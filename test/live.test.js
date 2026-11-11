// Rechecks the deployed vault against real NEAR testnet and Base Sepolia. No local stand-ins.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { verifyVault } from '../web/verify.mjs';

const evidence = JSON.parse(readFileSync(new URL('../web/evidence.json', import.meta.url)));
const ui = readFileSync(new URL('../web/ui.mjs', import.meta.url), 'utf8');
const reproducibleHash = ui.match(/WASM_HASH = '([^']+)'/)[1];

test('the live vault passes every check that has happened, and fails none', { timeout: 120_000 }, async () => {
  const r = await verifyVault({ vault: evidence.vault, evidence, reproducibleHash });
  const failed = r.checks.filter((c) => c.verdict === 'FAIL');
  assert.deepEqual(failed, []);
  for (const id of ['code-hash', 'reproducible', 'no-keys', 'vault-key', 'foreign-key', 'bounds', 'fallback', 'attacks']) {
    assert.equal(r.checks.find((c) => c.id === id)?.verdict, 'PASS', id);
  }
  assert.ok(r.checks.some((c) => c.id.startsWith('sig-') && c.verdict === 'PASS'), 'a real MPC signature recovers to the vault');
  assert.deepEqual(r.events.filter((e) => e.verdict !== 'PASS').map((e) => e.label), []);
});

test('the verifier fails when the published hash is wrong', { timeout: 120_000 }, async () => {
  const r = await verifyVault({ vault: evidence.vault, evidence: { events: [], settle: {} }, reproducibleHash: '1111' });
  assert.equal(r.checks.find((c) => c.id === 'reproducible').verdict, 'FAIL');
});

test('the verifier fails when an attack is claimed blocked but the receipt says otherwise', { timeout: 120_000 }, async () => {
  const succeeded = evidence.events.find((e) => e.expect === 'ok' && e.method === 'check_in');
  const lie = { events: [{ ...succeeded, expect: 'fail', error: 'payout already started' }], settle: {} };
  const r = await verifyVault({ vault: evidence.vault, evidence: lie });
  assert.equal(r.events[0].verdict, 'FAIL');
  assert.equal(r.checks.find((c) => c.id === 'attacks').verdict, 'FAIL');
});
