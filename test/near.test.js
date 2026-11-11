import assert from 'node:assert/strict';
import test from 'node:test';
import { outcome, signedBase64 } from '../relay/near.mjs';

test('reads the signed transaction the near CLI prints', () => {
  const out = 'noise\nSigned transaction (serialized as base64):\nIQAAAGFn+/==\nThis base64-encoded';
  assert.equal(signedBase64(out), 'IQAAAGFn+/==');
  assert.throws(() => signedBase64('nothing here'), /did not print/);
});

test('reports the contract panic text for a refused call', () => {
  const failed = { status: { Failure: { ActionError: { kind: { FunctionCallError: { ExecutionError: 'Smart contract panicked: fee above ceiling' } } } } } };
  assert.deepEqual(outcome(failed), { ok: false, error: 'fee above ceiling' });
});

test('decodes the return value of a successful call', () => {
  const ok = { status: { SuccessValue: Buffer.from('false').toString('base64') }, receipts_outcome: [] };
  assert.equal(outcome(ok).value, false);
});
