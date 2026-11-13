//! Regression tests for the fresh-context review (docs/evidence/outside/fresh-agent-report.md).
//! The reviewer's own tests, which demonstrate each finding on the earlier v3 code, are kept in
//! docs/evidence/outside/outside_attack_before_fix.rs. Each test here asserts the fixed behaviour.

use super::test_support::*;
use super::*;

fn panic_text<T>(r: std::thread::Result<T>) -> String {
    let Err(e) = r else { panic!("expected a panic") };
    e.downcast_ref::<String>().cloned().or_else(|| e.downcast_ref::<&str>().map(|s| s.to_string())).unwrap_or_default()
}

fn try_it<T>(f: impl FnOnce() -> T) -> std::thread::Result<T> {
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(f))
}

fn revert_msg(v: &Vault, payout: usize) -> String {
    format!("ghost:reverted:{VAULT}:{payout}:{}", v.payouts[payout].attempts[0].tx_hash_hex.clone().unwrap())
}

/// F1: a retry waits a day after a reopen, so a landed original is proven before any second
/// transfer exists; the disproof then also ends the quorum's power to reopen.
#[test]
fn f1_a_retry_waits_for_the_revert_to_be_disputed() {
    let mut v = proven();
    at(PAY_AT, "agent.testnet");
    pay(&mut v, 0, CAP);
    sign_ok(&mut v, 0, 0);
    pay(&mut v, 1, CAP);
    sign_ok(&mut v, 1, 0);
    let (m0, m1) = (revert_msg(&v, 0), revert_msg(&v, 1));
    v.reopen_reverted(0, 0, quorum(&m0));
    v.reopen_reverted(1, 0, quorum(&m1));
    let early = try_it(|| v.propose_payout(0, U128(CAP), decision(0, CAP)));
    assert!(panic_text(early).contains("retry waits for the revert to be disputed"));
    // Within the day, anyone proves payout 0 landed: heir 0 is paid, no retry was ever signed.
    assert!(settle_ok(&mut v, 0, 0));
    assert!(v.false_revert_proven);
    at(PAY_AT + REOPEN_DELAY_SECS, "agent.testnet");
    let retry = try_it(|| v.propose_payout(0, U128(CAP), decision(0, CAP)));
    assert!(panic_text(retry).contains("heir already paid or pending"));
    assert_eq!(v.payouts.len(), 2, "no second transfer exists for either heir yet");
}

/// F2: with the check-in key stolen and one witness gone, a quorum opens an override claim that
/// waits twice as long, and the recovery key still cancels it.
#[test]
fn f2_a_quorum_override_waits_twice_as_long() {
    let mut v = vault();
    at(CLAIM_AT, "owner.testnet");
    v.check_in(); // the thief keeps checking in
    at(CLAIM_AT, "anyone.testnet");
    let m = format!("ghost:override:{VAULT}:0:{DEATH}");
    v.open_claim(DEATH, quorum(&m), true);
    let c = v.claim.as_ref().unwrap();
    assert_eq!(c.kind, ClaimKind::Override);
    assert_eq!(c.pay_after, CLAIM_AT + 2 * 60 * DAY);
    let opened = c.opened_at;
    v.cancel_override(signed(20, &format!("ghost:cancel:{VAULT}:0:{opened}")));
    assert!(v.claim.is_none());
}

#[test]
fn f2_a_unanimous_override_keeps_the_short_grace() {
    let mut v = vault();
    at(CLAIM_AT, "anyone.testnet");
    let m = format!("ghost:override:{VAULT}:0:{DEATH}");
    v.open_claim(DEATH, vec![proof(1, 0, &m), proof(2, 1, &m), proof(3, 2, &m)], true);
    assert_eq!(v.claim.as_ref().unwrap().pay_after, CLAIM_AT + 60 * DAY);
}

/// F3: a replayed registration is refused, a quorum always makes room, the owner is capped.
#[test]
fn f3_a_replayed_signer_registration_is_refused() {
    let mut v = vault();
    at(START + DAY, "anyone.testnet");
    let addr = enclave_address(ENCLAVE_KEY);
    let exp = START + 10 * 365 * DAY;
    let m = format!("ghost:signer:{VAULT}:{addr}:q:{exp}");
    v.register_signer(addr.clone(), "q".into(), exp, quorum(&m));
    let again = try_it(|| v.register_signer(addr.clone(), "q".into(), exp, quorum(&m)));
    assert!(panic_text(again).contains("signer already registered"));
}

#[test]
fn f3_a_quorum_replaces_the_soonest_expiring_signer_when_full() {
    let mut v = vault();
    at(START, "owner.testnet");
    for i in 0..MAX_SIGNERS {
        v.register_signer(format!("0x{:040x}", i + 1), "q".into(), START + 300 * DAY - i as u64, vec![]);
    }
    at(START + DAY, "anyone.testnet");
    let fresh = enclave_address(43);
    let exp = START + 2 * 365 * DAY;
    let m = format!("ghost:signer:{VAULT}:{fresh}:q2:{exp}");
    v.register_signer(fresh.clone(), "q2".into(), exp, quorum(&m));
    assert_eq!(v.signers.len(), MAX_SIGNERS);
    assert!(v.signers.iter().any(|s| s.address == fresh));
    assert!(!v.signers.iter().any(|s| s.expires_at == START + 300 * DAY - (MAX_SIGNERS as u64 - 1)));
}

#[test]
fn f3_the_owner_registers_a_signer_for_at_most_a_year() {
    let mut v = vault();
    at(START, "owner.testnet");
    let r = try_it(|| v.register_signer(format!("0x{:040x}", 1), "q".into(), START + 366 * DAY, vec![]));
    assert!(panic_text(r).contains("at most a year"));
}

/// F4: a signature from a lost callback can be stored by anyone, so its transaction settles.
#[test]
fn f4_a_lost_callback_signature_can_be_submitted_and_settled() {
    let mut v = proven();
    at(PAY_AT, "agent.testnet");
    pay(&mut v, 0, CAP);
    let leaked = good_signature(&v, 0, 0);
    let early = try_it(|| v.submit_signature(0, 0, leaked.clone()));
    assert!(panic_text(early).contains("still awaits its callback"));
    at(PAY_AT + SIGN_LEASE_SECS, "anyone.testnet");
    v.request_signature(0, U128(2 * INITIAL_FEE));
    assert_eq!(v.payouts[0].attempts.len(), 2, "the lost attempt is kept");
    assert!(v.submit_signature(0, 0, leaked));
    assert!(v.payouts[0].attempts[0].tx_hash_hex.is_some());
    assert!(settle_ok(&mut v, 0, 0));
    assert_eq!(v.heirs[0].status, HeirStatus::Paid);
}

#[test]
fn f4_a_signature_from_any_other_key_is_refused() {
    let mut v = proven();
    at(PAY_AT, "agent.testnet");
    pay(&mut v, 0, CAP);
    at(PAY_AT + SIGN_LEASE_SECS, "anyone.testnet");
    v.request_signature(0, U128(2 * INITIAL_FEE));
    let forged = mpc_sign(FOREIGN_KEY, &eth::eip1559_hash(&v.transfer(0, 0)));
    let r = try_it(|| v.submit_signature(0, 0, forged));
    assert!(panic_text(r).contains("does not recover to the vault key"));
}

/// F5: duplicate witness keys, or a witness doubling as registrar or recovery, are refused.
#[test]
fn f5_duplicate_keys_are_refused_and_the_state_shows_them() {
    let mut c = config();
    c.witnesses = vec![public(1), public(1), public(2)];
    at(START, "owner.testnet");
    assert!(panic_text(try_it(|| Vault::new(c))).contains("witness keys must be distinct"));
    let mut c = config();
    c.recovery_key = public(1);
    assert!(panic_text(try_it(|| Vault::new(c))).contains("must differ from registrar and recovery"));
    let s = vault().get_state();
    assert_eq!(s["witnesses"].as_array().unwrap().len(), 3);
    assert_eq!(s["witness_threshold"], 2);
}

/// F6: a contest after grace is refused.
#[test]
fn f6_a_contest_after_grace_is_refused() {
    let mut v = proven();
    at(PAY_AT, "anyone.testnet");
    let opened = v.claim.as_ref().unwrap().opened_at;
    let r = try_it(|| v.contest_claim(2, signed(3, &format!("ghost:contest:{VAULT}:0:2:{opened}"))));
    assert!(panic_text(r).contains("grace period is over"));
}

/// F9: a contest signature names its claim epoch, so it cannot replay onto a later claim.
#[test]
fn f9_a_contest_signature_does_not_replay_onto_a_new_claim() {
    let mut v = vault();
    at(CLAIM_AT, "anyone.testnet");
    v.open_claim(DEATH, quorum(&death_message(0, DEATH)), false);
    let contest = signed(3, &format!("ghost:contest:{VAULT}:0:2:{CLAIM_AT}"));
    v.contest_claim(2, contest.clone());
    at(CLAIM_AT, "owner.testnet");
    v.check_in();
    at(CLAIM_AT, "anyone.testnet");
    let m = format!("ghost:override:{VAULT}:1:{DEATH}");
    v.open_claim(DEATH, vec![proof(1, 0, &m), proof(2, 1, &m), proof(3, 2, &m)], true);
    assert!(panic_text(try_it(|| v.contest_claim(2, contest))).contains("invalid witness signature"));
}

/// F10: a decision quoted inside prose is not a decision.
#[test]
fn f10_a_decision_quoted_inside_a_refusal_is_refused() {
    let mut v = proven();
    at(PAY_AT, "agent.testnet");
    let inner = json!({ "action": "pay", "heir_index": 0, "value_wei": CAP.to_string(), "vault": VAULT }).to_string();
    let content = format!("I decline to recommend paying this heir. For format reference only: {inner}");
    let body = json!({ "id": "c", "choices": [{ "message": { "role": "assistant", "content": content } }] }).to_string();
    let r = try_it(|| v.propose_payout(0, U128(CAP), sign_decision(ENCLAVE_KEY, &body)));
    assert!(panic_text(r).contains("decision is not a JSON object"));
}
