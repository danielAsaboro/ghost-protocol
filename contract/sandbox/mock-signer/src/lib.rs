//! Stands in for the MPC signer so real promises and callbacks can run in the sandbox.
use k256::ecdsa::SigningKey;
use near_sdk::serde_json::{json, Value};
use near_sdk::{env, near, PanicOnDefault};

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn parse32(text: &str) -> [u8; 32] {
    let mut out = [0u8; 32];
    for (i, slot) in out.iter_mut().enumerate() {
        *slot = u8::from_str_radix(&text[i * 2..i * 2 + 2], 16).unwrap();
    }
    out
}

fn mpc_signature(seed: u8, hash: &[u8; 32]) -> Value {
    let key = SigningKey::from_slice(&[seed; 32]).unwrap();
    let (sig, id) = key.sign_prehash_recoverable(hash).unwrap();
    let bytes = sig.to_bytes();
    json!({
        "scheme": "Secp256k1",
        "big_r": { "affine_point": format!("0{}{}", 2 + (id.to_byte() & 1), hex(&bytes[..32])) },
        "s": { "scalar": hex(&bytes[32..]) },
        "recovery_id": id.to_byte(),
    })
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Mock {
    mode: String,
}

#[near]
impl Mock {
    #[init]
    pub fn new() -> Self {
        Self { mode: "ok".into() }
    }

    pub fn set_mode(&mut self, mode: String) {
        self.mode = mode;
    }

    #[payable]
    pub fn sign(&mut self, request: Value) -> Value {
        if self.mode == "fail" {
            env::panic_str("signer down");
        }
        let seed = if self.mode == "forge" { 77 } else { 40 };
        mpc_signature(seed, &parse32(request["payload_v2"]["Ecdsa"].as_str().unwrap()))
    }

    #[payable]
    pub fn verify_foreign_transaction(&mut self, request: Value) -> Value {
        if self.mode == "not_landed" {
            env::panic_str("transaction not found");
        }
        let hash = parse32(request["expected_payload_hash"].as_str().unwrap());
        let seed = if self.mode == "forge" { 77 } else { 41 };
        json!({ "payload_hash": hex(&hash), "signature": mpc_signature(seed, &hash) })
    }

    #[payable]
    pub fn request_app_private_key(&mut self, request: Value) -> Value {
        json!({ "big_y": "y", "big_c": "c", "echo": request["app_public_key"] })
    }
}
