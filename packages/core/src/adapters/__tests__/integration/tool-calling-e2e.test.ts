/**
 * End-to-End Tool Calling Integration Tests
 *
 * Tests complete tool execution flows:
 * 1. User request
 * 2. Assistant tool call
 * 3. Tool execution
 * 4. Tool result
 * 5. Assistant final response
 *
 * Validates:
 * - Tool use → tool result pairing
 * - Multi-turn tool calling
 * - Parallel tool calls
 * - Error handling
 * - Cross-provider continuity
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
import { GatewayTranslationLayer } from '../../GatewayTranslationLayer';
import { AdapterRegistry } from '../../AdapterRegistry';
import { createTestModelConfig, createTestSessionContext, createTestTool } from './test-fixtures';

const HAS_KEYS = !!(process.env.ANTHROPIC_API_KEY && process.env.OPENAI_API_KEY && (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY));
describe.skipIf(!HAS_KEYS)('End-to-End Tool Calling', () => {
  const sessionContext = createTestSessionContext();
  const adapterRegistry = new AdapterRegistry();
  const gateway = new GatewayTranslationLayer(adapterRegistry);

  describe('Single Tool Call Flow', () => {
    it('should handle complete Anthropic tool call flow', () => {
      const modelConfig = createTestModelConfig('anthropic');
      const tools: CanonicalTool[] = [createTestTool('get_weather')];

      // Turn 1: User request
      const userMessage: CanonicalMessage = {
        uuid: 'msg_e2e_001',
        timestamp: '2025-10-24T09:00:00Z',
        timeline: {
          sessionId: sessionContext.sessionId,
          conversationId: sessionContext.conversationId,
          turnNumber: 1
        },
        role: 'user',
        type: 'text',
        content: [{ type: 'text', text: 'What is the weather in SF?' }],
        model: {
          id: modelConfig.id,
          provider: modelConfig.provider,
          apiPattern: modelConfig.api.pattern
        }
      };

      // Turn 2: Assistant tool use
      const assistantToolUse: CanonicalMessage = {
        uuid: 'msg_e2e_002',
        timestamp: '2025-10-24T09:00:10Z',
        timeline: {
          sessionId: sessionContext.sessionId,
          conversationId: sessionContext.conversationId,
          turnNumber: 2
        },
        role: 'assistant',
        type: 'tool_request',
        content: [
          { type: 'text', text: "I'll check the weather for San Francisco." },
          {
            type: 'tool_use',
            toolUse: {
              id: 'toolu_e2e_001',
              name: 'get_weather',
              input: { location: 'San Francisco, CA' }
            }
          }
        ],
        model: {
          id: modelConfig.id,
          provider: modelConfig.provider,
          apiPattern: modelConfig.api.pattern
        }
      };

      // Turn 3: Tool result
      const toolResult: CanonicalMessage = {
        uuid: 'msg_e2e_003',
        timestamp: '2025-10-24T09:00:15Z',
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
              tool_use_id: 'toolu_e2e_001',
              content: 'Sunny, 68°F',
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

      // Turn 4: Assistant final response
      const assistantFinal: CanonicalMessage = {
        uuid: 'msg_e2e_004',
        timestamp: '2025-10-24T09:00:20Z',
        timeline: {
          sessionId: sessionContext.sessionId,
          conversationId: sessionContext.conversationId,
          turnNumber: 4
        },
        role: 'assistant',
        type: 'text',
        content: [
          { type: 'text', text: 'The weather in San Francisco is sunny and 68°F.' }
        ],
        model: {
          id: modelConfig.id,
          provider: modelConfig.provider,
          apiPattern: modelConfig.api.pattern
        }
      };

      // Test full conversation flow
      const conversation = [userMessage, assistantToolUse, toolResult, assistantFinal];

      // Prepare request
      const preparedRequest = gateway.prepareRequest(
        conversation,
        tools,
        modelConfig
      );

      expect(preparedRequest.messages).toBeDefined();
      expect(preparedRequest.tools).toBeDefined();
      expect(preparedRequest.tools).toHaveLength(1);
      expect(preparedRequest.headers).toBeDefined();
      expect(preparedRequest.parameters).toBeDefined();

      // Validate request
      const validation = gateway.validateRequest(conversation, tools, modelConfig);
      expect(validation.valid).toBe(true);
      expect(validation.errors).toBeUndefined();
    });

    it('should handle complete OpenAI tool call flow', () => {
      const modelConfig = createTestModelConfig('openai');
      const tools: CanonicalTool[] = [createTestTool('calculator')];

      const conversation: CanonicalMessage[] = [
        {
          uuid: 'msg_e2e_101',
          timestamp: '2025-10-24T09:10:00Z',
          timeline: {
            sessionId: sessionContext.sessionId,
            conversationId: sessionContext.conversationId,
            turnNumber: 1
          },
          role: 'user',
          type: 'text',
          content: [{ type: 'text', text: 'What is 123 * 456?' }],
          model: {
            id: modelConfig.id,
            provider: modelConfig.provider,
            apiPattern: modelConfig.api.pattern
          }
        },
        {
          uuid: 'msg_e2e_102',
          timestamp: '2025-10-24T09:10:05Z',
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
                id: 'call_e2e_101',
                name: 'calculator',
                input: { expression: '123 * 456' }
              }
            }
          ],
          model: {
            id: modelConfig.id,
            provider: modelConfig.provider,
            apiPattern: modelConfig.api.pattern
          }
        },
        {
          uuid: 'msg_e2e_103',
          timestamp: '2025-10-24T09:10:08Z',
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
                tool_use_id: 'call_e2e_101',
                content: { result: 56088 },
                is_error: false
              }
            }
          ],
          model: {
            id: modelConfig.id,
            provider: modelConfig.provider,
            apiPattern: modelConfig.api.pattern
          }
        }
      ];

      const preparedRequest = gateway.prepareRequest(conversation, tools, modelConfig);
      expect(preparedRequest.messages).toBeDefined();
      expect(preparedRequest.tools).toBeDefined();

      const validation = gateway.validateRequest(conversation, tools, modelConfig);
      expect(validation.valid).toBe(true);
    });

    it('should handle complete Gemini tool call flow', () => {
      const modelConfig = createTestModelConfig('google');
      const tools: CanonicalTool[] = [createTestTool('search_web')];

      const conversation: CanonicalMessage[] = [
        {
          uuid: 'msg_e2e_201',
          timestamp: '2025-10-24T09:20:00Z',
          timeline: {
            sessionId: sessionContext.sessionId,
            conversationId: sessionContext.conversationId,
            turnNumber: 1
          },
          role: 'user',
          type: 'text',
          content: [{ type: 'text', text: 'Search for latest AI research' }],
          model: {
            id: modelConfig.id,
            provider: modelConfig.provider,
            apiPattern: modelConfig.api.pattern
          }
        },
        {
          uuid: 'msg_e2e_202',
          timestamp: '2025-10-24T09:20:05Z',
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
                id: 'toolu_gemini_e2e_001',
                name: 'search_web',
                input: { query: 'latest AI research 2025' }
              }
            }
          ],
          model: {
            id: modelConfig.id,
            provider: modelConfig.provider,
            apiPattern: modelConfig.api.pattern
          }
        },
        {
          uuid: 'msg_e2e_203',
          timestamp: '2025-10-24T09:20:10Z',
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
                tool_use_id: 'toolu_gemini_e2e_001',
                content: { results: ['Paper 1', 'Paper 2'] },
                is_error: false,
                metadata: {
                  functionName: 'search_web' // Gemini requires this
                }
              }
            }
          ],
          model: {
            id: modelConfig.id,
            provider: modelConfig.provider,
            apiPattern: modelConfig.api.pattern
          }
        }
      ];

      const preparedRequest = gateway.prepareRequest(conversation, tools, modelConfig);
      expect(preparedRequest.messages).toBeDefined();
      expect(preparedRequest.tools).toBeDefined();

      const validation = gateway.validateRequest(conversation, tools, modelConfig);
      expect(validation.valid).toBe(true);
    });
  });

  describe('Parallel Tool Calls', () => {
    it('should handle parallel tool calls in OpenAI', () => {
      const modelConfig = createTestModelConfig('openai');
      const tools: CanonicalTool[] = [
        createTestTool('get_weather'),
        createTestTool('get_news')
      ];

      const conversation: CanonicalMessage[] = [
        {
          uuid: 'msg_par_001',
          timestamp: '2025-10-24T09:30:00Z',
          timeline: {
            sessionId: sessionContext.sessionId,
            conversationId: sessionContext.conversationId,
            turnNumber: 1
          },
          role: 'user',
          type: 'text',
          content: [{ type: 'text', text: 'Get weather and news for NYC' }],
          model: {
            id: modelConfig.id,
            provider: modelConfig.provider,
            apiPattern: modelConfig.api.pattern
          }
        },
        {
          uuid: 'msg_par_002',
          timestamp: '2025-10-24T09:30:05Z',
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
                id: 'call_par_001',
                name: 'get_weather',
                input: { location: 'NYC' }
              }
            },
            {
              type: 'tool_use',
              toolUse: {
                id: 'call_par_002',
                name: 'get_news',
                input: { location: 'NYC' }
              }
            }
          ],
          model: {
            id: modelConfig.id,
            provider: modelConfig.provider,
            apiPattern: modelConfig.api.pattern
          }
        },
        {
          uuid: 'msg_par_003',
          timestamp: '2025-10-24T09:30:10Z',
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
                tool_use_id: 'call_par_001',
                content: 'Rainy, 55°F',
                is_error: false
              }
            },
            {
              type: 'tool_result',
              toolResult: {
                tool_use_id: 'call_par_002',
                content: 'Local elections update',
                is_error: false
              }
            }
          ],
          model: {
            id: modelConfig.id,
            provider: modelConfig.provider,
            apiPattern: modelConfig.api.pattern
          }
        }
      ];

      const preparedRequest = gateway.prepareRequest(conversation, tools, modelConfig);
      expect(preparedRequest.messages).toBeDefined();

      // OpenAI flattens assistant message with tool_calls array
      const adapter = new ChatCompletionsAPIAdapter();
      const providerMessages = adapter.toProviderMessages(
        [conversation[1]], // Assistant message with parallel tool calls
        modelConfig
      );

      const assistantMsg = providerMessages.find((m: any) => m.role === 'assistant');
      expect(assistantMsg).toBeDefined();
      expect((assistantMsg as any).tool_calls).toHaveLength(2);
    });

    it('should handle parallel tool calls in Anthropic', () => {
      const modelConfig = createTestModelConfig('anthropic');
      const tools: CanonicalTool[] = [
        createTestTool('fetch_data'),
        createTestTool('process_data')
      ];

      const assistantMessage: CanonicalMessage = {
        uuid: 'msg_par_ant_001',
        timestamp: '2025-10-24T09:35:00Z',
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
              id: 'toolu_par_001',
              name: 'fetch_data',
              input: { source: 'api' }
            }
          },
          {
            type: 'tool_use',
            toolUse: {
              id: 'toolu_par_002',
              name: 'process_data',
              input: { format: 'json' }
            }
          }
        ],
        model: {
          id: modelConfig.id,
          provider: modelConfig.provider,
          apiPattern: modelConfig.api.pattern
        }
      };

      const adapter = new MessagesAPIAdapter();
      const providerMessages = adapter.toProviderMessages([assistantMessage], modelConfig);

      expect(providerMessages).toHaveLength(1);
      const msg = providerMessages[0] as any;
      expect(msg.content).toHaveLength(2);
      expect(msg.content[0].type).toBe('tool_use');
      expect(msg.content[1].type).toBe('tool_use');
    });
  });

  describe('Error Handling', () => {
    it('should handle tool execution errors', () => {
      const modelConfig = createTestModelConfig('anthropic');
      const tools: CanonicalTool[] = [createTestTool('api_call')];

      const conversation: CanonicalMessage[] = [
        {
          uuid: 'msg_err_001',
          timestamp: '2025-10-24T09:40:00Z',
          timeline: {
            sessionId: sessionContext.sessionId,
            conversationId: sessionContext.conversationId,
            turnNumber: 1
          },
          role: 'user',
          type: 'text',
          content: [{ type: 'text', text: 'Call the API' }],
          model: {
            id: modelConfig.id,
            provider: modelConfig.provider,
            apiPattern: modelConfig.api.pattern
          }
        },
        {
          uuid: 'msg_err_002',
          timestamp: '2025-10-24T09:40:05Z',
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
                id: 'toolu_err_001',
                name: 'api_call',
                input: { endpoint: '/data' }
              }
            }
          ],
          model: {
            id: modelConfig.id,
            provider: modelConfig.provider,
            apiPattern: modelConfig.api.pattern
          }
        },
        {
          uuid: 'msg_err_003',
          timestamp: '2025-10-24T09:40:10Z',
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
                tool_use_id: 'toolu_err_001',
                content: 'Connection timeout',
                is_error: true
              }
            }
          ],
          model: {
            id: modelConfig.id,
            provider: modelConfig.provider,
            apiPattern: modelConfig.api.pattern
          }
        },
        {
          uuid: 'msg_err_004',
          timestamp: '2025-10-24T09:40:15Z',
          timeline: {
            sessionId: sessionContext.sessionId,
            conversationId: sessionContext.conversationId,
            turnNumber: 4
          },
          role: 'assistant',
          type: 'text',
          content: [
            { type: 'text', text: 'I encountered an error connecting to the API.' }
          ],
          model: {
            id: modelConfig.id,
            provider: modelConfig.provider,
            apiPattern: modelConfig.api.pattern
          }
        }
      ];

      const adapter = new MessagesAPIAdapter();
      const providerMessages = adapter.toProviderMessages(conversation, modelConfig);

      // Verify error tool result is preserved
      const toolResultMsg = providerMessages.find(
        (m: any) => m.content?.some?.((c: any) => c.type === 'tool_result')
      ) as any;

      expect(toolResultMsg).toBeDefined();
      const toolResult = toolResultMsg.content.find((c: any) => c.type === 'tool_result');
      expect(toolResult.is_error).toBe(true);
      expect(toolResult.content).toBe('Connection timeout');
    });

    it('should handle missing tool results gracefully', () => {
      const modelConfig = createTestModelConfig('openai');
      const tools: CanonicalTool[] = [createTestTool('incomplete_tool')];

      // Assistant makes tool call but no result follows (incomplete flow)
      const conversation: CanonicalMessage[] = [
        {
          uuid: 'msg_inc_001',
          timestamp: '2025-10-24T09:45:00Z',
          timeline: {
            sessionId: sessionContext.sessionId,
            conversationId: sessionContext.conversationId,
            turnNumber: 1
          },
          role: 'user',
          type: 'text',
          content: [{ type: 'text', text: 'Start process' }],
          model: {
            id: modelConfig.id,
            provider: modelConfig.provider,
            apiPattern: modelConfig.api.pattern
          }
        },
        {
          uuid: 'msg_inc_002',
          timestamp: '2025-10-24T09:45:05Z',
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
                id: 'call_inc_001',
                name: 'incomplete_tool',
                input: { action: 'start' }
              }
            }
          ],
          model: {
            id: modelConfig.id,
            provider: modelConfig.provider,
            apiPattern: modelConfig.api.pattern
          }
        }
      ];

      // Should still be able to prepare request (validation is separate)
      const preparedRequest = gateway.prepareRequest(conversation, tools, modelConfig);
      expect(preparedRequest.messages).toBeDefined();
      expect(preparedRequest.tools).toBeDefined();

      // Gateway should handle this gracefully
      const adapter = new ChatCompletionsAPIAdapter();
      const providerMessages = adapter.toProviderMessages(conversation, modelConfig);
      expect(providerMessages).toBeDefined();
      expect(providerMessages.length).toBeGreaterThan(0);
    });
  });

  describe('Multi-Turn Tool Calling', () => {
    it('should handle multi-turn tool calling conversation', () => {
      const modelConfig = createTestModelConfig('anthropic');
      const tools: CanonicalTool[] = [
        createTestTool('step_one'),
        createTestTool('step_two'),
        createTestTool('step_three')
      ];

      const conversation: CanonicalMessage[] = [
        // Turn 1: User request
        {
          uuid: 'msg_mt_001',
          timestamp: '2025-10-24T09:50:00Z',
          timeline: {
            sessionId: sessionContext.sessionId,
            conversationId: sessionContext.conversationId,
            turnNumber: 1
          },
          role: 'user',
          type: 'text',
          content: [{ type: 'text', text: 'Execute three-step process' }],
          model: {
            id: modelConfig.id,
            provider: modelConfig.provider,
            apiPattern: modelConfig.api.pattern
          }
        },
        // Turn 2: First tool call
        {
          uuid: 'msg_mt_002',
          timestamp: '2025-10-24T09:50:05Z',
          timeline: {
            sessionId: sessionContext.sessionId,
            conversationId: sessionContext.conversationId,
            turnNumber: 2
          },
          role: 'assistant',
          type: 'tool_request',
          content: [
            { type: 'text', text: 'Starting step one...' },
            {
              type: 'tool_use',
              toolUse: {
                id: 'toolu_mt_001',
                name: 'step_one',
                input: { action: 'initialize' }
              }
            }
          ],
          model: {
            id: modelConfig.id,
            provider: modelConfig.provider,
            apiPattern: modelConfig.api.pattern
          }
        },
        // Turn 3: First result
        {
          uuid: 'msg_mt_003',
          timestamp: '2025-10-24T09:50:10Z',
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
                tool_use_id: 'toolu_mt_001',
                content: 'Step one complete',
                is_error: false
              }
            }
          ],
          model: {
            id: modelConfig.id,
            provider: modelConfig.provider,
            apiPattern: modelConfig.api.pattern
          }
        },
        // Turn 4: Second tool call
        {
          uuid: 'msg_mt_004',
          timestamp: '2025-10-24T09:50:15Z',
          timeline: {
            sessionId: sessionContext.sessionId,
            conversationId: sessionContext.conversationId,
            turnNumber: 4
          },
          role: 'assistant',
          type: 'tool_request',
          content: [
            { type: 'text', text: 'Proceeding to step two...' },
            {
              type: 'tool_use',
              toolUse: {
                id: 'toolu_mt_002',
                name: 'step_two',
                input: { action: 'process' }
              }
            }
          ],
          model: {
            id: modelConfig.id,
            provider: modelConfig.provider,
            apiPattern: modelConfig.api.pattern
          }
        },
        // Turn 5: Second result
        {
          uuid: 'msg_mt_005',
          timestamp: '2025-10-24T09:50:20Z',
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
                tool_use_id: 'toolu_mt_002',
                content: 'Step two complete',
                is_error: false
              }
            }
          ],
          model: {
            id: modelConfig.id,
            provider: modelConfig.provider,
            apiPattern: modelConfig.api.pattern
          }
        },
        // Turn 6: Final tool call
        {
          uuid: 'msg_mt_006',
          timestamp: '2025-10-24T09:50:25Z',
          timeline: {
            sessionId: sessionContext.sessionId,
            conversationId: sessionContext.conversationId,
            turnNumber: 6
          },
          role: 'assistant',
          type: 'tool_request',
          content: [
            { type: 'text', text: 'Executing final step...' },
            {
              type: 'tool_use',
              toolUse: {
                id: 'toolu_mt_003',
                name: 'step_three',
                input: { action: 'finalize' }
              }
            }
          ],
          model: {
            id: modelConfig.id,
            provider: modelConfig.provider,
            apiPattern: modelConfig.api.pattern
          }
        },
        // Turn 7: Final result
        {
          uuid: 'msg_mt_007',
          timestamp: '2025-10-24T09:50:30Z',
          timeline: {
            sessionId: sessionContext.sessionId,
            conversationId: sessionContext.conversationId,
            turnNumber: 7
          },
          role: 'user',
          type: 'tool_response',
          content: [
            {
              type: 'tool_result',
              toolResult: {
                tool_use_id: 'toolu_mt_003',
                content: 'All steps complete',
                is_error: false
              }
            }
          ],
          model: {
            id: modelConfig.id,
            provider: modelConfig.provider,
            apiPattern: modelConfig.api.pattern
          }
        },
        // Turn 8: Final response
        {
          uuid: 'msg_mt_008',
          timestamp: '2025-10-24T09:50:35Z',
          timeline: {
            sessionId: sessionContext.sessionId,
            conversationId: sessionContext.conversationId,
            turnNumber: 8
          },
          role: 'assistant',
          type: 'text',
          content: [
            { type: 'text', text: 'Three-step process completed successfully.' }
          ],
          model: {
            id: modelConfig.id,
            provider: modelConfig.provider,
            apiPattern: modelConfig.api.pattern
          }
        }
      ];

      const preparedRequest = gateway.prepareRequest(conversation, tools, modelConfig);
      expect(preparedRequest.messages).toBeDefined();
      expect(preparedRequest.tools).toHaveLength(3);

      const validation = gateway.validateRequest(conversation, tools, modelConfig);
      expect(validation.valid).toBe(true);

      // Verify timeline tracking
      expect(conversation[0].timeline.turnNumber).toBe(1);
      expect(conversation[7].timeline.turnNumber).toBe(8);
    });
  });
});
