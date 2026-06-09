/**
 * Diagnostic test for GPT-5.1 tool execution
 * Run with: node test-gpt51-tools.js
 */

import { ModularModelRegistry } from './dist/models/registry/ModularModelRegistry.js';
import { ChatCompletionsAPIAdapter } from './dist/adapters/ChatCompletionsAPIAdapter.js';

// Check if gpt-5.1 model exists and has correct configuration
const registry = new ModularModelRegistry({ debug: true });

console.log('\n=== GPT-5.1 Model Configuration ===');
try {
  const gpt51 = registry.getModel('gpt-5.1');
  console.log('Model ID:', gpt51.id);
  console.log('Provider:', gpt51.provider);
  console.log('API Pattern:', gpt51.api.pattern);
  console.log('Tools Supported:', gpt51.tools.supported);
  console.log('Tool Adapter:', gpt51.tools.adapter);
  console.log('Naming Convention:', gpt51.tools.namingConvention);
  console.log('Max Tools:', gpt51.tools.maxTools);
  console.log('Parallel Tool Calls:', gpt51.tools.parallelToolCalls);
  console.log('Reasoning Supported:', gpt51.reasoning?.supported || false);
} catch (error) {
  console.error('Failed to get model:', error.message);
  process.exit(1);
}

// Test adapter conversion
console.log('\n=== Testing ChatCompletionsAPIAdapter ===');
const adapter = new ChatCompletionsAPIAdapter();

// Simulate an OpenAI response with tool_calls
const mockOpenAIResponse = {
  id: 'chatcmpl-test',
  object: 'chat.completion',
  created: Date.now(),
  model: 'gpt-5.1',
  choices: [{
    index: 0,
    message: {
      role: 'assistant',
      content: null,
      tool_calls: [{
        id: 'call_test123',
        type: 'function',
        function: {
          name: 'list_files',
          arguments: '{"path":"."}'
        }
      }]
    },
    finish_reason: 'tool_calls'
  }],
  usage: {
    prompt_tokens: 50,
    completion_tokens: 20,
    total_tokens: 70
  }
};

// Extract messages
const messages = mockOpenAIResponse.choices.map(c => c.message);
console.log('Extracted messages:', JSON.stringify(messages, null, 2));

// Convert to canonical format
const modelConfig = registry.getModel('gpt-5.1');
const sessionContext = {
  sessionId: 'test-session',
  conversationId: 'test-conv',
  turnNumber: 1
};

const canonicalMessages = adapter.fromProviderMessages(messages, modelConfig, sessionContext);
console.log('\n=== Canonical Messages ===');
console.log(JSON.stringify(canonicalMessages, null, 2));

// Check if tool_use blocks were extracted
const toolUseBlocks = canonicalMessages[0].content.filter(b => b.type === 'tool_use');
console.log('\n=== Tool Use Blocks ===');
console.log('Count:', toolUseBlocks.length);
if (toolUseBlocks.length > 0) {
  console.log('Tool Uses:', JSON.stringify(toolUseBlocks, null, 2));
} else {
  console.error('❌ NO TOOL USE BLOCKS FOUND! This is the problem.');
}

console.log('\n=== Test Complete ===');
