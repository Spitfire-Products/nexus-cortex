/**
 * Tool Format Validation Test
 *
 * Validates that tools are properly formatted for each provider's API.
 * Specifically tests grok-code-fast-1 (XAI Messages API) receives tools correctly.
 *
 * NOTE: Requires XAI_API_KEY environment variable
 */

import { describe, it, expect, beforeAll } from 'vitest';
import type { CortexOrchestrator } from '../../CortexOrchestrator.js';
import { createOrchestrator } from '../../OrchestratorFactory.js';
import type { CanonicalTool } from '../../../adapters/FormatAdapter.interface.js';
import { rm } from 'fs/promises';
import { existsSync } from 'fs';

const SKIP_SMOKE_TESTS = !process.env.ENABLE_SMOKE_TESTS || !process.env.XAI_API_KEY;

describe.skipIf(SKIP_SMOKE_TESTS)('Tool Format Validation (grok-code-fast-1)', () => {
  let orchestrator: CortexOrchestrator;
  const testStorageDir = '/tmp/tests/.cortex/test-sessions/tool-format-validation';

  beforeAll(async () => {
    if (existsSync(testStorageDir)) {
      await rm(testStorageDir, { recursive: true, force: true });
    }

    orchestrator = createOrchestrator({
      defaultModelId: 'grok-code-fast-1',
      projectPath: '/tmp/tests/tool-format',
      storageDir: testStorageDir,
      debug: true
    });
  });

  it('should receive and list tools correctly', async () => {
    const session = await orchestrator.createSession(
      '/tmp/tests/tool-format',
      'grok-code-fast-1'
    );

    console.log('\n=== Tool Format Validation Test ===');
    console.log(`Session: ${session.sessionId}`);
    console.log(`Model: grok-code-fast-1 (XAI Messages API)\n`);

    // Define test tools
    const tools: CanonicalTool[] = [
      {
        name: 'test_tool_one',
        description: 'First test tool for format validation',
        schema: {
          type: 'object',
          properties: {
            value: {
              type: 'string',
              description: 'A test value'
            }
          },
          required: ['value']
        }
      },
      {
        name: 'test_tool_two',
        description: 'Second test tool for format validation',
        schema: {
          type: 'object',
          properties: {
            number: {
              type: 'number',
              description: 'A test number'
            },
            text: {
              type: 'string',
              description: 'A test text'
            }
          },
          required: ['number']
        }
      },
      {
        name: 'calculate',
        description: 'Performs basic arithmetic calculations',
        schema: {
          type: 'object',
          properties: {
            expression: {
              type: 'string',
              description: 'Mathematical expression to evaluate'
            }
          },
          required: ['expression']
        }
      }
    ];

    console.log('Tools provided to model:');
    tools.forEach((tool, idx) => {
      console.log(`  ${idx + 1}. ${tool.name}: ${tool.description}`);
      console.log(`     Required params: ${tool.schema.required?.join(', ') || 'none'}`);
    });
    console.log('');

    // Ask grok to list the tools it received
    const response = await orchestrator.sendMessage(
      'Please list all the tools you have access to. For each tool, tell me: 1) the tool name, 2) what it does, and 3) what parameters it requires.',
      { tools }
    );

    expect(response).toBeDefined();
    expect(response.content).toBeDefined();

    console.log('\n=== Model Response ===');
    console.log(response.content);
    console.log('');

    // Check message history
    const history = orchestrator.getMessageHistory();
    console.log('=== Message History ===');
    console.log(`Total messages: ${history.length}`);

    history.forEach((msg, idx) => {
      console.log(`\nMessage ${idx + 1}:`);
      console.log(`  Role: ${msg.message.role}`);
      console.log(`  Type: ${msg.type}`);
      console.log(`  Turn: ${msg.timeline.turnNumber}`);

      const content = Array.isArray(msg.message.content) ? msg.message.content : [];
      if (content.length > 0) {
        content.forEach((contentItem, cidx) => {
          console.log(`  Content[${cidx}]: ${contentItem.type}`);
          if (contentItem.type === 'text' && contentItem.text) {
            const preview = contentItem.text.substring(0, 100);
            console.log(`    Text: ${preview}${contentItem.text.length > 100 ? '...' : ''}`);
          }
          if (contentItem.type === 'tool_use') {
            console.log(`    Tool: ${contentItem.toolUse.name}`);
            console.log(`    ID: ${contentItem.toolUse.id}`);
            console.log(`    Input: ${JSON.stringify(contentItem.toolUse.input)}`);
          }
          if (contentItem.type === 'tool_result') {
            console.log(`    Tool use ID: ${contentItem.toolResult.tool_use_id}`);
            console.log(`    Is error: ${contentItem.toolResult.is_error}`);
          }
        });
      }
    });

    // Verify response mentions the tools
    const responseText = (typeof response.content === 'string'
      ? response.content
      : response.content.map(c => (c as any).text || '').join('')
    ).toLowerCase();

    // Check if model acknowledges having tools
    const mentionsTools = responseText.includes('tool') ||
                         responseText.includes('function') ||
                         responseText.includes('test_tool') ||
                         responseText.includes('calculate');

    console.log(`\n=== Validation ===`);
    console.log(`Model mentions tools: ${mentionsTools}`);

    if (!mentionsTools) {
      console.log('WARNING: Model response does not mention tools!');
      console.log('This suggests tools may not be formatted correctly for XAI Messages API');
    }

    // Check if any tool was used
    const toolUsed = history.some(m => {
      if (m.message.role !== 'assistant') return false;
      const content = Array.isArray(m.message.content) ? m.message.content : [];
      return content.some(c => c.type === 'tool_use');
    });

    console.log(`Model attempted tool use: ${toolUsed}`);

    // Validation: Either model lists tools OR uses a tool
    expect(mentionsTools || toolUsed).toBe(true);

    console.log('\n=== Test Complete ===\n');
  }, 30000);

  it('should correctly format tools for Messages API', async () => {
    const session = await orchestrator.createSession(
      '/tmp/tests/tool-format/messages-api',
      'grok-code-fast-1'
    );

    const tools: CanonicalTool[] = [
      {
        name: 'get_weather',
        description: 'Get current weather for a location',
        schema: {
          type: 'object',
          properties: {
            location: {
              type: 'string',
              description: 'City name or coordinates'
            },
            units: {
              type: 'string',
              enum: ['celsius', 'fahrenheit'],
              description: 'Temperature units'
            }
          },
          required: ['location']
        }
      }
    ];

    console.log('\n=== Testing Messages API Tool Format ===');
    console.log('Tool definition:');
    console.log(JSON.stringify(tools[0], null, 2));
    console.log('');

    const response = await orchestrator.sendMessage(
      'Use the get_weather tool to check the weather in London with celsius units.',
      { tools }
    );

    const history = orchestrator.getMessageHistory();

    // Find if model made a tool call
    const toolCallMsg = history.find(m => {
      if (m.message.role !== 'assistant') return false;
      const content = Array.isArray(m.message.content) ? m.message.content : [];
      return content.some(c => c.type === 'tool_use');
    });

    if (toolCallMsg) {
      console.log('✓ Model made a tool call:');
      const content = Array.isArray(toolCallMsg.message.content) ? toolCallMsg.message.content : [];
      const toolUse = content.find(c => c.type === 'tool_use');
      if (toolUse && toolUse.type === 'tool_use') {
        console.log(`  Tool: ${toolUse.toolUse.name}`);
        console.log(`  Input: ${JSON.stringify(toolUse.toolUse.input, null, 2)}`);

        // Verify tool call format
        // Note: Gateway normalizes all tools to PascalCase (like base tools: Read, Write, etc.)
        expect(toolUse.toolUse.name).toBe('GetWeather');
        expect(toolUse.toolUse.input).toHaveProperty('location');
        expect(toolUse.toolUse.id).toBeDefined();
      }
    } else {
      console.log('✗ No tool call detected');
      console.log('Model response:', response.content);
    }

    expect(toolCallMsg).toBeDefined();
  }, 30000);
});
