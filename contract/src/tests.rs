use super::test_support::*;
use super::*;

// Trigger

#[test]
#[should_panic(expected = "owner is not inactive")]
fn missed_check_in_alone_is_required_first() {
    let mut v = vault();
    at(START + DAY, "anyone.testnet");
    v.open_claim(START, quorum(&death_message(0, START)), false);
}

#[test]
#[should_panic(expected = "witness quorum not met")]
fn one_witness_is_not_enough() {
    let mut v = vault();
    at(CLAIM_AT, "anyone.testnet");
    v.open_claim(DEATH, vec![proof(1, 0, &death_message(0, DEATH))], false);
}

#[test]
#[should_panic(expected = "duplicate witness")]
fn the_same_witness_cannot_count_twice() {
    let mut v = vault();
    at(CLAIM_AT, "anyone.testnet");
    let m = death_message(0, DEATH);
    v.open_claim(DEATH, vec![proof(1, 0, &m), proof(1, 0, &m)], false);
}

#[test]
#[should_panic(expected = "invalid witness signature")]
fn forged_witness_is_rejected() {
    let mut v = vault();
    at(CLAIM_AT, "anyone.testnet");
    let m = death_message(0, DEATH);
    v.open_claim(DEATH, vec![proof(7, 0, &m), proof(2, 1, &m)], false);
}

#[test]
#[should_panic(expected = "no proven claim")]
fn i9_owner_check_in_cancels_a_claim() {
    let mut v = proven();
    at(CLAIM_AT + DAY, "owner.testnet");
    v.check_in();
    at(PAY_AT, "agent.testnet");
    pay(&mut v, 0, CAP);
}

#[test]
#[should_panic(expected = "invalid witness signature")]
fn a_cancelled_claims_proofs_cannot_be_replayed() {
    let mut v = proven();
    at(CLAIM_AT + DAY, "owner.testnet");
    v.check_in();
    at(CLAIM_AT + 40 * DAY, "anyone.testnet");
    let t = CLAIM_AT + 2 * DAY;
    v.open_claim(t, quorum(&death_message(0, t)), false);
}

#[test]
#[should_panic(expected = "payout already started")]
fn i9_check_in_cannot_cancel_after_payout_starts() {
    let mut v = proven();
    at(PAY_AT, "agent.testnet");
    pay(&mut v, 0, CAP);
    at(PAY_AT, "owner.testnet");
    v.check_in();
}

#[test]
#[should_panic(expected = "grace period still running")]
fn i8_agent_cannot_pay_during_grace() {
    let mut v = proven();
    at(CLAIM_AT + DAY, "agent.testnet");
    pay(&mut v, 0, CAP);
}

// Stolen key and hospital

fn override_message(epoch: u64, death: u64) -> String {
    format!("ghost:override:{VAULT}:{epoch}:{death}")
}

fn override_claim(v: &mut Vault) {
    let m = override_message(0, DEATH);
    v.open_claim(DEATH, vec![proof(1, 0, &m), proof(2, 1, &m), proof(3, 2, &m)], true);
}

#[test]
fn i10_override_claim_opens_despite_a_thief_checking_in() {
    let mut v = vault();
    at(START + 5 * DAY, "owner.testnet");
    v.check_in();
    at(START + 6 * DAY, "anyone.testnet");
    override_claim(&mut v);
    assert_eq!(v.claim.as_ref().unwrap().kind, ClaimKind::Override);
    at(START + 7 * DAY, "owner.testnet");
    v.check_in();
    assert!(v.claim.is_some(), "stolen check-in key cancelled an override claim");
}

#[test]
#[should_panic(expected = "witness quorum not met")]
fn i10_override_needs_a_quorum() {
    let mut v = vault();
    at(START + DAY, "anyone.testnet");
    v.open_claim(DEATH, vec![proof(1, 0, &override_message(0, DEATH))], true);
}

#[test]
fn i10_recovery_key_cancels_override_once() {
    let mut v = vault();
    at(START + 2 * DAY, "anyone.testnet");
    override_claim(&mut v);
    let opened = v.claim.as_ref().unwrap().opened_at;
    let msg = format!("ghost:cancel:{VAULT}:0:{opened}");
    v.cancel_override(signed(20, &msg));
    assert!(v.claim.is_none());
    assert_eq!(v.claim_epoch, 1);
}

#[test]
#[should_panic(expected = "invalid recovery signature")]
fn i10_check_in_key_cannot_forge_the_recovery_signature() {
    let mut v = vault();
    at(START + 2 * DAY, "anyone.testnet");
    override_claim(&mut v);
    v.cancel_override(signed(7, "ghost:cancel"));
}

#[test]
#[should_panic(expected = "grace period still running")]
fn i16_contest_extends_the_delay_for_a_hospitalised_owner() {
    let mut v = proven();
    at(CLAIM_AT + DAY, "anyone.testnet");
    let opened = v.claim.as_ref().unwrap().opened_at;
    v.contest_claim(0, signed(1, &format!("ghost:contest:{VAULT}:0:0:{opened}")));
    at(PAY_AT, "agent.testnet");
    pay(&mut v, 0, CAP);
}

#[test]
#[should_panic(expected = "witness already contested")]
fn i16_a_witness_contests_only_once() {
    let mut v = proven();
    at(CLAIM_AT + DAY, "anyone.testnet");
    let opened = v.claim.as_ref().unwrap().opened_at;
    let sig = signed(1, &format!("ghost:contest:{VAULT}:0:0:{opened}"));
    v.contest_claim(0, sig.clone());
    v.contest_claim(0, sig);
}

// Age

#[test]
#[should_panic(expected = "invalid registrar signature")]
fn forged_age_record_is_rejected() {
    let mut v = vault();
    v.prove_adult(0, START, signed(8, &format!("ghost:adult:{VAULT}:0:{START}")));
}

#[test]
#[should_panic(expected = "invalid registrar signature")]
fn i11_a_proof_for_one_heir_cannot_be_used_for_another() {
    let mut v = vault();
    v.prove_adult(1, START, adult(0, START));
}

#[test]
#[should_panic(expected = "heir age already proven")]
fn i11_replay_cannot_overwrite_adult_at() {
    let mut v = vault();
    v.prove_adult(0, START, adult(0, START));
    let later = START + 5_000 * DAY;
    v.prove_adult(0, later, adult(0, later));
}

#[test]
#[should_panic(expected = "heir is not yet an adult")]
fn i8_minor_blocks_payout() {
    let mut v = vault();
    at(CLAIM_AT, "anyone.testnet");
    v.open_claim(DEATH, quorum(&death_message(0, DEATH)), false);
    let later = PAY_AT + 365 * DAY;
    v.prove_adult(0, later, adult(0, later));
    register(&mut v);
    at(PAY_AT, "agent.testnet");
    pay(&mut v, 0, CAP);
}

#[test]
fn i11_registrar_cannot_delay_past_owner_bound() {
    let mut v = vault();
    at(CLAIM_AT, "anyone.testnet");
    v.open_claim(DEATH, quorum(&death_message(0, DEATH)), false);
    let far = ADULT_BY + 9_000 * DAY;
    v.prove_adult(0, far, adult(0, far));
    register(&mut v);
    at(ADULT_BY, "agent.testnet");
    pay(&mut v, 0, CAP);
    assert_eq!(v.payouts.len(), 1);
}

// Agent bounds

#[test]
#[should_panic(expected = "only the agent can propose")]
fn stranger_cannot_propose() {
    let mut v = proven();
    at(PAY_AT, "attacker.testnet");
    pay(&mut v, 0, CAP);
}

#[test]
#[should_panic(expected = "amount exceeds heir cap")]
fn i2_hostile_agent_cannot_exceed_cap() {
    let mut v = proven();
    at(PAY_AT, "agent.testnet");
    pay(&mut v, 0, CAP + 1);
}

#[test]
#[should_panic(expected = "amount below heir floor")]
fn i2_hostile_agent_cannot_dust_an_heir_with_one_wei() {
    let mut v = proven();
    at(PAY_AT, "agent.testnet");
    pay(&mut v, 0, 1);
}

#[test]
#[should_panic(expected = "recipient is not an heir")]
fn i2_hostile_agent_cannot_pick_new_recipient() {
    let mut v = proven();
    at(PAY_AT, "agent.testnet");
    pay(&mut v, 2, CAP);
}

// Decision binding

#[test]
#[should_panic(expected = "decision not signed by a registered attested key")]
fn i14_unregistered_enclave_is_rejected() {
    let mut v = proven();
    at(PAY_AT, "agent.testnet");
    let body = decision_body(VAULT, 0, CAP);
    v.propose_payout(0, U128(CAP), sign_decision(77, &body));
}

#[test]
#[should_panic(expected = "response body does not match the signed hash")]
fn i14_changed_response_body_is_rejected() {
    let mut v = proven();
    at(PAY_AT, "agent.testnet");
    let mut p = decision(0, CAP);
    p.response_body = decision_body(VAULT, 0, CAP - 1);
    v.propose_payout(0, U128(CAP), p);
}

#[test]
#[should_panic(expected = "decision names another amount")]
fn i14_call_cannot_differ_from_signed_amount() {
    let mut v = proven();
    at(PAY_AT, "agent.testnet");
    v.propose_payout(0, U128(CAP), decision(0, CAP - 1));
}

#[test]
#[should_panic(expected = "decision names another heir")]
fn i14_call_cannot_differ_from_signed_heir() {
    let mut v = proven();
    at(PAY_AT, "agent.testnet");
    v.propose_payout(0, U128(CAP), decision(1, CAP));
}

#[test]
#[should_panic(expected = "decision is for another vault")]
fn i14_decision_for_another_vault_is_rejected() {
    let mut v = proven();
    at(PAY_AT, "agent.testnet");
    v.propose_payout(0, U128(CAP), sign_decision(ENCLAVE_KEY, &decision_body("other.testnet", 0, CAP)));
}

#[test]
#[should_panic(expected = "decision is not a payment")]
fn i14_defer_cannot_be_paid() {
    let mut v = proven();
    at(PAY_AT, "agent.testnet");
    let content = json!({ "action": "defer", "heir_index": 0, "value_wei": CAP.to_string(), "vault": VAULT }).to_string();
    let body = json!({ "choices": [{ "message": { "content": content } }] }).to_string();
    v.propose_payout(0, U128(CAP), sign_decision(ENCLAVE_KEY, &body));
}

#[test]
#[should_panic(expected = "decision not signed by a registered attested key")]
fn i14_expired_signer_is_rejected() {
    let mut v = proven();
    v.signers[0].expires_at = PAY_AT;
    at(PAY_AT, "agent.testnet");
    pay(&mut v, 0, CAP);
}

#[test]
fn signer_registration_rules() {
    let mut v = vault();
    at(START, "owner.testnet");
    v.register_signer(HEIR.into(), "q".into(), START + 300 * DAY, vec![]);
    assert_eq!(v.signers.len(), 1);
}

#[test]
#[should_panic(expected = "witness quorum not met")]
fn owner_cannot_register_a_signer_once_a_claim_is_open() {
    let mut v = vault();
    at(CLAIM_AT, "anyone.testnet");
    v.open_claim(DEATH, quorum(&death_message(0, DEATH)), false);
    at(CLAIM_AT, "owner.testnet");
    v.register_signer(HEIR.into(), "q".into(), u64::MAX, vec![]);
}

// Signature and settlement

#[test]
fn signature_alone_marks_nothing_paid() {
    let mut v = proven();
    at(PAY_AT, "agent.testnet");
    pay(&mut v, 0, CAP);
    sign_ok(&mut v, 0, 0);
    assert_eq!(v.heirs[0].status, HeirStatus::Pending);
    assert!(v.payouts[0].attempts[0].tx_hash_hex.is_some());
}

#[test]
fn i5_forged_signature_is_not_stored() {
    let mut v = proven();
    at(PAY_AT, "agent.testnet");
    pay(&mut v, 0, CAP);
    let forged = mpc_sign(77, &eth::eip1559_hash(&v.transfer(0, 0)));
    assert!(!v.on_signed(0, 0, v.payouts[0 as usize].signing_since, Ok(forged)));
    assert!(v.payouts[0].attempts.is_empty());
    assert_eq!(v.next_nonce, 1, "nonce belongs to the payout, not the signature");
}

#[test]
fn i5_high_s_signature_is_rejected() {
    let mut v = proven();
    at(PAY_AT, "agent.testnet");
    pay(&mut v, 0, CAP);
    let hash = eth::eip1559_hash(&v.transfer(0, 0));
    let (sig, id) = ec(VAULT_KEY).sign_prehash_recoverable(&hash).unwrap();
    let mut s = k256::Scalar::from(sig.s().as_ref().clone());
    s = -s;
    let bytes = sig.to_bytes();
    let forged = json!({
        "big_r": { "affine_point": format!("02{}", eth::hex(&bytes[..32])) },
        "s": { "scalar": eth::hex(&s.to_bytes()) },
        "recovery_id": id.to_byte() ^ 1,
    });
    assert!(!v.on_signed(0, 0, v.payouts[0 as usize].signing_since, Ok(forged)));
}

#[test]
fn i18_failed_signing_can_be_retried_on_the_same_nonce() {
    let mut v = proven();
    at(PAY_AT, "agent.testnet");
    pay(&mut v, 0, CAP);
    assert!(!v.on_signed(0, 0, v.payouts[0 as usize].signing_since, Err(PromiseError::Failed)));
    assert!(!v.payouts[0].signing);
    at(PAY_AT, "anyone.testnet");
    v.request_signature(0, U128(INITIAL_FEE));
    assert_eq!(v.payouts[0].nonce, 0);
    sign_ok(&mut v, 0, 0);
}

#[test]
fn i4_only_valid_attestation_marks_paid() {
    let mut v = proven();
    at(PAY_AT, "agent.testnet");
    pay(&mut v, 0, CAP);
    sign_ok(&mut v, 0, 0);
    assert!(!v.on_settled(0, 0, Err(PromiseError::Failed)));
    assert!(!v.on_settled(0, 0, Ok(attestation(&v, 0, 0, 77))));
    let mut wrong = attestation(&v, 0, 0, FOREIGN_KEY);
    wrong["payload_hash"] = json!("00".repeat(32));
    assert!(!v.on_settled(0, 0, Ok(wrong)));
    assert_eq!(v.heirs[0].status, HeirStatus::Pending);
    assert!(settle_ok(&mut v, 0, 0));
    assert_eq!(v.heirs[0].status, HeirStatus::Paid);
    assert_eq!(v.payouts[0].status, PayoutStatus::Settled);
}

#[test]
#[should_panic(expected = "heir already paid or pending")]
fn i3_paid_heir_cannot_be_paid_again() {
    let mut v = proven();
    at(PAY_AT, "agent.testnet");
    pay(&mut v, 0, CAP);
    sign_ok(&mut v, 0, 0);
    settle_ok(&mut v, 0, 0);
    pay(&mut v, 0, CAP);
}

#[test]
fn i6_stuck_heir_does_not_strand_later_nonces() {
    let mut v = proven();
    at(PAY_AT, "agent.testnet");
    pay(&mut v, 0, CAP);
    pay(&mut v, 1, CAP);
    assert_eq!((v.payouts[0].nonce, v.payouts[1].nonce), (0, 1));
}

#[test]
fn i6_repricing_keeps_nonce_recipient_and_value() {
    let mut v = proven();
    at(PAY_AT, "agent.testnet");
    pay(&mut v, 0, CAP);
    sign_ok(&mut v, 0, 0);
    at(PAY_AT, "anyone.testnet");
    v.request_signature(0, U128(INITIAL_FEE * 2));
    sign_ok(&mut v, 0, 1);
    let (a, b) = (v.transfer(0, 0), v.transfer(0, 1));
    assert_eq!((a.nonce, a.to, a.value), (b.nonce, b.to, b.value));
    assert_ne!(a.max_fee_per_gas, b.max_fee_per_gas);
    assert!(settle_ok(&mut v, 0, 1));
}

#[test]
#[should_panic(expected = "fee must double")]
fn i6_small_fee_bumps_cannot_exhaust_attempts() {
    let mut v = proven();
    at(PAY_AT, "agent.testnet");
    pay(&mut v, 0, CAP);
    sign_ok(&mut v, 0, 0);
    v.request_signature(0, U128(INITIAL_FEE + 1));
}

#[test]
#[should_panic(expected = "fee above ceiling")]
fn i6_fee_cannot_exceed_ceiling() {
    let mut v = proven();
    at(PAY_AT, "agent.testnet");
    pay(&mut v, 0, CAP);
    sign_ok(&mut v, 0, 0);
    v.request_signature(0, U128(CEILING + 1));
}

#[test]
#[should_panic(expected = "signature already in flight")]
fn i6_one_signature_in_flight_per_payout() {
    let mut v = proven();
    at(PAY_AT, "agent.testnet");
    pay(&mut v, 0, CAP);
    v.request_signature(0, U128(INITIAL_FEE * 2));
}

#[test]
fn i6_contract_wallet_heir_gets_its_own_gas_limit() {
    let mut c = config();
    c.heirs[0].gas_limit = 100_000;
    c.budget_wei = U128(CAP * 2 + 2 * 121_000 * CEILING);
    at(START, "owner.testnet");
    let mut v = Vault::new(c);
    at(CLAIM_AT, "anyone.testnet");
    v.open_claim(DEATH, quorum(&death_message(0, DEATH)), false);
    v.prove_adult(0, START, adult(0, START));
    register(&mut v);
    at(PAY_AT, "agent.testnet");
    pay(&mut v, 0, CAP);
    assert_eq!(v.transfer(0, 0).gas_limit, 100_000);
}

// Budget

#[test]
#[should_panic(expected = "caps and gas exceed the budget")]
fn i7_caps_cannot_exceed_budget() {
    let mut c = config();
    c.budget_wei = U128(CAP);
    at(START, "owner.testnet");
    Vault::new(c);
}

#[test]
#[should_panic(expected = "fallback must outlast every delay")]
fn fallback_must_outlast_delays() {
    let mut c = config();
    c.fallback_secs = c.grace_secs;
    at(START, "owner.testnet");
    Vault::new(c);
}

#[test]
#[should_panic(expected = "only Base Sepolia")]
fn wrong_chain_is_refused() {
    let mut c = config();
    c.chain_id = 1;
    at(START, "owner.testnet");
    Vault::new(c);
}

// Dead agent

#[test]
fn i13_fallback_pays_cap_without_any_agent() {
    let mut v = proven();
    at(FALLBACK_AT, "anyone.testnet");
    v.execute_fallback(0);
    assert_eq!(v.payouts[0].value_wei.0, CAP);
    assert_eq!(v.payouts[0].source, "fallback");
    assert_eq!(v.payouts[0].request_hash, None);
}

#[test]
#[should_panic(expected = "fallback not yet available")]
fn i13_fallback_waits_for_the_timeout() {
    let mut v = proven();
    at(PAY_AT, "anyone.testnet");
    v.execute_fallback(0);
}

#[test]
#[should_panic(expected = "heir already paid or pending")]
fn i13_fallback_cannot_double_pay_a_pending_heir() {
    let mut v = proven();
    at(PAY_AT, "agent.testnet");
    pay(&mut v, 0, CAP);
    at(FALLBACK_AT, "anyone.testnet");
    v.execute_fallback(0);
}

// Freeze

#[test]
#[should_panic(expected = "vault is frozen")]
fn i12_freeze_stops_payout() {
    let mut v = proven();
    at(PAY_AT, "court.testnet");
    v.freeze();
    at(PAY_AT, "agent.testnet");
    pay(&mut v, 0, CAP);
}

#[test]
fn i12_freeze_expires_by_itself() {
    let mut v = proven();
    at(PAY_AT, "court.testnet");
    v.freeze();
    at(PAY_AT + 90 * DAY, "agent.testnet");
    pay(&mut v, 0, CAP);
    assert_eq!(v.payouts.len(), 1);
}

#[test]
#[should_panic(expected = "freeze already used")]
fn i12_freeze_once_per_claim() {
    let mut v = proven();
    at(PAY_AT, "court.testnet");
    v.freeze();
    v.freeze();
}

#[test]
#[should_panic(expected = "only the legal authority can freeze")]
fn stranger_cannot_freeze() {
    let mut v = proven();
    at(PAY_AT, "attacker.testnet");
    v.freeze();
}

// Reverted payouts

fn signed_payout() -> Vault {
    let mut v = proven();
    at(PAY_AT, "agent.testnet");
    pay(&mut v, 0, CAP);
    sign_ok(&mut v, 0, 0);
    v
}

fn revert_message(v: &Vault) -> String {
    format!("ghost:reverted:{VAULT}:0:{}", v.payouts[0].attempts[0].tx_hash_hex.clone().unwrap())
}

#[test]
fn i17_quorum_reopens_a_reverted_payout_once() {
    let mut v = signed_payout();
    let m = revert_message(&v);
    v.reopen_reverted(0, 0, quorum(&m));
    assert_eq!(v.heirs[0].status, HeirStatus::Open);
    assert_eq!(v.payouts[0].status, PayoutStatus::Reverted);
    at(PAY_AT + REOPEN_DELAY_SECS, "agent.testnet");
    pay(&mut v, 0, CAP);
    assert_eq!(v.payouts[1].nonce, 1);
}

#[test]
#[should_panic(expected = "witness quorum not met")]
fn i17_one_witness_cannot_reopen() {
    let mut v = signed_payout();
    let m = revert_message(&v);
    v.reopen_reverted(0, 0, vec![proof(1, 0, &m)]);
}

#[test]
#[should_panic(expected = "heir already reopened once")]
fn i17_a_heir_reopens_only_once() {
    let mut v = signed_payout();
    let m = revert_message(&v);
    v.reopen_reverted(0, 0, quorum(&m));
    at(PAY_AT + REOPEN_DELAY_SECS, "agent.testnet");
    pay(&mut v, 0, CAP);
    sign_ok(&mut v, 1, 0);
    let m2 = format!("ghost:reverted:{VAULT}:1:{}", v.payouts[1].attempts[0].tx_hash_hex.clone().unwrap());
    v.reopen_reverted(1, 0, quorum(&m2));
}

#[test]
fn i17_disproved_revert_is_flagged_and_the_retry_keeps_its_nonce() {
    let mut v = signed_payout();
    let m = revert_message(&v);
    v.reopen_reverted(0, 0, quorum(&m));
    at(PAY_AT + REOPEN_DELAY_SECS, "agent.testnet");
    pay(&mut v, 0, CAP);
    assert!(settle_ok(&mut v, 0, 0));
    assert!(v.false_revert_proven);
    assert_eq!(v.heirs[0].status, HeirStatus::Paid);
    assert_eq!(v.payouts[1].status, PayoutStatus::Active, "a dead nonce would strand every later payout");
    sign_ok(&mut v, 1, 0);
    assert!(v.payouts[1].attempts[0].tx_hash_hex.is_some());
}

// Sealing

#[test]
#[should_panic(expected = "no proven claim")]
fn i15_wishes_key_is_unavailable_before_a_claim() {
    let mut v = vault();
    v.request_wishes_key();
}

#[test]
#[should_panic(expected = "grace period still running")]
fn i15_wishes_key_waits_for_grace() {
    let mut v = proven();
    at(CLAIM_AT + DAY, "anyone.testnet");
    v.request_wishes_key();
}

#[test]
fn i15_wishes_key_available_after_trigger() {
    let mut v = proven();
    at(PAY_AT, "anyone.testnet");
    v.request_wishes_key();
}

// Encoding

#[test]
fn eip1559_hash_matches_independent_encoder() {
    at(START, "owner.testnet");
    let tx = eth::Transfer {
        chain_id: 11_155_111,
        nonce: 7,
        max_priority_fee_per_gas: 1_000_000_000,
        max_fee_per_gas: 30_000_000_000,
        gas_limit: 21_000,
        to: eth::parse_address("0x70997970c51812dc3a010c7d01b50e0d17dc79c8").unwrap(),
        value: 10_000_000_000_000_000,
    };
    assert_eq!(eth::hex(&eth::eip1559_hash(&tx)), include_str!("../testdata/eip1559_vector.txt").trim());
}

// Injection evaluation: scored by the contract's accept or reject, never by the model's words.

#[test]
fn injection_eval_hostile_decisions_scored_by_the_contract() {
    std::panic::set_hook(Box::new(|_| {}));
    let cases: Vec<Value> = serde_json::from_str(include_str!("../testdata/hostile_decisions.json")).unwrap();
    let mut failures = vec![];
    for case in &cases {
        let mut v = proven();
        at(PAY_AT, "agent.testnet");
        let heir = case["heir_index"].as_u64().unwrap() as u32;
        let value: u128 = case["value_wei"].as_str().unwrap().parse().unwrap();
        let content = json!({ "action": case["action"], "heir_index": heir, "value_wei": value.to_string(), "vault": case["vault"], "reasoning": "r" }).to_string();
        let body = json!({ "choices": [{ "message": { "content": content } }] }).to_string();
        let accepted = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            v.propose_payout(heir, U128(value), sign_decision(ENCLAVE_KEY, &body));
        }))
        .is_ok();
        let got = if accepted { "accept" } else { "reject" };
        println!("{:<26} expect={:<6} got={}", case["id"].as_str().unwrap(), case["expect"].as_str().unwrap(), got);
        if got != case["expect"].as_str().unwrap() {
            failures.push(case["id"].clone());
        }
    }
    let _ = std::panic::take_hook();
    assert!(failures.is_empty(), "{failures:?}");
}

// Gaps found by cargo-mutants

#[test]
fn signature_parser_rejects_bad_fields() {
    let good = mpc_sign(VAULT_KEY, &[9u8; 32]);
    assert!(parse_mpc_signature(&good).is_some());
    let mut bad_id = good.clone();
    bad_id["recovery_id"] = json!(2);
    assert!(parse_mpc_signature(&bad_id).is_none());
    let mut short = good.clone();
    short["big_r"]["affine_point"] = json!("02ab");
    assert!(parse_mpc_signature(&short).is_none());
}

#[test]
#[should_panic(expected = "invalid heir address")]
fn invalid_heir_address_is_refused() {
    let mut c = config();
    c.heirs[0].address = "nope".into();
    at(START, "owner.testnet");
    Vault::new(c);
}

#[test]
#[should_panic(expected = "invalid signer address")]
fn invalid_signer_address_is_refused() {
    let mut v = vault();
    at(START, "owner.testnet");
    v.register_signer("nope".into(), "q".into(), u64::MAX, vec![]);
}

#[test]
#[should_panic(expected = "decision is not a JSON object")]
fn decision_without_json_is_refused() {
    let mut v = proven();
    at(PAY_AT, "agent.testnet");
    let body = json!({ "choices": [{ "message": { "content": "}pay{" } }] }).to_string();
    v.propose_payout(0, U128(CAP), sign_decision(ENCLAVE_KEY, &body));
}

#[test]
fn i16_contest_adds_exactly_the_contest_time() {
    let mut v = proven();
    let before = v.claim.as_ref().unwrap().pay_after;
    at(CLAIM_AT + DAY, "anyone.testnet");
    let opened = v.claim.as_ref().unwrap().opened_at;
    v.contest_claim(0, signed(1, &format!("ghost:contest:{VAULT}:0:0:{opened}")));
    assert_eq!(v.claim.as_ref().unwrap().pay_after, before + 14 * DAY);
}

#[test]
fn quorum_can_register_a_signer_after_a_claim() {
    let mut v = vault();
    at(CLAIM_AT, "anyone.testnet");
    v.open_claim(DEATH, quorum(&death_message(0, DEATH)), false);
    let m = format!("ghost:signer:{VAULT}:{}:q:9999999999", HEIR);
    v.register_signer(HEIR.into(), "q".into(), 9_999_999_999, quorum(&m));
    assert_eq!(v.signers.len(), 1);
}

#[test]
#[should_panic(expected = "witness quorum not met")]
fn one_witness_cannot_register_a_signer() {
    let mut v = vault();
    at(CLAIM_AT, "anyone.testnet");
    v.open_claim(DEATH, quorum(&death_message(0, DEATH)), false);
    let m = format!("ghost:signer:{VAULT}:{}:q:9999999999", HEIR);
    v.register_signer(HEIR.into(), "q".into(), 9_999_999_999, vec![proof(1, 0, &m)]);
}

#[test]
#[should_panic(expected = "reopen disabled after a disproved revert")]
fn i17_a_disproved_revert_disables_further_reopens() {
    let mut v = signed_payout();
    pay(&mut v, 1, CAP);
    sign_ok(&mut v, 1, 0);
    let m = revert_message(&v);
    v.reopen_reverted(0, 0, quorum(&m));
    assert!(settle_ok(&mut v, 0, 0));
    let tx = v.payouts[1].attempts[0].tx_hash_hex.clone().unwrap();
    v.reopen_reverted(1, 0, quorum(&format!("ghost:reverted:{VAULT}:1:{tx}")));
}

#[test]
fn i7_reservation_accounting_is_exact() {
    let mut v = signed_payout();
    let reserve = CAP + 21_000 * CEILING;
    assert_eq!(v.committed_wei, reserve);
    let m = revert_message(&v);
    v.reopen_reverted(0, 0, quorum(&m));
    assert_eq!(v.committed_wei, 21_000 * CEILING, "only the burned gas stays reserved");
}

#[test]
fn i14_stored_hashes_are_the_signed_request_and_response() {
    let mut v = proven();
    at(PAY_AT, "agent.testnet");
    let p = decision(0, CAP);
    let (req, resp) = p.signed_text.split_once(':').map(|(a, b)| (a.to_string(), b.to_string())).unwrap();
    v.propose_payout(0, U128(CAP), p);
    assert_eq!(v.payouts[0].request_hash.as_deref(), Some(req.as_str()));
    assert_eq!(v.payouts[0].response_hash.as_deref(), Some(resp.as_str()));
}

#[test]
fn i14_accepts_a_prefixed_text_and_raw_recovery_id() {
    use sha2::{Digest, Sha256};
    let mut v = proven();
    at(PAY_AT, "agent.testnet");
    let body = decision_body(VAULT, 0, CAP);
    let signed_text = format!("model:{}:{}", "cd".repeat(32), eth::hex(&Sha256::digest(body.as_bytes())));
    let digest = env::keccak256_array(&eth::personal_message(&signed_text));
    let (sig, id) = ec(ENCLAVE_KEY).sign_prehash_recoverable(&digest).unwrap();
    let mut bytes = sig.to_bytes().to_vec();
    bytes.push(id.to_byte());
    v.propose_payout(0, U128(CAP), DecisionProof { signed_text, signature: eth::hex(&bytes), response_body: body });
    assert_eq!(v.payouts[0].request_hash, Some("cd".repeat(32)));
}

#[test]
fn i4_expected_hash_is_sha256_of_the_pinned_borsh_payload() {
    use sha2::{Digest, Sha256};
    let v = vault();
    let tx = "ab".repeat(32);
    let mut bytes = vec![0, 6];
    bytes.extend([0xab; 32]);
    bytes.extend([0, 0, 0, 0, 2, 0, 0, 0, 0]);
    assert_eq!(v.expected_payload_hash(&tx).to_vec(), Sha256::digest(&bytes).to_vec());
}

#[test]
fn i4_transaction_hash_is_keccak_of_the_signed_encoding() {
    let v = signed_payout();
    let a = v.payouts[0].attempts[0].clone();
    let tx = v.transfer(0, 0);
    let r: [u8; 32] = eth::parse_hex(a.r_hex.as_ref().unwrap()).unwrap().try_into().unwrap();
    let s: [u8; 32] = eth::parse_hex(a.s_hex.as_ref().unwrap()).unwrap().try_into().unwrap();
    let keccak = env::keccak256(&eth::eip1559_signed(&tx, a.y_parity.unwrap(), &r, &s));
    assert_eq!(a.tx_hash_hex.unwrap(), eth::hex(&keccak));
}

#[test]
fn get_state_exposes_what_the_verifier_reads() {
    let s = proven().get_state();
    for field in ["vault_public_key", "budget_wei", "heirs", "payouts", "signers", "fallback_secs", "claim"] {
        assert!(!s[field].is_null(), "{field}");
    }
}

// v3: lease, abandonment, bounds

#[test]
fn d11_a_late_callback_for_a_replaced_request_is_ignored() {
    let mut v = proven();
    at(PAY_AT, "agent.testnet");
    pay(&mut v, 0, CAP);
    let first = v.payouts[0].signing_since;
    at(PAY_AT + SIGN_LEASE_SECS, "relayer.testnet");
    v.request_signature(0, U128(2 * INITIAL_FEE));
    let second = v.payouts[0].signing_since;
    assert!(second > first);
    // The lost request's callback arrives after all: ignored. Its signature can still be submitted.
    let late = good_signature(&v, 0, 0);
    assert!(!v.on_signed(0, 0, first, Ok(late)));
    assert!(v.payouts[0].signing && v.payouts[0].attempts[0].tx_hash_hex.is_none());
    sign_ok(&mut v, 0, 1);
    assert!(v.payouts[0].attempts[1].tx_hash_hex.is_some());
}

#[test]
#[should_panic(expected = "signature already in flight")]
fn d11_the_lease_must_expire_before_a_request_is_replaced() {
    let mut v = proven();
    at(PAY_AT, "agent.testnet");
    pay(&mut v, 0, CAP);
    at(PAY_AT + SIGN_LEASE_SECS - 1, "relayer.testnet");
    v.request_signature(0, U128(INITIAL_FEE));
}

#[test]
fn d11_a_replaced_request_follows_the_fee_rule_from_the_lost_attempt() {
    let mut v = proven();
    at(PAY_AT, "agent.testnet");
    pay(&mut v, 0, CAP);
    sign_ok(&mut v, 0, 0);
    at(PAY_AT + DAY, "relayer.testnet");
    v.request_signature(0, U128(2 * INITIAL_FEE));
    at(PAY_AT + DAY + SIGN_LEASE_SECS, "relayer.testnet");
    // The lost attempt stays on the same nonce, so the replacement doubles its fee.
    v.request_signature(0, U128(4 * INITIAL_FEE));
    assert_eq!(v.payouts[0].attempts.len(), 3);
    assert_eq!(v.payouts[0].attempts[2].max_fee_per_gas.0, 4 * INITIAL_FEE);
}

fn abandoning_vault() -> Vault {
    let mut c = config();
    c.abandon_secs = Some(1_000 * DAY);
    at(START, "owner.testnet");
    Vault::new(c)
}

#[test]
fn d20_after_abandonment_a_claim_needs_no_witness() {
    let mut v = abandoning_vault();
    at(START + 1_000 * DAY, "anyone.testnet");
    v.open_claim(START + 999 * DAY, vec![], false);
    assert_eq!(v.claim.as_ref().unwrap().kind, ClaimKind::Normal);
    // Still a normal claim: a living owner cancels it.
    at(START + 1_000 * DAY + 1, "owner.testnet");
    v.check_in();
    assert!(v.claim.is_none());
}

#[test]
#[should_panic(expected = "witness quorum not met")]
fn d20_before_abandonment_witnesses_are_still_required() {
    let mut v = abandoning_vault();
    at(START + 999 * DAY, "anyone.testnet");
    v.open_claim(START + 998 * DAY, vec![], false);
}

#[test]
#[should_panic(expected = "witness quorum not met")]
fn d20_abandonment_never_opens_an_override_claim() {
    let mut v = abandoning_vault();
    at(START + 2_000 * DAY, "anyone.testnet");
    v.open_claim(START + 1_999 * DAY, vec![], true);
}

#[test]
#[should_panic(expected = "witness quorum not met")]
fn d20_without_abandon_secs_silence_alone_never_opens_a_claim() {
    let mut v = vault();
    at(START + 100_000 * DAY, "anyone.testnet");
    v.open_claim(START + 99_999 * DAY, vec![], false);
}

#[test]
#[should_panic(expected = "durations must be at most 100 years")]
fn kani_durations_are_bounded_at_init() {
    let mut c = config();
    c.fallback_secs = MAX_DURATION_SECS + 1;
    at(START, "owner.testnet");
    Vault::new(c);
}

#[test]
#[should_panic(expected = "too many attested signers")]
fn d12_attested_signers_are_bounded() {
    let mut v = vault();
    at(START, "owner.testnet");
    for i in 0..=MAX_SIGNERS {
        v.register_signer(format!("0x{:040x}", i + 1), "q".into(), START + DAY, vec![]);
    }
}

#[test]
fn d12_expired_signers_make_room() {
    let mut v = vault();
    at(START, "owner.testnet");
    for i in 0..MAX_SIGNERS {
        v.register_signer(format!("0x{:040x}", i + 1), "q".into(), START + DAY, vec![]);
    }
    at(START + 2 * DAY, "owner.testnet");
    v.register_signer(format!("0x{:040x}", 99), "q".into(), START + 3 * DAY, vec![]);
    assert_eq!(v.signers.len(), 1);
}
