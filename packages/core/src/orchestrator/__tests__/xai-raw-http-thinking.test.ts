/**
 * Raw HTTP Test: Bypass Anthropic SDK to see what XAI really sends
 *
 * The Anthropic SDK might be filtering out redacted_thinking blocks.
 * This test makes raw HTTP requests to see the actual API response.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const XAI_API_KEY = process.env.XAI_API_KEY;

async function makeRawXAIRequest(params: any = {}) {
  const response = await fetch('https://api.x.ai/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': XAI_API_KEY!,
      'anthropic-version': '2023-06-01',
      ...params.headers
    },
    body: JSON.stringify({
      model: 'grok-4-fast',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: 'Explain why the sky is blue in 2-3 sentences. Think through this carefully.'
      }],
      ...params.body
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`HTTP ${response.status}: ${error}`);
  }

  return await response.json();
}

async function makeRawXAIStreamRequest(params: any = {}) {
  const response = await fetch('https://api.x.ai/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': XAI_API_KEY!,
      'anthropic-version': '2023-06-01',
      ...params.headers
    },
    body: JSON.stringify({
      model: 'grok-4-fast',
      max_tokens: 1024,
      stream: true,
      messages: [{
        role: 'user',
        content: 'Explain why the sky is blue in 2-3 sentences. Think through this carefully.'
      }],
      ...params.body
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`HTTP ${response.status}: ${error}`);
  }

  const events: any[] = [];
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6).trim();
        if (data === '[DONE]') continue;

        try {
          const event = JSON.parse(data);
          events.push(event);
        } catch (e) {
          console.log(`Failed to parse: ${data}`);
        }
      }
    }
  }

  return events;
}

describe('XAI raw HTTP thinking test', () => {
  it('should check what XAI actually sends (bypassing SDK)', async () => {
    if (!XAI_API_KEY) {
      console.log('⚠️  Skipping: XAI_API_KEY not set');
      return;
    }

    console.log('\n' + '='.repeat(70));
    console.log('RAW HTTP TEST - BYPASSING ANTHROPIC SDK');
    console.log('='.repeat(70));

    const results: any = {
      nonStreaming: {},
      streaming: {}
    };

    // Test 1: Non-streaming request (default)
    console.log('\n📡 Test 1: Non-streaming request (default parameters)');
    try {
      const response1 = await makeRawXAIRequest({});
      const contentTypes = response1.content?.map((c: any) => c.type) || [];

      console.log(`   Response ID: ${response1.id}`);
      console.log(`   Model: ${response1.model}`);
      console.log(`   Content blocks: ${response1.content?.length || 0}`);
      console.log(`   Content types: ${contentTypes.join(', ')}`);

      // Check for redacted_thinking
      const redactedBlock = response1.content?.find((c: any) => c.type === 'redacted_thinking');
      if (redactedBlock) {
        console.log(`   🔐 FOUND redacted_thinking! Data length: ${redactedBlock.data?.length || 0}`);
        console.log(`   First 100 chars of data: ${redactedBlock.data?.substring(0, 100)}`);
      } else {
        console.log(`   ❌ NO redacted_thinking found`);
      }

      results.nonStreaming.default = {
        contentTypes,
        hasRedactedThinking: !!redactedBlock,
        fullResponse: response1
      };
    } catch (error: any) {
      console.error(`   ❌ Error: ${error.message}`);
      results.nonStreaming.default = { error: error.message };
    }

    // Test 2: Non-streaming with use_encrypted_content: true
    console.log('\n📡 Test 2: Non-streaming with use_encrypted_content: true');
    try {
      const response2 = await makeRawXAIRequest({
        body: { use_encrypted_content: true }
      });
      const contentTypes = response2.content?.map((c: any) => c.type) || [];

      console.log(`   Content types: ${contentTypes.join(', ')}`);

      const redactedBlock = response2.content?.find((c: any) => c.type === 'redacted_thinking');
      if (redactedBlock) {
        console.log(`   🔐 FOUND redacted_thinking! Data length: ${redactedBlock.data?.length || 0}`);
      } else {
        console.log(`   ❌ NO redacted_thinking found`);
      }

      results.nonStreaming.encrypted = {
        contentTypes,
        hasRedactedThinking: !!redactedBlock
      };
    } catch (error: any) {
      console.error(`   ❌ Error: ${error.message}`);
      results.nonStreaming.encrypted = { error: error.message };
    }

    // Test 3: Streaming request (default)
    console.log('\n📡 Test 3: Streaming request (default parameters)');
    try {
      const events = await makeRawXAIStreamRequest({});

      console.log(`   Total events: ${events.length}`);

      // Analyze events
      const eventTypes = [...new Set(events.map(e => e.type))];
      console.log(`   Event types: ${eventTypes.join(', ')}`);

      // Look for thinking_delta events
      const thinkingDeltas = events.filter(e =>
        e.type === 'content_block_delta' && e.delta?.type === 'thinking_delta'
      );
      console.log(`   thinking_delta events: ${thinkingDeltas.length}`);

      // Look for redacted_thinking_delta events
      const redactedDeltas = events.filter(e =>
        e.type === 'content_block_delta' && e.delta?.type === 'redacted_thinking_delta'
      );
      console.log(`   redacted_thinking_delta events: ${redactedDeltas.length}`);

      // Check message_start for content types
      const msgStart = events.find(e => e.type === 'message_start');
      if (msgStart) {
        const contentTypes = msgStart.message?.content?.map((c: any) => c.type) || [];
        console.log(`   message_start content types: ${contentTypes.join(', ')}`);

        const hasRedacted = contentTypes.includes('redacted_thinking');
        if (hasRedacted) {
          console.log(`   🔐 message_start HAS redacted_thinking!`);
        }
      }

      results.streaming.default = {
        totalEvents: events.length,
        eventTypes,
        thinkingDeltas: thinkingDeltas.length,
        redactedDeltas: redactedDeltas.length,
        events
      };
    } catch (error: any) {
      console.error(`   ❌ Error: ${error.message}`);
      results.streaming.default = { error: error.message };
    }

    // Summary
    console.log('\n' + '='.repeat(70));
    console.log('SUMMARY');
    console.log('='.repeat(70));

    console.log('\nNon-Streaming:');
    Object.keys(results.nonStreaming).forEach(key => {
      const result = results.nonStreaming[key];
      if (result.error) {
        console.log(`  ${key}: ERROR - ${result.error}`);
      } else {
        console.log(`  ${key}:`);
        console.log(`    Content types: ${result.contentTypes?.join(', ')}`);
        console.log(`    Has redacted_thinking: ${result.hasRedactedThinking ? '✅ YES' : '❌ NO'}`);
      }
    });

    console.log('\nStreaming:');
    Object.keys(results.streaming).forEach(key => {
      const result = results.streaming[key];
      if (result.error) {
        console.log(`  ${key}: ERROR - ${result.error}`);
      } else {
        console.log(`  ${key}:`);
        console.log(`    thinking_delta events: ${result.thinkingDeltas}`);
        console.log(`    redacted_thinking_delta events: ${result.redactedDeltas}`);
      }
    });

    // Save results
    const outputPath = path.join(process.cwd(), 'xai-raw-http-results.json');
    fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
    console.log(`\n💾 Full results saved to: ${outputPath}`);

    // Conclusion
    if (results.nonStreaming.default?.hasRedactedThinking || results.nonStreaming.encrypted?.hasRedactedThinking) {
      console.log('\n✅ REDACTED_THINKING FOUND in non-streaming response!');
      console.log('   The Anthropic SDK was filtering it out.');
    } else {
      console.log('\n❌ NO REDACTED_THINKING in any configuration');
      console.log('   XAI may not send thinking for this model via Messages API');
    }

    expect(results).toBeDefined();
  }, 120000);
});
