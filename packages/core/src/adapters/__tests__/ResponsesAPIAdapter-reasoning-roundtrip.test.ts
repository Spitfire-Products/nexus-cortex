/**
 * xAI Responses output → canonical conversion.
 *
 * xAI returns `output: [reasoning, message]`. The orchestrator reads only
 * messages[0]. Previously the adapter prepended reasoning as a SEPARATE
 * message, so messages[0] was thinking-only and the real text/tool_use in
 * messages[1] was discarded → "Empty response detected". The adapter must
 * merge reasoning + text into ONE assistant message ([thinking, text]),
 * matching MessagesAPIAdapter. It must also read xAI's reasoning `summary`
 * array (not just OpenAI's `reasoning` string).
 */
import { describe, it, expect } from 'vitest';
import { ResponsesAPIAdapter } from '../ResponsesAPIAdapter.js';
import type { ModelConfig } from '../../models/ModelConfig.interface.js';

const adapter = new ResponsesAPIAdapter();

const xaiModel = {
  id: 'grok-4.3',
  provider: 'xai',
  api: { pattern: 'responses', endpoint: 'https://api.x.ai/v1/responses' },
} as unknown as ModelConfig;

const sessionContext = { sessionId: 's1', conversationId: 'c1', turnNumber: 1 };

describe('ResponsesAPIAdapter merges xAI reasoning + message into one canonical message', () => {
  it('returns ONE assistant message with [thinking, text], not a separate reasoning message', () => {
    const xaiResponse = {
      object: 'response',
      id: 'resp_1',
      model: 'grok-4.3',
      output: [
        {
          type: 'reasoning',
          id: 'rs_1',
          status: 'completed',
          summary: [{ type: 'summary_text', text: 'The user wants PONG.' }],
        },
        {
          type: 'message',
          id: 'msg_1',
          role: 'assistant',
          status: 'completed',
          content: [{ type: 'output_text', text: 'PONG' }],
        },
      ],
    };

    const result = adapter.fromProviderMessages([xaiResponse], xaiModel, sessionContext);

    // Exactly one canonical message (was 2: a thinking-only msg + a text msg)
    expect(result).toHaveLength(1);
    const blocks = result[0]!.content as Array<{ type: string; text?: string; thinking?: string }>;
    expect(blocks.map(b => b.type)).toEqual(['thinking', 'text']);
    // xAI reasoning comes from summary[].text, not a `reasoning` string
    expect(blocks[0]!.thinking).toBe('The user wants PONG.');
    expect(blocks[1]!.text).toBe('PONG');
  });

  it('still produces a usable message when a tool_use accompanies reasoning', () => {
    const xaiResponse = {
      object: 'response',
      id: 'resp_2',
      model: 'grok-4.3',
      output: [
        { type: 'reasoning', id: 'rs_2', summary: [{ type: 'summary_text', text: 'Need to read a file.' }] },
        { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'Read', arguments: '{"file_path":"x"}' },
      ],
    };

    const result = adapter.fromProviderMessages([xaiResponse], xaiModel, sessionContext);

    expect(result).toHaveLength(1);
    const types = (result[0]!.content as Array<{ type: string }>).map(b => b.type);
    expect(types).toContain('thinking');
    expect(types).toContain('tool_use');
    expect(result[0]!.type).toBe('tool_request');
  });
});
