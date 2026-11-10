//! Real promises and callbacks against a sandbox node. Build both WASMs first (see README).
use base64::{engine::general_purpose::STANDARD, Engine};
use ed25519_dalek::{Signer, SigningKey};
use k256::ecdsa::SigningKey as EcKey;
use near_workspaces::types::{Gas, NearToken};
use near_workspaces::{Account, Contract, Worker};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sha3::Keccak256;

const CAP: &str = "1000";
const HEIR: &str = "0x00000000000000000000000000000000000000aa";

fn ed(seed: u8) -> SigningKey {
    SigningKey::from_bytes(&[seed; 32])
}
fn ed_pub(seed: u8) -> String {
    STANDARD.encode(ed(seed).verifying_key().to_bytes())
}
fn ed_sign(seed: u8, message: &str) -> String {
    STANDARD.encode(ed(seed).sign(message.as_bytes()).to_bytes())
}
fn ec_pub_bytes(seed: u8) -> Vec<u8> {
    EcKey::from_slice(&[seed; 32]).unwrap().verifying_key().to_encoded_point(false).as_bytes()[1..].to_vec()
}
fn ec_pub(seed: u8) -> String {
    STANDARD.encode(ec_pub_bytes(seed))
}
fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

struct World {
    vault: Contract,
    mock: Contract,
    agent: Account,
    stranger: Account,
}

fn proof(vault: &str, value: &str) -> Value {
    let content = json!({ "action": "pay", "heir_index": 0, "value_wei": value, "vault": vault, "reasoning": "r" }).to_string();
    let body = json!({ "choices": [{ "message": { "content": content } }] }).to_string();
    let signed_text = format!("{}:{}", "ab".repeat(32), hex(&Sha256::digest(body.as_bytes())));
    let digest: [u8; 32] = Keccak256::digest(format!("\x19Ethereum Signed Message:\n{}{}", signed_text.len(), signed_text)).into();
    let (sig, id) = EcKey::from_slice(&[42; 32]).unwrap().sign_prehash_recoverable(&digest).unwrap();
    let mut bytes = sig.to_bytes().to_vec();
    bytes.push(id.to_byte() + 27);
    json!({ "signed_text": signed_text, "signature": hex(&bytes), "response_body": body })
}

async fn world(worker: &Worker<near_workspaces::network::Sandbox>) -> anyhow::Result<World> {
    let wasm = std::fs::read("../target/near/ghost_protocol.wasm")?;
    let mock_wasm = std::fs::read("mock-signer/target/near/mock_signer.wasm")?;
    let vault = worker.dev_deploy(&wasm).await?;
    let mock = worker.dev_deploy(&mock_wasm).await?;
    mock.call("new").transact().await?.into_result()?;
    let root = worker.root_account()?;
    let agent = root.create_subaccount("agent").initial_balance(NearToken::from_near(5)).transact().await?.into_result()?;
    let stranger = root.create_subaccount("stranger").initial_balance(NearToken::from_near(5)).transact().await?.into_result()?;

    let config = json!({
        "owner": stranger.id(), "recovery_key": ed_pub(20), "agent": agent.id(), "legal_authority": stranger.id(),
        "signer_contract": mock.id(), "vault_public_key": ec_pub(40), "foreign_tx_public_key": ec_pub(41),
        "witnesses": [ed_pub(1), ed_pub(2), ed_pub(3)], "witness_threshold": 2, "registrar": ed_pub(9),
        "inactivity_secs": 0, "grace_secs": 0, "override_grace_secs": 0, "contest_secs": 0, "freeze_max_secs": 0, "fallback_secs": 1,
        "chain_id": 84532, "initial_max_fee_per_gas": "100", "max_fee_ceiling": "1600", "max_priority_fee_per_gas": "1",
        "budget_wei": "100000000", "sealed_wishes_hash": "h", "wishes_app_key": "bls12381g1:app",
        "heirs": [{ "address": HEIR, "floor_wei": "500", "cap_wei": CAP, "gas_limit": 21000, "adult_by": 0 }],
    });
    vault.call("new").args_json(json!({ "config": config })).transact().await?.into_result()?;

    let id = vault.id().to_string();
    let death_at = 1u64;
    worker.fast_forward(2).await?;
    let state: Value = vault.view("get_state").await?.json()?;
    let death_at = state["last_check_in"].as_u64().unwrap().max(death_at);
    let message = format!("ghost:death:{id}:0:{death_at}");
    let proofs = json!([{ "witness_index": 0, "signature": ed_sign(1, &message) }, { "witness_index": 1, "signature": ed_sign(2, &message) }]);
    stranger.call(vault.id(), "open_claim").args_json(json!({ "death_at": death_at, "proofs": proofs, "override_claim": false })).transact().await?.into_result()?;

    let address = format!("0x{}", hex(&Keccak256::digest(ec_pub_bytes(42))[12..]));
    let quote = "q".to_string();
    let expires = 4_000_000_000u64;
    let msg = format!("ghost:signer:{id}:{address}:{quote}:{expires}");
    let signer_proofs = json!([{ "witness_index": 0, "signature": ed_sign(1, &msg) }, { "witness_index": 1, "signature": ed_sign(2, &msg) }]);
    stranger.call(vault.id(), "register_signer").args_json(json!({ "address": address, "quote_sha256": quote, "expires_at": expires, "proofs": signer_proofs })).transact().await?.into_result()?;
    Ok(World { vault, mock, agent, stranger })
}

async fn state(w: &World) -> anyhow::Result<Value> {
    Ok(w.vault.view("get_state").await?.json()?)
}

async fn propose(w: &World, value: &str) -> anyhow::Result<()> {
    let p = proof(w.vault.id().as_str(), value);
    w.agent.call(w.vault.id(), "propose_payout").args_json(json!({ "heir_index": 0, "value_wei": value, "proof": p })).gas(Gas::from_tgas(300)).transact().await?.into_result()?;
    Ok(())
}

async fn mode(w: &World, m: &str) -> anyhow::Result<()> {
    w.mock.call("set_mode").args_json(json!({ "mode": m })).transact().await?.into_result()?;
    Ok(())
}

async fn settle(w: &World) -> anyhow::Result<()> {
    w.stranger.call(w.vault.id(), "settle").args_json(json!({ "payout_index": 0, "attempt_index": 0 })).gas(Gas::from_tgas(300)).transact().await?.into_result()?;
    Ok(())
}

#[tokio::test]
async fn signs_then_settles_through_real_promises() -> anyhow::Result<()> {
    let worker = near_workspaces::sandbox().await?;
    let w = world(&worker).await?;
    propose(&w, CAP).await?;
    let s = state(&w).await?;
    assert_eq!(s["heirs"][0]["status"], "Pending");
    assert!(s["payouts"][0]["attempts"][0]["tx_hash_hex"].is_string(), "signature not stored: {s}");
    settle(&w).await?;
    let s = state(&w).await?;
    assert_eq!(s["heirs"][0]["status"], "Paid");
    assert_eq!(s["payouts"][0]["status"], "Settled");
    Ok(())
}

#[tokio::test]
async fn forged_mpc_signature_is_dropped_and_retry_works() -> anyhow::Result<()> {
    let worker = near_workspaces::sandbox().await?;
    let w = world(&worker).await?;
    mode(&w, "forge").await?;
    propose(&w, CAP).await?;
    let s = state(&w).await?;
    assert_eq!(s["payouts"][0]["attempts"].as_array().unwrap().len(), 0);
    assert_eq!(s["payouts"][0]["signing"], false);
    mode(&w, "ok").await?;
    w.stranger.call(w.vault.id(), "request_signature").args_json(json!({ "payout_index": 0, "max_fee_per_gas": "100" })).gas(Gas::from_tgas(300)).transact().await?.into_result()?;
    assert!(state(&w).await?["payouts"][0]["attempts"][0]["tx_hash_hex"].is_string());
    Ok(())
}

#[tokio::test]
async fn signer_failure_clears_the_attempt() -> anyhow::Result<()> {
    let worker = near_workspaces::sandbox().await?;
    let w = world(&worker).await?;
    mode(&w, "fail").await?;
    propose(&w, CAP).await.ok();
    let s = state(&w).await?;
    assert_eq!(s["payouts"][0]["signing"], false, "callback did not run: {s}");
    assert_eq!(s["payouts"][0]["attempts"].as_array().unwrap().len(), 0);
    Ok(())
}

#[tokio::test]
async fn a_transaction_that_never_landed_is_not_paid() -> anyhow::Result<()> {
    let worker = near_workspaces::sandbox().await?;
    let w = world(&worker).await?;
    propose(&w, CAP).await?;
    mode(&w, "not_landed").await?;
    settle(&w).await.ok();
    let s = state(&w).await?;
    assert_eq!(s["heirs"][0]["status"], "Pending");
    mode(&w, "forge").await?;
    settle(&w).await.ok();
    assert_eq!(state(&w).await?["heirs"][0]["status"], "Pending");
    Ok(())
}

#[tokio::test]
async fn callbacks_cannot_be_called_by_anyone_else() -> anyhow::Result<()> {
    let worker = near_workspaces::sandbox().await?;
    let w = world(&worker).await?;
    propose(&w, CAP).await?;
    let attempt = w.stranger.call(w.vault.id(), "on_settled").args_json(json!({ "payout_index": 0, "attempt_index": 0 })).gas(Gas::from_tgas(100)).transact().await?;
    assert!(attempt.is_failure());
    assert_eq!(state(&w).await?["heirs"][0]["status"], "Pending");
    Ok(())
}
