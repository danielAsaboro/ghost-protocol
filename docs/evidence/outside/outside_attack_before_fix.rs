//! Throwaway tests from an outside review of the v3 contract. Each test demonstrates a finding in
//! docs/evidence/outside/fresh-agent-report.md. They assert the current (attackable) behaviour.

use super::test_support::*;
use super::*;

fn panic_text(r: std::thread::Result<()>) -> String {
    let e = r.expect_err("expected a panic");
    e.downcast_ref::<String>().cloned().or_else(|| e.downcast_ref::<&str>().map(|s| s.to_string())).unwrap_or_default()
}

fn signer_message(address: &str, quote: &str, expires_at: u64) -> String {
    format!("ghost:signer:{VAULT}:{}:{quote}:{expires_at}", address.to_lowercase())
}

fn revert_msg(v: &Vault, payout: usize) -> String {
    format!("ghost:reverted:{VAULT}:{payout}:{}", v.payouts[payout].attempts[0].tx_hash_hex.clone().unwrap())
}

/// F1: a lying 2-of-3 quorum reopens every heir in the same block, before anyone can disprove one.
/// The README says "A lying witness quorum can overpay one heir once".
#[test]
fn f1_lying_quorum_overpays_every_heir_before_detection() {
    const BIG: u128 = 1_000_000_000_000_000_000; // 1 ETH caps, so value dominates gas
    let mut c = config();
    for h in c.heirs.iter_mut() {
        h.cap_wei = U128(BIG);
    }
    c.budget_wei = U128(2 * (BIG + 2 * 21_000 * CEILING));
    at(START, "owner.testnet");
    let mut v = Vault::new(c);
    at(CLAIM_AT, "anyone.testnet");
    v.open_claim(DEATH, quorum(&death_message(0, DEATH)), false);
    for i in 0..2 {
        v.prove_adult(i, START, adult(i, START));
    }
    register(&mut v);

    at(PAY_AT, "agent.testnet");
    pay(&mut v, 0, BIG);
    sign_ok(&mut v, 0, 0);
    pay(&mut v, 1, BIG);
    sign_ok(&mut v, 1, 0);
    // Both transactions in fact succeed on Base. The quorum lies about both, in one block.
    let (m0, m1) = (revert_msg(&v, 0), revert_msg(&v, 1));
    v.reopen_reverted(0, 0, quorum(&m0));
    v.reopen_reverted(1, 0, quorum(&m1));
    assert!(!v.false_revert_proven, "nothing stopped the second reopen");
    pay(&mut v, 0, BIG);
    sign_ok(&mut v, 2, 0);
    pay(&mut v, 1, BIG);
    sign_ok(&mut v, 3, 0);
    // Four signed transfers on four consecutive nonces, every one broadcastable.
    let outflow: u128 = v.payouts.iter().map(|p| p.value_wei.0).sum();
    assert_eq!(outflow, 4 * BIG);
    assert!(outflow > v.budget_wei, "the vault signed transfers worth more than its whole budget");
    // Disproof arrives only after finality, and it is too late.
    assert!(settle_ok(&mut v, 0, 0));
    assert!(v.false_revert_proven);
}

/// F2: anyone replays one quorum-signed registration until every signer slot is full.
#[test]
fn f2_stranger_replays_a_quorum_registration_into_every_slot() {
    let mut v = vault();
    at(START + DAY, "anyone.testnet");
    let addr = enclave_address(ENCLAVE_KEY);
    let exp = START + 10 * 365 * DAY;
    let m = signer_message(&addr, "q", exp);
    for _ in 0..MAX_SIGNERS {
        v.register_signer(addr.clone(), "q".into(), exp, quorum(&m));
    }
    assert_eq!(v.signers.len(), MAX_SIGNERS);
    assert!(v.signers.iter().all(|s| s.address == addr));
    // The quorum can no longer register a rotated enclave key until the replayed one expires.
    let fresh = enclave_address(43);
    let m2 = signer_message(&fresh, "q2", exp);
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        v.register_signer(fresh.clone(), "q2".into(), exp, quorum(&m2));
    }));
    assert!(panic_text(r).contains("too many attested signers"));
}

/// F3: with the check-in key stolen and one witness unreachable, no claim of any kind can open.
#[test]
fn f3_check_in_thief_plus_one_missing_witness_blocks_heirs_forever() {
    let mut c = config();
    c.abandon_secs = Some(3 * 365 * DAY);
    at(START, "owner.testnet");
    let mut v = Vault::new(c);
    // Owner dies at DEATH. Witness 3 (seed 3) has also died or lost the key.
    let mut t = START;
    let end = START + 20 * 365 * DAY;
    while t < end {
        t += 29 * DAY;
        at(t, "owner.testnet"); // the thief holds the check-in key
        v.check_in();
    }
    at(t + DAY, "anyone.testnet");
    let normal = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        v.open_claim(DEATH, vec![], false);
    }));
    assert!(panic_text(normal).contains("owner is not inactive"));
    let m = format!("ghost:override:{VAULT}:0:{DEATH}");
    let override_claim = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        v.open_claim(DEATH, quorum(&m), true);
    }));
    assert!(panic_text(override_claim).contains("witness quorum not met"));
    assert!(v.claim.is_none());
}

/// F4: a signature whose callback was lost is still a valid Base transaction. Once the lease
/// replaces the attempt, the vault has no record of its hash, so if it lands it can never settle.
#[test]
fn f4_lost_callback_signature_lands_but_can_never_settle() {
    let mut v = proven();
    at(PAY_AT, "agent.testnet");
    pay(&mut v, 0, CAP);
    // The MPC network signed attempt 0, but on_signed never ran (out of gas or storage).
    let leaked = good_signature(&v, 0, 0);
    let leaked_tx = v.transfer(0, 0);
    let (r, s, y) = parse_mpc_signature(&leaked).unwrap();
    let leaked_hash = eth::hex(&eth::signed_tx_hash(&leaked_tx, y, &r, &s));
    let old_since = v.payouts[0].signing_since;

    at(PAY_AT + SIGN_LEASE_SECS, "anyone.testnet");
    v.request_signature(0, U128(CEILING));
    sign_ok(&mut v, 0, 0);
    // The late callback carrying the valid leaked signature is discarded.
    assert!(!v.on_signed(0, 0, old_since, Ok(leaked.clone())));
    // Anyone broadcasts the leaked transaction (it is a valid signature for nonce 0). It lands.
    // No attempt of payout 0 has its hash, so settle can never be pointed at it.
    assert!(v.payouts[0].attempts.iter().all(|a| a.tx_hash_hex.as_deref() != Some(leaked_hash.as_str())));
    assert_eq!(v.heirs[0].status, HeirStatus::Pending);
}

/// F5: the same witness key may be listed twice, so one person alone is a "2-of-3 quorum".
#[test]
fn f5_duplicate_witness_key_lets_one_person_open_a_claim() {
    let mut c = config();
    c.witnesses = vec![public(1), public(1), public(2)];
    at(START, "owner.testnet");
    let mut v = Vault::new(c);
    at(CLAIM_AT, "anyone.testnet");
    let m = death_message(0, DEATH);
    v.open_claim(DEATH, vec![proof(1, 0, &m), proof(1, 1, &m)], false);
    assert!(v.claim.is_some());
}

/// F5b: the registrar, recovery and witness keys may also coincide.
#[test]
fn f5b_recovery_key_may_equal_a_witness_key() {
    let mut c = config();
    c.recovery_key = public(1);
    c.registrar = public(1);
    at(START, "owner.testnet");
    let _ = Vault::new(c);
}

/// F6: a witness contest after the claim matured and payouts began re-closes it for everyone else.
#[test]
fn f6_contest_after_payout_started_pauses_remaining_heirs() {
    let mut v = proven();
    at(PAY_AT, "agent.testnet");
    pay(&mut v, 0, CAP);
    at(PAY_AT, "anyone.testnet");
    let opened = v.claim.as_ref().unwrap().opened_at;
    v.contest_claim(2, signed(3, &format!("ghost:contest:{VAULT}:2:{opened}")));
    at(PAY_AT, "agent.testnet");
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        v.propose_payout(1, U128(CAP), decision(1, CAP));
    }));
    assert!(panic_text(r).contains("grace period still running"));
}

/// F7: contest signatures carry no claim epoch, so they replay onto a later claim opened in the
/// same second as the one they were made for.
#[test]
fn f7_contest_signature_replays_onto_a_new_claim_in_the_same_second() {
    let mut v = vault();
    at(CLAIM_AT, "anyone.testnet");
    v.open_claim(DEATH, quorum(&death_message(0, DEATH)), false);
    let contest = signed(3, &format!("ghost:contest:{VAULT}:2:{CLAIM_AT}"));
    v.contest_claim(2, contest.clone());
    at(CLAIM_AT, "owner.testnet");
    v.check_in();
    at(CLAIM_AT, "anyone.testnet");
    let m = format!("ghost:override:{VAULT}:1:{DEATH}");
    v.open_claim(DEATH, vec![proof(1, 0, &m), proof(2, 1, &m), proof(3, 2, &m)], true);
    v.contest_claim(2, contest); // the old signature is accepted for the new claim
    assert!(v.claim.as_ref().unwrap().contested[2]);
}

/// F8: the decision is the first `{` to the last `}` anywhere in the model's prose.
#[test]
fn f8_decision_quoted_inside_a_refusal_is_accepted() {
    let mut v = proven();
    at(PAY_AT, "agent.testnet");
    let inner = json!({ "action": "pay", "heir_index": 0, "value_wei": CAP.to_string(), "vault": VAULT }).to_string();
    let content = format!("I decline to recommend paying this heir. For format reference only: {inner}");
    let body = json!({ "id": "c", "choices": [{ "message": { "role": "assistant", "content": content } }] }).to_string();
    v.propose_payout(0, U128(CAP), sign_decision(ENCLAVE_KEY, &body));
    assert_eq!(v.heirs[0].status, HeirStatus::Pending);
}
