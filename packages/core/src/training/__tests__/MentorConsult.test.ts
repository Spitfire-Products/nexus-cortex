/**
 * mentorConsult — AskForAdvice mentor logic (MENTORSHIP_ASK_FOR_ADVICE_SPEC §4–§5).
 */
import { describe, it, expect } from 'vitest';
import {
  resolveConsultRung,
  resolveMentorConfig,
  bounceMessage,
  rateLimitedMessage,
  buildMentorUserPrompt,
  MENTOR_REFRAME_SYSTEM,
  MENTOR_INTERVIEW_SYSTEM,
} from '../mentorConsult.js';

const cfg = { maxConsults: 2 };

describe('resolveConsultRung — the graduated ladder', () => {
  it('premature (not thrashing, 0 consults) → bounce', () => {
    expect(resolveConsultRung(0, false, cfg)).toBe('bounce');
  });
  it('first honored consult (thrashing, 0 prior) → reframe', () => {
    expect(resolveConsultRung(0, true, cfg)).toBe('reframe');
  });
  it('second honored consult (thrashing, 1 prior) → interview', () => {
    expect(resolveConsultRung(1, true, cfg)).toBe('interview');
  });
  it('beyond the cap → ratelimited (even if thrashing)', () => {
    expect(resolveConsultRung(2, true, cfg)).toBe('ratelimited');
    expect(resolveConsultRung(3, true, cfg)).toBe('ratelimited');
  });
  it('rate-limit takes precedence over the bounce/thrash checks', () => {
    expect(resolveConsultRung(2, false, cfg)).toBe('ratelimited');
  });
});

describe('resolveMentorConfig', () => {
  it('reads the env cap; falls back on garbage/zero', () => {
    expect(resolveMentorConfig({ CORTEX_MENTOR_MAX_CONSULTS: '3' } as NodeJS.ProcessEnv).maxConsults).toBe(3);
    expect(resolveMentorConfig({ CORTEX_MENTOR_MAX_CONSULTS: 'x' } as NodeJS.ProcessEnv).maxConsults).toBe(2);
    expect(resolveMentorConfig({ CORTEX_MENTOR_MAX_CONSULTS: '0' } as NodeJS.ProcessEnv).maxConsults).toBe(2);
  });
});

describe('messages + prompts', () => {
  it('bounce message is constructive (reframe + distinct approach)', () => {
    const m = bounceMessage(3);
    expect(m).toContain('3 attempts');
    expect(m).toContain('reframe');
    expect(m).toContain('distinct approach');
  });
  it('rate-limited message says execute the guidance', () => {
    expect(rateLimitedMessage(2)).toContain('Execute the guidance');
  });
  it('mentor systems forbid the solution (hint-not-solution guard)', () => {
    expect(MENTOR_REFRAME_SYSTEM).toMatch(/NEVER write the solution/i);
    expect(MENTOR_INTERVIEW_SYSTEM).toMatch(/Do NOT provide the solution/i);
  });
});

describe('buildMentorUserPrompt', () => {
  const ctx = {
    task: 'Optimize the query so test.sh passes.',
    failed: [
      { call: 'psql -f query.sql', error: 'connection failed' },
      { call: 'bash test.sh', error: 'expected Spark SQL, got postgres' },
    ],
    question: 'why does the test keep failing?',
  };
  it('includes task, recent failures, and the question', () => {
    const p = buildMentorUserPrompt(ctx);
    expect(p).toContain('TASK:');
    expect(p).toContain('Optimize the query');
    expect(p).toContain('RECENT FAILED ATTEMPTS');
    expect(p).toContain('expected Spark SQL');
    expect(p).toContain('THE JUNIOR ASKS');
    expect(p).toContain('Do not write code');
  });
  it('caps the number of failed attempts included', () => {
    const many = { task: 't', failed: Array.from({ length: 20 }, (_, i) => ({ call: `c${i}`, error: `e${i}` })) };
    const p = buildMentorUserPrompt(many, 6);
    expect(p).toContain('c19'); // newest kept
    expect(p).not.toContain('c13'); // beyond the last 6 dropped
  });
  it('omits the question block when none given', () => {
    const p = buildMentorUserPrompt({ task: 't', failed: [] });
    expect(p).not.toContain('THE JUNIOR ASKS');
  });
});
