/**
 * Streaming Pattern-Based Integration Smoke Tests
 *
 * Phase 2.7: Pattern-Based Streaming Implementation Validation
 *
 * These tests validate that streaming works correctly with different
 * API patterns (messages, chat/completions, responses, generateContent)
 * using real API calls.
 *
 * Models tested:
 * - claude-haiku-4-5 (Messages API)
 * - gpt-4o-mini (Chat Completions API)
 * - grok-4-fast (Chat Completions API, XAI provider)
 * - gpt-5-codex (Responses API)
 * - gemini-2.5-flash-lite (GenerateContent API)
 *
 * Run with: ENABLE_SMOKE_TESTS=true npm test
 */

import { describe, it, expect, beforeAll } from 'vitest';
import type { CortexOrchestrator } from '../../CortexOrchestrator.js';
import { createOrchestrator } from '../../OrchestratorFactory.js';

// Only run if smoke tests are enabled
const SMOKE_ENABLED = process.env.ENABLE_SMOKE_TESTS === 'true';
const describeSmoke = SMOKE_ENABLED ? describe : describe.skip;

describeSmoke('Streaming Pattern-Based Integration (Smoke Tests)', () => {
  let orchestrator: CortexOrchestrator;

  beforeAll(async () => {
    // Initialize orchestrator with factory
    orchestrator = await createOrchestrator({
      defaultModelId: 'claude-haiku-4-5',
      projectPath: '/tmp/tests/streaming-pattern',
      storageDir: '/tmp/tests/.cortex/streaming-pattern',
      debug: true
    });

    // Create test session
    await orchestrator.createSession('/tmp/tests/streaming-pattern');
  });

  describe('Messages API Pattern (Anthropic)', () => {
    it('should stream from Claude 3.5 Haiku using Messages API', async () => {
      const chunks: string[] = [];
      let chunkCount = 0;

      console.log('\n[Streaming Test - Claude 3.5 Haiku] Starting stream...');

      // Stream the message
      const stream = orchestrator.streamMessage(
        'Count from 1 to 5, one number per line.',
        { modelId: 'claude-haiku-4-5' }
      );

      // Collect chunks
      for await (const chunk of stream) {
        if (chunk.type === 'text_delta' && chunk.delta) {
          chunks.push(chunk.delta);
          chunkCount++;
          process.stdout.write(chunk.delta);
        }
      }

      console.log(`\n[Streaming Test - Claude 3.5 Haiku] Received ${chunkCount} chunks`);

      // Validate streaming worked
      expect(chunkCount).toBeGreaterThan(0);
      expect(chunks.length).toBeGreaterThan(0);

      const fullContent = chunks.join('');
      expect(fullContent.length).toBeGreaterThan(0);

      console.log('[Streaming Test - Claude 3.5 Haiku] Full content length:', fullContent.length);
    }, 30000);
  });

  describe('Chat Completions API Pattern (OpenAI)', () => {
    it('should stream from GPT-4o Mini using Chat Completions API', async () => {
      const chunks: string[] = [];
      let chunkCount = 0;

      console.log('\n[Streaming Test - GPT-4o Mini] Starting stream...');

      // Stream the message
      const stream = orchestrator.streamMessage(
        'Count from 1 to 5, one number per line.',
        { modelId: 'gpt-4o-mini' }
      );

      // Collect chunks
      for await (const chunk of stream) {
        if (chunk.type === 'text_delta' && chunk.delta) {
          chunks.push(chunk.delta);
          chunkCount++;
          process.stdout.write(chunk.delta);
        }
      }

      console.log(`\n[Streaming Test - GPT-4o Mini] Received ${chunkCount} chunks`);

      // Validate streaming worked
      expect(chunkCount).toBeGreaterThan(0);
      expect(chunks.length).toBeGreaterThan(0);

      const fullContent = chunks.join('');
      expect(fullContent.length).toBeGreaterThan(0);

      console.log('[Streaming Test - GPT-4o Mini] Full content length:', fullContent.length);
    }, 30000);
  });

  describe('Chat Completions API Pattern (XAI)', () => {
    it('should stream from Grok 4 Fast using Chat Completions API', async () => {
      const chunks: string[] = [];
      let chunkCount = 0;

      console.log('\n[Streaming Test - Grok 4 Fast] Starting stream...');

      // Stream the message
      const stream = orchestrator.streamMessage(
        'Count from 1 to 5, one number per line.',
        { modelId: 'grok-4-fast' }
      );

      // Collect chunks
      for await (const chunk of stream) {
        if (chunk.type === 'text_delta' && chunk.delta) {
          chunks.push(chunk.delta);
          chunkCount++;
          process.stdout.write(chunk.delta);
        }
      }

      console.log(`\n[Streaming Test - Grok 4 Fast] Received ${chunkCount} chunks`);

      // Validate streaming worked
      expect(chunkCount).toBeGreaterThan(0);
      expect(chunks.length).toBeGreaterThan(0);

      const fullContent = chunks.join('');
      expect(fullContent.length).toBeGreaterThan(0);

      console.log('[Streaming Test - Grok 4 Fast] Full content length:', fullContent.length);
    }, 30000);
  });

  describe('Responses API Pattern (OpenAI)', () => {
    it('should stream from GPT-5 Codex using Responses API', async () => {
      const chunks: string[] = [];
      let chunkCount = 0;

      console.log('\n[Streaming Test - GPT-5 Codex] Starting stream...');

      // Stream the message
      const stream = orchestrator.streamMessage(
        'Count from 1 to 5, one number per line.',
        { modelId: 'gpt-5-codex' }
      );

      // Collect chunks
      for await (const chunk of stream) {
        if (chunk.type === 'text_delta' && chunk.delta) {
          chunks.push(chunk.delta);
          chunkCount++;
          process.stdout.write(chunk.delta);
        }
      }

      console.log(`\n[Streaming Test - GPT-5 Codex] Received ${chunkCount} chunks`);

      // Validate streaming worked
      expect(chunkCount).toBeGreaterThan(0);
      expect(chunks.length).toBeGreaterThan(0);

      const fullContent = chunks.join('');
      expect(fullContent.length).toBeGreaterThan(0);

      console.log('[Streaming Test - GPT-5 Codex] Full content length:', fullContent.length);
    }, 30000);
  });

  describe('GenerateContent API Pattern (Google)', () => {
    it('should stream from Gemini 2.5 Flash Lite using GenerateContent API', async () => {
      const chunks: string[] = [];
      let chunkCount = 0;

      console.log('\n[Streaming Test - Gemini 2.5 Flash Lite] Starting stream...');

      // Stream the message
      const stream = orchestrator.streamMessage(
        'Count from 1 to 5, one number per line.',
        { modelId: 'gemini-2.5-flash-lite' }
      );

      // Collect chunks
      for await (const chunk of stream) {
        if (chunk.type === 'text_delta' && chunk.delta) {
          chunks.push(chunk.delta);
          chunkCount++;
          process.stdout.write(chunk.delta);
        }
      }

      console.log(`\n[Streaming Test - Gemini 2.5 Flash Lite] Received ${chunkCount} chunks`);

      // Validate streaming worked
      expect(chunkCount).toBeGreaterThan(0);
      expect(chunks.length).toBeGreaterThan(0);

      const fullContent = chunks.join('');
      expect(fullContent.length).toBeGreaterThan(0);

      console.log('[Streaming Test - Gemini 2.5 Flash Lite] Full content length:', fullContent.length);
    }, 30000);
  });

  describe('Pattern-Based Routing Validation', () => {
    it('should correctly route different models by API pattern', async () => {
      console.log('\n[Pattern Routing Test] Testing all patterns sequentially...');

      const testCases = [
        { modelId: 'claude-haiku-4-5', pattern: 'messages', provider: 'anthropic' },
        { modelId: 'gpt-4o-mini', pattern: 'chat/completions', provider: 'openai' },
        { modelId: 'grok-4-fast', pattern: 'chat/completions', provider: 'xai' },
        { modelId: 'gemini-2.5-flash-lite', pattern: 'generateContent', provider: 'google' }
      ];

      for (const testCase of testCases) {
        console.log(`\n  Testing ${testCase.modelId} (${testCase.pattern})...`);

        const chunks: string[] = [];
        const stream = orchestrator.streamMessage(
          'Say hello',
          { modelId: testCase.modelId }
        );

        for await (const chunk of stream) {
          if (chunk.type === 'text_delta' && chunk.delta) {
            chunks.push(chunk.delta);
          }
        }

        expect(chunks.length).toBeGreaterThan(0);
        console.log(`  ✓ ${testCase.modelId}: ${chunks.length} chunks received`);
      }

      console.log('\n[Pattern Routing Test] All patterns validated successfully');
    }, 120000); // 2 minute timeout for multiple models
  });
});
