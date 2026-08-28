/**
 * toolChoiceTranslation — universal forced-tool-choice → per-provider wire shape
 * (MENTORSHIP_ASK_FOR_ADVICE_SPEC §3). Covers EVERY provider pattern.
 */
import { describe, it, expect } from 'vitest';
import { translateToolChoice } from '../toolChoiceTranslation.js';

const FORCE = { type: 'tool' as const, name: 'ask_for_advice' };

describe('translateToolChoice — universal per-provider fan-out', () => {
  it('undefined choice → undefined (leave provider default)', () => {
    expect(translateToolChoice(undefined, 'messages')).toBeUndefined();
  });

  it('unknown pattern → undefined (safe)', () => {
    expect(translateToolChoice(FORCE, 'nonsense')).toBeUndefined();
  });

  describe('messages (Anthropic / xAI / MiniMax)', () => {
    it('force → {tool_choice: {type:tool, name}}', () => {
      expect(translateToolChoice(FORCE, 'messages')).toEqual({ key: 'tool_choice', value: { type: 'tool', name: 'ask_for_advice' } });
    });
    it('auto → {type:auto}', () => {
      expect(translateToolChoice({ type: 'auto' }, 'messages')).toEqual({ key: 'tool_choice', value: { type: 'auto' } });
    });
    it('required → {type:any} (Anthropic vocabulary)', () => {
      expect(translateToolChoice({ type: 'required' }, 'messages')).toEqual({ key: 'tool_choice', value: { type: 'any' } });
    });
  });

  describe('chat/completions (OpenAI / DeepSeek / …) + hf-space', () => {
    it('force → {tool_choice:{type:function, function:{name}}}', () => {
      expect(translateToolChoice(FORCE, 'chat/completions')).toEqual({ key: 'tool_choice', value: { type: 'function', function: { name: 'ask_for_advice' } } });
    });
    it('auto/required → string forms', () => {
      expect(translateToolChoice({ type: 'auto' }, 'chat/completions')).toEqual({ key: 'tool_choice', value: 'auto' });
      expect(translateToolChoice({ type: 'required' }, 'chat/completions')).toEqual({ key: 'tool_choice', value: 'required' });
    });
    it('hf-space uses the same chat shape', () => {
      expect(translateToolChoice(FORCE, 'hf-space')).toEqual({ key: 'tool_choice', value: { type: 'function', function: { name: 'ask_for_advice' } } });
    });
  });

  describe('responses (OpenAI codex / xAI stateful) — flat', () => {
    it('force → {tool_choice:{type:function, name}} (flat, no nesting)', () => {
      expect(translateToolChoice(FORCE, 'responses')).toEqual({ key: 'tool_choice', value: { type: 'function', name: 'ask_for_advice' } });
    });
  });

  describe('google generateContent (REST HTTP) — snake_case tool_config', () => {
    it('force → tool_config with ANY mode + allowed_function_names', () => {
      expect(translateToolChoice(FORCE, 'generateContent')).toEqual({ key: 'tool_config', value: { function_calling_config: { mode: 'ANY', allowed_function_names: ['ask_for_advice'] } } });
    });
    it('auto → mode AUTO; required → mode ANY (no allow-list)', () => {
      expect(translateToolChoice({ type: 'auto' }, 'generateContent')).toEqual({ key: 'tool_config', value: { function_calling_config: { mode: 'AUTO' } } });
      expect(translateToolChoice({ type: 'required' }, 'generateContent')).toEqual({ key: 'tool_config', value: { function_calling_config: { mode: 'ANY' } } });
    });
  });

  describe('google-sdk / google-genai (@google/genai SDK config) — camelCase toolConfig', () => {
    it('force → toolConfig with ANY mode + allowedFunctionNames (camelCase)', () => {
      expect(translateToolChoice(FORCE, 'google-sdk')).toEqual({ key: 'toolConfig', value: { functionCallingConfig: { mode: 'ANY', allowedFunctionNames: ['ask_for_advice'] } } });
      expect(translateToolChoice(FORCE, 'google-genai')).toEqual({ key: 'toolConfig', value: { functionCallingConfig: { mode: 'ANY', allowedFunctionNames: ['ask_for_advice'] } } });
    });
    it('auto → mode AUTO; required → mode ANY', () => {
      expect(translateToolChoice({ type: 'auto' }, 'google-sdk')).toEqual({ key: 'toolConfig', value: { functionCallingConfig: { mode: 'AUTO' } } });
      expect(translateToolChoice({ type: 'required' }, 'google-genai')).toEqual({ key: 'toolConfig', value: { functionCallingConfig: { mode: 'ANY' } } });
    });
  });

  it('force with NO name degrades to required (never emits a broken force)', () => {
    expect(translateToolChoice({ type: 'tool' }, 'messages')).toEqual({ key: 'tool_choice', value: { type: 'any' } });
    expect(translateToolChoice({ type: 'tool' }, 'chat/completions')).toEqual({ key: 'tool_choice', value: 'required' });
  });
});
