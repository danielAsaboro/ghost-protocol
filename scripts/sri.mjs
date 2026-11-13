// Pins every file the verifier pages load with Subresource Integrity, so a host or CDN cannot
// swap the code that checks the claims. Chain: page -> import map integrity (verify.mjs, ui.mjs,
// vendored viem) and link integrity (styles, fonts.css) -> ui.mjs pins evidence.json by hash.
// Fonts are same-origin files listed with their hashes in web/vendor/MANIFEST.json.
//   node scripts/sri.mjs          rewrite the pins after editing anything under web/
//   node scripts/sri.mjs --check  exit 1 if any pin is stale (CI and npm test)
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const WEB = new URL('../web/', import.meta.url).pathname;
const VIEM = 'vendor/viem-2.57.17.mjs';
const check = process.argv.includes('--check');
const sri = (path) => `sha384-${createHash('sha384').update(readFileSync(join(WEB, path))).digest('base64')}`;
let stale = [];

function write(path, next) {
  let current = null;
  try { current = readFileSync(join(WEB, path), 'utf8'); } catch {}
  if (current === next) return;
  if (check) stale.push(path);
  else writeFileSync(join(WEB, path), next);
}

// 1. evidence.json is pinned inside ui.mjs.
const ui = readFileSync(join(WEB, 'ui.mjs'), 'utf8');
const uiNext = ui.replace(/export const EVIDENCE_SRI = '[^']*';/, `export const EVIDENCE_SRI = '${sri('evidence.json')}';`);
if (!uiNext.includes('EVIDENCE_SRI')) throw new Error('ui.mjs must declare EVIDENCE_SRI');
write('ui.mjs', uiNext);
// In check mode, hash what the file should be, so one stale pin is reported once.
const uiHash = `sha384-${createHash('sha384').update(uiNext).digest('base64')}`;

// 2. Fonts manifest.
const fonts = Object.fromEntries(
  readdirSync(join(WEB, 'vendor/fonts')).sort().map((f) => [`vendor/fonts/${f}`, sri(`vendor/fonts/${f}`)]),
);
write('vendor/MANIFEST.json', `${JSON.stringify({ [VIEM]: sri(VIEM), 'vendor/fonts.css': sri('vendor/fonts.css'), ...fonts }, null, 2)}\n`);

// 3. Page heads.
const map = {
  imports: { viem: `./${VIEM}` },
  integrity: { [`./${VIEM}`]: sri(VIEM), './verify.mjs': sri('verify.mjs'), './ui.mjs': uiHash },
};
const head = [
  `<link rel="stylesheet" href="vendor/fonts.css" integrity="${sri('vendor/fonts.css')}">`,
  `<link rel="stylesheet" href="styles.css" integrity="${sri('styles.css')}">`,
  `<script type="importmap">${JSON.stringify(map)}</script>`,
].join('\n');
for (const page of ['index.html', 'app.html']) {
  const html = readFileSync(join(WEB, page), 'utf8');
  const start = html.indexOf('<!-- pinned -->');
  const end = html.indexOf('<!-- /pinned -->');
  if (start < 0 || end < 0) throw new Error(`${page} needs <!-- pinned --> ... <!-- /pinned --> around its head links`);
  write(page, `${html.slice(0, start)}<!-- pinned -->\n${head}\n${html.slice(end)}`);
}

if (stale.length) {
  console.error(`stale integrity pins: ${stale.join(', ')}. Run node scripts/sri.mjs`);
  process.exit(1);
}
console.log(check ? 'integrity pins current' : 'integrity pins written');
