#!/usr/bin/env node
// Called by up.sh. `accounts <signer.wasm>` creates the accounts and deploys the signer contract;
// `init <n>` registers the node keys, initializes the contract, has the nodes vote the domains
// and the Base provider whitelist, and waits until the real nodes have generated every key.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { act, NEAR, send, sleep, view } from './lib/near.mjs';
import { BASE_WHITELIST, keyOf, loadState, MPC, saveState, newKey } from './lib/stack.mjs';

const [cmd, arg] = process.argv.slice(2);

async function must(label, signer, receiver, actions) {
  const r = await send(signer, keyOf(signer), receiver, actions);
  if (!r.ok || r.innerErrors?.length) throw new Error(`${label} failed: ${r.error ?? r.innerErrors.join(' | ')}`);
  console.log(`ok ${label} ${r.hash}`);
  return r;
}

async function createAccount(state, account, amount, extra = []) {
  const k = newKey();
  state.accounts[account] = { pem: k.pem, publicKey: k.publicKey };
  saveState(state);
  return must(`create ${account}`, 'test.near', account, [act.createAccount(), act.transfer(amount), act.addFullKey(k.publicKey), ...extra]);
}

if (cmd === 'accounts') {
  const code = readFileSync(arg);
  const state = { accounts: {}, signerWasm: { path: arg, sha256: createHash('sha256').update(code).digest('hex') } };
  saveState(state);
  await createAccount(state, MPC, NEAR(1000), [act.deploy(code)]);
  for (let i = 1; i <= 2; i++) await createAccount(state, `mpc-node-${i}.test.near`, NEAR(100));
} else if (cmd === 'init') {
  const n = Number(arg);
  const state = loadState();
  const nodes = [];
  for (let i = 1; i <= n; i++) {
    const data = await (await fetch(`http://127.0.0.1:${8080 + i}/public_data`)).json();
    nodes.push({ account: `mpc-node-${i}.test.near`, data });
  }
  state.nodes = nodes.map((x) => ({ account: x.account, p2p: x.data.near_p2p_public_key, signer: x.data.near_signer_public_key }));
  saveState(state);
  for (const { account, data } of nodes) {
    await must(`${account} node keys`, account, account, [
      act.addFnKey(data.near_signer_public_key, MPC, []),
      ...data.near_responder_public_keys.map((k) => act.addFnKey(k, MPC, [])),
    ]);
  }
  const participants = nodes.map(({ account, data }, i) => [account, i, { tls_public_key: data.near_p2p_public_key, url: `https://localhost:${3000 + i}` }]);
  await must('init', MPC, MPC, [act.call('init', {
    parameters: { threshold: 2, participants: { next_id: n, participants } },
    tee_verifier_account_id: 'tee-verifier.test.near',
  })]);
  // Same domains as docs/development/localnet/args/add_domain.json in near/mpc 3.18.0.
  const domain = (id, curve, protocol, purpose) => ({ id, curve, protocol, reconstruction_threshold: 2, purpose });
  const domains = { domains: [
    domain(0, 'Secp256k1', 'CaitSith', 'Sign'), domain(1, 'Edwards25519', 'Frost', 'Sign'),
    domain(2, 'Bls12381', 'ConfidentialKeyDerivation', 'CKD'), domain(3, 'Secp256k1', 'CaitSith', 'ForeignTx'),
  ] };
  for (const { account } of nodes) await must(`${account} vote_add_domains`, account, MPC, [act.call('vote_add_domains', domains)]);
  console.log('waiting for the nodes to generate keys for 4 domains');
  for (let t = 0; ; t++) {
    const s = await view(MPC, 'state');
    const running = s?.Running;
    if (running && running.keyset?.domains?.length === 4) break;
    if (t % 10 === 0) console.log(`  state: ${Object.keys(s ?? {})[0]} ${JSON.stringify(s?.Initializing?.generated_keys?.length ?? running?.keyset?.domains?.length ?? '')}`);
    if (t > 300) throw new Error('key generation did not finish');
    await sleep(3000);
  }
  for (const { account } of nodes) {
    await must(`${account} vote Base providers`, account, MPC, [act.call('vote_update_foreign_chain_providers', { votes: BASE_WHITELIST() })]);
  }
  console.log('waiting for Base to become available');
  for (let t = 0; ; t++) {
    const a = await view(MPC, 'get_available_foreign_chains');
    if (JSON.stringify(a).includes('Base')) { console.log(`available: ${JSON.stringify(a)}`); break; }
    if (t > 100) throw new Error(`Base never became available: ${JSON.stringify(a)}`);
    await sleep(3000);
  }
  const keys = {};
  for (const d of [0, 1, 2, 3]) keys[d] = await view(MPC, 'public_key', { domain_id: d });
  state.domainKeys = keys;
  saveState(state);
  console.log(JSON.stringify(keys, null, 2));
} else {
  console.error('usage: bootstrap.mjs accounts <signer.wasm> | init <n>');
  process.exit(1);
}
