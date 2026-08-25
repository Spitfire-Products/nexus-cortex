/**
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
 * ⚠ Harness status: the chat/completions request builder has NO image-block
 * ingestion yet (only ResponsesAPIAdapter handles image_url) and no tool emits
 * image blocks — so end-to-end agentic vision (e.g. "look at this screenshot
 * in the workspace") needs the image-path bridge first. The card ships so
 * direct API callers and the bridge work have a registry entry. EXPERIMENTAL
 * per DeepSeek — may change or be withdrawn.
 */

import { createDeepSeekModelConfig } from '../../configurators/DeepSeekConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const deepseekV4FlashVisionExp: ModelConfig = createDeepSeekModelConfig({
  id: 'deepseek-v4-flash-vision-exp',
  displayName: 'DeepSeek V4 Flash Vision (Exp)',
  family: 'deepseek-v4',

  // Same family defaults as deepseek-v4-flash (P4/P6 sweeps) — no vision-specific
  // sweep yet; revisit with the vision-cell arm.
  vision: true,
  anchorProfile: 'bash-edit',
  promptPreset: 'boot-minimal',
  contextWindow: 1000000,
  outputTokens: 65536,
  inputCost: 0.14,
  outputCost: 0.28,
  reasoning: {
    supported: true,
    format: 'reasoning_content',
    extractionMethod: 'separate_field',
    pattern: 'interleaved'
  }
});
