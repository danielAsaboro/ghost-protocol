# Verifier design

Direction: dark vault console, after the Dribbble shot "DeFi Investment Dashboard — Crypto Vaults & Web3 Platform UI" by Alamin Hossen. Layout and palette are adapted; no assets were copied.

| Token | Value | Use |
|---|---|---|
| `--bg` / `--panel` / `--panel-2` | #07090e / #0e121a / #131824 | page, panels, icon wells |
| `--line` / `--line-2` | #1d2331 / #262e3f | borders |
| `--violet` | #7557ff | primary actions, active tab, current lifecycle step |
| `--magenta` | #b4479a | glow only |
| `--mint` / `--red` / `--amber` | #3fe0a5 / #ff6b6b / #f2c14e | PASS / FAIL / WAIT only |

Surfaces: the window and every tile are translucent glass over the violet backdrop, `backdrop-filter: blur`, a soft top-lit white gradient and a 1px inner highlight. Buttons are a violet top-to-bottom gloss with an inner highlight.

Type: Inter for everything, JetBrains Mono only for hashes and addresses.

Layout, matching the reference: framed window on a violet backdrop; icon rail; top bar with title, network chip, plus button, primary action and identity chip; hero with identicon avatars in orbit; 2×2 stat tiles; a count with segmented tabs over scrolling cards with mint sparklines (log of real gas burned per transaction, the card's own point highlighted); feature card with avatar stack; closing band with two buttons and footer.

Rule: every number is recomputed from RPC. A check that cannot be confirmed yet is WAIT, never PASS.
