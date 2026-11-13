// For every code-hash change in ../code-hash-changes.json: fetch the code at the first new block,
// list its wasm exports (= callable method names), call `version`, and find the cause receipt/tx
// via nearblocks receipts files already saved (../receipts/*.json, DEPLOY_CONTRACT rows).
// Output: ../code-versions.json
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { rpc, callView, ACCOUNT } from './rpc.mjs';

const DIR = new URL('../', import.meta.url).pathname;
const { changes } = JSON.parse(readFileSync(DIR + 'code-hash-changes.json'));
const deployRows = [];
for (const f of readdirSync(DIR + 'receipts')) {
  for (const r of JSON.parse(readFileSync(DIR + 'receipts/' + f)).rows)
    if (r.actions.some((a) => a.action === 'DEPLOY_CONTRACT')) deployRows.push(r);
}
const bs58 = (buf) => { // base58 encode (NEAR code_hash = base58(sha256(code)))
  const A = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let n = BigInt('0x' + buf.toString('hex')), s = '';
  while (n > 0n) { s = A[Number(n % 58n)] + s; n /= 58n; }
  for (const b of buf) { if (b === 0) s = '1' + s; else break; }
  return s;
};
const out = [];
let prevExports = null;
for (const c of changes) {
  const h = c.first_new_height;
  const code = await rpc('query', { request_type: 'view_code', account_id: ACCOUNT, block_id: h });
  let exports = null, sha = null;
  if (code.result) {
    const bin = Buffer.from(code.result.code_base64, 'base64');
    sha = bs58(createHash('sha256').update(bin).digest());
    exports = WebAssembly.Module.exports(new WebAssembly.Module(bin)).filter((e) => e.kind === 'function').map((e) => e.name).sort();
  }
  const version = await callView('version', {}, { block_id: h });
  const meta = await callView('contract_source_metadata', {}, { block_id: h });
  const blk = await rpc('block', { block_id: h });
  // receipt that executed the deploy: same block or within a few blocks before
  const rcpt = deployRows.filter((r) => Number(r.block.block_height) <= h && Number(r.block.block_height) >= c.last_old_height - 2 && r.outcome.status);
  const added = prevExports && exports ? exports.filter((e) => !prevExports.includes(e)) : null;
  const removed = prevExports && exports ? prevExports.filter((e) => !exports.includes(e)) : null;
  out.push({
    first_new_height: h, last_old_height: c.last_old_height,
    date: blk.result ? new Date(Number(BigInt(blk.result.header.timestamp) / 1000000n)).toISOString() : null,
    old_code_hash: c.old_code_hash, new_code_hash: c.new_code_hash, sha256_check: sha === c.new_code_hash,
    version: version.ok ? version.value : null, source_metadata: meta.ok ? meta.value : null,
    deploy_receipt: rcpt.map((r) => ({ receipt_id: r.receipt_id, tx: r.transaction_hash, block: r.block.block_height, actions: r.actions, predecessor: r.predecessor_account_id })),
    exports_count: exports?.length ?? null, exports_added: added, exports_removed: removed, exports,
  });
  if (exports) prevExports = exports;
  process.stderr.write(`${h} ${out.at(-1).date} ${c.new_code_hash} v=${JSON.stringify(out.at(-1).version)} +${added?.length ?? '-'} -${removed?.length ?? '-'}\n`);
}
writeFileSync(DIR + 'code-versions.json', JSON.stringify(out, null, 1));
