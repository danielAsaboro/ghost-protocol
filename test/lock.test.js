import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('ghost.mjs has a lock step that removes the full-access key', () => {
  const source = readFileSync(new URL('../scripts/ghost.mjs', import.meta.url), 'utf8');
  assert.match(source, /delete-keys?/);
  assert.match(source, /FullAccess/);
});
