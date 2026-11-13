use super::*;
use ed25519_dalek::{Signer, SigningKey};
use k256::ecdsa::{SigningKey as EcKey, VerifyingKey};
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::testing_env;
use sha2::{Digest, Sha256};

pub const DAY: u64 = 86_400;
pub const START: u64 = 1_800_000_000;
pub const HEIR: &str = "0x00000000000000000000000000000000000000aa";
pub const HEIR2: &str = "0x00000000000000000000000000000000000000bb";
pub const FLOOR: u128 = 500;
pub const CAP: u128 = 1_000;
pub const INITIAL_FEE: u128 = 100;
pub const CEILING: u128 = 1_600;
pub const CLAIM_AT: u64 = START + 31 * DAY;
pub const DEATH: u64 = START + DAY;
pub const PAY_AT: u64 = CLAIM_AT + 8 * DAY;
pub const FALLBACK_AT: u64 = CLAIM_AT + 400 * DAY;
pub const ADULT_BY: u64 = START + 2_000 * DAY;
pub const VAULT: &str = "vault.testnet";

pub fn account(name: &str) -> AccountId {
    name.parse().unwrap()
}

pub fn at(secs: u64, caller: &str) {
    testing_env!(VMContextBuilder::new()
        .current_account_id(account(VAULT))
        .predecessor_account_id(account(caller))
        .block_timestamp(secs * 1_000_000_000)
        .prepaid_gas(Gas::from_tgas(300))
        .attached_deposit(NearToken::from_yoctonear(0))
        .build());
}

pub fn key(seed: u8) -> SigningKey {
    SigningKey::from_bytes(&[seed; 32])
}

pub fn public(seed: u8) -> Base64VecU8 {
    Base64VecU8(key(seed).verifying_key().to_bytes().to_vec())
}

pub fn signed(seed: u8, message: &str) -> Base64VecU8 {
    Base64VecU8(key(seed).sign(message.as_bytes()).to_bytes().to_vec())
}

pub fn ec(seed: u8) -> EcKey {
    EcKey::from_slice(&[seed; 32]).unwrap()
}

pub fn ec_public(key: &EcKey) -> Vec<u8> {
    let vk: &VerifyingKey = key.verifying_key();
    vk.to_encoded_point(false).as_bytes()[1..].to_vec()
}

pub const VAULT_KEY: u8 = 40;
pub const FOREIGN_KEY: u8 = 41;
pub const ENCLAVE_KEY: u8 = 42;

pub fn config() -> VaultConfig {
    VaultConfig {
        owner: account("owner.testnet"),
        recovery_key: public(20),
        agent: account("agent.testnet"),
        legal_authority: account("court.testnet"),
        signer_contract: account("v1.signer-prod.testnet"),
        vault_public_key: Base64VecU8(ec_public(&ec(VAULT_KEY))),
        foreign_tx_public_key: Base64VecU8(ec_public(&ec(FOREIGN_KEY))),
        witnesses: vec![public(1), public(2), public(3)],
        witness_threshold: 2,
        registrar: public(9),
        inactivity_secs: 30 * DAY,
        grace_secs: 7 * DAY,
        override_grace_secs: 60 * DAY,
        contest_secs: 14 * DAY,
        freeze_max_secs: 90 * DAY,
        fallback_secs: 365 * DAY,
        abandon_secs: None,
        chain_id: BASE_SEPOLIA,
        initial_max_fee_per_gas: U128(INITIAL_FEE),
        max_fee_ceiling: U128(CEILING),
        max_priority_fee_per_gas: U128(1),
        budget_wei: U128(2 * (CAP + 2 * 21_000 * CEILING)),
        sealed_wishes_hash: "abc".into(),
        wishes_app_key: Some("bls12381g1:app".into()),
        heirs: vec![heir(HEIR), heir(HEIR2)],
    }
}

pub fn heir(address: &str) -> HeirConfig {
    HeirConfig { address: address.into(), floor_wei: U128(FLOOR), cap_wei: U128(CAP), gas_limit: 21_000, adult_by: ADULT_BY }
}

pub fn vault() -> Vault {
    at(START, "owner.testnet");
    Vault::new(config())
}

pub fn proof(seed: u8, index: u32, message: &str) -> WitnessProof {
    WitnessProof { witness_index: index, signature: signed(seed, message) }
}

pub fn death_message(epoch: u64, death_at: u64) -> String {
    format!("ghost:death:{VAULT}:{epoch}:{death_at}")
}

pub fn quorum(message: &str) -> Vec<WitnessProof> {
    vec![proof(1, 0, message), proof(2, 1, message)]
}

/// A vault with a matured-ready claim and both heirs proven adult.
pub fn proven() -> Vault {
    let mut v = vault();
    at(CLAIM_AT, "anyone.testnet");
    v.open_claim(DEATH, quorum(&death_message(0, DEATH)), false);
    for i in 0..2 {
        v.prove_adult(i, START, adult(i, START));
    }
    at(START, "owner.testnet");
    register(&mut v);
    v
}

pub fn adult(heir: u32, adult_at: u64) -> Base64VecU8 {
    signed(9, &format!("ghost:adult:{VAULT}:{heir}:{adult_at}"))
}

pub fn enclave_address(seed: u8) -> String {
    format!("0x{}", eth::hex(&env::keccak256_array(&ec_public(&ec(seed)))[12..]))
}

pub fn register(v: &mut Vault) {
    // Registered directly: the owner path requires no open claim, and fixtures open one first.
    v.signers.push(AttestedSigner { address: enclave_address(ENCLAVE_KEY), quote_sha256: "q".into(), expires_at: u64::MAX });
}

pub fn decision_body(vault: &str, heir: u32, value: u128) -> String {
    let content = json!({ "action": "pay", "heir_index": heir, "value_wei": value.to_string(), "vault": vault, "reasoning": "r" }).to_string();
    json!({ "id": "c", "choices": [{ "message": { "role": "assistant", "content": content } }] }).to_string()
}

pub fn sign_decision(seed: u8, body: &str) -> DecisionProof {
    let response_hash = eth::hex(&Sha256::digest(body.as_bytes()));
    let signed_text = format!("{}:{}", "ab".repeat(32), response_hash);
    let digest = env::keccak256_array(&eth::personal_message(&signed_text));
    let (sig, id) = ec(seed).sign_prehash_recoverable(&digest).unwrap();
    let mut bytes = sig.to_bytes().to_vec();
    bytes.push(id.to_byte() + 27);
    DecisionProof { signed_text, signature: format!("0x{}", eth::hex(&bytes)), response_body: body.into() }
}

pub fn decision(heir: u32, value: u128) -> DecisionProof {
    sign_decision(ENCLAVE_KEY, &decision_body(VAULT, heir, value))
}

pub fn pay(v: &mut Vault, heir: u32, value: u128) {
    // Each payout is its own NEAR transaction.
    at(env::block_timestamp_ms() / 1000, env::predecessor_account_id().as_str());
    v.propose_payout(heir, U128(value), decision(heir, value));
}

pub fn mpc_sign(seed: u8, hash: &[u8; 32]) -> Value {
    let (sig, id) = ec(seed).sign_prehash_recoverable(hash).unwrap();
    let bytes = sig.to_bytes();
    json!({
        "scheme": "Secp256k1",
        "big_r": { "affine_point": format!("0{}{}", 2 + (id.to_byte() & 1), eth::hex(&bytes[..32])) },
        "s": { "scalar": eth::hex(&bytes[32..]) },
        "recovery_id": id.to_byte(),
    })
}

pub fn good_signature(v: &Vault, payout: usize, attempt: usize) -> Value {
    mpc_sign(VAULT_KEY, &eth::eip1559_hash(&v.transfer(payout, attempt)))
}

pub fn sign_ok(v: &mut Vault, payout: u32, attempt: u32) {
    let sig = good_signature(v, payout as usize, attempt as usize);
    assert!(v.on_signed(payout, attempt, v.payouts[payout as usize].signing_since, Ok(sig)));
}

pub fn attestation(v: &Vault, payout: usize, attempt: usize, seed: u8) -> Value {
    let tx = v.payouts[payout].attempts[attempt].tx_hash_hex.clone().unwrap();
    let hash = v.expected_payload_hash(&tx);
    json!({ "payload_hash": eth::hex(&hash), "signature": mpc_sign(seed, &hash) })
}

pub fn settle_ok(v: &mut Vault, payout: u32, attempt: u32) -> bool {
    let response = attestation(v, payout as usize, attempt as usize, FOREIGN_KEY);
    v.on_settled(payout, attempt, Ok(response))
}
