# nearcore and OP Stack / Base: 20-year dependency evidence

Scope: what the vault in `contract/src/lib.rs` and `contract/src/eth.rs` relies on below the MPC layer. The MPC network is covered in `mpc-governance.md`.

Sources and pins:

- nearcore `master` at `7fe46a53158e63ff56ecd6f10e4382e2d02c44e7` (2026-11-12), sparse clone at `/Users/MAC/development/near-hackathon-research/src/nearcore`. All `path:line` citations without a tag refer to this commit.
- Historical nearcore tags, fetched shallow into the same clone: `1.30.0`, `2.6.0`, `2.10.0`, `2.14.1`. Cited as `<tag>:path:line`.
- near-sdk `5.30.1` (the version in `Cargo.lock`), from `~/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/near-sdk-5.30.1`.
- OP specs `main` (fetched 2026-11-12): https://github.com/ethereum-optimism/specs
- op-geth `optimism` at `79e9d244748a1201fe686ca8a882b5fe7e173348`.
- Live RPC samples from `https://sepolia.base.org` and `https://mainnet.base.org` at 2026-11-12 23:08 UTC.

Quotes are kept to 15 words or fewer.

---

## Part A: nearcore

### A1. Host-function semantics

**`ecrecover`**

- Signature: `ecrecover(hash_len, hash_ptr, sig_len, sig_ptr, v, malleability_flag, register_id) -> u64`. It writes the 64-byte `x || y` public key to the register. [runtime/near-vm-runner/src/imports.rs:170; runtime/near-vm-runner/src/logic/host.rs:1914-1949]
- Flag `0` does no extra checks. Flag `1` rejects the upper range of `s`. [host.rs:1926-1927]
- `s` must be below `SECP256K1_N_HALF_ONE` (n/2 + 1) when the flag is set, and below `n` otherwise. `r` must always be below `n`. [core/crypto/src/signature.rs:928-933, 941-958]
- `v` must be 0..=3. A larger value is a host **error** (`ECRecoverError`), which aborts the call. The same happens for a signature that is not 64 bytes, a hash that is not 32 bytes, or a flag other than 0 or 1. [host.rs:1972-1979, 1956-1963, 1987-1994, 2005-2010]
- Out-of-range `r`/`s`, or a failed recovery, returns `0` and is **not** an error. [host.rs:2013-2028]
- near-sdk maps `0` to `None`. [near-sdk-5.30.1 src/environment/env.rs:596-618]
- Effect on this contract: `recovers_to` and `verify_decision` pass `true` and `v ∈ {0,1}` (lib.rs:247-251, 730-739), so they never hit the error path. A high-`s` signature from the MPC network returns `None`. In `on_signed` that discards the attempt. In `verify_decision` it panics ("decision signature does not recover"). For the decision signer to work, it must emit low-`s` signatures. EIP-2 already requires low-`s` for Ethereum transactions.

**`ed25519_verify`**

- Signature must be exactly 64 bytes and the public key exactly 32 bytes. Any other length is a host **error** (`Ed25519VerifyInvalidInput`). [host.rs:2038-2041, 2077-2083, 2108-2113]
- If the top 3 bits of the last signature byte are set, it returns `0`. [host.rs:2032-2034, 2084-2090]
- A key that does not decode returns `0`. [host.rs:2114-2117]
- Verification uses `ed25519_dalek` `verify`, not `verify_strict`. The docs say "Small-order public keys are accepted." [host.rs:2032, 2120-2123]
- Effect: the contract's `key32` and `sig64` helpers panic before calling the host on a bad length (lib.rs:219-225). Witness and registrar keys are fixed at `new`, so accepting small-order keys only matters if a deployer supplied a weak key. Unconfirmed: whether `new` should reject small-order keys.

**`sha256` / `keccak256`**

- Both are plain digests (`sha2::Sha256::digest`, `sha3::Keccak256::digest`) written to a register. Their only failure modes are memory and register limits. [host.rs:1653-1679, 1691-1717]

**`block_timestamp`**

- Returns `ctx.context.block_timestamp` in nanoseconds. [host.rs:877-885] near-sdk's `block_timestamp_ms` divides by 1e6. [env.rs:400-402]

**Are host functions ever removed or changed?**

- Runtime parameters are versioned. A base `parameters.yaml` plus per-version diffs (`V.yaml`) are applied cumulatively, and `old:` must match. [core/parameters/res/README.md; core/parameters/src/config_store.rs:19-37, 49-85]
- Old diffs are squashed into the base once versions drop below `MIN_SUPPORTED_PROTOCOL_VERSION`:
  - At `2.6.0` the diffs ran from `35.yaml` to `77.yaml`. [`2.6.0` `core/parameters/res/runtime_configs/`]
  - At `master` only `87, 88, 89, 150, 157` remain. [config_store.rs:32-38]
  - `MIN_SUPPORTED_PROTOCOL_VERSION` was 29 at `2.6.0`, 84 at `2.14.1` and is 85 now. [`2.6.0`:core/primitives-core/src/version.rs:317; `2.14.1`:…:670; version.rs:178]
- The binary keeps no execution semantics for versions below the minimum. The source says some old features "may no longer be available in the current binary" (Wasmer0/Wasmer2 removed). [version.rs:181-187] Old semantics are **not** kept forever. A deployed contract always runs under the newest protocol's VM and costs.
- Feature gates are deleted once every supported version has the feature:
  - `2.6.0` gated `#[math_extension] ecrecover`, `#[ed25519_verify] ed25519_verify` and `#[yield_resume_host_functions] promise_yield_create`. [`2.6.0`:runtime/near-vm-runner/src/imports.rs:127,135,233]
  - On `master` all three are ungated. [imports.rs:142-170, 323]
- No evidence was found of a host function being removed or having its semantics changed for live contracts. Changes found are of two kinds:
  - Cost changes, such as `wasm_ecrecover_base` cut from 3.37 Tgas to 0.279 Tgas at v48. [`2.6.0`:…/48.yaml:2]
  - Bug fixes behind new flags, such as `bls12381_not_in_group_fix` at v89. [89.yaml:5]
  - The ed25519 comment says a legacy check was kept "to avoid costs changing." [host.rs:2085-2087]
  - Unconfirmed: no written NEAR policy guarantees host functions will never be removed.
- **A real deprecation path for deployed code:** Wasm preparation limits are part of the VM config. A config change changes the compiled-contract cache key, so the contract is re-prepared under the new limits. [runtime/near-vm-runner/src/cache.rs:45-66; wasmtime_runner/mod.rs:593, 674]
  - New limits have been added to existing chains: `max_function_body_size`, `max_blocks_per_function`, `max_operand_stack_bytes_per_function` and others at v84 [`2.14.1`:…/84.yaml], and `min_contract_size_per_local: 2` at v87 [87.yaml:9-11].
  - The VM itself was replaced: Wasmer2 to NearVm at v62, NearVm to Wasmtime at v84. [`2.14.1`:…/62.yaml, 84.yaml]
  - An immutable contract that broke a future limit would fail to load for every call. The CHANGELOG notes a failed module load now "charges the contract-loading fee and aborts". [CHANGELOG.md:39]

### A2. Yield/resume

- The vault does not call `promise_yield_*` itself. The MPC contract's `sign` and `verify_foreign_transaction` do. The vault only sees the result as `PromiseError` in `#[callback_result]`.
- Timeout: `yield_timeout_length_in_blocks: 200`. [parameters.yaml:359; parameters.snap:261] It has been 200 since at least `2.6.0`. [`2.6.0`:…/parameters.yaml:233]
- The timeout is counted in **blocks**: expiry is `block_height + yield_timeout_length_in_blocks`. [runtime/runtime/src/function_call.rs:60-69] Faster NEAR blocks shorten the wall-clock window. Unconfirmed: current mainnet block time is not in this repo.
- On timeout, the runtime creates a `PromiseResume` receipt with `data: None` [runtime/runtime/src/lib.rs:3366-3392]. The callback runs with "input `PromiseResult::Failed`" [host.rs:4279-4280].
- The MPC contract's own callback then fails, so the vault's `on_signed` and `on_settled` see `Err` and return `false`. `on_signed` clears `signing` and truncates the attempt (lib.rs:538-547). That is safe **only if `on_signed` itself runs to completion** (see A3 and A4).

### A3. Storage staking

- `storage_amount_per_byte: 10^19 yN` (1e-5 NEAR/byte, 1 NEAR per 100 kB). [parameters.yaml:51; parameters.snap:23]
- History: one change, a **decrease** from `100_000_000_000_000_000_000` to `10_000_000_000_000_000_000` at v42. [`2.6.0`:…/42.yaml:1] No other diff touched it through `2.14.1` or `master`.
- Check: after all actions of **any** action receipt, the runtime calls `check_storage_stake`. On failure the whole receipt fails with `LackBalanceForState` and its state changes are dropped (the account is not written back). [runtime/runtime/src/lib.rs:1141-1163]
- The rule: `amount + locked >= storage_usage * storage_amount_per_byte`. It is waived only for accounts of at most 770 bytes. [runtime/runtime/src/verifier.rs:31, 54-92]
- Anyone can top up. `Transfer` carries no actor restriction [runtime/runtime/src/actions.rs:777-780]. It simply adds to `amount` [actions.rs:159-164]. Because the check runs after the actions, a transfer that brings the balance up to the requirement succeeds even if the account was short before. A transfer too small to close the gap fails and is refunded.
- 1-yocto deposits: since v85 (`one_yocto_on_promise`), a 1-yocto function-call deposit is subsidised **only when the balance is exactly zero**. Otherwise it is deducted. [`2.14.1`:…/85.yaml:1; runtime/near-vm-runner/src/logic/tests/promises.rs:896-952] The vault always holds a storage stake, so it pays 1 yocto per `sign`, `verify_foreign_transaction` and `request_app_private_key`.
- **Contract-specific consequence (inferred from the contract and the runtime rule above):**
  - `begin_attempt` sets `payouts[i].signing = true` and commits it (lib.rs:823).
  - Only `on_signed` clears it (lib.rs:538). There is no other reset path; `grep signing` finds lines 98, 517, 538, 784 and 823 only.
  - If `on_signed` ever fails as a receipt, its state change is reverted and `signing` stays `true` forever. Possible causes: `LackBalanceForState` from the attempt fields it writes, exceeding its fixed 60 Tgas, or any panic.
  - `request_signature` then always fails with "signature already in flight" (lib.rs:517).
  - That nonce never gets a signature, so every later payout with a higher nonce can never be mined on Base.

### A4. Gas limits and gas price

- Current values: `max_gas_burnt` 1 PGas, `max_total_prepaid_gas` 1 PGas. [parameters.yaml:317, 328]
- History, all **increases**:
  - `max_gas_burnt` 200 Tgas to 300 Tgas at v52. [`2.6.0`:…/52.yaml:1-2]
  - `max_gas_burnt`, `max_gas_burnt_view` and `max_total_prepaid_gas` 300 Tgas to 1 PGas at v83. [`2.14.1`:…/83.yaml:5-8]
  - At `2.6.0`, `max_total_prepaid_gas` was 300 Tgas. [`2.6.0`:…/parameters.yaml:208, 219]
- The vault's 150 + 60 Tgas chains fit with large margin today.
- The **per-callback** amount is fixed in the wasm (`CALLBACK_GAS = 60 Tgas`, lib.rs:20). Per-operation costs do move. Examples:
  - `wasm_contract_loading_bytes` rose 5x at v66 (216,750 to 1,089,295 gas/byte). [`2.14.1`:…/66.yaml:15-18]
  - The Wasmtime linear-op costs were introduced at v84. [84.yaml]
  - Storage-read and trie-node gas fell at v72 and v82. [72.yaml; 82.yaml]
  - The callback deserialises and re-serialises the whole `Vault` (one borsh blob, including all `payouts` and `signers`). Its cost therefore grows with state.
  - Unconfirmed: no measurement here of `on_signed` and `on_settled` gas at maximum state.
- Gas price:
  - Mainnet and testnet (genesis v29) override the genesis minimum with `MIN_GAS_PRICE_NEP_92_FIX = 100_000_000 yN`. [chain/chain/src/types.rs:206-212; core/primitives/src/version.rs:25-26]
  - Max is `min(genesis_max, 20 × min)`. [types.rs:198, 214-219]
  - Since v85, `min_gas_purchase_price: 1_000_000_000` means attached gas is bought at no less than 1e9 yN/gas, 10x the floor. [`2.14.1`:…/85.yaml:41; core/primitives/src/fees.rs:478-482, 550-555]
  - Unused gas is refunded at the burn price.
  - Effect: the caller of `propose_payout` / `request_signature` / `settle` must prefund about 210 Tgas × 1e9 = 0.21 NEAR (mostly refunded). The vault pays no gas.
  - Gas rewards to contracts were removed at v87 (30% to 0%). [87.yaml:1-7] The vault can no longer earn its own storage top-ups from gas.

### A5. Deleting or freezing an account with zero access keys

- None found; this is confirmed in the runtime code read.
- `DeleteAccount` (and `AddKey`, `DeployContract`, `DeleteKey`, `Stake`) requires `actor_id == account_id`. [runtime/runtime/src/actions.rs:739-776] Only the account itself can act, and a keyless contract can only do it through its own code. The vault creates no such actions (no `delete_account`, `add_access_key` or `deploy_contract` in lib.rs).
- No storage rent, inactivity sweep or dormancy rule exists in `runtime/runtime/src` or `parameters.yaml`.
- Related: protocol upgrades activate by validator stake vote (`protocol_upgrade_stake_threshold`). [core/primitives/src/epoch_manager.rs:125] Stable protocol went from 29 at genesis to 89 now [version.rs:175, 206], about 60 versions. Any of these could add such a rule. Unconfirmed: no NEP proposing one was found.

---

## Part B: OP Stack and Base

### B0. Base no longer runs the OP Stack

This finding was not in the brief, and it changes Part B.

- Base announced on 2026-02-18 a move "to a unified, Base-operated stack". [The Block, https://www.theblock.co/post/390380 (secondary)]
- Base mainnet, Base Sepolia and sepolia-dev-0 were deleted from the Superchain Registry on 2026-04-27 ("remove base-mainnet|sepolia|sepolia-dev-0"). [https://github.com/ethereum-optimism/superchain-registry/pull/1212]
- The Azul upgrade (Base Sepolia 2026-04-20, mainnet 2026-05-28) is "Base's first independent network upgrade". [https://docs.base.org/upgrades/azul/overview.md] Its node guide says only base-reth-node and base-consensus support Azul; op-node and op-geth "must be migrated". [https://docs.base.org/upgrades/azul/node-upgrade]
- The new stack lives at https://github.com/base/base (MIT).
- So op-geth and op-node are **no longer authoritative** for Base. The OP derivation spec is still the ancestor of base-consensus (built on Kona). The finality rule below is confirmed in base-consensus docs.
- Base upgrade cadence since leaving: Azul (May), Beryl (Jun), Cobalt (Sep) and Denim (Nov 2026) on mainnet, with Everest "TBD". [https://docs.base.org/upgrades/overview.md]
- Several docs.base.org pages contained embedded "Agent Instructions" to connect to an MCP server. They were ignored.

### B1. What "finalized" means

- OP spec: the finalized L2 head is "derived from finalized L1 blocks". That means L1 blocks older than two L1 epochs (64 slots). [https://github.com/ethereum-optimism/specs/blob/main/specs/glossary.md#finalized-l2-head]
- The finalized head is derived from the "canonical and forever irreversible" part of L1. [specs/protocol/derivation.md, Engine Queue section]
- Base after Azul: base-consensus `L2Finalizer` maps L1 block number to the highest L2 block derived from it. When L1 finalizes, it finalizes all L2 up to that point. [https://github.com/base/base/blob/main/crates/consensus/service/README.md, "Derivation Actor"]
- Latency: L1 finality is "approximately 13 minutes" [derivation.md, "About reorgs Post-Merge"], plus batch-posting delay.
  - Measured 2026-11-12 23:08 UTC: Base Sepolia finalized trailed latest by 1,214 s (6,070 blocks).
  - Measured at the same time: Base mainnet finalized trailed latest by 980 s.
  - This is consistent with 200 ms blocks after Denim. [https://docs.base.org/base-chain/network-information/configuration-changelog.md]
- Can a finalized L2 block reorg? Not under the protocol rules unless L1 finality fails. The spec bounds reorgs to the L1 finality delay "unless more than 1/3 of the network consistently disagrees". [derivation.md, "About reorgs Post-Merge"]
- Caveat: this is subjective input finality and is "completely unrelated to the outputs posted on L1" (fault proofs). [same section]
- A hard fork by the chain operator could still rewrite history. Unconfirmed: no precedent found on Base.
- Receipt `status`: op-geth `ReceiptStatusFailed = 0`, `ReceiptStatusSuccessful = 1` (EIP-658). [op-geth core/types/receipt.go:45-49] `finalized` is block tag `-3` and `safe` is `-4`. [op-geth rpc/types.go:67-68] Unconfirmed: base-reth-node source was not read, but reth follows the same EIP-658 receipt encoding.

### B2. Unsafe and safe reorg conditions

- Unsafe blocks are blocks the node knows but that were "not derived from the L1 chain", for example gossiped by the sequencer. [glossary.md#unsafe-l2-block]
- An unsafe block becomes safe when the L1-derived attributes match it exactly. If they don't, the derived attributes win, "creating an L2 chain reorg on top of the current safe block". [derivation.md, "L1-consolidation"]
- "The safe L2 head may only be reorged out due to L1 reorgs." [derivation.md, Engine API section]
- Sequencing window `seq_window_size = 3600` L1 blocks (about 12 h) on both Base chains. [superchain-registry @720185c3 superchain/configs/{sepolia,mainnet}/base.toml:12]
- If the batcher posts nothing within the window, empty or deposit-only batches are derived. [derivation.md:616] Unsafe blocks from that period are then replaced.
- Effect: the contract asks for `Finalized` only (lib.rs:565), so unsafe and safe reorgs cannot produce a false `Settled`. They can only delay it.

### B3. EIP-1559 parameters and base-fee behaviour on Base

- Last OP-registry genesis values [superchain-registry @720185c3]:
  - Base Sepolia: elasticity 10, denominator 50 before Canyon and 250 after.
  - Base mainnet: elasticity 6, denominator 250.
- Since Holocene these are `SystemConfig` values the operator can change. Base docs: they "can change without a protocol upgrade". [https://docs.base.org/base-chain/network-information/network-fees.md]
- Current values (network-fees page, 2026-11):
  - Mainnet: elasticity 5, denominator 1000, gas limit 40M, target 8M.
  - Base Sepolia: elasticity 15, denominator 1000, target 8M.
  - Both have a minimum base fee of 5,000,000 wei (0.005 gwei).
- Changes recorded in the configuration changelog [https://docs.base.org/base-chain/network-information/configuration-changelog.md]:
  - Mainnet minimum base fee: 200,000 wei (2025-12-04), then 500,000, 1,000,000, 2,000,000, and 5,000,000 (2026-02-19). That is 25x in 11 weeks.
  - Base Sepolia minimum base fee: 200,000 wei (2025-11-20), then 2,000,000 (2026-02-10), then 5,000,000 (2026-02-19).
  - Mainnet denominator: 125 (2026-02-04), then 100 (2026-03-25), then 1000 (2026-11-05). Elasticity set to 5 on 2026-03-25.
  - The docs say the minimum base fee "may be periodically adjusted".
  - Per-transaction gas cap 2^24 (EIP-7825) since Azul.
- Live sample 2026-11-12 (last 1,025 blocks):
  - Base Sepolia base fee min = max = 5,000,000 wei.
  - Mainnet base fee 5,000,000 to 5,018,964 wei.
- Historical extremes:
  - Mainnet 2024-03-19 had record fees. DL News reported the spike date and revenue but gave no gwei figures. [https://www.dlnews.com/articles/markets/coinbases-fee-revenue-from-its-base-network-spikes/]
  - A widely repeated secondary figure says activity fell only after "L2 gas hit 4 gwei" (attributed to Michael Silberling, Optimism Labs). Unconfirmed: primary post not retrieved.
  - Base Sepolia extremes: no source found (unconfirmed).
- Effect: the deploy script uses `max_fee_ceiling = 5 gwei` and `initial = 0.1 gwei` (scripts/ghost.mjs:95, 104). That is 1,000x the current floor. The only reported spike (about 4 gwei, mainnet, 2024) came within 1.25x of the ceiling. Mainnet's floor rose 25x in one quarter.
  - The ceiling is immutable, so the contract fails if the floor ever exceeds 5 gwei. It stalls rather than fails if the base fee stays above the ceiling for the life of a payout.
- Related Ethereum change, unconfirmed for Base: EIP-2780 (Last Call, deadline 2026-11-01, no fork named) keeps the 21,000 intrinsic cost.
  - It adds a runtime state charge of 183,600 gas for a value transfer to a non-existent account. [https://eips.ethereum.org/EIPS/eip-2780]
  - If Base adopts it, a payout with the immutable `gas_limit: 21000` (ghost.mjs:108) to a never-used heir address would revert with status 0.
  - The retry would use the same `gas_limit` (lib.rs:803) and revert again.

### B4. Base Sepolia lifecycle

- Precedent, Base Goerli:
  - Deposits on the Base Goerli bridge stopped 2024-01-19.
  - Goerli references were removed from the docs 2024-01-31.
  - Infrastructure including the bridge shut down 2024-02-09. [Coinlive summary of Base's post https://base.mirror.xyz/-1DzslYOS7HRrbOrHdcz5sZmfIF_tpxJ-NRvcMmZ75c; the original returned HTTP 403, so the dates are confirmed only via secondary sources]
  - Alchemy says Base announced the shutdown on Discord on 2024-01-29, 11 days before shutdown, and kept its nodes until 2024-02-16. [https://www.alchemy.com/blog/base-goerli-testnet-deprecation]
  - The trigger was the deprecation of Ethereum Goerli.
- Upstream: an EF DevOps lead (parithosh) proposed on 2026-05-27 to replace Sepolia. The proposal would "sunset it fully in Q2/Q3 2027". [https://ethereum-magicians.org/t/sepolia-testnet-replacement-sunsetting/28647] This is a proposal; there is no EF decision yet (unconfirmed). Sepolia's state growth is the stated reason.
- No Base announcement of a Base Sepolia end date was found. The upgrades page says nothing about testnet deprecation. [https://docs.base.org/upgrades/overview.md]
- Effect: the contract requires `chain_id == 84532` (lib.rs:278). It also pins MPC enum indices for `Base` and `Finalized` (eth.rs:122-125). If Base Sepolia shuts down or its L1 is replaced, no payout can ever settle. On a 20-year horizon this is near-certain.

### B5. Fault proofs and withdrawal finality

Skipped per brief.

---

## Dependency table

| Dependency | How it changes | Who | Frequency evidence | Effect on this contract |
|---|---|---|---|---|
| NEAR host fns `ecrecover`, `ed25519_verify`, `sha256`, `keccak256`, `block_timestamp` | Protocol upgrade (feature gates, cost diffs). Semantics unchanged so far; gates removed once universal | nearcore devs, activated by validator stake vote | About 60 protocol versions from v29 to v89; ecrecover cost cut 12x at v48 | Low. Behaviour stable. Malleability flag means MPC and enclave must emit low-s |
| Wasm VM and preparation limits | VM swapped twice (v62, v84). New per-contract limits at v84 and v87 apply to deployed code on recompile | nearcore devs, validators | 2 VM swaps and 2 limit batches in about 2 years | Medium. A future limit the wasm breaks would make every method fail to load, with no redeploy possible |
| `MIN_SUPPORTED_PROTOCOL_VERSION` / old semantics | Raised; old diffs squashed into base | nearcore devs | 29 at 2.6.0, 84 at 2.14.1, 85 now | Contract always runs under latest rules. No version pinning exists |
| Yield/resume (inside MPC) | `yield_timeout_length_in_blocks` param | nearcore devs | 200 since at least 2.6.0 | Timeout returns `PromiseError` and is handled. The window shrinks if NEAR blocks get faster |
| Callback gas (fixed 150 / 60 Tgas) | Per-op gas costs in diffs; prepaid caps | nearcore devs | Caps only rose (200T to 300T to 1P). Some costs rose (contract loading 5x at v66) | **High.** If `on_signed` ever runs out of 60 Tgas, `signing` sticks `true` forever and that nonce and all later ones are dead |
| Storage staking (`payouts`, `attempts`, `signers` grow) | `storage_amount_per_byte` | nearcore devs | One change ever, a decrease (1e20 to 1e19 at v42) | A shortfall fails the receipt with `LackBalanceForState`. Anyone can fix it with a plain Transfer. A shortfall during `on_signed` is the same stuck-`signing` failure |
| 1-yocto deposits from vault balance | `one_yocto_on_promise` (v85) subsidises only at zero balance | nearcore devs | Once | Negligible cost, but it draws on the storage stake |
| NEAR gas price for callers | `min_gas_purchase_price` 1e9 (v85); floor 1e8; max 20x floor | nearcore devs, validators | Purchase floor raised 10x once | Callers prefund about 0.21 NEAR per sign or settle; the vault pays nothing |
| Account deletion or freezing | Only via `DeleteAccount` by the account itself | n/a | No rent or dormancy rule found | None today. A future NEP could add one (unconfirmed, none found) |
| Base chain software | Left OP Stack (Feb 2026); base-reth-node + base-consensus | Base (Coinbase) alone; Optimism governance removed | 4 mainnet upgrades May to Nov 2026 | Settlement semantics now set by one operator. op-geth and op-node no longer apply |
| `Finalized` on Base | Derived from finalized L1; about 16-20 min today | Base; Ethereum L1 consensus | Rule unchanged since Bedrock; block time 2 s to 200 ms (Denim) | Low risk of a false settle. Depends on the MPC still exposing `Finalized` at pinned enum index 2 |
| Receipt `status == 1` | EIP-658 | Ethereum / Base EL | Stable since Byzantium (2017) | Low |
| EIP-1559 params / min base fee on Base | `SystemConfig`, changed without a hard fork | Base operator | Mainnet: min base fee 5 changes in 11 weeks (25x); denominator 3 changes in 2026 | **High over 20 years.** The immutable 5 gwei ceiling is 1,000x the floor today. The only reported spike was about 4 gwei (mainnet, 2024, secondary) |
| Intrinsic gas for value transfer | EIP-2780 (Last Call) adds 183,600 state gas to new accounts | Ethereum ACD, then Base adoption | Not scheduled (unconfirmed for Base) | **High if adopted.** `gas_limit` 21,000 is immutable, so transfers to fresh heir addresses revert, and the retry reverts too |
| Per-tx gas cap | EIP-7825, 2^24 | Base (Azul) | Once | None (`MAX_GAS_LIMIT` 2M) |
| Base Sepolia (84532) existence | Testnet shutdown; L1 Sepolia replacement | Base; Ethereum devs | Base Goerli: about 11 days' notice (2024). Sepolia sunset proposed Q2/Q3 2027 | **Critical.** `chain_id` is hard-required, so no payout can settle after shutdown |
| MPC network | See `mpc-governance.md` | NEAR MPC operators | n/a here | Out of scope for this file |
