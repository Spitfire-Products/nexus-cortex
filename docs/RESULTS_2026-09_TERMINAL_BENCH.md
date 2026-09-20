# nexus-cortex on Terminal-Bench — results note (draft, 2026-09-12)

Harness: `nexus-cortex` 4.107.2 (npm; 4.107.3 = same config as default). Action model: DeepSeek V4.1-Flash (`deepseek-flash`, GA 2026-09-10)
unless stated; helper/mentor model `deepseek-flash` at reasoning `none`. Executor: Harbor (`harbor` CLI) on our own substrate, one fresh task
container per task, per-task `test.sh` graders from the dataset (no LLM judge). Every row, trajectory and grader artifact is banked to a public
HF dataset per run (`tinkersnot/tb2-*`); config is banked with every row (`effective_config`, source-attributed).

## 1. Terminal-Bench 2.1 (89 tasks, `terminal-bench/terminal-bench-2-1`)

| arm | runs | pass@1 | notes |
|---|---|---|---|
| nexus-cortex, flash | k=5 (5 sequential full passes) | **77.3% mean, sd 2.7 pts** (70/71/65/70/68 of 89; pooled 344/445, Wilson 73.2–81.0) | one fixed config; 49 tasks pass in all 5, 81 in ≥1, 8 never |
| nexus-cortex, V4 Pro @ action effort high | n=1 | **80.9%** (72/89, Wilson 71.5–87.7) | +3–4 over flash, CIs overlap |
| DeepSeek Harness (installed, sdk-minimal), flash | n=1 | 79.8% (71/89) | the vendor's own harness on the same substrate |
| nexus-cortex stripped to DSH conditions, flash | n=1 | 77.5% (69/89) | our layers are cost-neutral on aggregate |

Independent reference (Artificial Analysis, Terminus 2 harness, e2b, pass@1 over 3 repeats): DeepSeek V4 Pro 0813 = **78.7%**.
Our pro number sits on that band; our flash number sits on the vendor-harness band. DeepSeek's model-card claim of 90.6 for V4.1-Flash on TB2.1
(DSH minimal, N=3) is not reproduced by us (79.8 with their harness) nor by Artificial Analysis.

Cost triple (flash, warm prompt cache ≈ 98% hit): median 23 tool iterations, 350 s wall, 21K output tokens per task; ≈ $2.8 of tokens per full
89-task pass at DeepSeek's off-peak flash prices. Pro: median 32 iterations, 737 s, $12.8 per pass. (Container time is reported separately.)

What the harness does that the vendor harness does not: 1.75× fewer turns and 2.4× less reasoning volume for the same pass rate; 8 tasks DSH fails
that we always pass (cobol-modernization, configure-git-webserver, hf-model-inference, kv-store-grpc, mcmc-sampling-stan, pypi-server,
pytorch-model-recovery, winning-avg-corewars); 4 tasks DSH passes that we never do (dna-assembly, extract-elf, filter-js-from-html,
video-processing). Tool shape is not the difference: DSH used its editor tool in 0.6% of calls.


**2026-09-15 rerun on nexus-cortex 4.108.21 (R149–R151 + Bash doctrine edits), 89 tasks × 3 repeats × 2 arms, Vast VM executors, harbor 0.23.0,
dataset pinned to the same commit as the k=5 series:**

| arm | pass@1 over 3 repeats | Wilson 95% | tokens (as billed) | agent-hours |
|---|---|---|---|---|
| effort low | **76.4%** (204/267) | 71.0–81.1 | $9.82 | 47.1 |
| effort high | 74.9% (200/267) | 69.4–79.7 | $13.49 | 62.3 |

Paired on 267 task×repeat pairs: 24 flips favor high, 28 favor low, p = 0.68. Effort is a null on TB2.1 and costs 37% more tokens, so
effort low is the TB2.1 configuration. Both arms sit on the earlier k=5 band (77.3 ± 2.7) — the 4.108.21 changes, which target 8-hour
behavior, neither moved nor hurt TB2.1. Disclosures: the high arm ran on a 7-vCPU VM against 15 for low; a 27-minute DeepSeek incident
returned null completion bodies to 23 of the 534 sessions, which the harness of the day ended as fails (fixed in 4.108.22, not re-scored).
Ledger: `.cortex/bench/r-tb21-a21-2026-09-15.md`.

## 2. Terminal-Bench 4.0 (66 tasks, `terminal-bench/terminal-bench`, 8-hour agent budgets)

| arm | runs | pass@1 | notes |
|---|---|---|---|
| nexus-cortex 4.108.5, flash | n=1 (63 tasks executed, 3 GPU tasks scored as fails) | **16.7%** (11/66, Wilson 9.6–27.4; 11/63 = 17.5% on the executed set) | Science 4/14, ML 2/11, Media 1/4, Software 4/18, Hardware 0/5, Operations 0/9, Security 0/5 |
| nexus-cortex 4.108.19, flash, action effort high | n=1 (same 63 executed, 3 GPU as fails) | **21.2%** (14/66, Wilson 13.1–32.5; 14/63 = 22.2% on the executed set) | Software 8/18, ML 2/11, Media 1/4, Science 1/14, Operations 1/9, Security 1/5, Hardware 0/5 |

Independent reference (Artificial Analysis, Terminus 2 harness, all 66 tasks, pass@1 over 3 repeats): V4.1 Flash **26.8**, V4 Pro 14.1,
GPT-6 Astra 59.6, Claude Fable 5.1 (xhigh) 55.1. Our point sits ~10 points under the AA flash number (about 1.5 SE at n=1 on 66 tasks) —
not parity, and unlike TB2.1 (§1) where our harness matched the vendor's and the independent band. TB4.0's multi-hour, 100–350-iteration
tasks are where this harness + flash trails Terminus 2 + flash.

Cost triple: **$13.50 of tokens** for the 63 rows (off-peak flash, 99.4% prompt-cache hit; median 107 tool iterations / 33 min wall / 185K
output tokens per task; 55 h of agent time on 8 lanes over ~14 h of wall) + **$4.29 of host** (one Vast.ai 24-vCPU VM at $0.24/h for its
whole 17.8-h life, ≈$3.4 for the run window) — versus the $40–110 of container-hours a full run cost on the previous substrate. DeepSeek's
dashboard reconciles to $16.1 including unbanked diagnostic runs (accounting under-count 16%, attributed in the ledger).

Passes: atrx-vep-crispr, coq-block-bound, cumulative-layout-shift, layout-config-recreation2, mp-checkpoint-consolidation,
photonic-waveguide-routing, protein-autointerp-disulfide, react-lead-form, sglang-qwen-burst, telecom-entity-resolution, wdm-design (6.8 h,
the longest agent phase; nothing hit the 8-h wall).

Compaction-resume field read (4.108.5): 11 compaction events in 3 of 62 sessions; every proactive compaction carried the pinned task, a
covering checkpoint memory and the workspace-state block. Grounded defect found: the token estimator that triggers it over-reads the request
by ~5–7× (fired at "760K–1.0M" where the API reported ≤152K prompt tokens), so it engages far earlier than needed (R132, open).

Store: `tinkersnot/tb2-t4y-ctl` (rows, trajectories, grader output, the adapter + supervisor). Ledger: `.cortex/bench/r-tb4-flash-v1-2026-09-12.md`.

Rerun (09-13/14, `tinkersnot/tb2-t4z-ctl`, ledger `.cortex/bench/r-tb4-flash-v2-2026-09-14.md`): same population and rig on
nexus-cortex 4.108.19 with the action model at effort high and a 600 s outer tool-timeout floor: **14/66 = 21.2%**, 0 errored rows.
Paired against the 4.108.5/low run on the same 63 tasks: 7 pass both, 7 pass only at high, 4 pass only at low (exact binomial p ≈ 0.55 —
not significant at n=1). Tokens $24.83 (+26% at equal rate tier: output +32%, thinking +38%), host $2.42, 9.9 h wall on 8 lanes. The
reference V4.1 Flash 26.8 now sits inside our interval. Three deltas moved at once (harness, effort, timeout floor), so the +3 is not
attributable to effort alone; the next spend should be repeats of this configuration, not another lever.

Post-run fixes (4.108.20, same day): the rerun's log sweep found two harness defects — a transport-fault class (`Connection error.` /
`terminated`) that was not retried and ended three lanes during one two-minute API blip (R150), and a compaction estimator that counted base64
images as text and fired three false compactions (R149). Both fixed and released; a 7-task retest on 4.108.20 (`tinkersnot/tb2-t4r-ctl`)
confirmed zero false compactions on the three image sessions and clean full-budget agent phases on every lane the blip had killed. Ledger:
`.cortex/bench/r-tb4-flash-v2-2026-09-14.md` §10.

Second repeat (09-15, `tinkersnot/tb2-t4z2-ctl`, ledger `.cortex/bench/r-tb4-flash-v3-2026-09-15.md`): same configuration on nexus-cortex
4.108.21 (R149–R151 + Bash doctrine edits): **11/66 = 16.7%** (Wilson 9.6–27.4), 0 errored rows. Paired against the 4.108.19 run: 4 pass
both, 7 only here, 10 only there (p = 0.63). Two repeats of the high configuration give a mean of 18.9% pass@1, 4/66 stable, 21/66 ever
passed. Tokens $26 as billed (+29% at equal rate for the same pass count), host ~$1.30. Seven sessions were ended by a 27-minute provider
incident (null completion bodies, fixed as R152 in 4.108.22), two of them on tasks the prior run passed; the clean number is bounded
at 11–13/66. The budget-visibility line (R151) fired in every session and the continue nudge 13 times, but the median failing session still
ended at 40 minutes of an 8-hour budget: the mechanism is live and does not change early finishing. The harness changes since the
first high run did not move the score; the next spend is a third repeat plus a 7-task patch cell on 4.108.22, not another lever.

Patch cell (09-16, `tinkersnot/tb2-t4p-ctl`, ledger `.cortex/bench/r-tb4-patch-2026-09-16.md`): the seven sessions the provider incident
had cut were re-run on nexus-cortex 4.111.0 (R152 null-body retry plus the 4.109–4.111 fixes). 1 of 7 recovered (lake-temp-glm), so the
clean second repeat is **12/66 = 18.2%** (Wilson 10.7–29.0) with the disclosure that those seven rows ran on a later harness than the
other 56; the single-version number remains 11/66. Two repeats of the high configuration now average 19.7%. No null-body errors
recurred; the reasoning-exhaustion backoff and the budget-aware finish judge both fired in the field (18 vetoes across 5 sessions) and
lengthened the sessions (median 137 min vs 28 min for the same tasks) without changing the outcome on 4 of the 5 judged sessions.

## 3. Methodology and disclosures
- pass@1 = mean over independent full passes; a single-run delta under ~5 points on TB2.1 is inside the measured run-to-run band (32 of 89 tasks flip).
- Sterile installs: the published npm package, no private memory or skills, no web tools (TB has no browse dependency), the model's own key only.
- TB2.1: all 89 tasks, no exclusions, task budgets from the dataset's `task.toml`.
- TB4.0: 3 GPU tasks (fp8-rmsnorm-gemm, jax-speedrun-gpu, math-eval-grader — two require an H100) not run on the CPU VM; reported as failures.
- TB4.0 run specifics: 7 tasks ran with `--cpus ignore` on a 24-vCPU host (dataset asks 8–16; one of them, wdm-design, passed);
  medical-claims-processing ran in bridge mode (its service containers via an extra compose file); 2 tasks (distributed-dedup,
  pretrain-shard-corruption) hit the grader's verifier timeout after the agent phase completed and are scored as fails (outcome unknown);
  risk-scorer-replay was re-run on 4.108.7 after its first session died at boot on the task's read-only workdir (harness bug R131, fixed);
  delivered config had `CORTEX_ACTION_EFFORT=low` (the TB2.1 A/B found effort a wash on flash).
- Cache-warm token costs are disclosed as such; cold-start would be ~30× on input.
- Every number links to a public HF dataset with per-task rows, trajectories (`trajectories/<task>.session.jsonl`) and grader output (`grader/`).

## 4. Harness changes validated by these runs (levers with A/B evidence in `.cortex/bench/`)
EndTurn in the turn-1 tool set (cell-n-r6 2×2, +4/26 on the hard core), mentor reasoning off for lift/resolver (cell-n-r1/r3: thinking-on judges
false-accept 50–67%), loop-tool-block + near-dup lens, deadline-exit mentor (dark: fires, no flips), action effort high on flash (no lift), planner
doctrine v2 (neutral). 4.108.0 adds resume memory across proactive compaction (unmeasured: the first 8-hour-budget runs are the field test).


### Terminal-Bench 4.0 — full run on nexus-cortex 4.119.1, control vs full lever stack (2026-09-19)

| arm | pass@1 (62 executed, 3 GPU tasks + 1 excluded scored as fails) | tokens |
|---|---|---|
| control: flash action model at effort high, pro mentor thinking-on, resolver thinking-off | **12/66 = 18.2%** (Wilson 10.7–29.0) | $22.88 |
| stack: mentor pro high + judge reasoning on + R170 investigate rounds + R172 per-action analysis/plan fields | **12/66 = 18.2%** | $21.80 |

Paired on 62 tasks: 5 pass in both arms, 7 flip each way (p = 1.00). Every stack lever fired (per-action rejections, 2–3 judge rounds
with 122 checks and 183 reads, judge and planner at high). Verdict: the steering-lever stack does not move V4.1 Flash on TB4.0; the
same-version control equals the 4.108.x runs (11–14/66). Reference: Terminus 2 + V4.1 Flash = 26.8 (3 repeats). Host ≈ $52 on four
Vast 64-vCPU VMs; ledger `.cortex/bench/r-tb4-full-f1-2026-09-18.md`.
