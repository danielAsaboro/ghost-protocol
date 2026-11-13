// Independent check of every code change on v1.signer-prod.testnet using archival view_account.code_hash.
// Samples: every STEP blocks from just before the first deploy to the final head, plus 2 blocks before and
// 6 blocks after every DEPLOY_CONTRACT receipt that nearblocks reported (../receipts/*.json).
// Any hash difference between consecutive samples is bisected to the exact first block with the new hash,
// so deploys nearblocks missed still show up (only an A->B->A flip inside one STEP gap could be missed).
// Results are cached in ../view-account-cache.json, so the script can be re-run/resumed after rate limits.
// Output: ../code-hash-samples.json, ../code-hash-changes.json
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { rpc, viewAccount } from './rpc.mjs';

const DIR = new URL('../', import.meta.url).pathname;
const CACHE = DIR + 'view-account-cache.json';
const START = Number(process.env.START || 169857000);
const STEP = Number(process.env.STEP || 250000);
const cache = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE)) : {};
let dirty = 0;
const save = () => writeFileSync(CACHE, JSON.stringify(cache));

async function at(h) { // view_account at h; null code_hash if account/block missing
  if (!cache[h]) {
    const r = await viewAccount(h);
    const err = r.missing ? (r.error?.cause?.name || r.error?.name || 'missing') : undefined;
    cache[h] = r.missing ? { err } : { code_hash: r.code_hash, storage_usage: r.storage_usage, block_hash: r.block_hash };
    if (++dirty % 20 === 0) save();
  }
  return cache[h];
}
async function atNear(h, max = 30) { // first existing block >= h
  for (let x = h; x < h + max; x++) {
    const r = await at(x);
    if (!r.err || r.err === 'UNKNOWN_ACCOUNT') return { h: x, code_hash: r.code_hash ?? null, ...r };
  }
  return { h, missing: true };
}

const head = (await rpc('block', { finality: 'final' })).result.header.height;
const hs = new Set([START, head]);
for (let h = START; h < head; h += STEP) hs.add(h);
for (const f of readdirSync(DIR + 'receipts').filter((f) => f.endsWith('.json'))) {
  for (const r of JSON.parse(readFileSync(DIR + 'receipts/' + f)).rows)
    if (r.actions.some((a) => a.action === 'DEPLOY_CONTRACT')) { const b = Number(r.block.block_height); hs.add(b - 2); hs.add(b + 6); }
}
// direct deploys signed with the account's own full-access keys (no method name, so not in receipts/*)
if (existsSync(DIR + 'txns-signed-by-signer-account.json'))
  for (const r of JSON.parse(readFileSync(DIR + 'txns-signed-by-signer-account.json')).rows)
    if (r.actions.some((a) => a.action === 'DEPLOY_CONTRACT')) { const b = Number(r.block.block_height); hs.add(b - 2); hs.add(b + 6); }
const heights = [...hs].sort((a, b) => a - b);
const samples = [];
for (const [i, h] of heights.entries()) {
  const r = await atNear(h);
  samples.push({ height: h, at: r.h, code_hash: r.code_hash ?? null, storage_usage: r.storage_usage ?? null, missing: !!r.missing });
  if (i % 25 === 0) process.stderr.write(`sample ${i}/${heights.length} h=${h} ${r.code_hash}\n`);
}
save();
writeFileSync(DIR + 'code-hash-samples.json', JSON.stringify({ start: START, step: STEP, head, n: samples.length, samples }, null, 1));

const valid = samples.filter((s) => !s.missing);
const changes = [];
for (let i = 1; i < valid.length; i++) {
  const a = valid[i - 1], b = valid[i];
  if (a.code_hash === b.code_hash) continue;
  let from = a; // walk A->B->C... inside one gap: bisect, then continue from the found change until b's hash
  while (from.code_hash !== b.code_hash) {
  let lo = from.at, hi = b.at;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    const r = await atNear(mid, 1);
    if (r.missing) { // skipped height: look forward for an existing block inside (mid, hi)
      const r2 = await atNear(mid, Math.min(30, hi - mid));
      if (r2.missing || r2.h >= hi) { hi = mid; continue; }
      if (r2.code_hash === from.code_hash) lo = r2.h; else hi = r2.h;
      continue;
    }
    if (r.code_hash === from.code_hash) lo = mid; else hi = mid;
  }
  const after = await atNear(hi, 30);
  if (after.missing || after.code_hash === from.code_hash) { process.stderr.write(`bisect stalled near ${hi}\n`); break; }
  changes.push({ last_old_height: lo, first_new_height: after.h, old_code_hash: from.code_hash, new_code_hash: after.code_hash, storage_usage_before: (await atNear(lo, 1)).storage_usage ?? null, storage_usage_after: after.storage_usage ?? null });
  process.stderr.write(`change at ${after.h}: ${from.code_hash} -> ${after.code_hash}\n`);
  from = { at: after.h, code_hash: after.code_hash };
  }
}
save();
writeFileSync(DIR + 'code-hash-changes.json', JSON.stringify({ step: STEP, head, n_changes: changes.length, changes }, null, 1));
console.log(JSON.stringify(changes, null, 1));
