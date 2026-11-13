//! GhostProtocol vault. Invariant numbers refer to docs/threat-model.md.

use near_sdk::json_types::{Base64VecU8, U128};
use near_sdk::serde::Deserialize;
use near_sdk::serde_json::{self, json, Value};
use near_sdk::{env, near, require, AccountId, Gas, GasWeight, NearToken, PanicOnDefault, Promise, PromiseError};

pub mod eth;
pub mod math;

pub const DERIVATION_PATH: &str = "ghost-base-sepolia-1";
pub const WISHES_PATH: &str = "ghost-wishes-1";
pub const BASE_SEPOLIA: u64 = 84_532;
const SIGN_DOMAIN: u32 = 0;
const CKD_DOMAIN: u32 = 2;
const FOREIGN_TX_DOMAIN: u32 = 3;
const SIGN_GAS: Gas = Gas::from_tgas(150);
const VERIFY_GAS: Gas = Gas::from_tgas(150);
const CKD_GAS: Gas = Gas::from_tgas(100);
const CALLBACK_GAS: Gas = Gas::from_tgas(60);
const MAX_RESPONSE_BYTES: usize = 16_384;
const ONE_YOCTO: NearToken = NearToken::from_yoctonear(1);
const MIN_GAS_LIMIT: u64 = 21_000;
const MAX_GAS_LIMIT: u64 = 2_000_000;
/// After this long without its callback, a signature request is presumed lost (D11) and anyone may
/// replace it. A late callback for the old request is ignored, so the lease is not a safety bound.
pub const SIGN_LEASE_SECS: u64 = 86_400;
/// No duration may exceed 100 years, so every deadline sum fits in u64 (Kani, `math.rs`).
pub const MAX_DURATION_SECS: u64 = 100 * 365 * 86_400;
/// Bounds on state, so the gas a callback needs is bounded (D11, D12).
pub const MAX_WITNESSES: usize = 32;
pub const MAX_HEIRS: usize = 16;
pub const MAX_SIGNERS: usize = 8;
/// A retry after a reopened revert waits this long, so anyone can first prove the original landed
/// (outside review F1: a lying quorum could otherwise overpay every heir before detection).
pub const REOPEN_DELAY_SECS: u64 = 86_400;
/// The owner may register an attested signer for at most this long (outside review F3).
pub const OWNER_SIGNER_MAX_SECS: u64 = 365 * 86_400;
/// 2^126 wei, about 8.5e19 ETH: far above any estate, and low enough that committed value plus one
/// reinstated payout cannot overflow.
pub const MAX_BUDGET_WEI: u128 = 1 << 126;
/// 2^63 wei per gas: far above any real fee, and low enough that the tip arithmetic cannot overflow.
pub const MAX_FEE_CEILING: u128 = 1 << 63;

#[near(serializers = [json, borsh])]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum HeirStatus {
    Open,
    Pending,
    Paid,
}

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct Heir {
    pub address: String,
    pub floor_wei: U128,
    pub cap_wei: U128,
    pub gas_limit: u64,
    /// Time by which this heir counts as an adult even if the registrar never signs.
    pub adult_by: u64,
    pub adult_at: Option<u64>,
    pub status: HeirStatus,
    pub reopened: bool,
    /// When a quorum reopened this heir's payout; its retry waits REOPEN_DELAY_SECS.
    pub reopened_at: Option<u64>,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum ClaimKind {
    Normal,
    Override,
}

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct Claim {
    pub kind: ClaimKind,
    pub death_at: u64,
    pub opened_at: u64,
    pub pay_after: u64,
    pub contested: Vec<bool>,
    pub frozen_until: u64,
    pub freeze_used: bool,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum PayoutStatus {
    Active,
    Settled,
    Reverted,
}

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct Attempt {
    pub max_fee_per_gas: U128,
    pub max_priority_fee_per_gas: U128,
    pub payload_hex: String,
    pub r_hex: Option<String>,
    pub s_hex: Option<String>,
    pub y_parity: Option<u8>,
    pub tx_hash_hex: Option<String>,
}

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct Payout {
    pub heir_index: u32,
    pub to: String,
    pub value_wei: U128,
    pub gas_limit: u64,
    pub nonce: u64,
    pub created_at: u64,
    pub source: String,
    pub request_hash: Option<String>,
    pub response_hash: Option<String>,
    pub signing: bool,
    /// Block time of the request in flight; its callback must quote it.
    pub signing_since: u64,
    pub status: PayoutStatus,
    pub settled_attempt: Option<u32>,
    pub attempts: Vec<Attempt>,
}

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct AttestedSigner {
    /// 0x-prefixed Ethereum-style address from the attestation report.
    pub address: String,
    pub quote_sha256: String,
    pub expires_at: u64,
}

#[near(serializers = [json])]
pub struct HeirConfig {
    pub address: String,
    pub floor_wei: U128,
    pub cap_wei: U128,
    pub gas_limit: u64,
    pub adult_by: u64,
}

#[near(serializers = [json])]
pub struct VaultConfig {
    pub owner: AccountId,
    pub recovery_key: Base64VecU8,
    pub agent: AccountId,
    pub legal_authority: AccountId,
    pub signer_contract: AccountId,
    /// Uncompressed secp256k1 key without prefix, from `derived_public_key` on domain 0.
    pub vault_public_key: Base64VecU8,
    /// Uncompressed secp256k1 key without prefix, from `public_key` on domain 3.
    pub foreign_tx_public_key: Base64VecU8,
    pub witnesses: Vec<Base64VecU8>,
    pub witness_threshold: u32,
    pub registrar: Base64VecU8,
    pub inactivity_secs: u64,
    pub grace_secs: u64,
    pub override_grace_secs: u64,
    pub contest_secs: u64,
    pub freeze_max_secs: u64,
    pub fallback_secs: u64,
    /// After this long without a check-in, a normal claim opens with no witnesses (D20). None: never.
    #[serde(default)]
    pub abandon_secs: Option<u64>,
    pub chain_id: u64,
    pub initial_max_fee_per_gas: U128,
    pub max_fee_ceiling: U128,
    pub max_priority_fee_per_gas: U128,
    pub budget_wei: U128,
    pub sealed_wishes_hash: String,
    /// BLS12-381 G1 key the wishes key is encrypted to, as the signer expects it.
    pub wishes_app_key: Option<String>,
    pub heirs: Vec<HeirConfig>,
}

#[near(serializers = [json])]
pub struct WitnessProof {
    pub witness_index: u32,
    pub signature: Base64VecU8,
}

#[near(serializers = [json])]
pub struct DecisionProof {
    /// Exact `request_sha256:response_sha256` text the enclave signed, with any prefix.
    pub signed_text: String,
    /// 65 bytes hex, `r || s || v`, with or without 0x.
    pub signature: String,
    /// Exact response bytes whose SHA-256 is in `signed_text`.
    pub response_body: String,
}

#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde")]
struct Decision {
    action: String,
    heir_index: u32,
    value_wei: String,
    vault: String,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Vault {
    owner: AccountId,
    recovery_key: Vec<u8>,
    agent: AccountId,
    legal_authority: AccountId,
    signer_contract: AccountId,
    vault_public_key: Vec<u8>,
    foreign_tx_public_key: Vec<u8>,
    witnesses: Vec<Vec<u8>>,
    witness_threshold: u32,
    registrar: Vec<u8>,
    inactivity_secs: u64,
    grace_secs: u64,
    override_grace_secs: u64,
    contest_secs: u64,
    freeze_max_secs: u64,
    fallback_secs: u64,
    abandon_secs: Option<u64>,
    chain_id: u64,
    initial_max_fee_per_gas: u128,
    max_fee_ceiling: u128,
    max_priority_fee_per_gas: u128,
    budget_wei: u128,
    committed_wei: u128,
    next_nonce: u64,
    claim_epoch: u64,
    sealed_wishes_hash: String,
    wishes_app_key: Option<String>,
    heirs: Vec<Heir>,
    last_check_in: u64,
    claim: Option<Claim>,
    payouts: Vec<Payout>,
    signers: Vec<AttestedSigner>,
    false_revert_proven: bool,
    /// Set when the wishes key is requested. From then on the claim cannot be cancelled (I20).
    wishes_released: bool,
}

fn now_secs() -> u64 {
    env::block_timestamp_ms() / 1000
}

fn key32(bytes: &[u8]) -> [u8; 32] {
    bytes.try_into().unwrap_or_else(|_| env::panic_str("key must be 32 bytes"))
}

fn sig64(bytes: &[u8]) -> [u8; 64] {
    bytes.try_into().unwrap_or_else(|_| env::panic_str("signature must be 64 bytes"))
}

fn fixed32(hex: &str) -> Option<[u8; 32]> {
    eth::parse_hex(hex)?.try_into().ok()
}

fn verify_ed25519(signature: &[u8], message: &str, key: &[u8]) -> bool {
    env::ed25519_verify(&sig64(signature), message.as_bytes(), &key32(key))
}

/// Parses `{big_r:{affine_point}, s:{scalar}, recovery_id}` into `(r, s, recovery_id)`.
fn parse_mpc_signature(value: &Value) -> Option<([u8; 32], [u8; 32], u8)> {
    let big_r = value.get("big_r")?.get("affine_point")?.as_str()?;
    let scalar = value.get("s")?.get("scalar")?.as_str()?;
    let recovery_id = value.get("recovery_id")?.as_u64()?;
    if recovery_id > 1 || big_r.len() != 66 {
        return None;
    }
    Some((fixed32(big_r.get(2..)?)?, fixed32(scalar)?, recovery_id as u8))
}

/// `true` only when the signature is low-s and recovers to exactly `expected`.
fn recovers_to(hash: &[u8; 32], r: &[u8; 32], s: &[u8; 32], recovery_id: u8, expected: &[u8]) -> bool {
    let mut compact = [0u8; 64];
    compact[..32].copy_from_slice(r);
    compact[32..].copy_from_slice(s);
    env::ecrecover(hash, &compact, recovery_id, true).is_some_and(|key| key.as_slice() == expected)
}

/// D3: the signer's deposit is a constant in its code today. A caller who attaches more passes it
/// on, so a raised deposit does not strand the vault. With nothing attached the vault pays 1 yocto.
fn forwarded_deposit() -> NearToken {
    env::attached_deposit().max(ONE_YOCTO)
}

fn ensure(condition: bool, message: &str) {
    if !condition {
        env::panic_str(message)
    }
}

#[near]
impl Vault {
    #[init]
    pub fn new(config: VaultConfig) -> Self {
        let witnesses: Vec<Vec<u8>> = config.witnesses.into_iter().map(|k| k.0).collect();
        witnesses.iter().for_each(|k| {
            key32(k);
        });
        require!(
            config.witness_threshold >= 2 && config.witness_threshold as usize <= witnesses.len(),
            "witness threshold must be at least 2 and at most the witness count"
        );
        key32(&config.registrar.0);
        key32(&config.recovery_key.0);
        // Outside review F5: one person must not count as two witnesses, or double as registrar or recovery.
        for (i, k) in witnesses.iter().enumerate() {
            require!(!witnesses[..i].contains(k), "witness keys must be distinct");
            require!(*k != config.registrar.0 && *k != config.recovery_key.0, "witness keys must differ from registrar and recovery keys");
        }
        require!(
            config.vault_public_key.0.len() == 64 && config.foreign_tx_public_key.0.len() == 64,
            "MPC keys must be 64 bytes"
        );
        require!(config.chain_id == BASE_SEPOLIA, "only Base Sepolia settlement is supported");
        require!(
            config.initial_max_fee_per_gas.0 > 0
                && config.initial_max_fee_per_gas.0 <= config.max_fee_ceiling.0
                && config.max_priority_fee_per_gas.0 <= config.initial_max_fee_per_gas.0,
            "invalid fee settings"
        );
        require!(witnesses.len() <= MAX_WITNESSES, "too many witnesses");
        require!(config.heirs.len() <= MAX_HEIRS, "too many heirs");
        let durations = [
            config.inactivity_secs,
            config.grace_secs,
            config.override_grace_secs,
            config.contest_secs,
            config.freeze_max_secs,
            config.fallback_secs,
            config.abandon_secs.unwrap_or(0),
        ];
        require!(durations.iter().all(|d| *d <= MAX_DURATION_SECS), "durations must be at most 100 years");
        if let Some(abandon) = config.abandon_secs {
            require!(abandon > config.inactivity_secs, "abandonment must outlast inactivity");
        }
        let delays = math::longest_delay(
            config.grace_secs,
            math::reduced_override_grace(config.override_grace_secs),
            config.contest_secs,
            witnesses.len(),
            config.freeze_max_secs,
        );
        require!(config.fallback_secs > delays, "fallback must outlast every delay");
        require!(!config.heirs.is_empty(), "at least one heir required");

        let ceiling = config.max_fee_ceiling.0;
        let mut required = 0u128;
        let mut heirs = Vec::with_capacity(config.heirs.len());
        for heir in config.heirs {
            ensure(eth::parse_address(&heir.address).is_some(), "invalid heir address");
            require!(
                heir.floor_wei.0 > 0 && heir.floor_wei.0 <= heir.cap_wei.0,
                "heir floor must be positive and at most the cap"
            );
            require!(
                heir.gas_limit >= MIN_GAS_LIMIT && heir.gas_limit <= MAX_GAS_LIMIT,
                "heir gas limit out of range"
            );
            // Two gas allowances: the payment, and one retry after a proven revert.
            required += math::heir_requirement(heir.cap_wei.0, heir.gas_limit, ceiling);
            heirs.push(Heir {
                address: heir.address,
                floor_wei: heir.floor_wei,
                cap_wei: heir.cap_wei,
                gas_limit: heir.gas_limit,
                adult_by: heir.adult_by,
                adult_at: None,
                status: HeirStatus::Open,
                reopened: false,
                reopened_at: None,
            });
        }
        require!(required <= config.budget_wei.0, "caps and gas exceed the budget");
        // Leaves headroom for one reinstated payout on top of a full budget (Kani, math.rs).
        require!(config.budget_wei.0 <= MAX_BUDGET_WEI, "budget too large");
        require!(config.max_fee_ceiling.0 <= MAX_FEE_CEILING, "fee ceiling too large");

        Self {
            owner: config.owner,
            recovery_key: config.recovery_key.0,
            agent: config.agent,
            legal_authority: config.legal_authority,
            signer_contract: config.signer_contract,
            vault_public_key: config.vault_public_key.0,
            foreign_tx_public_key: config.foreign_tx_public_key.0,
            witnesses,
            witness_threshold: config.witness_threshold,
            registrar: config.registrar.0,
            inactivity_secs: config.inactivity_secs,
            grace_secs: config.grace_secs,
            override_grace_secs: config.override_grace_secs,
            contest_secs: config.contest_secs,
            freeze_max_secs: config.freeze_max_secs,
            fallback_secs: config.fallback_secs,
            abandon_secs: config.abandon_secs,
            chain_id: config.chain_id,
            initial_max_fee_per_gas: config.initial_max_fee_per_gas.0,
            max_fee_ceiling: ceiling,
            max_priority_fee_per_gas: config.max_priority_fee_per_gas.0,
            budget_wei: config.budget_wei.0,
            committed_wei: 0,
            next_nonce: 0,
            claim_epoch: 0,
            sealed_wishes_hash: config.sealed_wishes_hash,
            wishes_app_key: config.wishes_app_key,
            heirs,
            last_check_in: now_secs(),
            claim: None,
            payouts: vec![],
            signers: vec![],
            false_revert_proven: false,
            wishes_released: false,
        }
    }

    /// I9: cancels a normal claim until the first payout exists. I10: never an override claim.
    pub fn check_in(&mut self) {
        require!(env::predecessor_account_id() == self.owner, "only the owner can check in");
        self.last_check_in = now_secs();
        if self.claim.as_ref().is_some_and(|c| c.kind == ClaimKind::Normal) {
            require!(self.payouts.is_empty(), "payout already started");
            require!(!self.wishes_released, "wishes already released");
            self.claim = None;
            self.claim_epoch += 1;
        }
    }

    /// A normal claim needs silence and a quorum. An override claim needs every witness.
    pub fn open_claim(&mut self, death_at: u64, proofs: Vec<WitnessProof>, override_claim: bool) {
        let now = now_secs();
        require!(self.claim.is_none(), "claim already open");
        require!(death_at <= now, "death time is in the future");
        let message = if override_claim {
            format!("ghost:override:{}:{}:{}", env::current_account_id(), self.claim_epoch, death_at)
        } else {
            require!(math::silence(now, self.last_check_in) >= self.inactivity_secs, "owner is not inactive");
            require!(death_at >= self.last_check_in, "death time is inconsistent with check-ins");
            format!("ghost:death:{}:{}:{}", env::current_account_id(), self.claim_epoch, death_at)
        };

        let mut seen = vec![false; self.witnesses.len()];
        let mut valid = 0u32;
        for proof in proofs {
            let i = proof.witness_index as usize;
            require!(i < self.witnesses.len(), "unknown witness");
            require!(!seen[i], "duplicate witness");
            seen[i] = true;
            require!(verify_ed25519(&proof.signature.0, &message, &self.witnesses[i]), "invalid witness signature");
            valid += 1;
        }
        // D20: after a very long silence a normal claim needs no witnesses, so lost witness keys
        // cannot strand the estate. A check-in still cancels it (I9).
        let abandoned = !override_claim
            && self.abandon_secs.is_some_and(|a| math::silence(now, self.last_check_in) >= a);
        // Outside review F2: with one witness gone and the check-in key stolen, an override with all
        // witnesses is impossible and check-ins block every normal claim. A quorum may open an
        // override, but it waits twice as long; the recovery key still cancels it.
        let needed = if override_claim || !abandoned { self.witness_threshold } else { 0 };
        require!(valid >= needed, "witness quorum not met");
        let unanimous = valid as usize == self.witnesses.len();
        let delay = match (override_claim, unanimous) {
            (true, true) => self.override_grace_secs,
            (true, false) => math::reduced_override_grace(self.override_grace_secs),
            (false, _) => self.grace_secs,
        };
        self.claim = Some(Claim {
            kind: if override_claim { ClaimKind::Override } else { ClaimKind::Normal },
            death_at,
            opened_at: now,
            pay_after: math::after(now, delay),
            contested: vec![false; self.witnesses.len()],
            frozen_until: 0,
            freeze_used: false,
        });
    }

    /// I10: only the cold recovery key can cancel an override claim.
    pub fn cancel_override(&mut self, signature: Base64VecU8) {
        let claim = self.claim.as_ref().unwrap_or_else(|| env::panic_str("no open claim"));
        require!(claim.kind == ClaimKind::Override, "not an override claim");
        require!(self.payouts.is_empty(), "payout already started");
        require!(!self.wishes_released, "wishes already released");
        let message = format!("ghost:cancel:{}:{}:{}", env::current_account_id(), self.claim_epoch, claim.opened_at);
        require!(verify_ed25519(&signature.0, &message, &self.recovery_key), "invalid recovery signature");
        self.claim = None;
        self.claim_epoch += 1;
        self.last_check_in = now_secs();
    }

    /// I16: one witness can buy time for someone in hospital, once.
    pub fn contest_claim(&mut self, witness_index: u32, signature: Base64VecU8) {
        let i = witness_index as usize;
        require!(i < self.witnesses.len(), "unknown witness");
        let contest_secs = self.contest_secs;
        let account = env::current_account_id();
        let key = self.witnesses[i].clone();
        let epoch = self.claim_epoch;
        let claim = self.claim.as_mut().unwrap_or_else(|| env::panic_str("no open claim"));
        require!(!claim.contested[i], "witness already contested");
        // Outside review F6: a contest buys time during grace, not after payouts began.
        require!(now_secs() < claim.pay_after, "grace period is over");
        // Outside review F9: bound to this claim, not just its opening second.
        let message = format!("ghost:contest:{}:{}:{}:{}", account, epoch, witness_index, claim.opened_at);
        require!(verify_ed25519(&signature.0, &message, &key), "invalid witness signature");
        claim.contested[i] = true;
        claim.pay_after = math::after(claim.pay_after, contest_secs);
    }

    /// I11: tied to one heir, once, and can only bring the date earlier than `adult_by`.
    pub fn prove_adult(&mut self, heir_index: u32, adult_at: u64, signature: Base64VecU8) {
        let i = heir_index as usize;
        require!(i < self.heirs.len(), "unknown heir");
        require!(self.heirs[i].adult_at.is_none(), "heir age already proven");
        let message = format!("ghost:adult:{}:{}:{}", env::current_account_id(), heir_index, adult_at);
        require!(verify_ed25519(&signature.0, &message, &self.registrar), "invalid registrar signature");
        self.heirs[i].adult_at = Some(adult_at);
    }

    /// I12: one bounded pause per claim.
    pub fn freeze(&mut self) {
        require!(env::predecessor_account_id() == self.legal_authority, "only the legal authority can freeze");
        let until = math::after(now_secs(), self.freeze_max_secs);
        let claim = self.claim.as_mut().unwrap_or_else(|| env::panic_str("no open claim"));
        require!(!claim.freeze_used, "freeze already used for this claim");
        claim.freeze_used = true;
        claim.frozen_until = until;
    }

    /// Registers an attested key. The owner may do this before a claim; afterwards a quorum must.
    pub fn register_signer(
        &mut self,
        address: String,
        quote_sha256: String,
        expires_at: u64,
        proofs: Vec<WitnessProof>,
    ) {
        ensure(eth::parse_address(&address).is_some(), "invalid signer address");
        require!(expires_at > now_secs(), "signer already expired");
        let by_owner = env::predecessor_account_id() == self.owner && self.claim.is_none();
        if by_owner {
            require!(proofs.is_empty(), "owner registration takes no proofs");
            require!(expires_at <= math::after(now_secs(), OWNER_SIGNER_MAX_SECS), "owner may register a signer for at most a year");
        } else {
            let message = format!(
                "ghost:signer:{}:{}:{}:{}",
                env::current_account_id(),
                address.to_lowercase(),
                quote_sha256,
                expires_at
            );
            let mut seen = vec![false; self.witnesses.len()];
            let mut valid = 0u32;
            for proof in proofs {
                let i = proof.witness_index as usize;
                require!(i < self.witnesses.len() && !seen[i], "bad witness index");
                seen[i] = true;
                require!(verify_ed25519(&proof.signature.0, &message, &self.witnesses[i]), "invalid witness signature");
                valid += 1;
            }
            require!(valid >= self.witness_threshold, "witness quorum not met");
        }
        let now = now_secs();
        let address = address.to_lowercase();
        self.signers.retain(|s| s.expires_at > now);
        // Outside review F3: a replayed registration adds nothing, and a quorum can always make room.
        require!(!self.signers.iter().any(|s| s.address == address), "signer already registered");
        if self.signers.len() >= MAX_SIGNERS {
            require!(!by_owner, "too many attested signers");
            let soonest = (0..self.signers.len()).min_by_key(|&k| self.signers[k].expires_at).unwrap();
            self.signers.remove(soonest);
        }
        self.signers.push(AttestedSigner { address, quote_sha256, expires_at });
    }

    /// I2, I14: the agent's only power, bounded by floor and cap and bound to an attested response.
    #[payable]
    pub fn propose_payout(&mut self, heir_index: u32, value_wei: U128, proof: DecisionProof) -> Promise {
        require!(env::predecessor_account_id() == self.agent, "only the agent can propose");
        let index = heir_index as usize;
        require!(index < self.heirs.len(), "recipient is not an heir");
        self.assert_trigger_proven(index);
        let heir = &self.heirs[index];
        require!(value_wei.0 >= heir.floor_wei.0, "amount below heir floor");
        require!(value_wei.0 <= heir.cap_wei.0, "amount exceeds heir cap");
        let (request_hash, response_hash) = self.verify_decision(heir_index, value_wei.0, &proof);
        self.create_payout(index, value_wei.0, "agent", Some(request_hash), Some(response_hash))
    }

    /// I13: after the long timeout anyone can pay an open heir its cap with no AI.
    #[payable]
    pub fn execute_fallback(&mut self, heir_index: u32) -> Promise {
        let index = heir_index as usize;
        require!(index < self.heirs.len(), "recipient is not an heir");
        self.assert_trigger_proven(index);
        let claim = self.claim.as_ref().unwrap();
        require!(now_secs() >= math::after(claim.opened_at, self.fallback_secs), "fallback not yet available");
        let cap = self.heirs[index].cap_wei.0;
        self.create_payout(index, cap, "fallback", None, None)
    }

    /// I6: anyone may ask for a re-priced signature. Same nonce, recipient and value.
    #[payable]
    pub fn request_signature(&mut self, payout_index: u32, max_fee_per_gas: U128) -> Promise {
        let i = payout_index as usize;
        require!(i < self.payouts.len(), "unknown payout");
        self.assert_not_frozen();
        require!(self.payouts[i].status == PayoutStatus::Active, "payout is not active");
        if self.payouts[i].signing {
            // D11: a callback that ran out of gas or storage rolled back and will never come.
            // The lost attempt stays: if the MPC network did sign it, anyone can submit that signature
            // (submit_signature), so a broadcast of it can still settle (outside review F4).
            let since = self.payouts[i].signing_since;
            require!(now_secs() >= math::after(since, SIGN_LEASE_SECS), "signature already in flight");
            self.payouts[i].signing = false;
        }
        let previous = self.payouts[i].attempts.last().map(|a| a.max_fee_per_gas.0);
        require!(max_fee_per_gas.0 <= self.max_fee_ceiling, "fee above ceiling");
        ensure(
            math::fee_allowed(previous, max_fee_per_gas.0, self.initial_max_fee_per_gas, self.max_fee_ceiling),
            if previous.is_some() { "fee must double or reach the ceiling" } else { "fee below initial" },
        );
        self.begin_attempt(i, max_fee_per_gas.0)
    }

    /// I5: stores the signature only if it recovers to the vault key.
    #[private]
    pub fn on_signed(
        &mut self,
        payout_index: u32,
        attempt_index: u32,
        requested_at: u64,
        #[callback_result] result: Result<Value, PromiseError>,
    ) -> bool {
        let i = payout_index as usize;
        let current = &self.payouts[i];
        if !current.signing
            || current.signing_since != requested_at
            || attempt_index as usize + 1 != current.attempts.len()
        {
            // A callback for a request that was presumed lost and replaced: ignore it.
            return false;
        }
        self.payouts[i].signing = false;
        let parsed = result.ok().as_ref().and_then(parse_mpc_signature);
        let tx = self.transfer(i, attempt_index as usize);
        let hash = eth::eip1559_hash(&tx);
        let verified = parsed.filter(|(r, s, v)| recovers_to(&hash, r, s, *v, &self.vault_public_key));
        let Some((r, s, y_parity)) = verified else {
            // I18: a failed attempt leaves nothing behind.
            self.payouts[i].attempts.truncate(attempt_index as usize);
            return false;
        };
        self.store_signature(i, attempt_index as usize, &tx, r, s, y_parity);
        true
    }

    /// I5: anyone may store a signature for an attempt whose callback was lost. Accepted exactly when
    /// `on_signed` would accept it: it must recover to the vault key over this attempt's payload.
    pub fn submit_signature(&mut self, payout_index: u32, attempt_index: u32, signature: Value) -> bool {
        let i = payout_index as usize;
        let a = attempt_index as usize;
        require!(i < self.payouts.len(), "unknown payout");
        require!(a < self.payouts[i].attempts.len(), "unknown attempt");
        require!(self.payouts[i].attempts[a].tx_hash_hex.is_none(), "attempt already signed");
        let (r, s, y_parity) = parse_mpc_signature(&signature).unwrap_or_else(|| env::panic_str("malformed signature"));
        let tx = self.transfer(i, a);
        let hash = eth::eip1559_hash(&tx);
        require!(recovers_to(&hash, &r, &s, y_parity, &self.vault_public_key), "signature does not recover to the vault key");
        self.store_signature(i, a, &tx, r, s, y_parity);
        // The in-flight request is done: a late callback is ignored, and a payout whose callback ran
        // out of storage need not wait for the lease (local stack, fault iv).
        if self.payouts[i].signing && a + 1 == self.payouts[i].attempts.len() {
            self.payouts[i].signing = false;
        }
        true
    }

    /// I4: asks the MPC network to attest that this exact transaction succeeded on Base.
    #[payable]
    pub fn settle(&mut self, payout_index: u32, attempt_index: u32) -> Promise {
        let i = payout_index as usize;
        require!(i < self.payouts.len(), "unknown payout");
        let attempt = self.payouts[i].attempts.get(attempt_index as usize).unwrap_or_else(|| env::panic_str("unknown attempt"));
        let tx_hash = attempt.tx_hash_hex.clone().unwrap_or_else(|| env::panic_str("attempt has no signature"));
        let expected = self.expected_payload_hash(&tx_hash);
        let args = json!({
            "request": {
                "request": { "Base": { "tx_id": tx_hash, "extractors": [], "finality": "Finalized" } },
                "domain_id": FOREIGN_TX_DOMAIN,
                "payload_version": 1,
                "expected_payload_hash": eth::hex(&expected),
            }
        });
        Promise::new(self.signer_contract.clone())
            .function_call_weight(
                "verify_foreign_transaction".to_string(),
                serde_json::to_vec(&args).unwrap(),
                forwarded_deposit(),
                VERIFY_GAS,
                GasWeight(1),
            )
            .then(self.callback(
                "on_settled",
                json!({ "payout_index": payout_index, "attempt_index": attempt_index }),
            ))
    }

    /// I3, I4: marks paid only on a valid attestation of the computed hash.
    #[private]
    pub fn on_settled(
        &mut self,
        payout_index: u32,
        attempt_index: u32,
        #[callback_result] result: Result<Value, PromiseError>,
    ) -> bool {
        let i = payout_index as usize;
        let Some(tx_hash) = self.payouts[i].attempts[attempt_index as usize].tx_hash_hex.clone() else {
            return false;
        };
        let expected = self.expected_payload_hash(&tx_hash);
        let Ok(response) = result else { return false };
        let Some(signed_hash) = response.get("payload_hash").and_then(Value::as_str).and_then(fixed32) else {
            return false;
        };
        if signed_hash != expected {
            return false;
        }
        let Some((r, s, v)) = response.get("signature").and_then(parse_mpc_signature) else {
            return false;
        };
        if !recovers_to(&expected, &r, &s, v, &self.foreign_tx_public_key) {
            return false;
        }

        let heir_index = self.payouts[i].heir_index as usize;
        if self.payouts[i].status == PayoutStatus::Reverted {
            // I17: the quorum said this failed and the MPC network just proved it landed.
            // The retry stays active: its nonce must remain signable or later payouts strand.
            // The value left the vault after all, so it counts as committed again (I7).
            self.false_revert_proven = true;
            self.committed_wei = math::reinstate(self.committed_wei, self.payouts[i].value_wei.0);
        }
        self.payouts[i].status = PayoutStatus::Settled;
        self.payouts[i].settled_attempt = Some(attempt_index);
        self.heirs[heir_index].status = HeirStatus::Paid;
        true
    }

    /// I17: reopens a payout whose transaction reverted. The MPC network cannot attest a failure.
    pub fn reopen_reverted(&mut self, payout_index: u32, attempt_index: u32, proofs: Vec<WitnessProof>) {
        let i = payout_index as usize;
        require!(i < self.payouts.len(), "unknown payout");
        require!(!self.false_revert_proven, "reopen disabled after a disproved revert");
        require!(self.payouts[i].status == PayoutStatus::Active, "payout is not active");
        let tx_hash = self.payouts[i].attempts.get(attempt_index as usize).and_then(|a| a.tx_hash_hex.clone());
        let tx_hash = tx_hash.unwrap_or_else(|| env::panic_str("attempt has no signature"));
        let heir_index = self.payouts[i].heir_index as usize;
        require!(!self.heirs[heir_index].reopened, "heir already reopened once");
        let message = format!("ghost:reverted:{}:{}:{}", env::current_account_id(), payout_index, tx_hash);
        let mut seen = vec![false; self.witnesses.len()];
        let mut valid = 0u32;
        for proof in proofs {
            let w = proof.witness_index as usize;
            require!(w < self.witnesses.len() && !seen[w], "bad witness index");
            seen[w] = true;
            require!(verify_ed25519(&proof.signature.0, &message, &self.witnesses[w]), "invalid witness signature");
            valid += 1;
        }
        require!(valid >= self.witness_threshold, "witness quorum not met");
        self.payouts[i].status = PayoutStatus::Reverted;
        self.payouts[i].settled_attempt = Some(attempt_index);
        self.committed_wei = math::release(self.committed_wei, self.payouts[i].value_wei.0);
        self.heirs[heir_index].status = HeirStatus::Open;
        self.heirs[heir_index].reopened = true;
        self.heirs[heir_index].reopened_at = Some(now_secs());
    }

    /// I15: only after the trigger, only for the registered key. The reply is encrypted to it.
    #[payable]
    pub fn request_wishes_key(&mut self) -> Promise {
        self.assert_claim_matured();
        let app_key = self.wishes_app_key.clone().unwrap_or_else(|| env::panic_str("no wishes app key"));
        // I20: once the key may be out, the claim is permanent.
        self.wishes_released = true;
        let args = json!({
            "request": { "derivation_path": WISHES_PATH, "app_public_key": app_key, "domain_id": CKD_DOMAIN }
        });
        Promise::new(self.signer_contract.clone()).function_call_weight(
            "request_app_private_key".to_string(),
            serde_json::to_vec(&args).unwrap(),
            forwarded_deposit(),
            CKD_GAS,
            GasWeight(1),
        )
    }

    pub fn get_state(&self) -> Value {
        json!({
            "owner": self.owner,
            "agent": self.agent,
            "legal_authority": self.legal_authority,
            "signer_contract": self.signer_contract,
            "vault_public_key": eth::hex(&self.vault_public_key),
            "foreign_tx_public_key": eth::hex(&self.foreign_tx_public_key),
            "last_check_in": self.last_check_in,
            "inactivity_secs": self.inactivity_secs,
            "grace_secs": self.grace_secs,
            "override_grace_secs": self.override_grace_secs,
            "contest_secs": self.contest_secs,
            "freeze_max_secs": self.freeze_max_secs,
            "fallback_secs": self.fallback_secs,
            "claim": self.claim,
            "claim_epoch": self.claim_epoch,
            "chain_id": self.chain_id,
            "initial_max_fee_per_gas": U128(self.initial_max_fee_per_gas),
            "max_fee_ceiling": U128(self.max_fee_ceiling),
            "max_priority_fee_per_gas": U128(self.max_priority_fee_per_gas),
            "budget_wei": U128(self.budget_wei),
            "committed_wei": U128(self.committed_wei),
            "next_nonce": self.next_nonce,
            "sealed_wishes_hash": self.sealed_wishes_hash,
            "wishes_app_key": self.wishes_app_key,
            "derivation_path": DERIVATION_PATH,
            "wishes_path": WISHES_PATH,
            "heirs": self.heirs,
            "payouts": self.payouts,
            "signers": self.signers,
            "false_revert_proven": self.false_revert_proven,
            "wishes_released": self.wishes_released,
            "witnesses": self.witnesses.iter().map(|k| eth::hex(k)).collect::<Vec<_>>(),
            "witness_threshold": self.witness_threshold,
            "registrar": eth::hex(&self.registrar),
            "recovery_key": eth::hex(&self.recovery_key),
            "abandon_secs": self.abandon_secs,
        })
    }
}

impl Vault {
    fn assert_not_frozen(&self) {
        if let Some(claim) = self.claim.as_ref() {
            require!(now_secs() >= claim.frozen_until, "vault is frozen");
        }
    }

    fn assert_claim_matured(&self) {
        let claim = self.claim.as_ref().unwrap_or_else(|| env::panic_str("no proven claim"));
        self.assert_not_frozen();
        require!(now_secs() >= claim.pay_after, "grace period still running");
    }

    /// I8.
    fn assert_trigger_proven(&self, heir: usize) {
        self.assert_claim_matured();
        let adult = math::adult_time(self.heirs[heir].adult_at, self.heirs[heir].adult_by);
        require!(now_secs() >= adult, "heir is not yet an adult");
        require!(self.heirs[heir].status == HeirStatus::Open, "heir already paid or pending");
        if let Some(at) = self.heirs[heir].reopened_at {
            require!(now_secs() >= math::after(at, REOPEN_DELAY_SECS), "retry waits for the revert to be disputed");
        }
    }

    /// I14. Returns `(request_hash, response_hash)`.
    fn verify_decision(&self, heir_index: u32, value_wei: u128, proof: &DecisionProof) -> (String, String) {
        require!(proof.response_body.len() <= MAX_RESPONSE_BYTES, "response too large");
        let parts: Vec<&str> = proof.signed_text.split(':').collect();
        require!(parts.len() == 2 || parts.len() == 3, "malformed signed text");
        let request_hash = parts[parts.len() - 2].to_string();
        let response_hash = parts[parts.len() - 1].to_string();
        require!(
            eth::hex(&env::sha256(proof.response_body.as_bytes())) == response_hash,
            "response body does not match the signed hash"
        );

        let digits = proof.signature.strip_prefix("0x").unwrap_or(&proof.signature);
        let bytes = eth::parse_hex(digits).filter(|b| b.len() == 65).unwrap_or_else(|| env::panic_str("malformed decision signature"));
        let recovery = match bytes[64] {
            27 | 28 => bytes[64] - 27,
            0 | 1 => bytes[64],
            _ => env::panic_str("malformed decision signature"),
        };
        let digest = env::keccak256_array(&eth::personal_message(&proof.signed_text));
        let recovered = env::ecrecover(&digest, &sig64(&bytes[..64]), recovery, true)
            .unwrap_or_else(|| env::panic_str("decision signature does not recover"));
        let address = format!("0x{}", eth::hex(&env::keccak256_array(&recovered)[12..]));
        let now = now_secs();
        require!(
            self.signers.iter().any(|s| s.address == address && s.expires_at > now),
            "decision not signed by a registered attested key"
        );

        let body: Value = serde_json::from_str(&proof.response_body).unwrap_or_else(|_| env::panic_str("response is not JSON"));
        let content = body["choices"][0]["message"]["content"]
            .as_str()
            .unwrap_or_else(|| env::panic_str("response has no message content"));
        // Outside review F10: the whole message is the decision, not any braces inside prose.
        let decision: Decision = serde_json::from_str(content.trim()).unwrap_or_else(|_| env::panic_str("decision is not a JSON object"));
        require!(decision.action == "pay", "decision is not a payment");
        require!(decision.vault == env::current_account_id().as_str(), "decision is for another vault");
        require!(decision.heir_index == heir_index, "decision names another heir");
        require!(decision.value_wei == value_wei.to_string(), "decision names another amount");
        (request_hash, response_hash)
    }

    fn create_payout(
        &mut self,
        index: usize,
        value: u128,
        source: &str,
        request_hash: Option<String>,
        response_hash: Option<String>,
    ) -> Promise {
        let heir = &self.heirs[index];
        let reserve = math::reserve(value, heir.gas_limit, self.max_fee_ceiling);
        require!(math::fits_budget(self.committed_wei, reserve, self.budget_wei), "budget exhausted");
        self.committed_wei += reserve;
        let payout = Payout {
            heir_index: index as u32,
            to: heir.address.clone(),
            value_wei: U128(value),
            gas_limit: heir.gas_limit,
            nonce: self.next_nonce,
            created_at: now_secs(),
            source: source.to_string(),
            request_hash,
            response_hash,
            signing: false,
            signing_since: 0,
            status: PayoutStatus::Active,
            settled_attempt: None,
            attempts: vec![],
        };
        self.next_nonce += 1;
        self.heirs[index].status = HeirStatus::Pending;
        self.payouts.push(payout);
        self.begin_attempt(self.payouts.len() - 1, self.initial_max_fee_per_gas)
    }

    fn store_signature(&mut self, payout: usize, attempt: usize, tx: &eth::Transfer, r: [u8; 32], s: [u8; 32], y_parity: u8) {
        let a = &mut self.payouts[payout].attempts[attempt];
        a.r_hex = Some(eth::hex(&r));
        a.s_hex = Some(eth::hex(&s));
        a.y_parity = Some(y_parity);
        a.tx_hash_hex = Some(eth::hex(&eth::signed_tx_hash(tx, y_parity, &r, &s)));
    }

    fn transfer(&self, payout: usize, attempt: usize) -> eth::Transfer {
        let p = &self.payouts[payout];
        let a = &p.attempts[attempt];
        eth::Transfer {
            chain_id: self.chain_id,
            nonce: p.nonce,
            max_priority_fee_per_gas: a.max_priority_fee_per_gas.0,
            max_fee_per_gas: a.max_fee_per_gas.0,
            gas_limit: p.gas_limit,
            to: eth::parse_address(&p.to).unwrap(),
            value: p.value_wei.0,
        }
    }

    fn begin_attempt(&mut self, payout: usize, max_fee: u128) -> Promise {
        // The tip rises with the fee cap, so a re-priced attempt is a valid mempool replacement
        // (geth and reth require both to rise; local stack, finding 4).
        let priority = math::tip(max_fee, self.initial_max_fee_per_gas, self.max_priority_fee_per_gas);
        self.payouts[payout].attempts.push(Attempt {
            max_fee_per_gas: U128(max_fee),
            max_priority_fee_per_gas: U128(priority),
            payload_hex: String::new(),
            r_hex: None,
            s_hex: None,
            y_parity: None,
            tx_hash_hex: None,
        });
        let attempt = self.payouts[payout].attempts.len() - 1;
        let payload_hex = eth::hex(&eth::eip1559_hash(&self.transfer(payout, attempt)));
        self.payouts[payout].attempts[attempt].payload_hex = payload_hex.clone();
        self.payouts[payout].signing = true;
        let requested_at = now_secs();
        self.payouts[payout].signing_since = requested_at;

        let args = json!({
            "request": { "path": DERIVATION_PATH, "payload_v2": { "Ecdsa": payload_hex }, "domain_id": SIGN_DOMAIN }
        });
        Promise::new(self.signer_contract.clone())
            .function_call_weight("sign".to_string(), serde_json::to_vec(&args).unwrap(), forwarded_deposit(), SIGN_GAS, GasWeight(1))
            .then(self.callback(
                "on_signed",
                json!({ "payout_index": payout, "attempt_index": attempt, "requested_at": requested_at }),
            ))
    }

    /// D2, D11: callbacks get at least CALLBACK_GAS plus a share of whatever the caller attached.
    fn callback(&self, method: &str, args: Value) -> Promise {
        Promise::new(env::current_account_id()).function_call_weight(
            method.to_string(),
            serde_json::to_vec(&args).unwrap(),
            NearToken::from_yoctonear(0),
            CALLBACK_GAS,
            GasWeight(1),
        )
    }

    fn expected_payload_hash(&self, tx_hash: &str) -> [u8; 32] {
        let id = fixed32(tx_hash).unwrap_or_else(|| env::panic_str("invalid transaction hash"));
        env::sha256_array(&eth::foreign_payload(&id))
    }
}

#[cfg(test)]
#[allow(unused_must_use)]
mod tests;
#[cfg(test)]
#[allow(unused_must_use)]
mod proptests;
#[cfg(test)]
#[allow(unused_must_use)]
mod test_support;
#[cfg(test)]
#[allow(unused_must_use)]
mod itf_replay;
#[cfg(test)]
#[allow(unused_must_use)]
mod counterexamples;
#[cfg(test)]
#[allow(unused_must_use)]
mod outside_review;
