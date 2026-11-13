# GhostProtocol

After its owner dies, a vault pays the right heirs, and no single person, key, model or operator can change that.

A NEAR contract controls a Base Sepolia address through Chain Signatures. It pays listed heirs after a witnessed death claim. An AI may choose each amount, but only between owner-set limits, and if the AI never answers, a fallback pays anyway.

Tracks: Privacy & Private AI, AI Security & Defense. Testnet only.

Every claim below links to a model-checker result, a proof, a test, a transaction or a hash. What could not be proven is listed under [Not proven](#not-proven) and [Limits](#limits).

## Check it yourself

```bash
npm install && npm run test:live
```

Rechecks the deployed vault against the live chains. Or run the site with `npm run web` and open http://localhost:4173: the pages read NEAR testnet and Base Sepolia from your browser and replay every recorded transaction from its receipt. A failing claim shows as failed. A node that does not answer shows as waiting, never as passed. Every script, stylesheet and evidence file the pages load is pinned by hash ([sri.mjs](scripts/sri.mjs)).

## Two vaults

| | Deployed vault (v2) | v3 |
|---|---|---|
| Account | [`ghostprotocol-vault.testnet`](https://testnet.nearblocks.io/address/ghostprotocol-vault.testnet) | `ghostprotocol-v3.testnet` (V3_STATUS) |
| Code | `DBRswoeb9syKVRZJrCpjbw62E3Z6ZL48MAoLN8KfU4E8`, reproducible at `ba25e39` ([log](docs/evidence/live/clean-rebuild.txt)) | `Gakhf4AxBppPcnXEjpuBgKNPqWojwM4gabLeGrVuGWNm`, reproducible at `ceedcd4` ([log](docs/evidence/live/v3-reproducible-build.log)) |
| Keys | None: `view_access_key_list` returns `[]` after the [lock](https://testnet.nearblocks.io/txns/2AwB18KpkUaPoBAJhJUSVtyHDW5jPGJtZvCDBDn2pUAa) | V3_LOCK |
| Known bugs | The ten below. It can never be changed | Fixed; each is a regression test |

Base Sepolia address of the deployed vault: [`0xAf8105c7e876f38Bf0A9f09e4c97029BCf74d0Cc`](https://sepolia.basescan.org/address/0xAf8105c7e876f38Bf0A9f09e4c97029BCf74d0Cc).

## What is proven, and how

| Claim | Proof |
|---|---|
| The state machine keeps every invariant in the threat model | Quint model of the vault, its actors, Base (reverts, reorgs, finality, fees) and every dependency failure. v3: TLC finds no counterexample in any behaviour of up to 17 steps of a one-heir configuration (73 million distinct states), nor does simulation in 100,000 random traces of 40 steps with two heirs ([results](docs/evidence/spec/README.md)) |
| The Rust contract is the model | 600 model traces, 24,000 steps, replayed on the contract with identical state after every step ([itf_replay.rs](contract/src/itf_replay.rs)). A one-character bug fails the replay |
| Heirs are eventually paid, or reopened after a real revert, with no AI | TLC over the complete fair-world graph of a one-heir configuration, 1.2 million states, under stated fairness: signing failures, lost callbacks, reverts and settlement timeouts included ([log](docs/evidence/spec/tlc-v3-tiny-liveness.log)) |
| Arithmetic cannot overflow for any config the vault accepts; the fee rule only raises and can always reach the ceiling; the tip rises with the fee | Kani, all inputs ([results](docs/evidence/kani/README.md)) |
| Transactions and the settlement payload are encoded exactly | Kani proofs for RLP and the settlement payload; 1,500 viem vectors, alloy and `near/mpc` 3.18.0's own types ([diff](contract/diff)) |
| A missed check-in alone moves nothing; a check-in cancels a false claim | [refused claim](docs/evidence/live/false-claim.txt), [claim](https://testnet.nearblocks.io/txns/6TjeYW5JvMYY9DR2B4vvwBqVn15JaMk1QPR5K78KZFCc) then [check-in](https://testnet.nearblocks.io/txns/Dm1JPDN2js5FVp6phEZHzcczJDbyKHmuyCQUpAUU5VVw) |
| Hostile calls are refused by the contract itself | 13 attacks after the lock, each a real transaction carrying the contract's error ([log](docs/evidence/live/attacks-after-lock.txt)) |
| With no AI at all, a heir is still paid | [Fallback tx](https://testnet.nearblocks.io/txns/GH1TmBiumNAzJmVsdfmo4RPkxjWGtKqXrQKYzCFQedJV): real MPC signature, checked on-chain with `ecrecover` against the vault key |
| A stuck transaction is replaced, not abandoned | [Re-price tx](https://testnet.nearblocks.io/txns/niToN6tTZiQ7VcAG53xxCUggQ8gNHerUHPWQU8E12R1): same nonce, recipient and amount |
| A signature is not a payment | [Settle tx](https://testnet.nearblocks.io/txns/9EivMJaKZbAjB6yih8CA8YVsx6FENebo9Fu9vQ1o9wmh) on an unbroadcast transaction: no attestation, heir stays `Pending` |
| The real MPC code and a real chain run the whole lifecycle | `neard` 2.14.0, the signer's deployed 3.18.0 code and two real `mpc-node` 3.18.0 participants with their own key generation, plus anvil as Base: claim, cancel, real signatures, re-price, revert and reopen, reorg, real foreign-transaction settlement and CKD, then six dependency failures injected ([results](docs/evidence/localstack/README.md)) |
| A funded payout settles and the heir shows `Paid` | STEP8 |
| The wishes were sealed before any key existed | Encrypted to the vault's CKD identity from public values; the key came from the [vault's own request](https://testnet.nearblocks.io/txns/8Uw6tGnSf6G49MavWf3LZHKbZ128cVhGzCqSp3XKbuwx) after the trigger |
| No unaddressed advisory reaches the wasm | `cargo deny check` and `cargo audit` clean; two advisories reach only test builds and are named in [deny.toml](contract/deny.toml) ([logs](docs/evidence/supply-chain/)) |

## Bugs found in this pass

| # | Found by | Bug in the deployed vault | v3 |
|---|---|---|---|
| 1 | Model checker | The wishes key can be released, then the claim cancelled | Claim is permanent once the key is requested (I20) |
| 2 | Model checker, from step 1's gas finding | A sign callback that runs out of gas or storage strands that nonce and every later one, forever | Lease: a request without its callback is replaced after a day; a late callback is ignored, and anyone can submit the lost signature (I5, I19) |
| 3 | TLC | A disproved revert leaves committed value understated | Value counted again (I7) |
| 4 | Kani | A config the vault accepts can make every claim overflow and fail | Durations, witnesses, heirs, signers and budget bounded (I21) |
| 5 | TLC | Witnesses who sign a revert before Base finality can make a heir be paid twice | Procedure: [`witness-revert`](scripts/ghost.mjs) signs only once Base reports the revert final (D23) |
| 6 | Real MPC nodes | One MPC config vote raising the minimum gas above 150 Tgas stops every `sign` and `settle`, forever | Calls take a share of attached gas; survived a 500 Tgas minimum |
| 7 | Real MPC nodes | A re-price keeps the tip, so geth and reth mempools refuse it as a replacement | The tip rises with the fee cap |
| 8 | Real MPC nodes | A settle sent before Base finality is silently abandoned | The relayer settles only the attempt that is final on Base |
| 9 | Fresh-context agent | A lying quorum could overpay every heir at once; a stolen check-in key plus one missing witness blocks heirs forever; signer slots can be filled by replay; duplicate witness keys; a contest after grace pauses payouts | Retry waits a day after a reopen; a quorum override waits twice as long; see [the report](docs/evidence/outside/fresh-agent-report.md) |
| 10 | Liveness check | A lost request's signature can land, but the vault never stored it, so the heir stays `Pending` | Anyone can `submit_signature`; it is checked like the MPC callback |

Tests: [counterexamples.rs](contract/src/counterexamples.rs) and [outside_review.rs](contract/src/outside_review.rs); failing output on v2: [counterexamples-v2-failing.txt](docs/evidence/spec/counterexamples-v2-failing.txt); the reviewer's own tests against the earlier v3: [outside_attack_before_fix.rs](docs/evidence/outside/outside_attack_before_fix.rs).

## How it works

1. The owner checks in. Silence plus a 2-of-3 witness quorum opens a claim. One check-in during grace cancels it.
2. If the owner's check-in key is stolen, all witnesses together open an override claim that check-ins cannot cancel. Only the owner's cold recovery key can.
3. Any witness can extend grace once, for an owner in hospital. A court can pause once, for a bounded time.
4. The agent proposes an amount between each heir's floor and cap. The contract accepts it only with a response signed by a registered NEAR AI enclave key whose signed body names this vault, heir and amount.
5. The contract builds the Base Sepolia transaction, requests its signature, and keeps it only if it recovers to the vault key.
6. Anyone broadcasts. The heir is marked paid only when the MPC network's `verify_foreign_transaction` attests that the contract-computed transaction succeeded on a finalized Base Sepolia block.
7. After a long timeout, anyone can pay each heir its cap without the agent.
8. v3: if every witness key is lost, after an owner-chosen silence (years) a claim opens with no witnesses, and a living owner still cancels it.

Design, actors, 22 invariants and 24 dependencies over 20 years: [docs/threat-model.md](docs/threat-model.md). For an outside reviewer: [docs/review/one-page.md](docs/review/one-page.md).

## Tests

```bash
spec/gen-traces.sh && (cd contract && cargo test)
```

113 contract tests: unit, 256 random sequences against every invariant, the model and review counterexamples, and the trace replay. Needs `npm i -g @informalsystems/quint@0.33.1`.

```bash
npm test
```

18 JavaScript tests, plus the integrity-pin check, including the witness finality rule.

```bash
(cd contract && cargo kani --features kani-proofs)
```

```bash
spec/check.sh safety --step stepLive
```

Exhaustive TLC; `TINY=1` for the one-heir bound. CI for a clean runner, ready once the repo is public: [.github/workflows/ci.yml](.github/workflows/ci.yml).

## Not proven

- **A funded payout on Base Sepolia, settled by the testnet MPC network.** The deployed vault holds 0 ETH, so its signed payout cannot land. A watcher broadcasts and settles it the moment it is funded. The full path, including real settlement, ran on the local stack instead.
- **v3 on testnet.** It needs a new account, which only the human can create; until then v3 is proven on the local stack, in the model and in tests, not on testnet.
- **An attested NEAR AI decision accepted on-chain.** No API key was available, so the agent path is covered by unit tests with a locally generated key, and every live and local-stack payout used the no-AI fallback.
- **The wishes key inside an enclave.** It is unwrapped on the operator's machine.
- **Kani for the whole EIP-1559 encoding and for `parse_address`.** Those harnesses exceeded this machine's memory (CBMC above 6 GB). The RLP pieces they are built from are proved; the full encodings are covered by 1,500 viem vectors, alloy and 2.5 million fuzz runs.
- **Exhaustive model checking with two heirs, and liveness with contests and the freeze.** Both exceed this machine; the stated bounds above are what ran.
- **Mempool replacement on Base itself.** The tip fix follows geth's and reth's replacement rule from their source; the local stack ran anvil, not Base's node.
- **An outside human review.** The brief is ready ([one page](docs/review/one-page.md)); no objection is recorded yet ([record](docs/evidence/outside/reviewer-objections.md)).
- **CI on a clean public runner.** The workflow is ready and runs once the repository is public.
- **Comparison with probate law.** The RUFADAA and proof-of-death reading planned for this pass was cut.

## Limits

- The MPC network is trusted. On testnet, so is each of the 4 full-access keys on `v1.signer-prod.testnet`: one of them alone can replace the signer's code and request signatures as this vault (D24). Mainnet `v1.signer` has no keys.
- Heir addresses, amounts, age gates, the estate size and the owner's check-in pattern are public before anyone dies. No value can become a commitment without weakening the no-AI fallback ([privacy](docs/evidence/privacy/README.md)).
- A compromised model can always choose the cap. The bound is the floor and cap, not the model.
- The contract binds a decision to an enclave key, not to the prompt. The key's link to the enclave measurement is checked off-chain.
- A lying witness quorum can overpay one heir once. It is detected and further reopens stop.
- The vault cannot adapt if the signer changes its interface, drops Base, or Base Sepolia shuts down (D1, D6, D8, D17). Fixing that would need a key, and a key could redirect the money.
- Stealing both of the owner's keys is indistinguishable from being the owner.
- Not a legal will: there is no court process, death certificate or identity check.

## Libraries and AI use

`near-sdk`, `viem`, `@noble/curves`, `@noble/hashes`, `proptest`, `alloy`, `blstrs` and `near-mpc-contract-interface` (tests), Quint, TLC, Kani, Foundry, the `near` CLI. The code and documentation were written with Claude Code. MIT licensed.
