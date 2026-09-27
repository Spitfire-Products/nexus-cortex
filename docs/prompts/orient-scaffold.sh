#!/bin/sh
# Generic mechanical orient — the shipped scaffold's boot-minimal turn-1 target
# (HARNESS_IMPROVEMENT_BACKLOG item 9b). Vendored by prepack to
# <pkg>/.cortex/orient; the boot-minimal clause points here when the project
# has no .cortex/orient of its own. Deterministic, read-only except for one
# mechanical .cortex/CORTEX.md render (never overwrites), always exits 0.
W="$(pwd)"
echo "== WORKSPACE MAP: $W =="
ls -1A "$W" 2>/dev/null | head -40
# orient v2 ships DARK (2026-09-27): every v2 section runs only with CORTEX_ORIENT_V2=1; unset = the v1 output byte-for-byte.
V2="${CORTEX_ORIENT_V2:-0}"
# orient v2 (2026-09-27, MiMo: the whole library lived under vendor/ and the map showed one level): one more level for the top
# directories (skipping caches/vendored deps of the toolchain), capped so the map stays small.
[ "$V2" = "1" ] && for d in $(ls -1A "$W" 2>/dev/null | head -40); do
  [ -d "$W/$d" ] || continue
  case "$d" in .git|node_modules|__pycache__|.venv|venv|.cache|.cortex|.addon-tools|dist|build|target) continue;; esac
  n=$(ls -1A "$W/$d" 2>/dev/null | wc -l | tr -d ' ')
  echo "  $d/ ($n): $(ls -1A "$W/$d" 2>/dev/null | head -8 | tr '\n' ' ')"
done | head -8
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
# orient v2: the baseline the judge's workspace delta is computed against — know it before editing.
if [ "$V2" != "1" ]; then :
elif command -v git >/dev/null 2>&1 && git -C "$W" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  CH=$(git -C "$W" status --porcelain 2>/dev/null | wc -l | tr -d ' ')
  if git -C "$W" rev-parse --verify -q HEAD >/dev/null 2>&1; then
    echo "-- git: $(git -C "$W" rev-parse --abbrev-ref HEAD 2>/dev/null) @ $(git -C "$W" log -1 --format=%h 2>/dev/null), $CH changed file(s) — \`git diff\` shows your edits"
  else
    echo "-- git: repository with no commits yet ($CH untracked/changed path(s)) — commit a baseline before editing to diff your work"
  fi
else
  echo "-- git: not a repository (no baseline to diff your edits against)"
fi
# Workspace baseline (CORTEX_ORIENT_BASELINE=1, dark, 2026-09-27): MiMo tb64 lost ~10-14% of tasks per run to the grader's
# protected-file guard (a file outside the task's repair set was modified, usually vendored library code) and the workspaces are not git
# repos, so nothing could show the agent what it had changed. Record a checksum list ONCE (never overwritten, so a re-run of orient keeps
# the start state) and ship `.cortex/changed`, which lists modified / added / deleted files against it. POSIX cksum; capped.
if [ "${CORTEX_ORIENT_BASELINE:-0}" = "1" ]; then
  mkdir -p "$W/.cortex" 2>/dev/null
  cat > "$W/.cortex/changed" 2>/dev/null <<'CHANGED'
#!/bin/sh
# Lists files modified / added / deleted since orient recorded .cortex/baseline.cksum (the task's start state).
cd "$(dirname "$0")/.." || exit 0
B=.cortex/baseline.cksum
[ -f "$B" ] || { echo "no baseline recorded (.cortex/baseline.cksum missing)"; exit 0; }
T=$(mktemp 2>/dev/null || echo /tmp/cortex-now.$$)
find . \( -path ./.git -o -path ./.cortex -o -name node_modules -o -name __pycache__ -o -name .venv -o -name venv -o -name .cache -o -name .pytest_cache -o -name .mypy_cache \) -prune -o -type f -size -20M -print 2>/dev/null | head -20000 | tr '\n' '\0' | xargs -0 cksum 2>/dev/null > "$T"
awk 'function k(  f) { f=$0; sub(/^[0-9]+[ \t]+[0-9]+[ \t]+/, "", f); return f }
  NR==FNR { b[k()]=$1" "$2; next } { n[k()]=$1" "$2 } END {
  for (f in n) { if (!(f in b)) print "added     " f; else if (b[f] != n[f]) print "modified  " f }
  for (f in b) if (!(f in n)) print "deleted   " f }' "$B" "$T" | sort -k2
rm -f "$T"
CHANGED
  if [ ! -f "$W/.cortex/baseline.cksum" ]; then
    ( cd "$W" && find . \( -path ./.git -o -path ./.cortex -o -name node_modules -o -name __pycache__ -o -name .venv -o -name venv -o -name .cache -o -name .pytest_cache -o -name .mypy_cache \) -prune -o -type f -size -20M -print 2>/dev/null | head -20000 | tr '\n' '\0' | xargs -0 cksum 2>/dev/null > .cortex/baseline.cksum )
  fi
  BN=$(wc -l < "$W/.cortex/baseline.cksum" 2>/dev/null | tr -d ' ')
  echo "-- baseline: ${BN:-0} files recorded at start; \`sh .cortex/changed\` lists files you modified/added/deleted. Before finishing, run it and revert every change the task did not require."
fi
# Bare-box hint (2026-09-03, operator-simplified): a task container may ship WITHOUT the language, compiler,
# package or library the objective needs — on purpose (the agent phase is bare; internet is usually allowed).
# State the FACTS (package manager present, whether we are root) and ONE principled directive — no command
# cookbook: the model bootstraps correctly on its own (pro solved a bare-box torch task with only this line).
# Prescribing exact incantations is prompt mass that misdirects; observation + intent is enough.
# The directive exists because some bench task containers ship WITHOUT the dependencies the task needs (operator, 09-27): they must be
# installed efficiently — once, cached, never duplicated. Trigger unchanged from v1 (no interpreter OR no C compiler). orient v2 adds a
# guard instead of suppressing the line: the MiMo doctrine mine found 21 sessions pip-installing into the task's frozen vendor trees.
if [ "${CORTEX_ORIENT_BOOTSTRAP:-0}" = "1" ] && { ! command -v python3 >/dev/null 2>&1 && ! command -v python >/dev/null 2>&1 || ! command -v cc >/dev/null 2>&1; }; then
  PM=""; for m in apt-get apk dnf yum pacman zypper brew; do command -v "$m" >/dev/null 2>&1 && { PM="$m"; break; }; done
  ROOT=$([ "$(id -u 2>/dev/null)" = "0" ] && echo yes || echo no)
  GUARD=""; [ "$V2" = "1" ] && GUARD=" Install into the system or a venv, never into the task's own source or vendored tree."
  echo "-- setup: this box may be missing a tool/language/library the task needs (pkg-mgr=${PM:-none}, root=$ROOT). If so, INSTALL what you need yourself following standard practice (the system package manager, or the language's own installer); install ONCE and reuse it, and prefer a fast cached installer for the language (uv for Python, bun for JS) — do not re-download a large dependency twice.$GUARD Pin versions, then verify with a real run before finishing. An empty box is part of the task, not an error."
fi
# orient v2 — VERIFICATION ENTRY POINTS: how this task's correctness is checked, so work is built and verified against the real
# criteria, not the agent's own guess (MiMo K=3: in 57/79 failures the agent's own test passed on a wrong solution). Same usage-line
# logic as the judge/planner env report (R193), plus probe/test scripts, test config and test directories. Read-only, capped.
VE=""; TC=""; TD=""
if [ "$V2" = "1" ]; then
VE=$(find . -maxdepth 3 \( -iname "*check*" -o -iname "*verif*" -o -iname "*validat*" -o -iname "*grade*" -o -iname "*probe*" -o -name "test_*.py" -o -name "*_test.py" -o -iname "run_tests*" \) \( -name "*.py" -o -name "*.sh" \) 2>/dev/null | grep -vE "node_modules|/\.|site-packages|/vendor/.*/tests?/" | head -6)
TC=""
for f in pytest.ini tox.ini setup.cfg pyproject.toml Makefile package.json; do
  [ -f "$f" ] || continue
  case "$f" in
    pytest.ini|tox.ini) TC="$TC $f";;
    setup.cfg) grep -q "tool:pytest" "$f" 2>/dev/null && TC="$TC setup.cfg[tool:pytest]";;
    pyproject.toml) grep -q "tool.pytest" "$f" 2>/dev/null && TC="$TC pyproject.toml[tool.pytest]";;
    Makefile) grep -qE "^(test|check)[a-z_-]*:" "$f" 2>/dev/null && TC="$TC make:$(grep -oE '^(test|check)[a-z_-]*' "$f" | head -3 | tr '\n' ',' | sed 's/,$//')";;
    package.json) grep -q '"test"' "$f" 2>/dev/null && TC="$TC npm-test";;
  esac
done
TD=$(find . -maxdepth 3 -type d \( -name tests -o -name test \) 2>/dev/null | grep -vE "node_modules|/\.|site-packages" | head -4 | tr '\n' ' ')
fi
if [ -n "$VE$TC$TD" ]; then
  echo "== VERIFICATION ENTRY POINTS (build to and verify against these — not a test you invent) =="
  for f in $VE; do
    echo "  $f"
    { grep -n -m3 -iE "usage|^ *Run:|add_argument|sys\.argv|getopts" "$f" 2>/dev/null; } | head -3 | cut -c1-150 | sed 's/^/      /'
  done
  [ -n "$TC" ] && echo "  test config:$TC"
  [ -n "$TD" ] && echo "  test dirs: $TD"
fi
if [ -f README.md ]; then
  echo "-- README head --"
  head -12 README.md
fi
# Capability index — harness-owned steering (item 9b): the skills shipped with
# the install, reachable through plain bash reads (works under any tool frame).
SK="${CORTEX_ROOT:-$HOME}/.cortex/skills"
if [ -d "$SK" ] && [ "$V2" != "1" ]; then
  echo "== CAPABILITY GUIDES (load one with: cat <path>/SKILL.md) =="
  for d in "$SK"/*/; do
    [ -d "$d" ] || continue
    n=$(basename "$d")
    desc=$(sed -n 's/^description:[[:space:]]*//p' "$d/SKILL.md" 2>/dev/null | head -1 | cut -c1-90)
    case "$desc" in ">"|"|"|"") desc="guide";; esac
    echo "  $SK/$n — $desc"
  done | head -14
elif [ -d "$SK" ]; then
  # orient v2: one line (was 12 full paths + descriptions ≈ half the output, mostly irrelevant to the task at hand).
  NAMES=$(for d in "$SK"/*/; do [ -d "$d" ] && basename "$d"; done | tr '\n' ' ')
  echo "== CAPABILITY GUIDES: $NAMES(read one: cat $SK/<name>/SKILL.md)"
  [ -f "$SK/verify-work/SKILL.md" ] && echo "  before finishing, verify-work: cat $SK/verify-work/SKILL.md"
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
