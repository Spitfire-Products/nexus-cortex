---
name: best-of-n
description: >
  Implement one task N ways in parallel and keep only the best candidate. Spawns
  N varied subagents (distinct strategy, model, temperature) in isolated git
  worktrees, judges every candidate against the SAME criteria, and applies only
  the winner. Use when asked to "best of n", "try multiple approaches", "parallel
  implementations", or when a task is high-value enough to buy N attempts.
metadata:
  short-description: "Parallel implementation tournament — diverse search, single judge"
  author: "nexus-cortex"
---

# Best-of-N — Parallel Implementation Tournament

One hard task, N independent attempts, one winner. This is the auto-research
arms doctrine applied to a single implementation task: **diversify the SEARCH,
unify the EVALUATION**. N identical agents waste the parallelism — the value
comes from genuinely different approaches judged by one fixed standard.

## When to use

- The task is high-value and the best approach is genuinely uncertain
  (architecture choices, tricky refactors, performance-sensitive code).
- The result is **verifiable**: there is a build, a test suite, a benchmark, or
  a concrete acceptance check. No verifiable outcome → do NOT run a tournament;
  ask for (or define) the acceptance criteria first.
- N× the cost is acceptable. Tournaments buy quality with spend — keep N small
  (3–5) with SHARP distinctions between arms.

## The workflow

1. **Define the judging criteria BEFORE spawning anything.** Write down: the
   acceptance check (command(s) that must pass), the quality dimensions you
   will compare (correctness, simplicity, performance, blast radius of the
   diff), and the tiebreaker. The criteria are frozen once arms launch — never
   weaken the check to make a candidate pass.

2. **Create one isolated worktree per arm** with the `WorkspaceManager` tool
   (`action: create`, branch per arm, e.g. `bon/<task>-1..N`). Isolation is
   mandatory: parallel agents editing one tree corrupt each other, and a losing
   candidate must be discardable in one `cleanup` call.

3. **Dispatch N subagents in ONE message** (parallel `Task` calls), each with:
   - the SAME task statement and the SAME acceptance check,
   - its own worktree path,
   - a DISTINCT angle: e.g. #1 minimal/conservative change, #2 aggressive
     refactor, #3 different algorithm/library, #4 performance-first,
     #5 high-creativity. Vary `model` and `temperature` per dispatch for real
     decorrelation, and pass a `strategy` label so effectiveness is recorded.
   - the instruction to build + run the acceptance check inside its own
     worktree and report the result honestly (a candidate that fails its own
     check disqualifies itself — that is signal, not failure).

4. **Judge centrally — you, not the arms.** Collect every candidate's diff
   (`WorkspaceManager diff`), its acceptance-check output, and its self-report.
   Score all candidates against the frozen criteria. Prefer the candidate that
   passes the check with the SIMPLEST diff; a solution that deletes complexity
   and still holds is a top-tier win. Arms never self-merge.

5. **Apply the winner, discard the rest.** Merge the winning branch (or apply
   its diff), then `WorkspaceManager cleanup` every worktree — losers cost one
   command to discard. Record what distinguished the winner; that observation
   improves your next tournament's arm design.

## Rules

- **No verifiable check → no tournament.** Judging N candidates by vibes
  multiplies cost without multiplying confidence.
- **The check is sacred.** You may improve candidates; you may never relax the
  acceptance criteria mid-tournament.
- **Sharp arms beat many arms.** 3 genuinely different approaches outperform
  7 near-duplicates at less than half the cost.
- **One winner.** If two candidates tie on the check, the simpler diff wins.
  If a hybrid is tempting, apply the winner first, then port the specific good
  idea from the runner-up as a separate, reviewed change.
