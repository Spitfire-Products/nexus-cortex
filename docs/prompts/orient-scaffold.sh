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
[ -f requirements.txt ] && echo "-- python deps: requirements.txt ($(wc -l < requirements.txt | tr -d ' ') lines)"
[ -f pyproject.toml ] && echo "-- python: pyproject.toml present"
[ -f Cargo.toml ] && echo "-- rust: Cargo.toml present (cargo build / cargo test)"
if [ -f Makefile ]; then
  echo "-- make targets --"
  sed -n 's/^\([A-Za-z0-9_.-][A-Za-z0-9_.-]*\):.*/  make \1/p' Makefile | head -8
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
