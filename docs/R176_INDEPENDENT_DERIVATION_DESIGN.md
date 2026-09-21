# R176 HB-INDEPENDENT-DERIVATION — design note (2026-09-21, draft)

## 1. The class it targets (grounded)
The largest never-passed class on TB4.0 (~14 of 37 tasks; lake read 2026-09-20): the deliverable is a computed value or an exact
artifact checked against a golden answer (foodstuff-beta-activity `test_value_within_tolerance` ×14 failures, roy-polymorph-cn
`test_values_accuracy`, glycan-ms2 `test_full_output_matches_golden_solution`, gsea-proteomics golden entries, hof-topology distances,
interleaved-vigenere decryption accuracy, sound-change-cascade exact match, cargo-flight-dispatch timing value, ctr-optimization
threshold, shadow-relay flag/key, satb pitches, takens-embedding-lean axioms). In these sessions the agent's own test passes, the judge
sees a consistent story, and every finish-time lever we have is blind: cell g1 held foodstuff six times and it returned the wrong value
six times. There is no ground truth in the container; the only lever left is to make the agent PRODUCE its own disagreement.

## 2. Mechanism
At the first finish of a turn whose task is value-shaped, the harness requires a second, independent derivation before the finish
can stand, and treats disagreement as objective evidence for a hold (R166/R173 rails, no new veto policy).

1. **Classification** (typed, cheap): is this task value-shaped? A Jev/own-readout noul over the task text — "does the task's
   correctness reduce to one or a few computed values or exact outputs that could be recomputed by a different method?" — banked as
   `valueShaped` with its probability; threshold ~0.5 (measure on the 66 task texts against the taxonomy first: expected ~14 yes).
2. **Elicitation of the second method** (one mentor call, same wire as the judge, its own persona, sees the task + the agent's final
   answer + the agent's method summary): "State the agent's method in one line. Name a DIFFERENT method that would produce the same
   value from the same inputs (different algorithm, different library, first-principles check, dimensional/bounds check). Write the
   command(s) that run it in this container, printing the value." Output: `METHOD: …` + `CHECK: …` lines (the R174 parser).
3. **Execution**: the harness runs the CHECK lines through the R170 runner (read-only denylist; a derivation may write under /tmp),
   captures the printed value(s).
4. **Reconciliation** (pure): parse numbers/strings from the agent's deliverable (the file the task names, read by the harness) and
   from the second derivation; compare with the task's stated tolerance when it states one, else a relative tolerance (1e-3) for
   numbers and exact match for strings. Agreement → the finish stands with `derivationAgreed=true`. Disagreement → the finish is held
   ONCE with both values and both methods shown ("your method gave X, an independent recomputation by <method> gave Y; reconcile before
   finishing"); the second finish stands regardless (liveness), with the disagreement banked.
5. **Bank**: event `independent_derivation` {valueShaped, p, method, checks, agentValue, derivedValue, agreed, latencyMs}; the resolver
   event gains `derivationAgreed`.

## 3. What it is not
Not a second judge opinion (the judge reads the same story); not a re-run of the agent's own tests; not a Terminus double-confirm.
It is a forced second measurement. Where the second method is the SAME algorithm in disguise the check is worthless — the persona must
be measured on method diversity (bank the METHOD lines; grade a sample by hand).

## 4. Cost and risk
One mentor call (~10 s) + one or two checks per value-shaped finish; ~$0.01 per session. Risk: wrong second derivations hold correct
answers once (bounded: one hold, then the finish stands). Risk: the class is where the model is genuinely wrong twice the same way
(shared misreading of the spec); expect a partial effect, not a cure.

## 5. Measurement
Cell on the value-shaped subset (the 14 tasks) + 6 ever-passed value tasks as a false-hold control, 3-h budgets, one box: ~$10.
Read: pass flips, `agreed=false` rate on passing vs failing sessions (does disagreement predict the grader?), false-hold rate.

## 6. Dependencies
R174 parser/runner (built), Jev gate (built; the noul needs `TYPESAFE_API_KEY` — or the own readout once calibrated), the deliverable
locator (the task text names the output path in every task of the class; the R174 author already extracts it).
