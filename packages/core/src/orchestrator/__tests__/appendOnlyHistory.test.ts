/**
 * Append-only history levers (R221-R228, dark) — pure helpers. The end-to-end proof (prefix divergence gone with the flag on, unchanged
 * with it off) is the prefix-stability harness (prefixStability.integration.test.ts with PREFIX_EXTRA_ENV).
 */
import { describe, it, expect } from 'vitest';
import {
  resolveWallCacheFix, resolvePersistInjected, resolveAppendOnlyTools, resolveKeepMentorMessages, resolveResponsesSliceAll,
  chainedSliceStart, tailUnitAfterLastAssistant, isPreviousResponseUnavailable,
} from '../appendOnlyHistory.js';
import { dropWalledTurn } from '../wallGuard.js';
import { ClientSideToolFilter } from '../../tools/ClientSideToolFilter.js';

describe('flag resolvers (all dark)', () => {
  const all = [
    [resolveWallCacheFix, 'CORTEX_WALL_CACHE_FIX'], [resolvePersistInjected, 'CORTEX_PERSIST_INJECTED'],
    [resolveAppendOnlyTools, 'CORTEX_APPEND_ONLY_TOOLS'], [resolveKeepMentorMessages, 'CORTEX_KEEP_MENTOR_MESSAGES'],
    [resolveResponsesSliceAll, 'CORTEX_RESPONSES_SLICE_ALL'],
  ] as const;
  for (const [fn, key] of all) {
    it(`${key}: unset/off → false; on|true|1 → true`, () => {
      expect(fn({})).toBe(false);
      expect(fn({ [key]: 'off' })).toBe(false);
      expect(fn({ [key]: ' On ' })).toBe(true);
      expect(fn({ [key]: 'true' })).toBe(true);
      expect(fn({ [key]: '1' })).toBe(true);
    });
  }
});

describe('chainedSliceStart', () => {
  it('no checkpoint → 0 (send all)', () => expect(chainedSliceStart(0, 5)).toBe(0));
  it('checkpoint inside history → slice from it', () => expect(chainedSliceStart(3, 5)).toBe(3));
  it('history shrank below the checkpoint → slice from the end', () => expect(chainedSliceStart(7, 5)).toBe(5));
});

describe('tailUnitAfterLastAssistant', () => {
  it('returns every message after the newest assistant turn', () => {
    const h = [{ uuid: 'u0', message: { role: 'user' } }, { uuid: 'a1', message: { role: 'assistant' } }, { uuid: 't1', message: { role: 'user' } }, { uuid: 'm1', message: { role: 'user' } }];
    expect(tailUnitAfterLastAssistant(h).map((m) => m.uuid).sort()).toEqual(['m1', 't1']);
    expect(tailUnitAfterLastAssistant([...h, { uuid: 'a2', message: { role: 'assistant' } }])).toEqual([]);
  });
});

describe('isPreviousResponseUnavailable (R228 fallback trigger)', () => {
  it('matches the providers\' lost-chain errors', () => {
    expect(isPreviousResponseUnavailable({ status: 404, message: "Previous response with id 'resp_1' not found." })).toBe(true);
    expect(isPreviousResponseUnavailable({ status: 400, error: { message: 'previous_response_id is invalid or expired' } })).toBe(true);
    expect(isPreviousResponseUnavailable({ status: 404, message: 'Response resp_9 does not exist' })).toBe(true);
  });
  it('does not match unrelated failures', () => {
    expect(isPreviousResponseUnavailable({ status: 404, message: 'model not found' })).toBe(false);
    expect(isPreviousResponseUnavailable({ status: 500, message: 'internal error' })).toBe(false);
    expect(isPreviousResponseUnavailable(new Error('ECONNRESET'))).toBe(false);
  });
});

describe('dropWalledTurn carrierMessage (R221)', () => {
  it('names the record that received the nudge so its cached conversion can be invalidated', () => {
    const res = { uuid: 'r1', type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } };
    const h: any[] = [
      { uuid: 'u0', type: 'user', message: { role: 'user', content: 'go' } },
      { uuid: 'a1', type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: {} }] } },
      res,
      { uuid: 'w', type: 'assistant', message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'x' }] } },
    ];
    const r = dropWalledTurn(h, 'N');
    expect(r).toMatchObject({ dropped: true, carrier: 'tool_result' });
    expect(r.carrierMessage).toBe(res);
  });
});

describe('ClientSideToolFilter append-only (R222)', () => {
  const T = (name: string, essential = false) => ({ name, description: name, inputSchema: {}, ...(essential ? { discoveryTier: 'essential' } : {}) }) as any;
  const all = [T('Bash', true), T('Alpha'), T('Edit', true), T('Beta'), T('Gamma')];
  it('off: allTools order, first-used tool inserted mid-array (pre-existing behaviour)', () => {
    const f = new ClientSideToolFilter();
    expect(f.getFilteredTools(all).map((t) => t.name)).toEqual(['Bash', 'Edit']);
    f.recordToolUse('Alpha');
    expect(f.getFilteredTools(all).map((t) => t.name)).toEqual(['Bash', 'Alpha', 'Edit']);
  });
  it('on: newly enabled tools APPEND in first-enable order; nothing is evicted or reordered', () => {
    const f = new ClientSideToolFilter();
    const on = { appendOnly: true };
    expect(f.getFilteredTools(all, on).map((t) => t.name)).toEqual(['Bash', 'Edit']);
    f.recordToolUse('Gamma');
    expect(f.getFilteredTools(all, on).map((t) => t.name)).toEqual(['Bash', 'Edit', 'Gamma']);
    f.recordToolUse('Alpha');
    expect(f.getFilteredTools(all, on).map((t) => t.name)).toEqual(['Bash', 'Edit', 'Gamma', 'Alpha']);
    // Push Gamma + Alpha out of the 15-slot recent list: they stay (no eviction), positions unchanged.
    for (let i = 0; i < 20; i++) f.recordToolUse(`Other${i}`);
    expect(f.getFilteredTools(all, on).map((t) => t.name)).toEqual(['Bash', 'Edit', 'Gamma', 'Alpha']);
    // Input order does not matter (initial request vs continuation pass different arrays).
    expect(f.getFilteredTools([...all].reverse(), on).map((t) => t.name)).toEqual(['Bash', 'Edit', 'Gamma', 'Alpha']);
  });
  it('on: a tool no longer offered at all is not sent', () => {
    const f = new ClientSideToolFilter();
    f.recordToolUse('Beta');
    f.getFilteredTools(all, { appendOnly: true });
    expect(f.getFilteredTools(all.filter((t) => t.name !== 'Beta'), { appendOnly: true }).map((t) => t.name)).toEqual(['Bash', 'Edit']);
  });
  it('isPreviousResponseUnavailable matches the live xAI + OpenAI chain-miss errors (probe 2026-10-02)', () => {
    expect(isPreviousResponseUnavailable(new Error('XAI Responses API error 404: {"code":"not-found","error":"Response with id=resp_doesnotexist000 not found"}'))).toBe(true);
    expect(isPreviousResponseUnavailable({ status: 400, message: "Previous response with id 'resp_doesnotexist000' not found." })).toBe(true);
    expect(isPreviousResponseUnavailable(new Error('XAI Responses API error 429: rate limited'))).toBe(false);
  });
});
