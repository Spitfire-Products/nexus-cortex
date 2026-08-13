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

export type ToolProfileName = 'full' | 'lean' | 'bash-only';

/** Tools always retained regardless of profile: EndTurn stays subordinate to
 *  its OWN gate (CORTEX_ENDTURN_GATE) — the profile must not silently disable
 *  that feature — and AskUserQuestion keeps the interactive approval path
 *  alive under bash-only. */
const ALWAYS_KEEP = new Set(['EndTurn', 'AskUserQuestion']);

/** bash-only: the mini-SWE-agent arm — one general-purpose action. */
const BASH_ONLY = new Set(['Bash', ...ALWAYS_KEEP]);

export function resolveToolProfile(env: NodeJS.ProcessEnv = process.env): ToolProfileName {
  const raw = (env.CORTEX_TOOL_PROFILE ?? 'full').trim().toLowerCase();
  if (raw === 'lean' || raw === 'bash-only') return raw;
  return 'full';
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
  return lookupTier(name) === 'essential';
}
