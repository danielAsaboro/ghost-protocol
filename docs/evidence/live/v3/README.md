# v3 on NEAR testnet

| Fact | Value |
|---|---|
| Account | [`ghostprotocol-v3.testnet`](https://testnet.nearblocks.io/address/ghostprotocol-v3.testnet) |
| Code hash on chain | `Gakhf4AxBppPcnXEjpuBgKNPqWojwM4gabLeGrVuGWNm`, the reproducible build at `ceedcd4` ([log](../v3-reproducible-build.log)) |
| Lock | [`G7m2XVez…`](https://testnet.nearblocks.io/txns/G7m2XVezMkjZ6rw1XBn9uSWyLWwcUjMT2sZ7NrdNfUat) deleted the last full-access key; `view_access_key_list` returns none |
| Base Sepolia address | [`0x5e5E2B74258a8ac3E2A32bda02cFcF1C102117ea`](https://sepolia.basescan.org/address/0x5e5E2B74258a8ac3E2A32bda02cFcF1C102117ea), unfunded |

## Calls after the lock

On a fresh vault two of the attack script's scenarios have no precondition (no payout has started, and no adulthood proof exists yet), so those calls are legitimate and succeed. The replay of the registrar proof is then sent again and refused.

| Call | Result | Transaction |
|---|---|---|
| Agent pays an unlisted recipient | refused: recipient is not an heir | [46XiU64uNS…](https://testnet.nearblocks.io/txns/46XiU64uNSqzbacL7vU5j7bo8U7QWBzXFgYLZ3JU8H3Z) |
| Agent pays an heir already being paid | refused: no proven claim | [CSA4dntNxh…](https://testnet.nearblocks.io/txns/CSA4dntNxhQoYsQW65JvH8KzQRT4rfurM6p7igzttryF) |
| Owner account poses as the agent | refused: only the agent can propose | [Chj8HLio37…](https://testnet.nearblocks.io/txns/Chj8HLio37HKxUZ1bjvMPphmzZgTgayETGxeHwtW5sE9) |
| Agent freezes the vault | refused: only the legal authority can freeze | [D7a89K2aPd…](https://testnet.nearblocks.io/txns/D7a89K2aPddtUDFnQdtWcPu6zQ3JusxtXUNDQuzHbusb) |
| Owner checks in (no payout exists on a fresh vault, so this is a legitimate call) | succeeded | [6P3uYPyWyv…](https://testnet.nearblocks.io/txns/6P3uYPyWyvq21AzFsfZWKQ3AyDUB7qHFW1W3oKXLctH9) |
| Anyone fakes the MPC settlement callback | refused: Method on_settled is private | [36VfcXiprs…](https://testnet.nearblocks.io/txns/36VfcXiprstNqm1Mh5UzV9ME3qiD5skTahfhD7z6W2ou) |
| Anyone fakes the MPC signature callback | refused: Method on_signed is private | [BWH9JzEA6i…](https://testnet.nearblocks.io/txns/BWH9JzEA6i27H7dHfkfjD7Jj8nKqV58PXkNuJVYLCSsK) |
| Forged witnesses reopen a payout | refused: unknown payout | [4gire6qj3j…](https://testnet.nearblocks.io/txns/4gire6qj3jBbXWK6UNPSdpFMWhR1P3TUTSTHZmAxxBzw) |
| Forged witnesses register a signing key | refused: invalid witness signature | [3KCxfFU7Ks…](https://testnet.nearblocks.io/txns/3KCxfFU7KsyH9bpLtLBNWrHYKZyiXnpe4guaEM2Q7z9Z) |
| Registrar proves heir 1 adult (first use of this proof) | succeeded | [Bk4UxQEEgo…](https://testnet.nearblocks.io/txns/Bk4UxQEEgomNTxNbtshJgwwBnrBbS8g4LWAwpDGhTSZ3) |
| Second claim while one is open | refused: owner is not inactive | [FaEbhaqfJo…](https://testnet.nearblocks.io/txns/FaEbhaqfJoN73sUW2yyGXq5F4jU4bXgN1R9BkjEAbmB8) |
| Registrar proof replayed | refused: heir age already proven | [5pJqXz36yA…](https://testnet.nearblocks.io/txns/5pJqXz36yAST27grqHKrcEEiqaryafekP49DeK44GRqS) |
