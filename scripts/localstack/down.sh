#!/usr/bin/env bash
# Stops every process up.sh started. `--wipe` also deletes the chain data (logs and state.json stay).
set -uo pipefail
R="${LOCALSTACK_DIR:-$HOME/development/near-hackathon-research/localstack-run}"
[[ -d "$R/pids" ]] || exit 0
for f in "$R"/pids/*.pid; do
  [[ -f "$f" ]] || continue
  pid=$(cat "$f")
  if kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null
    for _ in 1 2 3 4 5 6 7 8 9 10; do kill -0 "$pid" 2>/dev/null || break; sleep 1; done
    kill -9 "$pid" 2>/dev/null || true
    echo "stopped $(basename "$f" .pid) ($pid)"
  fi
  rm -f "$f"
done
if [[ "${1:-}" == "--wipe" ]]; then
  rm -rf "$R/near" "$R"/mpc-node-*
  echo "wiped chain data under $R"
fi
