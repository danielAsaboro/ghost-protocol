# GhostProtocol: one page for an outside reviewer

For someone who has administered an estate or audited smart contracts. About 10 minutes. Please write your objections in your own words, including the ones you think we cannot fix; they are recorded verbatim in [docs/evidence/outside/reviewer-objections.md](../evidence/outside/reviewer-objections.md).

## What it is

A program on NEAR holds an address on Base (an Ethereum network) through NEAR's threshold signing network (MPC). It pays a fixed list of heirs after a death claim. Nobody holds a key to the program: once deployed and locked, no person can change it, including us. Testnet only; this is a hackathon entry, not a legal will.

## How a payout happens

1. **The owner checks in** from time to time. Silence for `inactivity_secs` plus a quorum of witnesses (2 of 3 on the test vault) opens a death claim. The owner can cancel it with one check-in during a grace period.
2. **If the owner's check-in key is stolen**, all witnesses together open an "override" claim that check-ins cannot cancel; only the owner's cold recovery key can.
3. **Delays**: any witness can extend the grace period once (for an owner in hospital). A court account can pause once, for a bounded time.
4. **Amounts**: each heir has a floor and a cap set by the owner. An AI agent may choose an amount between them; the program accepts it only with a response signed by a registered enclave key. If the agent never acts, after a long timeout anyone can pay each heir its cap.
5. **Paid** means the MPC network attested that this exact Base transaction succeeded on a finalized block. A reverted payment is reopened once per heir by a witness quorum.
6. **If every witness key is lost** (new in v3), after a silence the owner chooses (years), a claim opens with no witnesses; a living owner still cancels it by checking in.

## What we claim, and how it is checked

| Claim | Evidence |
|---|---|
| No single person, key, model or operator can redirect the money | Actor table and 22 invariants in [threat-model.md](../threat-model.md); 99 contract tests; 600 model traces replayed on the code |
| The state machine has no reachable bad state | Quint model, checked by TLC and random simulation ([results](../evidence/spec/README.md)) |
| Arithmetic and transaction encoding cannot overflow or mis-encode | Kani proofs ([results](../evidence/kani/README.md)) |
| The deployed code is the published source | Reproducible build hash equals the chain's code hash |

## What we know is not solved

- The MPC network is trusted. On testnet, so is each of the 4 full-access keys on the signer account: one of them can replace the signer's code (D24 in the threat model).
- Heir addresses and amounts are public before anyone dies ([privacy](../evidence/privacy/README.md)).
- A lying witness quorum can overpay one heir once.
- The vault cannot adapt if the signer changes its interface, drops Base, or Base Sepolia shuts down. Fixing that would need a key, and a key could also redirect the money.
- There is no court process, death certificate or identity check. "Death" is the witnesses' word plus the owner's silence.

## Questions we would most like answered

1. **Executor**: what must an executor show before distributing a digital asset (under RUFADAA in the US, or your jurisdiction), and which of those does a 2-of-3 witness quorum plus owner silence fail to provide?
2. **Executor**: what goes wrong in practice that this design would make worse: disputed death, missing heirs, minors, creditors, taxes, a will that contradicts the on-chain list?
3. **Auditor**: in `contract/src/lib.rs`, where would you expect to find a fund-redirecting bug first, and did you find one?
4. **Both**: which claim above would you not sign your name to, and why?
