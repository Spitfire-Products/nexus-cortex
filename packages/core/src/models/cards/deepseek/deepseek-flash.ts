/**
 * DeepSeek Flash (deepseek-flash) — served by DeepSeek-V4.1-Flash-1017 since 2026-10-17.
 *
 * 2026-10-17 (api-docs.deepseek.com/quick_start/pricing "MODEL VERSION: DeepSeek-V4.1-Flash-1017";
 * /news "Use deepseek-flash as the model name. It is now served by DeepSeek-V4.1-Flash-1017, and the
 * calling method remains unchanged"; /updates "The API calling method and pricing remain unchanged"):
 * the alias was REPOINTED in place — no new model id, no way to request the September V4.1-Flash
 * weights. 1017 = "a minor update" (RL with self-feedback), MIT weights, SHORTER OUTPUTS + faster
 * task completion by design; DeepSeek's own Terminal-Bench 4.0 (Claude Code harness) 42.3 vs 31.2.
 * Every role on this card (action, helper, vision hand-off, resolver via the legacy name) moved with
 * it at 2026-10-16 ~10:46 PM PT — treat that as a model boundary in every ledger.
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
  displayName: 'DeepSeek Flash (V4.1-Flash-1017)',
  family: 'deepseek-v4', // identical parser/transport handling (same API shape as the V4 pair)

  // MULTIMODAL = image input only (no audio/video). The card schema carries one flag; the served constraints
  // (DeepSeek vision docs, probe-verified on the vision-exp alias 2026-08-25, unchanged by 1017): images via
  // image_url content blocks in USER messages only; auto-resized ~800x800 and capped at 384 tokens per image;
  // <=600 images per request; JPEG/PNG/GIF/WebP; tool calls with image context work. The orchestrator's image
  // TTL (orchestrator/imageTtl.ts) drops stale images because one image anywhere in history disables the
  // prompt-cache prefix. 1017 claims better visual benchmarks (Chartography 83.0, BabyVision 92.5), same modality.
  vision: true, // pricing page FEATURES: Vision; probe 2026-09-08 on the beta alias
  anchorProfile: 'bash-edit',
  promptPreset: 'boot-minimal',
  liftNudge: true,
  headlessDropAskUser: true,
  contextWindow: 1000000,
  outputTokens: 393216, // DeepSeek API max_tokens range 1..393216 (384K); provider defaults when unset: 64K thinking / 128K at effort max. Was 65536 (the old thinking default) until 2026-10-05.
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
