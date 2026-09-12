import { describe, it, expect } from 'vitest';
import { RESUME_MEMORY_PROMPT, renderResumeMemoryPrompt, buildRebuildInstructions, resolveCheckpointBand, resolveRearmBand } from '../compactionResumeTemplate';
import { buildCompactionResumeReminder } from '../compactionResume';

describe('HB-COMPACTION-RESUME v2 (4.108.2): the resume-session protocol ported into the harness', () => {
  it('the memory prompt carries the skill sections and substitutes the conversation + target', () => {
    for (const sec of ['## 0. WORK ORDER', '## 1. STATE — DONE', '## 2. STATE — OUTSTANDING', '## 3. DECISIONS', '## 4. ARTIFACTS', '## 5. TRAPS', '## 6. CURRENT WORK']) expect(RESUME_MEMORY_PROMPT).toContain(sec);
    const p = renderResumeMemoryPrompt('HELLO-HISTORY', 4321);
    expect(p).toContain('HELLO-HISTORY'); expect(p).toContain('~4321 tokens'); expect(p).not.toContain('{{CONVERSATION}}');
  });
  it('the rebuild protocol mirrors the wake protocol: re-read, verify on disk, no redo, start at item 1, observation wins', () => {
    const r = buildRebuildInstructions();
    for (const k of ['Re-read the WORK ORDER', 'Trust the files on disk', 'Do NOT redo', 'Start with §2 item 1', 'observation wins']) expect(r).toContain(k);
    const t = buildCompactionResumeReminder({ turn: 9, droppedCount: 3, keptCount: 5, tokensBefore: 100, tokensAfter: 50, resumeText: 'm', taskText: 't', rebuild: r, memorySource: 'checkpoint' });
    expect(t).toContain('REBUILD PROTOCOL'); expect(t).toContain('at the pre-compaction checkpoint'); expect(t.endsWith('</system-reminder>')).toBe(true);
  });
  it('pressure rung: band 0 below 75% of the threshold, band 1 at 75%, +1 per 10%, env-tunable and clamped', () => {
    expect(resolveCheckpointBand(0, 1000, {})).toBe(0);
    expect(resolveCheckpointBand(740, 1000, {})).toBe(0);
    expect(resolveCheckpointBand(750, 1000, {})).toBe(1);
    expect(resolveCheckpointBand(849, 1000, {})).toBe(1);
    expect(resolveCheckpointBand(850, 1000, {})).toBe(2);
    expect(resolveCheckpointBand(1000, 1000, {})).toBe(3);
    expect(resolveCheckpointBand(600, 1000, { CORTEX_COMPACTION_CHECKPOINT_PCT: '0.5' })).toBe(2);
    expect(resolveCheckpointBand(600, 1000, { CORTEX_COMPACTION_CHECKPOINT_PCT: 'junk' })).toBe(0);
    expect(resolveCheckpointBand(990, 1000, { CORTEX_COMPACTION_CHECKPOINT_PCT: '5' })).toBe(1); // clamped to 0.99
    expect(resolveCheckpointBand(500, 0, {})).toBe(0);
  });
});

describe('v3 rung re-arm', () => {
  it('re-arms so only the LAST band before the threshold fires on later cycles (unless the level is already above it)', () => {
    const env = { CORTEX_COMPACTION_CHECKPOINT_PCT: '0.75', CORTEX_COMPACTION_CHECKPOINT_STEP: '0.10' } as any;
    // bands: 0.75→1, 0.85→2, 0.95→3; last band = 3 → re-arm at 2 → next checkpoint fires at ≥95%
    expect(resolveRearmBand(5000, 14000, env)).toBe(2);
    expect(resolveCheckpointBand(13400, 14000, env)).toBe(3);   // 95.7% → fires after re-arm at 2
    expect(resolveCheckpointBand(12000, 14000, env)).toBe(2);   // 85.7% → does NOT fire after re-arm at 2
    // post-compaction level already in the last band → re-arm there (fires again only after the next compaction)
    expect(resolveRearmBand(13500, 14000, env)).toBe(3);
    expect(resolveRearmBand(5000, 0, env)).toBe(0);
  });
});
