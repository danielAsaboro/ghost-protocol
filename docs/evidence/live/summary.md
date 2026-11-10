# Live testnet evidence (2026-11-10)

Vault: `ghostprotocol-vault.testnet`. Base Sepolia address: `0xAf8105c7e876f38Bf0A9f09e4c97029BCf74d0Cc`.

| Claim | Evidence |
|---|---|
| Deployed code is this build | Chain `code_hash` = local sha256 = `AzDnubca5EUNJJPUGDF7wGWbE3raM8336fLFevACmLM8`. Deploy tx `6GuPaXDMPukwwerbHStheoJcAme6NWpmZKRhDVk8DtsC`. Build is `non-reproducible-wasm` |
| Claim refused while owner active | `owner is not inactive`, in `false-claim.txt` |
| Witness quorum opens a claim | tx `6TjeYW5JvMYY9DR2B4vvwBqVn15JaMk1QPR5K78KZFCc` |
| Owner check-in cancels it | tx `Dm1JPDN2js5FVp6phEZHzcczJDbyKHmuyCQUpAUU5VVw`, `claim_epoch` 0 to 1 |
| Registrar proof cannot be replayed | `heir age already proven` |
| New claim after cancel | tx `8bCHdgihoFGLKEFgmMN2naciNbZFfrerSmB9QzVKYfdH` |
| Five attacks blocked by the contract | `false-claim.txt` |
| Wishes sealed before any key existed, opened with the MPC CKD key the vault requested after the trigger | tx `8Uw6tGnSf6G49MavWf3LZHKbZ128cVhGzCqSp3XKbuwx`, pairing check in `agent/seal.mjs` passed |

Not yet: lock, signature, Base Sepolia payout, settlement, failed-broadcast recovery, attested reasoning. The CKD key was unwrapped on this machine, not in an enclave.
