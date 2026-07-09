/**
 * Model served from a HuggingFace Gradio Space (native, via the hf-space transport).
 *
 * Set HF_SPACE_ID to your Gradio Space (e.g. "your-user/your-space"), HF_TOKEN for auth,
 * then select it with DEFAULT_MODEL_ID=hf-space (or HF_SPACE_MODEL_ID for a custom id) /
 * HELPER_MODEL_ID=hf-space. The Space must expose the `/run` API (see
 * scripts/hf-space-template/). Only registers when HF_SPACE_ID is set.
 */

import { createHFSpaceModelConfig } from '../../configurators/HFSpaceConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

const num = (v: string | undefined, d: number) => {
  const n = v ? parseInt(v, 10) : NaN;
  return Number.isFinite(n) ? n : d;
};

const HF_SPACE_ID = process.env.HF_SPACE_ID?.trim();

export const hfSpace: ModelConfig | null = HF_SPACE_ID
  ? createHFSpaceModelConfig({
      id: process.env.HF_SPACE_MODEL_ID?.trim() || 'hf-space',
      displayName: `HF Space: ${HF_SPACE_ID}`,
      family: 'hf-space',
      spaceId: HF_SPACE_ID,
      contextWindow: num(process.env.HF_SPACE_CONTEXT_WINDOW, 32768),
      outputTokens: num(process.env.HF_SPACE_MAX_OUTPUT, 4096),
      supportsTools: process.env.HF_SPACE_SUPPORTS_TOOLS !== 'false',
      supportsReasoning: process.env.HF_SPACE_REASONING === 'true',
    })
  : null;
