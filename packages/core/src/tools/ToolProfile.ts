/**
 * ToolProfile — env-selected tool-surface restriction for the tool-profile
 * experiment (CORTEX_TOOL_PROFILE=full|lean|bash-only).
 *
 * HYPOTHESIS under test: tool-surface size × model capability interact —
 * frontier models gain from a lean/bash-only surface (schema tax; the
 * mini-SWE-agent precedent), small models lose (schemas scaffold the action
 * space). Profiles make the surface an experiment arm; the decision stores
 * stamp the active profile so per-profile tool-selection distributions and
 * success rates fall out of existing capture (no new instrumentation).
 *
 * Applied at the ONE choke point every model-facing path funnels through —
 * ToolFactory.getAllTools() — so turn assembly, SearchTools discovery, the
 * deferred-tool announcement, {{toolCount}}/{{toolNames}} template vars, the
 * server /tools route, and essential/standard tiering all see the same
 * reduced surface. Executor dispatch is gated separately in the orchestrator
 * (a hallucinated call to a hidden tool must NOT execute, or the A/B leaks).
 *
 * Resolved FRESH per call (env tier — hot-toggleable via RuntimeConfigRegistry).
 * Unknown values resolve to 'full' (fail-open: never brick the tool surface).
 */

export type ToolProfileName = 'full' | 'lean' | 'bash-only' | 'bash-plus' | 'bash-edit';

/** Tools always retained regardless of profile: EndTurn stays subordinate to
 *  its OWN gate (CORTEX_ENDTURN_GATE) — the profile must not silently disable
 *  that feature — and AskUserQuestion keeps the interactive approval path
 *  alive under bash-only. */
const ALWAYS_KEEP = new Set(['EndTurn', 'AskUserQuestion']);

/** bash-only: the mini-SWE-agent arm — one general-purpose action. */
const BASH_ONLY = new Set(['Bash', ...ALWAYS_KEEP]);

/** bash-plus: the minimal-harness arm (BASH_PLUS_SPEC.md, R61) — the Pi/dsh
 *  surface class: shell + structural file ops, nothing else. The shell-native
 *  small-model graduation target and P1 anchoring-A/B arm.
 *  ReadImage rides the practical doors (item 7): the orchestrator's VISION
 *  GATE strips it for non-vision cards BEFORE profile filtering, so set
 *  membership changes nothing for existing text-only frames — a vision card
 *  under a narrow door gets door+ReadImage (the vision-arm shape). */
const BASH_PLUS = new Set(['Bash', 'Read', 'Edit', 'Write', 'ReadImage', ...ALWAYS_KEEP]);

/** bash-edit: the dsh-Minimal shape — shell + structural editor ONLY (their
 *  bash + str_replace_editor). The deepseek home-door candidate. */
const BASH_EDIT = new Set(['Bash', 'Edit', 'ReadImage', ...ALWAYS_KEEP]);

/** ENABLE_WEBTOOLS — the web surface: builtin WebSearch / WebFetch / Browse, the nexus-browser
 *  MCP tools, and the provider-native hosted search tools (web_search / x_search).
 *  Modes (shipped default = auto):
 *    auto  — WebFetch stays ON (functional keyless via the helper-summarizer ladder); WebSearch,
 *            Browse, MCP browser tools and hosted search turn ON only when a search-capable
 *            credential is present (Gemini grounding / XAI / OpenAI keys). Keyless installs — the
 *            wall-page + hallucination-pressure population (keyless A/B 2026-08-31) — get search
 *            off with zero configuration; keyed installs get everything with zero configuration.
 *    true  — everything on.   false — everything off.
 *  Applied at this choke point (every tool surface), at the orchestrator assembly seam (MCP tools
 *  join past the factory), at the hosted-search injection, and refused at dispatch — so a disabled
 *  web tool is neither discoverable nor executable. 🔴 BENCH ARMS MUST PIN true/false EXPLICITLY:
 *  keyed bench containers carry job tokens for every provider, so auto resolves ON there.
 *  Resolved fresh per call (hot-toggleable). */
const WEB_TOOLS = new Set([
  'WebSearch', 'WebFetch', 'Browse',
  // provider-native server-side search (XAI/OpenAI hosted tools, injected by the orchestrator)
  'web_search', 'web_search_preview', 'x_search',
]);
const WEB_MCP_PREFIX = 'nexus-browser__';
/** Credentials that make a real search backend usable (Gemini grounding, XAI/OpenAI hosted search). */
export const WEB_SEARCH_CREDENTIAL_ENVS = ['GOOGLE_API_KEY', 'GEMINI_API_KEY', 'XAI_API_KEY', 'OPENAI_API_KEY'] as const;
export type WebToolsMode = 'auto' | 'true' | 'false';
export function isWebTool(name: string): boolean {
  return WEB_TOOLS.has(name) || name.startsWith(WEB_MCP_PREFIX);
}
export function resolveWebToolsMode(env: NodeJS.ProcessEnv = process.env): WebToolsMode {
  const v = (env.ENABLE_WEBTOOLS ?? '').trim().toLowerCase();
  if (v === 'false' || v === '0' || v === 'no' || v === 'off') return 'false';
  if (v === 'true' || v === '1' || v === 'yes' || v === 'on') return 'true';
  return 'auto';
}
export function hasWebSearchCredential(env: NodeJS.ProcessEnv = process.env): boolean {
  return WEB_SEARCH_CREDENTIAL_ENVS.some((k) => !!(env[k] ?? '').trim());
}
/** Is THIS web tool enabled under the active mode? Non-web tools are always true. */
export function isWebToolEnabled(name: string, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!isWebTool(name)) return true;
  const mode = resolveWebToolsMode(env);
  if (mode === 'true') return true;
  if (mode === 'false') return false;
  if (name === 'WebFetch') return true; // auto: fetch is useful keyless (helper-summarizer ladder)
  return hasWebSearchCredential(env);   // auto: search/browse/hosted search need a real backend
}
/** Dispatch/assembly face: true when the tool is a web tool that the active mode disables. */
export function webToolBlocked(name: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return isWebTool(name) && !isWebToolEnabled(name, env);
}
/** @deprecated mode-level view kept for callers that only need "is anything blocked"; prefer webToolBlocked. */
export function resolveWebToolsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return resolveWebToolsMode(env) !== 'false';
}

export function resolveToolProfile(env: NodeJS.ProcessEnv = process.env): ToolProfileName {
  const raw = (env.CORTEX_TOOL_PROFILE ?? 'full').trim().toLowerCase();
  if (raw === 'lean' || raw === 'bash-only' || raw === 'bash-plus' || raw === 'bash-edit') return raw;
  return 'full';
}

/**
 * CORTEX_TOOL_ANCHOR — first-turn policy anchoring (BASH_PLUS_SPEC.md P0).
 * When set to a narrow profile, the FIRST model request of a session presents
 * only that profile's tool schemas; after the first executed tool call the
 * session's own profile applies (injection at the first tool_result boundary
 * — the dsh anchored-standard point). 'full' or unknown → no anchor.
 */
export function resolveToolAnchor(
  env: NodeJS.ProcessEnv = process.env,
  cardAnchor?: string | null,
): ToolProfileName | null {
  const valid = (v: string) =>
    v === 'lean' || v === 'bash-only' || v === 'bash-plus' || v === 'bash-edit';
  const raw = (env.CORTEX_TOOL_ANCHOR ?? '').trim().toLowerCase();
  if (valid(raw)) return raw as ToolProfileName;
  if (raw === 'full' || raw === 'none' || raw === 'off') return null; // explicit env off overrides card
  const card = (cardAnchor ?? '').trim().toLowerCase();
  if (valid(card)) return card as ToolProfileName;
  return null;
}

/**
 * CORTEX_TOOL_ANCHOR_PERSIST — frame selection for an armed anchor (backlog
 * item 5). 'lifted' (default): the anchor lifts at the first tool_result
 * boundary and the session's full profile applies. 'persist': the anchored
 * surface stays the ONLY surface for the whole session (the TB2 persist
 * frame, previously an installed-copy patch). Precedence: env override >
 * card frameProfile > 'lifted'. Irrelevant when no anchor is armed.
 */
export function resolveFrameProfile(
  env: NodeJS.ProcessEnv = process.env,
  cardFrame?: string | null,
): 'lifted' | 'persist' {
  const raw = (env.CORTEX_TOOL_ANCHOR_PERSIST ?? '').trim().toLowerCase();
  if (raw === 'true' || raw === '1' || raw === 'persist') return 'persist';
  if (raw === 'false' || raw === '0' || raw === 'off' || raw === 'lifted') return 'lifted';
  const card = (cardFrame ?? '').trim().toLowerCase();
  if (card === 'persist') return 'persist';
  return 'lifted';
}

/** A′ deferred-refinement levers — per-model config. Precedence: **card > env baseline > default**.
 *  The model CARD is the per-model truth and wins (a model that differs sets its own value, provider-
 *  agnostic — see ModelConfig, not just DeepSeek). The `.env` is a GLOBAL baseline applied to every
 *  model WITHOUT a card opinion (so any provider/model can be enabled/disabled fleet-wide from env).
 *  A model with no card value follows the env baseline; neither set → the built-in default. */
function boolEnv(raw: string): boolean | null {
  const v = raw.trim().toLowerCase();
  if (v === 'true' || v === '1' || v === 'yes' || v === 'on') return true;
  if (v === 'false' || v === '0' || v === 'no' || v === 'off') return false;
  return null;
}
/** CORTEX_LIFT_NUDGE — lift-boundary SearchTools/AskForAdvice signpost. card > env > false. */
export function resolveLiftNudge(
  env: NodeJS.ProcessEnv = process.env,
  cardLiftNudge?: boolean | null,
): boolean {
  if (typeof cardLiftNudge === 'boolean') return cardLiftNudge; // per-model card wins
  const e = boolEnv(env.CORTEX_LIFT_NUDGE ?? '');
  return e === null ? false : e; // global env baseline, else default
}
/** CORTEX_HEADLESS_DROP_ASKUSER — drop AskUserQuestion in non-interactive sessions. card > env > false. */
export function resolveHeadlessDropAskUser(
  env: NodeJS.ProcessEnv = process.env,
  cardDrop?: boolean | null,
): boolean {
  if (typeof cardDrop === 'boolean') return cardDrop; // per-model card wins
  const e = boolEnv(env.CORTEX_HEADLESS_DROP_ASKUSER ?? '');
  return e === null ? false : e; // global env baseline, else default
}
/** ENABLE_DEFERRED_TOOL_LOADING per-model override. card > env > settings default. WIRED: the
 *  orchestrator resolves this ONCE per turn into `effectiveDeferredLoading`, read by all 11 per-request
 *  deferred gates together (no split-brain). Default = deferred ON (deferred-OFF regresses genuine
 *  controls, TB2 A′ matrix 2026-08-29); the pro card ships an OFF toggle commented out as a caveat. */
export function resolveDeferredLoading(
  env: NodeJS.ProcessEnv = process.env,
  cardDeferred?: boolean | null,
  settingsDefault = true,
): boolean {
  if (typeof cardDeferred === 'boolean') return cardDeferred; // per-model card wins
  const e = boolEnv(env.ENABLE_DEFERRED_TOOL_LOADING ?? '');
  return e === null ? settingsDefault : e; // global env baseline, else settings default
}

/** Do MCP / management / context tools ride along? Narrow arms suppress them
 *  (surface leak otherwise); full and lean keep them. */
export function isNarrowProfile(profile: ToolProfileName = resolveToolProfile()): boolean {
  return profile === 'bash-only' || profile === 'bash-plus' || profile === 'bash-edit';
}

/**
 * Filter a tool list to the active profile.
 *  - full: unchanged.
 *  - lean: discoveryTier === 'essential' (mirrors the registry's own tiering —
 *    zero separate list to maintain) + ALWAYS_KEEP.
 *  - bash-only: Bash + ALWAYS_KEEP.
 * Tools without a discoveryTier (MCP/context/server-injected) are treated as
 * non-essential under lean/bash-only.
 */
export function applyToolProfile<T extends { name: string; discoveryTier?: string }>(
  tools: T[],
  profile: ToolProfileName = resolveToolProfile(),
): T[] {
  tools = tools.filter((t) => !webToolBlocked(t.name)); // ENABLE_WEBTOOLS (auto/true/false)
  if (profile === 'full') return tools;
  if (profile === 'bash-only') return tools.filter((t) => BASH_ONLY.has(t.name));
  if (profile === 'bash-plus') return tools.filter((t) => BASH_PLUS.has(t.name));
  if (profile === 'bash-edit') return tools.filter((t) => BASH_EDIT.has(t.name));
  return tools.filter((t) => t.discoveryTier === 'essential' || ALWAYS_KEEP.has(t.name));
}

/** Is this tool callable under the active profile? (Dispatch-guard face —
 *  unknown names pass through; the normal unknown-tool path handles them.) */
export function isToolAllowedByProfile(
  name: string,
  lookupTier: (name: string) => string | undefined,
  profile: ToolProfileName = resolveToolProfile(),
): boolean {
  if (webToolBlocked(name)) return false; // ENABLE_WEBTOOLS: refused everywhere
  if (profile === 'full') return true;
  if (ALWAYS_KEEP.has(name)) return true;
  if (profile === 'bash-only') return BASH_ONLY.has(name);
  if (profile === 'bash-plus') return BASH_PLUS.has(name);
  if (profile === 'bash-edit') return BASH_EDIT.has(name);
  return lookupTier(name) === 'essential';
}
