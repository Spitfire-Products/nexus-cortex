/**
 * R217 HELPER PROVIDER MATCH (2026-10-02, DARK) — CORTEX_HELPER_MATCH_PROVIDER=on.
 *
 * HELPER_MODEL_ID and MENTORSHIP_HELPER_MODEL both default to deepseek-flash (SettingsSchema DEFAULT_SETTINGS + the
 * shipped .env.defaults), so every action model — Claude, GPT, Grok, Gemini — got DeepSeek as its judge / planner /
 * mentor / wall-summarizer / title writer. With the flag on, a role model that was NOT explicitly chosen resolves from
 * the ACTION model's provider through the same provider→cheap-model map selectHelperModel() uses for context
 * rejection / compaction (HELPER_MODEL_REGISTRY: anthropic→claude-haiku-4-5, openai→gpt-4.1-mini, google→
 * gemini-2.5-flash-lite, xai→grok-4.3, deepseek→deepseek-flash, …). A DeepSeek action model keeps deepseek-flash;
 * an unmapped provider keeps the defaulted id.
 *
 * "Explicitly set" is decided BY VALUE: .env.defaults is loaded into process.env as the lowest layer (bootstrapEnv),
 * so presence alone cannot tell a user choice from the shipped default. A role id is DEFAULTED when it is empty or
 * equals a shipped/code default for HELPER_MODEL_ID / MENTORSHIP_HELPER_MODEL (today all 'deepseek-flash'); any
 * other value is explicit and always wins. Consequence: with the flag on, a user who deliberately pins deepseek-flash
 * as the helper for a NON-DeepSeek action model gets the provider match instead — turn the flag off for that.
 *
 * Off (default) = the id passes through unchanged (byte-identical).
 */

export function resolveHelperMatchProviderFlag(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = String(env.CORTEX_HELPER_MATCH_PROVIDER ?? '').trim().toLowerCase();
  return v === 'on' || v === 'true' || v === '1';
}

/** The code-level default for both role keys (SettingsSchema DEFAULT_SETTINGS / mentorRole DEFAULT_MENTOR_MODEL). */
export const ROLE_MODEL_CODE_DEFAULT = 'deepseek-flash';

export interface HelperMatchInputs {
  /** The role model id the call site resolved the old way (per-call override || env || code default). */
  resolvedId: string | undefined;
  /** The ACTION model's provider (undefined = unknown → unchanged). */
  actionProvider: string | undefined;
  /** provider → cheap helper id (HELPER_MODEL_REGISTRY). */
  registry: Readonly<Record<string, string>>;
  /** Shipped defaults of the role keys (from .env.defaults); merged with ROLE_MODEL_CODE_DEFAULT. */
  shippedDefaults?: ReadonlyArray<string | undefined>;
  env?: NodeJS.ProcessEnv;
}

export function isDefaultedRoleModel(id: string | undefined, shippedDefaults: ReadonlyArray<string | undefined> = []): boolean {
  const v = String(id ?? '').trim();
  if (!v) return true;
  if (v === ROLE_MODEL_CODE_DEFAULT) return true;
  return shippedDefaults.some(d => String(d ?? '').trim() !== '' && String(d).trim() === v);
}

/**
 * Flag off → resolvedId unchanged (falls back to the code default only when the caller passed nothing, which every
 * call site already does itself). Flag on + defaulted id + mapped action provider → the provider's helper.
 */
export function matchHelperToActionProvider(inputs: HelperMatchInputs): string {
  const env = inputs.env ?? process.env;
  const id = String(inputs.resolvedId ?? '').trim() || ROLE_MODEL_CODE_DEFAULT;
  if (!resolveHelperMatchProviderFlag(env)) return id;
  if (!isDefaultedRoleModel(id, inputs.shippedDefaults)) return id;
  const provider = String(inputs.actionProvider ?? '').trim().toLowerCase();
  if (!provider) return id;
  return inputs.registry[provider] || id;
}
