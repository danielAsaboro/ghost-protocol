// Join code-hash changes (archival RPC) with deploy actions seen by nearblocks
// (self-signed DeployContract txns + DEPLOY_CONTRACT receipts from governance), print a markdown table,
// and list deploy actions that did not change the code hash. Output: ../code-changes-table.json
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
const DIR = new URL('../', import.meta.url).pathname;
const versions = JSON.parse(readFileSync(DIR + 'code-versions.json'));
const deploys = [];
for (const r of JSON.parse(readFileSync(DIR + 'txns-signed-by-signer-account.json')).rows)
  if (r.actions.some((a) => a.action === 'DEPLOY_CONTRACT')) deploys.push({ h: Number(r.block.block_height), tx: r.transaction_hash, ok: r.outcomes.status, path: 'full-access key', actions: r.actions.map((a) => a.method || a.action).join('+') });
for (const f of readdirSync(DIR + 'receipts')) for (const r of JSON.parse(readFileSync(DIR + 'receipts/' + f)).rows)
  if (r.actions.some((a) => a.action === 'DEPLOY_CONTRACT') && !deploys.some((d) => d.tx === r.transaction_hash))
    deploys.push({ h: Number(r.block.block_height), tx: r.transaction_hash, ok: r.outcome.status, path: 'contract self-upgrade (vote)', actions: r.actions.map((a) => a.method || a.action).join('+') });
deploys.sort((a, b) => a.h - b.h);
const iso = (s) => s?.slice(0, 16).replace('T', ' ');
const rows = [];
for (const v of versions) {
  if (v.old_code_hash === null) continue; // account creation (empty code 1111...)
  const d = deploys.find((d) => d.ok && d.h >= v.last_old_height - 3 && d.h <= v.first_new_height);
  if (d) d.matched = true;
  const ver = v.version ?? v.source_metadata?.version ?? null;
  rows.push({ height: v.first_new_height, date: v.date, tx: d?.tx ?? null, path: d?.path ?? 'UNMATCHED', old: v.old_code_hash, new: v.new_code_hash, version: ver, version_source: v.version ? 'version()' : v.source_metadata ? 'contract_source_metadata()' : null, link: v.source_metadata?.link ?? null, exports_added: v.exports_added, exports_removed: v.exports_removed });
}
const unmatched = deploys.filter((d) => !d.matched);
writeFileSync(DIR + 'code-changes-table.json', JSON.stringify({ n_changes: rows.length, rows, deploy_actions_total: deploys.length, deploy_actions_not_changing_hash: unmatched }, null, 1));
console.log('| # | first block with new code | date (UTC) | tx | path | old -> new code_hash | version |\n|---|---|---|---|---|---|---|');
rows.forEach((r, i) => console.log(`| ${i + 1} | ${r.height} | ${iso(r.date)} | \`${r.tx ?? '?'}\` | ${r.path} | \`${r.old.slice(0, 8)}…\` → \`${r.new}\` | ${r.version ?? 'n/a'}${r.version_source === 'contract_source_metadata()' ? ' (nep330)' : ''} |`));
console.log('\nDeploy actions that did not change code_hash:');
for (const d of unmatched) console.log(`- ${d.h} ${d.ok ? 'ok' : 'FAILED'} ${d.path} ${d.actions} \`${d.tx}\``);
