/**
 * Hugging Face Inference Providers model for the harness or helper model.
 *
 * HF's router (router.huggingface.co) is an OpenAI-compatible endpoint that routes to
 * partner providers, so you can run the harness on a hosted open model with just an
 * `HUGGINGFACE_API_KEY`. Set `HF_MODEL_ID` to a *served* HF repo id — e.g.
 * `openai/gpt-oss-120b`, `deepseek-ai/DeepSeek-R1` — optionally with a routing suffix
 * (`:fastest` default, `:cheapest`, or a provider like `:together`). Then select it with
 * `DEFAULT_MODEL_ID=<that repo id>` and/or `HELPER_MODEL_ID=<that repo id>`.
 *
 * Specs are env-flexible (`HF_MODEL_CONTEXT_WINDOW` / `HF_MODEL_MAX_OUTPUT`) so the card
 * matches the chosen model. The router returns native OpenAI `tool_calls[]`, so tool
 * calling works through the standard adapter with no per-model parsing. NOTE: HF
 * serverless hosts mostly larger popular models; small ones are usually not served — use
 * the `local` card for those. The card only registers when `HF_MODEL_ID` is set.
 */

import { createHuggingFaceModelConfig } from '../../configurators/HuggingFaceConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

const num = (v: string | undefined, d: number) => {
  const n = v ? parseInt(v, 10) : NaN;
  return Number.isFinite(n) ? n : d;
};

const HF_MODEL_ID = process.env.HF_MODEL_ID?.trim();

export const hfRouter: ModelConfig | null = HF_MODEL_ID
  ? createHuggingFaceModelConfig({
      id: HF_MODEL_ID, // repo id → sent as the request-body "model"
      displayName: `HF: ${HF_MODEL_ID}`,
      family: 'huggingface',
      contextWindow: num(process.env.HF_MODEL_CONTEXT_WINDOW, 32768),
      outputTokens: num(process.env.HF_MODEL_MAX_OUTPUT, 4096),
      supportsTools: process.env.HF_MODEL_SUPPORTS_TOOLS !== 'false',
    })
  : null;
