#![no_main]
use alloy_rlp::{Decodable, Header};
use ghost_protocol::eth;
use libfuzzer_sys::fuzz_target;

fuzz_target!(|d: (u64, u64, u128, u128, u64, [u8; 20], u128, u8, [u8; 32], [u8; 32])| {
    let (chain_id, nonce, tip, fee, gas_limit, to, value, y, r, s) = d;
    let tx = eth::Transfer { chain_id, nonce, max_priority_fee_per_gas: tip, max_fee_per_gas: fee, gas_limit, to, value };
    let y = y & 1;
    let encoded = eth::eip1559_signed(&tx, y, &r, &s);
    assert_eq!(encoded[0], 2);
    let mut body = &encoded[1..];
    let header = Header::decode(&mut body).unwrap();
    assert!(header.list);
    assert_eq!(header.payload_length, body.len());
    assert_eq!(u64::decode(&mut body).unwrap(), chain_id);
    assert_eq!(u64::decode(&mut body).unwrap(), nonce);
    assert_eq!(u128::decode(&mut body).unwrap(), tip);
    assert_eq!(u128::decode(&mut body).unwrap(), fee);
    assert_eq!(u64::decode(&mut body).unwrap(), gas_limit);
    let address: [u8; 20] = Decodable::decode(&mut body).unwrap();
    assert_eq!(address, to);
    assert_eq!(u128::decode(&mut body).unwrap(), value);
});
