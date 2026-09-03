/**
 * def-7f510b5635 (4.91.0): an exception thrown AFTER a tool batch executed must never re-run the batch.
 * The scripted API returns one tool_use; CORTEX_TEST_POST_EXEC_THROW=once makes the loop throw right after
 * execution. Before the fix the loop re-entered with the same assistant message and re-executed the tool
 * until the error cap (v4 flash/dna-insert: 1000 iterations). Now: exactly one execution, an error
 * tool_result, and the turn ends (synthesis may ask the model once more).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createOrchestrator } from '../OrchestratorFactory.js';
import { APIClient, type APIResponse } from '../APIClient.js';

const TOOL_NAME = 'grep';

class OneToolThenAnswer extends APIClient {
  public callCount = 0;
  private data(): any {
    this.callCount++;
    if (this.callCount === 1) {
      return { id: 'm1', type: 'message', role: 'assistant',
        content: [{ type: 'tool_use', id: 'toolu_once', name: TOOL_NAME, input: { pattern: 'zzz', path: '.' } }],
        stop_reason: 'tool_use', usage: { input_tokens: 10, output_tokens: 5 } };
    }
    return { id: `m${this.callCount}`, type: 'message', role: 'assistant',
      content: [{ type: 'text', text: 'FINAL: nothing found.' }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5 } };
  }
  override async sendRequest(): Promise<APIResponse> { return { data: this.data(), status: 200, headers: {} }; }
  override streamRequest(): any {
    const d = this.data();
    async function* none(): AsyncGenerator<any> { /* finalMessage carries the content */ }
    return { chunks: none(), finalMessage: Promise.resolve(d) };
  }
}

// createOrchestrator validates the provider key even with __apiClientOverride (no real call is made) — skip keyless (CI).
describe.skipIf(!process.env.ANTHROPIC_API_KEY)('re-execution guard (def-7f510b5635)', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reexec-')); });
  afterEach(() => { delete process.env.CORTEX_TEST_POST_EXEC_THROW; fs.rmSync(dir, { recursive: true, force: true }); });

  for (const mode of ['sendMessage', 'streamMessage'] as const) {
    it(`${mode}: a post-execution exception ends the batch once — no re-execution, error result recorded`, async () => {
      const api = new OneToolThenAnswer();
      const orch = await createOrchestrator({
        defaultModelId: 'claude-haiku-4-5', projectPath: dir, storageDir: path.join(dir, '.cortex/sessions'), debug: false,
        loopControl: { maxConsecutiveErrors: 999, maxToolIterations: 50, maxLoopRepetitions: 999 },
        __apiClientOverride: api,
      } as any, { enablePermissions: false });
      await orch.createSession(dir, 'claude-haiku-4-5');
      process.env.CORTEX_TEST_POST_EXEC_THROW = 'once';
      if (mode === 'sendMessage') {
        await orch.sendMessage('find zzz');
      } else {
        for await (const _chunk of orch.streamMessage('find zzz')) { /* drain */ }
      }
      expect(process.env.CORTEX_TEST_POST_EXEC_THROW).toBe('fired'); // the hook actually threw once
      const history = orch.getMessageHistory() as any[];
      const results = history.flatMap((m) => Array.isArray(m?.message?.content) ? m.message.content : [])
        .filter((b: any) => b?.type === 'tool_result' && b.tool_use_id === 'toolu_once');
      expect(results.length).toBe(1);                 // exactly ONE result for the executed tool_use
      expect(results[0].is_error).toBe(true);         // the synthetic fault surfaced as an error result
      expect(api.callCount).toBeLessThanOrEqual(3);   // initial + at most synthesis/continuation; no 1000-iteration spin
      await orch.cleanup().catch(() => {});
    });
  }
});
