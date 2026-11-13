# Formal spec results (step 2)

Spec: [spec/ghost.qnt](../../../spec/ghost.qnt), Quint 0.33.1, TLC through `quint verify --backend=tlc` (Apalache 0.62.4 for the translation, OpenJDK 21).

Actors, the clock, Base (inclusion, revert, reorg before finality, finality, fee moves), the MPC network's answers and every dependency failure from [step 1](../../threat-model.md#dependencies-over-20-years) are nondeterministic steps. Witnesses become adversarial at a nondeterministic moment; after that any quorum signs anything the contract accepts.

## Against the deployed contract (v2)

| # | Invariant | Found by | What happened | Test |
|---|---|---|---|---|
| 1 | `inv_wishes` (I15) | `quint run`, seed `0xefafe` | Claim matures, the wishes key is requested, then the owner's check-in (or the recovery key, for an override) cancels the claim. The wishes are out while the vault says nobody died | `cex1_*` in [counterexamples.rs](../../../contract/src/counterexamples.rs) |
| 2 | `inv_signing_has_callback` (I19) | `quint run`, seed 7 | `on_signed` is lost (out of gas or storage; its changes roll back). `signing` stays true, `request_signature` refuses forever, that nonce and every later one are dead | `cex2_*` |
| 3 | `inv_budget` (I7) | TLC, [log](tlc-v2-cex-committed.log) | A lying quorum reopens a payout that landed. The MPC network then attests it; `committed_wei` still excludes the value that left, so later payouts are signed against money that is gone | `cex3_*` |
| 4 | `inv_reopen` (I17), honest witnesses | TLC, [log](tlc-v2-cex-reorg-revert.log) | Witnesses sign a revert before Base finality. A reorg turns it into a success, and the retry also lands: the heir is paid twice | Procedure D23: witnesses must wait for finality. The model's honest witnesses now do |
| 5 | `inv_paid_once` (I3) | TLC, [log](tlc-v2-cex-stated-overpay.log) | A lying quorum's reopen is disproved after the retry exists: the heir is `Paid` with a live retry | Already a stated limit of I17; the invariant now states it exactly |

All four tests fail on the deployed code: [counterexamples-v2-failing.txt](counterexamples-v2-failing.txt).

## Trace replay (ITF)

`spec/gen-traces.sh` writes 600 traces with fixed seeds (400 without dependency failures, 200 with). [itf_replay.rs](../../../contract/src/itf_replay.rs) runs each step on the Rust contract and compares the contract's state, projected onto the model's variables, after every step. On the deployed code: 600 traces, 24,000 steps, every state equal. A one-character bug injected into `contest_claim` (`+ 1` on the contest delay) fails the replay at its first contest.

Run: `spec/gen-traces.sh && (cd contract && cargo test --lib itf_replay -- --nocapture)`.

## Against v3

The model was updated with each fix (v3 at `cb86882`, v3.1 after the outside review at `e73a181`): the claim is permanent once the wishes key is requested; a lost sign request is replaced after a one-day lease and its signature, if public, can be submitted by anyone; a disproved revert counts its value again; a retry waits a day after a reopen; a quorum override waits twice as long; contests only during grace; a no-witness claim after `ABANDON` of silence.

| Run | Result |
|---|---|
| `quint run`, 5 seeds (including the two that broke v2) x 20,000 traces x 40 steps | No violation of `safety` |
| TLC, `TINY=1`, v3 | One more counterexample, [log](tlc-v3-cex-budget-after-false-revert.log): with the restore, committed exceeds the budget by the overpaid value after a disproved revert. That is the stated limit of I17 made visible, so I7 now states it exactly: committed stays within the budget unless a revert was disproved, and then within one cap of it |
| TLC, `TINY=1`, final v3 model | No violation in any behaviour of up to 17 steps: 81 million distinct states, breadth-first, before TLC stopped at depth 18 without a message (8 GB heap, 12 workers) ([log](tlc-v3-tiny-live-safety.log)) |
| Trace replay, v3.1 | 600 traces, 24,000 steps, identical state after every step |
| Liveness, `TINY=1`, no-AI fair world | Holds: the complete state graph, 1,224,072 distinct states, depth 41, no violation ([log](tlc-v3-tiny-liveness.log)). Fair world: the owner has died, witnesses are honest, no dependency fails, the fee stays under the ceiling, no endless reorg; signing failures, lost callbacks, reverts and settlement timeouts stay in. Contests and the freeze are left out: with them the graph exceeds this machine ([incomplete run](tlc-v3-tiny-liveness-with-contests-incomplete.log)) |

One liveness counterexample was real ([log](tlc-v3-tiny-liveness-cex-public-signature.log)): a lost request's signature is public, someone broadcasts it and it lands, but the vault never stored it, so nobody can settle it and the heir stays `Pending`. `submit_signature` (from the outside review) is what fixes it, and the fair world needs someone to call it. Two more were in the model, not the contract, and are kept: a time horizon too short for the fallback ([log](tlc-v3-tiny-liveness-horizon-artifact.log)), and a fairness assumption that let a relayer keep settling an attempt that never landed ([log](tlc-v3-tiny-liveness-fairness-artifact.log)). The second is also a rule for relayers: settle the attempt whose transaction is on Base.

## Bounds

| Run | Bound |
|---|---|
| Simulation, `quint run` | 20,000 to 30,000 random traces of 40 to 50 steps per seed, full constants |
| TLC, full constants (2 heirs, 3 witnesses, time to 12) | Exceeds this machine: about 50 million distinct states at depth 17 with the queue still growing. Used to find counterexamples 3 to 5, not to show their absence |
| TLC, `TINY=1` (1 heir, 1 claim, inactivity 1, time to 12) | Safety: all behaviours up to 17 steps. Liveness: the complete fair graph |
| Apalache | Not used: its translation of this spec fails with `undeclared operator OVERRIDE_GRACE` in Apalache 0.62.4, which the TLC route through the same translator does not hit |
