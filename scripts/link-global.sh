#!/usr/bin/env bash
#
# Link the @nexus-cortex global commands. Self-healing + idempotent.
#
# WHY THIS EXISTS: the cli/tui split moved 7 of the 8 UI bins out of
# @nexus-cortex/cli into @nexus-cortex/tui, and the server ships its own bins
# (cortex-server, cortex-daemon). ALL present packages must be `npm link`ed or
# their commands end up as dangling symlinks → "command not found".
#   cli    → cortex
#   server → cortex-server, cortex-daemon
#   tui    → cortex-cli, cortex-launch, cortex-dev, neoncortex, fuzzycortex,
#            fuzzycortex-cli, fuzzycortex-dev   (dev repo only; not in the export)
#
# SAFETY: a registry install (e.g. a publish rehearsal's `npm install -g
# @nexus-cortex/...`) replaces the link with a REAL package directory whose bins
# still resolve — so a bins-only health check wrongly reports "already linked"
# while every command runs the stale registry copy. This script therefore checks
# that each global PACKAGE DIR is a symlink into THIS repo, and moves anything
# else aside (timestamped backup under the npm prefix) before relinking.
#
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PREFIX="$(npm config get prefix 2>/dev/null)"
GBIN="$PREFIX/bin"
GROOT="$PREFIX/lib/node_modules"

# Packages to link (only those present — the engine-only export has no tui) and
# the commands they own.
PKGS=(cli server)
CMDS=(cortex cortex-server cortex-daemon)
if [ -d "$ROOT/packages/tui" ]; then
  PKGS+=(tui)
  CMDS+=(cortex-cli cortex-launch cortex-dev neoncortex fuzzycortex fuzzycortex-cli fuzzycortex-dev)
fi

# Healthy = every command's symlink resolves AND every package dir is a symlink
# pointing into this repo (not a registry install, not another checkout).
broken=0
for c in "${CMDS[@]}"; do
  t="$(readlink -f "$GBIN/$c" 2>/dev/null)"
  if [ -z "$t" ] || [ ! -e "$t" ]; then broken=1; break; fi
done
if [ "$broken" = 0 ]; then
  for p in "${PKGS[@]}"; do
    d="$GROOT/@nexus-cortex/$p"
    if [ ! -L "$d" ]; then broken=1; break; fi
    real="$(readlink -f "$d" 2>/dev/null)"
    case "$real" in "$ROOT"/*) : ;; *) broken=1; break ;; esac
  done
fi

if [ "$broken" = 0 ]; then
  echo "[OK] all ${#CMDS[@]} @nexus-cortex global commands already linked to this repo"
  exit 0
fi

echo "[INFO] re-linking @nexus-cortex global commands (${PKGS[*]})..."

# Move aside anything occupying a package slot that is NOT a symlink into this
# repo — a real registry install gets BACKED UP (it may hold a version someone
# wants to inspect); a foreign/dangling symlink is just removed.
BACKUP_DIR="$PREFIX/.nexus-cortex-link-backups/$(date +%Y%m%d-%H%M%S)"
for p in "${PKGS[@]}"; do
  d="$GROOT/@nexus-cortex/$p"
  [ -e "$d" ] || [ -L "$d" ] || continue
  if [ -L "$d" ]; then
    real="$(readlink -f "$d" 2>/dev/null)"
    case "$real" in "$ROOT"/*) continue ;; esac   # already ours — npm link will refresh it
    rm -f "$d"                                     # foreign or dangling symlink
  else
    mkdir -p "$BACKUP_DIR"
    mv "$d" "$BACKUP_DIR/$p"
    echo "[INFO] backed up registry-installed @nexus-cortex/$p -> $BACKUP_DIR/$p"
  fi
done

# Clear stale/dangling command links so `npm link` won't EEXIST.
for c in "${CMDS[@]}"; do rm -f "$GBIN/$c"; done

for p in "${PKGS[@]}"; do
  ( cd "$ROOT/packages/$p" && npm link >/dev/null 2>&1 ) \
    || echo "[WARN] npm link @nexus-cortex/$p failed"
done

# Verify commands resolve and package dirs point into this repo.
dead=0
for c in "${CMDS[@]}"; do
  t="$(readlink -f "$GBIN/$c" 2>/dev/null)"
  if [ -z "$t" ] || [ ! -e "$t" ]; then echo "[WARN] $c still unlinked"; dead=1; fi
done
for p in "${PKGS[@]}"; do
  real="$(readlink -f "$GROOT/@nexus-cortex/$p" 2>/dev/null)"
  case "$real" in "$ROOT"/*) : ;; *) echo "[WARN] @nexus-cortex/$p not linked to this repo"; dead=1 ;; esac
done
[ "$dead" = 0 ] && echo "[OK] linked all ${#CMDS[@]} @nexus-cortex global commands (${PKGS[*]}) to this repo"
exit 0
