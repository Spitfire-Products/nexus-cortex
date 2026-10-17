/**
 * 🔴 RETIRED ALIAS (2026-10-17): DeepSeek's pricing page — "The legacy names deepseek-v4-flash and
 * deepseek-v4-flash-vision-exp are still accepted, but the corresponding models have been retired,
 * their requests are served by the DeepSeek-V4.1-Flash-1017 model" (billed at the Flash price).
 * Kept only so existing configs/arms keep resolving; new configs use `deepseek-flash`. The card below
 * mirrors the served model's price/capabilities; the original V4 Flash notes follow for history.
 *
 * DeepSeek V4 Flash Vision Exp (deepseek-v4-flash-vision-exp)
 * DeepSeek's first multimodal model (released 2026-08-21) — the V4 Flash line
 * with image input. 1M context, 384K max output.
 *
 * Vision facts (api-docs.deepseek.com/guides/vision, probed live 2026-08-25):
 * OpenAI-compatible image_url content blocks (base64 data: URI / external URL /
 * Files API); images auto-resized ~800×800, capped at 384 tokens per image;
 * ≤600 images/request; JPEG/PNG/GIF/WebP; images allowed in USER messages only.
 * Tool calls WITH image context verified live (read a value from a PNG and
 * emitted the correct function call).
 *
 * Pricing = identical to deepseek-v4-flash on the live pricing page
 * (2026-08-25: $0.22 in cache-miss / $0.66 out per M off-peak; peak 2×;
 * cache-hit $0.007/M). Card cost fields mirror the deepseek-v4-flash card's
 * existing convention so registry-relative routing stays consistent — a
 * family-wide card-pricing refresh is a separate change.
 *
 * Harness status: the image-path bridge shipped WITH this card in 4.71.0
 * (ReadImage tool, canonical image blocks, vision-gated image_url parts in
 * ChatCompletions/Messages adapters, downscale-at-ingest, image TTL eviction)
 * — end-to-end agentic vision verified in production (TB2 vision cell:
 * code-from-image solved with 1 ReadImage call).
 * ⚠ Cache caveat (probed 2026-08-25): image-bearing requests BYPASS DeepSeek
 * cache reads entirely; the harness's CORTEX_IMAGE_TTL_TURNS eviction restores
 * the discount for subsequent text turns. Not certified as a text-task drop-in
 * for deepseek-v4-flash (no parity cell yet). EXPERIMENTAL per DeepSeek — may
 * change or be withdrawn.
 */

import { createDeepSeekModelConfig } from '../../configurators/DeepSeekConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const deepseekV4FlashVisionExp: ModelConfig = createDeepSeekModelConfig({
  id: 'deepseek-v4-flash-vision-exp',
  displayName: 'DeepSeek V4 Flash Vision Exp (RETIRED alias → V4.1-Flash-1017)',
  family: 'deepseek-v4',

  // Same family defaults as deepseek-v4-flash (P4/P6 sweeps) — no vision-specific
  // sweep yet; revisit with the vision-cell arm.
  vision: true,
  anchorProfile: 'bash-edit',
  promptPreset: 'boot-minimal',
  // A′ config (TB2 matrix 2026-08-29, n=1): beats control on vision (50% vs 41%), the recovered full
  // data reversed the earlier "A′ hurts vision" (incomplete-read artifact). B (deferred-off) is worst
  // on vision (33%) and broke controls — not an option here.
  liftNudge: true,
  headlessDropAskUser: true,
  contextWindow: 1000000,
  outputTokens: 393216, // DeepSeek API max_tokens range 1..393216 (384K); provider defaults when unset: 64K thinking / 128K at effort max. Was 65536 (the old thinking default) until 2026-10-05.
  inputCost: 0.15,   // served by V4.1-Flash-1017 → billed at the Flash price (pricing page 2026-10-17)
  outputCost: 0.6,
  reasoning: {
    supported: true,
    // Hybrid thinker: effort IS API-settable (minimal..max all accepted, probe
    // 2026-09-01) — required for the gateway to pass per-request effort (the
    // pulse/envelope levers); without it the gateway silently dropped overrides.
    toggleable: true,
    format: 'reasoning_content',
    effort: 'medium', // reverted from 'max': max over-deliberated on solvable tasks (sampling A/B 2026-08-30: 35min/93 iters on circuit-fibsqrt where medium solved it fast, no pass-rate gain)
    extractionMethod: 'separate_field',
    pattern: 'interleaved'
  }
});
