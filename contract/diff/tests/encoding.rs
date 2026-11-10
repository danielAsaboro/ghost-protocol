//! Independent implementations must agree with the contract's hand-written encoders.

use alloy_consensus::{SignableTransaction, TxEip1559, transaction::TxEnvelope};
use alloy_eips::eip2930::AccessList;
use alloy_primitives::{Address, Bytes, Signature, TxKind, U256};
use ghost_protocol::eth;
use near_mpc_contract_interface::types as mpc;
use proptest::prelude::*;

fn alloy_tx(t: &eth::Transfer) -> TxEip1559 {
    TxEip1559 {
        chain_id: t.chain_id,
        nonce: t.nonce,
        gas_limit: t.gas_limit,
        max_fee_per_gas: t.max_fee_per_gas,
        max_priority_fee_per_gas: t.max_priority_fee_per_gas,
        to: TxKind::Call(Address::from(t.to)),
        value: U256::from(t.value),
        access_list: AccessList::default(),
        input: Bytes::new(),
    }
}

prop_compose! {
    fn transfer()(
        chain_id in prop_oneof![Just(84_532u64), any::<u64>()],
        nonce in prop_oneof![Just(0u64), 0u64..300, any::<u64>()],
        priority in prop_oneof![Just(0u128), any::<u128>()],
        fee in any::<u128>(),
        gas_limit in any::<u64>(),
        to in any::<[u8; 20]>(),
        value in prop_oneof![Just(0u128), 1u128..200, any::<u128>()],
    ) -> eth::Transfer {
        eth::Transfer { chain_id, nonce, max_priority_fee_per_gas: priority, max_fee_per_gas: fee, gas_limit, to, value }
    }
}

proptest! {
    #![proptest_config(ProptestConfig { cases: 5_000, failure_persistence: None, ..Default::default() })]

    #[test]
    fn preimage_matches_alloy(t in transfer()) {
        let mut expected = Vec::new();
        alloy_tx(&t).encode_for_signing(&mut expected);
        prop_assert_eq!(eth::eip1559_preimage(&t), expected);
    }

    #[test]
    fn signed_encoding_matches_alloy(
        t in transfer(), y in any::<bool>(),
        r in prop_oneof![any::<[u8; 32]>(), Just([0u8; 32]), any::<[u8; 31]>().prop_map(|b| { let mut o=[0u8;32]; o[1..].copy_from_slice(&b); o })],
        s in any::<[u8; 32]>(),
    ) {
        let sig = Signature::new(U256::from_be_bytes(r), U256::from_be_bytes(s), y);
        let envelope = TxEnvelope::Eip1559(alloy_tx(&t).into_signed(sig));
        let mut expected = Vec::new();
        alloy_eips::eip2718::Encodable2718::encode_2718(&envelope, &mut expected);
        prop_assert_eq!(eth::eip1559_signed(&t, y as u8, &r, &s), expected);
    }

    #[test]
    fn foreign_payload_matches_near_mpc(id in any::<[u8; 32]>()) {
        let request = mpc::ForeignChainRpcRequest::Base(mpc::EvmRpcRequest {
            tx_id: mpc::EvmTxId(id),
            extractors: vec![].try_into().unwrap(),
            finality: mpc::EvmFinality::Finalized,
        });
        let payload = mpc::ForeignTxSignPayload::V1(mpc::ForeignTxSignPayloadV1 { request, values: vec![] });
        prop_assert_eq!(eth::foreign_payload(&id), borsh::to_vec(&payload).unwrap());
    }
}

#[test]
fn verify_args_parse_as_near_mpc_types() {
    let tx = "ab".repeat(32);
    let args = serde_json::json!({
        "request": { "Base": { "tx_id": tx, "extractors": [], "finality": "Finalized" } },
        "domain_id": 3,
        "payload_version": 1,
        "expected_payload_hash": "cd".repeat(32),
    });
    let parsed: mpc::VerifyForeignTransactionRequestArgs = serde_json::from_value(args).unwrap();
    assert!(matches!(parsed.request, mpc::ForeignChainRpcRequest::Base(_)));
    assert_eq!(parsed.expected_payload_hash.unwrap().0, [0xcd; 32]);
}

#[test]
fn verify_response_has_the_shape_the_contract_reads() {
    let response = serde_json::json!({
        "payload_hash": "cd".repeat(32),
        "signature": {
            "scheme": "Secp256k1",
            "big_r": { "affine_point": format!("02{}", "11".repeat(32)) },
            "s": { "scalar": "22".repeat(32) },
            "recovery_id": 1,
        }
    });
    let parsed: mpc::VerifyForeignTransactionResponse = serde_json::from_value(response.clone()).unwrap();
    assert_eq!(serde_json::to_value(&parsed).unwrap(), response);
}

#[test]
fn viem_vectors_agree() {
    let raw = include_str!("../../testdata/viem_vectors.json");
    let vectors: serde_json::Value = serde_json::from_str(raw).unwrap();
    let list = vectors.as_array().unwrap();
    assert!(list.len() >= 1_000);
    for v in list {
        let to: [u8; 20] = eth::parse_hex(v["to"].as_str().unwrap()).unwrap().try_into().unwrap();
        let t = eth::Transfer {
            chain_id: v["chainId"].as_str().unwrap().parse().unwrap(),
            nonce: v["nonce"].as_str().unwrap().parse().unwrap(),
            max_priority_fee_per_gas: v["priority"].as_str().unwrap().parse().unwrap(),
            max_fee_per_gas: v["fee"].as_str().unwrap().parse().unwrap(),
            gas_limit: v["gas"].as_str().unwrap().parse().unwrap(),
            to,
            value: v["value"].as_str().unwrap().parse().unwrap(),
        };
        let r: [u8; 32] = eth::parse_hex(v["r"].as_str().unwrap()).unwrap().try_into().unwrap();
        let s: [u8; 32] = eth::parse_hex(v["s"].as_str().unwrap()).unwrap().try_into().unwrap();
        let y = v["y"].as_u64().unwrap() as u8;
        assert_eq!(eth::hex(&eth::eip1559_preimage(&t)), v["preimage"].as_str().unwrap());
        assert_eq!(eth::hex(&eth::eip1559_signed(&t, y, &r, &s)), v["signed"].as_str().unwrap());
    }
}

#[test]
fn noble_hash_to_curve_matches_blstrs_as_used_by_near_mpc() {
    let v: serde_json::Value = serde_json::from_str(include_str!("../../testdata/ckd_vector.json")).unwrap();
    let input = [hex::decode(v["mpk"].as_str().unwrap()).unwrap(), hex::decode(v["app_id"].as_str().unwrap()).unwrap()].concat();
    let point = blstrs::G1Projective::hash_to_curve(&input, b"NEAR BLS12381G1_XMD:SHA-256_SSWU_RO_", &[]);
    assert_eq!(hex::encode(point.to_uncompressed()), v["point"].as_str().unwrap());
}
