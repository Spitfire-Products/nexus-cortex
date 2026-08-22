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
 *   MiniCPM5        — XML <function name="n"><param name="k">v</param></function>
 *                     (attribute syntax, optional <![CDATA[...]]> values,
 *                     <tool_sep> content separator — per its chat_template.jinja)
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
  // New-generation LFM2.5 (128K vocab lineage; both always-think). Vendor temps
  // (2.6B gen_config 0.1 / 8B 0.2); rep-penalty is NOT expressible via the card
  // — confound-check degenerate recursion before believing any 0/N.
  { envSlug: 'LFM2_5_2_6B',  id: 'lfm2.5-2.6b-space',  displayName: 'LFM2.5 2.6B (HF Space)',     family: 'lfm2.5',  repo: 'LiquidAI/LFM2.5-2.6B',           contextWindow: 32768, reasoning: true, defaultTemperature: 0.1 },
  { envSlug: 'LFM2_5_8B_A1B', id: 'lfm2.5-8b-a1b-space', displayName: 'LFM2.5 8B-A1B MoE (HF Space)', family: 'lfm2.5', repo: 'LiquidAI/LFM2.5-8B-A1B',       contextWindow: 32768, reasoning: true, defaultTemperature: 0.2 },
  // MiniCPM5 1.08B (dense Llama arch, apache-2.0; hybrid <think>; own XML tool
  // family — see normalize.ts). Temp 0.3 = tool-stability override (vendor chat
  // default is 0.9/0.95, but router-bench r8/r8b: 100/300 @0.9 vs 250/300 @0.3 —
  // format-fragile tool caller, the Phi class). 128K native ctx; 32K serving.
  { envSlug: 'MINICPM5_1B',  id: 'minicpm5-1b-space',  displayName: 'MiniCPM5 1B (HF Space)',     family: 'minicpm5', repo: 'openbmb/MiniCPM5-1B',           contextWindow: 32768, reasoning: true,  defaultTemperature: 0.3 },
  // Reasoners (1.5-4B)
  { envSlug: 'QWEN3_1_7B',   id: 'qwen3-1.7b-space',   displayName: 'Qwen3 1.7B (HF Space)',      family: 'qwen3',   repo: 'Qwen/Qwen3-1.7B',                contextWindow: 32768, reasoning: true,  defaultTemperature: 0.6 },
  { envSlug: 'QWEN3_5_4B',   id: 'qwen3.5-4b-space',   displayName: 'Qwen3.5 4B (HF Space)',      family: 'qwen3.5', repo: 'Qwen/Qwen3.5-4B',                contextWindow: 32768, reasoning: true,  defaultTemperature: 0.6 },
  { envSlug: 'SMOLLM3_3B',   id: 'smollm3-3b-space',   displayName: 'SmolLM3 3B (HF Space)',      family: 'smollm3', repo: 'HuggingFaceTB/SmolLM3-3B',       contextWindow: 32768, reasoning: true,  defaultTemperature: 0.6 },
  { envSlug: 'PHI_4_MINI',   id: 'phi-4-mini-space',   displayName: 'Phi-4-mini 3.8B (HF Space)', family: 'phi-4',   repo: 'microsoft/Phi-4-mini-instruct',  contextWindow: 32768, reasoning: false, defaultTemperature: 0.0 },
  // ── 2026-07-10 onboarding wave (candidate research ledger: dbai training/v2p3/
  //    CANDIDATE_RESEARCH_2026-07-10.md). Tool families verified from each repo's
  //    chat_template.jinja: granite + arctic emit Hermes-JSON; nemotron emits the
  //    Qwen3.5-style <function=> XML *wrapped* in <tool_call> (parseHFCompletion
  //    handles both, verified against dist). gemma-4 uses a channel-based format —
  //    reasoning/tool emission confirmed via live shape probe before first bench.
  { envSlug: 'GRANITE_4_1_3B',      id: 'granite-4.1-3b-space',      displayName: 'Granite 4.1 3B (HF Space)',        family: 'granite',  repo: 'ibm-granite/granite-4.1-3b',              contextWindow: 32768, reasoning: false, defaultTemperature: 0.3 },
  // Sampling sweep r12: 200/300 @0.6 vs 50/300 @0.3 — the INVERSE of the MiniCPM/Phi
  // pattern; the Qwen-thinking "greedy discouraged" vendor note is real. Keep 0.6.
  { envSlug: 'QWEN3_5_2B',          id: 'qwen3.5-2b-space',          displayName: 'Qwen3.5 2B (HF Space)',            family: 'qwen3.5',  repo: 'Qwen/Qwen3.5-2B',                         contextWindow: 32768, reasoning: true,  defaultTemperature: 0.6 },
  // Operator-requested wildcard: community reasoning distill of the same base —
  // controlled A/B vs vanilla (does a 750-sample reasoning distill help/hurt routing?).
  { envSlug: 'QWEN3_5_2B_KHAZARAI', id: 'qwen3.5-2b-khazarai-space', displayName: 'Qwen3.5 2B Khazarai Distill (HF Space)', family: 'qwen3.5', repo: 'khazarai/Qwen3.5-2B-Qwen3.6-plus-Distilled', contextWindow: 32768, reasoning: true, defaultTemperature: 0.6 },
  { envSlug: 'NEMOTRON_3_NANO_4B',  id: 'nemotron-3-nano-4b-space',  displayName: 'Nemotron 3 Nano 4B (HF Space)',    family: 'nemotron', repo: 'nvidia/NVIDIA-Nemotron-3-Nano-4B-BF16',   contextWindow: 32768, reasoning: true,  defaultTemperature: 0.6 },
  { envSlug: 'GEMMA_4_E2B',         id: 'gemma-4-e2b-space',         displayName: 'Gemma 4 E2B (HF Space)',           family: 'gemma4',   repo: 'google/gemma-4-E2B-it',                   contextWindow: 32768, reasoning: true,  defaultTemperature: 0.6 },
  { envSlug: 'ARCTIC_AWM_4B',       id: 'arctic-awm-4b-space',       displayName: 'Arctic AWM 4B (HF Space)',         family: 'qwen3',    repo: 'Snowflake/Arctic-AWM-4B',                 contextWindow: 32768, reasoning: true,  defaultTemperature: 0.6 },
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
    // The Space normally serves the card's pinned base repo — but a graduated
    // ADAPTER of that base is served through the same card (P4 INTERN / real-world
    // validation). HF_SPACE_EXPECT_MODEL_<SLUG> overrides the identity assert to
    // the adapter id (same convention as HF_SPACE_ID_<SLUG>).
    expectedSpaceModel: process.env[`HF_SPACE_EXPECT_MODEL_${spec.envSlug}`]?.trim() || spec.repo,
    // Wire the spec's swept sampling temp into the card (it was previously dead
    // weight — calls fell through to request-or-0.7, the exact condition the
    // near-greedy sweep proved wrong for format-fragile families). Per-slug env
    // override for experiments (e.g. serving an InfoSFT graduate at 0.0).
    defaultTemperature: (() => {
      const env = Number(process.env[`HF_SPACE_TEMPERATURE_${spec.envSlug}`]);
      return Number.isFinite(env) ? env : spec.defaultTemperature;
    })(),
  });
}

export const hfSpaceModelCards: ModelConfig[] = SPECS.map(buildCard).filter(
  (c): c is ModelConfig => c !== null
);
