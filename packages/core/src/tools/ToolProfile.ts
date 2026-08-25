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
 *  small-model graduation target and P1 anchoring-A/B arm. */
const BASH_PLUS = new Set(['Bash', 'Read', 'Edit', 'Write', ...ALWAYS_KEEP]);

/** bash-edit: the dsh-Minimal shape — shell + structural editor ONLY (their
 *  bash + str_replace_editor). The deepseek home-door candidate. */
const BASH_EDIT = new Set(['Bash', 'Edit', ...ALWAYS_KEEP]);

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
  if (profile === 'full') return true;
  if (ALWAYS_KEEP.has(name)) return true;
  if (profile === 'bash-only') return BASH_ONLY.has(name);
  if (profile === 'bash-plus') return BASH_PLUS.has(name);
  if (profile === 'bash-edit') return BASH_EDIT.has(name);
  return lookupTier(name) === 'essential';
}
