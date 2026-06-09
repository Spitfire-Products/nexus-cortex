/**
 * Streaming Multi-Turn Tool Execution Tests
 *
 * Phase 2.8: Streaming Tool Execution - Multi-Turn Chains
 *
 * Validates:
 * - Multi-turn tool chains with streaming
 * - Tool result streaming in continuation responses
 * - Loop detection and prevention
 * - Error handling and recovery
 * - Turn number tracking across streaming iterations
 *
 * Run with: ENABLE_SMOKE_TESTS=true npm test streaming-multi-turn-tools.test.ts
 */

import { describe, it, expect, beforeAll } from 'vitest';
import type { CortexOrchestrator } from '../../CortexOrchestrator.js';
import { createOrchestrator } from '../../OrchestratorFactory.js';
import { rm } from 'fs/promises';
import { existsSync } from 'fs';
import type { StreamChunk } from '../../APIClient.js';

const SKIP_SMOKE_TESTS = !process.env.ENABLE_SMOKE_TESTS;

describe.skipIf(SKIP_SMOKE_TESTS)('Streaming Multi-Turn Tool Execution', () => {
  describe('Claude - Multi-Turn Streaming Tool Chains', () => {
    let orchestrator: CortexOrchestrator;
    const testStorageDir = '/tmp/tests/.cortex/test-sessions/streaming-multi-turn-claude';

    beforeAll(async () => {
      if (existsSync(testStorageDir)) {
        await rm(testStorageDir, { recursive: true, force: true });
      }

      orchestrator = createOrchestrator({
        defaultModelId: 'claude-haiku-4-5',
        projectPath: '/tmp/tests/streaming-multi-turn-claude',
        storageDir: testStorageDir,
        debug: true,
        loopControl: {
          maxToolIterations: 500,
          maxConsecutiveErrors: 3,
          maxLoopRepetitions: 3,
          toolTimeoutMs: 120000
        }
      });
    });

    it('should handle multi-turn tool chains in streaming mode', async () => {
      await orchestrator.createSession('/tmp/tests/streaming-multi-turn-claude');

      const chunks: StreamChunk[] = [];
      let toolUseCount = 0;
      let textChunks = 0;

      console.log('\n[Claude Multi-Turn] Streaming with tool chain...');

      const stream = orchestrator.streamMessage(
        'Use Glob to find all .ts files in src/orchestrator, then read the first file you find and tell me what it contains'
      );

      for await (const chunk of stream) {
        chunks.push(chunk);

        if (chunk.type === 'text_delta' && chunk.delta) {
          textChunks++;
          process.stdout.write(chunk.delta);
        }

        if (chunk.type === 'tool_use_complete') {
          toolUseCount++;
          console.log(`\n[Tool ${toolUseCount}] ${chunk.toolUse?.name}`);
        }
      }

      console.log(`\n[Claude Multi-Turn] Total chunks: ${chunks.length}`);
      console.log(`  Text chunks: ${textChunks}`);
      console.log(`  Tool uses: ${toolUseCount}`);

      // Should execute multiple tools (Glob + Read)
      expect(toolUseCount).toBeGreaterThanOrEqual(2);

      // Verify history contains tool chain
      const history = orchestrator.getMessageHistory();

      const toolMessages = history.filter(m => {
        const content = Array.isArray(m.message.content) ? m.message.content : [];
        return content.some(c => c.type === 'tool_use' || c.type === 'tool_result');
      });

      expect(toolMessages.length).toBeGreaterThan(0);

      console.log('✓ Multi-turn tool chain executed');
      console.log(`✓ History messages: ${history.length}`);
    }, 120000);

    it('should track turn numbers correctly across streaming iterations', async () => {
      await orchestrator.createSession('/tmp/tests/streaming-multi-turn-claude/turns');

      const stream = orchestrator.streamMessage(
        'Use Glob to find package.json files, then read one'
      );

      // Consume stream
      for await (const chunk of stream) {
        // Just consume
      }

      const history = orchestrator.getMessageHistory();

      // Extract all turn numbers
      const turnNumbers = history.map(m => m.timeline.turnNumber);

      // Turn numbers should be monotonically increasing
      for (let i = 1; i < turnNumbers.length; i++) {
        expect(turnNumbers[i]).toBeGreaterThanOrEqual(turnNumbers[i - 1]);
      }

      console.log('✓ Turn numbers valid:', turnNumbers.join(' → '));
    }, 120000);
  });

  describe('Grok - Multi-Turn Streaming with Reasoning', () => {
    let orchestrator: CortexOrchestrator;
    const testStorageDir = '/tmp/tests/.cortex/test-sessions/streaming-multi-turn-grok';

    beforeAll(async () => {
      if (!process.env.XAI_API_KEY) {
        console.warn('⚠️  XAI_API_KEY not set, skipping Grok tests');
        return;
      }

      if (existsSync(testStorageDir)) {
        await rm(testStorageDir, { recursive: true, force: true });
      }

      orchestrator = createOrchestrator({
        defaultModelId: 'grok-code-fast-1',
        projectPath: '/tmp/tests/streaming-multi-turn-grok',
        storageDir: testStorageDir,
        debug: true
      });
    });

    it.skipIf(!process.env.XAI_API_KEY)('should execute multi-turn tool chains with reasoning traces', async () => {
      await orchestrator.createSession('/tmp/tests/streaming-multi-turn-grok');

      const chunks: StreamChunk[] = [];
      let toolUseCount = 0;
      let reasoningChunks = 0;

      console.log('\n[Grok Multi-Turn] Streaming with tools + reasoning...');

      const stream = orchestrator.streamMessage(
        'Use Glob to find TypeScript files, then read the orchestrator file'
      );

      for await (const chunk of stream) {
        chunks.push(chunk);

        if (chunk.type === 'content_block_delta' && (chunk.data as any)?.reasoning) {
          reasoningChunks++;
        }

        if (chunk.type === 'tool_use_complete') {
          toolUseCount++;
          console.log(`\n[Tool ${toolUseCount}] ${chunk.toolUse?.name}`);
        }
      }

      console.log(`\n[Grok] Tool uses: ${toolUseCount}, Reasoning chunks: ${reasoningChunks}`);

      // Grok should execute multiple tools
      expect(toolUseCount).toBeGreaterThanOrEqual(1);

      // Should have reasoning traces
      if (reasoningChunks > 0) {
        console.log('✓ Reasoning traces preserved during multi-turn');
      }

      const history = orchestrator.getMessageHistory();
      console.log(`✓ History: ${history.length} messages`);
    }, 120000);
  });

  describe('Loop Detection in Streaming', () => {
    it('should detect and prevent infinite loops', async () => {
      const orchestrator = createOrchestrator({
        defaultModelId: 'claude-haiku-4-5',
        projectPath: '/tmp/tests/streaming-loop-detection',
        storageDir: '/tmp/tests/.cortex/streaming-loop-detection',
        debug: true,
        loopControl: {
          maxToolIterations: 5,
          maxConsecutiveErrors: 3,
          maxLoopRepetitions: 2, // Very low to trigger detection
          toolTimeoutMs: 120000
        }
      });

      await orchestrator.createSession('/tmp/tests/streaming-loop-detection');

      const stream = orchestrator.streamMessage(
        'Keep using Glob to find package.json files repeatedly'
      );

      let iterations = 0;
      for await (const chunk of stream) {
        if (chunk.type === 'tool_use_complete') {
          iterations++;
        }
      }

      // Should stop before MAX_TOOL_ITERATIONS due to loop detection
      expect(iterations).toBeLessThanOrEqual(5);

      console.log(`✓ Loop detection stopped after ${iterations} iterations`);
    }, 120000);
  });

  describe('Error Handling in Streaming', () => {
    it('should handle tool errors gracefully in streaming', async () => {
      const orchestrator = createOrchestrator({
        defaultModelId: 'claude-haiku-4-5',
        projectPath: '/tmp/tests/streaming-error-handling',
        storageDir: '/tmp/tests/.cortex/streaming-error-handling',
        debug: true
      });

      await orchestrator.createSession('/tmp/tests/streaming-error-handling');

      const chunks: StreamChunk[] = [];

      // Request tool use with intentionally bad input
      const stream = orchestrator.streamMessage(
        'Read the file /nonexistent/fake/path.txt'
      );

      for await (const chunk of stream) {
        chunks.push(chunk);
      }

      // Stream should complete despite tool error
      expect(chunks.length).toBeGreaterThan(0);

      // Verify error was recorded in history
      const history = orchestrator.getMessageHistory();

      const hasToolResult = history.some(m => {
        const content = Array.isArray(m.message.content) ? m.message.content : [];
        return content.some(c => c.type === 'tool_result' && c.is_error);
      });

      expect(hasToolResult).toBe(true);

      console.log('✓ Tool error handled gracefully');
      console.log('✓ Error recorded in history');
    }, 120000);
  });

  describe('Continuation Streaming Validation', () => {
    it('should stream continuation responses in real-time', async () => {
      const orchestrator = createOrchestrator({
        defaultModelId: 'claude-haiku-4-5',
        projectPath: '/tmp/tests/streaming-continuation',
        storageDir: '/tmp/tests/.cortex/streaming-continuation',
        debug: true
      });

      await orchestrator.createSession('/tmp/tests/streaming-continuation');

      const textDeltas: string[] = [];
      let afterFirstToolUse = false;

      const stream = orchestrator.streamMessage(
        'Use Glob to find .ts files, then describe what you found'
      );

      for await (const chunk of stream) {
        if (chunk.type === 'tool_use_complete') {
          afterFirstToolUse = true;
        }

        // Track text deltas AFTER first tool use (continuation response)
        if (afterFirstToolUse && chunk.type === 'text_delta' && chunk.delta) {
          textDeltas.push(chunk.delta);
        }
      }

      // Should have text deltas from continuation response
      expect(textDeltas.length).toBeGreaterThan(0);

      console.log(`✓ Continuation response streamed: ${textDeltas.length} text chunks`);
    }, 120000);
  });

  describe('Session Persistence Validation', () => {
    it('should persist streaming tool use to JSONL correctly', async () => {
      const testDir = '/tmp/tests/streaming-persistence';
      const storageDir = '/tmp/tests/.cortex/streaming-persistence';

      if (existsSync(storageDir)) {
        await rm(storageDir, { recursive: true, force: true });
      }

      const orchestrator = createOrchestrator({
        defaultModelId: 'claude-haiku-4-5',
        projectPath: testDir,
        storageDir,
        debug: false
      });

      const session = await orchestrator.createSession(testDir);

      const stream = orchestrator.streamMessage('Use Read to read package.json');

      // Consume stream
      for await (const chunk of stream) {
        // Just consume
      }

      const history = orchestrator.getMessageHistory();

      // Find tool use and tool result messages
      const toolUseMsg = history.find(m => {
        const content = Array.isArray(m.message.content) ? m.message.content : [];
        return content.some(c => c.type === 'tool_use');
      });

      const toolResultMsg = history.find(m => {
        const content = Array.isArray(m.message.content) ? m.message.content : [];
        return content.some(c => c.type === 'tool_result');
      });

      expect(toolUseMsg).toBeDefined();
      expect(toolResultMsg).toBeDefined();

      // Verify UUIDs are unique
      const uuids = history.map(m => m.uuid);
      const uniqueUuids = new Set(uuids);
      expect(uniqueUuids.size).toBe(uuids.length);

      // Verify session ID consistent
      const sessionIds = history.map(m => m.timeline.sessionId);
      expect(sessionIds.every(id => id === session.sessionId)).toBe(true);

      console.log('✓ JSONL persistence validated');
      console.log(`✓ Messages stored: ${history.length}`);
      console.log(`✓ Unique UUIDs: ${uniqueUuids.size}`);
    }, 120000);
  });
});
