/**
 * R217 CORTEX_FAMILY_PRESETS — preset selection per card family, flag on/off.
 * DeepSeek cards (own promptPreset 'boot-minimal') are unchanged either way; non-DeepSeek cards get
 * 'boot-minimal-generic' only with the flag on; off = the card's own preset only (byte-identical output).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SystemMessageMiddleware } from '../SystemMessageMiddleware.js';
import {
  BOOT_MINIMAL_PROMPT, BOOT_MINIMAL_GENERIC_PROMPT, SUPPRESS_CLAUSE, TURN_CONTRACT_CLAUSE, DELEGATION_HINT_CLAUSE,
  buildBootMinimalPrompt, buildBootMinimalGenericPrompt, resolveCardPreset, presetMassMode,
} from '../../system-messages/promptPresets.js';
import type { ModelConfig } from '../../models/ModelConfig.interface.js';
import { deepseekFlash } from '../../models/cards/deepseek/deepseek-flash.js';
import { deepseekV4Flash } from '../../models/cards/deepseek/deepseek-v4-flash.js';
import { deepseekV4Pro } from '../../models/cards/deepseek/deepseek-v4-pro.js';
import { deepseekV41Flash } from '../../models/cards/deepseek/deepseek-v4-1-flash.js';
import { deepseekV4FlashVisionExp } from '../../models/cards/deepseek/deepseek-v4-flash-vision-exp.js';
import { claudeSonnet46 } from '../../models/cards/anthropic/claude-sonnet-4-6.js';
import { gpt41Mini } from '../../models/cards/openai/gpt-4-1-mini.js';
import { grok43 } from '../../models/cards/xai/grok-4-3.js';
import { gemini25FlashLite } from '../../models/cards/google/gemini-2-5-flash-lite.js';

const DEEPSEEK = [deepseekFlash, deepseekV4Flash, deepseekV4Pro, deepseekV41Flash, deepseekV4FlashVisionExp];
const OTHERS = [claudeSonnet46, gpt41Mini, grok43, gemini25FlashLite];

const ctx = {
  sessionId: 's', conversationId: 'c', turnNumber: 0,
  modelId: 'x', config: { projectPath: '/tmp/__no_orient_here__' },
} as any;
const MSGS = () => ([
  { content: 'CORE PROMPT', position: 'prepend', priority: 1, wrapInSystemReminder: true,
    definition: { id: 'system_prompt', conditions: { turnNumber: 0 } } },
  { content: 'GUIDE ONE', position: 'prepend', priority: 2, wrapInSystemReminder: true,
    definition: { id: 'tool_usage_guide', conditions: { hasTools: true } } },
]);
const loader = { getMessagesForInjection: async () => MSGS() } as any;
const split = (m: ModelConfig, c = ctx) =>
  new SystemMessageMiddleware(loader, {} as any).injectWithSystemSplit('hi', m, true, c);

const KEYS = ['CORTEX_FAMILY_PRESETS', 'CORTEX_PROMPT_MASS', 'CORTEX_SYSTEM_PROMPT_FILE', 'CORTEX_ROOT',
  'CORTEX_TURN_CONTRACT', 'CORTEX_DELEGATION_HINT', 'CORTEX_TASK_INTEGRITY'];
describe('R217 family presets', () => {
  const prev: Record<string, string | undefined> = {};
  beforeEach(() => { for (const k of KEYS) { prev[k] = process.env[k]; delete process.env[k]; } });
  afterEach(() => { for (const k of KEYS) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; } });

  it('all 5 DeepSeek cards still carry boot-minimal; the others carry no preset', () => {
    for (const c of DEEPSEEK) expect((c as any).promptPreset, c.id).toBe('boot-minimal');
    for (const c of OTHERS) expect((c as any).promptPreset, c.id).toBeUndefined();
  });

  it('resolveCardPreset: off = the card\'s own preset exactly (unset / off / false / junk)', () => {
    for (const v of [undefined, 'off', 'false', '0', 'maybe']) {
      const env = v === undefined ? {} : { CORTEX_FAMILY_PRESETS: v };
      for (const c of DEEPSEEK) expect(resolveCardPreset(c as any, env)).toBe('boot-minimal');
      for (const c of OTHERS) expect(resolveCardPreset(c as any, env)).toBeUndefined();
    }
  });

  it('resolveCardPreset: on = DeepSeek keeps boot-minimal, every other family gets the generic preset', () => {
    for (const v of ['on', 'true', '1', ' ON ']) {
      for (const c of DEEPSEEK) expect(resolveCardPreset(c as any, { CORTEX_FAMILY_PRESETS: v })).toBe('boot-minimal');
      for (const c of OTHERS) expect(resolveCardPreset(c as any, { CORTEX_FAMILY_PRESETS: v }), c.id).toBe('boot-minimal-generic');
    }
    expect(presetMassMode('boot-minimal-generic')).toBe('minimal');
  });

  it('flag off: non-DeepSeek prompt is byte-identical across unset/off and keeps the full corpus', async () => {
    for (const c of OTHERS) {
      const a = await split(c);
      process.env.CORTEX_FAMILY_PRESETS = 'off';
      const b = await split(c);
      delete process.env.CORTEX_FAMILY_PRESETS;
      expect(b).toEqual(a);
      expect(a.systemPrompt).toContain('CORE PROMPT');
      expect(a.systemPrompt).toContain('GUIDE ONE');
      expect(a.systemPrompt).not.toContain('.cortex/orient');
    }
  });

  it('DeepSeek cards: output identical with the flag on and off', async () => {
    for (const c of DEEPSEEK) {
      const off = await split(c);
      process.env.CORTEX_FAMILY_PRESETS = 'on';
      const on = await split(c);
      delete process.env.CORTEX_FAMILY_PRESETS;
      expect(on).toEqual(off);
      expect(off.systemPrompt).toContain(BOOT_MINIMAL_PROMPT);
    }
  });

  it('flag on: non-DeepSeek cards get the lean frame + orient pointer, no suppression clause', async () => {
    process.env.CORTEX_FAMILY_PRESETS = 'on';
    for (const c of OTHERS) {
      const s = await split(c);
      expect(s.systemPrompt, c.id).toContain(BOOT_MINIMAL_GENERIC_PROMPT);
      expect(s.systemPrompt).toContain('sh .cortex/orient');
      expect(s.systemPrompt).not.toContain('CORE PROMPT');
      expect(s.systemPrompt).not.toContain('GUIDE ONE');
      expect(s.systemPrompt).not.toContain(SUPPRESS_CLAUSE.trim());
    }
  });

  it('flag on + resolved orient script: definite path, same as boot-minimal', async () => {
    const fs = await import('node:fs'); const os = await import('node:os'); const path = await import('node:path');
    const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'fam-orient-'));
    fs.mkdirSync(path.join(proj, '.cortex')); fs.writeFileSync(path.join(proj, '.cortex', 'orient'), 'echo hi\n');
    process.env.CORTEX_FAMILY_PRESETS = 'on';
    try {
      const s = await split(claudeSonnet46, { ...ctx, config: { projectPath: proj } });
      expect(s.systemPrompt).toContain(`sh ${path.join(proj, '.cortex', 'orient')}`);
      expect(s.systemPrompt).toContain('indexes your skill guides');
    } finally { fs.rmSync(proj, { recursive: true, force: true }); }
  });

  it('env levers still win over the family preset (PROMPT_MASS=full)', async () => {
    process.env.CORTEX_FAMILY_PRESETS = 'on';
    process.env.CORTEX_PROMPT_MASS = 'full';
    const s = await split(claudeSonnet46);
    expect(s.systemPrompt).toContain('CORE PROMPT');
    expect(s.systemPrompt).toContain('GUIDE ONE');
  });

  it('generic = boot-minimal minus only the suppression clause (both orient forms, levers compose)', () => {
    expect(BOOT_MINIMAL_GENERIC_PROMPT).toBe(BOOT_MINIMAL_PROMPT.replace(SUPPRESS_CLAUSE, ''));
    expect(BOOT_MINIMAL_GENERIC_PROMPT).not.toBe(BOOT_MINIMAL_PROMPT);
    expect(buildBootMinimalGenericPrompt(undefined, {})).toBe(BOOT_MINIMAL_GENERIC_PROMPT);
    expect(buildBootMinimalGenericPrompt('/x/orient', {})).toBe(buildBootMinimalPrompt('/x/orient', {}).replace(SUPPRESS_CLAUSE, ''));
    expect(buildBootMinimalGenericPrompt(undefined, { CORTEX_DELEGATION_HINT: 'true' })).toBe(BOOT_MINIMAL_GENERIC_PROMPT + DELEGATION_HINT_CLAUSE);
    expect(buildBootMinimalGenericPrompt(undefined, { CORTEX_TURN_CONTRACT: 'channel' })).toBe(BOOT_MINIMAL_GENERIC_PROMPT + TURN_CONTRACT_CLAUSE);
    expect(BOOT_MINIMAL_GENERIC_PROMPT).not.toMatch(/deepseek/i);
  });
});
