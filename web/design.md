# Verifier design

Feel: probate register, quiet, exact.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | #f4f5f2 | #0f1412 | page |
| `--sheet` | #ffffff | #161d1a | ledgers, panels |
| `--ink` | #18211d | #e3eae6 | text |
| `--accent` | #24584a | #86c4b0 | links, current lifecycle step, Recheck. Never a status |
| `--pass` / `--fail` / `--wait` | green / red / amber | lighter | verdicts only |

Type: IBM Plex Serif for the one headline, Plex Sans for text, Plex Mono only for hashes, addresses and verdicts.

Layout: one 920px column. Lifecycle strip, vault facts, proof ledger, on-chain record, terminal recheck. Rows are ruled, not carded.

Rules: every number on the page is recomputed from RPC; nothing is hard-coded except the published build hash and commit. A check that cannot be confirmed yet is WAIT, never PASS.
