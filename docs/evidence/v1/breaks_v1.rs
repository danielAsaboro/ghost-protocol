//! Each test states the safe behaviour. Against the v1 contract every test fails.
use super::*;
use ed25519_dalek::{Signer, SigningKey};
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::testing_env;

const DAY: u64 = 86_400;
const START: u64 = 1_800_000_000;
const HEIR: &str = "0x00000000000000000000000000000000000000aa";
const CLAIM_AT: u64 = START + 31 * DAY;
const DEATH: u64 = START + DAY;
const PAY_AT: u64 = CLAIM_AT + 8 * DAY;

fn at(secs: u64, caller: &str) {
    testing_env!(VMContextBuilder::new()
        .current_account_id("vault.testnet".parse().unwrap())
        .predecessor_account_id(caller.parse().unwrap())
        .block_timestamp(secs * 1_000_000_000)
        .prepaid_gas(Gas::from_tgas(300))
        .build());
}
fn key(seed: u8) -> SigningKey {
    SigningKey::from_bytes(&[seed; 32])
}
fn public(seed: u8) -> Base64VecU8 {
    Base64VecU8(key(seed).verifying_key().to_bytes().to_vec())
}
fn sign(seed: u8, msg: String) -> Base64VecU8 {
    Base64VecU8(key(seed).sign(msg.as_bytes()).to_bytes().to_vec())
}
fn proven() -> Vault {
    at(START, "owner.testnet");
    let mut v = Vault::new(VaultConfig {
        owner: "owner.testnet".parse().unwrap(),
        agent: "agent.testnet".parse().unwrap(),
        legal_authority: "court.testnet".parse().unwrap(),
        signer_contract: "v1.signer-prod.testnet".parse().unwrap(),
        witnesses: vec![public(1), public(2), public(3)],
        witness_threshold: 2,
        registrar: public(9),
        inactivity_secs: 30 * DAY,
        grace_secs: 7 * DAY,
        chain_id: 11_155_111,
        max_fee_per_gas: U128(100),
        max_priority_fee_per_gas: U128(1),
        sealed_wishes_hash: "abc".into(),
        heirs: vec![(HEIR.into(), U128(1_000))],
    });
    at(CLAIM_AT, "anyone.testnet");
    let msg = format!("ghost:death:vault.testnet:{DEATH}");
    v.open_claim(
        DEATH,
        vec![
            WitnessProof { witness_index: 0, signature: sign(1, msg.clone()) },
            WitnessProof { witness_index: 1, signature: sign(2, msg) },
        ],
    );
    v.prove_adult(START, sign(9, format!("ghost:adult:vault.testnet:{START}")));
    v
}

#[test]
fn agent_cannot_dust_an_heir_with_one_wei() {
    let mut v = proven();
    at(PAY_AT, "agent.testnet");
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        v.propose_payout(0, U128(1), "x".into());
    }));
    assert!(r.is_err(), "1 wei accepted: heir would be permanently paid");
}

#[test]
fn a_signature_alone_does_not_mark_an_heir_paid() {
    let mut v = proven();
    at(PAY_AT, "agent.testnet");
    v.propose_payout(0, U128(1_000), "x".into());
    v.on_signed(0, Ok(json!({ "ok": true })));
    assert!(!v.heirs[0].paid, "marked paid with no transaction on any chain");
}

#[test]
fn nonce_does_not_advance_on_a_signature_alone() {
    let mut v = proven();
    at(PAY_AT, "agent.testnet");
    v.propose_payout(0, U128(1_000), "x".into());
    v.on_signed(0, Ok(json!({ "ok": true })));
    assert_eq!(v.next_nonce, 0, "nonce advanced with nothing landed");
}

#[test]
fn forged_signature_is_not_stored() {
    let mut v = proven();
    at(PAY_AT, "agent.testnet");
    v.propose_payout(0, U128(1_000), "x".into());
    v.on_signed(0, Ok(json!({ "scheme": "garbage" })));
    assert!(v.payouts[0].signature.is_none(), "unverifiable signature stored");
}

#[test]
fn replaying_a_registrar_proof_cannot_rewrite_adult_at() {
    let mut v = proven();
    let later = START + 5_000 * DAY;
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        v.prove_adult(later, sign(9, format!("ghost:adult:vault.testnet:{later}")));
    }));
    assert!(r.is_err() || v.adult_at == Some(START), "adult_at overwritten by anyone");
}

#[test]
fn gas_limit_is_not_fixed_for_contract_wallet_heirs() {
    let v = proven();
    let json = serde_json::to_string(&v.heirs[0]).unwrap();
    assert!(json.contains("gas_limit"), "every heir is forced to 21000 gas");
}

#[test]
fn caps_cannot_exceed_a_declared_budget() {
    let v = proven();
    let state = v.get_state().to_string();
    assert!(state.contains("budget_wei"), "no budget: caps may exceed the vault balance");
}

#[test]
fn a_dead_agent_has_a_fallback() {
    let v = proven();
    let state = v.get_state().to_string();
    assert!(state.contains("fallback"), "without the agent the funds are locked forever");
}

#[test]
fn a_stolen_owner_key_cannot_block_forever() {
    let v = proven();
    let state = v.get_state().to_string();
    assert!(state.contains("override"), "a thief who checks in blocks every claim forever");
}
