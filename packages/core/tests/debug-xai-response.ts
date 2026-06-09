/**
 * Debug script to see raw XAI API response
 */

import { MessagesAPIAdapter } from './src/adapters/MessagesAPIAdapter.js';
import { grokCodeFast1 } from './src/models/cards/xai/grok-code-fast-1.js';

const apiKey = process.env.XAI_API_KEY;
if (!apiKey) {
  console.error('XAI_API_KEY not set');
  process.exit(1);
}

const adapter = new MessagesAPIAdapter();

// Prepare tools using validation
const tools = adapter.toProviderTools([
  {
    name: 'read_file',
    description: 'Read a file from the filesystem',
    schema: {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: 'Path to the file to read'
        }
      },
      required: ['file_path']
    }
  }
], grokCodeFast1);

console.log('Sending tools to XAI:');
console.log(JSON.stringify(tools, null, 2));

// Make API request
const requestBody = {
  model: 'grok-code-fast-1',
  max_tokens: 1024,
  messages: [
    {
      role: 'user',
      content: 'Please read the file /etc/hosts using the read_file tool'
    }
  ],
  tools
};

console.log('\n=== REQUEST ===');
console.log(JSON.stringify(requestBody, null, 2));

fetch('https://api.x.ai/v1/messages', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'anthropic-version': '2023-06-01'
  },
  body: JSON.stringify(requestBody)
})
.then(async (response) => {
  const responseText = await response.text();
  console.log('\n=== RESPONSE STATUS ===');
  console.log(response.status, response.statusText);
  console.log('\n=== RAW RESPONSE ===');
  console.log(responseText);

  try {
    const json = JSON.parse(responseText);
    console.log('\n=== PARSED RESPONSE ===');
    console.log(JSON.stringify(json, null, 2));

    if (json.content) {
      console.log('\n=== CONTENT BLOCKS ===');
      json.content.forEach((block: any, i: number) => {
        console.log(`\nBlock ${i}:`);
        console.log(JSON.stringify(block, null, 2));
      });
    }
  } catch (e) {
    console.error('Failed to parse JSON response');
  }
})
.catch(error => {
  console.error('\n=== ERROR ===');
  console.error(error);
});
