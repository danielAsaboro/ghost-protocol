import assert from 'node:assert/strict';
import test from 'node:test';
import { keccak256, parseTransaction, serializeTransaction } from 'viem';
import { privateKeyToAccount, sign } from 'viem/accounts';
import { assembleSignedTx, assertFunded, fullAccessKeys, unsignedFromAttempt } from '../relay/base.mjs';

const KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
const vault = privateKeyToAccount(KEY).address;
const payout = { to: '0x70997970c51812dc3a010c7d01b50e0d17dc79c8', value_wei: '10000000000000000', nonce: 7, gas_limit: 21000 };
const fees = { max_fee_per_gas: '30000000000', max_priority_fee_per_gas: '1000000000' };

async function signedAttempt() {
  const tx = unsignedFromAttempt(payout, fees);
  const hash = keccak256(serializeTransaction(tx));
  const signature = await sign({ hash, privateKey: KEY });
  return {
    ...fees, payload_hex: hash.slice(2), r_hex: signature.r.slice(2), s_hex: signature.s.slice(2), y_parity: signature.yParity,
    tx_hash_hex: keccak256(serializeTransaction(tx, signature)).slice(2),
  };
}

test('assembles the transaction the contract recorded', async () => {
  const parsed = parseTransaction(await assembleSignedTx(payout, await signedAttempt(), vault));
  assert.equal(parsed.to.toLowerCase(), payout.to);
  assert.equal(parsed.value, 10000000000000000n);
  assert.equal(parsed.chainId, 84532);
});

test('refuses a transaction the contract did not approve', async () => {
  await assert.rejects(assembleSignedTx({ ...payout, value_wei: '20000000000000000' }, await signedAttempt(), vault), /differs from contract payload/);
});

test('refuses a signature from another address', async () => {
  await assert.rejects(assembleSignedTx(payout, await signedAttempt(), '0x00000000000000000000000000000000000000aa'), /recovers to/);
});

test('refuses a transaction hash the contract did not record', async () => {
  await assert.rejects(assembleSignedTx(payout, { ...(await signedAttempt()), tx_hash_hex: '00'.repeat(32) }, vault), /differs from contract record/);
});

test('refuses to broadcast an underfunded transaction', () => {
  assert.throws(() => assertFunded(1n, payout, fees), /needs/);
  assertFunded(10n ** 18n, payout, fees);
});

test('fullAccessKeys finds only FullAccess entries', () => {
  const keys = [{ public_key: 'a', access_key: { permission: 'FullAccess' } }, { public_key: 'b', access_key: { permission: { FunctionCall: {} } } }];
  assert.deepEqual(fullAccessKeys(keys).map((k) => k.public_key), ['a']);
});
