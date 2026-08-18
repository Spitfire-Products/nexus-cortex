/**
 * P6 deferral (CORTEX_PROMPT_MASS=defer): turn-1 behaves exactly like
 * 'minimal' (only the core system_prompt + turn-varying messages), and
 * buildDeferredStaticCorpus returns precisely the complement — every static
 * doc EXCEPT system_prompt, no turn-varying content — for one-shot delivery
 * at the anchor-lift boundary.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SystemMessageMiddleware } from '../SystemMessageMiddleware.js';
import type { ModelConfig } from '../../models/ModelConfig.interface.js';

const model = {
  id: 'deepseek-v4-flash',
  api: { pattern: 'chat/completions' },
  reasoning: { supported: false },
  tools: { supported: true },
  streaming: { supported: true },
} as unknown as ModelConfig;

const ctx = {
  sessionId: 's', conversationId: 'c', turnNumber: 0,
  modelId: 'deepseek-v4-flash', config: { projectPath: '/tmp' },
} as any;

// Fake loader: 1 core prompt + 2 static guides + 1 turn-varying reminder
const MSGS = [
  { content: 'CORE PROMPT', position: 'prepend', priority: 1, wrapInSystemReminder: true,
    definition: { id: 'system_prompt', conditions: { turnNumber: 0 } } },
  { content: 'GUIDE ONE', position: 'prepend', priority: 2, wrapInSystemReminder: true,
    definition: { id: 'tool_usage_guide', conditions: { hasTools: true } } },
  { content: 'GUIDE TWO', position: 'append', priority: 3, wrapInSystemReminder: true,
    definition: { id: 'work_quality', conditions: { hasTools: true } } },
  { content: 'PERIODIC NOTE', position: 'prepend', priority: 10, wrapInSystemReminder: true,
    definition: { id: 'periodic_reminder', conditions: { turnNumberModulo: { divisor: 10, remainder: 0 } } } },
];
const loader = { getMessagesForInjection: async () => MSGS } as any;

describe('CORTEX_PROMPT_MASS=defer', () => {
  const prev = process.env.CORTEX_PROMPT_MASS;
  beforeEach(() => { process.env.CORTEX_PROMPT_MASS = 'defer'; });
  afterEach(() => {
    if (prev === undefined) delete process.env.CORTEX_PROMPT_MASS;
    else process.env.CORTEX_PROMPT_MASS = prev;
  });

  it('turn-1 split matches minimal: only system_prompt in the system field', async () => {
    const mw = new SystemMessageMiddleware(loader, {} as any);
    const split = await mw.injectWithSystemSplit('hi', model, true, ctx);
    expect(split.systemPrompt).toContain('CORE PROMPT');
    expect(split.systemPrompt).not.toContain('GUIDE ONE');
    expect(split.systemPrompt).not.toContain('GUIDE TWO');
    // turn-varying still rides the user turn
    const userText = split.userContent.map((b: any) => b.text || '').join('\n');
    expect(userText).toContain('PERIODIC NOTE');
  });

  it('buildDeferredStaticCorpus returns exactly the dropped statics', async () => {
    const mw = new SystemMessageMiddleware(loader, {} as any);
    const corpus = await mw.buildDeferredStaticCorpus(model, true, ctx);
    expect(corpus).toContain('GUIDE ONE');
    expect(corpus).toContain('GUIDE TWO');
    expect(corpus).not.toContain('CORE PROMPT');
    expect(corpus).not.toContain('PERIODIC NOTE');
    // prepend-before-append, priority order preserved
    expect(corpus!.indexOf('GUIDE ONE')).toBeLessThan(corpus!.indexOf('GUIDE TWO'));
  });

  it('full mode is untouched: everything static stays in the system field', async () => {
    process.env.CORTEX_PROMPT_MASS = '';
    const mw = new SystemMessageMiddleware(loader, {} as any);
    const split = await mw.injectWithSystemSplit('hi', model, true, ctx);
    expect(split.systemPrompt).toContain('CORE PROMPT');
    expect(split.systemPrompt).toContain('GUIDE ONE');
    expect(split.systemPrompt).toContain('GUIDE TWO');
  });
});
