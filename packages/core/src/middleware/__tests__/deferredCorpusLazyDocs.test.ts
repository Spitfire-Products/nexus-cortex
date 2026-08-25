/**
 * Item 9c (HARNESS_IMPROVEMENT_BACKLOG): the deferred static corpus must be
 * rebuilt under TURN-0 conditions at delivery time, with project docs read
 * lazily — so a CORTEX.md written DURING turn 1 (the orient script's
 * mechanical render) rides the corpus that lands at the anchor-lift boundary.
 * Regression guarded: turn-gated docs (conditions.turnNumber=0) previously
 * vanished from the delivery when the orchestrator's counter had advanced.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { SystemMessageMiddleware } from '../SystemMessageMiddleware.js';
import { SystemMessageLoader } from '../../system-messages/SystemMessageLoader.js';
import type { ModelConfig } from '../../models/ModelConfig.interface.js';

const model = {
  id: 'deepseek-v4-flash',
  api: { pattern: 'chat/completions' },
  reasoning: { supported: false },
  tools: { supported: true },
  streaming: { supported: true },
  promptPreset: 'boot-minimal',
} as unknown as ModelConfig;

let proj: string;

beforeAll(() => {
  proj = fs.mkdtempSync(path.join(os.tmpdir(), 'defer-lazy-'));
});
afterAll(() => {
  fs.rmSync(proj, { recursive: true, force: true });
});

describe('deferred corpus: turn-0 semantics + lazy project-doc pickup', () => {
  it('picks up a CORTEX.md written after boot, even with an advanced turn counter', async () => {
    const loader = new SystemMessageLoader({ projectPath: proj });
    const mw = new SystemMessageMiddleware(loader, {} as any);
    // orchestrator is mid-first-turn tool loop; counter has moved past 0
    const ctx = {
      sessionId: 's', conversationId: 'c', turnNumber: 3,
      modelId: 'deepseek-v4-flash', config: { projectPath: proj },
    } as any;

    const before = await mw.buildDeferredStaticCorpus(model, true, ctx);
    expect(before ?? '').not.toContain('LAZY_DOC_MARKER');

    // the orient script writes the mechanical CORTEX.md during turn 1
    fs.mkdirSync(path.join(proj, '.cortex'), { recursive: true });
    fs.writeFileSync(
      path.join(proj, '.cortex', 'CORTEX.md'),
      '# CORTEX.md\nLAZY_DOC_MARKER: build with `npm run build`.\n'
    );

    const after = await mw.buildDeferredStaticCorpus(model, true, ctx);
    expect(after).toBeDefined();
    expect(after!).toContain('LAZY_DOC_MARKER');
    // the corpus is everything EXCEPT the core system prompt
    expect(after!).not.toContain('You are Cortex, a coding agent');
  });
});
