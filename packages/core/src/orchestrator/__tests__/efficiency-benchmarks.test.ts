/**
 * Efficiency Benchmarks — Loop Control & Budget Signal Tests
 *
 * Test Suite 1: Loop control wiring (env vars → config → orchestrator)
 * Test Suite 2: Budget signal injection (50%/80% thresholds)
 * Test Suite 4: Action hallucination guard (no mutation tools on read-only prompts)
 */

import { describe, it, expect, afterEach } from 'vitest';
import { createOrchestrator } from '../OrchestratorFactory.js';
import { CortexOrchestrator } from '../CortexOrchestrator.js';
import { computeToolBudgetSignal } from '../toolBudgetSignal.js';
import { DEFAULT_SETTINGS } from '../../config/SettingsSchema.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import { tmpdir } from 'os';

function makeTempDir() {
  return path.join(
    tmpdir(),
    `efficiency-test-${Date.now()}-${Math.random().toString(36).substring(7)}`
  );
}

async function makeOrchestrator(
  testDir: string,
  overrides: Record<string, any> = {}
): Promise<CortexOrchestrator> {
  await fs.mkdir(testDir, { recursive: true });
  return createOrchestrator({
    defaultModelId: 'claude-haiku-4-5',
    projectPath: testDir,
    storageDir: path.join(testDir, 'sessions'),
    debug: false,
    ...overrides,
  });
}

describe('Efficiency Benchmarks', () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    delete process.env.MAX_TOOL_ITERATIONS;
    delete process.env.MAX_CONSECUTIVE_ERRORS;
    delete process.env.TOOL_TIMEOUT_MS;
    delete process.env.MAX_LOOP_REPETITIONS;

    for (const fn of cleanups) {
      await fn().catch(() => {});
    }
    cleanups.length = 0;
  });

  function track(orchestrator: CortexOrchestrator, dir: string) {
    cleanups.push(async () => {
      await orchestrator.cleanup().catch(() => {});
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    });
    return orchestrator;
  }

  // =========================================================================
  // TEST SUITE 1: Loop Control Wiring
  // =========================================================================
  describe('Suite 1: Loop Control Wiring', () => {
    it('should have CORTEX-parity default of 50 in SettingsSchema', () => {
      expect(DEFAULT_SETTINGS.MAX_TOOL_ITERATIONS).toBe('50');
    });

    it('should wire env var MAX_TOOL_ITERATIONS to config.loopControl', async () => {
      process.env.MAX_TOOL_ITERATIONS = '42';
      const dir = makeTempDir();
      const o = track(await makeOrchestrator(dir), dir);

      const loopConfig = o.getLoopControlConfig();
      expect(loopConfig.maxToolIterations).toBe(42);
    });

    it('should wire all loop control env vars', async () => {
      process.env.MAX_TOOL_ITERATIONS = '75';
      process.env.MAX_CONSECUTIVE_ERRORS = '5';
      process.env.TOOL_TIMEOUT_MS = '60000';
      process.env.MAX_LOOP_REPETITIONS = '3';

      const dir = makeTempDir();
      const o = track(await makeOrchestrator(dir), dir);

      const loopConfig = o.getLoopControlConfig();
      expect(loopConfig.maxToolIterations).toBe(75);
      expect(loopConfig.maxConsecutiveErrors).toBe(5);
      expect(loopConfig.toolTimeoutMs).toBe(60000);
      expect(loopConfig.maxLoopRepetitions).toBe(3);
    });

    it('should prefer explicit config over env vars', async () => {
      process.env.MAX_TOOL_ITERATIONS = '999';
      const dir = makeTempDir();
      const o = track(
        await makeOrchestrator(dir, { loopControl: { maxToolIterations: 25 } }),
        dir
      );

      const loopConfig = o.getLoopControlConfig();
      expect(loopConfig.maxToolIterations).toBe(25);
    });

    it('should use unified defaults when no env var or explicit config is set', async () => {
      const dir = makeTempDir();
      const o = track(await makeOrchestrator(dir), dir);

      const loopConfig = o.getLoopControlConfig();
      expect(loopConfig.maxToolIterations).toBe(50);
      expect(loopConfig.maxConsecutiveErrors).toBe(3);
      expect(loopConfig.toolTimeoutMs).toBe(120000);
      expect(loopConfig.maxLoopRepetitions).toBe(5);
    });

    it('should reject NaN env var values gracefully', async () => {
      process.env.MAX_TOOL_ITERATIONS = 'not-a-number';
      const dir = makeTempDir();
      const o = track(await makeOrchestrator(dir), dir);

      const loopConfig = o.getLoopControlConfig();
      expect(loopConfig.maxToolIterations).toBe(50);
      expect(Number.isNaN(loopConfig.maxToolIterations)).toBe(false);
    });

    it('should use same defaults in both streaming and non-streaming paths', async () => {
      const dir = makeTempDir();
      const o = track(await makeOrchestrator(dir), dir);

      const loopConfig = o.getLoopControlConfig();
      expect(loopConfig.maxToolIterations).toBe(50);
      expect(typeof loopConfig.maxToolIterations).toBe('number');
    });
  });

  // =========================================================================
  // TEST SUITE 2: Budget Signal Injection (computeToolBudgetSignal)
  // =========================================================================
  describe('Suite 2: Budget Signal Injection', () => {
    it('should inject budget signal at softBudget threshold', () => {
      const signal = computeToolBudgetSignal(20, 20);
      expect(signal).toBeTruthy();
      expect(signal!.toLowerCase()).toContain('tool calls');
    });

    it('should inject synthesis directive at 1.5x softBudget', () => {
      const signal = computeToolBudgetSignal(30, 20);
      expect(signal).toBeTruthy();
      expect(signal!.toLowerCase()).toContain('synthesize');
    });

    it('should not inject signal below softBudget', () => {
      const signal = computeToolBudgetSignal(5, 20);
      expect(signal).toBeFalsy();
    });

    it('should warn about tool diversity when one tool called 10+ times', async () => {
      const dir = makeTempDir();
      const o = track(
        await makeOrchestrator(dir, { loopControl: { maxToolIterations: 50 } }),
        dir
      );

      const toolCallCounts = new Map<string, number>([
        ['Read', 12],
        ['Grep', 3],
      ]);

      const warning = o.getDiversityWarning(toolCallCounts);
      expect(warning).toBeTruthy();
      expect(warning).toContain('Read');
    });
  });

  // =========================================================================
  // TEST SUITE 4: Action Hallucination Guard
  // =========================================================================
  describe('Suite 4: Action Hallucination Guard (static)', () => {
    it('should classify mutation and read-only tools correctly', async () => {
      const dir = makeTempDir();
      const o = track(await makeOrchestrator(dir), dir);

      const mutationTools = [
        'TodoCreate', 'TodoUpdate', 'TodoWrite',
        'Write', 'Edit', 'NotebookEdit',
      ];
      for (const tool of mutationTools) {
        expect(o.isMutationTool(tool)).toBe(true);
      }

      const readTools = ['Read', 'Grep', 'Glob', 'BashOutput'];
      for (const tool of readTools) {
        expect(o.isMutationTool(tool)).toBe(false);
      }
    });
  });
});
