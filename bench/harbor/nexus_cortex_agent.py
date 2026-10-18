"""
nexus_cortex_agent.py — Harbor installed-agent adapter for the nexus-cortex
harness (the P-series "A1" arm). Lets Harbor benchmark OUR harness the same way
it benchmarks mini-swe-agent / terminus / grok-build.

Loaded via Harbor's CUSTOM IMPORT-PATH mechanism (AgentFactory
create_agent_from_import_path — `--agent "nexus_cortex_agent:NexusCortex"`),
so it needs NO edit to Harbor's AgentName enum or factory map. Put this file on
Harbor's PYTHONPATH at run time.

Design (grounded, 2026-08-22):
- install(): the task container gets node+npm, then the PUBLISHED CLI
  (`npm i -g nexus-cortex`), pinned to the harness version under test.
- run(): `cortex --new --quiet --model <id> "<task>"` in the task's repo dir
  (headless has no interactive approver → auto-runs tools, edits files, exits).
  Reward comes from the TASK's own test.sh — no trajectory mapping needed, so
  SUPPORTS_ATIF is False (the ~470-line ATIF mapping mini-swe carries is
  optional for pass/fail).
- Inference: routed through the CORTEX ai-proxy exactly like the
  autoresearch-sandbox `userFundedExports` recipe — CORTEX_PROXY_BASE_URL +
  the per-session job token riding as the provider key (DEEPSEEK_API_KEY etc.);
  the RAW provider key never enters the task container, the proxy swaps the
  token. These are read from Harbor's own environment (stamped on the KEYED
  serving path; admin /debug/exec has none — run via the keyed MCP/PTY path).
- Narrow door: deepseek-v4-flash's model card defaults to the bash-edit anchor
  with redirects-off (card-scoped steering, nexus-cortex 4.69.1); set
  CORTEX_TOOL_ANCHOR=bash-edit explicitly here so the A1 arm is unambiguously
  the narrow-door config under test.

⚠️ Validation adapter — NOT baked into the image yet. Bake into the bench
sandbox Dockerfile only after a green partial run + the phase-2 security review.
"""
import os
import shlex
import json as _json
import base64 as _b64
from typing import Any, override

from harbor.agents.installed.base import BaseInstalledAgent
from harbor.agents.model_connection import ModelConnectionSpec

# 2026-09-23: discover the box (docker host) that serves the package cache (bootstrap-executor.sh, python http.server on
# TB2_PKG_PORT, default 8765): the container's default gateway from /proc/net/route (any compose network), `ip route` as a
# fallback, then docker0's conventional address; TB2_PKG_HOST overrides. Sourced into both the node and the harness install steps.
_PKG_CACHE_DISC = (
    'PKG_PORT=${TB2_PKG_PORT:-8765}; GW=""; '
    'if command -v python3 >/dev/null 2>&1; then GW=$(python3 -c "import socket,struct; l=[x.split() for x in open(\'/proc/net/route\')][1:]; g=[x[2] for x in l if x[1]==\'00000000\']; print(socket.inet_ntoa(struct.pack(\'<L\', int(g[0],16))) if g else \'\')" 2>/dev/null || true); fi; '
    '[ -n "$GW" ] || GW=$(ip route 2>/dev/null | awk \'/default/ {print $3; exit}\' || true); '
    '[ -n "$GW" ] || GW=$(awk \'$2=="00000000" {print $3; exit}\' /proc/net/route 2>/dev/null | sed -E \'s/(..)(..)(..)(..)/0x\\4 0x\\3 0x\\2 0x\\1/\' | xargs -r printf "%d.%d.%d.%d" 2>/dev/null || true); '
    'PKG_HOSTS="${TB2_PKG_HOST:-} $GW 172.17.0.1"; mkdir -p /logs/agent 2>/dev/null || true; '
)
from harbor.environments.base import BaseEnvironment
from harbor.models.agent.context import AgentContext

# Provider env vars cortex reads per provider (mirror of the autoresearch
# PROVIDER_ENV_VARS map — on the proxy path each holds the JOB TOKEN, not a raw key).
_PROVIDER_KEY_ENVS = (
    "DEEPSEEK_API_KEY",
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY",
    "XAI_API_KEY",
    "GEMINI_API_KEY",
    "GOOGLE_API_KEY",
)


# TB4.0 (2026-09-12): every Terminal-Bench 4.0 task carries [agent] timeout_sec = 28800 (8 h). Every self-imposed ceiling
# below (client fetch, curl, exec backstop) must clear the LARGEST task budget so Harbor's per-task timer governs, never us.
# Env-overridable so a dataset with longer budgets never silently self-cuts again.
MAX_TASK_BUDGET_S = int(os.environ.get("TB2_MAX_TASK_BUDGET_S", "28800"))
CEILING_S = MAX_TASK_BUDGET_S + 600

# ---------------------------------------------------------------------------------------------------------------------
# R194 SECOND ATTEMPT (bench-side, 2026-09-24; operator: "demote accept — while >= 50% of the budget remains the judge may veto and compare but
# never ends the task; its 'done' opens a second independent attempt"). Evidence: a 570-session replay of ever-passed tasks — 75% of failing
# sessions end with >= 50% of the budget unused; the judge's final action is in the harness's own decisions.jsonl. Implemented HERE, not in
# the harness: the adapter owns the server lifecycle and the workspace, and a fresh server + fresh state dir IS a clean context.
#   1. task start: snapshot the workspace into a SHADOW git repo (git dir outside the workspace; big files + vendor dirs excluded) → tag `lift`
#   2. after attempt k (k = 1, 2, ...): read attempt k's LAST endturn_resolver event; continue to attempt k+1 while ALL hold: action ∈ TRIGGER
#      set; the time remaining against the ORIGINAL deadline is >= MIN (0.5) of it; remaining − 5 min >= 15 min; extra attempts so far <
#      TB2_SECOND_ATTEMPT_MAX. Remaining is measured on the WALL CLOCK (task-start epoch T0 + the original CORTEX_TURN_DEADLINE_MS − now):
#      attempt k >= 2's own detail.remainingFrac is relative to ITS shortened deadline and is recorded but never used for the decision.
#      To continue: bank attempt-1 artifacts as *.attempt1.* (attempt k >= 2 writes its own *.attemptK.* directly; its server log is banked
#      as cortex-server.attemptK.log), commit the tree as tag `attemptK`, reset the tree to `lift`, kill the server BY PID, start a new one
#      (CORTEX_STATE_DIR=/tmp/.cortex-state-<k+1>, CORTEX_TURN_DEADLINE_MS = remaining − 5 min), POST the same task.
#   3. selection over ALL attempts' trees (helper sa-pick): run the workspace's own shipped check (Makefile test / test.sh / run_tests.sh /
#      pytest) on each tree, latest first (the latest and attempt 1 always; middle attempts only before the original deadline); when some
#      trees pass and others do not, only the passing ones stay candidates; then judge verdict rank (accept > accept-with-gap /
#      accept-low-confidence > no finish); tie → FEWEST tool-call turns (r-selector 2026-09-28, the measured best free selector;
#      promoted above namedPassed 2026-10-07); tie → more judge checks passed (namedPassed); tie → earliest attempt.
#   4. restore the chosen tree; response.json carries the chosen attempt with usage.session SUMMED over all attempts;
#      /logs/agent/second-attempt.json banks the whole decision: every attempt {k, action, remainingFrac (original basis), namedPassed,
#      check, turns} + pick + why (engagement evidence). Any failure at any step leaves attempt 1 (or the chosen finished attempt) in place.
#   The chain decision / selection / usage merge are Python functions in the _MA_HELPER constant (sa-go / sa-pick / sa-merge; tests:
#   tests/test_second_attempt_chain.py); the shadow-git tree handling stays here.
# Levers (env, forwarded by the supervisor): TB2_SECOND_ATTEMPT=1 (off by default), TB2_SECOND_ATTEMPT_MIN_REMAINING (0.5),
# TB2_SECOND_ATTEMPT_TRIGGER (default "accept-with-gap,accept-low-confidence"; add "accept" to retry confident finishes too; add "none"
#   (2026-10-07) to retry a give-up — an attempt that ended with NO resolver verdict),
# TB2_SECOND_ATTEMPT_MAX (maximum number of EXTRA attempts; integer, default 1 = one second attempt; 0 = none; non-integer → 1).
# Stands down when TB2_ATTEMPTS >= 2.
# ---------------------------------------------------------------------------------------------------------------------
# PROCESS RECORDER (2026-09-29): t4cwa payments-pipeline-fix__r2 lost its adapter shell to SIGKILL (exit 137) 44 min in, while the
# model's final test ran. The kernel logged no OOM kill at that time, the model's kill commands were all narrowly targeted, and harbor
# found the container alive — but nothing recorded the moment of death, because the adapter's own "no response" diagnostic runs only
# after the request returns and a SIGKILL skips it. This background loop snapshots the process tree + cgroup memory into
# /logs/agent/procwatch.log every 20 s (ring-capped ~250 KB; the supervisor banks it first). It is a sibling of the session copier, so it
# outlives a SIGKILL of the adapter shell until harbor stops the container, and the last snapshots show what was running and what the
# memory cgroup said. Read-only, best-effort: every leg ignores its own errors.
_PROC_WATCH = (
    "ADP=$$; ( while true; do { "
    "echo \"=== $(date -u +%H:%M:%S) adapter_pid=$ADP alive=$([ -d /proc/$ADP ] && echo y || echo n) srv=${SRV:-?}\"; "
    "for f in memory.current memory.max memory.peak memory.events memory.usage_in_bytes memory.limit_in_bytes memory.max_usage_in_bytes memory.oom_control; do "
    "  [ -r /sys/fs/cgroup/$f ] && echo \"cg.$f: $(tr '\\n' ' ' < /sys/fs/cgroup/$f 2>/dev/null)\"; "
    "  [ -r /sys/fs/cgroup/memory/$f ] && echo \"cg1.$f: $(tr '\\n' ' ' < /sys/fs/cgroup/memory/$f 2>/dev/null)\"; done; "
    "if command -v ps >/dev/null 2>&1; then ps -eo pid,ppid,etimes,rss,stat,args 2>/dev/null | cut -c1-200 | head -60; "
    "else for q in /proc/[0-9]*; do printf '%s %s\\n' \"${q#/proc/}\" \"$(tr '\\0' ' ' < $q/cmdline 2>/dev/null | cut -c1-150)\"; done | head -60; fi; "
    "} >> /logs/agent/procwatch.log 2>/dev/null; "
    "PWS=$(wc -c < /logs/agent/procwatch.log 2>/dev/null || echo 0); "
    "if [ \"${PWS:-0}\" -gt 250000 ] 2>/dev/null; then tail -c 150000 /logs/agent/procwatch.log > /tmp/.procwatch.tmp 2>/dev/null && mv /tmp/.procwatch.tmp /logs/agent/procwatch.log 2>/dev/null; fi; "
    "sleep 20; done ) >/dev/null 2>&1 & PROCWATCH=$!; "
)

_SA_SNAPSHOT = (
    'SA="${TB2_SECOND_ATTEMPT:-0}"; [ "${MA:-0}" -ge 2 ] 2>/dev/null && SA=0; case "${CORTEX_SECOND_ATTEMPT:-}" in 1|true|on|TRUE|On|ON) SA=0; echo "[adapter] R194 second-attempt: LIBRARY chain active (CORTEX_SECOND_ATTEMPT) — adapter chain stands down" >> /logs/agent/nexus-cortex.txt;; esac; SG=/tmp/.cortex-attempts/shadow.git; G="git --git-dir=$SG --work-tree=$PWD -c user.email=bench@x -c user.name=bench -c core.quotepath=off"; '
    'if [ "$SA" = 1 ]; then mkdir -p /tmp/.cortex-attempts; rm -f /tmp/.cortex-attempts/a[0-9]*.json /tmp/.cortex-attempts/check[0-9]* /tmp/.cortex-attempts/rc[0-9]* /tmp/.cortex-attempts/attempt[0-9]*.tagged; '
    '  { echo "$MA_HELPER_B64" | base64 -d > $AH; } 2>/dev/null; '  # the chain's decide/select/merge live in the shared helper
    '  if command -v git >/dev/null 2>&1 && mkdir -p /tmp/.cortex-attempts && rm -rf $SG && $G init -q >/dev/null 2>&1; then '
    '  printf \'node_modules/\\n.git/\\n.venv/\\nvenv/\\n__pycache__/\\ndist/\\nbuild/\\ntarget/\\n.cache/\\n.cortex/\\n.addon-tools/\\n.ivy2/\\n.sbt/\\n.m2/\\n.gradle/\\n.npm/\\n*.pyc\\n\' > $SG/info/exclude; '
    '  find . -type f -size +20M 2>/dev/null | grep -v -E "(^|/)(node_modules|\\.git)(/|$)" | sed "s#^\\./##" >> $SG/info/exclude; '
    # R252 (10-13): `reset --hard <tag> && clean -fdq` never touches EXCLUDED paths, so the graded tree carried the LAST attempt's build
    # output/caches/*.pyc/big files (photonic, t4jf: the pick failed live, passed 14/14 from a clean restore). Each attempt tag gets a
    # stamp; SAPRUNE <tag> deletes excluded-path content newer than it (never .git/.cortex). Mirrors WorkspaceSnapshot.pruneExcludedAfter.
    '  SAPRUNE() { [ -f $SG/stamp.$1 ] || return 0; find . \\( -name .git -o -name .cortex \\) -prune -o -type d \\( -name node_modules -o -name .venv -o -name venv -o -name __pycache__ -o -name dist -o -name build -o -name target -o -name .cache -o -name .addon-tools -o -name .ivy2 -o -name .sbt -o -name .m2 -o -name .gradle -o -name .npm \\) -print -prune 2>/dev/null | while read -r d; do find "$d" -type f -newer $SG/stamp.$1 -delete 2>/dev/null; find "$d" -depth -mindepth 1 -type d -empty -newer $SG/stamp.$1 -delete 2>/dev/null; done; find . \\( -name .git -o -name .cortex \\) -prune -o -type f \\( -name "*.pyc" -o -size +20M \\) -newer $SG/stamp.$1 -delete 2>/dev/null; echo "[adapter] R252 pruned excluded-path content newer than $1" >> /logs/agent/nexus-cortex.txt; }; '
    '  if timeout 180 $G add -A . >/dev/null 2>&1 && timeout 120 $G commit -qm lift --allow-empty >/dev/null 2>&1 && $G tag -f lift >/dev/null 2>&1; then '
    '    echo "[adapter] R194 second-attempt: workspace snapshot lift ($($G ls-files | wc -l) files)" >> /logs/agent/nexus-cortex.txt; '
    '  else SA=0; echo "[adapter] R194 second-attempt: snapshot FAILED — disabled for this task" >> /logs/agent/nexus-cortex.txt; fi; '
    'else SA=0; echo "[adapter] R194 second-attempt: no git — disabled" >> /logs/agent/nexus-cortex.txt; fi; fi; '
)
_SA_CHAIN = (
    'if [ "$SA" = 1 ]; then '
    '  SAMAX="${TB2_SECOND_ATTEMPT_MAX:-1}"; case "$SAMAX" in ""|*[!0-9]*) SAMAX=1;; esac; SAK=1; SAD=/logs/agent/decisions.jsonl; SADL=$(( ${CORTEX_TURN_DEADLINE_MS:-0} / 1000 )); '
    '  while :; do '
    # continue-decision on the wall clock against the ORIGINAL deadline (T0 = task-start epoch from _MA_SNAPSHOT); writes a<k>.json
    '    GO=$(TB2_SA_T0="$T0" TB2_SECOND_ATTEMPT_MAX="$SAMAX" timeout 60 python3 $AH sa-go $SAK $SAD 2>>/logs/agent/nexus-cortex.txt | tail -1); '
    '    echo "[adapter] R194 attempt-$SAK verdict: $(cat /tmp/.cortex-attempts/a$SAK.json 2>/dev/null)" >> /logs/agent/nexus-cortex.txt; '
    '    [ "$GO" = 1 ] || break; '
    '    if [ "$SAK" = 1 ]; then '
    '      for f in session.jsonl decisions.jsonl response.json cortex-server.log; do [ -f /logs/agent/$f ] && cp /logs/agent/$f /logs/agent/${f%.*}.attempt1.${f##*.}; done; '
    # R245 (10-10): the attempt's session is the NEWEST session file in the state dirs (the 20-s copier can be stale by one tick)
    '      SK=$(find /tmp/.cortex-state "$PWD/.cortex" "$HOME/.cortex" /root/.cortex -path \'*sessions*\' -name \'*.jsonl\' 2>/dev/null | xargs -r ls -t 2>/dev/null | head -1); [ -n "$SK" ] && cp "$SK" /logs/agent/session.attempt1.jsonl; '
    '      if timeout 180 $G add -A . >/dev/null 2>&1 && timeout 120 $G commit -qm attempt1 --allow-empty >/dev/null 2>&1 && $G tag -f attempt1 >/dev/null 2>&1; then : > /tmp/.cortex-attempts/attempt1.tagged; touch $SG/stamp.attempt1; '
    '      else echo "[adapter] R194 commit of attempt 1 FAILED — keeping attempt 1, no further attempts" >> /logs/agent/nexus-cortex.txt; break; fi; '
    '    else cp /logs/agent/cortex-server.log /logs/agent/cortex-server.attempt$SAK.log 2>/dev/null; '
    '      SK=$(find /tmp/.cortex-state "$PWD/.cortex" "$HOME/.cortex" /root/.cortex -path \'*sessions*\' -name \'*.jsonl\' 2>/dev/null | xargs -r ls -t 2>/dev/null | head -1); [ -n "$SK" ] && cp "$SK" /logs/agent/session.attempt$SAK.jsonl; cp /logs/agent/decisions.jsonl /logs/agent/decisions.attempt$SAK.jsonl 2>/dev/null; fi; '
    '    SAN=$((SAK+1)); '
    '    if ! { $G reset -q --hard lift >/dev/null 2>&1 && $G clean -fdq >/dev/null 2>&1; }; then '
    '      echo "[adapter] R194 reset to lift FAILED — stopping at attempt $SAK" >> /logs/agent/nexus-cortex.txt; $G reset -q --hard attempt$SAK >/dev/null 2>&1; break; fi; '
    '    echo "[adapter] R194 tree reset to lift; starting attempt $SAN" >> /logs/agent/nexus-cortex.txt; '
    # kill by PID, never by pattern: the adapter's OWN shell command line contains the server text and a pattern kill takes it down (e2e #2, 09-24)
    '    kill $SRV 2>/dev/null; sleep 2; kill -9 $SRV 2>/dev/null; sleep 1; '
    '    RM=$(python3 -c "import json; print(int(json.load(open(\'/tmp/.cortex-attempts/a$SAK.json\'))[\'nextDeadlineMs\']))" 2>/dev/null); case "$RM" in ""|*[!0-9]*) RM=600000;; esac; '
    '    CORTEX_STATE_DIR=/tmp/.cortex-state-$SAN CORTEX_TURN_DEADLINE_MS=$RM nohup cortex-server > /logs/agent/cortex-server.log 2>&1 & SRV=$!; '
    '    P2=""; for i in $(seq 1 60); do P2=$(grep -oE "running on port [0-9]+" /logs/agent/cortex-server.log 2>/dev/null | grep -oE "[0-9]+" | tail -1); [ -n "$P2" ] && H GET "http://localhost:$P2/health" /dev/null >/dev/null 2>&1 && break; sleep 1; done; [ -z "$P2" ] && P2=4000; '
    '    echo "[adapter] R194 attempt $SAN on port $P2, deadline ${RM} ms" >> /logs/agent/nexus-cortex.txt; '
    '    H POST "http://localhost:$P2/v1/messages" /tmp/req.json /logs/agent/response.attempt$SAN.json $((RM/1000+900)) 2>>/logs/agent/nexus-cortex.txt; echo $? > /tmp/.cortex-attempts/rc$SAN; '
    '    S2=$(find /tmp/.cortex-state-$SAN -path "*sessions*" -name "*.jsonl" 2>/dev/null | xargs -r ls -t 2>/dev/null | head -1); [ -n "$S2" ] && cp "$S2" /logs/agent/session.attempt$SAN.jsonl; '
    '    D2=$(find /tmp/.cortex-state-$SAN -maxdepth 2 -name decisions.jsonl 2>/dev/null | head -1); [ -n "$D2" ] && cp "$D2" /logs/agent/decisions.attempt$SAN.jsonl; '
    '    timeout 180 $G add -A . >/dev/null 2>&1 && timeout 120 $G commit -qm attempt$SAN --allow-empty >/dev/null 2>&1 && $G tag -f attempt$SAN >/dev/null 2>&1 && { : > /tmp/.cortex-attempts/attempt$SAN.tagged; touch $SG/stamp.attempt$SAN; }; '
    '    SAK=$SAN; SAD=/logs/agent/decisions.attempt$SAN.jsonl; '
    '  done; '
    '  if [ "$SAK" -ge 2 ]; then '
    '    CHK=""; if [ -f Makefile ] && grep -qE "^test\\s*:" Makefile; then CHK="make test"; elif [ -f test.sh ]; then CHK="sh ./test.sh"; elif [ -f run_tests.sh ]; then CHK="sh ./run_tests.sh"; elif [ -f pytest.ini ] || [ -d tests ] || [ -d test ]; then CHK="python3 -m pytest -q -x --no-header -p no:cacheprovider"; fi; '
    # shipped check on every committed tree, latest first (the tree on disk IS the latest); the latest and attempt 1 are always checked,
    # middle attempts only while the original deadline has not passed. No check file = none (the helper treats it as not passing).
    '    if [ -n "$CHK" ]; then j=$SAK; while [ "$j" -ge 1 ]; do '
    '      if [ ! -f /tmp/.cortex-attempts/attempt$j.tagged ]; then :; '
    '      elif [ "$j" != "$SAK" ] && [ "$j" != 1 ] && [ "$(date +%s)" -ge $(( T0 + SADL )) ]; then echo skipped > /tmp/.cortex-attempts/check$j; '
    '      elif [ "$j" = "$SAK" ] || { $G reset -q --hard attempt$j >/dev/null 2>&1 && $G clean -fdq >/dev/null 2>&1; }; then SAPRUNE attempt$j; '
    '        if timeout 300 sh -c "$CHK" >/tmp/.cortex-attempts/chk$j.txt 2>&1; then echo pass > /tmp/.cortex-attempts/check$j; else echo fail > /tmp/.cortex-attempts/check$j; fi; fi; '
    '      j=$((j-1)); done; fi; '
    '    PICK=$(CHK="$CHK" timeout 60 python3 $AH sa-pick $SAK 2>>/logs/agent/nexus-cortex.txt | tail -1); case "$PICK" in ""|*[!0-9]*) PICK=1;; esac; '
    '    if ! { $G reset -q --hard attempt$PICK >/dev/null 2>&1 && $G clean -fdq >/dev/null 2>&1; }; then '
    '      echo "[adapter] R194 restore of attempt $PICK FAILED — restoring attempt 1" >> /logs/agent/nexus-cortex.txt; $G reset -q --hard attempt1 >/dev/null 2>&1 && $G clean -fdq >/dev/null 2>&1; fi; '
    '    SAPRUNE attempt$PICK; '
    '    echo "[adapter] R194 selection: $(cat /logs/agent/second-attempt.json 2>/dev/null | tr -d \'\\n\' | cut -c1-600)" >> /logs/agent/nexus-cortex.txt; '
    '    timeout 60 python3 $AH sa-merge $SAK >/dev/null 2>>/logs/agent/nexus-cortex.txt; '
    # R245: the PICK's session/decisions become the canonical trajectory files (the supervisor banks /logs/agent/session.jsonl)
    '    for f in session.jsonl decisions.jsonl; do [ -f /logs/agent/${f%.*}.attempt$PICK.${f##*.} ] && cp /logs/agent/${f%.*}.attempt$PICK.${f##*.} /logs/agent/$f; done; '
    # R250 (sibling grading, 10-11): bank every attempt tree as a git bundle; the supervisor grades the non-picked ones in restore-only trials
    '    $G bundle create /logs/agent/attempts.bundle --all >/dev/null 2>&1 && echo "[adapter] R250 attempts bundle written (pick $PICK)" >> /logs/agent/nexus-cortex.txt; '
    '  fi; fi; '
)

# ---------------------------------------------------------------------------------------------------------------------
# TB2_ATTEMPTS — serial "anytime" best-of-N (bench-side, 2026-09-29; operator: "build it as a bench runner option or a lean extension of the
# autoresearch mode ... It would allow for multi provider arms"). Evidence: r-selector-2026-09-28 (7 identical MiMo runs: 29/64 tasks pass
# only sometimes; leak-free best-of-3 selection +1.2 (output vote) / +2.1 (fewest turns) passes per run). Generalizes R194 (which stays as-is
# and stands down when TB2_ATTEMPTS is on):
#   1. task start: tar snapshot of the workspace (`lift`) — tar, not git: nested vendor repos are restored (the R194 shadow git stores them as
#      gitlinks and never resets their contents); per-attempt models from `cortex autoresearch arms` (the loop's planArms) when
#      TB2_ATTEMPTS_MODELS / TB2_ATTEMPTS_PROVIDERS is set, else every attempt runs the task's model
#   2. attempt 1 = today's run, unchanged (full deadline). Attempts 2..N run only while the wall clock allows (T0 + deadline − reserve − now ≥
#      TB2_ATTEMPTS_MIN_S), each on a fresh server + state dir from the restored `lift`, deadline = the time left
#   3. pick (TB2_ATTEMPTS_SELECT): turns (fewest tool-call iterations among finished attempts, default) | vote (cross-run output agreement)
#      | first (attempt 1 unless it did not finish); restore the pick; response.json = the pick with usage.session SUMMED over all attempts +
#      metadata.attempts (per-attempt model/usage for per-model pricing) + metadata.attemptsPick; every attempt banked as *.attemptK.*
# Levers: TB2_ATTEMPTS (N >= 2 enables; off by default), TB2_ATTEMPTS_MODELS, TB2_ATTEMPTS_PROVIDERS, TB2_ATTEMPTS_KEY_POLICY
# (platform_fallback), TB2_ATTEMPTS_SELECT (turns), TB2_ATTEMPTS_MIN_S (240), TB2_ATTEMPTS_RESERVE_S (120). Needs python3 in the task image and
# CORTEX_TURN_DEADLINE_MS (set by the supervisor); otherwise it disables itself for the task and the run is today's single attempt.
# The helper below is the ONLY copy (tests: tests/test_attempts_helper.py loads it from this constant).
# ---------------------------------------------------------------------------------------------------------------------
_MA_HELPER = r'''#!/usr/bin/env python3
"""TB2_ATTEMPTS helper (bench-side best-of-N, 2026-09-29). This source is the constant _MA_HELPER in nexus_cortex_agent.py — the ONLY
copy (the adapter is shipped to boxes by several paths, all of which carry just that one file); the adapter writes it into the task container
as /tmp/.cortex-attempts/ah.py. Tests: tests/test_attempts_helper.py extracts and runs this constant.

  save NAME            snapshot the workspace (cwd) to /tmp/.cortex-attempts/NAME.tar (+ NAME.manifest). Tar, not git: nested vendor
                       git repos are stored as plain files (a shadow git stores them as gitlinks and never restores their contents).
  restore NAME         make the workspace equal to snapshot NAME: delete snapshot-eligible paths absent from it, then extract it.
  pick POLICY N        choose among attempts 1..N (files /logs/agent/response.attemptK.json, session.attemptK.jsonl, decisions.attemptK.jsonl,
                       snapshots attemptK): prints the chosen K and writes /logs/agent/attempts.json.
     turns  fewest tool-call iterations among FINISHED attempts (measured best free selector, MiMo 09-28: +2.1 passes/run at N=3)
     vote   each attempt's own final checks run on every finished attempt's snapshot; pick the attempt whose normalized outputs agree
            with the most others (ties → fewest turns). Measured +1.2 leak-free — kept for comparison.
     first  attempt 1 unless it did not finish (control-equivalent pick; engagement test).
  merge N K            write /logs/agent/response.json = attempt K's response with usage.session SUMMED over attempts 1..N and a per-attempt
                       breakdown (metadata.attempts) so the supervisor can price each attempt at its own model's rates.
  sa-go K DECISIONS    R194 chain: after attempt K, continue? (wall clock vs the ORIGINAL deadline; env TB2_SA_T0 = task-start epoch)
                       prints 1|0, writes D/aK.json.
  sa-pick N            R194 chain selection over attempts 1..N; prints the pick, writes /logs/agent/second-attempt.json.
  sa-merge N           R194 chain: response.json = the pick with usage.session summed over attempts 1..N.

Excluded from snapshots (never saved, never deleted on restore): dependency/cache dirs and files > 20 MB — state outside the snapshot
(installed packages, /tmp) persists across attempts by design (an install is reusable work, not an answer).
"""
import json, os, re, shutil, subprocess, sys, tarfile, time

D = os.environ.get('TB2_ATTEMPTS_DIR', '/tmp/.cortex-attempts')
LOGS = os.environ.get('TB2_ATTEMPTS_LOGS', '/logs/agent')
EXCL_DIRS = {'node_modules', '.venv', 'venv', '__pycache__', '.cache', '.cortex', '.addon-tools', '.pytest_cache', '.mypy_cache',
             '.npm', '.m2', '.gradle', '.ivy2', '.sbt', '.tox'}
BIG = 20 * 1024 * 1024


def _eligible(root):
    """Yield (relpath, is_dir) for every snapshot-eligible path under root (dirs before their contents)."""
    for dp, dns, fns in os.walk(root, topdown=True, followlinks=False):
        dns[:] = sorted(d for d in dns if d not in EXCL_DIRS)
        rel = os.path.relpath(dp, root)
        for d in dns:
            p = os.path.join(dp, d)
            yield (os.path.normpath(os.path.join(rel, d)), not os.path.islink(p))
        for f in sorted(fns):
            p = os.path.join(dp, f)
            try:
                if not os.path.islink(p) and os.path.getsize(p) > BIG:
                    continue
            except OSError:
                continue
            yield (os.path.normpath(os.path.join(rel, f)), False)


def save(name, root='.'):
    os.makedirs(D, exist_ok=True)
    names = []
    with tarfile.open(os.path.join(D, name + '.tar'), 'w') as tf:
        for rel, _ in _eligible(root):
            try:
                tf.add(os.path.join(root, rel), arcname=rel, recursive=False)
                names.append(rel)
            except OSError:
                pass
    json.dump(names, open(os.path.join(D, name + '.manifest'), 'w'))
    return len(names)


def _rm(p):
    try:
        if os.path.isdir(p) and not os.path.islink(p):
            shutil.rmtree(p, ignore_errors=True)
        elif os.path.lexists(p):
            os.unlink(p)
    except OSError:
        pass


def restore(name, root='.'):
    keep = set(json.load(open(os.path.join(D, name + '.manifest'))))
    cur = list(_eligible(root))
    for rel, is_dir in reversed(cur):  # contents before their dirs
        if rel in keep:
            continue
        p = os.path.join(root, rel)
        _rm(p)
    with tarfile.open(os.path.join(D, name + '.tar')) as tf:
        for m in tf.getmembers():
            p = os.path.join(root, m.name)
            # a type change (file <-> dir <-> symlink) since the snapshot: clear the path so extraction recreates the snapshot's type
            # clear anything that is not an existing dir the snapshot also has as a dir: type changes (file <-> dir <-> symlink) and
            # existing files (unlink first — read-only files such as git objects cannot be opened for writing by a non-root agent)
            if os.path.lexists(p) and not (m.isdir() and os.path.isdir(p) and not os.path.islink(p)):
                _rm(p)
        if sys.version_info >= (3, 12):
            tf.extractall(root, filter='tar')
        else:
            tf.extractall(root)
    return len(keep)


def _load(p):
    try:
        return json.load(open(p, encoding='utf-8', errors='replace'))
    except Exception:
        return None


def attempt_info(k):
    r = _load(os.path.join(LOGS, f'response.attempt{k}.json'))
    last = None
    try:
        for line in open(os.path.join(LOGS, f'decisions.attempt{k}.jsonl'), encoding='utf-8', errors='replace'):
            try:
                d = json.loads(line)
            except Exception:
                continue
            if d.get('kind') == 'endturn_resolver':
                last = d.get('detail') or {}
    except OSError:
        pass
    it = ((r or {}).get('metadata') or {}).get('toolCallIterations')
    # FINISHED = the attempt returned a response (no transport/API error) and its end state was snapshotted. The judge's verdict is recorded
    # but not required: configs without the EndTurn resolver still produce finished attempts; a timed-out POST leaves no response.
    finished = bool(r) and not (r or {}).get('error') and os.path.exists(os.path.join(D, f'attempt{k}.manifest'))
    return {'k': k, 'finished': finished, 'iterations': it if isinstance(it, int) else None, 'action': (last or {}).get('action'),
            'model': ((r or {}).get('model') or ((r or {}).get('metadata') or {}).get('model'))}


RUN = re.compile(r'\b(pytest|python3?|node|npm|npx|bash|sh|make|go test|cargo test|ruby|perl)\b')
INSPECT = re.compile(r'^\s*(cat|ls|grep|rg|find|head|tail|sed\s+-n|wc|less|more|git\s+(diff|status|log|show)|echo|pwd|which|file|stat|tree|diff)\b')
MUTATE = re.compile(r'(\bpip3?\s+install|\bapt(-get)?\s|\bnpm\s+(i|install|ci)\b|\bsed\s+-i|\brm\s+-|\bgit\s+(checkout|reset|apply|stash)|\bmv\s|\bcp\s|>\s*[^&]|\btee\b|\bpatch\b|\bchmod\b|\bmkdir\b|\bcurl\b|\bwget\b)')
TESTFILE = re.compile(r'(^/tmp/|/tests?/|test_[^/]*$|_test\.[a-z]+$|check[^/]*$|verif[^/]*$|probe[^/]*$|repro[^/]*$)', re.I)
NORM = [(re.compile(r'\b0x[0-9a-f]+\b'), '0x'), (re.compile(r'\d+(\.\d+)?\s*(s|sec|seconds|ms)\b'), 'T'),
        (re.compile(r'/tmp/[^\s:\'"]+'), '/tmp/X'), (re.compile(r'\bpid[ =]\d+'), 'pid'),
        (re.compile(r'\d{4}-\d\d-\d\dT[\d:.]+Z?'), 'TS'), (re.compile(r'[ \t]+'), ' ')]


def _testlike(path):
    """Test-like file? Paths inside the workspace are judged by their workspace-relative name (the '/tmp/' rule is for scratch files
    written OUTSIDE the workspace; a workspace that itself lives under /tmp must not turn every file into a test file)."""
    ap, cwd = os.path.abspath(path), os.getcwd()
    if ap.startswith(cwd.rstrip('/') + '/'):
        return bool(TESTFILE.search(os.path.relpath(ap, cwd)))
    return bool(TESTFILE.search(path))


def own_checks(k, cap=6):
    """The attempt's final verification: Bash commands after its last source edit that run something (no inspection/mutation), plus the
    final content of test-like files it wrote (materialized before its checks run on a peer's state)."""
    calls = []
    try:
        for line in open(os.path.join(LOGS, f'session.attempt{k}.jsonl'), encoding='utf-8', errors='replace'):
            try:
                r = json.loads(line)
            except Exception:
                continue
            for b in (r.get('message') or {}).get('content') or []:
                if not isinstance(b, dict):
                    continue
                tu = b.get('toolUse') or (b if b.get('type') == 'tool_use' else None)
                if tu and tu.get('name') in ('Bash', 'Edit', 'Write'):
                    calls.append((tu['name'], tu.get('input') or {}))
    except OSError:
        return [], {}
    last_src = max([i for i, (n, inp) in enumerate(calls) if n in ('Edit', 'Write') and not _testlike(inp.get('file_path', ''))], default=-1)
    cmds = []
    for n, inp in calls[last_src + 1:]:
        c = str(inp.get('command', '')).strip() if n == 'Bash' else ''
        if c and not inp.get('run_in_background') and RUN.search(c) and not INSPECT.search(c) and not MUTATE.search(c) and c not in cmds:
            cmds.append(c)
    files = {inp['file_path']: inp.get('content', '') for n, inp in calls if n == 'Write' and inp.get('file_path') and _testlike(inp['file_path'])}
    return cmds[-cap:], files


def _norm(s):
    s = s.strip()
    for rx, rep in NORM:
        s = rx.sub(rep, s)
    return s


def vote(fin, deadline):
    """Cross-run every finished attempt's own checks on every finished attempt's snapshot; score = summed output-cluster sizes."""
    checks = {k: own_checks(k) for k in fin}
    outs = {}
    for j in fin:
        if time.time() > deadline:
            break
        restore(f'attempt{j}')
        for i in fin:
            cmds, files = checks[i]
            for path, content in files.items():
                try:
                    os.makedirs(os.path.dirname(path) or '/', exist_ok=True); open(path, 'w').write(content)
                except OSError:
                    pass
            for n, c in enumerate(cmds):
                if time.time() > deadline:
                    break
                try:
                    p = subprocess.run(['bash', '-lc', c], capture_output=True, text=True, errors='replace', timeout=45)
                    o = (p.stdout or '') + (p.stderr or '')
                except subprocess.TimeoutExpired:
                    o = 'TIMEOUT'
                outs[(i, n, j)] = _norm(o[-1500:])
    score = {j: 0 for j in fin}
    for (i, n) in {(i, n) for i, n, _ in outs}:
        row = {j: outs.get((i, n, j)) for j in fin if (i, n, j) in outs}
        for j, o in row.items():
            score[j] += sum(1 for o2 in row.values() if o2 == o)
    return score, {k: len(v[0]) for k, v in checks.items()}


def pick(policy, n, deadline=None):
    info = [attempt_info(k) for k in range(1, n + 1)]
    fin = [x['k'] for x in info if x['finished']]
    turns = {x['k']: (x['iterations'] if x['iterations'] is not None else 10 ** 6) for x in info}
    extra = {}
    if not fin:
        k, why = 1, 'no attempt finished; keep attempt 1'
    elif policy == 'first':
        k, why = (1, 'attempt 1 finished') if 1 in fin else (min(fin, key=lambda j: (turns[j], j)), 'attempt 1 did not finish')
    elif policy == 'vote' and len(fin) >= 2:
        score, ncheck = vote(fin, deadline or (time.time() + 90))
        k = min(fin, key=lambda j: (-score[j], turns[j], j))
        why = 'vote (ties: fewest turns)'
        extra = {'voteScore': score, 'checksPerAttempt': ncheck}
    else:
        k = min(fin, key=lambda j: (turns[j], j))
        why = 'fewest turns among finished' + ('' if policy == 'turns' else f' ({policy} needs >= 2 finished)')
    out = {'policy': policy, 'attempts': n, 'pick': k, 'why': why, 'finished': fin, 'info': info, **extra}
    json.dump(out, open(os.path.join(LOGS, 'attempts.json'), 'w'), indent=1)
    return k


def merge(n, k):
    rs = {i: _load(os.path.join(LOGS, f'response.attempt{i}.json')) for i in range(1, n + 1)}
    base = rs.get(k) or next((r for r in rs.values() if r), None)
    if base is None:
        return False
    tot, per = {}, []
    for i, r in rs.items():
        s = ((r or {}).get('usage') or {}).get('session') or ((r or {}).get('usage') or {})
        for key, v in s.items():
            if isinstance(v, (int, float)) and not isinstance(v, bool):
                tot[key] = tot.get(key, 0) + v
        per.append({'k': i, 'model': (r or {}).get('model'), 'usage': s,
                    'toolCallIterations': ((r or {}).get('metadata') or {}).get('toolCallIterations')})
    base.setdefault('usage', {})['session'] = tot
    md = base.setdefault('metadata', {})
    md['chosenToolCallIterations'] = md.get('toolCallIterations')
    md['toolCallIterations'] = sum(p['toolCallIterations'] or 0 for p in per)
    md['attempts'] = per
    md['attemptsPick'] = _load(os.path.join(LOGS, 'attempts.json'))
    json.dump(base, open(os.path.join(LOGS, 'response.json'), 'w'))
    return True


# ---- R194 second-attempt CHAIN (TB2_SECOND_ATTEMPT + TB2_SECOND_ATTEMPT_MAX). Trees live in the R194 shadow git (tags lift, attempt1..N);
# these functions only decide (sa-go), select (sa-pick) and merge usage (sa-merge). Files: D/a<k>.json (per-attempt verdict), D/check<k>
# (pass|fail|skipped; absent = none), D/rc<k> (POST rc), D/attempt<k>.tagged (tree committed), LOGS/{response,decisions,session}.attempt<k>.*
SA_GAP = ('accept-with-gap', 'accept-low-confidence')


def last_resolver(path):
    """detail of the LAST endturn_resolver event in a decisions.jsonl ({} when none / unreadable)."""
    last = None
    try:
        for line in open(path, encoding='utf-8', errors='replace'):
            try:
                d = json.loads(line)
            except Exception:
                continue
            if isinstance(d, dict) and d.get('kind') == 'endturn_resolver':
                last = d.get('detail') or {}
    except OSError:
        pass
    return last if isinstance(last, dict) else {}


def _int(v, dflt):
    try:
        return int(str(v).strip())
    except (TypeError, ValueError):
        return dflt


def sa_go(k, decisions, t0=None, dl0=None, now=None, env=None):
    """After attempt k: continue to attempt k+1? Remaining time is measured on the WALL CLOCK against the ORIGINAL deadline (task start
    epoch t0 + original CORTEX_TURN_DEADLINE_MS dl0) — an attempt's own remainingFrac is relative to its own shortened deadline. Writes
    D/a<k>.json and returns it; out['go'] is the decision, out['nextDeadlineMs'] the next attempt's harness deadline (remaining − 5 min)."""
    env = os.environ if env is None else env
    det = last_resolver(decisions)
    dl = _int(dl0 if dl0 is not None else env.get('CORTEX_TURN_DEADLINE_MS'), 0)
    t0 = t0 if t0 is not None else (float(env['TB2_SA_T0']) if str(env.get('TB2_SA_T0') or '').strip() else None)
    now = time.time() if now is None else now
    ev = det.get('remainingFrac')
    try:
        mn = float(env.get('TB2_SECOND_ATTEMPT_MIN_REMAINING') or 0.5)
    except ValueError:
        mn = 0.5
    trig = [x.strip() for x in (env.get('TB2_SECOND_ATTEMPT_TRIGGER') or 'accept-with-gap,accept-low-confidence').split(',') if x.strip()]
    mx = max(0, _int(env.get('TB2_SECOND_ATTEMPT_MAX') or 1, 1))
    elapsed = None
    if t0 is not None and dl > 0:
        elapsed = int((now - t0) * 1000)
        rem_ms = dl - elapsed
    elif k == 1 and isinstance(ev, (int, float)) and dl > 0:  # no start epoch: attempt 1's own frac IS on the original basis
        rem_ms = int(ev * dl)
    else:
        rem_ms = 0
    frac = (rem_ms / dl) if dl > 0 else None
    act = det.get('action')
    act_key = act if act is not None else 'none'  # 2026-10-07: a give-up (no resolver verdict) matches the trigger token 'none'
    if act_key not in trig:
        why = 'action not in trigger set'
    elif frac is None or frac < mn:
        why = 'remaining fraction of the original deadline below minimum'
    elif rem_ms - 300000 < 900000:
        why = 'less than 15 min would remain after the 5 min reserve'
    elif k - 1 >= mx:
        why = 'extra-attempt cap reached'
    else:
        why = 'continue'
    go = why == 'continue'
    out = {'k': k, 'action': act, 'remainingFrac': round(frac, 4) if frac is not None else None, 'eventRemainingFrac': ev,
           'deadlineMs': dl, 'elapsedMs': elapsed, 'remainingMs': rem_ms, 'nextDeadlineMs': max(600000, rem_ms - 300000),
           'namedPassed': det.get('namedPassed') or 0, 'checkPassed': det.get('checkPassed'), 'trigger': trig, 'minRemaining': mn,
           'max': mx, 'extraSoFar': k - 1, 'go': go, 'why': why}
    try:
        os.makedirs(D, exist_ok=True)
        json.dump(out, open(os.path.join(D, f'a{k}.json'), 'w'))
    except OSError:
        pass
    return out


def session_turns(k):
    """Tool-call turns from the attempt's session record: assistant records carrying >= 1 tool_use block (None when absent)."""
    p = os.path.join(LOGS, f'session.attempt{k}.jsonl')
    if not os.path.exists(p):
        return None
    n = 0
    try:
        for line in open(p, encoding='utf-8', errors='replace'):
            try:
                r = json.loads(line)
            except Exception:
                continue
            blocks = (r.get('message') or {}).get('content') if isinstance(r, dict) else None
            if isinstance(blocks, list) and any(isinstance(b, dict) and (b.get('type') == 'tool_use' or b.get('toolUse')) for b in blocks):
                n += 1
    except OSError:
        return None
    return n


def _rank(action):
    return 2 if action == 'accept' else (1 if action in SA_GAP else 0)


def sa_pick(n, chk=None):
    """Select among attempts 1..n: (a) shipped check — when some candidates pass and others do not, keep the passing ones; (b) verdict rank
    accept > accept-with-gap/accept-low-confidence > no finish; (c) FEWEST tool-call turns; (d) more namedPassed; (e) earliest.
    Candidates = attempt 1 (always; the chain only starts from a finished, committed attempt 1) + attempts k >= 2 whose response is
    non-empty, whose judge reached a verdict, and whose tree was committed. Writes LOGS/second-attempt.json; returns the pick."""
    att = []
    for k in range(1, n + 1):
        a = _load(os.path.join(D, f'a{k}.json')) or {}
        det = last_resolver(os.path.join(LOGS, f'decisions.attempt{k}.jsonl')) or {}
        act = det.get('action', a.get('action'))
        np_ = det.get('namedPassed', a.get('namedPassed')) or 0
        rp = os.path.join(LOGS, f'response.attempt{k}.json')
        resp = os.path.exists(rp) and os.path.getsize(rp) > 0
        fin = k == 1 or (resp and act is not None and os.path.exists(os.path.join(D, f'attempt{k}.tagged')))
        try:
            c = open(os.path.join(D, f'check{k}')).read().strip() or 'none'
        except OSError:
            c = 'none'
        r = _load(rp) or {}
        it = (r.get('metadata') or {}).get('toolCallIterations') if isinstance(r, dict) else None
        try:
            rc = open(os.path.join(D, f'rc{k}')).read().strip()
        except OSError:
            rc = None
        att.append({'k': k, 'action': act, 'remainingFrac': a.get('remainingFrac'), 'namedPassed': np_, 'check': c,
                    'iterations': it if isinstance(it, int) and not isinstance(it, bool) else None, 'sessionTurns': session_turns(k),
                    'finished': bool(fin), 'rc': rc})
    cands = [x for x in att if x['finished']]
    # one turn measure for every candidate: toolCallIterations when all have it, else session tool-call turns
    src = 'toolCallIterations' if all(x['iterations'] is not None for x in cands) else 'session'
    for x in att:
        x['turns'] = x['iterations'] if src == 'toolCallIterations' else x['sessionTurns']
    why = []
    unfinished = [x['k'] for x in att if not x['finished']]
    if unfinished:
        why.append('no finish: attempt ' + ','.join(map(str, unfinished)))
    passing = [x for x in cands if x['check'] == 'pass']
    if passing and len(passing) < len(cands):
        cands = passing
        why.append('shipped check passes only on attempt ' + ','.join(str(x['k']) for x in passing))
    # 2026-10-07 (operator): on a verdict tie, FEWEST TURNS decides before the judge's named-check count — r-selector 09-28 measured fewest
    # turns among finished attempts at +1.7 passes [+0.4, +3.1]; the judge's count is the same judge that just accepted a wrong solution.
    steps = (('verdict', lambda x: -_rank(x['action'])), ('fewest tool-call turns', lambda x: x['turns'] if x['turns'] is not None else 10 ** 9),
             ('more judge checks passed', lambda x: -x['namedPassed']), ('earliest attempt', lambda x: x['k']))
    decided = bool(why) and why[-1].startswith('shipped check')
    for label, key in steps:
        if len(cands) <= 1:
            break
        best = min(key(x) for x in cands)
        nxt = [x for x in cands if key(x) == best]
        if len(nxt) < len(cands):
            if label == 'earliest attempt' and not decided:
                why.append('no evidence separates the attempts; earliest')
            else:
                why.append(f'{label} (attempt {nxt[0]["k"]}' + (f', action {nxt[0]["action"]}' if label == 'verdict' else '') + ')')
            decided = True
        cands = nxt
    pick = cands[0]['k'] if cands else 1
    if not decided:
        why.append('only candidate')
    chk = os.environ.get('CHK') if chk is None else chk
    out = {'pick': pick, 'why': '; '.join(why), 'attempts': att, 'turnsSource': src, 'shippedCheck': chk or None}
    for x in att:  # R194 v1 shape (attempt1 / attempt2 keys) kept for existing readers (s2-read.py)
        out[f'attempt{x["k"]}'] = {kk: x[kk] for kk in ('action', 'remainingFrac', 'namedPassed', 'check', 'rc', 'turns')}
    try:
        json.dump(out, open(os.path.join(LOGS, 'second-attempt.json'), 'w'), indent=1)
    except OSError:
        pass
    return pick


def sa_merge(n):
    """response.json = the picked attempt's response with usage.session SUMMED over attempts 1..n (+ usage/metadata.secondAttempt)."""
    rs = [_load(os.path.join(LOGS, f'response.attempt{k}.json')) for k in range(1, n + 1)]
    pk = _load(os.path.join(LOGS, 'second-attempt.json')) or {}
    p = pk.get('pick') if isinstance(pk.get('pick'), int) else 1
    base = (rs[p - 1] if 1 <= p <= n else None) or next((r for r in reversed(rs) if r), None)
    if not isinstance(base, dict):
        return False
    tot = {}
    for r in rs:
        s = (((r or {}).get('usage') or {}).get('session') or {}) if isinstance(r, dict) else {}
        for key, v in s.items():
            if isinstance(v, (int, float)):
                tot[key] = (tot.get(key) if isinstance(tot.get(key), (int, float)) else 0) + v
            elif v is not None and not isinstance(tot.get(key), (int, float)):
                tot[key] = v  # non-numeric: the latest attempt's value
    base.setdefault('usage', {})['session'] = tot
    base['usage']['secondAttempt'] = pk
    base.setdefault('metadata', {})['secondAttempt'] = pk
    json.dump(base, open(os.path.join(LOGS, 'response.json'), 'w'))
    return True


if __name__ == '__main__':
    cmd = sys.argv[1]
    if cmd == 'save':
        print(save(sys.argv[2]))
    elif cmd == 'restore':
        print(restore(sys.argv[2]))
    elif cmd == 'pick':
        dl = float(os.environ['TB2_ATTEMPTS_PICK_DEADLINE']) if os.environ.get('TB2_ATTEMPTS_PICK_DEADLINE') else None
        print(pick(sys.argv[2], int(sys.argv[3]), dl))
    elif cmd == 'merge':
        print(merge(int(sys.argv[2]), int(sys.argv[3])))
    elif cmd == 'sa-go':
        print('1' if sa_go(int(sys.argv[2]), sys.argv[3])['go'] else '0')
    elif cmd == 'sa-pick':
        print(sa_pick(int(sys.argv[2])))
    elif cmd == 'sa-merge':
        print(sa_merge(int(sys.argv[2])))
'''
_MA_SNAPSHOT = (
    'LOGF=/logs/agent/nexus-cortex.txt; MA="${TB2_ATTEMPTS:-0}"; case "$MA" in ""|*[!0-9]*) MA=0;; esac; T0=$(date +%s); AH=/tmp/.cortex-attempts/ah.py; MAM=""; '
    'if [ "$MA" -ge 2 ]; then mkdir -p /tmp/.cortex-attempts && echo "$MA_HELPER_B64" | base64 -d > $AH; '
    '  if [ -z "${CORTEX_TURN_DEADLINE_MS:-}" ] || ! command -v python3 >/dev/null 2>&1; then MA=0; echo "[adapter] TB2_ATTEMPTS: disabled (needs python3 + CORTEX_TURN_DEADLINE_MS)" >> $LOGF; '
    '  elif N0=$(timeout 300 python3 $AH save lift 2>>$LOGF) && [ -n "$N0" ] && [ "$N0" -gt 0 ] 2>/dev/null; then '
    '    if [ -n "${TB2_ATTEMPTS_MODELS:-}${TB2_ATTEMPTS_PROVIDERS:-}" ]; then MAM=$(timeout 90 cortex --json autoresearch arms --width "$MA" --model "$DEFAULT_MODEL_ID" ${TB2_ATTEMPTS_MODELS:+--arm-models "$TB2_ATTEMPTS_MODELS"} ${TB2_ATTEMPTS_PROVIDERS:+--providers "$TB2_ATTEMPTS_PROVIDERS"} --missing-provider-key-policy "${TB2_ATTEMPTS_KEY_POLICY:-platform_fallback}" 2>>$LOGF | python3 -c "import json,sys; print(\' \'.join((a.get(\'model\') or \'-\') for a in json.load(sys.stdin)[\'arms\']))" 2>>$LOGF); fi; '
    '    echo "[adapter] TB2_ATTEMPTS=$MA: snapshot lift ($N0 paths); models: ${MAM:-all $DEFAULT_MODEL_ID}; select=${TB2_ATTEMPTS_SELECT:-turns}" >> $LOGF; '
    '  else MA=0; echo "[adapter] TB2_ATTEMPTS: snapshot FAILED — disabled for this task" >> $LOGF; fi; fi; '
)
_MA_LOOP = (
    'if [ "$MA" -ge 2 ]; then '
    '  for f in session.jsonl decisions.jsonl response.json cortex-server.log; do [ -f /logs/agent/$f ] && cp /logs/agent/$f /logs/agent/${f%.*}.attempt1.${f##*.}; done; '
    '  timeout 300 python3 $AH save attempt1 >/dev/null 2>>$LOGF; K=1; '
    '  DLS=$(( CORTEX_TURN_DEADLINE_MS / 1000 )); RES=${TB2_ATTEMPTS_RESERVE_S:-120}; MIN=${TB2_ATTEMPTS_MIN_S:-240}; '
    '  for k in $(seq 2 "$MA"); do '
    '    LEFT=$(( T0 + DLS - RES - $(date +%s) )); '
    '    if [ "$LEFT" -lt "$MIN" ]; then echo "[adapter] TB2_ATTEMPTS: attempt $k not started (${LEFT}s left < ${MIN}s)" >> $LOGF; break; fi; '
    '    if ! timeout 300 python3 $AH restore lift >/dev/null 2>>$LOGF; then echo "[adapter] TB2_ATTEMPTS: restore lift FAILED — stopping" >> $LOGF; break; fi; '
    # kill by PID, never by pattern (the adapter's own shell argv contains the server text — R194 e2e #2)
    '    kill $SRV 2>/dev/null; sleep 2; kill -9 $SRV 2>/dev/null; sleep 1; '
    '    MK=$(echo "$MAM" | awk -v k=$k "{print \\$k}"); { [ -z "$MK" ] || [ "$MK" = "-" ]; } && MK="$DEFAULT_MODEL_ID"; '
    '    MK="$MK" python3 -c "import json,os; b=json.load(open(\'/tmp/req.json\')); b[\'model\']=os.environ[\'MK\']; json.dump(b, open(\'/tmp/req.attempt.json\',\'w\'))" 2>>$LOGF || cp /tmp/req.json /tmp/req.attempt.json; '
    '    CORTEX_STATE_DIR=/tmp/.cortex-state-$k DEFAULT_MODEL_ID="$MK" CORTEX_TURN_DEADLINE_MS=$((LEFT*1000)) nohup cortex-server > /logs/agent/cortex-server.attempt$k.log 2>&1 & SRV=$!; '
    '    PK=""; for i in $(seq 1 60); do PK=$(grep -oE "running on port [0-9]+" /logs/agent/cortex-server.attempt$k.log 2>/dev/null | grep -oE "[0-9]+" | tail -1); [ -n "$PK" ] && H GET "http://localhost:$PK/health" /dev/null >/dev/null 2>&1 && break; sleep 1; done; [ -z "$PK" ] && PK=4000; '
    '    echo "[adapter] TB2_ATTEMPTS: attempt $k on $MK, port $PK, deadline ${LEFT}s" >> $LOGF; '
    '    H POST "http://localhost:$PK/v1/messages" /tmp/req.attempt.json /logs/agent/response.attempt$k.json $((LEFT+120)) 2>>$LOGF; '
    '    SK=$(find /tmp/.cortex-state-$k -path "*sessions*" -name "*.jsonl" 2>/dev/null | xargs -r ls -t 2>/dev/null | head -1); [ -n "$SK" ] && cp "$SK" /logs/agent/session.attempt$k.jsonl; '
    '    DK=$(find /tmp/.cortex-state-$k -maxdepth 2 -name decisions.jsonl 2>/dev/null | head -1); [ -n "$DK" ] && cp "$DK" /logs/agent/decisions.attempt$k.jsonl; '
    '    [ -s /logs/agent/response.attempt$k.json ] && timeout 300 python3 $AH save attempt$k >/dev/null 2>>$LOGF; K=$k; '
    '  done; '
    '  PICK=$(TB2_ATTEMPTS_PICK_DEADLINE=$(( T0 + DLS - 20 )) timeout 900 python3 $AH pick "${TB2_ATTEMPTS_SELECT:-turns}" $K 2>>$LOGF | tail -1); case "$PICK" in ""|*[!0-9]*) PICK=1;; esac; '
    '  timeout 300 python3 $AH restore attempt$PICK >/dev/null 2>>$LOGF || { PICK=1; timeout 300 python3 $AH restore attempt1 >/dev/null 2>>$LOGF; }; '
    '  timeout 60 python3 $AH merge $K $PICK >/dev/null 2>>$LOGF; '
    '  for f in session.jsonl decisions.jsonl; do [ -f /logs/agent/${f%.*}.attempt$PICK.${f##*.} ] && cp /logs/agent/${f%.*}.attempt$PICK.${f##*.} /logs/agent/$f; done; '
    '  echo "[adapter] TB2_ATTEMPTS pick: $(tr -d "\\n" < /logs/agent/attempts.json 2>/dev/null | cut -c1-600)" >> $LOGF; '
    'fi; '
)

try:  # Harbor >= 0.24: tasks that ship skills require capabilities.skills = True or the agent is refused at start
    from harbor.agents.capabilities import AgentCapabilities as _AgentCapabilities
except Exception:  # older Harbor: no capabilities model — the class attribute is simply unused
    _AgentCapabilities = None


class NexusCortex(BaseInstalledAgent):
    # 2026-10-06: cumulative-layout-shift was refused in all four 10-05 arms ("Agent 'nexus-cortex' does not support skills; configured
    # skills require capabilities.skills = True"). Honest declaration: the run phase copies Harbor's skills_dir into the agent user's
    # $HOME/.cortex/skills (one of the harness Skill tool's search roots — SkillTool.ts: .agents/skills → .cortex/skills → ~/.agents/skills
    # → ~/.cortex/skills), outside the graded workspace, so the skills are discoverable through the harness's native skill tool.
    if _AgentCapabilities is not None:
        capabilities = _AgentCapabilities(skills=True)
    """Run the nexus-cortex harness (`cortex` CLI, headless) as a Harbor agent."""

    # Reward is the task's own verifier; we do not emit an ATIF trajectory.
    SUPPORTS_ATIF: bool = False

    @staticmethod
    @override
    def name() -> str:
        return "nexus-cortex"

    # Inference resolution: the job token rides as a provider key and the proxy
    # base URL routes it. passthrough=True → Harbor forwards these into the
    # task-container agent env without provider-format munging.
    MODEL_CONNECTION = ModelConnectionSpec(
        api_key_envs=_PROVIDER_KEY_ENVS,
        base_url_envs=("CORTEX_PROXY_BASE_URL",),
        passthrough=True,
    )

    @override
    def get_version_command(self) -> str | None:
        return "cortex --version 2>/dev/null | head -1"

    @override
    async def install(self, environment: BaseEnvironment) -> None:
        # cortex is a Node CLI and its undici dep needs Node >= 20 (the `File`
        # global; a distro-default Node 18 crashes at import with
        # "ReferenceError: File is not defined"). ensure_system_dependencies'
        # "nodejs" gives whatever the image ships (often 18), so install a
        # pinned modern Node from the official static tarball (glibc x64 — the
        # terminal-bench task images) and put it first on PATH.
        # 2026-09-11 (tb21-k5-n1 qemu-startup / qemu-alpine-ssh): harbor's ensure_system_dependencies runs a
        # strict `apt-get update && apt-get install …`; on Debian-bullseye task images the bullseye-security
        # Release file is now EXPIRED, so `apt-get update` exits 100 and the agent never starts
        # (NonZeroAgentExitCodeError at ~45 s, 2/89 lost). Both tasks passed on every harness through 4.91.1.
        # Do it ourselves, tolerantly: skip apt when the binaries are already present; otherwise update with
        # Check-Valid-Until off and never let the update step alone fail the install.
        await self.exec_as_root(
            environment,
            command=(
                "set +e; need=''; for b in curl bash git xz; do command -v $b >/dev/null 2>&1 || need=\"$need $b\"; done; "
                "[ -d /etc/ssl/certs ] || need=\"$need ca-certificates\"; "
                'if [ -z "$need" ]; then echo "sysdeps ok (already present)"; exit 0; fi; '
                'echo "sysdeps missing:$need"; '
                "if command -v apt-get >/dev/null 2>&1; then "
                "  export DEBIAN_FRONTEND=noninteractive; "
                "  apt-get -o Acquire::Check-Valid-Until=false -o Acquire::AllowInsecureRepositories=true update >/dev/null 2>&1 || "
                "  echo 'apt-get update failed (expired/insecure Release?) — continuing with the cached index'; "
                # 2026-10-17 HARNESS DEPENDENCY SET (lean, per task container): procps = REAL pgrep/pkill/ps — without pgrep the kill guard
                # silently disables itself (killGuard.ts ensureKillGuardDir returns null) and the c21ba self-kill class returns; file/xxd/strings =
                # the orient inventory's inspection set; poppler-utils = pdftotext; jq/zip/unzip; lsof + iproute2 (ss) = port checks; ripgrep =
                # the narrow frame's searcher + sgrep's dependency. Heavy optionals (imagemagick for ReadImage's `convert` path when python3 has no
                # PIL, tesseract-ocr, ffmpeg for the H264 stream encoder) ride only on TB2_EXTRA_PKGS (space-separated, apt names).
                f"  apt-get install -y --no-install-recommends curl bash git xz-utils ca-certificates tmux ripgrep procps file xxd binutils poppler-utils jq zip unzip lsof iproute2 {os.environ.get('TB2_EXTRA_PKGS', '')} || true; "  # ripgrep (2026-10-17): `rg` for the narrow bash+edit frame + sgrep's dependency  # tmux (2026-09-13): 12 of 62 TB4.0 task images lack it; the harness's persistent sessions + process artifacts need the binary (R134 is only the fallback)
                f"elif command -v apk >/dev/null 2>&1; then apk add --no-cache curl bash git xz ca-certificates tmux ripgrep procps file xxd binutils poppler-utils jq zip unzip lsof iproute2 {os.environ.get('TB2_EXTRA_PKGS', '')} || true; "
                f"elif command -v dnf >/dev/null 2>&1; then dnf install -y curl bash git xz ca-certificates tmux ripgrep procps-ng file vim-common binutils poppler-utils jq zip unzip lsof iproute {os.environ.get('TB2_EXTRA_PKGS', '')} || true; "
                f"elif command -v yum >/dev/null 2>&1; then yum install -y curl bash git xz ca-certificates tmux ripgrep procps-ng file vim-common binutils poppler-utils jq zip unzip lsof iproute {os.environ.get('TB2_EXTRA_PKGS', '')} || true; fi; "
                "miss=''; for b in curl bash git xz; do command -v $b >/dev/null 2>&1 || miss=\"$miss $b\"; done; "
                # Debian 11 (bullseye) left LTS on 2026-08-31: deb.debian.org's bullseye-security index is expired
                # and its packages 404 (the qemu-* TB2.1 images). Repoint to the archive mirror and retry once.
                'if [ -n "$miss" ] && command -v apt-get >/dev/null 2>&1; then '
                '  echo "sysdeps still missing:$miss — repointing apt to archive.debian.org and retrying"; '
                "  for f in /etc/apt/sources.list /etc/apt/sources.list.d/*.list /etc/apt/sources.list.d/*.sources; do [ -f \"$f\" ] || continue; "
                "    sed -i -e 's|http://deb.debian.org/debian-security|http://archive.debian.org/debian-security|g' "
                "           -e 's|http://security.debian.org/debian-security|http://archive.debian.org/debian-security|g' "
                "           -e 's|http://security.debian.org|http://archive.debian.org/debian-security|g' "
                "           -e 's|http://deb.debian.org/debian|http://archive.debian.org/debian|g' "
                "           -e 's|https://deb.debian.org/debian|http://archive.debian.org/debian|g' \"$f\"; done; "
                "  apt-get -o Acquire::Check-Valid-Until=false -o Acquire::AllowInsecureRepositories=true update >/dev/null 2>&1 || true; "
                # the archive's perl-base is newer than the image's perl → apt refuses git unless perl moves too
                "  apt-get -o Acquire::Check-Valid-Until=false -o Dpkg::Options::=--force-confold install -y --no-install-recommends perl perl-base perl-modules-5.32 libperl5.32 curl bash git xz-utils ca-certificates || "
                "  apt-get -o Acquire::Check-Valid-Until=false -o Dpkg::Options::=--force-confold install -y --no-install-recommends --fix-broken curl bash git xz-utils ca-certificates || true; "
                "  miss=''; for b in curl bash git xz; do command -v $b >/dev/null 2>&1 || miss=\"$miss $b\"; done; fi; "
                # Best-effort only (v4): the node step below fetches with curl|wget|python3|perl and unpacks a .tar.gz, and
                # the harness itself needs none of these binaries — so a package-manager failure must never kill the run.
                'if [ -n "$miss" ]; then echo "sysdeps still missing:$miss — continuing best-effort (node step has its own fetch fallbacks)"; fi; exit 0'
            ),
            timeout_sec=300,
        )
        node_ver = "v20.18.1"
        await self.exec_as_root(
            environment,
            command=(
                "set -e; "
                f"NODE={node_ver}; "
                # 2026-09-12 (TB4.0 bun-sourcemap-leak, empty session): the oven/bun image ships a BUN SHIM named `node`
                # (/usr/local/bun-node-fallback-bin/node) that reports a node version >= 20 but has NO npm — the old check
                # said "node ok", skipped the real install, and `npm install -g nexus-cortex` failed → no cortex-server.
                # Real node = major >= 20 AND npm resolves AND process.versions.bun is undefined.
                'if node -e "process.exit(((process.versions.node.split(\'.\')[0]|0)>=20 && typeof process.versions.bun===\'undefined\')?0:1)" 2>/dev/null && command -v npm >/dev/null 2>&1; then '
                '  echo "node ok: $(node -v) npm=$(command -v npm)"; '
                "else "
                '  ARCH=x64; '
                '  if ldd /bin/ls 2>/dev/null | grep -qi musl; then LIBC=musl; else LIBC=linux; fi; '
                '  URL="https://nodejs.org/dist/$NODE/node-$NODE-$LIBC-$ARCH.tar.gz"; '
                '  T=/tmp/node.tgz; rm -f $T; '
                # 2026-09-23: the box serves the node tarballs over the docker bridge (bootstrap-executor.sh builds /root/pkgs);
                # try it first — three payments rows were lost to in-container fetches — then fall back to nodejs.org unchanged.
                + _PKG_CACHE_DISC +
                '  for h in $PKG_HOSTS; do [ -n "$h" ] || continue; curl -fsS -m 60 "http://$h:$PKG_PORT/node-$NODE-$LIBC-$ARCH.tar.gz" -o $T 2>/dev/null && [ -s $T ] && { echo "node tarball from box cache ($h)" >> /logs/agent/nexus-cortex.txt 2>/dev/null || true; break; }; rm -f $T; done; '
                '  if [ -s $T ]; then :; '
                '  elif command -v curl >/dev/null 2>&1; then curl -fsSL "$URL" -o $T; '
                '  elif command -v wget >/dev/null 2>&1; then wget -qO $T "$URL"; '
                '  elif command -v python3 >/dev/null 2>&1; then python3 -c "import urllib.request,sys; urllib.request.urlretrieve(sys.argv[1], sys.argv[2])" "$URL" $T; '
                '  elif command -v perl >/dev/null 2>&1; then perl -MLWP::Simple -e "getstore(\$ARGV[0], \$ARGV[1]) == 200 or exit 1" "$URL" $T; '
                '  else echo "no fetcher (curl/wget/python3/perl) for node" >&2; exit 1; fi; '
                '  tar -xzf $T -C /opt; rm -f $T; '
                '  ln -sf /opt/node-$NODE-$LIBC-$ARCH/bin/node /usr/local/bin/node; '
                '  ln -sf /opt/node-$NODE-$LIBC-$ARCH/bin/npm /usr/local/bin/npm; '
                '  ln -sf /opt/node-$NODE-$LIBC-$ARCH/bin/npx /usr/local/bin/npx; '
                '  hash -r; echo "node installed: $(node -v)"; '
                "fi"
            ),
            timeout_sec=300,
        )
        # 🔴 VERSION PIN (k=5 stability): harbor's -a version arg (self._version) is
        # never passed by our supervisors, so installs floated to LATEST — a publish
        # mid-run would silently switch the harness under a live benchmark. Fall back
        # to TB2_HARNESS (e.g. "nexus-cortex@4.88.0"), which the fanout already sets
        # as the run's provenance tag and the supervisor env carries into harbor.
        # Explicit harbor version arg still wins; no tag anywhere = latest (dev mode).
        _env_pin = os.environ.get("TB2_HARNESS", "")
        _env_ver = _env_pin.rsplit("@", 1)[1] if "@" in _env_pin else ""
        # R262 / P1: a bare CORTEX_FEATURES_FILE = a payload the box package cache serves under features/<name>; fetched here (install runs
        # as root), readable by the image user; a miss is logged and leaves the library without a payload — the effective_config gate then
        # fails loudly on the absent CORTEX_FEATURES_HASH instead of a silent control.
        _feat_name = (os.environ.get("CORTEX_FEATURES_FILE") or "").strip()
        _feat_name = _feat_name if _feat_name and "/" not in _feat_name and all(c.isalnum() or c in "._-" for c in _feat_name) else ""
        # 2026-10-17 SEARCH TOOLING (10-18: release-store sourced): `sgrep` served from the box package cache (the bootstrap downloads the
        # pinned github.com/Spitfire-Products/cortex-tools release, sha256-checked) lands in /usr/local/bin so the model can call it from
        # Bash; the orient scaffold advertises it when present. The model cache rides along into /root/.cache so the first search never
        # downloads 32 MB inside the task. Fail-soft: no file = no change.
        _sgrep_cmd = ('for h in $PKG_HOSTS; do [ -n "$h" ] || continue; '
                      'if curl -fsS -m 60 "http://$h:$PKG_PORT/bin/sgrep" -o /usr/local/bin/sgrep 2>/dev/null && [ -s /usr/local/bin/sgrep ]; then '
                      'chmod a+rx /usr/local/bin/sgrep; echo "sgrep from box cache ($h)" | tee -a /logs/agent/nexus-cortex.txt; '
                      'mkdir -p /root/.cache && curl -fsS -m 120 "http://$h:$PKG_PORT/sgrep-model-cache.tgz" -o /tmp/sgrep-cache.tgz 2>/dev/null && tar xzf /tmp/sgrep-cache.tgz -C /root/.cache 2>/dev/null && chmod -R a+rX /root/.cache/huggingface 2>/dev/null && echo "sgrep model cache from box cache ($h)" | tee -a /logs/agent/nexus-cortex.txt; rm -f /tmp/sgrep-cache.tgz; '
                      'break; else rm -f /usr/local/bin/sgrep; fi; done; ')
        _feat_cmd = ((f'FEAT="{_feat_name}"; mkdir -p /usr/local/share; FOK=0; for h in $PKG_HOSTS; do [ -n "$h" ] || continue; '
                      'if curl -fsS -m 60 "http://$h:$PKG_PORT/features/$FEAT" -o /usr/local/share/cortex-features.json 2>/dev/null && [ -s /usr/local/share/cortex-features.json ]; then '
                      'chmod a+r /usr/local/share/cortex-features.json; FOK=1; echo "features payload from box cache ($h): $FEAT" | tee -a /logs/agent/nexus-cortex.txt; break; fi; done; '
                      '[ "$FOK" = 1 ] || echo "WARN: features payload $FEAT not served by any box cache host — no payload" | tee -a /logs/agent/nexus-cortex.txt; ')
                     if _feat_name else "")
        pin = f"@{self._version}" if self._version else (f"@{_env_ver}" if _env_ver else "")
        # --prefix /usr/local so the `cortex` bin lands on PATH (the tarball
        # node's default global prefix is /opt/... which is NOT on PATH → run()
        # got "cortex: command not found"). Verify node>=20 + cortex resolve so
        # a broken install fails install() loudly instead of at run time.
        await self.exec_as_root(
            environment,
            command=(
                # 2026-09-12 (TB4.0 VM restart, first wave 5 min after a publish): a transient registry/CDN miss left `cortex`
                # absent and every task banked reward 0 with ZERO tokens and NO exception (the adapter exited 0). Retry the
                # install with backoff and FAIL LOUDLY if the binary is still missing, so harbor records an errored trial
                # (infra-DNF, requeued by the supervisor's done-set) instead of a silent capability fail.
                # 2026-09-23: FIRST try the box's prebuilt global-prefix bundle (nexus-cortex@PIN with its whole dependency tree, built
                # once per box by bootstrap-executor.sh and served over the docker bridge) — no registry access inside the container.
                # L7+L8: `npm install -g nexus-cortex@PIN` failed after 3 retries in the payments image on both cells (3/42 rows RIG).
                _PKG_CACHE_DISC +
                f'PINV="{_env_ver or ""}"; [ -n "$PINV" ] || PINV="{(self._version or "")}"; '
                'if [ -n "$PINV" ]; then for h in $PKG_HOSTS; do [ -n "$h" ] || continue; '
                '  if curl -fsS -m 120 "http://$h:$PKG_PORT/cortex-prefix-$PINV.tgz" -o /tmp/cortex-prefix.tgz 2>/dev/null && [ -s /tmp/cortex-prefix.tgz ]; then '
                '    mkdir -p /usr/local && tar -xzf /tmp/cortex-prefix.tgz -C /usr/local && rm -f /tmp/cortex-prefix.tgz && hash -r; '
                '    if command -v cortex >/dev/null 2>&1 && command -v cortex-server >/dev/null 2>&1; then echo "harness from box cache ($h): nexus-cortex@$PINV" | tee -a /logs/agent/nexus-cortex.txt 2>/dev/null || true; break; fi; fi; '
                'done; fi; '
                "for i in 1 2 3; do "
                "  command -v cortex >/dev/null 2>&1 && command -v cortex-server >/dev/null 2>&1 && break; "
                f"  npm install -g --prefix /usr/local nexus-cortex{pin} 2>&1 | tail -8; "
                "  hash -r; command -v cortex >/dev/null 2>&1 && command -v cortex-server >/dev/null 2>&1 && break; "
                '  echo "harness install attempt $i failed (cortex/cortex-server missing) — retrying in 20s"; sleep 20; '
                "done; "
                f"{_sgrep_cmd}"
                f"{_feat_cmd}"
                # 2026-09-25 (R196): harbor runs install as ROOT and the agent phase as the image USER. Two TB4.0 images run as a
                # non-root user (risk-scorer-replay = nobody, rs-archive-clone = agent); the cache lines above created
                # /logs/agent/nexus-cortex.txt root-owned, every `>>` in the run phase then fails as a redirection error and bash
                # SKIPS the command that carries it — including the /v1/messages POST → 0 tokens, 2-s agent phase, no exception
                # (6/6 rows across five cells 09-24/25). Make the agent log dir + files writable by any user before the run phase.
                "chmod -R a+rwX /logs/agent 2>/dev/null || true; "
                'echo "node=$(node -v) cortex=$(command -v cortex || echo MISSING) cortex-server=$(command -v cortex-server || echo MISSING)"; '
                'command -v cortex-server >/dev/null 2>&1 || { echo "FATAL: nexus-cortex install failed after 3 attempts"; exit 1; }'
            ),
            timeout_sec=600,
        )

    @override
    async def run(
        self, instruction: str, environment: BaseEnvironment, context: AgentContext
    ) -> None:
        model = self.model_name or "deepseek-flash"

        # Inference env — mirror the autoresearch userFundedExports recipe:
        # forward CORTEX_PROXY_BASE_URL + whatever provider-key envs Harbor's
        # own environment carries (job token on the keyed path).
        env: dict[str, str] = {}
        proxy = os.environ.get("CORTEX_PROXY_BASE_URL")
        if proxy:
            env["CORTEX_PROXY_BASE_URL"] = proxy
        for k in _PROVIDER_KEY_ENVS:
            v = os.environ.get(k)
            if v:
                env[k] = v
        # R173b (2026-09-20): the TypeSafe Jev key for the judge's typed gap-hold gate (CORTEX_JUDGE_GAP_HOLD_JEV=shadow|gate).
        # Not a provider key (never a job token); forwarded verbatim when the executor env carries it.
        if os.environ.get("TYPESAFE_API_KEY"):
            env["TYPESAFE_API_KEY"] = os.environ["TYPESAFE_API_KEY"]

        # ── Optimal harness config for the benchmark run ──────────────────────
        # The deepseek-v4-flash card ALREADY auto-applies the P6 winners
        # (anchorProfile=bash-edit + promptPreset=boot-minimal); CORTEX_TOOL_ANCHOR
        # is set redundantly so the narrow door is unambiguous even if the seed
        # card is overridden. The budgets + fetch timeout are set EXPLICITLY so
        # the run does not inherit a stale/low container default that would cut
        # the agent short on hard tasks:
        env["CORTEX_TOOL_ANCHOR"] = "bash-edit"
        env["DEFAULT_MODEL_ID"] = model
        # R64 optimal loop budgets: a high iteration failsafe + the shipped soft
        # brake (pathology is caught by loop-detection/error-breaker, not by a
        # low cap). Caps are failsafes, not work limits.
        env["MAX_TOOL_ITERATIONS"] = "1000"
        env["TOOL_BUDGET_SOFT"] = "400"
        # 🔴 THE GUARD STACK (restored 2026-08-31 — CONFIG AUDIT finding): these 7
        # lines were hardcoded in the v7-v9 adapters (the TB2.0 optimal-config era,
        # 4.71-4.81) and SILENTLY DROPPED in the A'-era rewrite (~4.84) — every run
        # from the A' matrix through TB2.1 n=1 ran guardless, and TB2.1's failure
        # distribution maps ~1:1 onto the missing guards (retry_loop 65-74% of
        # fails <-> neardup breaker; busy-wait doctrine violations <-> poll guard;
        # premature finishes <-> surrender nudge). MAX_CONSECUTIVE_ERRORS=6 also
        # fixes the active regression to the blunt code-default 3. This block is
        # the guards' ONLY delivery vehicle in containers (no .env pre-4.88).
        # See .bench/tb21/CONFIG_AUDIT_2026-08-31.md before removing ANY line.
        # R155 (2026-09-16, tb4-flash-v3 nextjs-performance): keep the harness's runtime state OUT of the task's working tree, so
        # a model running `git add -A` / `git checkout <rev> --` / `git clean -fdx` in /app can never commit or clobber the live
        # session file. /tmp is writable for every task user (some tasks run the agent unprivileged: risk-scorer-replay EACCES on
        # /app). The session copier below searches this path first.
        env["CORTEX_STATE_DIR"] = "/tmp/.cortex-state"
        # R239 / P4: the library chain banks its per-attempt artifacts where harbor collects them (same names the adapter chain used)
        env.setdefault("CORTEX_SECOND_ATTEMPT_OUT_DIR", "/logs/agent")
        # 2026-10-18: the public CLI auto-installs sgrep/rg from GitHub releases on startup; bench containers get the same binaries from the
        # box package cache (sgrep) and apt (ripgrep) — no per-task GitHub download, no behaviour difference in what is on PATH.
        env.setdefault("CORTEX_TOOLS_AUTO_INSTALL", "off")
        env["CORTEX_BASH_PIPEFAIL"] = "true"
        env["CORTEX_TASK_INTEGRITY"] = "true"
        env["CORTEX_POLL_GUARD"] = "true"
        env["CORTEX_ENDTURN_INTEGRITY"] = "true"
        env["CORTEX_SURRENDER_NUDGE"] = "true"
        env["MAX_CONSECUTIVE_ERRORS"] = "6"
        env["CORTEX_NEARDUP_BREAKER"] = "true"
        # Never let the CLI's fetch self-cut before harbor's per-task timeout
        # (task.toml, typically 900s) governs — give the agent the full budget.
        env["CORTEX_CLIENT_FETCH_TIMEOUT_MS"] = str(CEILING_S * 1000)  # above the largest task budget (TB2.1 12000 s; TB4.0 28800 s) — was 12600000
        # Headless server should not linger after the task.
        # (CORTEX_IDLE_TIMEOUT removed 2026-09-02: nothing reads it — the server knob is SERVER_IDLE_TIMEOUT)
        # Match the autoresearch harness (startServer): keep the server's own
        # auto-record (flat-75 stub) out of the shared experiment store — the
        # bench's grade is the only record that counts.
        env["MODEL_ROUTER_RECORD"] = "false"
        # 🔴 NEVER let a bench task container canon-sync. The sandbox WORKER stamps
        # CANON_AUTO_SYNC=1 + CANON_REPO + GH_TOKEN into every keyed/admin exec
        # (harnessEnv, index.ts) — with auto-sync on and no store present, the
        # harness FULL-CLONES the multi-GB canon store into container storage
        # (storage-GB-hours billing) and could push bench noise into the user's
        # canon repo. This env dict is built clean (no os.environ inherit) so the
        # stamp does not reach cortex-server today — this line makes that a
        # GUARANTEE rather than an accident of construction (2026-09-01).
        env["CANON_AUTO_SYNC"] = "false"
        # 🔴 CRITICAL: do NOT set CORTEX_PROMPT_MASS here. Setting it to ANY value
        # (incl. 'defer') disables boot-minimal's ~400B replacement prompt
        # (SystemMessageMiddleware gates presetPrompt on `!envMass`) and falls back
        # to the full ~4.5KB SYSTEM_PROMPT.md — which makes deepseek deliberate
        # instead of act (proven: sysMsg 659B→acts vs 4529B→reasons-to-wall). The
        # card's promptPreset='boot-minimal' is the dsh narrow-door frame that
        # forces action; leave CORTEX_PROMPT_MASS UNSET so the card preset applies.
        # Prompt-mass A/B lever (passthrough): deepseek's card preset is
        # boot-minimal ('minimal' mass = full static corpus dropped for the whole
        # session). Set CORTEX_PROMPT_MASS in the harbor runner's env to override
        # for an arm — 'defer' = minimal turn-1 frame + the full corpus appended
        # ONCE at the anchor-lift boundary (full knowledge after act 1, cheap on
        # turn 1); 'full' = full corpus from turn 1. Unset = card default (minimal).
        _pm = os.environ.get("CORTEX_PROMPT_MASS")
        if _pm:
            env["CORTEX_PROMPT_MASS"] = _pm
        # Arm-lever passthrough (A/A′/B matrix): forward experiment flags set in the
        # harbor runner's env into the cortex-server env (first-wins over the card /
        # container global ~/.cortex/.env). Empty/unset = leave to the card default.
        #   CORTEX_LIFT_NUDGE / CORTEX_HEADLESS_DROP_ASKUSER = A′ deferred refinements
        #   ENABLE_DEFERRED_TOOL_LOADING = arm B sets 'false' (57 tools, same prompt)
        #   MENTORSHIP_ENABLED / MENTORSHIP_HELPER_MODEL = mentor arm config
        #   CORTEX_MENTOR_FORCE = v2 forced-tool_choice master gate (efficacy A/B treatment arm)
        for _k in (
            "CORTEX_LIFT_NUDGE",
            "CORTEX_HEADLESS_DROP_ASKUSER",
            "ENABLE_DEFERRED_TOOL_LOADING",
            "MENTORSHIP_ENABLED",
            "MENTORSHIP_HELPER_MODEL",
            "CORTEX_MENTOR_REASONING",  # mentor thinking on|none (HB-MENTOR-THINKING 2026-09-10)
            "CORTEX_MENTOR_CONSULT_REASONING", "CORTEX_MENTOR_TEMPERATURE",  # mentor role (training/mentorRole.ts)
            "CORTEX_MENTOR_EFFORT",
            "CORTEX_MENTOR_REASONING_ALLOWANCE",
            "CORTEX_MENTOR_THINKING_TIMEOUT_MS",
            "CORTEX_LIFT_PLAN_REASONING",
            "CORTEX_LIFT_PLAN_DOCTRINE",
            "CORTEX_ENDTURN_TIER",
            # DSH-MINIMAL profile (2026-09-11, operator): the arm env may override the adapter's narrow-door
            # defaults (anchor, iteration cap) and select the bash-plus tool profile + a one-line system prompt.
            "CORTEX_DSH_MINIMAL", "CORTEX_TOOL_PROFILE", "CORTEX_TOOL_ANCHOR", "MAX_TOOL_ITERATIONS", "CORTEX_SYSTEM_PROMPT_FILE",
            "CORTEX_SLASH_COMMAND_HINT", "CORTEX_GIT_CONTEXT", "CORTEX_ORIENT_BOOTSTRAP", "CORTEX_SURRENDER_NUDGE", "CORTEX_POLL_GUARD",
            "CORTEX_NEARDUP_BREAKER", "CORTEX_SLICE_NUDGE", "CORTEX_DEADLINE_EXIT_MENTOR", "CORTEX_ENDTURN_GATE", "CORTEX_ENDTURN_RESOLVER",
            "CORTEX_LIFT_PLAN", "CORTEX_LOOP_TOOL_BLOCK", "CORTEX_EMPTY_TURN_CONTINUE", "CORTEX_ACTION_EFFORT",
            "CORTEX_ENDTURN_RESOLVER_REASONING",
            # 2026-09-17: R166 judge veto policy + HB-TURN-CONTRACT channel frame + R153 backoff levers (pilot-12 arms)
            "CORTEX_JUDGE_VETO", "CORTEX_JUDGE_EVIDENCE_MAX_VETOES", "CORTEX_TURN_CONTRACT", "CORTEX_EFFORT_RAMP", "CORTEX_COMPUTE_NUDGE", "CORTEX_COMPUTE_NUDGE_TOKENS", "CORTEX_COMPUTE_NUDGE_COOLDOWN", "CORTEX_COMPUTE_NUDGE_MAX", "CORTEX_REASONING_EXHAUST_LADDER", "CORTEX_WALL_DROP", "CORTEX_OUTPUT_CAP_TOKENS", "CORTEX_HTTP_TIMEOUT_MS", "CORTEX_WALL_RETRY_LADDER", "CORTEX_WALL_FORCE_ACTION_AT", "CORTEX_WALL_SUMMARY", "CORTEX_WALL_SUMMARY_TIMEOUT_MS", "CORTEX_REASONING_EXHAUST_BACKOFF",
            "CORTEX_FINISH_CONFIRM", "CORTEX_FINISH_CONFIRM_MIN_REMAINING", "CORTEX_FINISH_CONFIRM_MAX",  # R167 (pilot-12 rerun)
            "CORTEX_MEETS_CONFIRM", "CORTEX_MEETS_CONFIRM_MIN_REMAINING",  # R168 (pilot-12 rerun 2)
            "CORTEX_TURN_CONTRACT_ENFORCE", "CORTEX_TURN_CONTRACT_ENFORCE_MAX",  # HB-TURN-CONTRACT-ENFORCE
            # 2026-10-03: R208-R214 + R210 plateau family — were MISSING, so v41b/v43a/v43b ran with them OFF (code default).
            "CORTEX_VERIFY_SCALE", "CORTEX_PID1_GUARD", "CORTEX_PLATEAU_STOP", "CORTEX_PLATEAU_WINDOW", "CORTEX_PLATEAU_REL",
            "CORTEX_PLATEAU_MIN_POINTS", "CORTEX_RULE_INPUTS", "CORTEX_RULE_INTERP", "CORTEX_RULE_HOLDOUT", "CORTEX_RULE_INDEP",
            # 2026-10-03 (g6rs forward-gate FAIL): the 10-02 transport/cache levers were never on this list
            "CORTEX_ANTHROPIC_EFFORT", "CORTEX_ANTHROPIC_HISTORY_CACHE", "CORTEX_GEMINI_TOOLS_THINKING", "CORTEX_OPENAI_CACHE_KEY", "CORTEX_PERSIST_INJECTED", "CORTEX_RESPONSES_INLINE_REMINDERS", "CORTEX_CHAT_REMINDERS_TO_SYSTEM", "CORTEX_LIFT_PLAN_MODEL", "CORTEX_ENDTURN_RESOLVER_MODEL", "CORTEX_DEADLINE_EXIT_MENTOR_MODEL", "CORTEX_LOOP_TOOL_BLOCK_MODEL", "CORTEX_MENTOR_CONSULT_MODEL", "CORTEX_RESPONSES_SLICE_ALL", "CORTEX_RESPONSES_STOP_REASON",
            "CORTEX_JUDGE_TOOL_ROUNDS", "CORTEX_JUDGE_TOOL_ROUND_BUDGET_MS",  # R170
            "CORTEX_JUDGE_TOOL_AUTOLOOP",  # R170b
            "CORTEX_LIFT_PLAN_TOOL_ROUNDS", "CORTEX_LIFT_PLAN_TOOL_ROUND_BUDGET_MS",  # R171
            "CORTEX_ACTION_PLAN_FIELDS",  # R172
            "CORTEX_JUDGE_GAP_HOLD", "CORTEX_JUDGE_GAP_HOLD_JEV", "CORTEX_JUDGE_GAP_HOLD_JEV_MIN",  # R173 / R173b
            "CORTEX_JUDGE_SPEC_TESTS", "CORTEX_JUDGE_SPEC_TESTS_MAX",  # R174
            "CORTEX_JUDGE_SPEC_TESTS_SAMPLES", "CORTEX_JUDGE_SPEC_VETO_FRAC",  # R174d
            "CORTEX_JUDGE_SPEC_TEXT",  # R174e
            "CORTEX_ENDTURN_REQ_COVERAGE",  # Stage 4f (2026-09-27)
            "CORTEX_TOOL_DOCTRINE",  # doctrine edits (2026-09-28)
            "CORTEX_JUDGE_VETO_MIN_REMAINING", "CORTEX_JUDGE_GAP_HOLD_MIN_INTERVAL_MS", "CORTEX_JUDGE_GAP_HOLD_PLAN_MAX_SIMILARITY",  # R173c
            "CORTEX_JUDGE_SPEC_REPEAT_MAX", "CORTEX_JUDGE_SPEC_TESTS_AT",  # R174b
            "CORTEX_JUDGE_INDEPENDENT_DERIVATION", "CORTEX_JUDGE_INDEPENDENT_DERIVATION_TOL",  # R176
            "CORTEX_JUDGE_REQ_LEDGER", "CORTEX_JUDGE_REQ_LEDGER_MAX", "CORTEX_JUDGE_REQ_LEDGER_HOLD_MAX", "CORTEX_JUDGE_REQ_LEDGER_JEV", "CORTEX_JUDGE_REQ_LEDGER_JEV_MIN",  # R187/R187b
            "CORTEX_JUDGE_REQ_LEDGER_FAIL_VETO", "CORTEX_JUDGE_REQ_LEDGER_FAIL_VETO_MAX", "CORTEX_JUDGE_REQ_LEDGER_FAIL_VETO_MIN_REMAINING", "CORTEX_JUDGE_REQ_LEDGER_FAIL_JEV", "CORTEX_JUDGE_REQ_LEDGER_FAIL_JEV_MIN",  # R192
            "CORTEX_FRAME", "CORTEX_FRAME_CHOOSER", "CORTEX_FRAME_CANDIDATES", "CORTEX_FRAME_WAIT_CAP_S", "CORTEX_FRAME_SCREEN_LINES", "CORTEX_FRAME_CONTRACT_EXTRA", "CORTEX_FRAME_KEY_GUARD", "CORTEX_FRAME_MIN_CANDIDATES", "CORTEX_FRAME_AUTHOR", "CORTEX_FRAME_AUTHOR_MODEL", "CORTEX_FRAME_AUTHOR_WHEN",  # R179/R178/R182/R184/R185/R186/R188
            "CORTEX_REASONING_EXHAUST_BACKOFF", "CORTEX_REASONING_EXHAUST_BACKOFF_TURNS",
            "CORTEX_DEADLINE_EXIT_MENTOR_REASONING",
            "CORTEX_LOOP_TOOL_BLOCK_REASONING", "CORTEX_ASK_FOR_ADVICE",  # mentor effort A/B lever + consult-tool off switch
            "HELPER_MODEL_ID",  # helper middleware (compaction/summary) model — 2026-09-10 pro sunset: bench pins deepseek-flash
            "CORTEX_MENTOR_FORCE",
            # Auto-consult retry-loop breaker (4.88): orchestrator self-consults
            # the mentor on cumulative thrash and injects the hint — the
            # DeepSeek-safe delivery (forced tool_choice is provider-unreliable).
            "CORTEX_MENTOR_AUTO",
            # Ablation rung 1: fixed self-interrogation instead of the helper call.
            "CORTEX_MENTOR_TEMPLATE",
            # Effort pulse (think-harder ablation arm, 4.88.2).
            "CORTEX_EFFORT_PULSE",
            "CORTEX_EFFORT_PULSE_TURNS",
            "CORTEX_EFFORT_PULSE_LEVEL",
            "CORTEX_EFFORT_TAIL",
            "CORTEX_EFFORT_TAIL_TURNS",
            "ENABLE_WEBTOOLS",
            "VISION_HELPER_MODEL",
            "TOOL_TIMEOUT_MODE",
            "VISION_HANDOFF_MAX",
            "CORTEX_ORIENT_BOOTSTRAP",
            "CORTEX_ORIENT_V2",  # orient v2 (dark, 2026-09-27)
            "CORTEX_INVENTORY", "CORTEX_STEER_INPUTS",  # canonical inventory + steering-input sizing (dark, 2026-09-29)
            "CORTEX_TURN_STATUS",  # HB-TURN-STATUS: per-round STATUS tail (elapsed/context/bg shells) on every tool result (dark, 2026-09-29)
            "CORTEX_WORKSPACE_CLEAN",  # harness writes nothing into the task tree (dark, 2026-09-29)
            "CORTEX_ORIENT_BASELINE", "CORTEX_LIFT_PLAN_SCOPE",  # edit-scope + workspace baseline (dark, 2026-09-27)
            "CORTEX_SLICE_NUDGE",
            # #2 (2026-09-04): per-turn wall-clock deadline (ms). The supervisor sets it per task
            # to ~90% of the task's own budget so the harness converges BEFORE Harbor's timeout kills
            # it with zero deliverable (the loop-killed grinders that drove the run's real cost).
            "CORTEX_TURN_DEADLINE_MS",
            "TB2_SECOND_ATTEMPT", "TB2_SECOND_ATTEMPT_MIN_REMAINING", "TB2_SECOND_ATTEMPT_TRIGGER", "TB2_SECOND_ATTEMPT_MAX",  # R194 (bench-side second-attempt chain)
            # R239 / P4 (2026-10-07): the SAME chain inside the LIBRARY (nexus-cortex >= 4.124.63, non-streaming /v1/messages). When
            # CORTEX_SECOND_ATTEMPT is set the adapter's own chain above STANDS DOWN (one chain per task, never both) and the library banks
            # the per-attempt artifacts into CORTEX_SECOND_ATTEMPT_OUT_DIR (= /logs/agent, set below) under the adapter's file names.
            "CORTEX_SECOND_ATTEMPT", "CORTEX_SECOND_ATTEMPT_MAX", "CORTEX_SECOND_ATTEMPT_MIN_REMAINING", "CORTEX_SECOND_ATTEMPT_TRIGGER",
            "CORTEX_SECOND_ATTEMPT_RESERVE_MS", "CORTEX_SECOND_ATTEMPT_FLOOR_MS", "CORTEX_SECOND_ATTEMPT_OUT_DIR",
            "CORTEX_SECOND_ATTEMPT_SELECT", "CORTEX_SECOND_ATTEMPT_UNTIL_BUDGET",  # R246/R247 (4.124.69)
            "CORTEX_SECOND_ATTEMPT_INFORMED",  # R254 informed retry (4.124.74, dark)
            "CORTEX_TOOLS_AUTO_INSTALL",  # 2026-10-18 external tools (sgrep/rg) auto-install; the bench pins it off below (box cache provides them)
            "TB2_ATTEMPTS", "TB2_ATTEMPTS_MODELS", "TB2_ATTEMPTS_PROVIDERS", "TB2_ATTEMPTS_KEY_POLICY", "TB2_ATTEMPTS_SELECT", "TB2_ATTEMPTS_MIN_S", "TB2_ATTEMPTS_RESERVE_S",  # serial best-of-N (2026-09-29)
            # 2026-09-13 (4.108.10-.19 levers): outer tool floor, derived sub-agent limits, terminal/sub-agent runtime seams, tmux self-install/capture levers, dark handoff-QA
            "CORTEX_OUTER_TOOL_TIMEOUT_MS", "CORTEX_API_NETWORK_RETRY_MS", "CORTEX_BUDGET_VISIBILITY", "CORTEX_BUDGET_CONTINUE_MIN_REMAINING", "CORTEX_BUDGET_FLOOR_S", "CORTEX_BUDGET_FLOOR_MODE", "CORTEX_BUDGET_CONTINUE_MAX_NUDGES", "CORTEX_REASONING_EXHAUST_BACKOFF", "CORTEX_REASONING_EXHAUST_BACKOFF_TURNS", "CORTEX_BASH_OOM_PRIORITY", "CORTEX_MENTOR_CONSULT_BUDGET_TOKENS", "CORTEX_ENDTURN_RESOLVER_MAX_REJECTS_BUDGETED", "CORTEX_JUDGE_SEMANTIC", "CORTEX_JUDGE_PROGRESS_MIN_CALLS", "CORTEX_JUDGE_ESCALATE_REASONING", "CORTEX_SUBAGENT_TIMEOUT_MS", "CORTEX_SUBAGENT_TIMEOUT_MAX_MS", "CORTEX_TERMINAL_BACKEND", "CORTEX_SUBAGENT_RUNTIME",
            "CORTEX_HERDR_KEEP_DELEGATE_PANES", "CORTEX_TMUX_AUTO_INSTALL", "CORTEX_TMUX_STATIC_URL", "CORTEX_TMUX_HISTORY_LIMIT", "CORTEX_TMUX_PANE_SIZE",
            "CORTEX_COMPACTION_HANDOFF_QA", "CORTEX_COMPACTION_HANDOFF_QA_MAX_QUESTIONS", "CORTEX_COMPACTION_THRESHOLD_TOKENS", "CORTEX_COMPACTION_TARGET_PCT", "CORTEX_TOOL_RESULT_PRUNE_AT", "CORTEX_TOOL_RESULT_PRUNE_KEEP_TURNS", "CORTEX_TOOL_RESULT_PRUNE_HARD_AGE", "CORTEX_DELEGATION_HINT",
            # Thrash tuning for the auto-consult arm (defaults ship in 4.88).
            "CORTEX_THRASH_CUM_FAILS",
            "CORTEX_THRASH_MIN_TURNS",
            # EndTurn self-verifier efficacy A/B (treatment arm sets both true):
            "CORTEX_ENDTURN_GATE",
            "CORTEX_ENDTURN_REQUIREMENTS",
            # Lift mentor-planner (LIFT_MENTOR_PLANNER, 2026-09-04): at the turn-1 lift a bounded
            # pro@max-reasoning mentor plans the task (adversarial + confirm the REAL grader criteria
            # + step plan or RETIRE) and injects it as a system-reminder for the narrow-door model.
            # Treatment arm sets CORTEX_LIFT_PLAN=true. Fires in the headless bench (autoApproveActions
            # true = non-TTY); INTERACTIVE flag is TUI-only, not forwarded here. The tuning defaults
            # (effort=max, budget=4000, timeout=90000) ship in the harness; forward to override per arm.
            "CORTEX_LIFT_PLAN",
            "CORTEX_LIFT_PLAN_EFFORT",
            "CORTEX_LIFT_PLAN_BUDGET_TOKENS",
            "CORTEX_LIFT_PLAN_TIMEOUT_MS",
            # EndTurn resolver (mentor-as-EndTurn-judge, 4.92.0): the finish-side twin. Treatment
            # arm sets CORTEX_ENDTURN_RESOLVER=true (control leaves it false). Fires only when the
            # mechanical gate accepts, so it needs GATE + REQUIREMENTS on (both above). Runs pro@max.
            "CORTEX_ENDTURN_RESOLVER",
            "CORTEX_ENDTURN_RESOLVER_EFFORT",
            "CORTEX_ENDTURN_RESOLVER_BUDGET_TOKENS",
            "CORTEX_ENDTURN_RESOLVER_MAX_REJECTS",
            "CORTEX_ENDTURN_RESOLVER_TIMEOUT_MS",
            # ── 4.94.0 DARK LEVERS (validation cell 2026-09-07) — each ships default OFF;
            # a treatment arm sets its flag, control leaves it unset. ──
            # Resolver abstention: RETIRE verdict for a structurally-unclosable finish → the
            # resolver ACCEPTS + stops the reject cycle instead of burning pro@max re-rejecting a
            # doomed finish. Needs the resolver on (CORTEX_ENDTURN_RESOLVER=true, above).
            "CORTEX_ENDTURN_RESOLVER_ABSTAIN",
            # Deadline-exit mentor: at the per-turn deadline WARN rung a bounded residual-scaled
            # mentor decides CONTINUE/FINISH/ACTION/RETIRE (don't truncate a late win; end cleanly
            # when stuck). Tuning defaults ship in the harness; forward to override per arm.
            "CORTEX_DEADLINE_EXIT_MENTOR",
            "CORTEX_DEADLINE_EXIT_MENTOR_EFFORT",
            "CORTEX_DEADLINE_EXIT_MENTOR_BUDGET_TOKENS",
            "CORTEX_DEADLINE_EXIT_MENTOR_TIMEOUT_MS",
            "CORTEX_DEADLINE_EXIT_MENTOR_RESIDUAL_FRAC",
            # Static action effort: sets the PRIMARY/action model's reasoning effort when a request
            # doesn't specify one (overrides the card default, not an explicit param or the pulse).
            "CORTEX_ACTION_EFFORT",
            # Loop-tool-block (hard loop intervention): on a detected non-converging same-approach loop,
            # disables the looping tool's EXECUTOR for one turn + returns an append-only redirect error
            # (tools list unchanged → cache-safe); escalates after 2 blocks to a bounded pro-max
            # exit-planner mentor (REPLAN|RETIRE). Sub-envs tune that mentor call.
            "CORTEX_LOOP_TOOL_BLOCK",
            "CORTEX_EMPTY_TURN_CONTINUE",  # E lever (HB-ENDTURN-TERMINAL); code-default OFF — must pass through to be testable
            # headless frame hygiene (4.99.0): the bench COMMON sets both false; they were NOT forwarded until 2026-09-10
            # (the rig passthrough guard caught it) — every earlier cell ran them at the code default.
            "CORTEX_GIT_CONTEXT", "CORTEX_SLASH_COMMAND_HINT",
            "CORTEX_LOOP_TOOL_BLOCK_EFFORT", "CORTEX_LOOP_TOOL_BLOCK_BUDGET_TOKENS", "CORTEX_LOOP_TOOL_BLOCK_TIMEOUT_MS",
            # OpenAI action/helper transport (2026-10-03, nano MiMo cell): OPENAI_API_MODE=responses moves every OpenAI card that opts in
            # (supportsServerSideTools) to /v1/responses — the only OpenAI route that accepts reasoning effort WITH function tools (R19b
            # drops it on chat/completions); CORTEX_OPENAI_TOOLS_REASONING=on forwards CORTEX_ACTION_EFFORT to reasoning.effort there.
            # Not forwarded before this: an OpenAI arm ran chat/completions with the action effort silently dropped.
            "OPENAI_API_MODE", "CORTEX_OPENAI_TOOLS_REASONING", "CORTEX_ACTION_EFFORT_FIRST", "CORTEX_HELPER_MATCH_PROVIDER", "CORTEX_FAMILY_PRESETS",
            # R262 / parity P1 (2026-10-15): the feature payload layer. CORTEX_FEATURES_FILE names the payload; a BARE name means a file the
            # box serves from its package cache (/root/pkgs/features/<name>, seeded from the arm store) — install() fetches it into the
            # container and the key is rewritten to that container path below. CORTEX_FEATURES_HASH is reported by the library, never set here.
            "CORTEX_FEATURES", "CORTEX_FEATURES_FILE", "CORTEX_FEATURES_JSON", "CORTEX_FEATURE_ATTRS",
            # 2026-10-17 lever profiles: the package ships CORTEX_PROFILE=standard; a cell that wants the byte-identical pre-profile frame
            # sets CORTEX_PROFILE=off, a reproduction run sets bench-tb4 (docs/REPRODUCING_BENCH_RESULTS.md in the nexus-cortex repo).
            "CORTEX_PROFILE", "CORTEX_INTERACTIVE_PROFILE",
            # R260 HB-ACCEPT-GATE (4.124.84): typed accept gate over the resolver's accept-class verdicts (jev | amos self-hosted).
            "CORTEX_JUDGE_ACCEPT_GATE", "CORTEX_JUDGE_ACCEPT_GATE_MIN", "CORTEX_JUDGE_ACCEPT_GATE_MAX", "CORTEX_JUDGE_ACCEPT_GATE_TIMEOUT_MS", "CORTEX_DECISION_MODEL", "CORTEX_DECISION_URL",
        ):
            _v = os.environ.get(_k)
            if _v:
                env[_k] = _v
        _ff = (env.get("CORTEX_FEATURES_FILE") or "").strip()
        if _ff and "/" not in _ff:
            env["CORTEX_FEATURES_FILE"] = "/usr/local/share/cortex-features.json"
        # 🔴 THE working-dir fix: cortex-server's Bash/Edit/Write tools operate
        # in the SERVER process's cwd (falling back for project context). The
        # CLI's auto-spawned server does NOT inherit the task cwd → tools default
        # to /tmp and the grader (which checks the task repo) sees no changes →
        # reward 0. run() below starts cortex-server EXPLICITLY in the task dir
        # (the exec cwd) then drives it.
        # NB: do NOT set PROJECT_PATH to the task repo — that triggers cortex's
        # MCP auto-detect, which tries to launch the repo's main.py as an MCP
        # server (`python3 main.py`) and crashes the server (ENOENT) on task
        # containers without python3 on the server's spawn PATH. The server cwd
        # alone gives the tools the right root without that side effect.
        # Defensive: prefer IPv4 for localhost so the CLI reliably reaches its
        # own cortex-server on 127.0.0.1:4000 across Node's ipv6-first default.
        # (Validated 2026-08-23: the earlier "fetch failed" was NOT this — it
        # was a :4000 collision when a stray cortex-server ran on the same
        # host-networked box; a fresh task container has :4000 free. Kept as a
        # cheap guard.)
        env["NODE_OPTIONS"] = "--dns-result-order=ipv4first"

        # Build the /v1/messages request body. base64 so the (possibly
        # multi-line, quote-heavy) instruction survives the shell round-trip
        # into the container intact.
        _req_body = {
            "model": model,
            "messages": [{"role": "user", "content": instruction}],
        }
        # Sampling A/B overrides (per-arm): BENCH_TOP_P / BENCH_REASONING_EFFORT go
        # into the /v1/messages body → parameters.topP / parameters.reasoningEffort,
        # overriding the deepseek card defaults (top_p=0.95, effort=max) so control
        # can run baseline (1.0 / medium) and each arm can isolate one lever.
        _tp = os.environ.get("BENCH_TOP_P")
        if _tp:
            _req_body["top_p"] = float(_tp)
        _re = os.environ.get("BENCH_REASONING_EFFORT")
        if _re:
            _req_body["reasoning_effort"] = _re
        # 2026-09-25: action-model sampling temperature per arm (BENCH_TEMPERATURE, 0-2). The DeepSeek card carries NO
        # temperature default (provider default 1.0 applies); the server route nests this under parameters.temperature and
        # the gateway emits it. First-ever action-temperature arm — see memory deepseek-sampling-temperature-history.
        _tt = os.environ.get("BENCH_TEMPERATURE")
        if _tt:
            _req_body["temperature"] = float(_tt)
        body_b64 = _b64.b64encode(_json.dumps(_req_body).encode()).decode()
        # curl's own timeout must clear the LARGEST task budget (12000s) so HARBOR's
        # per-task timeout (task.toml) governs, never curl. 3600 was NOT "comfortably
        # above": 12 tasks budget exactly 3600s (a coin-flip race with Harbor's timer,
        # won only because Harbor's starts ~1-2 min earlier) and 2 tasks allow
        # 7200/12000s where curl would self-cut first (audit 2026-09-02, p3 ledger).
        api_timeout_s = CEILING_S  # was 12600 (TB2.1); TB4.0 budgets are 28800 s
        # Metrics capture: Harbor's result.json token/cost fields are null
        # (SUPPORTS_ATIF=False → nothing reports usage back to Harbor), and the
        # /v1/messages response carries the real usage. Save the response and
        # extract a metrics.json sidecar (tokens, turns, cost) the supervisor
        # banks alongside reward — so a bench number is (pass-rate, cost, turns),
        # not pass-rate alone. deepseek-v4-flash pricing: $0.14/$0.28 per M.
        _mx = (
            "import json\n"
            "try: d=json.load(open('/logs/agent/response.json'))\n"
            "except Exception: d={}\n"
            "u=d.get('usage') or {}\n"
            "u=(u.get('session') or u)\n"  # R190: the session cumulative when present (every request), else the last request (pre-4.124.15)"
            "c=u.get('cache') or {}\n"
            "def g(*ks):\n"
            "  for src in (u,c):\n"
            "    for k in ks:\n"
            "      if src.get(k) is not None: return src.get(k)\n"
            "  return 0\n"
            "it=g('inputTokens','input_tokens') or 0\n"
            "ot=g('outputTokens','output_tokens') or 0\n"
            "cr=g('cacheReadTokens','cache_read_tokens','cachedTokens') or 0\n"
            "cw=g('cacheCreationTokens','cache_creation_tokens') or 0\n"
            "rt=g('reasoningTokens','reasoning_tokens') or 0\n"
            "tc=(d.get('metadata') or {}).get('toolCallIterations')\n"
            "if tc is None:\n"
            "  tu=d.get('toolUses'); tc=len(tu) if isinstance(tu,list) else None\n"
            # VERIFIED DeepSeek FLASH pricing per 1M tok (api-docs.deepseek.com/
            # quick_start/pricing, re-verified 2026-09-10 — deepseek-flash = V4.1
            # Flash GA; every legacy flash name routes here): cache-hit
            # $0.003/$0.006, cache-miss $0.15/$0.30, output $0.60/$1.20 (off-peak/
            # peak). Peak = 01:00-04:00 & 06:00-10:00 UTC Mon-Fri; else off-peak.
            # This sidecar is the FLASH estimate; the supervisor re-prices per
            # MODEL (its PRICING table) when it banks the row.
            # cost_usd applies the tier at COMPLETION time; both tiers stored so a
            # task straddling the boundary is bracketed, and usage_raw makes it
            # fully recomputable.
            "import datetime\n"
            "now=datetime.datetime.now(datetime.timezone.utc)\n"
            "peak=(now.weekday()<5) and (1<=now.hour<4 or 6<=now.hour<10)\n"
            "H,M,O=(0.006,0.30,1.20) if peak else (0.003,0.15,0.60)\n"
            "unc=max(it-cr,0)\n"
            "cost=round(unc*M/1e6 + cr*H/1e6 + ot*O/1e6, 6)\n"
            "cop=round(unc*0.15/1e6 + cr*0.003/1e6 + ot*0.60/1e6, 6)\n"
            "cpk=round(unc*0.30/1e6 + cr*0.006/1e6 + ot*1.20/1e6, 6)\n"
            # 2026-10-02 (stack portability): the flash estimate applies to DeepSeek models ONLY. Any other model gets no
            # sidecar price (None + cost_note) instead of a silent flash-rate number — the supervisor's per-model PRICING
            # table is the pricer of record (and logs UNPRICED loudly for a model it has no row for).
            f"MODEL={model!r}\n"
            "if 'deepseek' not in MODEL.lower(): cost=cop=cpk=None\n"
            "rec={'inputTokens':it,'outputTokens':ot,'cacheReadTokens':cr,"
            "'cacheCreationTokens':cw,'reasoningTokens':rt,'toolCallIterations':tc,'cost_usd':cost,"
            "'cost_usd_offpeak':cop,'cost_usd_peak':cpk,"
            "'rate_tier':('peak' if peak else 'offpeak'),'usage_raw':u}\n"
            "if cost is None: rec.update({'model':MODEL,'cost_note':'non-DeepSeek model: sidecar does not price; supervisor PRICING re-prices'})\n"
            "open('/logs/agent/metrics.json','w').write(json.dumps(rec))\n"
        )
        mx_b64 = _b64.b64encode(_mx.encode()).decode()
        # Start cortex-server IN the task working dir with PROJECT_PATH set, wait
        # for /health, then send the task. cortex-server's tools now operate in
        # the repo the grader checks. (Mirror of autoresearch startServer.)
        await self.exec_as_agent(
            environment,
            # 🔴 Task containers share the CF-sandbox network (host-network
            # overlay, needed for outbound), so cortex-servers COLLIDE on :4000
            # across tasks: the first task's server holds :4000, later servers
            # fall back to :4001+, but the CLI defaults to :4000 → talks to the
            # STALE first-task server (wrong cwd + accumulated session → orphaned
            # 'tool' 400s / NonZeroAgentExitCodeError). Fix: read the port OUR
            # server actually bound from its log and point the CLI there via
            # CORTEX_SERVER_URL. (No `pkill -f cortex-server` — it self-matches
            # the shell argv → SIGKILL/exit 137; and a port-race between parallel
            # tasks would make it unreliable anyway.)
            # Drive the server's /v1/messages API directly (the autoresearch
            # serverRunner path) instead of `cortex --quiet`, which has a
            # HARDCODED AbortSignal.timeout(600000) (single-message.ts:54, not
            # env-configurable) that cuts hard tasks short of their 900s+ budget.
            # The API runs the FULL agentic loop server-side (tools + edits in
            # the server cwd = task repo) with our own curl timeout. The reward
            # comes from the task's verifier (repo state), not the response body.
            command=(
                "mkdir -p /logs/agent; "
                # 2026-10-06 skills (capabilities.skills=True): stage Harbor's skills_dir where the harness Skill tool looks, outside the workspace
                + (f'SKD={self.skills_dir!r}; if [ -n "$SKD" ] && [ -d "$SKD" ]; then mkdir -p "$HOME/.cortex/skills" && cp -r "$SKD"/. "$HOME/.cortex/skills"/ 2>/dev/null && echo "[adapter] skills staged from $SKD: $(ls "$HOME/.cortex/skills" | tr \'\\n\' \' \')" >> /logs/agent/nexus-cortex.txt; fi; ' if getattr(self, "skills_dir", None) else "")
                + # R196 guard (2026-09-25): if the install phase (root) left a log the agent user cannot append to, move it aside so
                # no later `>> nexus-cortex.txt` / `2>>` redirection can fail and silently skip its command (the POST included).
                "L=/logs/agent/nexus-cortex.txt; if [ -e $L ] && [ ! -w $L ]; then mv $L /logs/agent/nexus-cortex.install.txt 2>/dev/null || true; fi; "
                'echo "[adapter] run phase as $(id -un 2>/dev/null) uid=$(id -u 2>/dev/null); /logs/agent writable=$([ -w /logs/agent ] && echo yes || echo no)" >> $L 2>/dev/null || true; '
                # env_unprovisioned detection (2026-09-02, def-99ca5d361f): torch-tensor/torch-pipeline
                # landed in an EMPTY task dir (no python3, no files) = infra DNF, not a model fail.
                # Marker is harvested by the supervisor (banks status env_unprovisioned + retries once)
                # and read by tb2-distill (classifier infra_unprovisioned). Never blocks the run.
                # 2026-09-03: an EMPTY task dir is NORMAL for from-scratch tasks (cancel-async-tasks) —
                # the ONLY infra-DNF signature is NO INTERPRETER (torch-*: empty dir AND python3 absent).
                "if [ -z \"$(ls -A . 2>/dev/null | grep -vE '^(\\.addon-tools|\\.cortex|\\.git)$')\" ] && ! command -v python3 >/dev/null 2>&1 && ! command -v python >/dev/null 2>&1; then "
                "  echo \"cwd=$(pwd) files=0 python3=none\" > /logs/agent/env_unprovisioned; fi; "
                # 2026-09-11 (qemu-* images: NO curl, and apt is dead on bullseye): every HTTP call goes through `H`,
                # which is curl when present and otherwise node (always present — the install step put it on PATH).
                # H GET <url> [outfile] | H POST <url> <bodyfile> <outfile> <timeout_s>
                # DSH-MINIMAL: materialize dsh's one-line system prompt where CORTEX_SYSTEM_PROMPT_FILE points.
                '[ "${CORTEX_DSH_MINIMAL:-0}" = 1 ] && printf "You are a helpful software engineer assistant.\\n" > /tmp/dsh-system-prompt.md; '
                "H() { if command -v curl >/dev/null 2>&1; then "
                "  if [ \"$1\" = GET ]; then curl -sf \"$2\" ${3:+-o \"$3\"}; else curl -sS -m \"$5\" -X POST \"$2\" -H 'Content-Type: application/json' -d @\"$3\" -o \"$4\"; fi; "
                "else node -e '"
                "const [m,u,b,o,t]=process.argv.slice(1);const http=require(\"http\");const fs=require(\"fs\");"
                "const U=new URL(u);const body=m===\"POST\"?fs.readFileSync(b):null;"
                "const req=http.request({host:U.hostname,port:U.port,path:U.pathname+U.search,method:m,headers:body?{\"Content-Type\":\"application/json\",\"Content-Length\":body.length}:{}},res=>{"
                "let d=[];res.on(\"data\",c=>d.push(c));res.on(\"end\",()=>{const out=Buffer.concat(d);const dest=m===\"POST\"?o:b;if(dest)fs.writeFileSync(dest,out);process.exit(res.statusCode>=200&&res.statusCode<300?0:22)})});"
                "req.on(\"error\",e=>{process.stderr.write(String(e)+\"\\n\");process.exit(7)});"
                "if(t)req.setTimeout(Number(t)*1000,()=>{process.stderr.write(\"timeout\\n\");req.destroy();process.exit(28)});"
                "if(body)req.write(body);req.end();"
                "' \"$@\"; fi; }; "
                + f"MA_HELPER_B64={shlex.quote(_b64.b64encode(_MA_HELPER.encode()).decode())}; " + _MA_SNAPSHOT + _SA_SNAPSHOT +
                "nohup cortex-server > /logs/agent/cortex-server.log 2>&1 & SRV=$!; " + _PROC_WATCH +
                "P=''; for i in $(seq 1 60); do "
                "  P=$(grep -oE 'running on port [0-9]+' /logs/agent/cortex-server.log 2>/dev/null | grep -oE '[0-9]+' | tail -1); "
                "  [ -n \"$P\" ] && H GET \"http://localhost:$P/health\" /dev/null >/dev/null 2>&1 && break; "
                "  sleep 1; done; "
                "[ -z \"$P\" ] && P=4000; "
                # EFFECTIVE-CONFIG CAPTURE (resolver-AB gate, 2026-09-04): grab the SERVER's merged
                # effective config (seed .env.example ⊕ adapter env ⊕ COMMON, with per-lever
                # source=env|code-default) from the main-port /health/config JSON. This is the ONLY
                # faithful surface — the adapter is what injects the guards + passes COMMON, so only
                # THIS server's view is authoritative. Harvested by the supervisor into rec.effective_config;
                # the verify-first hard gate reads it from the Dataset to certify CORTEX_ENDTURN_RESOLVER
                # is env-sourced true/false per arm before any scored fanout. Never blocks the run.
                "H GET \"http://localhost:$P/health/config\" /logs/agent/health_config.json 2>/dev/null || true; "
                "echo \"[adapter] cortex-server on port $P; driving /v1/messages\" >> /logs/agent/nexus-cortex.txt; "
                # INCREMENTAL SESSION PERSIST (v6, 2026-08-25): the copy in the
                # command tail NEVER RUNS when Harbor kills this exec at the
                # task budget — which made every hard-timeout failure (10-11
                # per flash arm, the most valuable trajectories) UNOBSERVABLE:
                # no /logs/agent/session.jsonl → nothing for the supervisor to
                # harvest → absent from the Dataset AND the canon store. This
                # background loop copies the newest session record into
                # /logs/agent every 20s DURING the run, so a budget kill loses
                # at most 20s of trajectory. Harbor collects /logs/agent into
                # the trial artifacts even on AgentTimeoutError; the supervisor
                # finds it via `find {jd} -path '*agent*' -name session.jsonl`.
                "( while true; do "
                "  IS=$(find /tmp/.cortex-state \"$PWD/.cortex\" \"$HOME/.cortex\" /root/.cortex -path '*sessions*' -name '*.jsonl' 2>/dev/null | xargs -r ls -t 2>/dev/null | head -1); "
                "  [ -n \"$IS\" ] && cp \"$IS\" /logs/agent/session.jsonl 2>/dev/null; "
                # v8: decision-store EVENT rows (loop_escalation / gate fallbacks /
                # inaction nudges — the 4.70+ observability schema) ride along; the
                # distiller/doctrine-mine join them to the session by sessionId.
                "  DS=$(find /tmp/.cortex-state \"$PWD/.cortex\" \"$HOME/.cortex\" /root/.cortex -maxdepth 2 -name 'decisions.jsonl' 2>/dev/null | head -1); "
                "  [ -n \"$DS\" ] && cp \"$DS\" /logs/agent/decisions.jsonl 2>/dev/null; "
                "  sleep 20; done ) & SESS_COPIER=$!; "
                f"echo {shlex.quote(body_b64)} | base64 -d > /tmp/req.json; "
                # -o saves the full response (usage lives here); stderr → log.
                f"H POST \"http://localhost:$P/v1/messages\" /tmp/req.json /logs/agent/response.json {api_timeout_s} 2>>/logs/agent/nexus-cortex.txt; RC=$?; "
                # R175 (2026-09-21, cell g1): 2 of 70 sessions ended with the server log stopping mid-session and NO response —
                # bank the death evidence (curl rc, server alive?, memory, cgroup/OOM counters, the server log tail) so the class
                # can be grounded instead of guessed.
                "if [ ! -s /logs/agent/response.json ]; then { echo \"[adapter] NO RESPONSE (curl rc=$RC) server_alive=$(pgrep -fc cortex-serve[r]) mem=$(free -m 2>/dev/null | awk '/Mem/{print $3\"/\"$2\"MB\"}') cgroup_mem_max=$(cat /sys/fs/cgroup/memory.max 2>/dev/null || cat /sys/fs/cgroup/memory/memory.limit_in_bytes 2>/dev/null) oom_events=$(cat /sys/fs/cgroup/memory.events 2>/dev/null | tr '\\n' ' ')\"; "
                "  dmesg 2>/dev/null | grep -iE 'killed process|out of memory' | tail -3; echo '--- server log tail'; tail -8 /logs/agent/cortex-server.log 2>/dev/null; } >> /logs/agent/nexus-cortex.txt 2>&1; fi; "
                # 🔴 CUMULATIVE usage: the /v1/messages response carries only the
                # FINAL call's usage. The session record (.cortex/sessions/*.jsonl)
                # holds per-turn usage on each assistant record (orchestrator:1444).
                # Copy it out to /logs/agent (harbor copies that dir) so the
                # supervisor can SUM per-turn usage for the true task total.
                "kill $SESS_COPIER 2>/dev/null; "
                "S=$(find /tmp/.cortex-state \"$PWD/.cortex\" \"$HOME/.cortex\" /root/.cortex -path '*sessions*' -name '*.jsonl' 2>/dev/null | xargs -r ls -t 2>/dev/null | head -1); "
                # R245 (10-10): when a second-attempt chain (adapter or library) picked attempt k, the trajectory is the PICK's session, never
                # the newest file (= the LAST attempt): every chain cell before 10-10 banked the last attempt as the trajectory.
                "PK=$(python3 -c \"import json;print(json.load(open('/logs/agent/second-attempt.json')).get('pick') or '')\" 2>/dev/null); "
                "if [ -n \"$PK\" ] && [ -s /logs/agent/session.attempt$PK.jsonl ]; then cp /logs/agent/session.attempt$PK.jsonl /logs/agent/session.jsonl; "
                "  [ -s /logs/agent/decisions.attempt$PK.jsonl ] && cp /logs/agent/decisions.attempt$PK.jsonl /logs/agent/decisions.jsonl; echo \"[adapter] R245 trajectory = attempt $PK (the pick)\" >> /logs/agent/nexus-cortex.txt; "
                "else [ -n \"$S\" ] && cp \"$S\" /logs/agent/session.jsonl; fi; "
                "DS=$(find /tmp/.cortex-state \"$PWD/.cortex\" \"$HOME/.cortex\" /root/.cortex -maxdepth 2 -name 'decisions.jsonl' 2>/dev/null | head -1); "
                "[ -n \"$DS\" ] && cp \"$DS\" /logs/agent/decisions.jsonl; "
                "echo \"session:${S:-none}\" >> /logs/agent/nexus-cortex.txt; "
                + _MA_LOOP + _SA_CHAIN +
                # keep the per-call sidecar too (fallback / cross-check).
                f"echo {shlex.quote(mx_b64)} | base64 -d > /tmp/mx.py; "
                "python3 /tmp/mx.py 2>>/logs/agent/nexus-cortex.txt; "
                "cat /logs/agent/metrics.json 2>/dev/null | tee -a /logs/agent/nexus-cortex.txt; "
                # ALWAYS exit 0: reward is graded by the task VERIFIER from repo
                # state, never by this command's exit code. A plumbing hiccup in
                # the metrics tail (mx.py raise, curl transport error) must not
                # surface as NonZeroAgentExitCodeError and mask a real solution.
                "kill $PROCWATCH 2>/dev/null; "
                "true"
            ),
            env=env,
            timeout_sec=self._agent_timeout_sec(),
        )

    def _agent_timeout_sec(self) -> int:
        # Respect Harbor's configured agent timeout when present; else a generous
        # BACKSTOP. Harbor itself enforces the task's real budget via
        # asyncio.wait_for(task-config timeout x multiplier) around agent.run()
        # (trial.py _run_agent_phase) -> AgentTimeoutError. This exec timeout must
        # sit ABOVE that so the task budget governs -- the old 900 fallback was the
        # binding constraint: 6 tasks died at ~950-1010s as RuntimeError (exec cut),
        # NOT AgentTimeoutError, i.e. we self-cut short of the task's own budget.
        # Backstop must clear the LARGEST task budget so Harbor's per-task
        # wait_for always governs. Measured across all 89 TB2.0 task.tomls
        # (laude-institute/terminal-bench-2 @69671fb): 600x1 750x1 900x49
        # 1200x6 1800x16 2400x2 3600x12 7200x1 12000x1 -- max 12000s.
        for attr in ("agent_timeout_sec", "timeout_sec", "_timeout_sec"):
            v = getattr(self, attr, None)
            if isinstance(v, (int, float)) and v > 0:
                return int(v)
        return CEILING_S  # was 12300 (TB2.1 max 12000 + 300)
