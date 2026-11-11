#!/bin/zsh
# Waits for the vault to be funded, broadcasts payout 0, then settles it once Base Sepolia finalizes.
cd "$(dirname "$0")/.."
ADDR=0xAf8105c7e876f38Bf0A9f09e4c97029BCf74d0Cc
RPC=https://base-sepolia-rpc.publicnode.com
bal() { curl -s $RPC -H 'content-type: application/json' -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"eth_getBalance\",\"params\":[\"$ADDR\",\"latest\"]}" | python3 -c "import sys,json;print(int(json.load(sys.stdin)['result'],16))"; }
until [ "$(bal)" -ge 1004200000000000 ]; do sleep 30; done
echo "funded: $(bal) wei"
npm run -s ghost -- broadcast 0 || exit 1
for i in $(seq 1 30); do
  sleep 300
  npm run -s ghost -- settle 0 2>&1 | grep -E 'settle tx|panicked'
  st=$(npm run -s ghost -- status | python3 -c "import sys,json;print(json.load(sys.stdin)['heirs'][0]['status'])")
  echo "attempt $i: heir $st"
  [ "$st" = "Paid" ] && exit 0
done
exit 1
