# Live testnet runbook

Testnet only.

## Human steps

1. Create and fund a NEAR testnet account for the vault, in the keychain.
2. Run the commands `npm run ghost -- accounts` prints.
3. Set `NEARAI_API_KEY` in your shell.
4. Send about 0.01 Base Sepolia ETH to the address `npm run ghost -- address` prints. Run this only after the lock step below prints LOCKED.
5. Start Docker, for the reproducible build.

## Order

| Step | Command | Proves |
|---|---|---|
| 1 | `cargo near build reproducible-wasm` in `contract/`, after pinning `image_digest` | Rebuildable WASM |
| 2 | `npm run ghost -- init VAULT.testnet 0xHEIR` | Wishes sealed with public values |
| 3 | `npm run ghost -- deploy` | Keys and config on-chain |
| 4 | `npm run ghost -- lock` | I1: prints LOCKED after reading `view_access_key_list` |
| 5 | `near contract call-function as-read-only v1.signer-prod.testnet get_available_foreign_chains json-args {} network-config testnet now` | `Base` is available |
| 6 | Fund, then `claim`, `checkin`, wait, `claim` | False claim cancelled |
| 7 | `attack` | Every line prints BLOCKED |
| 8 | Contract call `request_wishes_key`, then `open <big_y> <big_c>` | Real CKD against domain 2 |
| 9 | `reason "..."`, `register`, `pay` | Attested decision accepted |
| 10 | `broadcast 0`, wait for finality, `settle 0` | I4: heir `Paid` from an MPC attestation |
| 11 | Failed-broadcast recovery: with a second heir, leave the first attempt unbroadcast at a fee below base, then `reprice 1 <gwei>` and `broadcast 1` | I6 |

Step 10 is the first real test that the MPC network accepts an empty extractor list for `Base` with `Finalized`. If it does not, record the failure and change `settle` to `extractors: ["BlockHash"]`.
