# Arm Persona Library

Named personas for auto-research arms (and any `best-of-n` tournament). Each file
is a self-contained persona the PM embeds into an arm's Task prompt — and each
persona's filename IS its **`strategy` label**: pass it on the dispatch
(`strategy: "precise"`, plus the suggested `temperature`) so every benchmark the
arm produces is recorded under that arm in the effectiveness matrix
(`getStrategyScores` / `recommendStrategy` then learn which personas win which
task types over time).

## How the PM uses this library

1. **Pick a diverse set** (3–5) whose angles genuinely differ for THIS deficiency —
   sharp distinctions beat near-duplicates. `recommendStrategy(taskType)` tells you
   the strongest proven arm; give it one slot and spend the rest on variety.
2. **Embed the persona body** in that arm's prompt, after the shared plan
   (metric, acceptance check, continue/fail rules — identical across arms).
3. **Dispatch with the matching labels**: `strategy` = the persona filename,
   `temperature` from the persona's suggested range (auto-clamped per model),
   `model` varied across arms for real decorrelation.
4. Every persona obeys the shared contract below — personas change the SEARCH,
   never the EVALUATION.

## The shared contract (all personas)

- The metric, acceptance check, and judge are FROZEN by the plan — a persona may
  not reinterpret or relax them.
- Work in YOUR assigned worktree only; commit your candidate; never merge.
- Report honestly in the structured format your persona defines — a failed
  attempt reported clearly is more valuable than a fake success.
- Fail fast: if your angle is exhausted or the target is unmeasurable from your
  side, say so and stop within budget.

## The personas

| File / `strategy` | Angle | Suggested temp |
|---|---|---|
| `precise` | Minimal, conservative, smallest-possible diff | 0.0–0.3 |
| `aggressive-refactor` | Fix the structure, not the symptom | 0.5–0.8 |
| `root-cause` | Diagnose fully before touching anything | 0.2–0.5 |
| `test-first` | Encode the bug as a failing test, then fix to green | 0.2–0.5 |
| `security-auditor` | Adversarial audit — findings, not fixes | 0.2–0.4 |
| `perf-hunter` | Measure first, optimize the proven hotspot only | 0.3–0.6 |
| `creative` | Divergent — question the framing, try the unconventional | 0.9–1.3 |
| `skeptic-reviewer` | Verification arm — refute the others' candidates | 0.1–0.3 |
