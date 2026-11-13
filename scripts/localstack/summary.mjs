// PASS/FAIL table for one lifecycle run, read from its events.jsonl. Exit 1 if any check fails.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
const events = readFileSync(join(dir, 'events.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const find = (prefix) => events.find((e) => e.assert?.startsWith(prefix));
const checks = [
  ['a', 'A check-in cancels a witnessed claim', (e) => e.claim === null, 'a3'],
  ['b', 'The real MPC signature passes on_signed (ecrecover against the vault key)', (e) => e.value === true, 'b2'],
  ['d1', 'A settle before Base finality is not attested; heir stays Pending', (e) => e.heir0 === 'Pending', 'd1'],
  ['d2', 'After finality the real MPC attestation marks the heir Paid', (e) => e.heir0 === 'Paid' && e.payout0 === 'Settled', 'd2'],
  ['e4', 'A reverted transfer is not attested', (e) => e.value === false && e.heir1 === 'Pending', 'e4'],
  ['e6', 'A witness quorum reopens the revert; the retry waits', (e) => e.payouts?.some((p) => p.status === 'Reverted'), 'e6'],
  ['f6', 'A transfer reorged out before finality is not attested', (e) => e.value === false, 'f6'],
  ['f10', 'The same transfer lands again and settles: heir Paid', (e) => e.heir0 === 'Paid', 'f10'],
  ['g', 'The real CKD key opens the sealed wishes after a pairing check', (e) => e.ok === true, 'g1'],
];
const refused = events.filter((e) => e.expect === 'fail');
let failed = 0;
const rows = checks.map(([id, what, ok, key]) => {
  const e = find(key);
  const pass = !!e && ok(e);
  if (!pass) failed++;
  return `| ${id} | ${what} | ${e ? (pass ? 'PASS' : 'FAIL') : 'MISSING'} |`;
});
const table = ['| # | Check | Result |', '|---|---|---|', ...rows].join('\n');
writeFileSync(join(dir, 'SUMMARY.md'), `# ${dir.split('/').pop()}\n\nReal mpc-node 3.18.0 x2, signer 3.18.0 code, neard 2.14.0, anvil as Base.\n\n${table}\n`);
console.log(table);
console.log(failed ? `\n${failed} FAILED` : '\nALL PASS');
process.exit(failed ? 1 : 0);
