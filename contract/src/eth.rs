//! EIP-1559 encoding for plain transfers, and the NEAR MPC foreign-transaction payload.
//! Everything except the two hash wrappers is pure, so it can be fuzzed and diffed.

use near_sdk::env;

#[derive(Clone, Debug)]
pub struct Transfer {
    pub chain_id: u64,
    pub nonce: u64,
    pub max_priority_fee_per_gas: u128,
    pub max_fee_per_gas: u128,
    pub gas_limit: u64,
    pub to: [u8; 20],
    pub value: u128,
}

pub fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Strict lowercase-or-uppercase hex with no prefix. `None` on any malformed input.
pub fn parse_hex(digits: &str) -> Option<Vec<u8>> {
    if digits.len() % 2 != 0 || !digits.is_ascii() {
        return None;
    }
    let bytes = digits.as_bytes();
    bytes
        .chunks(2)
        .map(|pair| {
            let high = (pair[0] as char).to_digit(16)?;
            let low = (pair[1] as char).to_digit(16)?;
            Some((high * 16 + low) as u8)
        })
        .collect()
}

pub fn parse_address(address: &str) -> Option<[u8; 20]> {
    let digits = address.strip_prefix("0x")?;
    if digits.len() != 40 {
        return None;
    }
    parse_hex(digits)?.try_into().ok()
}

fn length_prefix(len: usize, offset: u8) -> Vec<u8> {
    if len < 56 {
        return vec![offset + len as u8];
    }
    let bytes = len.to_be_bytes();
    let first = bytes.iter().position(|b| *b != 0).unwrap();
    let mut out = vec![offset + 55 + (bytes.len() - first) as u8];
    out.extend_from_slice(&bytes[first..]);
    out
}

fn rlp_bytes(bytes: &[u8]) -> Vec<u8> {
    if bytes.len() == 1 && bytes[0] < 0x80 {
        return bytes.to_vec();
    }
    let mut out = length_prefix(bytes.len(), 0x80);
    out.extend_from_slice(bytes);
    out
}

/// Encodes a big-endian integer of any width without leading zeros.
fn rlp_be(bytes: &[u8]) -> Vec<u8> {
    let first = bytes.iter().position(|b| *b != 0).unwrap_or(bytes.len());
    rlp_bytes(&bytes[first..])
}

fn rlp_uint(value: u128) -> Vec<u8> {
    rlp_be(&value.to_be_bytes())
}

fn rlp_list(items: &[Vec<u8>]) -> Vec<u8> {
    let body: Vec<u8> = items.concat();
    let mut out = length_prefix(body.len(), 0xc0);
    out.extend(body);
    out
}

fn fields(tx: &Transfer) -> Vec<Vec<u8>> {
    vec![
        rlp_uint(tx.chain_id as u128),
        rlp_uint(tx.nonce as u128),
        rlp_uint(tx.max_priority_fee_per_gas),
        rlp_uint(tx.max_fee_per_gas),
        rlp_uint(tx.gas_limit as u128),
        rlp_bytes(&tx.to),
        rlp_uint(tx.value),
        rlp_bytes(&[]),
        rlp_list(&[]),
    ]
}

fn typed(items: &[Vec<u8>]) -> Vec<u8> {
    let mut out = vec![0x02];
    out.extend(rlp_list(items));
    out
}

pub fn eip1559_preimage(tx: &Transfer) -> Vec<u8> {
    typed(&fields(tx))
}

pub fn eip1559_signed(tx: &Transfer, y_parity: u8, r: &[u8; 32], s: &[u8; 32]) -> Vec<u8> {
    let mut items = fields(tx);
    items.push(rlp_uint(y_parity as u128));
    items.push(rlp_be(r));
    items.push(rlp_be(s));
    typed(&items)
}

pub fn eip1559_hash(tx: &Transfer) -> [u8; 32] {
    env::keccak256_array(&eip1559_preimage(tx))
}

pub fn signed_tx_hash(tx: &Transfer, y_parity: u8, r: &[u8; 32], s: &[u8; 32]) -> [u8; 32] {
    env::keccak256_array(&eip1559_signed(tx, y_parity, r, s))
}

/// `ForeignChainRpcRequest::Base` index at near/mpc tag 3.18.0.
const BASE_VARIANT: u8 = 6;
/// `EvmFinality::Finalized` index at near/mpc tag 3.18.0.
const FINALIZED_VARIANT: u8 = 2;

/// Borsh of `ForeignTxSignPayload::V1 { request: Base { tx_id, extractors: [], Finalized }, values: [] }`.
pub fn foreign_payload(tx_id: &[u8; 32]) -> Vec<u8> {
    let mut out = vec![0u8, BASE_VARIANT];
    out.extend_from_slice(tx_id);
    out.extend_from_slice(&0u32.to_le_bytes());
    out.push(FINALIZED_VARIANT);
    out.extend_from_slice(&0u32.to_le_bytes());
    out
}

/// Bytes EIP-191 `personal_sign` hashes for an ASCII message.
pub fn personal_message(text: &str) -> Vec<u8> {
    let mut out = format!("\x19Ethereum Signed Message:\n{}", text.len()).into_bytes();
    out.extend_from_slice(text.as_bytes());
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rlp_length_boundary_is_exact() {
        assert_eq!(rlp_bytes(&[0x7f]), vec![0x7f]);
        assert_eq!(rlp_bytes(&[0x80]), vec![0x81, 0x80]);
        assert_eq!(rlp_bytes(&[1u8; 55])[0], 0x80 + 55);
        assert_eq!(rlp_bytes(&[1u8; 56])[..2], [0x80 + 56, 56]);
        assert_eq!(rlp_list(&[vec![1u8; 55]])[0], 0xc0 + 55);
        assert_eq!(rlp_list(&[vec![1u8; 56]])[..2], [0xc0 + 56, 56]);
        assert_eq!(rlp_bytes(&[1u8; 256])[..3], [0x80 + 57, 1, 0]);
    }

    #[test]
    fn hex_parser_rejects_bad_input() {
        assert_eq!(parse_hex("0a"), Some(vec![10]));
        assert_eq!(parse_hex("0"), None);
        assert_eq!(parse_hex("zz"), None);
        assert_eq!(parse_hex("\u{e9}a"), None);
        assert_eq!(parse_address("0x00"), None);
        assert!(parse_address("0x00000000000000000000000000000000000000aa").is_some());
        assert_eq!(parse_address("00000000000000000000000000000000000000aa"), None);
    }

    #[test]
    fn foreign_payload_bytes_are_pinned() {
        let payload = foreign_payload(&[7u8; 32]);
        let mut expected = vec![0, 6];
        expected.extend([7u8; 32]);
        expected.extend([0, 0, 0, 0, 2, 0, 0, 0, 0]);
        assert_eq!(payload, expected);
    }

    #[test]
    fn personal_message_format_is_eip191() {
        assert_eq!(personal_message("hi"), b"\x19Ethereum Signed Message:\n2hi".to_vec());
    }

    #[test]
    fn encoders_match_viem_vectors() {
        use near_sdk::serde_json::{from_str, Value};
        let vectors: Vec<Value> = from_str(include_str!("../testdata/viem_vectors.json")).unwrap();
        for v in vectors.iter().take(300) {
            let tx = Transfer {
                chain_id: v["chainId"].as_str().unwrap().parse().unwrap(),
                nonce: v["nonce"].as_str().unwrap().parse().unwrap(),
                max_priority_fee_per_gas: v["priority"].as_str().unwrap().parse().unwrap(),
                max_fee_per_gas: v["fee"].as_str().unwrap().parse().unwrap(),
                gas_limit: v["gas"].as_str().unwrap().parse().unwrap(),
                to: parse_hex(v["to"].as_str().unwrap()).unwrap().try_into().unwrap(),
                value: v["value"].as_str().unwrap().parse().unwrap(),
            };
            let r: [u8; 32] = parse_hex(v["r"].as_str().unwrap()).unwrap().try_into().unwrap();
            let s: [u8; 32] = parse_hex(v["s"].as_str().unwrap()).unwrap().try_into().unwrap();
            let y = v["y"].as_u64().unwrap() as u8;
            assert_eq!(hex(&eip1559_preimage(&tx)), v["preimage"].as_str().unwrap());
            assert_eq!(hex(&eip1559_signed(&tx, y, &r, &s)), v["signed"].as_str().unwrap());
        }
    }
}

#[cfg(kani)]
mod proofs {
    //! Bounded proofs. `cargo kani --features kani-proofs` from `contract/`.
    use super::*;

    /// Reads one RLP item header at `pos`. Returns `(payload_start, payload_len, is_list)`.
    /// Rejects non-canonical headers, so a pass also proves the encoder is canonical.
    fn header(buf: &[u8], pos: usize) -> (usize, usize, bool) {
        let b = buf[pos];
        match b {
            0x00..=0x7f => (pos, 1, false),
            0x80..=0xb7 => {
                let len = (b - 0x80) as usize;
                if len == 1 {
                    assert!(buf[pos + 1] >= 0x80, "single byte below 0x80 must encode as itself");
                }
                (pos + 1, len, false)
            }
            0xb8..=0xbf | 0xf8..=0xff => {
                let n = (b - if b >= 0xf8 { 0xf7 } else { 0xb7 }) as usize;
                assert!(buf[pos + 1] != 0, "length of length has a leading zero");
                let mut len = 0usize;
                for k in 0..n {
                    len = (len << 8) | buf[pos + 1 + k] as usize;
                }
                assert!(len >= 56, "long form used for a short payload");
                (pos + 1 + n, len, b >= 0xf8)
            }
            _ => ((pos + 1), (b - 0xc0) as usize, true),
        }
    }

    /// Decodes a canonical RLP unsigned integer item and returns `(value, next_pos)`.
    fn uint_at(buf: &[u8], pos: usize) -> (u128, usize) {
        let (start, len, list) = header(buf, pos);
        assert!(!list && len <= 16);
        if len > 0 && start != pos {
            assert!(buf[start] != 0, "integer has a leading zero");
        }
        let mut v = 0u128;
        for k in 0..len {
            v = (v << 8) | buf[start + k] as u128;
        }
        (v, start + len)
    }

    fn any_transfer() -> Transfer {
        Transfer {
            chain_id: kani::any(),
            nonce: kani::any(),
            max_priority_fee_per_gas: kani::any(),
            max_fee_per_gas: kani::any(),
            gas_limit: kani::any(),
            to: kani::any(),
            value: kani::any(),
        }
    }

    /// Walks the nine EIP-1559 fields and checks each against the transfer. Returns the next position.
    fn check_fields(buf: &[u8], mut pos: usize, tx: &Transfer) -> usize {
        let expect = [tx.chain_id as u128, tx.nonce as u128, tx.max_priority_fee_per_gas, tx.max_fee_per_gas, tx.gas_limit as u128];
        for want in expect {
            let (v, next) = uint_at(buf, pos);
            assert!(v == want);
            pos = next;
        }
        let (start, len, list) = header(buf, pos);
        assert!(!list && len == 20 && start == pos + 1);
        for k in 0..20 {
            assert!(buf[start + k] == tx.to[k]);
        }
        pos = start + 20;
        let (v, next) = uint_at(buf, pos);
        assert!(v == tx.value);
        pos = next;
        assert!(buf[pos] == 0x80, "data is the empty string");
        assert!(buf[pos + 1] == 0xc0, "access list is the empty list");
        pos + 2
    }

    #[kani::proof]
    #[kani::unwind(20)]
    fn rlp_uint_is_canonical_and_exact() {
        let v: u128 = kani::any();
        let out = rlp_uint(v);
        let (decoded, end) = uint_at(&out, 0);
        assert!(decoded == v && end == out.len());
        if v == 0 {
            assert!(out == [0x80]);
        }
    }

    #[kani::proof]
    #[kani::unwind(10)]
    fn length_prefix_round_trips() {
        let len: usize = kani::any();
        kani::assume(len <= u32::MAX as usize);
        let list: bool = kani::any();
        let mut buf = length_prefix(len, if list { 0xc0 } else { 0x80 });
        let hdr = buf.len();
        buf.push(0x80); // a payload byte so the single-byte rule has something to read
        let (start, decoded, is_list) = header(&buf, 0);
        assert!(start == hdr && decoded == len && is_list == list);
        assert!(hdr == if len < 56 { 1 } else { 1 + (usize::BITS as usize / 8 - len.leading_zeros() as usize / 8) });
    }

    #[kani::proof]
    #[kani::unwind(130)]
    #[kani::solver(kissat)]
    fn eip1559_preimage_decodes_to_the_transfer() {
        let tx = any_transfer();
        let out = eip1559_preimage(&tx);
        assert!(out[0] == 0x02, "typed transaction 2");
        let (start, len, list) = header(&out, 1);
        assert!(list && start + len == out.len(), "list length covers exactly the body");
        assert!(check_fields(&out, start, &tx) == out.len());
    }

    #[kani::proof]
    #[kani::unwind(200)]
    #[kani::solver(kissat)]
    fn eip1559_signed_decodes_to_the_transfer_and_signature() {
        let tx = any_transfer();
        let y: u8 = kani::any();
        kani::assume(y <= 1);
        let r: [u8; 32] = kani::any();
        let s: [u8; 32] = kani::any();
        let out = eip1559_signed(&tx, y, &r, &s);
        assert!(out[0] == 0x02);
        let (start, len, list) = header(&out, 1);
        assert!(list && start + len == out.len());
        let mut pos = check_fields(&out, start, &tx);
        let (v, next) = uint_at(&out, pos);
        assert!(v == y as u128);
        pos = next;
        for word in [r, s] {
            let (st, l, list) = header(&out, pos);
            assert!(!list && l <= 32);
            // Big-endian without leading zeros: the trailing `l` bytes are the payload.
            for k in 0..32 {
                if k < 32 - l {
                    assert!(word[k] == 0);
                } else {
                    assert!(out[st + k - (32 - l)] == word[k]);
                }
            }
            pos = st + l;
        }
        assert!(pos == out.len());
    }

    #[kani::proof]
    fn foreign_payload_is_fixed_layout() {
        let id: [u8; 32] = kani::any();
        let out = foreign_payload(&id);
        assert!(out.len() == 43 && out[0] == 0 && out[1] == BASE_VARIANT && out[38] == FINALIZED_VARIANT);
        assert!(out[2..34] == id);
        assert!(out[34..38] == [0; 4] && out[39..43] == [0; 4]);
    }

    #[kani::proof]
    #[kani::unwind(10)]
    fn parse_hex_never_panics_and_is_exact() {
        let bytes: [u8; 8] = kani::any();
        let n: usize = kani::any();
        kani::assume(n <= 8);
        let Ok(text) = core::str::from_utf8(&bytes[..n]) else { return };
        if let Some(out) = parse_hex(text) {
            assert!(out.len() * 2 == n);
            for (k, b) in out.iter().enumerate() {
                let hi = (bytes[2 * k] as char).to_digit(16).unwrap();
                let lo = (bytes[2 * k + 1] as char).to_digit(16).unwrap();
                assert!(*b as u32 == hi * 16 + lo);
            }
        } else {
            assert!(n % 2 == 1 || bytes[..n].chunks(2).any(|p| !(p[0] as char).is_ascii_hexdigit() || !(p[1] as char).is_ascii_hexdigit()));
        }
    }

    #[kani::proof]
    #[kani::unwind(45)]
    fn parse_address_accepts_exactly_0x_and_40_hex() {
        // ASCII input: any non-ASCII byte makes `parse_hex` return None before reading digits,
        // which `parse_hex_never_panics_and_is_exact` already covers.
        let bytes: [u8; 42] = kani::any();
        kani::assume(bytes.iter().all(|b| b.is_ascii()));
        let text = core::str::from_utf8(&bytes).unwrap();
        let ok = bytes[0] == b'0' && bytes[1] == b'x' && bytes[2..].iter().all(|b| (*b as char).is_ascii_hexdigit());
        assert!(parse_address(text).is_some() == ok);
    }
}
