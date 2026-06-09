/**
 * Message Round-Trip Integration Tests
 *
 * Validates lossless conversion: Canonical → Provider → Canonical
 *
 * Tests:
 * - Simple text messages
 * - Messages with tool use
 * - Messages with tool results
 * - Mixed content blocks
 * - Timeline tracking preservation
 * - Metadata preservation
 *
 * Phase 1.5: Week 1 Integration Testing
 */

import { describe, it, expect } from 'vitest';
import {
  CanonicalMessage,
  CanonicalTool,
  CanonicalToolUse,
  CanonicalToolResult
} from '../../FormatAdapter.interface';
import { MessagesAPIAdapter } from '../../MessagesAPIAdapter';
import { ChatCompletionsAPIAdapter } from '../../ChatCompletionsAPIAdapter';
import { GenerateContentAPIAdapter } from '../../GenerateContentAPIAdapter';
import { ModelConfig } from '../../../models/ModelConfig.interface';
import { createTestModelConfig, createTestSessionContext } from './test-fixtures';

describe('Message Round-Trip Conversion', () => {
  const sessionContext = createTestSessionContext();

  describe('AnthropicMessagesToolsAdapter', () => {
    const adapter = new MessagesAPIAdapter();
    const modelConfig = createTestModelConfig('anthropic');

    it('should preserve simple text message', () => {
      const original: CanonicalMessage = {
        uuid: 'msg_001',
        timestamp: '2025-10-24T08:00:00Z',
        timeline: {
          sessionId: sessionContext.sessionId,
          conversationId: sessionContext.conversationId,
          turnNumber: 1
        },
        role: 'user',
        type: 'text',
        content: [
          { type: 'text', text: 'Hello, world!' }
        ],
        model: {
          id: modelConfig.id,
          provider: modelConfig.provider,
          apiPattern: modelConfig.api.pattern
        }
      };

      // Convert to provider format
      const providerMessages = adapter.toProviderMessages([original], modelConfig);
      expect(providerMessages).toHaveLength(1);

      // Convert back to canonical
      const converted = adapter.fromProviderMessages(
        providerMessages,
        modelConfig,
        sessionContext
      );

      expect(converted).toHaveLength(1);
      expect(converted[0].role).toBe(original.role);
      expect(converted[0].type).toBe(original.type);
      expect(converted[0].content).toHaveLength(1);
      expect(converted[0].content[0].type).toBe('text');
      expect(converted[0].content[0].text).toBe('Hello, world!');
      expect(converted[0].timeline.sessionId).toBe(sessionContext.sessionId);
      expect(converted[0].timeline.conversationId).toBe(sessionContext.conversationId);
    });

    it('should preserve assistant message with tool use', () => {
      const original: CanonicalMessage = {
        uuid: 'msg_002',
        timestamp: '2025-10-24T08:01:00Z',
        timeline: {
          sessionId: sessionContext.sessionId,
          conversationId: sessionContext.conversationId,
          turnNumber: 2
        },
        role: 'assistant',
        type: 'tool_request',
        content: [
          { type: 'text', text: "I'll check the weather for you." },
          {
            type: 'tool_use',
            toolUse: {
              id: 'toolu_001',
              name: 'get_weather',
              input: { location: 'San Francisco' }
            }
          }
        ],
        model: {
          id: modelConfig.id,
          provider: modelConfig.provider,
          apiPattern: modelConfig.api.pattern
        }
      };

      const providerMessages = adapter.toProviderMessages([original], modelConfig);
      const converted = adapter.fromProviderMessages(
        providerMessages,
        modelConfig,
        sessionContext
      );

      expect(converted).toHaveLength(1);
      expect(converted[0].content).toHaveLength(2);
      expect(converted[0].content[0].type).toBe('text');
      expect(converted[0].content[0].text).toBe("I'll check the weather for you.");
      expect(converted[0].content[1].type).toBe('tool_use');
      expect(converted[0].content[1].toolUse?.name).toBe('get_weather');
      expect(converted[0].content[1].toolUse?.input).toEqual({ location: 'San Francisco' });
    });

    it('should preserve user message with tool result', () => {
      const original: CanonicalMessage = {
        uuid: 'msg_003',
        timestamp: '2025-10-24T08:02:00Z',
        timeline: {
          sessionId: sessionContext.sessionId,
          conversationId: sessionContext.conversationId,
          turnNumber: 3
        },
        role: 'user',
        type: 'tool_response',
        content: [
          {
            type: 'tool_result',
            toolResult: {
              tool_use_id: 'toolu_001',
              content: 'Sunny, 72°F',
              is_error: false
            }
          }
        ],
        model: {
          id: modelConfig.id,
          provider: modelConfig.provider,
          apiPattern: modelConfig.api.pattern
        }
      };

      const providerMessages = adapter.toProviderMessages([original], modelConfig);
      const converted = adapter.fromProviderMessages(
        providerMessages,
        modelConfig,
        sessionContext
      );

      expect(converted).toHaveLength(1);
      expect(converted[0].content).toHaveLength(1);
      expect(converted[0].content[0].type).toBe('tool_result');
      expect(converted[0].content[0].toolResult?.content).toBe('Sunny, 72°F');
      expect(converted[0].content[0].toolResult?.is_error).toBe(false);
    });

    it('should preserve thinking blocks WITH signature (extended thinking)', () => {
      // Extended thinking (Opus + Tab toggle) has cryptographic signatures
      const original: CanonicalMessage = {
        uuid: 'msg_004',
        timestamp: '2025-10-24T08:03:00Z',
        timeline: {
          sessionId: sessionContext.sessionId,
          conversationId: sessionContext.conversationId,
          turnNumber: 4
        },
        role: 'assistant',
        type: 'text',
        content: [
          {
            type: 'thinking',
            thinking: 'Let me analyze this request...',
            signature: 'thinking_abc123' // Extended thinking has signatures
          },
          { type: 'text', text: 'Here is my response.' }
        ],
        model: {
          id: modelConfig.id,
          provider: modelConfig.provider,
          apiPattern: modelConfig.api.pattern
        }
      };

      const providerMessages = adapter.toProviderMessages([original], modelConfig);
      const converted = adapter.fromProviderMessages(
        providerMessages,
        modelConfig,
        sessionContext
      );

      expect(converted).toHaveLength(1);
      expect(converted[0].content).toHaveLength(2);
      expect(converted[0].content[0].type).toBe('thinking');
      expect(converted[0].content[0].thinking).toBe('Let me analyze this request...');
      expect(converted[0].content[0].signature).toBe('thinking_abc123');
      expect(converted[0].content[1].type).toBe('text');
      expect(converted[0].content[1].text).toBe('Here is my response.');
    });

    // Updated 2026-05-11 (#19): adapter now drops signature-less thinking
    // blocks when targeting Anthropic — the API 400s on them in current
    // production. Test asserts the drop instead of the preserve.
    it('drops signature-less thinking blocks on Anthropic round-trip (#19)', () => {
      const original: CanonicalMessage = {
        uuid: 'msg_004b',
        timestamp: '2025-10-24T08:03:30Z',
        timeline: {
          sessionId: sessionContext.sessionId,
          conversationId: sessionContext.conversationId,
          turnNumber: 4
        },
        role: 'assistant',
        type: 'text',
        content: [
          {
            type: 'thinking',
            thinking: 'Signature-less thinking — would 400 the API'
          },
          { type: 'text', text: 'Here is my response.' }
        ],
        model: {
          id: modelConfig.id,
          provider: modelConfig.provider,
          apiPattern: modelConfig.api.pattern
        }
      };

      const providerMessages = adapter.toProviderMessages([original], modelConfig);
      const converted = adapter.fromProviderMessages(
        providerMessages,
        modelConfig,
        sessionContext
      );

      // Thinking block dropped, text preserved.
      expect(converted).toHaveLength(1);
      expect(converted[0].content).toHaveLength(1);
      expect(converted[0].content[0].type).toBe('text');
      expect(converted[0].content[0].text).toBe('Here is my response.');
    });

    it('should preserve error tool results', () => {
      const original: CanonicalMessage = {
        uuid: 'msg_005',
        timestamp: '2025-10-24T08:04:00Z',
        timeline: {
          sessionId: sessionContext.sessionId,
          conversationId: sessionContext.conversationId,
          turnNumber: 5
        },
        role: 'user',
        type: 'tool_response',
        content: [
          {
            type: 'tool_result',
            toolResult: {
              tool_use_id: 'toolu_002',
              content: 'API key invalid',
              is_error: true
            }
          }
        ],
        model: {
          id: modelConfig.id,
          provider: modelConfig.provider,
          apiPattern: modelConfig.api.pattern
        }
      };

      const providerMessages = adapter.toProviderMessages([original], modelConfig);
      const converted = adapter.fromProviderMessages(
        providerMessages,
        modelConfig,
        sessionContext
      );

      expect(converted).toHaveLength(1);
      expect(converted[0].content[0].type).toBe('tool_result');
      expect(converted[0].content[0].toolResult?.is_error).toBe(true);
      expect(converted[0].content[0].toolResult?.content).toBe('API key invalid');
    });

    it('should handle multi-turn conversation', () => {
      const messages: CanonicalMessage[] = [
        {
          uuid: 'msg_006',
          timestamp: '2025-10-24T08:05:00Z',
          timeline: {
            sessionId: sessionContext.sessionId,
            conversationId: sessionContext.conversationId,
            turnNumber: 6
          },
          role: 'user',
          type: 'text',
          content: [{ type: 'text', text: 'What is 2+2?' }],
          model: {
            id: modelConfig.id,
            provider: modelConfig.provider,
            apiPattern: modelConfig.api.pattern
          }
        },
        {
          uuid: 'msg_007',
          timestamp: '2025-10-24T08:05:30Z',
          timeline: {
            sessionId: sessionContext.sessionId,
            conversationId: sessionContext.conversationId,
            turnNumber: 7
          },
          role: 'assistant',
          type: 'text',
          content: [{ type: 'text', text: '2+2 equals 4.' }],
          model: {
            id: modelConfig.id,
            provider: modelConfig.provider,
            apiPattern: modelConfig.api.pattern
          }
        }
      ];

      const providerMessages = adapter.toProviderMessages(messages, modelConfig);
      expect(providerMessages).toHaveLength(2);

      const converted = adapter.fromProviderMessages(
        providerMessages,
        modelConfig,
        sessionContext
      );

      expect(converted).toHaveLength(2);
      expect(converted[0].role).toBe('user');
      expect(converted[0].content[0].text).toBe('What is 2+2?');
      expect(converted[1].role).toBe('assistant');
      expect(converted[1].content[0].text).toBe('2+2 equals 4.');
    });
  });

  describe('OpenAIFunctionsToolsAdapter', () => {
    const adapter = new ChatCompletionsAPIAdapter();
    const modelConfig = createTestModelConfig('openai');

    it('should preserve simple text message', () => {
      const original: CanonicalMessage = {
        uuid: 'msg_101',
        timestamp: '2025-10-24T08:10:00Z',
        timeline: {
          sessionId: sessionContext.sessionId,
          conversationId: sessionContext.conversationId,
          turnNumber: 1
        },
        role: 'user',
        type: 'text',
        content: [
          { type: 'text', text: 'Hello, OpenAI!' }
        ],
        model: {
          id: modelConfig.id,
          provider: modelConfig.provider,
          apiPattern: modelConfig.api.pattern
        }
      };

      const providerMessages = adapter.toProviderMessages([original], modelConfig);
      const converted = adapter.fromProviderMessages(
        providerMessages,
        modelConfig,
        sessionContext
      );

      expect(converted).toHaveLength(1);
      expect(converted[0].role).toBe('user');
      expect(converted[0].content[0].type).toBe('text');
      expect(converted[0].content[0].text).toBe('Hello, OpenAI!');
    });

    it('should preserve assistant message with tool calls', () => {
      const original: CanonicalMessage = {
        uuid: 'msg_102',
        timestamp: '2025-10-24T08:11:00Z',
        timeline: {
          sessionId: sessionContext.sessionId,
          conversationId: sessionContext.conversationId,
          turnNumber: 2
        },
        role: 'assistant',
        type: 'tool_request',
        content: [
          { type: 'text', text: 'Let me calculate that.' },
          {
            type: 'tool_use',
            toolUse: {
              id: 'call_001',
              name: 'calculator',
              input: { expression: '5 * 7' }
            }
          }
        ],
        model: {
          id: modelConfig.id,
          provider: modelConfig.provider,
          apiPattern: modelConfig.api.pattern
        }
      };

      const providerMessages = adapter.toProviderMessages([original], modelConfig);
      const converted = adapter.fromProviderMessages(
        providerMessages,
        modelConfig,
        sessionContext
      );

      // OpenAI flattens to a single assistant message with tool_calls
      expect(converted).toHaveLength(1);
      expect(converted[0].role).toBe('assistant');
      expect(converted[0].content.some(b => b.type === 'text')).toBe(true);
      expect(converted[0].content.some(b => b.type === 'tool_use')).toBe(true);

      const toolUseBlock = converted[0].content.find(b => b.type === 'tool_use');
      expect(toolUseBlock?.toolUse?.name).toBe('calculator');
      expect(toolUseBlock?.toolUse?.input).toEqual({ expression: '5 * 7' });
    });

    it('should handle tool results as separate messages', () => {
      const original: CanonicalMessage = {
        uuid: 'msg_103',
        timestamp: '2025-10-24T08:12:00Z',
        timeline: {
          sessionId: sessionContext.sessionId,
          conversationId: sessionContext.conversationId,
          turnNumber: 3
        },
        role: 'user',
        type: 'tool_response',
        content: [
          {
            type: 'tool_result',
            toolResult: {
              tool_use_id: 'call_001',
              content: { result: 35 },
              is_error: false
            }
          }
        ],
        model: {
          id: modelConfig.id,
          provider: modelConfig.provider,
          apiPattern: modelConfig.api.pattern
        }
      };

      const providerMessages = adapter.toProviderMessages([original], modelConfig);

      // OpenAI converts tool results to role='tool' messages
      expect(providerMessages).toHaveLength(1);
      expect((providerMessages[0] as any).role).toBe('tool');
      expect((providerMessages[0] as any).tool_call_id).toBe('call_001');

      const converted = adapter.fromProviderMessages(
        providerMessages,
        modelConfig,
        sessionContext
      );

      expect(converted).toHaveLength(1);
      expect(converted[0].content[0].type).toBe('tool_result');
      expect(converted[0].content[0].toolResult?.tool_use_id).toBe('call_001');
    });

    it('should preserve parallel tool calls', () => {
      const original: CanonicalMessage = {
        uuid: 'msg_104',
        timestamp: '2025-10-24T08:13:00Z',
        timeline: {
          sessionId: sessionContext.sessionId,
          conversationId: sessionContext.conversationId,
          turnNumber: 4
        },
        role: 'assistant',
        type: 'tool_request',
        content: [
          {
            type: 'tool_use',
            toolUse: {
              id: 'call_002',
              name: 'get_weather',
              input: { location: 'NYC' }
            }
          },
          {
            type: 'tool_use',
            toolUse: {
              id: 'call_003',
              name: 'get_weather',
              input: { location: 'LA' }
            }
          }
        ],
        model: {
          id: modelConfig.id,
          provider: modelConfig.provider,
          apiPattern: modelConfig.api.pattern
        }
      };

      const providerMessages = adapter.toProviderMessages([original], modelConfig);
      const converted = adapter.fromProviderMessages(
        providerMessages,
        modelConfig,
        sessionContext
      );

      expect(converted).toHaveLength(1);
      const toolUseBlocks = converted[0].content.filter(b => b.type === 'tool_use');
      expect(toolUseBlocks).toHaveLength(2);
      expect(toolUseBlocks[0].toolUse?.input).toEqual({ location: 'NYC' });
      expect(toolUseBlocks[1].toolUse?.input).toEqual({ location: 'LA' });
    });
  });

  describe('GeminiGenerativeAIToolsAdapter', () => {
    const adapter = new GenerateContentAPIAdapter();
    const modelConfig = createTestModelConfig('google');

    it('should preserve simple text message', () => {
      const original: CanonicalMessage = {
        uuid: 'msg_201',
        timestamp: '2025-10-24T08:20:00Z',
        timeline: {
          sessionId: sessionContext.sessionId,
          conversationId: sessionContext.conversationId,
          turnNumber: 1
        },
        role: 'user',
        type: 'text',
        content: [
          { type: 'text', text: 'Hello, Gemini!' }
        ],
        model: {
          id: modelConfig.id,
          provider: modelConfig.provider,
          apiPattern: modelConfig.api.pattern
        }
      };

      const providerMessages = adapter.toProviderMessages([original], modelConfig);
      const converted = adapter.fromProviderMessages(
        providerMessages,
        modelConfig,
        sessionContext
      );

      expect(converted).toHaveLength(1);
      expect(converted[0].role).toBe('user');
      expect(converted[0].content[0].type).toBe('text');
      expect(converted[0].content[0].text).toBe('Hello, Gemini!');
    });

    it('should preserve function calls in model messages', () => {
      const original: CanonicalMessage = {
        uuid: 'msg_202',
        timestamp: '2025-10-24T08:21:00Z',
        timeline: {
          sessionId: sessionContext.sessionId,
          conversationId: sessionContext.conversationId,
          turnNumber: 2
        },
        role: 'assistant',
        type: 'tool_request',
        content: [
          { type: 'text', text: 'Searching for that information...' },
          {
            type: 'tool_use',
            toolUse: {
              id: 'toolu_gemini_001',
              name: 'web_search',
              input: { query: 'latest AI news' }
            }
          }
        ],
        model: {
          id: modelConfig.id,
          provider: modelConfig.provider,
          apiPattern: modelConfig.api.pattern
        }
      };

      const providerMessages = adapter.toProviderMessages([original], modelConfig);
      const converted = adapter.fromProviderMessages(
        providerMessages,
        modelConfig,
        sessionContext
      );

      expect(converted).toHaveLength(1);
      expect(converted[0].role).toBe('assistant');
      expect(converted[0].content).toHaveLength(2);
      expect(converted[0].content[0].type).toBe('text');
      expect(converted[0].content[1].type).toBe('tool_use');
      expect(converted[0].content[1].toolUse?.name).toBe('web_search');
    });

    it('should preserve function responses with metadata', () => {
      const original: CanonicalMessage = {
        uuid: 'msg_203',
        timestamp: '2025-10-24T08:22:00Z',
        timeline: {
          sessionId: sessionContext.sessionId,
          conversationId: sessionContext.conversationId,
          turnNumber: 3
        },
        role: 'user',
        type: 'tool_response',
        content: [
          {
            type: 'tool_result',
            toolResult: {
              tool_use_id: 'toolu_gemini_001',
              content: { articles: ['AI breakthrough...'] },
              is_error: false,
              metadata: {
                functionName: 'web_search' // Gemini requires function name
              }
            }
          }
        ],
        model: {
          id: modelConfig.id,
          provider: modelConfig.provider,
          apiPattern: modelConfig.api.pattern
        }
      };

      const providerMessages = adapter.toProviderMessages([original], modelConfig);
      const converted = adapter.fromProviderMessages(
        providerMessages,
        modelConfig,
        sessionContext
      );

      expect(converted).toHaveLength(1);
      expect(converted[0].content[0].type).toBe('tool_result');
      expect(converted[0].content[0].toolResult?.content).toEqual({ articles: ['AI breakthrough...'] });
      expect(converted[0].content[0].toolResult?.metadata?.functionName).toBe('web_search');
    });

    it('should drop thinking blocks (Gemini does not round-trip foreign thinking)', () => {
      // R20d (2026-05-13): foreign thinking blocks (e.g. from Anthropic or
      // OpenAI in a cross-provider session) are dropped when serialized to
      // Gemini. Previously stringified as `[Thinking: ...]` text, which Gemini
      // would parrot back in its response — caught by parallel benchmark.
      // Matches nexus-terminal CORTEX GeminiTransport.ts handling exactly
      // ("thinking / redacted_thinking: not round-trippable in Gemini API,
      // dropped. Reasoning is server-side and re-derived per turn.")
      const original: CanonicalMessage = {
        uuid: 'msg_204',
        timestamp: '2025-10-24T08:23:00Z',
        timeline: {
          sessionId: sessionContext.sessionId,
          conversationId: sessionContext.conversationId,
          turnNumber: 4
        },
        role: 'assistant',
        type: 'text',
        content: [
          { type: 'thinking', thinking: 'Processing this request...' },
          { type: 'text', text: 'Final answer.' }
        ],
        model: {
          id: modelConfig.id,
          provider: modelConfig.provider,
          apiPattern: modelConfig.api.pattern
        }
      };

      const providerMessages = adapter.toProviderMessages([original], modelConfig);
      const converted = adapter.fromProviderMessages(
        providerMessages,
        modelConfig,
        sessionContext
      );

      expect(converted).toHaveLength(1);
      // Only the text block survives; thinking is dropped silently.
      expect(converted[0].content).toHaveLength(1);
      expect(converted[0].content[0].type).toBe('text');
      expect(converted[0].content[0].text).toBe('Final answer.');
    });

    it('should handle error function responses', () => {
      const original: CanonicalMessage = {
        uuid: 'msg_205',
        timestamp: '2025-10-24T08:24:00Z',
        timeline: {
          sessionId: sessionContext.sessionId,
          conversationId: sessionContext.conversationId,
          turnNumber: 5
        },
        role: 'user',
        type: 'tool_response',
        content: [
          {
            type: 'tool_result',
            toolResult: {
              tool_use_id: 'toolu_gemini_002',
              content: 'Rate limit exceeded',
              is_error: true,
              metadata: {
                functionName: 'api_call'
              }
            }
          }
        ],
        model: {
          id: modelConfig.id,
          provider: modelConfig.provider,
          apiPattern: modelConfig.api.pattern
        }
      };

      const providerMessages = adapter.toProviderMessages([original], modelConfig);
      const converted = adapter.fromProviderMessages(
        providerMessages,
        modelConfig,
        sessionContext
      );

      expect(converted).toHaveLength(1);
      expect(converted[0].content[0].type).toBe('tool_result');
      expect(converted[0].content[0].toolResult?.is_error).toBe(true);
      expect(converted[0].content[0].toolResult?.content).toBe('Rate limit exceeded');
    });
  });
});
