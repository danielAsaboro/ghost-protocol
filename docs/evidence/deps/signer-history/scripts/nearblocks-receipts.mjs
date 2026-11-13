// Page through nearblocks v3 receipts on v1.signer-prod.testnet filtered by method name.
// Usage: node nearblocks-receipts.mjs method1 method2 ...
// Writes ../receipts/<method>.json (all pages, raw rows) and prints a per-method count.
// Gentle: one request every 2.1 s; backs off on 429.
import { mkdirSync, writeFileSync } from 'node:fs';

const ACCOUNT = 'v1.signer-prod.testnet';
const BASE = `https://api-testnet.nearblocks.io/v3/accounts/${ACCOUNT}/receipts`;
const OUT = new URL('../receipts/', import.meta.url).pathname;
const MAX_PAGES = Number(process.env.MAX_PAGES || 200);
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url) {
  for (let i = 0; i < 8; i++) {
    await sleep(2100);
    const res = await fetch(url, { headers: { accept: 'application/json' } });
    if (res.status === 429 || res.status >= 500) { await sleep(5000 * (i + 1)); continue; }
    return res.json();
  }
  throw new Error('nearblocks: too many retries for ' + url);
}

for (const method of process.argv.slice(2)) {
  const rows = [];
  let next = null, pages = 0, stoppedEarly = false, error = null;
  while (true) {
    const url = `${BASE}?method=${encodeURIComponent(method)}&limit=100${next ? `&next=${encodeURIComponent(next)}` : ''}`;
    const j = await get(url);
    if (!j.data) { error = j.errors ?? j; break; }
    rows.push(...j.data);
    pages++;
    next = j.meta?.next_page;
    if (!next || j.data.length === 0) break;
    if (pages >= MAX_PAGES) { stoppedEarly = true; break; }
  }
  // sanity: keep only rows whose actions really contain this method
  const matching = rows.filter((r) => r.actions?.some((a) => a.method === method));
  writeFileSync(OUT + method + '.json', JSON.stringify({ method, fetched_at: new Date().toISOString(), pages, stopped_early_at_page_cap: stoppedEarly, error, total_rows: rows.length, matching_rows: matching.length, rows }, null, 1));
  console.log(`${method}\trows=${rows.length}\tmatching=${matching.length}\tpages=${pages}${stoppedEarly ? '\tSTOPPED_AT_CAP' : ''}${error ? '\tERROR ' + JSON.stringify(error) : ''}`);
}
