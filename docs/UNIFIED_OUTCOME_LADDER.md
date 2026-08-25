# Unified Outcome Ladder — one failure semantics for every guard

*Proposal 2026-08-24, from the TB2 retry-loop root-cause analysis (harbor-bench skill) + distiller
evidence (11 loop-failures flash-lifted, 6 flash-persist, loops in all 4 arms on install-windows /
query-optimize). Status: IMPLEMENTED locally 2026-08-25 (toolOutcome.ts + loopLadder.ts + both orchestrator loops wired; 41 scoped tests + tsc green). Release deploy-gated.*

## The diagnosis in one line

Five systems each privately define "failure" and "repetition", and none agree — so a model
thrashing on failing bash commands is invisible to all of them until the $-expensive 1000-iteration
failsafe:

| System | Its private "failure" | Its private "repetition" | Why it missed the loops |
|---|---|---|---|
| MAX_CONSECUTIVE_ERRORS | `is_error` results | consecutive | bash exit!=0 returns a SUCCESS result (ShellTool.ts:258) |
| Decision store priors | `success: !is_error` | exact input hash | failing calls recorded as successes; no failures to remind on |
| Error-family lens (unreleased) | gated on `is_error` | normalized error snippet | same is_error gate → misses bash loops |
| MAX_LOOP_REPETITIONS | n/a | byte-identical name+inputHash | loops vary the command slightly each retry; and it BLUNT-KILLS the turn when it fires |
| TOOL_BUDGET_SOFT/HARD | n/a | n/a (count only) | pressure, not diagnosis |

## The fix: one OUTCOME layer, one ESCALATION ladder

### 1. `classifyToolOutcome(result)` — the single source of truth (new, core/training)

Every tool result is classified ONCE, immediately after execution, and every guard consumes the
same classification:

```ts
type ToolOutcome = {
  status: 'ok' | 'failed' | 'error';       // failed = ran but did not succeed
  // ok:    exitCode===0 (or no exit semantics and !is_error)
  // failed: metadata.exitCode!==0 | content matches failure signatures
  //         ("Command failed with exit code", verifier-reject patterns)
  // error: is_error (aborts, exceptions, timeouts)
  family?: string;        // classifyErrorFamily(content) — normalized failure fingerprint
  approachHash: string;   // NORMALIZED input hash (errorFamily-style: strip digits/paths/
                          // quoted strings from the command) — "same approach", not "same bytes"
  exactHash: string;      // current stableInputHash (kept for exact-match priors)
};
```

Key moves: exit-code truth comes from `metadata.exitCode` (already present in ShellTool results) —
the WIRE `is_error` is untouched (changing it changes model-visible behavior; out of scope).
`approachHash` reuses the errorFamily normalizer so "retry with a tweaked flag" collides with its
siblings.

### 2. Consumers all switch to the shared layer (small diffs each)

- **Decision store**: `success = outcome.status === 'ok'`; store `family` + `approachHash`
  alongside. Priors become TRUE priors. (One-line change in processToolTraining + schema add.)
- **Family lens**: fires on `status !== 'ok'` (not `is_error`) — un-gates the AHE borrow for the
  dominant real-world case.
- **Consecutive breaker**: counts consecutive `status !== 'ok'` per approachHash (not global
  is_error) — a genuine "this approach keeps failing" signal.
- **Loop detection**: matches on `approachHash` (near-duplicates collide) with the exact-hash
  detector retained at a lower threshold.

### 3. The escalation ladder (replaces independent blunt guards)

Per (toolName, approachHash), escalate — never jump straight to a kill:

| # failed repeats | action |
|---|---|
| 2 | **remind** — family reminder injected into the tool result ("this approach failed N times — change strategy"), now firing because outcomes are true |
| 4 | **diversify** — stronger steering: enumerate what was tried (from the store), require a different approach or a diagnostic step; under the narrow frame, point at the skills dir (`ls .cortex/skills` — the bash-native affordance; persist-served models' only path) |
| 6 | **break gracefully** — end the LOOP, not the turn: inject a final instruction to summarize state honestly and either attempt one different strategy or conclude with what is known. No silent `toolCallIteration = MAX` kill |
| MAX_TOOL_ITERATIONS | unchanged failsafe (recommend bench profile ~200, not 1000 — cost containment; the ladder should make it unreachable) |

All thresholds env-tunable (`LOOP_REMIND_AT`, `LOOP_DIVERSIFY_AT`, `LOOP_BREAK_AT`), defaults as
above; `MAX_LOOP_REPETITIONS` retained as the exact-match fast path.

### 4. Observability guarantee (adapter + harness)

- Adapter: incremental session persist — DONE 2026-08-25 (v6: 20s background copier; copy session.jsonl during the run, not only in the command
  tail) — timeouts stop being unobservable.
- Harness: on ladder escalation, emit a `loop_escalation` decision record (ts, tool, family,
  approachHash, step) — the distiller and autoresearch read these directly instead of inferring
  loops from trajectories.

## Why this is COHERENT, not just patched

- One definition of failure; every guard is a view over it. New guards inherit it for free.
- The ladder converts detection into TEACHING (remind → diversify) before enforcement (break) —
  aligned with the decision-store philosophy and the skills-affordance arc: a stuck model is first
  pointed at knowledge, then constrained.
- It composes with the persist-frame architecture: the diversify step's skills pointer is exactly
  the bash-reachable capability plane persist-served models need.
- Wire compatibility: no change to tool_result is_error semantics or schemas; risk contained to
  internal bookkeeping + injected reminders (already-shipped mechanism).

## Expected effect (from distiller evidence)

Targets the single largest failure mode: 17 loop-failures across the flash arms alone (11 lifted /
6 persist), loops present in all four arms (install-windows-3.11, query-optimize in 4/4). If even
half convert, that is +5-8 points of TB2 pass rate from harness changes only — plus large cost
savings (loops burned up to 1000 iterations at full budget).

## Verification plan (the gate — no self-graded wins)

1. TDD the outcome layer + ladder (unit: classification table, ladder transitions, normalizer
   collisions/non-collisions).
2. cortex-bench micro-suite: synthetic looping tasks (failing build, missing dep) — ladder fires,
   turn ends gracefully, decision records emitted.
3. TB2 A/B: loop-heavy subset + untouched holdout subset; judge reads the diff (no eval-gaming);
   compare (pass, cost, turns) triples. FWER-adjust if run as multiple arms.
4. Ship via the release train (deploy-gated: operator go on deploy-nexus-cortex.sh) together with
   the parked error-family + guardedPush commits.

## Relation to existing backlog
Subsumes: "identical-call hard breaker" + "error-family release" + half of "policy-friction"
(the $() denial class becomes a family the ladder teaches around). Leaves separate: prompt-mass
arms, skill-affordance clause (composes at the diversify step), incremental session persist
(bundled here as the observability guarantee).

## Micro-suite findings (2026-08-25, live probes vs local ladder-wired server)
1. **Specificity PASS**: a naturally-diversifying run (model escaped a forced pip loop by building a
   local wheel) triggered ZERO ladder signals — no false positives; clean synthesis at 12 turns.
2. **Normalizer defect FOUND+FIXED**: version-pin (`==2.1`) and flag (`--no-cache-dir`) variants
   produced distinct approach buckets → ladder never counted past 1. Fix: strip pin skeletons,
   option flags, and standalone number tokens in normalizeApproachText (tests added).
3. **🔴 EXIT-CODE MASKING (open, systemic)**: models routinely append `; echo "exit=$?"` or pipe to
   `tail` — the compound/pipe exit is 0, so failing commands classify `ok`, starving the ladder AND
   the decision store AND the family lens. Candidate fix: bench/server profile env
   `CORTEX_BASH_PIPEFAIL=1` (ShellTool prepends `set -o pipefail;`) + a conservative content
   signature tier for `ERROR:`-class tails when exitCode==0. NOT yet implemented — needs its own
   look (changing user command semantics is risky).
4. Model-behavior note: with true failure recording, full-prompt deepseek gave up HONESTLY at 3
   attempts on an impossible task ("I could not make this succeed, and I won't claim otherwise") —
   the narrow-door bench loops may partly reflect the missing doctrine mass, reinforcing the
   skill/doctrine-reachability arms.

5. **SENSITIVITY PASS (probe-4, post-normalizer-fix)**: forced same-bucket retries → count 2 fired
   diversify (model pivoted to diagnostics immediately after), count 3 fired BREAK (server log:
   "LoopLadder break"), turn ended in honest synthesis at 7 turns (backstop 15 never reached).
6. **Defect #4 FOUND (observability): injected signals are invisible in the session record** — the
   signals block mutates the in-memory tool_result AFTER historyStore.appendMessage persisted it, so
   the durable JSONL lacks the reminders the model actually saw. Distiller/canon blind to steering.
   Fix with §4's loop_escalation decision record AND/OR re-persist the mutated block.
   **FIXED 2026-08-25 (backlog item 3): DecisionStore event rows** — `recordEvent` appends
   kind-tagged rows (`loop_escalation`/`steering_injected`/`endturn_gate_fallback`/
   `inaction_nudge`) to decisions.jsonl, excluded from every prior-lookup path; both loops emit at
   every escalation rung and every post-persist signal injection. Session rows stay append-only.
   **Defect #3 (exit-masking) also mitigated**: `CORTEX_BASH_PIPEFAIL=true` (backlog item 4,
   bench/server profiles) — ShellTool wraps with `set -o pipefail`; the `; echo $?` class remains
   the documented residual.

**Micro-suite verdict: machinery VERIFIED (specificity + sensitivity), 4 defects surfaced
(normalizer + family-gate fixed; exit-masking + session-persist-ordering scoped).** Next gate rung:
TB2 loop-subset A/B with holdout + judge (post-release-train).
