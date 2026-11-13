# lifecycle-20261113-102449

Real mpc-node 3.18.0 x2, signer 3.18.0 code, neard 2.14.0, anvil as Base.

| # | Check | Result |
|---|---|---|
| a | A check-in cancels a witnessed claim | PASS |
| b | The real MPC signature passes on_signed (ecrecover against the vault key) | PASS |
| d1 | A settle before Base finality is not attested; heir stays Pending | PASS |
| d2 | After finality the real MPC attestation marks the heir Paid | PASS |
| e4 | A reverted transfer is not attested | PASS |
| e6 | A witness quorum reopens the revert; the retry waits | PASS |
| f6 | A transfer reorged out before finality is not attested | PASS |
| f10 | The same transfer lands again and settles: heir Paid | PASS |
| g | The real CKD key opens the sealed wishes after a pairing check | PASS |
