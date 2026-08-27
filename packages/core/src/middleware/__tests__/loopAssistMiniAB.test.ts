/**
 * MINI A/B SIMULATION (2026-08-27) — validate the fixed loop-assist end-to-end,
 * in-process, with ONE real DeepSeek call. No harness/container run (repl-safe).
 *
 * Exercises the REAL fixed path:
 *   generatePatternDetectionGuidance (no helperModelId) →
 *   fallback 'deepseek-v4-flash' (the single-key change) →
 *   getHelperModelConfig → ChatCompletions adapter → generate() (RAW, the rewrap fix) →
 *   real DeepSeek → guidance
 *
 * PASS = the loop-assist returns actual loop-breaking guidance, NOT a 9-category summary.
 * This is the pre-publish mechanics/var validation. The orchestrator FIRING gate
 * (shouldTriggerPatternDetection) is validated by the container bench A/B post-publish.
 */
import { describe, it, expect } from 'vitest';
import { HelperModelMiddleware } from '../HelperModelMiddleware.js';

describe('mini A/B: fixed loop-assist delivers real guidance (single-key DeepSeek)', () => {
  it('generatePatternDetectionGuidance → RELIABLE loop-breaking guidance (4/4 non-empty)', async () => {
    if (!process.env.DEEPSEEK_API_KEY) {
      console.warn('SKIP: no DEEPSEEK_API_KEY in env');
      return;
    }
    const mw = new HelperModelMiddleware();
    const N = 4;
    let firstSample = '';
    for (let i = 0; i < N; i++) {
      // NO helperModelId → exercises the new 'deepseek-v4-flash' fallback (single-key change)
      const guidance = await mw.generatePatternDetectionGuidance({
        errorPattern: "sed: -e expression #1: unterminated `s' command",
        occurrences: 3,
        recentHistory: [
          { role: 'assistant', content: "Bash: sed -i 's/foo/bar/ file.txt   -> exit 1" },
          { role: 'assistant', content: "Bash: sed -i 's/foo/bar file.txt    -> exit 1" },
          { role: 'assistant', content: "Bash: sed -i s/foo/bar/g file.txt    -> exit 1" },
        ] as any,
      });
      if (!firstSample) firstSample = guidance;
      // Every call must produce real guidance (the reasoning-floor fix) — not empty
      expect(guidance.length, `run ${i} returned empty/short (reasoning starved content?)`).toBeGreaterThan(60);
      expect(guidance).not.toContain('PRIMARY REQUEST'); // not the 9-category summary (rewrap fix)
      expect(guidance).not.toMatch(/Structure your summary|KEY TECHNICAL CONCEPTS|DURABLE PROJECT NOTES/);
    }
    // At least the first sample should engage the actual problem
    expect(firstSample.toLowerCase()).toMatch(/delimiter|dry.?run|quote|different|approach|strateg|perl|verify/);
    console.log('\n===== LOOP-ASSIST OUTPUT (fixed, ' + N + '/' + N + ' non-empty) =====\n' + firstSample.slice(0, 600) + '\n=====\n');
  }, 180000);
});
