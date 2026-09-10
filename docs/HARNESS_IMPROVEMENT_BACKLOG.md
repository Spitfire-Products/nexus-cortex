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

## HB-SLICE-BLOCK — coercive escalation of the ignored slice-nudge (BUILT + tested, DARK 2026-09-09)

Deficiency: `CORTEX_SLICE_NUDGE` (reson, ON) fires ONE reminder at the 3rd bash slice-read of a file then goes
silent; full-sample compliance mining (k5 @4.91.1, **66 nudge-fires**) proves it is **IGNORED ~80% of re-tested
cases** (93% of ignored files are NEVER `Read`; harm concentrates in a 39% deep-grinder tail, up to 23 extra
slices of one file). Re-firing the ignored channel is not supported by the data; a coercive block is.

Fix (built, dark behind `CORTEX_SLICE_BLOCK`, sibling of `loopToolBlock`): a pre-execution gate
`maybeBlockSliceRead` that, after `CORTEX_SLICE_BLOCK_AT` (5) slices of a STATIC/source file, refuses to run
further slice-reads of it (append-only redirect → force `Read`), bounded to `CORTEX_SLICE_BLOCK_MAX` (2)/file.
Scoped: append-mostly logs exempt (legit re-tailing) + path-like gate (never blocks `echo`/`python3` the shared
slice-regex over-captures from pipelines). Banks `slice_block`. Files: `sliceBlock.ts` (14 unit tests) +
`CortexOrchestrator` (2 executor sites) + `ToolProfile`/`effectiveConfig`/`.env`/`DecisionStore`.
Validated: 14 unit + orchestrator e2e 26/26 + tsc clean + a **real-trajectory replay** (fires correctly on
gcode/make-mips/circuit source files, all command-keyword false-positives excluded). **Owed:** A/B on the
slice-heavy source pop before default-on. Full spec + evidence: **`docs/HB-SLICE-BLOCK-SPEC.md`**.

## HB-HELPER-VISION — vision-capable general helper + image passthrough on the overflow paths (BUILT 2026-09-09)

Two coupled changes, both shipping on the next train:
1. **Vision-capable general helper default.** `HELPER_MODEL_ID` = `deepseek-v4-flash-vision-exp` (was `deepseek-v4-flash`).
   Same cost ($0.14/$0.28), near-identical text (bench-arm parity), + vision — so ONE helper card serves compaction,
   web-fetch summary, error guidance AND the ReadImage/`describeImage` hand-off (`VISION_HELPER_MODEL` can later collapse
   into it). Mentor roles unaffected (`MENTORSHIP_HELPER_MODEL`=pro overrides `HELPER_MODEL_ID`). `.env` + generated `.env.defaults`.
2. **Image passthrough on the two overflow paths.** Before this, compaction DROPPED `{type:'image'}` blocks
   (`renderBlock`'s `return ''`) and tool-result summarization `JSON.stringify`'d them into a base64 text blob — visual info
   lost, base64 bloat. Fix: `helperImageBlocks.ts` (pure, normalizes canonical/anthropic/openai image shapes; 11 unit tests)
   + `HelperModelMiddleware.describeAndReplaceImages` (describe each image via the existing `describeImage`, which ALWAYS
   resolves a vision card independent of `HELPER_MODEL_ID` → replace the block with one line of text; marker fallback on
   error). Wired at the compaction choke point (`compactHistoryViaHelper` → covers history + combined overflow) and in
   `handleToolResultOverflow` (describe BEFORE stringify); `renderBlock` safety-net marker so images are never silently
   dropped again. Purely additive (same array ref when no image → common path byte-identical). tsc clean; 11 new + 29 + 17
   existing helper tests pass. NOTE: images in the harness normally ride `tr.metadata.imagePayload` (consumed+deleted by
   `collectPendingImages` before history reuse), so the live trigger is a vision-primary session whose injected image
   user-messages (`injectImageUserMessage`) survive into an overflow.

## HB-WEBFETCH-VISION — page screenshot → vision helper, via a lazy-loaded internal browser module (IDEA, logged 2026-09-09)

Evaluated 2026-09-09 (Explore agent, grounded): **web_search gains nothing** (returns text snippets/URLs; a SERP
screenshot adds nothing over the structured list). **web_fetch gains real capability ONLY if a screenshot is added** —
today every path returns text (Gemini urlContext, provider-native, and the `fetch()`+`html-to-text` fallback: no JS
execution, no rendering), and `summarizeWebContent` embeds the page as plain text, so the vision helper alone is INERT
(nothing in the web path is ever an image). A rendered screenshot fed to the vision helper (via a `describeImage`-style
call) WOULD help JS/SPA pages (the `fetch`-only fallback gets little), layout/table/chart pages that flatten badly through
`html-to-text` (`img` is `format:'skip'`), and visual-only/anti-bot renders.
- **Cost:** a headless browser per fetch + render time + image tokens + a ~30–60s vision round-trip.
- **Build vehicle (operator, 2026-09-09): an INTERNAL version of the browser MCP as a LAZY-LOADED harness module, spun up
  on demand.** Playwright screenshot managers ALREADY exist in `packages/executors/.../addon/`
  (`HybridScreenshotManager`/`ScreenStream`/`KeyframeDetector`) but are scoped to the sandbox/artifact visual-feedback
  pipeline (screenshotting the harness's OWN UI) and NOT wired to arbitrary URLs — a driver-abstraction port
  (CF-Worker | local-Playwright driver, optional dep ~300MB Chromium) is the decoupled nexus-browser-as-library idea.
  Lazy-load only when a page needs rendering, so the ~300MB dep + browser boot cost is paid on request, not by default.
- **Cheaper existing escalation:** `browseEscalationDirective` (WebFetch) + web_search `mode:'interactive'` already hand
  JS-heavy work to a nexus-browser subagent. So this is a want, not a need — logged, not scheduled.

## EVAL — ttfx (Rust terminal text-effects) for TUI polish (IDEA, logged 2026-09-09, operator-requested)

Operator asked to evaluate **github.com/omacom/ttfx** for "our TUIs or the SPA — more efficient + more
flexibility." Grounded (WebFetch 2026-09-09): ttfx = **MIT Rust CLI**, an officially-sanctioned Rust port of
TerminalTextEffects (Python). Pipes stdin → renders **37 animated text effects** (decrypt, matrix, beams,
fireworks…); single ~3.3MB static binary, no deps, ~0.5ms startup (vs Python ~64ms), median **~27.5× faster**
than the Python original, byte-identical output.
- 🔴 SCOPE CORRECTION (temper the ask): it is **NOT a TUI framework, layout engine, or renderer** — it's a
  text-ANIMATION effects pipe. It will **not** make a TUI "more efficient" (no render/layout perf gain). Its
  value is **flexibility/polish**: flourish for the nexus-cortex TUIs (fuzzycortex/neoncortex) — boot/orient
  animations, completion/finish effects, banners, streamed-reveal — the open polish gap ([[tui-release-2-context]]).
- **SPA fit is INDIRECT**: it's a terminal binary, not web code → not droppable into the React SPA. Options:
  (a) run it inside the SPA's SHELL/TMUX xterm windows (a container-side binary), or (b) reimplement the few
  effects we'd want in JS. Not a direct dependency.
- **EVAL when TUI polish is prioritized**: try `<cmd> | ttfx <effect>` in a TUI render path, measure the
  startup/latency budget against the **streamed** layout (operator prefers the streamed layout as final —
  [[feedback-tui-streaming-layout-preferred]]); decide effects-as-Rust-dependency vs port-what-we-use. Cost =
  a Rust binary in the TUI distribution (or a SHELL-only toy). Verdict pending the eval; logged, not scheduled.

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

## REPL-INDEPENDENT CONTINUITY — worker-cron keepalive (the unbuilt half of def-2332d425c8)

**Status: QUEUED (post-k=5; owner-gated worker deploy). Banked 2026-09-03 (operator: "bank it in the backlog").**

**Problem.** Item 9 (bench-lease registry) made bench COST repl-independent but NOT CONTINUITY. The
ONLY keepalive is the repl-side watchdog tick (`tb2-relaunch` → inbound request resets CF
`sleepAfter:20m`). A repl outage >20min idle-SUSPENDS lanes (proven 2026-09-03: 25/32 lanes stalled
during a repl restart; internal supervisor CPU does NOT reset sleepAfter — it is inbound-request-driven).
Guardian re-arm + resume-from-store lose no data/cost, only WALL-TIME. def-2332d425c8's original decision
was "worker-cron keep-alive + TTL-destroy"; item 9 shipped only the destroy half.

**Root cause / mechanism (grounded, `nexus-terminal/workers/nexus-cortex/src/index.ts`).**
`benchSweep` (217-233) ONLY destroys expired leases; the worker deliberately never pings a live DO
(index.ts:834 "a DO request would reset sleepAfter"). The pieces to build it already exist: the cron
already runs `*/5 * * * *` (wrangler.jsonc — 4× margin on 20min); the `ncxbench:` leases already store
every live `doName` (and lease presence = the has-work signal, released on complete); `sandboxAdmin(env,
doName, path, body)` reaches any DO via the `SANDBOX` service binding with NO admin token.

**Fix (~5 lines).** In the existing `scheduled()` sweep: for each LIVE lease (`now < expiresAt`), send a
lightweight touch (`sandboxAdmin(env, lease.doName, '/health', {})`) to reset its sleepAfter; expired →
destroy (unchanged). Only leased (= has-work) lanes get pinged, so finished lanes still sleep. Bounded
waste: if the repl is dead when a lane finishes, its lease lingers ≤TTL (90min) keeping it warm — zero it
by also checking the store done-set, or accept the bound.

**Alternatives (the clock is free; the authenticated per-DO fan-out is the work).**
- **CF worker cron (free, KEEPALIVE-only):** the ~5-line fix above. Prevents sleep but CANNOT run the full
  tb2-relaunch placement/boot logic (that's repl-side python) → it keeps live DOs warm but cannot RESURRECT a
  dead lane's supervisor.
- 🔴 **Replit Scheduled Deployments (paid, FULL RELAUNCH, repl-independent) — the strongest candidate, initially
  under-rated (2026-09-03, operator caught the ungrounded dismissal).** Runs in a SEPARATE deployment env
  (1vCPU/2GiB, up to 11h/job, no concurrency cap) INDEPENDENT of the crash-prone workspace VM, on a natural-language
  cron. Because it runs OUR python, it can run the ENTIRE `tb2-relaunch.py` (keepalive + relaunch dead lanes +
  renew leases) off-VM — a more COMPLETE continuity layer than the keepalive-only CF cron. UNKNOWNS to verify at
  build: does the deployment env carry the repo + secrets (admin/HF/DeepSeek) + egress to the CF worker; billing is
  Replit compute-credits/run (cheap for short jobs). Docs: docs.replit.com/cloud-services/deployments/scheduled-deployments.
- **Replit Routines (Agent-scheduling, paid, POOR fit for a tick):** schedules the Replit AI AGENT to repeat work
  in a Conversation, Power/Max Mode BUDGET PER RUN. Drives the AI (non-deterministic, credits/run) — absurd as a
  frequent keepalive. POSSIBLE as a LOW-frequency repl-independent HEALER (fire the Agent to run the pm-wake-loop
  drill) IF a Routine wakes a dead workspace (UNVERIFIED) — but pricey per fire. Docs: docs.replit.com/updates/2026/08/21.
- **Container self-ping** (robust, zero external dep, auto-stops at COMPLETE — needs token-in-container + unverified
  "container resets its OWN sleepAfter"); **browser-SPA tick / UptimeRobot / home-cron** (fragile clocks, each still
  needs the worker to own the fan-out); **market-websocket tick** (solves timing, already free; not the fan-out).
**Leading design: Replit Scheduled Deployment running tb2-relaunch (full off-VM relaunch) OR the CF cron keepalive
(free, sleep-prevention only) — or both layered.** Verify the touch/relaunch path before shipping; NOT a mid-run deploy.

**🟢 TWO VERIFIED CANDIDATE IMPLEMENTATIONS of the CF-cron keepalive exist (2026-09-05, local-harness A/B capability test).**
Built by the LOCAL nexus-cortex harness (deepseek flash vs pro, under the bench reson config, off the Anthropic budget — the
dogfooding capability test) and orchestrator-verified. Both edit `benchSweep`'s live-lease branch (index.ts ~227) to touch the DO
before `continue`:
```ts
if (now < lease.expiresAt) {
  await sandboxAdmin(env, lease.doName, '/health', {});  // reset sleepAfter on still-leased lanes
  out.live++; continue;
}
```
`/health` IS a real DO route (index.ts:276); the expired→`/admin/destroy` branch is untouched in both. BOTH pass `tsc --noEmit`.
- **flash (+13 lines):** the above PLUS a `touched` counter (extends the `benchSweep` return type + accumulator, surfaced via the
  existing `/admin/bench/sweep` route) PLUS refreshes 2 now-contradicting comments (the line-834 "NOT probe" note + the `scheduled()`
  docstring). **Preferred** — an observable keepalive is easier to trust in prod. Wall 467s.
- **pro (+4 lines):** the minimal touch only (no counter, no type change). Tightest diff. Wall 418s.
- Local work products (regeneratable, NOT committed — `.bench` is local): `/home/runner/workspace/.bench/local-ab/arm-{flash,pro}/nexus-cortex/src/index.ts` + each `FIX_NOTES.md`.
- **2 deficiency datapoints from the run:** (i) **deepseek-v4-pro fetch-failed 1 of 2 runs** (flash 0/1) — a pro-path transport reliability wobble in the local harness; (ii) the harness agents **could not run their own `tsc`** (git/npm in the nested monorepo copy timed out) → they fell back to inspection — a self-verification friction worth smoothing.
- NOT applied/deployed (worker deploy is owner-gated). To ship: apply flash's version to the real `nexus-terminal/workers/nexus-cortex/src/index.ts`, review, deploy via `.github/workflows/deploy-workers.yml`.

## STEERING-EVENT CONTENT IS UNBANKED — lift_plan / endturn_resolver record METADATA, not the plan/verdict TEXT (2026-09-05, resolver-AB)
**Evidence.** The resolver-AB run (`.bench/resolver-ab/`) banks per-task `decisions.jsonl` events, but the mentor-steering
events carry only counters: `lift_plan.detail = {fired, planChars, retire, criteriaStated}`; `endturn_resolver.detail =
{meets, planChars, rejects, parsed}`. The actual **plan prose** (adversarial analysis + criteria + step plan) and the
**resolver verdict/fix-plan text** are injected as post-record system-reminders, which the session trajectory is blind to
(the known "records don't capture post-persist injections" trap). Consequence: plan QUALITY is unanalyzable, and outcome
CAUSATION can't be attributed (we could see the resolver fired GAP×2 on sqlite-with-gcov and the task flipped 0→1, but
NOT read WHAT it told the model; and we could NOT read the retire plan to judge whether a `retire=True` was well-reasoned).
**Fix.** Bank the content on the event (same pattern as the `effective_config` capture added this session): put the plan
text + verdict + fix-plan on `lift_plan`/`endturn_resolver`/`steering_injected` events (or a sibling `steering_content`
sidecar keyed by sessionId+ts), truncated to a sane cap. Then the distiller can score plan quality, and A/B adjudication
can attribute a flip to the specific steering the model received — closing the mechanism-engagement loop from "it fired"
to "here is what it said and here is the turn it changed." Touchpoints: the DecisionStore steering-event writers +
whatever emits the metadata-only `detail` today. Verification rung: a live seeded run whose banked event carries the
plan text verbatim.

## THE `retire` SIGNAL IS INERT — the narrow-door action model ignores "retire" and grinds to the budget wall (2026-09-05, resolver-AB)
**Evidence.** `make-mips-interpreter`: lift planner returned `retire=True` in resoff (and `retire=False` in reson — pro
mentor nondeterminism on the same task/config). The resoff model did NOT retire: it ran 119 tool iterations / 132 tool
calls / **budget_frac 1.002** (ground to the FULL budget wall) and failed. So the `retire` recommendation had ZERO effect
on behavior — the model ignored it and burned the whole budget. (reson finished at budget_frac 0.837 and passed — the
flip was grind-timeout nondeterminism, NOT the retire and NOT the resolver, which was silent there.)
**Why it matters.** If `retire` is meant to SAVE budget on genuinely-hopeless tasks (its whole point — quarantine
overthinking, don't grind a lost cause to the wall), it must actually SHORT-CIRCUIT the loop (e.g. a bounded graceful
finish / early-exit path when the planner retires with high confidence), not be a plan line the action model discards.
As-is it's a no-op: neither harmful (model ignores it) nor helpful (no budget saved). Design tension: a false-retire that
DID short-circuit would be an own-goal (a wrongly-abandoned task), so any teeth on `retire` needs a confidence gate +
the mechanism-engagement evidence to tune it — which itself needs the plan-text banking above. Sequence the two: bank
the content first, then decide whether `retire` earns teeth.

## THE ENDTURN RESOLVER SKIPS `endturn_gate_fallback` FINISHES — a backwards coverage gap (2026-09-05, resolver-AB)
**Evidence.** Resolver firing census over 11 reson tasks: fired on 8/11 (12 fires; GAP×5 tasks, MEETS×3). The 3
non-fires: `make-mips-interpreter` and `circuit-fibsqrt` BOTH finished via `endturn_gate_fallback:1` and the resolver
never fired on them; `bn-fit-modify` finished fast/clean (budget_frac 0.13, no gate event). So the resolver fires after
a NORMAL gate acceptance (`ev.endTurnCalled===true`) but the streaming gate's **fallback-accept path bypasses it**.
**Why it's backwards.** The fallback-accept is reached only after the mechanical gate nudged → re-requested → gave up
and accepted anyway — i.e. exactly the finishes the gate was LEAST comfortable with. Those are the finishes that most
deserve the resolver's does-this-meet-requirements adjudication, and they're precisely the ones it skips. (make-mips
then ground to budget_frac 1.002 and failed; a resolver GAP there might have redirected the grind.)
**Fix.** Invoke `adjudicateEndTurn` on the fallback-accept branch too (the streaming loop's fallback path in
`endTurnGates.ts` / the :4706 site), not only on the primary accept. Guard against double-fire (fallback already
consumed the nudge budget) and respect `..._MAX_REJECTS` so a fallback→resolver→GAP loop stays bounded. Verification:
a live seeded run where a task that previously hit `endturn_gate_fallback` now shows an `endturn_resolver` event.
Cross-ref: the three-execution-paths lesson (4.91.0 DELTA — a hook that looks wired can be silently dead on one path;
prove it with a live event, not tsc).

## EXPERIMENT (candidate, GATED on resolver-k5 post-adjudication) — deadline-triggered exit-mentor: turn `CORTEX_TURN_DEADLINE_MS` from a dumb "finish now" nudge into a mentor-directed exit (2026-09-05, operator-raised)
**Status. ✅ BUILT + shipped DARK (verified in-code 2026-09-09 — the "NOT built" below is STALE).** The full smart-deadline
form is live: `training/deadlineExitMentor.ts` (checkpoint verdicts CONTINUE/FINISH/ACTION/RETIRE, residual-scaled budget,
fail-safe to CONTINUE) + orchestrator integration (`deadlineExitCheckpoint` fires at the WARN rung `:3154`; FINISH/RETIRE →
`shouldBreak` → post-loop synthesis with the resolver bypassed via abnormal exit; ACTION injects the step; the unconditional
hard-floor break stays at `:3233`) + `CORTEX_TURN_DEADLINE_MS`/`CORTEX_DEADLINE_EXIT_MENTOR` BOTH reported in `effectiveConfig.ts`
(the observability gap noted below is also closed). 🔴 STILL OPEN = ONLY the **valid efficacy run**: k5v2 fired it 0× because
its subset failed by early give-up (budget_frac 0.24-0.31) and never reached the warn rung — run it on the ≥0.80 budget_frac
FINISHING population (schemelike, make-mips, install-windows, filter-js, pytorch). No code re-target is required; it's a
population + lever-on run. (Optional cosmetic tuning: warnFrac 0.9→0.911 to hit exactly 0.82; leave unless the A/B motivates it.)

**[HISTORICAL — pre-build spec, kept for trace]** NOT built. A v2 idea for the `#2` wall-clock deadline lever, to spec ONLY after the resolver-k5 adjudication data
is analyzed (it sizes the population this affects). Recorded so it isn't lost.
**Today's mechanism (verified).** The supervisor sets `CORTEX_TURN_DEADLINE_MS = 0.9 × task_budget` (`tb2-durable-supervisor.py:164`).
At the `break` rung (`CortexOrchestrator.ts:3061` non-streaming, `:4996` streaming; state from `timeBudget.ts`) the loop logs
"#2: turn wall-clock deadline reached — forcing synthesis" and tells the MODEL to wrap up. That self-wrap then (if the gate
accepts) hits the EndTurn resolver (pro@max) — a two-step tail on the last 10% of budget.
**Data motivation (resolver-k5, ~68/110 rows).** (a) The current order OVERRUNS: deadline-bound tasks bank `budget_frac`>1.0
(schemelike 1.14, circuit 1.12, make-mips 1.05) — model-wrap THEN resolver pushes total wall-clock past budget. (b)
`filter-js-from-html`: resolver keeps pushing a hopeless task (+68% cost vs control, still 0/n) — no "retire/abstain" exit. (c)
~22% of attempts hit the deadline (concentrated: make-mips, schemelike, circuit, install-windows).
**The idea.** At the deadline, instead of directing the MODEL to wrap, invoke a **mentor-as-deadline-exit-planner** (a THIRD
mentor invocation, distinct from lift-plan and endturn-resolver): input `{current work-product, remaining budget}` → output one
of {already-meets-criteria → finish now + attestation; X% short → the ONE minimal action worth the residual → do Y then finish;
unsolvable in residual → **retire cleanly**}. The retire branch also kills the filter-js over-spend.
**🔴 The operator's "move it up to 80–85%" refinement — and why a FLAT move is wrong.** Moving the force-synthesis trigger earlier
gives the exit-mentor more residual, BUT resolver-k5 shows **11/46 passing rows (24%) finish at ≥0.80 of budget** — they solve
in the last fifth. `schemelike` passes at frac 0.81/0.86/0.96/0.96/0.98/1.03/1.14 (a 100%-pass task that solves LATE, several
PAST the 0.9 deadline and still passing); also circuit (0.92,1.12), sqlite-db-truncate (0.90,1.03), make-mips (0.96, its only win).
A flat 0.80–0.85 deadline would truncate ~a quarter of current WINS. **So make the deadline SMART, don't slide the number:** promote
the existing `warn` rung (~0.82) into the exit-mentor CHECKPOINT that DECIDES on-track (closing in like schemelike → hands off,
let it run) vs stuck (grinding like filter-js → direct exit/retire NOW), and keep `break` (~0.92) as the hard floor. Two-tier reuses
the existing warn/break machinery; the residual-budget worry self-solves (mentor only seizes the remainder when it judges the task stuck).
**Constraints.** (1) The exit-mentor's own budget must be RESIDUAL-scaled, not its default (`..._BUDGET_TOKENS=4000, TIMEOUT_MS=90000`
could eat the entire 90s residual of a 900s task). (2) A mentor-directed finish must BYPASS the normal EndTurn resolver (no double
pro@max pay). (3) Value is GATED on the mentor's assessment quality — if it can't tell "schemelike closing in" from "filter-js
grinding", an early checkpoint HURTS (kills schemelike). That's the same exit-planner-output-quality question the k5 adjudication measures.
**Spec shape to A/B.** `checkpoint@0.82 (mentor decides) + hard floor@0.92` vs the current flat `0.90`, measured on the 0.80–1.0
finishing population, on BOTH pass-rate and the `budget_frac>1.0` overrun. Own arm — do NOT fold blind into the resolver A/B.
**Two observability gaps this surfaced (fix regardless).** (i) `CORTEX_TURN_DEADLINE_MS` is NOT in `effectiveConfig.ts`'s reported
list → the config-certify gate can't see/certify this central lever and it's absent from banked `effective_config`. Add it.
(ii) The supervisor's `rec["budget_frac"]`/`rec["agent_budget_s"]` aren't populating in banked rows (the `if bmap` path) — had to
recompute from `tb2-budgets.json`; fix so deadline-binding is visible per row.

## FINDING — context is APPEND-ONLY (cache ~99% to peak); it reached ~321K only because the task ENDED at the deadline, not from curation; compaction never fires (2026-09-05, resolver-k5; CORRECTED)
**What.** On the longest-context task in resolver-k5 (`make-mips-interpreter__r4`, arm on, **166 turns**), the trajectory's per-call
usage shows **peak single-request context = 321,066 tokens** (turn 165). NO compaction/summarize event fired (trajectory record types
are only `user`/`assistant`/`file-history-snapshot`; the 5 "compact/summarize" string hits are false positives — model reasoning
about the MIPS task + the deadline force-synthesis "summarize your findings" prompt).
**The 31M red herring.** The banked `inputTokens`=30.9M is the CUMULATIVE SUM across 166 turns (each turn re-sends the growing
convo), i.e. token THROUGHPUT — NOT a single context. Compaction triggers on a SINGLE request nearing the window, not on cumulative
throughput. Peak 321K on a **1M-token model = ~32% of window** → never near a compaction threshold → never fires.
**🔴 CORRECTION (an earlier version of this entry claimed a "curation-held plateau" — that mechanism was WRONG; the cache data disproves it).**
Per-turn cache hit rate is **~99–100% all the way to the 321K peak** (turn 165: cacheRead 320,896 / uncached 170 = 99.9%; aggregate
99.0%; total uncached across the whole task = 301K of 31M). A 99.9% hit at 321K PROVES the 320,896-token prefix was byte-identical to
the prior request → **no old content was rewritten**. So the context is **APPEND-ONLY**: it grows monotonically (turn1 3,876 →
turn165 321,066), decelerating (1,911→1,717→1,266 tok/turn as late turns emit smaller outputs), and it stopped at 321K **because the
task ENDED at the 0.9 deadline (turn 166 = force-synthesis)** — NOT because anything capped it. A longer task would keep climbing.
Curation (BashOutput tail-truncation Item 14; `file-history-snapshot` pointers) shapes what gets APPENDED before it enters context;
it does NOT re-edit committed history, which is exactly why the cacheable prefix stays intact. The harness does NOT "trim-to-a-plateau."
**The one cache-buster = the exit turn.** Turn 166 (deadline force-synthesis) builds a FRESH, reduced 163,634-token prompt at **0.2%
hit** (163K uncached) — it does not reuse the cached prefix. So the force-synthesis pays one full ~163K uncached call. Minor cost, but
a real argument that the mentor-directed exit (see the deadline-exit-mentor experiment above) should be prompt-efficient, not a fresh rebuild.
**🔴 Implication for small-context arms.** The 321K peak is harmless only because the model is 1M. A 128K-context model as a bench arm
would EXCEED 321K mid-task → forced compaction/truncation → a confound (and capability hit) the 1M runs never see, AND likely a cache
collapse if compaction rewrites the prefix. Re-check context + cache behavior BEFORE promoting any smaller-context model to an arm; the
"no compaction / 99% cache" result does NOT transfer.

## EXPERIMENT+REFACTOR (operator-approved 2026-09-05) — move the effort-by-ROLE profile into the model card (action vs mentor), env levers demoted to overrides

**Status.** QUEUED. Card SCHEMA change to the published package (owner-gated). The *values* are A/B-gated (validate-then-bake); the *refactor* (making the card the source of truth) can land once the schema + resolution are agreed.

**The insight (operator).** The mentor/lift/resolver levers exist to keep the primary in its NARROW-DOOR ACTION frame and not devolve to overthinking; the deliberation is quarantined to the max-reasoning junctures. That action-executor-at-reduced-effort + mentor-at-max split is a per-MODEL property → it belongs in the card, not scattered across per-surface env.

**Current split is half card / half env (grounded).**
- Primary/action effort = card-based: `card.reasoning.effort` (deepseek flash & pro both `'medium'`), resolved in `APIClient.ts:849-857` with precedence **request-param > card > default**.
- Mentor-lever efforts = env-ONLY, card-UNAWARE: `liftPlanner.ts:43` reads `env.CORTEX_LIFT_PLAN_EFFORT`; `endTurnResolver.ts:26` reads `env.CORTEX_ENDTURN_RESOLVER_EFFORT`; each falls back to its own `max`. Neither consults the card.
- So the *action-vs-mentor relationship* can't be expressed per-model in one place, and every surface must re-declare `CORTEX_*_EFFORT`.

**The change.**
1. Card schema — add a role profile under `reasoning`:
   ```ts
   reasoning: {
     supported: true,
     effort: 'medium',            // keep = legacy/base fallback
     effortByRole: {              // NEW — canonical per-model split
       action: 'medium',          // narrow-door executor
       mentor: 'max',             // lift-planner / endturn-resolver / ask-advice junctures
     },
   }
   ```
2. Resolution — primary reads `effortByRole.action ?? effort`; `liftPlanner`/`endTurnResolver` gain a card fallback: `env.CORTEX_*_EFFORT > card.reasoning.effortByRole.mentor > 'max'` (mirrors the primary's request > card > default). Env stays as a per-run OVERRIDE, not the source of truth.

**Baseline ratified (operator 2026-09-05): flash `action:medium` + mentor(pro) `max` stays as-is — "a good fit currently."** The refactor makes that split CANONICAL (card-owned) rather than the current card+env split; it does NOT change flash's effective config. Precedent for card-as-home: the `medium`-revert comment already lives in the cards (deepseek-v4-flash.ts:42 / -pro.ts:51 — "reverted from 'max': max over-deliberated on solvable tasks, 35min/93 iters on circuit-fibsqrt, no pass-rate gain").

**What it unlocks (the pro variant).** Once role-effort is card-owned, flash and pro can carry DIFFERENT action efforts without per-surface env — e.g. pro `action:'low'` (candidate) while flash stays `medium`, both keeping `mentor:'max'`. **🔴 validate-then-bake:** the pro action effort (`low` vs `medium`) is UNTESTED (the 2026-08-30 A/B was max-vs-medium, not medium-vs-low; low has a "floor risk" — too low and the executor loses in-loop tool micro-reasoning). Do NOT bake a pro `action:'low'` into the card until the **pro effort-placement A/B** confirms it (`pro@low-action+pro@max-mentor` vs `pro@medium-action+pro@max-mentor` vs `pro@max-everywhere`). Effort is API-settable per-request (probed 2026-09-01), so the A/B is cleanly buildable via the existing `*_EFFORT` levers before the card change.

**Cross-ref:** the pro-track effort-placement experiment (to spec post flash-k5 adjudication); `CORTEX_EFFORT_PULSE`/`EFFORT_TAIL` are the complementary DYNAMIC effort dimension (escalate on introspective/tail turns) — the card role-profile is the STATIC base they modulate.

## BENCH-RIG BUGS (2 found during resolver-k5 tail, 2026-09-06) — the harbor-bench supervisor + watchdog stall on tail completion

These are the harbor-bench RIG (`scripts/tb2-durable-supervisor.py` + the k5 watchdogs), NOT nexus-cortex core — but they cost hours on the resolver-k5 tail and left it at 108/110. Logged per Operating-Rule-1 deficiency-mining.

**BUG 1 — supervisor tail-completion: `remaining` compares slice to GLOBAL done, exits prematurely.**
On resume, the durable supervisor logs `"N tasks, <global_done> done, -<M> remaining"` and when global_done exceeds its slice size, `remaining` goes NEGATIVE and it exits treating the shard as complete — EVEN IF a task in ITS OWN slice is undone. Evidence: `k5on8fix` placed for shard-8 (holding the 2 undone r5 tasks) logged `"3 tasks, 53 done, -50 remaining"` and exited having run NOTHING → no container, no rows. This is why the last 2 could never be re-driven by a shard relaunch. **Fix:** compute `remaining` against the shard's OWN slice done-set (`slice_tasks − banked(slice_tasks)`), not `slice_size − global_done`. Until fixed, tail tasks must be re-run by DIRECT task id, not shard relaunch.

**BUG 2 — watchdog reap cadence (~12 min) < task runtime, so a shard once in the "complete-but-short" loop never lands a long task.**
Once a shard is flagged COMPLETE-but-REMOTE-SHORT (e.g. a crash left it short), the watchdog reaps+remaps it every ~12 min. A fresh lane cold-starts (~7 min) then runs the task, but the next ~12-min tick reaps it BEFORE a ~22–39 min task (e.g. install-windows-3.11, measured 1352–2326s) can finish → the task NEVER completes → perpetual loop. Tasks that finished (r1–r4) only did so because their shards ran uninterrupted and never entered the loop; it is NOT a general long-task problem. **Fix:** reap interval must exceed the slice's longest expected runtime (read the per-task budget from `tb2-budgets.json` and set the watchdog patience to ≥ max(slice budgets), or don't reap a lane that is actively producing tool-call progress).

**Corollary process note (self-inflicted, 2026-09-05→06):** destroying lanes by BLIND ROSTER NAME instantiates DOs that weren't live (a DO request creates it) → spiked the fleet 4→30. Enumerate ACTUAL live instances via `wrangler containers list` / the CF API and destroy only those; NEVER loop the roster blind. (Also in harbor-bench skill.)

## DEFICIENCY — resolver ABSTENTION gap: over-fires on HOPELESS tasks (resolver-k5 event evidence, 2026-09-06)
Second v2 axis alongside the fallback-coverage gap. From the k=5 decisions.jsonl: the resolver keeps rejecting finishes on tasks the model CANNOT solve — filter-js-from-html (fired 9, **rej 7**, 0/5 pass) and pytorch-model-cli (fired 10, **rej 8**, 1/5 pass) — burning pro@max EndTurn calls for zero pass conversion. Minor reject-overhead also on saturated-pass tasks (circuit-fibsqrt rej 7, sqlite-db-truncate rej 5 — both 5/5 on AND off, so the rejects add cost without pass benefit). **Fix:** give the resolver a "unsolvable-in-remaining-budget → retire/abstain" verdict so it stops re-rejecting a hopeless finish (ties directly to the deadline-exit-mentor experiment's retire branch). NOTE: verdict TEXT quality is already high (specific correct requirement catches) — the entire resolver v2 is a GATING problem (when it fires: coverage + abstention), not an output-quality problem.

## 🔴 CORRECTION (2026-09-06, resolver-k5 decisions.jsonl) — the "fallback-coverage gap" was MIS-PREMISED; the real resolver gaps are abnormal-exit + abstention
Grounded check of the actual fallback reasons (not the AB's inference):
- **circuit-fibsqrt: the resolver DOES fire** (2 events/rep; r3 also has a `coordinate-violation`). NOT a coverage gap. So the AB's "circuit finished via fallback, resolver never fired" was wrong.
- **make-mips: ALL 5 reps hit `abnormal-exit-bypass`** (CortexOrchestrator.ts:3441-3458 — abnormal loop exit: loop-detection/max-iters/consecutive-errors/deadline force-synthesis), NOT `endturn_gate_fallback`. The gate+resolver are bypassed because the model NEVER cleanly finished. There is no declared EndTurn to adjudicate, and make-mips is genuinely hard (2/5 even on-arm) — the resolver structurally cannot rescue a task that never finishes.

**Therefore the originally-scoped fix (invoke adjudicateEndTurn on the endturn_gate_fallback branch) is REJECTED — it wouldn't cover make-mips (wrong bypass path) and circuit is already covered.** The two REAL, worthwhile resolver-behavior fixes are:
1. **ABSTENTION** (higher value, lower risk) — the resolver over-rejects HOPELESS tasks (filter-js 7 rej/0 pass; pytorch 8 rej/1 pass). Add a "unsolvable-in-budget → retire/abstain" verdict so it stops burning pro@max re-rejecting doomed finishes. Simple verdict-type addition to endTurnResolver.ts.
2. **ABNORMAL-EXIT ADJUDICATION** (make-mips's actual bypass) — only meaningful as part of the deadline-exit-mentor experiment (adjudicate a force-synthesis exit WITH remaining budget); a loop-detection/max-iters exit is unrescuable. Do NOT bolt a naive resolver call onto the abnormal-exit post-loop point — that's the deadline-exit-mentor's job, gated on remaining budget.

**Held for operator decision** (premise changed): the effort should go to (1) ABSTENTION, not the mis-premised fallback branch. Map-before-assert on the actual decisions.jsonl caught this before a wrong change shipped to the published core.

## READY-TO-RUN SPEC — pro-track effort-placement A/B (prepared 2026-09-06, launch operator-gated)
Tests the operator's hypothesis: pro@LOW-action + pro@MAX-mentor is a more efficient pairing than pro@medium (wider action↔mentor effort delta; concentrate deliberation at the junctures).

**Needs ONE small core change first (build+test, then publish):** add `CORTEX_ACTION_EFFORT` env lever that sets the PRIMARY model's `options.parameters.reasoningEffort` (APIClient already honors request-param > card > default at APIClient.ts:852, so a request-param override is all that's needed). No existing primary-effort env lever (verified). Precedence: `CORTEX_ACTION_EFFORT` (new) > card.reasoning.effort > default. Keep the mentor levers as-is (`CORTEX_LIFT_PLAN_EFFORT=max`, `CORTEX_ENDTURN_RESOLVER_EFFORT=max` — already env-controlled).

**Arms (primary = deepseek-v4-pro, reson config as the new standard baseline):**
1. `CORTEX_ACTION_EFFORT=low` + mentor@max — the operator's hypothesis (wide delta, cheap decisive executor).
2. `CORTEX_ACTION_EFFORT=medium` + mentor@max — the direct medium→low test the flash A/B never ran (card default is medium).
3. `CORTEX_ACTION_EFFORT=max` (or LIFT/RESOLVER also max = "max everywhere") — the naive port the card comment predicts LOSES (max over-deliberated: 35min/93 iters on circuit-fibsqrt).

**Measure (not just pass-rate):** pass-rate, **cost-per-PASS** (not per-run), and **thrash-rate / mentor-invocation-count** (to catch the inversion where low-executor thrashes more → more expensive mentor calls). Hypothesis: min cost-per-pass at `low` with pass-rate ≥ medium and no thrash blow-up. Falsifiable: if pass drops or thrash spikes, medium is the floor.

**Validation cell:** small wide fanout, the same 11-task subset ×3 reps/arm (or a control-pass-rate-mid-range subset recomputed for PRO's baseline — do NOT reuse flash's difficulty map). Budget ~$0.12/task × 33/arm × 3 arms ≈ $12; well within the $177.79 DeepSeek balance. Apply ALL tonight's durability lessons: patient lanes for the long tasks (reap interval ≥ max slice runtime — BENCH-BUG-2), no blind roster-destroy (BENCH-BUG corollary), wrangler for state, store-only monitor, direct-task-id re-run for tail (BENCH-BUG-1).

**Why validated-before-baked:** the winning `CORTEX_ACTION_EFFORT` value then becomes the pro card's `effortByRole.action` (the effort-by-role card refactor item) — validate-then-bake.

## 🔴 OPEN ISSUE — config does NOT propagate to EXISTING users' .env on upgrade (2026-09-06, operator-raised; design-decision-gated)
**Grounded current behavior:**
- `bootstrapEnv` seeds `~/.cortex/.env` + `<pkg>/.env` ONLY WHEN MISSING (`if (!fs.existsSync(target)) copyFileSync(examplePath, target)`, SettingsLoader.ts:130-132). An existing user's .env is NEVER re-touched on upgrade.
- The shipped `.env.example` carries REAL VALUES (GATE=true, RESOLVER=true, LIFT=true — my 2026-09-06 reson edit), so the seeded .env is a snapshot of defaults AT INSTALL TIME.
- `DEFAULT_SETTINGS` code defaults are the OLD values (`CORTEX_ENDTURN_GATE: 'false'` at SettingsSchema.ts:466) — NOT updated to reson.
- NO version stamp / migration anywhere in config (verified).
- Resolution order (SettingsLoader.ts:~463): `env(.env) || process.env || DEFAULT_SETTINGS`.

**Consequence:** reson reaches FRESH installs only. Existing user: (a) changed default GATE false→true → FROZEN (their .env has false); (b) a NEW lever we add → absent from their .env → falls to the OLD code default → silent old behavior.

**The robust fix (3 parts, ratify order/scope with operator first — changes the published config contract):**
1. **Move shipped-recommended values into CODE (`DEFAULT_SETTINGS` = reson).** Behavior ships with the package VERSION, not frozen in the user's file. A lever ABSENT from a user's .env → resolves to the updated code default → every non-overriding user gets it on upgrade (new AND existing). SMALLEST, highest-leverage — do first.
2. **Ship `.env.example` as a COMMENTED documentation template** (`#VAR=default  # what`) instead of live values. Seeded .env has commented levers → users fall through to code defaults; UNCOMMENTING is the override. (The scaffold's own comment already claims "blank so env wins" — copy-pkg-cortex-scaffold.mjs:81 — but the file ships live values, so the intent is unrealized.)
3. **Version-stamped migration on first-run-after-upgrade:** ADD new keys (commented) to the user's .env so new levers are documented; for a CHANGED default, update the user's value ONLY IF it still equals the OLD default (unchanged), else preserve (they customized) — the only safe way to distinguish "has old default" from "deliberately set".

**🔴 TENSION to resolve:** the reson standard currently lives in `.env.example` VALUES (my edits) but SHOULD live in `DEFAULT_SETTINGS` to actually propagate. Re-decide where it lives as part of this fix. My `.env.example` reson edits are correct for the CURRENT (fresh-install-only) model; they do NOT solve propagation.

## HB-PLACEMENT — the bench PLACEMENT BRIDGE is the fanout bottleneck (2026-09-07, operator-approved to open)
**Symptom:** k5v2 7-arm (SHARD_N=55, 1-task/lane, ~300 lanes) spent ~2h in FANOUT before real work began;
running-instance count wobbled 16→117 through the transition (completion-drain during a slow serial fanout,
NOT churn — done kept advancing). The bottleneck is the placement plane, not compute or any rate limit
(host logs 0× 429/402; 1 exc / 98 banked rows; ZERO empty-session zero-token rows).

**Root — 3 compounding components:**
1. **Serialization** — one armer loops ~300 `tb2-relaunch` calls, 1-2 at a time.
2. **Per-placement latency (~25s/lane)** — each `tick` BLOCKS on a `/debug/exec` round-trip + supervisor
   boot + a verify read (the blocking verify is the cost).
3. **Bridge wedging** — `/debug/exec` wedges under concurrent hits (`bridge wedged or cap saturated`,
   42/300 ≈ 14%). Root: concurrent new-session execs each cold-start a fresh DO and CF throttles concurrent
   container STARTS → the synchronous exec stalls. The admin debug shell is not a mass-placement API.

**Fixes (impact÷effort):**
- **RIG, low effort — next run, no worker change:** ① ASYNC PLACE/VERIFY SPLIT in `scripts/tb2-relaunch.py`
  (PLACE = fire the detached-supervisor exec + return ~2s; VERIFY = separate store-read pass off the critical
  path — supervisor is durable, so fire-and-forget is safe; the watchdog re-places any that didn't take;
  ~25s→~2s/lane). ② BOUNDED-PARALLEL PLACEMENT in the armer (`xargs -P N` / per-arm placement worker; ~20
  in-flight with ① → ~30s total fanout vs ~2h). ⑤ SHARD_N≈18-20 (~3 tasks/lane = ⅓ the placements — the
  tasks-per-lane law's UNDER-loaded edge: 1-task/lane is churn-optimal but placement-pessimal; sweet spot ≈3).
  ⑥ 🔴 **HEAL-PATH FIX (rearm-all.sh):** on a mid-run watchdog death, `rearm-all.sh` must **arm the dead
  watchdogs directly** (they drive only NOT-DONE lanes), NOT re-fire the armer — a re-fired armer replays the
  ENTIRE serial fanout, re-placing already-done lanes as 75s no-op cold-starts (~4.5h, ~$32/hr wasted, starves
  the not-done tail until fanout completes). k5v2 2026-09-07: flash flatlined 93+min this way. Alternatively
  gate the fanout to skip done lanes on a re-fire (done-set check). Diagnostic + live fix = harbor-bench DELTA 2026-09-07c.
- **WORKER, medium — the real wedge fix (deploy-gated):** `POST /admin/bench/launch` on nexus-cortex-sandbox
  taking a LIST of `{session,repo,task,config}`; the worker places server-side at a CONTROLLED rate (paces DO
  cold-starts so the bridge never wedges) + returns immediately; client declares intent once, worker
  reconciles desired→actual (extend the existing lease-KV + warden cron, harbor-bench DELTA 09-03). Removes
  the serial loop AND the self-wedge.
- **WORKER+IMAGE, high — warm pool + pinned repin (deploy-gated; kills cold-start):** pre-booted DO pool with
  nexus-cortex installed; ASSIGN a task instead of cold-starting per lane. Reuses the SHIPPED update lifecycle
  `packages/cli/src/lifecycle/updateCheck.ts`: `CORTEX_UPDATE_POLICY` (off/warn/error/force/auto),
  `runUpdate()` = `npm install -g nexus-cortex@latest`, startup check ≤ hourly TTL, `cortex update` = thin
  wrapper, `error` policy → **exit 75 (EX_TEMPFAIL)** = a first-class "stale pin, update+relaunch me"
  orchestrator signal. On a WARM container `npm i -g nexus-cortex@<pin>` is SECONDS (cached deps) vs cold
  ~7min → reuse-not-destroy + pinned repin = fast path, no new mechanism. 🔴 NOT `force` (installs @latest →
  mid-run bump) — use policy=off + the adapter's pinned `npm i -g nexus-cortex@$TB2_HARNESS`, or add a `pin`
  mode that repins to TB2_HARNESS. Erases the cold-start $ premium (harbor-bench CF-billing analysis).

**🔴 REALITY-CHECK on ④ (grounded 2026-09-07 — corrects the naive "bake a warm image" instinct):**
- The SANDBOX image is ALREADY warm: `nexus-terminal/workers/nexus-cortex-sandbox/Dockerfile:61` bakes
  `npm i -g nexus-cortex@4.93.0` (+ tui/claude-code/canon, node, and the npm cache — no `npm cache clean`).
  So rebuilding a "warmer" sandbox image buys ≈nothing; at most bump the baked version so a near-pin delta is
  smaller (can't bake a FUTURE pin).
- The ~7min cold-start is **TWO-container**: the sandbox LANE (our image, baked warm, booted once/lane) vs
  each **per-task `alexgshaw/<task>` container** spun up inside DinD, where the adapter's `install()` runs
  node20 + `npm i -g nexus-cortex@<pin>` **FRESH** — an image WE DON'T CONTROL. A warm sandbox image or the
  running pool warms the LANE, NOT that per-task install. This is the load-bearing correction: ④'s warmth
  helps lane boot, not the dominant per-task setup.
- **TARGETED FIX (adapter work, NOT an image rebuild):** MOUNT the sandbox's warm npm cache (+ node) into
  each task container so the per-task `npm i nexus-cortex@<pin>` hits a populated cache → seconds. ORDER OF
  WORK: (1) profile where the ~7min actually goes (sandbox boot vs task-container install); (2) if it's the
  task-container install → cache-mount into task containers; (3) running pool warms the lane (necessary, not
  sufficient alone).
- **BUILD NOTE (Replit-safe):** the sandbox image is built by `wrangler containers build --push` (manual
  dispatch, CI runner with docker), pushed to CF's managed registry, tag pinned in wrangler.jsonc. NEVER
  build on Replit — no docker daemon + storage-quota crash. Replit only edits the Dockerfile + bumps the tag
  + triggers the deploy pipeline. (Exact CI workflow trigger still to be confirmed — build METHOD grounded
  from the wrangler.jsonc comment; the workflow file wasn't in the dev repo.)

**Owner-gate:** ①②⑤ = rig, do freely next run. ③④ = nexus-cortex-sandbox worker/image changes (deploy-gated).
**Cross-ref:** harbor-bench SKILL DELTA 2026-09-07b (same fixes, run-side framing).

## HB-ENDTURN-TERMINAL — the EndTurn gate's "you stopped" reminder is TERMINAL and kills mid-recon builds (2026-09-08, k5v2 failure-mine)
**🔴 HIGH VALUE — shipped-baseline behavior depressing EVERY DeepSeek run, not an experimental lever.** The
single dominant, fixable cause of DeepSeek early give-ups on hard tasks.
**Grounded mechanism:** when the EndTurn gate is on (`CORTEX_ENDTURN_GATE`, part of the shipped reson standard),
`CortexOrchestrator.ts:3625` (non-stream) + `:5594` (stream) fire, on the condition
`endTurnGateEnabled && ev.usedTools && !ev.endTurnCalled`, a system-reminder ending with **"Do NOT call any
tools."** On a hard task MID-RECON, the model emits a no-tool-call turn (it's THINKING, not finishing) → the
gate reads it as "stopped" → the TERMINAL "Do NOT call any tools" clause **forbids recovery** → the agent
honestly reports it never built the artifact, one turn short. The model is NOT giving up; the harness stops it.
**Evidence (k5v2 failure-trajectory mine + primary verification):** the reminder fired in **10 of 36** flash
failure sessions, **present across all loop-block-OFF arms** (ctl 1, dl 3, elo 2; lb 4) → NOT the loop-block
lever (`loop_tool_block` fired 0× this run; different, non-terminal code path — `loopToolBlock.ts`). Failure
signature: clean reward-0, budget_frac **0.24-0.31** (gave up at ~25% budget), honest non-completion text
("I was stopped before I was able to create…"). Passing tasks (pytorch-model-cli 5/5 ctl) hit the reminder
**0×** and committed to building early.
**FIX DIRECTION (verify the full loop before implementing — I verified the TRIGGER, not the downstream):** make
the reminder **NON-TERMINAL when budget remains AND no required artifact exists yet** — "continue working, you
have budget" instead of "Do NOT call any tools." Keep it terminal only near end-of-budget or when an artifact
exists to attest against. **KEEP the beneficial half** of the gate (the reject-continue on empty/unverified
attestation, `endturn_resolver`, which fired usefully 25-27×/arm). 🔴 Implementer must first map the full gate
loop (END_TURN_MAX_NUDGES, force-final logic, the R29a-bypass note at `:3600`, and BOTH the :3625 non-stream and
:5594 stream sites) — the trigger is grounded, the surrounding nudge/force-final logic is not yet.
**Owner-gate:** shipped-config behavior change → operator-gated; ride the next release train with a live
before/after on the hard-task give-up set (filter-js short runs, configure-git, schemelike, bn-fit give-ups).

### IMPLEMENTATION SPEC (2026-09-08, grounded end-to-end by reading; reuses the existing D-E `truncated` carve-out)
**Root (verified file:line):** `assistantTextPresence.ts:11` — a thinking-only turn (reasoning, no text, no
tool_use) → `hasVisibleAssistantText=false`. `emptyResponseClassifier.ts:51-55` classifies it `reasoning_only`
(when `stopReason ∉ TRUNCATION_STOP`), whose nudge (`:67`) is "write your complete final answer now" and whose
`nudgeForbidsTools` (`:75`) returns TRUE. The classifier is **budget-blind** → it can't tell "reasoned to a
final answer, forgot to surface it" (exhausted → force answer, correct) from "reasoned about the next action
mid-recon" (has budget → should continue, BROKEN). Fires at 4 sites: in-loop retry `CortexOrchestrator.ts:2187`
(non-stream) / `:4535` (stream) — SOFT (text-forbids; tools still passed `:2265`); post-loop R29a `:3597`/`:5580`
— HARD (tools `[]` `:3653`, hardcoded terminal reminder `:3625`). Observed give-ups hit R29a (text matched).

**FIX — 3 components, mirrors the D-E `truncated` carve-out:**
1. **`emptyResponseClassifier.ts` (pure):** add param `loopHasBudget?: boolean` + kind `'reasoning_only_active'`.
   In the final branch: `hadReasoning && !truncated && loopHasBudget===true` → `reasoning_only_active`.
   `emptyResponseNudge('reasoning_only_active')` = "You produced reasoning but took no action and gave no final
   answer, and you still have budget. Continue now — take your next concrete action (call a tool), or give your
   complete verified final answer only if actually finished." `nudgeForbidsTools` → false (join `truncated`:
   `return kind!=='truncated' && kind!=='reasoning_only_active'`).
2. **In-loop retry (`:2187`/`:4535`):** pass `loopHasBudget` into `classifyEmptyResponse` (`:2196`/`:4544`).
   Replace the single-shot `emptyResponseRetryUsed` guard FOR THE CONTINUE-KINDS ONLY with a bounded counter
   `emptyContinueCount` (cap 3): `truncated`/`reasoning_only_active` consume from it (loop keeps going);
   `reasoning_only`/`no_visible_content` keep the one-shot force-answer. Exhausted counter → terminal path
   (bounds any empty-turn loop). Tools already passed at `:2265` — nudge text now says "continue."
3. **R29a (`:3597`/`:5580`):** classify first; if kind ∈ {`truncated`,`reasoning_only_active`} → push the
   continue nudge as a user turn and `continue` back into the loop WITH `toolsToUse` (re-entry, NOT the `[]`
   synthesis), guarded by `emptyContinueCount`. Else (`reasoning_only` exhausted / `no_visible_content`) → keep
   R29a EXACTLY as-is (terminal tools-suppressed synthesis — the case it was built for).

**`loopHasBudget` signal (both loops have it):** `(Date.now()-loopStartMs) < 0.6*effectiveTurnDeadlineMs &&
toolCallIteration < 0.6*effectiveMaxIterations`. `loopStartMs`+`TURN_DEADLINE_MS` = DELTA 09-05c (`:1924`/`:4341`);
`toolCallIteration` in scope (logged `:2198`). 0.6 = "clearly mid-task," conservative.

**Gate:** `CORTEX_EMPTY_TURN_CONTINUE` (default false → dark → A/B → default true); add to `effectiveConfig.ts`.
When false, byte-identical to today (new kind never selected).

**Validate (before default-on):** (1) unit — classifier: reasoning_only+budget→active+forbid=false; +truncated
still wins; +!budget still reasoning_only. (2) LIVE SEEDED (mechanism-fire proof) — local cortex-server,
deepseek, inject a reasoning-only turn at iter ~5 → assert continue nudge + tools kept + next action taken;
contrast near-deadline → still force-synthesizes. (3) A/B on the give-up subset before/after. 🔴 REGRESSION
GUARD: a genuine 30+-call exhaustion task MUST still force-synthesize (not loop) — include one in the cell.

**Do NOT change:** the exhaustion path (R29a terminal synth at real budget-spend); the `truncated` D-E carve-out;
the DSML parser (that's HB-DSML-PARSE, sacred surface, separate). **Touchpoints:** `emptyResponseClassifier.ts` +
`CortexOrchestrator.ts` `:2187`,`:2196`,`:3597`,`:4535`,`:4544`,`:5580` + `effectiveConfig.ts` + classifier tests
+ one seeded integration test. ~5 edited functions, one new pure branch, one flag.

## HB-DSML-PARSE — DeepSeek DSML tool-call dialect occasionally leaks unparsed → dropped turn (2026-09-08, rare)
**Lower priority (1/36 sessions) but real; compounds HB-ENDTURN-TERMINAL.** In one k5v2 failure session
(`filter-js-from-html` ctl r1) the model emitted a tool call in DeepSeek's DSML dialect
(`<｜｜DSML｜｜tool_calls｜｜invoke name="Bash">…`) that the parser failed to extract, so it landed as PLAIN
assistant text → the turn read as "empty" → tripped the terminal "you stopped" reminder (HB-ENDTURN-TERMINAL).
Tool-call parse lands at `APIClient.ts:1079` (`if (parsed.toolCalls.length) message.tool_calls = parsed.toolCalls`).
**FIX:** harden the DeepSeek/ChatCompletions tool-call parser to recover the DSML dialect (or, minimally, detect
leaked DSML markup in assistant text and re-request the turn rather than treat it as a stop).
🔴 **This touches the SACRED tool-call parsing surface** ([[feedback_xai_interleaved_sacred]]) — repeatedly
broken by AI sessions. Do NOT touch without: (a) before/after canary probes on the deepseek + xai tool-call
round-trip, (b) explicit operator approval. Frequency is low, so this is not urgent — HB-ENDTURN-TERMINAL's
non-terminal-reminder fix already neutralizes most of its impact (a recovered-vs-dropped turn both survive if
the reminder stops forbidding tools).

**✅ STATUS: BUILT 2026-09-09 (release-gated).** `packages/core/src/orchestrator/dsmlRecovery.ts` (isolated
module: `looksLikeLeakedDsml` + `recoverDsmlToolCalls`) + a PURELY-ADDITIVE hook in the DeepSeek non-stream
`chunks()` generator (`APIClient.ts:358` — NOT `:1079`, which was a stale/HF-space ref): fires ONLY when the
structured `tool_calls` field is empty AND the DSML markup is present, so the normal structured path is never
touched. 5 unit tests green (real captured format: single/multiple invokes + malformed-tag fallback + never
fabricates), tsc-clean. 🔴 ROOT CAUSE CONFIRMED (operator question 2026-09-09) = a **reasoning-MODEL artifact,
NOT a gateway malformation**: the gateway sends correct OpenAI `type:function` tools and our prompts teach NO XML
tool format; reasoning models (xAI grok, DeepSeek) intermittently emit tool calls as XML/markup TEXT in content —
already documented + partly handled by `ChatCompletionsAPIAdapter.sanitizeXmlContaminatedInput` (the
argument-pollution sibling). DSML is the fully-leaked-into-content DeepSeek variant. Pending: canary probes
(deepseek+xai round-trip, confirm normal path unaffected) + release.

---

## HB-ENDTURN-CITATION-GROUNDING — 39% of EndTurn attempts rejected; audited to the citation (2026-09-10, cell-d-k3, 26 sessions)
**Measured:** the EndTurn Stage-2 gate (`packages/core/src/orchestrator/endTurnGates.ts`) rejected **42 of 107 EndTurn
calls** across 41 sessions (21/26 sessions that reached EndTurn took ≥1; 4 took ≥3 consecutive). Identical in every arm.
**Diagnosis (corrected the same day — the first write-up blamed a "per-turn window"; WRONG: the corpus is already
cumulative over the whole task, `TurnEvidence.outputs` is never reset).** All 84 flagged citations were re-checked
against the session's full tool output with the gate's own normalizer:
| share | what the model quoted | verdict |
|---|---|---|
| 47% | real lines stitched from several outputs / a heredoc it wrote then cat'd — every LINE verbatim, the BLOCK not contiguous | gate too strict at block granularity |
| 44% | text never observed through any tool (memory/paraphrase) | gate correct — fabrication |
| 3% | text it authored inside a Bash heredoc / `python -c` (only Write/Edit counted as authored) | corpus gap |
| 2% | the task statement itself | corpus gap |
| 2% | in the corpus but rejected (normalization edge) | true false-reject |
**✅ FIX BUILT 2026-09-10 (release-gated, ships in 4.100.0):** (1) grounding corpus = observations + Write/Edit text +
**Bash command text** + **the task statement** (`endTurnGates.ts` at the Stage-2 call; `deps.userTaskText`); (2)
**line-wise verbatim matching** for multi-line quotes — every non-trivial line must be present, contiguity relaxed
(`citationVerification.ts` `verifyCitationsGrounded(…, {linewise})`, default on, `CORTEX_ENDTURN_CITATION_LINEWISE=false`
restores block matching). Audit replay: rescues ~60/84 (the 47% + the corpus gaps), still rejects every invented line.
7 new unit tests. Standing metric for every finishing-population cell: `endturn_rejections/session`.

### HB-PLACEMENT ⑥ — per-lane launch results (2026-09-10, cell-m-p3 field evidence)
**Symptom:** `/admin/bench/launch` (worker) returns 200 for the batch even when `placeOne` exhausts its 4 exec retries on a
lane ("exhausted → leave placing", no signal); the STDB module's `launch_lanes` only fails on a chunk-level HTTP error, so
`[bench fanout] declaratively placed 32` / `[bench placement] re-placed 6` describe the CALL, not the containers. On
cell-m-p3 five lanes (pro-high0..3, flash-max0) went through fanout + 2 placement re-fires with NO run-tagged
`__run_config__` row (supervisor never booted) while 27 siblings booted in <2 min; a sixth (pro-low3) booted on its 2nd
attempt. Diagnosis was only possible from the stores (no run_config row for the run tag) — the control plane itself had
no idea. The P14 fresh-session remap at `place_attempts ≥ 2` is the eventual heal (~10-14 min lost per lane).
**Fix:** (a) worker: the route returns `{ok, placed:[session…], failed:[{session, attempts, lastError}]}` (keep 200; the
body carries the truth); (b) module `launch_lanes`/`fanout`/`placement`: parse the body; a `failed` lane gets
`place_attempts+1` immediately and, on a `SandboxError`/500-class lastError, is remapped to a fresh session at once
instead of waiting out the 600 s grace twice; (c) the same 4-retry exhaustion sets `supervisor_alive: Some(false)` so the
tick does not treat the lane as booting. Also fold in DELTA 10g: the route now 400s on session names the worker would
silently collapse (staged in tree, undeployed). Verification: a launch with one deliberately-invalid and one
unreachable-DO lane must show both in `failed` and the module must log + act on them within one tick.
**⑥b — the INSTANT-COMPLETE livelock (same run, 20:04Z):** a lane whose 1-task slice is ALREADY banked (rows from a prior
`-pN` attempt) boots, banks `__run_config__`, prints COMPLETE and exits in seconds — before the 300 s tick ever probes it.
It never beats, so placement treats it as "unbooted", re-fires it (600 s grace each), remaps it at ≥2, and finally gives
up at PLACE_MAX_ATTEMPTS=5 → `dead` (pro-high2: 5 cold starts, ~$0.50 and 50 min of lane wall, for a task that was done
before the run started). Reconcile's slice check only resolves `complete_pending` lanes (the ones that beat COMPLETE).
**Fix (either):** (a) reconcile also checks `placing` lanes' slices against the store and marks them `complete` when every
task in the slice is banked; or (b) the supervisor sleeps ≥ one tick period (≥300 s, or until a probe) after COMPLETE
so the tick can bank the beat — (a) is cheaper and touch-free.

## HB-MENTOR-BUDGET — thinking-ON mentor calls return EMPTY output because reasoning shares `max_tokens` (2026-09-10, cell-m pilot)
**Evidence (cell-m-p3, 4.105.0, 32 sessions):** with `CORTEX_MENTOR_REASONING=on`, deepseek-v4-pro delivered 0/10 lift plans and
1/8 resolver verdicts (blank after 50–75 s); deepseek-flash 3/10 plans, 2/9 verdicts. Thinking-OFF arms: 8/8 plans (≈5 KB),
12/12 verdicts, 5–9 s. Every blank resolver fail-opened to `meets:true` (endTurnResolver.ts:132) → the EndTurn gate
rubber-stamped every finish on the thinking-on arms. Ledger: `.cortex/bench/r-cell-m-2026-09-10.md`.
**Mechanism (direct API call):** DeepSeek's `completion_tokens` INCLUDES `reasoning_tokens` (pro@high: 2045 = 1641 + ~400
content) — reasoning and content share `max_tokens`. `ChatCompletionsAPIHelperAdapter.ts:395` sends `max_tokens =
min(outputBudgetTokens=4000, limits.outputTokens)` for every mentor call and never reads `finish_reason`; on the real mentor
prompts (6 KB delta + recon + outputs) high/max reasoning exhausts the cap → `finish_reason: length`, `content: ""`.
**Fix:**
1. Adapter: when `mentorRole.thinking`, send `max_tokens = outputBudgetTokens + reasoningAllowance(effort)` (low 4K / high 12K /
   max 24K; bounded by `limits.outputTokens`), keep `outputBudgetTokens` as the CONTENT expectation only.
2. Adapter: read `choices[0].finish_reason` + `usage.completion_tokens_details.reasoning_tokens`; on `length` with empty content
   → return a structured `{text:'', truncated:true, reasoningTokens}` and let the mentor surfaces RETRY ONCE with thinking off
   (the proven baseline) — never hand `''` up as a plan/verdict.
3. Events: `lift_plan`/`endturn_resolver`/`deadline_exit_mentor`/`loop_tool_block` bank `truncated`, `reasoningTokens`,
   `failOpen:true` when a blank verdict was accepted; effective-config report gains `CORTEX_MENTOR_REASONING_ALLOWANCE`.
4. Resolver policy (operator call): keep fail-open-to-MEETS for liveness, but count `failOpen` in adjudication; or fail-open
   to the ABSTAIN path when `abstain` is on.
5. Loop-block: bank `blocksSoFar`/`escalateAt` on redirect events so "fired 12×, never escalated" is one field (cell-m: the
   exit planner was never reached — 2 blocks max per tool, escalation needs >2).
**Verification:** unit test on the adapter (finish_reason length + empty content → truncated + retry); live probe: a
resolver prompt of ≥8K tokens at pro@max must return `parsed:true`; re-pilot flash-none vs flash-high (K=2) on the loop
population; adjudicate on DELIVERY counts (`planChars>0`, `parsed:true`) not fire counts.
**Third surface, same day:** `scripts/doctrine-mine.py` synthesis (deepseek-v4-pro, thinking on, max_tokens 10000) returned EMPTY content on the cell-m clusters and crashed on `json.loads('')`; thinking-off returned 5 valid edits first try. The labeler had already been switched to thinking-off on 2026-08-26 for the identical reason (its source comment) — the class was known and never generalized. Every DeepSeek thinking-on call in the codebase needs the allowance + finish_reason handling, not per-surface workarounds.
**Rule promoted:** mechanism-engagement evidence = DELIVERY, not "fired": a mentor event with the right wire config and
`planChars:0`/`rawLen:0` is a broken arm (second control with a stall), not a null result.

## BENCH-TOOLING — the distiller's `retry_loop` classifier over-fires on same-file edit iteration (2026-09-10)
`scripts/tb2-distill.py` labelled 21/31 cell-d-k3 failures "repeated-identical-retry loop" from *near-identical call
clusters*, but the clusters are `Edit:/app/vm.js` ×7–17, `Edit:/app/filter.py` ×4–21, `sed -n 'a,bp' file` paging and
`ReadImage strip_N.png` — ordinary edit-test-edit / chunked-read iteration on one artifact, NOT the retry loop the
harness LoopLadder targets (only 5 `loop_escalation` events fleet-wide). The genuine loop in the set is the EndTurn
rejection loop above. Fix: exempt same-file Edit/Read/sed-paging/ReadImage sequences whose *inputs differ* (different
old_string / line ranges / files) and count only identical-input repeats; classify EndTurn-rejection repeats as their own
mode (`endturn_reject_loop`). Also: `budget_frac`/`frame` columns print "-"/"?" for STDB-driven rows (the row schema
carries `latency_s` + `effective_config`, not `agent_budget_s`/`budget_frac`) — read the budget from `tb2-budgets.json`.

## HB-JUDGE-GROUNDING — the done/not-done judges (resolver, exit planner, lift planner) never see the deliverable (2026-09-10, cell-d-k3; operator: "big deficiency")
**Evidence (cell-d-k3, 42 rows):** the EndTurn resolver HELD the first finish on 24/25 rows that reached EndTurn and held
**9 of the 10 passing rows** (false-negative holds; ≤1 hold-driven flip). The deadline exit planner fired 8× and mis-called
done/not-done in 3/3 real calls (FINISH on a failing row; ACTION ×2 that overran into the wall). Same mentor, same failure
in both directions. **Cause, verified in code:** the judges never see the artifact.
- `CortexOrchestrator.ts:855` `gatherEnvReport()` runs `ENV_RECON_COMMAND` (`training/liftPlanner.ts:59`: tooling, pip list,
  node globals, df/free, a find of test-looking files, top-level `ls`) — an INVENTORY, no file contents, no diff, no test
  result — and caches it in `cachedEnvReport` (`:872`, never invalidated) at the lift-plan call at task START; the resolver
  (`:964`) and the exit planner (`:1041`) reuse that stale snapshot at task END.
- Resolver work product (`:957`): `lastAssistantText()` + `ev.outputs.join('\n').slice(0, 4000)` = the FIRST 4,000 chars
  of the task's tool outputs (the oldest, not the final checks) + the attestation JSON (2,000).
- Exit planner work product (`buildDeadlineWorkProduct`): `lastAssistantText()` + the LAST 6 tool results at 500 chars.
So the judge classifies "done" from the model's prose about the work plus stale/early context — it cannot tell a correct
finish from a confident one. **The PROMPTS already carry the intended design** (`training/endTurnResolver.ts:41` RESOLVER_SYSTEM:
"Be adversarial: hunt for the exact constraint a nearly-done agent misses — a wrong output artifact, a filename/path/format
mismatch…", judge "the criteria the hidden grader will check, NOT the junior's own tests"; `deadlineExitMentor.ts:72` same
framing) — the adversarial criteria derivation is asked for and, per the banked planText, performed. What is broken is the
EVIDENCE path: the prompt promises the judge "the WORK PRODUCT (its final answer + the checks it ran)" and an ENVIRONMENT
REPORT, but the orchestrator hands it the model's prose, the OLDEST 4K of outputs (not the checks it ran), and a start-of-task
inventory. A judge told to hunt for a wrong artifact that is never shown the artifact can only be suspicious of prose
(→ false holds on passing work) or trust it (→ FINISH on failing work). The fix is not a prompt change; it is delivering
what the prompt already assumes.
**Fix, two tiers (both generic, no task knowledge):**
- **Tier 1 — cheap, no new model calls, ship before the k=5 if time allows:** (a) `gatherEnvReport({ fresh: true })` at the
  two judge sites (bust the cache; the ~1 s recon is nothing next to a pro@max call); (b) resolver outputs = the LAST 4,000
  chars (recent checks), not the first; (c) add a bounded **workspace delta** to both judges: files changed since task start
  (`git status --short` + `git diff --stat` when a repo, else `find -newer <task-start-marker>`), plus the head (≤60 lines)
  of each changed file up to a cap — the deliverable itself; (d) the judge prompts state that a HOLD must name a concrete
  failed check or a missing/incorrect artifact visible in the delta, and a FINISH/MEETS must point at a passing check.
- **Tier 2 — grounded check:** when a test entry point is evident (Makefile `test`, `test.sh`, `pytest` layout, the task's own
  "verify" phrasing), the harness runs it read-only and hands the judge the result; HOLD only on a failed check, FINISH only
  on a passing one; otherwise the judge abstains (accept) rather than guess. Bounded by the existing resolver call budget.
**Metrics (finishing population, k=3):** false-hold rate on passing rows (baseline 9/10), hold-driven flips (≤1), exit-planner
mis-calls (3/3), EndTurn turns/session, cost. Pair with HB-ENDTURN-CITATION-GROUNDING's `endturn_rejections/session`.
**✅ BUILT 2026-09-10 (both tiers, release-gated → 4.101.0):** `training/judgeEvidence.ts` (`collectWorkspaceDelta`,
`detectCheckCommand`, `runCheck`, `resolveJudgeGroundingConfig`; 9 tests), `gatherEnvReport({fresh})`, `taskStartMs` anchor
at both loops, resolver = LAST 4K outputs + delta + check, exit planner = delta; prompts carry the EVIDENCE RULE; resolver
event banks `deltaChars/checkRan/checkPassed`. Levers CORTEX_JUDGE_* (defaults on) in `.env.defaults` + effectiveConfig.
Efficacy = the next finishing-population cell (false-hold rate on passing rows, hold-driven flips, exit-planner mis-calls).
**Downstream map before editing (rule [[feedback-downstream-order-mapping]]):** `gatherEnvReport` callers: lift planner
(`:807`), resolver (`:964`), exit planner (`:1041`), loop-exit mentor (`:9110`); `buildDeadlineWorkProduct` callers `:3158`
(sendMessage) + `:5142` (streaming) — both loops must change together; `helperMiddleware.evaluateEndTurn` /
`evaluateDeadlineExit` / `generateTaskPlan` prompt templates consume `envReport`/`workProduct` verbatim.

## HB-LOOP-NEARDUP — CORTEX_LOOP_TOOL_BLOCK never armed because its trigger lens could not see real loops (2026-09-10) — ✅ BUILT
**Evidence:** cell-l pilot (6 lever rows on dna-assembly/gcode/train-fasttext, the known loopers): `loop_tool_block` 0×,
`loop_escalation` 1×. Replay of the harness's own `approachHash` + 30-window over 47 real sessions: the hash lens peaked at
**7-in-30 on every genuine loop** (each loop iteration = 3-5 distinct calls, so 12-in-30 is structurally unreachable) and its
top hits were paging `Read`s with different offsets that digit-stripping collapses into one key. The distiller's ≥0.9
similarity criterion is what actually sees the loops (`python3 -c "…"` retries with an edited script hash differently).
**Fix (built):** `training/toolOutcome.ts` `approachText` (normalized command/content for EXECUTING tools; slice-reads
excluded → the slice block's job) + `diceSimilarity`; `LoopLadder.observeSimilar` — bigram-Dice ≥ `NEARDUP_SIM` (0.9) over the
last `NEARDUP_WINDOW` executing calls, diversify at `NEARDUP_SIM_AT` (7), break at 2×; masking fix (`RANK`-based: a near-dup
diversify is never hidden by a failure-ladder remind); `LadderResult.trigger` and `loop_tool_block.detail.trigger`
(ladder | neardup-hash | neardup-similarity). Threshold 7 chosen from the replay: dna-assembly 7/7, gcode python -c 18 cross
it; no PASSING session exceeds 6 (healthy test iteration). 6 new ladder tests + 4 approachText tests.
**Gate before k:** CORTEX_LOOP_TOOL_BLOCK stays a lever; a mechanism-fire pilot (cell-l's 6 rows) must show `loop_tool_block`
events with `trigger: neardup-similarity` before it is measured at k=3.

## HB-SLICE-BLOCK — default ON since 4.101.0 (2026-09-10)
cell-d-k3: the soft nudge fired 23× on 17/42 rows and was ignored (61 further bash slices vs 5 Reads; 3 files switched, 15 kept
slicing). `resolveSliceBlock` flipped to `!== 'false'`; `CORTEX_SLICE_BLOCK/_AT/_MAX` registered in SettingsSchema, SettingsLoader,
RuntimeConfigRegistry; env ledger line. Append-log exemption + MAX=2/file unchanged. Watch `slice_block` events on the k=5.

## HB-MENTOR-THINKING — every DeepSeek MENTOR call has run with thinking DISABLED since 2026-08-30 (found 2026-09-10) — ✅ FIXED
**Symptom:** the ledgers say "mentor roles @max" (lift planner, EndTurn resolver, deadline exit planner, loop-exit planner,
mentor consult: `*_EFFORT` defaults 'max'). `HelperModelMiddleware.generateGuidance` (`:1295-1300`) clones the config with
`reasoning.effort = spec.effort`. But `ChatCompletionsAPIHelperAdapter` (`:400-412`) builds the wire body from
`reasoning.defaultEffort` only, and for any registry-resolved DeepSeek card (no defaultEffort) sends
`thinking: {type: 'disabled'}` — the 2026-08-30 fix for blank helper hints ("the helper ROLE never wants thinking").
`reasoning.effort` was never read. **Wire-verified 2026-09-10:** `thinking:{disabled}` → 0 reasoning tokens on
deepseek-flash AND deepseek-v4-pro; `reasoning_effort:'max'` → reasoning present. So every judge and planner verdict in
every cell since 08-30 (cell-d-k3's 47 resolver holds, 8 exit-planner calls, 42 lift plans; k5v2; resolver-k5 …) was a
NON-THINKING call. "pro@max mentor" never existed on the wire. 🔴 READ THIS RIGHT (operator 2026-09-10): those non-thinking
mentors were NOT useless — the resolver A/B (09-05) and resolver k=5 (09-06, +17pp, 5 help / 0 hurt) banked real 1.5–7.3K-char
plans with thinking OFF, and the thinking-ON test that WAS run (AskForAdvice, 08-27/30) came back blank (reasoning ate the
budget) — that is why the helper-role rule exists and why the later mentor surfaces inherited it. Turning mentor thinking ON
is therefore an UNTESTED change, not a restored one: `CORTEX_MENTOR_REASONING` (on|none, 4.104.0) keeps the measured
baseline reachable and cell-m A/Bs {pro, flash} × {on, none} before the k=5 pins it. HB-JUDGE-GROUNDING's metrics were
measured on the thinking-off judge and must be re-baselined per arm.
**Fix (4.103.0):** generateGuidance marks the clone `reasoning.effortExplicit = true`; the adapter precedence is now
helper-role `defaultEffort` ('none', cheap configs) > explicit mentor `effort` (sent as `reasoning_effort`) > DeepSeek
thinking-disabled fallback. Non-mentor helper calls (compaction, summaries, vision hand-off) are unchanged. Tests in
HelperAdapters.test.ts. Cost note: mentor calls will now spend reasoning tokens (outputBudgetTokens 4000 was sized for it).
**Bench consequence:** cell-m (mentor pro@max vs flash@max) is the FIRST cell with a thinking mentor. Re-baseline
HB-JUDGE-GROUNDING's metrics on it.
**✅ 4.104.0 — MENTOR ROLE (operator: "build the mentor role config and schema first"):** `training/mentorRole.ts` makes the
mentor a first-class role like the helper: `resolveMentorRoleConfig(surface)` → {model, thinking, effort, budget, timeout,
temperature}; `HelperFrameSpec.mentor` carries it; the adapters read `mentorRole` (never inferred from the card); every
mentor event banks `mentor:{model,thinking,effort,budget}` so a ledger proves the wire. Levers: CORTEX_MENTOR_REASONING
(on|none), CORTEX_MENTOR_CONSULT_REASONING (none default), CORTEX_MENTOR_TEMPERATURE; "Mentor role" effective-config group;
schema/loader/registry; master .env MENTOR ROLE section. The bench INV can now assert `mentor.thinking` per arm.

## FUTURE FIXES QUEUE (2026-09-09 — deferred items surfaced this session)

**Harness code:**
- **HB-DSML-PARSE unify + generalize** (follow-up to the above). The DSML content-level recovery
  (`dsmlRecovery.ts`) and the argument-level XML repair (`ChatCompletionsAPIAdapter.sanitizeXmlContaminatedInput`)
  are the SAME model behavior at two layers (content-leak vs argument-pollution) across two providers (DeepSeek
  DSML + xAI grok `<xai:function_call>`). Unify into ONE "leaked-XML-tool-call recovery" covering: both leak
  layers, both providers (my recovery is DeepSeek-only; xAI's fully-leaked variant is uncaught), and the STREAMING
  path (I hooked only the non-stream `chunks()` generator; a streamed DSML leak would still drop). Sacred surface
  → same canary-probe discipline.
- **`CORTEX_ENDTURN_REQUIREMENTS=strict`** — BLOCKED on 3 code bugs (D-B empty-`{}` truncation, `UNVERIFIED
  (reason)` regex, D-D loop-escalation exemption; session-resume-2026-09-04). Fix them, then the strict-vs-relaxed
  A/B; the fix was assessed "iffy" — reassess ROI before investing.
- **`CORTEX_DEADLINE_EXIT_MENTOR` re-target design** — the "smart deadline" checkpoint@0.82 + hard-floor@0.92 form
  (existing experiment above), targeting the ≥0.80 budget_frac finishing population; needed before its efficacy run.

**Bench / STDB durable control plane (the bench-runner spine, maincloud module `nexus-nexus-cortex`):**
- **CF EGRESS billing** — the 4th CF dashboard metric (Egress GB) is NOT tracked; it is not uptime-derivable. Wire
  the CF GraphQL **analytics API** (app-level) to capture egress + reconcile the per-run uptime-derived compute
  metrics (mem/vcpu/disk resource-seconds) against the app-level dashboard totals. (Operator: "many billing
  metrics; those 4 affect spend now — per-run tracking to judge aggregate cost across all surfaces.")
- **Per-run `total_cost_usd` rollup** — aggregate spend across surfaces: `cost_usd` (DeepSeek tokens) +
  `instance_cost_usd` (CF containers). Add the field (Option, `#[default]`, strictly at END) + monitor sets it.
- **Verify CF per-metric RATES** — `cf_rate_mem_gib_sec`/`_vcpu_sec`/`_disk_gb_sec` code defaults are APPROXIMATE;
  verify vs the CF Workers-Containers pricing page and set the config keys to the real rates (the resource-second
  metrics are exact regardless; only the $ conversion depends on these).
- **`rearm-all.sh` v2 hardening** — heal a mid-run watchdog death by arming the watchdogs DIRECTLY (or done-set-skip
  on a re-fire), NEVER re-firing the armer (the 93-min no-op fanout / ~$50 trap, k5v2 postmortem). Rule documented;
  the SCRIPT change is still "owed." Largely superseded by the STDB control plane, but the repl rig still uses it.
- **Commit the STDB bench source + generated TS bindings** — the `nexus-nexus-cortex` bench module (bench.rs trio +
  bench_scheduler + admin cache) was PUBLISHED to maincloud from the working tree but is UNCOMMITTED in git; the
  regenerated `modules/database-ai/generated/*` bindings too. Commit both (workspace git, explicit pathspec).
- **HB-PLACEMENT ④ warm container pool** — eliminate the ~7-min per-lane cold-start (per-task-container
  `npm i nexus-cortex@pin`) via a warm pool / cache-mount into task containers (HB-PLACEMENT ④ above; deploy-gated).
- **BENCHMARKS / BENCHRUNNER SPA windows** — the two visual command windows over the STDB control plane
  (`HARNESS_BENCH_CONSOLIDATION_PLAN.md` Layer 3); deferred until the headless system is fully proven (operator).
