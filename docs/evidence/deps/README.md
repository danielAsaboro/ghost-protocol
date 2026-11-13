# Dependency evidence (step 1)

Primary-source reads behind the "Dependencies over 20 years" section of [the threat model](../../threat-model.md#dependencies-over-20-years).

| File | Source read |
|---|---|
| [mpc-governance.md](mpc-governance.md) | `near/mpc` at tag `3.18.0`: upgrade, domain, resharing, foreign-chain policy, inspector, deposit and gas code, with `path:line` citations |
| [signer-history.md](signer-history.md) and [signer-history/](signer-history/) | Archival RPC and nearblocks history of `v1.signer-prod.testnet`: every code change, governance call and key check, with the commands to re-run |
| [nearcore-and-op-stack.md](nearcore-and-op-stack.md) | nearcore runtime source and parameter files (host functions, yield, storage, gas, account rules); OP Stack specs, Base upgrade and fee changelogs, Base Sepolia lifecycle |

Clones used: `near/mpc` tag `3.18.0`, `near/nearcore` sparse checkout at master plus tags `1.30.0`, `2.6.0`, `2.10.0`, `2.14.1`, in `~/development/near-hackathon-research/src` (outside the repo).
