# Live testnet evidence (2026-11-10)

Vault `ghostprotocol-vault.testnet`. Base Sepolia address `0xAf8105c7e876f38Bf0A9f09e4c97029BCf74d0Cc`.

| Step | Transaction or result |
|---|---|
| First deploy (non-reproducible build) | `6GuPaXDMPukwwerbHStheoJcAme6NWpmZKRhDVk8DtsC` |
| Claim refused while owner active | `owner is not inactive` |
| Witness claim | `6TjeYW5JvMYY9DR2B4vvwBqVn15JaMk1QPR5K78KZFCc` |
| Owner check-in cancels | `Dm1JPDN2js5FVp6phEZHzcczJDbyKHmuyCQUpAUU5VVw` |
| Registrar replay refused | `heir age already proven` |
| Second claim | `8bCHdgihoFGLKEFgmMN2naciNbZFfrerSmB9QzVKYfdH` |
| Five attacks blocked | `false-claim.txt` |
| Wishes key requested by the vault, opened after pairing check | `8Uw6tGnSf6G49MavWf3LZHKbZ128cVhGzCqSp3XKbuwx` |
| Fallback payout, MPC signature verified on-chain | `GH1TmBiumNAzJmVsdfmo4RPkxjWGtKqXrQKYzCFQedJV` |
| Re-price on the same nonce | `niToN6tTZiQ7VcAG53xxCUggQ8gNHerUHPWQU8E12R1` |
| Redeploy of the reproducible build, state intact | `7H9Fi6ydDzHtZzbzLSc5hHHBGcPxWyCjqLeCXaRmm3r1`, code hash `DBRswoeb9syKVRZJrCpjbw62E3Z6ZL48MAoLN8KfU4E8` |
| Settlement refused for an unbroadcast transaction | `9EivMJaKZbAjB6yih8CA8YVsx6FENebo9Fu9vQ1o9wmh`, heir stays `Pending` |
| Lock | `2AwB18KpkUaPoBAJhJUSVtyHDW5jPGJtZvCDBDn2pUAa`, `view_access_key_list` returns `[]` |
| 13 attacks after lock, each refused on-chain | `attacks-after-lock.txt`, hashes in `web/evidence.json` |

Open: funded broadcast, MPC settlement of a landed transaction, attested NEAR AI decision.
