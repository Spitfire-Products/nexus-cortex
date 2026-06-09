/**
 * Multi-turn test with grok-4-fast to see if thinking appears
 * with conversation history and beta headers
 */

import Anthropic from '@anthropic-ai/sdk';
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const XAI_API_KEY = process.env.XAI_API_KEY;

describe('XAI grok-4-fast multi-turn thinking test', () => {
  it('should test if beta header and multi-turn triggers thinking', async () => {
    if (!XAI_API_KEY) {
      console.log('⚠️  Skipping: XAI_API_KEY not set');
      return;
    }

    console.log('\n' + '='.repeat(70));
    console.log('GROK-4-FAST MULTI-TURN TEST WITH BETA HEADERS');
    console.log('='.repeat(70));

    // Test with exact headers from cortex_v3 capture
    const client = new Anthropic({
      apiKey: XAI_API_KEY!,
      baseURL: 'https://api.x.ai',
      defaultHeaders: {
        'anthropic-beta': 'interleaved-thinking-2025-05-14'
      }
    });

    console.log('\n📡 Test 1: Single-turn with beta header');
    let test1Events: any[] = [];
    try {
      const stream = await client.messages.stream({
        model: 'grok-4-fast',
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: 'Explain why the sky is blue in 2-3 sentences. Think through this carefully.'
        }]
      });

      for await (const event of stream) {
        test1Events.push(event);
      }

      const finalMsg = await stream.finalMessage();
      const contentTypes = finalMsg.content.map((c: any) => c.type);
      console.log(`   Content types: ${contentTypes.join(', ')}`);
      console.log(`   Has thinking: ${contentTypes.includes('thinking') ? 'YES' : 'NO'}`);
      console.log(`   Has redacted_thinking: ${contentTypes.includes('redacted_thinking') ? 'YES 🔐' : 'NO'}`);
    } catch (error: any) {
      console.error(`   ❌ Error: ${error.message}`);
    }

    console.log('\n📡 Test 2: Multi-turn with simulated thinking history');
    let test2Events: any[] = [];
    try {
      // Simulate a conversation with previous redacted_thinking blocks
      const stream = await client.messages.stream({
        model: 'grok-4-fast',
        max_tokens: 1024,
        messages: [
          {
            role: 'user',
            content: 'What is 2+2?'
          },
          {
            role: 'assistant',
            content: [
              {
                // @ts-ignore - Include a fake redacted_thinking block
                type: 'redacted_thinking',
                data: 'fake_encrypted_data_ABC123=='
              },
              {
                type: 'text',
                text: '2+2 equals 4.'
              }
            ]
          },
          {
            role: 'user',
            content: 'Now explain why the sky is blue. Think carefully.'
          }
        ]
      });

      for await (const event of stream) {
        test2Events.push(event);
      }

      const finalMsg = await stream.finalMessage();
      const contentTypes = finalMsg.content.map((c: any) => c.type);
      console.log(`   Content types: ${contentTypes.join(', ')}`);
      console.log(`   Has thinking: ${contentTypes.includes('thinking') ? 'YES' : 'NO'}`);
      console.log(`   Has redacted_thinking: ${contentTypes.includes('redacted_thinking') ? 'YES 🔐' : 'NO'}`);
    } catch (error: any) {
      console.error(`   ❌ Error: ${error.message}`);
    }

    console.log('\n📡 Test 3: grok-code-fast-1 for comparison');
    let test3Events: any[] = [];
    try {
      const stream = await client.messages.stream({
        model: 'grok-code-fast-1',
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: 'Explain why the sky is blue in 2-3 sentences. Think through this carefully.'
        }]
      });

      let thinkingCount = 0;
      for await (const event of stream) {
        test3Events.push(event);
        if (event.type === 'content_block_delta' && (event.delta as any)?.type === 'thinking_delta') {
          thinkingCount++;
        }
      }

      const finalMsg = await stream.finalMessage();
      const contentTypes = finalMsg.content.map((c: any) => c.type);
      console.log(`   Content types: ${contentTypes.join(', ')}`);
      console.log(`   thinking_delta events: ${thinkingCount}`);
      console.log(`   Has thinking: ${contentTypes.includes('thinking') ? 'YES' : 'NO'}`);
      console.log(`   Has redacted_thinking: ${contentTypes.includes('redacted_thinking') ? 'YES 🔐' : 'NO'}`);
    } catch (error: any) {
      console.error(`   ❌ Error: ${error.message}`);
    }

    // Save results
    const results = {
      test1_single_turn_beta: test1Events,
      test2_multiturn_with_history: test2Events,
      test3_grok_code_fast_1: test3Events
    };

    const outputPath = path.join(process.cwd(), 'xai-grok-4-fast-multiturn.json');
    fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
    console.log(`\n💾 Results saved to: ${outputPath}`);

    console.log('\n' + '='.repeat(70));
    console.log('CONCLUSION');
    console.log('='.repeat(70));
    console.log('If grok-4-fast shows thinking in any test, we found the trigger!');
    console.log('If only grok-code-fast-1 shows thinking, then grok-4-fast may not');
    console.log('expose thinking via Messages API at all.');

    expect(results).toBeDefined();
  }, 120000);
});
