# MPC signer governance: what can change under the vault

Source: `near/mpc` tag `3.18.0`, commit `e691bdb98d68dcf74653da58d043453a6318765f`, clean checkout. Every `path:line` is relative to that repo root. The vault side is `contract/src/lib.rs` in this repo.

What the vault fixes forever (`contract/src/lib.rs`):

- `signer_contract`, the domain-0 derived key and the domain-3 root key are stored at init (lib.rs:128-132).
- `sign` is called with `{"request":{"path":"ghost-base-sepolia-1","payload_v2":{"Ecdsa":hex},"domain_id":0}}`, 1 yocto, 150 Tgas (lib.rs:825-830, 16, 21).
- `verify_foreign_transaction` is called with `{"request":{"request":{"Base":{"tx_id","extractors":[],"finality":"Finalized"}},"domain_id":3,"payload_version":1,"expected_payload_hash":hex}}`, 1 yocto, 150 Tgas (lib.rs:563-572, 17).
- `request_app_private_key` is called with `{"request":{"derivation_path":"ghost-wishes-1","app_public_key":…,"domain_id":2}}`, 1 yocto, 100 Tgas. It has no callback (lib.rs:647-659, 18).
- Responses are parsed by JSON field names `big_r.affine_point`, `s.scalar`, `recovery_id` and `payload_hash` (lib.rs:236-244, 593-599). They are then checked with `ecrecover` against the stored keys (lib.rs:247-251, 542, 602).
- The expected foreign payload is hand-encoded Borsh `[0, 6, tx_id, 0u32, 2, 0u32]` (contract/src/eth.rs:128-135).

---

## 1. Contract upgrade

**Method names.** Tag 3.18.0 has no `propose_update` or `vote_update`. The upgrade methods are `vote_contract_update(update_hash)` and `submit_contract_update(update)`.

- `vote_contract_update` stores the caller's vote for an `UpdateHash` and returns whether the threshold is met (crates/contract/src/api/update.rs:80-96).
- `submit_contract_update` takes the full `Update` in Borsh. It checks that the votes for its hash meet the threshold, clears all update votes and applies it (crates/contract/src/api/update.rs:19-78).
- `Update` is either `Code(Vec<u8>)` or `Config(Config)`. `UpdateHash` is `Code(Hash256)` or `Config(Hash256)` (crates/near-mpc-contract-interface/src/types/updates.rs:11-37).
- A code update runs `deploy_contract(code)` and then calls `migrate` (crates/contract/src/api/update.rs:59-66).
- A config update calls the private `update_config`, which overwrites `self.config` (crates/contract/src/api/update.rs:67-73, 152-155).
- Submitting needs a 1-yocto deposit (crates/near-mpc-contract-interface/src/deposits.rs:6; crates/contract/src/api/update.rs:31-39).

**Who votes.**

- Only current participants can vote. The voter is authenticated against `threshold_parameters().participants()` (crates/contract/src/api/update.rs:89-94).
- Votes are counted only for current participants (`count_participants`) (crates/contract/src/api/update.rs:91-94).
- The participant's own account must call directly: `signer_account_id == predecessor_account_id`, so no forwarding through a multisig contract (crates/contract/src/api/authorization.rs:62-79).
- `submit_contract_update` also requires a voter (`voter_or_panic`) (crates/contract/src/api/update.rs:29; crates/contract/src/api/authorization.rs:28-34).
- In the Resharing state, the old participant set is the electorate (crates/contract/src/state.rs:188-190).

**Threshold.**

- An update needs `GovernanceThreshold` k votes: `parameters.threshold().is_met_by(num_votes)` (crates/contract/src/api/update.rs:54, 95).
- k must be at least 2 and at least 60% of n rounded up (`3n.div_ceil(5)`). It may not exceed n (crates/contract/src/primitives/thresholds.rs:10-25, 59-90).
- Updates apply in the Running, Resharing and Initializing states. The test is `submit_contract_update__should_apply_an_approved_update_in_any_active_state` (crates/contract/src/api/update.rs:254-273).
- The 3.18.0 `migrate` from the 3.17.0 layout separately requires the Running state (crates/contract/src/v3_17_0_state.rs:170-173).

**Can an upgrade change `sign` / `verify_foreign_transaction` / `request_app_private_key`?** Yes. A code update replaces the whole WASM (crates/contract/src/api/update.rs:59-60). The contract code places no limit on what the new code exports, accepts or returns, and nothing in the contract enforces a frozen ABI. Today's shapes are:

- `sign(request: SignRequestArgs)` (crates/contract/src/api/sign.rs:26-28).
- `verify_foreign_transaction(request: VerifyForeignTransactionRequestArgs)` (crates/contract/src/api/foreign_chain/requests.rs:30-35).
- `request_app_private_key(request: CKDRequestArgs)` (crates/contract/src/api/ckd.rs:31-33).
- The `sign` result is `SignatureResponse`, tagged by `"scheme"`, with `K256Signature { big_r, s, recovery_id }` (crates/near-mpc-crypto-types/src/primitives.rs:166-170, 219-223).
- The verify result is `{ payload_hash, signature }` (crates/near-mpc-contract-interface/src/types/foreign_chain.rs:151-154).

**Compatibility evidence in source** (these are habits, not promises):

- `SignRequestArgs` has a hand-written deserializer. It still accepts the pre-EdDSA field `payload` (raw 32 bytes, read as ECDSA) and `key_version` as an alias for `domain_id`. It serializes as `payload_v2`. The comment says this is "required for backward compatibility" (crates/near-mpc-crypto-types/src/sign.rs:1-6, 19-95).
- `get_pending_request` keeps an `Option<YieldIndex>` shape "for JSON wire compatibility with out-of-tree consumers" (crates/contract/src/api/sign.rs:179-181).
- `fail_on_timeout` keeps the old timeout error text "To stay consistent with the old version" (crates/contract/src/api/common.rs:116-120).
- `ForeignTxSignPayload` says "Never reorder existing enum variants or struct fields … would … break signature verification" (crates/near-mpc-contract-interface/src/types/foreign_chain.rs:1704-1711).
- There are pinned hash snapshots for V1 payloads on Ethereum, Solana, Fogo, Bitcoin, Starknet, TON, Aptos and Sui. **No Base vector is pinned** (crates/near-mpc-contract-interface/src/types/foreign_chain.rs:1888-1907; crates/near-mpc-contract-interface/src/types/snapshots/).
- Change-detection snapshots exist for the ABI, the request wire format and the contract's Borsh schema: `test_abi_has_not_changed` (crates/contract/tests/abi.rs:45-47), the wire-format catalog (crates/near-mpc-contract-interface/src/client.rs:837-840) and `mpc_contract_borsh_schema_has_not_changed` (crates/contract/src/lib.rs:79-85). These are CI tripwires that maintainers can re-accept. They are not on-chain guarantees.
- Migration code keeps pending request maps across the 3.17.0 → 3.18.0 upgrade (crates/contract/src/v3_17_0_state.rs:191-196). `migrate` tries the previous layout first and then the current one (crates/contract/src/api/lifecycle.rs:166-185).

**Counter-evidence: user-facing changes have shipped.**

- 3.18.0 itself: "*(contract)* [**breaking**] Remove support for latest_key_version (#4902)" (CHANGELOG.md:8, 180).
- 3.7.0: "[**breaking**] Remove derivation paths from foreign chain validation requests (#2378)" (CHANGELOG.md:2184, 2194). That changed the `verify_foreign_transaction` request shape.
- The 3.18.0 migration also changed policy data: it removed `Bitcoin` from the RPC whitelist and from the available chains, and lowered every other chain's RPC quorum by 1 (crates/contract/src/v3_17_0_state.rs:123-146, 189-190).

**Written compatibility promise.** The only one found is `RELEASES.md:224-240`, a process document rather than code. It promises contract-to-node and node-to-node compatibility across versions. It says nothing about third-party callers of `sign`, `verify_foreign_transaction` or `request_app_private_key`. **Not confirmed:** that any compatibility promise to external callers exists.

## 2. Domains and resharing

**Adding domains.**

- `vote_add_domains(domains)` works only in Running (crates/contract/src/api/governance.rs:85-104; crates/contract/src/state.rs:145-153).
- It needs a vote from **every** current participant: `num_participants == n_votes` (crates/contract/src/state/running.rs:206-247).
- New IDs must be contiguous from `next_domain_id` (crates/contract/src/primitives/domain.rs:144-161).
- Once accepted, the contract enters **Initializing** (crates/contract/src/state/running.rs:231-243).

**Removing a domain or changing its key.**

- `DomainRegistry` has no remove method. Its comment says domains are deleted "in only one case": a cancelled key generation for domains being added (crates/contract/src/primitives/domain.rs:103-111, 163-167; crates/contract/src/state/initializing.rs:112-140).
- Domain IDs are never reused (crates/contract/src/primitives/domain.rs:103-105, 128-141).
- The only field a vote can change on an existing domain is `reconstruction_threshold`, through `vote_new_parameters` (crates/contract/src/primitives/domain.rs:218-245).
- No vote path writes a new public key for an existing domain. `vote_pk` exists only in Initializing, for the domain being generated (crates/contract/src/state.rs:111-124).
- Node migration requires the submitted keyset to equal the stored one (crates/contract/src/api/node_migration.rs:210-219).
- **A code update can rewrite any state.** `migrate` is `#[init(ignore_state)]` (crates/contract/src/api/lifecycle.rs:166-169), so "no key change" holds only for the current code.

**Resharing (`vote_new_parameters`).**

- The vote names a new participant set, a new governance threshold and optional new per-domain reconstruction thresholds (crates/contract/src/api/governance.rs:14-35).
- At least k old participants must stay in the proposal (crates/contract/src/primitives/thresholds.rs:176-179).
- New members can vote only after k old participants voted for the same proposal (crates/contract/src/state/running.rs:190-199).
- The transition needs a vote from **every proposed** participant: `new_num_participants == n_votes` (crates/contract/src/state/running.rs:202-203).
- Each proposed participant must hold a valid TEE attestation, or the vote is rejected (crates/contract/src/api/governance.rs:47-81).

**What resharing does to keys.**

- `ResharingContractState` keeps the previous running state "to copy the public keys" (crates/contract/src/state/resharing.rs:20-26).
- `vote_reshared` builds each new `KeyForDomain` with `key: previous_key.key`, so the root public key of every domain is carried over unchanged (crates/contract/src/state/resharing.rs:121-135).
- The new `Keyset` gets a new epoch ID but the same keys (crates/contract/src/state/resharing.rs:151-160).
- A key event completes only when every proposed participant has voted (crates/contract/src/state/key_event.rs:116-134).
- Derived keys are computed from the root key and `derive_tweak(predecessor, path)`. The tweak uses a fixed prefix `"near-mpc-recovery v0.1.0 epsilon derivation:"` (crates/contract/src/api/keys.rs:29-58; crates/near-mpc-crypto-types/src/kdf.rs:8-13). With an unchanged root key and unchanged code, the domain-0 key derived for `ghostprotocol-vault.testnet` / `ghost-base-sepolia-1` is unchanged.
- Resharing can be cancelled by k old participants, which returns to the old running state (crates/contract/src/state/resharing.rs:173-196).

**In-flight and new requests by state.**

- **Running:** accepted.
- **Resharing:** accepted. The domain registry and public keys come from `previous_running_state` (crates/contract/src/state.rs:36-52). `respond`, `respond_verify_foreign_tx` and `respond_ckd` accept answers while `is_running_or_resharing()` (crates/contract/src/api/sign.rs:95-97; crates/contract/src/api/foreign_chain/requests.rs:90-92; crates/contract/src/api/ckd.rs:85-87; crates/contract/src/state.rs:211-216).
- **Initializing** (while adding domains): **new** `sign`, verify and CKD calls panic at submission. `check_request_preconditions` calls `domain_registry()`, which errors with `ProtocolStateNotRunningNorResharing` (crates/contract/src/api/common.rs:36-39; crates/contract/src/state.rs:36-41).
  - Requests already pending cannot be answered, because `respond*` rejects outside Running and Resharing. They expire through the yield timeout (crates/contract/src/api/sign.rs:95-97).
  - For the vault, a key-generation ceremony means every `sign` or `settle` in that window fails, and the call must be retried later.
- **`accept_requests == false`:** every new request panics with `TeeValidationFailed` (crates/contract/src/api/common.rs:74-79), and responses are refused (crates/contract/src/api/sign.rs:99-101).

## 3. Foreign-chain policy

There are two layers. A chain must pass both before `verify_foreign_transaction` accepts it.

**1. On-chain RPC provider whitelist.**

- `vote_update_foreign_chain_providers(votes: NonEmptyBTreeMap<ForeignChain, ChainEntry>)` (crates/contract/src/api/foreign_chain/support.rs:69-106).
- `ChainEntry` is `{ providers: NonEmptyBTreeMap<ProviderId, ProviderConfig>, quorum }` (crates/near-mpc-contract-interface/src/types/foreign_chain.rs:1874-1878).
- A chain's entry is **replaced** once k current participants voted the same `(providers, quorum)` hash (crates/contract/src/foreign_chain_rpc.rs:149-172, 193-213).
- `quorum` must be between 1 and the number of providers (crates/near-mpc-sdk/src/foreign_chain/validation.rs:49-63).
- The view method `allowed_foreign_chain_providers` returns the whitelist (crates/contract/src/api/foreign_chain/support.rs:108-115).

**2. Per-node support.**

- Each node calls `register_foreign_chains_config` with the chains it covers (crates/contract/src/api/foreign_chain/support.rs:14-33).
- A chain is **available** only if it is whitelisted and supported by at least `required_active_signers` of the foreign-tx domain among current participants (crates/contract/src/api/foreign_chain/support.rs:36-67; crates/contract/src/foreign_chains_metadata.rs:41-66).
- A node registers only chains whose local providers meet the voted quorum (crates/node/src/foreign_chain_rpc_policy.rs:26-35, 55-58).

**Can `Base` be removed?**

- **Vote:** a vote cannot delete the entry, because the provider map must be non-empty (crates/contract/src/foreign_chain_rpc.rs:47-50). It can replace the providers and quorum with values the nodes' local configs do not match. Those nodes then stop counting Base as eligible, and Base drops out of the available set (crates/node/src/foreign_chain_rpc_policy.rs:55-79).
- **Nodes:** Base also drops out if fewer than the required number of nodes register it, for example when operators lose RPC credentials.
- **Code update:** an upgrade can delete Base outright. 3.18.0 did exactly this to Bitcoin (crates/contract/src/v3_17_0_state.rs:123-146). `AllowedProviders::remove` exists for this (crates/contract/src/foreign_chain_rpc.rs:103-105).
- Both `ForeignChain` and `ForeignChainRpcRequest` are `#[non_exhaustive]` (crates/near-mpc-contract-interface/src/types/foreign_chain.rs:173, 1371).

**If the chain is not available.**

- **At submission:** `verify_foreign_transaction` panics with `ForeignChainNotAvailable` (crates/contract/src/api/foreign_chain/requests.rs:49-57). The receipt fails and the vault's `on_settled` receives `Err`.
- **After submission:** if Base becomes unavailable while the request is pending, the leader node refuses it (`ensure_chain_is_available`) (crates/node/src/providers/verify_foreign_tx/sign.rs:98-116, 682-693). The request then times out.

**Node configuration (`crates/node-config/foreign_chains/testnet.toml`).**

- The file is "embedded in the node for testnet, covered by the image hash vote". Providers are enabled by operator credentials (crates/node-config/foreign_chains/testnet.toml:1-4).
- `[base]`: `timeout_sec = 30`, `max_retries = 3`, `expected_network_fingerprint = "84532"`. Providers are Alchemy `base-sepolia`, QuickNode `base-sepolia` and Tatum `base-sepolia` (crates/node-config/foreign_chains/testnet.toml:108-123).
- Mainnet uses `"8453"` and `base-mainnet` hosts (crates/node-config/foreign_chains/mainnet.toml:111-114).
- The signed payload names only `ForeignChain::Base`, not a chain ID (crates/near-mpc-contract-interface/src/types/foreign_chain.rs:1750-1753). "Base" means Base Sepolia only because the testnet nodes are configured that way.
- `max_retries` is read only by the fingerprint probe. "transaction verification does not retry a provider at all currently" (crates/node-config/src/foreign_chains.rs:79-81).

**`expected_network_fingerprint`.**

- It is "Declarative: nothing reads it during config loading" (crates/node-config/src/foreign_chains.rs:82-86).
- The health check compares each provider's `eth_chainId` against it (crates/foreign-chain-health-check/src/lib.rs:1-3; crates/foreign-chain-health-check/src/probe.rs:139-158; crates/foreign-chain-inspector/src/evm/inspector.rs:44-56).
- The node runs that probe periodically and marks it "Diagnostic only: nothing gates on the result" (crates/node/src/foreign_chain_probe.rs:18-20).
- **So a provider serving the wrong network does not, by itself, stop verification.** Protection comes from the whitelisted provider hosts and from the RPC quorum agreeing.

## 4. Inspector semantics (EVM / Base)

- Base uses the shared `EvmInspector` (crates/foreign-chain-inspector/src/base/inspector.rs:9-16).

**"Finalized", step by step:**

1. `eth_getTransactionReceipt(tx_hash)` (crates/foreign-chain-inspector/src/evm/inspector.rs:79-89). If it returns `null`, the verdict is `TransactionNotFound` (inspector.rs:90-92). A receipt for a different hash is an error (inspector.rs:94-101).
2. `eth_getBlockByNumber("finalized", false)`. If `head.number < receipt.block_number`, the error is `NotFinalized` (inspector.rs:152-178). The tag serializes as camelCase `"finalized"` (crates/foreign-chain-rpc-interfaces/src/evm.rs:68-74).
   - **Not confirmed in this repo:** what "finalized" means on Base. It is whatever each provider's node reports for that tag, which on OP-stack is an L2 block derived from finalized L1 data.
3. `eth_getBlockByNumber(receipt.block_number)`. If its hash differs from `receipt.block_hash`, the verdict is `NonCanonicalBlock`. This is the reorg check (inspector.rs:106-121, 180-197).
4. `receipt.status == 1`, otherwise the verdict is `TransactionFailed` (inspector.rs:123-127).
5. Extractors run last. The vault passes none (inspector.rs:129-136).

**Quorum across providers (`FanOut::extract_with_quorum`).**

- All configured providers are queried concurrently (crates/foreign-chain-inspector/src/lib.rs:220-249).
- Errors are tolerated (lib.rs:250-268).
- **Any two different verdicts fail the whole extraction with `InspectorResponseMismatch`** (lib.rs:278-288).
- At least `quorum.required` *whitelisted* providers must reach the same verdict, otherwise `SubQuorum` (lib.rs:290-307).
- With no verdict at all, the first error is returned (lib.rs:271-276).
- A provider that hangs stalls the fan-out until the node's timeout (lib.rs:137-146).

**Negative outcome: no response at all.**

- The node accepts only `Verdict::Extracted`. Every other verdict becomes an error (crates/node/src/providers/verify_foreign_tx/sign.rs:695-699).
- Each inspection is capped at `FOREIGN_CHAIN_INSPECTION_TIMEOUT = 5 s` (crates/node/src/providers/verify_foreign_tx/sign.rs:43, 404-410).
- The code says outright: "Any negative verdict or errors here only makes this node abstain from responding and lets the request time out" (TODO #2677) (crates/node/src/providers/verify_foreign_tx/sign.rs:254-256).
- A payload that does not match `expected_payload_hash` is also refused before signing (crates/node/src/providers/verify_foreign_tx/sign.rs:46-57). On-chain, `respond_verify_foreign_tx` checks the same thing (crates/contract/src/api/foreign_chain/requests.rs:98-102).
- **So for a reverted, missing, reorged, unfinalized or disputed Base transaction, nothing is ever signed.** The caller sees only a timeout and cannot tell "failed" from "not yet final" from "RPC disagreement". This matches the vault's own comment, "The MPC network cannot attest a failure" (lib.rs:618).

**Retries and timeout.**

- The leader retries a failing request: up to 10 attempts as primary leader and 5 per failover leader, up to 4 failover levels. Attempts are spaced at least 1 s apart, and failover leaders wait 10 s each (crates/node/src/requests/queue.rs:27-49, 485-490).
- The request lifetime is `REQUEST_EXPIRATION_BLOCKS = 200`, "equal to the yield-resume timeout on the blockchain" (crates/node/src/requests/queue.rs:32-34). The contract's sandbox tests use `SIGNATURE_TIMEOUT_BLOCKS = 200` (crates/contract/tests/sandbox/sign.rs:29; crates/contract/tests/sandbox/foreign_chain_request.rs:20).
- The 200-block value is set by the NEAR protocol, not by the MPC contract. **Not confirmed in this repo:** the nearcore constant itself, and the wall-clock length of 200 blocks.
- A Base transaction submitted to `settle` before the providers report it as finalized will likely run out of attempts or blocks. The caller must call `settle` again later.

**What the caller's callback receives on timeout.**

- The yield callback gets `Err(PromiseError)`, pops the oldest queued yield, and returns a `fail_on_timeout` promise (crates/contract/src/api/foreign_chain/requests.rs:165-184; crates/contract/src/api/sign.rs:198-219; crates/contract/src/api/ckd.rs:137-157).
- `fail_on_timeout` panics with `"Request has timed out."` (crates/contract/src/api/common.rs:116-120; crates/contract/src/errors.rs:52-53).
- The vault's `#[callback_result]` therefore receives `Err(PromiseError::Failed)`. `on_signed` and `on_settled` return `false` (lib.rs:539-544, 592).
- A late `respond*` after the timeout is a no-op for that yield (crates/contract/src/pending_requests.rs:59-62).

## 5. Deposits and fees

- **`sign`:** minimum deposit `SIGN_DEPOSIT_YOCTONEAR = 1` (crates/near-mpc-contract-interface/src/deposits.rs:4; crates/contract/src/api/sign.rs:35-40).
- **`verify_foreign_transaction`:** reuses the same `SIGN_DEPOSIT_YOCTONEAR` constant (crates/contract/src/api/foreign_chain/requests.rs:42-47).
- **CKD:** `MINIMUM_CKD_REQUEST_DEPOSIT = 1 yocto` (crates/contract/src/api/ckd.rs:41-46, 160-161).
- **Refunds:** only the excess over the minimum is refunded, through a detached transfer. The required 1 yocto is kept (crates/contract/src/api/common.rs:123-156).
- **Why it exists:** to force a full-access-key signature, so a malicious frontend cannot spend a function-call key (crates/contract/src/api/common.rs:125-130). This does not affect a contract caller like the vault.
- **Can governance raise it?** Not with a config vote. `Config` has no deposit field (crates/contract/src/config.rs:48-92; crates/near-mpc-contract-interface/src/types/config.rs:22-63). The deposits are compile-time constants, so raising them needs a **code update** (k-of-n, section 1).
- **If raised above 1 yocto:**
  - `require_deposit` panics with `InsufficientDeposit { attached: 1, required: N }` (crates/contract/src/api/common.rs:134-145). The signer receipt fails.
  - `on_signed` and `on_settled` receive `Err` and return `false`.
  - `request_wishes_key` has no callback, so its transaction simply fails.
  - The vault can never attach more, because `ONE_YOCTO` is a constant (lib.rs:21). **Every** sign, settle and wishes-key call fails from then on.
  - **Not confirmed in this repo:** that NEAR refunds the attached yocto of a failed receipt to the vault. That is protocol behaviour.

## 6. Other parameters that break hard-coded callers

**Config, changeable by a k-of-n config update** (crates/contract/src/api/update.rs:67-73, 152-155):

| Config field | Default | Effect on the vault |
|---|---|---|
| `sign_call_gas_attachment_requirement_tera_gas` | 15 (crates/contract/src/config.rs:13) | Minimum prepaid gas for `sign` **and** `verify_foreign_transaction` (crates/contract/src/api/sign.rs:38; crates/contract/src/api/foreign_chain/requests.rs:45). Raised above 150, both vault calls panic with `InsufficientGas` (crates/contract/src/api/common.rs:59-68). |
| `ckd_call_gas_attachment_requirement_tera_gas` | 15 (crates/contract/src/config.rs:15) | Minimum for CKD (crates/contract/src/api/ckd.rs:44). Raised above 100, `request_wishes_key` fails. |
| `return_signature_and_clean_state_on_success_call_tera_gas`, `return_ck_and_clean_state_on_success_call_tera_gas` | 7 and 7 (crates/contract/src/config.rs:17-19) | Gas reserved for the yield callback, taken from the caller's prepaid gas (crates/contract/src/api/sign.rs:69-80; crates/contract/src/api/common.rs:89-111). **Not confirmed:** exactly how a very large value fails inside 150 Tgas. |
| `fail_on_timeout_tera_gas` | 2 (crates/contract/src/config.rs:21) | Gas for the timeout path (crates/contract/src/api/sign.rs:212-215). |
| `tee_upgrade_deadline_duration_seconds` | 7 days (crates/contract/src/config.rs:7) | How fast nodes on old images fall out, which feeds section 7. |

There is no config field for payload version, request shape, deposit or domain IDs.

**Changeable only by a code update:**

- **Request JSON shape.**
  - `payload_v2`, `domain_id` and `path` (crates/near-mpc-crypto-types/src/sign.rs:30-39).
  - Verify args `request`, `domain_id`, `payload_version` and `expected_payload_hash` (crates/near-mpc-contract-interface/src/types/foreign_chain.rs:101-107).
  - Enum tags such as `"Base"`, `"Finalized"` and `"Ecdsa"` (crates/near-mpc-contract-interface/src/types/foreign_chain.rs:174-191, 952-957).
- **`payload_version`.** `ForeignTxPayloadVersion` is `#[non_exhaustive]` and holds only `V1 = 1`. Unknown values are rejected (crates/near-mpc-contract-interface/src/types/foreign_chain.rs:62-67, 2220-2225). The node bails on unsupported versions (crates/node/src/providers/verify_foreign_tx/sign.rs:616-624).
- **The Borsh layout of the foreign payload.**
  - `ForeignTxSignPayload::V1(ForeignTxSignPayloadV1 { request, values })` is Borsh-serialized and SHA-256 hashed (crates/near-mpc-contract-interface/src/types/foreign_chain.rs:1729-1770).
  - The vault's `BASE_VARIANT = 6` depends on `Base` staying at index 6 of `ForeignChainRpcRequest` (crates/near-mpc-contract-interface/src/types/foreign_chain.rs:174-181).
  - The vault's `FINALIZED_VARIANT = 2` depends on `Finalized` staying at index 2 of `EvmFinality` (crates/near-mpc-contract-interface/src/types/foreign_chain.rs:953-957).
  - The vault also depends on `EvmRpcRequest` keeping its field order `tx_id, extractors, finality` (crates/near-mpc-contract-interface/src/types/foreign_chain.rs:233-237).
  - The "never reorder" comment covers this, but no Base hash vector is pinned (section 1).
- **Response JSON field names**, which the vault parses by name (crates/near-mpc-crypto-types/src/primitives.rs:166-170, 219-223).
- **Payload validity.** An ECDSA payload that is not a valid secp256k1 scalar panics at submission (crates/contract/src/api/sign.rs:45-51). This is vanishingly rare for a keccak hash, but `request_signature` would need a fee change to get a new hash.
- **Per-key fan-out cap.** At most 128 duplicate pending requests per key (crates/contract/src/pending_requests.rs:22-35, 41-57).

## 7. TEE, participants and the key

**Attestation requirements.**

- Responding requires an attested participant of the active phase. In Resharing that is the *new* set (crates/contract/src/api/authorization.rs:36-60; crates/contract/src/state.rs:244-266).
- New participant sets must be fully attested (crates/contract/src/api/governance.rs:47-81).
- Allowed node images are voted in with k votes (`vote_mpc_node_manifest_digest`) (crates/contract/src/api/tee_measurements.rs:16-48). Launcher hashes and OS measurements are voted in the same file (crates/contract/src/api/tee_measurements.rs:50-190).
- The TEE verifier account can be changed by vote (crates/contract/src/api/tee_verifier.rs:22).
- The embedded foreign-chain TOML is "covered by the image hash vote", so changing Base RPCs means shipping a new image (crates/node-config/foreign_chains/testnet.toml:1).

**Participant changes and the threshold set.**

- Governance can change participants, the governance threshold and per-domain reconstruction thresholds through `vote_new_parameters` (section 2).
- `verify_tee`, callable by any participant, re-verifies attestations without a governance vote. If some fail but enough remain, it **starts a resharing automatically** to the attested subset with the same threshold (crates/contract/src/api/attestation.rs:276-361).
- If too few remain for the governance threshold or a domain's protocol, it sets `accept_requests = false` and waits for manual intervention (crates/contract/src/api/attestation.rs:309-333). Every new vault request then fails with `TeeValidationFailed` (crates/contract/src/api/common.rs:74-79).

**Does the public key survive?**

- Yes, under the current code. Resharing copies each domain's public key unchanged (crates/contract/src/state/resharing.rs:121-160). Cancelled resharings revert to the previous keyset (crates/contract/src/state/resharing.rs:173-196).
- Node migration demands the same keyset (crates/contract/src/api/node_migration.rs:210-219).
- The vault's stored domain-0 derived key and domain-3 root key therefore stay valid across any number of participant changes, **as long as** at least a reconstruction threshold of share holders keeps passing shares forward.
- If the network ever loses enough shares, no one can produce signatures under those keys again. Any replacement key would need a new domain with a new ID (section 2), which the vault cannot adopt. **Not confirmed:** how the operators would recover in that case. No code path for it was found.

---

## Dependency table

| Dependency | How it changes | Who | What a caller with hard-coded values experiences |
|---|---|---|---|
| Contract code (method names, arg/response JSON, Borsh payload layout) | `vote_contract_update` + `submit_contract_update` with `Update::Code`, then `migrate` (crates/contract/src/api/update.rs:19-96) | k of n current participants, k ≥ max(2, ⌈0.6n⌉) (crates/contract/src/primitives/thresholds.rs:10-25, 59-90) | Any rename, shape change or enum reorder makes `sign`, `verify_foreign_transaction` or CKD fail or return unparseable data. The vault gets `Err` or a parse failure and returns `false` forever. Precedent: user-facing removals in 3.18.0 and 3.7.0 (CHANGELOG.md:180, 2194). |
| Min prepaid gas for sign and verify (`sign_call_gas_attachment_requirement_tera_gas`, default 15) | Config update (crates/contract/src/api/update.rs:67-73) | k of n | Above 150 Tgas, every sign and settle panics with `InsufficientGas` (crates/contract/src/api/common.rs:59-68). Permanent for the vault. |
| Min prepaid gas for CKD (`ckd_call_gas_attachment_requirement_tera_gas`, default 15) | Config update | k of n | Above 100 Tgas, `request_wishes_key` fails permanently. |
| Required deposit (1 yocto: `SIGN_DEPOSIT_YOCTONEAR`, `MINIMUM_CKD_REQUEST_DEPOSIT`) | Code update only (crates/near-mpc-contract-interface/src/deposits.rs:4; crates/contract/src/api/ckd.rs:161) | k of n | Above 1, every call panics with `InsufficientDeposit`. Permanent. |
| `payload_version` 1 | Code update only (crates/near-mpc-contract-interface/src/types/foreign_chain.rs:62-67) | k of n | If V1 is dropped, the args fail to deserialize or nodes bail. `settle` can never succeed. |
| Domain 0, 2 and 3 existence and purpose | No vote removes or edits them. A code update can (crates/contract/src/primitives/domain.rs:103-111) | k of n (code) | `DomainNotFound` or `WrongDomainPurpose` panic (crates/contract/src/api/common.rs:40-56). Permanent. |
| Domain public keys (root and derived) | Unchanged by resharing (crates/contract/src/state/resharing.rs:121-135). Changeable only by a code-level state rewrite | k of n (code). Loss of shares (operators) | If the key changes or shares are lost, signatures never recover to the stored keys and the vault's `ecrecover` rejects them. Permanent. |
| Protocol state (Initializing during domain additions) | `vote_add_domains`, unanimous (crates/contract/src/state/running.rs:206-247) | All n participants | Temporary: new requests panic at submission. Pending ones time out. Retry later. |
| `accept_requests` (TEE health) | `verify_tee` (crates/contract/src/api/attestation.rs:309-333) | Any participant triggers it, attestation state decides | Temporary or indefinite: every request panics with `TeeValidationFailed`. |
| Participants and thresholds | `vote_new_parameters` (unanimous among proposed, k old to admit), or the automatic `verify_tee` kickout | Participants | Transparent: the same keys are used. Requests keep working during Resharing. |
| Base RPC whitelist and quorum | `vote_update_foreign_chain_providers` (crates/contract/src/foreign_chain_rpc.rs:193-213) | k of n | A non-matching whitelist makes Base unavailable. `settle` panics with `ForeignChainNotAvailable` or times out. Cannot be deleted by vote, but can by code (precedent: Bitcoin, crates/contract/src/v3_17_0_state.rs:123-146). |
| Per-node Base support | `register_foreign_chains_config` by each node (crates/contract/src/api/foreign_chain/support.rs:14-33) | Each operator (credentials, config) | Below `required_active_signers`, Base becomes unavailable and `settle` fails. |
| Node RPC config (testnet.toml: Base Sepolia hosts, fingerprint 84532) | New node image (crates/node-config/foreign_chains/testnet.toml:1) | k of n image-hash vote, operators deploy | "Base" means whatever network those hosts serve. The fingerprint is diagnostic only (crates/node/src/foreign_chain_probe.rs:18-20). |
| Inspector semantics (finalized tag, status, canonical check, unanimity plus quorum) | Node release | k of n image vote | Revert, not-found, reorg, not-yet-finalized or RPC disagreement give no response at all, only a timeout `Err` (crates/node/src/providers/verify_foreign_tx/sign.rs:254-256). |
| Yield timeout (200 blocks) | NEAR protocol, not MPC governance (crates/node/src/requests/queue.rs:32-34) | NEAR protocol upgrades (not confirmed here) | The callback gets `Err` after about 200 blocks. A `settle` issued before Base finality is likely to time out and must be re-sent. |
