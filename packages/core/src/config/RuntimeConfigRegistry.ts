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
  CANON_AUTO_SYNC:                { tier: 'env' },
  CANON_AUTO_SYNC_DEBOUNCE_MS:    { tier: 'env' },
  CANON_STORE:                    { tier: 'env' },
  CANON_REPO:                     { tier: 'env' },
  CORTEX_ENDTURN_GATE:        { tier: 'env' },
  CORTEX_TOOL_PROFILE:        { tier: 'env' },
  XAI_API_MODE:                   { tier: 'env' },
  OPENAI_API_MODE:                { tier: 'env' },
  ENABLE_PTC:                     { tier: 'env' },
  ENABLE_LOCAL_CODE_EXECUTION:    { tier: 'env' },
  ENABLE_DEFERRED_TOOL_LOADING:   { tier: 'env' },
  ENABLE_WEBTOOLS:                { tier: 'env' },
  VISION_HELPER_MODEL:            { tier: 'env' },
  TOOL_TIMEOUT_MODE:              { tier: 'env' },
  VISION_HANDOFF_MAX:             { tier: 'env' },
  CORTEX_SLICE_NUDGE:             { tier: 'env' },
  CORTEX_MENTOR_REASONING:        { tier: 'env' },
  CORTEX_MENTOR_EFFORT:           { tier: 'env' },
  CORTEX_ASK_FOR_ADVICE:          { tier: 'env' },
  CORTEX_MENTOR_CONSULT_REASONING: { tier: 'env' },
  CORTEX_MENTOR_TEMPERATURE:      { tier: 'env' },
  CORTEX_MENTOR_REASONING_ALLOWANCE: { tier: 'env' },
  CORTEX_MENTOR_THINKING_TIMEOUT_MS: { tier: 'env' },
  CORTEX_LIFT_PLAN_REASONING: { tier: 'env' },
  CORTEX_LIFT_PLAN_DOCTRINE: { tier: 'env' },
  CORTEX_LIFT_PLAN_TOOL_ROUNDS: { tier: 'env' },
  CORTEX_LIFT_PLAN_TOOL_ROUND_BUDGET_MS: { tier: 'env' },
  CORTEX_ENDTURN_TIER: { tier: 'env' },
  CORTEX_COMPACTION_RESUME: { tier: 'env' },
  CORTEX_COMPACTION_CHECKPOINT_PCT: { tier: 'env' },
  CORTEX_COMPACTION_THRESHOLD_TOKENS: { tier: 'env' },
  CORTEX_COMPACTION_HANDOFF_QA: { tier: 'env' },
  CORTEX_COMPACTION_HANDOFF_QA_MAX_QUESTIONS: { tier: 'env' },
  CORTEX_STATE_DIR: { tier: 'env' },
  CORTEX_COMPACTION_CHECKPOINT_STEP: { tier: 'env' },
  CORTEX_DELEGATION_HINT: { tier: 'env' },
  CORTEX_TURN_CONTRACT: { tier: 'env' },
  CORTEX_SUBAGENT_TIMEOUT_MS: { tier: 'env' },
  CORTEX_SUBAGENT_TIMEOUT_MAX_MS: { tier: 'env' },
  CORTEX_OUTER_TOOL_TIMEOUT_MS: { tier: 'env' },
  CORTEX_API_NETWORK_RETRY_MS: { tier: 'env' },
  CORTEX_BUDGET_VISIBILITY: { tier: 'env' },
  CORTEX_BUDGET_CONTINUE_MIN_REMAINING: { tier: 'env' },
  CORTEX_REASONING_EXHAUST_BACKOFF: { tier: 'env' },
  CORTEX_REASONING_EXHAUST_BACKOFF_TURNS: { tier: 'env' },
  CORTEX_BUDGET_CONTINUE_MAX_NUDGES: { tier: 'env' },
  CORTEX_BASH_OOM_PRIORITY: { tier: 'env' },
  CORTEX_MENTOR_CONSULT_BUDGET_TOKENS: { tier: 'env' },
  CORTEX_ENDTURN_RESOLVER_MAX_REJECTS_BUDGETED: { tier: 'env' },
  CORTEX_JUDGE_SEMANTIC: { tier: 'env' },
  CORTEX_JUDGE_VETO: { tier: 'env' },
  CORTEX_FINISH_CONFIRM: { tier: 'env' },
  CORTEX_FINISH_CONFIRM_MIN_REMAINING: { tier: 'env' },
  CORTEX_FINISH_CONFIRM_MAX: { tier: 'env' },
  CORTEX_MEETS_CONFIRM: { tier: 'env' },
  CORTEX_MEETS_CONFIRM_MIN_REMAINING: { tier: 'env' },
  CORTEX_JUDGE_TOOL_ROUNDS: { tier: 'env' },
  CORTEX_JUDGE_TOOL_ROUND_BUDGET_MS: { tier: 'env' },
  CORTEX_JUDGE_TOOL_AUTOLOOP: { tier: 'env' },
  CORTEX_JUDGE_GAP_HOLD: { tier: 'env' },
  CORTEX_JUDGE_GAP_HOLD_JEV: { tier: 'env' },
  CORTEX_JUDGE_GAP_HOLD_JEV_MIN: { tier: 'env' },
  CORTEX_JUDGE_SPEC_TESTS: { tier: 'env' },
  CORTEX_JUDGE_SPEC_TESTS_MAX: { tier: 'env' },
  CORTEX_JUDGE_VETO_MIN_REMAINING: { tier: 'env' },
  CORTEX_JUDGE_GAP_HOLD_MIN_INTERVAL_MS: { tier: 'env' },
  CORTEX_JUDGE_GAP_HOLD_PLAN_MAX_SIMILARITY: { tier: 'env' },
  CORTEX_JUDGE_SPEC_REPEAT_MAX: { tier: 'env' },
  CORTEX_JUDGE_SPEC_TESTS_AT: { tier: 'env' },
  CORTEX_JUDGE_REQ_LEDGER: { tier: 'env' },
  CORTEX_JUDGE_REQ_LEDGER_MAX: { tier: 'env' },
  CORTEX_JUDGE_REQ_LEDGER_HOLD_MAX: { tier: 'env' },
  CORTEX_JUDGE_REQ_LEDGER_JEV: { tier: 'env' },
  CORTEX_JUDGE_REQ_LEDGER_JEV_MIN: { tier: 'env' },
  CORTEX_JUDGE_INDEPENDENT_DERIVATION: { tier: 'env' },
  CORTEX_JUDGE_INDEPENDENT_DERIVATION_TOL: { tier: 'env' },
  CORTEX_FRAME: { tier: 'env' }, // R179
  CORTEX_FRAME_CHOOSER: { tier: 'env' },
  CORTEX_FRAME_CANDIDATES: { tier: 'env' },
  CORTEX_FRAME_WAIT_CAP_S: { tier: 'env' },
  CORTEX_FRAME_SCREEN_LINES: { tier: 'env' },
  CORTEX_FRAME_KEY_GUARD: { tier: 'env' },
  CORTEX_FRAME_MIN_CANDIDATES: { tier: 'env' },
  CORTEX_FRAME_AUTHOR: { tier: 'env' },
  CORTEX_FRAME_AUTHOR_MODEL: { tier: 'env' },
  CORTEX_FRAME_AUTHOR_WHEN: { tier: 'env' },
  CORTEX_FRAME_CONTRACT_EXTRA: { tier: 'env' },
  CORTEX_TURN_CONTRACT_ENFORCE: { tier: 'env' },
  CORTEX_TURN_CONTRACT_ENFORCE_MAX: { tier: 'env' },
  CORTEX_ACTION_PLAN_FIELDS: { tier: 'env' },
  CORTEX_JUDGE_EVIDENCE_MAX_VETOES: { tier: 'env' },
  CORTEX_JUDGE_PROGRESS_MIN_CALLS: { tier: 'env' },
  CORTEX_JUDGE_ESCALATE_REASONING: { tier: 'env' },
  CORTEX_HERDR_REPORTING: { tier: 'env' },
  CORTEX_HERDR_AGENT_NAME: { tier: 'env' },
  CORTEX_TERMINAL_BACKEND: { tier: 'env' },
  CORTEX_TMUX_AUTO_INSTALL: { tier: 'env' },
  CORTEX_TMUX_STATIC_URL: { tier: 'env' },
  CORTEX_TMUX_HISTORY_LIMIT: { tier: 'env' },
  CORTEX_TMUX_PANE_SIZE: { tier: 'env' },
  CORTEX_SUBAGENT_RUNTIME: { tier: 'env' },
  CORTEX_HERDR_KEEP_DELEGATE_PANES: { tier: 'env' },
  CORTEX_ENDTURN_RESOLVER_REASONING: { tier: 'env' },
  CORTEX_DEADLINE_EXIT_MENTOR_REASONING: { tier: 'env' },
  CORTEX_LOOP_TOOL_BLOCK_REASONING: { tier: 'env' },
  CORTEX_SLICE_BLOCK:             { tier: 'env' },
  CORTEX_SLICE_BLOCK_AT:          { tier: 'env' },
  CORTEX_SLICE_BLOCK_MAX:         { tier: 'env' },
  USE_EMOJI:                      { tier: 'env' },
  WEB_TOOLS_MODEL:                { tier: 'env' },
  TOOL_BUDGET_SOFT:               { tier: 'env' },
  CORTEX_DELIVER_SYSTEM_PROMPT:   { tier: 'env' },
  AGENT_TMUX_MONITOR:             { tier: 'env' },
  SYSTEM_MESSAGE_DOC_MAX_BYTES:   { tier: 'env' },
  MEMORY_ARCHIVE_MAX_BYTES:       { tier: 'env' },

  // Training / Decision Store
  CORTEX_RECORD_DECISIONS:        { tier: 'env' },
  CORTEX_LOOKUP_PRIOR_DECISIONS:  { tier: 'env' },
  CORTEX_DECISIONS_MAX_BYTES:     { tier: 'env' },

  // Runtime
  YOLO:                           { tier: 'env' },
  DEBUG_PAYLOAD:                  { tier: 'env' },
  DEBUG_THINKING:                 { tier: 'env' },
  THINKING_AS_TEXT_FALLBACK:      { tier: 'env' },
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
