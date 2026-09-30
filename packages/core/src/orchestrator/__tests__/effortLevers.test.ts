/**
 * 2026-09-30 effort levers (TB4 t4cw traces: the action model reasoned to the 65,536-token wall right after reading the task).
 *  - R153c provider-aware exhaustion ladder: DeepSeek reasoning_effort is low | high | max (medium runs as HIGH), so the old
 *    high → medium step was a no-op; with the provider ladder high → low.
 *  - HB-EFFORT-RAMP (CORTEX_EFFORT_RAMP): the first N action calls of a turn run at a lower level, then the configured effort.
 *  - HB-COMPUTE-NUDGE (CORTEX_COMPUTE_NUDGE): after a step that reasoned past a token threshold, a tail line tells the model to
 *    compute/test instead of deliberating.
 */
import { describe, it, expect } from 'vitest';
import { stepDownEffort, effortLadderFor, resolveExhaustLadderMode } from '../emptyResponseClassifier.js';
import { resolveEffortRamp, rampEffortFor } from '../effortRamp.js';
import { resolveComputeNudge, computeNudgeDecision, buildComputeNudgeLine, lastAssistantReasoningTokens } from '../computeNudge.js';

describe('R153c provider-aware exhaustion ladder', () => {
  it('deepseek ladder has no medium', () => {
    expect(effortLadderFor('deepseek')).toEqual(['low', 'high', 'max']);
    expect(effortLadderFor('anthropic')).toEqual(['low', 'medium', 'high']);
    expect(effortLadderFor(undefined)).toEqual(['low', 'medium', 'high']);
  });
  it('deepseek: high → low (not medium), max → high, medium (= high) → low, card default → low, low stays low', () => {
    const ds = effortLadderFor('deepseek');
    expect(stepDownEffort('high', ds)).toBe('low');
    expect(stepDownEffort('max', ds)).toBe('high');
    expect(stepDownEffort('xhigh', ds)).toBe('high');
    expect(stepDownEffort('medium', ds)).toBe('low');
    expect(stepDownEffort(undefined, ds)).toBe('low');
    expect(stepDownEffort('low', ds)).toBe('low');
    expect(stepDownEffort('none', ds)).toBe('low');
  });
  it('default ladder keeps the legacy steps', () => {
    const d = effortLadderFor('openai');
    expect(stepDownEffort('max', d)).toBe('medium');
    expect(stepDownEffort('high', d)).toBe('medium');
    expect(stepDownEffort('medium', d)).toBe('low');
    expect(stepDownEffort(undefined, d)).toBe('medium');
  });
  it('no ladder argument = legacy behaviour exactly', () => {
    expect(stepDownEffort('high')).toBe('medium');
    expect(stepDownEffort('max')).toBe('medium');
    expect(stepDownEffort(undefined)).toBe('medium');
  });
  it('CORTEX_REASONING_EXHAUST_LADDER: provider (default) | legacy', () => {
    expect(resolveExhaustLadderMode({})).toBe('provider');
    expect(resolveExhaustLadderMode({ CORTEX_REASONING_EXHAUST_LADDER: 'legacy' })).toBe('legacy');
    expect(resolveExhaustLadderMode({ CORTEX_REASONING_EXHAUST_LADDER: 'junk' })).toBe('provider');
  });
});

describe('HB-EFFORT-RAMP', () => {
  it('unset / off = disabled', () => {
    expect(resolveEffortRamp({}).enabled).toBe(false);
    expect(resolveEffortRamp({ CORTEX_EFFORT_RAMP: 'off' }).enabled).toBe(false);
    expect(resolveEffortRamp({ CORTEX_EFFORT_RAMP: 'false' }).enabled).toBe(false);
  });
  it('parses level:calls; bare level defaults to 8 calls; on = low:8', () => {
    expect(resolveEffortRamp({ CORTEX_EFFORT_RAMP: 'low:6' })).toEqual({ enabled: true, level: 'low', calls: 6 });
    expect(resolveEffortRamp({ CORTEX_EFFORT_RAMP: 'low' })).toEqual({ enabled: true, level: 'low', calls: 8 });
    expect(resolveEffortRamp({ CORTEX_EFFORT_RAMP: 'on' })).toEqual({ enabled: true, level: 'low', calls: 8 });
    expect(resolveEffortRamp({ CORTEX_EFFORT_RAMP: 'low:0' }).enabled).toBe(false);
    expect(resolveEffortRamp({ CORTEX_EFFORT_RAMP: 'low:500' }).calls).toBe(100);
    expect(resolveEffortRamp({ CORTEX_EFFORT_RAMP: 'bogus:3' }).enabled).toBe(false);
  });
  it('ramps the first N calls (call index 0 = the turn\'s initial request), then yields to the configured effort', () => {
    const cfg = resolveEffortRamp({ CORTEX_EFFORT_RAMP: 'low:3' });
    expect(rampEffortFor(cfg, 0)).toBe('low');
    expect(rampEffortFor(cfg, 2)).toBe('low');
    expect(rampEffortFor(cfg, 3)).toBeUndefined();
    expect(rampEffortFor(resolveEffortRamp({}), 0)).toBeUndefined();
  });
});

describe('HB-COMPUTE-NUDGE', () => {
  it('off by default; on with threshold / cooldown / per-turn max', () => {
    expect(resolveComputeNudge({}).enabled).toBe(false);
    expect(resolveComputeNudge({ CORTEX_COMPUTE_NUDGE: 'on' })).toEqual({ enabled: true, thresholdTokens: 16000, cooldownRounds: 3, maxPerTurn: 6 });
    expect(resolveComputeNudge({ CORTEX_COMPUTE_NUDGE: 'on', CORTEX_COMPUTE_NUDGE_TOKENS: '24000' }).thresholdTokens).toBe(24000);
    expect(resolveComputeNudge({ CORTEX_COMPUTE_NUDGE: 'on', CORTEX_COMPUTE_NUDGE_TOKENS: 'x' }).thresholdTokens).toBe(16000);
  });
  it('fires above the threshold, respects cooldown and the per-turn cap', () => {
    const cfg = resolveComputeNudge({ CORTEX_COMPUTE_NUDGE: 'on' });
    expect(computeNudgeDecision(cfg, { reasoningTokens: 15000, round: 4, lastFiredRound: -99, firedThisTurn: 0 })).toBe(false);
    expect(computeNudgeDecision(cfg, { reasoningTokens: 34000, round: 4, lastFiredRound: -99, firedThisTurn: 0 })).toBe(true);
    expect(computeNudgeDecision(cfg, { reasoningTokens: 34000, round: 5, lastFiredRound: 4, firedThisTurn: 1 })).toBe(false); // cooldown
    expect(computeNudgeDecision(cfg, { reasoningTokens: 34000, round: 7, lastFiredRound: 4, firedThisTurn: 1 })).toBe(true);
    expect(computeNudgeDecision(cfg, { reasoningTokens: 34000, round: 40, lastFiredRound: 30, firedThisTurn: 6 })).toBe(false); // cap
    expect(computeNudgeDecision(resolveComputeNudge({}), { reasoningTokens: 90000, round: 4, lastFiredRound: -99, firedThisTurn: 0 })).toBe(false);
  });
  it('line names the spent tokens and tells the model to compute/test', () => {
    const line = buildComputeNudgeLine(34479);
    expect(line.startsWith('<system-reminder>')).toBe(true);
    expect(line.endsWith('</system-reminder>')).toBe(true);
    expect(line).toContain('~34K reasoning tokens');
    expect(line).toMatch(/script|checker/);
  });
  it('reads reasoning tokens from the newest assistant message (usage.reasoningTokens, then output_tokens)', () => {
    const h = [
      { role: 'assistant', usage: { reasoningTokens: 50000, outputTokens: 51000 } },
      { role: 'user', content: [{ type: 'tool_result', content: 'x' }] },
      { message: { role: 'assistant' }, usage: { reasoningTokens: 34479, outputTokens: 35383 } },
      { role: 'user', content: [{ type: 'tool_result', content: 'y' }] },
    ];
    expect(lastAssistantReasoningTokens(h)).toBe(34479);
    expect(lastAssistantReasoningTokens([{ role: 'assistant', usage: { output_tokens: 20000 } }])).toBe(20000);
    expect(lastAssistantReasoningTokens([{ role: 'user' }])).toBe(0);
  });
});
