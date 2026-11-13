//! Each test is a model-checker counterexample from spec/ghost.qnt, replayed on the contract.
//! Logs: docs/evidence/spec/. They fail on the deployed v2 code and pass after the fix.

use super::test_support::*;
use super::*;

/// spec invariant `inv_wishes` (quint run, seed 0xefafe): the wishes key is released after grace,
/// then the claim is cancelled. The heirs' wishes are out while the vault says nobody died.
#[test]
fn cex1_wishes_release_makes_a_normal_claim_permanent() {
    let mut v = proven();
    at(PAY_AT, "anyone.testnet");
    v.request_wishes_key();
    at(PAY_AT + 1, "owner.testnet");
    let cancelled = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| v.check_in())).is_ok();
    assert!(!cancelled, "a check-in cancelled the claim after the wishes key was released");
}

#[test]
fn cex1_wishes_release_makes_an_override_claim_permanent() {
    let mut v = vault();
    at(CLAIM_AT, "anyone.testnet");
    let m = format!("ghost:override:{VAULT}:0:{DEATH}");
    v.open_claim(DEATH, vec![proof(1, 0, &m), proof(2, 1, &m), proof(3, 2, &m)], true);
    let opened = v.claim.as_ref().unwrap().opened_at;
    at(CLAIM_AT + 61 * DAY, "anyone.testnet");
    v.request_wishes_key();
    let sig = signed(20, &format!("ghost:cancel:{VAULT}:0:{opened}"));
    let cancelled = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| v.cancel_override(sig))).is_ok();
    assert!(!cancelled, "the recovery key cancelled the claim after the wishes key was released");
}

/// spec invariant `inv_signing_has_callback` (quint run, seed 7): `on_signed` runs out of gas or
/// storage and rolls back, so `signing` stays true and nobody can ever request a signature again.
/// That nonce, and every later one, can never be mined.
#[test]
fn cex2_a_lost_sign_callback_does_not_strand_the_payout() {
    let mut v = proven();
    at(PAY_AT, "agent.testnet");
    pay(&mut v, 0, CAP);
    assert!(v.payouts[0].signing);
    // No on_signed: the callback receipt failed and its changes were rolled back.
    at(PAY_AT + 2 * DAY, "relayer.testnet");
    let retried = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        v.request_signature(0, U128(INITIAL_FEE));
        v
    }));
    let mut v = retried.unwrap_or_else(|_| panic!("payout stranded: no new signature can ever be requested"));
    assert_eq!(v.payouts[0].attempts.len(), 1, "the dead attempt is replaced, not kept");
    sign_ok(&mut v, 0, 0);
    assert!(v.payouts[0].attempts[0].tx_hash_hex.is_some());
}

/// TLC, `inv_budget` (docs/evidence/spec/tlc-v2-cex-committed.log): a lying quorum reopens a payout
/// that landed, the MPC network then attests it, and `committed_wei` still excludes the value that
/// left. Later payouts are then signed against money the vault no longer has.
#[test]
fn cex3_a_disproved_revert_restores_committed_value() {
    let mut v = proven();
    at(PAY_AT, "agent.testnet");
    pay(&mut v, 0, CAP);
    sign_ok(&mut v, 0, 0);
    let reserve = CAP + 21_000 * CEILING;
    assert_eq!(v.committed_wei, reserve);
    let m = format!("ghost:reverted:{VAULT}:0:{}", v.payouts[0].attempts[0].tx_hash_hex.clone().unwrap());
    v.reopen_reverted(0, 0, quorum(&m));
    assert!(settle_ok(&mut v, 0, 0));
    assert!(v.false_revert_proven);
    assert_eq!(v.committed_wei, reserve, "the value that landed is not counted as committed");
}

/// Kani, `time_arithmetic_cannot_overflow_for_any_accepted_config` (docs/evidence/kani/math.log):
/// `new` accepts a grace period so long that `now + grace` overflows, so no claim can ever open and
/// the funds are stranded. Either `new` must refuse the config, or the claim must open.
#[test]
fn cex4_every_accepted_config_can_open_a_claim() {
    let mut c = config();
    c.override_grace_secs = u64::MAX - 1_000;
    c.contest_secs = 0;
    c.freeze_max_secs = 0;
    c.fallback_secs = u64::MAX;
    at(START, "owner.testnet");
    let Ok(mut v) = std::panic::catch_unwind(|| Vault::new(c)) else { return };
    at(CLAIM_AT, "anyone.testnet");
    let m = format!("ghost:override:{VAULT}:0:{DEATH}");
    let opened = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        v.open_claim(DEATH, vec![proof(1, 0, &m), proof(2, 1, &m), proof(3, 2, &m)], true)
    }));
    assert!(opened.is_ok(), "new accepted a config under which no claim can ever open");
}
