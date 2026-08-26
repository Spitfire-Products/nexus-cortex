/** Item 13b — surrender-guard pure half. */
import { describe, it, expect } from 'vitest';
import { detectSurrenderText, resolveSurrenderNudgeMode, SURRENDER_REMINDER } from '../turnEndGuards.js';

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
