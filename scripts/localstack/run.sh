#!/usr/bin/env bash
# One command: real MPC nodes + anvil, the whole payout lifecycle on the vault, a PASS/FAIL table,
# then tear down. Nothing is mocked; nothing touches a public network.
#   npm run local                 uses the reproducible v3 wasm (built if missing)
#   npm run local -- path.wasm    any vault wasm
set -euo pipefail
cd "$(dirname "$0")/../.."
WASM="${1:-$HOME/development/near-hackathon-research/ghost-v3-final.wasm}"
if [[ ! -f "$WASM" ]]; then
  (cd contract && cargo near build reproducible-wasm)
  WASM=contract/target/near/ghost_protocol.wasm
fi
RUN="lifecycle-$(date +%Y%m%d-%H%M%S)"
echo "vault wasm: $WASM ($(python3 scripts/codehash.py "$WASM"))"
trap 'scripts/localstack/down.sh >/dev/null 2>&1 || true' EXIT
scripts/localstack/up.sh
VAULT_PAYABLE=1 PRIORITY_WEI=100000000 node scripts/localstack/lifecycle.mjs "$WASM" "$RUN" A,B
node scripts/localstack/summary.mjs "docs/evidence/localstack/$RUN"
