# Adversarial read of the candidate author (R185) — inputs, construction, and whether it can pay for itself (2026-09-23)

Operator: "if the author is not being given good inputs how can we expect it to pay for itself with quality output. It would seem to be no
better than the poorly informed exit planner / judge." Read against the code as shipped in 4.124.13 (`HelperModelMiddleware.generateFrameCandidates`,
`frameRunner.step`, `buildStateCard`), not against my description of it.

## 1. What the author is actually given (per call)
| input | what it is | cap | what is lost |
|---|---|---|---|
| task | the task text | first 2500 chars | 14 of 64 TB4.0 tasks are longer (react-lead-form 3405; max 6389): the tail, where later requirements sit, is cut |
| state card | turn, cwd, last command + rc, budget, plan step, open items, then the last 12 commands with rc + 80-char outcome | first 900 chars of a 1500-char card | the recent-commands digest is the LAST section, so it is what the 900 cap truncates — the author loses most of the history exactly when the history is long |
| screen | the pane | last 2500 chars of the 6000-char clip | an error that scrolled off is invisible |
| writer analysis / plan | the writer's own text this turn | 500 / 300 chars | — |
| writer candidates | label + keystrokes | 160 chars of keystrokes each | the writer's `why` is not passed |
| model / budget | HELPER_MODEL_ID = flash, thinking OFF, one shot, 400 output tokens | — | no reasoning about a stuck state |
Not given at all: the lift plan of attack, the requirement ledger (lines + status), the environment report, the task's own test command,
earlier screens, the errors seen so far, the files the writer created, what the writer tried and abandoned.

## 2. What follows
1. **It is strictly less informed than the writer on every axis except independence.** The writer holds the full history, the plan, the
   ledger, and reasons at high effort; the author holds a truncated task, a truncated card, a screen tail, and no reasoning. So it cannot
   systematically produce BETTER next steps; it can only produce DIFFERENT ones. On a writer that is on track, different is worse — the
   smoke agrees (Jev 0.20–0.49 for the author vs 0.74–0.89 for the writer's first option).
2. **The case where it should pay is the case its inputs are weakest.** The author earns its cost when the writer is stuck: repeating a
   command, looping on an error, missing a stated requirement. Those facts live in (a) the recent-commands digest — truncated by the 900
   cap when the history is long, i.e. when the session is stuck; (b) the error text — possibly above the 2500-char screen tail; (c) the
   plan and the ledger — not passed. The author is blind to the very signal that would let it propose the other approach.
3. **Thinking off + 400 tokens yields pattern-level alternatives.** The smoke's authored options were all diagnostics ("preview the csv",
   "od the bytes", "awk cross-check", "AST check", "byte audit"): check-shaped, not approach-shaped. That is what a no-reasoning model does
   with a "propose a different approach" instruction and no evidence of what is wrong.
4. **The same input caps sit under the planner and the judge.** `buildPlannerUserPrompt` slices the task to 2000 chars (25 of 64 TB4.0
   tasks are longer); `buildResolverUserPrompt` to 2500 (14 longer); the ledger extractor uses 6000. The lift planner never sees the last
   third of react-lead-form's text. The plan-mention read (32/33 failing runs' plans name the failed requirement) says the planner still
   got the point on those five tasks, so this is not the cause of the top-7 losses — but it is a standing defect on a quarter of the
   population, and it is exactly the "poorly informed" charge, with a number on it.
5. **Cost.** ~$0.0005 and ~1.2 s per turn on the 89% of turns where the writer gives one option. Cheap — but a cheap input that Jev
   scores 0.2–0.5 and never picks is pure overhead, plus one more thing for the writer to read in the consequence line.

## 3. Verdict
As built, the author is a diversity source, not a quality source, and its diversity is of the wrong kind (checks, not approaches). It
should NOT be measured in E3 as-is: an E3 read of "Jev rarely picked the author" would be a read of these inputs, not of the concept.

## 4. What would make it worth its call (in order; all cheap; none requires a cell)
1. **Fix the task-text caps everywhere** (planner 2000 → 8000, judge 2500 → 8000, author 2500 → 8000; the ledger's 6000 → 8000). One
   constant each; the prompts are cache-stable per session anyway.
2. **Give the author the state that shows a writer is stuck, first and untruncated:** the recent-commands digest with rc and outcome
   (put it FIRST in the card or pass it as its own field, full 1500), the repeat count, the errors seen (a code-collected list of the
   last N non-zero rc outcomes), the ledger's OPEN lines (the requirement not yet exercised is the best "different approach" there is),
   and the plan step. All of this exists in code; none needs a model.
3. **Ask a different question when stuck vs when not.** If repeats ≥ 2 or the last 3 rc ≠ 0: "the writer is stuck on X; propose the
   approach that gets around it" — else "propose the requirement-exercising step the writer has not taken" (from the ledger). A no-reasoning
   model needs the diagnosis handed to it.
4. **Then measure, off-line, before E3:** replay the author on the E2 rows' stuck turns (the 449 turns where the chooser restricted or the
   screen showed an unaddressed error, and the freecad/kv-live-surgery loops) and have Jev score its options against what the writer did next
   and against the session outcome — the E0 method. Only if the author's options score above the writer's on stuck turns does E3 test the
   concept. Cost ≈ $2 of helper + Jev calls, no boxes.
5. **Model:** only after 1–4. Pro with thinking on at every turn is the wrong price for a menu filler; a flash call with the diagnosis
   handed to it is the design that could pay.
