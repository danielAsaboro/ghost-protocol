// What a stranger learns about a vault's heirs and money from public RPC alone: no keys, no
// off-chain files. Usage: node scripts/observe.mjs [vault] > docs/evidence/privacy/observer.json
import { createPublicClient, http, formatEther } from 'viem';
import { baseSepolia } from 'viem/chains';

const VAULT = process.argv[2] ?? 'ghostprotocol-vault.testnet';
const NEAR = 'https://rpc.testnet.near.org';
const BLOCKS = 'https://api-testnet.nearblocks.io/v3';
const base = createPublicClient({ chain: baseSepolia, transport: http('https://base-sepolia-rpc.publicnode.com') });

async function near(method, params) {
  const res = await fetch(NEAR, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const body = await res.json();
  if (body.error) throw new Error(JSON.stringify(body.error));
  return body.result;
}

async function view(method) {
  const r = await near('query', { request_type: 'call_function', finality: 'final', account_id: VAULT, method_name: method, args_base64: 'e30=' });
  return JSON.parse(Buffer.from(r.result).toString());
}

async function txns(account) {
  // Public indexer. Rate limited; one page is enough to show the pattern.
  const res = await fetch(`${BLOCKS}/accounts/${account}/txns?per_page=25`);
  if (!res.ok) return { error: `nearblocks ${res.status}` };
  const { data: list = [] } = await res.json();
  return list.map((t) => ({ hash: t.transaction_hash, at: new Date(Number(BigInt(t.block_timestamp) / 1_000_000n)).toISOString(), method: t.actions?.[0]?.method ?? t.actions?.[0]?.action, ok: t.outcomes?.status, from: t.signer_account_id, to: t.receiver_account_id }));
}

const s = await view('get_state');
const derived = await near('query', {
  request_type: 'call_function', finality: 'final', account_id: s.signer_contract, method_name: 'derived_public_key',
  args_base64: Buffer.from(JSON.stringify({ path: s.derivation_path, predecessor: VAULT, domain_id: 0 })).toString('base64'),
});
const key = JSON.parse(Buffer.from(derived.result).toString());
const now = Math.floor(Date.now() / 1000);

const heirs = await Promise.all(s.heirs.map(async (h, i) => ({
  index: i,
  address: h.address,
  floor_eth: formatEther(BigInt(h.floor_wei)),
  cap_eth: formatEther(BigInt(h.cap_wei)),
  // adult_by > now means the owner expects this heir to be a minor until then.
  minor_until: h.adult_by > now ? new Date(h.adult_by * 1000).toISOString() : null,
  adult_proven_at: h.adult_at ? new Date(h.adult_at * 1000).toISOString() : null,
  status: h.status,
  base_tx_count: await base.getTransactionCount({ address: h.address }),
  base_balance_eth: formatEther(await base.getBalance({ address: h.address })),
})));

const out = {
  vault: VAULT,
  observed_at: new Date().toISOString(),
  sources: [NEAR, 'base-sepolia-rpc.publicnode.com', BLOCKS],
  learned: {
    number_of_heirs: s.heirs.length,
    heirs,
    estate_budget_eth: formatEther(BigInt(s.budget_wei)),
    committed_eth: formatEther(BigInt(s.committed_wei)),
    vault_base_key: key,
    owner_account: s.owner,
    owner_last_check_in: new Date(s.last_check_in * 1000).toISOString(),
    owner_silent_for_days: Math.round((now - s.last_check_in) / 86400),
    death_claim: s.claim ? { opened: new Date(s.claim.opened_at * 1000).toISOString(), stated_death: new Date(s.claim.death_at * 1000).toISOString(), kind: s.claim.kind } : null,
    witnesses: { count: s.claim?.contested?.length ?? null, threshold: null },
    agent_account: s.agent,
    court_account: s.legal_authority,
    payouts: s.payouts.map((p) => ({ heir: p.heir_index, to: p.to, value_eth: formatEther(BigInt(p.value_wei)), source: p.source, status: p.status, attempts: p.attempts.length })),
    sealed_wishes_hash: s.sealed_wishes_hash,
  },
  activity: { owner: await txns(s.owner), vault: await txns(VAULT) },
};
console.log(JSON.stringify(out, null, 2));
