# R179 HB-TERMINUS-FRAME — the Terminus-2 frame as an action mode of our harness, with the menu step (design, 2026-09-21; nothing built)

## 0. Why this is the next move (grounded)
- TB4.0 flash: our frame 18.2% on the full 62 (f1, control = full lever stack, WASH); Terminus 2 with the same V4.1 Flash = 26.8 (AA, 3 repeats).
  The lever pile on the finish decision is CLOSED (R165–R176: one reproducible flip, the early no-evidence hold). The f1 ledger's own last line:
  "what remains untested is the frame itself". This is the one variable between 18 and 26.8 we have never varied.
- The reference agent (memory `terminus-2-harness-reference`, read from source): ONE tmux tool; per turn the model sees the task + the current
  screen and answers JSON {analysis, plan, commands:[{keystrokes, duration}], task_complete}; one "are you sure" confirmation; a 3-step Q&A
  summarization on overflow. No tool schemas, no tool results in the context — the screen IS the result.
- E0 (09-21) fixed two rules for the menu step: the chooser's state must never contain the decision it gates (Jev echoed the judge), and "raw
  evidence" must be the actual screen/artifact, not a tail of outputs. The raw-PANE hypothesis is only testable inside this frame.
- Existing parts we reuse, not rebuild: `TmuxSession` tool (create/send/capture/snapshot/wait, R138–R143 pane geometry + history + Wait primitive),
  R172 action-plan fields (analysis/plan already in the action JSON), the endturn resolver + gates (R166 evidence, R173 hold, R174 spec, R176
  derivation), lift plan, compaction (`compactionResume.ts`), decision store, `jevGate.ts`, the turn-prediction store, the bench adapter + stores.

## 1. Shape: a FRAME, not a new agent
`CORTEX_FRAME=tools|terminus` (default tools). In `terminus` the SAME orchestrator runs the same turn loop with one difference in the action step:
- Tools exposed to the model: none of the 31. The action is a JSON document the harness executes against one tmux pane.
- The prefix (cached): system prompt + task + lift plan + the frame contract (one page). The suffix (rebuilt per turn, cheap): the SCREEN
  (160×40 capture) + a STATE CARD + the MENU. No tool-result history is appended — history lives in the decision store and the state card.
  This is what keeps the prefix cache intact (the TypeSafe essay's trap, avoided) and the context flat over 200-turn sessions.
- Everything downstream is unchanged: EndTurn = `task_complete:true` → resolver → holds/spec/derivation → finish confirm ("are you sure" is our
  R167 finish confirm). So E1 vs control isolates the frame; nothing else moves.

## 2. The turn (what the writer sees, what it emits)
STATE CARD (built in code, parsed fields the reader and writer both get; ≤ 1.5K chars):
  cwd · last command · its exit code (from a PROMPT_COMMAND hook that prints `__RC=<n>`) · elapsed on the last command · budget used/left ·
  turn n · commands run · repeats detected (exact-repeat tracker over keystrokes) · open items from the last hold (verbatim, ≤ 400 chars) ·
  the plan's current step. Numbers are parsed here, never inferred by either model.
SCREEN: the pane as text (ANSI stripped), plus a "show earlier output" template when the command produced more than one screen.
MENU (the ghost text, k ≤ 3 generator candidates + code templates):
  the generator's action JSON becomes `candidates:[{label, keystrokes, duration_s, why}]` (k=1 in E1 = plain Terminus; k=3 in E2);
  code templates always present: WAIT +30s · INTERRUPT (C-c) · SHOW MORE OUTPUT · RUN THE TASK'S OWN TEST · RE-READ THE TASK · FINISH.
  The writer never sees the reader's probabilities — only consequences ("candidate 2 was chosen", "held: rerun the test first").
EMIT: `{analysis, plan, candidates:[…], task_complete}` — R172's fields plus the candidate list; parse strict, one re-ask on format miss
  (the R172 fallback path), then execute candidate[0].

## 3. The menu step (chooser)
`CORTEX_FRAME_CHOOSER=off|jev|readout` (off = E1). With `jev`: ONE call per turn (0.34 s, all questions in one pass) over a state that is
  the screen + state card + the candidates + the task's stated criteria — NEVER the judge's verdict or plan (E0 rule). Questions:
  choice `next` over the candidate labels + templates; nouls `repeat` (a candidate repeats a run command — Jev reads literal repeats at 0.98),
  `unaddressed_error` (the screen shows an error no candidate addresses → consequence: the writer gets the full screen tail once and re-plans),
  `unsafe` (destructive / outside the task tree — replaces the regex denylist as a gate, keeps the denylist as a hard floor).
  Policy: execute the chosen candidate if its probability ≥ 0.3 (the measured Jev operating point); else candidate[0] (escape; the arm never
  does worse than E1); `unsafe` ≥ 0.7 → refuse + consequence; `repeat` ≥ 0.7 → the WAIT/INTERRUPT/SHOW-MORE templates only.
  Fail-open: Jev error/timeout (8 s) → candidate[0]. Engagement evidence per turn: candidates, pick, probabilities, provenance, executed keys.
Banking: one `turn_predictions`-shaped row per turn (predictedNext = the pick's keystrokes, actualNext = executed, provenance inserted|none,
  predictorModel = generator|jev-chooser) with additive fields {candidates, pickProbability, outcomeReward at grade}; scorer = token-F1 kept for
  comparability + exact match on normalized keystrokes. These rows are Lens A on agent actions and the DPO source for the apprentice (E3, $0).

## 4. Execution and waiting
send-keys via the TmuxSession tool; then wait `duration_s` (cap 300 s per action); then the R142 Wait primitive extends while the screen keeps
changing and no prompt is back (cap by budget); the exit code comes from the prompt hook. A command still running at the cap is NOT killed:
the next turn sees it running and the menu offers WAIT/INTERRUPT (D2 becomes a live, labeled decision: the label is whether it finished).

## 5. Context growth
Terminus summarizes with 3 Q&A steps at overflow. We do not grow: the prefix is fixed, the suffix is rebuilt. The decision store keeps every
turn; a "recent history" digest (last 12 commands: keystrokes, rc, one-line outcome) is part of the state card. Proactive compaction stays
as a safety net only.

## 6. Build (day-scale; TDD; all dark by default)
1. `packages/core/src/frames/terminusFrame.ts` — PURE: buildStateCard, buildMenu (templates ∪ candidates), parseFrameAction (strict JSON,
   R172-compatible), waitPolicy (duration + screen-change extension), stripAnsi, promptRc parser. ~15 unit tests.
2. `packages/core/src/frames/chooser.ts` — PURE policy (thresholds, escape, fail-open) + the Jev state builder (independence enforced by
   construction: it takes no verdict argument). Tests for the E0 rules.
3. Orchestrator: `CORTEX_FRAME=terminus` branch in the action step (one place: where tool_use blocks are executed) — emit → execute → bank;
   `task_complete` routes into the existing EndTurn path. Config mirrors (RuntimeConfigRegistry / SettingsLoader / SettingsSchema /
   effectiveConfig), `.env` LEDGER lines, adapter allowlist keys (`CORTEX_FRAME`, `CORTEX_FRAME_CHOOSER`, `CORTEX_FRAME_CANDIDATES`,
   `CORTEX_FRAME_WAIT_CAP_S`), TurnPredictionStore additive fields.
4. Local smoke: a docker container with tmux + a 3-command toy task; then one TB4.0 task on a box (ever-passed, e.g. react-lead-form) at k=1.
5. Release (minor). Then E1: control (tools frame) vs `CORTEX_FRAME=terminus` chooser off, g1-35 population, 3-h budgets, one box per arm
   (~$40). Read: paired passes, first-finish budget use, unverified-claim rate (distill), wall hits, turns. Then E2: chooser jev vs off on the
   same frame (~$40) — engagement rows + the raw-pane question. E3: apprentice in the writer slot on the E2 rows ($0 + training).

## 7. Risks (named now)
- Losing the tool-level guards (R170 denylist, exact-repeat tracker, the Wait primitive) when actions become keystrokes → each is re-expressed
  as a menu gate/template above; the denylist stays as a hard floor on keystrokes.
- 40-line screens hide long outputs (Terminus's known weakness) → SHOW MORE template + the harness keeps the full capture for the reader.
- Two variables at once → E1 before E2, always.
- The writer may game the menu (always candidate[0] = its own plan) → the chooser's pick rate and override outcomes are the engagement read.
