/**
 * 2026-10-01 wall levers (c22: 69 reasoning-exhaustion walls in ~19.6K calls; the 65K dead reasoning stayed in history and rode along in every
 * later call; acted-call reasoning p99.9 = 40K, only 7 of 19,337 acting calls above 48K).
 *  - CORTEX_WALL_DROP: drop the walled (reasoning-only, truncated) assistant turn from the in-memory history before the retry and carry the
 *    nudge at the tail of the newest tool_result → the retry is the exact pre-wall prefix + the nudge (cache-preserving).
 *  - CORTEX_OUTPUT_CAP_TOKENS: per-call output cap for the action model (fills maxTokens only when the request did not set one).
 */
import { describe, it, expect } from 'vitest';
import { resolveWallDrop, resolveOutputCap, dropWalledTurn } from '../wallGuard.js';

describe('CORTEX_WALL_DROP / CORTEX_OUTPUT_CAP_TOKENS resolvers', () => {
  it('wall drop: off by default; on/true/1 enable', () => {
    expect(resolveWallDrop({})).toBe(false);
    for (const v of ['on', 'true', '1', 'ON']) expect(resolveWallDrop({ CORTEX_WALL_DROP: v })).toBe(true);
    expect(resolveWallDrop({ CORTEX_WALL_DROP: 'off' })).toBe(false);
  });
  it('output cap: unset/invalid/too small = none; integer >= 1024 kept', () => {
    expect(resolveOutputCap({})).toBeUndefined();
    expect(resolveOutputCap({ CORTEX_OUTPUT_CAP_TOKENS: '48000' })).toBe(48000);
    expect(resolveOutputCap({ CORTEX_OUTPUT_CAP_TOKENS: 'abc' })).toBeUndefined();
    expect(resolveOutputCap({ CORTEX_OUTPUT_CAP_TOKENS: '500' })).toBeUndefined();
    expect(resolveOutputCap({ CORTEX_OUTPUT_CAP_TOKENS: '0' })).toBeUndefined();
  });
});

describe('dropWalledTurn', () => {
  const user0 = { type: 'user', message: { role: 'user', content: 'do the task' } };
  const asst1 = { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: {} }] } };
  const res1 = () => ({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } });
  const wall = () => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'x'.repeat(5000) }] } });
  it('removes the walled assistant turn and puts the nudge at the tail of the newest tool_result', () => {
    const h: any[] = [user0, asst1, res1(), wall()];
    const r = dropWalledTurn(h, '<system-reminder>NUDGE</system-reminder>');
    expect(r).toMatchObject({ dropped: true, carrier: 'tool_result', droppedChars: 5000 });
    expect(h.length).toBe(3);
    expect(h[2].message.content[0].content.endsWith('<system-reminder>NUDGE</system-reminder>')).toBe(true);
    expect(JSON.stringify(h[1])).toBe(JSON.stringify(asst1)); // the earlier prefix is untouched
  });
  it('no tool_result before the wall (wall on the first call): drops, carrier none (caller pushes a user message)', () => {
    const h: any[] = [user0, wall()];
    const r = dropWalledTurn(h, 'N');
    expect(r).toMatchObject({ dropped: true, carrier: 'none' });
    expect(h.length).toBe(1);
  });
  it('refuses when the last message is not an assistant turn (nothing dropped)', () => {
    const h: any[] = [user0, asst1, res1()];
    expect(dropWalledTurn(h, 'N')).toMatchObject({ dropped: false });
    expect(h.length).toBe(3);
  });
  it('refuses when the last assistant turn carries a tool call (never drops a turn whose reasoning must round-trip)', () => {
    const h: any[] = [user0, asst1];
    expect(dropWalledTurn(h, 'N')).toMatchObject({ dropped: false });
    expect(h.length).toBe(2);
  });
});

import { resolveWallSummary, extractWalledReasoning, clipReasoning, buildWallSummaryPrompt, formatWallSummary, WALL_SUMMARY_SYSTEM } from '../wallGuard.js';

describe('HB-WALL-SUMMARY helpers', () => {
  it('off by default; on enables with a 30 s default timeout', () => {
    expect(resolveWallSummary({}).enabled).toBe(false);
    expect(resolveWallSummary({ CORTEX_WALL_SUMMARY: 'on' })).toMatchObject({ enabled: true, timeoutMs: 30000 });
    expect(resolveWallSummary({ CORTEX_WALL_SUMMARY: 'on', CORTEX_WALL_SUMMARY_TIMEOUT_MS: '9000' }).timeoutMs).toBe(9000);
  });
  it('extracts the reasoning of the newest assistant turn (thinking blocks only)', () => {
    const h = [
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'OLD' }] } },
      { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'r' }] } },
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'A' }, { type: 'thinking', thinking: 'B' }] } },
    ];
    expect(extractWalledReasoning(h)).toBe('A\nB');
    expect(extractWalledReasoning([{ type: 'user', message: { role: 'user', content: 'x' } }])).toBe('');
  });
  it('clips to head + tail with an elision marker', () => {
    const t = 'H'.repeat(100) + 'M'.repeat(10000) + 'T'.repeat(100);
    const c = clipReasoning(t, 50, 80);
    expect(c.startsWith('H'.repeat(50))).toBe(true);
    expect(c.endsWith('T'.repeat(80))).toBe(true);
    expect(c).toContain('characters omitted');
    expect(clipReasoning('short', 50, 80)).toBe('short');
  });
  it('prompt carries the clipped reasoning; persona asks for CONCLUDED / STUCK ON / NEXT', () => {
    expect(buildWallSummaryPrompt('the thoughts')).toContain('the thoughts');
    expect(WALL_SUMMARY_SYSTEM).toMatch(/CONCLUDED/);
    expect(WALL_SUMMARY_SYSTEM).toMatch(/STUCK ON/);
    expect(WALL_SUMMARY_SYSTEM).toMatch(/NEXT/);
  });
  it('formats an attributed block (helper-written, never presented as the model\'s own thinking), capped; empty in → empty out', () => {
    const f = formatWallSummary('CONCLUDED: a\nSTUCK ON: b\nNEXT: c');
    expect(f).toMatch(/summary written by the harness/i);
    expect(f).toContain('CONCLUDED: a');
    expect(formatWallSummary('   ')).toBe('');
    expect(formatWallSummary('x'.repeat(5000)).length).toBeLessThan(1700);
  });
});
