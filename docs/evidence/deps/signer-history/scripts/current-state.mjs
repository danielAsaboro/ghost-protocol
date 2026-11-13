// Snapshot current view methods of v1.signer-prod.testnet at one final block.
// Output: ../current-state.json
import { writeFileSync } from 'node:fs';
process.env.NEAR_RPC ||= 'https://rpc.testnet.near.org';
const { rpc, callView } = await import('./rpc.mjs');

const OUT = new URL('../current-state.json', import.meta.url).pathname;
const head = (await rpc('block', { finality: 'final' })).result.header;
const at = { block_id: head.height };
const calls = [
  ['version', {}],
  ['state', {}],
  ['config', {}],
  ['public_key', { domain_id: 0 }],
  ['public_key', { domain_id: 1 }],
  ['public_key', { domain_id: 2 }],
  ['public_key', { domain_id: 3 }],
  ['public_key', {}],
  ['allowed_foreign_chain_providers', {}],
  ['get_available_foreign_chains', {}],
  ['get_foreign_chains_configs', {}],
  ['contract_update_votes', {}],
  ['allowed_docker_image_hashes', {}],
  ['tee_verifier_account_id', {}],
  ['migration_info', {}],
  ['contract_source_metadata', {}],
];
const out = { block_height: head.height, block_hash: head.hash, block_timestamp: head.timestamp, timestamp_iso: new Date(Number(BigInt(head.timestamp) / 1000000n)).toISOString(), account: (await rpc('query', { request_type: 'view_account', account_id: 'v1.signer-prod.testnet', ...at })).result, views: {} };
for (const [m, args] of calls) {
  const key = Object.keys(args).length ? `${m}(${JSON.stringify(args)})` : m;
  out.views[key] = await callView(m, args, at);
}
writeFileSync(OUT, JSON.stringify(out, null, 1));
for (const [k, v] of Object.entries(out.views)) console.log(k, v.ok ? JSON.stringify(v.value).slice(0, 200) : 'ERR ' + JSON.stringify(v.error).slice(0, 200));
