# Verifier design

Direction: dark vault console, after the Dribbble shot "DeFi Investment Dashboard — Crypto Vaults & Web3 Platform UI" by Alamin Hossen. Layout and palette are adapted; no assets were copied.

| Token | Value | Use |
|---|---|---|
| `--bg` / `--panel` / `--panel-2` | #07090e / #0e121a / #131824 | page, panels, icon wells |
| `--line` / `--line-2` | #1d2331 / #262e3f | borders |
| `--violet` | #7557ff | primary actions, active tab, current lifecycle step |
| `--magenta` | #b4479a | glow only |
| `--mint` / `--red` / `--amber` | #3fe0a5 / #ff6b6b / #f2c14e | PASS / FAIL / WAIT only |

Type: Inter for everything, JetBrains Mono only for hashes and addresses.

Layout: icon rail; hero with the vault's actors in orbit; 2×2 stat tiles; lifecycle cards; tabbed evidence (proofs, on-chain record, heirs and payouts); recheck panel with copyable commands.

Rule: every number is recomputed from RPC. A check that cannot be confirmed yet is WAIT, never PASS.
