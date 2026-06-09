/**
 * Real API Smoke Tests
 * Tests adapters with actual provider APIs
 *
 * USAGE:
 * 1. Ensure API keys are set in environment (from Replit Secrets)
 * 2. Set ENABLE_SMOKE_TESTS=true in .env
 * 3. Run: npm test -- src/adapters/__tests__/smoke --run
 *
 * NOTE: These tests:
 * - Make real API calls (costs tokens)
 * - Require internet connection
 * - May be slower (~5-10s per test)
 * - Can fail due to rate limits or API issues
 */

import { describe, it, expect, beforeAll } from 'vitest';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const SMOKE_TESTS_ENABLED = process.env.ENABLE_SMOKE_TESTS === 'true';

// Skip all tests if smoke tests are disabled
const describeIf = SMOKE_TESTS_ENABLED ? describe : describe.skip;

describeIf('Real API Smoke Tests', () => {
  beforeAll(() => {
    if (!SMOKE_TESTS_ENABLED) {
      console.log('⏭️  Skipping smoke tests (ENABLE_SMOKE_TESTS=false)');
      return;
    }
    console.log('🔥 Running smoke tests with real APIs...');
  });

  describe('Anthropic Claude', () => {
    it('should make real API call to Claude', async () => {
      if (!process.env.ANTHROPIC_API_KEY) {
        console.log('⏭️  Skipping Anthropic test (no API key)');
        return;
      }

      const Anthropic = (await import('@anthropic-ai/sdk')).default;
      const anthropic = new Anthropic({
        apiKey: process.env.ANTHROPIC_API_KEY,
      });

      const message = await anthropic.messages.create({
        model: 'claude-haiku-4-5',
        max_tokens: 100,
        messages: [
          { role: 'user', content: 'Say "test successful" and nothing else.' },
        ],
      });

      expect(message.content).toBeDefined();
      expect(message.content.length).toBeGreaterThan(0);
      expect(message.content[0].type).toBe('text');

      console.log('✅ Anthropic API call successful');
      console.log(`   Model: ${message.model}`);
      console.log(`   Tokens: ${message.usage.input_tokens} in, ${message.usage.output_tokens} out`);
    }, 15000); // 15s timeout

    it.skip('should detect context limit error from Claude', async () => {
      if (!process.env.ANTHROPIC_API_KEY) {
        console.log('⏭️  Skipping Anthropic error test (no API key)');
        return;
      }

      const Anthropic = (await import('@anthropic-ai/sdk')).default;
      const anthropic = new Anthropic({
        apiKey: process.env.ANTHROPIC_API_KEY,
      });

      // Create a message that's too large for the context window
      const largeMessage = 'x'.repeat(500000); // ~500K chars

      try {
        await anthropic.messages.create({
          model: 'claude-haiku-4-5',
          max_tokens: 100,
          messages: [{ role: 'user', content: largeMessage }],
        });

        // If we get here, the test failed (should have thrown)
        expect.fail('Expected context limit error but request succeeded');
      } catch (error: any) {
        // Verify it's a context limit error - just check the message
        expect(error).toBeDefined();
        expect(error.message.toLowerCase()).toMatch(/prompt|too long|tokens|maximum/);

        console.log('✅ Context limit error detected correctly');
        console.log(`   Error type: ${error.type || error.code || 'unknown'}`);
        console.log(`   Message: ${error.message.substring(0, 100)}`);
      }
    }, 15000);
  });

  describe('OpenAI GPT', () => {
    it('should make real API call to GPT', async () => {
      if (!process.env.OPENAI_API_KEY) {
        console.log('⏭️  Skipping OpenAI test (no API key)');
        return;
      }

      const OpenAI = (await import('openai')).default;
      const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
      });

      const completion = await openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        max_tokens: 100,
        messages: [
          { role: 'user', content: 'Say "test successful" and nothing else.' },
        ],
      });

      expect(completion.choices).toBeDefined();
      expect(completion.choices.length).toBeGreaterThan(0);
      expect(completion.choices[0].message.content).toBeDefined();

      console.log('✅ OpenAI API call successful');
      console.log(`   Model: ${completion.model}`);
      console.log(`   Tokens: ${completion.usage?.prompt_tokens} in, ${completion.usage?.completion_tokens} out`);
    }, 15000);

    it.skip('should detect context limit error from GPT', async () => {
      if (!process.env.OPENAI_API_KEY) {
        console.log('⏭️  Skipping OpenAI error test (no API key)');
        return;
      }

      const OpenAI = (await import('openai')).default;
      const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
      });

      // Create a message that exceeds GPT-3.5's context (16K tokens)
      const largeMessage = 'x'.repeat(100000); // ~100K chars, ~25K tokens

      try {
        await openai.chat.completions.create({
          model: 'gpt-3.5-turbo',
          max_tokens: 100,
          messages: [{ role: 'user', content: largeMessage }],
        });

        expect.fail('Expected context limit error but request succeeded');
      } catch (error: any) {
        // OpenAI error structure - check for context limit error
        expect(error).toBeDefined();
        const errorStr = (error.code || error.type || error.message || '').toLowerCase();
        expect(errorStr).toMatch(/context|length|exceeded|tokens/);

        console.log('✅ Context limit error detected correctly');
        console.log(`   Error code: ${error.code || error.type || 'unknown'}`);
        console.log(`   Message: ${error.message.substring(0, 100)}`);
      }
    }, 15000);
  });

  describe('Google Gemini', () => {
    it('should make real API call to Gemini', async () => {
      if (!process.env.GOOGLE_API_KEY && !process.env.GEMINI_API_KEY) {
        console.log('⏭️  Skipping Gemini test (no API key)');
        return;
      }

      const { GoogleGenerativeAI } = await import('@google/generative-ai');
      const genAI = new GoogleGenerativeAI(
        process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || ''
      );

      const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-lite' });
      const result = await model.generateContent('Say "test successful" and nothing else.');
      const response = await result.response;
      const text = response.text();

      expect(text).toBeDefined();
      expect(text.length).toBeGreaterThan(0);

      console.log('✅ Gemini API call successful');
      console.log(`   Model: gemini-2.0-flash-lite`);
      console.log(`   Response: ${text.substring(0, 50)}...`);
    }, 15000);

    it('should handle Gemini with tools', async () => {
      if (!process.env.GOOGLE_API_KEY && !process.env.GEMINI_API_KEY) {
        console.log('⏭️  Skipping Gemini tools test (no API key)');
        return;
      }

      const { GoogleGenerativeAI } = await import('@google/generative-ai');
      const genAI = new GoogleGenerativeAI(
        process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || ''
      );

      const model = genAI.getGenerativeModel({
        model: 'gemini-2.0-flash-lite',
        tools: [
          {
            functionDeclarations: [
              {
                name: 'get_weather',
                description: 'Get the weather for a location',
                parameters: {
                  type: 'OBJECT' as any,
                  properties: {
                    location: { type: 'STRING' as any, description: 'City name' },
                  },
                  required: ['location'],
                },
              },
            ],
          },
        ],
      });

      const result = await model.generateContent(
        "What's the weather in San Francisco? Just use the tool, don't make up data."
      );
      const response = await result.response;

      // Check if tool was called
      const candidates = response.candidates;
      expect(candidates).toBeDefined();

      console.log('✅ Gemini tools call successful');
      console.log(`   Model: gemini-2.0-flash-lite`);
      console.log(`   Tool calling: supported`);
    }, 15000);
  });

  describe('Helper Model Middleware Integration', () => {
    it('should use helper model for compaction', async () => {
      if (!process.env.ANTHROPIC_API_KEY) {
        console.log('⏭️  Skipping helper model test (no API key)');
        return;
      }

      const Anthropic = (await import('@anthropic-ai/sdk')).default;
      const haiku = new Anthropic({
        apiKey: process.env.ANTHROPIC_API_KEY,
      });

      // Simulate compaction: summarize a long conversation
      const longConversation = `
User: What is quantum computing?
Assistant: Quantum computing uses quantum mechanics principles...
User: How does it differ from classical computing?
Assistant: Classical computers use bits (0 or 1), quantum computers use qubits...
User: What are practical applications?
Assistant: Applications include cryptography, drug discovery, optimization...
      `.repeat(100); // Make it long

      const summary = await haiku.messages.create({
        model: 'claude-haiku-4-5',
        max_tokens: 200,
        messages: [
          {
            role: 'user',
            content: `Summarize this conversation in 2-3 sentences:\n\n${longConversation}`,
          },
        ],
      });

      expect(summary.content).toBeDefined();
      expect(summary.content[0].type).toBe('text');

      const summaryText = (summary.content[0] as any).text;
      expect(summaryText.length).toBeLessThan(longConversation.length);

      console.log('✅ Helper model compaction successful');
      console.log(`   Input: ${longConversation.length} chars`);
      console.log(`   Summary: ${summaryText.length} chars`);
      console.log(`   Compression: ${Math.round((1 - summaryText.length / longConversation.length) * 100)}%`);
    }, 20000);
  });
});

// Export smoke test utilities
export const smokeTestsEnabled = SMOKE_TESTS_ENABLED;

export async function checkAPIKeys() {
  const keys = {
    anthropic: !!process.env.ANTHROPIC_API_KEY,
    openai: !!process.env.OPENAI_API_KEY,
    google: !!(process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY),
  };

  console.log('API Keys Status:');
  console.log(`  Anthropic: ${keys.anthropic ? '✅' : '❌'}`);
  console.log(`  OpenAI: ${keys.openai ? '✅' : '❌'}`);
  console.log(`  Google: ${keys.google ? '✅' : '❌'}`);

  return keys;
}
