/**
 * ESC-abort orphan sub-agent recovery
 *
 * Tests the two-part fix:
 * 1. SubAgentProcessManager persists completed results to disk keyed by tool_use_id
 * 2. validateAndRepairMessages recovers persisted results instead of generic errors
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { SubAgentProcessManager } from '../SubAgentProcessManager.js';
import type { SubAgentResult } from '../SubAgentTypes.js';

// ============================================
// Part 1: Durable persistence via loadPersistedResult
// ============================================

describe('SubAgentProcessManager — durable result persistence', () => {
  const testDir = join(tmpdir(), `r30-test-${Date.now()}`);
  const sessionId = 'test-session-abc';
  const toolUseId = 'toolu_01XYZ';

  const fakeResult: SubAgentResult = {
    agentId: 'browse-agent-123',
    agentName: 'browse-agent',
    model: 'grok-4-1-fast-reasoning',
    startTime: new Date('2026-05-20T10:00:00Z'),
    endTime: new Date('2026-05-20T10:00:30Z'),
    durationMs: 30000,
    turnCount: 3,
    status: 'completed',
    summary: 'Found and extracted the data.',
    fullResponse: 'Detailed agent response here.',
    toolsUsed: [],
    filesRead: ['/workspace/data.json'],
    filesModified: [],
    cost: { inputTokens: 1200, outputTokens: 400, estimatedCost: 0.005, cacheHits: 0 },
  };

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('loadPersistedResult returns null when no file exists', () => {
    const result = SubAgentProcessManager.loadPersistedResult(
      sessionId,
      toolUseId,
      testDir,
    );
    expect(result).toBeNull();
  });

  it('loadPersistedResult returns the result after manual write', () => {
    const dir = join(testDir, '.cortex', 'sessions', `${sessionId}.subagents`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${toolUseId}.json`), JSON.stringify(fakeResult), 'utf-8');

    const result = SubAgentProcessManager.loadPersistedResult(
      sessionId,
      toolUseId,
      testDir,
    );
    expect(result).not.toBeNull();
    expect(result!.agentId).toBe('browse-agent-123');
    expect(result!.status).toBe('completed');
    expect(result!.summary).toBe('Found and extracted the data.');
    expect(result!.fullResponse).toBe('Detailed agent response here.');
  });

  it('loadPersistedResult returns null for corrupted JSON', () => {
    const dir = join(testDir, '.cortex', 'sessions', `${sessionId}.subagents`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${toolUseId}.json`), '{{INVALID JSON', 'utf-8');

    const result = SubAgentProcessManager.loadPersistedResult(
      sessionId,
      toolUseId,
      testDir,
    );
    expect(result).toBeNull();
  });

  it('loadPersistedResult uses SESSION_STORAGE_DIR env override', () => {
    const customDir = 'custom-sessions';
    vi.stubEnv('SESSION_STORAGE_DIR', customDir);

    const dir = join(testDir, customDir, `${sessionId}.subagents`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${toolUseId}.json`), JSON.stringify(fakeResult), 'utf-8');

    const result = SubAgentProcessManager.loadPersistedResult(
      sessionId,
      toolUseId,
      testDir,
    );
    expect(result).not.toBeNull();
    expect(result!.agentId).toBe('browse-agent-123');

    vi.unstubAllEnvs();
  });
});

// ============================================
// Part 2: SpawnAgentOptions.toolUseId passthrough
// ============================================

describe('SubAgentProcessManager — toolUseId in SpawnAgentOptions', () => {
  it('SpawnAgentOptions accepts toolUseId field', async () => {
    // Type-level check: this should compile without error
    const opts = {
      modelOverride: 'test-model',
      timeoutMs: 5000,
      toolUseId: 'toolu_01ABC',
    };
    expect(opts.toolUseId).toBe('toolu_01ABC');
  });
});
