// Minimal NEAR JSON-RPC helper with retries. Usage: import { rpc, viewAccount, callView } from './rpc.mjs'
// Rotates between the two public archival endpoints when one rate-limits (HTTP 429).
export const RPCS = (process.env.NEAR_RPC || 'https://archival-rpc.testnet.fastnear.com,https://archival-rpc.testnet.near.org').split(',');
export const RPC = RPCS[0];
let rr = 0;
export const ACCOUNT = 'v1.signer-prod.testnet';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function rpc(method, params, { tries = 14 } = {}) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const url = RPCS[(rr++ + i) % RPCS.length];
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      });
      if (res.status === 429) { await sleep(15000 * (i + 1)); throw new Error('HTTP 429'); }
      if (res.status >= 500) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      return j; // caller inspects j.result / j.error
    } catch (e) {
      lastErr = e;
      await sleep(Math.min(400 * 2 ** i, 20000));
    }
  }
  throw lastErr;
}

// Returns {code_hash, storage_usage, block_height, block_hash} or {missing:true, error}
export async function viewAccount(height) {
  const j = await rpc('query', { request_type: 'view_account', block_id: height, account_id: ACCOUNT });
  if (j.result) return j.result;
  return { missing: true, error: j.error };
}

// Find a viewable block at or after `height` (heights can be skipped on NEAR).
export async function viewAccountNear(height, maxSkip = 20) {
  for (let h = height; h < height + maxSkip; h++) {
    const r = await viewAccount(h);
    if (!r.missing) return r;
    const name = r.error?.cause?.name || r.error?.name;
    if (name === 'UNKNOWN_ACCOUNT') return { ...r, block_height: h };
  }
  return { missing: true, block_height: height };
}

export async function callView(method, args, blockRef) {
  const params = {
    request_type: 'call_function',
    account_id: ACCOUNT,
    method_name: method,
    args_base64: Buffer.from(JSON.stringify(args ?? {})).toString('base64'),
    ...blockRef,
  };
  const j = await rpc('query', params);
  if (j.result?.result) {
    const txt = Buffer.from(j.result.result).toString('utf8');
    let parsed;
    try { parsed = JSON.parse(txt); } catch { parsed = txt; }
    return { ok: true, block_height: j.result.block_height, value: parsed };
  }
  return { ok: false, error: j.error ?? j.result?.error ?? j.result };
}
