//! Random sequences of every public method must never break an invariant.
//! A panic in a real NEAR call reverts state, so each failed step restores a snapshot.

use super::test_support::*;
use super::*;
use near_sdk::borsh;
use proptest::prelude::*;
use std::panic::{catch_unwind, AssertUnwindSafe};

#[derive(Clone, Debug)]
enum Op {
    Advance(u64),
    CheckIn,
    Claim { good: bool, over: bool },
    Contest(u32),
    CancelOverride { good: bool },
    Adult { heir: u32, late: bool },
    Freeze,
    Propose { heir: u32, value: u128, good: bool },
    Fallback(u32),
    Reprice { payout: u32, fee: u128 },
    Signed { payout: u32, good: bool },
    Settled { payout: u32, good: bool },
    Reopen { payout: u32 },
    Wishes,
}

fn op() -> impl Strategy<Value = Op> {
    prop_oneof![
        (1u64..120).prop_map(|d| Op::Advance(d * DAY)),
        Just(Op::CheckIn),
        (any::<bool>(), any::<bool>()).prop_map(|(good, over)| Op::Claim { good, over }),
        (0u32..4).prop_map(Op::Contest),
        any::<bool>().prop_map(|good| Op::CancelOverride { good }),
        (0u32..3, any::<bool>()).prop_map(|(heir, late)| Op::Adult { heir, late }),
        Just(Op::Freeze),
        (0u32..3, 0u128..1_500, any::<bool>()).prop_map(|(heir, value, good)| Op::Propose { heir, value, good }),
        (0u32..3).prop_map(Op::Fallback),
        (0u32..3, 0u128..2_000).prop_map(|(payout, fee)| Op::Reprice { payout, fee }),
        (0u32..3, any::<bool>()).prop_map(|(payout, good)| Op::Signed { payout, good }),
        (0u32..3, any::<bool>()).prop_map(|(payout, good)| Op::Settled { payout, good }),
        (0u32..3).prop_map(|payout| Op::Reopen { payout }),
        Just(Op::Wishes),
    ]
}

fn apply(v: &mut Vault, now: &mut u64, op: &Op) {
    match op {
        Op::Advance(by) => *now += by,
        Op::CheckIn => {
            at(*now, "owner.testnet");
            v.check_in();
        }
        Op::Claim { good, over } => {
            at(*now, "anyone.testnet");
            let death = v.last_check_in;
            let kind = if *over { "override" } else { "death" };
            let m = format!("ghost:{kind}:{VAULT}:{}:{death}", v.claim_epoch);
            let mut p = vec![proof(1, 0, &m)];
            if *good {
                p.push(proof(2, 1, &m));
                p.push(proof(3, 2, &m));
            }
            v.open_claim(death, p, *over);
        }
        Op::Contest(w) => {
            at(*now, "anyone.testnet");
            let opened = v.claim.as_ref().map_or(0, |c| c.opened_at);
            let sig = signed((*w + 1) as u8, &format!("ghost:contest:{VAULT}:{w}:{opened}"));
            v.contest_claim(*w, sig);
        }
        Op::CancelOverride { good } => {
            at(*now, "anyone.testnet");
            let opened = v.claim.as_ref().map_or(0, |c| c.opened_at);
            let seed = if *good { 20 } else { 21 };
            v.cancel_override(signed(seed, &format!("ghost:cancel:{VAULT}:{}:{opened}", v.claim_epoch)));
        }
        Op::Adult { heir, late } => {
            at(*now, "anyone.testnet");
            let t = if *late { u64::MAX } else { START };
            v.prove_adult(*heir, t, adult(*heir, t));
        }
        Op::Freeze => {
            at(*now, "court.testnet");
            v.freeze();
        }
        Op::Propose { heir, value, good } => {
            at(*now, "agent.testnet");
            let body = decision_body(VAULT, *heir, *value);
            let p = sign_decision(if *good { ENCLAVE_KEY } else { 77 }, &body);
            v.propose_payout(*heir, U128(*value), p);
        }
        Op::Fallback(heir) => {
            at(*now, "anyone.testnet");
            v.execute_fallback(*heir);
        }
        Op::Reprice { payout, fee } => {
            at(*now, "anyone.testnet");
            v.request_signature(*payout, U128(*fee));
        }
        Op::Signed { payout, good } => {
            at(*now, "vault.testnet");
            let i = *payout as usize;
            require!(i < v.payouts.len() && v.payouts[i].signing, "nothing to sign");
            let attempt = v.payouts[i].attempts.len() - 1;
            let hash = eth::eip1559_hash(&v.transfer(i, attempt));
            let sig = mpc_sign(if *good { VAULT_KEY } else { 77 }, &hash);
            v.on_signed(*payout, attempt as u32, v.payouts[*payout as usize].signing_since, Ok(sig));
        }
        Op::Settled { payout, good } => {
            at(*now, "vault.testnet");
            let i = *payout as usize;
            require!(i < v.payouts.len(), "unknown");
            let attempt = v.payouts[i].attempts.iter().rposition(|a| a.tx_hash_hex.is_some()).unwrap();
            let r = attestation(v, i, attempt, if *good { FOREIGN_KEY } else { 77 });
            v.on_settled(*payout, attempt as u32, Ok(r));
        }
        Op::Reopen { payout } => {
            at(*now, "anyone.testnet");
            let i = *payout as usize;
            let attempt = v.payouts[i].attempts.iter().rposition(|a| a.tx_hash_hex.is_some()).unwrap();
            let tx = v.payouts[i].attempts[attempt].tx_hash_hex.clone().unwrap();
            let m = format!("ghost:reverted:{VAULT}:{payout}:{tx}");
            v.reopen_reverted(*payout, attempt as u32, quorum(&m));
        }
        Op::Wishes => {
            at(*now, "anyone.testnet");
            v.request_wishes_key();
        }
    }
}

fn check(v: &Vault) {
    for (n, p) in v.payouts.iter().enumerate() {
        let heir = &v.heirs[p.heir_index as usize];
        assert_eq!(p.to, heir.address, "I2 recipient");
        assert!(p.value_wei.0 >= heir.floor_wei.0 && p.value_wei.0 <= heir.cap_wei.0, "I2 bounds");
        assert_eq!(p.nonce, n as u64, "I6 one nonce per payout");
        assert_eq!(p.gas_limit, heir.gas_limit);
        for a in &p.attempts {
            assert!(a.max_fee_per_gas.0 <= v.max_fee_ceiling, "I6 ceiling");
            if let (Some(r), Some(s), Some(y)) = (&a.r_hex, &a.s_hex, a.y_parity) {
                let digest = eth::parse_hex(&a.payload_hex).unwrap();
                let hash: [u8; 32] = digest.try_into().unwrap();
                let (r, s): ([u8; 32], [u8; 32]) =
                    (eth::parse_hex(r).unwrap().try_into().unwrap(), eth::parse_hex(s).unwrap().try_into().unwrap());
                assert!(recovers_to(&hash, &r, &s, y, &v.vault_public_key), "I5");
            }
        }
        if p.status == PayoutStatus::Settled {
            assert!(p.settled_attempt.is_some(), "I4");
        }
    }
    assert!(v.committed_wei <= v.budget_wei, "I7");
    assert_eq!(v.next_nonce as usize, v.payouts.len(), "I6 no gaps");
    for (i, h) in v.heirs.iter().enumerate() {
        let settled = v.payouts.iter().filter(|p| p.heir_index as usize == i && p.status == PayoutStatus::Settled).count();
        if h.status == HeirStatus::Paid {
            assert!(settled >= 1, "I4 paid without a settled payout");
        }
        assert!(settled <= 1 + h.reopened as usize, "I3 at most one proof, plus a disproved revert");
    }
}

proptest! {
    #![proptest_config(ProptestConfig { cases: 256, failure_persistence: None, ..Default::default() })]

    #[test]
    fn random_operations_never_break_an_invariant(ops in prop::collection::vec(op(), 1..60)) {
        std::panic::set_hook(Box::new(|_| {}));
        let mut v = vault();
        register(&mut v);
        let mut now = START;
        for op in &ops {
            let before = borsh::to_vec(&v).unwrap();
            let created_before = v.payouts.len();
            let (claim, status): (Option<Claim>, Vec<HeirStatus>) = (v.claim.clone(), v.heirs.iter().map(|h| h.status).collect());
            let result = catch_unwind(AssertUnwindSafe(|| apply(&mut v, &mut now, op)));
            if result.is_err() {
                v = borsh::from_slice(&before).unwrap();
                continue;
            }
            if v.payouts.len() > created_before {
                // I8: a new payout requires a matured, unfrozen claim on an open heir.
                let c = claim.expect("I8 payout with no claim");
                prop_assert!(now >= c.pay_after, "I8 before delay");
                prop_assert!(now >= c.frozen_until, "I12 while frozen");
                let p = v.payouts.last().unwrap();
                prop_assert_eq!(status[p.heir_index as usize], HeirStatus::Open);
                if p.source == "fallback" {
                    prop_assert!(now >= c.opened_at + v.fallback_secs, "I13 fallback early");
                }
            }
            check(&v);
        }
        let _ = std::panic::take_hook();
    }
}
