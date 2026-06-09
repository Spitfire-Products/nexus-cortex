/**
 * Test XAI grok-4-fast with use_encrypted_content: false
 * This should expose thinking in plain text
 */

import Anthropic from '@anthropic-ai/sdk';
import { describe, it, expect } from 'vitest';

const XAI_API_KEY = process.env.XAI_API_KEY;

describe('XAI grok-4-fast unencrypted thinking test', () => {
  it('should receive thinking with use_encrypted_content false', async () => {
    if (!XAI_API_KEY) {
      console.log('⚠️  Skipping: XAI_API_KEY not set');
      return;
    }

    console.log('\n🧪 Testing grok-4-fast with use_encrypted_content: false\n');

    const client = new Anthropic({
      apiKey: XAI_API_KEY,
      baseURL: 'https://api.x.ai',
    });

    // @ts-ignore - use_encrypted_content is not in TypeScript types
    const stream = await client.messages.stream({
      model: 'grok-4-fast',
      max_tokens: 1024,
      use_encrypted_content: false,  // ← DISABLE ENCRYPTION
      messages: [{
        role: 'user',
        content: 'Explain why the sky is blue in 2-3 sentences.'
      }]
    });

    console.log('📥 Streaming response:\n');
    let thinkingCount = 0;
    let redactedThinkingCount = 0;
    let textCount = 0;
    const events: any[] = [];

    for await (const event of stream) {
      events.push(event);

      if (event.type === 'message_start') {
        console.log(`\n🟢 message_start: model=${(event as any).message.model}`);
        const contentTypes = (event as any).message.content.map((c: any) => c.type);
        console.log(`   Content types in message: ${contentTypes.join(', ')}`);
      } else if (event.type === 'content_block_start') {
        console.log(`\n🟢 content_block_start: type=${event.content_block.type}`);
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
    console.log(`   Redacted thinking: ${redactedThinkingCount}`);
    console.log(`   Text deltas: ${textCount}`);

    // Check final message content
    const msgStart = events.find(e => e.type === 'message_start');
    if (msgStart) {
      const contentTypes = msgStart.message.content.map((c: any) => c.type);
      console.log(`   Final message content types: ${contentTypes.join(', ')}`);

      const hasThinking = contentTypes.includes('thinking');
      const hasRedacted = contentTypes.includes('redacted_thinking');

      if (hasThinking) {
        console.log(`\n✅ Plain thinking block found in final message!`);
      } else if (hasRedacted) {
        console.log(`\n⚠️  Redacted thinking block found (encrypted)`);
      } else {
        console.log(`\n❌ NO thinking blocks in final message`);
      }
    }

    // Save for analysis
    const fs = await import('fs');
    const path = await import('path');
    const outputPath = path.join(process.cwd(), 'xai-grok-4-fast-unencrypted.json');
    fs.writeFileSync(outputPath, JSON.stringify(events, null, 2));
    console.log(`\n💾 Saved to: ${outputPath}`);

    expect(events.length).toBeGreaterThan(0);
  }, 60000);
});
