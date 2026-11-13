// Aggregate ../receipts/<method>.json into counts per method and per month (UTC), success vs failure.
// Output: ../governance-by-month.json and a markdown table on stdout.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
const DIR = new URL('../', import.meta.url).pathname;
const SKIP = new Set(['sign', 'respond']);
const per = {}; const months = new Set(); const totals = {};
for (const f of readdirSync(DIR + 'receipts').filter((f) => f.endsWith('.json'))) {
  const j = JSON.parse(readFileSync(DIR + 'receipts/' + f));
  if (SKIP.has(j.method)) continue;
  for (const r of j.rows) {
    if (!r.actions.some((a) => a.method === j.method)) continue;
    const mo = new Date(Number(BigInt(r.block.block_timestamp) / 1000000n)).toISOString().slice(0, 7);
    months.add(mo);
    per[j.method] ??= {}; per[j.method][mo] ??= { ok: 0, fail: 0 };
    per[j.method][mo][r.outcome.status ? 'ok' : 'fail']++;
    totals[j.method] ??= { ok: 0, fail: 0, first: mo, last: mo, signers: new Set(), pages: j.pages, capped: j.stopped_early_at_page_cap };
    const t = totals[j.method]; t[r.outcome.status ? 'ok' : 'fail']++; if (mo < t.first) t.first = mo; if (mo > t.last) t.last = mo; t.signers.add(r.predecessor_account_id);
  }
}
const ms = [...months].sort();
const methods = Object.keys(per).sort();
writeFileSync(DIR + 'governance-by-month.json', JSON.stringify({ months: ms, per_method_month: per, totals: Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, { ...v, signers: [...v.signers].sort() }])) }, null, 1));
console.log('| method | receipts ok | failed | distinct callers | first | last |\n|---|---|---|---|---|---|');
for (const m of methods.sort((a, b) => totals[b].ok - totals[a].ok)) { const t = totals[m]; console.log(`| \`${m}\` | ${t.ok} | ${t.fail} | ${t.signers.size} | ${t.first} | ${t.last} |`); }
console.log('\n| month | ' + methods.map((m) => `\`${m}\``).join(' | ') + ' | total |');
console.log('|---|' + methods.map(() => '---').join('|') + '|---|');
for (const mo of ms) {
  let tot = 0;
  const cells = methods.map((m) => { const c = per[m][mo]; const n = c ? c.ok + c.fail : 0; tot += n; return n || ''; });
  console.log(`| ${mo} | ${cells.join(' | ')} | ${tot} |`);
}

// Grouped monthly view (all receipts, ok + failed). Groups are by what a vote can change for a client.
const GROUPS = {
  'code upgrade (propose_update, vote_update, submit_contract_update, vote_contract_update)': ['propose_update', 'vote_update', 'submit_contract_update', 'vote_contract_update'],
  'domains (vote_add_domains)': ['vote_add_domains'],
  'participants/threshold (vote_new_parameters, vote_join, vote_leave)': ['vote_new_parameters', 'vote_join', 'vote_leave'],
  'key events (vote_pk, vote_reshared, vote_abort_key_event_instance, vote_cancel_*)': ['vote_pk', 'vote_reshared', 'vote_abort_key_event_instance', 'vote_cancel_keygen', 'vote_cancel_resharing'],
  'TEE allowlists (vote_code_hash, vote_add/remove_launcher_hash, vote_add/remove_os_measurement, vote_mpc_node_manifest_digest, vote_tee_verifier_change)': ['vote_code_hash', 'vote_add_launcher_hash', 'vote_remove_launcher_hash', 'vote_add_os_measurement', 'vote_remove_os_measurement', 'vote_mpc_node_manifest_digest', 'vote_tee_verifier_change'],
  'foreign-chain policy (vote_foreign_chain_policy, vote_update_foreign_chain_providers)': ['vote_foreign_chain_policy', 'vote_update_foreign_chain_providers'],
};
const short = ['upgrade', 'domains', 'participants', 'key events', 'TEE', 'foreign chain'];
console.log('\nGROUPS:'); Object.keys(GROUPS).forEach((g, i) => console.log(`- **${short[i]}**: ${g}`));
console.log('\n| month | ' + short.join(' | ') + ' | votes total | upgrades applied |');
console.log('|---|' + short.map(() => '---').join('|') + '|---|---|');
for (const mo of ms) {
  let tot = 0;
  const cells = Object.values(GROUPS).map((ms_) => { let n = 0; for (const m of ms_) { const c = per[m]?.[mo]; if (c) n += c.ok + c.fail; } tot += n; return n || ''; });
  const applied = (per.migrate?.[mo]?.ok || 0);
  console.log(`| ${mo} | ${cells.join(' | ')} | ${tot} | ${applied || ''} |`);
}
