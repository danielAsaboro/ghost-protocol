// Deploys and drives a GhostProtocol vault on the localnet with keys read from the real MPC contract.
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { assembleSignedTx, addressFromNearKey, base58Decode, base58Encode, nearKeyBytes, PATH, WISHES_PATH } from '../../../relay/base.mjs';
import { newAppKey, sealToIdentity } from '../../../agent/seal.mjs';
import { act, NEAR, rpc, sleep, view } from './near.mjs';
import { loadState, MPC, newKey, saveState } from './stack.mjs';

export const GWEI = 10n ** 9n;
export const CAP = 10n ** 15n; // 0.001 ETH

// fallback must exceed max(grace, 2 * override_grace) + contest * witnesses + freeze (v3 at e73a181 doubles override grace).
export const DEFAULT_TIMING = { inactivity_secs: 15, grace_secs: 10, override_grace_secs: 12, contest_secs: 2, freeze_max_secs: 2, fallback_secs: 40 };

export const signText = (pem, text) => crypto.sign(null, Buffer.from(text), pem).toString('base64');

export async function nearNow() {
  const b = await rpc('block', { finality: 'final' });
  return Math.floor(Number(BigInt(b.header.timestamp) / 1_000_000_000n));
}

/** Waits until the final NEAR block timestamp reaches `t` (seconds). */
export async function waitUntil(t) {
  for (;;) {
    const now = await nearNow();
    if (now >= t) return now;
    await sleep(Math.min(5000, (t - now) * 1000 + 500));
  }
}

export async function mpcKeys(vault) {
  const [vaultKey, foreignKey, ckdKey] = await Promise.all([
    view(MPC, 'derived_public_key', { path: PATH, predecessor: vault, domain_id: 0 }),
    view(MPC, 'public_key', { domain_id: 3 }),
    view(MPC, 'public_key', { domain_id: 2 }),
  ]);
  return { vaultKey, foreignKey, ckdKey, address: addressFromNearKey(vaultKey) };
}

/**
 * Creates `<name>.test.near` (plus owner/agent/court sub-accounts), and deploys + inits the vault
 * in one transaction. Secrets go to the run dir state.json; the public config goes to evidence.
 */
export async function deployVault(rec, name, { wasm, heirs, timing = DEFAULT_TIMING, fund = NEAR(30), ceilingGwei = 16n, initialGwei = 1n, priorityGwei = 1n,
  ceilingWei, initialWei, priorityWei, gasLimits, witnessCount = 3, abandonSecs, cap = CAP } = {}) {
  const vault = `${name}.test.near`;
  const state = loadState();
  const keys = { vault: newKey(), owner: newKey(), agent: newKey(), court: newKey() };
  const witnesses = Array.from({ length: witnessCount }, () => newKey());
  const registrar = newKey();
  const recovery = newKey();
  const app = newAppKey();
  state.accounts[vault] = { pem: keys.vault.pem, publicKey: keys.vault.publicKey };
  for (const r of ['owner', 'agent', 'court']) state.accounts[`${r}.${vault}`] = { pem: keys[r].pem, publicKey: keys[r].publicKey };
  state.vaults = state.vaults ?? {};
  state.vaults[vault] = {
    witnesses: witnesses.map((w) => w.pem), registrar: registrar.pem, recovery: recovery.pem,
    appSecret: app.secret.toString(16), appPublic: Buffer.from(app.publicKey).toString('hex'),
  };
  saveState(state);

  await rec.tx(`create ${vault}`, 'test.near', vault, [act.createAccount(), act.transfer(fund), act.addFullKey(keys.vault.publicKey)]);
  for (const r of ['owner', 'agent', 'court']) {
    await rec.tx(`create ${r}.${vault}`, vault, `${r}.${vault}`, [act.createAccount(), act.transfer(NEAR(2)), act.addFullKey(keys[r].publicKey)]);
  }

  const mpc = await mpcKeys(vault);
  const mpk = base58Decode(mpc.ckdKey.split(':')[1], 96);
  const wishes = `Local stack wishes for ${vault}: pay the heirs once they are adults.`;
  const sealed = sealToIdentity(mpk, vault, WISHES_PATH, wishes);
  const ceiling = ceilingWei ?? ceilingGwei * GWEI;
  const limits = gasLimits ?? heirs.map(() => 21000);
  const config = {
    owner: `owner.${vault}`, recovery_key: recovery.raw.toString('base64'), agent: `agent.${vault}`, legal_authority: `court.${vault}`,
    signer_contract: MPC,
    vault_public_key: nearKeyBytes(mpc.vaultKey).toString('base64'),
    foreign_tx_public_key: nearKeyBytes(mpc.foreignKey).toString('base64'),
    witnesses: witnesses.map((w) => w.raw.toString('base64')), witness_threshold: 2, registrar: registrar.raw.toString('base64'),
    ...timing,
    chain_id: 84532, initial_max_fee_per_gas: (initialWei ?? initialGwei * GWEI).toString(), max_fee_ceiling: ceiling.toString(),
    max_priority_fee_per_gas: (priorityWei ?? priorityGwei * GWEI).toString(),
    ...(abandonSecs ? { abandon_secs: abandonSecs } : {}),
    budget_wei: heirs.reduce((a, _, i) => a + cap + 2n * BigInt(limits[i]) * ceiling, 0n).toString(),
    sealed_wishes_hash: crypto.createHash('sha256').update(JSON.stringify(sealed)).digest('hex'),
    wishes_app_key: `bls12381g1:${base58Encode(app.publicKey)}`,
    heirs: heirs.map((address, i) => ({ address, floor_wei: (cap / 2n).toString(), cap_wei: cap.toString(), gas_limit: limits[i], adult_by: 0 })),
  };
  const s2 = loadState();
  s2.vaults[vault].sealed = sealed;
  s2.vaults[vault].wishes = wishes;
  saveState(s2);
  rec.file(`vault-${name}-config.json`, { vault, evmAddress: mpc.address, mpcKeys: mpc, config, sealed });
  const r = await rec.tx(`deploy and init ${vault}`, vault, vault, [act.deploy(wasm), act.call('new', { config }, 100)]);
  if (!r.ok) throw new Error(`vault deploy failed: ${r.error}`);
  return new Vault(rec, vault, mpc);
}

export class Vault {
  constructor(rec, account, mpc) {
    this.rec = rec;
    this.account = account;
    this.mpc = mpc;
    this.owner = `owner.${account}`;
    this.agent = `agent.${account}`;
    this.court = `court.${account}`;
  }

  get secrets() { return loadState().vaults[this.account]; }
  state() { return view(this.account, 'get_state'); }
  call(label, method, args, { signer = this.owner, ...opts } = {}) { return this.rec.call(label, signer, this.account, method, args, opts); }

  proofs(message, n = 2) {
    return this.secrets.witnesses.slice(0, n).map((pem, i) => ({ witness_index: i, signature: signText(pem, message) }));
  }

  async openClaim(label, { expect = 'ok' } = {}) {
    const s = await this.state();
    const deathAt = (await nearNow()) - 1;
    return this.call(label, 'open_claim', {
      death_at: deathAt, proofs: this.proofs(`ghost:death:${this.account}:${s.claim_epoch}:${deathAt}`), override_claim: false,
    }, { expect });
  }

  reopen(label, payout, attempt, txHash) {
    return this.call(label, 'reopen_reverted', {
      payout_index: payout, attempt_index: attempt, proofs: this.proofs(`ghost:reverted:${this.account}:${payout}:${txHash}`),
    });
  }

  async signedRaw(payoutIndex, attemptIndex) {
    const s = await this.state();
    const payout = s.payouts[payoutIndex];
    const attempt = payout.attempts[attemptIndex];
    const raw = await assembleSignedTx(payout, attempt, this.mpc.address);
    return { raw, txHash: `0x${attempt.tx_hash_hex}`, payout, attempt };
  }
}

export { readFileSync };
