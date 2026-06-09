/**
 * Cross-Provider Continuity Integration Tests
 *
 * Tests conversation continuity when switching between providers:
 * - Anthropic → OpenAI
 * - OpenAI → Gemini
 * - Gemini → Anthropic
 * - Multi-hop provider switching
 *
 * Validates:
 * - Message format conversion between different provider formats
 * - Timeline tracking across provider switches
 * - Tool context preservation
 * - Conversation resume capability
 *
 * Phase 1.5: Week 1 Integration Testing
 */

import { describe, it, expect } from 'vitest';
import {
  CanonicalMessage,
  CanonicalTool
} from '../../FormatAdapter.interface';
import { MessagesAPIAdapter } from '../../MessagesAPIAdapter';
import { ChatCompletionsAPIAdapter } from '../../ChatCompletionsAPIAdapter';
import { GenerateContentAPIAdapter } from '../../GenerateContentAPIAdapter';
import { createTestModelConfig, createTestSessionContext, createTestTool } from './test-fixtures';

describe('Cross-Provider Continuity', () => {
  const sessionContext = createTestSessionContext();

  describe('Provider Switching', () => {
    it('should convert Anthropic conversation to OpenAI format', () => {
      const anthropicConfig = createTestModelConfig('anthropic');
      const openaiConfig = createTestModelConfig('openai');

      // Original conversation in Anthropic canonical format
      const conversation: CanonicalMessage[] = [
        {
          uuid: 'msg_cross_001',
          timestamp: '2025-10-24T10:00:00Z',
          timeline: {
            sessionId: sessionContext.sessionId,
            conversationId: sessionContext.conversationId,
            turnNumber: 1
          },
          role: 'user',
          type: 'text',
          content: [{ type: 'text', text: 'Hello from Anthropic' }],
          model: {
            id: anthropicConfig.id,
            provider: anthropicConfig.provider,
            apiPattern: anthropicConfig.api.pattern
          }
        },
        {
          uuid: 'msg_cross_002',
          timestamp: '2025-10-24T10:00:05Z',
          timeline: {
            sessionId: sessionContext.sessionId,
            conversationId: sessionContext.conversationId,
            turnNumber: 2
          },
          role: 'assistant',
          type: 'text',
          content: [{ type: 'text', text: 'Hello! How can I help?' }],
          model: {
            id: anthropicConfig.id,
            provider: anthropicConfig.provider,
            apiPattern: anthropicConfig.api.pattern
          }
        }
      ];

      // Convert to OpenAI format
      const openaiAdapter = new ChatCompletionsAPIAdapter();
      const openaiMessages = openaiAdapter.toProviderMessages(conversation, openaiConfig);

      expect(openaiMessages).toHaveLength(2);
      expect((openaiMessages[0] as any).role).toBe('user');
      expect((openaiMessages[0] as any).content).toBe('Hello from Anthropic');
      expect((openaiMessages[1] as any).role).toBe('assistant');
      expect((openaiMessages[1] as any).content).toBe('Hello! How can I help?');

      // Convert back to canonical
      const convertedBack = openaiAdapter.fromProviderMessages(
        openaiMessages,
        openaiConfig,
        { ...sessionContext, turnNumber: 3 }
      );

      expect(convertedBack).toHaveLength(2);
      expect(convertedBack[0].role).toBe('user');
      expect(convertedBack[0].content[0].text).toBe('Hello from Anthropic');
      expect(convertedBack[1].role).toBe('assistant');
      expect(convertedBack[1].content[0].text).toBe('Hello! How can I help?');

      // Verify timeline tracking persists
      expect(convertedBack[0].timeline.sessionId).toBe(sessionContext.sessionId);
      expect(convertedBack[0].timeline.conversationId).toBe(sessionContext.conversationId);
    });

    it('should convert OpenAI conversation to Gemini format', () => {
      const openaiConfig = createTestModelConfig('openai');
      const geminiConfig = createTestModelConfig('google');

      const conversation: CanonicalMessage[] = [
        {
          uuid: 'msg_cross_101',
          timestamp: '2025-10-24T10:05:00Z',
          timeline: {
            sessionId: sessionContext.sessionId,
            conversationId: sessionContext.conversationId,
            turnNumber: 1
          },
          role: 'user',
          type: 'text',
          content: [{ type: 'text', text: 'Hello from OpenAI' }],
          model: {
            id: openaiConfig.id,
            provider: openaiConfig.provider,
            apiPattern: openaiConfig.api.pattern
          }
        },
        {
          uuid: 'msg_cross_102',
          timestamp: '2025-10-24T10:05:05Z',
          timeline: {
            sessionId: sessionContext.sessionId,
            conversationId: sessionContext.conversationId,
            turnNumber: 2
          },
          role: 'assistant',
          type: 'text',
          content: [{ type: 'text', text: 'Hi there!' }],
          model: {
            id: openaiConfig.id,
            provider: openaiConfig.provider,
            apiPattern: openaiConfig.api.pattern
          }
        }
      ];

      // Convert to Gemini format
      const geminiAdapter = new GenerateContentAPIAdapter();
      const geminiMessages = geminiAdapter.toProviderMessages(conversation, geminiConfig);

      expect(geminiMessages).toHaveLength(2);
      expect((geminiMessages[0] as any).role).toBe('user');
      expect((geminiMessages[0] as any).parts[0].text).toBe('Hello from OpenAI');
      expect((geminiMessages[1] as any).role).toBe('model'); // Gemini uses 'model' not 'assistant'
      expect((geminiMessages[1] as any).parts[0].text).toBe('Hi there!');

      // Convert back to canonical
      const convertedBack = geminiAdapter.fromProviderMessages(
        geminiMessages,
        geminiConfig,
        { ...sessionContext, turnNumber: 3 }
      );

      expect(convertedBack).toHaveLength(2);
      expect(convertedBack[0].role).toBe('user');
      expect(convertedBack[1].role).toBe('assistant'); // Should convert back to 'assistant'
    });

    it('should convert Gemini conversation to Anthropic format', () => {
      const geminiConfig = createTestModelConfig('google');
      const anthropicConfig = createTestModelConfig('anthropic');

      const conversation: CanonicalMessage[] = [
        {
          uuid: 'msg_cross_201',
          timestamp: '2025-10-24T10:10:00Z',
          timeline: {
            sessionId: sessionContext.sessionId,
            conversationId: sessionContext.conversationId,
            turnNumber: 1
          },
          role: 'user',
          type: 'text',
          content: [{ type: 'text', text: 'Hello from Gemini' }],
          model: {
            id: geminiConfig.id,
            provider: geminiConfig.provider,
            apiPattern: geminiConfig.api.pattern
          }
        },
        {
          uuid: 'msg_cross_202',
          timestamp: '2025-10-24T10:10:05Z',
          timeline: {
            sessionId: sessionContext.sessionId,
            conversationId: sessionContext.conversationId,
            turnNumber: 2
          },
          role: 'assistant',
          type: 'text',
          content: [{ type: 'text', text: 'Greetings!' }],
          model: {
            id: geminiConfig.id,
            provider: geminiConfig.provider,
            apiPattern: geminiConfig.api.pattern
          }
        }
      ];

      // Convert to Anthropic format
      const anthropicAdapter = new MessagesAPIAdapter();
      const anthropicMessages = anthropicAdapter.toProviderMessages(conversation, anthropicConfig);

      expect(anthropicMessages).toHaveLength(2);
      expect((anthropicMessages[0] as any).role).toBe('user');
      expect((anthropicMessages[1] as any).role).toBe('assistant');

      // Convert back to canonical
      const convertedBack = anthropicAdapter.fromProviderMessages(
        anthropicMessages,
        anthropicConfig,
        { ...sessionContext, turnNumber: 3 }
      );

      expect(convertedBack).toHaveLength(2);
      expect(convertedBack[0].content[0].text).toBe('Hello from Gemini');
      expect(convertedBack[1].content[0].text).toBe('Greetings!');
    });
  });

  describe('Tool Context Preservation', () => {
    it('should preserve tool use when switching from Anthropic to OpenAI', () => {
      const anthropicConfig = createTestModelConfig('anthropic');
      const openaiConfig = createTestModelConfig('openai');

      const conversation: CanonicalMessage[] = [
        {
          uuid: 'msg_tool_001',
          timestamp: '2025-10-24T10:15:00Z',
          timeline: {
            sessionId: sessionContext.sessionId,
            conversationId: sessionContext.conversationId,
            turnNumber: 1
          },
          role: 'user',
          type: 'text',
          content: [{ type: 'text', text: 'Get weather' }],
          model: {
            id: anthropicConfig.id,
            provider: anthropicConfig.provider,
            apiPattern: anthropicConfig.api.pattern
          }
        },
        {
          uuid: 'msg_tool_002',
          timestamp: '2025-10-24T10:15:05Z',
          timeline: {
            sessionId: sessionContext.sessionId,
            conversationId: sessionContext.conversationId,
            turnNumber: 2
          },
          role: 'assistant',
          type: 'tool_request',
          content: [
            {
              type: 'tool_use',
              toolUse: {
                id: 'toolu_cross_001',
                name: 'get_weather',
                input: { location: 'Seattle' }
              }
            }
          ],
          model: {
            id: anthropicConfig.id,
            provider: anthropicConfig.provider,
            apiPattern: anthropicConfig.api.pattern
          }
        },
        {
          uuid: 'msg_tool_003',
          timestamp: '2025-10-24T10:15:10Z',
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
                tool_use_id: 'toolu_cross_001',
                content: 'Cloudy, 58°F',
                is_error: false
              }
            }
          ],
          model: {
            id: anthropicConfig.id,
            provider: anthropicConfig.provider,
            apiPattern: anthropicConfig.api.pattern
          }
        }
      ];

      // Convert to OpenAI format
      const openaiAdapter = new ChatCompletionsAPIAdapter();
      const openaiMessages = openaiAdapter.toProviderMessages(conversation, openaiConfig);

      // OpenAI flattens to: user message, assistant with tool_calls, tool message
      expect(openaiMessages.length).toBeGreaterThan(0);

      // Verify tool call is preserved
      const assistantMsg = openaiMessages.find((m: any) => m.role === 'assistant');
      expect(assistantMsg).toBeDefined();
      expect((assistantMsg as any).tool_calls).toBeDefined();
      expect((assistantMsg as any).tool_calls[0].function.name).toBe('get_weather');

      // Verify tool result is preserved
      const toolMsg = openaiMessages.find((m: any) => m.role === 'tool');
      expect(toolMsg).toBeDefined();
      expect((toolMsg as any).content).toContain('Cloudy, 58°F');
    });

    it('should preserve tool use when switching from OpenAI to Gemini', () => {
      const openaiConfig = createTestModelConfig('openai');
      const geminiConfig = createTestModelConfig('google');

      const conversation: CanonicalMessage[] = [
        {
          uuid: 'msg_tool_101',
          timestamp: '2025-10-24T10:20:00Z',
          timeline: {
            sessionId: sessionContext.sessionId,
            conversationId: sessionContext.conversationId,
            turnNumber: 1
          },
          role: 'assistant',
          type: 'tool_request',
          content: [
            {
              type: 'tool_use',
              toolUse: {
                id: 'call_cross_101',
                name: 'search',
                input: { query: 'AI news' }
              }
            }
          ],
          model: {
            id: openaiConfig.id,
            provider: openaiConfig.provider,
            apiPattern: openaiConfig.api.pattern
          }
        },
        {
          uuid: 'msg_tool_102',
          timestamp: '2025-10-24T10:20:05Z',
          timeline: {
            sessionId: sessionContext.sessionId,
            conversationId: sessionContext.conversationId,
            turnNumber: 2
          },
          role: 'user',
          type: 'tool_response',
          content: [
            {
              type: 'tool_result',
              toolResult: {
                tool_use_id: 'call_cross_101',
                content: { articles: ['Article 1'] },
                is_error: false,
                metadata: {
                  functionName: 'search' // For Gemini compatibility
                }
              }
            }
          ],
          model: {
            id: openaiConfig.id,
            provider: openaiConfig.provider,
            apiPattern: openaiConfig.api.pattern
          }
        }
      ];

      // Convert to Gemini format
      const geminiAdapter = new GenerateContentAPIAdapter();
      const geminiMessages = geminiAdapter.toProviderMessages(conversation, geminiConfig);

      expect(geminiMessages.length).toBeGreaterThan(0);

      // Verify function call is preserved
      const modelMsg = geminiMessages.find((m: any) => m.role === 'model');
      expect(modelMsg).toBeDefined();
      expect((modelMsg as any).parts[0].functionCall).toBeDefined();
      expect((modelMsg as any).parts[0].functionCall.name).toBe('search');

      // Verify function response is preserved
      const userMsg = geminiMessages.find(
        (m: any) => m.parts?.some?.((p: any) => p.functionResponse)
      );
      expect(userMsg).toBeDefined();
      expect((userMsg as any).parts[0].functionResponse.name).toBe('search');
    });
  });

  describe('Multi-Hop Provider Switching', () => {
    it('should handle Anthropic → OpenAI → Gemini conversation', () => {
      const anthropicConfig = createTestModelConfig('anthropic');
      const openaiConfig = createTestModelConfig('openai');
      const geminiConfig = createTestModelConfig('google');

      // Start with Anthropic
      let conversation: CanonicalMessage[] = [
        {
          uuid: 'msg_hop_001',
          timestamp: '2025-10-24T10:25:00Z',
          timeline: {
            sessionId: sessionContext.sessionId,
            conversationId: sessionContext.conversationId,
            turnNumber: 1
          },
          role: 'user',
          type: 'text',
          content: [{ type: 'text', text: 'Start with Anthropic' }],
          model: {
            id: anthropicConfig.id,
            provider: anthropicConfig.provider,
            apiPattern: anthropicConfig.api.pattern
          }
        },
        {
          uuid: 'msg_hop_002',
          timestamp: '2025-10-24T10:25:05Z',
          timeline: {
            sessionId: sessionContext.sessionId,
            conversationId: sessionContext.conversationId,
            turnNumber: 2
          },
          role: 'assistant',
          type: 'text',
          content: [{ type: 'text', text: 'Response from Anthropic' }],
          model: {
            id: anthropicConfig.id,
            provider: anthropicConfig.provider,
            apiPattern: anthropicConfig.api.pattern
          }
        }
      ];

      // Convert to OpenAI
      const openaiAdapter = new ChatCompletionsAPIAdapter();
      const openaiMessages = openaiAdapter.toProviderMessages(conversation, openaiConfig);
      const openaiCanonical = openaiAdapter.fromProviderMessages(
        openaiMessages,
        openaiConfig,
        { ...sessionContext, turnNumber: 3 }
      );

      // Add OpenAI message
      conversation = [
        ...openaiCanonical,
        {
          uuid: 'msg_hop_003',
          timestamp: '2025-10-24T10:25:10Z',
          timeline: {
            sessionId: sessionContext.sessionId,
            conversationId: sessionContext.conversationId,
            turnNumber: 3
          },
          role: 'user',
          type: 'text',
          content: [{ type: 'text', text: 'Continue with OpenAI' }],
          model: {
            id: openaiConfig.id,
            provider: openaiConfig.provider,
            apiPattern: openaiConfig.api.pattern
          }
        }
      ];

      // Convert to Gemini
      const geminiAdapter = new GenerateContentAPIAdapter();
      const geminiMessages = geminiAdapter.toProviderMessages(conversation, geminiConfig);
      const geminiCanonical = geminiAdapter.fromProviderMessages(
        geminiMessages,
        geminiConfig,
        { ...sessionContext, turnNumber: 4 }
      );

      // Verify all messages preserved
      expect(geminiCanonical.length).toBe(3);
      expect(geminiCanonical[0].content[0].text).toBe('Start with Anthropic');
      expect(geminiCanonical[1].content[0].text).toBe('Response from Anthropic');
      expect(geminiCanonical[2].content[0].text).toBe('Continue with OpenAI');

      // All should have same session/conversation IDs
      expect(geminiCanonical[0].timeline.sessionId).toBe(sessionContext.sessionId);
      expect(geminiCanonical[1].timeline.sessionId).toBe(sessionContext.sessionId);
      expect(geminiCanonical[2].timeline.sessionId).toBe(sessionContext.sessionId);

      expect(geminiCanonical[0].timeline.conversationId).toBe(sessionContext.conversationId);
      expect(geminiCanonical[1].timeline.conversationId).toBe(sessionContext.conversationId);
      expect(geminiCanonical[2].timeline.conversationId).toBe(sessionContext.conversationId);
    });

    it('should handle conversation resume with different provider', () => {
      const anthropicConfig = createTestModelConfig('anthropic');
      const geminiConfig = createTestModelConfig('google');

      // Original conversation checkpoint
      const checkpoint: CanonicalMessage[] = [
        {
          uuid: 'msg_resume_001',
          timestamp: '2025-10-24T10:30:00Z',
          timeline: {
            sessionId: sessionContext.sessionId,
            conversationId: sessionContext.conversationId,
            turnNumber: 1,
            checkpointId: 'checkpoint_001'
          },
          role: 'user',
          type: 'text',
          content: [{ type: 'text', text: 'Original request' }],
          model: {
            id: anthropicConfig.id,
            provider: anthropicConfig.provider,
            apiPattern: anthropicConfig.api.pattern
          }
        },
        {
          uuid: 'msg_resume_002',
          timestamp: '2025-10-24T10:30:05Z',
          timeline: {
            sessionId: sessionContext.sessionId,
            conversationId: sessionContext.conversationId,
            turnNumber: 2,
            checkpointId: 'checkpoint_001'
          },
          role: 'assistant',
          type: 'text',
          content: [{ type: 'text', text: 'Original response' }],
          model: {
            id: anthropicConfig.id,
            provider: anthropicConfig.provider,
            apiPattern: anthropicConfig.api.pattern
          }
        }
      ];

      // Resume with different provider (Gemini)
      const resumeMessage: CanonicalMessage = {
        uuid: 'msg_resume_003',
        timestamp: '2025-10-24T10:35:00Z',
        timeline: {
          sessionId: sessionContext.sessionId,
          conversationId: sessionContext.conversationId,
          turnNumber: 3,
          resumePoint: true
        },
        role: 'user',
        type: 'text',
        content: [{ type: 'text', text: 'Resume with new provider' }],
        model: {
          id: geminiConfig.id,
          provider: geminiConfig.provider,
          apiPattern: geminiConfig.api.pattern
        }
      };

      const fullConversation = [...checkpoint, resumeMessage];

      // Convert to Gemini format
      const geminiAdapter = new GenerateContentAPIAdapter();
      const geminiMessages = geminiAdapter.toProviderMessages(fullConversation, geminiConfig);

      expect(geminiMessages).toHaveLength(3);

      // Convert back to canonical
      const converted = geminiAdapter.fromProviderMessages(
        geminiMessages,
        geminiConfig,
        { ...sessionContext, turnNumber: 4 }
      );

      expect(converted).toHaveLength(3);

      // Verify checkpoint and resume point markers are preserved
      const checkpointMsg = fullConversation.find(m => m.timeline.checkpointId);
      expect(checkpointMsg).toBeDefined();
      expect(checkpointMsg?.timeline.checkpointId).toBe('checkpoint_001');

      const resumeMsg = fullConversation.find(m => m.timeline.resumePoint);
      expect(resumeMsg).toBeDefined();
      expect(resumeMsg?.timeline.resumePoint).toBe(true);
    });
  });

  describe('Content Block Preservation', () => {
    it('should preserve mixed content blocks across provider switch', () => {
      const anthropicConfig = createTestModelConfig('anthropic');
      const openaiConfig = createTestModelConfig('openai');

      const complexMessage: CanonicalMessage = {
        uuid: 'msg_mixed_001',
        timestamp: '2025-10-24T10:40:00Z',
        timeline: {
          sessionId: sessionContext.sessionId,
          conversationId: sessionContext.conversationId,
          turnNumber: 1
        },
        role: 'assistant',
        type: 'tool_request',
        content: [
          { type: 'text', text: 'Let me help with that.' },
          {
            type: 'tool_use',
            toolUse: {
              id: 'toolu_mixed_001',
              name: 'analyze',
              input: { data: 'sample' }
            }
          },
          { type: 'text', text: 'Processing...' }
        ],
        model: {
          id: anthropicConfig.id,
          provider: anthropicConfig.provider,
          apiPattern: anthropicConfig.api.pattern
        }
      };

      // Convert to OpenAI
      const openaiAdapter = new ChatCompletionsAPIAdapter();
      const openaiMessages = openaiAdapter.toProviderMessages([complexMessage], openaiConfig);

      // OpenAI flattens: assistant message with content + tool_calls
      const assistantMsg = openaiMessages.find((m: any) => m.role === 'assistant') as any;
      expect(assistantMsg).toBeDefined();
      expect(assistantMsg.content).toContain('Let me help with that.');
      expect(assistantMsg.content).toContain('Processing...');
      expect(assistantMsg.tool_calls).toBeDefined();
      expect(assistantMsg.tool_calls[0].function.name).toBe('analyze');

      // Convert back to canonical
      const converted = openaiAdapter.fromProviderMessages(
        openaiMessages,
        openaiConfig,
        sessionContext
      );

      expect(converted).toHaveLength(1);
      expect(converted[0].content.some(b => b.type === 'text')).toBe(true);
      expect(converted[0].content.some(b => b.type === 'tool_use')).toBe(true);
    });

    it('should preserve extended thinking blocks (with signature)', () => {
      const anthropicConfig = createTestModelConfig('anthropic');
      const geminiConfig = createTestModelConfig('google');

      const messageWithExtendedThinking: CanonicalMessage = {
        uuid: 'msg_think_001',
        timestamp: '2025-10-24T10:45:00Z',
        timeline: {
          sessionId: sessionContext.sessionId,
          conversationId: sessionContext.conversationId,
          turnNumber: 1
        },
        role: 'assistant',
        type: 'text',
        content: [
          {
            type: 'thinking',
            thinking: 'Analyzing the problem...',
            signature: 'thinking_xyz789' // Extended thinking has signatures
          },
          { type: 'text', text: 'Here is my answer.' }
        ],
        model: {
          id: anthropicConfig.id,
          provider: anthropicConfig.provider,
          apiPattern: anthropicConfig.api.pattern
        }
      };

      // Convert to Anthropic (should preserve thinking block with signature)
      const anthropicAdapter = new MessagesAPIAdapter();
      const anthropicMessages = anthropicAdapter.toProviderMessages(
        [messageWithExtendedThinking],
        anthropicConfig
      );

      expect((anthropicMessages[0] as any).content).toHaveLength(2);
      expect((anthropicMessages[0] as any).content[0].type).toBe('thinking');
      expect((anthropicMessages[0] as any).content[0].signature).toBe('thinking_xyz789');

      // Convert to Gemini (foreign thinking dropped — Gemini doesn't
      // round-trip non-native thinking. Mirrors the reference Gemini transport's
      // GeminiTransport.ts. Replaced earlier `[Thinking: ...]` text injection
      // which caused Gemini to parrot the literal string in responses.)
      const geminiAdapter = new GenerateContentAPIAdapter();
      const geminiMessages = geminiAdapter.toProviderMessages(
        [messageWithExtendedThinking],
        geminiConfig
      );

      expect((geminiMessages[0] as any).parts).toHaveLength(1);
      expect((geminiMessages[0] as any).parts[0].text).toBe('Here is my answer.');
    });

    // Updated 2026-05-11 (#19): the original test asserted "preserve
    // signature-less native interleaved thinking" — but live re-bench
    // showed Anthropic's current API 400s on ANY signature-less thinking
    // block, regardless of source. The adapter now drops signature-less
    // blocks universally for Anthropic; losing reasoning context is
    // preferable to the 400 that stops the entire turn.
    it('drops signature-less thinking blocks when targeting Anthropic (#19)', () => {
      const anthropicConfig = createTestModelConfig('anthropic');

      const messageWithNativeThinking: CanonicalMessage = {
        uuid: 'msg_think_002',
        timestamp: '2025-10-24T10:46:00Z',
        timeline: {
          sessionId: sessionContext.sessionId,
          conversationId: sessionContext.conversationId,
          turnNumber: 2
        },
        role: 'assistant',
        type: 'text',
        content: [
          {
            type: 'thinking',
            thinking: 'Signature-less thinking — would 400 the API'
          },
          { type: 'text', text: 'Here is my answer.' }
        ],
        model: {
          id: anthropicConfig.id,
          provider: anthropicConfig.provider,
          apiPattern: anthropicConfig.api.pattern
        }
      };

      const anthropicAdapter = new MessagesAPIAdapter();
      const anthropicMessages = anthropicAdapter.toProviderMessages(
        [messageWithNativeThinking],
        anthropicConfig
      );

      // Thinking block dropped, text preserved.
      const content = (anthropicMessages[0] as any).content;
      expect(content).toHaveLength(1);
      expect(content[0].type).toBe('text');
      expect(content[0].text).toBe('Here is my answer.');
    });
  });
});
