/**
 * Hybrid split: injectWithSystemSplit must route turn-varying system messages
 * (e.g. periodic_reminder, turnNumberModulo) into the MOVING user turn — which
 * sits after every provider's cache boundary — while turn-0-static content
 * stays in the cached/pinned `system` field. This preserves periodic/phased
 * message semantics without busting the xAI cross-turn prompt cache.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { SystemMessageMiddleware } from '../SystemMessageMiddleware.js';

const model: any = { api: { pattern: 'messages' }, reasoning: {}, tools: {}, streaming: {} };
const ctx: any = { sessionId: 's1', conversationId: 'c1', turnNumber: 0, modelId: 'm', config: {} };

function mw(messages: any[]): SystemMessageMiddleware {
  const loader: any = { getMessagesForInjection: async () => messages };
  return new SystemMessageMiddleware(loader, {} as any);
}
const def = (conditions: any) => ({ conditions, injection: {} });

describe('injectWithSystemSplit hybrid', () => {
  it('keeps turn-0-static in systemPrompt, routes turn-varying into the moving user turn', async () => {
    const m = mw([
      { content: 'STATIC_SYSTEM_PROMPT', position: 'prepend', priority: 1,
        wrapInSystemReminder: false, contentHash: 'h1', definition: def({ turnNumber: 0 }) },
      { content: 'PERIODIC_REMINDER_TEXT', position: 'prepend', priority: 10,
        wrapInSystemReminder: true, contentHash: 'h2',
        definition: def({ hasTools: true, turnNumberModulo: { divisor: 10, remainder: 0 } }) },
    ]);

    const r = await m.injectWithSystemSplit('hello from user', model, true, ctx);

    // static -> pinned system field, NOT the moving turn
    expect(r.systemPrompt).toContain('STATIC_SYSTEM_PROMPT');
    expect(r.systemPrompt).not.toContain('PERIODIC_REMINDER_TEXT');

    // varying -> front of the moving user turn (after the cache boundary),
    // wrapped as authored; the user's actual text follows it
    const texts = r.userContent.map((b: any) => b.text);
    expect(texts[0]).toBe('<harness-note source="automated-harness" from-user="false">\nPERIODIC_REMINDER_TEXT\n</harness-note>');
    expect(texts).toContain('<user_query>\nhello from user\n</user_query>');
    expect(texts.join('')).not.toContain('STATIC_SYSTEM_PROMPT');
  });

  it('all-static: moving turn is left lean (bare user content), system holds everything', async () => {
    const m = mw([
      { content: 'A', position: 'prepend', priority: 1, wrapInSystemReminder: false,
        contentHash: 'a', definition: def({ turnNumber: 0 }) },
      { content: 'B', position: 'append', priority: 2, wrapInSystemReminder: false,
        contentHash: 'b', definition: def({ sessionPhase: ['start', 'ongoing'] }) },
    ]);

    const r = await m.injectWithSystemSplit('just the user', model, true, ctx);

    expect(r.systemPrompt).toBe('A\nB'); // prepend before append
    expect(r.userContent).toEqual([{ type: 'text', text: '<user_query>\njust the user\n</user_query>' }]);
  });

  it('all-varying: systemPrompt is undefined, everything rides the moving turn', async () => {
    const m = mw([
      { content: 'V', position: 'prepend', priority: 5, wrapInSystemReminder: false,
        contentHash: 'v', definition: def({ turnNumber: 3 }) },
    ]);

    const r = await m.injectWithSystemSplit('u', model, true, ctx);

    expect(r.systemPrompt).toBeUndefined();
    expect(r.userContent.map((b: any) => b.text)).toEqual(['V', '<user_query>\nu\n</user_query>']);
  });
});
