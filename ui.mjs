// Small rendering helpers shared by the landing page and the app.
export const VAULT = 'ghostprotocol-vault.testnet';
export const REPO = 'https://github.com/danielAsaboro/ghost-protocol';
// Hash of `cargo near build reproducible-wasm` at COMMIT. Both are checked against the chain, never trusted.
export const WASM_HASH = 'DBRswoeb9syKVRZJrCpjbw62E3Z6ZL48MAoLN8KfU4E8';
export const COMMIT = 'ba25e39';

export const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
export const short = (h, a = 6, b = 4) => (h && h.length > a + b + 1 ? `${h.slice(0, a)}…${h.slice(-b)}` : h);
export const eth = (wei) => `${(Number(BigInt(wei)) / 1e18).toLocaleString('en-US', { maximumFractionDigits: 6 })} ETH`;
export const ago = (secs) => {
  const d = Math.max(0, Math.floor(Date.now() / 1000) - secs);
  if (d < 3600) return `${Math.max(1, Math.floor(d / 60))} min ago`;
  if (d < 86400) return `${Math.floor(d / 3600)} h ago`;
  return `${Math.floor(d / 86400)} d ago`;
};
export const when = (iso) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
export const markSvg = '<svg viewBox="0 0 24 24" fill="#fff"><path d="M12 3a7 7 0 0 0-7 7v10.2c0 .7.8 1 1.3.6l1.5-1.2 1.6 1.3c.4.3.9.3 1.3 0L12 19.6l1.3 1.3c.4.3.9.3 1.3 0l1.6-1.3 1.5 1.2c.5.4 1.3.1 1.3-.6V10a7 7 0 0 0-7-7m-2.5 6.2a1.3 1.3 0 1 1 0 2.6 1.3 1.3 0 0 1 0-2.6m5 0a1.3 1.3 0 1 1 0 2.6 1.3 1.3 0 0 1 0-2.6"/></svg>';

/** A 5×5 mirrored pattern derived from an account name or address, used as its avatar. */
export function identicon(seed) {
  let h = 2166136261;
  for (const c of String(seed)) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  const next = () => (h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0);
  const hue = next() % 360;
  let cells = '';
  for (let y = 0; y < 5; y++) for (let x = 0; x < 3; x++) if (next() % 2) {
    cells += `<rect x="${x}" y="${y}" width="1" height="1"/>`;
    if (x < 2) cells += `<rect x="${4 - x}" y="${y}" width="1" height="1"/>`;
  }
  return `<svg viewBox="-1 -1 7 7" shape-rendering="crispEdges" aria-hidden="true"><rect x="-1" y="-1" width="7" height="7" fill="hsl(${(hue + 30) % 360} 40% 92%)"/><g fill="hsl(${hue} 55% 50%)">${cells}</g></svg>`;
}

export const avatar = (seed, size = 28) => `<span class="av" style="width:${size}px;height:${size}px" title="${esc(seed)}">${identicon(seed)}</span>`;

/** Smooth line with a soft fill; `at` marks one point with a band and a dot. */
export function spark(values, at, { w = 240, h = 64 } = {}) {
  const v = values.map((x) => Math.log1p(x * 4));
  const n = v.length, max = Math.max(...v), min = Math.min(...v), pad = 6;
  const pts = v.map((y, i) => [(i / Math.max(1, n - 1)) * w, h - pad - ((y - min) / (max - min || 1)) * (h - pad * 2 - 6)]);
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 1; i < n; i++) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i], cx = (x0 + x1) / 2; d += ` C${cx},${y0} ${cx},${y1} ${x1},${y1}`; }
  const id = `s${Math.random().toString(36).slice(2, 8)}`;
  const band = w / Math.max(1, n - 1);
  const mark = at === undefined ? '' : `<rect x="${Math.max(0, pts[at][0] - band / 2)}" y="0" width="${band}" height="${h}" fill="url(#${id}b)"/><circle cx="${pts[at][0]}" cy="${pts[at][1]}" r="3.5" fill="#3fe0a5" stroke="#11151f" stroke-width="1.5"/>`;
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" width="100%" height="${h}" aria-hidden="true">
    <defs><linearGradient id="${id}f" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3fe0a5" stop-opacity=".22"/><stop offset="1" stop-color="#3fe0a5" stop-opacity="0"/></linearGradient>
    <linearGradient id="${id}b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3fe0a5" stop-opacity=".25"/><stop offset="1" stop-color="#3fe0a5" stop-opacity=".02"/></linearGradient></defs>
    <path d="${d} L${w},${h} L0,${h} Z" fill="url(#${id}f)"/>${mark}
    <path d="${d}" fill="none" stroke="#3fe0a5" stroke-width="1.6" vector-effect="non-scaling-stroke"/></svg>`;
}

/** Where the vault is in its life, from on-chain state. */
export function stages(r) {
  const s = r.state, c = s.claim, p = s.payouts[0], now = Math.floor(Date.now() / 1000);
  const locked = r.checks.find((x) => x.id === 'no-keys')?.verdict === 'PASS';
  const paid = s.heirs.every((h) => h.status === 'Paid');
  const list = [
    { title: 'Sealed', doing: 'Sealing the wishes', note: 'Wishes encrypted to a key no one holds', done: true },
    { title: 'Locked', doing: 'Not locked yet', note: locked ? 'No one holds a key to the vault' : 'Keys still present', done: locked },
    { title: 'Claimed', doing: 'Owner is alive', note: c ? `Witnesses confirmed a death, ${ago(c.opened_at)}` : 'The owner keeps checking in', done: Boolean(c) },
    { title: 'Grace', doing: 'Grace period', note: c ? (now < c.pay_after ? `${c.pay_after - now}s left for the owner to cancel` : 'Over, the owner did not cancel') : 'Not started', done: Boolean(c) && now >= c.pay_after },
    { title: 'Paying', doing: 'Ready to pay', note: p ? `Payment signed by the MPC network, ${p.attempts.filter((a) => a.r_hex).length} attempts` : 'Waiting for the agent or the fallback', done: Boolean(p) },
    { title: 'Settled', doing: 'Payment signed, not yet landed', note: paid ? 'Every heir paid and confirmed' : 'The vault needs Base Sepolia ETH before the signed payment can land', done: paid },
  ];
  const current = list.findIndex((x) => !x.done);
  return { list, current: current < 0 ? list.length - 1 : current };
}

export const tally = (r) => {
  const all = [...r.checks, ...r.events];
  const fail = all.filter((x) => x.verdict === 'FAIL').length, wait = all.filter((x) => x.verdict === 'WAIT').length;
  const refused = r.events.filter((e) => e.expect === 'fail');
  return { total: all.length, pass: all.length - fail - wait, fail, wait, refused: refused.length, refusedOk: refused.filter((e) => e.verdict === 'PASS').length };
};

export async function loadEvidence() {
  try {
    const res = await fetch('evidence.json');
    return res.ok ? await res.json() : { events: [], settle: {} };
  } catch {
    return { events: [], settle: {} };
  }
}
