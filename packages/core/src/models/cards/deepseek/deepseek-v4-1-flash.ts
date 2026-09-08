/**
 * DeepSeek V4.1 Flash — BETA (deepseek-v4.1-flash-expires-on-0910)
 *
 * A time-boxed beta iteration of the fast V4 flash model. Probe-verified 2026-09-08:
 * the alias RESOLVES (echoes its own id), supports reasoning (reasoning_content +
 * reasoning_tokens via reasoning_effort), accepts `medium` effort (coerced, V4-family
 * behavior), does OpenAI-format function tool-calls, AND is multimodal (identified a
 * solid-blue PNG via image_url content block). So this is effectively deepseek-v4-flash
 * PLUS vision — a superset. Straight model-id swap on the same chat/completions adapter
 * + tool-call parser; vision reuses the image plumbing shipped with the vision-exp card.
 *
 * 🔴 CONSTRAINTS (beta): expires 2026-09-10 (alias name is literal); limited to ~20
 * concurrent requests. Any bench MUST finish before the expiry and keep lanes ≤20.
 * Cost fields mirror deepseek-v4-flash (v4.1 beta pricing UNCONFIRMED) — the bench uses
 * verified provider pricing / token reconciliation, not the card cost, so this is safe.
 */

import { createDeepSeekModelConfig } from '../../configurators/DeepSeekConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const deepseekV41Flash: ModelConfig = createDeepSeekModelConfig({
  id: 'deepseek-v4.1-flash-expires-on-0910',
  displayName: 'DeepSeek V4.1 Flash (beta, exp 0910)',
  family: 'deepseek-v4', // same family = identical parser/transport handling (probe-verified identical API shape)

  vision: true, // probe-verified 2026-09-08 (image_url content block → correct color); reuses the vision-exp image plumbing
  anchorProfile: 'bash-edit',
  promptPreset: 'boot-minimal',
  liftNudge: true,
  headlessDropAskUser: true,
  contextWindow: 1000000,
  outputTokens: 65536,
  inputCost: 0.14,   // UNCONFIRMED — mirrors v4-flash; bench uses verified provider pricing, not this
  outputCost: 0.28,  // UNCONFIRMED — mirrors v4-flash
  reasoning: {
    supported: true,
    toggleable: true,          // effort API-settable (probe 2026-09-08: reasoning_content present @ effort=high)
    format: 'reasoning_content',
    effort: 'medium',          // V4-family default; medium accepted (coerced) — bench arms override per-run
    extractionMethod: 'separate_field',
    pattern: 'interleaved'
  }
});
