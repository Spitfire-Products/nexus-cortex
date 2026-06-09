/**
 * Integration test: the progress-gated hard tool-budget cap, driven through the
 * REAL orchestrator loop (sendMessage AND streamMessage) with a scripted model.
 *
 * Live benchmarks could not reliably trigger the force-stop — real models either
 * make distinct progress (gate correctly stays quiet) or hit exact-repeat loop
 * detection first. This test injects a scripted APIClient that emits a rotating
 * cycle of tool calls (4 distinct, each re-issued) so that, past the hard budget,
 * the recent window is ≥50% repeats (isToolProgressStalled === true) while no
 * single signature reaches MAX_LOOP_REPETITIONS — the exact pathology the gate
 * exists for. We assert the gate fires (force-synthesis) and the R29a net then
 * delivers a real text answer instead of a bare/preamble tool_use turn.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { createOrchestrator } from '../OrchestratorFactory.js';
import { APIClient, type APIResponse } from '../APIClient.js';

const SOFT_BUDGET = 4;            // hard cap = 2x = 8
const ROTATING = ['g0', 'g1', 'g2', 'g3']; // 4-cycle: ≥50% recent repeats by call 8, none hits 5
const TOOL_NAME = 'grep';         // snake_case (anthropic model) → converted to 'Grep' for the executor

/** A scripted APIClient that drives the real loop with a controlled tool_use sequence. */
class ScriptedAPIClient extends APIClient {
  public callCount = 0;
  constructor(private readonly hardCap: number) {
    super();
  }
  private nextProviderData(): any {
    this.callCount++;
    // A couple calls past the hard cap the loop has force-stopped; this is the
    // tools-suppressed synthesis turn — return a real text answer.
    if (this.callCount > this.hardCap) {
      return {
        id: `msg_synth_${this.callCount}`,
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'SYNTHESIZED: here is the final answer from gathered context.' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 8 },
      };
    }
    const pattern = ROTATING[(this.callCount - 1) % ROTATING.length];
    return {
      id: `msg_${this.callCount}`,
      type: 'message',
      role: 'assistant',
      content: [{ type: 'tool_use', id: `toolu_${this.callCount}`, name: TOOL_NAME, input: { pattern, path: '.' } }],
      stop_reason: 'tool_use',
      usage: { input_tokens: 10, output_tokens: 5 },
    };
  }
  override async sendRequest(): Promise<APIResponse> {
    return { data: this.nextProviderData(), status: 200, headers: {} };
  }
  override streamRequest(): any {
    const data = this.nextProviderData();
    // eslint-disable-next-line require-yield
    async function* noChunks(): AsyncGenerator<any> { /* finalMessage carries the content */ }
    return { chunks: noChunks(), finalMessage: Promise.resolve(data) };
  }
}

async function makeOrchestrator(scripted: ScriptedAPIClient) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forcestop-'));
  const orch = await createOrchestrator(
    {
      defaultModelId: 'claude-haiku-4-5', // anthropic/messages, snake_case tools
      projectPath: dir,
      storageDir: path.join(dir, '.cortex/sessions'),
      debug: false,
      // Low budget + high error/loop tolerance so ONLY the progress gate can stop
      // the loop (isolates the behaviour under test from loop-detection / error caps).
      loopControl: {
        toolBudgetSoft: SOFT_BUDGET,
        maxLoopRepetitions: 999,
        maxConsecutiveErrors: 999,
        maxToolIterations: 50,
      },
      // Test seam: inject the scripted client (production never sets this).
      __apiClientOverride: scripted,
    } as any,
    { enablePermissions: false }, // no permission prompts — tools auto-execute
  );
  await orch.createSession(dir, 'claude-haiku-4-5');
  return { orch, dir };
}

describe('progress-gated hard cap — end-to-end through the real loop', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let dirs: string[] = [];

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    dirs = [];
  });
  afterEach(() => {
    warnSpy.mockRestore();
    for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} }
  });

  it('sendMessage: force-stops a cycling model at the hard cap, then synthesizes an answer', async () => {
    const scripted = new ScriptedAPIClient(SOFT_BUDGET * 2);
    const { orch, dir } = await makeOrchestrator(scripted);
    dirs.push(dir);

    const res = await orch.sendMessage('Find every tool-budget constant in the codebase.');

    const warnings = warnSpy.mock.calls.map(c => String(c[0]));
    // The gate fired (NOT loop detection, NOT max iterations).
    expect(warnings.some(w => /hard cap \+ stalled progress/.test(w))).toBe(true);
    // It stopped near the hard cap, far below MAX_TOOL_ITERATIONS (50).
    expect(scripted.callCount).toBeGreaterThanOrEqual(SOFT_BUDGET * 2);
    expect(scripted.callCount).toBeLessThan(20);
    // The R29a net delivered real text rather than a bare/preamble tool_use turn.
    const text = Array.isArray(res.content)
      ? res.content.filter((b: any) => b?.type === 'text').map((b: any) => b.text).join(' ')
      : String(res.content);
    expect(text).toMatch(/SYNTHESIZED|final answer/i);
  }, 30000);

  it('streamMessage: force-stops a cycling model at the hard cap (streaming parity)', async () => {
    const scripted = new ScriptedAPIClient(SOFT_BUDGET * 2);
    const { orch, dir } = await makeOrchestrator(scripted);
    dirs.push(dir);

    // Drive the async generator to completion.
    const chunks: any[] = [];
    for await (const chunk of orch.streamMessage('Find every tool-budget constant in the codebase.')) {
      chunks.push(chunk);
    }

    const warnings = warnSpy.mock.calls.map(c => String(c[0]));
    expect(warnings.some(w => /Streaming.*hard cap \+ stalled progress/.test(w))).toBe(true);
    expect(scripted.callCount).toBeGreaterThanOrEqual(SOFT_BUDGET * 2);
    expect(scripted.callCount).toBeLessThan(20);
  }, 30000);

  it('does NOT force-stop a model making distinct progress (control)', async () => {
    // Scripted to emit a UNIQUE tool call every turn (never cycling), then text.
    class DistinctClient extends ScriptedAPIClient {
      private n = 0;
      override async sendRequest(): Promise<APIResponse> {
        this.callCount++; this.n++;
        if (this.n > 12) {
          return { data: { id: 'm', type: 'message', role: 'assistant', content: [{ type: 'text', text: 'done, distinct work complete' }], stop_reason: 'end_turn', usage: { input_tokens: 5, output_tokens: 5 } }, status: 200, headers: {} };
        }
        return { data: { id: `m${this.n}`, type: 'message', role: 'assistant', content: [{ type: 'tool_use', id: `t${this.n}`, name: TOOL_NAME, input: { pattern: `unique-${this.n}`, path: '.' } }], stop_reason: 'tool_use', usage: { input_tokens: 5, output_tokens: 5 } }, status: 200, headers: {} };
      }
    }
    const scripted = new DistinctClient(SOFT_BUDGET * 2);
    const { orch, dir } = await makeOrchestrator(scripted);
    dirs.push(dir);

    await orch.sendMessage('Read 12 distinct files.');

    const warnings = warnSpy.mock.calls.map(c => String(c[0]));
    // Past the hard budget (12 > 8) but NEVER force-stopped — distinct progress.
    expect(warnings.some(w => /hard cap \+ stalled progress/.test(w))).toBe(false);
  }, 30000);
});
