/**
 * setupPlan — the PURE half of `cortex setup` (2026-10-17, operator: a first-time user needs an initial startup procedure that walks
 * through the providers they intend to use, their keys, then the ACTION model, a cheap HELPER model, the stronger MENTOR model, the
 * vision hand-off and the web-tools provider — "then everything works").
 *
 * The CLI owns the prompting (inquirer); everything that decides what to offer and what to write lives here so every surface
 * (cortex, the TUIs, a future SPA onboarding) asks the same questions and writes the same levers through the canonical settings
 * writer. No I/O, no process.env writes: inputs are the registry's cards and the answers; the output is the env map to persist.
 */
import type { ModelConfig } from '../models/ModelConfig.interface.js';

export interface ProviderChoice {
  /** registry provider id (card.provider), e.g. 'deepseek' */
  provider: string;
  label: string;
  /** the env var that unlocks this provider's cards (card.api.apiKeyEnvVar); '' = keyless cards only */
  keyEnv: string;
  /** cards behind this provider (registered, non-retired) */
  models: ModelCardSummary[];
}

export interface ModelCardSummary {
  id: string;
  provider: string;
  displayName: string;
  keyEnv: string;
  inputCost: number;
  outputCost: number;
  contextWindow: number;
  reasoning: boolean;
  vision: boolean;
}

export const PROVIDER_LABELS: Readonly<Record<string, string>> = {
  deepseek: 'DeepSeek', anthropic: 'Anthropic (Claude)', openai: 'OpenAI', google: 'Google (Gemini)', gemini: 'Google (Gemini)',
  xai: 'xAI (Grok)', cloudflare: 'Cloudflare Workers AI', zhipu: 'Zhipu (GLM)', dashscope: 'Alibaba (Qwen)', qwen: 'Alibaba (Qwen)',
  moonshot: 'Moonshot (Kimi)', minimax: 'MiniMax', inception: 'Inception (Mercury)', mercury: 'Inception (Mercury)', nvidia: 'NVIDIA',
  huggingface: 'Hugging Face', 'hf-space': 'Hugging Face Spaces', local: 'Local (Ollama / llama.cpp)',
};

/** Cards a wizard should not offer: retired aliases, expired betas, transport-variant twins. */
export function isOfferable(card: ModelConfig): boolean {
  const n = (card.displayName || '').toLowerCase();
  if (n.includes('retired') || n.includes('expires') || n.includes('(beta') || n.includes('dark')) return false;
  if (/-(responses|chat)$/.test(card.id) && n.includes('via')) return false;
  return true;
}

export function summarize(card: ModelConfig): ModelCardSummary {
  const c = card as any;
  // The registry's cards are built by the per-provider configurators, so cost/limits live under the
  // SCHEMA paths (`cost.inputPerMillion`, `limits.contextWindow`) — the flat `inputCost`/`contextWindow`
  // forms are the configurator INPUTS, kept as a fallback for hand-built test cards.
  return {
    id: card.id,
    provider: card.provider,
    displayName: card.displayName || card.id,
    keyEnv: c.api?.apiKeyEnvVar ?? '',
    inputCost: Number(c.cost?.inputPerMillion ?? c.inputCost ?? c.pricing?.input ?? 0) || 0,
    outputCost: Number(c.cost?.outputPerMillion ?? c.outputCost ?? c.pricing?.output ?? 0) || 0,
    contextWindow: Number(c.limits?.contextWindow ?? c.contextWindow ?? c.capabilities?.contextWindow ?? 0) || 0,
    reasoning: !!(c.reasoning?.supported ?? c.capabilities?.reasoning),
    vision: !!(c.vision ?? c.capabilities?.vision),
  };
}

/** Providers to offer, from the registry's cards: one row per provider, labelled, with its key env and offerable cards. */
export function providerChoices(cards: ReadonlyArray<ModelConfig>): ProviderChoice[] {
  const by = new Map<string, ProviderChoice>();
  for (const card of cards) {
    if (!isOfferable(card)) continue;
    const s = summarize(card);
    const row = by.get(s.provider) ?? { provider: s.provider, label: PROVIDER_LABELS[s.provider] ?? s.provider, keyEnv: s.keyEnv, models: [] };
    if (!row.keyEnv && s.keyEnv) row.keyEnv = s.keyEnv;
    row.models.push(s);
    by.set(s.provider, row);
  }
  // DeepSeek first (the shipped default provider), then alphabetical
  return [...by.values()].sort((a, b) => (a.provider === 'deepseek' ? -1 : b.provider === 'deepseek' ? 1 : a.label.localeCompare(b.label)));
}

export interface RoleDefaults {
  action: string;
  helper: string;
  mentor: string;
  vision: string | null;
}

/** Suggested models per role for the chosen providers. Action: the shipped default when its provider is chosen, else the provider's
 *  strongest offerable card. Helper: the CHEAPEST card of the action model's provider (one key, thinking-off work). Mentor: the
 *  STRONGEST card of the action provider (a same-strength mentor adds nothing — ledger 2026-09-02); the action model when nothing is
 *  stronger. Vision: the action model if it sees images, else the cheapest vision card among the chosen providers. */
export function suggestRoles(chosen: ReadonlyArray<ProviderChoice>, shippedDefault = 'deepseek-flash'): RoleDefaults | null {
  const all = chosen.flatMap((p) => p.models);
  if (all.length === 0) return null;
  const byCost = (a: ModelCardSummary, b: ModelCardSummary) => a.outputCost - b.outputCost || a.inputCost - b.inputCost;
  const action = all.find((m) => m.id === shippedDefault) ?? [...chosen[0]!.models].sort(byCost).at(-1)!;
  const sameProvider = all.filter((m) => m.provider === action.provider);
  const helper = [...sameProvider].sort(byCost)[0] ?? action;
  const strongest = [...sameProvider].sort(byCost).at(-1) ?? action;
  const mentor = strongest.outputCost > action.outputCost ? strongest : action;
  const visionCards = all.filter((m) => m.vision).sort(byCost);
  const vision = action.vision ? action.id : (visionCards[0]?.id ?? null);
  return { action: action.id, helper: helper.id, mentor: mentor.id, vision };
}

export interface WebChoice {
  value: string;      // WEB_TOOLS_MODEL value ('' = auto-pick / DuckDuckGo fetch-only)
  label: string;
  needsKey: string;   // '' when keyless
}

/** Web-tools backends the chosen keys can power (mirrors the WEB_TOOLS_MODEL ledger + ENABLE_WEBTOOLS auto rule). */
export function webChoices(keyEnvsPresent: ReadonlySet<string>): WebChoice[] {
  const out: WebChoice[] = [];
  if (keyEnvsPresent.has('GEMINI_API_KEY') || keyEnvsPresent.has('GOOGLE_API_KEY')) out.push({ value: 'gemini-2.5-flash', label: 'Google search grounding via Gemini (gemini-2.5-flash): search + fetch with citations', needsKey: 'GEMINI_API_KEY' });
  if (keyEnvsPresent.has('ANTHROPIC_API_KEY')) out.push({ value: 'claude-haiku-4-5', label: 'Anthropic web_search server tool (claude-haiku-4-5): inline source citations', needsKey: 'ANTHROPIC_API_KEY' });
  if (keyEnvsPresent.has('XAI_API_KEY')) out.push({ value: 'grok-4-fast-non-reasoning', label: 'xAI Responses web_search (grok-4-fast-non-reasoning): URL citations', needsKey: 'XAI_API_KEY' });
  if (keyEnvsPresent.has('DEEPSEEK_API_KEY')) out.push({ value: 'deepseek-flash', label: 'DeepSeek Search/Fetch API (deepseek-flash): engine summaries + page Markdown, $0.75 per 1,000 calls', needsKey: 'DEEPSEEK_API_KEY' });
  out.push({ value: '', label: out.length ? 'Auto-pick from my keys (Gemini > DeepSeek > Anthropic > xAI > OpenAI)' : 'No search key: WebFetch only (page reads via the helper model); search and browse stay off', needsKey: '' });
  return out;
}

export interface SetupAnswers {
  keys: Record<string, string>;          // env var → value (only the ones entered/kept)
  action: string;
  helper: string;
  mentor: string;
  vision: string | null;
  webToolsModel: string;                 // '' = auto
}

/** The env map `cortex setup` persists to ~/.cortex/.env (keys first, then the role levers). Only levers that differ from the
 *  shipped default are worth a line, but a first-time user wants to SEE their choices, so every chosen role is written explicitly. */
export function planToEnv(a: SetupAnswers): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(a.keys)) if (v && v.trim()) env[k] = v.trim();
  env.DEFAULT_MODEL_ID = a.action;
  env.HELPER_MODEL_ID = a.helper;
  env.MENTORSHIP_HELPER_MODEL = a.mentor;
  if (a.vision) env.VISION_HELPER_MODEL = a.vision;
  env.WEB_TOOLS_MODEL = a.webToolsModel;
  env.ENABLE_WEBTOOLS = 'auto';
  return env;
}

export interface SetupInputs {
  /** provider ids (or their key env var, e.g. 'deepseek' or 'DEEPSEEK_API_KEY') */
  providers?: string[];
  /** env var → value, as entered on the command line (never read back from disk) */
  keys?: Record<string, string>;
  action?: string;
  helper?: string;
  mentor?: string;
  /** undefined = suggest; 'none' = no vision hand-off */
  vision?: string | null;
  /** undefined = suggest from the keys present; 'auto' / 'off' = WEB_TOOLS_MODEL '' */
  webToolsModel?: string | null;
}

export interface ResolvedSetup {
  answers: SetupAnswers;
  providers: ProviderChoice[];
}

/**
 * The NON-INTERACTIVE half of the wizard (scripts, containers, `cortex setup --provider … --key …`).
 *
 * Same decisions as the prompts, from flags + the keys already present: the chosen providers come from
 * `inputs.providers`, else from whichever providers the resolvable keys unlock; every role the caller did
 * not name falls back to `suggestRoles`, so `cortex setup --key DEEPSEEK_API_KEY=sk-… --yes` is a complete
 * first run. Returns null when there is nothing to configure (no provider chosen and no key anywhere) —
 * the caller then prints the manual recipe instead of writing a half-configured file.
 */
export function resolveSetupAnswers(
  cards: ReadonlyArray<ModelConfig>,
  inputs: SetupInputs,
  presentKeys: ReadonlySet<string>,
  shippedDefault = 'deepseek-flash',
): ResolvedSetup | null {
  const all = providerChoices(cards);
  const norm = (s: string) => s.trim().toLowerCase();
  const keySet = new Set(presentKeys);
  for (const [k, v] of Object.entries(inputs.keys ?? {})) if (v && v.trim()) keySet.add(k);

  let chosen: ProviderChoice[];
  if (inputs.providers?.length) {
    chosen = inputs.providers
      .map((t) => all.find((p) => norm(p.provider) === norm(t) || (!!p.keyEnv && norm(p.keyEnv) === norm(t))))
      .filter((p): p is ProviderChoice => !!p);
  } else {
    // No explicit provider: infer from the keys that resolve (a DeepSeek key means DeepSeek), else keyless cards.
    chosen = all.filter((p) => !!p.keyEnv && keySet.has(p.keyEnv));
    if (chosen.length === 0) chosen = all.filter((p) => !p.keyEnv);
  }
  if (chosen.length === 0) return null;

  const defaults = suggestRoles(chosen, shippedDefault);
  if (!defaults) return null;
  const known = new Set(all.flatMap((p) => p.models.map((m) => m.id)));
  // An explicit role is honored when the card exists (even on a provider the user did not select — a role
  // pinned to another provider still works); otherwise the suggestion stands.
  const role = (explicit: string | undefined, fallback: string) => (explicit && known.has(explicit) ? explicit : fallback);
  const action = role(inputs.action, defaults.action);
  const helper = role(inputs.helper, defaults.helper);
  const mentor = role(inputs.mentor, defaults.mentor);
  const wantVision = inputs.vision === undefined ? undefined : inputs.vision;
  const vision = wantVision === undefined
    ? defaults.vision
    : wantVision === null || /^(none|off|no)$/i.test(wantVision)
      ? null
      : role(wantVision, defaults.vision ?? action);
  const wantWeb = inputs.webToolsModel === undefined ? undefined : inputs.webToolsModel;
  const web = wantWeb === undefined
    ? (webChoices(keySet)[0]?.value ?? '')
    : wantWeb === null || /^(auto|off|none|false)$/i.test(wantWeb) ? '' : wantWeb;

  const keys: Record<string, string> = {};
  for (const [k, v] of Object.entries(inputs.keys ?? {})) if (v && v.trim()) keys[k] = v.trim();
  return { answers: { keys, action, helper, mentor, vision, webToolsModel: web }, providers: chosen };
}

/** Human summary lines for the confirm step and the final "what you have" print. */
export function summaryLines(a: SetupAnswers, byId: (id: string) => ModelCardSummary | undefined): string[] {
  const name = (id: string | null) => { if (!id) return '(none)'; const c = byId(id); return c ? `${c.displayName} (${id})` : id; };
  const web = a.webToolsModel ? `WEB_TOOLS_MODEL=${a.webToolsModel}` : 'auto-pick from keys (fetch-only when no search key)';
  return [
    `Keys:          ${Object.keys(a.keys).filter((k) => a.keys[k]?.trim()).join(', ') || '(none)'}`,
    `Action model:  ${name(a.action)}`,
    `Helper model:  ${name(a.helper)}   (compaction, summaries, turn prediction — thinking off)`,
    `Mentor model:  ${name(a.mentor)}   (lift plan, EndTurn judge, exit planners — thinking on)`,
    `Vision helper: ${name(a.vision)}`,
    `Web tools:     ${web}`,
  ];
}
