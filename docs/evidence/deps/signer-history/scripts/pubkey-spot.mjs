// Spot-check public keys right after the events most likely to change them:
// every successful init_running / DeployContract signed by the account's own keys (2024-2025 resets),
// the last vote_reshared / vote_pk / vote_add_domains receipt of each UTC day (end of a resharing / keygen).
// Output: ../pubkey-spot.json
import { readFileSync, writeFileSync } from 'node:fs';
import { rpc, callView } from './rpc.mjs';
const DIR = new URL('../', import.meta.url).pathname;
const ev = new Map();
const add = (h, why) => { if (!ev.has(h)) ev.set(h, why); };
for (const r of JSON.parse(readFileSync(DIR + 'txns-signed-by-signer-account.json')).rows)
  if (r.outcomes.status && r.actions.some((a) => a.action === 'DEPLOY_CONTRACT' || a.method === 'init_running')) add(Number(r.block.block_height) + 5, 'self-signed ' + r.actions.map((a) => a.method || a.action).join('+'));
for (const m of ['vote_reshared', 'vote_pk', 'vote_add_domains']) {
  const byDay = {};
  for (const r of JSON.parse(readFileSync(DIR + `receipts/${m}.json`)).rows) {
    const d = new Date(Number(BigInt(r.block.block_timestamp) / 1000000n)).toISOString().slice(0, 10);
    byDay[d] = Math.max(byDay[d] || 0, Number(r.block.block_height));
  }
  for (const [d, h] of Object.entries(byDay)) add(h + 5, `after last ${m} on ${d}`);
}
const rows = [];
for (const [h, why] of [...ev].sort((a, b) => a[0] - b[0])) {
  const row = { height: h, why };
  for (const [k, args] of [['pk_noargs', {}], ['pk_d0', { domain_id: 0 }], ['pk_d1', { domain_id: 1 }], ['pk_d2', { domain_id: 2 }], ['pk_d3', { domain_id: 3 }]]) {
    const v = await callView('public_key', args, { block_id: h });
    row[k] = v.ok ? v.value : { error: JSON.stringify(v.error).slice(0, 200) };
  }
  rows.push(row);
  process.stderr.write(`${h} ${why} ${JSON.stringify(row.pk_d0).slice(0, 30)} ${JSON.stringify(row.pk_d3).slice(0, 30)}\n`);
}
writeFileSync(DIR + 'pubkey-spot.json', JSON.stringify({ rows }, null, 1));
for (const k of ['pk_noargs', 'pk_d0', 'pk_d1', 'pk_d2', 'pk_d3']) {
  const vals = new Set(rows.filter((r) => typeof r[k] === 'string').map((r) => r[k]));
  console.log(k, 'distinct=', vals.size, [...vals].map((v) => v.slice(0, 24) + '...').join(' '));
}
