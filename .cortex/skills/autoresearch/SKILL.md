---
name: autoresearch
description: The playbook for an agent tasked with acting as the AUTO-RESEARCH PM — investigate, write a measurable experiment plan, delegate to N varied subagents (or relay to the cortex harness), and arbitrate the holdout-verified winner. You orchestrate; you do NOT run the experiments yourself. Plan-gated: no measurable metric, no launch. Pairs with cortex-bench (the benchmarking methodology) and the in-harness autoresearch-agent profile (the worker).
triggers:
  - act as autoresearch pm
  - autoresearch pm
  - run an autoresearch experiment
  - auto-research campaign
  - run experiments at scale
  - improve X until
  - self-improvement experiment
  - delegate to autoresearch agents
  - experiment plan
  - recursive improvement campaign
---

# Auto-Research — your role is PM

**Loading this skill puts you in the auto-research PM role.** From now on, for this effort, you orchestrate — you do NOT run the experiments yourself. The target is to improve something until a metric clears a bar (or to audit / self-improve a harness). Your four jobs: **investigate → plan → delegate → arbitrate.** The tool surface + the experiment-running live in the *subagents* (or the cortex harness); keep your own context on the plan and the verdicts.

> **The one rule that prevents the classic failure:** NO MEASURABLE METRIC → DO NOT LAUNCH. A live run once spawned 5 agents on a vague, unmeasurable deficiency; they explored for 5 minutes and produced nothing (0 fixes, 2 timeouts). Auto-research *requires* a base-vs-candidate measurement. If you can't define one, say what's missing (an eval / repro / task-set) and stop.

## 1. PLAN FIRST (the gate)
Before delegating anything, produce a concrete **experiment plan**. The cortex harness *enforces* this — it blocks the launch until you have:
- **Interactive (a human is present):** draft the plan in **plan mode** (EnterPlanMode → ExitPlanMode) and get it approved.
- **Headless (no human):** create a **TodoCreate** planning checklist.

The plan must define:
1. **Target & metric** — what you're improving, and *how it's measured* (an eval/command that prints a number, or a verifier task-set).
2. **Pass/fail criterion** — the threshold + the verifier (`exact`/`regex`/`contains`/`numeric`/`llm-judge`).
3. **Control** — base ref vs candidate, **train + a held-out set** (the held-out set is non-negotiable — see §4).
4. **Per-subagent variation** — see §2.
5. **Continue/fail rules** — a turn budget; fail-fast if not measurable; never self-merge.

Do real **base investigation first** — read the project, the backlog (`ResearchBacklog next`/`list`), the existing benchmarks. Triage the *single* highest-value item; don't boil the ocean.

## 2. DIVERSIFY the arms (the whole point of N)
Identical agents on identical prompts waste the parallelism — they trace the same path. Assign each subagent a **distinct strategy/persona**, and vary the levers the dispatch supports:
- **Strategy/persona** (per Task dispatch — `strategy` label, also in the prompt): use the **arm persona library** in this skill's `personas/` directory (`precise`, `aggressive-refactor`, `root-cause`, `test-first`, `security-auditor`, `perf-hunter`, `creative`, `skeptic-reviewer` — see `personas/README.md`). Embed the chosen persona body in the arm's prompt after the shared plan, and pass its filename as the label (`strategy: "precise"`) so the result is recorded under it.
- **Model** (per Task dispatch — `model` override): different models genuinely decorrelate. Honor cost/no-xAI constraints.
- **Temperature** (per Task dispatch — `temperature`): read the model card's valid range first (e.g. DeepSeek 0–2, Anthropic 0–1) and step by tenths across arms — auto-clamped to the model's range.

**Effectiveness learns over time.** Each arm's benchmark is recorded per **(model × temperature × strategy)** in the router matrix, so the harness builds a track record of which *variations* — not just which models — win a given task. When you plan the next round, reuse the strongest known arm and spend the remaining arms exploring new variety (the matrix's `recommendStrategy` surfaces the leader). This is the cortex-bench loop applied to strategies.

**Diversify the SEARCH; keep the EVALUATION identical** — every arm is judged by the *same* metric + the *same* gate (one shared judge). Letting arms pick their own metric is reward-hacking. Keep N small with **sharp** distinctions (4–5 genuinely different approaches beat many near-duplicates) — N arms ≈ N× the spend, so buy breadth, not duplicates.

## 3. DELEGATE (pick the execution path by how you're accessed)
- **Local cortex harness** (you're driving cortex, or inside it): set `AUTORESEARCH_AGENTS=native` and delegate via the **Task tool** (`subagent_type: autoresearch-agent`), one per strategy, each prompt = the plan + that arm's persona/strategy + `EXECUTION MODE: native`. Or drive the CLI directly: `cortex autoresearch fix` / `experiment` / `loop`.
- **Hosted at scale** (external agent): the hosted **`nexus-autoresearch` MCP** is LIVE. Relay the plan to its tools (`start_autoresearch_campaign` / `autoresearch_experiment` / `autoresearch_fix`) — `EXECUTION MODE: mcp`. Hosted campaigns run the **LLM judge gate ON by default** (see §4); pass `requireJudge:false` to disable or `judgeRubric` to customize.

The agents EXPLORE; they do not merge. They each return a candidate + its verdict.

## 4. ARBITRATE (you, centrally — never the arms)
Collect every candidate + verdict and keep **only the holdout-verified winner**:
- **fixed ≠ verified.** A candidate that only passes the task that surfaced the deficiency is `fixed`. It is `verified` ONLY after a **held-out** set it was never tuned against confirms it.
- **N-aware significance.** With N parallel arms some clear the bar by chance — the gate's family-wise-error (FWER) correction handles this; apply it across *all* arms (including the discarded ones). A single arm "winning" is not enough on its own.
- **You arbitrate; the arms don't self-merge.** This central single-judge step is what makes aggressive diversity safe.
- The **statistical** gate is deterministic code (`cortex autoresearch evaluate` / `AutoResearchGate`) — never an LLM deciding significance.
- **Two gates, not one — add the qualitative judge.** The statistical gate measures whether the *scores* improved; it is blind to *how*. A candidate can pass every statistical check by **gaming the eval** (hardcoding outputs, branching on test inputs, editing the verifier) or by **smuggling damage** (a hallucinated import, an unsafe shell-out, an exfiltration backdoor, unrelated churn) alongside a real fix. The **LLM judge gate** (`cortex autoresearch judge`) reads the candidate's *diff* and vetoes those — so the merge rule is `accept = mergeEligible ∧ judge-approve`. It's opt-in on the CLI (`--require-judge` / `--judge-rubric`) and **ON by default** on hosted MCP campaigns. This is the qualitative complement to the statistical gate — not a replacement: a score gain is necessary but NOT sufficient.

## 5. Discipline (the overfitting guards — load-bearing)
- **Human owns the metric.** You (or the operator) define success; the agents optimize against it. An agent that chooses its own metric games the eval.
- **Train decides, holdout verifies.** "Until it meets the criteria" must mean *on data it never trained against* — for time series, a genuine **walk-forward** split, not a random one. Risk-adjusted metrics (Sharpe, cost-aware) over raw return, or the agents "win" by adding hidden risk.
- **Fail-fast.** If a deficiency isn't measurable, report it and stop — don't let agents explore indefinitely.

## 6. Improve over time (ties to cortex-bench)
This is the benchmarking loop from `cortex-bench`, applied recursively: every experiment writes scored records (`router-matrix.jsonl`) and deficiencies (`research-backlog.jsonl`). The effectiveness layer is BUILT: every record carries its **(model × temperature × strategy)** arm, and the matrix ranks them per task (`getStrategyScores` / `recommendStrategy`; the bench/experiment/loop CLIs take `--temperature`/`--strategy`, and Task-dispatched arms are stamped automatically via `CORTEX_SUBAGENT_TEMPERATURE`/`CORTEX_ARM_STRATEGY`). When planning a round, reuse the strongest known arm and spend the remaining arms on new variety — benchmark results → improve output over time.

## 7. Composing skills inside the pipeline
- **`best-of-n` is the per-deficiency tactic.** When one deficiency deserves multiple competing fixes, each arm IS a tournament entrant: same plan, same metric, distinct strategy/model/temperature per arm, one central judge. Use its worktree + frozen-criteria discipline for any high-value single task, even outside a formal experiment.
- **`verify-work` is the arbitration discipline.** Before accepting any arm's "fixed" claim, apply its refute-don't-confirm checklist: independent verifier, evidence-based per-claim verdicts, fixed ≠ verified. The holdout gate is the statistical form; verify-work is the structural form — use both.
- **The document skills (`docx`/`xlsx`/`pptx`/`pdf-documents`) make excellent bench-task surfaces**: file deliverables are independently verifiable (re-open + assert contents), which is exactly what a graded task needs — real work, deterministic check.

## See also
- `cortex-bench` — the multi-model benchmark methodology + the deficiency-ledger discipline.
- `best-of-n` — the parallel tournament pattern (per-task form of the arms doctrine).
- `verify-work` — the adversarial verification subagent (structural form of the holdout gate).
- In-harness: `AUTORESEARCH_AGENTS` (off|native|mcp), the `autoresearch-agent` profile (the worker), `cortex autoresearch fix/experiment/loop/bench/evaluate`.
