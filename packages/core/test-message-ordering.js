/**
 * Test to understand the tool message ordering issue
 */

import { ChatCompletionsAPIAdapter } from './dist/adapters/ChatCompletionsAPIAdapter.js';

const adapter = new ChatCompletionsAPIAdapter();

// Simulate the canonical message flow that might be causing the issue
const canonicalMessages = [
  // 1. User asks a question
  {
    uuid: 'msg-1',
    timestamp: new Date().toISOString(),
    timeline: { sessionId: 'test', conversationId: 'test', turnNumber: 1 },
    role: 'user',
    type: 'text',
    content: [{ type: 'text', text: 'What is the content of test.md?' }],
    model: { id: 'gpt-5.1', provider: 'openai', apiPattern: 'chat/completions' }
  },
  // 2. Assistant responds with tool call
  {
    uuid: 'msg-2',
    timestamp: new Date().toISOString(),
    timeline: { sessionId: 'test', conversationId: 'test', turnNumber: 2 },
    role: 'assistant',
    type: 'tool_request',
    content: [
      {
        type: 'tool_use',
        toolUse: {
          id: 'call_123',
          name: 'read',
          input: { file_path: 'test.md', limit: 2000 }
        }
      }
    ],
    model: { id: 'gpt-5.1', provider: 'openai', apiPattern: 'chat/completions' }
  },
  // 3. Tool result comes back
  {
    uuid: 'msg-3',
    timestamp: new Date().toISOString(),
    timeline: { sessionId: 'test', conversationId: 'test', turnNumber: 3 },
    role: 'user',
    type: 'tool_response',
    content: [
      {
        type: 'tool_result',
        toolResult: {
          tool_use_id: 'call_123',
          content: 'File contents here...',
          is_error: false
        }
      }
    ],
    model: { id: 'gpt-5.1', provider: 'openai', apiPattern: 'chat/completions' }
  },
  // 4. User asks follow-up
  {
    uuid: 'msg-4',
    timestamp: new Date().toISOString(),
    timeline: { sessionId: 'test', conversationId: 'test', turnNumber: 4 },
    role: 'user',
    type: 'text',
    content: [{ type: 'text', text: 'try again' }],
    model: { id: 'gpt-5.1', provider: 'openai', apiPattern: 'chat/completions' }
  }
];

const modelConfig = {
  id: 'gpt-5.1',
  provider: 'openai',
  api: { pattern: 'chat/completions' },
  tools: { namingConvention: 'snake_case' }
};

console.log('=== Converting Canonical Messages to OpenAI Format ===\n');

const openaiMessages = adapter.toProviderMessages(canonicalMessages, modelConfig);

console.log('OpenAI Messages (in order):');
openaiMessages.forEach((msg, i) => {
  console.log(`\n${i + 1}. Role: ${msg.role}`);
  if (msg.role === 'tool') {
    console.log(`   tool_call_id: ${msg.tool_call_id}`);
    console.log(`   content: ${msg.content.substring(0, 50)}...`);
  } else if (msg.tool_calls) {
    console.log(`   content: ${msg.content || '(null)'}`);
    console.log(`   tool_calls: ${msg.tool_calls.length} call(s)`);
    msg.tool_calls.forEach(tc => {
      console.log(`     - ${tc.function.name} (id: ${tc.id})`);
    });
  } else {
    console.log(`   content: ${msg.content}`);
  }
});

// Check for ordering violations
console.log('\n=== Checking for OpenAI Ordering Violations ===\n');
let lastAssistantWithToolCalls = -1;
let valid = true;

openaiMessages.forEach((msg, i) => {
  if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
    lastAssistantWithToolCalls = i;
    console.log(`✓ Position ${i + 1}: Assistant with tool_calls`);
  } else if (msg.role === 'tool') {
    if (lastAssistantWithToolCalls === i - 1 ||
        (i > 0 && openaiMessages[i - 1].role === 'tool')) {
      console.log(`✓ Position ${i + 1}: Tool message correctly follows assistant or another tool`);
    } else {
      console.log(`✗ Position ${i + 1}: Tool message VIOLATES ordering!`);
      console.log(`   Last assistant with tool_calls was at position ${lastAssistantWithToolCalls + 1}`);
      valid = false;
    }
  }
});

if (valid) {
  console.log('\n✅ Message ordering is valid!');
} else {
  console.log('\n❌ Message ordering VIOLATES OpenAI requirements!');
}
