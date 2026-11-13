import { getAddress, keccak256, recoverAddress, serializeTransaction } from 'viem';

export const TESTNET_RPC = 'https://rpc.testnet.near.org';
export const SIGNER = 'v1.signer-prod.testnet';
export const PATH = 'ghost-base-sepolia-1';
export const WISHES_PATH = 'ghost-wishes-1';
export const BASE_SEPOLIA = 84532;
export const SIGN_DOMAIN = 0;
export const CKD_DOMAIN = 2;
export const FOREIGN_TX_DOMAIN = 3;

async function rpcQuery(params, rpc = TESTNET_RPC) {
  const res = await fetch(rpc, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'query', params }),
  });
  const body = await res.json();
  if (!body.result || body.result.error) throw new Error(`query failed: ${JSON.stringify(body.result ?? body.error)}`);
  return body.result;
}

export async function viewCall(account, method, args = {}, rpc = TESTNET_RPC) {
  const result = await rpcQuery({
    request_type: 'call_function', finality: 'final', account_id: account, method_name: method,
    args_base64: Buffer.from(JSON.stringify(args)).toString('base64'),
  }, rpc);
  return JSON.parse(Buffer.from(result.result).toString());
}

export const accessKeys = async (account, rpc) =>
  (await rpcQuery({ request_type: 'view_access_key_list', finality: 'final', account_id: account }, rpc)).keys;

export const fullAccessKeys = (keys) => keys.filter((k) => k.access_key.permission === 'FullAccess');

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export function base58Decode(text, length) {
  let n = 0n;
  for (const c of text) {
    const digit = BASE58.indexOf(c);
    if (digit < 0) throw new Error('invalid base58');
    n = n * 58n + BigInt(digit);
  }
  return Buffer.from(n.toString(16).padStart(length * 2, '0'), 'hex');
}

export function base58Encode(bytes) {
  let n = BigInt(`0x${Buffer.from(bytes).toString('hex')}`);
  let out = '';
  while (n > 0n) {
    out = BASE58[Number(n % 58n)] + out;
    n /= 58n;
  }
  return out;
}

export const nearKeyBytes = (nearKey) => base58Decode(nearKey.split(':')[1], 64);

/** Converts a NEAR-format secp256k1 public key into an Ethereum address. */
export const addressFromNearKey = (nearKey) => getAddress(`0x${keccak256(nearKeyBytes(nearKey)).slice(-40)}`);

export const derivedKey = (vault) => viewCall(SIGNER, 'derived_public_key', { path: PATH, predecessor: vault, domain_id: SIGN_DOMAIN });
export const foreignTxKey = () => viewCall(SIGNER, 'public_key', { domain_id: FOREIGN_TX_DOMAIN });
export const ckdMasterKey = () => viewCall(SIGNER, 'public_key', { domain_id: CKD_DOMAIN });
export const deriveVaultAddress = async (vault) => addressFromNearKey(await derivedKey(vault));

export function unsignedFromAttempt(payout, attempt) {
  return {
    type: 'eip1559',
    chainId: BASE_SEPOLIA,
    nonce: Number(payout.nonce),
    maxFeePerGas: BigInt(attempt.max_fee_per_gas),
    maxPriorityFeePerGas: BigInt(attempt.max_priority_fee_per_gas),
    gas: BigInt(payout.gas_limit),
    to: getAddress(payout.to),
    value: BigInt(payout.value_wei),
  };
}

/** Rebuilds the signed transaction and refuses it unless it is exactly what the contract approved. */
export async function assembleSignedTx(payout, attempt, expectedSigner) {
  if (!attempt.r_hex) throw new Error('attempt has no signature');
  const tx = unsignedFromAttempt(payout, attempt);
  const hash = keccak256(serializeTransaction(tx));
  if (hash.slice(2) !== attempt.payload_hex) throw new Error('rebuilt transaction differs from contract payload');
  const signature = { r: `0x${attempt.r_hex}`, s: `0x${attempt.s_hex}`, yParity: attempt.y_parity };
  const recovered = await recoverAddress({ hash, signature });
  if (recovered !== getAddress(expectedSigner)) throw new Error(`signature recovers to ${recovered}`);
  const serialized = serializeTransaction(tx, signature);
  if (keccak256(serialized).slice(2) !== attempt.tx_hash_hex) throw new Error('transaction hash differs from contract record');
  return serialized;
}

/** The contract cannot read a Base balance, so the relayer refuses a transaction that cannot be mined. */
export function assertFunded(balance, payout, attempt) {
  const needed = BigInt(payout.value_wei) + BigInt(payout.gas_limit) * BigInt(attempt.max_fee_per_gas);
  if (balance < needed) throw new Error(`vault holds ${balance} wei and this transaction needs ${needed}`);
}

/**
 * D23: witnesses may sign a revert only when Base reports it final, the rule the MPC inspector
 * applies to successes. A revert signed earlier can be reorged into a success, and the retry would
 * then pay the heir twice (docs/evidence/spec/tlc-v2-cex-reorg-revert.log).
 * Pure: takes the receipt, the `finalized` block and the canonical block at the receipt's height.
 */
export function revertIsFinal(receipt, finalized, canonical) {
  if (!receipt) return { ok: false, reason: 'transaction not found' };
  if (receipt.status !== 'reverted') return { ok: false, reason: `status is ${receipt.status}, not reverted` };
  if (!finalized || receipt.blockNumber > finalized.number) return { ok: false, reason: 'block is not finalized yet' };
  if (!canonical || canonical.hash !== receipt.blockHash) return { ok: false, reason: 'receipt is not on the canonical chain' };
  return { ok: true };
}

/** Reads the three facts `revertIsFinal` needs from a viem client. */
export async function checkRevertFinal(client, hash) {
  const receipt = await client.getTransactionReceipt({ hash }).catch(() => null);
  const finalized = await client.getBlock({ blockTag: 'finalized' });
  const canonical = receipt ? await client.getBlock({ blockNumber: receipt.blockNumber }).catch(() => null) : null;
  return revertIsFinal(receipt, finalized, canonical);
}
