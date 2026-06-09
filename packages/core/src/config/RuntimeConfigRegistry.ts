/**
 * RuntimeConfigRegistry
 *
 * Single source of truth for which settings can be hot-applied at runtime
 * and the mapping from env var name to orchestrator config update.
 *
 * Three tiers:
 *  - 'config': needs orchestrator.updateRuntimeConfig() — stored in this.config
 *  - 'env': just process.env mutation is enough — read fresh each turn/request
 *  - undefined: restart required — baked into objects at startup
 */

export type ConfigUpdateMapper = (value: string) => Record<string, unknown>;

export interface RuntimeConfigEntry {
  tier: 'config' | 'env';
  mapper?: ConfigUpdateMapper;
}

const CONFIG_ENTRIES: Record<string, RuntimeConfigEntry> = {
  // Config-stored: need updateRuntimeConfig() call
  DEBUG:                   { tier: 'config', mapper: (v) => ({ debug: v === 'true' }) },
  MENTORSHIP_ENABLED:      { tier: 'config', mapper: (v) => ({ reactiveMentorship: { enabled: v === 'true' } }) },
  MAX_TOOL_ITERATIONS:     { tier: 'config', mapper: (v) => ({ loopControl: { maxToolIterations: parseInt(v, 10) } }) },
  MAX_CONSECUTIVE_ERRORS:  { tier: 'config', mapper: (v) => ({ loopControl: { maxConsecutiveErrors: parseInt(v, 10) } }) },
  TOOL_TIMEOUT_MS:         { tier: 'config', mapper: (v) => ({ loopControl: { toolTimeoutMs: parseInt(v, 10) } }) },
  MAX_LOOP_REPETITIONS:    { tier: 'config', mapper: (v) => ({ loopControl: { maxLoopRepetitions: parseInt(v, 10) } }) },
  MODEL_ROUTER_ENABLED:    { tier: 'config', mapper: (v) => ({ modelRouter: { enabled: v === 'true' } }) },
  MODEL_ROUTER_STRATEGY:   { tier: 'config', mapper: (v) => ({ modelRouter: { strategy: v } }) },
  MODEL_ROUTER_RECORD:     { tier: 'config', mapper: (v) => ({ modelRouter: { autoRecord: v === 'true' } }) },

  // Env-read per-turn/request: process.env mutation is sufficient
  ENABLE_SERVER_SIDE_TOOLS:       { tier: 'env' },
  ANTHROPIC_PROMPT_CACHING:       { tier: 'env' },
  TURN_SUMMARY_PREDICTION:        { tier: 'env' },
  CORTEX_ENDTURN_GATE:        { tier: 'env' },
  XAI_API_MODE:                   { tier: 'env' },
  OPENAI_API_MODE:                { tier: 'env' },
  ENABLE_PTC:                     { tier: 'env' },
  ENABLE_LOCAL_CODE_EXECUTION:    { tier: 'env' },
  ENABLE_DEFERRED_TOOL_LOADING:   { tier: 'env' },
  USE_EMOJI:                      { tier: 'env' },
  WEB_TOOLS_MODEL:                { tier: 'env' },
  TOOL_BUDGET_SOFT:               { tier: 'env' },
  AGENT_TMUX_MONITOR:             { tier: 'env' },
  SYSTEM_MESSAGE_DOC_MAX_BYTES:   { tier: 'env' },

  // Training / Decision Store
  CORTEX_RECORD_DECISIONS:        { tier: 'env' },
  CORTEX_LOOKUP_PRIOR_DECISIONS:  { tier: 'env' },
  CORTEX_DECISIONS_MAX_BYTES:     { tier: 'env' },

  // Runtime
  YOLO:                           { tier: 'env' },
  DEBUG_PAYLOAD:                  { tier: 'env' },
  DEBUG_THINKING:                 { tier: 'env' },
  AUTO_RESUME:                    { tier: 'env' },
};

export function getRuntimeConfigEntry(key: string): RuntimeConfigEntry | undefined {
  return CONFIG_ENTRIES[key];
}

export function isLiveToggleable(key: string): boolean {
  return key in CONFIG_ENTRIES;
}

export function getLiveLabel(key: string): '(live)' | '(restart required)' {
  return isLiveToggleable(key) ? '(live)' : '(restart required)';
}
