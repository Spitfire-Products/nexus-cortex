/**
 * Streaming Tool Use Smoke Tests
 *
 * Phase 2.8: Streaming Tool Execution
 *
 * Validates:
 * - Tool use detection in streaming chunks (Claude incremental, Grok single-chunk)
 * - tool_use_complete event emission
 * - Tool execution during streaming
 * - Session history storage with streaming tool results
 * - Interleaved thinking preservation
 *
 * Models tested:
 * - claude-haiku-4-5 (Messages API, incremental tool streaming)
 * - grok-code-fast-1 (Messages API, single-chunk tool streaming with reasoning)
 *
 * Run with: ENABLE_SMOKE_TESTS=true npm test streaming-tool-use-smoke.test.ts
 */

import { describe, it, expect, beforeAll } from 'vitest';
import type { CortexOrchestrator } from '../../CortexOrchestrator.js';
import { createOrchestrator } from '../../OrchestratorFactory.js';
import { rm } from 'fs/promises';
import { existsSync } from 'fs';
import type { StreamChunk } from '../../APIClient.js';

const SKIP_SMOKE_TESTS = !process.env.ENABLE_SMOKE_TESTS;

describe.skipIf(SKIP_SMOKE_TESTS)('Streaming Tool Use Validation', () => {
  describe('Claude 3.5 Haiku - Incremental Tool Streaming', () => {
    let orchestrator: CortexOrchestrator;
    const testStorageDir = '/tmp/tests/.cortex/test-sessions/streaming-claude-tools';

    beforeAll(async () => {
      if (existsSync(testStorageDir)) {
        await rm(testStorageDir, { recursive: true, force: true });
      }

      orchestrator = await createOrchestrator({
        defaultModelId: 'claude-haiku-4-5',
        projectPath: '/tmp/tests/streaming-claude-tools',
        storageDir: testStorageDir,
        debug: true
      });
    });

    it('should detect and execute single tool during streaming', async () => {
      await orchestrator.createSession('/tmp/tests/streaming-claude-tools');

      const chunks: StreamChunk[] = [];
      let toolUseCompleteCount = 0;
      let textChunkCount = 0;

      console.log('\n[Claude Haiku] Streaming with tool use...');

      const stream = orchestrator.streamMessage(
        'Read the package.json file in the current directory using the Read tool'
      );

      for await (const chunk of stream) {
        chunks.push(chunk);

        if (chunk.type === 'text_delta' && chunk.delta) {
          textChunkCount++;
          process.stdout.write(chunk.delta);
        }

        if (chunk.type === 'tool_use_complete') {
          toolUseCompleteCount++;
          console.log(`\n[Tool Use Complete] ${chunk.toolUse?.name} (id: ${chunk.toolUse?.id})`);
          expect(chunk.toolUse).toBeDefined();
          expect(chunk.toolUse!.name).toBeDefined();
          expect(chunk.toolUse!.id).toBeDefined();
          expect(chunk.toolUse!.input).toBeDefined();
        }
      }

      console.log(`\n[Claude Haiku] Chunks: ${chunks.length}, Text: ${textChunkCount}, Tool Use: ${toolUseCompleteCount}`);

      // Verify tool use was detected
      expect(toolUseCompleteCount).toBeGreaterThan(0);
      expect(chunks.some(c => c.type === 'tool_use_complete')).toBe(true);

      // Verify session history contains tool use and tool result
      const history = orchestrator.getMessageHistory();

      const hasToolUse = history.some(m => {
        if (m.message.role !== 'assistant') return false;
        const content = Array.isArray(m.message.content) ? m.message.content : [];
        return content.some(c => c.type === 'tool_use');
      });

      const hasToolResult = history.some(m => {
        if (m.message.role !== 'user') return false;
        const content = Array.isArray(m.message.content) ? m.message.content : [];
        return content.some(c => c.type === 'tool_result');
      });

      expect(hasToolUse).toBe(true);
      expect(hasToolResult).toBe(true);

      console.log('✓ Tool use detected in streaming chunks');
      console.log('✓ Tool result stored in history');
    }, 60000);

    it('should handle interleaved thinking with tool use', async () => {
      // Phase 2.8: Claude Sonnet 4.5 extended thinking enabled via thinking parameter + beta header
      // Requires: thinking.type = 'enabled', thinking.budget_tokens >= 1024
      // Requires: anthropic-beta: interleaved-thinking-2025-05-14 header
      const thinkingOrchestrator = await createOrchestrator({
        defaultModelId: 'claude-sonnet-4-5-20250929',
        projectPath: '/tmp/tests/streaming-claude-thinking',
        storageDir: '/tmp/tests/.cortex/test-sessions/streaming-claude-thinking',
        debug: true
      });

      await thinkingOrchestrator.createSession('/tmp/tests/streaming-claude-thinking');

      const chunks: StreamChunk[] = [];
      let thinkingChunks = 0;
      let toolUseCount = 0;

      console.log('\n[Claude Sonnet 4.5] Streaming with thinking + tools...');

      // No need to pass thinking parameters - system auto-detects from model card
      const stream = thinkingOrchestrator.streamMessage(
        'Use Glob to find all TypeScript files in src directory, then analyze which one to read'
      );

      for await (const chunk of stream) {
        chunks.push(chunk);

        if (chunk.type === 'content_block_delta' && (chunk.data as any)?.reasoning) {
          thinkingChunks++;
        }

        if (chunk.type === 'tool_use_complete') {
          toolUseCount++;
        }
      }

      console.log(`\n[Claude Haiku] Thinking chunks: ${thinkingChunks}, Tool use: ${toolUseCount}`);

      // Should have both thinking and tool use
      expect(thinkingChunks).toBeGreaterThan(0);
      expect(toolUseCount).toBeGreaterThan(0);

      console.log('✓ Interleaved thinking preserved during streaming tool execution');
    }, 60000);
  });

  describe('Grok Code Fast 1 - Single-Chunk Tool Streaming', () => {
    let orchestrator: CortexOrchestrator;
    const testStorageDir = '/tmp/tests/.cortex/test-sessions/streaming-grok-tools';

    beforeAll(async () => {
      if (!process.env.XAI_API_KEY) {
        console.warn('⚠️  XAI_API_KEY not set, skipping Grok tests');
        return;
      }

      if (existsSync(testStorageDir)) {
        await rm(testStorageDir, { recursive: true, force: true });
      }

      orchestrator = await createOrchestrator({
        defaultModelId: 'grok-code-fast-1',
        projectPath: '/tmp/tests/streaming-grok-tools',
        storageDir: testStorageDir,
        debug: true
      });
    });

    it.skipIf(!process.env.XAI_API_KEY)('should detect tool use in single chunk', async () => {
      await orchestrator.createSession('/tmp/tests/streaming-grok-tools');

      const chunks: StreamChunk[] = [];
      let toolUseCompleteCount = 0;
      let reasoningChunks = 0;

      console.log('\n[Grok Code Fast] Streaming with tool use...');

      // Match the working Grok test pattern - be explicit about file location
      const stream = orchestrator.streamMessage(
        'Read the package.json file in the current directory and tell me the package name'
      );

      for await (const chunk of stream) {
        chunks.push(chunk);

        if (chunk.type === 'text_delta' && chunk.delta) {
          process.stdout.write(chunk.delta);
        }

        if (chunk.type === 'content_block_delta' && (chunk.data as any)?.reasoning) {
          reasoningChunks++;
        }

        if (chunk.type === 'tool_use_complete') {
          toolUseCompleteCount++;
          console.log(`\n[Tool Use Complete] ${chunk.toolUse?.name}`);

          // XAI returns tool use complete in single chunk
          expect(chunk.toolUse).toBeDefined();
          expect(chunk.toolUse!.name).toBeDefined();
          expect(chunk.toolUse!.input).toBeDefined();

          // Input should be complete (not partial)
          const inputKeys = Object.keys(chunk.toolUse!.input);
          expect(inputKeys.length).toBeGreaterThan(0);
        }
      }

      console.log(`\n[Grok] Chunks: ${chunks.length}, Tool Use: ${toolUseCompleteCount}, Reasoning: ${reasoningChunks}`);

      // Verify tool use was detected
      expect(toolUseCompleteCount).toBeGreaterThan(0);

      // Verify reasoning traces (Grok includes thinking)
      if (reasoningChunks > 0) {
        console.log('✓ Grok reasoning traces captured');
      }

      // Verify history
      const history = orchestrator.getMessageHistory();

      const hasToolUse = history.some(m => {
        const content = Array.isArray(m.message.content) ? m.message.content : [];
        return content.some(c => c.type === 'tool_use');
      });

      expect(hasToolUse).toBe(true);
      console.log('✓ Tool use detected and stored');
    }, 60000);
  });

  describe('Tool Detection Validation', () => {
    it('should emit tool_use_complete event with correct structure', async () => {
      const orchestrator = await createOrchestrator({
        defaultModelId: 'claude-haiku-4-5',
        projectPath: '/tmp/tests/streaming-tool-structure',
        storageDir: '/tmp/tests/.cortex/streaming-tool-structure',
        debug: false
      });

      await orchestrator.createSession('/tmp/tests/streaming-tool-structure');

      const toolUseEvents: StreamChunk[] = [];

      const stream = orchestrator.streamMessage(
        'Use Glob to find all package.json files'
      );

      for await (const chunk of stream) {
        if (chunk.type === 'tool_use_complete') {
          toolUseEvents.push(chunk);
        }
      }

      expect(toolUseEvents.length).toBeGreaterThan(0);

      const toolUse = toolUseEvents[0];
      expect(toolUse.toolUse).toBeDefined();
      expect(toolUse.toolUse!.id).toMatch(/^toolu_/); // Anthropic format
      expect(toolUse.toolUse!.name).toBe('glob');
      expect(toolUse.toolUse!.input).toBeDefined();
      expect(toolUse.toolUse!.input.pattern).toBeDefined();

      console.log('✓ tool_use_complete event structure valid');
      console.log(`  Tool: ${toolUse.toolUse!.name}`);
      console.log(`  ID: ${toolUse.toolUse!.id}`);
      console.log(`  Input keys: ${Object.keys(toolUse.toolUse!.input).join(', ')}`);
    }, 60000);
  });

  describe('Schema Compliance', () => {
    it('should maintain canonical message format in history', async () => {
      const orchestrator = await createOrchestrator({
        defaultModelId: 'claude-haiku-4-5',
        projectPath: '/tmp/tests/streaming-schema',
        storageDir: '/tmp/tests/.cortex/streaming-schema',
        debug: false
      });

      await orchestrator.createSession('/tmp/tests/streaming-schema');

      const stream = orchestrator.streamMessage(
        'Use Read to read package.json'
      );

      // Consume stream
      for await (const chunk of stream) {
        // Just consume
      }

      // Verify canonical message structure
      const history = orchestrator.getMessageHistory();

      // Find assistant message with tool use
      const assistantMsg = history.find(m => {
        if (m.message.role !== 'assistant') return false;
        const content = Array.isArray(m.message.content) ? m.message.content : [];
        return content.some(c => c.type === 'tool_use');
      });

      expect(assistantMsg).toBeDefined();
      expect(assistantMsg!.uuid).toBeDefined();
      expect(assistantMsg!.timestamp).toBeDefined();
      expect(assistantMsg!.timeline).toBeDefined();
      expect(assistantMsg!.timeline.sessionId).toBeDefined();
      expect(assistantMsg!.timeline.conversationId).toBeDefined();
      expect(assistantMsg!.timeline.turnNumber).toBeGreaterThanOrEqual(0);
      expect(assistantMsg!.model).toBeDefined();
      expect(assistantMsg!.model.id).toBe('claude-haiku-4-5');

      // Verify content block structure
      const content = assistantMsg!.message.content as any[];
      const toolUseBlock = content.find(c => c.type === 'tool_use');

      expect(toolUseBlock).toBeDefined();
      expect(toolUseBlock.toolUse).toBeDefined();
      expect(toolUseBlock.toolUse.id).toBeDefined();
      expect(toolUseBlock.toolUse.name).toBeDefined();
      expect(toolUseBlock.toolUse.input).toBeDefined();

      console.log('✓ Canonical message schema maintained');
      console.log('✓ Tool use content block structure valid');
    }, 60000);
  });
});
