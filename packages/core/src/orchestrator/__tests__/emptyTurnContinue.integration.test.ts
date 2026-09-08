/**
 * HB-ENDTURN-TERMINAL (2026-09-08): a reasoning-only empty turn MID-RECON (budget remaining) must be
 * nudged to CONTINUE (tools available), not forced into terminal surrender ("write your answer, no
 * tools"). The scripted API returns: recon tool_use → reasoning-only turn → (resume) tool_use → answer.
 *
 * We observe the injected nudge via the REQUESTS the mock receives (getMessageHistory() strips the
 * internal system-reminder text). The empty-retry nudge phrases are distinct from the EndTurn gate's:
 *   - reasoning_only_active (flag ON + budget): "continue the task now" + "budget remaining", tools allowed
 *   - reasoning_only        (flag OFF / exhausted): "write out your complete final answer" + forbid tools
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createOrchestrator } from '../OrchestratorFactory.js';
import { APIClient, type APIResponse } from '../APIClient.js';

const RECON = { pattern: 'zzz', path: '.' };
function toolMsg(id: string): any {
  return { id, type: 'message', role: 'assistant',
    content: [{ type: 'tool_use', id: `toolu_${id}`, name: 'grep', input: RECON }],
    stop_reason: 'tool_use', usage: { input_tokens: 10, output_tokens: 5 } };
}
function reasoningOnlyMsg(id: string): any {
  return { id, type: 'message', role: 'assistant',
    content: [{ type: 'thinking', thinking: 'Let me plan the next concrete step before acting.' }],
    stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5 } };
}
function answerMsg(id: string): any {
  return { id, type: 'message', role: 'assistant',
    content: [{ type: 'text', text: 'FINAL: done.' }], stop_reason: 'end_turn',
    usage: { input_tokens: 10, output_tokens: 5 } };
}

class ScriptedAPI extends APIClient {
  public callCount = 0;
  public script: any[] = [];
  public requestBlob = '';
  private data(): any {
    const i = this.callCount++;
    return this.script[Math.min(i, this.script.length - 1)];
  }
  private record(req: any) { try { this.requestBlob += '\n' + JSON.stringify(req); } catch { /* ignore */ } }
  override async sendRequest(req?: any): Promise<APIResponse> { this.record(req); return { data: this.data(), status: 200, headers: {} }; }
  override streamRequest(req?: any): any {
    this.record(req);
    const d = this.data();
    async function* none(): AsyncGenerator<any> { /* finalMessage carries the content */ }
    return { chunks: none(), finalMessage: Promise.resolve(d) };
  }
}

// createOrchestrator validates the provider key even with __apiClientOverride — skip keyless (CI).
describe.skipIf(!process.env.ANTHROPIC_API_KEY)('HB-ENDTURN-TERMINAL empty-turn continue', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emptycont-')); });
  afterEach(() => { delete process.env.CORTEX_EMPTY_TURN_CONTINUE; fs.rmSync(dir, { recursive: true, force: true }); });

  async function run(script: any[], flag: boolean, mode: 'sendMessage' | 'streamMessage', deadlineMs = 0) {
    if (flag) process.env.CORTEX_EMPTY_TURN_CONTINUE = 'true'; else delete process.env.CORTEX_EMPTY_TURN_CONTINUE;
    const api = new ScriptedAPI(); api.script = script;
    const orch = await createOrchestrator({
      defaultModelId: 'claude-haiku-4-5', projectPath: dir, storageDir: path.join(dir, '.cortex/sessions'), debug: false,
      loopControl: { maxConsecutiveErrors: 999, maxToolIterations: 50, maxLoopRepetitions: 999, turnDeadlineMs: deadlineMs },
      __apiClientOverride: api,
    } as any, { enablePermissions: false });
    await orch.createSession(dir, 'claude-haiku-4-5');
    if (mode === 'sendMessage') await orch.sendMessage('find zzz');
    else for await (const _c of orch.streamMessage('find zzz')) { /* drain */ }
    const blob = api.requestBlob.toLowerCase();
    const callCount = api.callCount;
    await orch.cleanup().catch(() => {});
    return { blob, callCount };
  }

  for (const mode of ['sendMessage', 'streamMessage'] as const) {
    it(`${mode}: flag ON + budget → reasoning-only turn gets the CONTINUE nudge (tools allowed), loop resumes`, async () => {
      const { blob, callCount } = await run(
        [toolMsg('m1'), reasoningOnlyMsg('m2'), toolMsg('m3'), answerMsg('m4')], true, mode);
      // reasoning_only_active nudge fired (unique phrases), NOT the terminal reasoning_only nudge.
      expect(blob).toContain('continue the task now');
      expect(blob).toContain('budget remaining');
      expect(blob).not.toContain('write out your complete final answer');
      // loop RESUMED past the empty turn (recon → reasoning → resume tool → answer).
      expect(callCount).toBeGreaterThanOrEqual(4);
    }, 40000);
  }

  it('sendMessage: flag OFF → byte-identical terminal reasoning_only nudge (write answer)', async () => {
    const { blob } = await run([toolMsg('m1'), reasoningOnlyMsg('m2'), answerMsg('m3')], false, 'sendMessage');
    expect(blob).toContain('write out your complete final answer');
    expect(blob).not.toContain('continue the task now');
  }, 40000);

  it('sendMessage: flag ON but budget spent (tiny deadline) → NO continue nudge (regression guard)', async () => {
    const { blob } = await run([toolMsg('m1'), reasoningOnlyMsg('m2'), answerMsg('m3')], true, 'sendMessage', 1);
    expect(blob).not.toContain('continue the task now');
  }, 40000);
});
