/**
 * xAI chat/completions transport helpers (2026-10-03; stack-portability map
 * .cortex/research/stack-portability-2026-10-02.md §"xAI CHAT/COMPLETIONS THEORY TEST").
 *
 * The third xAI transport, ADDITIVE beside /v1/messages (the interleaved-thinking path — untouched) and /v1/responses.
 * Selected per card (`apiMode: 'chat'`, e.g. grok-4.3-chat / grok-build-0.1-chat) or globally for un-pinned xAI cards via
 * XAI_API_MODE=chat. Reachable ONLY when an xAI card resolves to pattern 'chat/completions' — nothing on the shipped default
 * path does, so every helper here is dark by construction.
 *
 * Pure helpers — no client state.
 */
import type { ModelConfig } from '../models/ModelConfig.interface.js';

/** True when this request rides api.x.ai /v1/chat/completions. */
export function isXAIChatRoute(modelConfig: Pick<ModelConfig, 'provider' | 'api'>): boolean {
  return modelConfig.api?.pattern === 'chat/completions' && String(modelConfig.provider ?? '').toLowerCase() === 'xai';
}

/** xAI reasoning_effort values (docs: model-capabilities/text/reasoning). `xhigh` = grok-4.6+; older models treat it as high. */
const XAI_EFFORT_LEVELS = new Set(['low', 'medium', 'high', 'xhigh']);

/**
 * `reasoning_effort` for an xAI chat/completions request, or undefined (send nothing → provider default, 'high').
 *
 * Per-card capability: a card that declares no default effort (`reasoning.defaultEffort` / `reasoning.effort` — the
 * XAIConfigurator `reasoningEffort` option) NEVER gets the field. grok-build-0.1 400s on it ("does not support parameter
 * reasoningEffort", live 2026-10-02) and its cards deliberately omit `reasoningEffort`.
 *
 * Precedence: explicit request / action effort (CORTEX_ACTION_EFFORT, effort pulse) > card default. Mapping: the harness's
 * `max` (the DeepSeek ladder top) → `high` (xAI has no `max`; `xhigh` is not accepted on every grok — pass it explicitly to
 * use it); `none` / unknown → the card default (xAI reasoning cannot be disabled).
 */
export function xaiChatReasoningEffort(requested: unknown, modelConfig: Pick<ModelConfig, 'reasoning'>): string | undefined {
  const r = modelConfig.reasoning as { supported?: boolean; effort?: string; defaultEffort?: string } | undefined;
  if (!r?.supported) return undefined;
  const cardDefault = r.effort ?? r.defaultEffort;
  if (!cardDefault) return undefined; // capability gate — no declared effort, no field
  const norm = (v: unknown): string | undefined => {
    const e = String(v ?? '').trim().toLowerCase();
    if (e === 'max') return 'high';
    return XAI_EFFORT_LEVELS.has(e) ? e : undefined;
  };
  return norm(requested) ?? norm(cardDefault);
}
