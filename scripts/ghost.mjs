#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createPublicClient, formatEther, http, parseEther, parseGwei } from 'viem';
import { baseSepolia } from 'viem/chains';
import { attestation, reason, sha256 } from '../agent/reason.mjs';
import { newAppKey, openWithIdentityKey, sealToIdentity, unwrapCkd } from '../agent/seal.mjs';
import {
  accessKeys, assembleSignedTx, assertFunded, base58Decode, base58Encode, checkRevertFinal, ckdMasterKey, landedFinalAttempt, derivedKey, deriveVaultAddress,
  foreignTxKey, fullAccessKeys, nearKeyBytes, SIGNER, viewCall, WISHES_PATH,
} from '../relay/base.mjs';
import { callContract } from '../relay/near.mjs';

try { process.loadEnvFile(new URL('../.env', import.meta.url).pathname); } catch { /* no .env */ }

// GHOST_STATE and GHOST_EVIDENCE select another vault's files, e.g. .ghost/v3/state.json.
const STATE = process.env.GHOST_STATE ?? new URL('../.ghost/state.json', import.meta.url);
const OPENED = new URL('../.ghost/opened.json', import.meta.url);
const EVIDENCE = process.env.GHOST_EVIDENCE ?? new URL('../web/evidence.json', import.meta.url);
const WASM = process.env.GHOST_WASM ?? new URL('../contract/target/near/ghost_protocol.wasm', import.meta.url).pathname;
const BASE_RPC = process.env.BASE_SEPOLIA_RPC ?? 'https://base-sepolia-rpc.publicnode.com';

const load = () => JSON.parse(readFileSync(STATE));
const save = (s) => writeFileSync(STATE, JSON.stringify(s, null, 2), { mode: 0o600 });
const client = () => createPublicClient({ chain: baseSepolia, transport: http(BASE_RPC) });
const chain = () => viewCall(load().vault, 'get_state');

const evidence = () => (existsSync(EVIDENCE) ? JSON.parse(readFileSync(EVIDENCE)) : { vault: load().vault, events: [], settle: {} });
const writeEvidence = (e) => writeFileSync(EVIDENCE, `${JSON.stringify(e, null, 2)}\n`);

function newKey() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  return {
    pub: publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('base64'),
    priv: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  };
}
const signText = (key, text) => crypto.sign(null, Buffer.from(text), key.priv).toString('base64');
const proofs = (s, message, n = 2) => s.witnesses.slice(0, n).map((w, i) => ({ witness_index: i, signature: signText(w, message) }));

/**
 * Sends one call, logs it to web/evidence.json so the verifier can recheck it, and prints one line.
 * `expect` is 'ok' for an action and 'fail' for an attack the contract must refuse.
 */
async function act(label, method, args, signer, { expect = 'ok', gas } = {}) {
  const r = await callContract({ contract: load().vault, method, args, signer, gas });
  const held = expect === 'ok' ? r.ok : !r.ok;
  const verdict = expect === 'ok' ? (r.ok ? 'OK     ' : 'FAILED ') : (r.ok ? 'NOT BLOCKED' : 'BLOCKED');
  console.log(`${verdict}  ${label}${r.error ? `: ${r.error}` : ''}\n         https://testnet.nearblocks.io/txns/${r.hash}`);
  const e = evidence();
  e.events.push({ label, method, tx: r.hash, sender: signer, expect, ...(r.error ? { error: r.error } : {}), at: new Date().toISOString() });
  writeEvidence(e);
  if (!held) process.exitCode = 1;
  return r;
}

const latestSigned = (state, index) => {
  const payout = state.payouts[index];
  const attemptIndex = payout?.attempts.findLastIndex((a) => a.r_hex);
  if (attemptIndex === undefined || attemptIndex < 0) throw new Error('payout has no signed attempt');
  return { payout, attempt: payout.attempts[attemptIndex], attemptIndex };
};

const commands = {
  /** D23: the witness quorum reopens a reverted payout, only once Base reports the revert final. */
  async 'witness-revert'([payout = '0', attempt = '0']) {
    const s = load();
    const p = (await chain()).payouts[Number(payout)];
    const hash = `0x${p?.attempts[Number(attempt)]?.tx_hash_hex ?? ''}`;
    const check = await checkRevertFinal(client(), hash);
    if (!check.ok) throw new Error(`not signing: ${check.reason}`);
    const message = `ghost:reverted:${s.vault}:${payout}:${hash.slice(2)}`;
    await act('Witness quorum reopens a final revert', 'reopen_reverted',
      { payout_index: Number(payout), attempt_index: Number(attempt), proofs: proofs(s, message) }, s.agent);
  },
  /** Generates local test keys and seals the wishes to the vault's MPC identity. */
  async init([vault, ...heirs]) {
    if (!vault || !heirs.length) throw new Error('usage: init <vault.testnet> <0xHeir> [0xHeir...]');
    mkdirSync(new URL('../.ghost/', import.meta.url), { recursive: true });
    const wishes = process.env.GHOST_WISHES ?? 'Give Ada her gift once she is an adult. If anyone is pressuring her for the money, wait.';
    const mpk = base58Decode((await ckdMasterKey()).split(':')[1], 96);
    const app = newAppKey();
    save({
      vault, owner: `owner.${vault}`, agent: `agent.${vault}`, court: `court.${vault}`,
      witnesses: [newKey(), newKey(), newKey()], registrar: newKey(), recovery: newKey(), heirs,
      appSecret: app.secret.toString(16), appPublicHex: Buffer.from(app.publicKey).toString('hex'),
      sealed: sealToIdentity(mpk, vault, WISHES_PATH, wishes),
    });
    writeEvidence({ vault, events: [], settle: {} });
    console.log('Keys written to .ghost/state.json');
  },

  async address() {
    console.log(await deriveVaultAddress(load().vault));
  },

  /** Prints the account commands for the human to run. Nothing here creates an account. */
  accounts() {
    const s = load();
    console.log(`for r in owner agent court; do near account create-account fund-myself $r.${s.vault} '1 NEAR' autogenerate-new-keypair --signature-scheme ed25519 save-to-keychain sign-as ${s.vault} network-config testnet sign-with-keychain send; done`);
  },

  async deploy() {
    const s = load();
    const [vaultKey, foreignKey] = await Promise.all([derivedKey(s.vault), foreignTxKey()]);
    const ceiling = parseGwei('5');
    const cap = parseEther('0.001');
    const config = {
      owner: s.owner, recovery_key: s.recovery.pub, agent: s.agent, legal_authority: s.court, signer_contract: SIGNER,
      vault_public_key: nearKeyBytes(vaultKey).toString('base64'),
      foreign_tx_public_key: nearKeyBytes(foreignKey).toString('base64'),
      witnesses: s.witnesses.map((w) => w.pub), witness_threshold: 2, registrar: s.registrar.pub,
      inactivity_secs: Number(process.env.GHOST_INACTIVITY ?? 60), grace_secs: Number(process.env.GHOST_GRACE ?? 60),
      override_grace_secs: 120, contest_secs: 30, freeze_max_secs: 60, fallback_secs: Number(process.env.GHOST_FALLBACK ?? 600),
      ...(process.env.GHOST_ABANDON ? { abandon_secs: Number(process.env.GHOST_ABANDON) } : {}),
      chain_id: 84532, initial_max_fee_per_gas: parseGwei('0.1').toString(), max_fee_ceiling: ceiling.toString(),
      max_priority_fee_per_gas: parseGwei('0.01').toString(),
      budget_wei: (BigInt(s.heirs.length) * (cap + 2n * 21000n * ceiling)).toString(),
      sealed_wishes_hash: sha256(JSON.stringify(s.sealed)), wishes_app_key: `bls12381g1:${base58Encode(Buffer.from(s.appPublicHex, 'hex'))}`,
      heirs: s.heirs.map((address) => ({ address, floor_wei: (cap / 2n).toString(), cap_wei: cap.toString(), gas_limit: 21000, adult_by: 0 })),
    };
    execFileSync('near', ['contract', 'deploy', s.vault, 'use-file', WASM, 'with-init-call', 'new', 'json-args',
      JSON.stringify({ config }), 'prepaid-gas', '100 Tgas', 'attached-deposit', '0 NEAR', 'network-config', 'testnet',
      'sign-with-keychain', 'send'], { stdio: 'inherit' });
  },

  /** I1: removes every full-access key, then proves none remain by reading the chain. */
  async lock() {
    const { vault } = load();
    const keys = fullAccessKeys(await accessKeys(vault));
    if (!keys.length) {
      console.log('LOCKED: view_access_key_list returns no FullAccess key');
      return;
    }
    // ML-DSA keys are listed by hash; the CLI needs the full key, which any transaction the vault signed contains.
    const names = keys.map((k) => (k.public_key.startsWith('ml-dsa-65-hash:') ? process.env.GHOST_FULL_KEY : k.public_key));
    if (names.some((n) => !n)) throw new Error('set GHOST_FULL_KEY to the full ml-dsa-65 public key');
    execFileSync('near', ['account', 'delete-keys', vault, 'public-keys', names.join(','),
      'network-config', 'testnet', 'sign-with-keychain', 'send'], { stdio: 'inherit' });
    const remaining = fullAccessKeys(await accessKeys(vault));
    if (remaining.length) throw new Error(`FullAccess keys remain: ${JSON.stringify(remaining)}`);
    console.log('LOCKED: view_access_key_list returns no FullAccess key');
  },

  checkin() {
    return act('Owner checks in', 'check_in', {}, load().owner);
  },

  async claim() {
    const s = load();
    const state = await chain();
    const deathAt = Math.floor(Date.now() / 1000) - 5;
    await act('Witnesses open a claim', 'open_claim',
      { death_at: deathAt, proofs: proofs(s, `ghost:death:${s.vault}:${state.claim_epoch}:${deathAt}`), override_claim: false }, s.owner);
    const adultAt = deathAt - 86400;
    for (const [i, heir] of state.heirs.entries()) {
      if (heir.adult_at === null) {
        await act(`Registrar proves heir ${i} is an adult`, 'prove_adult',
          { heir_index: i, adult_at: adultAt, signature: signText(s.registrar, `ghost:adult:${s.vault}:${i}:${adultAt}`) }, s.owner);
      }
    }
  },

  /** Every call here must be refused by the contract. Each refusal is a transaction anyone can recheck. */
  async attack() {
    const s = load();
    const state = await chain();
    const forged = { signed_text: `${'ab'.repeat(32)}:${'cd'.repeat(32)}`, signature: '00'.repeat(65), response_body: '{}' };
    const witnessForgery = proofs({ witnesses: [newKey(), newKey()] }, 'forged');
    const stuck = state.payouts.findIndex((p) => p.status === 'Active');
    const attacks = [
      ['Agent pays an unlisted recipient', 'propose_payout', { heir_index: 7, value_wei: '1', proof: forged }, s.agent],
      ['Agent pays an heir already being paid', 'propose_payout', { heir_index: 0, value_wei: parseEther('1').toString(), proof: forged }, s.agent],
      ['Owner account poses as the agent', 'propose_payout', { heir_index: 0, value_wei: '1', proof: forged }, s.owner],
      ['Agent freezes the vault', 'freeze', {}, s.agent],
      ['Owner cancels after payout started', 'check_in', {}, s.owner],
      ['Anyone fakes the MPC settlement callback', 'on_settled', { payout_index: 0, attempt_index: 0 }, s.agent],
      ['Anyone fakes the MPC signature callback', 'on_signed', { payout_index: 0, attempt_index: 0 }, s.agent],
      ['Forged witnesses reopen a payout', 'reopen_reverted', { payout_index: 0, attempt_index: 0, proofs: witnessForgery }, s.agent],
      ['Forged witnesses register a signing key', 'register_signer',
        { address: '0x000000000000000000000000000000000000dEaD', quote_sha256: 'x', expires_at: 4_000_000_000, proofs: witnessForgery }, s.agent],
      ['Registrar proof replayed', 'prove_adult', { heir_index: 0, adult_at: 1, signature: signText(s.registrar, `ghost:adult:${s.vault}:0:1`) }, s.agent],
      ['Second claim while one is open', 'open_claim', { death_at: 1, proofs: [], override_claim: false }, s.agent],
      ...(stuck >= 0 ? [
        ['Fee raised above the ceiling', 'request_signature', { payout_index: stuck, max_fee_per_gas: parseGwei('6').toString() }, s.agent],
        ['Fee nudged to burn attempts', 'request_signature', { payout_index: stuck, max_fee_per_gas: parseGwei('0.21').toString() }, s.agent],
      ] : []),
    ];
    for (const [label, method, args, signer] of attacks) await act(label, method, args, signer, { expect: 'fail', gas: '100 Tgas' });
  },

  async reason([report]) {
    const apiKey = process.env.NEARAI_API_KEY;
    if (!apiKey || !report) throw new Error('usage: reason "<situation report>" with NEARAI_API_KEY in .env');
    const s = load();
    const state = await chain();
    const wishes = JSON.parse(readFileSync(OPENED)).wishes;
    const result = await reason({ apiKey, vault: s.vault, wishes, heirs: state.heirs, report });
    const att = await attestation({ apiKey, signingAddress: result.signingAddress });
    writeFileSync(new URL('../web/attestation.json', import.meta.url), att.text);
    writeFileSync(new URL('../.ghost/reasoning.json', import.meta.url), JSON.stringify({ report, ...result, quoteSha256: att.quoteSha256 }, null, 2));
    console.log(JSON.stringify(result.decision, null, 2));
  },

  register() {
    const s = load();
    const r = JSON.parse(readFileSync(new URL('../.ghost/reasoning.json', import.meta.url)));
    const expires = Math.floor(Date.now() / 1000) + 86400 * 30;
    const message = `ghost:signer:${s.vault}:${r.signingAddress.toLowerCase()}:${r.quoteSha256}:${expires}`;
    return act('Witness quorum registers the NEAR AI enclave key', 'register_signer',
      { address: r.signingAddress, quote_sha256: r.quoteSha256, expires_at: expires, proofs: proofs(s, message) }, s.owner);
  },

  pay() {
    const r = JSON.parse(readFileSync(new URL('../.ghost/reasoning.json', import.meta.url)));
    if (r.decision?.action !== 'pay') throw new Error('latest decision is not a payment');
    return act('Agent proposes the attested payout', 'propose_payout',
      { heir_index: r.decision.heir_index, value_wei: String(r.decision.value_wei), proof: r.proof }, load().agent);
  },

  fallback([heir = '0']) {
    return act(`Anyone starts the no-AI fallback for heir ${heir}`, 'execute_fallback', { heir_index: Number(heir) }, load().owner);
  },

  /** Asks for the same payout at a higher fee. Anyone can do this. */
  reprice([payout = '0', gwei]) {
    return act(`Payout ${payout} re-signed at ${gwei} gwei`, 'request_signature',
      { payout_index: Number(payout), max_fee_per_gas: parseGwei(gwei).toString() }, load().owner);
  },

  async broadcast([index = '0']) {
    const s = load();
    const { payout, attempt } = latestSigned(await chain(), Number(index));
    const signer = await deriveVaultAddress(s.vault);
    const serializedTransaction = await assembleSignedTx(payout, attempt, signer);
    assertFunded(await client().getBalance({ address: signer }), payout, attempt);
    const hash = await client().sendRawTransaction({ serializedTransaction });
    console.log(`BROADCAST  https://sepolia.basescan.org/tx/${hash}`);
  },

  /** Asks the MPC network to attest the landed transaction. Run after Base Sepolia finalizes it. */
  async settle([index = '0']) {
    const s = load();
    const landed = await landedFinalAttempt(client(), (await chain()).payouts[Number(index)]);
    if (!landed.ready) {
      console.log(`NOT SETTLED  ${landed.reason}`);
      return;
    }
    const attemptIndex = landed.index;
    const r = await act(`MPC network asked to attest payout ${index}`, 'settle', { payout_index: Number(index), attempt_index: attemptIndex }, s.owner);
    if (r.ok && r.value === true) {
      const e = evidence();
      e.settle[`${index}:${attemptIndex}`] = { tx: r.hash, sender: s.owner };
      writeEvidence(e);
    }
    console.log(r.value === true ? 'SETTLED  heir marked Paid' : 'NOT SETTLED  the network has not attested a landed transaction yet');
  },

  /** Has the vault request the wishes key, then opens the sealed wishes after a pairing check. */
  async open() {
    const s = load();
    const r = await act('Vault requests the wishes key from the MPC network', 'request_wishes_key', {}, s.owner);
    if (!r.ok || !r.value?.big_y) throw new Error('no CKD response');
    const mpk = base58Decode((await ckdMasterKey()).split(':')[1], 96);
    const g1 = (v) => base58Decode(v.split(':').pop(), 48);
    const key = unwrapCkd(g1(r.value.big_y), g1(r.value.big_c), BigInt(`0x${s.appSecret}`));
    const wishes = openWithIdentityKey(mpk, s.vault, WISHES_PATH, key, s.sealed);
    writeFileSync(OPENED, JSON.stringify({ wishes }), { mode: 0o600 });
    console.log('OPENED  key passed the pairing check; unwrapped on this machine, not in an enclave');
  },

  async status([flag]) {
    const state = await chain();
    if (flag === '--json') return console.log(JSON.stringify(state, null, 2));
    const s = load();
    const now = Math.floor(Date.now() / 1000);
    const address = await deriveVaultAddress(s.vault);
    const balance = await client().getBalance({ address });
    const keys = fullAccessKeys(await accessKeys(s.vault));
    const c = state.claim;
    const phase = !c ? 'no claim' : now < c.pay_after ? `claim open, grace ends in ${c.pay_after - now}s` : 'claim matured';
    console.log(`vault     ${s.vault}  ${keys.length ? `${keys.length} full-access key(s)` : 'locked'}`);
    console.log(`address   ${address}  ${formatEther(balance)} ETH on Base Sepolia`);
    console.log(`claim     ${phase}`);
    for (const [i, h] of state.heirs.entries()) console.log(`heir ${i}    ${h.address}  ${h.status}  floor ${formatEther(BigInt(h.floor_wei))}  cap ${formatEther(BigInt(h.cap_wei))}`);
    for (const [i, p] of state.payouts.entries()) {
      console.log(`payout ${i}  ${formatEther(BigInt(p.value_wei))} ETH  nonce ${p.nonce}  ${p.source}  ${p.status}  ${p.attempts.length} attempt(s)`);
    }
  },
};

const [name, ...args] = process.argv.slice(2);
if (!commands[name]) {
  console.error(`commands: ${Object.keys(commands).join(', ')}`);
  process.exit(1);
}
try {
  await commands[name](args);
} catch (e) {
  console.error(`error: ${e.message}`);
  process.exit(1);
}
