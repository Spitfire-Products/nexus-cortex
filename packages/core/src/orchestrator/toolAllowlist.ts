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

/**
 * The BROWSE sub-agent (the Browse tool's delegate; launched with CORTEX_BROWSE_AGENT=true) may not start another sub-agent of any
 * kind (operator 2026-11-03: "only that subagent can't invoke another subagent"). The tools that can spawn one are never offered or
 * discoverable there, and the orchestrator refuses any spawn request inside it whichever tool made it. Other sub-agents are unaffected.
 */
export const SUBAGENT_SPAWNING_TOOLS = ['Browse', 'Task', 'WebSearch'] as const;   // WebSearch: its 'interactive' mode dispatches a browse agent

export const isBrowseAgent = (env: NodeJS.ProcessEnv = process.env): boolean => env.CORTEX_BROWSE_AGENT === 'true';

/**
 * Bounded sub-agent nesting (operator 2026-11-03: "the main concern is just that subagents keep invoking more subagents"). Every
 * sub-agent process carries its depth (CORTEX_AGENT_DEPTH, set by the spawner: main = 0, its sub-agents 1, theirs 2). An agent at
 * CORTEX_MAX_AGENT_DEPTH (default 1: sub-agents never start sub-agents) — or the browse agent at any depth — may not start another: it is
 * not offered a spawning tool and any spawn request it makes is refused. Default 1 matches the 2026-10-19 design (R267): delegates drive
 * tools themselves — e.g. web-researcher drives the nexus-browser MCP directly (its `mcp: nexus-browser`), never through Browse.
 */
export function agentDepth(env: NodeJS.ProcessEnv = process.env): number {
  const n = parseInt(env.CORTEX_AGENT_DEPTH ?? '', 10);
  return Number.isFinite(n) && n >= 0 ? n : env.CORTEX_AGENT_MODE === 'true' ? 1 : 0;
}
export function maxAgentDepth(env: NodeJS.ProcessEnv = process.env): number {
  const n = parseInt(env.CORTEX_MAX_AGENT_DEPTH ?? '', 10);
  return Number.isFinite(n) && n >= 0 ? n : 1;
}
/** The depth to give a child this process spawns. */
export const childAgentDepth = (env: NodeJS.ProcessEnv = process.env): string => String(agentDepth(env) + 1);
/** This agent may not start a sub-agent: it is the browse agent, or it is at the maximum depth. */
export const mayNotSpawn = (env: NodeJS.ProcessEnv = process.env): boolean => isBrowseAgent(env) || agentDepth(env) >= maxAgentDepth(env);

/**
 * The tools an agent may be OFFERED, DISCOVER (SearchTools) or EXECUTE: the definition allowlist (+ the always-kept core tools) and,
 * for an agent that may not spawn (the browse agent, or one at the maximum depth), minus SUBAGENT_SPAWNING_TOOLS. One filter for all three surfaces so they cannot disagree.
 */
export function filterAgentTools<T extends { name: string }>(tools: T[], allow: string[] | undefined, env: NodeJS.ProcessEnv = process.env): T[] {
  const kept = applyAllowlistKeepingCore(tools, allow);
  if (!mayNotSpawn(env)) return kept;
  const excluded = new Set(SUBAGENT_SPAWNING_TOOLS.map(normalizeToolName));
  return kept.filter((t) => !excluded.has(normalizeToolName(t.name)));
}

/** True when a call to `name` must be refused: it names a base tool this agent may not use. Non-base (MCP) tools are never blocked here. */
export function isBlockedBaseToolCall(name: string, baseToolNames: string[], allow: string[] | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  const n = normalizeToolName(name);
  const base = baseToolNames.find((b) => normalizeToolName(b) === n);
  if (!base) return false;
  return filterAgentTools([{ name: base }], allow, env).length === 0;
}
