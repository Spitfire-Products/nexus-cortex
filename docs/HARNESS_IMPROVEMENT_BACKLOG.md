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

---

## Item 7 — Chat/completions image-path bridge (agentic vision; added 2026-08-25)

**STATUS: BUILT + LIVE-VERIFIED E2E 2026-08-25** (local build; rides next release train).
Canonical `image` block (types/tools.ts, own field — no `data?` collision); chat/completions
renders user-message image parts GATED on `card.vision` (non-vision wire byte-identical, proven);
Messages-dialect parity case; `ReadImage` executor (magic-byte sniff, 32MiB cap, payload in
metadata, registers the read) + BASE_TOOLS def at discoveryTier ESSENTIAL (live-probe finding:
'standard' hid it behind SearchTools discovery on turn 1) + BASH_EDIT/BASH_PLUS membership
(vision gate strips it pre-profile for non-vision cards — existing frames unchanged, tested);
vision-gate filters at BOTH assembly sites + the SearchTools catalog; orchestrator scrubs
`imagePayload` from metadata pre-persist and injects the image as an R18b-shaped USER message
(providers reject image parts on tool messages), non-vision hallucinated calls rewritten to an
actionable error; convertSingleMessage image passthrough (live-probe finding: the unknown-type
fallback JSON.stringified the block — model saw 'attached base64 blob'). Tests: 6 adapter +
6 imageFile + 5 ReadImage integration + 1 converter regression; adjacent sweeps green.
**E2E PROOF (local server + real API):** ReadImage on a generated PNG → ONE turn → exact answer
"CODE: XR-4406 and a green circle" (95 out-tokens, no OCR grinding). Earlier failed probes are the
two findings above — both fixed with regression coverage.
**Remaining for the vision-cell arm:** publish (next train, minor), then the arm: {extract-moves-
from-video, code-from-image, sam-cell-seg} × {flash OCR-baseline, vision-exp}.

**Trigger:** DeepSeek released `deepseek-v4-flash-vision-exp` (2026-08-21) — flash-priced
multimodal with TOOL CALLS, probe-verified (read a value from a PNG → correct function call).
Card onboarded (registry + barrel). TB2 census: `extract-moves-from-video` failed ALL arms as a
text-only capability-mismatch (the model correctly built an ffmpeg+tesseract pipeline and died in
tool-timeout cascade); `code-from-image` passed via OCR only on flash-lifted. Native vision is the
lever the harness cannot currently deliver.

**Gap:** only ResponsesAPIAdapter handles `image_url`; the chat/completions request builder has NO
image-block ingestion, and no tool emits image blocks — so a container/workspace image can never
reach a vision model on the DeepSeek path.

**Design sketch (own TDD pass; not rushed into 4.70.x):**
1. Chat/completions builder: pass through `image_url` content blocks in user messages (wire format
   already OpenAI-compatible; images user-role-only per DeepSeek).
2. A `ReadImage` tool (or Read-on-image-extension branch) that emits an image content block from a
   workspace file (base64 data URI; respect ≤32MiB, JPEG/PNG/GIF/WebP; note images ride USER
   messages, so the result must inject as a follow-up user image block — a new mechanic, needs the
   session-persist ordering lessons from item 3).
3. Model-capability gate: only offer/emit for cards flagged vision (add `vision?: boolean` to
   ModelConfig — the field does not exist today; grok/gemini cards would set it too).
4. Verification: vision-cell arm — {extract-moves-from-video, code-from-image, sam-cell-seg} × 
   {flash (OCR baseline), flash-vision-exp} once the bridge ships; plus a cortex-bench micro-probe
   (screenshot → tool call).

**Cost note:** images ≤384 tokens each, 600/request — cheap. Same peak/off-peak windows as flash.

---

## Item 8 — Doctrine mining layer (backpass-pattern proposer, bench-gated apply; SPEC 2026-08-25)

**Trigger:** operator-sourced kunchenguid/backpass (MIT): evidence-mined prompt editing with strong
hygiene — verbatim-quote provenance per claim, ≥2-independent-session corroboration per new rule,
≤5 edits/run ("learning rate"), apply gate, rejection memory. Its gap is OUR moat (same verdict as
AHE): zero outcome verification — no A/B, no holdout, no judge. Borrow the algorithm, not the
codebase; gate it with our bench-cell machinery. This defines HOW the already-queued doctrine arm
generates its content from evidence instead of hand-writing.

**Why we start ahead of backpass:** (a) the trace distiller already is its collect+distill+loss
skeleton (our "candidate deficiencies ×2+" = its two-session rule); (b) canon store = its collect
stage done cross-harness (4,200+ sessions); (c) 4.70.0 steering/event records are PRE-LABELED loss
events it doesn't have — loop_escalation, endturn_gate_fallback, inaction_nudge, edit-denial
signatures — joinable to sessions by sessionId; (d) the deficiency ledger's evidence_refs are its
verbatim-quote convention already in production.

**Design (offline tool; no harness code changes):**
1. **Stage A — digest (deterministic, no model):** reuse the distiller's trajectory walk; per
   session emit user/assistant turns + one-line tool-call shapes + JOINED decision-store event rows
   (the pre-labeled failures). Golden-file deterministic.
2. **Stage B — loss labeling (one cheap call/session):** distilled digest + the TARGET FILE
   (see targets) + rubric → strict JSON: {instruction helped | violated | gap}, each claim with a
   VERBATIM quote. deepseek-v4-flash, off-peak, capped session sample.
3. **Stage C — aggregation (deterministic, no model):** mechanical quote check first (a claim whose
   quote is not an exact substring of its source session is DROPPED — the Stage-2-grounding trick
   applied to the miner itself); cluster near-duplicate gaps via the approachHash-style normalizer;
   corroboration counts; drop clusters seen in <2 sessions; rank violations > gaps > unhelpful.
4. **Stage D — synthesis (one high-reasoning call):** ≤5 candidate edits (ADD / REMOVE / REWRITE /
   EXTRACT→SKILL — the last maps onto our distiller→skill doctrine) against a STAGING copy, each
   annotated with rationale + quotes + a post-edit token-budget check on the target file. Never
   writes the live file; emits candidate + diff report.
5. **Gate — a bench cell, not an eyeball:** the candidate file runs as an arm (discriminating
   subset + 5 pass-controls; judge reads the DIFF; FWER-adjust if multiple candidates compete).
   Apply only on gate-keep ∧ judge-approve; edits to published surfaces ride the release train
   (operator gate) like any code change. Rejected candidates land in a rejection ledger and are
   not re-proposed without materially new evidence.

**Targets, in leverage order:** (1) `.cortex/orient` — tiny, boot-minimal-visible, most of what a
narrow-door model ever sees; (2) tool descriptions (doctrine-at-tool-read-time; EndTurn precedent);
(3) the browser SPA's VFS AGENTS.md (seeds the narrow frame's first bash call); (4) the full
system-message corpus last (largest, least tractable).

**Data sources:** TB2 arm Datasets (trajectories/ + result rows), canon store sessions,
`.cortex/decisions.jsonl` (decision + kind-tagged event rows).

**Touchpoints:** extend `scripts/tb2-distill.py` with a `--mine-rules <target-file>` mode (or a
sibling `scripts/doctrine-mine.py` sharing its walker); bench-cell mechanics = existing arm
machinery; zero orchestrator/executor changes.

**Tests:** digest determinism (golden file); normalizer clustering table; corroboration-threshold
unit; mechanical quote-verification (fabricated quote → dropped); ≤5-edit + token-budget caps;
rejection-ledger suppression.

**Verification rung:** first target = orient. Cell ≈ 15-20 tasks (skills-unreachable +
doctrine-stripped failure classes + controls) × {current orient, mined orient}; success =
(pass, cost, turns) improves, controls hold, judge approves the diff.

**Risks:** rule overfitting to bench mechanics (the AHE trap — holdout tasks + judge mitigate);
labeler quote fabrication (mechanical substring check kills it); prompt-mass creep on the target
(hard token budget, backpass-style); mining spend (flash + off-peak + sample cap).

### Item 7 addendum — image cache dynamics (operator question, 2026-08-25)
Provider prefix-caching makes REPLAY tokens nearly free (≤384 tok/image at cache-hit ~$0.007/M —
fractions of a cent per hundred turns) and context occupancy trivial; the un-cacheable cost is the
request BODY — the full base64 re-uploads every turn (cache is server-side; the client still sends
the bytes) and DeepSeek caps request bodies at 48 MiB, so one large image + a long session can hit
a HARD wall. Verdict: **prune-and-bust is the wrong tool for images** (busting the prefix re-bills
the whole suffix at miss price to save bytes that tokens never paid for). Right tool =
**downscale-at-ingest to the provider's own ~800×800 resize target** — zero model-visible fidelity
loss (the provider was going to do it anyway), ~100× wire reduction, keeps history byte-stable so
the cache rides forever. Follow-up: ReadImage opportunistic PIL/ImageMagick shell-out downscale
above a soft threshold (~2 MiB), else advise; age-tier pruning for images only for pathological
many-image sessions (100+ images → token space matters again).

**MEASURED 2026-08-25 (probe, decisive):** image-bearing requests on vision-exp currently BYPASS
cache reads ENTIRELY — an identical repeat request reported cached=0 even though its own text
prefix was demonstrably in cache (a pure-text request with the same prefix hit 896 cached tokens,
populated BY the image-bearing call). So the real cost of an image in history is not its ≤384
tokens: it disables the ~31× cache-hit discount ($0.007 vs $0.22/M off-peak) for EVERY subsequent
request of the session. On long agentic sessions (TB2 tasks run 97%+ cache-hit, e.g. 37M input /
35.8M cached) that is the difference between ~$0.40 and ~$8 per task. REVISED design:
downscale-at-ingest stays (wire); ADD an **image TTL/eviction** mechanic — after N turns (env
`CORTEX_IMAGE_TTL_TURNS`, default ~3), replace the image block with a text stub
"[image evicted: <path> — ReadImage again if needed]"; the one-time prefix bust this causes is
massively net-positive because it RESTORES caching for the rest of the session. Likely a temporary
"-exp" limitation — re-probe on model updates before tuning further.

## Item 9 — Composable deferred doctrine: defer-gate fix + mechanical orient + lazy doc pickup (BUILT 2026-08-25)

**STATUS: BUILT (local, green — release-gated).** 9a gate fix + orient-path interpolation in
SystemMessageMiddleware (+ resolveOrientPath); 9b generic mechanical orient at
docs/prompts/orient-scaffold.sh, vendored by prepack to <pkg>/.cortex/orient (repo-root
.cortex/orient stays dev-project-specific, never shipped); 9c turn-0 semantics + lazy doc pickup
in buildDeferredStaticCorpus. Tests: promptPreset.test.ts 10 (6 new: defer-composition ×3,
orient interpolation ×3) + deferredCorpusLazyDocs.test.ts 1 + promptMassDefer.test.ts 3 adjacent
green; tsc clean. Changeset deferred-doctrine-item9 (core minor).

**Trigger (operator-designed, from the TB2 steering audit):** the narrow door should TELL the model
to run the init routine via bash on turn 1, then deliver the full doctrine — including the
freshly-generated CORTEX.md — at the anchor-lift boundary after that first call. Door economics on
turn 1, full knowledge after act 1. This is the P6 defer design's original intent, currently
unreachable, now with the steering evidence to justify finishing it.

**Evidence (grounded 2026-08-25, TB2 fleet + code):**
- **Steering works and was aimed at nothing:** 101/251 staged bench sessions executed the boot
  prompt's orient clause VERBATIM (`sh .cortex/orient` → fallback echo) — ~40% single-clause
  obedience — while the target file never existed in task cwds. Meanwhile the npm scaffold (with 10
  vendored skills) sat in `~/.cortex` in every container, unreached: the clause probes the RELATIVE
  path.
- **Zero discovery ever:** 0 SearchTools + 0 Skill calls across ~11K tool calls, all four arms.
  Presence-in-request is the only affordance that fired. SearchTools steering exists ONLY in
  TOOL_USAGE_GUIDE.md:91 (stripped under boot-minimal); Skill/skills-dir steering exists NOWHERE in
  the corpus at any mass level; init-generated CORTEX.md is workspace steering only (six-section
  template — no capability content, correctly).
- **The gate bug (defer-trap root cause, skill ledger):** `SystemMessageMiddleware.ts` applies the
  card's preset prompt only when `!envMass` — so `CORTEX_PROMPT_MASS=defer` DISABLES boot-minimal
  and ships the full prompt turn 1. Defer and the narrow door are mutually exclusive when they must
  compose.
- **The delivery mechanism already exists and is cache-safe:** `CortexOrchestrator.ts:571-595`
  appends the deferred corpus ONCE onto the first tool_result (`<system-reminder>` wrapped) —
  append-only on the moving turn, cached prefix untouched.

**Design (three parts):**
1. **9a — defer composes with the card preset.** Middleware gate becomes: preset replacement prompt
   applies when envMass is unset OR `defer` (still overridden by CORTEX_SYSTEM_PROMPT_FILE).
   `minimal`/`full` semantics unchanged. Result: defer = boot-minimal turn 1 → corpus at lift.
2. **9b — mechanical orient (bash-runnable init).** Ship a real `orient` script in the scaffold:
   runs `InitCortexContext.scan` mechanics deterministically (no model synthesis) → writes
   `.cortex/CORTEX.md` if absent (Project/Key Commands/deps summary) → prints the workspace map +
   CAPABILITY steering to stdout (skills dir listing with one-line domains, SearchTools pointer —
   the bash-native affordance clause's natural home: harness-owned, frame-independent, works under
   persist). Boot prompt clause interpolated by the server to a RESOLVED path (project `.cortex/
   orient` if present, else the global scaffold copy) — never a relative probe at nothing.
3. **9c — lazy project-doc pickup at lift.** `buildDeferredStaticCorpus` must (re)read project docs
   (CORTEX.md/AGENTS.md family) at DELIVERY time, not boot — so a CORTEX.md written during the
   turn-1 orient call is included in the corpus that lands on that same call's tool_result.

**Touchpoints:** SystemMessageMiddleware (gate, ~line 326), promptPresets.ts (clause + server-side
path interpolation), scaffold assets (orient script), InitCortexContext (expose mechanical render),
CortexOrchestrator defer delivery (lazy doc read), .env.example + docs.

**Tests:** composition unit (defer + preset card → turn-1 sysMsg == preset text; corpus delivered
exactly once at lift; minimal/full unchanged); lazy-pickup unit (doc written after boot, before
lift → present in corpus); orient golden test (writes CORTEX.md, idempotent, prints skills index);
path interpolation (project beats global; absent → clause still valid via global). Probe recipe:
DEBUG_PAYLOAD → turn-1 `sysMsg≈659B tools=3`, corpus block on first tool_result, CORTEX.md inside.

**Verification rung:** local probe → **cell D** in the steering-arm family on the discriminating
subset (A = boot-minimal control [existing data], B = full-mass alone [small bracket cell],
C = full-mass + pre-generated CORTEX.md, D = defer-fixed steered door). Secondary metrics via
distiller: orient-obedience rate, SearchTools/Skill first-ever invocations, input-mass per task.

**Risks / non-goals:** corpus (~32KB) lands once in the moving turn = one-time cache-miss cost
(~$0.007, acceptable); clause obedience <100% is fine (corpus delivers at lift regardless — orient
only adds the workspace map); boot-prompt growth must not break turn-1 action (defer-trap lesson —
DEBUG_PAYLOAD gate before any fleet fire); NOT a change to minimal/full behavior or to the
model-synthesized /init flow (the mechanical render is additive).

## Item 10 — Helper-curated doctrine freshness (BUILT 2026-08-26 — legs 1,2,6 + compaction category; see status)

**STATUS: CORE BUILT (release-gated).** Built: orient v2 (machine-section markers, drift check,
.next/.diff staging, zero-decision stdout — full lifecycle live-tested), curateDoctrine helper
one-shot (frame-layer surface, adapter-registry provider-agnostic), orchestrator
ensureDoctrineFresh (synchronous-by-boundary: defer-lift await + full-mass pre-assembly hook;
bounded fail-open; doctrine_curation/_timeout decisions events), applyCuratedDoctrine containment
(size budget, .prev, atomic rename, staging cleanup — 8 tests), compaction template DURABLE
PROJECT NOTES category. Env: CORTEX_DOCTRINE_CURATION (default off) + timeout/budget knobs.
DEFERRED to a later train: leg 4 staged memory fold; compaction staged-delta FILE emission
(category lands in-summary only); fresh-edges sidecar emitter (canon-side).

**The problem:** system-message doctrine (CORTEX.md family, MEMORY.md) must stay fresh across
sessions in persistent environments (TUIs, repeated headless use) WITHOUT (a) busting the cached
prefix mid-session, or (b) giving the working model ANY turn-1 decision surface — every measured
failure class (defer-trap reason-to-the-wall, pro-persist paralysis, never-acted rows) was
deliberation induced where the model should have been acting. Earlier design candidates (model
merges the diff; model approves a staged diff; fresh-edges evidence in turn 1) were all rejected
for reintroducing exactly that hazard.

**The organizing doctrine (operator-set):** the MAIN model acts, always, only — turn 1 carries an
imperative and a map, never a question. The HELPER model (HELPER_MODEL_ID, default flash — the
same rail that already runs compaction summaries via HelperModelMiddleware.compactHistoryViaHelper
and the TURN_SUMMARY_PREDICTION post-turn hook) judges and curates in DISPOSABLE side contexts.
The MECHANICAL layer stages. BOUNDARIES deliver (session start / compaction / the defer lift —
the three moments the prefix is rebuilt anyway, so refresh is cache-free).

**Design:**
1. **Orient stays imperative + stages drift materials.** On drift (cheap structural check:
   machine-section content vs live ls/scripts), orient writes the mechanical refresh candidate to
   `.cortex/CORTEX.md.next` + a compact diff. Its stdout to the main model stays zero-decision
   (map + one informational line). Fresh containers/first sessions: write-if-absent as today —
   no drift branch, no overhead (bench path byte-identical).
2. **Session-start helper curation (new hook, mentorship-pattern).** A one-shot helper call —
   separate request, own context, zero main-session cache impact — receives: stale CORTEX.md +
   mechanical .next + diff (+ the OPTIONAL canon fresh-edges sidecar, see 5). It returns the
   CURATED doc. Harness validates (hard size budget, structural sanity), applies ATOMICALLY with
   `cp → .prev` rollback, records the event in the decisions store with helper provenance.
   SYNCHRONOUS-BY-BOUNDARY (operator-corrected 2026-08-25 — the earlier race design is
   REJECTED: it made doc delivery a nondeterministic function of helper latency, an uncontrolled
   instrument variable): under DEFER, the lift's corpus assembly AWAITS the helper's completion
   before delivering (the lift is the doc's only context entry, so this guarantees the session
   never runs on stale curated doctrine; the helper's seconds still overlap the model's turn-1
   tool execution). Under FULL MASS (persistent TUI/CLI), a PRE-ASSEMBLY hook completes drift
   check + curation BEFORE the turn-0 prompt is built. Both bounded by a hard timeout (~20-30s):
   on expiry, deliver the previous doc + log a curation_timeout decisions event — a helper
   outage degrades to yesterday's behavior, visibly, and can never hang a session. The
   first-turn pause is an ACCEPTED trade-off (operator-ratified 2026-08-25): drift-gating means
   only drifted sessions pay it, it lands once pre-first-token (the most forgivable latency slot),
   and surfaces (TUI/CLI) MUST show a status line during the hold ("refreshing workspace
   doctrine…") so the wait reads as work, not lag.
3. **Compaction leg = prompt extension to the EXISTING summary call.** The helper is already
   reading the whole session at compaction — extend compactHistoryViaHelper's prompt to also emit
   staged doctrine/memory deltas (a few hundred output tokens on an already-paid context; no new
   invocation). Deltas land in staging, folded at the next boundary.
4. **Staged memory fold (mechanical).** MemoryWrite lands in per-session staging files
   (`.cortex/staged/<sessionId>.memory.jsonl`); startup/compaction folds them into MEMORY.md
   deduped + budgeted (hot-index cap, overflow to archive tier via MemoryRecall). Multi-writer
   safe (parallel sessions/dispatch teams never race one file).
5. **Fresh edges: helper-input ONLY, never main-context.** canon-cron precomputes an optional
   per-workspace sidecar (edges touching this workspace since CORTEX.md mtime, success-filtered
   per the corpus-hygiene rule, ranked, capped ~10). Orient/hook cats it INTO THE HELPER PROMPT
   if present; absent = leg silently skipped. The main model never sees evidence, only outcomes.
6. **Containment for helper-written doctrine:** hard output budget · atomic write + .prev ·
   decisions-store provenance · conservative authorship rule (helper freely refreshes mechanical
   sections and its own prior curations, APPENDS observations, never deletes human-authored
   text) · compaction re-read verification (confirm rebuilt context reads docs fresh through the
   loader's mtime cache; one probe, else a one-line re-read at the boundary).

**Touchpoints:** orient scaffold (drift check + staging), HelperModelMiddleware (new session-start
hook + compaction prompt extension), memory tools (staged landing), scripts/canon (fresh-edges
sidecar emitter), SettingsSchema (hook toggle env, default off).

**Tests:** drift-detector table (no-doc / current / drifted); staging golden files; helper-apply
atomicity + rollback + budget rejection; race (lift before helper completes → previous doc, no
error); memory fold dedup/budget; bench-path regression (fresh container = today's behavior,
byte-identical orient output).

**Verification rung:** local probe (session 1 → drift session 2 → helper curates → lift delivers
curated doc) → persistent-workspace canary (dev TUI use) → optionally a TB2 cell only if a bench
analog exists (bench is session-1-only by construction, so this item is product-serving, not
bench-serving).

**Explicitly rejected designs (do not resurrect):** main-model merge at session start
(deliberation hazard); main-model diff approval (same hazard in miniature, fake judgment over
mechanical facts); fresh edges in main context (worst offender); silent unbounded auto-curation
(no provenance, no rollback).

**Companion item (also next-train): persist schema-presentation leak** — hidden tool schemas
surface in continuations under CORTEX_TOOL_ANCHOR_PERSIST (~40 wasted calls/arm measured on the
flip boards, dispatch guard correctly refuses); fix = keep hidden schemas out of persist-frame
continuation requests.

## Item 11 — Helper frame unification + compaction fidelity + foreign-thinking removal (BUILT 2026-08-26 — see status)

**STATUS: BUILT (release-gated).** 11a helperFrame.ts + base helpers (ChatCompletions adapter
wired: compaction/tool-summary/chunk/merge system lines; OTHER 4 adapters inherit the layer but
keep their existing frames this train — parity wiring = follow-up). 11b chunk-path full template
+ action-stream digest rendering in the shared extractTextContent (decisions-join at compaction
DEFERRED). 11c injectThinkingBlock unified to attributed user-role system-reminder for ALL
adapters (last thinking-typed branch removed; rechannel value preserved — the guidance content is
unchanged, only the channel; wire-validity reasoning_content untouched). 11d prefixStability.test
(3 tests: shared-prefix byte-identity, call-order purity, item-9 mixed-message delivery shape).
Tests: 8 curation + 3 prefix + 29 adapter + 117 mentorship/helper/prompt adjacent green; tsc
clean core/executors/types.

**Source:** full audit of every helper-model surface (HelperModelMiddleware.ts + the 5 dialect
adapters), operator-reviewed. Ten surfaces, ten hand-rolled frames, five dialect implementations
each — and two fidelity defects in the most load-bearing surface (compaction).

**11a — Shared helper-frame layer.** One composition implemented ONCE above the adapters, inherited
by all dialects and parameterized per surface: persona line + task frame + optional workspace
one-liner + HARD output budget + grounding rule ("preserve verbatim, never invent, cite what you
kept"). Today: roles inconsistent ("helpful assistant" ChatCompletions:99 vs "AI mentor" :1192 vs
none), Messages adapter routes a systemPrompt variable while ChatCompletions hardcodes one (parity
drift by construction), no surface receives workspace grounding, no uniform budget/grounding
discipline. Every FUTURE helper surface (item 10's curation hook included) registers on this layer
instead of hand-rolling frame #11.

**11b — Compaction fidelity (two defects, one improvement):**
1. **Chunk-path degradation (defect):** the shared 8-category template (HelperMiddlewareAdapter
   .interface.ts:253 — request/concepts/files/errors/decisions/verbatim-user-messages/state/
   pending) applies only to single-call compactions; the chunked path
   (ChatCompletionsAPIHelperAdapter.ts:228-233) swaps to a bare "Summarize this conversation
   section in N tokens" — the sessions LARGE enough to need chunking get the weakest frame.
   Fix: chunk path uses the full template with per-chunk budgets + a category-merge final pass.
2. **Action-stream blindness (defect, confirmed-in-code-path):** extractTextContent
   (interface.ts:238-244) joins `block.text || ''` — tool_use blocks (agent actions) and nested
   tool_result content contribute NOTHING, so an agentic session's summary is built from prose
   alone while the template's categories 3/5 ask for exactly the dropped evidence. Fix: render
   non-text blocks as one-line shapes (the doctrine-mine digest pattern: `tool: Bash(cmd…)` /
   `result: …first 120 chars`). Verify runtime shape with a tool-heavy probe first.
3. **Decisions join (improvement):** compaction reads the session while `.cortex/decisions.jsonl`
   sits beside it — join kind-tagged event rows (loop escalations, gate fallbacks, exit-masked
   failures) so summaries stop laundering failures as successes (corpus-hygiene rule applied to
   compaction).

**11c — RECHANNEL (or remove) mentorship interleaved thinking (operator-refined).**
generateInterleavedThinking + the between-tool-calls variant (HelperModelMiddleware.ts:1597-1700)
inject HELPER-AUTHORED first-person thinking into the main model's reasoning stream. Past evidence
(repeated): incongruence, confusion, coherence loss — the FOREIGN-THINKING mechanism: thinking
blocks are the one channel a model treats as its own prior voice; another model's content there is
identity contamination. The mentorship VALUE may survive via REFRAME: deliver the same guidance as
an ATTRIBUTED mentor nudge — system-reminder-wrapped text on the MOVING turn (tool_result/user
tail) — the exact proven channel of the ladder/R32/inaction/EndTurn nudges (+21 flips, zero cache
regressions). Rechannel first; remove only if the rechanneled form measures useless. ⚠ WIRING
CARE (touched in many surfaces): (a) distinguish WIRE-VALIDITY filler from mentorship injection —
DeepSeek REQUIRES reasoning_content on assistant messages (glossary), so some synthetic thinking
is transport-load-bearing and must NOT be swept; (b) the browser twin generateContinuationThinking
(live layer-3 emulation) is the same reframe candidate on its own surface; (c) map 2nd/3rd-order
consumers BEFORE editing (downstream-order rule). Doctrine in THINKING_GLOSSARY: helper output
arrives as ATTRIBUTED content, never first-person thinking; real provider thinking (layer 3, xAI
path) untouched and sacred.

**11d — Cache-compliance contract for ALL middleware injection routines (operator-set).** The R28
rule graduates from a comment to a TESTED contract every routine must pass:
1. NEVER mutate the stable prefix mid-session (system field, prior messages) — the only sanctioned
   history rewrite is compaction itself (a full prefix rebuild at a boundary).
2. ALL mid-session injections ride the MOVING TAIL (latest user turn / tool_result append),
   system-reminder-wrapped and attributed — the tail sits after every provider's cache boundary
   (xAI end-of-messages; Anthropic after the cache_control breakpoint; OpenAI/DeepSeek prefix
   tail), so it varies freely without busting the cache.
3. One-shot deliveries land at boundaries only (anchor lift, session start, compaction rebuild).
4. Helper calls are separate requests by construction — main-session cache untouchable from them.
5. TEST: a prefix byte-stability harness — across a multi-iteration tool loop, assert request N's
   serialized prefix is a byte-prefix of request N+1 (moving tail excluded) for each dialect;
   any middleware change that breaks the assertion fails CI. This turns the 0.27%-vs-98.5%
   cache-hit cliff into a regression gate instead of an archaeology exercise.

**Touchpoints:** HelperMiddlewareAdapter.interface.ts (frame layer + extractTextContent), all 5
adapters (inherit frame, chunk-path fix), HelperModelMiddleware.ts (surface registration, 11c
removal), SettingsSchema (any removed toggles deprecated not repurposed).

**Tests:** frame-layer composition table (each surface gets persona+budget+grounding); adapter
parity (same surface → same frame bytes across dialects); chunk-path template presence; digest
rendering golden (tool-heavy session → actions visible in helper input); decisions-join presence;
11c: no thinking-channel injection remains (grep-level + runtime probe).

**Verification rung:** unit + one compaction probe on a real tool-heavy session (before/after
summary quality read via distiller categories); 11c removal = regression sweep on mentorship
tests + one live session confirming no synthetic thinking blocks in the wire payload.

## Item 12 — Task-integrity guard (anti-reward-hacking; BUILT 2026-08-26)

**STATUS: BUILT (release-gated).** Layer 1 description clauses (WebSearch/WebFetch/Bash) +
layer 2 CORTEX_TASK_INTEGRITY prefix-stable system line (survives boot-minimal; off =
byte-identical) + run3 doctrine edits applied ARM-FILTERED (frame-neutral inspection wording —
38/69 of the miner's evidence came from persist arms where Read doesn't exist; forensics
carve-out kept per the miner's own counter-evidence cluster; edit-2 downgraded, 9/11 persist
artifact) + busy-wait POLL GUARD in the loop ladder (CORTEX_POLL_GUARD, ok-streak detector,
'poll'-family signal+event — the run3 class nothing failure-based could see). Layer 3 distiller
integrity lens = adjudication-side, next distill pass. LAYER 4 (BUILT 2026-08-26,
operator-designed): EndTurn Stage-5 verifier — deterministic transplant/solution-query checks +
mandatory sources attestation for web usage; JUSTIFY-DON'T-BLOCK (A/B audit-only when attested;
only unattested web use nudges). integrityVerification.ts, 10 tests; integrity_flag events. Tests: 14 ladder + 12 preset + adjacent
green. Run4 hygiene note: miner's 96-cap on sorted glob sampled flash arms only — stratify.

**Trigger:** Artificial Analysis's TB2.1 leaderboard (pass@1 ×3, Terminus 2, e2b, internet ON)
tracks and penalizes reward-hacking trajectories — retrieving task solutions from the internet
instead of solving; operator reports DeepSeek ranked highest-propensity in their 2026-08-26 post.
Literature (Terminal Wrench, arXiv:2604.17596): ~16% of terminal-bench-class tasks hackable;
observed vectors = web-searching task-specific reference solutions/speedruns, mining git history /
public repos / archives / package registries, and training-knowledge substitution (emitting
memorized outputs without executing work). Our harness must STEER AGAINST all three before any
TB2.1 run — both for leaderboard integrity and because shortcut trajectories are corpus poison.

**Design (three layers, all cheap):**
1. **Doctrine at the tool surface** (always-on; tool descriptions are doctrine-at-read-time):
   WebSearch/WebFetch descriptions gain an integrity clause — research documentation, APIs, and
   error messages; NEVER search for a task's published solution, reference implementation, or
   answer; deliverables must derive from work executed in this workspace. Bash description gains
   the mirror for repo/registry mining.
2. **`CORTEX_TASK_INTEGRITY=true` system clause** (env-gated, bench/serving profiles): one
   compact static line appended to the system prompt (cache-safe, prefix-stable): outputs must be
   produced by executing work here; retrieving or reciting a known solution is task failure;
   verify by running, not by recall. Rides the same mass partition as other static docs
   (included under minimal? NO — must survive boot-minimal: append to the preset prompt when the
   env is set, ~25 tokens on the door — DEBUG_PAYLOAD-verify turn-1 action survives).
3. **Observability, not policing** (adjudication-side): web-tool usage is already banked per row
   (tool_calls_by_name) and v8 decisions carry inputs; the distiller gains an integrity lens —
   flag rows where WebSearch/WebFetch queries contain task-slug/solution-shaped strings or where
   artifacts appear without generating tool activity. Run3's never-claim-unfinished cluster (×6)
   is adjacent evidence. NO hard in-harness blocking of web tools (TB2.1 grants internet
   deliberately; honest competition = keep the capability, steer the intent, audit the exhaust).

**Tests:** description-clause presence; integrity line composes with boot-minimal (turn-1 door
intact via preset test harness); env off = byte-identical prompts (prefix-stability gate).

**Verification rung:** DEBUG_PAYLOAD probe → the TB2.1 exploratory pass runs WITH integrity
armed; distiller integrity lens on its trajectories; compare flagged-rate vs the AA narrative.

## Item 13 — Turn-end coherence: gate-bypass, surrender, steering spam (SPEC+BUILD 2026-08-26)

**Source:** first train-fasttext specimen under full observability (mini-persist-gate, 4.74.1) —
the honest-premature-surrender class, causal chain fully grounded: OOM'd background run → varied
/proc probes (tracker-invisible) → nonzero exits under pipefail → MAX_CONSECUTIVE_ERRORS=3 blunt
loop-kill MID-DIAGNOSIS → R29a tools-suppressed synthesis (EndTurn gate structurally BYPASSED —
it lives inside the loop; R29a runs post-loop with tools=[]) → impeccably honest surrender WITH
a self-written recovery plan and 85% budget unused. Also: `diversity` steering injected 15
consecutive iterations (no latch), wrong message for Bash under a bash-anchored frame.

**13a — Gate-coherent abnormal exits.** (i) When gate-armed + tools-used and the turn ends via
the R29a path, bank `endturn_gate_fallback` reason 'abnormal-exit-bypass' — un-attested passes
become visible to the distiller. (ii) R29a's reminder gains attestation-lite: enumerate which
task requirements are satisfied (and how verified) and which are NOT — Stage-4's re-read-the-task
effect without needing the tool.

**13b — Surrender guard.** (i) In-loop, at the normal no-tool-use exit (same mechanics as gate
nudges): final text matching remaining-work shapes + tools used + CORTEX_SURRENDER_NUDGE=true →
ONE "you wrote the plan — execute it now" nudge, then continue; surrender_nudge event either way.
(ii) ROOT TRIGGER: bench/serving profiles raise MAX_CONSECUTIVE_ERRORS 3→6 (three failing
diagnostic probes are normal debugging; the ladder's remind@2/diversify@4/break@6 is the graceful
owner of persistent failure — the blunt breaker should be a rarer backstop).

**13c — Diversity-warning latch.** getDiversityWarning fires on threshold CROSSINGS only
(10, 20, 40… doubling), not every iteration after 10; under a narrow bash-* profile the Bash
threshold starts at 30 (10+ Bash calls is the NORM when bash is the whole surface).

**Non-goals:** re-entering the tool loop post-R29a (structural change to the mega-loop, wrong
risk profile hours before a launch); budget-fraction awareness in-harness (budget is a
bench-side concept).

## Item 14 — Mini-distill findings: BashOutput tail-truncation + near-dup breaker (2026-08-26)

**Source:** formal distill over the 6 train-fasttext mini cells (.bench/distill-minis/) + the
FIRST events-joined doctrine-mine pass (run4: 128 events joined, 21 clusters, busy-wait
corroborated with event-grounded quotes).

**14a — BashOutput tail-truncation (BUILT, rides next train).** The oversized-result guard
hard-refused a 368K-token background training log with Read/Grep-shaped advice that is
unactionable for BashOutput (no navigation params) — the model could NOT harvest its own
training results. Fix: BashOutput oversize returns the TAIL (~limit tokens) as a SUCCESS with a
truncation notice pointing at the filter param; Read/Grep/Bash keep the guidance-error path.
3 tests.

**14b — Normalized near-dup breaker (SPEC — the fix-set item c, now twice-corroborated).**
Distiller: near-identical call cluster ×65, max 4 CONSECUTIVE (varied params: model_v#, pids)
— below the exact tracker AND the poll guard by construction; the models even used the correct
in-call wait idiom but re-issued it with tweaked params for hours. Design: sliding-window
counter over normalizeApproachText hashes (the approachHash already collides near-dups) —
N same-approach calls within the last M calls regardless of interleaving → one ladder-style
diversify nudge; 2N → break. Bounded, window-based (NOT consecutive), env-gated
CORTEX_NEARDUP_BREAKER. Defer to post-matrix train — core-loop change, wrong risk hours
before a launch.

**14c — Timeout error-family mislabel (NOTE).** Tool-timeout kills surface as error family
"command was cancelled by user" — misleading to the family lens and to models reading the
error. Relabel at the classification site next train.

**Run-target staleness (miner hygiene):** doctrine-mine's run2 target carries pre-4.74
description text — regenerate the target from CURRENT BaseToolRegistry before run5, or the
miner audits doctrine that no longer ships (one marginal cluster produced exactly this way).

## Item 15 — $() blacklist + YOLO/permissions-in-headless (RULED + BUILT 2026-08-26; operator-set)

**STATUS: operator ruled "go ahead with the recommended fixes" → BUILT (rides 4.78.0):**
(b)-minimum — `$(( ))` arithmetic no longer flagged (nested real substitution inside
arithmetic still blocked); (a) — `CORTEX_ALLOW_CMD_SUBSTITUTION=true` lifts the check for
sandboxed profiles, default off, documented in .env.example; denial message now teaches the
accepted alternative. 4 new integration tests; env-docs gate green. NOT built (explicitly):
backtick/`<()` coverage — closing the porosity would need a semantic validator or a
permissions-plane move; left for a future ruling/autoresearch.

**Finding:** mini specimens show 8+ `command substitution using $() is not allowed` denials
(tb2-friction-bash-subst, still unfixed) including FALSE POSITIVES on `$(( ))` arithmetic (naive
substring match); the denial→rewrite→variant loop feeds the near-dup class (14b's feeder).
**Operator question first:** headless CLI was believed `--yolo` by default (permissions layer
inactive headless), but `.env.example` ships `YOLO=false` — map the YOLO env through the
permissions middleware and establish what the sterile bench container ACTUALLY runs before any
policy change. **Then rule (operator decision — $() blocking is the injection defense, a
SECURITY control):** (a) bench-profile allowance in sandboxed containers, (b) semantic validator
(un-flag `$(( ))` at minimum — plain bug in any threat model), (c) leave for autoresearch.

**INVESTIGATED 2026-08-26 (post-compaction; all claims file:line-verified). Three findings:**

1. **The operator's belief is CONFIRMED in effect — headless runs are permissions-bypassed
   regardless of `YOLO=false`.** Persistent-server path: `packages/server/src/index.ts:555`
   `headlessAutoApprove = !process.stdout.isTTY && CORTEX_HEADLESS_APPROVE !== 'false'` feeds
   `yolo` (index.ts:556) → `permissionMode: 'auto'` (index.ts:231) → `bypassAll: true`
   (OrchestratorFactory.ts:459) → PermissionsMiddleware.ts:160 short-circuits ALLOW on every
   tool with no policy evaluation. Stateless per-request path (routes/messages.ts:95):
   `YOLO=false` → `permissionMode: 'disabled'` → the middleware is never constructed
   (factory:423). The bench adapter spawns `cortex-server` from a python subprocess (no TTY),
   so `headlessAutoApprove` is true → bypassAll. `.env.example`'s `YOLO=false` is INERT for
   every headless surface; it only governs TTY-attached interactive prompting.

2. **The $() denial does NOT come from the permissions layer** — it is
   `ShellTool.validateToolParams` (packages/executors/.../ShellTool.ts:162-164): an
   unconditional `params.command.includes('$(')` substring check inside the tool itself,
   active in EVERY mode including full YOLO/bypassAll. Options (a)/(b) therefore mean
   editing the tool validator, not the permissions plane.

3. **The control is porous by construction**: backticks and `<()` process substitution are
   not checked anywhere in ShellTool — only the `$(` spelling is blocked. A model wanting
   substitution semantics rewrites with backticks (observed: the denial→rewrite→variant
   loop), so the check does not foreclose command substitution; it taxes the natural
   spelling, false-positives on `$(( ))` arithmetic and quoted literals, and feeds the
   near-dup class.

**Recommendation (ruling stays with the operator):** (b)-minimum now — stop flagging `$(`
immediately followed by `(` (the arithmetic false positive is a plain bug under any threat
model). Given finding 3, (a) for sandboxed bench containers costs nothing security-wise the
backtick hole doesn't already give away; a real injection defense would need a semantic
validator covering all three substitution spellings plus quoting context, or should live in
the permissions plane where modes can govern it.
