/**
 * Ready-made cards for popular open sub-4B models served from your own HF Gradio
 * Space (the hf-space transport; deploy the template at scripts/hf-space-template/).
 *
 * Each card registers only when its Space id env var is set:
 *   HF_SPACE_ID_<SLUG>=your-user/your-space     (one Space per model — parallel use)
 * or, to point ALL of them at one shared Space you swap via its MODEL_ID variable:
 *   HF_SPACE_CANDIDATES=true + HF_SPACE_ID=your-user/your-space   (serial use)
 *
 * Every card pins the HF model repo it expects the Space to serve; the transport
 * verifies the Space's [MODEL=...] output prefix against it and fails loudly on
 * mismatch, so a card can never silently answer with the wrong model.
 *
 * Tool-call families (parsed by models/hfSpace/normalize.ts):
 *   Qwen3 / SmolLM3 — Hermes <tool_call>{json}</tool_call>
 *   Qwen3.5         — XML <function=name><parameter=k>v</parameter></function>
 *   Phi-4-mini      — bare JSON array
 *   LFM2.5          — pythonic <|tool_call_start|>[f(k=v)]<|tool_call_end|>
 */

import { createHFSpaceModelConfig } from '../../configurators/HFSpaceConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

interface SpaceModelSpec {
  /** env suffix: HF_SPACE_ID_<envSlug> */
  envSlug: string;
  id: string;
  displayName: string;
  family: string;
  /** HF repo the Space must serve (verified via the [MODEL=...] prefix). */
  repo: string;
  contextWindow: number;
  /** Hybrid thinker (enable_thinking template) -> reasoning_content. */
  reasoning: boolean;
  /** Force near-greedy sampling (format-fragile tool callers, e.g. Phi-4-mini). */
  defaultTemperature?: number;
}

// defaultTemperature = the VENDOR-recommended sampling temperature for each model
// (Qwen thinking 0.6 — greedy explicitly discouraged; SmolLM3 0.6; LFM2.5 0.3;
// Phi-4-mini greedy for function calling). Pair with Space-side GEN_TOP_P /
// GEN_MIN_P / GEN_REP_PENALTY variables (see scripts/hf-space-template/).
const SPECS: SpaceModelSpec[] = [
  // Routers (sub-1B)
  { envSlug: 'QWEN3_0_6B',   id: 'qwen3-0.6b-space',   displayName: 'Qwen3 0.6B (HF Space)',      family: 'qwen3',   repo: 'Qwen/Qwen3-0.6B',                contextWindow: 32768, reasoning: true,  defaultTemperature: 0.6 },
  { envSlug: 'QWEN3_5_0_8B', id: 'qwen3.5-0.8b-space', displayName: 'Qwen3.5 0.8B (HF Space)',    family: 'qwen3.5', repo: 'Qwen/Qwen3.5-0.8B',              contextWindow: 32768, reasoning: true,  defaultTemperature: 0.6 },
  { envSlug: 'LFM2_5_350M',  id: 'lfm2.5-350m-space',  displayName: 'LFM2.5 350M (HF Space)',     family: 'lfm2.5',  repo: 'LiquidAI/LFM2.5-350M',           contextWindow: 32768, reasoning: false, defaultTemperature: 0.3 },
  { envSlug: 'LFM2_5_1_2B',  id: 'lfm2.5-1.2b-space',  displayName: 'LFM2.5 1.2B (HF Space)',     family: 'lfm2.5',  repo: 'LiquidAI/LFM2.5-1.2B-Instruct',  contextWindow: 32768, reasoning: false, defaultTemperature: 0.3 },
  { envSlug: 'LFM2_5_1_2B_THINKING', id: 'lfm2.5-1.2b-thinking-space', displayName: 'LFM2.5 1.2B Thinking (HF Space)', family: 'lfm2.5', repo: 'LiquidAI/LFM2.5-1.2B-Thinking', contextWindow: 32768, reasoning: true, defaultTemperature: 0.3 },
  // Reasoners (1.5-4B)
  { envSlug: 'QWEN3_1_7B',   id: 'qwen3-1.7b-space',   displayName: 'Qwen3 1.7B (HF Space)',      family: 'qwen3',   repo: 'Qwen/Qwen3-1.7B',                contextWindow: 32768, reasoning: true,  defaultTemperature: 0.6 },
  { envSlug: 'QWEN3_5_4B',   id: 'qwen3.5-4b-space',   displayName: 'Qwen3.5 4B (HF Space)',      family: 'qwen3.5', repo: 'Qwen/Qwen3.5-4B',                contextWindow: 32768, reasoning: true,  defaultTemperature: 0.6 },
  { envSlug: 'SMOLLM3_3B',   id: 'smollm3-3b-space',   displayName: 'SmolLM3 3B (HF Space)',      family: 'smollm3', repo: 'HuggingFaceTB/SmolLM3-3B',       contextWindow: 32768, reasoning: true,  defaultTemperature: 0.6 },
  { envSlug: 'PHI_4_MINI',   id: 'phi-4-mini-space',   displayName: 'Phi-4-mini 3.8B (HF Space)', family: 'phi-4',   repo: 'microsoft/Phi-4-mini-instruct',  contextWindow: 32768, reasoning: false, defaultTemperature: 0.0 },
];

function buildCard(spec: SpaceModelSpec): ModelConfig | null {
  const spaceId =
    process.env[`HF_SPACE_ID_${spec.envSlug}`]?.trim() ||
    (process.env.HF_SPACE_CANDIDATES === 'true' ? process.env.HF_SPACE_ID?.trim() : undefined);
  if (!spaceId) return null;

  return createHFSpaceModelConfig({
    id: spec.id,
    displayName: spec.displayName,
    family: spec.family,
    spaceId,
    contextWindow: spec.contextWindow,
    outputTokens: 4096,
    supportsTools: true,
    supportsReasoning: spec.reasoning,
    expectedSpaceModel: spec.repo,
  });
}

export const hfSpaceModelCards: ModelConfig[] = SPECS.map(buildCard).filter(
  (c): c is ModelConfig => c !== null
);
