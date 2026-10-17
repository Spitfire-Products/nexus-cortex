# Reproducing the published Terminal-Bench results

Every number we publish for `nexus-cortex` comes from one of two configurations of the same package, both expressed as a
**lever profile** (`CORTEX_PROFILE`), run by the open-source [Harbor](https://github.com/laude-institute/harbor) benchmark runner
with the adapter in `bench/harbor/`. Nothing in a result depends on our infrastructure: the harness is the npm release, the
grader is the task's own `test.sh`, the model is the public DeepSeek API.

## 1. The two configurations

| profile | what it is | who it is for |
|---|---|---|
| `CORTEX_PROFILE=standard` | the shipped default since the 2026-10-17 release: every lever with banked evidence that is safe in any session (failure-path handling, steering inputs, timeouts), every role on `deepseek-flash` | what you get by installing the package |
| `CORTEX_PROFILE=bench-tb4` | the exact library-side bundle of our Terminal-Bench 4.0 cells: `standard` plus the grader-oriented levers (task rules, verify-at-scale, turn status, veto cap, output cap, second-attempt chain, mentor on `deepseek-v4-pro` with thinking on, effort high, workspace hygiene, web tools off) | reproducing a published cell number |
| `CORTEX_PROFILE=off` | the byte-identical pre-profile defaults | the control for "what did the profile change" |

The lever list behind each name is in `packages/core/src/config/interactiveProfile.ts` (one source of truth, unit-tested) and every
run reports the resolved value and source of every lever in `GET /health/config` and in the banked `effective_config` of each row.
A profile fills only levers you did not set: anything in your environment or `~/.cortex/.env` wins.

## 2. Prerequisites

- Docker, Python 3.11+, `pip install harbor` (we used harbor 0.23.0; Terminal-Bench 4.0 is `terminal-bench/terminal-bench@4.0`,
  2.1 is `terminal-bench/terminal-bench-2-1`).
- A DeepSeek API key in `DEEPSEEK_API_KEY`. The action model id is `deepseek-flash` (served by DeepSeek-V4.1-Flash-1017 since
  2026-10-17; the September weights cannot be requested any more, see §5), the bench mentor is `deepseek-v4-pro`.
- About 16 vCPU / 32 GB per 4 concurrent tasks for the 4.0 board; 7 tasks carry 8-hour budgets, 3 need a GPU (we score them as fails).

## 3. Run

```
git clone https://github.com/nexus-cortex/nexus-cortex && cd nexus-cortex/bench/harbor
export DEEPSEEK_API_KEY=...            # the only secret
export TB2_HARNESS=nexus-cortex@<the version the result names>
export CORTEX_PROFILE=bench-tb4        # or standard / off
harbor run -d terminal-bench/terminal-bench@4.0 -a nexus_cortex_agent:NexusCortex -m deepseek-flash \
  --agent-import-path . --n-concurrent 4 --output-dir ./runs/tb4
```

Harbor writes one `result.json` per task; the pass rate is the mean of `reward` over the 66 tasks (count the 3 GPU tasks as fails
if you cannot run them, as we do). For a single task: `harbor run -i <task-name> ...`.

## 4. Read it the way we do

- **One repeat is a ±3-task band on the 4.0 board.** We call a difference under 4 tasks between two single runs undetermined and
  replicate before claiming anything; published numbers state the repeat count and the union (tasks passed in at least one repeat).
- **Model spend is the published cost.** Container time is reported separately. A full 62-task pass costs roughly $14 of tokens at
  effort low without the chain and $55 to $70 with the `bench-tb4` bundle (second attempts, Pro mentor), at DeepSeek's off-peak prices.
- **Mechanism evidence, not just the score.** Each session's `decisions.jsonl` (in the task's `.cortex` state dir) records every
  lever that fired (lift plan, resolver verdicts, walls, second attempts). An arm whose mechanism never fired is a control, not a treatment.
- Our own runs additionally bank every row, trajectory and grader artifact to a private store per arm and label every failure with a
  grader-derived failure mode; that pipeline is ours, the numbers do not depend on it.

## 5. Model boundary

DeepSeek repointed the `deepseek-flash` alias to V4.1-Flash-1017 on 2026-10-17 (their pricing page names the served version). Results
published before that date were produced on the September weights and are not reproducible on the API any more; results after it
name the weights date. DeepSeek's own 4.0 number for 1017 is 42.3 with the Claude Code harness (31.2 for the September weights);
Artificial Analysis measured the September weights at 26.8 with mini-swe-agent. Quote a harness and a weights date with every number.

## 6. The second-attempt caveat

Our 4.0 cells ran the second-attempt chain in the Harbor adapter (`TB2_SECOND_ATTEMPT=1`, kept there until the library chain matches
it on spend and results). `bench-tb4` turns on the library chain instead (`CORTEX_SECOND_ATTEMPT=1`); both make the same selection
decisions on the paired cells we ran, with a 1 to 3 task outcome gap still open at n=2. To run the adapter chain exactly as the cells did,
set `TB2_SECOND_ATTEMPT=1 TB2_SECOND_ATTEMPT_MAX=2 TB2_SECOND_ATTEMPT_TRIGGER=accept-with-gap,accept-low-confidence,accept,none` and
`CORTEX_SECOND_ATTEMPT=0` in the Harbor environment.
