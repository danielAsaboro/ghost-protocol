// Raw JSON-RPC to the anvil node. The harness mines every block itself so finality is explicit:
// anvil reports `finalized` = latest - 2 * slots_in_an_epoch (up.sh starts it with 2 slots).
import { ANVIL } from './stack.mjs';

export const FINALITY_LAG = 4;
// Anvil's first default dev account; only ever used on this local chain to fund the vault address.
export const DEV_FUNDER = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';

export async function eth(method, params = []) {
  const res = await fetch(ANVIL, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const body = await res.json();
  if (body.error) {
    const e = new Error(`${method}: ${body.error.message}`);
    e.rpc = body.error;
    throw e;
  }
  return body.result;
}

export const hex = (n) => `0x${BigInt(n).toString(16)}`;
export const mine = (n = 1) => eth('anvil_mine', [hex(n)]);
export const setNextBaseFee = (wei) => eth('anvil_setNextBlockBaseFeePerGas', [hex(wei)]);
export const block = (tag) => eth('eth_getBlockByNumber', [tag, false]);
export const receipt = (hash) => eth('eth_getTransactionReceipt', [hash]);
export const balance = async (addr) => BigInt(await eth('eth_getBalance', [addr, 'latest']));
export const nonceOf = async (addr, tag = 'latest') => Number(BigInt(await eth('eth_getTransactionCount', [addr, tag])));

export async function heads() {
  const [latest, safe, finalized] = await Promise.all(['latest', 'safe', 'finalized'].map(block));
  return { latest: Number(BigInt(latest.number)), safe: Number(BigInt(safe.number)), finalized: Number(BigInt(finalized.number)),
    latestHash: latest.hash, baseFeePerGas: BigInt(latest.baseFeePerGas).toString() };
}

/** Mines until `finalized` is at or past `blockNumber`. */
export async function finalize(blockNumber) {
  const h = await heads();
  const need = blockNumber + FINALITY_LAG - h.latest;
  if (need > 0) await mine(need);
  return heads();
}

/** Sends value from the unlocked anvil dev account and mines it. */
export async function fund(to, valueWei) {
  const hash = await eth('eth_sendTransaction', [{ from: DEV_FUNDER, to, value: hex(valueWei) }]);
  await mine(1);
  return { hash, receipt: await receipt(hash) };
}

export async function txpool() {
  try { return await eth('txpool_content'); } catch (e) { return { error: e.message }; }
}
