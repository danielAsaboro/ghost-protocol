// Measure how long `public_key({domain_id:0})` was unavailable ("Protocol state is not running, nor resharing.")
// while new domains were being generated. For each vote_add_domains cluster: bisect the first failing block
// (between the cluster's first vote and 5 blocks after its last vote) and the first block where it works again.
// Output: ../keygen-windows.json
import { readFileSync, writeFileSync } from 'node:fs';
import { rpc, callView } from './rpc.mjs';
const DIR = new URL('../', import.meta.url).pathname;
const rows = JSON.parse(readFileSync(DIR + 'receipts/vote_add_domains.json')).rows.map((r) => Number(r.block.block_height)).sort((a, b) => a - b);
const clusters = [];
for (const h of rows) { const c = clusters.at(-1); if (c && h - c.last < 300000) c.last = h; else clusters.push({ first: h, last: h }); }

const cache = {};
async function status(h) { // 'ok' | 'down' | 'other'
  if (cache[h]) return cache[h];
  for (let x = h; x < h + 10; x++) {
    const v = await callView('public_key', { domain_id: 0 }, { block_id: x });
    if (v.ok) return (cache[h] = 'ok');
    const e = JSON.stringify(v.error);
    if (/not running, nor resharing/.test(e)) return (cache[h] = 'down');
    if (!/UNKNOWN_BLOCK|DB Not Found|not.*available/i.test(e)) return (cache[h] = 'other:' + e.slice(0, 120));
  }
  return (cache[h] = 'missing');
}
const ts = async (h) => { for (let x = h; x < h + 10; x++) { const b = await rpc('block', { block_id: x }); if (b.result) return new Date(Number(BigInt(b.result.header.timestamp) / 1000000n)).toISOString(); } return null; };
const out = [];
for (const c of clusters) {
  const probe = c.last + 5;
  if ((await status(probe)) !== 'down') { out.push({ ...c, down_at_last_vote_plus_5: false }); continue; }
  let lo = c.first - 1, hi = probe; // lo ok, hi down
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if ((await status(m)) === 'down') hi = m; else lo = m; }
  const start = hi;
  let a = probe, step = 50, b; // gallop forward to an ok block
  while (true) { b = a + step; const s = await status(b); if (s === 'ok') break; a = b; step *= 2; if (step > 5e6) break; }
  while (b - a > 1) { const m = (a + b) >> 1; if ((await status(m)) === 'ok') b = m; else a = m; }
  const r = { ...c, first_down_block: start, first_ok_block_after: b, blocks_down: b - start, start_time: await ts(start), end_time: await ts(b) };
  r.minutes_down = r.start_time && r.end_time ? Math.round((new Date(r.end_time) - new Date(r.start_time)) / 60000) : null;
  out.push(r);
  process.stderr.write(JSON.stringify(r) + '\n');
}
writeFileSync(DIR + 'keygen-windows.json', JSON.stringify({ note: 'public_key(domain 0) unavailable while state is Initializing (new-domain keygen)', windows: out }, null, 1));
console.log(JSON.stringify(out, null, 1));
