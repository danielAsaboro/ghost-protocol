# GhostProtocol

After its owner dies, a vault pays the right heirs, and no single person, key, model or operator can change that.

A NEAR contract controls a Base Sepolia address through Chain Signatures. It pays listed heirs after a witnessed death claim. An AI may choose each amount, but only between owner-set limits, and if the AI never answers, a fallback pays anyway.

Tracks: Privacy & Private AI, AI Security & Defense. Testnet only.

## Check it yourself

Run the site with `npm run web` and open http://localhost:4173.

- `index.html` is the landing page: what GhostProtocol does, who can't change the outcome, and live proof numbers.
- `app.html` is the app for the live test vault, with Overview, Heirs & payouts, Activity, Proofs and Verify views.

Both read NEAR testnet and Base Sepolia from your browser, recompute every claim below, and replay every recorded transaction from its receipt. A failing claim shows as failed. A node that does not answer shows as waiting, never as passed.

The same checks run from a terminal against the live chain:

```bash
npm install && npm run test:live
```

Live vault: [`ghostprotocol-vault.testnet`](https://testnet.nearblocks.io/address/ghostprotocol-vault.testnet). Its Base Sepolia address: [`0xAf8105c7e876f38Bf0A9f09e4c97029BCf74d0Cc`](https://sepolia.basescan.org/address/0xAf8105c7e876f38Bf0A9f09e4c97029BCf74d0Cc).

| Claim | Proof |
|---|---|
| The deployed code is this source | Chain code hash `DBRswoeb9syKVRZJrCpjbw62E3Z6ZL48MAoLN8KfU4E8` equals `cargo near build reproducible-wasm` at commit `ba25e39`, rebuilt from a clean clone ([log](docs/evidence/live/clean-rebuild.txt)) |
| Nobody holds a key to the vault | `view_access_key_list` returns `[]` after [lock tx](https://testnet.nearblocks.io/txns/2AwB18KpkUaPoBAJhJUSVtyHDW5jPGJtZvCDBDn2pUAa) |
| A missed check-in alone moves nothing | Live claim refused with `owner is not inactive` ([log](docs/evidence/live/false-claim.txt)) |
| The owner cancels a false claim | [claim](https://testnet.nearblocks.io/txns/6TjeYW5JvMYY9DR2B4vvwBqVn15JaMk1QPR5K78KZFCc), then [check-in](https://testnet.nearblocks.io/txns/Dm1JPDN2js5FVp6phEZHzcczJDbyKHmuyCQUpAUU5VVw) |
| A registrar proof cannot be replayed | Live `heir age already proven` |
| Hostile calls are refused by the contract itself | 13 attacks after the lock, each a real transaction whose receipt carries the contract's error: unlisted recipient, impostor agent, forged witnesses, faked MPC callbacks, a fee above the ceiling, a fee nudged to burn attempts, the owner cancelling after payout began ([record](web/evidence.json), [log](docs/evidence/live/attacks-after-lock.txt)). Five earlier attacks before payout began: over-cap, below floor, unlisted heir, non-agent, non-court freeze ([log](docs/evidence/live/false-claim.txt)) |
| With no AI at all, the heir is still paid | [Fallback tx](https://testnet.nearblocks.io/txns/GH1TmBiumNAzJmVsdfmo4RPkxjWGtKqXrQKYzCFQedJV): real MPC signature, checked on-chain with `ecrecover` against the vault key |
| A stuck transaction is replaced, not abandoned | [Re-price tx](https://testnet.nearblocks.io/txns/niToN6tTZiQ7VcAG53xxCUggQ8gNHerUHPWQU8E12R1): attempt 2 has the same nonce, recipient and amount, so only one can land |
| A signature is not a payment | [Settle tx](https://testnet.nearblocks.io/txns/9EivMJaKZbAjB6yih8CA8YVsx6FENebo9Fu9vQ1o9wmh) on an unbroadcast transaction: the MPC network declined to attest, and the heir stays `Pending` |
| The wishes were sealed before any key existed | Encrypted to the vault's CKD identity using public values only. The key came from the [vault's own request](https://testnet.nearblocks.io/txns/8Uw6tGnSf6G49MavWf3LZHKbZ128cVhGzCqSp3XKbuwx) after the trigger, and passed a pairing check before decrypting |

## How it works

1. The owner checks in. Silence plus a 2-of-3 witness quorum opens a claim. One check-in during grace cancels it.
2. If the owner's check-in key is stolen, all witnesses together open an override claim that check-ins cannot cancel. Only the owner's cold recovery key can.
3. Any witness can extend grace once, for an owner in hospital. A court can pause once, for a bounded time.
4. The agent proposes an amount between each heir's floor and cap. The contract accepts it only with a response signed by a registered NEAR AI enclave key, whose signed body names this vault, heir and amount.
5. The contract builds the Base Sepolia transaction itself, requests its signature, and keeps it only if it recovers to the vault key.
6. Anyone broadcasts. The heir is marked paid only when the MPC network's `verify_foreign_transaction` attests that the contract-computed transaction succeeded on a finalized Base Sepolia block.
7. After a long timeout, anyone can pay each heir its cap without the agent.

Why Base Sepolia: the testnet signer's `verify_foreign_transaction` supports `Base`, pinned to chain ID 84532, but not `Ethereum` ([sources](docs/threat-model.md#sources-checked)).

Full design and invariants: [docs/threat-model.md](docs/threat-model.md).

## Tests

```bash
npm install
```

```bash
npm test
```

17 JavaScript tests pass, including the CKD sealing round trip.

```bash
npm run test:live
```

3 tests recheck the deployed vault on real testnet: every check passes, and the verifier reports FAIL when given a wrong build hash or a false attack record.

```bash
cd contract && cargo test
```

83 contract tests pass, including 256 random sequences of every method checked against the invariants after each step.

| Layer | What it shows |
|---|---|
| `contract/diff` | Encoding agrees with alloy and 1,500 viem vectors. The settlement payload agrees with `near/mpc` 3.18.0's own types. Hash-to-curve agrees with `blstrs` |
| `cargo mutants` | 167 of 167 viable mutants caught |
| `cargo fuzz` | Parsers and RLP, about 2.5M runs, no crashes |
| `docs/evidence/v1/` | The original contract's ten breaks, each shown failing before the fix |

## Not proven yet

- A funded Base Sepolia payout and its MPC settlement. The verifier shows these as WAIT until they happen.
- An attested decision from NEAR AI accepted on-chain. Unit tests cover the check with a locally generated secp256k1 key.
- The wishes key is unwrapped on the operator's machine, not inside an attested enclave.
- A live injection evaluation. A hostile-model set is scored by the contract: it rejects every out-of-bounds decision and accepts the cap, which is the limit a compromised model always has.

## Limits

- A compromised model can always choose the cap. The bound is the floor and cap, not the model.
- The contract binds a decision to an enclave key, not to the prompt. Anyone with an API key can get a genuine signature on a crafted response.
- The link between that key and the enclave measurement is checked off-chain.
- The MPC network cannot attest a failed transaction. A witness quorum reopens a reverted payment once per heir, and a lying quorum can overpay that heir once.
- Stealing both of the owner's keys is indistinguishable from being the owner.
- The MPC network itself is trusted.
- This is not a legal will.

## Run it on testnet

[docs/live-runbook.md](docs/live-runbook.md).

## Libraries and AI use

`near-sdk`, `viem`, `@noble/curves`, `@noble/hashes`, `proptest`, `alloy`, `blstrs` and `near-mpc-contract-interface` (tests), and the `near` CLI. The code and documentation were written with Claude Code. MIT licensed.
