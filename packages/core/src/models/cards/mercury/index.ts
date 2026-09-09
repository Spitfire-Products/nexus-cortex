/**
 * Mercury (Inception Labs) Model Cards
 * Auto-exported for easy discovery.
 *
 * Diffusion LLMs over an OpenAI-compatible Chat Completions API.
 * Verified against https://api.inceptionlabs.ai/v1/models (2026-06-07):
 * the direct API serves only `mercury-2`. Coder variants are OpenRouter-only.
 */

export { mercury2 } from './mercury-2.js';
// mercury-2.5 — probe-verified 2026-09-08 (/v1/models + tool-call round-trip), registered.
// 260K ctx, 65536 out, tools + json_mode + structured_outputs; reasons internally (billed
// reasoning_tokens, not surfaced → needs generous max_tokens). See mercury-2-5.ts header.
export { mercury25 } from './mercury-2-5.js';
