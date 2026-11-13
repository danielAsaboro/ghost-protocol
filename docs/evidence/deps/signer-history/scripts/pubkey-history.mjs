// Call public_key (no args, and per domain_id 0..3) and version at historical heights.
// Heights: every ~1.5M blocks from first deploy to head, plus 1 block after every DeployContract receipt
// found in ../receipts/{migrate,init_running}.json.
// Output: ../pubkey-history.json
import { readFileSync, writeFileSync } from 'node:fs';
import { rpc, callView } from './rpc.mjs';

const DIR = new URL('../', import.meta.url).pathname;
const head = (await rpc('block', { finality: 'final' })).result.header.height;
const set = new Set();
for (let h = 169860000; h < head; h += 1500000) set.add(h);
set.add(head);
for (const f of ['migrate', 'init_running']) {
  try {
    for (const r of JSON.parse(readFileSync(DIR + 'receipts/' + f + '.json')).rows) {
      if (r.actions.some((a) => a.action === 'DEPLOY_CONTRACT') && r.outcome.status) set.add(Number(r.block.block_height) + 3);
    }
  } catch {}
}
const heights = [...set].sort((a, b) => a - b);
const rows = [];
for (const h of heights) {
  let at = h, res;
  for (let k = 0; k < 10; k++) { // skip missing heights
    const v = await callView('version', {}, { block_id: at });
    if (v.ok || !/UNKNOWN_BLOCK|GARBAGE|not.*found|DB Not Found/i.test(JSON.stringify(v.error))) { res = v; break; }
    at++;
  }
  const row = { height: h, at, version: res?.ok ? res.value : { error: JSON.stringify(res?.error).slice(0, 300) } };
  for (const [k, args] of [['pk_noargs', {}], ['pk_d0', { domain_id: 0 }], ['pk_d1', { domain_id: 1 }], ['pk_d2', { domain_id: 2 }], ['pk_d3', { domain_id: 3 }]]) {
    const v = await callView('public_key', args, { block_id: at });
    row[k] = v.ok ? v.value : { error: JSON.stringify(v.error).slice(0, 300) };
  }
  const b = await rpc('block', { block_id: at });
  row.date = b.result ? new Date(Number(BigInt(b.result.header.timestamp) / 1000000n)).toISOString() : null;
  rows.push(row);
  process.stderr.write(`${h} ${row.date} v=${JSON.stringify(row.version).slice(0, 40)} d0=${JSON.stringify(row.pk_d0).slice(0, 30)}\n`);
}
writeFileSync(DIR + 'pubkey-history.json', JSON.stringify({ head, rows }, null, 1));

// summarise distinct values
for (const k of ['pk_noargs', 'pk_d0', 'pk_d1', 'pk_d2', 'pk_d3']) {
  const vals = new Map();
  for (const r of rows) if (typeof r[k] === 'string') { if (!vals.has(r[k])) vals.set(r[k], [r.height, r.height]); vals.get(r[k])[1] = r.height; }
  console.log(k, 'distinct=', vals.size, JSON.stringify([...vals].map(([v, [a, b]]) => ({ key: v.slice(0, 30) + '...', first_seen: a, last_seen: b }))));
}
