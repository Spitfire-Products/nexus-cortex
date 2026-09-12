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

## 2. Terminal-Bench 4.0 (66 tasks, `terminal-bench/terminal-bench`, 8-hour agent budgets)

_Run in progress (VM executor, 63 non-GPU tasks, native resources, real budgets). Fill: pass/66 with the 3 GPU tasks counted as fails,
category breakdown, cost triple._ Independent reference (Artificial Analysis, 3 repeats): V4.1 Flash 26.8, V4 Pro 14.1, GPT-6 Astra 59.6.

## 3. Methodology and disclosures
- pass@1 = mean over independent full passes; a single-run delta under ~5 points on TB2.1 is inside the measured run-to-run band (32 of 89 tasks flip).
- Sterile installs: the published npm package, no private memory or skills, no web tools (TB has no browse dependency), the model's own key only.
- TB2.1: all 89 tasks, no exclusions, task budgets from the dataset's `task.toml`.
- TB4.0: 3 GPU tasks (fp8-rmsnorm-gemm, jax-speedrun-gpu, math-eval-grader — two require an H100) not run on the CPU VM; reported as failures.
- Cache-warm token costs are disclosed as such; cold-start would be ~30× on input.
- Every number links to a public HF dataset with per-task rows, trajectories (`trajectories/<task>.session.jsonl`) and grader output (`grader/`).

## 4. Harness changes validated by these runs (levers with A/B evidence in `.cortex/bench/`)
EndTurn in the turn-1 tool set (cell-n-r6 2×2, +4/26 on the hard core), mentor reasoning off for lift/resolver (cell-n-r1/r3: thinking-on judges
false-accept 50–67%), loop-tool-block + near-dup lens, deadline-exit mentor (dark: fires, no flips), action effort high on flash (no lift), planner
doctrine v2 (neutral). 4.108.0 adds resume memory across proactive compaction (unmeasured: the first 8-hour-budget runs are the field test).
