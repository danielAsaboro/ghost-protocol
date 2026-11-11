// Signs with the near CLI keychain, broadcasts over RPC, and returns the on-chain outcome.
// Failed calls keep their hash, so every attack leaves a receipt anyone can recheck.
import { spawnSync } from 'node:child_process';
import { TESTNET_RPC } from './base.mjs';

export function signedBase64(output) {
  const lines = output.replace(/\x1b\[[0-9;]*m/g, '').split('\n');
  const at = lines.findIndex((l) => l.includes('Signed transaction (serialized as base64)'));
  const value = at >= 0 ? lines[at + 1]?.trim() : undefined;
  if (!value || !/^[A-Za-z0-9+/=]+$/.test(value)) throw new Error('near CLI did not print a signed transaction');
  return value;
}

/** Reduces an RPC transaction result to { ok, value, error }, reading the first failing receipt. */
export function outcome(result) {
  const failure = (status) => status?.Failure;
  const describe = (f) => {
    const exec = f?.ActionError?.kind?.FunctionCallError?.ExecutionError;
    if (exec) return exec.replace(/^Smart contract panicked: /, '');
    if (f?.ActionError?.kind?.FunctionCallError?.MethodResolveError) return 'method not found';
    return JSON.stringify(f);
  };
  const top = result.status;
  if (failure(top)) return { ok: false, error: describe(top.Failure) };
  const inner = result.receipts_outcome?.map((r) => r.outcome.status).find(failure);
  const raw = top?.SuccessValue;
  const value = raw ? JSON.parse(Buffer.from(raw, 'base64').toString() || 'null') : null;
  return { ok: true, value, innerError: inner ? describe(inner.Failure) : undefined };
}

export async function sendTx(base64, rpc = TESTNET_RPC) {
  const res = await fetch(rpc, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'send_tx', params: { signed_tx_base64: base64, wait_until: 'FINAL' } }),
  });
  const body = await res.json();
  if (body.error) throw new Error(`send_tx: ${JSON.stringify(body.error.data ?? body.error)}`);
  return { hash: body.result.transaction.hash, ...outcome(body.result) };
}

export async function callContract({ contract, method, args, signer, gas = '300 Tgas', deposit = '0 NEAR' }) {
  const cli = spawnSync('near', ['contract', 'call-function', 'as-transaction', contract, method, 'json-args', JSON.stringify(args),
    'prepaid-gas', gas, 'attached-deposit', deposit, 'sign-as', signer, 'network-config', 'testnet',
    'sign-with-keychain', 'display'], { encoding: 'utf8' });
  if (cli.status !== 0) throw new Error(`near CLI failed to sign: ${cli.stderr.split('\n').find((l) => l.includes('Error')) ?? cli.stderr}`);
  return sendTx(signedBase64(`${cli.stdout}\n${cli.stderr}`));
}
