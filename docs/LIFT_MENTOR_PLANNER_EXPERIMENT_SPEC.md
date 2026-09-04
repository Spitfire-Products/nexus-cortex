# Lift-Boundary Mentor-Planner — Experiment Spec

**Status:** DRAFT (operator-gated; nothing built, published, or launched). 2026-09-04.
**Owner decision points** are marked 🟠. **Build-blocking prerequisites** (grounded code-reads) are §3.
**Discipline:** cortex-bench (treatment-vs-banked-control, n≥2, mechanism-engagement evidence, ship-dark →
live-seeded fire-check → bench, overfitting guard) + grounded-research (every file:line is a POINTER to
re-verify NOW; claims are labeled `verified(file:line)` or `OPEN`).

---

## 1. HYPOTHESIS

Two failure classes cost us score and money on TB2.1, and **both are planning failures the reactive nets are
structurally blind to**:

1. **Grind-to-wall** — 14 tasks ran to the 1000-iteration cap = ~78% of tokens (199M input). The model acts
   forever without converging. `verified`: the grind-blindness is real — the two grind-stoppers
   (failure-lookup decision store; mentor-auto `resolveThrashState`) BOTH require `currentlyFailing`, and
   grinds are ~90% successes (make-mips 119 ok / 14 fail). Tool histogram: Bash 3232×, Skill 1×, consult 1×
   in ~4,500 calls — the narrow door produced pure action, zero planning/reading/consulting.
2. **Criteria-misalignment (self-graded success)** — the model builds/runs ITS OWN tests, passes them,
   declares victory, and EndTurns, but the hidden grader (TB2.1's own unmodified `test.sh`) checks something
   else. `SIZED 2026-09-04` (bucket mine, `scratchpad/criteria-misalignment-bucket.md`): of 22 flash fails —
   **GRIND 14 (64%, dominant), CRITERIA-MISALIGNMENT 5 strong (up to 7 by end-behavior, ~23%), OTHER 3.**
   Named: `kv-store-grpc` (BOTH r1+r2 — reproducible), `filter-js-from-html__r1`, `configure-git-webserver__r3`,
   `pytorch-model-cli__r1` (weak); gray-zone (+2): `torch-pipeline-parallelism__r1`, `raman-fitting__r1`
   (overran wall AND self-declared — the two modes CO-OCCUR). ⇒ criteria-misalignment is a **small-COUNT but
   HIGH-VALUE-per-conversion** bucket: each is a *convertible near-miss* (the model was capable, aimed wrong),
   so 5–7 conversions = a direct +5–9% flash pass-rate. Grind is the dominant class, so the RELIABLE win is
   retire/wall-management; score-lift is the high-value secondary. 🔴 Methodology note: this store has **no
   `turns=None` sentinel** — the grind marker is `exc=["AgentTimeoutError"]` (agent overran the harbor per-task
   wall-clock, 900/1800s). ⇒ #2's `CORTEX_TURN_DEADLINE_MS` at 90% is the right internal lever: it converts a
   hard harbor-kill-with-nothing into a graceful best-effort submit BEFORE the timeout.

**Hypothesis:** A **bounded, max-reasoning mentor that plans the task at the lift boundary** — *before* the
narrow-door action model resumes — will (a) **convert criteria-misaligned near-misses to PASSES** (score lift,
the primary hoped-for win), (b) **retire grinds early** instead of at the wall (cost saving), **without
regressing** the easy/mid tasks the narrow door already passes.

**Mechanism (why it should work):** DeepSeek in the agentic path conditions on its own accumulating reasoning
trail, so both failures are **self-reinforced** (the grind re-justifies a doomed approach; the self-test
manufactures false confidence). An external plan from a *different* model instance is a **decorrelator** — an
outside view injected at the one moment you can see the failure coming (there is no failure signal for the
reactive nets to catch). Lineage: `def-ab49527d7d` (child-mentor/decorrelation) + `def-efdbb67fd8` (effort
envelope) — both LIVE as sibling arms in the auto-consult block.

---

## 2. DESIGN — surgical extension of the existing auto-consult block

**This is NOT new machinery.** It is two changes to a proven, DeepSeek-safe block.

### 2.1 What already exists (verified this session)
- **Orchestrator-dispatched mentor consult + system-reminder delivery** — `verified`
  `CortexOrchestrator.ts:8583–8629`. The comment states it explicitly: forced `tool_choice` is
  provider-unreliable on DeepSeek (≥1 prior tool_call ⇒ the API ignores the forced choice, mapped
  2026-08-30), so on thrash "the orchestrator consults the mentor ITSELF (`executeAskForAdvice`) and delivers
  the hint through the tool-result reminder channel — the delivery that provably works."
  - Invoke: `:8614` `const consult = await this.executeAskForAdvice(undefined);`
  - Delivery: `:8620–8625` prepends `<system-reminder>MENTOR ADVICE …: {consult.llmContent}</system-reminder>`
    to the next content block.
  - Trigger (the grind-blind part we REPLACE): `:8594–8598` gated on `outcome.status !== 'ok'` +
    `resolveThrashState`.
  - Reusable scaffolding: `maxConsults` rate-limit + rungs (`:8600`, `:8616`), episode banking,
    mechanism-engagement `store.recordEvent` pattern (`:8654`, sibling `effort_pulse` arm).
- **Forced tool_choice is OFF the table** for anything firing after turn 0 — `verified` (tool-dev skill §6.4 +
  the block comment). The lift is always after the anchor's turn-0 bash action ⇒ history always holds a prior
  tool_call ⇒ forced choice is dead on DeepSeek. This is why Option C (orchestrator sidecar) is the *only*
  viable path, not merely the preferred one.
- **TB2.1 task handoff** — `verified` `nexus_cortex_agent.py` `run(instruction, environment, context)` →
  `cortex --new "<instruction>"` in the task repo dir inside the container; reward = the task's own verifier
  (never seen). So the model gets a **prompt + a container**; the mentor can be handed the SAME instruction
  (it is already the first user message in history).
- **TodoWrite store** — `verified` `TodoWriteTool.ts:30` is a **module-global `Map`** with `getCurrentTodos()`
  ⇒ the orchestrator CAN populate it server-side from a plan (no model tool call). BUT per-turn re-surfacing
  is **NOT wired**: `SystemReminderInjector.{createTodoReminder,createTodoUpdateReminder,hasTodoListChanged}`
  exist (`SystemReminderInjector.ts:227,323,373`) with **no caller in `packages/*/src`** — so a pre-populated
  list is invisible unless the model queries it, OR we wire the re-surface.
- 🔴 **TodoWrite is DEFERRED-STRIPPED in the bench config** — `verified` `TodoCreate/TodoUpdate/TodoList` are
  `discoveryTier: 'standard'` (`BaseToolRegistry:694,732,748`); the deferred filter keeps only `essential` +
  recently-used (`ClientSideToolFilter.ts:34,44`). So in the narrow-frame lift schema the MODEL does not have
  the todo tools at all (hidden behind SearchTools). ⇒ **arm C splits into two independent halves, and the
  clean design AVOIDS the deferred problem entirely:** (a) the orchestrator POPULATES the store server-side
  (needs no tool presence) + (b) the model SEES a persistent read-only plan via wiring `createTodoReminder`
  into per-turn assembly (a system-reminder surface, NOT a tool call — also needs no tool presence). ONLY
  model-driven **check-off** (calling TodoUpdate) would need the tool present via a post-filter append
  (tool-dev §4) AND adds the narrow-door tool-call friction — so arm C SKIPS model check-off and measures
  plan-following by correlating actions to plan steps instead. ⇒ arm C's real cost = "wire the read-only
  re-surface," not "make TodoWrite reachable in the narrow frame." Still v2/deferred (§5, arm C). **v1 is
  UNAFFECTED — it delivers a plain system-reminder step-list, never touches TodoWrite.**
- 🟢 **The historical "forced-active-item / every-turn-nag" friction is NOT in the current harness** — `verified`
  the executor is warn-not-reject (`TodoWriteTool.ts:345` "Warn (don't reject) if setting multiple in_progress";
  no min-item / must-keep-active rule anywhere in its 436 lines), and the nag builders
  (`createEmptyTodoReminder`, `createTodoReminder`, `createTodoUpdateReminder`, `hasTodoListChanged`) are **DEAD
  — zero callers in core/executors/cli** (patterns ported verbatim from Claude Code but never wired). ⇒ the
  friction the operator recalls is Claude-Code / a prior version, not here. Consequence for arm C: wire a
  **plan-specific, change-only re-surface** (via `hasTodoListChanged` delta-injection, gated on
  `CORTEX_LIFT_PLAN`) — explicitly NOT the generic dead nags (which would re-introduce the every-turn friction
  for ALL sessions). Arm C can have a persistent visible plan without the historical glitchiness, by design.

### 2.2 The two changes (v1) — RESOLVED by the §3 code-reads
1. **Trigger:** thrash/`currentlyFailing` → **the lift boundary** (fire preventively, on a non-failure), behind
   a new master gate `CORTEX_LIFT_PLAN` (default off, ship dark). `verified`: the lift hook is FULLY BUILT —
   two sites (`:2910→2919-2920` non-stream, `:4835→4843-4844` streaming twin) already flip `anchorLifted=true`
   at the first tool_result boundary then call one-shot lift-deliveries (`deliverDeferredCorpusAtLift` +
   `deliverLiftNudge`). A new `deliverLiftPlanAtLift(model)` drops in beside them in BOTH loops. The gate is
   naturally scoped: it only fires when the anchor was armed + frame ≠ persist (`:2903-2908`) = exactly the
   narrow-door runs we want. At the lift the model has done EXACTLY ONE action, so the turn-0 bash output is in
   history = a real env observation for the planner.
2. **Payload = v1 SNAPSHOT planner (NOT a tool loop).** `verified`: `executeAskForAdvice` (`:8438`) and
   `generateMentorHint` (`HelperModelMiddleware:1381`) are a **single-shot** `generateGuidance`/`adapter.generate`
   call (text-in→text-out, `outputBudgetTokens:400`) — there is **NO existing bounded-tool-using-helper-loop
   primitive** in HelperModelMiddleware (every method is single-shot). ⇒ **v1 = a NEW sibling
   `generateTaskPlan(context)`** (mirrors generateMentorHint: one `generateGuidance` call, planning persona,
   ~1200 output budget) fed an **orchestrator-assembled env snapshot** (history-to-lift = task instruction +
   turn-0 action + its bash output, PLUS a cheap orchestrator recon: `ls -a`, `find . -name '*test*'`, cat
   README/task files). NOT an extension of generateMentorHint (different persona/input/budget). This is a SMALL
   build — it reuses `generateGuidance`, the `ensureDoctrineFresh('lift')` await-helper-at-lift template
   (`:592`, incl. `withTimeout` + fail-open + `recordEvent`), and the `deliverDeferredCorpusAtLift`
   append-to-last-tool_result injection (`:672`). **v2 = adaptive tool-using planner** (build a bounded helper
   tool-loop so the mentor can `cat` a test file it just discovered) — the richer "max reasoning + limited
   turns" version; DEFERRED because the loop primitive must be built from scratch.

### 2.3 The mentor planner turn (prompt design — the 3-part role)
The planner (helper model = `deepseek-v4-pro`, **max reasoning ON**, **hard TURN cap**, see §2.4) receives the
**same task instruction** and is directed to:
1. **Adversarial prompt analysis** — steelman where a naive solution fails; surface nuance/edge constraints in
   the instruction the action model will miss.
2. **Confirm the REAL criteria** — infer what the hidden grader will assert (provided test files? a stated run
   command? expected output?), and **explicitly distinguish task criteria from self-authored tests**: "success
   = the task's criteria pass; your own tests are a means, never the finish line."
3. **Recon + plan** — check the environment for resources, existing tests/fixtures, installers (fold in the
   uv/bare-box orient hint here), then emit a **step-by-step action plan** for the narrow-door model, OR a
   **RETIRE verdict** ("no viable path in budget — attempt <skeleton>, run the provided test, submit best-
   effort, do NOT grind"). Retire is a first-class output (the reliable cost win).

### 2.4 Bounding — v1 is single-shot (no turn cap needed); the constraint bites only in v2
`verified` (arc L56132–56139): a `max_tokens` cap TRUNCATES DeepSeek mid-thought (the silent-empty-hint era);
DeepSeek has no `budget_tokens` analog.
- **v1 (snapshot, single `generateTaskPlan` call):** there is no loop to cap. Bound = the `generateGuidance`
  **output budget** — size it for a plan (~1200 tok, up from the hint's 400), large enough not to truncate the
  plan mid-list. The helper's reasoning (deepseek-v4-pro thinking) precedes the output; a single adequately-
  budgeted call is safe. This removes the turn-cap complexity from v1 entirely.
- **v2 (adaptive tool-loop):** THIS is where the constraint bites — bound the planner's tool loop by a **turn
  cap** (`CORTEX_LIFT_PLAN_MAX_TURNS`, e.g. 5–8), never a token cap. Max reasoning ON; deliverable is a PLAN not
  a solution, so the turn cap makes it structurally unable to grind.

### 2.5 Delivery (v1)
Reuse the proven at-lift injection: append the plan as a `<system-reminder>` to the last tool_result message —
the exact `deliverDeferredCorpusAtLift` mechanism (`:670-675`, push a `{type:'text'}` block onto the
tool_result's content array; adapters render mixed [tool_result, text] per dialect). Re-inject each turn for
the first K turns so the plan doesn't decay (cheap; it must guide many turns). Plain numbered step-list. No
TodoWrite, no model-side tool burden.

---

## 3. ✅ PREREQUISITE CODE-READS — DONE 2026-09-04 (were build-blocking; now RESOLVED)
1. **LIFT hook — PINNED.** `verified`: the lift is the first-tool_result boundary, `CortexOrchestrator.ts`
   `:2903-2922` (non-stream) and `:4835+` (streaming twin). Sequence at each: guard `!anchorLifted && anchor
   armed && frame≠persist` → `anchorLifted=true` (`:2910`/`:4835`) → `deliverDeferredCorpusAtLift` (`:2919`/
   `:4843`) → `deliverLiftNudge` (`:2920`/`:4844`). ⇒ new `await this.deliverLiftPlanAtLift(effectiveModel)`
   goes on the line AFTER `deliverLiftNudge` in BOTH loops. Fires exactly once (one-shot flag pattern). Template
   to mirror: `ensureDoctrineFresh('lift')` (`:592`) already awaits a bounded helper call at the lift, injects,
   times out (`withTimeout`), fails open, and banks `recordEvent` — with "the MAIN model never sees the diff."
2. **`executeAskForAdvice` + `generateMentorHint` — READ; fork RESOLVED.** Both are **single-shot** helper
   calls (`executeAskForAdvice:8438` → `generateMentorHint:HelperModelMiddleware:1381` → one `generateGuidance`
   / `adapter.generate`, `outputBudgetTokens:400`, text-in→text-out). There is **NO bounded-tool-using-helper-
   loop primitive** anywhere in HelperModelMiddleware (all methods single-shot). ⇒ **v1 = NEW sibling
   `generateTaskPlan` fed an orchestrator-assembled snapshot** (the mentor-runs-tools fork goes to v2, since the
   loop must be built from scratch). NOT an extension of generateMentorHint (different persona/input/budget).
3. **Dispatch path — CONFIRMED path-1-only, no tool at all.** The planner is delivered via system-reminder
   injection (§2.5); the main model never calls a tool. ⇒ no BaseToolRegistry entry, no inclusion pipeline, no
   forced tool_choice, no unknown-tool guard. This sidesteps the entire §4-inclusion + §6-forced-choice surface
   of the tool-dev skill — the reason forced tool_choice is dead on DeepSeek post-turn-0 simply doesn't apply.

**⇒ Build is now fully specced and SMALL** (two new methods + two one-line call-sites + one env gate + a
persona/prompt), reusing 3 existing templates (`ensureDoctrineFresh` await-at-lift, `deliverDeferredCorpusAtLift`
inject, `generateMentorHint` helper-call). No remaining code-reads block v1.

### ✅ v1 BUILT DARK 2026-09-04 (typecheck clean · 8/8 planner tests · orchestrator e2e 26/26 · core build clean · UNPUBLISHED)
- `packages/core/src/training/liftPlanner.ts` (NEW, pure) — `PLANNER_SYSTEM` (3-part role), `buildPlannerUserPrompt`, `resolveLiftPlanConfig`. 8 unit tests.
- `HelperModelMiddleware.generateTaskPlan({task, observations, helperModelId})` — single-shot sibling of `generateMentorHint` (persona=PLANNER_SYSTEM); passes `effort`+`outputBudgetTokens` from `resolveLiftPlanConfig`.
- `helperFrame.HelperFrameSpec` += optional `effort`; `generateGuidance` clones the helper config with that effort when the model's reasoning is toggleable (per-call max-reasoning override — the pro card ships 'medium').
- `ToolProfile.resolveLiftPlan(env, cardLiftPlan?)` — gate `CORTEX_LIFT_PLAN` (card > env > false).
- `DecisionStore.SteeringEventKind` += `'lift_plan'` (mechanism-engagement event: {fired, planChars, retire, criteriaStated}).
- `effectiveConfig.ts` ledger += `CORTEX_LIFT_PLAN` (dark).
- `CortexOrchestrator.deliverLiftPlanAtLift(model)` + `liftPlanDelivered` one-shot flag; called at BOTH lift sites right after `deliverLiftNudge`. Awaits `generateTaskPlan` with `withTimeout` (`CORTEX_LIFT_PLAN_TIMEOUT_MS`) + fail-open; appends the plan as a `<system-reminder>` to the last tool_result; banks the `lift_plan` event.
- 🔴 **INTERACTIVE GATE (operator caveat):** the planner adds a ~30-60s silent pause (pro @ max). It fires ONLY in headless/one-shot/bench sessions (`autoApproveActions=true`, = `!(stdin.isTTY && stdout.isTTY)`); in an interactive TUI it is SUPPRESSED (a silent pause reads as a frozen UI) UNLESS `CORTEX_LIFT_PLAN_INTERACTIVE=true` (reserved for when a TUI thinking-indicator/spinner is wired). **FOLLOW-UP for interactive graduation: wire a status-line spinner / streaming "planning…" indicator before enabling it in the TUI.**
- **TUNED FROM THE 2026-09-04 EVAL:** effort=**max** (default; the eval's plan was excellent — criteria-anchored, adversarial, anti-self-test), budget=**4000** (🔴 max+1200 returned an EMPTY plan — reasoning consumed the whole budget; max+4000 = clean 2727-char plan), timeout=**90s** (max took ~54s once; ~12s another — variable). Validated end-to-end at DEFAULTS: non-empty 2774-char plan, effort override flows through generateGuidance.
- **New env vars:** `CORTEX_LIFT_PLAN` (gate, off), `CORTEX_LIFT_PLAN_EFFORT` (max), `CORTEX_LIFT_PLAN_BUDGET_TOKENS` (4000), `CORTEX_LIFT_PLAN_TIMEOUT_MS` (90000), `CORTEX_LIFT_PLAN_INTERACTIVE` (false). All in `.env.example` ledger.
- **Green:** tsc clean · 10/10 planner tests · orchestrator e2e 26/26 no-regression · core build clean. Gate off ⇒ byte-identical.
- **Fire-check PASSED + eval done (§6.3).** Remaining PRE-PUBLISH: add these envs to the harbor adapter env passthrough; then the combined dark release (6 fixes + this); then the treatment bench.

---

## 4. DEPENDENCIES — rides ON TOP of the 6 staged fixes
The experiment MUST run with the 6 staged fixes present, especially:
- **#2 wall-clock break** (`CORTEX_TURN_DEADLINE_MS`) — the **SAFETY FLOOR**. Arm it so that even if the
  planner fails to retire a grind, no task can run to the 1000-iter wall again (no repeat of the $109). Non-
  negotiable for this bench.
- **D-C** (strict `verified_how` grounding) — relevant if the EndTurn gate is on and shares the mentor's
  criteria list.
These are unpublished. ⇒ the planner build + the 6 fixes ship together, dark, in one publish (🟠 operator-
gated: `deploy-nexus-cortex.sh --release`).

---

## 5. EXPERIMENT — arms, sets, control, metrics

### 5.1 Arms
| Arm | Config | Purpose |
|---|---|---|
| **A (control)** | banked v4/v5 n=1 rows, `CORTEX_LIFT_PLAN` off | the baseline (same tasks, planner OFF) — NO new spend |
| **B (treatment v1)** | `CORTEX_LIFT_PLAN=true`, plain system-reminder delivery, turn-capped planner, `CORTEX_TURN_DEADLINE_MS` armed | the primary test |
| **C (treatment v2, optional 🟠)** | B + persistent TodoWrite (requires the re-surface wiring, §2.1) | measure whether a persistent plan + check-off signal beats plain injection |

Control is the **banked matrix with the lever OFF** (cortex-bench: a prior run with the lever off IS the
control) — so A costs nothing.

### 5.2 Treatment task sets (SIZED from the 2026-09-04 bucket mine)
- **Grind set (retire target — the DOMINANT class, 14/22 fails):** the wall-hitters marked
  `exc=["AgentTimeoutError"]` — enumerate the 14 from `criteria-misalignment-bucket.md` (known burners:
  make-mips-interpreter, install-windows-3.11, circuit-fibsqrt, schemelike-metacircular-eval,
  filter-js-from-html, dna-assembly, make-doom-for-mips, torch-pipeline-parallelism, raman-fitting, …).
- **Criteria-misaligned set (score-lift target — high-VALUE minority, 5–7):** `kv-store-grpc` (r1+r2,
  reproducible anchor), `filter-js-from-html`, `configure-git-webserver`, `pytorch-model-cli` (weak), +
  gray-zone `torch-pipeline-parallelism`, `raman-fitting` (co-occur with grind). Convertible near-misses ⇒
  each conversion is a direct pass gain.
- **Regression sample (guard):** ~10–15 easy/mid tasks that PASSED cleanly in v4/v5 (e.g. bn-fit) — the frame-
  tension check.
- **Held-out hard set (overfitting guard):** hard/grind-prone tasks NOT used to tune the planner prompt.

Note: `filter-js-from-html`, `torch-pipeline-parallelism`, `raman-fitting` appear in BOTH grind and misalign
sets (the modes co-occur) — evidence the mentor-planner (correct-criteria + retire-budget in one intervention)
targets both at once.

### 5.3 Metrics (per task, banked as rows) — reframed after sizing
- **PRIMARY (reliable): Retire/cost** on the grind set (dominant, 14/22) — tokens, turns, wall-time to finish,
  and did it overrun (`exc=AgentTimeoutError`) or stop early with a best-effort submit? B should be ≪ A. This
  is where the mass of the failure is.
- **SECONDARY (high-value): Score-lift** — pass-rate Δ on the criteria-misaligned set (5–7 convertible near-
  misses). Small count, but each conversion is a direct pass gain (5–7 = +5–9% flash). `kv-store-grpc` (both
  replicates) is the cleanest reproducible anchor to watch.
- **Regression:** pass-rate Δ + tokens/turns Δ on the regression sample (must be ~neutral; a drop = frame-
  tension realized).
- **🔴 Mechanism-engagement (MANDATORY, per B/C row — else null is uninterpretable,
  [[feedback-mechanism-engagement-evidence]]):** bank a `lift_plan` decision-store event (mirror the
  `effort_pulse` `recordEvent` at `:8654`) capturing: plan FIRED at lift (y/n), plan non-empty (y/n), criteria
  stated (y/n), retire-verdict (y/n), and a plan-follow proxy (did the model's subsequent actions reference the
  plan's named files/steps / for arm C, todos checked off). An arm that can't prove its treatment fired is a
  second control.

### 5.4 n and models
- Model: **flash first** (the 199M/78% grind tokens were flash; grinds worst there; cheapest to run).
- n=1 across the full treatment set (many tasks = the n for cross-task generality), then **n=2 on the movers**
  (tasks that flip or retire) to confirm signal ≠ nondeterminism (cortex-bench cardinal rule 1).
- pro only if flash shows signal (🟠).

---

## 6. SEQUENCE (ship-dark → validate-fires → bench)

### 6.1 PRE-STEP — quantify the criteria-misalignment bucket ✅ DONE 2026-09-04
Result (`scratchpad/criteria-misalignment-bucket.md`): of 22 flash fails, GRIND 14 / MISALIGN 5 (up to 7) /
OTHER 3. Grind is dominant ⇒ retire-cost is the PRIMARY metric, score-lift the high-value secondary (§5.3).
Grind marker = `exc=AgentTimeoutError` (no `turns=None` in this store).

### 6.2 BUILD (after §3 prereqs) → ship DARK
Build B behind `CORTEX_LIFT_PLAN` (default off). `tsc --noEmit` after every edit; scoped single-file vitest
only (never the full suite). Both stream + non-stream loops. Publish dark with the 6 fixes (🟠).

### 6.3 LIVE-SEEDED FIRE-CHECK ✅ DONE + PASSED 2026-09-04 (local, ~a few cents)
Drove a representative coding task (roman-numeral converter, real subtractive-edge criteria) with
`CORTEX_LIFT_PLAN=true` + DEBUG locally. Evidence:
- Server log: **`[LiftPlan] plan delivered at lift (2024 chars, retire=false, criteria=true)`** + `[Anchor]
  lifted at first tool_result boundary`.
- Decision store: `lift_plan` events banked `{fired:true, planChars:2260/2024, criteriaStated:true, retire:false}`
  (2 runs). The injection code executed (event banks AFTER the `content.push`, same try, real planChars — a
  throw would bank an `error` detail instead).
- **Negative control:** the run where the gate was NOT in the server env banked NO `lift_plan` event → dark
  gate confirmed byte-identical.
- The plan TEXT is not persisted/loggable (it appends AFTER the tool_result is recorded — correct: it mutates
  the in-memory history that builds the next request, not the stored copy; DEBUG_PAYLOAD logs a summarized
  body). To eyeball plan quality, use an isolated `generateTaskPlan` call, not a full task run.
- 🔴 **LAUNCH NUANCE (record for the bench):** the CLI `--env CORTEX_LIFT_PLAN=true` flag does NOT propagate a
  NEW var to the auto-spawned server — it must be in the PROCESS env (export it, or `.env`). ⇒ **the harbor
  adapter (`nexus_cortex_agent.py`) must add `CORTEX_LIFT_PLAN` (+ `_BUDGET_TOKENS`/`_TIMEOUT_MS`) to its env
  passthrough dict** (same place `CORTEX_TURN_DEADLINE_MS` was added), or the bench arm silently runs dark. ✅ DONE.

### 6.3b HOW EACH CHANGE REACHES THE BENCH CONTAINER — CONFIRMED at file:line 2026-09-04 (do NOT re-guess)
Two independent delivery paths — a change to one does NOT ride the other:
- 🟢 **The ADAPTER (`nexus_cortex_agent.py`, the lever passthrough) travels in the HF DATASET — it goes out on the
  next SEED, NOT on a worker deploy.** Confirmed: the sandbox Dockerfile only `RUN mkdir -p /app/bench` (empty
  dir — it does NOT bake the adapter in). `scripts/tb2-durable-supervisor.py` clones the HF dataset into the
  container (`HFDS="/app/bench/hfds"`, `git clone {GIT_URL} {HFDS}`) and `cp {HFDS}/nexus_cortex_agent.py
  /app/bench/` at run time — comment: "adapter travels in the Dataset". `seed-datasets.sh` copies the LOCAL
  adapter → the store at seed time. The worker JS (`src/index.ts`) only runs `harbor run -d <dataset>` — it
  passes a dataset NAME, never writes the adapter. ⇒ my adapter edit is already ready; the next `seed-datasets.sh`
  uploads it automatically. NO worker/container deploy needed for lever changes (that is the design's whole
  point — iterate levers without rebuilding the image).
- **The HARNESS CODE (fixes + planner) travels via npm** — `deploy-nexus-cortex.sh --release` publishes, then the
  container must get the new version (the sandbox Dockerfile pins a published version → bump the pin + rebuild the
  image via `ship-cortex-sandbox.sh` / the `nexus-cortex-sandbox` worker deploy). THIS is the path that needs a
  deploy action.
- ⇒ **Bench-readiness = (1) release the harness to npm + get it into the container image, (2) re-seed** (the seed
  carries the adapter with the `CORTEX_LIFT_PLAN` passthrough). Not "worker-deploy the adapter."

### 6.4 BENCH
Run arm B over the treatment sets, `CORTEX_TURN_DEADLINE_MS` armed, **budget cap armed**
(`scripts/tb2-budget-cap.sh <CAP> .bench/<run>`, 🟠 CAP e.g. $30–40 — far below the $109 disaster; the
wall-clock floor + retire should make it cheap). Reconcile vs the DeepSeek dashboard (banked gauge is a lower
bound; `usage_missing` flag marks unreliable rows). Provenance gate before launch
(`scripts/bench-config-provenance.sh`), --ack the dark lever knowingly.

### 6.5 ADJUDICATE + overfitting guard
Score-lift + retire + regression from the banked rows. Re-run the movers on the **held-out hard set** — a fix
tuned to the tasks that surfaced it is `fixed`, not `verified`, until it holds on tasks it never saw.

---

## 7. SUCCESS / KILL CRITERIA
- **Win:** criteria-misaligned pass-rate ↑ (score) AND/OR grind tokens ↓ substantially via early retire, with
  regression-sample pass-rate flat (±0) and no token/turn blowup on easy tasks. Mechanism-engagement proves
  the planner fired + was followed.
- **Kill (stop the bench):** budget cap hit; OR regression-sample pass-rate drops (frame-tension realized —
  the planner is taxing easy tasks); OR mechanism-engagement shows the plan fires but is ignored (plan-binding
  failure) — then the finding is "delivery/binding needs work," not "planning doesn't help."

## 8. RISKS
- **Frame-tension** — LARGELY mitigated (planning is on a different model instance; the main model never mode-
  switches) but MUST be measured on the regression sample, not assumed.
- **Plan-binding** — the real residual risk: low-compliance DeepSeek may ignore the injected plan. v1 measures
  it; arm C (persistent todo + check-off) is the escalation lever if v1 shows fire-but-ignore.
- **Mentor recon depth** — if v1 uses a snapshot (not a tool loop), the planner may miss env details a live
  scan would catch. Fork decided in §3.2.
- **Publish coupling** — the planner ships with 6 other unpublished fixes; a publish regression risk. Mitigate
  with the standard preflight ([[feedback-preflight-before-publish]]).

## 9. 🟠 OPEN OPERATOR DECISIONS
1. Publish the 6 staged fixes + the dark planner together, or fixes-first then planner in a second publish?
2. Model(s): flash-first (recommended) vs both.
3. Budget cap value for the treatment bench (recommend $30–40).
4. Include arm C (persistent TodoWrite, needs re-surface wiring) in this round, or defer to a follow-up?
5. Mentor recon: bounded tool-loop-in-container (faithful, heavier) vs orchestrator snapshot (lighter v1)?

---
*Grounded citations verified 2026-09-04 this session; re-verify each file:line before editing (line drift).
Reconstruction source: `scratchpad/k5-arc-reconstruction.md`. Resume: `memory/session-resume-2026-09-04.md`.*
