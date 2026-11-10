#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createPublicClient, http, parseEther, parseGwei } from 'viem';
import { baseSepolia } from 'viem/chains';
import { attestation, reason, sha256 } from '../agent/reason.mjs';
import { openWithIdentityKey, sealToIdentity, newAppKey, unwrapCkd } from '../agent/seal.mjs';
import {
  accessKeys, assembleSignedTx, assertFunded, base58Decode, base58Encode, ckdMasterKey, derivedKey, deriveVaultAddress, foreignTxKey,
  fullAccessKeys, nearKeyBytes, SIGNER, viewCall, WISHES_PATH,
} from '../relay/base.mjs';

const STATE = new URL('../.ghost/state.json', import.meta.url);
const RUN = new URL('../web/run.json', import.meta.url);
const WASM = process.env.GHOST_WASM ?? new URL('../contract/target/near/ghost_protocol.wasm', import.meta.url).pathname;
const BASE_RPC = process.env.BASE_SEPOLIA_RPC ?? 'https://base-sepolia-rpc.publicnode.com';

const load = () => JSON.parse(readFileSync(STATE));
const save = (s) => writeFileSync(STATE, JSON.stringify(s, null, 2), { mode: 0o600 });
const run = () => (existsSync(RUN) ? JSON.parse(readFileSync(RUN)) : {});
const record = (patch) => writeFileSync(RUN, JSON.stringify({ vault: load().vault, ...run(), ...patch }, null, 2));
const client = () => createPublicClient({ chain: baseSepolia, transport: http(BASE_RPC) });

function newKey() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  return {
    pub: publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('base64'),
    priv: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  };
}
const signText = (key, text) => crypto.sign(null, Buffer.from(text), key.priv).toString('base64');
const proofs = (s, message, n = 2) => s.witnesses.slice(0, n).map((w, i) => ({ witness_index: i, signature: signText(w, message) }));

function nearArgs(contract, method, args, signer, gas = '300 Tgas') {
  return ['contract', 'call-function', 'as-transaction', contract, method, 'json-args', JSON.stringify(args),
    'prepaid-gas', gas, 'attached-deposit', '0 NEAR', 'sign-as', signer, 'network-config', 'testnet',
    'sign-with-keychain', 'send'];
}
const call = (method, args, signer, gas) => execFileSync('near', nearArgs(load().vault, method, args, signer, gas), { stdio: 'inherit' });
function expectFailure(label, method, args, signer) {
  const r = spawnSync('near', nearArgs(load().vault, method, args, signer), { encoding: 'utf8' });
  const output = `${r.stdout}\n${r.stderr}`;
  const blocked = r.status !== 0 || /Failure|panicked/i.test(output);
  const why = output.match(/Smart contract panicked: ([^\n"]+)/)?.[1] ?? 'failed';
  console.log(`${blocked ? 'BLOCKED' : 'NOT BLOCKED'}  ${label}: ${why}`);
  return { label, blocked, reason: why };
}

const latestSigned = (chain, index) => {
  const payout = chain.payouts[index];
  const attemptIndex = payout?.attempts.findLastIndex((a) => a.r_hex);
  if (attemptIndex === undefined || attemptIndex < 0) throw new Error('payout has no signed attempt');
  return { payout, attempt: payout.attempts[attemptIndex], attemptIndex };
};

const commands = {
  /** Generates local test keys and seals the wishes to the MPC identity. */
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
    console.log('Keys written to .ghost/state.json');
  },

  async address() {
    console.log(await deriveVaultAddress(load().vault));
  },

  /** Prints account commands for the human to run. Nothing here creates an account. */
  accounts() {
    const s = load();
    for (const role of [s.owner, s.agent, s.court]) {
      console.log(`near account create-account fund-myself ${role} '1 NEAR' autogenerate-new-keypair save-to-keychain sign-as ${s.vault} network-config testnet sign-with-keychain send`);
    }
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
      chain_id: 84532, initial_max_fee_per_gas: parseGwei('0.1').toString(), max_fee_ceiling: ceiling.toString(),
      max_priority_fee_per_gas: parseGwei('0.01').toString(),
      budget_wei: (BigInt(s.heirs.length) * (cap + 2n * 21000n * ceiling)).toString(),
      sealed_wishes_hash: sha256(JSON.stringify(s.sealed)), wishes_app_key: `bls12381g1:${base58Encode(Buffer.from(s.appPublicHex, 'hex'))}`,
      heirs: s.heirs.map((address) => ({ address, floor_wei: (cap / 2n).toString(), cap_wei: cap.toString(), gas_limit: 21000, adult_by: 0 })),
    };
    execFileSync('near', ['contract', 'deploy', s.vault, 'use-file', WASM, 'with-init-call', 'new', 'json-args',
      JSON.stringify({ config }), 'prepaid-gas', '100 Tgas', 'attached-deposit', '0 NEAR', 'network-config', 'testnet',
      'sign-with-keychain', 'send'], { stdio: 'inherit' });
    record({ deployed: true });
  },

  /** I1: removes every full-access key, then proves none remain by reading the chain. */
  async lock() {
    const { vault } = load();
    const keys = fullAccessKeys(await accessKeys(vault));
    if (!keys.length) throw new Error('no full-access keys to remove');
    execFileSync('near', ['account', 'delete-keys', vault, 'public-keys', keys.map((k) => k.public_key).join(','),
      'network-config', 'testnet', 'sign-with-keychain', 'send'], { stdio: 'inherit' });
    const remaining = fullAccessKeys(await accessKeys(vault));
    if (remaining.length) throw new Error(`FullAccess keys remain: ${JSON.stringify(remaining)}`);
    console.log('LOCKED: view_access_key_list returns no FullAccess key');
    record({ locked: true });
  },

  checkin() {
    call('check_in', {}, load().owner);
    record({ falseClaimCancelled: run().claimed === true });
  },

  claim() {
    const s = load();
    const deathAt = Math.floor(Date.now() / 1000) - 5;
    return viewCall(s.vault, 'get_state').then((chain) => {
      call('open_claim', { death_at: deathAt, proofs: proofs(s, `ghost:death:${s.vault}:${chain.claim_epoch}:${deathAt}`), override_claim: false }, s.owner);
      const adultAt = deathAt - 86400;
      s.heirs.forEach((_, i) => chain.heirs[i].adult_at === null && call('prove_adult', { heir_index: i, adult_at: adultAt, signature: signText(s.registrar, `ghost:adult:${s.vault}:${i}:${adultAt}`) }, s.owner));
      record({ claimed: true });
    });
  },

  async reason([report]) {
    const apiKey = process.env.NEARAI_API_KEY;
    if (!apiKey || !report) throw new Error('usage: NEARAI_API_KEY=... reason "<situation report>"');
    const s = load();
    const chain = await viewCall(s.vault, 'get_state');
    const wishes = JSON.parse(readFileSync(new URL('../.ghost/opened.json', import.meta.url))).wishes;
    const result = await reason({ apiKey, vault: s.vault, wishes, heirs: chain.heirs, report });
    const att = await attestation({ apiKey, signingAddress: result.signingAddress });
    writeFileSync(new URL('../web/attestation.json', import.meta.url), att.text);
    console.log(JSON.stringify(result.decision, null, 2));
    record({ reasoning: { report, ...result, quoteSha256: att.quoteSha256 } });
  },

  async attack() {
    const s = load();
    const hostile = { signed_text: 'a:b', signature: '00', response_body: '{}' };
    const results = [
      expectFailure('Over-cap payout', 'propose_payout', { heir_index: 0, value_wei: parseEther('1').toString(), proof: hostile }, s.agent),
      expectFailure('Payout below floor', 'propose_payout', { heir_index: 0, value_wei: '1', proof: hostile }, s.agent),
      expectFailure('Recipient not on the heir list', 'propose_payout', { heir_index: 99, value_wei: '1', proof: hostile }, s.agent),
      expectFailure('Payout from a non-agent account', 'propose_payout', { heir_index: 0, value_wei: '1', proof: hostile }, s.owner),
      expectFailure('Freeze from a non-court account', 'freeze', {}, s.agent),
    ];
    record({ attacks: results });
    if (results.some((r) => !r.blocked)) process.exitCode = 1;
  },

  register() {
    const s = load();
    const { reasoning } = run();
    const expires = Math.floor(Date.now() / 1000) + 86400 * 30;
    const message = `ghost:signer:${s.vault}:${reasoning.signingAddress.toLowerCase()}:${reasoning.quoteSha256}:${expires}`;
    call('register_signer', { address: reasoning.signingAddress, quote_sha256: reasoning.quoteSha256, expires_at: expires, proofs: proofs(s, message) }, s.owner);
  },

  pay() {
    const s = load();
    const { reasoning } = run();
    if (reasoning?.decision?.action !== 'pay') throw new Error('latest decision is not a payment');
    call('propose_payout', { heir_index: reasoning.decision.heir_index, value_wei: String(reasoning.decision.value_wei), proof: reasoning.proof }, s.agent);
  },

  fallback([heir]) {
    call('execute_fallback', { heir_index: Number(heir) }, load().owner);
  },

  /** Asks for the same payout at a higher fee. Anyone can do this. */
  reprice([payout, gwei]) {
    call('request_signature', { payout_index: Number(payout), max_fee_per_gas: parseGwei(gwei).toString() }, load().owner);
  },

  async broadcast([index = '0']) {
    const s = load();
    const chain = await viewCall(s.vault, 'get_state');
    const { payout, attempt } = latestSigned(chain, Number(index));
    const signer = await deriveVaultAddress(s.vault);
    const serializedTransaction = await assembleSignedTx(payout, attempt, signer);
    assertFunded(await client().getBalance({ address: signer }), payout, attempt);
    const hash = await client().sendRawTransaction({ serializedTransaction });
    console.log(`https://sepolia.basescan.org/tx/${hash}`);
    record({ baseTx: hash, baseFrom: signer });
  },

  /** Asks the MPC network to attest the landed transaction. Run after it is finalized. */
  async settle([index = '0']) {
    const s = load();
    const { attemptIndex } = latestSigned(await viewCall(s.vault, 'get_state'), Number(index));
    call('settle', { payout_index: Number(index), attempt_index: attemptIndex }, s.owner);
  },

  /** Requests the wishes key from the vault and opens the sealed wishes. Prints a warning, not a claim of enclave custody. */
  async open([bigY, bigC]) {
    const s = load();
    const mpk = base58Decode((await ckdMasterKey()).split(':')[1], 96);
    const g1 = (v) => base58Decode(v.split(':').pop(), 48);
    const key = unwrapCkd(g1(bigY), g1(bigC), BigInt(`0x${s.appSecret}`));
    const wishes = openWithIdentityKey(mpk, s.vault, WISHES_PATH, key, s.sealed);
    writeFileSync(new URL('../.ghost/opened.json', import.meta.url), JSON.stringify({ wishes }), { mode: 0o600 });
    console.warn('Key unwrapped on this machine, not inside an attested enclave.');
  },

  async status() {
    console.log(JSON.stringify(await viewCall(load().vault, 'get_state'), null, 2));
  },
};

const [name, ...args] = process.argv.slice(2);
if (!commands[name]) {
  console.error(`commands: ${Object.keys(commands).join(', ')}`);
  process.exit(1);
}
await commands[name](args);
