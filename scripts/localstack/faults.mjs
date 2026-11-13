#!/usr/bin/env node
// Dependency-failure injection on the local stack. Each fault goes through the real governance
// path of the 3.18.0 signer contract (votes by the real node accounts), then the vault is driven
// and whatever it did is recorded under docs/evidence/localstack/<run>/.
//
// Usage: node scripts/localstack/faults.mjs <vault.wasm> [run-name] [faults]
//   faults: comma list of gasconfig, providers, reshare, storage, signers, upgrade-same, upgrade-break
//   upgrade-break replaces the signer contract and leaves the stack unusable; run it last.
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { getAddress } from 'viem';
import { act, NEAR, query, rpc, sleep, view, viewAccount } from './lib/near.mjs';
import { BASE_WHITELIST, loadState, MPC, newKey, Recorder, RUN_DIR, saveState } from './lib/stack.mjs';
import { eth, finalize, fund, heads, mine, receipt, setNextBaseFee } from './lib/evm.mjs';
import { CAP, deployVault, DEFAULT_TIMING, GWEI, waitUntil } from './lib/vault.mjs';

const [wasmPath, runArg, faultArg] = process.argv.slice(2);
if (!wasmPath) {
  console.error('usage: faults.mjs <vault.wasm> [run-name] [faults]');
  process.exit(1);
}
const wasm = readFileSync(wasmPath);
const run = runArg ?? `faults-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '')}`;
const faults = (faultArg ?? 'gasconfig,providers,reshare,storage,signers,upgrade-same,upgrade-break').split(',');
const rec = new Recorder(run);
const tag = randomBytes(3).toString('hex');
const research = `${process.env.HOME}/development/near-hackathon-research`;
const SIGNER_WASM = `${research}/signer-wasm/v1.signer-prod.testnet.wasm`;
const MIGRATION_WASM = process.env.MIGRATION_WASM ?? `${research}/signer-wasm/test_migration_contract.wasm`;
const sha = (b) => createHash('sha256').update(b).digest('hex');
let participantList = [];
/** Current participants, read from the contract (refreshed before each governance action). */
async function refreshParticipants() {
  const st = await view(MPC, 'state');
  const params = (st.Running ?? st.Resharing?.previous_running_state ?? {}).parameters;
  participantList = params.participants.participants.map((x) => x[0]);
  return participantList;
}
const participants = () => participantList;
const freshEoa = () => getAddress(`0x${randomBytes(20).toString('hex')}`);

async function rawConfig() {
  const r = await query({ request_type: 'call_function', account_id: MPC, method_name: 'config', args_base64: '' });
  return Buffer.from(r.result).toString();
}

const CONFIG_FIELDS = ['key_event_timeout_blocks', 'tee_upgrade_deadline_duration_seconds', 'apply_contract_update_tera_gas',
  'sign_call_gas_attachment_requirement_tera_gas', 'ckd_call_gas_attachment_requirement_tera_gas',
  'return_signature_and_clean_state_on_success_call_tera_gas', 'return_ck_and_clean_state_on_success_call_tera_gas',
  'fail_on_timeout_tera_gas', 'fail_attestation_submission_tera_gas', 'clean_tee_status_tera_gas', 'clean_invalid_attestations_tera_gas',
  'cleanup_orphaned_node_migrations_tera_gas', 'remove_non_participant_update_votes_tera_gas', 'clean_foreign_chain_data_tera_gas',
  'remove_non_participant_tee_verifier_votes_tera_gas', 'verifier_tera_gas', 'resolve_verification_tera_gas',
  'launcher_hash_unused_ttl_seconds', 'attestation_storage_fee_millinear'];

/** borsh(Update::Config(config)) and its UpdateHash (sha256 of the serde_json bytes). */
function configUpdate(config) {
  const keys = Object.keys(config);
  if (keys.join() !== CONFIG_FIELDS.join()) throw new Error(`config fields changed: ${keys.join()}`);
  const borsh = Buffer.alloc(1 + 8 * keys.length);
  borsh[0] = 1;
  keys.forEach((k, i) => borsh.writeBigUInt64LE(BigInt(config[k]), 1 + 8 * i));
  return { borsh, hash: { Config: sha(Buffer.from(JSON.stringify(config))) } };
}

function codeUpdate(code) {
  const borsh = Buffer.alloc(5 + code.length);
  borsh[0] = 0;
  borsh.writeUInt32LE(code.length, 1);
  code.copy(borsh, 5);
  return { borsh, hash: { Code: sha(code) } };
}

/** Real governance: every participant votes, then one submits. */
async function applyUpdate(label, update) {
  await refreshParticipants();
  for (const p of participants()) {
    await rec.call(`${label}: ${p} vote_contract_update`, p, MPC, 'vote_contract_update', { update_hash: update.hash });
  }
  return rec.tx(`${label}: submit_contract_update`, participants()[0], MPC, [act.callRaw('submit_contract_update', update.borsh, 300n * 10n ** 12n, 1n)]);
}

async function readyVault(name, heirs = [freshEoa(), freshEoa()]) {
  const v = await deployVault(rec, `${name}-${tag}`, { wasm, heirs });
  await waitUntil((await v.state()).last_check_in + DEFAULT_TIMING.inactivity_secs + 1);
  await v.openClaim(`${name}: claim opens`);
  await waitUntil((await v.state()).claim.opened_at + DEFAULT_TIMING.fallback_secs + 1);
  return v;
}

const signedAttempts = (s, p) => s.payouts[p].attempts.map((a, i) => ({ i, fee: a.max_fee_per_gas, signed: !!a.r_hex }));

async function landAndFinalize(v, p, a) {
  const { raw, txHash } = await v.signedRaw(p, a);
  await setNextBaseFee(GWEI / 10n);
  await mine(1);
  await eth('eth_sendRawTransaction', [raw]);
  await mine(1);
  const r = await receipt(txHash);
  await finalize(Number(BigInt(r.blockNumber)));
  rec.log({ evm: `payout ${p} attempt ${a} landed and finalized`, txHash, status: r.status, block: r.blockNumber, heads: await heads() });
  return r;
}

// ---------------- faults ----------------

let F; // shared vault for the signer-side faults

async function shared() {
  if (F) return F;
  F = await readyVault('ghost-f');
  await rec.call('F baseline: fallback payout heir 0 (real sign)', F.owner, F.account, 'execute_fallback', { heir_index: 0 });
  await fund(F.mpc.address, 4n * CAP);
  await landAndFinalize(F, 0, 0);
  return F;
}

/** One real MPC sign through the vault: a new payout for an open heir, else a re-price of an active one. */
async function signTest(v, label, opts = {}) {
  const s = await v.state();
  const heir = s.heirs.findIndex((h) => h.status === 'Open');
  if (heir >= 0) return rec.call(`${label} (fallback heir ${heir})`, v.owner, v.account, 'execute_fallback', { heir_index: heir }, { expect: 'any', ...opts });
  const ceiling = BigInt(s.max_fee_ceiling);
  const p = s.payouts.findIndex((x) => x.status === 'Active' && !x.signing && BigInt(x.attempts.at(-1).max_fee_per_gas) < ceiling);
  if (p < 0) throw new Error('no heir or payout left to sign for');
  const next = BigInt(s.payouts[p].attempts.at(-1).max_fee_per_gas) * 2n;
  return rec.call(`${label} (re-price payout ${p})`, v.owner, v.account, 'request_signature', { payout_index: p, max_fee_per_gas: (next > ceiling ? ceiling : next).toString() }, { expect: 'any', ...opts });
}

const prepaidOf = (r, method) => r.receipts?.filter((x) => x.method === method).map((x) => Number(BigInt(x.prepaid_gas ?? 0) / 10n ** 12n));

async function gasconfig() {
  // Raises the signer's sign-gas requirement through a real config vote, then drives the vault.
  // GAS_REQS lists the requirements to try (Tgas); the vault call always prepays 300 Tgas.
  const v = await shared();
  const original = JSON.parse(await rawConfig());
  rec.file('vi-config-before.json', original);
  const reqs = (process.env.GAS_REQS ?? '151').split(',').map(Number);
  const prepaid = Number(process.env.GAS_PREPAID ?? 300);
  for (const req of reqs) {
    const r = await applyUpdate(`vi raise sign gas requirement to ${req} Tgas`, configUpdate({ ...original, sign_call_gas_attachment_requirement_tera_gas: req }));
    await sleep(3000);
    const now = JSON.parse(await rawConfig());
    rec.log({ assert: `vi config applied (${req})`, applied: now.sign_call_gas_attachment_requirement_tera_gas, submit_ok: r.ok });
    const sig = await signTest(v, `vi sign (${prepaid} Tgas prepaid) with requirement ${req} Tgas`, { gas: prepaid });
    const s = await v.state();
    rec.log({ assert: `vi vault sign under requirement ${req}`, value: sig.value, sign_prepaid_tgas: prepaidOf(sig, 'sign'), on_signed_prepaid_tgas: prepaidOf(sig, 'on_signed'), innerErrors: sig.innerErrors, payouts: s.payouts.map((x, i) => ({ i, status: x.status, signing: x.signing, attempts: signedAttempts(s, i) })) });
    const st = await rec.call(`vi settle (${prepaid} Tgas) with requirement ${req} Tgas`, v.owner, v.account, 'settle', { payout_index: 0, attempt_index: 0 }, { expect: 'any', gas: prepaid });
    rec.log({ assert: `vi settle under requirement ${req}`, value: st.value, verify_prepaid_tgas: prepaidOf(st, 'verify_foreign_transaction'), innerErrors: st.innerErrors, heir0: (await v.state()).heirs[0].status });
  }
  // Can a caller attach more than 300 Tgas to buy more headroom?
  const big = await rec.call('vi request_signature prepaying 1000 Tgas', v.owner, v.account, 'request_signature', { payout_index: 0, max_fee_per_gas: GWEI.toString() }, { expect: 'any', gas: 1000 });
  rec.log({ assert: 'vi 1000 Tgas prepaid', ok: big.ok, error: big.error });
  const ck = await rec.call('vi request_wishes_key under raised sign requirement', v.owner, v.account, 'request_wishes_key', {}, { expect: 'any' });
  rec.log({ assert: 'vi ckd under raised sign requirement', ok: ck.ok, hasKey: !!ck.value?.big_y });
  await applyUpdate('vi restore sign gas requirement', configUpdate(original));
  await sleep(3000);
  rec.log({ assert: 'vi restored', value: JSON.parse(await rawConfig()).sign_call_gas_attachment_requirement_tera_gas });
}

async function providers() {
  const v = await shared();
  const before = await view(MPC, 'get_available_foreign_chains');
  // Same anvil node, different host: the nodes' local `127.0.0.1` provider no longer conforms.
  await refreshParticipants();
  for (const p of participants()) {
    await rec.call(`ii ${p} votes Base provider -> http://localhost:8545`, p, MPC, 'vote_update_foreign_chain_providers', { votes: BASE_WHITELIST('http://localhost:8545') });
  }
  let after;
  for (let t = 0; t < 40; t++) {
    after = await view(MPC, 'get_available_foreign_chains');
    if (!JSON.stringify(after).includes('Base')) break;
    await sleep(3000);
  }
  rec.log({ assert: 'ii Base availability', before, after, whitelist: await view(MPC, 'allowed_foreign_chain_providers'), configs: await view(MPC, 'get_foreign_chains_configs') });
  const st = await rec.call('ii settle while Base is unavailable', v.owner, v.account, 'settle', { payout_index: 0, attempt_index: 0 }, { expect: 'any' });
  rec.log({ assert: 'ii settle with Base unavailable', value: st.value, heir0: (await v.state()).heirs[0].status });
  for (const p of participants()) {
    await rec.call(`ii ${p} restores Base provider`, p, MPC, 'vote_update_foreign_chain_providers', { votes: BASE_WHITELIST() });
  }
  for (let t = 0; t < 40; t++) {
    if (JSON.stringify(await view(MPC, 'get_available_foreign_chains')).includes('Base')) break;
    await sleep(3000);
  }
  const ok = await rec.call('ii settle after Base restored', v.owner, v.account, 'settle', { payout_index: 0, attempt_index: 0 }, { expect: 'any' });
  rec.log({ assert: 'ii settle after restore', value: ok.value, heir0: (await v.state()).heirs[0].status });
}

async function startThirdNode() {
  const state = loadState();
  const account = 'mpc-node-3.test.near';
  if (!state.accounts[account]) {
    const k = newKey();
    state.accounts[account] = { pem: k.pem, publicKey: k.publicKey };
    saveState(state);
    await rec.tx(`iii create ${account}`, 'test.near', account, [act.createAccount(), act.transfer(NEAR(100)), act.addFullKey(k.publicKey)]);
  }
  try {
    const data = await (await fetch('http://127.0.0.1:8083/public_data')).json();
    return { account, data }; // already running with its keys registered
  } catch { /* start it */ }
  const home = `${RUN_DIR}/mpc-node-3`;
  const conf = readFileSync(`${RUN_DIR}/mpc-node-2/mpc-config.toml`, 'utf8').replaceAll('mpc-node-2', 'mpc-node-3')
    .replace('127.0.0.1:3032', '127.0.0.1:3033').replace('127.0.0.1:24568', '127.0.0.1:24569').replace('127.0.0.1:8082', '127.0.0.1:8083')
    .replace('127.0.0.1:8092', '127.0.0.1:8093').replace('127.0.0.1:34002', '127.0.0.1:34003');
  const { mkdirSync, openSync } = await import('node:fs');
  mkdirSync(home, { recursive: true });
  writeFileSync(`${home}/mpc-config.toml`, conf);
  const out = openSync(`${RUN_DIR}/logs/mpc-node-3.log`, 'a');
  const child = spawn(`${research}/bin/bin/mpc-node`, ['start-with-config-file', `${home}/mpc-config.toml`], { detached: true, stdio: ['ignore', out, out], env: { ...process.env, RUST_LOG: 'info' } });
  writeFileSync(`${RUN_DIR}/pids/mpc-node-3.pid`, String(child.pid));
  child.unref();
  let data;
  for (let t = 0; t < 120; t++) {
    try { data = await (await fetch('http://127.0.0.1:8083/public_data')).json(); break; } catch { await sleep(2000); }
  }
  await rec.tx('iii mpc-node-3 node keys', account, account, [
    act.addFnKey(data.near_signer_public_key, MPC, []), ...data.near_responder_public_keys.map((k) => act.addFnKey(k, MPC, [])),
  ]);
  const s = loadState();
  s.nodes.push({ account, p2p: data.near_p2p_public_key, signer: data.near_signer_public_key });
  saveState(s);
  return { account, data };
}

async function reshare() {
  const v = await shared();
  const keysBefore = { 0: await view(MPC, 'public_key', { domain_id: 0 }), 3: await view(MPC, 'public_key', { domain_id: 3 }), derived: await view(MPC, 'derived_public_key', { path: 'ghost-base-sepolia-1', predecessor: v.account, domain_id: 0 }) };
  const third = await startThirdNode();
  // A new node's attestation needs one prepaid storage grant (fee from `config`, in milliNEAR);
  // the node then submits its (local, mock) attestation itself, retrying with backoff up to 60 s.
  if (!JSON.stringify(await view(MPC, 'get_tee_accounts')).includes(third.account) && (await view(MPC, 'available_attestation_grants', { account_id: third.account })) === 0) {
    const fee = BigInt(JSON.parse(await rawConfig()).attestation_storage_fee_millinear) * 10n ** 21n;
    await rec.call('iii prepay one attestation-storage grant for mpc-node-3', 'test.near', MPC, 'prepay_attestation_storage', { account_id: third.account, grants: 1 }, { deposit: fee, gas: 30 });
  }
  for (let t = 0; t < 60; t++) {
    const tee = await view(MPC, 'get_tee_accounts');
    if (JSON.stringify(tee).includes(third.account)) break;
    await sleep(3000);
  }
  rec.log({ view: 'iii tee accounts', value: await view(MPC, 'get_tee_accounts') });
  const st = await view(MPC, 'state');
  const current = st.Running.parameters;
  const proposal = { parameters: {
    threshold: 2,
    participants: {
      next_id: current.participants.next_id + 1,
      participants: [...current.participants.participants, [third.account, current.participants.next_id, { url: 'https://localhost:3002', tls_public_key: third.data.near_p2p_public_key }]],
    },
  } };
  const epoch = st.Running.keyset.epoch_id + 1;
  for (const p of [...current.participants.participants.map((x) => x[0]), third.account]) {
    await rec.call(`iii ${p} vote_new_parameters (add node 3)`, p, MPC, 'vote_new_parameters', { prospective_epoch_id: epoch, proposal }, { expect: 'any' });
  }
  let final;
  for (let t = 0; t < 200; t++) {
    final = await view(MPC, 'state');
    if (final.Running && final.Running.keyset.epoch_id === epoch) break;
    if (t % 10 === 0) console.log(`  resharing: ${Object.keys(final)[0]}`);
    await sleep(3000);
  }
  const keysAfter = { 0: await view(MPC, 'public_key', { domain_id: 0 }), 3: await view(MPC, 'public_key', { domain_id: 3 }), derived: await view(MPC, 'derived_public_key', { path: 'ghost-base-sepolia-1', predecessor: v.account, domain_id: 0 }) };
  rec.file('iii-state-after-reshare.json', final);
  rec.log({ assert: 'iii keys unchanged by resharing', same: JSON.stringify(keysBefore) === JSON.stringify(keysAfter), keysBefore, keysAfter, epoch: final.Running?.keyset.epoch_id });
  const sig = await rec.call('iii request_signature after resharing (real sign, 3 participants)', v.owner, v.account, 'request_signature',
    { payout_index: 0, max_fee_per_gas: (2n * GWEI).toString() }, { expect: 'any' });
  rec.log({ assert: 'iii vault signs after resharing', value: sig.value, attempts: signedAttempts(await v.state(), 0) });
  const settle = await rec.call('iii settle after resharing (real verify_foreign_transaction)', v.owner, v.account, 'settle', { payout_index: 0, attempt_index: 0 }, { expect: 'any' });
  rec.log({ assert: 'iii vault settles after resharing', value: settle.value, heir0: (await v.state()).heirs[0].status });
}

async function storage() {
  // How the vault behaves when its NEAR balance barely covers its storage. The vault still holds its
  // full-access key on the localnet, so the harness can drain it, then top it up to an exact number
  // of free bytes from test.near.
  const PER_BYTE = 10n ** 19n;
  const v = await readyVault('ghost-s', [freshEoa(), freshEoa()]);
  const optimisticAccount = (id) => query({ request_type: 'view_account', account_id: id, finality: 'optimistic' });
  const acct = async () => {
    const a = await viewAccount(v.account);
    const amount = BigInt(a.amount);
    return { amount: amount.toString(), storage_usage: a.storage_usage, free_bytes: Number((amount - BigInt(a.storage_usage) * PER_BYTE) / PER_BYTE) };
  };
  const setFree = async (bytes, label) => {
    let a = await acct();
    const drain = BigInt(a.free_bytes - 40) * PER_BYTE;
    if (drain > 0n) await rec.tx(`iv drain ${label}`, v.account, 'test.near', [act.transfer(drain)]);
    a = await acct();
    const top = BigInt(bytes - a.free_bytes) * PER_BYTE;
    if (top > 0n) await rec.tx(`iv top up ${label}`, 'test.near', v.account, [act.transfer(top)]);
    a = await acct();
    rec.log({ assert: `iv free bytes set: ${label}`, target: bytes, ...a });
    return a;
  };
  let fee = 1n;
  const reprice = async (label) => {
    fee *= 2n;
    const r = await rec.call(label, v.owner, v.account, 'request_signature', { payout_index: 0, max_fee_per_gas: (fee * GWEI).toString() }, { expect: 'any' });
    const s = await v.state();
    if (!s.payouts[0].attempts.some((x) => BigInt(x.max_fee_per_gas) === fee * GWEI)) fee /= 2n; // refused: reuse the fee
    rec.log({ assert: label, value: r.value, error: r.error, innerErrors: r.innerErrors, account: await acct(),
      payouts: s.payouts.map((p, i) => ({ i, heir: p.heir_index, status: p.status, signing: p.signing, attempts: signedAttempts(s, i) })) });
    return { r, s };
  };

  // 1. Measure one re-price with ample balance: storage after begin_attempt (first change seen at
  //    optimistic finality) and after on_signed.
  await rec.call('iv fallback heir 0 (ample balance)', v.owner, v.account, 'execute_fallback', { heir_index: 0 });
  const s0 = (await acct()).storage_usage;
  const seen = [];
  let done = false;
  const pending = reprice('iv measure: re-price with ample balance').then((x) => { done = true; return x; });
  while (!done) {
    const u = (await optimisticAccount(v.account)).storage_usage;
    if (seen.at(-1) !== u) seen.push(u);
    await sleep(100);
  }
  await pending;
  const s1 = (await acct()).storage_usage;
  const mid = seen.find((u) => u !== s0) ?? s1;
  const beginBytes = mid - s0;
  const signBytes = s1 - mid;
  rec.log({ assert: 'iv measured storage deltas', before: s0, storage_values_seen: seen, after: s1, begin_attempt_bytes: beginBytes, on_signed_bytes: signBytes });

  // 2. Not enough for begin_attempt: the request itself should fail and leave nothing behind.
  await setFree(Math.max(1, Math.floor(beginBytes / 2)), 'below begin_attempt');
  await reprice('iv re-price with too little storage for begin_attempt');

  // 3. Enough for begin_attempt but not on_signed: the callback fails after the MPC network signed.
  let lostSignature = null;
  if (signBytes > 0) {
    await setFree(beginBytes + Math.max(1, Math.floor(signBytes / 2)), 'between begin_attempt and on_signed');
    const { r } = await reprice('iv re-price with storage for begin_attempt only');
    // The MPC network's signature is still on chain: the return value of the signer's yield callback.
    try {
      const st = await rpc('EXPERIMENTAL_tx_status', { tx_hash: r.hash, sender_account_id: v.owner, wait_until: 'FINAL' });
      const ids = new Set((st.receipts ?? []).filter((x) => x.receipt?.Action?.actions?.some((a) => a.FunctionCall?.method_name === 'return_signature_and_clean_state_on_success')).map((x) => x.receipt_id));
      const out = st.receipts_outcome.find((o) => ids.has(o.id) && o.outcome.status?.SuccessValue);
      lostSignature = out && JSON.parse(Buffer.from(out.outcome.status.SuccessValue, 'base64').toString());
    } catch (e) { rec.log({ assert: 'iv could not read the lost signature', error: e.message }); }
    rec.log({ assert: 'iv MPC signature returned to the failed callback, read from the chain', signature: lostSignature });
  } else {
    rec.log({ assert: 'iv on_signed adds no storage beyond begin_attempt; case 3 does not exist', beginBytes, signBytes });
  }

  // 4. A plain transfer, then try again on the same payout and on the other heir.
  await rec.tx('iv plain transfer of 1 NEAR to the vault', 'test.near', v.account, [act.transfer(NEAR(1))]);
  await reprice('iv re-price after the transfer');
  if (lostSignature) {
    // v3 (e73a181+): anyone may submit the MPC signature of an attempt whose callback was lost.
    const s = await v.state();
    const a = s.payouts[0].attempts.findIndex((x) => !x.tx_hash_hex);
    if (a >= 0) {
      const sub = await rec.call(`iv submit_signature for payout 0 attempt ${a} with the signature from the chain`, v.owner, v.account, 'submit_signature', { payout_index: 0, attempt_index: a, signature: lostSignature }, { expect: 'any', gas: 50 });
      const s2 = await v.state();
      rec.log({ assert: 'iv submit_signature after a storage-failed callback', ok: sub.ok, value: sub.value, error: sub.error, payout0: { signing: s2.payouts[0].signing, attempts: signedAttempts(s2, 0) } });
      if (sub.ok) await reprice('iv re-price after submit_signature');
    }
  }
  const stuck = (await v.state()).payouts[0];
  if (stuck.signing && process.env.STORAGE_LEASE_WAIT === '1' && stuck.signing_since !== undefined) {
    // v3: a request whose callback never came may be replaced after SIGN_LEASE_SECS (3600 s).
    rec.log({ assert: 'iv waiting out the sign lease', signing_since: stuck.signing_since, until: stuck.signing_since + 3600 });
    await waitUntil(stuck.signing_since + 3600 + 2);
    await reprice('iv re-price after the 3600 s lease');
  }
  const r = await rec.call('iv fallback heir 1 after the transfer', v.owner, v.account, 'execute_fallback', { heir_index: 1 }, { expect: 'any' });
  rec.log({ assert: 'iv other heir after transfer', value: r.value, error: r.error, account: await acct() });
  rec.file('iv-final-state.json', await v.state());
}

async function signers() {
  // State growth the owner controls: register_signer pushes without a bound. Measures on_signed gas
  // at 2 heirs + max attempts with many registered signers.
  const v = await deployVault(rec, `ghost-g-${tag}`, { wasm, heirs: [freshEoa(), freshEoa()] });
  const n = Number(process.env.SIGNERS ?? 120);
  const expires = Math.floor(Date.now() / 1000) + 86400 * 365;
  for (let batch = 0; batch < n; batch += 40) {
    const actions = [];
    for (let i = batch; i < Math.min(n, batch + 40); i++) {
      actions.push(act.call('register_signer', { address: `0x${randomBytes(20).toString('hex')}`, quote_sha256: 'ab'.repeat(32), expires_at: expires, proofs: [] }, 7));
    }
    await rec.tx(`v register ${actions.length} signers (owner, before claim)`, v.owner, v.account, actions);
  }
  const extra = await rec.call(`v register signer number ${n + 1}`, v.owner, v.account, 'register_signer', { address: `0x${randomBytes(20).toString('hex')}`, quote_sha256: 'ab'.repeat(32), expires_at: expires, proofs: [] }, { expect: 'any', gas: 30 });
  rec.log({ assert: `v signer ${n + 1} accepted?`, ok: extra.ok, error: extra.error });
  const a = await viewAccount(v.account);
  rec.log({ assert: 'v state size with signers', storage_usage: a.storage_usage, signers: (await v.state()).signers.length });
  await waitUntil((await v.state()).last_check_in + DEFAULT_TIMING.inactivity_secs + 1);
  await v.openClaim('v claim opens');
  await waitUntil((await v.state()).claim.opened_at + DEFAULT_TIMING.fallback_secs + 1);
  await rec.call('v fallback heir 0', v.owner, v.account, 'execute_fallback', { heir_index: 0 });
  await rec.call('v fallback heir 1', v.owner, v.account, 'execute_fallback', { heir_index: 1 });
  for (const gwei of [2n, 4n, 8n, 16n]) {
    await rec.call(`v re-price payout 1 to ${gwei} gwei with ${n} signers`, v.owner, v.account, 'request_signature', { payout_index: 1, max_fee_per_gas: (gwei * GWEI).toString() }, { expect: 'any' });
  }
  await fund(v.mpc.address, 4n * CAP);
  await landAndFinalize(v, 0, 0); // nonce 0 first, or nonce 1 waits in the pool
  await landAndFinalize(v, 1, 4);
  await rec.call(`v settle payout 1 attempt 4 with ${n} signers`, v.owner, v.account, 'settle', { payout_index: 1, attempt_index: 4 }, { expect: 'any' });
  rec.log({ assert: 'v final', storage_usage: (await viewAccount(v.account)).storage_usage, heir1: (await v.state()).heirs[1].status });
}

async function upgradeSame() {
  const v = await shared();
  const code = readFileSync(SIGNER_WASM);
  const r = await applyUpdate('i upgrade signer to the same 3.18.0 code', codeUpdate(code));
  await sleep(5000);
  const acc = await viewAccount(MPC);
  rec.log({ assert: 'i code hash after same-code upgrade', code_hash: acc.code_hash, submit_ok: r.ok, innerErrors: r.innerErrors, version: await view(MPC, 'version') });
  const s = await v.state();
  const p = s.payouts.findIndex((x) => x.status === 'Active');
  const heir = s.heirs.findIndex((h) => h.status === 'Open');
  const sig = p >= 0
    ? await rec.call('i request_signature after same-code upgrade', v.owner, v.account, 'request_signature', { payout_index: p, max_fee_per_gas: (BigInt(s.payouts[p].attempts.at(-1).max_fee_per_gas) * 2n).toString() }, { expect: 'any' })
    : await rec.call('i fallback heir after same-code upgrade', v.owner, v.account, 'execute_fallback', { heir_index: heir }, { expect: 'any' });
  rec.log({ assert: 'i vault signs after same-code upgrade', value: sig.value, error: sig.error });
}

async function upgradeBreak() {
  const v = await shared();
  const code = readFileSync(MIGRATION_WASM);
  const r = await applyUpdate('i upgrade signer to crates/test-migration-contract (no sign method)', codeUpdate(code));
  await sleep(5000);
  const acc = await viewAccount(MPC);
  rec.log({ assert: 'i code hash after breaking upgrade', code_hash: acc.code_hash, migration_sha256: sha(code), submit_ok: r.ok, innerErrors: r.innerErrors });
  const s = await v.state();
  const heir = s.heirs.findIndex((h) => h.status === 'Open');
  const p = s.payouts.findIndex((x) => x.status === 'Active');
  const sig = heir >= 0
    ? await rec.call('i fallback after the signer lost sign', v.owner, v.account, 'execute_fallback', { heir_index: heir }, { expect: 'any' })
    : await rec.call('i re-price after the signer lost sign', v.owner, v.account, 'request_signature', { payout_index: p, max_fee_per_gas: (BigInt(s.payouts[p].attempts.at(-1).max_fee_per_gas) * 2n).toString() }, { expect: 'any' });
  const s2 = await v.state();
  rec.log({ assert: 'i vault after signer lost sign', value: sig.value, error: sig.error, innerErrors: sig.innerErrors, payouts: s2.payouts.map((x, i) => ({ i, status: x.status, signing: x.signing, attempts: signedAttempts(s2, i) })) });
  const st = await rec.call('i settle after the signer lost verify_foreign_transaction', v.owner, v.account, 'settle', { payout_index: 0, attempt_index: 0 }, { expect: 'any' });
  rec.log({ assert: 'i settle after breaking upgrade', value: st.value, innerErrors: st.innerErrors });
  rec.file('i-final-vault-state.json', await v.state());
}


async function maxstate() {
  // v3 bounds state (16 heirs, 32 witnesses, 8 signers); attempts are bounded only by the fee
  // range. Builds the largest of these on the real stack and measures what the callbacks burn.
  const H = Number(process.env.MAX_HEIRS ?? 16);
  const W = Number(process.env.MAX_WITNESSES ?? 32);
  const S = Number(process.env.MAX_SIGNERS ?? 8);
  const exp = BigInt(process.env.MAX_CEILING_EXP ?? 40); // fees 1, 2, 4, ... 2^exp wei: exp + 1 attempts
  const timing = { ...DEFAULT_TIMING, contest_secs: 1, fallback_secs: 60 };
  const heirs = Array.from({ length: H }, freshEoa);
  const v = await deployVault(rec, `ghost-m-${tag}`, { wasm, heirs, witnessCount: W, timing, initialWei: 1n, ceilingWei: 1n << exp, priorityWei: 1n, fund: NEAR(50) });
  const expires = Math.floor(Date.now() / 1000) + 86400 * 365;
  const reg = Array.from({ length: S }, () => act.call('register_signer', { address: `0x${randomBytes(20).toString('hex')}`, quote_sha256: 'ab'.repeat(32), expires_at: expires, proofs: [] }, 30));
  await rec.tx(`v max: owner registers ${S} signers`, v.owner, v.account, reg);
  await waitUntil((await v.state()).last_check_in + timing.inactivity_secs + 1);
  await v.openClaim('v max: claim opens');
  await waitUntil((await v.state()).claim.opened_at + timing.fallback_secs + 1);
  const gas = [];
  const note = (label, r) => {
    const g = r.receipts?.find((x) => x.method === 'on_signed' || x.method === 'on_settled');
    gas.push({ label, value: r.value, method: g?.method, tgas: g?.tgas, prepaid_tgas: g?.prepaid_gas && Number(BigInt(g.prepaid_gas) / 10n ** 12n) });
  };
  for (let h = 0; h < H; h++) note(`fallback heir ${h}`, await rec.call(`v max: fallback heir ${h}`, v.owner, v.account, 'execute_fallback', { heir_index: h }, { expect: 'any' }));
  const last = 0; // nonce 0, so it can land without the other payouts' nonces before it
  for (let e = 1n; e <= exp; e++) {
    note(`re-price payout ${last} to 2^${e} wei`, await rec.call(`v max: re-price payout ${last} to 2^${e} wei`, v.owner, v.account, 'request_signature', { payout_index: last, max_fee_per_gas: (1n << e).toString() }, { expect: 'any' }));
  }
  await fund(v.mpc.address, 10n ** 18n);
  const s = await v.state();
  const a = s.payouts[last].attempts.length - 1;
  await landAndFinalize(v, last, a);
  note(`settle payout ${last} attempt ${a}`, await rec.call(`v max: settle payout ${last} attempt ${a}`, v.owner, v.account, 'settle', { payout_index: last, attempt_index: a }, { expect: 'any' }));
  const acc = await viewAccount(v.account);
  rec.file('v-max-gas.json', { heirs: H, witnesses: W, signers: s.signers.length, attempts_on_last_payout: s.payouts[last].attempts.length, storage_usage: acc.storage_usage, callbacks: gas });
  rec.log({ assert: 'v max state callback gas', max_on_signed: Math.max(...gas.filter((g) => g.method === 'on_signed').map((g) => g.tgas)), on_settled: gas.find((g) => g.method === 'on_settled')?.tgas, storage_usage: acc.storage_usage });
}

async function reshareRemove() {
  // Drops mpc-node-3 again through the real vote; keys must stay the same and the vault keep working.
  const v = await shared();
  const keys = async () => ({ 0: await view(MPC, 'public_key', { domain_id: 0 }), 3: await view(MPC, 'public_key', { domain_id: 3 }) });
  const before = await keys();
  const st = await view(MPC, 'state');
  const current = st.Running.parameters;
  const kept = current.participants.participants.filter((x) => x[0] !== 'mpc-node-3.test.near');
  if (kept.length === current.participants.participants.length) { rec.log({ assert: 'iii-remove: node 3 is not a participant, skipped' }); return; }
  const proposal = { parameters: { threshold: 2, participants: { next_id: current.participants.next_id, participants: kept } } };
  const epoch = st.Running.keyset.epoch_id + 1;
  for (const [p] of kept) await rec.call(`iii-remove ${p} vote_new_parameters (drop node 3)`, p, MPC, 'vote_new_parameters', { prospective_epoch_id: epoch, proposal }, { expect: 'any' });
  let final;
  for (let t = 0; t < 200; t++) {
    final = await view(MPC, 'state');
    if (final.Running && final.Running.keyset.epoch_id === epoch) break;
    await sleep(3000);
  }
  const after = await keys();
  rec.log({ assert: 'iii-remove keys unchanged', same: JSON.stringify(before) === JSON.stringify(after), epoch: final.Running?.keyset.epoch_id, participants: final.Running?.parameters.participants.participants.map((x) => x[0]) });
  const sig = await signTest(v, 'iii-remove sign with 2 participants again');
  rec.log({ assert: 'iii-remove vault signs', value: sig.value });
}

const table = { gasconfig, providers, reshare, 'reshare-remove': reshareRemove, storage, signers, maxstate, 'upgrade-same': upgradeSame, 'upgrade-break': upgradeBreak };
for (const f of faults) {
  console.log(`== ${f}`);
  try {
    await table[f]();
  } catch (e) {
    rec.log({ fault: f, fatal: e.message, stack: e.stack });
    console.error(`${f} failed:`, e);
  }
}
console.log(`evidence: docs/evidence/localstack/${run}/`);
