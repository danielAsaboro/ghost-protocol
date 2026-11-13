# What shows it is right, check by check

From the second deep pass brief. Each check has a recorded result or the reason it could not run.

| Check | Result | Evidence |
|---|---|---|
| Model checker: no safety counterexample, no liveness violation, at stated bounds | Safety: no violation in any behaviour of up to 17 steps of a one-heir configuration (81 million states), and none in 100,000 random two-heir traces of 40 steps. Liveness: holds on the complete fair-world graph of the one-heir no-AI path (1.2 million states). Ten counterexamples found on the way, each fixed or stated | [spec/README.md](spec/README.md) |
| Kani: proofs that pass, with stated bounds | 10 harnesses proved, including every arithmetic path in the contract; 1 failed on the deployed code and is proved on v3; 3 encoding harnesses exceeded memory, with their parts proved | [kani/README.md](kani/README.md) |
| Real `near/mpc` code as the oracle | Signatures, foreign-transaction attestations and CKD from two real `mpc-node` 3.18.0 participants running the signer's deployed code, accepted by the vault, on v2 and on the final v3 | [localstack/README.md](localstack/README.md) |
| Testnet: a funded payout attested by the MPC network, heir `Paid`, rechecked by the verifier | **Not yet.** The deployed vault's Base Sepolia address holds 0 ETH, so its signed payout cannot land. A watcher (`scripts/finish-payout.sh`) is running and will broadcast and settle when it is funded; the verifier shows the check as waiting until then. Funding needs the human | [live/finish-payout.log](live/finish-payout.log) |
| A clean CI runner producing the deployed WASM hash | **Not run.** The repository is private and may not be made public without the human. The workflow is ready; locally the deployed hash was reproduced from a clean clone, and the final v3 hash from its commit | [ci.yml](../../.github/workflows/ci.yml), [clean-rebuild.txt](live/clean-rebuild.txt), [v3-reproducible-build.log](live/v3-reproducible-build.log) |
| `cargo-deny` and `cargo-audit` with no unaddressed advisories | Clean for the WASM. Two advisories reach only native test builds and are ignored by ID with reasons; `wee_alloc` was removed from the WASM | [supply-chain/](supply-chain/), [deny.toml](../../contract/deny.toml) |
| A fresh-context agent that reads only the README, attacks the contract, files findings | Done: no theft path; 2 medium, 6 low, 2 info. All fixable ones fixed in v3 with regression tests; the rest are stated limits | [outside/fresh-agent-report.md](outside/fresh-agent-report.md) |
| One outside person, objections verbatim | **Not yet.** The one-page brief is ready; no outside person has reviewed it | [outside/reviewer-objections.md](outside/reviewer-objections.md), [one-page.md](../review/one-page.md) |

## Cut, and why

- **v3 on testnet**: needs a new account only the human can create. Keys and sealed wishes are prepared, so deploy and lock take minutes once it exists.
- **The RUFADAA and probate comparison and the QuadrigaCX filings**: cut for time; no claim in the README depends on them.
- **Commitments for heirs**: measured instead; no clear value can be committed without weakening the no-AI fallback ([privacy/README.md](privacy/README.md)).
- **A stateful `cargo-fuzz` target**: the existing 256-sequence proptest and the model's trace replay cover operation sequences; no new fuzz target was added.
