#!/bin/zsh
# Exhaustive TLC check of ghost.qnt with the trace variables off.
#   check.sh <invariant> [quint verify args]           full constants
#   SMALL=1 check.sh <invariant> [quint verify args]   small constants (docs/evidence/spec/README.md)
#   TINY=1 check.sh ...                                 small constants, one heir, one claim
set -e
cd "$(dirname "$0")"
export PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH
mkdir -p _check/tmp
# TLC spills its queue to the temp dir; keep it here so a run can be cleaned up.
export TMPDIR=$PWD/_check/tmp
sed 's/pure val TRACE = true/pure val TRACE = false/' ghost.qnt > _check/ghost.qnt
if [ -n "$TINY" ]; then
  # One heir, one claim: its payout and its one retry still share the nonce sequence.
  sed -i '' -e 's/pure val NUM_HEIRS = 2/pure val NUM_HEIRS = 1/' -e 's/pure val MAX_EPOCH = 1/pure val MAX_EPOCH = 0/' _check/ghost.qnt
  SMALL=1
fi
if [ -n "$SMALL" ]; then
  sed -i '' -e 's/pure val INACTIVITY = 2/pure val INACTIVITY = 1/' \
    -e 's/pure val MAX_TIME = 12/pure val MAX_TIME = 9/' \
    -e 's/pure val ADULT_BY: int -> int = Map(0 -> 0, 1 -> 4)/pure val ADULT_BY: int -> int = Map(0 -> 0, 1 -> 2)/' _check/ghost.qnt
fi
cd _check
quint verify ghost.qnt --backend=tlc --invariant "$1" "${@:2}"
