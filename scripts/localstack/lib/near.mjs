// Minimal NEAR client for the localnet: borsh transactions signed with node:crypto ed25519 keys,
// sent over JSON-RPC. No near CLI keychain, so every key the harness uses lives in the run dir.
import crypto from 'node:crypto';
import { base58Decode, base58Encode } from '../../../relay/base.mjs';

export const RPC = process.env.LOCALNET_RPC ?? 'http://127.0.0.1:3030';

// ---------- keys ----------
export function newKey() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  return keyFromPem(privateKey.export({ type: 'pkcs8', format: 'pem' }), publicKey);
}

function keyFromPem(pem, publicKey = crypto.createPublicKey(pem)) {
  const raw = publicKey.export({ type: 'spki', format: 'der' }).subarray(-32);
  return { pem, publicKey: `ed25519:${base58Encode(raw)}`, raw: Buffer.from(raw) };
}

/** Accepts a stored `{pem}` or a NEAR `ed25519:<base58 64-byte secret>` string. */
export function loadKey(k) {
  if (typeof k === 'string') {
    const bytes = base58Decode(k.split(':')[1], 64);
    const der = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), bytes.subarray(0, 32)]);
    const priv = crypto.createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
    return keyFromPem(priv.export({ type: 'pkcs8', format: 'pem' }));
  }
  return keyFromPem(k.pem);
}

// ---------- borsh ----------
class W {
  constructor() { this.parts = []; }
  u8(n) { this.parts.push(Buffer.from([n])); return this; }
  u32(n) { const b = Buffer.alloc(4); b.writeUInt32LE(n); this.parts.push(b); return this; }
  u64(n) { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); this.parts.push(b); return this; }
  u128(n) { const v = BigInt(n); const b = Buffer.alloc(16); b.writeBigUInt64LE(v & ((1n << 64n) - 1n)); b.writeBigUInt64LE(v >> 64n, 8); this.parts.push(b); return this; }
  bytes(b) { this.u32(b.length); this.parts.push(Buffer.from(b)); return this; }
  fixed(b) { this.parts.push(Buffer.from(b)); return this; }
  str(s) { return this.bytes(Buffer.from(s, 'utf8')); }
  pk(p) { this.u8(0); return this.fixed(base58Decode(p.split(':')[1], 32)); }
  out() { return Buffer.concat(this.parts); }
}

export const act = {
  createAccount: () => ({ t: 0 }),
  deploy: (code) => ({ t: 1, code }),
  call: (method, args, gasTgas = 300, deposit = 0n) => ({ t: 2, method, args, gas: BigInt(gasTgas) * 10n ** 12n, deposit: BigInt(deposit) }),
  callRaw: (method, argBytes, gas, deposit = 0n) => ({ t: 2, method, args: argBytes, gas: BigInt(gas), deposit: BigInt(deposit) }),
  transfer: (deposit) => ({ t: 3, deposit: BigInt(deposit) }),
  addFullKey: (publicKey) => ({ t: 5, publicKey, full: true }),
  addFnKey: (publicKey, receiver, methods = [], allowance = null) => ({ t: 5, publicKey, receiver, methods, allowance }),
};

function encodeAction(w, a) {
  w.u8(a.t);
  if (a.t === 1) w.bytes(a.code);
  if (a.t === 2) {
    const args = Buffer.isBuffer(a.args) || a.args instanceof Uint8Array ? a.args : Buffer.from(JSON.stringify(a.args));
    w.str(a.method).bytes(args).u64(a.gas).u128(a.deposit);
  }
  if (a.t === 3) w.u128(a.deposit);
  if (a.t === 5) {
    w.pk(a.publicKey).u64(0);
    if (a.full) w.u8(1);
    else {
      w.u8(0);
      if (a.allowance === null) w.u8(0); else w.u8(1).u128(a.allowance);
      w.str(a.receiver).u32(a.methods.length);
      a.methods.forEach((m) => w.str(m));
    }
  }
}

// ---------- rpc ----------
export async function rpc(method, params, url = RPC) {
  for (let i = 0; ; i++) {
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
      const body = await res.json();
      if (body.error) {
        const err = new Error(`${method}: ${JSON.stringify(body.error.data ?? body.error)}`);
        err.rpc = body.error;
        throw err;
      }
      return body.result;
    } catch (e) {
      if (e.rpc || i >= 5) throw e;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

export const query = (params) => rpc('query', { finality: 'final', ...params });

export async function view(account, method, args = {}) {
  const r = await query({ request_type: 'call_function', account_id: account, method_name: method,
    args_base64: Buffer.from(JSON.stringify(args)).toString('base64') });
  const text = Buffer.from(r.result).toString();
  return text ? JSON.parse(text) : null;
}

export const viewAccount = (account) => query({ request_type: 'view_account', account_id: account });

export async function accountExists(account) {
  try { await viewAccount(account); return true; } catch { return false; }
}

/** Reduces a final execution outcome to { ok, value, error, innerErrors, gasBurnt }. */
export function outcome(result) {
  const describe = (f) => {
    const exec = f?.ActionError?.kind?.FunctionCallError?.ExecutionError;
    if (exec) return exec.replace(/^Smart contract panicked: /, '');
    return JSON.stringify(f);
  };
  const top = result.status;
  const receipts = result.receipts_outcome ?? [];
  const innerErrors = receipts.map((r) => r.outcome.status).filter((s) => s?.Failure).map((s) => describe(s.Failure));
  const gasBurnt = receipts.reduce((a, r) => a + BigInt(r.outcome.gas_burnt), BigInt(result.transaction_outcome?.outcome.gas_burnt ?? 0));
  if (top?.Failure) return { ok: false, error: describe(top.Failure), innerErrors, gasBurnt };
  const raw = top?.SuccessValue;
  let value = null;
  if (raw) {
    const text = Buffer.from(raw, 'base64').toString();
    try { value = JSON.parse(text); } catch { value = text; }
  }
  return { ok: true, value, innerErrors, gasBurnt };
}

const nonces = new Map();

/**
 * Signs and sends one transaction. `wait` is a send_tx wait_until level. Returns
 * { hash, ok, value, error, result } where `result` is the full RPC response.
 */
export async function send(signer, key, receiver, actions, { wait = 'FINAL' } = {}) {
  const k = loadKey(key);
  const id = `${signer}/${k.publicKey}`;
  if (!nonces.has(id)) {
    const ak = await query({ request_type: 'view_access_key', account_id: signer, public_key: k.publicKey });
    nonces.set(id, BigInt(ak.nonce));
  }
  const nonce = nonces.get(id) + 1n;
  nonces.set(id, nonce);
  const block = await rpc('block', { finality: 'final' });
  const w = new W().str(signer).pk(k.publicKey).u64(nonce).str(receiver).fixed(base58Decode(block.header.hash, 32)).u32(actions.length);
  actions.forEach((a) => encodeAction(w, a));
  const tx = w.out();
  const hash = crypto.createHash('sha256').update(tx).digest();
  const sig = crypto.sign(null, hash, k.pem);
  const signed = Buffer.concat([tx, Buffer.from([0]), sig]);
  const txHash = base58Encode(hash);
  let result;
  try {
    result = await rpc('send_tx', { signed_tx_base64: signed.toString('base64'), wait_until: wait });
  } catch (e) {
    if (String(e.message).includes('TIMEOUT') || String(e.message).includes('Timeout')) {
      result = await waitTx(txHash, signer);
    } else {
      nonces.delete(id);
      return { hash: txHash, ok: false, error: e.message, result: e.rpc };
    }
  }
  return { hash: txHash, ...outcome(result), result };
}

export async function waitTx(hash, sender, timeoutMs = 600_000) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    try {
      return await rpc('EXPERIMENTAL_tx_status', { tx_hash: hash, sender_account_id: sender, wait_until: 'FINAL' });
    } catch (e) {
      if (Date.now() > until) throw e;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const NEAR = (n) => BigInt(Math.round(n * 1000)) * 10n ** 21n;

/** Per-receipt gas and status, with the function name each receipt ran. */
export async function receiptBreakdown(hash, sender) {
  const r = await rpc('EXPERIMENTAL_tx_status', { tx_hash: hash, sender_account_id: sender, wait_until: 'FINAL' });
  const methods = new Map();
  for (const rc of r.receipts ?? []) {
    const fc = rc.receipt?.Action?.actions?.find((a) => a.FunctionCall)?.FunctionCall;
    methods.set(rc.receipt_id, { method: fc?.method_name ?? (rc.receipt?.Data ? 'data' : rc.predecessor_id === 'system' ? 'refund' : 'other'), prepaid: fc?.gas });
  }
  return (r.receipts_outcome ?? []).map((o) => ({
    id: o.id, executor: o.outcome.executor_id, method: methods.get(o.id)?.method ?? 'refund', prepaid_gas: methods.get(o.id)?.prepaid,
    gas_burnt: o.outcome.gas_burnt, tgas: Number(o.outcome.gas_burnt) / 1e12,
    status: o.outcome.status?.Failure ? { Failure: o.outcome.status.Failure } : Object.keys(o.outcome.status ?? {})[0], logs: o.outcome.logs,
  }));
}
