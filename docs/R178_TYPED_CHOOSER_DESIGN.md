# R178 HB-TYPED-CHOOSER — design note (2026-09-21, draft; nothing built)

Operator framing (09-21 morning, paraphrased): Oregon Trail / Carmen Sandiego present labeled options and the player picks; give Jev a "typed
keyboard" — or better, labeled shortcuts with prefill, IDE tab-to-complete style — and let it drive a Terminus-2-style tmux session. We already
have the predictive-text slot (`TURN_SUMMARY_PREDICTION`, `turn_predictions`, Lens A graduation) — use it to present the options.

## 1. What we are actually proposing (one sentence)
A generator authors a small set of candidate next actions each turn (the ghost text); a typed decision model (Jev now, an own readout later)
chooses among them or rejects them all; the harness executes the pick; every (candidates, pick, outcome) row is banked through the existing
turn-prediction pipeline with the roles flipped from "predict the human" to "predict the agent".

## 2. Facts this rests on (verified; sources in the jev skill and the terminus-2 memory)
- Jev: choice over ≤255 labeled options / score / noul, probabilities out, ~0.34 s median, $0.042/M input, stateless, 32K state, cannot
  generate text, cannot count or compare numbers, literal, degrades with irrelevant state. Our paired eval: "is this task done" AUC 0.716,
  ECE 0.056, usable threshold ≈ 0.3; judge AND Jev ≥ 0.3 removed 24/51 false accepts for 6/27 true. It is a calibrated GATE, not a judge.
- Terminus 2 (Harbor reference agent): one tmux tool; per turn the model sees task + screen and answers JSON {analysis, plan, commands[{keystrokes,
  duration}], task_complete}; one "are you sure" confirmation; 3-step summarization on overflow. Our reference arm: `TB2_AGENT=terminus-2`
  (pilot-12, 0/12 on deepseek-reasoner, budget-killed). The frame PORT into our harness is NOT built (f1 ledger: "what remains untested is the frame").
- Turn-prediction pipeline (harness `HelperModelMiddleware.generateTurnSummaryAndPrediction` + `TurnPredictionStore`; browser
  `cortex/core/training/turnPrediction.ts` → STDB `turn_predictions` via `record_turn_prediction`): post-turn the helper predicts the USER's next
  message; scored by token-F1 (`predictionMatchScore`, identical on both surfaces by rule); provenance none|shown|inserted; inserted rows are
  excluded from the graduation exam (Lens A); DPO pairs from prefill votes are a listed lake consumer. Harness lever DARK (interactive-only UX).
- Why a raw keyboard is wrong: one key per call = 40 decisions and ~14 s per command, compounding error, no planning of the string. Oregon Trail
  worked because the options were few, labeled and meaningful. The unit of choice is an ACTION with its keystrokes prefilled, not a key.

## 3. The decision types, and — the crux — where each one's ground truth comes from
A replay is only as good as its per-turn labels. Our data has session-level labels (the grader) and almost no per-turn labels. So:

| decision | Jev primitive | state | label source for replay | status |
|---|---|---|---|---|
| D1 finish: is the task done / should `task_complete` stand | noul | task + final message + last N tool results | the hidden grader (per session) | DONE — the 262-session eval; this is the one with real evidence |
| D2 wait vs interrupt: is the running command still making progress | noul | last two screen captures + elapsed | did the process exit within the next K seconds (from the recorded trajectory timestamps) | replayable from Terminus trajectories (`tb2-t4pt-ctl`, 12) and our Bash tool timings |
| D3 permission: is this keystroke/command safe and inside the task | noul | command + task + cwd listing | weak: "did the command error / touch outside the task dir" from decision traces; strong labels need hand review | replayable, weak labels; the R170/R177 denylist is the baseline |
| D4 choose among N generator candidates (the tab key) | choice | task + plan + screen + candidates | NONE in the data: the trajectory recorded one action, not alternatives; whether it was the right one is unknown per turn | NOT replayable honestly from recordings — needs live candidates (frame) or hand-labeled turns |
| D5 candidate is a re-attestation / a repeat (loop) | noul | last k actions | R135/R165 loop labels exist (exact-repeat tracker, hold progress) | replayable from decision traces |
| D6 summary adequacy (operator 09-21): the generator works from a truncated summary of the pane; Jev reads the RAW pane and answers "does the raw output contain an error none of the candidates address / contradict the agent's last claim / name a failure the plan omits" | noul ×3 | raw pane captures (≤ 32K) + the summary the generator saw + candidates + last claim | unverified-claim distill labels (43/100 failing sessions) + grader; R170 investigate rows (raw-evidence vetoes) | replayable from banked sessions where raw tool output was kept (`grader/` dirs, not the pruned session.jsonl) |

Consequence: "replay the chooser" is well-posed for D1 (done), D2, D3, D5. It is NOT well-posed for D4, the actual tab-complete, because the
recordings contain no alternatives and no per-turn correctness. A synthetic menu (the recorded action + distractors from other turns) measures
whether Jev can spot the odd one out, not whether it chooses well — a known way to inflate a number. D4 needs the frame, or a labeled slice.

### 3a. The split of state (operator framing, 09-21): the writer sees the gist, the reader sees the raw
Generator = the human in the Claude Code analogy (truncated tool results + project context, writes the options); Jev = the one who sees the
full pane. The inversion to guard: the raw-reader cannot ADD an option, so a detail the summary dropped (a stack-trace file name) cannot reach
the menu. D6 closes it: a YES becomes a consequence to the generator ("re-plan from the full output") and the raw block is sent ONCE, that turn.
The generator's view is therefore adaptive — summaries by default, raw on demand — and its prompt stays small and cache-stable. Jev's state is
rebuilt per call (no cache to protect; flat $0.042/M; 32K cap; more state is not better — the rich-state eval variant was a wash — different,
parsed state per decision is).

## 4. Candidate authoring (the part that decides whether D4 is worth anything)
- Author = the generator (flash), asked for k=3 next actions as `{label, keystrokes, duration, why}` lines — the same shape Terminus emits, times k.
  Cost: one generator call per turn either way; the k-way variant adds output tokens only.
- Templates from code join the menu: wait longer / interrupt (C-c) / scroll back / re-read the task / run the task's own test command / finish.
  These are the Oregon Trail options; they need no generator and they are the ones a chooser can be right about cheaply.
- Escape: "none of these" → the generator's single best action executes unchosen (the arm degrades to the plain frame, never worse).
- The state Jev sees must be compact and parsed: exit codes and counts extracted in code; screen ≤ 6.4K chars (160×40); the plan ≤ 1K; the
  candidates verbatim. Irrelevant history hurts Jev (documented) — this is a harness responsibility, not a prompt.

## 5. Banking (reuse, do not fork)
`turn_predictions` row per turn: `predictedNext` = the chosen candidate's keystrokes, `actualNext` = what executed, `prefillProvenance` =
`inserted` when Jev's pick executed, `none` when the escape fired; `predictorModel` = `jev-chooser@<version>` or the own readout. New optional
fields (all Option<T>, additive): `candidates` (JSON), `pickProbability`, `outcomeReward` joined at grade time. Scorer: keep token-F1 for
comparability AND add exact-match on the normalized command — token-F1 on shell text is coarse. DPO pairs = (chosen, rejected) per turn,
labeled by session outcome, exactly the lake's listed consumer. This is Lens A with the apprentice in the author slot later: no new pipeline.

## 6. Experiments, in order (none started; spend is quoted, operator gates)
- E0 (≈$2, no build beyond scripts): replay D2 + D3 + D5 on the 12 Terminus trajectories and ~200 of our banked sessions (decision traces in
  the lake). Report AUC/ECE + confident-wrong per decision, against the code baselines (duration heuristic, denylist, repeat tracker). Go/no-go
  for putting a typed gate on each in the frame.
- E1 (day-scale build, ≈$40 measure): the Terminus frame port on the existing TmuxSession tool with the action step designed as menu + prefill
  from day one (author → chooser → sender), chooser OFF. A/B vs our control on the 35-task g1 population. This is the untested-frame experiment
  the f1 ledger asked for; it stands on its own without Jev.
- E2 (≈$40): same frame, chooser ON (D4 live, D1 as the finish gate at threshold 0.3, D2/D3 as gates if E0 says so). Paired vs E1. Engagement
  evidence = the rows in §5 (candidates, pick, probability, provenance) — an arm that cannot show its picks is a second control.
- E3 ($0 + training): apprentice in the author slot, graded by Lens A on the E2 rows.

### 6a. E0 RESULT (run 2026-09-21, `omniclaude-v4/.cortex/research/jev-e0-2026-09-21/results.md`)
Leg B: v1 (claim + tool rows) AUC 0.638 / ECE 0.056 / 0 confident-wrong on 97 g1/g2 sessions; adding the banked 1500-char raw-output sample
did not help (v3 0.603 / 0.069); adding the judge's opinion made Jev ECHO the judge (v4 AUC 0.645 but ECE 0.229, recall = the judge's) →
RULE: the gate's state never contains the decision it gates. Leg A: p_fail AUC 0.62 (weak ranker input; literal repeat detection 0.98).
Leg C: uninformative (2 loops in 396). The raw-PANE hypothesis is untested until the frame exists (E1/E2); the banked sample is not the pane.

## 7. Risks named now
- Label leakage in E0: D2's "process exited within K s" is available only because the recording continued; fine for replay, not for live.
- Menu-authoring bias: if the generator's three candidates share one misreading of the spec, the chooser cannot rescue it — expect D4 to help on
  mechanical turns and not on spec-reading turns (the C4 overfit class).
- Cache economics: the candidate list changes every turn but sits at the END of the prompt (suffix), so the prefix cache is intact; the chooser
  call is on Jev's wire, not the generator's. No per-turn prefix rewrite (the trap in the TypeSafe-agent essay).
- Two frames at once: E1 must be read before E2 or the frame and the chooser confound each other.

## 8. Dependencies
TmuxSession tool + R138–R143 tmux levers (built); R172 action plan fields (built; Terminus shape); jevGate.ts (built; noul, fail-open);
turn-prediction store + reducer (built, dark in the harness); Terminus trajectories `tinkersnot/tb2-t4pt-ctl` (banked); decision traces in
the lake (`decision_trace` rows, 09-20 backfill). Not built: the frame port, the candidate author, the chooser call, the sender, the E0 scripts.
