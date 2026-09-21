# nexus-cortex harness — evidence note (DRAFT, 2026-09-20; cell g1 pending)

Audience: someone deciding whether to fund the next phase. Every number links to a public artifact (HF dataset per run, ledger file, or
STDB row); nothing here is a projection.

## 1. Headline: parity with the vendor and the independent reference on Terminal-Bench 2.1

| arm | pass@1 | evidence |
|---|---|---|
| nexus-cortex + DeepSeek V4.1 Flash, k=5 sequential full passes (89 tasks) | **77.3% ± 2.7** (pooled 344/445) | `docs/RESULTS_2026-09_TERMINAL_BENCH.md` §1; stores `tinkersnot/tb2-k5-n*-flash` |
| nexus-cortex + DeepSeek V4 Pro, action effort high (n=1) | **80.9%** (72/89) | same |
| DeepSeek's own harness (installed, sdk-minimal), Flash, same substrate (n=1) | 79.8% (71/89) | same |
| Artificial Analysis, Terminus 2 + V4 Pro, 3 repeats | 78.7% | independent reference |

Our Flash number sits on the vendor-harness band; our Pro number sits on the independent band. The harness does it with 1.75× fewer
turns and 2.4× less reasoning volume than the vendor harness, at ≈ $2.8 of tokens per full 89-task pass (off-peak Flash, warm cache).
Repeat-to-repeat spread on TB2.1 is ±2.7 points (32 of 89 tasks flip between passes), so single-run deltas under ~5 points are noise.

## 2. Terminal-Bench 4.0 (66 tasks, 8-hour budgets): a measured null on the steering-lever program

| run | pass@1 (of 66; 3 GPU tasks scored as fails) | evidence |
|---|---|---|
| 4.108.5 Flash, effort low | 16.7% (11) | `r-tb4-flash-v1-2026-09-12.md`, store `tb2-t4y-ctl` |
| 4.108.19 Flash, effort high | 21.2% (14) | `r-tb4-flash-v2-2026-09-14.md`, `tb2-t4z-ctl` |
| 4.108.21 repeat | 16.7% (11) → 18.2% (12) after the provider-incident patch cell | `r-tb4-flash-v3-2026-09-15.md`, `tb2-t4z2-ctl` / `tb2-t4p-ctl` |
| 4.119.1 full run, control vs the complete lever stack (62 executed) | **12/66 = 18.2% in BOTH arms** (7 flips each way, p = 1.00) | `r-tb4-full-f1-2026-09-18.md`, `tb2-t4f{ca,cb,sa,sb}-ctl` |
| reference: Terminus 2 + V4.1 Flash (Artificial Analysis, 3 repeats) | 26.8% | independent |

Nine levers were built and measured one at a time and then together (mentor effort, judge reasoning, investigate rounds, per-action
analysis/plan fields, action effort, meets-confirm, finish-confirm, evidence veto, lift-plan tool loop). Every lever demonstrably fired
(engagement evidence banked per arm) and none moved the pass count. That is a real result: the ~8.6-point gap to Terminus 2 on TB4.0 is
not in how the judge or planner *talks* to the action model.

## 3. What the corpus says the gap is (typed, not anecdotal)

A typed distill of the 100 failing f1 sessions (TypeSafe Jev, $0.011 for the whole corpus; `r-tb4-f1-curation-2026-09-19.md`):
- 83/100 failing sessions had their **own test passing** (self-authored evidence); 43/100 ended on an **unverified claim**;
- 96/100 **gave up early** — the median failing session used ~15% of an 8-hour budget;
- the finish judge **named the real defect** in a large share of these and was overridden: with shipped defaults a GAP verdict without a
  FAILED harness-run check is accepted "with gap", so the effective veto budget was 1 (code map 09-20, `endTurnResolver.ts` ~317-330);
- a 13-task pool where the judge named the defect, the defect was fixable, and the session gave up early is the cheapest upside in the data.

## 4. What was built on that diagnosis (4.120.0 → 4.123.0, 2026-09-20/21; cell g1 measured, cell g2 in flight)

- **R173 gap hold**: while ≥ 50% of the wall budget remains and the judge names open items, the items go back to the agent (up to the
  budgeted cap of 6 holds) — with or without a failed check.
- **R174 blind spec tests**: at the first finish, a separate call that sees only the task text and the environment writes up to 4
  read-only checks; the harness runs them at every finish; a failed one is objective evidence for the hold. This is the first evidence at
  the finish that is neither the agent's own test nor the judge's post-hoc reading of the solution.
- **R173b typed gate**: TypeSafe Jev's `fixable_with_more_turns` probability (zero output tokens, ~0.3 s) is wired into the hold
  (shadow mode first; gate mode later). First typed decision in the harness's control flow.
- Cell g1 (35 TB4.0 tasks = 29 ever-passed ∪ the 13-task pool, 3-hour budgets, one Vast VM per arm, $45 all-in): control 9/35, levers 11/35;
  paired both 5 / only-control 4 / only-levers 6. The count is inside one-repeat noise; the attribution is the evidence: every pass flip came
  from a hold with ≥ 66% of the budget left, three of the four were early give-ups the control arm accepted at 85–91% budget; one regression
  was a veto at 15% budget (a removable trigger), one a silent server death that hit both arms, two variance. Cost: +16% tokens, +34% median
  latency in the lever arm.
- 4.121.0 (from that attribution): a budget floor below which nothing holds the finish; a re-hold needs elapsed time; repeated identical spec
  failures become suspect rather than evidence; spec checks authored at lift instead of at the first finish.
- Cell g2 (the 4.121.0 levers on the same 35 tasks, control = the g1 control rows; 28/35 at 8 AM PT 09-21): the floor worked (no veto below
  25% in 28 sessions); the pure no-evidence hold repeated its flip on risk-scorer-replay (2 for 2 across cells); the lever arm sits at 5 vs 8
  on the 28 — the other g1 flips did not repeat and the losses have no lever trigger (a reasoning-exhaustion fallback, two slow sessions, a
  95/97 hidden-test miss). Two harness defects were grounded from the rows and shipped in 4.123.0: a classifier crash that ended a session in
  both cells (a `constructor` command head hit an object-prototype key), and the re-hold rule accepting rewritten judge text as progress.
- GPU cell (one 4090 VM, driver upgraded in-VM to 580, $7): the three never-attempted GPU tasks are now attempted — two fail on merit
  (jax-speedrun-gpu 7 h, math-eval-grader 1 h), one is still an environment DNF (fp8-rmsnorm-gemm needs CUDA 13.2 → driver 595, next);
  vpp-loss-divergence, which lost to verifier timeouts on CPU in 8 of 11 prior attempts, graded normally (4/5 tests) — the timeout class
  is an environment artifact, not a harness one.

## 5. Decision-model results (the reusable asset)

Paired evaluation on 262 real graded sessions (`jev-assessment-2026-09-18.md` §7; records public at `tinkersnot/jev-eval-2026-09-18`):

| model | done AUC | ECE | note |
|---|---|---|---|
| TypeSafe Jev (hosted, $0.042/M input, 0.34 s) | 0.716 | **0.056** | calibrated gate; on top of the LLM judge it removes 24 of 51 false accepts for 6 of 27 true |
| our Qwen3.5-4B logit readout (no training, $0.55 to run) | **0.728** | 0.291 | same ranking power, 5× worse calibration — the hosted model's edge is calibration, not discrimination |
| GLiNER 2.5 (zero-shot) | 0.55–0.59 | 0.09–0.33 | fine-tune base only |

Public write-up: "Jev vs LLM judge on 262 real agent sessions" (Claude Doc, 2026-09-20).

## 6. The data asset (closed 2026-09-20)

Every graded bench session now lands in the training lake and the STDB bench control plane: 210 run stores → 4,606 task results,
~4,300 outcome-labeled agent sessions plus one decision-trace row per session (true per-tool outcomes and judge verdicts, previously
dropped by the ETL). Failed sessions are weighted as negatives (DPO rejected side); the decision traces are label sources, never
imitation targets. New runs land automatically at adjudication (`.bench/lake-ingest-queue.txt` → daily ETL).

## 7. Cost discipline

Bench executor moved from Cloudflare containers ($40–110 per full run in container-hours) to Vast.ai VMs (≈ $0.7–1.5/h per 64-vCPU box);
a full TB4.0 run is now ≈ $52 host + ≈ $45 tokens for two arms; a 29–35-task cell ≈ $10 host + $8–16 tokens per arm. Boxes destroy
themselves at completion or TTL (self-reaper on the VM; survives a controller restart).

## 8. Ask (to be written once g1 lands)

_Interim (g2 at 28/35): the gap-hold/spec-test pair is a one-flip-per-cell effect on 35 tasks, not a full-66 candidate at ≈ $100; the reproducible piece is the early no-evidence hold. The next spend is the R176 independent-derivation cell (~$10) on the computed-answer class, then the Terminus-2 frame port decision. Earlier text: the g1 result decides whether the next spend is a full-66 confirmation of the gap-hold/spec-test pair (≈ $100) or a pivot to the
Terminus-2 frame port. Either way the decision-model and data-lake assets above stand._
