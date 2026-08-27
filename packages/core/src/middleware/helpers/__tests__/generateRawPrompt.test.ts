/**
 * Guard test for the compaction-prompt-rewrap defect (confirmed + fixed 2026-08-27).
 *
 * The 7 mentorship generators (incl. PATTERN_DETECTION loop-assist) used to call
 * adapter.compact(), which wraps their crafted instruction prompt inside the
 * "Summarize this conversation in 9 categories … CONVERSATION HISTORY: {prompt}"
 * template — so the helper summarized the instructions instead of acting on them.
 * They now call adapter.generate(), which MUST send the prompt RAW.
 *
 * This test would have caught the original bug. See
 * RECURSIVE_PM_WAKE_LOOP_DESIGN.md §ADDENDUM 08-27d and
 * .bench/mentorship-rewrap-smoke-2026-08-27.md.
 */
import { describe, it, expect, vi } from 'vitest';
import { ChatCompletionsAPIHelperAdapter } from '../adapters/ChatCompletionsAPIHelperAdapter.js';

const cfg: any = {
  id: 'deepseek-chat',
  provider: 'deepseek',
  api: {
    pattern: 'chat/completions',
    endpoint: 'https://example/chat/completions',
    apiKeyEnvVar: 'DEEPSEEK_API_KEY',
    authHeader: 'Authorization',
    authPrefix: 'Bearer',
  },
  limits: { contextWindow: 100000, outputTokens: 8192, requestsPerMinute: 1, tokensPerMinute: 1 },
};

const MARKER = 'RAWMARKER_break_the_repeated_failure_loop';
const promptMsg: any = [{ role: 'user', content: `You are an AI mentor. ${MARKER}` }];

describe('helper generate() sends the prompt RAW (rewrap-defect fix)', () => {
  it('generate() does NOT wrap in the compaction/summarization template', async () => {
    const adapter = new ChatCompletionsAPIHelperAdapter();
    const spy = vi
      .spyOn(adapter as any, 'makeAPICall')
      .mockResolvedValue({ choices: [{ message: { content: 'ok' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } });

    await adapter.generate(promptMsg, cfg, 500);

    const sent = JSON.stringify(spy.mock.calls[0][1]); // the messages array sent to the provider
    expect(sent).toContain(MARKER); // the real directive survives
    expect(sent).not.toContain('Summarize this conversation'); // NOT wrapped
    expect(sent).not.toContain('PRIMARY REQUEST'); // no 9-category template
  });

  it('compact() DOES wrap (contrast — why generators must use generate, not compact)', async () => {
    const adapter = new ChatCompletionsAPIHelperAdapter();
    const spy = vi
      .spyOn(adapter as any, 'makeAPICall')
      .mockResolvedValue({ choices: [{ message: { content: 'ok' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } });

    await adapter.compact(promptMsg, cfg, 500);

    const sent = JSON.stringify(spy.mock.calls[0][1]);
    expect(sent).toContain('Summarize this conversation'); // the wrapper is present on compact()
  });
});
