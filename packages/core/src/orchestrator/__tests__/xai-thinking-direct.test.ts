/**
 * Direct XAI Messages API Test
 * Tests what XAI actually sends for grok-4-fast thinking
 */

import Anthropic from '@anthropic-ai/sdk';
import { describe, it, expect } from 'vitest';

const XAI_API_KEY = process.env.XAI_API_KEY;

describe('XAI grok-4-fast thinking_delta test', () => {
  it('should receive thinking_delta events from grok-4-fast', async () => {
    if (!XAI_API_KEY) {
      console.log('⚠️  Skipping: XAI_API_KEY not set');
      return;
    }

    console.log('\n🧪 Testing grok-4-fast with XAI Messages API\n');

    const client = new Anthropic({
      apiKey: XAI_API_KEY,
      baseURL: 'https://api.x.ai',
    });

    const stream = await client.messages.stream({
      model: 'grok-4-fast-reasoning',  // ← Changed from 'grok-4-fast'
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: 'Explain why the sky is blue in 2-3 sentences.'
      }]
    });

    console.log('📥 Streaming response:\n');
    let thinkingCount = 0;
    let textCount = 0;
    const events: any[] = [];

    for await (const event of stream) {
      events.push(event);

      // Log every event type we receive
      if (event.type === 'content_block_start') {
        console.log(`\n🟢 content_block_start: index=${event.index}, content_block.type=${event.content_block.type}`);
      } else if (event.type === 'content_block_delta') {
        const deltaType = (event.delta as any)?.type;
        console.log(`\n🔵 content_block_delta: index=${event.index}, delta.type=${deltaType}`);

        if (deltaType === 'thinking_delta') {
          thinkingCount++;
          const thinking = (event.delta as any).thinking || '';
          console.log(`   💭 THINKING: "${thinking.substring(0, 60)}${thinking.length > 60 ? '...' : ''}"`);
        } else if (deltaType === 'text_delta') {
          textCount++;
          const text = (event.delta as any).text || '';
          console.log(`   📝 TEXT: "${text.substring(0, 60)}${text.length > 60 ? '...' : ''}"`);
        } else if ((event.delta as any)?.reasoning_content) {
          console.log(`   🧠 REASONING_CONTENT: "${(event.delta as any).reasoning_content.substring(0, 60)}..."`);
        }

        // Log full delta structure for first few events
        if (events.length <= 5) {
          console.log(`   Full delta:`, JSON.stringify(event.delta, null, 2));
        }
      } else if (event.type === 'content_block_stop') {
        console.log(`\n🔴 content_block_stop: index=${event.index}`);
      } else if (event.type === 'message_start') {
        console.log(`\n🟢 message_start: message.id=${(event as any).message.id}, model=${(event as any).message.model}`);
      } else if (event.type === 'message_delta') {
        console.log(`\n🔵 message_delta: delta.stop_reason=${(event as any).delta.stop_reason}`);
      } else if (event.type === 'message_stop') {
        console.log(`\n🔴 message_stop`);
      }
    }

    console.log(`\n\n📊 Summary:`);
    console.log(`   Thinking deltas: ${thinkingCount}`);
    console.log(`   Text deltas: ${textCount}`);
    console.log(`   Total events: ${events.length}`);

    if (thinkingCount === 0) {
      console.log(`\n❌ NO THINKING DELTAS RECEIVED!`);
      console.log(`   This means grok-4-fast is NOT sending thinking_delta events.`);
      console.log(`   Event types received:`, [...new Set(events.map(e => e.type))]);
    } else {
      console.log(`\n✅ Thinking deltas received successfully!`);
    }

    // Save raw events for analysis
    const fs = await import('fs');
    const path = await import('path');
    const outputPath = path.join(process.cwd(), 'xai-grok-4-fast-events.json');
    fs.writeFileSync(outputPath, JSON.stringify(events, null, 2));
    console.log(`\n💾 Raw events saved to: ${outputPath}`);

    expect(events.length).toBeGreaterThan(0);
  }, 60000);
});
