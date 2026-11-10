#![no_main]
use ghost_protocol::eth;
use libfuzzer_sys::fuzz_target;

fuzz_target!(|text: &str| {
    if let Some(bytes) = eth::parse_hex(text) {
        assert_eq!(eth::hex(&bytes), text.to_lowercase());
    }
    if let Some(address) = eth::parse_address(text) {
        assert_eq!(format!("0x{}", eth::hex(&address)), text.to_lowercase());
    }
});
