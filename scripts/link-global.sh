#!/usr/bin/env bash
#
# Link the @nexus-cortex global commands. Self-healing + idempotent.
#
# WHY THIS EXISTS: the cli/tui split moved 7 of the 8 global bins out of
# @nexus-cortex/cli into @nexus-cortex/tui. BOTH packages must be `npm link`ed or
# those 7 commands (cortex-cli, cortex-launch, cortex-dev, neoncortex, fuzzycortex,
# fuzzycortex-cli, fuzzycortex-dev) end up as dangling symlinks → "command not found".
# `cortex` lives in cli; the rest live in tui. Run after build (build.sh calls this).
#
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GBIN="$(npm config get prefix 2>/dev/null)/bin"
CMDS=(cortex cortex-cli cortex-launch cortex-dev neoncortex fuzzycortex fuzzycortex-cli fuzzycortex-dev)

broken=0
for c in "${CMDS[@]}"; do
  t="$(readlink -f "$GBIN/$c" 2>/dev/null)"
  if [ -z "$t" ] || [ ! -e "$t" ]; then broken=1; break; fi
done

if [ "$broken" = 0 ]; then
  echo "[OK] all 8 @nexus-cortex global commands already linked"
  exit 0
fi

echo "[INFO] re-linking @nexus-cortex global commands (cli + tui)..."
# clear stale/dangling links first so `npm link` won't EEXIST
for c in "${CMDS[@]}"; do rm -f "$GBIN/$c"; done
( cd "$ROOT/packages/cli" && npm link >/dev/null 2>&1 ) || { echo "[WARN] npm link @nexus-cortex/cli failed"; }
( cd "$ROOT/packages/tui" && npm link >/dev/null 2>&1 ) || { echo "[WARN] npm link @nexus-cortex/tui failed"; }

# verify
dead=0
for c in "${CMDS[@]}"; do
  t="$(readlink -f "$GBIN/$c" 2>/dev/null)"
  if [ -z "$t" ] || [ ! -e "$t" ]; then echo "[WARN] $c still unlinked"; dead=1; fi
done
[ "$dead" = 0 ] && echo "[OK] linked all 8 @nexus-cortex global commands (cli + tui)"
exit 0
