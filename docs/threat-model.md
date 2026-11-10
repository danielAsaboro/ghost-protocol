# Threat model

Claim under test: **after its owner dies, a vault pays the right heirs, and no single person, key, model or operator can change that.**

Every code change traces to an invariant below. Each invariant is a sentence a test or the chain can falsify.

## Sources checked

| Source | Version | What it settled |
|---|---|---|
| `near/mpc` `crates/near-mpc-contract-interface/src/types/foreign_chain.rs` | tag `3.18.0` | Request layout, `Base` is enum index 6, payload hash is `sha256(borsh(ForeignTxSignPayload))` |
| `near/mpc` `crates/foreign-chain-inspector/src/evm/inspector.rs` | tag `3.18.0` | Nodes sign only for a canonical block with receipt status 1. A revert yields `Verdict::TransactionFailed` and no signature |
| `near/mpc` `crates/node-config/foreign_chains/testnet.toml` | tag `3.18.0` | Testnet `base` is pinned to `expected_network_fingerprint = "84532"` (Base Sepolia) |
| `near/mpc` `crates/contract/src/api/ckd.rs`, `primitives/ckd.rs` | tag `3.18.0` | CKD key depends only on caller, path and domain. `app_public_key` only encrypts the reply |
| `v1.signer-prod.testnet` over RPC, 2026-11-09 | `version` = `3.18.0`, code hash `CpGX8ywXJwvWPgZFDDCTCuPJBHF7BATT51gSfc3APERJ` | Domains 0 Sign, 2 CKD, 3 ForeignTx. `allowed_foreign_chain_providers.Base` lists only `base-sepolia` hosts, quorum 2. `Ethereum` is not available |
| `nearai/nearai-cloud-verifier` `py/chat_verifier.py`, `py/model_verifier.py` | main, 2026-11-09 | Signed text is `request_sha256:response_sha256` (optionally prefixed), EIP-191, by `signing_address`. TDX `report_data[0..32]` binds that address |
| Zodiac `Delay.sol` | main, 2026-11-09 | Cooldown plus expiry, anyone executes, owner vetoes by moving a nonce. Adopted: anyone can execute after the delay |
| Sarcophagus v2 `ThirdPartyFacet.sol` | main, 2026-11-09 | Grace after a deadline, third-party accusation. Adopted: a bounded contest by one party |

Casa inheritance documents, Bitcoin miniscript timelocks and published loss post-mortems were not reviewed in this pass.

## Assets

| Asset | Where it lives |
|---|---|
| Vault funds | Base Sepolia address derived from `vault account + path` on domain 0 |
| Heir list, floors, caps | Contract state, immutable after `new` |
| Sealed wishes | Ciphertext off-chain, hash on-chain |
| Wishes key | Does not exist until the MPC network derives it |
| Authority to sign | Only the vault account can request domain 0 signatures for its path |

## Trust boundaries

1. NEAR contract state and receipts are trusted to the NEAR validator set.
2. Signatures and foreign-chain attestations are trusted to an 11-of-N MPC threshold.
3. Everything off-chain (relayer, agent host, RPC, browser) is untrusted and must be checkable.
4. The contract cannot read a TDX quote or a Base balance. Those are rechecked off-chain and labeled as such.

## Actors: worst thing each can do alone

| Actor | Worst alone, after the fixes | Why not worse |
|---|---|---|
| Owner | Check in forever, change nothing else | Heirs and limits are immutable. Dying is not required for the owner to keep the money: the owner cannot withdraw through the contract at all |
| Thief of the owner's check-in key | Delay a normal claim indefinitely | An override claim from all witnesses ignores check-ins, and only the cold recovery key cancels it (I10) |
| Thief of both owner keys | Keep cancelling claims | Indistinguishable from the owner. Stated limit |
| Deployer | Nothing after lock | No full-access key remains (I1). Before lock the deployer can drain, so lock is verified before funding |
| Agent | Pay a listed heir between floor and cap, once. Or do nothing | Fallback removes the need for the agent (I13) |
| Model provider | Choose within floor and cap | Same bounds. A provider who signs a crafted response stays inside I2 |
| Relayer | Delay broadcast | Anyone can broadcast the stored signature or request a higher fee (I6) |
| One witness | Add one bounded contest delay | Quorum needed to claim. Each witness contests once (I16) |
| Witness quorum | Open a false claim. Declare a payment reverted, once per heir | The owner cancels in grace. A false revert overpays one heir once and is recorded if disproved (I9, I17) |
| Registrar | Mark one heir adult early | Can only accelerate, once per heir, and only for that heir (I11) |
| Court | Delay payout once per claim, up to `freeze_max_secs` | Freeze expires by itself (I12) |
| MPC network (threshold) | Sign anything, steal everything, falsely attest a payment | Root of trust. Stated limit |
| Heir | Refuse the funds, or run a contract that reverts | The revert consumes only that heir's nonce. Later heirs continue (I6) |
| Coercer of an heir | Force that heir to accept | Payment goes only to the listed address. Off-chain harm is out of scope |

## Invariants

- **I1** After `lock`, `view_access_keys` for the vault returns no key with `FullAccess` permission.
- **I2** Every payout goes to a listed heir, with `floor_wei <= value <= cap_wei`.
- **I3** A heir is `Paid` only once per settled proof, and a `Paid` heir never gets a new payout.
- **I4** A heir becomes `Paid` only after the MPC ForeignTx key signs the contract-computed payload hash for the contract-computed transaction hash.
- **I5** A signature is stored only if `ecrecover` with low-s enforcement returns the vault's key.
- **I6** Each payout owns exactly one nonce. All attempts for a payout share nonce, recipient and value and differ only in fee. So at most one attempt can land, and a stuck attempt is replaced, not abandoned.
- **I7** The sum of committed value and maximum gas never exceeds `budget_wei`.
- **I8** No payout is created unless the claim is open, the delay has passed, no active freeze applies and the heir's age gate is open.
- **I9** The owner's check-in cancels a normal claim until the first payout exists.
- **I10** Check-in does not cancel an override claim. Only a signature from the recovery key does, and that signature cannot be replayed on a later claim.
- **I11** `prove_adult` is bound to one heir, succeeds once per heir, and cannot delay that heir past the owner-set `adult_by`.
- **I12** A freeze lasts at most `freeze_max_secs` and can be applied once per claim.
- **I13** After `opened_at + fallback_secs`, anyone can start the cap payout for any open heir, with no agent and no decision proof.
- **I14** The agent's payout is accepted only with a response signed by a registered, unexpired attested signer, and the heir and amount in that signed body must equal the call's arguments and name this vault.
- **I15** The vault requests the wishes key only after I8's trigger conditions hold, and only for the registered app key.
- **I16** A contest extends the delay by `contest_secs`, at most once per witness.
- **I17** A reverted payout can be reopened once per heir, needs a witness quorum over its exact transaction hash, and is flagged if later proven to have succeeded.
- **I19** Every payout's nonce stays signable until settled or reverted, so no later payout can be stranded by an earlier one.
- **I18** Failed signing changes no nonce and no heir state beyond releasing the attempt.

## Stated limits

- The contract can bind a decision to a signing key, not to the prompt. Anyone holding an API key can obtain a genuine signature on a crafted response. That is why I2 and I13 hold without trusting the agent. Comparing `request_hash` with the published prompt happens off-chain.
- The binding of signing key to enclave measurement is checked off-chain by the published command, because the contract cannot verify a TDX quote.
- The contract cannot read the Base balance. An underfunded transaction is invalid, is never mined and consumes no nonce, so it retries once funded. The relayer refuses and says why.
- The MPC network does not attest failures, so a revert needs the witness path in I17.
- A witness quorum that lies about a revert, with a retry already issued, can overpay that heir once. It is detected, and further reopens stop, but the transfer cannot be undone.
- Early signatures already released cannot be revoked by a later freeze.
- Not a legal will.
