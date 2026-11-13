#!/bin/zsh
# Writes model traces for contract/src/itf_replay.rs. Seeds are fixed so the set is reproducible.
set -e
cd "$(dirname "$0")"
rm -rf traces && mkdir traces
quint run ghost.qnt --step stepLive --max-samples 400 --n-traces 400 --max-steps 40 --seed 0x6a057 \
  --out-itf 'traces/live_{seq}.itf.json' > /dev/null
quint run ghost.qnt --step step --max-samples 200 --n-traces 200 --max-steps 40 --seed 0xdeb5 \
  --out-itf 'traces/deps_{seq}.itf.json' > /dev/null
ls traces | wc -l
