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
2. Signatures and foreign-chain attestations are trusted to an 11-of-N MPC threshold. On testnet, also to each of the 4 full-access keys on `v1.signer-prod.testnet` (D24).
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
- **I7** The sum of committed value and maximum gas never exceeds `budget_wei`. A disproved revert counts its value as committed again (v3; model counterexample 3), so committed may then exceed the budget by that one payout, which is the overpayment the stated limit of I17 allows.
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
- **I19** Every payout's nonce stays signable until settled or reverted, so no later payout can be stranded by an earlier one. A request whose callback never comes is replaced after `SIGN_LEASE_SECS` by anyone, and a late callback for the replaced request is ignored (v3; D11).
- **I18** Failed signing changes no nonce and no heir state beyond releasing the attempt.
- **I20** Once the wishes key is requested, the claim can no longer be cancelled, by check-in or by the recovery key (v3; model counterexample 1).
- **I21** Every config `new` accepts can open a claim and reach every deadline: durations are at most 100 years, witnesses at most 32, heirs at most 16, budget at most 2^126 wei, attested signers at most 8 live at a time (v3; Kani counterexample, `cex4`).
- **I22** After `abandon_secs` of silence, if the owner set it, a normal claim opens with no witnesses; a check-in still cancels it (v3; D20).

## Dependencies over 20 years

Read from primary sources only: `near/mpc` at tag `3.18.0`, nearcore runtime source and parameter files, the archival history of `v1.signer-prod.testnet`, the OP Stack specs and Base's own changelogs. Raw reads, with file and line citations: [docs/evidence/deps/](evidence/deps/README.md).

The vault has no key, so nothing below can be fixed after deployment. Each row says what the deployed code does when the dependency changes. **D** rows that hold are invariants; the rest are stated limits.

| # | Dependency | How it changes, and who | How often, on-chain | What the deployed vault does |
|---|---|---|---|---|
| D1 | Signer contract code: method names, request JSON, response JSON | `vote_contract_update`, k of n participants, k ≥ max(2, 60% of n). Replaces all code and runs `migrate` | 48 code changes from 2024-07-25 to 2026-10-30, about 1.8 a month: 24 deployed by a full-access key, 24 by participant vote ([table](evidence/deps/signer-history/code-changes-table.json)) | Any break makes `sign`, `verify_foreign_transaction` or CKD fail forever. Precedents: 3.18.0 removed `latest_key_version`; 3.7.0 changed the verify request shape. **Limit** |
| D2 | Signer's minimum attached gas for `sign` and `verify_foreign_transaction` (default 15 Tgas) | Config vote, k of n | Config and code updates share one vote: 172 successful `vote_update` calls, 2025-02 to 2026-10 ([counts](evidence/deps/signer-history/governance-by-month.json)) | Deployed vault: a fixed 150 Tgas; above that, both calls fail forever. v3: at least 150 Tgas plus an equal share of whatever the caller attaches (`GasWeight`), so a caller can meet a raised minimum up to the 1 PGas receipt cap. **Limit in v2, mitigated in v3** |
| D3 | Required deposit, 1 yoctoNEAR | Code update only | Constant since the request API began | Deployed vault: above 1, every call fails with `InsufficientDeposit` forever. v3: every call that reaches the signer is payable and forwards what the caller attaches (at least 1 yocto from the vault). **Limit in v2, mitigated in v3** |
| D4 | Domains 0, 2, 3 and their public keys | Resharing copies every key unchanged. No vote removes a domain. A code update can | 97 resharings started and 856 `vote_reshared` calls, 2025-01 to 2026-10 ([counts](evidence/deps/signer-history/governance-by-month.json)); key checks in [signer-history.md](evidence/deps/signer-history.md) | Holds while the keys exist: signatures are checked against stored keys, so a changed key is refused, never trusted. If the key is lost, nothing recovers it. **Invariant D4** with **limit** on key loss |
| D5 | Protocol state (key generation for a new domain, TEE re-checks) | `vote_add_domains` (all participants), `verify_tee` | 48 successful `vote_add_domains` calls and 10 key generations, 2025-04 to 2026-11 ([counts](evidence/deps/signer-history/governance-by-month.json)) | New requests panic, pending ones time out. The vault's failed attempt is released (I18) and anyone retries later. **Invariant D5** |
| D6 | Base in the signer's foreign-chain whitelist, and enough nodes serving it | `vote_update_foreign_chain_providers` (k of n), each node's config, or a code update (precedent: Bitcoin deleted by the 3.18.0 migration) | 9 `vote_foreign_chain_policy` (2026-02 to 2026-03) and 53 `vote_update_foreign_chain_providers` (2026-06 to 2026-09) ([counts](evidence/deps/signer-history/governance-by-month.json)) | `settle` fails. The transfer itself still lands on Base, later heirs are unaffected (I19), but the heir stays `Pending` on NEAR. **Limit** |
| D7 | Inspector rule for "Finalized": receipt at or below the RPC's `finalized` block, re-read by number, status 1, all providers agree | Node release, image-hash vote | Unchanged in 3.18.0 | Only a finalized success is attested. Revert, not found, reorged, not final or disagreement: no answer, the callback gets a timeout error. **Invariant I4** |
| D8 | Payload layout: `Base` at enum index 6, `Finalized` at 2, `payload_version` 1 | Code update | Pinned by a source comment, not by a test vector | A reorder makes every `settle` fail. **Limit** |
| D9 | NEAR host functions `ecrecover`, `ed25519_verify`, `sha256`, `keccak256` | Protocol upgrade | About 60 protocol versions from v29 to v89; no semantic change to these | Stable. `ecrecover` with the malleability flag refuses high-s, so the MPC network and the enclave must sign low-s. **Invariant I5** |
| D10 | Wasm preparation limits | Protocol upgrade, applied to deployed code when the VM changes | Limits added at v84 and v87; VM swapped at v62 and v84 | A future limit this wasm breaks would make every method fail to load. **Limit** |
| D11 | Gas a callback needs, against the fixed 60 Tgas | Runtime cost changes (contract loading cost rose 5x at v66); state size | Caps only rose; some costs rose | If `on_signed` runs out of gas or storage, its changes roll back and `signing` stays true forever: that nonce and every later one are dead. Model counterexample, test `cex2`. **Broken in the deployed vault.** v3: callbacks also get a share of attached gas, state is bounded (I21), and a request without its callback is replaced after a one-hour lease (I19) |
| D12 | Storage staking (1e19 yoctoNEAR per byte) | Protocol parameter | One change ever, a decrease, at v42 | A shortfall fails the receipt with `LackBalanceForState`. Anyone can top up with a plain transfer. A shortfall during `on_signed` is D11. **Limit**, recoverable |
| D13 | Keyless accounts | No rule deletes or freezes an account with no keys | None found | Holds. **Invariant I1** |
| D14 | Base's chain software and "finalized" | Base left the OP Stack (announced 2026-02-18; removed from the Superchain Registry 2026-04-27). One operator sets the rules | 4 mainnet upgrades May to Nov 2026 | Settlement trusts whatever the MPC nodes' Base RPCs call finalized (about 16 to 20 minutes today). **Limit** |
| D15 | Base's minimum base fee and EIP-1559 parameters | `SystemConfig`, changed by the operator without a hard fork | Mainnet minimum went 25x in 11 weeks | The fee ceiling is immutable (5 gwei on the live vault, about 1,000x today's Base Sepolia fee). Above it, a payout waits. **Limit** |
| D16 | Intrinsic gas for a value transfer | EIP-2780 (Last Call) would add 183,600 gas for a fresh recipient | Not scheduled | Each heir's `gas_limit` is immutable. A 21,000 limit to a fresh address would revert, and so would the retry. Set limits with headroom at deployment. **Limit** |
| D17 | Base Sepolia (84532) itself | Testnet shutdown | Base Goerli: about 11 days' notice (2024) | `chain_id` is fixed. After a shutdown nothing can settle. Testnet only. **Limit** |
| D18 | Signer account `v1.signer-prod.testnet` | Its operators | One account so far | Stored at init; a move to a new account strands the vault. **Limit** |
| D19 | Actor accounts: owner, agent, court | Sub-accounts of the vault | n/a | Only the parent creates sub-accounts, and the vault has no key, so a deleted actor can never be re-registered by someone else. **Invariant D19** |
| D20 | Witness and registrar keys | Their holders | n/a | Deployed vault: if more than `n - threshold` witnesses lose their keys, no claim can ever open; funds are stranded. v3: after `abandon_secs` of silence (an owner choice, years), a normal claim opens with no witness at all, and a living owner still cancels it with a check-in (I22). **Limit in v2, escape path in v3** |
| D21 | Heir keys | Their holders | n/a | Addresses are immutable. A heir who loses its key loses its share. **Limit** |
| D22 | NEAR AI attested signer | Expiry, provider | n/a | Agent payouts stop; the fallback pays each heir its cap with no AI (I13). **Invariant I13** |
| D24 | Who can replace the signer contract | On testnet: any one of 4 full-access keys on `v1.signer-prod.testnet`, with no vote. On mainnet `v1.signer` has no keys, so only a participant vote | Testnet: 24 of 48 code changes were key deploys, the last on 2025-04-07 (version 1.0.1); every change since has been a vote, but the keys remain ([table](evidence/deps/signer-history/code-changes-table.json), [keys](evidence/deps/signer-history/access-keys-current.json), [mainnet keys](evidence/deps/signer-history/access-keys-mainnet-v1.signer.json)) | The contract decides which account a signature request comes from. Code deployed by one key could ask the nodes to sign as this vault, and the vault's Base funds would follow. The vault cannot detect it. **Limit: on testnet the custody claim holds only if none of those 4 keys acts alone** |
| D23 | Witnesses signing a revert | Their own procedure | n/a | A revert signed before Base finality can be reorged into a success, and the retry pays the heir twice (model counterexample, `tlc-v2-cex-reorg-revert.log`). Witnesses must wait for finality, as the MPC inspector does for successes. **Procedure invariant D23** |

What this means: the deployed vault survives key rotation of MPC participants (D4, D5), host-function churn (D9) and every temporary outage, because failure releases the attempt and anyone can retry. It does not survive an incompatible signer upgrade, a gas or deposit rule above its constants, the loss of Base from the signer, or the loss of too many witness keys. None of those can be fixed after lock, by design: any key that could fix them could also redirect the money.

## Stated limits

- The contract can bind a decision to a signing key, not to the prompt. Anyone holding an API key can obtain a genuine signature on a crafted response. That is why I2 and I13 hold without trusting the agent. Comparing `request_hash` with the published prompt happens off-chain.
- The binding of signing key to enclave measurement is checked off-chain by the published command, because the contract cannot verify a TDX quote.
- The contract cannot read the Base balance. An underfunded transaction is invalid, is never mined and consumes no nonce, so it retries once funded. The relayer refuses and says why.
- The MPC network does not attest failures, so a revert needs the witness path in I17.
- A witness quorum that lies about a revert, with a retry already issued, can overpay that heir once. It is detected, and further reopens stop, but the transfer cannot be undone.
- Early signatures already released cannot be revoked by a later freeze.
- Not a legal will.
