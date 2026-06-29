# Auto-Research

`cortex autoresearch` is a recursive self-improvement engine. It runs controlled
experiments — a *base* harness/project version versus a *candidate* version — over a
fixed set of verifiable tasks, then puts the result through a **Monte-Carlo keep/discard
gate** with **held-out verification**. Only changes that beat the base by a
statistically real, generalizing margin are kept.

It is the decision layer on top of the `cortex-bench` methodology: bench grades real
outputs against task verifiers; the gate decides whether the candidate's apparent gain is
signal or noise. A raw `delta > 0` is *never* enough — a loop fed by raw deltas overfits
to noise, and avoiding exactly that is the reason this layer exists.

---

## 1. Overview

The engine is built from a few composable pieces:

- **bench** — runs a task set through a target, grades each output with the task's
  verifier, and writes scored records to `.cortex/router-matrix.jsonl`.
- **evaluate** — pulls the recorded base/candidate records and runs the keep/discard gate,
  writing an audited verdict to `.cortex/experiments.jsonl`.
- **experiment** — the full single lifecycle: build + serve both arms, bench train +
  holdout, gate, emit the verdict and a JSONL artifact.
- **loop** — the autonomous campaign: each round clones a throwaway worktree, lets a Fixer
  edit a candidate, benches base vs candidate, gates, and keeps the candidate on a
  dedicated loop branch only if it verifies.
- **list** — show recorded keep/discard decisions.

Records are append-only JSONL (concurrent-safe for agents sharing a tree). The decision
record schema (`ExperimentRecord` + `ExperimentTaskResult`) is flat-scalar by design so it
maps 1:1 onto downstream storage tables.

All commands accept the global `--json` flag for machine-readable output.

---

## 2. The CLI commands

### `cortex autoresearch bench`

Run + grade a task set through a target and write REAL scored records to
`.cortex/router-matrix.jsonl`. This is the grader; the gate needs these records before it
can decide anything.

Required:
- `--task-set <path>` — task-set JSON file, or a directory of `*.json` (prompt + verifier
  per task).
- `--experiment-tag <tag>` — experiment / swarm-member id.

Key options:
- `--runs <n>` — runs per task (default `2`; use `>= 2` for significance).
- `--split <train|holdout>` — which split this is (default `train`). Holdout never seeds
  the backlog.
- `--model <id>` — model to bench (default `$DEFAULT_MODEL_ID`). Pin it; never `auto`.
- `--harness-ref <ref>` — override the auto-stamped git SHA (lets one box simulate
  base/candidate).
- `--server-url <url>` — cortex server URL (default `$CORTEX_SERVER_URL` or
  `http://localhost:4000`).
- `--run-cmd <template>` / `--build-cmd <cmd>` / `--cwd <dir>` / `--accept-exit <codes>` —
  the non-cortex command-target path (see [Target modes](#5-target-modes)).
- `--temperature <n>` / `--strategy <label>` — effectiveness-arm labels recorded with each
  run so the matrix can rank (model x temperature x strategy).
- `--no-seed-backlog` — do not auto-seed a deficiency for each failing task (use for
  candidate-worktree benches so a not-yet-fixed task doesn't re-stamp the discovery
  record).

```bash
# Bench the base harness build (server already running on :4000)
cortex autoresearch bench \
  --task-set .cortex/bench/tasks/sample-tasks.json \
  --experiment-tag round-1 \
  --model deepseek-v4-flash \
  --runs 3 \
  --harness-ref base
```

### `cortex autoresearch evaluate`

Run the keep/discard gate over already-recorded base/candidate runs, writing the audited
verdict to `.cortex/experiments.jsonl`.

Required:
- `--experiment-tag <tag>` — experiment / swarm-member id.
- `--base <ref>` — base harness ref (control).
- `--candidate <ref>` — candidate harness ref (under test).
- `--branch <branch>` — worktree branch the experiment runs on.

Key options:
- `--model-id <id>` — restrict the comparison to one model (default: all pooled).
- `--n-family <n>` — parallel experiments in the family (the FWER N; default `1`).
- `--alpha <a>` — family-wise significance level (default `0.05`).
- `--seed <s>` — PRNG seed for a reproducible verdict.
- `--epsilon <e>` — regression dead-band on the 0-100 scale.
- `--min-runs <n>` — minimum runs per arm for a task to count.
- `--deficiency-id <id>` / `--benchmark-source <src>` — link to the backlog / label the
  benchmark lens.
- `--verify-holdout` — also run the held-out gate (a merge needs both).

```bash
cortex autoresearch evaluate \
  --experiment-tag round-1 \
  --base base --candidate cand-abc123 \
  --branch autoresearch/loop-abc123 \
  --n-family 4 --seed 42 --verify-holdout
```

### `cortex autoresearch experiment`

The full single experiment, end to end. Builds the candidate (and optionally the base),
serves each on its own isolated port, benches both arms (train + optional holdout) into
ONE shared `.cortex` store, runs the gate + held-out verification, and emits the verdict +
a JSONL artifact. This is the piece that guarantees "two builds, not one relabel": each
arm is served by a server built from its own code, so the comparison is real.

Required:
- `--experiment-tag <tag>` — experiment / swarm-member id.
- `--candidate-dir <path>` — checkout/worktree with the candidate fix (gets built +
  served).
- `--task-set <path>` — TRAIN task-set (file or dir); this drives keep/discard.

Key options:
- `--base-dir <path>` — base checkout (default: project root; assumed prebuilt unless
  `--build-base`).
- `--holdout-set <path>` — HOLDOUT task-set (separate file; required for a mergeable
  verdict).
- `--runs <n>` — runs per task per arm (default `2`).
- `--model <id>` — model both arms use (default `$DEFAULT_MODEL_ID`).
- `--n-family <n>` — parallel experiments this round (FWER width; default `1`).
- `--build-base` — also build the base dir; `--no-build` — skip the candidate build
  (config/env experiments where code is unchanged).
- `--base-port <n>` / `--candidate-port <n>` — server ports (default: auto free port).
- `--base-ref <ref>` / `--candidate-ref <ref>` — override the auto-stamped git short SHAs.
- `--cortex-dir <path>` — shared `.cortex` store + JSONL artifact dir (default: project
  root).
- `--seed <s>` / `--alpha <a>` / `--epsilon <e>` / `--min-runs <n>` — gate knobs.
- `--temperature <n>` / `--strategy <label>` — effectiveness-arm labels.
- `--run-cmd <template>` / `--build-cmd <cmd>` / `--accept-exit <codes>` — the non-cortex
  command-target path (see [Target modes](#5-target-modes)).

```bash
cortex autoresearch experiment \
  --experiment-tag exp-1 \
  --candidate-dir /tmp/cand-worktree \
  --task-set .cortex/bench/tasks/train.json \
  --holdout-set .cortex/bench/tasks/holdout.json \
  --runs 3 --model deepseek-v4-flash --seed 42
```

The verdict object carries `decision` (`keep`/`discard`/`pending`), `effect`, `ciLow`/
`ciHigh`, `pValue` vs `alphaAdjusted`, `holdoutVerdict`, and **`mergeEligible`** (true only
when kept + FWER-adjusted + holdout-verified).

### `cortex autoresearch fix`

Headless, autonomous coding-agent edit of a worktree. Runs the orchestrator in-process
with the real `Edit`/`Write`/`Bash` executors and `permissionMode: auto` (no approval
prompts), scoped to `--cwd`. It EDITS but does NOT commit — the caller (`loop`, or the
swarm Fixer) does `git add -A` + commit so the candidate ref differs from base.

Required:
- `--cwd <path>` — worktree to edit (the candidate checkout).

Key options:
- `--prompt <text>` or `--prompt-file <path>` — the fix instruction (deficiency
  description + repro + strategy). It MUST NOT contain task sets — that overfitting
  trip-wire is the caller's structural guarantee.
- `--model <id>` — coding model (default `$DEFAULT_MODEL_ID`, falling back to
  `deepseek-v4-flash`).
- `--max-iterations <n>` — max tool iterations.

```bash
cortex autoresearch fix \
  --cwd /tmp/cand-worktree \
  --prompt "Fix the tool-budget stall: computeToolBudgetSignal should return null when ..." \
  --model deepseek-v4-flash
```

### `cortex autoresearch judge`

The **LLM-as-judge qualitative gate** — the second, qualitative half of the merge
decision. The statistical gate (`experiment`/`evaluate`) answers *"is this a REAL
improvement?"* (effect size, CI, FWER, holdout). The judge answers the orthogonal
question the statistics cannot: *"is the change actually GOOD?"* — a real fix of the
cause, not an artifact that games the eval or smuggles in unsafe code. It reads the
candidate's `git diff` **read-only** (it never edits) and emits a structured verdict.

Required:
- `--base-ref <ref>` / `--candidate-ref <ref>` — the two refs to diff (both reachable
  from `--cwd`).

Key options:
- `--rubric <text>` or `--rubric-file <path>` — the scoring rubric. Defaults to a tuned
  anti-gaming / anti-unsafe rubric when omitted.
- `--mission <text>` — optional framing of what is being evaluated.
- `--cwd <path>` — repo/worktree the refs are reachable from (default: cwd).
- `--model <id>` — judge model (default `$DEFAULT_MODEL_ID`).
- `--max-diff-chars <n>` — cap the diff fed to the model (default `60000`).

`--json` emits `{ approve, score (0-100), confidence (0-1), rationale }`. Fail-closed: a
missing/garbled verdict or an error yields `approve:false` so a required judge never
passes blind.

```bash
cortex autoresearch judge \
  --cwd /tmp/cand-worktree --base-ref HEAD~1 --candidate-ref HEAD \
  --rubric "Approve only a minimal, correct fix; reject hardcoded outputs, hallucinated APIs, unsafe code." \
  --json
```

### `cortex autoresearch loop`

The autonomous campaign — the single-process, local analogue of an N-agent swarm. Pick a
goal, fix it in an isolated worktree, measure base vs candidate through the gate, KEEP
only what verifies, advance the base, repeat until a stop condition.

Required:
- `--repo <path>` — git repo to improve (worktrees are made off a dedicated loop branch;
  your branch is untouched).
- `--task-set <path>` — train task-set (file or dir).

Key options:
- `--holdout-set <path>` — holdout task-set. **Required for verified merges** — without it
  the loop accepts on train-only and logs the round as UNVERIFIED.
- `--prompt <goal>` — a fixed improvement directive each round (default: pull the
  highest-priority workable backlog deficiency).
- `--fixer-cmd <cmd>` — run THIS in the candidate worktree as the mutation step
  (`{prompt}` substituted) instead of the LLM Fixer.
- `--run-cmd <template>` / `--build-cmd <cmd>` / `--accept-exit <codes>` — non-cortex
  target (else build + serve a cortex server per arm).
- `--runs <n>` — bench runs per task per arm (default `3`).
- `--model <id>` — model for cortex targets / the LLM Fixer.
- `--max-rounds <n>` (default `10`) / `--max-stale <n>` — stop after N consecutive
  non-merge rounds.
- `--success-metric <taskId:threshold>` — stop early when the candidate mean score for
  `taskId` reaches the threshold.
- `--base-ref <ref>` — starting ref (default: repo HEAD).
- `--branch <name>` — loop branch name (default `autoresearch/loop-<sha>`).
- `--cortex-dir <path>` — shared `.cortex` store + artifacts (default: repo).
- `--temperature <n>` / `--strategy <label>` — effectiveness labels passed to each round's
  experiment.
- `--require-judge` — **opt-in qualitative gate.** After the statistical gate accepts a
  candidate, run `cortex autoresearch judge` on it and merge ONLY if it also approves
  (`accept = gate-accept ∧ judge-approve`). Default off.
- `--judge-rubric <text>` / `--judge-rubric-file <path>` — rubric for `--require-judge`
  (default: the tuned anti-gaming / anti-unsafe rubric).
- `--judge-model <id>` — judge model (default: `--model`, else `$DEFAULT_MODEL_ID`).
- `--keep-worktrees` — do not remove rejected candidate worktrees (debugging).

Each round:

1. **Goal** = `--prompt`, else the highest-priority workable backlog deficiency.
2. **Candidate worktree** detached at the current base ref.
3. **Mutate** it: `--fixer-cmd` (any transformer), else the LLM `cortex autoresearch fix`.
4. **Commit** the candidate (no change -> skip the round).
5. **Experiment** (`cortex autoresearch experiment`) base vs candidate -> read the verdict.
6. **Accept** = `mergeEligible` when a holdout is given (keep + FWER + holdout-verified);
   with no holdout, accept = keep-on-train (logged UNVERIFIED). **With `--require-judge`,
   a gate-accepted candidate must ALSO pass the judge** (`accept = gate-accept ∧
   judge-approve`) — the judge reads the diff and rejects eval-gaming / unsafe code the
   metric cannot see, fail-closed. On accept: advance base to the candidate and anchor the
   loop branch to it. On reject: drop the worktree.
7. **Stop** on: success metric met, max rounds, max consecutive stale rounds, or a dry
   backlog.

> **The hosted MCP turns the judge gate ON by default** (`start_autoresearch_campaign`
> defaults `requireJudge:true`); the CLI keeps it opt-in via `--require-judge`. See §8.

```bash
cortex autoresearch loop \
  --repo /path/to/project \
  --task-set ./tasks/train.json \
  --holdout-set ./tasks/holdout.json \
  --runs 3 --model deepseek-v4-flash \
  --max-rounds 8 --max-stale 3

# When satisfied, merge the loop branch yourself:
#   git -C /path/to/project merge autoresearch/loop-<sha>
```

### `cortex autoresearch list`

Show recorded keep/discard decisions from `.cortex/experiments.jsonl`.

- `--decision <keep|discard|pending>` — filter.

```bash
cortex autoresearch list --decision keep
```

---

## 3. Task-sets

A task-set is a JSON file (an array, or a single object), or a directory of `*.json`
files. Each task is a `{ id, prompt, verifier, taskType? }`:

```json
[
  {
    "id": "read-package-version",
    "taskType": "T1",
    "prompt": "Read the file packages/core/package.json in this repository and reply with ONLY the value of its \"version\" field, nothing else.",
    "verifier": { "type": "regex", "pattern": "\\b\\d+\\.\\d+\\.\\d+\\b" }
  },
  {
    "id": "budget-signal-recall",
    "taskType": "T1",
    "prompt": "Read packages/core/src/orchestrator/toolBudgetSignal.ts and answer precisely: (1) what condition makes computeToolBudgetSignal return null, (2) ... Cite exact identifiers.",
    "verifier": { "type": "contains", "all": ["softBudget", "stall", "null"], "caseInsensitive": true }
  },
  {
    "id": "registered-tool-count",
    "taskType": "T3",
    "prompt": "How many base tool executors are registered in packages/executors/src/ExecutorRegistry.ts? Reply with just the number.",
    "verifier": { "type": "regex", "pattern": "\\b(4[0-9]|50)\\b" }
  }
]
```

(Sample shipped at `.cortex/bench/tasks/sample-tasks.json`.)

### Verifier types

Each grades one output to a `qualitativeScore` in 0-100 and a pass/fail:

- **`exact`** — `{ type, expected, normalize? }`. Output (optionally whitespace-normalized)
  must equal `expected`. Score 100 or 0.
- **`regex`** — `{ type, pattern, flags? }`. The pattern must match somewhere in the
  output.
- **`contains`** — `{ type, all: string[], caseInsensitive? }`. Every string in `all` must
  appear; **partial credit** (`found / total x 100`). This is the workhorse — continuous
  scores give the bootstrap/permutation gate real signal to separate base from candidate.
- **`llm-judge`** — `{ type, rubric }`. Delegated to an injected judge function (network is
  not built into core).
- **`numeric`** — `{ type, direction: maximize|minimize, extract?, best?, worst?, target? }`.
  Extracts a number (`extract` regex capture group 1, else the last number in the output)
  and scores it. `best`/`worst` linearly map to 0-100; `target` sets the pass threshold.
  This is the continuous-metric path for non-cortex targets (ROI, latency, accuracy, tour
  length, ...). A crashed / non-numeric run scores 0 and seeds the backlog.

`taskType` (T1-T5) is optional; when omitted it is classified from the prompt.

### The rules (from the cortex-bench methodology)

- **No task-set / no measurable metric, no launch.** Every run must produce a deficiency
  ledger, not a pass/fail.
- **The eval is sacred — never weaken the verifier** to make a candidate "pass." You may
  change the harness; you may never relax the check. If a fix only passes by relaxing
  verification, it is not a fix.
- **Pin the model — never `auto`.** Benchmarking measures a specific model, so route to it
  explicitly. `auto` silently swaps the variable you are measuring and poisons the router
  matrix.
- **`n >= 2`, different tasks.** One task agreeing is a false positive; run at least two
  different tasks across `>= 2` runs each for significance.
- Each task's `taskFingerprint` is a hash of `prompt + verifier`, so it is the stable
  comparability key across base and candidate versions.

---

## 4. The Monte-Carlo gate

The gate (`decideExperiment`) turns the per-task base-vs-candidate run arrays into one
`keep`/`discard`/`pending` verdict. It runs four things:

1. **Bootstrap CI** — a percentile confidence interval on the aggregate effect (mean
   across tasks of `candMean - baseMean`), resampling runs within each arm of each task.
   Keep requires `ciLow > 0`.
2. **Permutation p-value** — a one-sided test for "candidate > base". Within each task it
   pools+reshuffles the two arms (the exchangeability null), recomputes the aggregate
   effect, and measures how often the permuted effect meets or beats the observed one.
   Add-one estimator (never returns exactly 0).
3. **FWER adjustment** — when `N` experiments run in parallel (a swarm), the keep bar is
   tightened to hold the family-wise error rate at `alpha`. A Monte-Carlo threshold
   (`mcFwerThreshold`) simulates the joint null of `N` experiments; the Sidak threshold
   `1 - (1 - alpha)^(1/N)` is the analytic fallback. This is the multiple-comparisons
   guard at swarm scale.
4. **Holdout verification** — `verifyOnHoldout` re-runs the same gate on `split='holdout'`
   records only.

**Decision rule:**

- **PENDING** if no task has `>= minRunsPerArm` (default 2) runs in both arms — not enough
  data.
- **KEEP** if `ciLow > 0` AND `pValue <= alphaAdjusted` (a real, significant gain).
- **DISCARD** otherwise.

**`mergeEligible` = keep (on train) AND `fwerAdjusted` AND holdout-verified.** A keep that
introduced task regressions is flagged in the reason so the loop does not silently merge
collateral damage.

### The judge gate (qualitative half)

The Monte-Carlo gate is **statistical** — it measures whether the candidate's *scores*
improved, generalizing to a holdout, beyond chance at swarm scale. It is structurally
blind to *how* the scores were obtained: a candidate can pass every statistical check by
**gaming the eval** (hardcoding expected outputs, branching on test inputs, editing the
verifier) or by smuggling in damage alongside a correct fix (a hallucinated import, an
unsafe shell-out, an exfiltration backdoor, unrelated churn). The numbers look great; the
diff does not.

The **judge gate** (`cortex autoresearch judge`) closes that hole. When `--require-judge`
is set (CLI) — or always, for hosted MCP campaigns — a candidate the statistical gate
already accepted is sent to an LLM that reads the **diff** read-only and renders a
qualitative verdict against a rubric. The merge decision becomes:

```
accept = mergeEligible  ∧  judge.approve          (require-judge on)
```

It can only **subtract** eligibility — it runs ONLY on already-accepted candidates and
never resurrects a discarded one — and it is **fail-closed** (a judge error or unparseable
verdict counts as not-approved). The default rubric is tuned for this job: a measurable,
holdout-verified gain is *necessary but not sufficient*; the judge approves only a real,
minimal, generalizing fix and rejects eval-gaming, hallucinated APIs, unsafe operations,
and scope creep. Verified end-to-end: a correct-but-malicious candidate (a real fix that
also adds a `child_process` exfiltration backdoor) passes the statistical gate with
`effect 100`, holdout-verified — and is still **rejected by the judge and not merged**.

### Overfitting guards (load-bearing)

- **Train decides, holdout verifies.** The keep/discard decision is computed from
  `split='train'` records *only*; holdout records are never the basis for keep/discard.
- **`fixed` != `verified`.** A candidate that was kept on train is only merge-eligible
  after it ALSO clears the held-out gate. A fix tuned to win the train eval will not
  generalize to held-out tasks it never saw — that is the structural defense.
- **No held-out evidence -> unverifiable -> not mergeable.** With no holdout records the
  holdout verdict is null and the candidate cannot merge.
- **Raw delta never keeps.** Only the Monte-Carlo gate (via `ExperimentLedger.decide`) can
  set a non-`pending` decision; a raw `delta > 0` must never set `keep`.

The audited record (`ExperimentRecord` in `.cortex/experiments.jsonl`) carries
`decision`, `pValue`, `ciLow`/`ciHigh`, `fwerAdjusted`, `nRuns`, the per-task `results`,
and the rationale — append-only, latest snapshot per `experimentTag` wins.

---

## 5. Target modes

Both `bench` and `experiment` (and `loop`) support two target kinds. The base/candidate
difference is always the worktree the run happens in.

### (a) Cortex-harness target (default)

Build + serve a cortex server per arm and POST each task prompt to its `/v1/messages`
endpoint. `experiment` builds each checkout, starts its server on an isolated free port,
health-checks it, benches both arms into one shared `.cortex` store, and tears the servers
down. This is the harness-code experiment path: base build vs candidate build, compared by
git SHA.

```bash
cortex autoresearch experiment \
  --experiment-tag harness-1 \
  --base-dir . --candidate-dir /tmp/cand \
  --task-set ./tasks/train.json --holdout-set ./tasks/holdout.json \
  --build-base --runs 3
```

### (b) `--run-cmd` non-cortex target

Grade an arbitrary shell command per task instead of building + serving a cortex server —
so you can improve ANY project (a library, CLI, test suite, backtest — anything with a
build + run + metric) through the same statistical gate.

- `--run-cmd <template>` — the per-task command; `{prompt}` / `{case}` are substituted (and
  single-quote-escaped, so a task prompt cannot inject shell syntax). If the template has
  no placeholder, the prompt is appended as a single quoted argument.
- `--build-cmd <cmd>` — a one-shot build run in the arm dir before benching.
- `--accept-exit <codes>` — comma list of exit codes whose stdout is graded (default `0`).
  A crashed run (non-accepted exit) yields empty output, so every verifier fails (score 0)
  and seeds the backlog. stderr and the exit code are surfaced via the log, never graded.

Pair `--run-cmd` with `numeric` verifiers that extract the metric from stdout.

```bash
cortex autoresearch experiment \
  --experiment-tag roi-1 \
  --base-dir . --candidate-dir /tmp/cand \
  --task-set ./tasks/backtest.json \
  --run-cmd "python eval.py --case {prompt}" \
  --build-cmd "pip install -e ." \
  --accept-exit 0
```

---

## 6. Models

- **`deepseek-v4-flash`** — the default (`$DEFAULT_MODEL_ID` fallback). Fast and cheap;
  the right default for both the Fixer and cortex-target arms.
- **`deepseek-v4-pro`** — the max-quality DeepSeek model for harder fixes / arms.

**xAI (Grok) models are rejected by the swarm** and excluded from auto-routing by default
(`MODEL_ROUTER_EXCLUDE` defaults to `grok*`). Use a non-xAI model for campaign members.
The exclude governs only auto-routing — an explicitly chosen model is always honored, but
for auto-research you should pin DeepSeek.

Always pin the model (`--model <id>`); never benchmark under `auto` routing.

---

## 7. GitHub safety

The loop and swarm are built so an autonomous campaign cannot damage your work:

- **All work is in throwaway worktrees** detached off a **dedicated loop branch**
  (`autoresearch/loop-*`). Your branch and working tree are never touched.
- **Accepted candidate commits are anchored** to the loop branch, so detached-HEAD
  commits survive worktree removal. Rejected worktrees are removed (unless
  `--keep-worktrees`).
- **The operator merges the loop branch** when satisfied — the loop never merges into your
  branch itself (`git -C <repo> merge autoresearch/loop-<sha>`).
- **Token handling (GitPolicy).** When a git auth token is used, it is injected into the
  subprocess environment as `GH_TOKEN` / `GITHUB_TOKEN` ONLY — never interpolated into
  argv or a clone URL. Repo/branch/PR inputs are always validated (regex + `execFile`, no
  shell), which closes the shell/argument-injection class.
- **Repo allow-list.** `GIT_ALLOWED_REPOS` (comma list of `owner/repo`, supports
  `owner/*` and `*`) restricts which repos git/PR actions may touch. Unset means "allow
  all" (so single-user setups keep working); multi-tenant deployments set it.

---

## 8. The hosted MCP (nexus-autoresearch)

The auto-research capabilities are also exposed as a **hosted MCP server** — the
`nexus-autoresearch` MCP — so external agents can drive the swarm without installing or
configuring the CLI. The heavy work (worktree builds, graded benchmarks, the Monte-Carlo
gate, holdout verification) runs in an executor container; the MCP tools queue jobs and
report verdicts (`autoresearch_experiment`, `autoresearch_fix`,
`start_autoresearch_campaign`, plus `autoresearch_status` / `autoresearch_result` /
`list_autoresearch_jobs`). It uses a credential-free model — point it at a public repo
(clone) or upload private source — and it returns the winning diff. The MCP's own usage
guide lives in the nexus-terminal repo; this document covers the CLI engine that backs it.

**Judge gate on hosted campaigns.** Unlike the CLI (where the judge is opt-in via
`--require-judge`), the hosted `start_autoresearch_campaign` turns the judge gate **ON by
default** — `requireJudge` defaults `true` with the tuned production rubric, so every
hosted campaign merges a candidate only when the statistical gate AND the judge approve.
Callers opt out with `requireJudge:false`, or override the criteria with `judgeRubric` /
`judgeModel`. The container installs the published CLI, so this maps directly onto
`cortex autoresearch loop --require-judge --judge-rubric …` inside the sandbox.
