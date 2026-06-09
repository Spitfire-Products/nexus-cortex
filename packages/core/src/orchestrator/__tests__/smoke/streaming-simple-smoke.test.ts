/**
 * Streaming Simple Smoke Tests
 *
 * Phase 2.7: Pattern-Based Streaming - Simple validation without tool history
 *
 * These tests use fresh sessions for each model to avoid tool call history complications.
 *
 * Run with: ENABLE_SMOKE_TESTS=true npm test streaming-simple-smoke.test.ts
 */

import { describe, it, expect } from 'vitest';
import { createOrchestrator } from '../../OrchestratorFactory.js';

// Only run if smoke tests are enabled
const SMOKE_ENABLED = process.env.ENABLE_SMOKE_TESTS === 'true';
const describeSmoke = SMOKE_ENABLED ? describe : describe.skip;

describeSmoke('Streaming Simple Validation (Fresh Sessions)', () => {
  describe('Messages API Pattern (Claude)', () => {
    it('should stream from Claude 3.5 Haiku', async () => {
      const orchestrator = await createOrchestrator({
        defaultModelId: 'claude-haiku-4-5',
        projectPath: '/tmp/tests/streaming-claude',
        storageDir: '/tmp/tests/.cortex/streaming-claude',
        debug: false
      });

      await orchestrator.createSession('/tmp/tests/streaming-claude');

      const chunks: string[] = [];
      console.log('\n[Claude 3.5 Haiku] Streaming...');

      const stream = orchestrator.streamMessage('Say hello in exactly 3 words.');

      for await (const chunk of stream) {
        if (chunk.type === 'text_delta' && chunk.delta) {
          chunks.push(chunk.delta);
          process.stdout.write(chunk.delta);
        }
      }

      console.log(`\n[Claude 3.5 Haiku] ${chunks.length} chunks`);
      expect(chunks.length).toBeGreaterThan(0);
    }, 30000);
  });

  describe('Chat Completions API Pattern (OpenAI)', () => {
    it('should stream from GPT-4o Mini', async () => {
      const orchestrator = await createOrchestrator({
        defaultModelId: 'gpt-4o-mini',
        projectPath: '/tmp/tests/streaming-openai',
        storageDir: '/tmp/tests/.cortex/streaming-openai',
        debug: false
      });

      await orchestrator.createSession('/tmp/tests/streaming-openai');

      const chunks: string[] = [];
      console.log('\n[GPT-4o Mini] Streaming...');

      const stream = orchestrator.streamMessage('Say hello in exactly 3 words.');

      for await (const chunk of stream) {
        if (chunk.type === 'text_delta' && chunk.delta) {
          chunks.push(chunk.delta);
          process.stdout.write(chunk.delta);
        }
      }

      console.log(`\n[GPT-4o Mini] ${chunks.length} chunks`);
      expect(chunks.length).toBeGreaterThan(0);
    }, 30000);
  });

  describe('Messages API Pattern (XAI)', () => {
    it('should stream from Grok 4 Fast using XAI Messages API', async () => {
      const orchestrator = await createOrchestrator({
        defaultModelId: 'grok-4-fast',
        projectPath: '/tmp/tests/streaming-xai',
        storageDir: '/tmp/tests/.cortex/streaming-xai',
        debug: false
      });

      await orchestrator.createSession('/tmp/tests/streaming-xai');

      const chunks: string[] = [];
      console.log('\n[Grok 4 Fast] Streaming...');

      const stream = orchestrator.streamMessage('Say hello in exactly 3 words.');

      for await (const chunk of stream) {
        if (chunk.type === 'text_delta' && chunk.delta) {
          chunks.push(chunk.delta);
          process.stdout.write(chunk.delta);
        }
      }

      console.log(`\n[Grok 4 Fast] ${chunks.length} chunks`);
      expect(chunks.length).toBeGreaterThan(0);
    }, 30000);
  });

  describe('GenerateContent API Pattern (Google)', () => {
    it('should stream from Gemini 2.5 Flash Lite', async () => {
      const orchestrator = await createOrchestrator({
        defaultModelId: 'gemini-2.5-flash-lite',
        projectPath: '/tmp/tests/streaming-gemini',
        storageDir: '/tmp/tests/.cortex/streaming-gemini',
        debug: false
      });

      await orchestrator.createSession('/tmp/tests/streaming-gemini');

      const chunks: string[] = [];
      console.log('\n[Gemini 2.5 Flash Lite] Streaming...');

      const stream = orchestrator.streamMessage('Say hello in exactly 3 words.');

      for await (const chunk of stream) {
        if (chunk.type === 'text_delta' && chunk.delta) {
          chunks.push(chunk.delta);
          process.stdout.write(chunk.delta);
        }
      }

      console.log(`\n[Gemini 2.5 Flash Lite] ${chunks.length} chunks`);
      expect(chunks.length).toBeGreaterThan(0);
    }, 30000);
  });

  describe('Responses API Pattern (OpenAI)', () => {
    it('should stream from GPT-5 Codex using Responses API', async () => {
      const orchestrator = await createOrchestrator({
        defaultModelId: 'gpt-5-codex',
        projectPath: '/tmp/tests/streaming-codex',
        storageDir: '/tmp/tests/.cortex/streaming-codex',
        debug: false
      });

      await orchestrator.createSession('/tmp/tests/streaming-codex');

      const chunks: string[] = [];
      console.log('\n[GPT-5 Codex] Streaming...');

      const stream = orchestrator.streamMessage('Say hello in exactly 3 words.');

      for await (const chunk of stream) {
        if (chunk.type === 'text_delta' && chunk.delta) {
          chunks.push(chunk.delta);
          process.stdout.write(chunk.delta);
        }
      }

      console.log(`\n[GPT-5 Codex] ${chunks.length} chunks`);
      expect(chunks.length).toBeGreaterThan(0);
    }, 30000);
  });
});
