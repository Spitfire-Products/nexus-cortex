/**
 * Base-tool allowlist for delegated sub-agents (OrchestratorConfig.allowedBaseTools). R266: the control
 * tools the turn loop itself depends on — SearchTools (discovery) and EndTurn (the gate) — always survive
 * an agent definition's whitelist; before, the browse delegate's [Read, Grep, Glob, Todo*] list stripped
 * SearchTools and the model was told to "call SearchTools first" with no such tool in the array.
 */
export const ALLOWLIST_CORE_TOOLS = ['SearchTools', 'EndTurn'] as const;

export function normalizeToolName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, ''); // parity with the former orchestrator normalizer (WebSearch ≡ web_search)
}

export function applyAllowlistKeepingCore<T extends { name: string }>(tools: T[], allow: string[] | undefined): T[] {
  if (!allow || allow.length === 0) return tools;
  const allowed = new Set([...allow, ...ALLOWLIST_CORE_TOOLS].map(normalizeToolName));
  return tools.filter((t) => allowed.has(normalizeToolName(t.name)));
}

/**
 * R267: tools the parent grants per Task call (`Task.tools`) on top of the definition's allowlist. 'all' stays 'all';
 * otherwise the union, definition order first, de-duplicated by normalized name.
 */
export function mergeExtraTools(defTools: string[] | 'all', extra: unknown): string[] | 'all' {
  if (defTools === 'all') return 'all';
  const add = Array.isArray(extra) ? extra.filter((t): t is string => typeof t === 'string' && t.trim().length > 0).map((t) => t.trim()) : [];
  const seen = new Set(defTools.map(normalizeToolName));
  const out = [...defTools];
  for (const t of add) { const n = normalizeToolName(t); if (!seen.has(n)) { seen.add(n); out.push(t); } }
  return out;
}
