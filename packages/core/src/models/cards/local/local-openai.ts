/**
 * Local / self-hosted OpenAI-compatible model for the harness or helper model.
 *
 * Point `LOCAL_MODEL_ENDPOINT` at any OpenAI-compatible `/v1/chat/completions`
 * server — LM Studio (default :1234), llama-server, vLLM, Ollama, etc. Then select
 * it with `DEFAULT_MODEL_ID=local` (main) and/or `HELPER_MODEL_ID=local`.
 *
 * Specs are env-flexible so the card matches whatever model you load — set the
 * context window / output cap so compaction triggers correctly, and toggle tool
 * support. TOOL CALLING: the harness expects native OpenAI `tool_calls[]`, so run
 * your server with tool parsing on (e.g. `llama-server --jinja`, vLLM
 * `--enable-auto-tool-choice`, LM Studio's tool support). No API key required
 * unless your server enforces one (`LOCAL_MODEL_API_KEY`).
 */

import { createLocalModelConfig } from '../../configurators/LocalModelConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

const num = (v: string | undefined, d: number) => {
  const n = v ? parseInt(v, 10) : NaN;
  return Number.isFinite(n) ? n : d;
};

export const localOpenAI: ModelConfig = createLocalModelConfig({
  id: 'local',
  displayName: 'Local (OpenAI-compatible)',
  family: 'local',
  contextWindow: num(process.env.LOCAL_MODEL_CONTEXT_WINDOW, 32768),
  outputTokens: num(process.env.LOCAL_MODEL_MAX_OUTPUT, 4096),
  endpoint: process.env.LOCAL_MODEL_ENDPOINT || 'http://localhost:1234/v1/chat/completions',
  apiKeyEnvVar: 'LOCAL_MODEL_API_KEY',
  supportsTools: process.env.LOCAL_MODEL_SUPPORTS_TOOLS !== 'false',
  // Set LOCAL_MODEL_REASONING=true for a reasoning model that emits a separate
  // reasoning_content field (run it with thinking on). Off by default.
  supportsReasoning: process.env.LOCAL_MODEL_REASONING === 'true',
});
