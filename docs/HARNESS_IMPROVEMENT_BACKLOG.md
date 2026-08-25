# Harness Improvement Backlog — the three-guard architecture + config plane

*2026-08-25. Source: TB2 2×2 distiller evidence (FINAL — all four arms 89/89; verdict at
.bench/distill-final/VERDICT.md) + the outcome-ladder micro-suite findings. Companion docs:
UNIFIED_OUTCOME_LADDER.md (implemented, release-gated). Sequencing agreed with operator:
finish 2×2 → final verdict → build/fold changes → publish via release train → rerun flip candidates.*

**STATUS 2026-08-25: ALL SIX ITEMS BUILT (local, green — release-gated).** Pure layers:
`orchestrator/{inactionGuard,requirementsVerification}.ts`, `training/DecisionStore.ts` event rows
(`recordEvent`/`readEvents`, kind-tagged, prior-invisible), `tools/ToolProfile.ts`
`resolveFrameProfile`, `executors/.../execution/bashFileAccess.ts` parser. Wiring: both
orchestrator loops (inaction retry after R18b/R32; Stage 4 in the EndTurn grounded branch;
fallback + steering + ladder-escalation records), EndTurn schema `requirements` (optional —
backward-compatible), ShellTool (bash-read registration + markBashWrite invalidation + pipefail
wrapper), EditTool (frame-aware denial + markBashWrite), WriteFileTool (authored-content
markAsRead), types/configurators/orchestrator `frameProfile` (NO card values set — default 'lifted' = the
unchanged legacy behavior. 🔴 OPERATOR PUSHBACK 2026-08-25: the 2×2 frame verdict was measured
UNDER THE PRE-FIX HARNESS, and the fixes target exactly persist's loss classes — Stage-4 ↔
wrong-artifact, inaction guard ↔ paralysis, item 6 ↔ the persist arms' 54/27 dead-end denials +
blind sed -i (persist bash-writes 2-3× more, so item 6 disproportionately helps persist).
Per-model frameProfile values are DEFERRED until post-publish rerun cells re-measure persist with
the guards armed; do NOT cite "lifted for both tiers" as settled). Tests: 25 parser + 13
frame-coherence integration + 13 inaction + 12 Stage-4 + 6 event-store + 7 frame-precedence new;
adjacent sweeps 71 orchestrator + 113 executors green; tsc clean (types/core/executors).
Env flags (all default-off): CORTEX_ENDTURN_REQUIREMENTS, CORTEX_INACTION_NUDGE
(+CORTEX_INACTION_MIN_CHARS), CORTEX_BASH_PIPEFAIL, CORTEX_TOOL_ANCHOR_PERSIST.
Item 6a/6b/6c/Write-coherence are always-on (guard semantics unchanged; advice + registration only).

## The organizing insight

The 2×2 exposed **three behavioral failure modes that the frames trade between**, each needing its
own guard — plus config-plane items the data decided:

| Failure mode | Evidence | Guard | Status |
|---|---|---|---|
| Repeated failing action (thrash) | #1 mode everywhere: 12 pro-lifted, 11 flash-lifted, 7 pro-persist, 6 flash-persist | **Loop ladder** | BUILT + live-verified (UNIFIED_OUTCOME_LADDER.md) |
| Zero-action paralysis | 4 pro-persist + 2/2 flash never-acted; persist *induces* it on strong models | **Inaction guard** (item 2) | SPECCED |
| Premature finish (wrong artifact) | ~10 flash-persist, cluster of pro-persist frame-split losses | **EndTurn gate + requirements extension** (item 1) | gate SHIPPED (dormant); extension SPECCED |

---

## Item 1 — EndTurn gate: `requirements` attestation extension

**Gate as-built (analyzed 2026-08-25; BaseToolRegistry.ts:970, orchestrator ~1515-1870):**
- Generative attestation: `citations` (reference + verbatim_source), `verification`
  (command + observed_result), `summary`, `open_items`, `self_review`. "Inventing one is a failed
  answer."
- Stage 2: every verbatim_source must appear in THIS turn's tool outputs (regurgitation rejected).
- Stage 3: deterministic coordinate verification — drafted line-number claims must map to a
  citation actually sitting at that line (built for the line-fabrication problem; solved it).
- Adaptive nudges (readish vs mutating emphasis), bounded at END_TURN_MAX_NUDGES=2, fallback-accept.
- `EndTurn` ∈ ALWAYS_KEEP → survives the bash-edit anchor → works turn-1 under the persist frame.
- Its tool description is doctrine-at-tool-read-time (an existing instance of the
  tool-description-as-doctrine pattern).

**The gap:** it verifies *citations*, not *task requirements*. A wrong-artifact finish passes with
honest citations and a legitimate `verification: []` ("none asked"). Nothing forces re-reading the
task statement.

**Design:**
1. Schema add (backward-compatible): optional `requirements: [{requirement, satisfied_by,
   verified_how}]` — one row per requirement STATED in the task; `satisfied_by` = what in the
   artifact satisfies it; `verified_how` = the command/observation that proves it (or "UNVERIFIED").
2. Gate mode env `CORTEX_ENDTURN_REQUIREMENTS=true` (off by default; the persist+EndTurn arm and
   bench profiles arm it): when set, `requirements` becomes required and a **Stage 4** check runs:
   - empty `requirements` on a turn whose user message contains imperative/task shape → nudge
     ("re-read the task statement; enumerate each stated requirement").
   - any row with `verified_how: UNVERIFIED` → adaptive nudge naming it ("requirement X is
     unverified — run the check or move it to open_items with justification").
3. New adaptive nudge branch: mutating turn + empty `verification` → "you modified files but ran
   no checks."
4. **Fallback observability**: when the 2-nudge bound trips and the gate fallback-accepts, emit an
   `endturn_gate_fallback` decision record (ts, reason, nudges) — the distiller sees un-attested
   passes.

**Touchpoints:** BaseToolRegistry (schema + description paragraph), orchestrator gate block
(~1781-1870, both loops), decision store (record type). No wire-semantics changes.

**Tests:** schema validation both modes; Stage-4 unit table (empty reqs / UNVERIFIED row / clean);
nudge-branch selection; fallback record emission. Micro-probe: 3-explicit-requirement task, model
prodded to finish early → nudge names the unmet requirement; control task → no false nudge.

**Verification rung:** the persist+EndTurn cell (spec in harbor-bench skill: 10 wrong-artifact +
6 loop no-regression + 5 pass controls, ~21 tasks, ~$1-2) runs WITH this extension.

**Risks:** prompt-mass of a longer description under narrow doors (measure); attestation fatigue →
shallow rows (judge samples in the cell); requirements hallucination (rows not in the task — Stage-4
cannot verify text provenance cheaply; accept v1, distiller audits).

---

## Item 2 — Inaction guard (the ladder's inverse)

**Evidence:** never-acted/over-deliberated failures — 4 pro-persist, 2 flash-lifted, 2
flash-persist, 0 pro-lifted. Persist *induces* paralysis on the strong model (frame-split: base
wins with loser class never-acted on filter-js-from-html, gpt2-codegolf, raman-fitting). No
existing guard can fire: the whole stack counts tool calls; these turns have ZERO calls and a
reason-to-the-wall text/thinking dump (the known out_tok signature, currently observable only
post-hoc).

**Design:** extend the R18b/R32 empty-response-retry precedent (the mechanism that already re-asks
on empty responses) to ACTLESS-VERBOSE responses:
- Trigger: final assistant response with zero tool_use in the ENTIRE turn AND output length above
  `INACTION_MIN_CHARS` (default ~4000) AND agentic context (first turn of a session in a
  tool-capable request — conservative v1 gate to protect pure-chat).
- Action: ONE retry with an injected steering user message: "You produced a long analysis but ran
  no commands. Act first: run at least one tool call to ground or execute your plan, then answer."
- Bounded: single nudge (`inactionNudgeUsed` flag), fallback-accept like the EndTurn gate.
- **Default OFF** (`CORTEX_INACTION_NUDGE=true` arms it) — bench/server profiles arm; interactive
  CLI default stays off until specificity is proven broadly.
- Emit an `inaction_nudge` decision record either way it resolves.

**Touchpoints:** both orchestrator loops at the no-tool-use exit path (adjacent to the R32 block);
config env; decision record.

**Tests:** detector unit table (long+actless+agentic → fire; short answer → no; actless but
pure-chat second turn → no; acted turn → no). Micro-probes both directions (paralysis-bait task
fires; plain question silent).

**Verification rung:** rides the same bench cells; success = never-acted count drops without
pure-language regressions (judge samples).

**Risk:** false positives on legitimately analytic asks — hence conservative v1 gate + default-off
+ single nudge.

---

## Item 3 — Steering observability (session-persist ordering fix, micro-suite defect #4)

**Evidence:** injected signals (prior/family reminders, ladder escalations, budget warnings) mutate
the in-memory tool_result AFTER historyStore.appendMessage persisted it → the durable session lacks
the steering the model actually saw; distiller/canon are blind to it (probe-1/3/4 confirmed).

**Design (records over re-persistence):** do NOT re-write session rows (append-only invariants).
Instead emit decision-store records at each injection: `loop_escalation` (ts, tool, family,
approachHash, rung), `steering_injected` (kind: prior|family|budget|diversity|ladder|endturn,
truncated text hash). The store persists reliably and the distiller already reads it. Optionally
(later) a session-record type for steering, resume-tolerant like the file-snapshot records.

**Tests:** unit — each injection path emits exactly one record; harvest check — records present in
the banked store.

---

## Item 4 — Exit-code masking mitigation (micro-suite defect #3)

**Evidence:** `cmd | tail` and `cmd; echo "exit=$?"` return exit 0 → outcome layer classifies `ok`
→ ladder/store/family all starved (probe-3: three failing installs recorded as successes).

**Design:** `CORTEX_BASH_PIPEFAIL=true` (default OFF, bench/server profiles arm): ShellTool
prepends `set -o pipefail;` to commands. Catches the pipe class; the `; echo $?` class remains
masked (documented residual — solving it textually risks false positives; revisit only with
evidence it dominates). NEVER default-on: it changes user command semantics.

**Tests:** ShellTool unit with/without env; probe-3 rerun shape (piped failing install now
classifies `failed`).

---

## Item 5 — Per-model frame defaults (the 2×2's config-plane verdict)

**Evidence:** frame effects are model-strength-dependent in BOTH directions — persist halves flash
loops (11→6) but 2.5×'s its wrong-artifact (4→10); persist on PRO nets negative (base 10 vs
persist 5 frame-split wins; paralysis + premature finish). One global frame setting is wrong for
someone.

**Design:** `frameProfile?: 'lifted' | 'persist'` on model cards, consulted where
`resolveToolAnchor` reads `cardAnchorProfile`; env (`CORTEX_TOOL_ANCHOR_PERSIST`) still overrides
for experiments. **Initial values: NONE (operator direction 2026-08-25)** — the raw 2×2 numbers
(persist net-negative both tiers) were measured under the pre-fix harness; items 1/2/6 attack
persist's exact loss classes, so tier defaults are set only after the post-fix rerun cells.
Sub-1B serving: persist (frame-as-instrument doctrine) + paralysis-watch in evals.

**Tests:** card resolution precedence unit (env > card > default).

---

## Execution order & gates

1. Items 1+2 first (the new guards) — so the persist+EndTurn cell tests the IMPROVED gate.
2. Item 3 with them (observability for their evidence).
3. Items 4-5 as small config diffs.
4. All behind the release train (operator gate) with the ladder + error-family + guardedPush.
5. Post-publish: flip-candidate rerun (loop+timeout unions across arms + pass controls), then the
   arm queue: persist+EndTurn cell → skill-affordance clause → doctrine arm → k=5 (off-peak).

## Explicit non-changes
- Wire `is_error` semantics: untouched (model-visible).
- END_TURN_MAX_NUDGES bounding + fallback-accept: kept (liveness beats purity); now observable via
  fallback records.
- `; echo $?` masking: accepted residual, documented.
- Append-only session rows: never rewritten (records carry steering instead).

---

## Item 6 — Frame-coherent read/write permissions (operator-raised, 2026-08-25)

**Evidence (trajectory-mined):** Under the persist frame the anchor set {Bash, Edit} has NO Read
tool, and EditTool's read-first guard (FileReadTracker, Read-tool-populated ONLY) hard-denies
never-Read files with advice ("Use the Read tool…") the model cannot follow — 54 denial events in
flash-persist, 27 in pro-persist. Bash `cat` reads do NOT register, so even read-first behavior via
bash is punished. Denied writes route to sed -i/heredoc/> which bypass ALL guards (redirect
steering off for bash-anchored cards per D61). Bash file-writes are 2-3× more frequent under
persist (354/229 vs 107 lifted); unambiguous in-place modifies (sed -i) are 67-83% BLIND (no
detected prior read of the target in-session).

**Design:**
a. **Bash-read registration**: ShellTool parses read-command targets (cat/head/tail/sed -n/less)
   and calls FileReadTracker.markRead — the coherence keystone; cheap (steering parser exists).
b. **Frame-aware denial text**: when Read ∉ active toolset, denials advise `cat -n <file>` (which,
   with (a), then satisfies the guard). Never weaken the guard itself.
c. **Bash-write staleness**: sed -i/perl -i/>>/tee targets mark the file edited in the tracker so
   later Edits demand re-read (either channel).
d. Optional (measure first): warn-once steering on sed -i of an unread file under anchored frames
   (warn, not deny — the bash channel stays usable).

**Touchpoints:** ShellTool (target parsing → tracker calls), EditTool (denial text branch on
active-toolset), FileReadTracker (markRead/markEdited public entry points).
**Tests:** parser table (reads/writes/pipes/false positives like `grep cat.txt`); denial-text
branch; cat→Edit now-succeeds integration; staleness-via-bash-write case.
**Verification:** persist-arm rerun cells — Edit denial count should collapse; blind sed -i rate
drops; no new failures from over-registration.
**Risk:** parser false-positives marking unread files read (conservative patterns; only simple
argument positions).
