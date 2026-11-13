// Shared state for the local stack: run dir, account keys, and an evidence recorder that writes
// every transaction hash and RPC response to docs/evidence/localstack/<run>/.
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { act, newKey, receiptBreakdown, send, view } from './near.mjs';

export const RUN_DIR = process.env.LOCALSTACK_DIR ?? join(homedir(), 'development/near-hackathon-research/localstack-run');
export const STATE = join(RUN_DIR, 'state.json');
export const MPC = 'mpc-contract.test.near';
export const ANVIL = process.env.ANVIL_RPC ?? 'http://127.0.0.1:8545';
export const REPO = new URL('../../../', import.meta.url).pathname;

/** The Base whitelist entry the nodes vote: one provider (anvil), RPC quorum 1. */
export const BASE_WHITELIST = (url = ANVIL) => ({
  Base: { providers: { anvil: { base_url: url, auth_scheme: 'None', chain_routing: 'Embedded' } }, quorum: 1 },
});

export const loadState = () => (existsSync(STATE) ? JSON.parse(readFileSync(STATE)) : { accounts: {} });
export const saveState = (s) => writeFileSync(STATE, JSON.stringify(s, null, 2), { mode: 0o600 });

export function validator() {
  const v = JSON.parse(readFileSync(join(RUN_DIR, 'near/validator_key.json')));
  return { account: v.account_id, key: v.secret_key ?? v.private_key };
}

export function keyOf(account) {
  if (account === 'test.near') return validator().key;
  const k = loadState().accounts[account];
  if (!k) throw new Error(`no key for ${account}`);
  return k;
}

const PAYABLE = new Set(['propose_payout', 'execute_fallback', 'request_signature', 'settle', 'request_wishes_key']);

const json = (v) => JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? x.toString() : x), 2);

/** Records into docs/evidence/localstack/<run>/: events.jsonl plus one file per named artifact. */
export class Recorder {
  constructor(run) {
    this.dir = join(REPO, 'docs/evidence/localstack', run);
    mkdirSync(this.dir, { recursive: true });
    this.events = join(this.dir, 'events.jsonl');
    // Continue numbering when a run is resumed with more phases.
    this.step = Math.max(0, ...readdirSync(this.dir).filter((f) => /^\d{3}-/.test(f)).map((f) => Number(f.slice(0, 3))), Number(process.env.STEP_FROM ?? 0));
  }

  log(entry) {
    const line = { at: new Date().toISOString(), ...entry };
    appendFileSync(this.events, `${JSON.stringify(line, (_, x) => (typeof x === 'bigint' ? x.toString() : x))}\n`);
    return line;
  }

  file(name, value) {
    writeFileSync(join(this.dir, name), typeof value === 'string' ? value : `${json(value)}\n`);
    return name;
  }

  /** Sends a NEAR tx, saves the full RPC response, and logs a one-line summary. */
  async tx(label, signer, receiver, actions, { expect = 'ok', wait } = {}) {
    const r = await send(signer, keyOf(signer), receiver, actions, { wait });
    try { r.receipts = await receiptBreakdown(r.hash, signer); } catch { /* tx never reached the chain */ }
    for (const a of r.result?.transaction?.actions ?? []) {
      if (a.DeployContract?.code) {
        // neard 2.14 returns the code's sha256 here, not the code.
        const b = Buffer.from(a.DeployContract.code, 'base64');
        a.DeployContract.code = b.length === 32 ? `<code sha256 ${b.toString('hex')}>` : `<${b.length} bytes, sha256 ${createHash('sha256').update(b).digest('hex')}>`;
      }
    }
    this.step += 1;
    const file = `${String(this.step).padStart(3, '0')}-${label.replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 60)}.json`;
    this.file(file, { label, signer, receiver, hash: r.hash, ok: r.ok, value: r.value, error: r.error, innerErrors: r.innerErrors, gasBurnt: r.gasBurnt, receipts: r.receipts, rpc: r.result });
    const held = expect === 'any' || (expect === 'ok' ? r.ok : !r.ok);
    this.log({ label, signer, receiver, hash: r.hash, ok: r.ok, value: summarize(r.value), error: r.error, innerErrors: r.innerErrors?.length ? r.innerErrors : undefined, expect, held, file });
    console.log(`${held ? 'as expected' : 'UNEXPECTED '} ${r.ok ? 'ok  ' : 'fail'} ${label} ${r.hash}${r.error ? ` :: ${r.error}` : ''}${r.innerErrors?.length ? ` :: inner ${r.innerErrors.join(' | ').slice(0, 300)}` : ''} -> ${summarize(r.value)}`);
    return r;
  }

  call(label, signer, receiver, method, args, { gas = 300, deposit = 0n, ...opts } = {}) {
    // v3 vaults make every method that calls the signer #[payable] and forward the deposit.
    if (process.env.VAULT_PAYABLE === '1' && PAYABLE.has(method) && receiver.startsWith('ghost-') && BigInt(deposit) === 0n) deposit = 1n;
    return this.tx(label, signer, receiver, [act.call(method, args, gas, deposit)], opts);
  }

  async view(label, account, method, args = {}) {
    let value; let error;
    try { value = await view(account, method, args); } catch (e) { error = e.message; }
    this.log({ view: label, account, method, args, value: summarize(value), error });
    return value;
  }
}

function summarize(v) {
  const s = v === undefined ? '' : JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? x.toString() : x));
  return s && s.length > 400 ? `${s.slice(0, 400)}...` : s;
}

export { json, newKey };
