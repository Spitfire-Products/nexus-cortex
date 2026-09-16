/** Item 13b — surrender-guard pure half. */
import { describe, it, expect } from 'vitest';
import { detectSurrenderText, resolveSurrenderNudgeMode, SURRENDER_REMINDER, detectOpenItemsText, buildBudgetContinueReminder } from '../turnEndGuards.js';

describe('surrender detection (item 13b)', () => {
  it('detects the train-fasttext specimen shape', () => {
    const t = `I did **not** finish the task. Here is the status:
**What was completed:** data prep, probe.
**What remains to finish the task:**
1. Let the full model finish training (or train a smaller-dim model).
2. Quantize it and verify <150MB.
I did not claim the model exists because it does not — the task is incomplete.`;
    expect(detectSurrenderText(t)).toBe(true);
  });

  it('detects "next steps:" plans and "could not complete the task"', () => {
    expect(detectSurrenderText('Partial results gathered so far are below.\nNext steps: retrain with dim=50, then quantize and verify the output size.')).toBe(true);
    expect(detectSurrenderText('Despite several attempts with different configurations, I could not complete the task because the build kept failing on the linker step.')).toBe(true);
  });

  it('never trips on a plain successful answer', () => {
    expect(detectSurrenderText('PASS')).toBe(false);
    expect(detectSurrenderText('The model achieved 0.71 accuracy and is saved at /app/model.bin (142MB). All requirements verified: size <150MB, accuracy >=0.62, format valid.')).toBe(false);
  });

  it('never trips on short texts even with keywords', () => {
    expect(detectSurrenderText('next steps: n/a')).toBe(false); // <80 chars
  });

  it('detects the live mini-vision and defer-flash rerun phrasings (4.76.1)', () => {
    expect(detectSurrenderText('Remaining work is listed below for completeness and reference.\nI have not claimed the task complete, because the final deliverable (/app/model.bin) with verified size and accuracy was not produced.')).toBe(true);
    expect(detectSurrenderText('The background run may still finish later on its own.\n**What remains to complete the task:** check the output, evaluate, tune, save the final model. I am not claiming completion — the deliverable is not yet in place.')).toBe(true);
  });

  it('reminder demands execution, bounded framing', () => {
    expect(SURRENDER_REMINDER).toContain('EXECUTE those steps now');
    expect(SURRENDER_REMINDER).toContain('hard limit');
  });

  it('env gate', () => {
    const prev = process.env.CORTEX_SURRENDER_NUDGE;
    try {
      process.env.CORTEX_SURRENDER_NUDGE = 'true';
      expect(resolveSurrenderNudgeMode()).toBe(true);
      delete process.env.CORTEX_SURRENDER_NUDGE;
      expect(resolveSurrenderNudgeMode()).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.CORTEX_SURRENDER_NUDGE; else process.env.CORTEX_SURRENDER_NUDGE = prev;
    }
  });
});

describe('R151 open-items detection', () => {
  it('detects the sound-change-cascade specimen (did not get to execute it within budget)', () => {
    const t = `I also wrote /app/repair.py, an error-driven search that derives candidate rules only from the 23 broken pairs and tries each at every position, but I did not get to execute it within budget. **Open items:** the 23 unexplained pairs; the cascade is over-fitted, so its generalization to unseen proto-forms is unverified.`;
    expect(detectOpenItemsText(t)).toBe(true);
  });
  it('detects "not yet verified" / "could not verify" / "left untouched" finishes', () => {
    expect(detectOpenItemsText('The migration is applied and the API answers on both paths. The rollback script is written but not yet verified against a live cutover, and the p95 numbers are noisy on this shared box, so treat them as indicative rather than final.')).toBe(true);
    expect(detectOpenItemsText('checkpoint.py still has lsn + 1 in create_checkpoint; it is off the stated surface so I left it untouched. Durability is synchronous per commit and the writer keeps every durable entry in memory over a very long run.')).toBe(true);
  });
  it('never trips on a plain complete answer or on short texts', () => {
    expect(detectOpenItemsText('All 60 tests pass locally; the package installs cleanly, the benchmark shows a 12x speedup over NetworkX on the provided graph pairs, and the output file is at /app/output/result.json exactly as specified.')).toBe(false);
    expect(detectOpenItemsText('Open items: none.')).toBe(false);
  });
  it('reminder names the remaining and total budget', () => {
    const r = buildBudgetContinueReminder(6 * 3600_000, 8 * 3600_000);
    expect(r).toContain('~6h00m');
    expect(r).toContain('8h00m wall budget (75%)');
  });
});

// R157 (2026-09-16, tb4-flash-v3 audit): explicit surrenders the first R151 set missed + the re-armed reminder.
describe('R157 open-items detector v2', () => {
  const pad = ' The rest of this message describes what was built and how it was checked, in enough detail to clear the length floor.';
  it('catches the tb4-flash-v3 surrender phrasings', () => {
    for (const t of [
      '## Final answer: TASK NOT COMPLETE. I must be plain: I did not prove target_theorem, and I did not edit /app/Main.v at all.' + pad,
      'FINAL ANSWER — honest status report. OUTCOME: The task is NOT complete. The delivered artifact fails the task\'s real success criterion.' + pad,
      'Honest bottom line: I did not fully solve the task. I recovered a 33-rule cascade that reproduces 777 of 780 training pairs.' + pad,
      'I could not prove takens_embedding_existential. Here is an honest account of what I did and where the proof breaks.' + pad,
      'I was unable to get the marker to disappear on boot; the mechanism is localized but the fix is incomplete.' + pad,
      'The build still fails on the second target after my change; the first target passes.' + pad,
    ]) expect(detectOpenItemsText(t)).toBe(true);
  });
  it('stays quiet on a confident completed finish', () => {
    expect(detectOpenItemsText('I fixed the release pipeline. /app/scripts/release.ts now drives everything from the app present at run time plus /app/visibility.json. All release checks pass and the output matches the reference byte for byte.')).toBe(false);
  });
  it('second reminder is firmer and names the count', () => {
    const first = buildBudgetContinueReminder(6 * 3600_000, 8 * 3600_000);
    const second = buildBudgetContinueReminder(6 * 3600_000, 8 * 3600_000, 2);
    expect(first).toContain('CLOSE those items now');
    expect(second).toContain('second time');
    expect(second).toContain('75%');
    expect(second).not.toBe(first);
  });
});
