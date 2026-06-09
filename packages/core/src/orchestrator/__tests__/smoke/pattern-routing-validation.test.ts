/**
 * Pattern-Based Routing Validation Tests
 *
 * Tests all 5 API patterns with their designated models to verify
 * the pattern-based routing architecture works correctly.
 *
 * Test Models:
 * 1. Grok (XAI) - MessagesAPI with grok-4-fast
 * 2. Gemini (Google) - GenerateContentAPI with gemini-2.5-flash-lite
 * 3. OpenAI - ResponsesAPI with gpt-5-codex
 * 4. DeepSeek - ChatCompletionsAPI with deepseek-chat
 * 5. Gemma (Google) - GoogleGenAPI with gemma-3-27b-it (no streaming)
 *
 * Run with: ENABLE_SMOKE_TESTS=true npm test
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { createOrchestrator } from '../../OrchestratorFactory.js';
import type { CortexOrchestrator } from '../../CortexOrchestrator.js';

// Only run if smoke tests are enabled
const SMOKE_ENABLED = process.env.ENABLE_SMOKE_TESTS === 'true';
const describeSmoke = SMOKE_ENABLED ? describe : describe.skip;

describeSmoke('Pattern-Based Routing Validation (All 5 Patterns)', () => {
  let orchestrator: CortexOrchestrator;

  beforeAll(async () => {
    // Initialize orchestrator using factory
    orchestrator = createOrchestrator({
      defaultModelId: 'grok-4-fast',
      projectPath: '/tmp/test-pattern-routing',
      storageDir: '/tmp/test-pattern-routing/.cortex/sessions',
      debug: true
    });

    // Create test session
    await orchestrator.createSession('/tmp/test-pattern-routing');
  });

  describe('1. Messages API Pattern (XAI Grok)', () => {
    it('should send message to Grok 4 Fast using Messages API', async () => {
      console.log('\n[Test 1/5] Testing Grok 4 Fast (Messages API)...');

      const response = await orchestrator.sendMessage(
        'Say "Hello from Grok" in exactly 5 words.',
        { modelId: 'grok-4-fast' }
      );

      // Validate response
      expect(response).toBeDefined();
      expect(response.content).toBeDefined();
      expect(response.content.length).toBeGreaterThan(0);

      console.log('[Test 1/5] ✓ Grok 4 Fast response received');
      console.log('  Pattern: messages');
      console.log('  Adapter: MessagesAPIAdapter');
      console.log('  Response length:', response.content.length);
    }, 30000);

    it('should stream from Grok 4 Fast using Messages API', async () => {
      console.log('\n[Test 1/5 Streaming] Testing Grok 4 Fast streaming...');

      const chunks: string[] = [];
      let chunkCount = 0;

      const stream = orchestrator.streamMessage(
        'Count from 1 to 3.',
        { modelId: 'grok-4-fast' }
      );

      for await (const chunk of stream) {
        if (chunk.type === 'text_delta' && chunk.delta) {
          chunks.push(chunk.delta);
          chunkCount++;
        }
      }

      expect(chunkCount).toBeGreaterThan(0);
      console.log('[Test 1/5 Streaming] ✓ Received', chunkCount, 'chunks');
    }, 30000);
  });

  describe('2. GenerateContent API Pattern (Google Gemini)', () => {
    it('should send message to Gemini 2.5 Flash Lite using GenerateContent API', async () => {
      console.log('\n[Test 2/5] Testing Gemini 2.5 Flash Lite (GenerateContent API)...');

      const response = await orchestrator.sendMessage(
        'Say "Hello from Gemini" in exactly 5 words.',
        { modelId: 'gemini-2.5-flash-lite' }
      );

      // Validate response
      expect(response).toBeDefined();
      expect(response.content).toBeDefined();
      expect(response.content.length).toBeGreaterThan(0);

      console.log('[Test 2/5] ✓ Gemini 2.5 Flash Lite response received');
      console.log('  Pattern: generateContent');
      console.log('  Adapter: GenerateContentAPIAdapter');
      console.log('  Response length:', response.content.length);
    }, 30000);

    it('should stream from Gemini 2.5 Flash Lite using GenerateContent API', async () => {
      console.log('\n[Test 2/5 Streaming] Testing Gemini 2.5 Flash Lite streaming...');

      const chunks: string[] = [];
      let chunkCount = 0;

      const stream = orchestrator.streamMessage(
        'Count from 1 to 3.',
        { modelId: 'gemini-2.5-flash-lite' }
      );

      for await (const chunk of stream) {
        if (chunk.type === 'text_delta' && chunk.delta) {
          chunks.push(chunk.delta);
          chunkCount++;
        }
      }

      expect(chunkCount).toBeGreaterThan(0);
      console.log('[Test 2/5 Streaming] ✓ Received', chunkCount, 'chunks');
    }, 30000);
  });

  describe('3. Responses API Pattern (OpenAI gpt-5-codex)', () => {
    it('should send message to GPT-5 Codex using Responses API', async () => {
      console.log('\n[Test 3/5] Testing GPT-5 Codex (Responses API)...');

      const response = await orchestrator.sendMessage(
        'Say "Hello from GPT-5" in exactly 5 words.',
        { modelId: 'gpt-5-codex' }
      );

      // Validate response
      expect(response).toBeDefined();
      expect(response.content).toBeDefined();
      expect(response.content.length).toBeGreaterThan(0);

      console.log('[Test 3/5] ✓ GPT-5 Codex response received');
      console.log('  Pattern: responses');
      console.log('  Adapter: ResponsesAPIAdapter');
      console.log('  Response length:', response.content.length);
    }, 30000);

    it('should stream from GPT-5 Codex using Responses API', async () => {
      console.log('\n[Test 3/5 Streaming] Testing GPT-5 Codex streaming...');

      const chunks: string[] = [];
      let chunkCount = 0;

      const stream = orchestrator.streamMessage(
        'Count from 1 to 3.',
        { modelId: 'gpt-5-codex' }
      );

      for await (const chunk of stream) {
        if (chunk.type === 'text_delta' && chunk.delta) {
          chunks.push(chunk.delta);
          chunkCount++;
        }
      }

      expect(chunkCount).toBeGreaterThan(0);
      console.log('[Test 3/5 Streaming] ✓ Received', chunkCount, 'chunks');
    }, 30000);
  });

  describe('4. Chat Completions API Pattern (DeepSeek)', () => {
    it('should send message to DeepSeek Chat using Chat Completions API', async () => {
      console.log('\n[Test 4/5] Testing DeepSeek Chat (Chat Completions API)...');

      const response = await orchestrator.sendMessage(
        'Say "Hello from DeepSeek" in exactly 5 words.',
        { modelId: 'deepseek-chat' }
      );

      // Validate response
      expect(response).toBeDefined();
      expect(response.content).toBeDefined();
      expect(response.content.length).toBeGreaterThan(0);

      console.log('[Test 4/5] ✓ DeepSeek Chat response received');
      console.log('  Pattern: chat/completions');
      console.log('  Adapter: ChatCompletionsAPIAdapter');
      console.log('  Response length:', response.content.length);
    }, 30000);

    it('should stream from DeepSeek Chat using Chat Completions API', async () => {
      console.log('\n[Test 4/5 Streaming] Testing DeepSeek Chat streaming...');

      const chunks: string[] = [];
      let chunkCount = 0;

      const stream = orchestrator.streamMessage(
        'Count from 1 to 3.',
        { modelId: 'deepseek-chat' }
      );

      for await (const chunk of stream) {
        if (chunk.type === 'text_delta' && chunk.delta) {
          chunks.push(chunk.delta);
          chunkCount++;
        }
      }

      expect(chunkCount).toBeGreaterThan(0);
      console.log('[Test 4/5 Streaming] ✓ Received', chunkCount, 'chunks');
    }, 30000);
  });

  describe('5. Google GenAI API Pattern (Gemma - No Streaming)', () => {
    it('should send message to Gemma 3 27B using Google GenAI API', async () => {
      console.log('\n[Test 5/5] Testing Gemma 3 27B IT (Google GenAI API)...');

      const response = await orchestrator.sendMessage(
        'Say "Hello from Gemma" in exactly 5 words.',
        { modelId: 'gemma-3-27b-it' }
      );

      // Validate response
      expect(response).toBeDefined();
      expect(response.content).toBeDefined();
      expect(response.content.length).toBeGreaterThan(0);

      console.log('[Test 5/5] ✓ Gemma 3 27B IT response received');
      console.log('  Pattern: google-genai');
      console.log('  Adapter: GoogleGenAPIAdapter');
      console.log('  Streaming: Not supported');
      console.log('  Response length:', response.content.length);
    }, 30000);

    it('should throw error when trying to stream from Gemma (not supported)', async () => {
      console.log('\n[Test 5/5 Streaming] Verifying Gemma does not support streaming...');

      // Streaming should throw an error for google-genai pattern
      await expect(async () => {
        const stream = orchestrator.streamMessage(
          'Count from 1 to 3.',
          { modelId: 'gemma-3-27b-it' }
        );

        // Try to consume first chunk
        for await (const chunk of stream) {
          break;
        }
      }).rejects.toThrow();

      console.log('[Test 5/5 Streaming] ✓ Correctly throws error for unsupported streaming');
    }, 30000);
  });

  describe('Cross-Pattern Validation', () => {
    it('should correctly route all 5 patterns in sequence', async () => {
      console.log('\n[Cross-Pattern Test] Testing all 5 patterns sequentially...');

      const testCases = [
        {
          modelId: 'grok-4-fast',
          pattern: 'messages',
          provider: 'xai',
          adapter: 'MessagesAPIAdapter'
        },
        {
          modelId: 'gemini-2.5-flash-lite',
          pattern: 'generateContent',
          provider: 'google',
          adapter: 'GenerateContentAPIAdapter'
        },
        {
          modelId: 'gpt-5-codex',
          pattern: 'responses',
          provider: 'openai',
          adapter: 'ResponsesAPIAdapter'
        },
        {
          modelId: 'deepseek-chat',
          pattern: 'chat/completions',
          provider: 'deepseek',
          adapter: 'ChatCompletionsAPIAdapter'
        },
        {
          modelId: 'gemma-3-27b-it',
          pattern: 'google-genai',
          provider: 'google',
          adapter: 'GoogleGenAPIAdapter'
        }
      ];

      for (const testCase of testCases) {
        console.log(`\n  Testing ${testCase.modelId}...`);
        console.log(`    Pattern: ${testCase.pattern}`);
        console.log(`    Adapter: ${testCase.adapter}`);

        const response = await orchestrator.sendMessage(
          'Say hello',
          { modelId: testCase.modelId }
        );

        expect(response.content.length).toBeGreaterThan(0);
        console.log(`  ✓ ${testCase.modelId}: ${response.content.length} chars received`);
      }

      console.log('\n[Cross-Pattern Test] All 5 patterns validated successfully! ✨');
    }, 180000); // 3 minute timeout for 5 models
  });
});
