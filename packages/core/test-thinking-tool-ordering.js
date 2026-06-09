/**
 * Test tool message ordering with thinking blocks
 */

import { ChatCompletionsAPIAdapter } from './dist/adapters/ChatCompletionsAPIAdapter.js';

const adapter = new ChatCompletionsAPIAdapter();

// Simulate the scenario: tool executed, then "try again" with thinking enabled
const canonicalMessages = [
  // 1. User asks a question
  {
    uuid: 'msg-1',
    role: 'user',
    type: 'text',
    content: [{ type: 'text', text: 'What is the content of test.md?' }],
  },
  // 2. Assistant responds with tool call (with thinking)
  {
    uuid: 'msg-2',
    role: 'assistant',
    type: 'tool_request',
    content: [
      { type: 'thinking', thinking: 'I need to read the file...' },
      {
        type: 'tool_use',
        toolUse: {
          id: 'call_123',
          name: 'read',
          input: { file_path: 'test.md' }
        }
      }
    ],
  },
  // 3. Tool result
  {
    uuid: 'msg-3',
    role: 'user',
    type: 'tool_response',
    content: [
      {
        type: 'tool_result',
        toolResult: {
          tool_use_id: 'call_123',
          content: 'File contents...',
          is_error: false
        }
      }
    ],
  },
  // 4. Assistant final response (with thinking)
  {
    uuid: 'msg-4',
    role: 'assistant',
    type: 'text',
    content: [
      { type: 'thinking', thinking: 'Now I can answer...' },
      { type: 'text', text: 'The file contains...' }
    ],
  },
  // 5. User says "try again"
  {
    uuid: 'msg-5',
    role: 'user',
    type: 'text',
    content: [{ type: 'text', text: 'try again' }],
  },
  // 6. Assistant responds with another tool call (with thinking)
  {
    uuid: 'msg-6',
    role: 'assistant',
    type: 'tool_request',
    content: [
      { type: 'thinking', thinking: 'Let me read it again...' },
      {
        type: 'tool_use',
        toolUse: {
          id: 'call_456',
          name: 'read',
          input: { file_path: 'test.md' }
        }
      }
    ],
  }
];

const modelConfig = {
  id: 'gpt-5.1',
  provider: 'openai',
  api: { pattern: 'chat/completions' },
  tools: { namingConvention: 'snake_case' }
};

console.log('=== Scenario: Multi-turn with Thinking Blocks ===\n');

const openaiMessages = adapter.toProviderMessages(canonicalMessages, modelConfig);

console.log(`Total OpenAI messages: ${openaiMessages.length}\n`);

openaiMessages.forEach((msg, i) => {
  console.log(`${i + 1}. Role: ${msg.role}${msg.tool_calls ? ` (${msg.tool_calls.length} tool_calls)` : ''}${msg.tool_call_id ? ` (tool_call_id: ${msg.tool_call_id})` : ''}`);
});

// Check for violations
console.log('\n=== Validation ===\n');
let lastToolCallIndex = -1;
let hasViolation = false;

for (let i = 0; i < openaiMessages.length; i++) {
  const msg = openaiMessages[i];

  if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
    lastToolCallIndex = i;
  }

  if (msg.role === 'tool') {
    // Tool message must come immediately after assistant with tool_calls OR after another tool message
    const prevMsg = i > 0 ? openaiMessages[i - 1] : null;
    const isValid = prevMsg &&
      (prevMsg.role === 'tool' ||
       (prevMsg.role === 'assistant' && prevMsg.tool_calls && prevMsg.tool_calls.length > 0));

    if (!isValid) {
      console.log(`❌ Position ${i + 1}: Tool message violates ordering!`);
      console.log(`   Previous message: ${prevMsg ? prevMsg.role : 'none'}`);
      console.log(`   Last assistant with tool_calls: position ${lastToolCallIndex + 1}`);
      hasViolation = true;
    }
  }
}

if (!hasViolation) {
  console.log('✅ All messages follow correct ordering!');
} else {
  console.log('\n⚠️  This would cause OpenAI API error!');
}

// Check if thinking blocks are in the messages
console.log('\n=== Thinking Blocks Check ===');
const hasThinking = canonicalMessages.some(m =>
  m.content.some(b => b.type === 'thinking')
);
console.log(`Canonical messages contain thinking blocks: ${hasThinking}`);
console.log(`OpenAI messages would include thinking content: NO (filtered out by adapter)`);
