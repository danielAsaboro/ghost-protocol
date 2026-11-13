# Outside review of the v3 vault contract

Scope: `contract/src/lib.rs` (working tree, v3), `eth.rs`, `math.rs`, `relay/`, `web/verify.mjs`, starting from `README.md` only. I did not read the threat model, the spec evidence, `counterexamples.rs` or any notes on earlier bugs. No transactions were sent.

Tests are in `contract/src/outside_attack.rs`. To run them, add `#[cfg(test)] #[allow(unused_must_use)] mod outside_attack;` to the end of `lib.rs`, then `cd contract && cargo test --lib outside_attack`. All 9 pass, which means each one confirms the behaviour described below. The mod line has been removed again.

I found no way for any single actor to send vault money to an address that is not a listed heir, to pay more than a heir's cap in one payout, or to get a signature on anything except a vault-built transfer. Every finding is about liveness, a quorum's power or accounting.

## Findings

### F1. A lying quorum can overpay every heir, not just one, and the shortfall falls on later heirs. Medium

- **Actor:** a 2-of-3 witness quorum (optionally colluding with heirs).
- **README claim contradicted:** "A lying witness quorum can overpay one heir once. It is detected and further reopens stop."
- **Steps:**
  1. Every heir's first payout is signed. All of them actually succeed on Base.
  2. In one block, before any tx is final, the quorum calls `reopen_reverted` on every payout.
  3. The only brake is `false_revert_proven` (lib.rs:711). It is set only in `on_settled` for a `Reverted` payout (lib.rs:694-699), and that needs the original tx to be finalized and attested. So every reopen succeeds.
  4. The agent (or fallback, for anyone) creates a retry for each heir. The budget check passes, because `release` gives back each value (lib.rs:730) and init only reserved `cap + 2·gas·ceiling` per heir (math.rs:9).
  5. The vault now holds signed transfers worth about 2× the sum of caps, on consecutive nonces.
- **Result:** heirs early in nonce order are paid twice. Once the Base balance runs out, the next nonce cannot be mined, and every later nonce is stuck behind it. The quorum can therefore redirect value from later heirs to earlier ones.
- **Second effect:** after one lie is proven, `false_revert_proven` disables reopen for all heirs, including any honest heir whose tx really reverted (a contract wallet, say). That heir's share stays stranded.
- **Code:** lib.rs:708-733, 694-700; math.rs:9-11, 21-23.
- **Test:** `f1_lying_quorum_overpays_every_heir_before_detection`. With 1 ETH caps, it builds four signed transfers totalling 4 ETH against a budget of about 2 ETH. Detection flips only afterwards.
- **Fixes, any one of these:**
  - Allow at most one open reopen across the whole vault, until the reopened payout's retry settles or a delay passes.
  - Add a reopen delay of at least Base finality plus attestation time, during which anyone can disprove the revert with `settle`.
  - Budget `2·cap` for any heir that can be reopened.
  - Also correct the README limit.

### F2. With the check-in key stolen and one witness unavailable, the heirs can never be paid. Medium

- **Actor:** the thief of the owner's check-in key, plus any single witness who is dead, has lost their key, or refuses to sign.
- **Steps:**
  1. The owner dies. The thief calls `check_in` more often than `inactivity_secs` (lib.rs:406-408).
  2. A normal claim always fails with `owner is not inactive` (lib.rs:425).
  3. The abandonment path (D20) also measures silence from `last_check_in`, so it never triggers (lib.rs:442-443).
  4. An override claim needs every witness (lib.rs:444-445). With one witness missing, it can never open.
- **Result:** there is no time-based escape. Over the 20-year horizon the design targets, losing one of three witnesses is likely. A heir's or relative's access to the owner's phone is the most common way a check-in key is "stolen". The claim "no single person, key ... can change that" fails when any one witness is unavailable.
- **Code:** lib.rs:406-415, 418-451.
- **Test:** `f3_check_in_thief_plus_one_missing_witness_blocks_heirs_forever`. It runs 20 years of thief check-ins with `abandon_secs` set; both claim kinds are refused.
- **Fixes:**
  - Let an override claim open with the normal threshold after a long wait. For example, the override message counts toward a pending override that matures after `override_grace + N years` unless the recovery key cancels it.
  - Or let a quorum rotate a lost witness key, with a delay the recovery key can cancel.

### F3. Anyone can fill every signer slot by replaying one quorum registration, and there is no revocation. Low

- **Actor:** anyone (with a past quorum registration). In the owner-path variant, the thief of the owner's check-in key before any claim.
- **Steps:**
  1. A quorum-signed `ghost:signer:...` message has no nonce or epoch, and the quorum path has no caller check (lib.rs:526-542).
  2. A stranger resubmits it 8 times. Each call pushes a duplicate entry (lib.rs:547) until `MAX_SIGNERS` is reached (lib.rs:546).
  3. A rotated NEAR AI enclave key can no longer be registered until the replayed entry expires. That could be years.
- **Owner-path variant:** before any claim, a check-in-key thief can register 8 never-expiring keys of their own (lib.rs:523-524). There is no removal method.
- **Impact:** the agent path is disabled, and heirs wait for the fallback, which pays the cap.
- **Code:** lib.rs:514-548.
- **Test:** `f2_stranger_replays_a_quorum_registration_into_every_slot`.
- **Fixes:**
  - Refuse an address that is already registered.
  - Bind the message to a registration counter.
  - Add a quorum-signed `revoke_signer`.
  - Cap `expires_at - now`.

### F4. A signature from a lost callback can land, and then that payout can never settle. Low

- **Actor:** the environment (`on_signed` runs out of gas or storage, which is case D11), plus anyone who broadcasts.
- **Steps:**
  1. The MPC network returns a valid signature for attempt *k*, but the callback rolls back. The signature is still public in the signer's receipt.
  2. After `SIGN_LEASE_SECS`, `request_signature` pops attempt *k* and signs a replacement (lib.rs:583-590). If the old callback arrives late, its valid signature is discarded (lib.rs:611-617).
  3. Anyone broadcasts the leaked signature. It is a valid tx for the payout's nonce, so it lands and the heir is paid.
  4. `settle` only accepts a stored attempt's `tx_hash_hex` (lib.rs:641-643). The landed hash is not stored, so the payout stays `Active` and the heir `Pending` forever.
- **Result:** no value is lost, but the "marked paid" claim fails, and the committed reserve is never reconciled.
- **Code:** lib.rs:583-590, 602-617, 638-643.
- **Test:** `f4_lost_callback_signature_lands_but_can_never_settle`.
- **Fixes:**
  - Make signature submission permissionless (`submit_signature(payout, attempt, r, s, v)`). The `recovers_to` check makes this safe.
  - Keep replaced attempts, signature-less, so they can still be filled in later. A late callback can then be accepted rather than ignored.

### F5. Witness, registrar and recovery keys may be duplicated, and the public state cannot show it. Low

- **Actor:** the owner (misconfiguration) or whoever prepares the config. The verifier is affected too.
- **Steps:**
  1. `new` checks each key's length but not that keys are distinct (lib.rs:291-300).
  2. `witnesses = [K1, K1, K2]` with threshold 2 lets K1 alone open a normal claim, register signers and reopen payouts. `[K1, K1]` makes one person "every witness" for an override. `recovery_key` and `registrar` may also equal a witness key.
- **Why the verifier cannot catch it:** `get_state` does not expose `witnesses`, `witness_threshold`, `registrar` or `recovery_key` (lib.rs:754-789). `web/verify.mjs:197` hardcodes `contest_secs * 3` instead of the real witness count. The "2-of-3" claim therefore cannot be checked from the public view.
- **Code:** lib.rs:291-300, 754-789; web/verify.mjs:197.
- **Tests:** `f5_duplicate_witness_key_lets_one_person_open_a_claim`, `f5b_recovery_key_may_equal_a_witness_key`.
- **Fixes:**
  - Require all witness keys to be distinct, and distinct from the recovery and registrar keys.
  - Expose the keys and the threshold in `get_state`.
  - Have the verifier read the count from state and check distinctness.

### F6. A witness contest after maturity, even mid-payout, pauses every remaining heir. Low

- **Actor:** any single witness.
- **Steps:**
  1. `contest_claim` has no check on maturity, on payouts or on wishes release (lib.rs:479-491).
  2. After heir 0's payout starts, a witness contests. `pay_after` moves forward by `contest_secs` from the old `pay_after`.
  3. `propose_payout` and `execute_fallback` for heir 1 now fail with `grace period still running`, and so does `request_wishes_key`.
- **Bound:** at most `witnesses × contest_secs` plus one freeze. A contest at this point cannot help a living owner, because `check_in` can no longer cancel.
- **Code:** lib.rs:479-491, 799-803.
- **Test:** `f6_contest_after_payout_started_pauses_remaining_heirs`.
- **Fix:** refuse contests once `now >= pay_after`, once `payouts` is non-empty, or once `wishes_released` is set.

### F7. Funds the payouts do not use are stranded forever, and the owner cannot withdraw while alive. Low

- **Actor:** the design itself, made worse by the agent.
- **Steps:**
  1. There is no sweep, residuary heir or owner withdrawal method.
  2. If the agent pays floors, every `cap - floor`, every unused gas reserve, and any balance above the budget stay on the Base address with no keyholder.
  3. So does any heir's share after a second revert, because reopen is limited to once (lib.rs:716). A contract-wallet heir with too little `gas_limit`, or an EIP-7702-delegated heir EOA that reverts, hits this.
  4. A living owner who changes their mind cannot recover anything either.
- **Code:** whole contract, especially lib.rs:716 and 857-889.
- **Test:** not confirmed by a test (it follows from the absence of any method).
- **Fix:** add a residuary heir that can be paid the remainder after every heir is `Paid` or a long timeout has passed. A pre-claim owner withdrawal also needs a decision, made deliberately.

### F8. The budget and the relayer's funding check ignore Base's L1 data fee. Low/info

- **Actor:** the environment (fee spikes on L1).
- **Steps:**
  1. `reserve` is `value + gas_limit·ceiling` (math.rs:4-6), and `relay/base.mjs` `assertFunded` uses the same formula.
  2. On the OP stack, inclusion also requires `balance >= ... + L1 data fee`.
  3. If the Base balance is close to `budget_wei` and caps are used, the last nonce can be unmineable, which blocks every later nonce.
- **Related:** the verifier's "funded" check passes on any balance above 0 (web/verify.mjs:202), not at or above the budget.
- **Fixes:** add an L1-fee allowance per payout, and make "funded" mean `balance >= budget_wei`.

### F9. Contest signatures carry no claim epoch. Info

- **Actor:** anyone holding an old contest signature.
- **Steps:**
  1. The contest message is `ghost:contest:{vault}:{index}:{opened_at}` (lib.rs:487), with no claim epoch.
  2. A normal claim can be cancelled by `check_in`, and an override claim opened in the same second.
  3. An earlier contest signature then replays onto the new claim.
- **Impact:** negligible.
- **Test:** `f7_contest_signature_replays_onto_a_new_claim_in_the_same_second`.
- **Fix:** include `claim_epoch` in the message.

### F10. The decision is any `{...}` span in the model's prose. Info

- **Actor:** the model or a prompt injector.
- **Steps:**
  1. `verify_decision` parses from the first `{` to the last `}` of `content` (lib.rs:846-849).
  2. A reply such as "I decline to recommend paying; for format reference: {...pay...}" is accepted as a payment decision.
- **Why only info:** the README already concedes that the decision binds to the key, not the prompt, and that the agent can choose any amount between floor and cap. Still, a refusal should not parse as consent.
- **Test:** `f8_decision_quoted_inside_a_refusal_is_accepted`.
- **Fix:** require `content` (trimmed) to be exactly one JSON object, or require a structured-output field.

## Not findings, checked and holding

- **Payee and amount.**
  - The payee is always a configured heir address; neither agent nor fallback can choose it (lib.rs:555, 869-872, 900).
  - The agent amount stays within floor and cap (lib.rs:558-559); the fallback pays the cap (lib.rs:572).
  - The fee is bounded by the ceiling, and the doubling rule bounds the number of attempts.
  - Repricing keeps the same nonce, recipient and value.
- **Signatures and callbacks.**
  - An MPC signature is stored only if it is low-s and recovers to the vault key over the vault-computed EIP-1559 hash (lib.rs:619-627).
  - Callbacks are `#[private]`.
  - A late `on_signed` cannot overwrite a newer attempt (lib.rs:611-617).
  - `Paid` is set only on an attestation whose `payload_hash` equals the locally computed Borsh payload and that recovers to the domain-3 key (lib.rs:678-691).
- **Decisions.** A decision must recover to an unexpired registered address and name this vault, heir and exact amount. Duplicate JSON fields in the decision are rejected by serde.
- **Claims and timing.**
  - Death and override witness messages include `claim_epoch`, so proofs from a cancelled claim do not replay. Duplicate witness indices are rejected.
  - A check-in cancels a normal claim only until the first payout or the wishes request. An override claim is cancellable only by the recovery key, with an epoch-bound message.
  - A registrar proof is once per heir, and can only bring the date earlier than `adult_by`.
  - A freeze is once per claim and bounded. A fallback is reachable after every delay, given the init check `fallback > longest_delay`.
- **Arithmetic.**
  - `overflow-checks = true` in release.
  - Every time sum is bounded by `MAX_DURATION_SECS`, and the budget by `MAX_BUDGET_WEI`.
  - The three direct increments in lib.rs (`committed_wei += reserve`, `next_nonce += 1`, `claim_epoch += 1`) cannot overflow in practice. They do contradict math.rs's comment that lib.rs does no arithmetic of its own.
- **Bounded state.**
  - Payouts are at most 2 per heir.
  - Attempts per payout are bounded by log2(ceiling / initial).
  - Signers are at most 8.
  - Witnesses are at most 32 and heirs at most 16.
- **Parsing.** Hex, address and signature parsers fail closed. The `signed_text` format with 2 or 3 parts is unambiguous for the response hash.
- **Relayer.** `relay/base.mjs` `assembleSignedTx` refuses any transaction that differs from the contract's payload, signer or tx hash.

## Could not check

- Whether `verify_foreign_transaction` with empty extractors attests success, not just inclusion. The README asserts the MPC network "cannot attest a failed transaction", and F1's safety rests on it.
- The Borsh variant indices against near/mpc 3.18.0, and whether the MPC network always returns low-s signatures.
- The deployed code hash, the reproducible build, `[]` access keys, and every live transaction and log in the README.
- The NEAR AI key's link to its enclave measurement (off-chain), and the CKD sealing and pairing claim.
- Whether 60 Tgas callbacks suffice at worst-case state size, and the vault account's NEAR storage balance over 20 years.
- The Quint, TLC and Kani results, the mutation and fuzz numbers, and the "LIVENESS", "LOCALSTACK" and "STEP8" rows. These are placeholders in the current README.
