# What an observer learns (step 6)

`node scripts/observe.mjs ghostprotocol-vault.testnet` uses only public RPC (NEAR testnet, Base Sepolia, the nearblocks indexer). No key and no off-chain file. Output for the live vault: [observer.json](observer.json).

## Leaks, measured on the live vault

| What | Where an observer reads it | Live value |
|---|---|---|
| Number of heirs | `get_state().heirs` | 1 |
| Each heir's Base address | `heirs[i].address`, before anyone dies | `0x8FA8…0BAf` |
| Each heir's floor and cap | `heirs[i].floor_wei`, `cap_wei` | 0.0005 to 0.001 ETH |
| Whether a heir is a minor, and until when | `heirs[i].adult_by` in the future | none on the live vault |
| When the registrar proved a heir adult | `heirs[i].adult_at` | 2026-11-09 |
| The estate's size | `budget_wei`, and the Base balance of the vault address derived from `vault + path` | 0.00121 ETH budget, 0 ETH held |
| The owner's activity pattern | `last_check_in`, and every `check_in` transaction of the owner account in the indexer | last check-in 2026-11-10 |
| That someone claims the owner died, and when | `claim.opened_at`, `claim.death_at` | claim opened 2026-11-10 |
| Who the agent and court are | `agent`, `legal_authority` | sub-accounts of the vault |
| How many witnesses, and whether one contested | `claim.contested` | 3, none |
| Every payout: recipient, amount, AI or fallback | `payouts[]` | 0.001 ETH, fallback |
| What the heir does with the money | The heir's Base address history | 0 transactions |

The wishes stay private: only a SHA-256 of the ciphertext is on-chain, and the key does not exist until the trigger (I15).

## Can commitments replace the clear values?

The test: replace a value with `sha256(value || salt)` and reveal it only when a check needs it. Each value fails the test for the same reason. Some check that anyone must be able to run reads it before the reveal:

| Value | Check that needs it in clear | Who must run that check |
|---|---|---|
| Heir address | The contract builds the transaction it asks the MPC network to sign (I2, I6) | Anyone, through `execute_fallback` (I13) |
| Cap | Fallback pays the cap; `new` checks caps plus gas fit the budget (I7) | Anyone (I13); the contract at init |
| Floor | `propose_payout` refuses less than the floor (I2) | The contract, on the agent's call |
| `adult_by` | The age gate (I8) | Anyone, through `execute_fallback` (I13) |
| Witness and registrar keys | Signature checks (I8, I11, I16, I17) | The contract |

Committing the address, cap and `adult_by` would turn I13 from "anyone can start the cap payout" into "anyone holding that heir's opening". The opening would have to live somewhere a stranger can reach after the trigger, which brings the leak back. Committing only the floor would hide one number while the cap stays visible next to it. Neither is a net gain, so the vault keeps every value in clear and the README states the leak.

At payout the recipient and amount become public on Base anyway: that is a transfer on a public chain.

## What would change it

A heir list committed as a Merkle root, with per-heir openings encrypted to the CKD wishes key (released only after the trigger, I15), would keep heirs private until the claim matures, and keep I13 for anyone the wishes key reaches. It costs a second sealed object, a new vault and a change to who can run the fallback. Not built in this pass.
