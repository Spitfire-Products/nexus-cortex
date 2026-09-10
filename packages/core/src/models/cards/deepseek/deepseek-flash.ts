/**
 * DeepSeek Flash (deepseek-flash) — DeepSeek-V4.1-Flash, GA.
 *
 * Catalog collapse verified 2026-09-10 (api-docs.deepseek.com/quick_start/pricing + live
 * /models = [deepseek-flash, deepseek-v4-pro]): `deepseek-flash` is the canonical id;
 * the legacy `deepseek-v4-flash` / `deepseek-v4-flash-vision-exp` names and the
 * `deepseek-v4.1-flash-expires-on-0910` beta alias are still accepted but all SERVED BY
 * V4.1 Flash at the Flash price (responses echo `model: deepseek-flash`). From 2026-09-14
 * 04:00 UTC `deepseek-v4-pro` also routes here until V4.1 Pro ships.
 *
 * Capabilities = the v4.1 beta card (probe-verified 2026-09-08): reasoning_content +
 * effort ladder {low, high, max} (medium coerces → high), OpenAI-format tool calls, vision
 * (image_url blocks), 1M context. Concurrency limit 2500 (pro: 500) — the beta's ~20 cap is
 * gone (30-parallel probe 2026-09-10: 30/30 200). Pricing per 1M (off-peak / peak):
 * cache-hit $0.003/$0.006, cache-miss $0.15/$0.30, output $0.60/$1.20; peak = 01-04 &
 * 06-10 UTC Mon-Fri.
 */

import { createDeepSeekModelConfig } from '../../configurators/DeepSeekConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const deepseekFlash: ModelConfig = createDeepSeekModelConfig({
  id: 'deepseek-flash',
  displayName: 'DeepSeek Flash (V4.1)',
  family: 'deepseek-v4', // identical parser/transport handling (same API shape as the V4 pair)

  vision: true, // V4.1 Flash is multimodal (pricing page FEATURES: Vision ✓; probe 2026-09-08 on the beta alias)
  anchorProfile: 'bash-edit',
  promptPreset: 'boot-minimal',
  liftNudge: true,
  headlessDropAskUser: true,
  contextWindow: 1000000,
  outputTokens: 65536,
  inputCost: 0.15,   // cache-miss off-peak (pricing page 2026-09-10); benches reconcile from verified provider pricing
  outputCost: 0.6,   // off-peak
  reasoning: {
    supported: true,
    toggleable: true,
    format: 'reasoning_content',
    effort: 'medium',          // accepted, coerced → high server-side (ladder is {low, high, max}); bench arms override per run
    extractionMethod: 'separate_field',
    pattern: 'interleaved'
  }
});
