#!/usr/bin/env node
// Drives a fresh vault through its lifecycle on the local stack (scripts/localstack/up.sh) against
// the real MPC nodes and anvil. Every NEAR tx and EVM RPC response lands in
// docs/evidence/localstack/<run>/.
//
// Usage: node scripts/localstack/lifecycle.mjs <vault.wasm> [run-name] [phases]
//   phases: comma list of A (scenarios a-e, g on vault A) and B (scenario f and the gas probe on vault B).
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { getAddress } from 'viem';
import { base58Decode, WISHES_PATH } from '../../relay/base.mjs';
import { openWithIdentityKey, unwrapCkd } from '../../agent/seal.mjs';
import { view } from './lib/near.mjs';
import { MPC, Recorder, RUN_DIR } from './lib/stack.mjs';
import { balance, block, eth, finalize, fund, heads, mine, nonceOf, receipt, setNextBaseFee, txpool } from './lib/evm.mjs';
import { CAP, deployVault, DEFAULT_TIMING, GWEI, nearNow, waitUntil } from './lib/vault.mjs';

const [wasmPath, runArg, phaseArg] = process.argv.slice(2);
if (!wasmPath) {
  console.error('usage: lifecycle.mjs <vault.wasm> [run-name] [A,B]');
  process.exit(1);
}
const wasm = readFileSync(wasmPath);
const run = runArg ?? `run-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '')}`;
const phases = (phaseArg ?? 'A,B').split(',');
const rec = new Recorder(run);
const tag = randomBytes(3).toString('hex');

const sha = (b) => createHash('sha256').update(b).digest('hex');
const bin = (cmd, args) => { try { return execFileSync(cmd, args, { encoding: 'utf8' }).trim().split('\n')[0]; } catch (e) { return `error: ${e.message}`; } };
const research = `${process.env.HOME}/development/near-hackathon-research`;

rec.file('versions.json', {
  vault_wasm: { path: wasmPath, sha256: sha(wasm), bytes: wasm.length },
  signer_wasm: { sha256: sha(readFileSync(`${research}/signer-wasm/v1.signer-prod.testnet.wasm`)), version: await view(MPC, 'version') },
  neard: bin(`${research}/bin/bin/neard`, ['--version']),
  mpc_node: bin(`${research}/bin/bin/mpc-node`, ['--version']),
  anvil: bin('anvil', ['--version']),
  node: process.version,
  mpc_state: await view(MPC, 'state'),
  mpc_config: await view(MPC, 'config'),
  available_foreign_chains: await view(MPC, 'get_available_foreign_chains'),
  allowed_foreign_chain_providers: await view(MPC, 'allowed_foreign_chain_providers'),
});

/** Saves an EVM observation and returns it. */
async function evm(label, value) {
  rec.step += 1;
  const file = `${String(rec.step).padStart(3, '0')}-evm-${label.replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 50)}.json`;
  rec.file(file, value);
  rec.log({ evm: label, file, summary: JSON.stringify(value, (_, x) => (typeof x === 'bigint' ? x.toString() : x)).slice(0, 300) });
  console.log(`evm  ${label} ${JSON.stringify(value, (_, x) => (typeof x === 'bigint' ? x.toString() : x)).slice(0, 200)}`);
  return value;
}

async function sendRaw(label, raw) {
  try {
    const hash = await eth('eth_sendRawTransaction', [raw]);
    return evm(`${label} accepted`, { hash, pool: await txpool() });
  } catch (e) {
    return evm(`${label} refused`, { error: e.message, rpc: e.rpc });
  }
}

/** Lines the MPC nodes logged about foreign-tx verification and signing between `since` and now. */
function nodeLog(label, since) {
  const lines = [];
  const strip = (l) => l.replace(/\x1b\[[0-9;]*m/g, '');
  for (const n of [1, 2, 3]) {
    try {
      const text = readFileSync(`${RUN_DIR}/logs/mpc-node-${n}.log`, 'utf8');
      for (const raw of text.split('\n')) {
        const line = strip(raw);
        const ts = line.slice(0, 27);
        if (ts >= since && /foreign|verify|finality|TransactionFailed|not found|NonCanonical|signature|ckd/i.test(line)) lines.push(`node${n}: ${line.slice(0, 500)}`);
      }
    } catch { /* no log */ }
  }
  const dedup = [...new Set(lines)];
  rec.file(`nodelog-${label}.txt`, `${dedup.slice(0, 40).join('\n')}\n...\n${dedup.slice(-40).join('\n')}\n(${dedup.length} matching lines)\n`);
  return dedup;
}

const vaultState = async (v, label) => {
  const s = await v.state();
  rec.file(`state-${label}.json`, s);
  return s;
};

async function matureClaim(v, label) {
  const s = await v.state();
  await waitUntil(s.last_check_in + DEFAULT_TIMING.inactivity_secs + 1);
  const r = await v.openClaim(label);
  const opened = (await v.state()).claim.opened_at;
  await waitUntil(opened + DEFAULT_TIMING.fallback_secs + 1);
  return r;
}

const freshEoa = () => getAddress(`0x${randomBytes(20).toString('hex')}`);

async function deployReverter() {
  // Runtime code `PUSH1 0 PUSH1 0 REVERT`: every call, including a plain value transfer, reverts.
  const hash = await eth('eth_sendTransaction', [{ from: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266', data: '0x6005600c60003960056000f360006000fd' }]);
  await mine(1);
  const r = await receipt(hash);
  const code = await eth('eth_getCode', [r.contractAddress, 'latest']);
  await evm('deploy reverting heir contract', { hash, receipt: r, code });
  return getAddress(r.contractAddress);
}

async function phaseA() {
  const reverter = await deployReverter();
  const heir0 = freshEoa();
  const v = await deployVault(rec, `ghost-a-${tag}`, { wasm, heirs: [heir0, reverter], gasLimits: [21000, 50000] });
  await evm('vault A addresses', { vault: v.account, evm: v.mpc.address, heir0, heir1_reverter: reverter });

  // a. owner active -> refused; witness claim; check-in cancels it.
  await v.openClaim('a1 claim while owner is active (refused)', { expect: 'fail' });
  await waitUntil((await v.state()).last_check_in + DEFAULT_TIMING.inactivity_secs + 1);
  await v.openClaim('a2 witness quorum opens claim after silence');
  await vaultState(v, 'a2-claim-open');
  await v.call('a3 owner check-in cancels the claim', 'check_in', {});
  const afterCheckIn = await vaultState(v, 'a3-after-check-in');
  rec.log({ assert: 'a3 claim cancelled', claim: afterCheckIn.claim, claim_epoch: afterCheckIn.claim_epoch });

  // b. second claim matures; fallback payout; the real MPC sign result passes on_signed.
  await matureClaim(v, 'b1 second claim opens');
  const b2 = await v.call('b2 fallback payout heir 0 (real MPC sign)', 'execute_fallback', { heir_index: 0 });
  const s0 = await vaultState(v, 'b2-after-sign');
  rec.log({ assert: 'b2 on_signed returned', value: b2.value, attempt0: s0.payouts[0]?.attempts[0] });

  // c. broadcast with a stuck fee, re-price on the same nonce, land it.
  await evm('fund vault address', await fund(v.mpc.address, 3n * CAP));
  await setNextBaseFee(3n * GWEI / 2n);
  await mine(1);
  const a0 = await v.signedRaw(0, 0);
  await sendRaw('c1 attempt 0 (max fee 1 gwei) with base fee 1.5 gwei', a0.raw);
  await setNextBaseFee(3n * GWEI / 2n);
  await mine(1);
  await evm('c2 after a block at 1.5 gwei base fee', { heads: await heads(), attempt0Receipt: await receipt(a0.txHash), nonce: await nonceOf(v.mpc.address), pool: await txpool() });
  await v.call('c3 request_signature re-price to 2 gwei (real MPC sign)', 'request_signature', { payout_index: 0, max_fee_per_gas: (2n * GWEI).toString() });
  const a1 = await v.signedRaw(0, 1);
  await sendRaw('c4 attempt 1 (max fee 2 gwei) same nonce', a1.raw);
  await setNextBaseFee(3n * GWEI / 2n);
  await mine(1);
  const r1 = await receipt(a1.txHash);
  await evm('c5 attempt 1 receipt', { receipt: r1, attempt0Receipt: await receipt(a0.txHash), heads: await heads(), pool: await txpool() });
  const landedAttempt = r1 ? 1 : 0;
  const landed = r1 ?? await receipt(a0.txHash);
  const landedBlock = Number(BigInt(landed.blockNumber));

  // d. settle before finality: the network must not attest; then finalize and settle.
  await evm('d1 heads before early settle', await heads());
  const sinceD1 = new Date().toISOString();
  const early = await v.call('d1 settle before finality (real verify_foreign_transaction)', 'settle', { payout_index: 0, attempt_index: landedAttempt }, { expect: 'any' });
  const sEarly = await vaultState(v, 'd1-after-early-settle');
  rec.log({ assert: 'd1 heir 0 still Pending', value: early.value, heir0: sEarly.heirs[0].status, heads: await heads() });
  nodeLog('d1-early-settle', sinceD1);
  await evm('d2 finalize the block', await finalize(landedBlock));
  const late = await v.call('d2 settle after finality (real verify_foreign_transaction)', 'settle', { payout_index: 0, attempt_index: landedAttempt });
  const sPaid = await vaultState(v, 'd2-after-settle');
  rec.log({ assert: 'd2 heir 0 Paid', value: late.value, heir0: sPaid.heirs[0].status, payout0: sPaid.payouts[0].status });

  // e. a heir that reverts on receive.
  await v.call('e1 fallback payout heir 1 (reverting contract)', 'execute_fallback', { heir_index: 1 });
  const e = await v.signedRaw(1, 0);
  await sendRaw('e2 broadcast payout 1', e.raw);
  await mine(1);
  const re = await receipt(e.txHash);
  await evm('e3 payout 1 receipt (status 0 expected)', { receipt: re });
  await evm('e3 finalize', await finalize(Number(BigInt(re.blockNumber))));
  const sinceE4 = new Date().toISOString();
  const eSettle = await v.call('e4 settle the reverted tx (network must not attest)', 'settle', { payout_index: 1, attempt_index: 0 }, { expect: 'any' });
  rec.log({ assert: 'e4 settle of reverted tx', value: eSettle.value, heir1: (await v.state()).heirs[1].status });
  nodeLog('e4-reverted-settle', sinceE4);
  await v.reopen('e5 witness quorum reopens the reverted payout', 1, 0, e.txHash.slice(2));
  await vaultState(v, 'e5-after-reopen');
  // v3 (e73a181+) makes a retry after a reopen wait REOPEN_DELAY_SECS (86400 s), so this may be refused.
  await v.call('e6 immediate retry payout for heir 1', 'execute_fallback', { heir_index: 1 }, { expect: 'any' });
  const sRetry = await vaultState(v, 'e6-after-retry');
  rec.log({ assert: 'e6 retry payout', payouts: sRetry.payouts.map((p) => ({ heir: p.heir_index, nonce: p.nonce, status: p.status, attempts: p.attempts.length, signed: p.attempts.map((x) => !!x.r_hex) })) });

  // g. CKD wishes key through the real nodes.
  const g = await v.call('g1 request_wishes_key (real CKD)', 'request_wishes_key', {});
  const secrets = v.secrets;
  let opened = null; let ckdError = null;
  try {
    const mpk = base58Decode(v.mpc.ckdKey.split(':')[1], 96);
    const g1 = (x) => base58Decode(x.split(':').pop(), 48);
    const key = unwrapCkd(g1(g.value.big_y), g1(g.value.big_c), BigInt(`0x${secrets.appSecret}`));
    opened = openWithIdentityKey(mpk, v.account, WISHES_PATH, key, secrets.sealed);
  } catch (err) { ckdError = err.message; }
  rec.log({ assert: 'g1 wishes opened with the CKD key after a pairing check', ok: opened === secrets.wishes, ckdError });
  rec.file('g1-ckd-result.json', { response: g.value, opened_matches_sealed: opened === secrets.wishes, error: ckdError });
  return v;
}

async function phaseB() {
  const heirs = [freshEoa(), freshEoa()];
  const v = await deployVault(rec, `ghost-b-${tag}`, { wasm, heirs });
  await evm('vault B addresses', { vault: v.account, evm: v.mpc.address, heirs });
  await matureClaim(v, 'f0 claim opens on vault B');
  await v.call('f1 fallback payout heir 0', 'execute_fallback', { heir_index: 0 });
  await evm('fund vault B address', await fund(v.mpc.address, 3n * CAP));
  const f = await v.signedRaw(0, 0);
  await sendRaw('f2 broadcast payout 0', f.raw);
  await mine(1);
  const rf = await receipt(f.txHash);
  const included = Number(BigInt(rf.blockNumber));
  await evm('f3 included, not final', { receipt: rf, heads: await heads(), nonce: await nonceOf(v.mpc.address) });
  const depth = (await heads()).latest - included + 1;
  await eth('anvil_reorg', [depth, []]);
  await evm('f4 after anvil_reorg', { depth, receipt: await receipt(f.txHash), heads: await heads(), blockAtIncluded: await block(`0x${included.toString(16)}`), nonce: await nonceOf(v.mpc.address), pool: await txpool(), balance: (await balance(v.mpc.address)).toString() });
  await mine(5);
  await evm('f5 five more blocks: reorged tx', { receipt: await receipt(f.txHash), heads: await heads(), nonce: await nonceOf(v.mpc.address) });
  const sinceF6 = new Date().toISOString();
  const fSettle = await v.call('f6 settle the reorged-out tx (network must not attest)', 'settle', { payout_index: 0, attempt_index: 0 }, { expect: 'any' });
  rec.log({ assert: 'f6 settle of reorged-out tx', value: fSettle.value, heir0: (await v.state()).heirs[0].status });
  nodeLog('f6-reorged-settle', sinceF6);
  await sendRaw('f7 rebroadcast the same signed tx', f.raw);
  await mine(1);
  const rf2 = await receipt(f.txHash);
  await evm('f8 same tx lands again', { receipt: rf2, nonce: await nonceOf(v.mpc.address) });
  // The leader retries a not-yet-final request about 10 times a second apart, a failover leader 5 more
  // after 10 s, then nobody tries again until the 200-block yield timeout. Finality that arrives
  // 30 s after the request therefore comes too late, even though the request is still pending.
  const sinceF9 = new Date().toISOString();
  const later = setTimeout(() => finalize(Number(BigInt(rf2.blockNumber))).then((h) => rec.log({ evm: 'f9 finalized 30 s into the pending settle', heads: h })), 30_000);
  const fLate = await v.call('f9 settle sent before finality; block finalizes 30 s later', 'settle', { payout_index: 0, attempt_index: 0 }, { expect: 'any' });
  clearTimeout(later);
  rec.log({ assert: 'f9 late finality during pending settle', value: fLate.value, heads: await heads() });
  nodeLog('f9-finality-30s-into-pending', sinceF9);
  await finalize(Number(BigInt(rf2.blockNumber)));
  const fOk = await v.call('f10 settle after finality', 'settle', { payout_index: 0, attempt_index: 0 });
  rec.log({ assert: 'f10 heir 0 Paid', value: fOk.value, heir0: (await v.state()).heirs[0].status });

  // v. gas at the largest reachable state: 2 heirs, max attempts (1, 2, 4, 8, 16 gwei).
  // Also: attempt 0 enters the pool while the base fee is low, then the base fee rises above it, and
  // each re-priced attempt (same nonce, same 1 gwei priority fee) is offered as a replacement.
  await v.call('v1 fallback payout heir 1 attempt 0', 'execute_fallback', { heir_index: 1 });
  const p0 = await v.signedRaw(1, 0);
  await sendRaw('c6 attempt 0 of payout 1 while base fee is low', p0.raw);
  await setNextBaseFee(3n * GWEI);
  await mine(1);
  await evm('c7 base fee 3 gwei: attempt 0 (1 gwei) stays pending', { heads: await heads(), receipt: await receipt(p0.txHash), pool: await txpool() });
  for (const [i, gwei] of [2n, 4n, 8n, 16n].entries()) {
    await v.call(`v2 re-price payout 1 to ${gwei} gwei`, 'request_signature', { payout_index: 1, max_fee_per_gas: (gwei * GWEI).toString() });
    if (i === 0) {
      const p1 = await v.signedRaw(1, 1);
      await sendRaw('c8 replacement attempt 1 (2 gwei max fee, same 1 gwei tip)', p1.raw);
      await evm('c8 pool after replacement offer', { pool: await txpool() });
    }
  }
  await v.call('v3 re-price past the ceiling (refused)', 'request_signature', { payout_index: 1, max_fee_per_gas: (32n * GWEI).toString() }, { expect: 'fail' });
  const last = await v.signedRaw(1, 4);
  await sendRaw('v4 broadcast attempt 4 (16 gwei) as a replacement', last.raw);
  await setNextBaseFee(3n * GWEI);
  await mine(1);
  let landedAt = -1; let rl = null;
  for (let a = 4; a >= 0 && !rl; a--) {
    const r = await receipt((await v.signedRaw(1, a)).txHash);
    if (r) { rl = r; landedAt = a; }
  }
  await evm('v4 which attempt of payout 1 landed', { landedAt, receipt: rl, pool: await txpool() });
  // Same race with finality 4 s after the request: inside the leader's retry window.
  const sinceV5 = new Date().toISOString();
  const soon = setTimeout(() => finalize(Number(BigInt(rl.blockNumber))).then((h) => rec.log({ evm: 'v5 finalized 4 s into the pending settle', heads: h })), 4_000);
  const v5 = await v.call(`v5 settle payout 1 attempt ${landedAt} at max state (finalizes 4 s after the request)`, 'settle', { payout_index: 1, attempt_index: landedAt }, { expect: 'any' });
  clearTimeout(soon);
  nodeLog('v5-finality-4s-into-pending', sinceV5);
  if (v5.value !== true) {
    await finalize(Number(BigInt(rl.blockNumber)));
    await v.call(`v6 settle payout 1 attempt ${landedAt} after finality`, 'settle', { payout_index: 1, attempt_index: landedAt });
  }
  await vaultState(v, 'v5-final');
  return v;
}

try {
  if (phases.includes('A')) await phaseA();
  if (phases.includes('B')) await phaseB();
  console.log(`evidence: docs/evidence/localstack/${run}/`);
} catch (e) {
  rec.log({ fatal: e.message, stack: e.stack });
  console.error(e);
  process.exit(1);
}
