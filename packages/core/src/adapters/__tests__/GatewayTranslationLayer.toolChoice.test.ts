/**
 * AskForAdvice v2 §13-B1: prepareRequest carries a forced tool_choice to the wire,
 * name-converted AT THE GATEWAY (canonical `AskForAdvice` → wire `ask_for_advice` for
 * snake_case providers like deepseek), and ONLY when tools are actually sent. This is
 * the load-bearing wiring for the forced-choice backstop — if the name isn't converted,
 * the provider rejects the forced tool and the mentor hint never fires.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { GatewayTranslationLayer } from '../GatewayTranslationLayer.js';
import { deepseekV4Flash } from '../../models/cards/deepseek/deepseek-v4-flash.js';
import { claudeOpus55 } from '../../models/cards/anthropic/claude-opus-5-5.js';
import { claudeSonnet55 } from '../../models/cards/anthropic/claude-sonnet-5-5.js';
import { claudeFable51 } from '../../models/cards/anthropic/claude-fable-5-1.js';
import { claudeOpus5 } from '../../models/cards/anthropic/claude-opus-5.js';
import type { CanonicalMessage, CanonicalTool } from '@nexus-cortex/types';

const STUB_KEYS = ['DEEPSEEK_API_KEY', 'ANTHROPIC_API_KEY'] as const;
const saved: Record<string, string | undefined> = {};
beforeAll(() => {
  for (const k of STUB_KEYS) { saved[k] = process.env[k]; if (!process.env[k]) process.env[k] = 'test-key-not-real'; }
});
afterAll(() => {
  for (const k of STUB_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

const gw = new GatewayTranslationLayer();

const userMsg: CanonicalMessage = {
  uuid: 'msg_tc_001',
  timestamp: '2026-08-28T00:00:00Z',
  timeline: { sessionId: 's', conversationId: 'c', turnNumber: 5 },
  role: 'user',
  type: 'text',
  content: [{ type: 'text', text: 'solve it' }],
  model: { id: 'deepseek-v4-flash', provider: 'deepseek', apiPattern: 'chat/completions' },
};

const askTool: CanonicalTool = {
  name: 'AskForAdvice',
  description: 'Consult a senior engineer for a hint when stuck.',
  schema: { type: 'object', properties: { question: { type: 'string' } } },
};

describe('prepareRequest — forced tool_choice (§13-B1)', () => {
  it('name-converts AND provider-shapes the forced tool at the gateway (deepseek = chat/completions)', () => {
    const req = gw.prepareRequest([userMsg], [askTool], deepseekV4Flash, {
      toolChoice: { type: 'tool', name: 'AskForAdvice' },
    });
    // Gateway does BOTH: naming (AskForAdvice→ask_for_advice) + schema shape (chat/completions).
    expect(req.toolChoice).toEqual({
      key: 'tool_choice',
      value: { type: 'function', function: { name: 'ask_for_advice' } },
    });
  });

  it('OMITS the forced tool_choice when no tools are sent (a forced tool needs the tool present)', () => {
    const req = gw.prepareRequest([userMsg], undefined, deepseekV4Flash, {
      toolChoice: { type: 'tool', name: 'AskForAdvice' },
    });
    expect(req.toolChoice).toBeUndefined();
  });

  it('shapes a non-tool choice (required) to the provider form', () => {
    const req = gw.prepareRequest([userMsg], [askTool], deepseekV4Flash, {
      toolChoice: { type: 'required' },
    });
    expect(req.toolChoice).toEqual({ key: 'tool_choice', value: 'required' });
  });

  it('sets no toolChoice on the default path (no option passed) — zero effect on shipped behavior', () => {
    const req = gw.prepareRequest([userMsg], [askTool], deepseekV4Flash, {});
    expect(req.toolChoice).toBeUndefined();
  });
});

const otherTool: CanonicalTool = {
  name: 'Bash',
  description: 'Run a shell command.',
  schema: { type: 'object', properties: { command: { type: 'string' } } },
};

describe('prepareRequest — forced tool_choice capability gate (tools.supportsToolChoice === false)', () => {
  for (const card of [claudeOpus55, claudeSonnet55, claudeFable51]) {
    it(`${card.id}: drops a forced named choice AND keeps the full tools array (forced any/tool → 400)`, () => {
      expect(card.tools.supportsToolChoice).toBe(false);
      const req = gw.prepareRequest([userMsg], [askTool, otherTool], card, {
        toolChoice: { type: 'tool', name: 'AskForAdvice' },
      });
      expect(req.toolChoice).toBeUndefined();
      expect(req.tools).toHaveLength(2); // not narrowed to the forced tool
    });

    it(`${card.id}: drops a forced 'required' (wire 'any') choice`, () => {
      const req = gw.prepareRequest([userMsg], [askTool], card, { toolChoice: { type: 'required' } });
      expect(req.toolChoice).toBeUndefined();
    });

    it(`${card.id}: still passes 'auto'`, () => {
      const req = gw.prepareRequest([userMsg], [askTool], card, { toolChoice: { type: 'auto' } });
      expect(req.toolChoice).toEqual({ key: 'tool_choice', value: { type: 'auto' } });
    });
  }

  it('cards without the declaration are unaffected (claude-opus-5 still gets the forced choice)', () => {
    expect(claudeOpus5.tools.supportsToolChoice).toBeUndefined();
    const req = gw.prepareRequest([userMsg], [askTool], claudeOpus5, {
      toolChoice: { type: 'tool', name: 'AskForAdvice' },
    });
    expect(req.toolChoice).toEqual({ key: 'tool_choice', value: { type: 'tool', name: 'ask_for_advice' } });
  });
});
