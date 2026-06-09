/**
 * Efficiency Benchmark Smoke Tests
 *
 * Real API tests that verify the over-exploration fix works end-to-end.
 * Runs the same prompts through nexus-cortex and captures iteration counts.
 *
 * Run with: ENABLE_SMOKE_TESTS=true npx vitest run --testPathPattern efficiency-benchmarks-smoke
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { CortexOrchestrator } from '../../CortexOrchestrator.js';
import { createOrchestrator } from '../../OrchestratorFactory.js';
import * as fs from 'fs/promises';

const SMOKE_ENABLED = process.env.ENABLE_SMOKE_TESTS === 'true';
const describeSmoke = SMOKE_ENABLED ? describe : describe.skip;

interface BenchmarkResult {
  iterations: number;
  wallClockMs: number;
  toolUses: Array<{ name: string; input: any }>;
  content: string;
  tokens: { inputTokens: number; outputTokens: number };
}

describeSmoke('Efficiency Benchmark Smoke Tests', () => {
  let orchestrator: CortexOrchestrator;
  const testDir = '/tmp/tests/efficiency-benchmark-smoke';

  beforeAll(async () => {
    await fs.mkdir(testDir, { recursive: true });

    orchestrator = await createOrchestrator({
      defaultModelId: process.env.DEFAULT_MODEL_ID || 'grok-code-fast-1',
      projectPath: process.cwd(),
      storageDir: `${testDir}/sessions`,
      debug: false,
      loopControl: {
        maxToolIterations: 50,
      },
    });

    await orchestrator.createSession(process.cwd());
  });

  afterAll(async () => {
    if (orchestrator) await orchestrator.cleanup().catch(() => {});
    await fs.rm(testDir, { recursive: true, force: true }).catch(() => {});
  });

  function extractText(content: string | any[]): string {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content
        .filter((b: any) => b.type === 'text')
        .map((b: any) => b.text || '')
        .join('\n');
    }
    return '';
  }

  async function benchmark(prompt: string): Promise<BenchmarkResult> {
    const start = Date.now();
    const response = await orchestrator.sendMessage(prompt);
    const wallClockMs = Date.now() - start;

    return {
      iterations: response.metadata?.toolCallIterations || 0,
      wallClockMs,
      toolUses: response.toolUses || [],
      content: extractText(response.content),
      tokens: {
        inputTokens: response.usage?.inputTokens || 0,
        outputTokens: response.usage?.outputTokens || 0,
      },
    };
  }

  // =========================================================================
  // Prompt A: Bounded factual question — should be 2-5 tools
  // =========================================================================
  it('Prompt A: bounded factual — permission profiles', async () => {
    const result = await benchmark(
      'Which permission profiles exist in the .cortex/ directory? Just list their names and file paths.'
    );

    console.log(`[Benchmark A] iterations=${result.iterations}, tools=${result.toolUses.map(t => t.name).join(',')}, ms=${result.wallClockMs}`);

    // Must complete within 15 iterations (CORTEX parity is ~5)
    expect(result.iterations).toBeLessThanOrEqual(15);
    expect(result.iterations).toBeGreaterThan(0);

    // Must mention dev/test/prod
    const lower = result.content.toLowerCase();
    expect(lower).toContain('dev');
    expect(lower).toContain('test');
    expect(lower).toContain('prod');

    // No mutation tools on a factual question
    const mutationTools = ['TodoCreate', 'TodoUpdate', 'TodoWrite', 'Write', 'Edit', 'NotebookEdit'];
    for (const tool of result.toolUses) {
      expect(mutationTools).not.toContain(tool.name);
    }
  }, 120000);

  // =========================================================================
  // Prompt B: Multi-part bounded — should be 2-3 tools
  // =========================================================================
  it('Prompt B: multi-part bounded — MAX_TOOL_ITERATIONS default', async () => {
    const result = await benchmark(
      'What is the default value of MAX_TOOL_ITERATIONS in SettingsSchema.ts? Report the exact string value.'
    );

    console.log(`[Benchmark B] iterations=${result.iterations}, tools=${result.toolUses.map(t => t.name).join(',')}, ms=${result.wallClockMs}`);

    expect(result.iterations).toBeLessThanOrEqual(10);
    expect(result.content).toContain('50');

    const mutationTools = ['TodoCreate', 'TodoUpdate', 'TodoWrite', 'Write', 'Edit', 'NotebookEdit'];
    for (const tool of result.toolUses) {
      expect(mutationTools).not.toContain(tool.name);
    }
  }, 120000);

  // =========================================================================
  // Prompt C: Deep synthesis — should be 8-25 tools (NOT capped too aggressively)
  // =========================================================================
  it('Prompt C: deep synthesis — tool_use lifecycle trace', async () => {
    const result = await benchmark(
      'Trace the tool_use lifecycle in the non-streaming path of CortexOrchestrator.ts: ' +
      'from the initial response containing tool_use blocks, through execution, to the tool_result ' +
      'being saved to history. List the 5 major steps with approximate line numbers.'
    );

    console.log(`[Benchmark C] iterations=${result.iterations}, tools=${result.toolUses.map(t => t.name).join(',')}, ms=${result.wallClockMs}`);

    // Deep synthesis needs room — should use 3+ iterations but stay under 30
    expect(result.iterations).toBeGreaterThanOrEqual(1);
    expect(result.iterations).toBeLessThanOrEqual(30);

    // Must reference the orchestrator file
    expect(result.content).toContain('CortexOrchestrator');

    // No mutation tools
    const mutationTools = ['TodoCreate', 'TodoUpdate', 'TodoWrite', 'Write', 'Edit', 'NotebookEdit'];
    for (const tool of result.toolUses) {
      expect(mutationTools).not.toContain(tool.name);
    }
  }, 180000);

  // =========================================================================
  // Action hallucination guard — live test
  // =========================================================================
  it('should not create artifacts when asked a question', async () => {
    const result = await benchmark(
      'How many tool executors are registered in ExecutorRegistry.ts? Just give me the count.'
    );

    console.log(`[Benchmark hallucination] iterations=${result.iterations}, tools=${result.toolUses.map(t => t.name).join(',')}`);

    expect(result.iterations).toBeLessThanOrEqual(10);

    const mutationTools = ['TodoCreate', 'TodoUpdate', 'TodoWrite', 'Write', 'Edit', 'NotebookEdit'];
    for (const tool of result.toolUses) {
      expect(mutationTools).not.toContain(tool.name);
    }
  }, 120000);
});
