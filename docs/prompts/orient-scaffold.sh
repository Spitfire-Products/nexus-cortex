#!/bin/sh
# Generic mechanical orient — the shipped scaffold's boot-minimal turn-1 target
# (HARNESS_IMPROVEMENT_BACKLOG item 9b). Vendored by prepack to
# <pkg>/.cortex/orient; the boot-minimal clause points here when the project
# has no .cortex/orient of its own. Deterministic, read-only except for one
# mechanical .cortex/CORTEX.md render (never overwrites), always exits 0.
W="$(pwd)"
echo "== WORKSPACE MAP: $W =="
ls -1A "$W" 2>/dev/null | head -40
PROJECT=""
CMDS=""
if [ -f package.json ]; then
  if command -v node >/dev/null 2>&1; then
    PROJECT=$(node -e 'try{console.log(require("./package.json").name||"")}catch(e){}' 2>/dev/null)
    SCRIPTS=$(node -e 'try{Object.keys(require("./package.json").scripts||{}).forEach(k=>console.log(k))}catch(e){}' 2>/dev/null | head -12)
  else
    PROJECT=$(sed -n 's/.*"name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' package.json | head -1)
    SCRIPTS=$(tr ',' '\n' < package.json | sed -n 's/.*"\([A-Za-z0-9:_-]*\)"[[:space:]]*:[[:space:]]*".*/\1/p' | head -12)
  fi
  if [ -n "$SCRIPTS" ]; then
    echo "-- package.json scripts --"
    printf '%s\n' "$SCRIPTS" | sed 's/^/  npm run /'
    CMDS=$(printf '%s\n' "$SCRIPTS" | head -8 | sed 's/^/- `npm run /;s/$/`/')
  fi
fi
# Tooling inventory (item 11, 2026-09-02): ONE line of generic process intelligence —
# which interpreters/venvs and which common binaries exist — so the model does not
# discover `python3: command not found` five turns in. Read-only, always cheap.
TI=""
for i in python3 python node; do
  v=$(command -v "$i" 2>/dev/null) && TI="$TI $i=$v"
done
for v in /opt/*/bin/python /app/.venv/bin/python /root/.venv/bin/python /venv/bin/python; do
  [ -x "$v" ] && TI="$TI venv=$v"
done
HAVE=""; MISS=""
for b in file xxd strings ps pgrep free pdftotext tesseract gcc make git curl; do
  if command -v "$b" >/dev/null 2>&1; then HAVE="$HAVE $b"; else MISS="$MISS $b"; fi
done
echo "-- tooling:${TI:- (no python/node on PATH)} | have:${HAVE:- none} | missing:${MISS:- none}"
# Bare-box hint (2026-09-03, operator-simplified): a task container may ship WITHOUT the language, compiler,
# package or library the objective needs — on purpose (the agent phase is bare; internet is usually allowed).
# State the FACTS (package manager present, whether we are root) and ONE principled directive — no command
# cookbook: the model bootstraps correctly on its own (pro solved a bare-box torch task with only this line).
# Prescribing exact incantations is prompt mass that misdirects; observation + intent is enough.
if [ "${CORTEX_ORIENT_BOOTSTRAP:-0}" = "1" ] && { ! command -v python3 >/dev/null 2>&1 && ! command -v python >/dev/null 2>&1 || ! command -v cc >/dev/null 2>&1; }; then
  PM=""; for m in apt-get apk dnf yum pacman zypper brew; do command -v "$m" >/dev/null 2>&1 && { PM="$m"; break; }; done
  ROOT=$([ "$(id -u 2>/dev/null)" = "0" ] && echo yes || echo no)
  echo "-- setup: this box may be missing a tool/language/library the task needs (pkg-mgr=${PM:-none}, root=$ROOT). If so, INSTALL what you need yourself following standard practice (the system package manager, or the language's own installer); install ONCE and reuse it, and prefer a fast cached installer for the language (uv for Python, bun for JS) — do not re-download a large dependency twice. Pin versions, then verify with a real run before finishing. An empty box is part of the task, not an error."
fi
if [ -f README.md ]; then
  echo "-- README head --"
  head -12 README.md
fi
# Capability index — harness-owned steering (item 9b): the skills shipped with
# the install, reachable through plain bash reads (works under any tool frame).
SK="${CORTEX_ROOT:-$HOME}/.cortex/skills"
if [ -d "$SK" ]; then
  echo "== CAPABILITY GUIDES (load one with: cat <path>/SKILL.md) =="
  for d in "$SK"/*/; do
    [ -d "$d" ] || continue
    n=$(basename "$d")
    desc=$(sed -n 's/^description:[[:space:]]*//p' "$d/SKILL.md" 2>/dev/null | head -1 | cut -c1-90)
    case "$desc" in ">"|"|"|"") desc="guide";; esac
    echo "  $SK/$n — $desc"
  done | head -14
fi
echo "note: when your tool list is limited, additional tools may be discoverable via the SearchTools tool."
# Mechanical CORTEX.md (items 9c + 10): machine-authored sections live between
# markers so the drift check can regenerate ONLY what the machine wrote.
# - absent doc  -> write fresh (with markers)
# - doc w/ markers + drift -> stage .cortex/CORTEX.md.next + .diff for the
#   HELPER-model curation boundary (item 10); print ONE informational line —
#   the working model gets zero decision surface.
# - doc without markers -> fully hand-authored; never touched, never staged.
MB_BEGIN="<!-- orient:auto:begin -->"
MB_END="<!-- orient:auto:end -->"
machine_block() {
  echo "$MB_BEGIN"
  echo "## Project"
  echo "${PROJECT:-$(basename "$W")} — see README for details."
  echo
  echo "## Key Commands"
  if [ -n "$CMDS" ]; then printf '%s\n' "$CMDS"; else echo "- (no package.json scripts; check README/Makefile)"; fi
  echo
  echo "## Structure (top level)"
  ls -1A "$W" 2>/dev/null | head -25 | sed 's/^/- /'
  echo "$MB_END"
}
DOC=.cortex/CORTEX.md
if [ ! -f "$DOC" ]; then
  mkdir -p .cortex 2>/dev/null
  {
    echo "# CORTEX.md (mechanical orient scan — refine with init_cortex_context)"
    echo
    machine_block
  } > "$DOC" 2>/dev/null && echo "(wrote mechanical .cortex/CORTEX.md)"
elif grep -q "orient:auto:begin" "$DOC" 2>/dev/null; then
  machine_block > .cortex/.orient-fresh-block 2>/dev/null
  awk '/orient:auto:begin/{f=1} f{print} /orient:auto:end/{f=0}' "$DOC" > .cortex/.orient-cur-block 2>/dev/null
  if cmp -s .cortex/.orient-cur-block .cortex/.orient-fresh-block; then
    rm -f .cortex/.orient-fresh-block .cortex/.orient-cur-block
    rm -f "$DOC.next" "$DOC.diff"
    echo "(CORTEX.md current)"
  else
    awk -v fresh=.cortex/.orient-fresh-block '
      /orient:auto:begin/ {skip=1; while ((getline line < fresh) > 0) print line; close(fresh); next}
      /orient:auto:end/ {skip=0; next}
      skip!=1 {print}' "$DOC" > "$DOC.next" 2>/dev/null
    diff -u "$DOC" "$DOC.next" > "$DOC.diff" 2>/dev/null
    rm -f .cortex/.orient-fresh-block .cortex/.orient-cur-block
    echo "(doctrine refresh staged for curation: machine sections drifted)"
  fi
fi
exit 0
