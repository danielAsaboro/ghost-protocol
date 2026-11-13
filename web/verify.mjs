// Recomputes every GhostProtocol claim from public RPC answers. Used by the web verifier and by `npm run test:live`.
import { getAddress, keccak256, recoverAddress, serializeTransaction } from 'viem';

export const NEAR_RPC = 'https://rpc.testnet.near.org';
const NEAR_RPCS = [NEAR_RPC, 'https://test.rpc.fastnear.com'];
const BASE_RPCS = ['https://base-sepolia-rpc.publicnode.com', 'https://sepolia.base.org'];
// Transactions older than a few epochs live only on archival nodes.
export const ARCHIVAL_RPC = ['https://archival-rpc.testnet.near.org', 'https://archival-rpc.testnet.fastnear.com'];
export const BASE_RPC = 'https://base-sepolia-rpc.publicnode.com';
export const SIGNER = 'v1.signer-prod.testnet';
export const PATH = 'ghost-base-sepolia-1';
export const BASE_SEPOLIA = 84532;
const HALF_N = 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0n;
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export const hex = (b) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
export const unhex = (h) => Uint8Array.from(h.match(/../g) ?? [], (x) => parseInt(x, 16));
const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const text = (bytes) => new TextDecoder().decode(bytes);

export function b58encode(bytes) {
  let n = BigInt(`0x${hex(bytes) || '0'}`);
  let out = '';
  while (n > 0n) {
    out = B58[Number(n % 58n)] + out;
    n /= 58n;
  }
  return out;
}

export function b58decode(s, length) {
  let n = 0n;
  for (const c of s) {
    const d = B58.indexOf(c);
    if (d < 0) throw new Error('invalid base58');
    n = n * 58n + BigInt(d);
  }
  return unhex(n.toString(16).padStart(length * 2, '0'));
}

export const sha256 = async (bytes) => new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
export const addressOf = (pubHex) => getAddress(`0x${keccak256(`0x${pubHex}`).slice(-40)}`);

/** Borsh of the MPC request `V1 { Base { tx_id, [], Finalized }, [] }`, pinned to near/mpc 3.18.0. */
export function foreignPayload(txId) {
  const out = new Uint8Array(43);
  out[1] = 6;
  out.set(txId, 2);
  out[38] = 2;
  return out;
}

// Transaction receipts never change, so a session can keep them.
const cache = {
  get(hash) {
    try { const v = globalThis.sessionStorage?.getItem(`tx:${hash}`); return v ? JSON.parse(v) : null; } catch { return null; }
  },
  set(hash, value) {
    try { globalThis.sessionStorage?.setItem(`tx:${hash}`, JSON.stringify(value)); } catch { /* storage full or blocked */ }
  },
};

async function mapLimited(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }));
  return out;
}

export function makeRpc(fetchImpl = fetch) {
  const post = async (url, body) => (await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
  // Tries each provider, then backs off and tries again. Public RPCs rate-limit bursts.
  const any = async (urls, body, ok) => {
    let last;
    for (let attempt = 0; attempt < 3; attempt++) {
      for (const url of urls) {
        try {
          const j = await post(url, body);
          if (ok(j)) return j;
          last = j.error ?? j.result?.error;
        } catch (e) {
          last = e.message;
        }
      }
      await new Promise((r) => setTimeout(r, 400 * 2 ** attempt));
    }
    throw new Error(`RPC unreachable: ${JSON.stringify(last)}`);
  };
  const near = async (params) => (await any(NEAR_RPCS, { jsonrpc: '2.0', id: 1, method: 'query', params: { finality: 'final', ...params } },
    (j) => j.result && !j.result.error)).result;
  return {
    near,
    view: async (account, method, args = {}) => JSON.parse(text(Uint8Array.from((await near({
      request_type: 'call_function', account_id: account, method_name: method, args_base64: btoa(JSON.stringify(args)),
    })).result))),
    tx: async (hash, sender) => {
      const cached = cache.get(hash);
      if (cached) return cached;
      let last;
      for (let attempt = 0; attempt < 4; attempt++) {
        for (const url of ARCHIVAL_RPC) {
          try {
            const j = await post(url, { jsonrpc: '2.0', id: 1, method: 'tx', params: { tx_hash: hash, sender_account_id: sender, wait_until: 'NONE' } });
            if (j.result?.transaction) {
              cache.set(hash, j.result);
              return j.result;
            }
            last = j.error?.data ?? j.error;
          } catch (e) {
            last = e.message;
          }
        }
        await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
      }
      const err = new Error(`could not reach an archival node for ${hash}: ${JSON.stringify(last)}`);
      err.unreachable = true;
      throw err;
    },
    base: async (method, params) => (await any(BASE_RPCS, { jsonrpc: '2.0', id: 1, method, params }, (j) => 'result' in j)).result,
  };
}

/** Reduces a NEAR transaction result to what happened: success with a return value, or the contract's own error. */
export function outcome(result) {
  const describe = (f) => {
    const call = f?.ActionError?.kind?.FunctionCallError;
    if (call?.ExecutionError) return call.ExecutionError.replace(/^Smart contract panicked: /, '');
    return JSON.stringify(f);
  };
  if (result.status?.Failure) return { ok: false, error: describe(result.status.Failure) };
  const raw = result.status?.SuccessValue;
  let value = null;
  if (raw) {
    try { value = JSON.parse(text(b64(raw))); } catch { value = text(b64(raw)); }
  }
  return { ok: true, value };
}

function actionName(transaction) {
  const a = transaction.actions[0];
  if (typeof a === 'string') return a;
  if (a.FunctionCall) return a.FunctionCall.method_name;
  if (a.DeployContract) return transaction.actions.length > 1 ? 'new' : 'deploy';
  if (a.DeleteKey) return 'delete_key';
  return Object.keys(a)[0];
}

const check = (group, id, verdict, claim, detail) => ({ group, id, verdict, claim, detail });

/**
 * Returns { state, vaultAddress, balance, checks, events }.
 * Every verdict is PASS, FAIL or WAIT, and every input comes from public RPC.
 */
export async function verifyVault({ vault, evidence = { events: [], settle: {} }, reproducibleHash = null, rpc = makeRpc() }) {
  const checks = [];
  const [account, code, keys, state] = await Promise.all([
    rpc.near({ request_type: 'view_account', account_id: vault }),
    rpc.near({ request_type: 'view_code', account_id: vault }),
    rpc.near({ request_type: 'view_access_key_list', account_id: vault }),
    rpc.view(vault, 'get_state'),
  ]);

  const codeHash = b58encode(await sha256(b64(code.code_base64)));
  checks.push(check('Code', 'code-hash', codeHash === account.code_hash ? 'PASS' : 'FAIL',
    'The deployed WASM hashes to the code hash the chain reports', `sha256 ${codeHash}`));
  if (reproducibleHash) {
    checks.push(check('Code', 'reproducible', codeHash === reproducibleHash ? 'PASS' : 'FAIL',
      'It equals the reproducible build of the published source', `cargo near build reproducible-wasm → ${reproducibleHash}`));
  }

  const full = keys.keys.filter((k) => k.access_key.permission === 'FullAccess');
  checks.push(check('Custody', 'no-keys', full.length === 0 ? 'PASS' : 'FAIL',
    'No one holds a key to the vault account, so only its code can ask for signatures',
    full.length ? `${full.length} full-access key(s) remain` : `${keys.keys.length} access keys`));

  const derived = await rpc.view(SIGNER, 'derived_public_key', { path: PATH, predecessor: vault, domain_id: 0 });
  const derivedHex = hex(b58decode(derived.split(':')[1], 64));
  const vaultAddress = addressOf(derivedHex);
  checks.push(check('Custody', 'vault-key', derivedHex === state.vault_public_key ? 'PASS' : 'FAIL',
    'The key the contract checks signatures against is the one the MPC network derives for this vault', vaultAddress));

  const rootKey = await rpc.view(SIGNER, 'public_key', { domain_id: 3 });
  const rootHex = hex(b58decode(rootKey.split(':')[1], 64));
  const rootAddress = addressOf(rootHex);
  checks.push(check('Custody', 'foreign-key', rootHex === state.foreign_tx_public_key ? 'PASS' : 'FAIL',
    'Payments are confirmed only by the MPC network’s foreign-transaction key', `domain 3 · ${rootAddress}`));

  const caps = state.heirs.reduce((t, h) => t + BigInt(h.cap_wei), 0n);
  const floorsOk = state.heirs.every((h) => BigInt(h.floor_wei) > 0n && BigInt(h.floor_wei) <= BigInt(h.cap_wei));
  checks.push(check('Rules', 'bounds', state.chain_id === BASE_SEPOLIA && floorsOk && caps <= BigInt(state.budget_wei) ? 'PASS' : 'FAIL',
    'Every heir has a floor and a cap, on Base Sepolia, inside the budget',
    `chain ${state.chain_id} · ${state.heirs.length} heir(s) · caps ${caps} ≤ budget ${state.budget_wei} wei`));
  const delays = Math.max(state.override_grace_secs, state.grace_secs) + state.contest_secs * 3 + state.freeze_max_secs;
  checks.push(check('Rules', 'fallback', state.fallback_secs > delays ? 'PASS' : 'FAIL',
    'A no-AI fallback opens after every delay has run out', `fallback ${state.fallback_secs}s > delays ${delays}s`));

  const balance = BigInt((await rpc.base('eth_getBalance', [vaultAddress, 'latest'])) ?? '0x0');
  checks.push(check('Payout', 'funded', balance > 0n ? 'PASS' : 'WAIT', 'The vault address holds funds on Base Sepolia', `${balance} wei`));

  const payouts = [];
  for (const [i, p] of state.payouts.entries()) {
    const heir = state.heirs[p.heir_index];
    const attempts = [];
    for (const [j, a] of p.attempts.entries()) {
      const item = { index: j, fee: a.max_fee_per_gas, signed: Boolean(a.r_hex) };
      if (a.r_hex) {
        const tx = { type: 'eip1559', chainId: BASE_SEPOLIA, nonce: Number(p.nonce), to: getAddress(p.to), value: BigInt(p.value_wei),
          gas: BigInt(p.gas_limit), maxFeePerGas: BigInt(a.max_fee_per_gas), maxPriorityFeePerGas: BigInt(a.max_priority_fee_per_gas) };
        const hash = keccak256(serializeTransaction(tx));
        const sig = { r: `0x${a.r_hex}`, s: `0x${a.s_hex}`, yParity: a.y_parity };
        const recovered = await recoverAddress({ hash, signature: sig });
        const txHash = keccak256(serializeTransaction(tx, sig));
        item.recovered = recovered;
        item.txHash = txHash;
        const ok = hash.slice(2) === a.payload_hex && recovered === vaultAddress && BigInt(sig.s) <= HALF_N && txHash.slice(2) === a.tx_hash_hex;
        checks.push(check('Payout', `sig-${i}-${j}`, ok ? 'PASS' : 'FAIL',
          `Payout ${i + 1}, attempt ${j + 1}: the MPC signature recovers to the vault and covers exactly this transfer`,
          `${p.value_wei} wei to ${p.to} · nonce ${p.nonce} · fee ${a.max_fee_per_gas}`));
        const receipt = await rpc.base('eth_getTransactionReceipt', [txHash]);
        item.landed = receipt ? receipt.status === '0x1' : null;
        checks.push(check('Payout', `landed-${i}-${j}`, !receipt ? 'WAIT' : item.landed && getAddress(receipt.from) === vaultAddress ? 'PASS' : 'FAIL',
          `Payout ${i + 1}, attempt ${j + 1}: included on Base Sepolia`, receipt ? `block ${parseInt(receipt.blockNumber, 16)} · status ${receipt.status}` : `${txHash} not mined`));
      }
      attempts.push(item);
    }
    const nonces = new Set(p.attempts.map(() => p.nonce));
    if (p.attempts.length > 1) {
      checks.push(check('Payout', `one-nonce-${i}`, nonces.size === 1 ? 'PASS' : 'FAIL',
        `Payout ${i + 1}: every re-signed attempt reuses nonce ${p.nonce}, so at most one can land`, `${p.attempts.length} attempts`));
    }
    const key = `${i}:${p.settled_attempt}`;
    if (p.status === 'Settled') {
      const settleTx = evidence.settle?.[key];
      if (!settleTx) {
        checks.push(check('Payout', `settled-${i}`, 'FAIL', `Payout ${i + 1}: MPC attestation`, 'settled on-chain, but its settlement transaction is not listed'));
      } else {
        const result = await rpc.tx(settleTx.tx, settleTx.sender);
        const reply = result.receipts_outcome.map((r) => r.outcome).find((o) => o.executor_id === SIGNER && o.status.SuccessValue);
        const att = reply ? JSON.parse(text(b64(reply.status.SuccessValue))) : null;
        const expected = hex(await sha256(foreignPayload(unhex(p.attempts[p.settled_attempt].tx_hash_hex))));
        let signer = null;
        if (att?.signature) {
          const s = att.signature;
          signer = await recoverAddress({ hash: `0x${att.payload_hash}`, signature: { r: `0x${s.big_r.affine_point.slice(2)}`, s: `0x${s.s.scalar}`, yParity: s.recovery_id } });
        }
        checks.push(check('Payout', `settled-${i}`, att?.payload_hash === expected && signer === rootAddress ? 'PASS' : 'FAIL',
          `Payout ${i + 1}: the MPC network attested that this exact transaction succeeded`, `payload ${expected.slice(0, 16)}… · signer ${signer}`));
      }
    } else {
      checks.push(check('Payout', `settled-${i}`, 'WAIT', `Payout ${i + 1}: the MPC network attests the payment landed`, `heir ${heir.status}`));
    }
    payouts.push({ index: i, heir: p.heir_index, to: p.to, value: p.value_wei, nonce: p.nonce, source: p.source, status: p.status, attempts });
  }

  if (evidence.integrity === false) {
    checks.push(check('Code', 'evidence-pin', 'FAIL', 'The evidence file matches the hash pinned in the page', 'evidence.json was changed after it was pinned'));
  }
  const events = await mapLimited(evidence.events ?? [], 4, async (e) => {
    try {
      const result = await rpc.tx(e.tx, e.sender);
      const o = outcome(result);
      const method = actionName(result.transaction);
      const receiverOk = result.transaction.receiver_id === vault;
      const matches = e.expect === 'ok' ? o.ok : !o.ok && (!e.error || o.error.includes(e.error));
      const gas = [result.transaction_outcome, ...result.receipts_outcome].reduce((t, r) => t + Number(r.outcome.gas_burnt), 0);
      return { ...e, verdict: matches && receiverOk && method === e.method ? 'PASS' : 'FAIL', observed: o.ok ? 'succeeded' : o.error, tgas: gas / 1e12 };
    } catch (err) {
      // A node that does not answer proves nothing either way.
      return { ...e, verdict: err.unreachable ? 'WAIT' : 'FAIL', observed: err.message };
    }
  });
  const refused = events.filter((e) => e.expect === 'fail');
  if (refused.length) {
    checks.push(check('Attacks', 'attacks', refused.every((e) => e.verdict === 'PASS') ? 'PASS' : 'FAIL',
      'Every recorded attack was refused on-chain with the expected error', `${refused.filter((e) => e.verdict === 'PASS').length} of ${refused.length} refusals rechecked from receipts`));
  }

  return { state, vaultAddress, balance, codeHash, checks, events, payouts };
}
