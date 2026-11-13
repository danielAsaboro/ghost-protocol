# v1.signer-prod.testnet change history

Primary on-chain measurement of how often the NEAR testnet MPC signer contract changed, for the vault's 20-year dependency map. Collected 2026-11-12/13 UTC from NEAR testnet archival RPC and the nearblocks testnet API (v3). Raw outputs are in [`signer-history/`](signer-history/); every number below can be regenerated with the commands in [Re-run](#re-run).

## Findings

| | |
|---|---|
| Account created | block **169857059**, 2024-07-25 19:10 UTC, tx `ED53bmEqqWTf1QXs26cSwyiiEe8UhgYZvQpe85G4iA4y` |
| Code-hash changes | **48** from 2024-07-25 to 2026-10-30 (42 distinct code hashes, 30 distinct versions) |
| By path | 24 by the account's own full-access keys (2024-07-25 → 2025-04-07), 24 by participant vote (2025-02-19 → 2026-10-30) |
| By year | 2024: 22, 2025: 8, 2026 (to 11-12): 18 |
| Vote-path cadence | median 16.1 days between upgrades (min 5.5, max 148.2) |
| Current code | `CpGX8ywXJwvWPgZFDDCTCuPJBHF7BATT51gSfc3APERJ`, version **3.18.0**, source `near/mpc@e691bdb9` |
| Full-access keys still on the account | **4** (see [`access-keys-current.json`](signer-history/access-keys-current.json)); the last key-signed deploy was 2025-04-07, but nothing on chain prevents another |
| Domain keys | domain 0 key **never changed** since 2024-07-25; domains 1, 2, 3 each have had one key since they were created; see [Domain public keys](#domain-public-keys) |
| Method surface | 113 exported methods across all versions, only 13 present in every one (`sign`, `public_key`, `derived_public_key`, `respond`, `state`, `config`, `version`, `vote_pk`, `vote_reshared`, ...). The upgrade-vote API itself was renamed in 3.17.0 (`propose_update`/`vote_update` → `submit_contract_update`/`vote_contract_update`) |
| Outages seen | `public_key` failed for 12 s to 1.8 min during each of 4 new-domain keygens, and after the 3.0.2 upgrade (2025-11-12 15:28) every view call panicked with `Cannot deserialize the contract state.` for ~4 minutes (blocks 222661043–222661260) until `pub_migrate` was called |
| Votes | **2,157** `vote_*` receipts across 16 vote methods that were ever called (2025-01 → 2026-11) |
| `sign` volume | roughly 1.27 M `sign` receipts in total (estimate); 2026-10 ≈ 190 k; dominated by benchmark callers (`tx-bench.testnet`, earlier `ping-account.testnet`) |

What this means for a contract that hard-codes the signer:

- The account id has been stable for 2.3 years; the code behind it has not. In 2026 it changed about every 2.5 weeks.
- Two upgrade paths exist: participant vote, and the account's own full-access keys. The keys alone can still replace the code.
- The domain 0 key has stayed the same through 48 code changes and many reshares. The keys of other domains are different keys, and new domains keep being added (4–7 added 2026-11-10/11).
- `public_key` changed meaning at 2.0.0-rc.1 (2025-04-14). Before that it ignored `domain_id` and returned the root key for any input. Since then an unknown domain panics.

## Code-hash changes

`first block with new code` is the first block whose `view_account.code_hash` differs, found by bisection. `version` comes from the `version` view at that block, or from `contract_source_metadata` (NEP-330) when `version` did not exist or failed (marked nep330). Full rows with the exported-method diff for each version are in [`code-changes-table.json`](signer-history/code-changes-table.json) and [`code-versions.json`](signer-history/code-versions.json).

| # | first block with new code | date (UTC) | tx | path | old -> new code_hash | version |
|---|---|---|---|---|---|---|
| 1 | 169858015 | 2024-07-25 19:26 | `Ht8CuDTHjVVHyVugMKjz57SAgjpwDJN5w17CxBLmKV2m` | full-access key | `11111111…` → `GNrVPAzEqQfRxnYCUGnKtSbhafbPcxuUnjW9z5DyfuvR` | 1.0.0-rc.1 (nep330) |
| 2 | 170316845 | 2024-07-31 04:09 | `4QdovxjgvPKcFb1poViFEA23QPWLc1oe7aDfWR9WNffp` | full-access key | `GNrVPAzE…` → `BLoQbtJPyP2PETabrcrq7sdkb9bQ3rKE75sQbzXN9Q16` | 1.0.0-rc.2 (nep330) |
| 3 | 170612662 | 2024-08-03 22:52 | `6ADQyBp3SvYTtQs4ieBWeF9ybfPznRF7y9UKTBd4VexV` | full-access key | `BLoQbtJP…` → `GQgaay9nYNjmR1ZGvPqNioDusW3JEBTGYznAGoFzLX65` | 1.0.0-rc.3 (nep330) |
| 4 | 174590596 | 2024-09-18 16:37 | `7REdySPUADqECdekx52RBf59XNajbHp7RmLDUR5BMShX` | full-access key | `GQgaay9n…` → `2a5V7PRw4CM8zmTK47w3YzXi94W4Pat8uwE4HVwaTp6r` | 1.0.0-rc.4 |
| 5 | 174590979 | 2024-09-18 16:43 | `EVih1ymjd1wuVkajfkiuEXM5RANXmZFiMQF4apAfxBF` | full-access key | `2a5V7PRw…` → `9hRTenFqTD5tZmzKLFD1Joi9uWj5zmsHZjVHrhw2G7i6` | 1.0.0-rc.4 |
| 6 | 174591117 | 2024-09-18 16:46 | `H4UYeZ3mkHs82KYtfWjEvegqeqjeLCykh8TS3gRW92z8` | full-access key | `9hRTenFq…` → `2a5V7PRw4CM8zmTK47w3YzXi94W4Pat8uwE4HVwaTp6r` | 1.0.0-rc.4 |
| 7 | 176979280 | 2024-10-16 15:16 | `6Ko17ZLAKGE1pgToPA3G4WkKgKRu1cMzfQ2jBZgjUFUf` | full-access key | `2a5V7PRw…` → `B4fFGusvRJjApd5JywucknmDrBPMhi17kSWoc1pUdTf9` | 1.0.0-rc.5 |
| 8 | 177075386 | 2024-10-17 18:47 | `7q6tTLRQXPZTbYQbTAHQWf2P98fJ15cMWqW32zpDmyFp` | full-access key | `B4fFGusv…` → `Fk2ebttCS7wi7J3CNtCdaUx2JNfWFuojUDeoU4XVCHTr` | 1.0.0-rc.5 |
| 9 | 177080432 | 2024-10-17 20:09 | `H1HJCnzkwFCG4CHChBAjDMoPUfQ7KU7ccexmReCuG31d` | full-access key | `Fk2ebttC…` → `B4fFGusvRJjApd5JywucknmDrBPMhi17kSWoc1pUdTf9` | 1.0.0-rc.5 |
| 10 | 177756750 | 2024-10-25 15:31 | `ErRy47Lt3Z3Dz3JvEieHYVJ1w1kKud1B3m8sBy42z6MV` | full-access key | `B4fFGusv…` → `CxUxBpJenzeTztPiwq9Lu6PzbGWc9t3KQUi5tYwHvvRk` | 1.0.0-rc.5 |
| 11 | 177756929 | 2024-10-25 15:34 | `8WRyUb549BDfcwaAEyQ8o92p2p4DBKfqrJqMp4nJM3pu` | full-access key | `CxUxBpJe…` → `B4fFGusvRJjApd5JywucknmDrBPMhi17kSWoc1pUdTf9` | 1.0.0-rc.5 |
| 12 | 178124908 | 2024-10-29 19:50 | `Bfd26NwizdP3v2mHdBLh9t7is3v88FnnoPn2GjCTjo8S` | full-access key | `B4fFGusv…` → `Fk2ebttCS7wi7J3CNtCdaUx2JNfWFuojUDeoU4XVCHTr` | 1.0.0-rc.5 |
| 13 | 178125004 | 2024-10-29 19:51 | `HndiZbRCfcyXf1CKzXd7CmGWXNeAbxK9T2YB5wRSp8k2` | full-access key | `Fk2ebttC…` → `B4fFGusvRJjApd5JywucknmDrBPMhi17kSWoc1pUdTf9` | 1.0.0-rc.5 |
| 14 | 178213613 | 2024-10-30 20:05 | `9u6iW7RkencY7zA6NytKaHGmuC9ruc3VU2X1R1gxVP5o` | full-access key | `B4fFGusv…` → `CxUxBpJenzeTztPiwq9Lu6PzbGWc9t3KQUi5tYwHvvRk` | 1.0.0-rc.5 |
| 15 | 178213697 | 2024-10-30 20:07 | `FZTcoGWUDhCMQnvvyQjcpK4mRAuWExb61JySAvhgY21c` | full-access key | `CxUxBpJe…` → `EuDKDZdJshYsX3P5L8JaeNdJBgQuQ2ucSyTbor3pCjog` | 1.0.0-rc.5 |
| 16 | 178670785 | 2024-11-04 23:53 | `DFAaadb9neDtNKmHEVzhS9KfiFmnRLJgbEoRCfiYtp6W` | full-access key | `EuDKDZdJ…` → `Df16TFtBf3V22VZkTwZk364PHWmPyhR66xyGVBtwLXMJ` | 1.0.0-rc.5 |
| 17 | 178674370 | 2024-11-05 00:53 | `e9DrarqPUEpRtGgJTjB2C19RShaJGrRTTtE7MxJgjFD` | full-access key | `Df16TFtB…` → `4udaD9rFfdrZTUYvxxWZTNpDGkBpKbmyU3Vm6PYJTpk9` | 1.0.0-rc.5 |
| 18 | 178674718 | 2024-11-05 00:59 | `9UYWahMixAjkzRrAssJNwrK4mbDNWYU4Qoaev46mLNfb` | full-access key | `4udaD9rF…` → `HXkYa6gg2cwX6NgstPcLQJkWHqcAZWTcermG5caGvBZe` | 1.0.0-rc.5 |
| 19 | 178674799 | 2024-11-05 01:00 | `HunNauYTTs6QuhaevR97mNsn2rxXbQ92kxcQQKYhAfd2` | full-access key | `HXkYa6gg…` → `EveSEqi8o4jpTWnNBbjY1BAuoMN1ybAVcm3r44cxFGh8` | 1.0.0-rc.5 |
| 20 | 179885828 | 2024-11-18 23:04 | `5NudJouzgx8r4ceeMeyg3jPE3J9X6cdez2aC7beuwRjy` | full-access key | `EveSEqi8…` → `97Vqe8JkYHcg331t3th4yjutgEZ4joBSZfZwF2xALEqF` | 1.0.0-rc.5 |
| 21 | 179887079 | 2024-11-18 23:25 | `Gv1bAUcCuCg7apXWiSa6iF4xy8BFzPq9rmQENZTmSx1u` | full-access key | `97Vqe8Jk…` → `GZA7i9HSUUSRPXQh8CfxXBEcTMxwqpA5CsxSJojkCN1h` | 1.0.0-rc.5 |
| 22 | 179888752 | 2024-11-18 23:52 | `8WemwY2w4xTwVwLBWw6oGAwQ7uR8zR5QCBd17qDSc8dU` | full-access key | `GZA7i9HS…` → `8ZbCEy8EE7yY2Az7AiJsNBdtNdJ9TsGfvnQcULnio9M7` | 1.0.0-rc.5 |
| 23 | 188054751 | 2025-02-19 15:03 | `4WZz5PatT29mtAVQRL4Wdouw52j6vcwutfhSeUUG5CEP` | contract self-upgrade (vote) | `8ZbCEy8E…` → `8Pn8RvP2RXqC8m7tvdnsrxSMcCG9J6jusXaimuoruz92` | 1.0.0 |
| 24 | 188375641 | 2025-02-23 06:07 | `ipTC2xJXzoDoZfq3G9ySzPcusNwwddfxdSZZfbiD4jo` | full-access key | `8Pn8RvP2…` → `GE2QGtKiAJZ1DffA2jufMjEtDmVfwaAtpCvAepAyru6g` | 1.0.1 |
| 25 | 192201745 | 2025-04-07 15:35 | `5tfLC5K2MpkiqSW3hTdxTxoazRFonRpGudiSBK9UTRQv` | full-access key | `GE2QGtKi…` → `Gag9Gi1Loqr1jRsPeTeB1KyMsSJQ4fFyiFWG931Xe3n7` | 1.0.1 |
| 26 | 192817955 | 2025-04-14 15:35 | `7ew43gKYDhg71ZcWGsvGTSEKuP4GEZ2LDt6DixjNiDdk` | contract self-upgrade (vote) | `Gag9Gi1L…` → `6r6NsDnE9rCMopJiZ7mfwQAAZR7gkLmpTDAecjxXq8Lh` | 2.0.0-rc.1 |
| 27 | 198111510 | 2025-05-23 14:07 | `Cbp3TGHQdk8iNxpGp1WatUajYwZX8sp4G7Kz8QTH6jib` | contract self-upgrade (vote) | `6r6NsDnE…` → `C3267AxjrGA6FW5ZWBduLM5aqBDHfTbhnkwXKQJkwc4h` | 2.1.1-rc.1 |
| 28 | 201653479 | 2025-06-17 09:34 | `4L63GHTvSkbWfR59cr4B3VCvQPUD6WiSVPhZJfj3Cyy4` | contract self-upgrade (vote) | `C3267Axj…` → `AwGsqzBktLoUvdnUsNVrP8hFea3SywdRYHzmPead4Jts` | 2.2.0-rc.1 |
| 29 | 222661043 | 2025-11-12 15:28 | `HDke3yUnpqeyZp8QwM5GKAy63tBeEuSGJfAz1HnsmPLJ` | contract self-upgrade (vote) | `AwGsqzBk…` → `4SKLfbnrk2BL8zKTVxLybwXLq8TMLgaCbBaJ9JHfdCCU` | 3.0.2 (nep330) |
| 30 | 228273574 | 2025-12-19 22:20 | `H4eit1SDW19xAU8yFx1V8GbWbQC77FgJ5QB8Xxf4R2Hn` | contract self-upgrade (vote) | `4SKLfbnr…` → `7n11BaHZYtmzLRtbwGMqVLfFusDat8UWA5JbgFzAHYP2` | 3.2.0 |
| 31 | 234240345 | 2026-01-28 21:29 | `WqQdSxpvu2Ty34BRZ7wLeU63ehkAMQCxxMbiyALZr8S` | contract self-upgrade (vote) | `7n11BaHZ…` → `CzsFL4F7Xu7fbBcj6tq2ZVDFC3czKXov4BsyVD15Dh7P` | 3.3.2 |
| 32 | 236006970 | 2026-02-09 10:44 | `HhfMiWQotoWcifP7otqB7pzmLuBunG1XjXJweEkWqpwA` | contract self-upgrade (vote) | `CzsFL4F7…` → `AQ33TDCQTfdA14RVnppFic65TRij1LQ6SS4CzVGCbHb9` | 3.4.1 |
| 33 | 238484573 | 2026-02-25 14:18 | `29SJAFQWU9e6q5mT5wHNFABVPUaUSSKLNy1QnTpZzSj1` | contract self-upgrade (vote) | `AQ33TDCQ…` → `6Tu5K7DsZKABbQCA8eH15jwFKyCyLzDWS4x4bAMVTfz1` | 3.5.1 |
| 34 | 239824364 | 2026-03-06 11:34 | `6xt74uqYi6f2ym98hEWL417h9KQkJrYNAvc8DduFVcBV` | contract self-upgrade (vote) | `6Tu5K7Ds…` → `EdvPfvi2StkRC2d67t2JjtTcvCSaVcoo4P4YHVnrbycu` | 3.6.0 |
| 35 | 241503413 | 2026-03-17 14:02 | `4bcbnQUmiK91dhQHXKSKFAbjFmHQE4MWxEwoTtMn68x2` | contract self-upgrade (vote) | `EdvPfvi2…` → `DaiXSyjKGsCp7nkuoNLj6V8WAJdz13wnE2KUhs5CFvp9` | 3.7.0 |
| 36 | 245082343 | 2026-04-10 10:48 | `EndSKpfHMu4J2Z6SZamSwbRkwp5vyVeEtUhcikM4HSKk` | contract self-upgrade (vote) | `DaiXSyjK…` → `6bvKGnWqRBteERN2bgsAWNChnMRinfYjVssa961rm8zL` | 3.8.1 |
| 37 | 246913700 | 2026-04-22 13:16 | `AwjKUSA5E9BEmb1ZxcF8Wnf7nxiUC6gjSzpZQoEUF4nB` | contract self-upgrade (vote) | `6bvKGnWq…` → `GdFSBgbL7DasBGKj29acqVafexEytKvi6ptkioui5eJ7` | 3.9.1 |
| 38 | 251916549 | 2026-05-25 14:13 | `9AFevQyHNXmyPEzrASLAqnr9Lkjsui1AsDMjnwtNNNs7` | contract self-upgrade (vote) | `GdFSBgbL…` → `ETgRbRLx271wp5udzwYmUa7yZficGXkVsAPJZtXR6oBh` | 3.10.1 |
| 39 | 254119345 | 2026-06-09 14:09 | `8jCrfGXHohdbB34WYhyKfpD5TQsDFxeB2Legs9UC3kD8` | contract self-upgrade (vote) | `ETgRbRLx…` → `4BFRExu7Ruba1HEwdJmbB6u7CiAiXN5ko3iEP431WNqt` | 3.11.2 |
| 40 | 255296434 | 2026-06-17 16:43 | `7U85a8dZnKyaVbu8fGGk2vnEFTZrBEiDVySD2M3rC8rM` | contract self-upgrade (vote) | `4BFRExu7…` → `6M8tyVP9QpuWXp5SPqx1zS8oWMpheg1jx5FWixZjkPtM` | 3.12.0 |
| 41 | 257405461 | 2026-07-02 13:02 | `DFP83sXYAFhjYvHykB9FAZEo3d4meSZz9pww5nmRUoAh` | contract self-upgrade (vote) | `6M8tyVP9…` → `GinewFVCcTLsARFnW8E5Am9Y8Nf2MP2hKJMpwDLEyHco` | 3.13.0 |
| 42 | 262833765 | 2026-08-07 13:31 | `D2fc6JGWfdyxHkGPeeoeS9DbUrBqYsg8K8G7ikZJc3GE` | contract self-upgrade (vote) | `GinewFVC…` → `EM7QrQMdd71hCHFL4RHkYQ2E4jmESpgu85mDZJu8jJJd` | 3.14.0 |
| 43 | 264657783 | 2026-08-19 15:55 | `EcK62WDmWAWKebABGJDD8frSNyKRHvfUdqiYi7M9HxHM` | contract self-upgrade (vote) | `EM7QrQMd…` → `F8NqkFhF97BxjYrweg3hFFhdH57k4qgqoPdLDwP6H9dL` | 3.14.1 |
| 44 | 267841591 | 2026-09-09 20:02 | `CkbTNaK3taauP6YC7qtuSgJQfTAhfpc33naV3Y1K5GP3` | contract self-upgrade (vote) | `F8NqkFhF…` → `DywtPs7x1zgQ9PHHoQLqHT9yuZwYzcP75SZtwaX1VbF3` | 3.15.0 |
| 45 | 268673750 | 2026-09-15 09:01 | `5GUymaMSMSeisz9j7L97ouFp26hxf3ebZTCvL1hnAtU8` | contract self-upgrade (vote) | `DywtPs7x…` → `8XjbgWsv7eEcNnMujyWwAbQHVXnu49qD3JTbH4TGPqBL` | 3.15.1 |
| 46 | 269867677 | 2026-09-23 09:10 | `EFLYXxbyMDoPsH5i7cdm5sw5PLAiYTpgWQqirQhEE7yy` | contract self-upgrade (vote) | `8XjbgWsv…` → `BqN6GrovBmBD7g41p5GvXMVUJcLgipuVGXF6ps6hQgBy` | 3.16.0 |
| 47 | 273041826 | 2026-10-14 13:13 | `2wf7vHzCHJ3X68imtgWnxmDFKTe8WEMxkn2mEzP41tJP` | contract self-upgrade (vote) | `BqN6Grov…` → `DAE5ng4ZFR2ctMx9SizQBqmGkVbKUutgZ4ZECD4R8Sm9` | 3.17.0 |
| 48 | 275431712 | 2026-10-30 09:31 | `3M5H9hoZxVnapxhpgb5Nx4c6WjVzpc7NoWqA3r4JRo8X` | contract self-upgrade (vote) | `DAE5ng4Z…` → `CpGX8ywXJwvWPgZFDDCTCuPJBHF7BATT51gSfc3APERJ` | 3.18.0 |


Deploy actions that did **not** change the code hash (excluded from the 48): 7 failed deploys (`EbJm7ype…` 2024-07-25; four `DEPLOY_CONTRACT+init_running` retries on 2025-04-07; the vote-path `oCiR8d8G…` 2025-11-11, whose `migrate` failed and rolled back) and 2 successful same-code redeploys on 2024-11-18 (`252Uxyxt…`, `DzV4CUCa…`).

Notes on the table:

- Rows 1–22 and 24–25 were signed by the account's own full-access keys, usually `DeployContract` followed by `init_running` (a re-initialisation). In 2024 the hashes flip back and forth (`B4fF…` ↔ `Fk2e…` ↔ `CxUx…`), which looks like deploy-and-revert testing on the production account.
- Rows 23 and 26–48 came from a `DEPLOY_CONTRACT + migrate` receipt that the contract sent to itself when a vote reached threshold. The tx in the table is the voter's transaction that triggered it.
- `version` failed at the first block of 3.0.2 (row 29) because state could not be deserialised until `pub_migrate` ran 216 blocks later (`DMv2Qt5XshDKkgXSKEuqAA4LuqyDjUNGgssDZcUJnY1m`, `n1-multichain.testnet`).

## Governance calls

Source: nearblocks `/v3/accounts/v1.signer-prod.testnet/receipts?method=<name>`, for every vote, upgrade, init, migration and node-admin method exported by any historical code version (method lists come from `view_code` at each version; see `exports` in `code-versions.json`). All pages were fetched, except for three node-operational methods capped at 30 pages (3,000 receipts each): `join` (2024-08 → 2025-04; 2,989 of the 3,000 fetched failed, and 2,982 came from `bst-near.testnet`), `verify_tee` and `submit_participant_info`. None of the three is a vote. Counts are receipts, so they include cross-contract calls. Failed receipts are counted separately. Methods queried with zero receipts: `init`, `remove_contract_update_vote`, `vote_cancel_resharing`, `vote_cancel_keygen`, `vote_remove_launcher_hash`, `vote_add_os_measurement`, `withdraw_tee_verifier_vote`, `update_config`, `remove_update_vote`, `remove_update_proposal`, `register_foreign_chain_support`, `cancel_node_migration`, `update_participant_url`, `clean`. The method name `vote_foreign_chain_policy` existed only in versions 3.4.1–3.9.1 and was replaced by `vote_update_foreign_chain_providers` in 3.11.2.

### By method

| method | receipts ok | failed | distinct callers | first | last |
|---|---|---|---|---|---|
| `submit_participant_info` | 3000 (capped) | 0 | 16 | 2026-11 | 2026-11 |
| `verify_tee` | 2842 (capped) | 158 | 19 | 2025-11 | 2026-11 |
| `vote_reshared` | 856 | 54 | 22 | 2025-01 | 2026-10 |
| `register_foreign_chain_config` | 781 | 39 | 17 | 2026-05 | 2026-09 |
| `register_foreign_chains_config` | 622 | 1 | 18 | 2026-08 | 2026-11 |
| `vote_new_parameters` | 264 | 62 | 22 | 2025-04 | 2026-10 |
| `vote_update` | 172 | 61 | 20 | 2025-02 | 2026-10 |
| `vote_code_hash` | 134 | 13 | 17 | 2026-03 | 2026-09 |
| `start_reshare_instance` | 97 | 0 | 2 | 2025-04 | 2026-10 |
| `vote_pk` | 89 | 9 | 20 | 2025-04 | 2026-11 |
| `vote_add_launcher_hash` | 77 | 1 | 16 | 2026-04 | 2026-08 |
| `vote_mpc_node_manifest_digest` | 63 | 12 | 17 | 2026-10 | 2026-11 |
| `vote_update_foreign_chain_providers` | 53 | 0 | 17 | 2026-06 | 2026-09 |
| `vote_add_domains` | 48 | 1 | 19 | 2025-04 | 2026-11 |
| `remove_timed_out_requests` | 46 | 2 | 2 | 2025-03 | 2025-03 |
| `start_node_migration` | 30 | 4 | 11 | 2026-04 | 2026-10 |
| `register_backup_service` | 26 | 7 | 18 | 2026-03 | 2026-10 |
| `conclude_node_migration` | 25 | 2 | 11 | 2026-04 | 2026-10 |
| `migrate` | 24 | 1 | 1 | 2025-02 | 2026-10 |
| `propose_update` | 24 | 1 | 1 | 2025-02 | 2026-10 |
| `init_running` | 23 | 12 | 1 | 2024-07 | 2025-04 |
| `vote_tee_verifier_change` | 23 | 0 | 16 | 2026-07 | 2026-11 |
| `vote_join` | 21 | 9 | 8 | 2025-01 | 2025-04 |
| `clean_invalid_attestations` | 20 | 3 | 4 | 2026-04 | 2026-11 |
| `vote_remove_os_measurement` | 18 | 0 | 16 | 2026-10 | 2026-10 |
| `vote_leave` | 16 | 6 | 8 | 2025-01 | 2025-12 |
| `clean_tee_status` | 15 | 1 | 1 | 2025-11 | 2026-10 |
| `remove_non_participant_update_votes` | 13 | 0 | 1 | 2026-01 | 2026-08 |
| `join` | 11 (capped) | 2989 | 7 | 2024-08 | 2025-04 |
| `vote_contract_update` | 11 | 24 | 15 | 2026-10 | 2026-10 |
| `cleanup_orphaned_node_migrations` | 10 | 6 | 1 | 2025-11 | 2026-10 |
| `start_keygen_instance` | 10 | 0 | 2 | 2025-04 | 2026-11 |
| `vote_foreign_chain_policy` | 9 | 0 | 9 | 2026-02 | 2026-03 |
| `vote_abort_key_event_instance` | 7 | 44 | 15 | 2025-11 | 2026-08 |
| `clean_foreign_chain_data` | 6 | 4 | 1 | 2026-05 | 2026-10 |
| `remove_non_participant_tee_verifier_votes` | 4 | 0 | 1 | 2026-07 | 2026-10 |
| `remove_non_participant_contract_update_votes` | 2 | 0 | 1 | 2026-10 | 2026-10 |
| `post_upgrade_cleanup` | 1 | 1 | 1 | 2026-01 | 2026-01 |
| `pub_migrate` | 1 | 0 | 1 | 2025-11 | 2025-11 |
| `submit_contract_update` | 1 | 0 | 1 | 2026-10 | 2026-10 |

`migrate`, `init_running`, `start_*`, `clean_*`, `register_*`, `pub_migrate` and `post_upgrade_cleanup` are not votes. They are listed because they are the calls that apply or maintain changes.

### By month

Groups: **upgrade** = `propose_update`, `vote_update`, `submit_contract_update`, `vote_contract_update`; **domains** = `vote_add_domains`; **participants** = `vote_new_parameters`, `vote_join`, `vote_leave`; **key events** = `vote_pk`, `vote_reshared`, `vote_abort_key_event_instance`, `vote_cancel_*`; **TEE** = `vote_code_hash`, `vote_add/remove_launcher_hash`, `vote_add/remove_os_measurement`, `vote_mpc_node_manifest_digest`, `vote_tee_verifier_change`; **foreign chain** = `vote_foreign_chain_policy`, `vote_update_foreign_chain_providers`. Counts include failed receipts. Months with no receipts for any queried method (2025-07, 2025-10) are omitted. 2024 has no votes because the code was then changed only with the account's keys. Per-method, per-month counts with ok/fail splits are in [`governance-by-month.json`](signer-history/governance-by-month.json).

| month | upgrade | domains | participants | key events | TEE | foreign chain | votes total | vote-path upgrades applied |
|---|---|---|---|---|---|---|---|---|
| 2024-07 |  |  |  |  |  |  | 0 |  |
| 2024-08 |  |  |  |  |  |  | 0 |  |
| 2024-09 |  |  |  |  |  |  | 0 |  |
| 2024-10 |  |  |  |  |  |  | 0 |  |
| 2024-11 |  |  |  |  |  |  | 0 |  |
| 2025-01 |  |  | 17 | 16 |  |  | 33 |  |
| 2025-02 | 16 |  |  |  |  |  | 16 | 1 |
| 2025-03 |  |  | 24 | 22 |  |  | 46 |  |
| 2025-04 | 9 | 7 | 25 | 43 |  |  | 84 | 1 |
| 2025-05 | 7 |  |  |  |  |  | 7 | 1 |
| 2025-06 | 7 |  |  |  |  |  | 7 | 1 |
| 2025-08 |  |  | 21 | 16 |  |  | 37 |  |
| 2025-09 |  |  | 15 | 20 |  |  | 35 |  |
| 2025-11 | 22 | 10 | 10 | 33 |  |  | 75 | 1 |
| 2025-12 | 10 | 7 | 1 | 18 |  |  | 36 | 1 |
| 2026-01 | 10 |  | 44 | 142 |  |  | 196 | 1 |
| 2026-02 | 14 |  |  |  |  | 7 | 21 | 2 |
| 2026-03 | 16 | 9 | 11 | 63 | 7 | 2 | 108 | 2 |
| 2026-04 | 13 |  |  |  | 11 |  | 24 | 2 |
| 2026-05 | 10 |  | 27 | 36 | 30 |  | 103 | 1 |
| 2026-06 | 21 |  | 90 | 272 | 61 | 13 | 457 | 2 |
| 2026-07 | 13 |  | 36 | 74 | 70 |  | 193 | 1 |
| 2026-08 | 34 |  | 17 | 97 | 32 |  | 180 | 2 |
| 2026-09 | 43 |  |  |  | 26 | 40 | 109 | 3 |
| 2026-10 | 49 |  | 40 | 143 | 77 |  | 309 | 2 |
| 2026-11 |  | 16 |  | 64 | 27 |  | 107 |  |

## Current state

Snapshot at block 277427970 (2026-11-12 23:01 UTC), raw JSON in [`current-state.json`](signer-history/current-state.json):

- `version`: `3.18.0`, `contract_source_metadata.link`: `https://github.com/near/mpc/tree/e691bdb98d68dcf74653da58d043453a6318765f`
- `state`: `Running`, keyset epoch 27, threshold 11 of 16 participants, `next_domain_id` 8
- Domains: 0 CaitSith/Sign, 1 Frost/Sign, 2 ConfidentialKeyDerivation/CKD, 3 CaitSith/ForeignTx, 4 CaitSith/Sign, 5 Frost/Sign, 6 CKD, 7 CaitSith/ForeignTx (4–7 voted in 2026-11-10/11)
- `public_key`:
  - domain 0: `secp256k1:4NfTiv3UsGahebgTaHyD9vF8KYKMBnfd6kh94mK6xv8fGBiJB8TBtFMP5WWXz6B89Ac1fbpzPwAvoyQebemHFwx3`
  - domain 1: `ed25519:6vSEtQxrQj6txUMh33WC4ERyCWmNMRTdufDWAaDY3Un2`
  - domain 2: `bls12381g2:xeYho48G2Sr9oJz4gw9sLGZGspeeKpHZvMDAwWvoNTRnVMFJH96GxX98TT2MRhTtsot1wcGR1Ti2Xh8PCsbYJ2enbLNdJXDvTYSK8aTE3nJ5NZXU7Kt1F6mFtReWs5pR4kj`
  - domain 3: `secp256k1:2KGCoy2pZt7n85QfJnQzCT1eHySuNpquUfNc8ySpRbr15F5kqU7agJYjfo5RkrzNd4tZimDFv2wAZri7RRZ32qj1`
- Foreign-chain policy: `allowed_foreign_chain_providers` lists 12 chains (Solana, Base, Bnb, Arbitrum, Abstract, Starknet, Polygon, HyperEvm, Aptos, Sui, Avalanche, Fogo). The legacy `get_foreign_chain_policy` was removed in 3.10.1.
- `config`, `contract_update_votes` (empty), `allowed_docker_image_hashes`, `tee_verifier_account_id` (`tee-verifier-2026-11-02.testnet`, another account the signer now calls) and `migration_info` are all in the snapshot.
- The full ABI that nearblocks parsed is in [`contract-schema-nearblocks.json`](signer-history/contract-schema-nearblocks.json).

## Domain public keys

`public_key` was called with no args and with `{"domain_id":0..3}` at 98 heights: every 1.5 M blocks from 2024-07-25, 3 blocks after every vote-path deploy, and the final head ([`pubkey-history.json`](signer-history/pubkey-history.json)). A second pass ([`pubkey-spot.json`](signer-history/pubkey-spot.json)) checked 5 blocks after every successful key-signed deploy or `init_running`, and after the last `vote_reshared`, `vote_pk` and `vote_add_domains` of each day.

| domain | key | first seen | changed? |
|---|---|---|---|
| 0 (and no-arg call) | `secp256k1:4NfTiv3U…` | 2024-07-25 (after first `init_running`) | **never**, in all samples through 2026-11-12 |
| 1 | `ed25519:6vSEtQxr…` | between 2025-04-14 and 2025-04-23 (vote_add_domains 2025-04-17) | no |
| 2 | `bls12381g2:xeYho48G…` | between 2025-11-20 and 2025-12-10 | no |
| 3 | `secp256k1:2KGCoy2p…` | between 2026-02-25 and 2026-03-06 (vote_add_domains 2026-03-02) | no |

How the method signature changed:

- **Before 2.0.0-rc.1 (2024-07-25 → 2025-04-14)** the contract had a single key. `public_key` ignored its arguments, so `{"domain_id":3}` returned the domain 0 key. Reading a historical `domain_id:3` value from that period would be wrong.
- **From 2.0.0-rc.1** `public_key` takes an optional `domain_id`. With no argument it still returns domain 0. A domain that does not exist yet panics (`HostError`).
- The current `state.keyset` shows `attempt: 1` for domains 0 and 3 (and 0 for the rest). The key value did not change in any sample, so a non-zero attempt does not mean the key changed. Historical `state` shapes were not compared.

The spot pass covered 88 heights and found the same result: domain 0 has 1 distinct value, and domains 1/2/3 each have 1 value since creation. Their only other value is the pre-2.0.0 echo of the domain 0 key.

`public_key` can be temporarily **unavailable** even when no key changes. While new domains are being generated the protocol state is `Initializing`, and `public_key` for an existing domain panics with `Protocol state is not running, nor resharing.` (the `sign` path checks the same state, but that was not tested here). Measured windows ([`keygen-windows.json`](signer-history/keygen-windows.json)):

| keygen round | first failing block | recovered at | duration |
|---|---|---|---|
| 2025-04-18 | 193199054 | 193199073 | 19 blocks, ~12 s |
| 2025-12-03 | 225788709 | 225788847 | 138 blocks, ~1.3 min |
| 2026-03-02 | 239294193 | 239294248 | 55 blocks, ~0.5 min |
| 2026-11-11 | 277201391 | 277201573 | 182 blocks, ~1.8 min |

The two vote rounds in 2025-11 did not put the contract into this state at last-vote + 5 blocks. The rounds are bisected under the assumption that each has one contiguous window.

## `sign` volume

nearblocks v3 has no public count endpoint (`/txns/count` returns "This endpoint is currently unavailable."). Two approximations:

1. `sign` receipts per month. For each month, take three sample points (the 5th, 15th and 25th at 12:00 UTC). At each point fetch the 100 most recent `sign` receipts before it, compute rate = 99 / (time span + gap to the sample point), and average × the length of the month. Bursty callers make this a rough order of magnitude only. 2026-11 is a single sample extrapolated to a full month.
2. All transactions to or from the signer per day, from `/stats/txns` (exact, but only the last 365 days, and it counts every method including `respond`).

| month | est. `sign` receipts | sample rates (receipts/s) | top caller in samples | all txns, daily stats |
|---|---|---|---|---|
| 2024-07 | ~0 | 0.0000 / 0.0000 / 0.0000 | – | – |
| 2024-08 | ~1,334 | 0.0003 / 0.0004 / 0.0008 | `louddish8727.testnet` | – |
| 2024-09 | ~8,373 | 0.0005 / 0.0007 / 0.0085 | `proxy-1.testnet` | – |
| 2024-10 | ~22,843 | 0.0071 / 0.0074 / 0.0112 | `ping-account.testnet` | – |
| 2024-11 | ~76,469 | 0.0003 / 0.0445 / 0.0437 | `ping-account.testnet` | – |
| 2024-12 | ~119,259 | 0.0446 / 0.0440 / 0.0449 | `ping-account.testnet` | – |
| 2025-01 | ~41,677 | 0.0020 / 0.0003 / 0.0444 | `ping-account.testnet` | – |
| 2025-02 | ~80,055 | 0.0448 / 0.0442 / 0.0103 | `ping-account.testnet` | – |
| 2025-03 | ~11,563 | 0.0010 / 0.0104 / 0.0016 | `v2.atlas_public_testnet.testnet` | – |
| 2025-04 | ~9,023 | 0.0028 / 0.0014 / 0.0062 | `v2.atlas_public_testnet.testnet` | – |
| 2025-05 | ~43,435 | 0.0061 / 0.0014 / 0.0411 | `v2.atlas_public_testnet.testnet` | – |
| 2025-06 | ~25,261 | 0.0178 / 0.0078 / 0.0036 | `tx-bench.testnet` | – |
| 2025-07 | ~14,399 | 0.0047 / 0.0086 / 0.0029 | `tx-bench.testnet` | – |
| 2025-08 | ~12,736 | 0.0027 / 0.0038 / 0.0078 | `tx-bench.testnet` | – |
| 2025-09 | ~9,445 | 0.0034 / 0.0035 / 0.0040 | `tx-bench.testnet` | – |
| 2025-10 | ~12,770 | 0.0033 / 0.0077 / 0.0033 | `tx-bench.testnet` | – |
| 2025-11 | ~17,574 | 0.0054 / 0.0082 / 0.0067 | `tx-bench.testnet` | 39,133 (19 days) |
| 2025-12 | ~50,997 | 0.0081 / 0.0240 / 0.0251 | `tx-bench.testnet` | 78,400 |
| 2026-01 | ~21,099 | 0.0067 / 0.0102 / 0.0067 | `tx-bench.testnet` | 53,035 |
| 2026-02 | ~21,337 | 0.0081 / 0.0069 / 0.0115 | `tx-bench.testnet` | 65,989 |
| 2026-03 | ~17,887 | 0.0066 / 0.0067 / 0.0067 | `tx-bench.testnet` | 85,894 |
| 2026-04 | ~17,424 | 0.0067 / 0.0068 / 0.0067 | `tx-bench.testnet` | 63,019 |
| 2026-05 | ~104,172 | 0.1032 / 0.0067 / 0.0067 | `tx-bench.testnet` | 77,547 |
| 2026-06 | ~17,290 | 0.0066 / 0.0067 / 0.0067 | `tx-bench.testnet` | 55,429 |
| 2026-07 | ~17,624 | 0.0066 / 0.0066 / 0.0065 | `tx-bench.testnet` | 51,958 |
| 2026-08 | ~19,774 | 0.0072 / 0.0067 / 0.0083 | `tx-bench.testnet` | 62,793 |
| 2026-09 | ~71,232 | 0.0067 / 0.0092 / 0.0666 | `tx-bench.testnet` | 129,918 |
| 2026-10 | ~189,387 | 0.0667 / 0.0790 / 0.0664 | `tx-bench.testnet` | 382,067 |
| 2026-11 | ~210,923 | 0.0814 | `tx-bench.testnet` | 149,365 (11 days) |

Most `sign` traffic in the samples comes from load generators (`ping-account.testnet` in late 2024, `tx-bench.testnet` from mid-2025, a `loadtest-*` burst in 2026-05). Organic usage is a small fraction.

## Gaps and caveats

- **Code changes**: complete for code-hash changes. Samples every 250,000 blocks plus 2 blocks before and 6 after every deploy that nearblocks reported, and every difference bisected to one block. An A→B→A flip inside one 250 k-block gap with no deploy that nearblocks indexed would be missed. All 50 successful deploys nearblocks reports are accounted for (48 hash changes, 2 same-code redeploys).
- **nearblocks pagination**: every method was paged to the end, except `join`, `verify_tee` and `submit_participant_info`, which stopped at the 30-page cap (3,000 rows each). Their totals are lower bounds. `/v3/accounts/{id}/txns` ignores a `method` filter, which is why receipts were used.
- **nearblocks deployments endpoint** (`/contract/deployments`) returns only the first and the latest deploy (2 rows), so it can't be used as a history.
- **`version` view**: missing or failing on 1.0.0-rc.1…rc.3 and on 3.0.2's first block. For those rows the NEP-330 `contract_source_metadata.version` is shown.
- **Argument formats** of `sign` and `respond` were not diffed version by version (only exported names were). The ABI (`__contract_abi`) is embedded only from 3.2.0 on.
- **Votes** count receipts with that method name, including failed and duplicate ones. They are not distinct proposals.
- **RPC**: `archival-rpc.testnet.fastnear.com` returned HTTP 429 under load. The scripts back off and cache results (`view-account-cache.json`).

## Re-run

Requires Node ≥ 20 (uses global `fetch`). From `docs/evidence/deps/signer-history/scripts/`:

```sh
# 1. account creation + deployments index (nearblocks v3; v1 was retired 2026-11-05)
curl -s https://api-testnet.nearblocks.io/v3/accounts/v1.signer-prod.testnet
curl -s https://api-testnet.nearblocks.io/v3/accounts/v1.signer-prod.testnet/contract/deployments
curl -s https://api-testnet.nearblocks.io/v3/accounts/v1.signer-prod.testnet/contract/schema > ../contract-schema-nearblocks.json

# 2. governance receipts, one file per method in ../receipts/ (~2 s per request)
node nearblocks-receipts.mjs migrate init init_running vote_update propose_update vote_contract_update \
  submit_contract_update remove_contract_update_vote vote_add_domains vote_new_parameters vote_cancel_resharing \
  vote_cancel_keygen vote_abort_key_event_instance vote_update_foreign_chain_providers vote_foreign_chain_policy \
  register_foreign_chains_config vote_pk vote_reshared vote_join vote_leave vote_code_hash vote_add_launcher_hash \
  vote_remove_launcher_hash vote_add_os_measurement vote_remove_os_measurement vote_mpc_node_manifest_digest \
  vote_tee_verifier_change withdraw_tee_verifier_vote update_config start_keygen_instance start_reshare_instance
MAX_PAGES=30 node nearblocks-receipts.mjs remove_update_vote remove_update_proposal remove_non_participant_update_votes \
  remove_non_participant_contract_update_votes remove_non_participant_tee_verifier_votes pub_migrate post_upgrade_cleanup \
  register_foreign_chain_config register_foreign_chain_support join start_node_migration conclude_node_migration \
  cancel_node_migration update_participant_url register_backup_service clean_tee_status cleanup_orphaned_node_migrations \
  clean_invalid_attestations clean_foreign_chain_data clean remove_timed_out_requests verify_tee submit_participant_info

# 3. transactions signed by the account's own keys (direct deploys), -> ../txns-signed-by-signer-account.json
#    GET /v3/accounts/v1.signer-prod.testnet/txns?signer=v1.signer-prod.testnet&limit=100 (+ &next=<meta.next_page>)
curl -s 'https://api-testnet.nearblocks.io/v3/accounts/v1.signer-prod.testnet/txns?signer=v1.signer-prod.testnet&limit=100'

# 4. code_hash scan + bisection on archival RPC, then per-version exports/version/metadata
NEAR_RPC=https://archival-rpc.testnet.fastnear.com node scan-code-hash.mjs   # -> ../code-hash-{samples,changes}.json
NEAR_RPC=https://archival-rpc.testnet.fastnear.com node versions.mjs         # -> ../code-versions.json
node reconcile.mjs                                                           # -> ../code-changes-table.json + table

# 5. current state and keys
node current-state.mjs                                                       # rpc.testnet.near.org -> ../current-state.json
curl -s -X POST https://rpc.testnet.near.org -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"view_access_key_list","finality":"final","account_id":"v1.signer-prod.testnet"}}' \
  > ../access-keys-current.json
NEAR_RPC=https://archival-rpc.testnet.fastnear.com node pubkey-history.mjs   # -> ../pubkey-history.json
NEAR_RPC=https://archival-rpc.testnet.fastnear.com node pubkey-spot.mjs      # -> ../pubkey-spot.json
NEAR_RPC=https://archival-rpc.testnet.fastnear.com node keygen-windows.mjs   # -> ../keygen-windows.json

# 6. aggregates
node governance-summary.mjs                                                  # -> ../governance-by-month.json + tables
node sign-rate.mjs                                                           # -> ../sign-rate.json, ../nearblocks-stats-txns-daily.json
```

A single historical call by hand, e.g. `public_key` for domain 0 at the block before 2.0.0-rc.1:

```sh
curl -s -X POST https://archival-rpc.testnet.fastnear.com -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"call_function","block_id":192817950,"account_id":"v1.signer-prod.testnet","method_name":"public_key","args_base64":"'"$(printf '{"domain_id":0}' | base64)"'"}}'
```
