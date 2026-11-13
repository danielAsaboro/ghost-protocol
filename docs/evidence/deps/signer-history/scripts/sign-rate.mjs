// Approximate `sign` volume per month. nearblocks v3 has no public count endpoint, so for each month we take
// SAMPLES points (before_ts), fetch the 100 most recent `sign` receipts before each point, and compute the
// receipt rate from the time span those 100 rows cover. Monthly estimate = mean rate * seconds in month.
// Also saves the last-365-day daily txn totals (all methods) from /stats/txns.
// Output: ../sign-rate.json, ../nearblocks-stats-txns-daily.json
import { writeFileSync } from 'node:fs';
const A = 'v1.signer-prod.testnet';
const BASE = `https://api-testnet.nearblocks.io/v3/accounts/${A}`;
const DIR = new URL('../', import.meta.url).pathname;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(url) {
  for (let i = 0; i < 8; i++) {
    await sleep(2100);
    const res = await fetch(url);
    if (res.status === 429 || res.status >= 500) { await sleep(5000 * (i + 1)); continue; }
    return res.json();
  }
  throw new Error('too many retries ' + url);
}
writeFileSync(DIR + 'nearblocks-stats-txns-daily.json', JSON.stringify(await get(`${BASE}/stats/txns?limit=365`), null, 1));

const DAYS = (process.env.DAYS || '5,15,25').split(',').map(Number);
const months = [];
for (let y = 2024, m = 7; y < 2026 || (y === 2026 && m <= 11); m === 12 ? (y++, m = 1) : m++) months.push([y, m]);
const now = Date.now();
const out = [];
for (const [y, m] of months) {
  const samples = [];
  for (const d of DAYS) {
    const t = Date.UTC(y, m - 1, d, 12);
    if (t > now) continue;
    const j = await get(`${BASE}/receipts?method=sign&limit=100&before_ts=${BigInt(t) * 1000000n}`);
    const rows = (j.data || []).filter((r) => r.actions?.some((a) => a.method === 'sign'));
    if (rows.length < 2) { samples.push({ day: d, n: rows.length, rate_per_s: 0, note: 'fewer than 2 rows' }); continue; }
    const t0 = Number(BigInt(rows[0].block.block_timestamp) / 1000000n), t1 = Number(BigInt(rows.at(-1).block.block_timestamp) / 1000000n);
    const gapToPoint = (t - t0) / 1000; // seconds between sample point and newest row (large => sparse)
    const span = Math.max((t0 - t1) / 1000, 1);
    samples.push({ day: d, n: rows.length, span_s: span, gap_to_point_s: gapToPoint, rate_per_s: (rows.length - 1) / (span + Math.max(gapToPoint, 0)), newest: new Date(t0).toISOString(), oldest: new Date(t1).toISOString(), top_predecessors: Object.entries(rows.reduce((a, r) => ((a[r.predecessor_account_id] = (a[r.predecessor_account_id] || 0) + 1), a), {})).sort((a, b) => b[1] - a[1]).slice(0, 3) });
  }
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const rate = samples.reduce((s, x) => s + x.rate_per_s, 0) / (samples.length || 1);
  out.push({ month: `${y}-${String(m).padStart(2, '0')}`, est_sign_receipts: Math.round(rate * daysInMonth * 86400), samples });
  console.log(out.at(-1).month, out.at(-1).est_sign_receipts, samples.map((s) => `${s.day}:${s.rate_per_s.toFixed(4)}/s`).join(' '));
}
writeFileSync(DIR + 'sign-rate.json', JSON.stringify({ method: 'rate from 100 most recent sign receipts before each sample point; rate=(n-1)/(span+gap)', months: out }, null, 1));
