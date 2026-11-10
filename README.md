# GhostProtocol

A NEAR contract that pays your heirs on Ethereum after your death is proven. An AI reasons privately about your sealed wishes, but it can only propose a payout within limits the contract enforces.

Built at the NEAR Hackathon. Tracks: Privacy & Private AI, AI Security & Defense.

## Problem

Crypto is lost when its owner dies, and a simple dead man's switch can pay out because someone lost their phone. An AI executor with wallet keys adds the risk that it is tricked into stealing the money.

## How it works

1. The owner funds an Ethereum address controlled by the vault contract through NEAR Chain Signatures. Existing wallets are not touched.
2. A missed check-in alone moves nothing. A claim also needs signatures from 2 of 3 named witnesses.
3. During a grace period, one owner check-in cancels the claim.
4. A registrar-signed time proves the heir is an adult without putting a birth date on-chain.
5. The agent reasons over the wishes through NEAR AI Cloud and verifies the response signature.
6. The agent submits only a heir number, an amount and a reasoning hash. The contract checks them, sets the nonce and fees, builds the Ethereum transaction and requests its signature.
7. Anyone can broadcast the signed transaction. The relay refuses anything that differs from what the contract approved.

## Try it without accounts

Needs Node 24.22.1 or later and Rust with `cargo-near`.

```bash
npm install
```

```bash
npm test
```

See 7 JavaScript tests pass.

```bash
cd contract && cargo test
```

See 18 contract tests pass, including forged witnesses, over-cap payouts, unlisted heirs, replays and legal freezes.

## Run it on testnet

Needs a funded NEAR testnet account you created, `NEARAI_API_KEY`, and Sepolia test ETH.

```bash
cd contract && cargo near build non-reproducible-wasm --no-abi && cd ..
```

```bash
npm run ghost -- init YOUR_ACCOUNT.testnet 0xHEIR_ADDRESS
```

```bash
npm run ghost -- accounts
```

Run the printed commands yourself to create the owner, agent and court sub-accounts.

```bash
npm run ghost -- address
```

Send about 0.01 Sepolia ETH to the printed address, then run these in order:

| Command | You should see |
|---|---|
| `npm run ghost -- deploy` | Contract deployed with a 60-second inactivity window and 60-second grace |
| `npm run ghost -- claim` after 60 seconds | Witness quorum accepted |
| `npm run ghost -- checkin` | Claim cancelled |
| `npm run ghost -- claim` after 60 more seconds | New claim opened |
| `npm run ghost -- attack` after 60 seconds | Every attack prints `BLOCKED` with the contract's reason |
| `npm run ghost -- reason "Ada is safe and enrolled at university."` | A decision with its verified signature kind |
| `npm run ghost -- pay` | Contract stores a signature |
| `npm run ghost -- broadcast` | A Sepolia Etherscan link |
| `npm run web` | Timeline at http://localhost:4173 |

Test the deferral path with a report saying someone is pressuring the heir.

## What is proven and what is not

| Part | Status |
|---|---|
| Contract rules | Tested in unit tests |
| Ethereum transaction hash | Matches viem |
| Live testnet deploy, Chain Signature and Sepolia payout | Scripted, not yet run |
| NEAR AI verified inference | Scripted with the official SDK, not yet run |
| Sealed storage | Wishes are AES-encrypted, but the demo key is in local `.ghost/state.json`. Not yet held in a TEE |
| Agent key | A normal NEAR account, not yet TEE-bound |

## Known limits

- Colluding witnesses can open a false claim. The owner's check-in is the defense, so the grace period must be long enough for real life.
- The agent chooses the amount up to each heir's cap, so a bad agent can underpay once per heir or decline to pay.
- A freeze stops only payouts not yet requested. Transfers cannot be undone.
- Enclaves can be attacked, especially with physical access.
- The vault's Ethereum address must only be used by this contract, because the contract counts its nonce from 0.
- This is not a legal will and has no legal force.

## NEAR components

Chain Signatures through `v1.signer-prod.testnet`, NEAR AI Cloud, and `ed25519_verify` in a NEAR contract.

## Libraries and AI use

`near-sdk`, `ed25519-dalek` (tests), `viem`, `@nearai/inference-sdk`, and the `near` CLI. The code and documentation were written with Claude Code.

All code was written during the hackathon window. MIT licensed.
