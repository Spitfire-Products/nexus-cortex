/**
 * Direct XAI Messages API Test for grok-3-mini
 * Compare with grok-4-fast to understand thinking differences
 */

import Anthropic from '@anthropic-ai/sdk';
import { describe, it, expect } from 'vitest';

const XAI_API_KEY = process.env.XAI_API_KEY;

describe('XAI grok-3-mini thinking_delta test', () => {
  it('should test grok-3-mini thinking behavior', async () => {
    if (!XAI_API_KEY) {
      console.log('⚠️  Skipping: XAI_API_KEY not set');
      return;
    }

    console.log('\n🧪 Testing grok-3-mini with XAI Messages API\n');

    const client = new Anthropic({
      apiKey: XAI_API_KEY,
      baseURL: 'https://api.x.ai',
    });

    const stream = await client.messages.stream({
      model: 'grok-3-mini',
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

      if (event.type === 'message_start') {
        console.log(`\n🟢 message_start: model=${(event as any).message.model}`);
      } else if (event.type === 'content_block_start') {
        console.log(`\n🟢 content_block_start: content_block.type=${event.content_block.type}`);
      } else if (event.type === 'content_block_delta') {
        const deltaType = (event.delta as any)?.type;

        if (deltaType === 'thinking_delta') {
          thinkingCount++;
          const thinking = (event.delta as any).thinking || '';
          console.log(`   💭 THINKING: "${thinking.substring(0, 60)}${thinking.length > 60 ? '...' : ''}"`);
        } else if (deltaType === 'text_delta') {
          textCount++;
          if (textCount <= 5) {
            const text = (event.delta as any).text || '';
            console.log(`   📝 TEXT: "${text}"`);
          }
        }
      }
    }

    console.log(`\n\n📊 Summary:`);
    console.log(`   Thinking deltas: ${thinkingCount}`);
    console.log(`   Text deltas: ${textCount}`);
    console.log(`   Total events: ${events.length}`);

    if (thinkingCount === 0) {
      console.log(`\n❌ NO THINKING DELTAS from grok-3-mini`);
    } else {
      console.log(`\n✅ Thinking deltas received from grok-3-mini!`);
    }

    // Save for comparison
    const fs = await import('fs');
    const path = await import('path');
    const outputPath = path.join(process.cwd(), 'xai-grok-3-mini-events.json');
    fs.writeFileSync(outputPath, JSON.stringify(events, null, 2));
    console.log(`\n💾 Saved to: ${outputPath}`);

    expect(events.length).toBeGreaterThan(0);
  }, 60000);
});
