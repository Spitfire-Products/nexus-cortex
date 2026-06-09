/**
 * Regression: switchModel same-model no-op guard.
 *
 * The server route calls switchModel on every request carrying `model`, so a
 * same-model "switch" fires every headless turn. Without the guard it nulls
 * the Responses-API chain (lastResponseId) and can slice history, silently
 * breaking multi-turn continuity. Cross-harness bug class — nexus fixed its
 * equivalent in 407fcfb12; this is the nexus-cortex port.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createOrchestrator } from '../OrchestratorFactory.js';
import type { CortexOrchestrator } from '../CortexOrchestrator.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import { tmpdir } from 'os';

describe('switchModel same-model guard', () => {
  let orchestrator: CortexOrchestrator;
  let testDir: string;

  beforeEach(async () => {
    testDir = path.join(tmpdir(), `switchmodel-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(testDir, { recursive: true });
    orchestrator = await createOrchestrator({
      defaultModelId: 'claude-haiku-4-5',
      projectPath: testDir,
      storageDir: path.join(testDir, '.cortex/sessions'),
    });
    await orchestrator.createSession(testDir, 'claude-haiku-4-5');
  });

  it('same-model switch preserves the Responses-API chain and history', async () => {
    const o = orchestrator as any;
    o.lastResponseId = 'resp_chain_123';
    o.lastResponseIdProvider = 'anthropic';
    o.messageCountAtLastResponse = 3;
    const histLenBefore = orchestrator.getMessageHistory().length;

    const result = await orchestrator.switchModel('claude-haiku-4-5');

    expect(result.success).toBe(true);
    expect(result.previousModel).toBe('claude-haiku-4-5');
    expect(result.newModel).toBe('claude-haiku-4-5');
    expect(result.contextAdjustment).toBeUndefined();
    expect(o.lastResponseId).toBe('resp_chain_123');
    expect(o.messageCountAtLastResponse).toBe(3);
    expect(orchestrator.getMessageHistory().length).toBe(histLenBefore);
  });

  it('genuine model change still resets the chain', async () => {
    const o = orchestrator as any;
    o.lastResponseId = 'resp_chain_456';
    o.lastResponseIdProvider = 'anthropic';

    const result = await orchestrator.switchModel('grok-4-fast');

    expect(result.success).toBe(true);
    expect(result.newModel).toBe('grok-4-fast');
    expect(o.lastResponseId).toBeNull();
  });
});
