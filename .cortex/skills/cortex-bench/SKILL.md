---
name: cortex-bench
description: Multi-model parallel benchmark methodology for finding harness deficiencies and driving autoresearch-style recursive self-improvement of the CORTEX harness itself. Cross-provider comparison with ground-truth control. EVERY run must produce a deficiency ledger; experiments are git-worktree-isolated; visual/TUI output is evaluated via tmux capture; NEVER use model='auto' routing when benchmarking models.
triggers:
  - benchmark
  - multi-model
  - cross-provider
  - harness audit
  - recursive improvement
  - recursive self-improvement
  - auto-research
  - autoresearch
  - compare models
  - ground truth
  - cortex bench
  - parallel benchmark
  - find harness bugs
  - git worktree
  - tmux capture
  - tui evaluation
  - frontend design
---

# Cortex-Bench — Multi-Model Benchmark Methodology

Cross-provider benchmark technique for auditing the CORTEX harness and driving recursive iterative self-improvement. The core insight: **many apparent "model quality gaps" between providers are harness-side bugs, not model-side**. Only a side-by-side comparison catches them.

Proven to surface 7+ classes of harness bugs (the running deficiency trail lives in your `.cortex/bench/` ledgers + `research-backlog.jsonl`).

> ## ⚑ THREE NON-NEGOTIABLE OPERATING RULES (read before any benchmark)
>
> 1. **Every benchmark must produce a DEFICIENCY LEDGER, not a pass/fail.** Any agent benchmarking in the CORTEX harness runs tasks *in order to find and fix what's wrong with the harness*. The deliverable of every run is a structured list of (a) harness deficiencies found + their fix, (b) model-disposition gaps to address via prompts/tool-defs/system-msgs, and (c) what was verified clean. A run that ends "all arms agree, looks good" is a wasted run — the task wasn't hard enough or wasn't real-work. Mine every run for deltas.
>
> 2. **NEVER use `model='auto'` / the model router when benchmarking models.** Benchmarking *measures a specific model*, so you must PIN it (`cortex -m <model>` / `Task model='<exact-id>'`). `'auto'` routes to a possibly-different model per task type, silently swapping the variable you're measuring and destroying the comparison. Worse, the router *learns from these runs* (`MODEL_ROUTER_RECORD`), so an auto-routed benchmark poisons the matrix with mislabeled data. The router is for production dispatch; the bench is for controlled measurement. Keep them apart.
>
> 3. **The eval is sacred — never game it.** The ground-truth control + the verifiable task is the fixed measuring stick (the `prepare.py` of this system). You may change the *harness*; you may never weaken the *check* to make a model/harness "pass." If a fix only passes by relaxing the verification, it's not a fix.

## The Core Methodology

```
Same exact prompt
    ├── Arm 1: CORTEX via model A (e.g., deepseek-v4-pro, Chat Completions API)
    ├── Arm 2: CORTEX via model B (e.g., claude-sonnet-4-6, Messages API)
    ├── Arm 3: CORTEX via model C (e.g., gemini-2.5-flash, GenerateContent API)
    ├── Arm 4+: More models covering more adapter paths
    └── Control: Claude Code native sub-agent (Opus) — the ground-truth reference

                   ↓

  Compare all arms side-by-side across:
    - Correctness vs control
    - Tool call counts (thrashing?)
    - Empty/dropped content
    - Duplicate blocks
    - 400 errors in server logs
    - Cache hit rates
    - Latency and cost

                   ↓

  Discrepancies → harness bugs OR model disposition differences
  Harness bugs → fix → harness improves → re-benchmark
  Model differences → document → improve prompts/tool defs/system msgs
```

## Cardinal Rules (learned the hard way)

1. **n ≥ 2, different tasks.** One task agreeing three ways is a false positive. Run at least two different tasks in fresh sessions.
2. **Ground-truth against the real artifact, not an agent.** The parallel sub-agent is a reference that fails differently, not an oracle. The only truth is direct shell/grep/python on actual files. **Existence/resolution claims need a behavioral probe**: an agent asserting "X is registered / X resolves / the alias works" must demonstrate it (run the lookup, hit the endpoint) — in a live audit, 2 of 6 agents asserted a nonexistent alias from a comment they'd read, and only the probe refuted it (which then exposed a real bug).
3. **Fresh server + fresh session per model probe.** `--new` on every prompt; restart the server between models. Prompt cache and debug logs bleed across models.
4. **Discard confounded runs.** After every run: `grep -nE "429|capacity|exhausted|rate.?limit|overloaded|quota" /tmp/cortex-server.log`. If it hits, the model was throttled, not benchmarked. Throw it away.
5. **Real work surface, not toy prompts.** The task must (a) move the harness/platform forward AND (b) have an independently verifiable answer. "Count imports in file X" is verifiable but worthless; "refactor module Z" is real but unverifiable. Find tasks that are BOTH.
6. **Pin the model — never `auto`.** See operating rule #2. When the variable under test IS the model, routing must be off and the model explicit. Auto-routing during a model benchmark is a methodology error that also corrupts the router matrix.
7. **Output is a deficiency ledger.** See operating rule #1. End every run by writing the findings to `.cortex/bench/<round>-<tag>.md` AND appending durable harness deficiencies to the `ResearchBacklog` (`.cortex/research-backlog.jsonl`). No ledger → the run didn't happen.

## Server Setup for Benchmarking

```bash
# Kill old server (match REAL argv — "node dist/index.js" not the full path)
pkill -9 -f "node dist/index.js" 2>/dev/null; sleep 2
ps -eo pid,args | grep "[d]ist/index.js" && echo "ZOMBIE — kill -9" || echo "clean"

# Start stateless (CRITICAL — persistent mode leaks context across probes)
cd packages/server && \
  DEBUG=true \
  MENTORSHIP_ENABLED=false \
  ENABLE_SERVER_SIDE_TOOLS=true \
  XAI_API_MODE=messages \
  CORTEX_MODE=stateless \
  setsid nohup node dist/index.js > /tmp/cortex-server.log 2>&1 < /dev/null &

# Poll for boot (~20s cold, not 5s)
for i in $(seq 1 30); do sleep 2; curl -sf http://localhost:4000/health >/dev/null && break; done

# Verify isolation: two identical probes must give DIFFERENT conversationId, SAME inputTokens
curl -s http://localhost:4000/v1/messages -H "Content-Type: application/json" \
  -d '{"model":"deepseek-v4-pro","messages":[{"role":"user","content":"say hi"}],"max_tokens":50}' | python3 -c "import json,sys; r=json.load(sys.stdin); print(r.get('metadata',{}).get('conversationId','MISSING')[:8])"
```

## The Prompt Template

Craft a task that is:
- **Deterministic**: file contents, code patterns, counts — anything verifiable
- **Multi-step**: forces 3-15 tool calls (exercises tool loop, budget signals, error recovery)
- **Specific**: asks for exact line numbers, code quotes, structured output

Counter-examples (don't use): web content (varies by time), creative writing (no ground truth), single-file reads (too simple, bypasses loop).

## Running the Benchmark (Parallel Dispatch)

From within a Claude Code session, dispatch ALL arms in ONE message for true parallelism:

```
Task sub-agent 1: model=deepseek-v4-flash, prompt="[TASK TEXT]"
Task sub-agent 2: model=deepseek-v4-pro, prompt="[TASK TEXT]"  
Task sub-agent 3: model=claude-sonnet-4-6, prompt="[TASK TEXT]"
Task sub-agent 4: model=gemini-2.5-flash, prompt="[TASK TEXT]"
```

Or via the cortex CLI + Task agents mixed:
```bash
# In one bash call, launch cortex + Claude Code sub-agent concurrently:
cortex --new --quiet -m deepseek-v4-pro "[TASK]" &
# + Task agent with Opus as control
```

## The Comparison Table (copy this format)

| Metric | Arm A (model) | Arm B (model) | Arm C (model) | Control (Opus) | Verdict |
|--------|---------------|---------------|---------------|----------------|---------|
| Turns | | | | | |
| Tool calls | | | | | |
| Tool pattern | | | | | |
| File path | | | | | |
| Key answer 1 | | | | | |
| Key answer 2 | | | | | |
| Code blocks correct? | | | | | |
| Empty/dropped content? | | | | | |
| Errors? | | | | | |
| Duration | | | | | |

## Bug Patterns — What Each Discrepancy Means

| Symptom | Likely Harness Bug | Class |
|---------|-------------------|-------|
| Empty content / no text | Empty-response not retried (R18b), responses adapter wrong id field (R18c) | Adapter |
| Duplicate tool_use blocks | Streaming accumulator no dedup (R18a) | Streaming |
| 400 error in server log | Wrong param name for provider (R19/O-series), id prefix mismatch (R19e) | Adapter/Config |
| 404 on Responses path | Doubled endpoint (R27#1) | Routing |
| Model returns tool_use only, no text | Loop exits on tool-use-no-text (R29a) | Loop control |
| Model thrashing (15+ calls) | Wrong working directory (R44 ESM bug), budget signals too weak | Infrastructure |
| Cache hit rate flat ~0.5% | System prompt in moving user slot instead of stable system field (R28a-f) | Caching |
| Cross-turn model switch 400s | Cross-provider response_id leak (R20a) | State |
| All o-series models 400 | Missing max_completion_tokens param (R19) | Model card |
| Gemini multi-turn 400 | thoughtSignature stripped in canonical conversion (R19c/d) | Adapter |

## Performance Benchmarking Addendum

When comparing cost/latency (not just correctness), capture these fields from every `/v1/messages` response:

| Field | Why |
|-------|-----|
| `usage.inputTokens` | System message + history overhead |
| `usage.outputTokens` | Response size |
| `usage.cacheReadTokens` / `usage.cacheCreationTokens` | Cache effectiveness |
| `metadata.toolCallIterations` | Round-trips |
| Wall-clock (time the curl) | Latency |

**Caveats:**
- `usage.cost_in_usd_ticks` only exists on XAI Responses API path — don't compare cost from paths that don't emit it
- `usage.outputTokens` under-reported for Gemini and XAI Messages
- Fresh-session floor ≈ 16k input tokens (system messages + tool schemas)

## Recursive Auto-Research Self-Improvement (autoresearch-style)

The harness is now mature enough to **research and improve its own library, autonomously and recursively** — the same pattern as karpathy/autoresearch (an agent mutates code, runs a fixed eval, keeps-or-discards, repeats, indefinitely). Here the "model being trained" is **the CORTEX harness itself**, and the eval is this benchmark methodology.

### The autoresearch mapping (internalize this)

| autoresearch | this harness |
|---|---|
| `train.py` — the mutable code the agent edits | the harness source in `packages/` (NOT a single file → use git-worktree isolation, below) |
| `prepare.py` — fixed, read-only eval (the ground truth metric) | the cortex-bench task + ground-truth control. **Never modify the check to pass** (operating rule #3) |
| `program.md` — human-tuned instructions ("a super lightweight skill") | **THIS skill** + the system messages. The human iterates HERE; the agent iterates on the code |
| `val_bpb` — one comparable metric | the per-run score: correctness-vs-control + deficiency count + the perf fields (input/output tokens, cache hit rate, tool iterations, latency) |
| `results.tsv` — append-only experiment ledger | `.cortex/bench/<round>-<tag>.md` + `research-backlog.jsonl` + `router-matrix.jsonl` |
| keep/discard via `git reset` | merge the worktree if the re-bench improves + no regression; else drop the worktree |
| **simplicity criterion** | a harness fix that *deletes* code/complexity and still holds the benchmark is a top-tier win. Weigh complexity cost vs. improvement; reject ugly hacks for tiny gains |
| **NEVER STOP** (run until interrupted) | run round after round; do not pause to ask "should I continue?" — escalate task difficulty and keep mining (consistent with the operator's `execute, don't defer` rule) |

### The loop

```
0. SETUP: pick a round tag (e.g. r55-loopfix). Create an isolated worktree (below).
1. RUN BENCHMARK (multi-model, same task, models PINNED — no 'auto')
       ↓
2. COMPARE vs control → MINE the deficiency ledger (operating rule #1)
       ↓
3. CLASSIFY each finding:
   ├── Harness bug → FIX in the worktree (ONE coherent fix; scope-isolation prevents creep)
   ├── Model disposition difference → improve prompts / tool-defs / system msgs
   └── Genuine model error → log it; nothing to fix in the harness
       ↓
4. REBUILD (npm run build) + RE-RUN the SAME benchmark in the worktree
       ↓
5. DECIDE: improved AND no regression on prior rounds' tasks?
   ├── yes → merge worktree → main; append the deficiency + fix to the memory ledger
   └── no  → drop the worktree (cheap discard); log "discard" + why
       ↓
6. Pick the NEXT task (harder, exercises newly-fixed paths) → goto 1.  Until interrupted.
```

The harness converges: each round fixes bugs that masked real model differences, making the next round's comparisons cleaner. Eventually the only remaining discrepancies are genuine model-capability differences (addressed via prompting, not code).

### Git-worktree schema — use the native `WorkspaceManager` tool (this already exists)

autoresearch isolates by editing one file; we isolate by **one git worktree per experiment** — required here because (a) the harness is a whole monorepo, not one file, (b) **two agents share this working tree** (Claude Code + the CORTEX agent), so an in-place experimental edit corrupts the other's state, and (c) a failed experiment must be discardable in one command.

**Do NOT hand-roll raw `git worktree` — the harness ships the `WorkspaceManager` tool for exactly this** (the agent-team-workspace system, built 2026-02-13; there is even a "Git Worktree" *dispatch mode* = `WorkspaceManager` + team dispatch where each parallel agent gets its own worktree). Native CORTEX agents call the tool; it wraps the git mechanics:

| `WorkspaceManager` action | what it runs | returns |
|---|---|---|
| `create` | `git worktree add /tmp/workspace-{uuid} -b {branch} {baseBranch}` | `{ worktreePath, branch, baseBranch, repoPath }` |
| `status` | `git worktree list --porcelain` | `{ worktreeCount, worktrees: [{path,head,branch}] }` |
| `diff` | `git diff {baseBranch} -- .` | `{ changedFiles, fileCount, diffLines, diff }` |
| `cleanup` | remove the worktree | — |
| `clone` | `git clone --depth 50` external repo (+ optional worktree) | `{ cloneDir, worktreePath, branch, repo }` |

Experiment loop with the tool:
1. `WorkspaceManager create` (branch `cortex-exp/<round>`) → isolated `worktreePath`.
2. **build INSIDE that worktree** (`cd <worktreePath> && npm install && npm run build`) — each worktree is its own checkout with its own `dist/`; never share `dist/`.
3. run the experiment server on a **non-default port** (4100, 4101, …) so it doesn't collide with the operator's live :4000.
4. bench against the experiment port, mine deficiencies, apply **one** coherent fix, rebuild, re-bench. Use `WorkspaceManager diff` to review the experiment's full change set before deciding.
5. **KEEP** (improved + no regression) → merge the branch to main, then `WorkspaceManager cleanup`. **DISCARD** → `WorkspaceManager cleanup` + delete the branch (cheap revert — the autoresearch keep/discard step).

Rules: **one fix per worktree** (scope-isolation = autoresearch's single-file constraint); parallel experiments = multiple worktrees on different ports; the keep/discard decision is the only thing that touches `main`.

*(Direct shell equivalents, if you're driving without the tool — e.g. a Claude Code session: `git worktree add -b cortex-exp/<round> /tmp/cortex-exp-<round> <base>` → build → bench on :4100 → `git merge --no-ff` or `git worktree remove --force` + `git branch -D`.)*

### The deficiency backlog — auto-add via the `ResearchBacklog` tool

The deficiency ledger (operating rule #1) is now a **tracked, triaged task lifecycle**, not just prose. Every deficiency found → `ResearchBacklog` tool, `action:add` (auto-triages + computes priority on add). The harness identifies its own weaknesses, prioritizes them, and works the highest-priority one next.

- **Triage / priority** = `(severityWeight × impact × confidence) ÷ effort`. Low-confidence "deficiencies" (could be model noise) sink automatically — the triage-layer overfitting guard.
- **Lifecycle**: `open → triaged → in_progress → fixed → verified → closed` (+ `wont_fix`, `regressed`). `action:next` returns the top-priority open item — the recursion's "what to fix next."
- **OVERFITTING GUARD in the status model**: `action:fixed` = passes the task that *surfaced* it; `action:verified` = ALSO holds on **held-out** tasks. **Never `verified` without held-out confirmation** — `fixed` is not done.
- Store: `.cortex/research-backlog.jsonl` (append-only, two-agent safe). The matrix (`router-matrix.jsonl`) holds the *scores*; the backlog holds the *work items*; they share `harnessRef`/`taskFingerprint` provenance.

### Overfitting guards (the recursion's immune system)

Recursive self-improvement's failure mode is **gaming the eval** — the harness tuned to pass the benchmark tasks rather than genuinely improving. Guards, layered:
1. **Held-out split.** Mark validation runs `CORTEX_BENCH_HOLDOUT=true` (→ `split:'holdout'` on matrix records). **Keep/discard uses `train`; verification uses `holdout`.** A fix tuned against task T is only `verified` when it improves *other* tasks it never saw.
2. **`fixed` ≠ `verified`.** The backlog enforces it structurally — no held-out pass, no verification.
3. **Confidence-weighted triage.** Noise-suspect findings are deprioritized, not chased.
4. **n ≥ 2 + significance.** LLM benchmarks are noisy; a single-run delta is often noise. Never "keep" on a delta within run-to-run variance (cardinal rule #1).
5. **Rotate the task pool.** Don't re-use the same handful of tasks every round; a fixed eval set invites overfitting. Real-work-surface tasks (cardinal rule #5) + rotation keep the eval honest.
6. **Regression scan across a broad set**, not just the target task — a "fix" that helps T while quietly hurting U is a discard.

### External / official benchmarks (SWE-bench etc.) — same pipeline, different source

The pipeline is **benchmark-source-agnostic**: `BenchmarkRecord.benchmarkSource` (env `CORTEX_BENCH_SOURCE`, default `cortex-bench`) lets official benchmarks feed the SAME matrix + backlog. An external runner (e.g. SWE-bench) records under `benchmarkSource:'swebench'`, the instance id as `taskFingerprint`, and pass/score from *its* grader — then auto-adds deficiencies for instances the harness fails. So SWE-bench / aider-polyglot / terminal-bench become additional ground-truth lenses pinpointing harness weaknesses, scored on the same axes, gated by the same overfitting/held-out discipline. (External runs are *excellent* held-out sets — the harness was never tuned against them.)

### North-star: a public verifiable record (SpacetimeDB)

The three local append-only stores — `router-matrix.jsonl` (scores), `research-backlog.jsonl` (work items), and `experiments.jsonl` (keep/discard decisions) — are **deliberately shaped to map onto STDB tables**: each is an append-only event stream keyed by `(taskFingerprint, modelId, harnessRef)` / `deficiency id` / `experimentTag`. Promoting them to a SpacetimeDB module would give a **public, verifiable, tamper-evident record** of the harness's self-improvement — every score, deficiency, and keep/discard decision auditable with commit provenance. (That public-record module lives in a separate service; the JSONL schemas here are the local mirror that ports up.)

### The decision layer is BUILT — call it, don't hand-judge keep/discard

As of 2026-06-07 the keep/discard decision is a **statistically-gated, reproducible** pipeline in `@nexus-cortex/core` (commits `ab9eb0b37`·`f7fc7e5c2`·`ec0f47551`·`825ada395`·`adb927987`). Do NOT eyeball "score went up → keep" — that overfits a recursive loop. Use:
- **`evaluateAutoResearchExperiment(matrix, ledger, input)`** — runs regressionScan → opens the ledger record → the Monte-Carlo gate → writes the audited verdict to `.cortex/experiments.jsonl`. `input = {experimentTag, baseRef, candidateRef, branch, deficiencyId?, benchmarkSource?, modelId?, nFamilyExperiments?, gate?, epsilon?}`. A 'keep' that introduced collateral regressions is flagged in the recorded reason.
- **`verifyOnHoldout(matrix, input)`** — the mandatory 2nd gate on `split='holdout'`; a candidate merges ONLY if kept-on-train AND verified-on-holdout (`fixed` ≠ `verified`; null = no held-out evidence = not mergeable).
- The gate = bootstrap CI (keep iff CI excludes 0) + permutation p-value + **N-aware FWER** (pass `nFamilyExperiments` = swarm width so the keep bar tightens with parallelism). Seeded RNG → **reproducible verdicts** (same records + seed = same p/CI), which is what makes the future STDB record publicly verifiable. Pure stats also exported: `decideExperiment`, `bootstrapCI`, `permutationPValue`, `sidakThreshold`, `mcFwerThreshold`.
- Optional **Thompson-sampling router** (`MODEL_ROUTER_EXPLORATION=true`) for explore/exploit so the matrix doesn't lock onto early winners. Off by default.

**Producing REAL scored records — `cortex autoresearch bench` (the grader).** The orchestrator's auto-record (`MODEL_ROUTER_RECORD`) writes only a liveness STUB (`qualitativeScore = hasText ? 75 : 0`) — useless for keep/discard (base ≈ candidate → always discard). To get real signal, run a graded task set:
```
cortex autoresearch bench --task-set <file|dir of *.json> --experiment-tag <id> \
  --runs 2 --split train|holdout [--harness-ref <sha>] [--model <id>]
```
Task = `{id, prompt, verifier, taskType?}`; verifier ∈ `exact|regex|contains|llm-judge`. **Prefer `contains` (partial credit → continuous score) or graded rubrics** over binary exact/regex — the bootstrap/permutation gate separates arms far better on continuous scores. Sample: `.cortex/bench/tasks/sample-tasks.json`. Run it in the base build and the candidate build (different `--harness-ref`/worktree), then `cortex autoresearch evaluate`. Keep holdout task FILES out of any fixing agent's context (overfitting guard).

**The one-shot runner — `cortex autoresearch experiment` (v4.7.0).** Does the whole single-experiment loop in one call (build+serve both arms → bench train+holdout → gate → `verifyOnHoldout` → teardown), so you don't orchestrate `bench`×2 + `evaluate` by hand:
```
cortex autoresearch experiment --experiment-tag <id> \
  --candidate-dir <worktree-with-fix> --base-dir <prebuilt base> \
  --task-set <train.json> [--holdout-set <holdout.json>] \
  --model <id> --runs 3 --n-family <swarm-width> --cortex-dir <per-exp dir> --json
```
`--json` → `{verdict, holdoutVerdict, regressedTasks, mergeEligible, benchSummaries, cortexDir, jsonlPaths}`. Owns the "two builds not one relabel" correctness (each arm served from its OWN built code; refuses `baseRef===candidateRef`). `--cortex-dir` is the per-experiment **artifact** (all 3 `.cortex/*.jsonl`). `mergeEligible` = keep ∧ fwerAdjusted ∧ holdout-keep (FALSE without holdout). Validated live end-to-end (both a real **discard** and a real **keep** with `mergeEligible:true`).

### Hard-won benchmarking gotchas (from the first live runs, 2026-06-08)
- **Server returns `model` as an OBJECT** `{id, provider}`, not a string — any recorder must extract `.id` (fixed in serverRunner/estimateCost, `a4097aaf8`).
- **`PROJECT_PATH`, not `PROJECT_ROOT`**, controls the orchestrator's project context (system messages, CORTEX.md, agents) — set it when spawning a harness for a specific checkout (fixed in startServer, `3f549daa5`).
- **System-message resolution is project → global → builtin.** A candidate that edits a **built-in/`dist`** system message is **shadowed by `~/.cortex` (global)** and has NO effect. To change harness behavior, override at the **PROJECT** level (`<dir>/.cortex/system-messages/` or `<dir>/.cortex/CORTEX.md`) — that wins over global. (System-message injection itself WORKS — confirmed ~72K chars incl. CORTEX.md reach the model.)
- **Markers/format tokens are an UNRELIABLE signal** — low-compliance models (e.g. deepseek-v4-flash) ignore a format rule buried in a 72K system prompt even when it's present. For a measurable base-vs-candidate signal, use a **high-compliance model** (e.g. `claude-haiku-4-5`) and a **strong directive** (e.g. "respond only with JSON `{\"answer\":…}`") with a verifier that checks it. That's what produced the clean keep proof.

### Model-selection discipline while benchmarking (no-xAI cost constraint)
Default sub-agent model is **deepseek** (`DEFAULT_SUBAGENT_MODEL=deepseek-v4-flash`; `recommend()` fallback is deepseek too — no grok/sonnet defaults). The auto-router (Thompson exploration) honors `MODEL_ROUTER_EXCLUDE` (default `grok*`, a prefix wildcard) so it can NEVER auto-route a sub-agent to an xAI model. This is a guardrail on *automatic* picks only — an **explicit** model choice (driver `DEFAULT_MODEL_ID`, `/model`, an agent profile's pinned model, or the Task tool's `model` param) is always honored, including xAI/expensive-Claude. When benchmarking specific models, name them explicitly and never rely on `'auto'` (per the deficiency-first rule above).

### Composing skills inside the loop
- **The FIX step can be a `best-of-n` tournament.** A high-value deficiency justifies N competing fixes instead of one: one worktree per entrant, distinct strategy/model/temperature per arm (pass `strategy`/`temperature` on the Task dispatch — recorded into the matrix), criteria frozen before launch, one central judge. The re-bench IS the tournament's acceptance check.
- **The VERIFY step is `verify-work`.** Before a keep decision, run its refute-don't-confirm checklist on the candidate: independent verifier that never saw the fix reasoning, evidence-based per-claim verdicts, blast-radius scan. The statistical gate (`evaluate`) and the structural verifier catch different failure modes — use both.
- **The document skills (`docx`/`xlsx`/`pptx`/`pdf-documents`) are ready-made bench-task surfaces.** "Produce a workbook with these computed columns / a deck with these sections" is real work with a deterministic verifier (re-open the file, assert contents) — exactly the real-work-surface + independently-verifiable pair that cardinal rule #5 demands, and a graded `contains`/`numeric` task-set can check the extracted content.

## Visual / TUI Evaluation via tmux (for CLI/TUI frontend-design benchmarks)

Most benchmarks compare JSON from `/v1/messages` — but that **cannot see what a human sees**. When the thing under test is *rendered output* — markdown formatting (tables, code fences, lists), the Ink TUI's layout, colors, alignment, spinners, wrapping, the thinking/tool-call panes — you must evaluate the **actual terminal render**, not the raw model text. A model can emit perfect markdown that the TUI then mangles; only a capture shows it.

**Use the native `TmuxSession` tool** (proven method — same one used during the earlier active-improvement rounds; it wraps `TmuxCapture.ts`/`TmuxManager.ts`, stores metadata in `.cortex/tmux-sessions/`, binary via `TMUX_BIN`). The tool exposes **create → send commands → capture output → list → kill**. The agentic flow:

1. `TmuxSession create` — a persistent session sized like a real terminal (e.g. 200×50; also test 80×24 — different widths expose different wrapping/overflow bugs).
2. `TmuxSession send` → from the repo root, launch the TUI (e.g. `neoncortex`, the Ink UI; or `cortex-cli`). Wait for boot.
3. `TmuxSession send` → the prompt that exercises the rendering under test (e.g. *"Show a markdown table of the 5 cheapest models with a fenced code example"*). Wait for the stream to finish.
4. `TmuxSession capture` — **this captured pane IS the metric.** It's the human-visible truth; the raw model text is NOT (a model can emit perfect markdown the TUI then mangles — only the capture shows it).
5. Evaluate the capture for **frontend-design deficiencies**, treating the render as a real UI surface (hierarchy, alignment, contrast, density — not just "did text appear"):
   - markdown table aligned / borders intact? code fence syntax-highlighted vs. raw backticks?
   - wrapping at the pane width, or overflow / truncation?
   - colors readable, spacing/padding sane, no doubled/garbled lines?
   - thinking & tool-call panes legible and not stealing the answer's space?
6. Fix the TUI renderer (in the TUI package, where installed), rebuild, **re-capture, diff before/after** — same keep/discard discipline as the code loop. `TmuxSession kill` when done.

*(Direct shell equivalent without the tool: `tmux new-session -d -s T -x 200 -y 50` → `tmux send-keys -t T '…' Enter` → `tmux capture-pane -p -e -t T > render.txt` (`-e` keeps ANSI color) → inspect → `tmux kill-session -t T`.)*

## Quick-Start (copy-paste into a session)

```
I need a multi-model benchmark. Pick a specific task:

TASK: "In this repo, find [specific file/function]. Report: (a) path,
(b) complete implementation, (c) [specific detail], (d) [edge case behavior].
Be precise, cite line numbers."

Dispatch arms:
- Arm A: model=deepseek-v4-pro, same prompt
- Arm B: model=claude-sonnet-4-6, same prompt  
- Arm C: model=claude-haiku-4-5, same prompt
- Control: I (Opus) will answer directly

Then compare all 4 answers side-by-side and report discrepancies.
```

## Location Reference

(paths are relative to the repo root)

- Server: `packages/server/dist/index.js`
- Server log: `/tmp/cortex-server.log`
- Bench results / deficiency ledgers: `.cortex/bench/`
- Routing matrix (the metric store): `.cortex/router-matrix.jsonl`
- Deficiency backlog (the work-item ledger): `.cortex/research-backlog.jsonl`
- **Worktree/team proven pattern:** the `WorkspaceManager` tool (core: `tools/definitions/`, executor: `executors/.../execution/`)
- **TUI capture proven pattern:** the `TmuxSession` tool, `TmuxCapture.ts` / `TmuxManager.ts`, sessions in `.cortex/tmux-sessions/`
- The project `CLAUDE.md` is the full tool & subsystem reference (tools like `TmuxSession`, `WorkspaceManager`, the adapter map, the registries).
- Auto-research inspiration: the "evolve code → fixed eval → keep/discard → repeat" loop — a fixed eval (`prepare.py` analog) ≙ the ground-truth control; the mutable code (`train.py` analog) ≙ the harness, worktree-isolated; this skill is the human-tuned `program.md` analog.
