# Mentorship v2 — `AskForAdvice`: thrash-invited, model-initiated, stronger-model mentorship

**Status:** SPEC (operator-designed 2026-08-28; not commissioned). Gated build — Phase 0 (heed
probe) decides whether the rest is built.
**Origin:** the loop-assist A/B arc. The prior mentorship path (`PATTERN_DETECTION` +
same-strength helper) was proven **inert** — it fired on 0/7 outcome-changing tasks, and even when
it fired the "mentor" was the same weak model (`deepseek-v4-flash` mentoring `deepseek-v4-flash`),
so it had no intelligence to add. Corpus mining (this session) showed the *varied-approach loop*
(BUILD 1a's target) is rare (6 failing loops / 71 tasks, all ×2–3). The **dominant** failure mode is
**diverse-exploration thrash** — the model makes 44–105 *different* attempts that fail, and it
**ignores injected reminders** (the exact-input reminder fired ×3 on gcode-to-text; the model made
105 calls anyway). This spec is the mentorship layer the operator originally envisioned: a
**stronger** model mentoring a weaker one, invoked at the moment of genuine struggle, through a
channel the model actually **heeds**.

---

## 0. The two hard problems this design separates

1. **Heed** — injected advice is ignored. FIX: make the advice a **tool result the model
   requested** (agents act on tool results they fetch, unlike ambient reminders).
2. **Over-reliance** — an always-usable "ask a stronger model" tool becomes a crutch (offload all
   work). FIX: gate the **executor** (not the tool's visibility), so the door is locked until
   genuine thrash, opens briefly, rate-limited, and only ever returns a **hint, not the solution**.

Detection is **cheap + deterministic + harness-side** (a failure-density read over the decision
store — no LLM). The expensive **stronger-model** call fires only when the model *bites* the tool.

```
thrash detected (harness, ~free) ─► inject: "<system-reminder>You've made N attempts, M failed,
   no progress. Stop guessing — call AskForAdvice.</system-reminder>"  (suffix-append, cache-safe)
        │
        ▼  model calls the tool  (its choice → it heeds the result)
   AskForAdvice(question?) ─► EXECUTOR GATE (ladder, below)
        │  eligible ▼
   stronger model (MENTORSHIP_HELPER_MODEL = deepseek-v4-pro; single DeepSeek key)
   reads {failed trace + task + question} ─► returns a HINT (direction, not the answer)
        │
        ▼  tool result the model requested → HEEDED → model does the work with the hint
```

---

## 1. PHASE 0 — THE HEED PROBE (the gate; build nothing else until this passes)

Everything rests on one empirical question: **when a reminder tells deepseek-flash to call
`AskForAdvice`, does it emit a `tool_use` for it — or just acknowledge in prose?** If it reliably
calls the tool, the whole design holds. If not, we fall back to harness auto-invoke (see §7).

**Probe (cheap, ~$0.01, no bench container):** a direct `/v1/messages` (or chat/completions) call
to deepseek-flash with:
- an `AskForAdvice` tool defined in the tool list (dummy schema),
- a synthetic conversation showing ~4 failed attempts at a task (real thrash trace works),
- a final tool_result carrying the thrash `<system-reminder>` inviting the tool,
- read the response: **does it contain a `tool_use` block for `AskForAdvice`?**

Run n≥5 (deepseek nondeterminism) across 2–3 thrash traces. **PASS bar: flash emits the tool call
in the clear majority.** Also record: does it call it *bare* or with a `question`? (informs §3.)
Artifact: `.bench/mentorship-heed-probe-<date>.md`. **If it fails, STOP — redesign toward auto-invoke
before building the executor/tool.**

---

## 2. Thrash detector (the trigger — shape-agnostic, grounded)

A function over the recent decision-store window (the store already records success/fail per call
— `DecisionStore`). Shape-agnostic: catches diverse-exploration thrash, which 1a/pattern-detection
structurally cannot.

- **Signal (start conservative, tune):** `≥K of the last N tool calls failed` (default K=4, N=6)
  **AND** no success in the last N **AND** turn count ≥ a floor (don't fire on early normal
  debugging — the `MAX_CONSECUTIVE_ERRORS=6` precedent: 3 failing probes are normal).
- **Optional second gate:** `budget_frac` past a fraction with no passing self-check.
- Pure function `resolveThrashState(recentDecisions) → {thrashing: bool, failures, window}`; unit-testable
  in isolation. Rides `CORTEX_LOOKUP_PRIOR_DECISIONS` (already default-on) — sterile-bench-safe, no key.

---

## 3. `AskForAdvice` tool

- **Naming (verified against the factory):** canonical = **`AskForAdvice`** (PascalCase — registry,
  storage, code, docs, sibling of `AskUserQuestion`); **on the wire = `ask_for_advice`** (snake_case,
  provider-facing). Per `CanonicalTool.ts` ("canonical in storage, provider-specific on the wire,
  transparent to user"); the harness normalizes with `name.toLowerCase().replace(/[_-]/g,'')`
  (`SubAgentPermissionChecker`, `toolCatalogCoherence.test`). ⇒ define/register as `AskForAdvice`; the
  Phase-0 probe and any hand-built tool schema must use the **wire name `ask_for_advice`** (that's
  what deepseek sees and emits).
- **Signature:** `AskForAdvice(question?: string)` — question **optional**. A thrashing model may
  not be able to articulate; bare-call must work (executor auto-assembles context). A given question
  focuses the mentor (rubber-duck benefit). Phase-0 tells us which flash prefers.
- **Registration:** registered in `BaseToolRegistry` **only when mentorship-active-for-a-weak-model**
  (env-gated; off for pro/strong agents and by default). **Always present when active** (prefix
  stable → cache never breaks — do NOT reveal-on-thrash; that re-bills the largest suffix at the
  worst moment).
- **Context to the mentor (bounded):** last N *failed* calls + their errors + the task statement +
  the question if given. Enough to diagnose, capped for cost.

---

## 4. Executor gate — the GRADUATED MENTOR ESCALATION (operator-refined)

The tool is always visible; the executor gates each call and **escalates mentor involvement** with
persistence. The intensity ramps only as the junior proves it's genuinely stuck — so the mentor's
cost tracks real need, and the junior does a round of directed self-work between escalations.

**Rung 0 — truly premature (no real failed trace / barely started) → cheap self-help bounce
(no LLM, free):**
> "You've made {n} attempts — reframe the goal and try a different solution before calling
> AskForAdvice again. Re-read the task, restate what you're actually trying to achieve, and try a
> distinct approach first."

Guards against pure offloading before any struggle exists (and there's nothing for a mentor to
reframe yet).

**Rung 1 — first substantive call (real thrash trace) → mentor's DIRECTED REFRAME (one mentor
turn):** the mentor model reads the last N failed turns and writes a *"continue trying"* message
with **specific, directed reframing** — what assumption to drop, what to reconsider, which direction
to try — NOT the solution. Returned as the tool result; the junior tries again *with direction*.
This is the operator's key refinement: even the first honored call gives real contextual help, not
a canned bounce — a senior saying "step back, you're assuming X; look at Y" and sending them back to
work.

**Rung 2 — calls AGAIN after following the reframe and still failing → STRUCTURED INTERVIEW (à la
`AskUserQuestion`):** persistence proves the light-touch reframe wasn't enough, so the mentor
escalates to a **structured Q&A** — the sibling pattern to the `AskUserQuestion` tool: the mentor
presents structured diagnostic questions / candidate blockers ("which is your actual blocker:
(a) data format, (b) the test harness's expected interface, (c) the algorithm?") and iterates to pin
down the issue with the junior. Heavier engagement, only when earned. Still diagnostic — it isolates
the blocker; it does not hand over the fix.

**Rate-limit:** cap honored escalations (≈2–3/task incl. the structured interview). Beyond it →
"You've consulted twice; execute the guidance you have."

Net over-reliance guards: cheap bounce before real struggle (rung 0); escalating cost only with
proven persistence (rungs 1→2); rate-limit (cap); and the hint-not-solution rule (§5) at every rung.

---

## 5. Mentor prompt — HINT, not solution (the deepest guard)

System prompt for the mentor model: *"You are a senior engineer. The junior is stuck. Give a
**hint or redirection** — name what they're missing or the wrong assumption they're making — in 1–3
sentences. **Never write the solution or the code.** They must do the work themselves."*

Why it's the deepest over-reliance guard: if the mentor solves it, (a) the weak model learns to
offload and (b) the **training corpus is polluted** — a graduated house model's trajectory must show
*it* solving with a hint, not the pro doing the work. This preserves agency AND keeps the DBAI
graduation data clean. Direction in ("you keep assuming Postgres; the tests import pyspark"),
execution stays the junior's.

---

## 6. Cache-safety (already solved by the shape)

- Tool always in the surface when active → **prefix stable, no cache break** (the reveal-on-thrash
  options pay the 31× miss on the largest suffix — rejected, §0/§3).
- Thrash reminder = **suffix-append** on the tool result (the existing `DecisionPriorInjector`
  pattern) + post-turn cleanup → next request byte-identical. No item-10/11 rebuild.
- Mentor runs **off-main** in its own context (its own cache); its hint returns as a normal tool
  result. Main model's cache never mutated by the mentor.

---

## 7. Touchpoints (VERIFY with an Explore/downstream map before editing)

- Thrash detector: new `orchestrator/thrashDetector.ts` (pure), fed the decision-store window.
- Reminder tier: `CortexOrchestrator.processToolTraining` (~L8095) — add the thrash tier alongside
  exact/family/approach(1a), gated on `resolveThrashState`.
- Tool + executor: `tools/registries/BaseToolRegistry.ts` (registration, mentorship-active gate) +
  a new executor calling the helper; reuse `HelperModelMiddleware` off-main invocation +
  `MENTORSHIP_HELPER_MODEL` (the separate model var — set to `deepseek-v4-pro`).
- Rate-limit + eligibility state: per-session counter (the orchestrator already tracks session state).
- Boot-prompt line: `promptPresets.ts` boot-minimal — "when you've tried several approaches without
  progress, call AskForAdvice instead of guessing again" (the tool-selection nudge that must land).
- **Backstop (Phase 0 result 2026-08-28: heed is WEAK — 2/10 default, 4/10 forceful; the invite alone
  is unreliable):** on HIGH-confidence thrash, **force `tool_choice:{type:function,function:{name:
  ask_for_advice}}` for the one thrash turn.** This is a per-request parameter, NOT the cached prefix,
  so it is cache-safe, and it delivers the mentor hint through the heed-friendly TOOL-RESULT channel
  (superior to auto-injecting the hint as an ambient reminder, which is itself weakly heeded). The soft
  invite stays rung 1 (captures the ~40% who self-refer); forcing is the backstop for the rest. Reserve
  forcing for high-confidence thrash — a false-positive force wastes a pro call. Full result:
  `.bench/mentorship-heed-probe-2026-08-28.md`. The deeper heed lever is TRAINING the escalate-when-stuck
  reflex into the DBAI corpus (forceful prompting capped at 40%).

---

## 8. Test plan (TDD)

1. `thrashDetector` unit: fires at K/N, not before the floor, resets on success.
2. Executor ladder unit: first call → reframe refuse; thrash-eligible subsequent → honor; rate-limit.
3. Mentor-prompt guard: mentor output is a hint (assert no code fences / solution markers — soft).
4. Cache: `prefixStability` — the thrash reminder append + tool presence leave the next request
   byte-identical (the item-11d test extended).
5. Integration: a scripted thrash session → reminder fires → (mock) tool call → executor honors →
   hint appended.

---

## 9. Rollout / A/B gate

- Ships **off by default** (mentorship-active + weak-model + stronger-mentor all opt-in).
- 🎯 **TASK TARGETING (fire-check finding 2026-08-28): a mentor only helps where it is STRONGER ON
  THAT TASK.** The 4 flash retry_loop tasks (dna-*, gcode, make-mips) fail for **pro too** (pro
  budget-exhausts, turns=None, bf~1.0–1.1) — capability-ceiling tasks hard for everyone; a pro hint
  there is no smarter than flash's own reasoning → **exclude both-fail tasks.** Target **KNOWLEDGE-GAP
  tasks** where flash lacks specific knowledge pro HAS (the Spark SQL / pyspark case). Probe
  corroboration: heed AND forced-hint redirect were both higher on the knowledge-gap (query) trace
  than the both-hard (gcode) trace. Build the A/B set from **flash-fails-∧-pro-passes** tasks (mine
  the matrix cells for that split), NOT 1a's rare varied-loop tasks and NOT both-fail tasks.
- 🔵 **GROUNDED with the actual matrix mine (2026-08-28, `.bench/distill-final` fl-lifted vs pl-lifted,
  full 89):** `flash-fails ∧ pro-passes` = **17 raw** (flash-fails 32, both-fail 15). But 17 ≠ 17 mentor
  targets — broken down by flash's FAILURE MODE, only a slice is mentor-shaped:
  - **retry-loop ∧ pro-passes = 4 — the TRUE AskForAdvice core:** dna-assembly, filter-js-from-html,
    polyglot-rust-c, winning-avg-corewars (flash loops, pro solves → a hint can break the loop).
  - no-trajectory/plumbing = 6 (adaptive-rejection-sampler, gpt2-codegolf, hf-model-inference,
    largest-eigenval, make-mips-interpreter, qemu-alpine-ssh) → **infra-DNF (empty-session/402 era),
    REQUEUE not mentor** — some may flip to pass on a clean flash rerun.
  - wrong-artifact = 2 (polyglot-c-py, torch-pipeline-parallelism) → **EndTurn gate (built)**, not mentor.
  - never-acted = 2 (regex-chess [EASY], schemelike-metacircular-eval) → **inaction guard (built)**.
  - budget/error-cascade/unclassified = 3 (model-extraction-relu-logits, compile-compcert,
    db-wal-recovery) → maybe 1-2 real knowledge-gap.
  - **Retry-loop reframe corrected:** flash's ~11 retry-loop tasks SPLIT 4 pro-pass (addressable) / 7
    both-fail capability ceiling (make-doom, path-tracing, query-optimize, rstan-to-pystan, sam-cell-seg,
    torch-tensor-parallelism, train-fasttext — mentor useless). The earlier "dna-*/gcode/make-mips are
    both-fail" was coarse: dna-ASSEMBLY is pro-pass, dna-INSERT/gcode/make-mips-interp are not.
  - **⇒ v2's genuine mentor target ≈ 4-6 tasks, not 17.** As a BENCH lever it's modest (and shrinks:
    several are in TB2.1's 28-fix set — polyglot-rust-c/polyglot-c-py/torch-tensor-parallelism/query-optimize
    — and the 4.71.0 guard build already cut flash loops 13→5, so the Aug-25 basis over-states it). v2's
    load-bearing justification is the DATA PUMP (§10), where even 4-6 clean thrash→ask→hint→solve episodes
    ×k are the reward-labeled positives. **Confirmatory 4-task A/B = the retry-loop∧pro-pass core above.**
- A/B arms: control (no mentorship) vs AskForAdvice (thrash→invite/forced→pro-hint). k≥5 (variance).
- **Read:** (a) heed — did flash call the tool on invite; (b) conversion — did the hint flip fails
  to passes; (c) cost — pro-mentor $/task; (d) no over-reliance regression on easy controls.
- **Merge only through the standard gate + judge** (no promote on enthusiasm) — the loop-assist arc's
  whole lesson: confirm the mechanism FIRES + reproduces (n≥2) before believing any effect.

---

## 10. THE PRIMARY VALUE PROP — a data pump for the apprentice (operator, 2026-08-28)

**We cannot fine-tune deepseek (API-only/closed).** That doesn't shelve this — it REFRAMES it. We
don't train deepseek; we **USE deepseek + pro to GENERATE the training data that trains our own
(trainable, open-weight) apprentice.** The full loop:

```
AskForAdvice on flash + pro-mentor  → forced tool_choice MANUFACTURES the pattern (heed ceiling
   irrelevant: we make it call the tool even though flash self-refers only 2–4/10)
 → episode: thrash → AskForAdvice → pro hint → follow-through → outcome
 → BANK (harvest-the-exhaust) → arm store → canon-store → DATA LAKE  (rail already exists)
 → filter SUCCESS episodes (hint followed → SOLVED = reward-labeled positives)
 → TRAIN the apprentice on them → apprentice natively (a) calls AskForAdvice when stuck AND
   (b) follows hints → serve apprentice behind the same mechanism (self-refers + forced backstop)
```

- **Forced `tool_choice` is a DEMONSTRATION-GENERATION forcing function**, not just a runtime backstop:
  it manufactures the `thrash→ask→hint→follow→solve` trajectory the apprentice must learn, from a
  demonstrator that wouldn't self-refer. Route around deepseek's un-trainable heed ceiling by forcing
  (to generate) then training the apprentice past it (to make native).
- **Knowledge-gap targeting is doubly load-bearing:** `flash-fails ∧ pro-passes` tasks are where the
  hint converts to a SOLVE → where episodes carry POSITIVE reward → the training-worthy examples.
  Both-fail tasks yield ask→hint→still-fail (uninformative). Same targeting makes the mechanism work
  AND generates good data.
- **North-Star alignment:** "the platform's own exhaust (canon trajectories, reward-labeled episodes)
  is the training substrate for the next graduate" (`RECURSIVE_PM_WAKE_LOOP_DESIGN.md`). A DATA PUMP
  for the DBAI apprentice pipeline, on infra that already exists.

**Data-generation design requirements (for the build):** bank the FULL episode (thrash window →
AskForAdvice call + question → mentor hint → all subsequent actions → graded outcome); label by
outcome (hint-followed→solved = positive); tag `mentor_episode` so the distiller/canon can filter
them; capture the pro hint verbatim + whether the junior's next actions aligned with it.

## 11. Non-goals
- NOT the passive `PATTERN_DETECTION` path (inert — retire it or fold it in as one thrash signal).
- NOT a solver — the mentor hints; the junior executes (also keeps the apprentice-facing corpus
  clean: it shows the JUNIOR solving with a hint, never the pro doing the work).

## 12. GROUNDED TOOL-SYSTEM ARCHITECTURE (read file:line 2026-08-28 — the map Stage B rests on)

Recorded so the integration is never re-derived (grounded-research: make the doc the source of
truth). All anchors relative to `omniclaude-v4/packages/core/src` unless noted.

**A. DEFINITION vs EXECUTION are split across two packages** (`packages/executors/src/ExecutorRegistry.ts:5-11`):
- **Definitions — `packages/core/src/tools/`:**
  - `registries/BaseToolRegistry.ts` — IMMUTABLE static `BASE_TOOLS[]` of `CanonicalToolDefinition`
    (`{name, description, schema, category, discoveryTier, metadata}`); singleton `baseToolRegistry`.
    `AskForAdvice` is here (`:823`). Base tools carry NO code.
  - `registries/AddonToolRegistry.ts` — MUTABLE, dynamic ("on the fly") tools; `addon-temporary`
    (session) / `addon-persistent` (saved); each carries `implementation:{language,code,dependencies}`
    (`types/CanonicalTool.ts:101-110`); singleton `addonToolRegistry`. AskForAdvice is NOT this.
  - `ToolFactory.ts` (singleton `toolFactory`) — unifies base∪addon (base precedence, deduped) →
    `applyToolProfile()`; the single path every model-facing surface funnels through (`:32-57`).
    `getEssentialTools()`/`getStandardTools()` (`:172/:187`) drive PTC tiering.
  - `types/CanonicalTool.ts` — `ExecutionEnvironment = client|sandbox` ONLY (no 'server'; server tools
    dispatch by NAME). Addon `implementation.code` runs via the sandbox/artifact executors.
- **Execution — `packages/executors/`:** `ExecutorRegistry` (`src/ExecutorRegistry.ts:117`) maps tool
  NAME → a `BaseTool` subclass; `registerAllExecutors():133` (~40: ShellTool/EditTool/…/EndTurn…);
  `execute(name,params,signal):291`. **Executors receive only `ExecutorConfig` (`:119`) — NO
  helperMiddleware / orchestrator state.**
- **Three orchestrator dispatch paths** (`orchestrator/CortexOrchestrator.ts executeToolCalls`):
  (1) name-switch context-management (`:6625/6713`); (2) MCP (`:6633/6645`); (3) `executorRegistry`
  (`:6649/6936`). **⇒ AskForAdvice MUST be orchestrator-dispatched (path 1), because the mentor call
  needs `this.helperMiddleware` + session thrash-state, which path-3 executors structurally lack
  (`ExecutorRegistry.ts:119`).** Same reason MemoryWrite/InitCortexContext are path-1.

**B. THE CANONICAL SYSTEM — three ORTHOGONAL layers** ("canonical in storage, provider-specific on the
wire", `ToolNamingHandler.ts:1-15`). Set by three independent `ModelConfig` keys:
- naming — `tools.namingConvention` (`snake_case`|`PascalCase`) → `ToolNamingHandler` at the GATEWAY.
- schema shape — `tools.adapter` → the format adapter (`AdapterRegistry.getAdapterForModel`).
- transport — `api.pattern` → `APIClient` body-builders.
- Round-trip: `GatewayTranslationLayer.prepareRequest:230` = `applyNamingConvention` (canonical→wire,
  `:275`) → dedupe (`:285`) → `adapter.toProviderTools` (SCHEMA only, `:293`). `convertResponse:379` =
  `adapter.fromProviderMessages` → reverse-name `applyNamingToToolUse(...,'PascalCase')` (`:408-414`)
  → **orchestrator always sees CANONICAL `AskForAdvice`.** `ToolNamingHandler.convertName:95` memoized;
  MCP `server__tool` pass through unmangled (`:108`). deepseek/deepseek-pro = `chat/completions` +
  ChatCompletions adapter + snake_case (the `'interleaved'` on the card is `reasoning.pattern`).
- 🔴 **Forced `tool_choice` rides the SAME three layers** (corrects an earlier plan): pass CANONICAL
  `toolChoice {type:'tool',name:'AskForAdvice'}` INTO `prepareRequest` as an option → convert its name
  with `convertName(name, namingConvention)` THERE (naming stays at the gateway, NOT hand-set in the
  orchestrator) → `orchestrator/toolChoiceTranslation.ts translateToolChoice` (BUILT, 12 tests) does the
  per-provider SCHEMA shape → APIClient body-builders emit `{key:value}` (`tool_choice` vs Google
  `tool_config`). `tool_choice` is body-level, NOT the cached tools/prefix → cache-safe.

**C. DEFERRED LOADING + ANCHOR LIFT (the winning config is "lifted, DEFERRED" — NOT full catalog;
verified 2026-08-28: full base catalog = 51 tools, essential tier = 15; the bench inherits
`ENABLE_DEFERRED_TOOL_LOADING='true'` (default, adapter does NOT override) so the model sees ~15
essential+recently-used tools, and the bash-edit anchor lifts to THAT set, never the 51. "Lifted"
= the anchor lifting, orthogonal to deferred-on/off; the true full-catalog/deferred-OFF config is
an UNTESTED lever)** — filter order per request
(`CortexOrchestrator.ts:1240-1274`): deferred filter (`:1246`, `!isPTCEnabled && enableDeferredToolLoading`
→ `toolFilter.getFilteredTools` keeps **essential + recently-used only**) → anchor (`:1259`
`applyAnchorIfArmed`, {Bash,Edit} turn-1, no-op once lifted) → post-filter append (`:1272`).
`ENABLE_DEFERRED_TOOL_LOADING` default `'true'` (`config/SettingsSchema.ts:428`); `ENABLE_PTC` default
`'false'` (`:426`, Anthropic-only path). **⇒ standard-tier tools (incl. AskForAdvice) are STRIPPED by
the deferred filter even after the lift** — the `discoveryTier:'standard'` I set does NOT make it
present. 🔴 **CORRECT inclusion = APPEND AskForAdvice into `toolsToUse` AFTER the deferred filter +
anchor (`:1273`, the `ensureStructuredOutputTool` request-scoped pattern — "appended after the deferred
filter so it can't be stripped"), gated weak-model + mentorship-active, session-stable for the cache.**
Do NOT rely on the tier or SearchTools discovery (a thrashing model can't afford a discovery round-trip).

**D. STAGE B integration points (grounded, all confirmed above):**
1. Inclusion — append at `CortexOrchestrator.ts:1273` AND the streaming region `~:3800`, gated.
2. Dispatch — branch beside context-management (`:6630/6713` + parallel `:7156`) → `generateMentorHint`.
3. Forced tool_choice — add `toolChoice` option to `GatewayTranslationLayer.prepareRequest` (`:234`
   opts + `:308` output) with name-conversion there; call `translateToolChoice` at APIClient's ~6
   tool-attach sites (Anthropic `:447`, xAI `:584` SACRED-additive+canary, chat `:888` [covers stream],
   responses `:1241/:2494`, gemini `:1388/:2812`, sdk `:3136/:3244`).
4. Trigger — `MentorshipMiddleware.shouldTriggerMentorship:112` at the continuation `prepareRequest`.
5. Banking — `DecisionStore.recordEvent({kind:'mentor_consult', detail})` (kind added, Stage A).
- Duplication hazard: assembly (`:965`/`:3545`), dispatch (`:6625`/`:7156`), two loops (`:1664`/`:4048`)
  are all stream/non-stream duplicated — every edit goes in BOTH or is refactored to a shared helper.
- Capability flags `supportsToolChoice`/`toolChoiceOptions` are UNPOPULATED on production cards (only
  the interface templates, `models/ModelConfig.interface.ts:59/111`) → gate on provider/pattern, not
  the flag. `generateContent` does NOT spread `request.parameters` → tool_config needs explicit insert.

## 13. V2 BUILD PLAN + 4-TASK VALIDATION (✅ CODE BUILT 2026-08-28; validation cost-gated, NOT run)

**✅ BUILD STATUS (2026-08-28): B1+B2+B3 CODE COMPLETE, typecheck+build clean, tests green, UNRELEASED
(gated off: needs `reactiveMentorship.enabled` + `CORTEX_MENTOR_FORCE=true`).**
- B1 (toolChoice→wire) — 🔵 REFACTORED to the correct layering (operator: "the gateway translator
  translates canonical→provider schemas"): the GATEWAY does BOTH translations. `prepareRequest` takes a
  NORMALIZED `toolChoice` opt, name-converts it (`AskForAdvice`→`ask_for_advice`) AND calls
  `translateToolChoice(named, api.pattern)` → stores the fully PROVIDER-SHAPED `{key,value}` on
  `PreparedRequest.toolChoice` (only when tools are sent). The TRANSPORT (`APIClient.applyToolChoice`) is
  now a DUMB SPLAT — `body[request.toolChoice.key] = request.toolChoice.value` — at all 10 tool-attach
  sites (Anthropic/xAI-messages/chat/responses/gemini-HTTP + google-SDK ×2, stream+non-stream;
  responses-stream inlined for the `this`-less closure). NO per-provider logic in APIClient anymore
  (removed the hand-rolled `applyToolChoiceGenAI` + the per-site `translateToolChoice` import). xAI site
  additive-only (does not touch interleaved thinking). ✅ GOOGLE GAP CLOSED: `translateToolChoice` now
  owns the split — `generateContent` → snake `tool_config` (REST HTTP wire), `google-sdk`/`google-genai`
  → camelCase `toolConfig`/`functionCallingConfig`/`allowedFunctionNames` (@google/genai SDK config).
  `WireToolChoice.key` ∈ {tool_choice, tool_config, toolConfig}. **COVERAGE AUDIT (2026-08-28): every
  dispatched `api.pattern` is wired both sides** — messages (Anthropic+xAI, stream+non-stream), chat/completions,
  responses (×2), generateContent (×2), google-sdk/google-genai (×2). **ONE structural exception: `hf-space`
  (Gradio Spaces)** — the gateway SHAPES it, but `sendHFSpaceAPI` calls the Space's `/run` predict with a
  FIXED signature `[messages, tools, maxTokens, temperature]` (no tool_choice slot), so it can't forward the
  force → silently no-ops. Not a harness bug — a SERVING-side limit (the Space `app.py` template needs a
  tool_choice arg). 🎯 ENDGAME RELEVANCE: when the trained apprentice is served via hf-space and we want to
  force AskForAdvice on IT, the Space template must add that parameter. (`pattern:'chat'` for Cohere is a
  doc-only placeholder in ADDING_NEW_MODELS.md — not a live card, not dispatched.)
- B2 (arm on thrash): `resolveForcedMentorChoice(toolsToUse)` — gated mentorship-active + `CORTEX_MENTOR_FORCE`
  + tool-present + not-rate-limited + `resolveThrashState(recentOutcomes, turnNumber)` high-confidence →
  `{type:'tool',name:'AskForAdvice'}`, passed as `toolChoice` at BOTH main prepareRequest calls
  (non-stream :1291, stream :3824). New `DecisionStore.recentOutcomes(limit)` = chronological pass/fail
  window (thrashDetector needs the mix, not recentFailures' failures-only). Fail-open on read error.
- B3 (episode banking): `executeAskForAdvice` now banks the FULL episode — `tag:'mentor_episode'`, `turn`
  (trajectory-join key), `question`, full `hint` (untruncated), `failedTrace` — reward label joined at
  distill time from the task row.
- TESTS (all green, scoped-single-file): `GatewayTranslationLayer.toolChoice.test.ts` (4 — gateway does
  name-conv + provider-shape + only-when-tools + default-path-clean), `DecisionStore.test.ts` +2
  (recentOutcomes window/limit/event-excl), `ToolChoiceTranslation` 14 (+2 for the google HTTP-vs-SDK
  split), v1 ThrashDetector 8 / MentorConsult 12 / ReactiveMentorship 30 = no regression. typecheck+build clean.
- NOT DONE: soft-invite `<system-reminder>` thrash tier (B2 uses the forced path only — the invite/rung-1
  is v1's executor ladder; a proactive pre-tool reminder tier is optional). NOT released, NOT validated.


**Already built (v1, shipped 4.82.0 + tested):** `thrashDetector.ts`, `mentorConsult.ts` (graduated
ladder), `generateMentorHint`, `AskForAdvice` tool + `ensureAskForAdviceTool` inclusion + orchestrator
dispatch, `DecisionStore.recentFailures`/`recordEvent('mentor_consult')`, and **`translateToolChoice`
(12 tests, all provider patterns incl. xAI additive).** v1 verdict: wiring sound, voluntary heed 0/6.

**Net-new for v2 = 3 wiring pieces + banking (all touchpoints grounded in §12.D — verify each with a
downstream-order map before editing, per feedback-downstream-order-mapping):**
- **B1 — carry `toolChoice` to the wire.** Add the `toolChoice` opt to `prepareRequest` (§12.D.3:
  GatewayTranslationLayer `:234`/`:308`), name-convert it THERE (gateway, not orchestrator), then call
  `translateToolChoice(choice, apiPattern)` at APIClient's ~6 tool-attach sites and set `body[key]=value`.
  🔴 xAI site (`:584`) is the SACRED interleaved-thinking path — tool_choice is an ADDITIVE body key that
  does NOT touch the thinking round-trip, but gate it behind before/after grok canary probes per
  [[feedback_xai_interleaved_sacred]]. `generateContent` needs an explicit `tool_config` insert (no
  param-spread). Test: extend `prefixStability` — forced-choice leaves the cached tools/prefix
  byte-identical (it's body-level).
- **B2 — arm forcing on HIGH-confidence thrash.** In the continuation `prepareRequest` (§12.D.4,
  `MentorshipMiddleware.shouldTriggerMentorship:112`): when `resolveThrashState` = high-confidence
  thrash AND the tool hasn't been honored this window, set `toolChoice={type:'tool',name:'AskForAdvice'}`
  for THAT ONE turn (soft-invite reminder stays rung-1 for the ~40% self-referrers). Gate behind
  `CORTEX_MENTOR_FORCE=true` (default off). False-positive force wastes a pro call → keep the confidence
  bar high (past turn floor + full window + no success). Test: scripted thrash → forced turn emits the
  tool_use; below-threshold → not forced.
- **B3 — full-episode banking (the data pump, §10).** On a mentor_consult: bank the WHOLE episode
  (thrash window → AskForAdvice+question → pro hint verbatim → subsequent junior actions → graded
  outcome), tag `mentor_episode`, reward-label by outcome. Rides the harvest-the-exhaust trajectory rail
  (harbor-bench §📐 invariant 10) → arm store → canon. This is what makes the run worth its cost even at
  n=4: positive episodes are apprentice training data.
- Effort: ~1 focused build session (B1 is the bulk — 6 grounded sites + canary; B2/B3 are small). TDD
  per §8 + the two new tests above; typecheck + no-keys unit run BEFORE any publish ([[feedback-preflight-before-publish]]).

**4-TASK VALIDATION (the retry-loop∧pro-pass core, §9 mine):** `dna-assembly`, `filter-js-from-html`,
`polyglot-rust-c`, `winning-avg-corewars`.
- **Arms (k≥5/task — the loop-assist variance lesson):** (A) CONTROL = flash-lifted, mentorship OFF
  (or reuse the matrix baseline rows for these 4). (B) TREATMENT = flash-lifted + `MENTORSHIP_ENABLED` +
  `CORTEX_MENTOR_FORCE=true` + `MENTORSHIP_HELPER_MODEL=deepseek-v4-pro`.
- **Reads:** (a) MECHANISM FIRED — thrash trigger + forced tool_use in the trajectory (grep
  `ask_for_advice` + `mentor_consult` events) — the loop-assist lesson: NEVER attribute a delta without
  confirming firing; (b) CONVERSION — hint flips fail→pass, reproduced (n≥2 of the k); (c) pro-mentor
  $/task; (d) episodes banked with reward labels (data-pump deliverable); (e) no over-reliance regression
  (spot-check an easy control task doesn't start over-calling the tool).
- **Cost (rough):** 4 tasks × 5 reps × 2 arms = 40 flash runs (~$0.02–0.10 each) + forced pro-mentor
  calls (~$0.10 each, ~1–2/thrash-task) ≈ **$5–10**. Schedule OFF-PEAK (DeepSeek peak 2× — harbor-bench).
- **Durability + teardown (the container-cost lesson):** one arm store per arm, durable supervisor +
  idempotent relaunch (harbor-bench §📐); **short `sleepAfter` on the bench session AND `/admin/sessions/destroy`
  every session on completion** ([[nexus-cortex-sandbox-kill-switch]]); NEVER poke to verify. Checkpoint
  the resume memory BEFORE walking away ([[feedback-checkpoint-before-autocompaction]]).
- **Merge gate:** standard statistical gate + judge; the confirmatory single cell (no FWER family). A
  conversion on ≥2/4 tasks reproduced = build the data-pump loop; 0 conversions = the bench-lever thesis
  dies, keep only if the banked episodes justify the pump on their own.

**DECISION FRAME for the operator:** v2-as-bench-lever ≈ 4 real targets (shrinking after guards + TB2.1)
→ modest. v2-as-data-pump = the load-bearing reason (manufactures apprentice training episodes deepseek
won't self-generate). Cheaper alternatives that DON'T need v2 and may matter more for TB2.1: REQUEUE the
6 infra-DNF flash fails (may flip some to pass for free) + ride the already-shipped inaction/EndTurn
guards (cover the never-acted + wrong-artifact tasks in the 17).
