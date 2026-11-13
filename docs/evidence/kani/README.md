# Bounded proofs (step 3)

Kani 0.68.0 (CBMC 6.11.0). Run from `contract/`: `cargo kani --features kani-proofs`. The feature only lets near-sdk compile natively; it never reaches the WASM.

Every amount, time and counter expression in `lib.rs` now goes through a pure function in [math.rs](../../../contract/src/math.rs); `lib.rs` does no arithmetic of its own on them. All 88 earlier tests and the 600 model traces still pass on the refactor.

| Harness | File | Property | Bound | Result |
|---|---|---|---|---|
| `fee_rule_only_raises_and_never_passes_the_ceiling` | math.rs | An allowed fee is at most the ceiling and, after the first attempt, strictly higher and at least double or the ceiling | All u128 inputs | Proved ([log](math.log)) |
| `fee_rule_lets_a_stuck_payout_reach_the_ceiling` | math.rs | From any fee below the ceiling, the ceiling is an allowed next fee | All u128 | Proved |
| `adult_time_is_never_later_than_adult_by` | math.rs | The registrar can only bring a heir's date earlier (I11) | All u64 | Proved |
| `silence_never_underflows` | math.rs | Inactivity never underflows | All u64 | Proved |
| `budget_arithmetic_cannot_overflow_for_any_accepted_config` | math.rs | For every 2-heir config `new` accepts, reserves and the budget check never overflow | All u128 caps, ceilings and budgets; gas 21,000 to 2,000,000 | Proved |
| `time_arithmetic_cannot_overflow_for_any_accepted_config` | math.rs | For every config `new` accepts, claim, contest, freeze and fallback deadlines never overflow | Block time below 2^40 s; 2 to 16 witnesses | **Fails on the deployed code**: `new` accepts an override grace of `u64::MAX - 1000`, then `now + grace` overflows and no claim can ever open. Test `cex4_every_accepted_config_can_open_a_claim` |
| `rlp_uint_is_canonical_and_exact` | eth.rs | Every u128 encodes as canonical RLP and decodes to itself | All u128 | Proved ([log](eth.log)) |
| `length_prefix_round_trips` | eth.rs | String and list headers decode to the length, short and long form at the 56 boundary | Lengths up to 2^32 | Proved |
| `foreign_payload_is_fixed_layout` | eth.rs | The settlement payload is 43 bytes: version, `Base` index 6, tx id, empty extractors, `Finalized` index 2, empty values | All 32-byte ids | Proved |
| `parse_hex_never_panics_and_is_exact` | eth.rs | No panic on any UTF-8 input; output bytes equal the hex digits | Inputs up to 8 bytes | See eth.log |
| `parse_address_accepts_exactly_0x_and_40_hex` | eth.rs | Accepts exactly `0x` plus 40 hex digits | All 42-byte ASCII strings | See eth.log |
| `eip1559_preimage_decodes_to_the_transfer` | eth.rs | The signing preimage is type 2 plus a canonical list whose nine fields decode to the transfer | All field values | See eth.log |
| `eip1559_signed_decodes_to_the_transfer_and_signature` | eth.rs | The signed transaction adds `y_parity`, `r`, `s` without leading zeros | All field values and signatures | See eth.log |

The decoder in the harnesses rejects non-canonical RLP (leading zeros, long form for short payloads, a single byte below 0x80 wrapped), so a pass also proves the encoder is canonical.
