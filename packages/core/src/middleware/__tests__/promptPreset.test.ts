/**
 * Card-level promptPreset (P6f productization): 'boot-minimal' on a model card
 * applies the minimal mass filter AND swaps the core system prompt for the
 * packaged boot-observation text — unless the env experiment levers
 * (CORTEX_PROMPT_MASS / CORTEX_SYSTEM_PROMPT_FILE) are set, which always win.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SystemMessageMiddleware } from '../SystemMessageMiddleware.js';
import { BOOT_MINIMAL_PROMPT } from '../../system-messages/promptPresets.js';
import type { ModelConfig } from '../../models/ModelConfig.interface.js';

const mkModel = (preset?: string) => ({
  id: 'deepseek-v4-flash',
  api: { pattern: 'chat/completions' },
  reasoning: { supported: false },
  tools: { supported: true },
  streaming: { supported: true },
  ...(preset ? { promptPreset: preset } : {}),
}) as unknown as ModelConfig;

const ctx = {
  sessionId: 's', conversationId: 'c', turnNumber: 0,
  modelId: 'deepseek-v4-flash', config: { projectPath: '/tmp' },
} as any;

const MSGS = () => ([
  { content: 'CORE PROMPT', position: 'prepend', priority: 1, wrapInSystemReminder: true,
    definition: { id: 'system_prompt', conditions: { turnNumber: 0 } } },
  { content: 'GUIDE ONE', position: 'prepend', priority: 2, wrapInSystemReminder: true,
    definition: { id: 'tool_usage_guide', conditions: { hasTools: true } } },
]);
const loader = { getMessagesForInjection: async () => MSGS() } as any;

describe('card-level promptPreset', () => {
  const prevMass = process.env.CORTEX_PROMPT_MASS;
  const prevFile = process.env.CORTEX_SYSTEM_PROMPT_FILE;
  beforeEach(() => {
    delete process.env.CORTEX_PROMPT_MASS;
    delete process.env.CORTEX_SYSTEM_PROMPT_FILE;
  });
  afterEach(() => {
    if (prevMass === undefined) delete process.env.CORTEX_PROMPT_MASS;
    else process.env.CORTEX_PROMPT_MASS = prevMass;
    if (prevFile === undefined) delete process.env.CORTEX_SYSTEM_PROMPT_FILE;
    else process.env.CORTEX_SYSTEM_PROMPT_FILE = prevFile;
  });

  it('boot-minimal: minimal filter + packaged prompt text', async () => {
    const mw = new SystemMessageMiddleware(loader, {} as any);
    const split = await mw.injectWithSystemSplit('hi', mkModel('boot-minimal'), true, ctx);
    expect(split.systemPrompt).toContain(BOOT_MINIMAL_PROMPT);
    expect(split.systemPrompt).not.toContain('CORE PROMPT');
    expect(split.systemPrompt).not.toContain('GUIDE ONE');
  });

  it('no preset: full corpus, original prompt (default unchanged)', async () => {
    const mw = new SystemMessageMiddleware(loader, {} as any);
    const split = await mw.injectWithSystemSplit('hi', mkModel(), true, ctx);
    expect(split.systemPrompt).toContain('CORE PROMPT');
    expect(split.systemPrompt).toContain('GUIDE ONE');
  });

  it('env CORTEX_PROMPT_MASS beats the card preset', async () => {
    process.env.CORTEX_PROMPT_MASS = 'full';
    const mw = new SystemMessageMiddleware(loader, {} as any);
    const split = await mw.injectWithSystemSplit('hi', mkModel('boot-minimal'), true, ctx);
    // env said full → corpus present, original prompt kept
    expect(split.systemPrompt).toContain('CORE PROMPT');
    expect(split.systemPrompt).toContain('GUIDE ONE');
  });

  it('env CORTEX_SYSTEM_PROMPT_FILE suppresses the preset text swap', async () => {
    process.env.CORTEX_SYSTEM_PROMPT_FILE = '/tmp/whatever.md';
    const mw = new SystemMessageMiddleware(loader, {} as any);
    const split = await mw.injectWithSystemSplit('hi', mkModel('boot-minimal'), true, ctx);
    // mass still minimal (from preset) but content NOT swapped (loader owns file override)
    expect(split.systemPrompt).toContain('CORE PROMPT');
    expect(split.systemPrompt).not.toContain('GUIDE ONE');
  });
});
