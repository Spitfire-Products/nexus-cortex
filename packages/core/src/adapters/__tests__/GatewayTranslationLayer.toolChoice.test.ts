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
import type { CanonicalMessage, CanonicalTool } from '@nexus-cortex/types';

const STUB_KEYS = ['DEEPSEEK_API_KEY'] as const;
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
