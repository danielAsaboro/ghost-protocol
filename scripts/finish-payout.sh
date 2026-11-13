#!/bin/zsh
# Waits for the vault to be funded, broadcasts payout 0, then settles it once Base Sepolia finalizes.
cd "$(dirname "$0")/.."
ADDR=0xAf8105c7e876f38Bf0A9f09e4c97029BCf74d0Cc
RPC=https://base-sepolia-rpc.publicnode.com
bal() { curl -s $RPC -H 'content-type: application/json' -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"eth_getBalance\",\"params\":[\"$ADDR\",\"latest\"]}" | python3 -c "import sys,json;print(int(json.load(sys.stdin)['result'],16))"; }
until [ "$(bal 2>/dev/null || echo 0)" -ge 1004200000000000 ] 2>/dev/null; do sleep 30; done
echo "funded: $(bal) wei"
npm run -s ghost -- broadcast 0 || echo 'broadcast refused (already landed?), settling anyway'
for i in $(seq 1 30); do
  sleep 180
  npm run -s ghost -- settle 0 2>&1 | grep -E 'SETTLED|NOT SETTLED|settle tx|panicked'
  st=$(curl -s https://rpc.testnet.near.org -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"call_function","finality":"final","account_id":"ghostprotocol-vault.testnet","method_name":"get_state","args_base64":"e30="}}' | python3 -c "import sys,json;r=json.load(sys.stdin)['result'];print(json.loads(bytes(r['result']))['heirs'][0]['status'])" 2>/dev/null)
  echo "attempt $i: heir $st"
  [ "$st" = "Paid" ] && exit 0
done
exit 1
