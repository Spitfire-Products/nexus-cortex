/**
 * Discovery Test: Figure out how to get grok-4-fast thinking
 *
 * This test will try different approaches:
 * 1. Default (no parameters)
 * 2. use_encrypted_content: false
 * 3. use_encrypted_content: true
 * 4. Check for thinking_delta during streaming
 * 5. Check for redacted_thinking in final message
 */

import Anthropic from '@anthropic-ai/sdk';
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const XAI_API_KEY = process.env.XAI_API_KEY;

interface TestResult {
  config: string;
  thinkingDeltaCount: number;
  textDeltaCount: number;
  finalMessageContentTypes: string[];
  hasPlainThinking: boolean;
  hasRedactedThinking: boolean;
  events: any[];
}

async function testConfiguration(
  configName: string,
  requestParams: any
): Promise<TestResult> {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Testing: ${configName}`);
  console.log(`${'='.repeat(60)}\n`);

  const client = new Anthropic({
    apiKey: XAI_API_KEY!,
    baseURL: 'https://api.x.ai',
  });

  const stream = await client.messages.stream({
    model: 'grok-4-fast',
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: 'Explain why the sky is blue in 2-3 sentences. Think through this carefully.'
    }],
    ...requestParams
  });

  let thinkingDeltaCount = 0;
  let textDeltaCount = 0;
  const events: any[] = [];

  for await (const event of stream) {
    events.push(event);

    if (event.type === 'content_block_start') {
      const blockType = event.content_block.type;
      console.log(`🟢 content_block_start: type=${blockType}`);

      // Check if content_block has thinking field
      if ((event.content_block as any).thinking) {
        console.log(`   💭 Has thinking field! Length: ${(event.content_block as any).thinking.length}`);
      }
    } else if (event.type === 'content_block_delta') {
      const deltaType = (event.delta as any)?.type;

      if (deltaType === 'thinking_delta') {
        thinkingDeltaCount++;
        const thinking = (event.delta as any).thinking || '';
        console.log(`   💭 thinking_delta: "${thinking.substring(0, 50)}${thinking.length > 50 ? '...' : ''}"`);
      } else if (deltaType === 'text_delta') {
        textDeltaCount++;
        if (textDeltaCount <= 3) {
          const text = (event.delta as any).text || '';
          console.log(`   📝 text_delta: "${text}"`);
        }
      } else if (deltaType === 'redacted_thinking_delta') {
        console.log(`   🔐 redacted_thinking_delta!`);
      } else {
        // Log any other delta types
        console.log(`   ❓ Unknown delta type: ${deltaType}`);
      }
    }
  }

  // IMPORTANT: Check the SDK's finalMessage after streaming completes
  const finalMessage = await stream.finalMessage();

  console.log(`\n📦 SDK finalMessage content types: ${finalMessage.content.map((c: any) => c.type).join(', ')}`);

  // Log redacted_thinking if present
  const redactedBlock = finalMessage.content.find((c: any) => c.type === 'redacted_thinking');
  if (redactedBlock) {
    console.log(`   🔐 Found redacted_thinking! Data length: ${(redactedBlock as any).data?.length || 0}`);
  }

  // Check final message from both message_start event AND SDK finalMessage
  const msgStart = events.find(e => e.type === 'message_start');
  const eventContentTypes = msgStart?.message?.content?.map((c: any) => c.type) || [];
  const sdkContentTypes = finalMessage.content.map((c: any) => c.type);

  console.log(`   Event message_start types: ${eventContentTypes.join(', ')}`);
  console.log(`   SDK finalMessage types: ${sdkContentTypes.join(', ')}`);

  const contentTypes = sdkContentTypes; // Use SDK finalMessage as source of truth
  const hasPlainThinking = contentTypes.includes('thinking');
  const hasRedactedThinking = contentTypes.includes('redacted_thinking');

  console.log(`\n📊 Results for ${configName}:`);
  console.log(`   thinking_delta events: ${thinkingDeltaCount}`);
  console.log(`   text_delta events: ${textDeltaCount}`);
  console.log(`   Final message content types: ${contentTypes.join(', ')}`);
  console.log(`   Has plain thinking: ${hasPlainThinking ? '✅' : '❌'}`);
  console.log(`   Has redacted thinking: ${hasRedactedThinking ? '🔐' : '❌'}`);

  return {
    config: configName,
    thinkingDeltaCount,
    textDeltaCount,
    finalMessageContentTypes: contentTypes,
    hasPlainThinking,
    hasRedactedThinking,
    events
  };
}

describe('XAI grok-4-fast thinking discovery', () => {
  it('should discover how to get thinking from grok-4-fast', async () => {
    if (!XAI_API_KEY) {
      console.log('⚠️  Skipping: XAI_API_KEY not set');
      return;
    }

    const results: TestResult[] = [];

    // Test 1: Default (no special parameters)
    try {
      const result1 = await testConfiguration('Default (no params)', {});
      results.push(result1);
    } catch (error: any) {
      console.error(`❌ Test 1 failed: ${error.message}`);
    }

    // Test 2: use_encrypted_content: false
    try {
      const result2 = await testConfiguration('use_encrypted_content: false', {
        // @ts-ignore
        use_encrypted_content: false
      });
      results.push(result2);
    } catch (error: any) {
      console.error(`❌ Test 2 failed: ${error.message}`);
    }

    // Test 3: use_encrypted_content: true (explicit)
    try {
      const result3 = await testConfiguration('use_encrypted_content: true', {
        // @ts-ignore
        use_encrypted_content: true
      });
      results.push(result3);
    } catch (error: any) {
      console.error(`❌ Test 3 failed: ${error.message}`);
    }

    // Test 4: Try with thinking parameter (Claude extended thinking API)
    try {
      const result4 = await testConfiguration('With thinking parameter', {
        // @ts-ignore
        thinking: {
          type: 'enabled',
          budget_tokens: 5000
        }
      });
      results.push(result4);
    } catch (error: any) {
      console.error(`❌ Test 4 failed: ${error.message}`);
    }

    // Test 5: Try with anthropic-beta header for thinking
    try {
      const client = new Anthropic({
        apiKey: XAI_API_KEY!,
        baseURL: 'https://api.x.ai',
        defaultHeaders: {
          'anthropic-beta': 'interleaved-thinking-2025-05-14'
        }
      });

      const stream = await client.messages.stream({
        model: 'grok-4-fast',
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: 'Explain why the sky is blue in 2-3 sentences. Think through this carefully.'
        }]
      });

      let thinkingCount = 0;
      let textCount = 0;
      const events: any[] = [];

      for await (const event of stream) {
        events.push(event);
        if (event.type === 'content_block_delta') {
          const deltaType = (event.delta as any)?.type;
          if (deltaType === 'thinking_delta') thinkingCount++;
          if (deltaType === 'text_delta') textCount++;
        }
      }

      const msgStart = events.find(e => e.type === 'message_start');
      const contentTypes = msgStart?.message?.content?.map((c: any) => c.type) || [];

      const result5 = {
        config: 'With anthropic-beta header',
        thinkingDeltaCount: thinkingCount,
        textDeltaCount: textCount,
        finalMessageContentTypes: contentTypes,
        hasPlainThinking: contentTypes.includes('thinking'),
        hasRedactedThinking: contentTypes.includes('redacted_thinking'),
        events
      };

      console.log(`\n📊 Results for With anthropic-beta header:`);
      console.log(`   thinking_delta events: ${thinkingCount}`);
      console.log(`   Final content types: ${contentTypes.join(', ')}`);

      results.push(result5);
    } catch (error: any) {
      console.error(`❌ Test 5 failed: ${error.message}`);
    }

    // Summary
    console.log(`\n${'='.repeat(60)}`);
    console.log(`SUMMARY OF ALL TESTS`);
    console.log(`${'='.repeat(60)}\n`);

    results.forEach(result => {
      console.log(`${result.config}:`);
      console.log(`  - thinking_delta during streaming: ${result.thinkingDeltaCount}`);
      console.log(`  - Plain thinking in final message: ${result.hasPlainThinking ? 'YES ✅' : 'NO ❌'}`);
      console.log(`  - Redacted thinking in final message: ${result.hasRedactedThinking ? 'YES 🔐' : 'NO ❌'}`);
      console.log(``);
    });

    // Save all results
    const outputPath = path.join(process.cwd(), 'xai-grok-4-fast-thinking-discovery.json');
    fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
    console.log(`💾 Full results saved to: ${outputPath}\n`);

    // Find working configuration
    const workingConfig = results.find(r => r.thinkingDeltaCount > 0 || r.hasPlainThinking);

    if (workingConfig) {
      console.log(`✅ FOUND WORKING CONFIGURATION: ${workingConfig.config}`);
      console.log(`   Use this configuration to get thinking from grok-4-fast!`);
    } else {
      console.log(`❌ NO WORKING CONFIGURATION FOUND`);
      console.log(`   grok-4-fast may not expose thinking via Messages API`);
      console.log(`   Only redacted (encrypted) thinking is available`);
    }

    expect(results.length).toBeGreaterThan(0);
  }, 120000); // 2 minute timeout for all tests
});
