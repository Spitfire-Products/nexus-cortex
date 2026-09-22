/**
 * Settings Schema
 *
 * Defines all configurable settings for Nexus Cortex
 * Maps to .env file variables and OrchestratorConfig
 */

/**
 * Environment Variables Schema
 */
export interface EnvironmentVariables {
  // ============================================
  // API KEYS
  // ============================================

  /** Anthropic API Key for Claude models */
  ANTHROPIC_API_KEY?: string;

  /** OpenAI API Key for GPT models */
  OPENAI_API_KEY?: string;

  /** Google API Key for Gemini models */
  GOOGLE_API_KEY?: string;

  /** Gemini API Key (preferred for Gemini models, falls back to GOOGLE_API_KEY) */
  GEMINI_API_KEY?: string;

  /** X.AI API Key for Grok models */
  XAI_API_KEY?: string;

  /** DeepSeek API Key for DeepSeek models */
  DEEPSEEK_API_KEY?: string;

  /** Inception Labs API Key for Mercury diffusion models */
  INCEPTION_API_KEY?: string;

  /** Alibaba Cloud DashScope API Key for Qwen models */
  DASHSCOPE_API_KEY?: string;

  /** Zhipu AI API Key for GLM models */
  ZHIPU_API_KEY?: string;

  /** Moonshot API Key for Kimi models */
  MOONSHOT_API_KEY?: string;

  /** MiniMax API Key for MiniMax models */
  MINIMAX_API_KEY?: string;

  /** Cloudflare API Token for Workers AI models (@cf/* models) */
  CLOUDFLARE_API_TOKEN?: string;

  /** Cloudflare Account ID — required alongside CLOUDFLARE_API_TOKEN. Endpoint format: api.cloudflare.com/client/v4/accounts/{ID}/ai/v1/... */
  CLOUDFLARE_ACCOUNT_ID?: string;

  // ============================================
  // ANTHROPIC AUTHENTICATION
  // ============================================

  /** Anthropic authentication method: 'oauth' | 'api-key' | 'auto' */
  ANTHROPIC_AUTH_METHOD?: string;

  /** Claude.ai OAuth token override (alternative to ~/.claude/.credentials.json) */
  CLAUDE_CODE_OAUTH_TOKEN?: string;

  // ============================================
  // MODEL CONFIGURATION
  // ============================================

  /** Default model ID to use for new sessions */
  DEFAULT_MODEL_ID?: string;

  /** Helper model ID for context management and mentorship */
  HELPER_MODEL_ID?: string;

  // ============================================
  // SYSTEM SETTINGS
  // ============================================

  /** Enable debug logging */
  DEBUG?: string; // 'true' | 'false'

  /** Project root path */
  PROJECT_PATH?: string;

  /** Use emojis in CLI output */
  USE_EMOJI?: string; // 'true' | 'false'

  // ============================================
  // REACTIVE MENTORSHIP
  // ============================================

  /** Enable reactive mentorship system */
  MENTORSHIP_ENABLED?: string; // 'true' | 'false'

  /** Trigger mentorship on tool errors */
  MENTORSHIP_TRIGGER_ON_ERROR?: string; // 'true' | 'false'

  /** Error severity threshold for triggering mentorship */
  MENTORSHIP_ERROR_THRESHOLD?: string; // 'low' | 'medium' | 'high'

  /** Enable keyword triggers (@ultrathink, @analyze, etc.) */
  MENTORSHIP_KEYWORDS_ENABLED?: string; // 'true' | 'false'

  /** Custom keywords for mentorship (comma-separated) */
  MENTORSHIP_CUSTOM_KEYWORDS?: string;

  /** Helper model for mentorship (overrides HELPER_MODEL_ID if set) */
  MENTORSHIP_HELPER_MODEL?: string;
  CORTEX_MENTOR_REASONING?: string; // 'on' | 'none'
  CORTEX_MENTOR_EFFORT?: string; // '' | 'low' | 'medium' | 'high' | 'max'
  CORTEX_ASK_FOR_ADVICE?: string; // 'true' | 'false'
  CORTEX_MENTOR_CONSULT_REASONING?: string; // 'on' | 'none'
  CORTEX_MENTOR_TEMPERATURE?: string; // number as string, optional
  CORTEX_MENTOR_REASONING_ALLOWANCE?: string; // integer tokens, optional (overrides the per-effort table)
  CORTEX_MENTOR_THINKING_TIMEOUT_MS?: string; // integer ms, optional (thinking-on mentor surface timeout; overrides the per-effort table)
  CORTEX_LIFT_PLAN_REASONING?: string; // 'on' | 'none' — per-surface, wins over CORTEX_MENTOR_REASONING
  CORTEX_LIFT_PLAN_DOCTRINE?: string; // 'v1' | 'v2' — planner doctrine
  CORTEX_LIFT_PLAN_TOOL_ROUNDS?: string; // max planner calls at the lift; >1 lets the planner INVESTIGATE (harness runs its read-only CHECK/READ lines between rounds) — R171 HB-LIFT-PLAN-TOOL-LOOP (default 1 = single-shot)
  CORTEX_LIFT_PLAN_TOOL_ROUND_BUDGET_MS?: string; // aggregate wall clock for the planner's investigation rounds (default 240000; 10000..1800000) — R171 bullets (4.107.2 lever)
  CORTEX_ENDTURN_TIER?: string; // 'standard' | 'essential' — EndTurn discovery tier (4.107.2 lever)
  CORTEX_DELEGATION_HINT?: string; // 'true' | 'false' — DARK: boot-minimal clause naming the Task tool for delegation (4.108.1)
  CORTEX_TURN_CONTRACT?: string; // '' (shipped door) | 'channel' — boot prompt drops 'prefer acting over deliberating' and asks for ANALYSIS + PLAN + action every turn; length recovery re-issues at the same effort (HB-TURN-CONTRACT)
  CORTEX_SUBAGENT_TIMEOUT_MS?: string; // Task sub-agent wall-clock limit (ms) when no parent turn deadline is set (R133; default 300000)
  CORTEX_SUBAGENT_TIMEOUT_MAX_MS?: string; // upper cap (ms) on the deadline-derived Task sub-agent limit (R133; empty = no cap)
  CORTEX_OUTER_TOOL_TIMEOUT_MS?: string; // floor (ms) for the outer per-batch tool abort: deadline = max(computed, floor + grace); empty = no floor
  CORTEX_API_NETWORK_RETRY_MS?: string; // wall-clock budget (ms) for network-class API fault retries (R150; default 600000; 0 = attempt-capped legacy)
  CORTEX_BUDGET_VISIBILITY?: string; // 'false' silences the per-10%-band WALL BUDGET line and the continue-with-budget nudge (R151; default on when a turn deadline exists)
  CORTEX_BUDGET_CONTINUE_MIN_REMAINING?: string; // fraction of the wall budget that must remain for the open-items continue nudge (R151; default 0.5; 0 = off)
  CORTEX_REASONING_EXHAUST_BACKOFF?: string; // 'false' disables the effort backoff after a truncated reasoning-only turn (R153; default on)
  CORTEX_REASONING_EXHAUST_BACKOFF_TURNS?: string; // continuations run at the lowered effort after a reasoning-exhaustion turn (R153; default 2; 1..10)
  CORTEX_BUDGET_CONTINUE_MAX_NUDGES?: string; // continue-with-budget nudges allowed per turn (R157; default 2; 0 = off; max 10)
  CORTEX_BASH_OOM_PRIORITY?: string; // 'false' stops the Bash child shell from raising its own oom_score_adj to 1000 (R156; default on, linux only)
  CORTEX_MENTOR_CONSULT_BUDGET_TOKENS?: string; // output cap (tokens) for an AskForAdvice mentor hint (default 800; was 400; 100..4000)
  CORTEX_ENDTURN_RESOLVER_MAX_REJECTS_BUDGETED?: string; // resolver GAP vetoes allowed while >= the budget-continue fraction of the wall budget remains (R160; default 6; 0 = liveness cap only)
  CORTEX_JUDGE_SEMANTIC?: string; // 'false' restores the 4.111 judge gating (task-shape regex gate, regex nudges, fixed veto count) — A/B control (R165; default on)
  CORTEX_JUDGE_VETO?: string; // 'evidence' (default: only a failed harness-run judge-named check holds a finish) | 'opinion' (R165) | 'never' (record only) — R166
  CORTEX_FINISH_CONFIRM?: string; // default on: an accept-with-gap finish with budget left is held ONCE with an informed confirmation (budget, reviewer gaps, own open items) — R167 HB-FINISH-CONFIRM
  CORTEX_FINISH_CONFIRM_MIN_REMAINING?: string; // fraction of the wall budget that must remain to confirm (default 0.3) — R167
  CORTEX_FINISH_CONFIRM_MAX?: string; // confirmations per session (default 1, 0..5) — R167
  CORTEX_MEETS_CONFIRM?: string; // default on: a MEETS verdict must name a proving CHECK that passes; an unverified MEETS with budget left is held once (shares CORTEX_FINISH_CONFIRM_MAX) — R168 HB-MEETS-CONFIRM
  CORTEX_TURN_CONTRACT_ENFORCE?: string; // 'true': a tool-calling response whose text lacks ANALYSIS + PLAN is rejected unexecuted with a re-prompt, up to CORTEX_TURN_CONTRACT_ENFORCE_MAX times per turn (HB-TURN-CONTRACT-ENFORCE; default off)
  CORTEX_ACTION_PLAN_FIELDS?: string; // 'true': Bash/Edit/Write calls must carry required `analysis` + `plan` fields (the per-step plan inside the action's own JSON; invalid calls are returned unexecuted, no cap) — R172 HB-ACTION-PLAN-FIELDS (default off)
  CORTEX_TURN_CONTRACT_ENFORCE_MAX?: string; // format rejections per turn before the batch executes as-is (default 2, 0..10)
  CORTEX_JUDGE_TOOL_ROUNDS?: string; // max judge calls per finish adjudication; >1 lets the judge INVESTIGATE (harness runs its read-only CHECK/READ lines between rounds) — R170 HB-JUDGE-TOOL-LOOP (default 1 = single-shot)
  CORTEX_JUDGE_TOOL_ROUND_BUDGET_MS?: string; // aggregate wall clock for the investigation rounds of one adjudication (default 240000; 10000..1800000) — R170
  CORTEX_JUDGE_TOOL_AUTOLOOP?: string; // 'true': a first-round MEETS/GAP that names CHECK lines is re-asked once with the harness-run results (needs CORTEX_JUDGE_TOOL_ROUNDS >= 2) — R170b (default off)
  CORTEX_JUDGE_GAP_HOLD?: string; // 'true': an evidence-mode GAP that names open items is returned to the junior while >= CORTEX_BUDGET_CONTINUE_MIN_REMAINING of the budget remains and the budgeted cap allows — R173 HB-GAP-HOLD (default off)
  CORTEX_JUDGE_GAP_HOLD_JEV?: string; // off|shadow|gate: Jev fixable_with_more_turns over the hold — shadow banks the probability, gate holds only at >= CORTEX_JUDGE_GAP_HOLD_JEV_MIN (needs TYPESAFE_API_KEY) — R173b (default off)
  CORTEX_JUDGE_GAP_HOLD_JEV_MIN?: string; // probability floor for the Jev gate (default 0.3) — R173b
  CORTEX_JUDGE_SPEC_TESTS?: string; // 'true': blind spec-derived CHECK lines authored from the task text alone at the first finish, run at every adjudication; a FAILED one is veto evidence — R174 HB-SPEC-TESTS (default off)
  CORTEX_JUDGE_SPEC_TESTS_MAX?: string; // max spec checks per turn (default 4; 1..8) — R174
  CORTEX_JUDGE_VETO_MIN_REMAINING?: string; // Budget floor: below this fraction of the wall budget no veto or hold of any kind holds the finish (R173c; 0 = off) (default 0)
  CORTEX_JUDGE_GAP_HOLD_MIN_INTERVAL_MS?: string; // A re-hold needs this much elapsed time since the last hold OR a changed open-items list (R173c) (default 180000)
  CORTEX_JUDGE_GAP_HOLD_PLAN_MAX_SIMILARITY?: string; // Token-Jaccard threshold below which the judge plan counts as changed for a re-hold (R173c) (default 0.6)
  CORTEX_JUDGE_SPEC_REPEAT_MAX?: string; // Consecutive identical spec-check failures before the check is suspect, not veto evidence (R174b) (default 2)
  CORTEX_JUDGE_SPEC_TESTS_AT?: string; // When the blind spec checks are authored: finish (first adjudication) | lift (background at task lift) (R174b) (default finish)
  CORTEX_JUDGE_INDEPENDENT_DERIVATION?: string; // On a value-shaped task, recompute the result by a different method before a standing finish; disagreement holds once (R176 HB-INDEPENDENT-DERIVATION): off | on (default off)
  CORTEX_JUDGE_INDEPENDENT_DERIVATION_TOL?: string; // Relative tolerance for numeric agreement in the independent derivation (R176) (default 0.001)
  CORTEX_FRAME?: string; // tools (default) | terminus: one tmux pane as the only action surface (FrameAction + EndTurn), screen + state card + menu each turn (R179)
  CORTEX_FRAME_CHOOSER?: string; // off (default) | jev: a typed reader picks among the writer's candidates + templates; fail-open to the first candidate (R179/R178)
  CORTEX_FRAME_CANDIDATES?: string; // max candidate actions per FrameAction, 1..3 (default 1) (R179)
  CORTEX_FRAME_WAIT_CAP_S?: string; // cap on waiting for one action's command, seconds (default 300) (R179)
  CORTEX_FRAME_SCREEN_LINES?: string; // pane lines captured per observation (default 45) (R179)
  CORTEX_FRAME_KEY_GUARD?: string; // on|off — refuse pane-killing/destructive keystrokes in the terminal frame (default on) (R182)
  CORTEX_FRAME_MIN_CANDIDATES?: string; // 1..3 distinct writer candidates the menu step needs (unset = 2 with the chooser on) (R184)
  CORTEX_FRAME_AUTHOR?: string; // off|helper — helper model authors alternatives for the chooser menu (unset = helper with the chooser on) (R185)
  CORTEX_FRAME_CONTRACT_EXTRA?: string; // text appended to the turn-0 frame contract (cell-specific guidance without a release) (R179)
  CORTEX_MEETS_CONFIRM_MIN_REMAINING?: string; // fraction of the wall budget that must remain to hold an unverified MEETS (default 0.5) — R168
  CORTEX_JUDGE_EVIDENCE_MAX_VETOES?: string; // max evidence-backed vetoes per session (default 1) — R166
  CORTEX_JUDGE_PROGRESS_MIN_CALLS?: string; // tool calls since the last veto that count as working the plan (R165; default 3; 1..50)
  CORTEX_JUDGE_ESCALATE_REASONING?: string; // 'false' skips the one thinking-on re-judge before accepting a finish with a recorded gap (R165; default on)
  CORTEX_HERDR_REPORTING?: string; // 'false' disables herdr lifecycle reporting inside a herdr pane (R145; default on when HERDR_ENV=1)
  CORTEX_HERDR_AGENT_NAME?: string; // agent label reported to herdr (R145; default cortex)
  CORTEX_TERMINAL_BACKEND?: string; // auto | herdr | tmux | detached — persistent-session backend under Bash/TmuxSession/CreateArtifact (R146; auto = herdr > tmux > detached)
  CORTEX_TMUX_AUTO_INSTALL?: string; // 'false' disables the R138 tmux self-install on the first persistent request (default on: apt-get/apk/dnf/yum/brew, then CORTEX_TMUX_STATIC_URL, then R134 degrade)
  CORTEX_TMUX_STATIC_URL?: string; // URL of a prebuilt tmux binary dropped into ~/.local/bin/tmux by the R138 self-install when package managers fail (unset = skipped)
  CORTEX_TMUX_HISTORY_LIMIT?: string; // scrollback lines per harness-created tmux pane (R141; default 50000)
  CORTEX_TMUX_PANE_SIZE?: string; // fixed geometry WxH for harness-created tmux sessions (R141; default 160x40)
  CORTEX_SUBAGENT_RUNTIME?: string; // auto | process | herdr — where Task sub-agents run (R147; auto = herdr pane when HERDR_ENV=1 + backend resolves + parent auto-approves, else forked IPC child)
  CORTEX_HERDR_KEEP_DELEGATE_PANES?: string; // '0'/'false' closes a herdr delegate pane when it finishes (R147; default keep for operator inspection)
  CORTEX_COMPACTION_THRESHOLD_TOKENS?: string; // test/ops override of the compaction threshold in tokens (4.108.3); empty = card-derived
  CORTEX_COMPACTION_HANDOFF_QA?: string; // 'true' | 'false' — Terminus-style gap-question round appended to the resume memory as a GAPS (Q/A) section (R143; default false)
  CORTEX_COMPACTION_HANDOFF_QA_MAX_QUESTIONS?: string; // cap on gap questions per handoff QA round (R143; default 6, 1-20)
  CORTEX_STATE_DIR?: string; // explicit runtime-state root (4.108.6); empty = <project>/.cortex with writable-probe fallback
  CORTEX_COMPACTION_CHECKPOINT_PCT?: string; // fraction of the compaction threshold at which the first pre-compaction checkpoint is written (4.108.2; default 0.75)
  CORTEX_COMPACTION_CHECKPOINT_STEP?: string; // checkpoint refresh band width as a fraction of the threshold (4.108.2; default 0.10)
  CORTEX_COMPACTION_RESUME?: string; // 'true' | 'false' — resume memory + task pin injected after proactive compaction (4.108.0)
  CORTEX_ENDTURN_RESOLVER_REASONING?: string; // 'on' | 'none' — per-surface, wins over CORTEX_MENTOR_REASONING
  CORTEX_DEADLINE_EXIT_MENTOR_REASONING?: string; // 'on' | 'none' — per-surface, wins over CORTEX_MENTOR_REASONING
  CORTEX_LOOP_TOOL_BLOCK_REASONING?: string; // 'on' | 'none' — per-surface, wins over CORTEX_MENTOR_REASONING

  /** Enable turn-based periodic mentorship review */
  MENTORSHIP_TURN_BASED_ENABLED?: string; // 'true' | 'false'

  /** Number of turns between periodic mentorship reviews */
  MENTORSHIP_TURN_INTERVAL?: string; // number as string

  /** Enable interleaved thinking assistance for non-reasoning models */
  MENTORSHIP_INTERLEAVED_THINKING?: string; // 'true' | 'false'

  /** Enable pattern detection for repeated failures */
  MENTORSHIP_PATTERN_DETECTION?: string; // 'true' | 'false'

  /** Number of similar errors to trigger pattern detection */
  MENTORSHIP_PATTERN_THRESHOLD?: string; // number as string

  /** Enable Active Discovery guidance to encourage thorough file reading */
  MENTORSHIP_ACTIVE_DISCOVERY?: string; // 'true' | 'false'

  // ============================================
  // TURN SUMMARY & PREDICTION
  // ============================================

  /** Enable post-turn summary and next-action prediction via helper model */
  TURN_SUMMARY_PREDICTION?: string; // 'true' | 'false'

  // ============================================
  // CANON (reactive session capture)
  // ============================================

  /** Auto-sync sessions to the canon store after each turn (debounced; opt-in — pushes to a git remote) */
  CANON_AUTO_SYNC?: string; // 'true' | 'false'

  /** Debounce window (ms) before a reactive canon sync fires after the last turn */
  CANON_AUTO_SYNC_DEBOUNCE_MS?: string;

  /** Canon store working clone path (empty = /tmp/canon-store) */
  CANON_STORE?: string;

  /** Canon store git remote URL (empty = the canonical nexus-canon-store repo) */
  CANON_REPO?: string;

  // ============================================
  // CONTEXT MANAGEMENT
  // ============================================

  /** Render prior thinking as <prior_reasoning> text on chat/completions (recall for resumed sessions) */
  THINKING_AS_TEXT_FALLBACK?: string; // 'true' | 'false'

  /** Enable Anthropic prompt caching (default: true) */
  ANTHROPIC_PROMPT_CACHING?: string; // 'true' | 'false'

  // ============================================
  // SESSION CONFIGURATION
  // ============================================

  /** Session storage directory */
  SESSION_STORAGE_DIR?: string;

  /** Enable MCP auto-injection */
  MCP_AUTO_INJECT?: string; // 'true' | 'false'

  /** Auto-research subagent feature. off = disabled (PM never told about it; main context
   *  stays clean). native = the PM delegates to autoresearch-agent subagents that run
   *  experiments with the INTERNAL tools. mcp = the subagents route experiment-running to
   *  a configured external auto-research MCP server instead. */
  AUTORESEARCH_AGENTS?: string; // 'off' | 'native' | 'mcp'

  /** Per-doc byte cap for injected project docs (CLAUDE.md, MEMORY.md, etc.). 0/unset = unlimited. */
  SYSTEM_MESSAGE_DOC_MAX_BYTES?: string; // integer as string

  /** Archive-prune cap for MEMORY.md: over-cap overflow MOVES to MEMORY.archive.md
   *  (never dropped), bounding both injection and file growth. 0/unset = off. */
  MEMORY_ARCHIVE_MAX_BYTES?: string; // integer as string

  // ============================================
  // LOOP CONTROL (Inline Detection)
  // ============================================

  /** Maximum tool execution iterations per turn */
  MAX_TOOL_ITERATIONS?: string; // number as string

  /** Maximum consecutive tool errors before stopping */
  MAX_CONSECUTIVE_ERRORS?: string; // number as string

  /** Soft tool-call budget per turn */
  TOOL_BUDGET_SOFT?: string; // number as string

  /** Tool execution timeout in milliseconds */
  TOOL_TIMEOUT_MS?: string; // number as string

  /** Maximum identical tool call repetitions before detecting loop */
  MAX_LOOP_REPETITIONS?: string; // number as string

  // ============================================
  // SERVER-SIDE TOOLS
  // ============================================

  /** Model that backs WebSearch and WebFetch */
  WEB_TOOLS_MODEL?: string;

  /** Enable XAI server-side agentic tools (web_search, x_search, code_execution) */
  ENABLE_SERVER_SIDE_TOOLS?: string; // 'true' | 'false'

  /** XAI API mode: 'messages' (supports thinking) or 'responses' (supports server-side tools + stateful) */
  XAI_API_MODE?: string; // 'messages' | 'responses'

  /** OpenAI API mode */
  OPENAI_API_MODE?: string; // 'chat/completions' | 'responses'

  // ============================================
  // PROGRAMMATIC TOOL CALLING (PTC)
  // ============================================

  /** Enable Anthropic Programmatic Tool Calling (server-side code execution sandbox) */
  ENABLE_PTC?: string; // 'true' | 'false'

  /** Web surface mode: auto (fetch on; search/browse on iff a search key is present) | true | false */
  ENABLE_WEBTOOLS?: string; // 'auto' | 'true' | 'false'

  /** Vision hand-off helper card for text-only primaries (ReadImage → helper → text); 'false' disables */
  VISION_HELPER_MODEL?: string;

  /** Tool timeout policy: kill (legacy) | background (promote at deadline) | auto (background when headless) */
  TOOL_TIMEOUT_MODE?: string;

  /** Per-turn cap on ReadImage→vision-helper hand-offs (0 = unlimited) */
  VISION_HANDOFF_MAX?: string;

  /** Slice-reader nudge: after 3 sed/head/tail slices of one file, remind to Read it once ('true'|'false') */
  CORTEX_SLICE_NUDGE?: string;
  CORTEX_SLICE_BLOCK?: string;
  CORTEX_SLICE_BLOCK_AT?: string;
  CORTEX_SLICE_BLOCK_MAX?: string;

  /** Enable local code execution for non-PTC models (node -e with tool globals) */
  ENABLE_LOCAL_CODE_EXECUTION?: string; // 'true' | 'false'

  /** Enable deferred tool loading (essential tools always loaded, others discovered on-demand) */
  ENABLE_DEFERRED_TOOL_LOADING?: string; // 'true' | 'false'

  // ============================================
  // MODEL ROUTER
  // ============================================

  /** Enable model router — auto-select model based on task type and benchmark history */
  MODEL_ROUTER_ENABLED?: string; // 'true' | 'false'

  /** Model router strategy */
  MODEL_ROUTER_STRATEGY?: string; // 'auto' | 'matrix-only'

  /** Auto-record benchmark metrics after each turn */
  MODEL_ROUTER_RECORD?: string; // 'true' | 'false'

  /** Min task-classification confidence (0-1) before model='auto' will route */
  ROUTER_MIN_CONFIDENCE?: string; // float 0..1

  /** Min real benchmark samples before model='auto' trusts a task type's recommendation */
  ROUTER_MIN_SAMPLES?: string; // positive int

  /** Opt-in: use Thompson-sampling (explore/exploit) instead of greedy trust-gated routing for model='auto' */
  MODEL_ROUTER_EXPLORATION?: string; // 'true' | 'false'

  /** Comma-separated model IDs the router must NEVER auto-select (cost/policy bans) */
  MODEL_ROUTER_EXCLUDE?: string; // csv of model ids

  // ============================================
  // AGENT TEAM WORKSPACE
  // ============================================

  /** Enable tmux visual monitoring for parallel agent teams */
  AGENT_TMUX_MONITOR?: string; // 'true' | 'false'

  // ============================================
  // ENDTURN GATE / TRAINING SUBSTRATE
  // ============================================

  /** Mandatory EndTurn pre-delivery self-audit + Stage 2/3 verifiers */
  CORTEX_ENDTURN_GATE?: string; // 'true' | 'false'
  CORTEX_TOOL_PROFILE?: string; // 'full' | 'lean' | 'bash-only' — tool-surface experiment arm

  // ============================================
  // DECISION STORE
  // ============================================

  /** Append each tool decision to .cortex/decisions.jsonl */
  CORTEX_RECORD_DECISIONS?: string; // 'true' | 'false'

  /** Inject prior decisions as a system-reminder before tool use */
  CORTEX_LOOKUP_PRIOR_DECISIONS?: string; // 'true' | 'false'

  /** Decision file self-rotates at this byte cap (default 2 MB) */
  CORTEX_DECISIONS_MAX_BYTES?: string; // number as string

  // ============================================
  // RUNTIME FLAGS
  // ============================================

  /** Orchestrator lifecycle mode */
  CORTEX_MODE?: string; // 'persistent' | 'stateless' | 'server'

  /** Self-update behaviour when a newer release exists */
  CORTEX_UPDATE_POLICY?: string; // 'auto' | 'off' | 'warn' | 'error' | 'force'

  /** Auto-approve ALL tool executions (bypasses permissions) */
  YOLO?: string; // 'true' | 'false'

  /** Auto-resume last session on startup */
  AUTO_RESUME?: string; // 'true' | 'false'

  /** HTTP server port */
  PORT?: string; // number as string

  /** Server URL for HTTP client mode (e.g. http://localhost:4000) */
  CORTEX_SERVER_URL?: string;

  /** Show raw API request/response payloads */
  DEBUG_PAYLOAD?: string; // 'true' | 'false'

  /** Show thinking/reasoning block content in CLI output */
  DEBUG_THINKING?: string; // 'true' | 'false'

  /** Enable real API smoke tests */
  ENABLE_SMOKE_TESTS?: string; // 'true' | 'false'

  /** Nvidia API Key */
  NVIDIA_API_KEY?: string;

  // ============================================
  // GIT / PR ACCESS CONTROL
  // ============================================

  /**
   * Comma-separated allow-list of repositories the git/PR tools may operate on.
   * Supports exact `owner/repo`, `owner/*` wildcards, and `*` (all). Unset → all
   * repos allowed, with a one-time startup warning. Input format validation
   * (which blocks shell/argument injection) is always enforced regardless.
   */
  GIT_ALLOWED_REPOS?: string;

  /**
   * Comma-separated allow-list of git/PR actions:
   * review,list,create,post-review,clone,worktree,diff,cleanup,status.
   * Unset or `*` → all actions allowed.
   */
  GIT_ALLOWED_ACTIONS?: string;

  /**
   * Auth token for gh/git operations. Injected into the subprocess environment
   * as GH_TOKEN/GITHUB_TOKEN only — never placed on argv or in a clone URL.
   */
  GIT_AUTH_TOKEN?: string;

  /** GitHub (Enterprise) host for git/PR tools. Default: github.com */
  GIT_HOST?: string;

  /**
   * HMAC secret for the /v1/pr/webhook endpoint (GitHub X-Hub-Signature-256).
   * Unset → the webhook is disabled (returns 401) rather than open.
   */
  GITHUB_WEBHOOK_SECRET?: string;
}

/**
 * Configuration Defaults
 */
export const DEFAULT_SETTINGS: Required<Omit<EnvironmentVariables,
  'ANTHROPIC_API_KEY' | 'OPENAI_API_KEY' | 'GOOGLE_API_KEY' | 'GEMINI_API_KEY' | 'XAI_API_KEY' | 'DEEPSEEK_API_KEY' | 'INCEPTION_API_KEY' | 'DASHSCOPE_API_KEY' | 'ZHIPU_API_KEY' | 'MOONSHOT_API_KEY' | 'MINIMAX_API_KEY' | 'CLOUDFLARE_API_TOKEN' | 'CLOUDFLARE_ACCOUNT_ID' | 'CLAUDE_CODE_OAUTH_TOKEN' | 'NVIDIA_API_KEY' | 'GIT_AUTH_TOKEN' | 'GITHUB_WEBHOOK_SECRET'
>> = {
  // Anthropic Authentication
  ANTHROPIC_AUTH_METHOD: 'auto',

  // Prompt Caching
  ANTHROPIC_PROMPT_CACHING: 'true',

  // Model Configuration
  DEFAULT_MODEL_ID: 'deepseek-flash',
  HELPER_MODEL_ID: 'deepseek-flash',

  // System Settings
  DEBUG: 'false',
  PROJECT_PATH: process.cwd(),
  USE_EMOJI: 'false',

  // Reactive Mentorship
  MENTORSHIP_ENABLED: 'true',
  MENTORSHIP_TRIGGER_ON_ERROR: 'false',
  MENTORSHIP_ERROR_THRESHOLD: 'medium',
  MENTORSHIP_KEYWORDS_ENABLED: 'false',
  MENTORSHIP_CUSTOM_KEYWORDS: '',
  MENTORSHIP_HELPER_MODEL: 'deepseek-flash',
  CORTEX_MENTOR_REASONING: 'on',
  CORTEX_MENTOR_EFFORT: '',
  CORTEX_ASK_FOR_ADVICE: 'true',
  CORTEX_MENTOR_CONSULT_REASONING: 'none',
  CORTEX_MENTOR_TEMPERATURE: '',
  CORTEX_MENTOR_REASONING_ALLOWANCE: '',
  CORTEX_MENTOR_THINKING_TIMEOUT_MS: '',
  CORTEX_LIFT_PLAN_REASONING: '',
  CORTEX_LIFT_PLAN_DOCTRINE: '',
  CORTEX_LIFT_PLAN_TOOL_ROUNDS: '',
  CORTEX_LIFT_PLAN_TOOL_ROUND_BUDGET_MS: '',
  CORTEX_ENDTURN_TIER: '',
  CORTEX_COMPACTION_RESUME: '',
  CORTEX_COMPACTION_CHECKPOINT_PCT: '',
  CORTEX_COMPACTION_THRESHOLD_TOKENS: '',
  CORTEX_COMPACTION_HANDOFF_QA: '',
  CORTEX_COMPACTION_HANDOFF_QA_MAX_QUESTIONS: '',
  CORTEX_STATE_DIR: '',
  CORTEX_COMPACTION_CHECKPOINT_STEP: '',
  CORTEX_DELEGATION_HINT: '',
  CORTEX_TURN_CONTRACT: '',
  CORTEX_SUBAGENT_TIMEOUT_MS: '',
  CORTEX_SUBAGENT_TIMEOUT_MAX_MS: '',
  CORTEX_OUTER_TOOL_TIMEOUT_MS: '',
  CORTEX_API_NETWORK_RETRY_MS: '',
  CORTEX_BUDGET_VISIBILITY: '',
  CORTEX_BUDGET_CONTINUE_MIN_REMAINING: '',
  CORTEX_REASONING_EXHAUST_BACKOFF: '',
  CORTEX_REASONING_EXHAUST_BACKOFF_TURNS: '',
  CORTEX_BUDGET_CONTINUE_MAX_NUDGES: '',
  CORTEX_BASH_OOM_PRIORITY: '',
  CORTEX_MENTOR_CONSULT_BUDGET_TOKENS: '',
  CORTEX_ENDTURN_RESOLVER_MAX_REJECTS_BUDGETED: '',
  CORTEX_JUDGE_SEMANTIC: '',
  CORTEX_JUDGE_VETO: '',
  CORTEX_FINISH_CONFIRM: '',
  CORTEX_FINISH_CONFIRM_MIN_REMAINING: '',
  CORTEX_FINISH_CONFIRM_MAX: '',
  CORTEX_MEETS_CONFIRM: '',
  CORTEX_MEETS_CONFIRM_MIN_REMAINING: '',
  CORTEX_JUDGE_TOOL_ROUNDS: '',
  CORTEX_JUDGE_TOOL_ROUND_BUDGET_MS: '',
  CORTEX_JUDGE_TOOL_AUTOLOOP: '',
  CORTEX_JUDGE_GAP_HOLD: '',
  CORTEX_JUDGE_GAP_HOLD_JEV: '',
  CORTEX_JUDGE_GAP_HOLD_JEV_MIN: '',
  CORTEX_JUDGE_SPEC_TESTS: '',
  CORTEX_JUDGE_SPEC_TESTS_MAX: '',
  CORTEX_JUDGE_VETO_MIN_REMAINING: '',
  CORTEX_JUDGE_GAP_HOLD_MIN_INTERVAL_MS: '',
  CORTEX_JUDGE_GAP_HOLD_PLAN_MAX_SIMILARITY: '',
  CORTEX_JUDGE_SPEC_REPEAT_MAX: '',
  CORTEX_JUDGE_SPEC_TESTS_AT: '',
  CORTEX_JUDGE_INDEPENDENT_DERIVATION: '',
  CORTEX_JUDGE_INDEPENDENT_DERIVATION_TOL: '',
  CORTEX_FRAME: '',
  CORTEX_FRAME_CHOOSER: '',
  CORTEX_FRAME_CANDIDATES: '',
  CORTEX_FRAME_WAIT_CAP_S: '',
  CORTEX_FRAME_SCREEN_LINES: '',
  CORTEX_FRAME_KEY_GUARD: '',
  CORTEX_FRAME_MIN_CANDIDATES: '',
  CORTEX_FRAME_AUTHOR: '',
  CORTEX_FRAME_CONTRACT_EXTRA: '',
  CORTEX_TURN_CONTRACT_ENFORCE: '',
  CORTEX_TURN_CONTRACT_ENFORCE_MAX: '',
  CORTEX_ACTION_PLAN_FIELDS: '',
  CORTEX_JUDGE_EVIDENCE_MAX_VETOES: '',
  CORTEX_JUDGE_PROGRESS_MIN_CALLS: '',
  CORTEX_JUDGE_ESCALATE_REASONING: '',
  CORTEX_HERDR_REPORTING: '',
  CORTEX_HERDR_AGENT_NAME: '',
  CORTEX_TERMINAL_BACKEND: '',
  CORTEX_TMUX_AUTO_INSTALL: '',
  CORTEX_TMUX_STATIC_URL: '',
  CORTEX_TMUX_HISTORY_LIMIT: '',
  CORTEX_TMUX_PANE_SIZE: '',
  CORTEX_SUBAGENT_RUNTIME: '',
  CORTEX_HERDR_KEEP_DELEGATE_PANES: '',
  CORTEX_ENDTURN_RESOLVER_REASONING: '',
  CORTEX_DEADLINE_EXIT_MENTOR_REASONING: '',
  CORTEX_LOOP_TOOL_BLOCK_REASONING: '',
  MENTORSHIP_TURN_BASED_ENABLED: 'false',
  MENTORSHIP_TURN_INTERVAL: '10',
  MENTORSHIP_INTERLEAVED_THINKING: 'false',
  MENTORSHIP_PATTERN_DETECTION: 'false',
  MENTORSHIP_PATTERN_THRESHOLD: '3',
  MENTORSHIP_ACTIVE_DISCOVERY: 'false',

  // Turn Summary & Prediction
  TURN_SUMMARY_PREDICTION: 'false',

  // Canon (reactive session capture)
  CANON_AUTO_SYNC: 'false',
  CANON_AUTO_SYNC_DEBOUNCE_MS: '60000',
  CANON_STORE: '',
  CANON_REPO: '',

  // Context Management
  THINKING_AS_TEXT_FALLBACK: 'false',
  // Session Configuration
  SESSION_STORAGE_DIR: '.cortex/sessions',
  MCP_AUTO_INJECT: 'false',
  AUTORESEARCH_AGENTS: 'off',
  SYSTEM_MESSAGE_DOC_MAX_BYTES: '0',
  // Default ON (P-A memory upgrade 2026-07): bounds hot MEMORY.md, overflow moves
  // losslessly to MEMORY.archive.md. Superior to the head-truncating doc cap
  // (which DROPS the tail) — claude_memory is now exempt from that cap entirely.
  MEMORY_ARCHIVE_MAX_BYTES: '10000',

  // Loop Control
  MAX_TOOL_ITERATIONS: '1000',
  MAX_CONSECUTIVE_ERRORS: '6',
  TOOL_BUDGET_SOFT: '400',
  TOOL_TIMEOUT_MS: '120000',
  MAX_LOOP_REPETITIONS: '5',

  // Web Tools
  WEB_TOOLS_MODEL: '',

  // Server-Side Tools
  ENABLE_SERVER_SIDE_TOOLS: 'true',
  XAI_API_MODE: 'messages',
  OPENAI_API_MODE: 'chat/completions',

  // Programmatic Tool Calling
  ENABLE_PTC: 'false',
  ENABLE_LOCAL_CODE_EXECUTION: 'false',
  ENABLE_DEFERRED_TOOL_LOADING: 'true',
  ENABLE_WEBTOOLS: 'auto',
  VISION_HELPER_MODEL: 'deepseek-flash',
  TOOL_TIMEOUT_MODE: 'auto',
  VISION_HANDOFF_MAX: '8',
  CORTEX_SLICE_NUDGE: 'true',
  CORTEX_SLICE_BLOCK: 'true',
  CORTEX_SLICE_BLOCK_AT: '5',
  CORTEX_SLICE_BLOCK_MAX: '2',

  // Model Router
  MODEL_ROUTER_ENABLED: 'false',
  MODEL_ROUTER_STRATEGY: 'auto',
  MODEL_ROUTER_RECORD: 'false',
  ROUTER_MIN_CONFIDENCE: '0.3',
  ROUTER_MIN_SAMPLES: '3',
  MODEL_ROUTER_EXPLORATION: 'false',
  // 'grok*' prefix wildcard → exploration can never auto-route to any xAI model
  // (standing cost constraint). Carried in the optimal defaults so /config reset
  // preserves the guard. See ThompsonRouter exclude matching.
  MODEL_ROUTER_EXCLUDE: 'grok*',

  // Agent Team Workspace
  AGENT_TMUX_MONITOR: 'false',

  // Endturn Gate / Training
  CORTEX_ENDTURN_GATE: 'false',
  CORTEX_TOOL_PROFILE: 'full',

  // Decision Store
  CORTEX_RECORD_DECISIONS: 'true',
  CORTEX_LOOKUP_PRIOR_DECISIONS: 'true',
  CORTEX_DECISIONS_MAX_BYTES: '2097152',

  // Runtime
  CORTEX_MODE: 'persistent',
  CORTEX_UPDATE_POLICY: 'auto',
  YOLO: 'false',
  AUTO_RESUME: 'false',
  PORT: '4000',
  CORTEX_SERVER_URL: 'http://localhost:4000',
  DEBUG_PAYLOAD: 'false',
  DEBUG_THINKING: 'false',
  ENABLE_SMOKE_TESTS: 'false',

  // Git / PR access control (token + webhook secret are secrets — no default)
  GIT_ALLOWED_REPOS: '',
  GIT_ALLOWED_ACTIONS: '',
  GIT_HOST: 'github.com',
};

/**
 * Setting Metadata for Interactive Configuration
 */
export interface SettingMetadata {
  key: keyof EnvironmentVariables;
  displayName: string;
  description: string;
  type: 'string' | 'boolean' | 'number' | 'choice' | 'secret';
  category: 'api_keys' | 'models' | 'system' | 'mentorship' | 'context' | 'session' | 'loop_control' | 'server_side_tools' | 'model_router' | 'agent_workspace' | 'training' | 'runtime';
  required?: boolean;
  choices?: string[];
  default?: string;
  secret?: boolean; // Hide input
  validation?: (value: string) => true | string; // true or error message
}

/**
 * All Settings Metadata
 */
export const SETTINGS_METADATA: SettingMetadata[] = [
  // ============================================
  // API KEYS
  // ============================================
  {
    key: 'ANTHROPIC_API_KEY',
    displayName: 'Anthropic API Key',
    description: 'API key for Claude models (claude-sonnet-4-5, claude-opus-4-8, etc.)',
    type: 'secret',
    category: 'api_keys',
    secret: true,
    validation: (val) => val.startsWith('sk-ant-') || 'Must start with sk-ant-'
  },
  {
    key: 'OPENAI_API_KEY',
    displayName: 'OpenAI API Key',
    description: 'API key for GPT models (gpt-4, o1, etc.)',
    type: 'secret',
    category: 'api_keys',
    secret: true,
    validation: (val) => val.startsWith('sk-') || 'Must start with sk-'
  },
  {
    key: 'GOOGLE_API_KEY',
    displayName: 'Google API Key',
    description: 'API key for Gemini models',
    type: 'secret',
    category: 'api_keys',
    secret: true,
    validation: (val) => val.startsWith('AIza') || 'Must start with AIza'
  },
  {
    key: 'XAI_API_KEY',
    displayName: 'X.AI API Key',
    description: 'API key for Grok models',
    type: 'secret',
    category: 'api_keys',
    secret: true,
    validation: (val) => val.startsWith('xai-') || 'Must start with xai-'
  },
  {
    key: 'DEEPSEEK_API_KEY',
    displayName: 'DeepSeek API Key',
    description: 'API key for DeepSeek models',
    type: 'secret',
    category: 'api_keys',
    secret: true,
    validation: (val) => val.startsWith('sk-') || 'Must start with sk-'
  },
  {
    key: 'INCEPTION_API_KEY',
    displayName: 'Inception (Mercury) API Key',
    description: 'API key for Mercury (Inception Labs) diffusion models',
    type: 'secret',
    category: 'api_keys',
    secret: true
    // No prefix validation — Inception key format is not constrained here.
  },
  {
    key: 'DASHSCOPE_API_KEY',
    displayName: 'DashScope (Qwen) API Key',
    description: 'Alibaba Cloud DashScope API key for Qwen models',
    type: 'secret',
    category: 'api_keys',
    secret: true
  },
  {
    key: 'ZHIPU_API_KEY',
    displayName: 'Zhipu (GLM) API Key',
    description: 'Zhipu AI API key for GLM models',
    type: 'secret',
    category: 'api_keys',
    secret: true
  },
  {
    key: 'MOONSHOT_API_KEY',
    displayName: 'Moonshot (Kimi) API Key',
    description: 'Moonshot API key for Kimi models',
    type: 'secret',
    category: 'api_keys',
    secret: true
  },
  {
    key: 'MINIMAX_API_KEY',
    displayName: 'MiniMax API Key',
    description: 'MiniMax API key for MiniMax models',
    type: 'secret',
    category: 'api_keys',
    secret: true
  },
  {
    key: 'CLOUDFLARE_API_TOKEN',
    displayName: 'Cloudflare API Token',
    description: 'API token for Cloudflare Workers AI (@cf/* models)',
    type: 'secret',
    category: 'api_keys',
    secret: true
  },
  {
    key: 'CLOUDFLARE_ACCOUNT_ID',
    displayName: 'Cloudflare Account ID',
    description: 'Cloudflare account id — required alongside CLOUDFLARE_API_TOKEN for @cf/* models',
    type: 'string',
    category: 'api_keys'
  },

  // ============================================
  // ANTHROPIC AUTHENTICATION
  // ============================================
  {
    key: 'ANTHROPIC_AUTH_METHOD',
    displayName: 'Anthropic Auth Method',
    description: 'Authentication method for Anthropic: auto (try OAuth first, fallback to API key), oauth (OAuth only), api-key (API key only)',
    type: 'choice',
    category: 'api_keys',
    choices: ['auto', 'oauth', 'api-key'],
    default: 'auto'
  },
  {
    key: 'CLAUDE_CODE_OAUTH_TOKEN',
    displayName: 'Claude OAuth Token',
    description: 'OAuth token override (alternative to ~/.claude/.credentials.json)',
    type: 'secret',
    category: 'api_keys',
    secret: true,
    validation: (val) => val.startsWith('sk-ant-oat') || 'Must start with sk-ant-oat'
  },

  // ============================================
  // PROMPT CACHING
  // ============================================
  {
    key: 'ANTHROPIC_PROMPT_CACHING',
    displayName: 'Anthropic Prompt Caching',
    description: 'Enable Anthropic prompt caching for up to 90% cost reduction',
    type: 'boolean',
    category: 'context',
    default: 'true'
  },

  // ============================================
  // MODEL CONFIGURATION
  // ============================================
  {
    key: 'DEFAULT_MODEL_ID',
    displayName: 'Default Model',
    description: 'Default model ID for new sessions (any registered model ID or alias)',
    type: 'string',
    category: 'models',
    required: true,
    default: 'deepseek-flash'
  },
  {
    key: 'HELPER_MODEL_ID',
    displayName: 'Helper Model',
    description: 'Model for context management and summarization (any registered model ID)',
    type: 'string',
    category: 'models',
    default: 'deepseek-flash'
  },

  // ============================================
  // SYSTEM SETTINGS
  // ============================================
  {
    key: 'DEBUG',
    displayName: 'Debug Mode',
    description: 'Enable verbose debug logging',
    type: 'boolean',
    category: 'system',
    default: 'false'
  },
  {
    key: 'USE_EMOJI',
    displayName: 'Use Emojis',
    description: 'Display emojis in CLI output (set to false for plain text)',
    type: 'boolean',
    category: 'system',
    default: 'false'
  },
  {
    key: 'PROJECT_PATH',
    displayName: 'Project Path',
    description: 'Root directory for the project',
    type: 'string',
    category: 'system',
    default: process.cwd()
  },

  // ============================================
  // REACTIVE MENTORSHIP
  // ============================================
  {
    key: 'MENTORSHIP_ENABLED',
    displayName: 'Enable Mentorship',
    description: 'Enable AI-to-AI reactive mentorship system',
    type: 'boolean',
    category: 'mentorship',
    default: 'true'
  },
  {
    key: 'MENTORSHIP_TRIGGER_ON_ERROR',
    displayName: 'Error-Triggered Mentorship',
    description: 'Automatically trigger mentorship on tool errors',
    type: 'boolean',
    category: 'mentorship',
    default: 'false'
  },
  {
    key: 'MENTORSHIP_ERROR_THRESHOLD',
    displayName: 'Error Severity Threshold',
    description: 'Minimum error severity to trigger mentorship',
    type: 'choice',
    category: 'mentorship',
    choices: ['low', 'medium', 'high'],
    default: 'medium'
  },
  {
    key: 'MENTORSHIP_KEYWORDS_ENABLED',
    displayName: 'Keyword Triggers',
    description: 'Enable @ultrathink, @analyze, @rethink keywords',
    type: 'boolean',
    category: 'mentorship',
    default: 'false'
  },
  {
    key: 'MENTORSHIP_CUSTOM_KEYWORDS',
    displayName: 'Custom Keywords',
    description: 'Additional keywords (comma-separated, e.g., @help,@stuck)',
    type: 'string',
    category: 'mentorship',
    default: ''
  },
  {
    key: 'MENTORSHIP_HELPER_MODEL',
    displayName: 'Mentorship Helper Model',
    description: 'Model for mentorship guidance (any registered model ID)',
    type: 'string',
    category: 'mentorship',
    default: 'deepseek-flash'
  },
  {
    key: 'CORTEX_MENTOR_REASONING',
    displayName: 'Mentor Reasoning (planner surfaces)',
    description: 'Whether the MENTOR surfaces (lift planner, EndTurn resolver, deadline exit planner, loop-exit planner) send their effort on the wire (thinking ON) or run thinking-off like helper calls. on (default) | none. Every mentor result before 4.103.0 was measured thinking-off.',
    type: 'string',
    category: 'mentorship',
    default: 'on'
  },
  {
    key: 'CORTEX_MENTOR_EFFORT',
    displayName: 'Mentor Effort (all planner surfaces)',
    description: 'One reasoning effort for the lift planner, EndTurn resolver, deadline exit and loop-exit planner (low | medium | high | max). Empty = each surface\'s own *_EFFORT (default max). A surface variable that is explicitly set wins over this.',
    type: 'string',
    category: 'mentorship',
    default: ''
  },
  {
    key: 'CORTEX_ASK_FOR_ADVICE',
    displayName: 'AskForAdvice Tool',
    description: 'Include the model-initiated AskForAdvice consult tool while mentorship is on. Set false to drop it (the consult was measured thinking-off with weak voluntary heed; keep it out of mentor A/Bs).',
    type: 'boolean',
    category: 'mentorship',
    default: 'true'
  },
  {
    key: 'CORTEX_MENTOR_CONSULT_REASONING',
    displayName: 'Mentor Reasoning (AskForAdvice consult)',
    description: 'Whether the AskForAdvice consult hint reasons (on) or stays thinking-off (none, default — the 08-30 measurement: thinking-on hints came back blank under the small consult budget).',
    type: 'string',
    category: 'mentorship',
    default: 'none'
  },
  {
    key: 'CORTEX_MENTOR_TEMPERATURE',
    displayName: 'Mentor Temperature',
    description: 'Optional sampling temperature for mentor calls (0-2). Empty = adapter default (0.7).',
    type: 'string',
    category: 'mentorship',
    default: ''
  },
  {
    key: 'CORTEX_LIFT_PLAN_REASONING',
    displayName: 'Lift planner Reasoning',
    description: 'on | none — this surface\'s own thinking switch; wins over CORTEX_MENTOR_REASONING. Empty = follow the global lever.',
    type: 'string',
    category: 'mentorship',
    default: ''
  },
  {
    key: 'CORTEX_LIFT_PLAN_TOOL_ROUNDS',
    displayName: 'Lift planner investigation rounds',
    description: "Max planner calls at the anchor lift. Above 1 the planner may answer INVESTIGATE with CHECK (read-only command) and READ (file slice) lines; the harness runs them, appends an EVIDENCE block and asks again, withdrawing the option on the last round — the spec's v2 tool-using planner as a harness-driven text loop. Default 1 = single-shot. (R171, HB-LIFT-PLAN-TOOL-LOOP)",
    type: 'string',
    category: 'training',
    default: ''
  },
  {
    key: 'CORTEX_LIFT_PLAN_TOOL_ROUND_BUDGET_MS',
    displayName: 'Lift planner investigation budget',
    description: 'Aggregate wall clock (ms) the planner\'s investigation rounds may use before it must plan (default 240000). (R171)',
    type: 'string',
    category: 'training',
    default: ''
  },
  {
    key: 'CORTEX_LIFT_PLAN_DOCTRINE',
    displayName: 'Lift planner doctrine version',
    description: 'v1 (default, 4.107.0 prompt) | v2 (adds the census bullets: one install layer, no long sleeps, byte-level exact output, literals verbatim). Lever for the cell-n-r6 2×2.',
    type: 'string',
    category: 'mentorship',
    default: ''
  },
  {
    key: 'CORTEX_TURN_CONTRACT',
    displayName: 'Turn contract (suppress vs channel)',
    description: "'' = the shipped boot-minimal door (suppresses deliberation: 'prefer acting'). 'channel' = think freely, then every response carries ANALYSIS, PLAN, then the tool call; a reasoning-exhausted turn is re-issued at the same effort with the Terminus-2 style message instead of an effort step-down. (HB-TURN-CONTRACT, 2026-09-17)",
    type: 'string',
    category: 'training',
    default: ''
  },
  {
    key: 'CORTEX_DELEGATION_HINT',
    displayName: 'Delegation hint (dark)',
    description: 'true | false (default) — append one clause to the boot-minimal prompt naming the Task tool for large/independent/output-heavy sub-tasks (4.108.1, HB-DELEGATION-DOCTRINE). Dark until an A/B reads.',
    type: 'string',
    category: 'training',
    default: ''
  },
  {
    key: 'CORTEX_SUBAGENT_TIMEOUT_MS',
    displayName: 'Sub-agent timeout (ms)',
    description: 'Task sub-agent wall-clock limit (ms) when no parent turn deadline is set; default 300000 (R133, HB-SUBAGENT-TIMEOUT).',
    type: 'string',
    category: 'training',
    default: ''
  },
  {
    key: 'CORTEX_SUBAGENT_TIMEOUT_MAX_MS',
    displayName: 'Sub-agent timeout cap (ms)',
    description: 'Upper cap (ms) on the deadline-derived Task sub-agent limit; unset = no cap (R133).',
    type: 'string',
    category: 'training',
    default: ''
  },
  {
    key: 'CORTEX_BUDGET_VISIBILITY',
    displayName: 'Wall-budget visibility',
    description: 'When a turn deadline exists, append a one-line WALL BUDGET reminder (total / elapsed / remaining) to the tool result each time elapsed crosses a 10 percent band, and arm the open-items continue nudge (R151, HB-BUDGET-VISIBILITY). Default on; "false" disables.',
    type: 'string',
    category: 'training',
    default: ''
  },
  {
    key: 'CORTEX_BUDGET_CONTINUE_MIN_REMAINING',
    displayName: 'Budget-continue minimum remaining fraction',
    description: 'A finish whose draft lists open, unverified or unexecuted items gets one continue-with-budget nudge per turn when at least this fraction of the wall budget remains (R151). Default 0.5; 0 disables the nudge.',
    type: 'string',
    category: 'training',
    default: ''
  },
  {
    key: 'CORTEX_REASONING_EXHAUST_BACKOFF',
    displayName: 'Reasoning-exhaustion effort backoff',
    description: 'After a turn that spent the whole output budget on reasoning with no text or tool call (finish_reason length), run the next continuations one reasoning-effort level lower and say so to the model (R153, HB-REASONING-EXHAUSTION). Default on; \'false\' disables.',
    type: 'string',
    category: 'training',
    default: ''
  },
  {
    key: 'CORTEX_REASONING_EXHAUST_BACKOFF_TURNS',
    displayName: 'Reasoning-exhaustion backoff turns',
    description: 'How many continuation calls run at the lowered reasoning effort after a reasoning-exhaustion turn (R153). Default 2.',
    type: 'string',
    category: 'training',
    default: ''
  },
  {
    key: 'CORTEX_BUDGET_CONTINUE_MAX_NUDGES',
    displayName: 'Budget-continue max nudges per turn',
    description: 'How many times per turn an open-items finish with budget remaining may be nudged to continue; the second nudge is firmer (R157, R151 v2). Default 2; 0 disables.',
    type: 'string',
    category: 'training',
    default: ''
  },
  {
    key: 'CORTEX_BASH_OOM_PRIORITY',
    displayName: 'Bash child OOM priority',
    description: 'The Bash tool child shell (and every descendant) raises its own oom_score_adj to 1000 so the kernel OOM killer takes it before the orchestrator; the model sees Killed instead of the session vanishing (R156, HB-OOM-CHILD-PRIORITY). Default on; linux only.',
    type: 'string',
    category: 'training',
    default: ''
  },
  {
    key: 'CORTEX_MENTOR_CONSULT_BUDGET_TOKENS',
    displayName: 'Mentor consult answer budget (tokens)',
    description: 'Output token cap for an AskForAdvice mentor hint. Default 800 (a 400-token hint on tb4-flash-v3 was cut mid-sentence, finish_reason length); clamps to 100..4000.',
    type: 'string',
    category: 'training',
    default: ''
  },
  {
    key: 'CORTEX_ENDTURN_RESOLVER_MAX_REJECTS_BUDGETED',
    displayName: 'Resolver max rejects with budget',
    description: 'How many times the EndTurn finish judge may veto a finish while at least CORTEX_BUDGET_CONTINUE_MIN_REMAINING of the wall budget remains (R160, HB-RESOLVER-BUDGET-CAP). Below that fraction, or without a deadline, the liveness cap CORTEX_ENDTURN_RESOLVER_MAX_REJECTS (2) applies. Default 6; 0 disables.',
    type: 'string',
    category: 'training',
    default: ''
  },
  {
    key: 'CORTEX_JUDGE_SEMANTIC',
    displayName: 'Semantic finish judge',
    description: 'The EndTurn finish judge adjudicates every tool-using finish (no task-shape regex gate), runs the checks it names, grades GAP by confidence, and replaces the fixed veto count with a progress condition plus one thinking-on escalation (R165, HB-JUDGE-SEMANTIC). Default on; false = the 4.111 behavior.',
    type: 'string',
    category: 'training',
    default: ''
  },
  {
    key: 'CORTEX_FINISH_CONFIRM',
    displayName: 'Informed finish confirmation',
    description: "When the finish judge would accept a finish with a recorded gap and at least CORTEX_FINISH_CONFIRM_MIN_REMAINING of the wall budget remains, hold the finish once (CORTEX_FINISH_CONFIRM_MAX) with a zero-model-call confirmation carrying the budget left, the reviewer's gap plan and the model's own open items; the next EndTurn stands unless an evidence veto applies. Default on; false = off. (R167, HB-FINISH-CONFIRM)",
    type: 'string',
    category: 'training',
    default: ''
  },
  {
    key: 'CORTEX_FINISH_CONFIRM_MIN_REMAINING',
    displayName: 'Finish confirmation budget floor',
    description: 'Fraction of the wall budget that must remain for the confirmation to fire (default 0.3). (R167)',
    type: 'string',
    category: 'training',
    default: ''
  },
  {
    key: 'CORTEX_FINISH_CONFIRM_MAX',
    displayName: 'Finish confirmations per session',
    description: 'Max informed confirmations per session (default 1, 0..5). (R167)',
    type: 'string',
    category: 'training',
    default: ''
  },
  {
    key: 'CORTEX_MEETS_CONFIRM',
    displayName: 'Verified MEETS',
    description: "The finish judge must back a MEETS verdict with one to three CHECK commands whose passing proves the task's own criteria; the harness runs them. A MEETS with no passing check and at least CORTEX_MEETS_CONFIRM_MIN_REMAINING of the wall budget left is held once (sharing CORTEX_FINISH_CONFIRM_MAX with R167) with the check results, the budget and the model's own open items; the next EndTurn stands. Default on; false = 4.116.2 behavior. (R168, HB-MEETS-CONFIRM)",
    type: 'string',
    category: 'training',
    default: ''
  },
  {
    key: 'CORTEX_MEETS_CONFIRM_MIN_REMAINING',
    displayName: 'Verified-MEETS budget floor',
    description: 'Fraction of the wall budget that must remain to hold an unverified MEETS (default 0.5). (R168)',
    type: 'string',
    category: 'training',
    default: ''
  },
  {
    key: 'CORTEX_ACTION_PLAN_FIELDS',
    displayName: 'Action plan fields',
    description: "The Bash, Edit and Write tool schemas gain REQUIRED `analysis` and `plan` string fields; a call missing either is returned unexecuted with a corrective error every time (no cap), valid calls have the fields stripped before dispatch and keep them in the trajectory. The per-step analysis + plan as part of the action's own JSON — Terminus 2's shape through function calling. Default off. (R172, HB-ACTION-PLAN-FIELDS)",
    type: 'string',
    category: 'training',
    default: ''
  },
  {
    key: 'CORTEX_TURN_CONTRACT_ENFORCE',
    displayName: 'Turn contract enforcement',
    description: "With CORTEX_TURN_CONTRACT=channel, a tool-calling response whose visible text lacks the ANALYSIS and PLAN sections is REJECTED: its tool calls are returned unexecuted as error results carrying the re-prompt, up to CORTEX_TURN_CONTRACT_ENFORCE_MAX times per turn, then the batch runs as-is. Finish (EndTurn) batches are exempt. Terminus 2's parser-reject, structurally. Default off. (HB-TURN-CONTRACT-ENFORCE)",
    type: 'string',
    category: 'training',
    default: ''
  },
  {
    key: 'CORTEX_TURN_CONTRACT_ENFORCE_MAX',
    displayName: 'Turn contract rejections per turn',
    description: 'Format rejections per turn before the tool batch executes as-is (default 2, 0..10). (HB-TURN-CONTRACT-ENFORCE)',
    type: 'string',
    category: 'training',
    default: ''
  },
  {
    key: 'CORTEX_JUDGE_TOOL_ROUNDS',
    displayName: 'Finish judge investigation rounds',
    description: "Max judge calls per finish adjudication. Above 1 the judge may answer VERDICT: INVESTIGATE with CHECK (read-only command) and READ (file slice) lines; the harness runs them, appends an EVIDENCE block and asks again, withdrawing the option on the last round. The v2 tool-using judge as a harness-driven text loop. Default 1 = single-shot (4.116.2). (R170, HB-JUDGE-TOOL-LOOP)",
    type: 'string',
    category: 'training',
    default: ''
  },
  {
    key: 'CORTEX_JUDGE_TOOL_ROUND_BUDGET_MS',
    displayName: 'Finish judge investigation budget',
    description: 'Aggregate wall clock (ms) the investigation rounds of one adjudication may use before the judge must decide (default 240000). (R170)',
    type: 'string',
    category: 'training',
    default: ''
  },
  {
    key: 'CORTEX_JUDGE_TOOL_AUTOLOOP',
    displayName: 'Finish judge auto-loop on named checks',
    description: "With CORTEX_JUDGE_TOOL_ROUNDS >= 2: when the judge's first verdict (MEETS or GAP) names CHECK lines, the harness runs them and asks the judge again with the results before accepting the verdict — the investigation loop no longer depends on the judge choosing VERDICT: INVESTIGATE. Default off. (R170b)",
    type: 'string',
    category: 'training',
    default: ''
  },
  {
    key: 'CORTEX_JUDGE_GAP_HOLD',
    displayName: 'Finish judge gap hold (budget-aware)',
    description: "true: in evidence mode a GAP verdict that names open items is RETURNED to the junior — with or without a failed check — while at least CORTEX_BUDGET_CONTINUE_MIN_REMAINING of the wall budget remains and the budgeted reject cap allows; the R165 progress rules still apply (escalate once, then the finish stands). Below the budget floor R166 evidence mode is unchanged. Default off. (R173, HB-GAP-HOLD)",
    type: 'string',
    category: 'training',
    default: ''
  },
  {
    key: 'CORTEX_JUDGE_GAP_HOLD_JEV',
    displayName: 'Finish judge gap hold — Jev gate',
    description: "off (default) | shadow | gate. With CORTEX_JUDGE_GAP_HOLD, ask TypeSafe Jev (typed yes/no, ~0.3 s) whether the reviewer's open items are fixable with more turns: shadow banks the probability on the endturn_resolver event; gate holds only when it is >= CORTEX_JUDGE_GAP_HOLD_JEV_MIN. Needs TYPESAFE_API_KEY; fail-open to R166 when unavailable. (R173b)",
    type: 'string',
    category: 'training',
    default: ''
  },
  {
    key: 'CORTEX_JUDGE_SPEC_TESTS',
    displayName: 'Finish judge blind spec tests',
    description: "true: at the first finish of a turn a mentor call that sees ONLY the task text and the environment report writes up to CORTEX_JUDGE_SPEC_TESTS_MAX read-only CHECK commands that fail when a stated requirement is unmet; the harness runs them at every adjudication, shows the results to the judge, and a FAILED spec check is objective evidence for the veto (independent of the agent's own tests and of the judge's post-hoc checks). Default off. (R174, HB-SPEC-TESTS)",
    type: 'string',
    category: 'training',
    default: ''
  },
  {
    key: 'CORTEX_JUDGE_VETO_MIN_REMAINING',
    displayName: 'Finish judge budget floor',
    description: "Fraction of the wall budget below which NO verdict holds the finish (veto or gap hold): the gap is recorded and the finish stands. The one attributable cell-g1 regression was an evidence veto at 15% budget. 0 = off. (R173c)",
    type: 'string',
    category: 'training',
    default: ''
  },
  {
    key: 'CORTEX_JUDGE_SPEC_TESTS_AT',
    displayName: 'Blind spec tests authored at',
    description: "finish (default): at the first finish adjudication. lift: in the background at task lift, so a session whose first finish comes late still has its checks. (R174b)",
    type: 'string',
    category: 'training',
    default: ''
  },
  {
    key: 'CORTEX_JUDGE_INDEPENDENT_DERIVATION',
    displayName: 'Independent derivation before finish',
    description: "on: on a value-shaped task (names an output artifact + computation language), before a finish that would otherwise stand, a mentor call authors a recomputation by a DIFFERENT method; the harness runs it (read-only runner) and holds the finish ONCE when the values disagree, showing both. Targets the largest never-passed class (computed answers with no in-container ground truth). Default off. (R176)",
    type: 'string',
    category: 'training',
    default: ''
  },
  {
    key: 'CORTEX_FRAME',
    displayName: 'Action frame',
    description: "tools (default) | terminus: the Terminus-2-style frame — one tmux pane is the only action surface (FrameAction + EndTurn); each turn returns the screen, a parsed state card and the harness templates (R179 HB-TERMINUS-FRAME).",
    type: 'string',
    category: 'training',
    default: ''
  },
  {
    key: 'CORTEX_FRAME_CHOOSER',
    displayName: 'Frame menu chooser',
    description: "off (default) | jev: a typed reader (Jev) sees the raw screen + state + the writer's candidates and picks the action to execute, refuses unsafe ones, restricts repeats; never sees the judge; fail-open to the first candidate (R178).",
    type: 'string',
    category: 'training',
    default: ''
  },
  {
    key: 'CORTEX_JUDGE_VETO',
    displayName: 'Finish judge veto mode',
    description: "evidence (default): a GAP verdict holds the finish only when a check the judge named and the harness ran just now FAILED, at most CORTEX_JUDGE_EVIDENCE_MAX_VETOES times; otherwise the finish stands and the plan is recorded. opinion: the R165 policy (vetoes on the verdict alone). never: record only. (R166, HB-JUDGE-EVIDENCE-VETO)",
    type: 'string',
    category: 'training',
    default: ''
  },
  {
    key: 'CORTEX_JUDGE_EVIDENCE_MAX_VETOES',
    displayName: 'Finish judge evidence vetoes',
    description: 'Max evidence-backed vetoes per session in evidence mode (default 1, 0..20). (R166)',
    type: 'string',
    category: 'training',
    default: ''
  },
  {
    key: 'CORTEX_JUDGE_PROGRESS_MIN_CALLS',
    displayName: 'Judge progress minimum calls',
    description: 'How many tool calls since the previous veto count as the junior having worked the fix plan; fewer (and no named check run) triggers the thinking-on escalation instead of another veto (R165). Default 3.',
    type: 'string',
    category: 'training',
    default: ''
  },
  {
    key: 'CORTEX_JUDGE_ESCALATE_REASONING',
    displayName: 'Judge escalation to reasoning',
    description: 'When the junior re-attests without working the plan, re-judge once with the resolver reasoning forced on before accepting the finish with the gap recorded (R165). Default on.',
    type: 'string',
    category: 'training',
    default: ''
  },
  {
    key: 'CORTEX_API_NETWORK_RETRY_MS',
    displayName: 'API network-fault retry budget (ms)',
    description: 'Wall-clock budget for retrying network-class API faults (connection error, terminated stream, 5xx) with an exponential ladder capped at 60 s per wait (R150, HB-API-CONNECTION-RESILIENCE). Default 600000 (10 min); 0 = legacy 3-attempt cap.',
    type: 'string',
    category: 'training',
    default: ''
  },
  {
    key: 'CORTEX_OUTER_TOOL_TIMEOUT_MS',
    displayName: 'Outer tool abort floor (ms)',
    description: 'Floor (ms) for the outer per-batch tool abort; the deadline becomes max(computed, floor + 30 s grace). Unset = no floor (150 s for non-Bash tools without their own limit).',
    type: 'string',
    category: 'training',
    default: ''
  },
  {
    key: 'CORTEX_HERDR_REPORTING',
    displayName: 'herdr lifecycle reporting',
    description: 'Inside a herdr pane (HERDR_ENV=1 + herdr on PATH) the orchestrator reports working/idle/blocked and a summary token to herdr (R145, HB-HERDR-LIFECYCLE). On by default there; "false" disables.',
    type: 'string',
    category: 'runtime',
    default: ''
  },
  {
    key: 'CORTEX_HERDR_AGENT_NAME',
    displayName: 'herdr agent label',
    description: 'Agent label passed to herdr pane report-agent --agent; sanitized to [a-z][a-z0-9_-]{0,31}. Default cortex (R145).',
    type: 'string',
    category: 'runtime',
    default: ''
  },
  {
    key: 'CORTEX_TERMINAL_BACKEND',
    displayName: 'Terminal backend',
    description: 'Backend for persistent terminal sessions (Bash persistentSession, TmuxSession, CreateArtifact persistent): auto | herdr | tmux | detached. auto = herdr pane (inside a herdr pane with the socket reachable) > tmux > detached background process (R146, HB-HERDR-TERMINAL-BACKEND). Resolved once per process.',
    type: 'string',
    category: 'runtime',
    default: ''
  },
  {
    key: 'CORTEX_TMUX_AUTO_INSTALL',
    displayName: 'tmux self-install',
    description: 'When tmux is missing, the first persistent request tries to install it: package manager (apt-get with expired-Release tolerance, apk, dnf, yum, brew; each step capped at 120 s), then a static binary from CORTEX_TMUX_STATIC_URL, then the R134 detached degrade. One attempt per process, one [INFO]/[WARN] line (R138, HB-TMUX-SELF-INSTALL). Set false to never attempt an install.',
    type: 'string',
    category: 'runtime',
    default: ''
  },
  {
    key: 'CORTEX_TMUX_STATIC_URL',
    displayName: 'tmux static binary URL',
    description: 'URL of a prebuilt/static tmux binary the R138 self-install downloads (curl, else wget) into ~/.local/bin/tmux after every package manager fails. Unset = the static step is skipped; there is no default download.',
    type: 'string',
    category: 'runtime',
    default: ''
  },
  {
    key: 'CORTEX_TMUX_HISTORY_LIMIT',
    displayName: 'tmux history limit',
    description: 'Scrollback lines kept per tmux pane the harness creates (applied around new-session so the first window gets it, plus the session option). Default 50000 (R141, HB-TMUX-CAPTURE-CAP).',
    type: 'string',
    category: 'runtime',
    default: ''
  },
  {
    key: 'CORTEX_TMUX_PANE_SIZE',
    displayName: 'tmux pane size',
    description: 'Fixed WxH geometry for tmux sessions the harness creates (new-session -x W -y H). Default 160x40, the pane Terminus captures. Every capture is 10 KB middle-omitted regardless (R141).',
    type: 'string',
    category: 'runtime',
    default: ''
  },
  {
    key: 'CORTEX_SUBAGENT_RUNTIME',
    displayName: 'Sub-agent runtime',
    description: 'Where Task sub-agents run: auto | process | herdr. process = forked IPC child (the default path); herdr = a sibling herdr pane running the same agent-mode entry (visible + takeover-able, lifecycle reported to herdr; runs auto-approved because a pane has no IPC approval channel). auto = herdr when HERDR_ENV=1, the herdr terminal backend resolves and the parent auto-approves tools, else process. Task input `runtime` overrides per dispatch (R147, HB-HERDR-DELEGATES).',
    type: 'string',
    category: 'runtime',
    default: ''
  },
  {
    key: 'CORTEX_HERDR_KEEP_DELEGATE_PANES',
    displayName: 'Keep herdr delegate panes',
    description: 'Herdr delegate panes are kept after the sub-agent finishes so the operator can inspect or take them over (default). Set 0/false to close the pane and remove its task/result files on completion (R147).',
    type: 'string',
    category: 'runtime',
    default: ''
  },
  {
    key: 'CORTEX_COMPACTION_THRESHOLD_TOKENS',
    displayName: 'Compaction threshold override (tokens)',
    description: 'Test/ops override: a positive integer replaces the card-derived compaction threshold (and halves it as the kept-history budget) so the checkpoint rung and compaction fire in a short run. Empty = card-derived (4.108.3).',
    type: 'string',
    category: 'training',
    default: ''
  },
  {
    key: 'CORTEX_COMPACTION_HANDOFF_QA',
    displayName: 'Compaction handoff QA round',
    description: 'DARK lever (R143 HB-HANDOFF-QA-SUMMARY): true = after each resume memory, a fresh history-free helper call asks what the memory is missing and a second helper call answers from the covered history; the answers are appended as a GAPS (Q/A) section. Empty/false = plain memory (default).',
    type: 'string',
    category: 'training',
    default: ''
  },
  {
    key: 'CORTEX_COMPACTION_HANDOFF_QA_MAX_QUESTIONS',
    displayName: 'Handoff QA max questions',
    description: 'Cap on the gap questions asked per handoff QA round (R143). Empty = 6; clamped to 1-20.',
    type: 'string',
    category: 'training',
    default: ''
  },
  {
    key: 'CORTEX_STATE_DIR',
    displayName: 'Cortex state directory override',
    description: 'Explicit runtime-state root for sessions/artifacts/tmux/decisions (4.108.6); empty = <project>/.cortex, falling back to ~/.cortex/projects/<hash> then tmpdir when the project dir is not writable',
    type: 'string',
    category: 'training',
    default: ''
  },
  {
    key: 'CORTEX_COMPACTION_CHECKPOINT_PCT',
    displayName: 'Pre-compaction checkpoint rung',
    description: 'Fraction of the compaction threshold (0.3–0.99) at which the helper model first writes the resume memory of the whole conversation, BEFORE any compaction (4.108.2). Empty = 0.75.',
    type: 'string',
    category: 'training',
    default: ''
  },
  {
    key: 'CORTEX_COMPACTION_CHECKPOINT_STEP',
    displayName: 'Checkpoint refresh band',
    description: 'How much further (fraction of the threshold, 0.02–0.5) the context must grow before the resume memory is refreshed (4.108.2). Empty = 0.10.',
    type: 'string',
    category: 'training',
    default: ''
  },
  {
    key: 'CORTEX_COMPACTION_RESUME',
    displayName: 'Compaction resume memory',
    description: 'true (default) | false — when proactive compaction drops older messages, the helper model writes a resume memory of them and the orchestrator prepends it with the original task verbatim (4.108.0, HB-COMPACTION-RESUME).',
    type: 'string',
    category: 'training',
    default: ''
  },
  {
    key: 'CORTEX_ENDTURN_TIER',
    displayName: 'EndTurn discovery tier',
    description: 'essential (default since 4.107.3: in the turn-1 tool set) | standard (deferred behind SearchTools; the 4.107.0 baseline).',
    type: 'string',
    category: 'training',
    default: ''
  },
  {
    key: 'CORTEX_ENDTURN_RESOLVER_REASONING',
    displayName: 'EndTurn resolver Reasoning',
    description: 'on | none — this surface\'s own thinking switch; wins over CORTEX_MENTOR_REASONING. Empty = follow the global lever.',
    type: 'string',
    category: 'mentorship',
    default: ''
  },
  {
    key: 'CORTEX_DEADLINE_EXIT_MENTOR_REASONING',
    displayName: 'Deadline exit mentor Reasoning',
    description: 'on | none — this surface\'s own thinking switch; wins over CORTEX_MENTOR_REASONING. Empty = follow the global lever.',
    type: 'string',
    category: 'mentorship',
    default: ''
  },
  {
    key: 'CORTEX_LOOP_TOOL_BLOCK_REASONING',
    displayName: 'Loop-exit planner Reasoning',
    description: 'on | none — this surface\'s own thinking switch; wins over CORTEX_MENTOR_REASONING. Empty = follow the global lever.',
    type: 'string',
    category: 'mentorship',
    default: ''
  },
  {
    key: 'CORTEX_MENTOR_THINKING_TIMEOUT_MS',
    displayName: 'Mentor Thinking Timeout (ms)',
    description: 'Surface timeout for a thinking-on mentor call (lift planner, EndTurn resolver, loop-exit planner): max(surface timeout, this). Empty = per-effort table low 120000 / medium 180000 / high 240000 / max 300000. The first (thinking-on) request is aborted at 60% so the thinking-off retry fits.',
    type: 'string',
    category: 'mentorship',
    default: ''
  },
  {
    key: 'CORTEX_MENTOR_REASONING_ALLOWANCE',
    displayName: 'Mentor Reasoning Allowance',
    description: 'Extra max_tokens granted to a thinking-on mentor call for its reasoning (DeepSeek counts reasoning inside max_tokens). Empty = per-effort table low 4000 / medium 8000 / high 12000 / max 24000.',
    type: 'string',
    category: 'mentorship',
    default: ''
  },
  {
    key: 'MENTORSHIP_TURN_BASED_ENABLED',
    displayName: 'Turn-Based Mentorship',
    description: 'Enable periodic mentorship review every N turns',
    type: 'boolean',
    category: 'mentorship',
    default: 'false'
  },
  {
    key: 'MENTORSHIP_TURN_INTERVAL',
    displayName: 'Turn Interval',
    description: 'Number of turns between periodic mentorship reviews',
    type: 'number',
    category: 'mentorship',
    default: '10',
    validation: (val) => {
      const num = parseInt(val);
      return (!isNaN(num) && num >= 1 && num <= 50) || 'Must be 1-50';
    }
  },
  {
    key: 'MENTORSHIP_INTERLEAVED_THINKING',
    displayName: 'Interleaved Thinking',
    description: 'Enable thinking assistance for non-reasoning models',
    type: 'boolean',
    category: 'mentorship',
    default: 'false'
  },
  {
    key: 'MENTORSHIP_PATTERN_DETECTION',
    displayName: 'Pattern Detection',
    description: 'Detect and alert on repeated failure patterns',
    type: 'boolean',
    category: 'mentorship',
    default: 'false'
  },
  {
    key: 'MENTORSHIP_PATTERN_THRESHOLD',
    displayName: 'Pattern Threshold',
    description: 'Number of similar errors to trigger pattern detection',
    type: 'number',
    category: 'mentorship',
    default: '3',
    validation: (val) => {
      const num = parseInt(val);
      return (!isNaN(num) && num >= 2 && num <= 10) || 'Must be 2-10';
    }
  },

  // ============================================
  // TURN SUMMARY & PREDICTION
  // ============================================
  {
    key: 'TURN_SUMMARY_PREDICTION',
    displayName: 'Turn Summary & Prediction',
    description: 'Generate post-turn summary and next-action prediction via helper model',
    type: 'boolean',
    category: 'mentorship',
    default: 'false'
  },

  // ============================================
  // CANON (reactive session capture)
  // ============================================
  {
    key: 'CANON_AUTO_SYNC',
    displayName: 'Canon Auto-Sync',
    description: 'Auto-sync sessions to the canon store after each turn (debounced; opt-in — commits and pushes to your canon git remote)',
    type: 'boolean',
    category: 'session',
    default: 'false'
  },
  {
    key: 'CANON_AUTO_SYNC_DEBOUNCE_MS',
    displayName: 'Canon Auto-Sync Debounce (ms)',
    description: 'Quiet window after the last turn before a reactive canon sync fires (a burst of turns collapses into one sync)',
    type: 'number',
    category: 'session',
    default: '60000',
    validation: (val) => {
      const num = parseInt(val);
      return (!isNaN(num) && num >= 1000) || 'Must be >= 1000 (ms)';
    }
  },
  {
    key: 'CANON_STORE',
    displayName: 'Canon Store Path',
    description: 'Canon store working clone directory (empty = /tmp/canon-store, off-quota)',
    type: 'string',
    category: 'session',
    default: ''
  },
  {
    key: 'CANON_REPO',
    displayName: 'Canon Store Remote',
    description: 'Git remote URL for the canon store (empty = the canonical nexus-canon-store repo)',
    type: 'string',
    category: 'session',
    default: ''
  },

  // ============================================
  // CONTEXT MANAGEMENT
  // ============================================
  // CONTEXT_BUDGET_STRATEGY was removed 2026-07-28: the setting was read but
  // never consumed — the selection strategy is derived from the MODEL CARD
  // (model.compaction.behavior.compactOlder → preserve-critical, else
  // sliding-window) at the orchestrator call site, per-model, which is
  // strictly more correct than a global knob. Its schema default
  // ('priority-based') was not even a valid SelectionStrategy member.
  {
    key: 'THINKING_AS_TEXT_FALLBACK',
    displayName: 'Thinking As Text Fallback',
    description: 'Render prior thinking blocks as visible <prior_reasoning> text on the chat/completions path — recall for resumed reasoning-heavy sessions (canon cross-harness pulls). Providers ignore replayed reasoning_content as context, so without this, resumed reasoning is invisible. Costs tokens (A/B: 0/3 → 3/3 recall for +3.5%).',
    type: 'boolean',
    category: 'context',
    default: 'false'
  },
  // ============================================
  // SESSION CONFIGURATION
  // ============================================
  {
    key: 'SESSION_STORAGE_DIR',
    displayName: 'Session Storage Directory',
    description: 'Directory to store session history',
    type: 'string',
    category: 'session',
    default: '.cortex/sessions'
  },
  {
    key: 'MCP_AUTO_INJECT',
    displayName: 'MCP Auto-Injection',
    description: 'Automatically inject MCP server tools',
    type: 'boolean',
    category: 'session',
    default: 'false'
  },
  {
    key: 'AUTORESEARCH_AGENTS',
    displayName: 'Auto-Research Subagents',
    description: 'Delegate auto-research to subagents. off = disabled. native = subagents run experiments with internal tools. mcp = subagents route to the configured auto-research MCP. The PM (main model) only gets a delegation hint — the tool surface lives in the subagents.',
    type: 'choice',
    category: 'session',
    choices: ['off', 'native', 'mcp'],
    default: 'off'
  },
  {
    key: 'SYSTEM_MESSAGE_DOC_MAX_BYTES',
    displayName: 'System Doc Inject Cap',
    description: 'Cap on bytes per injected project doc (CLAUDE.md, MEMORY.md, AGENTS.md, GEMINI.md, CORTEX.md). 0 = unlimited (default). Set a positive integer to truncate; model can use Read to fetch full content.',
    type: 'number',
    category: 'session',
    default: '0'
  },
  {
    key: 'MEMORY_ARCHIVE_MAX_BYTES',
    displayName: 'Memory Archive Cap',
    description: 'Archive-prune cap for CORTEX MEMORY.md. When over cap, older overflow MOVES to a sibling MEMORY.archive.md (never dropped) and MEMORY.md is bounded — fixes unbounded growth + full-file injection. 0 = off (default). Recommended ~10000. Superior to the doc inject cap for MEMORY.md, which head-truncates and loses the newest entries.',
    type: 'number',
    category: 'session',
    default: '0'
  },

  // ============================================
  // LOOP CONTROL
  // ============================================
  {
    key: 'MAX_TOOL_ITERATIONS',
    displayName: 'Max Tool Iterations',
    description: 'Absolute per-turn tool-iteration ceiling. A runaway/cost failsafe, NOT a work limit — real long tasks must never hit it (R64: the old 50 severed legitimate deep-repo work). Pathology is handled by loop detection + the progress-gated budget stop.',
    type: 'number',
    category: 'loop_control',
    default: '1000'
  },
  {
    key: 'MAX_CONSECUTIVE_ERRORS',
    displayName: 'Max Consecutive Errors',
    description: 'Maximum consecutive tool errors before stopping',
    type: 'number',
    category: 'loop_control',
    default: '6'
  },
  {
    key: 'TOOL_BUDGET_SOFT',
    displayName: 'Soft Tool Budget',
    description: 'Tool calls per turn before escalating "synthesize now" reminders (1x and 1.5x); a PROGRESS-GATED force-synthesis cap fires at 2x (only when cycling). 0 disables budget pressure entirely. R64: sized so real work never feels it (old 15 induced fabricated completions on deep tasks).',
    type: 'number',
    category: 'loop_control',
    default: '400'
  },
  {
    key: 'TOOL_TIMEOUT_MS',
    displayName: 'Tool Timeout (ms)',
    description: 'Tool execution timeout in milliseconds',
    type: 'number',
    category: 'loop_control',
    default: '120000'
  },
  {
    key: 'MAX_LOOP_REPETITIONS',
    displayName: 'Max Loop Repetitions',
    description: 'Maximum identical tool call repetitions before detecting loop',
    type: 'number',
    category: 'loop_control',
    default: '5'
  },

  // ============================================
  // SERVER-SIDE TOOLS
  // ============================================
  {
    key: 'ENABLE_SERVER_SIDE_TOOLS',
    displayName: 'Server-Side Tools',
    description: 'Enable XAI server-side agentic tools (web_search, x_search, code_execution)',
    type: 'boolean',
    category: 'server_side_tools',
    default: 'true'
  },
  {
    key: 'XAI_API_MODE',
    displayName: 'XAI API Mode',
    description: 'XAI API mode: messages (supports thinking) or responses (supports server-side tools + stateful)',
    type: 'choice',
    category: 'server_side_tools',
    choices: ['messages', 'responses'],
    default: 'messages'
  },
  {
    key: 'OPENAI_API_MODE',
    displayName: 'OpenAI API Mode',
    description: 'OpenAI API mode: chat/completions (default, simple/fast) or responses (supports server-side tools + visible reasoning). With ENABLE_SERVER_SIDE_TOOLS=true, server-side tool requests dynamically switch to responses regardless of this default.',
    type: 'choice',
    category: 'server_side_tools',
    choices: ['chat/completions', 'responses'],
    default: 'chat/completions'
  },

  // ============================================
  // PROGRAMMATIC TOOL CALLING (PTC)
  // ============================================
  {
    key: 'ENABLE_PTC',
    displayName: 'Programmatic Tool Calling',
    description: 'Enable Anthropic PTC — server-side Python sandbox where Claude writes code that calls tools. 37-85% token reduction.',
    type: 'boolean',
    category: 'server_side_tools',
    default: 'false'
  },
  {
    key: 'TOOL_TIMEOUT_MODE',
    displayName: 'Tool Timeout Mode',
    description: 'What happens when a Bash call exceeds TOOL_TIMEOUT_MS. kill: terminate (legacy). background: promote the still-running command to a background shell (bash_id) and return the output so far. auto (default): background in headless/auto-approve sessions, kill in interactive sessions.',
    type: 'choice',
    category: 'server_side_tools',
    choices: ['auto', 'kill', 'background'],
    default: 'auto'
  },
  {
    key: 'VISION_HANDOFF_MAX',
    displayName: 'Vision Hand-off Max',
    description: 'Per-turn cap on ReadImage hand-offs to the vision helper (VISION_HELPER_MODEL). Past the cap, ReadImage returns a consolidate-your-reads reminder instead of another vision call. 0 = unlimited.',
    type: 'number',
    category: 'server_side_tools',
    default: '8'
  },
  {
    key: 'CORTEX_SLICE_NUDGE',
    displayName: 'Slice-Reader Nudge',
    description: 'After the third bash slice-read (sed -n N,Mp / head / tail) of the same file in a session, append a one-line reminder to read the file once with Read instead. Doctrine gap seen on both models in the v4 cell.',
    type: 'boolean',
    category: 'server_side_tools',
    default: 'true'
  },
  {
    key: 'CORTEX_SLICE_BLOCK',
    displayName: 'Slice-Reader Block',
    description: 'After CORTEX_SLICE_BLOCK_AT bash slice-reads (sed -n / head / tail) of the same static/source file, the next slice-read is refused and the model is told to Read the file once (bounded to CORTEX_SLICE_BLOCK_MAX blocks per file; append-mostly logs exempt). Set false to fall back to the soft nudge only.',
    type: 'boolean',
    category: 'server_side_tools',
    default: 'true'
  },
  {
    key: 'CORTEX_SLICE_BLOCK_AT',
    displayName: 'Slice-Reader Block Threshold',
    description: 'Slice count at which CORTEX_SLICE_BLOCK starts blocking a file.',
    type: 'number',
    category: 'server_side_tools',
    default: '5'
  },
  {
    key: 'CORTEX_SLICE_BLOCK_MAX',
    displayName: 'Slice-Reader Block Max',
    description: 'Max coercive slice-blocks per file before letting further slices through.',
    type: 'number',
    category: 'server_side_tools',
    default: '2'
  },
  {
    key: 'VISION_HELPER_MODEL',
    displayName: 'Vision Helper Model',
    description: 'Vision-capable card that reads images on behalf of text-only models: ReadImage sends the image + your question through the helper middleware and returns text (the primary never receives image bytes). Default deepseek-v4-flash-vision-exp (same DeepSeek key). Set false to offer ReadImage only to vision-capable primaries.',
    type: 'string',
    category: 'server_side_tools',
    default: 'deepseek-flash'
  },
  {
    key: 'ENABLE_WEBTOOLS',
    displayName: 'Web Tools',
    description: 'Web surface mode. auto (default): WebFetch on; WebSearch / Browse / browser MCP / hosted search on only when a search-capable key is present (Gemini grounding, XAI, OpenAI). true = all on. false = all off — stripped from every tool surface and refused at dispatch. Benches must pin true/false explicitly.',
    type: 'choice',
    choices: ['auto', 'true', 'false'],
    category: 'server_side_tools',
    default: 'auto'
  },
  {
    key: 'ENABLE_LOCAL_CODE_EXECUTION',
    displayName: 'Local Code Execution',
    description: 'Enable local code execution tool for non-PTC models (JS sandbox with tool-calling globals)',
    type: 'boolean',
    category: 'server_side_tools',
    default: 'false'
  },
  {
    key: 'ENABLE_DEFERRED_TOOL_LOADING',
    displayName: 'Deferred Tool Loading',
    description: 'Load only essential tools upfront; discover others on-demand via SearchTools. Reduces token cost per request.',
    type: 'boolean',
    category: 'server_side_tools',
    default: 'true'
  },

  // ============================================
  // MODEL ROUTER
  // ============================================
  {
    key: 'MODEL_ROUTER_ENABLED',
    displayName: 'Model Router',
    description: 'Auto-select model based on task type and accumulated benchmark history. When enabled, "auto" as model ID triggers the router.',
    type: 'boolean',
    category: 'model_router',
    default: 'false'
  },
  {
    key: 'MODEL_ROUTER_STRATEGY',
    displayName: 'Router Strategy',
    description: 'How the router picks models. "auto" classifies the prompt then consults the matrix. "matrix-only" requires explicit task type.',
    type: 'choice',
    category: 'model_router',
    choices: ['auto', 'matrix-only'],
    default: 'auto'
  },
  {
    key: 'MODEL_ROUTER_RECORD',
    displayName: 'Auto-Record Benchmarks',
    description: 'Automatically record turn metrics (tool calls, tokens, latency) into the routing matrix after each turn.',
    type: 'boolean',
    category: 'model_router',
    default: 'false'
  },
  {
    key: 'ROUTER_MIN_CONFIDENCE',
    displayName: 'Router Min Confidence',
    description: "Minimum task-classification confidence (0-1) before model='auto' routes a sub-agent. Below it, 'auto' inherits the parent model instead of guessing.",
    type: 'number',
    category: 'model_router',
    default: '0.3',
    validation: (v) => { const n = Number(v); return (!Number.isNaN(n) && n >= 0 && n <= 1) || 'Must be a number between 0 and 1'; }
  },
  {
    key: 'ROUTER_MIN_SAMPLES',
    displayName: 'Router Min Samples',
    description: "Minimum real benchmark observations a task type needs before model='auto' trusts and uses its matrix recommendation. Below it, 'auto' inherits the parent model. Raising the bar = more conservative routing; the bar is met as MODEL_ROUTER_RECORD accumulates data.",
    type: 'number',
    category: 'model_router',
    default: '3',
    validation: (v) => { const n = Number(v); return (Number.isInteger(n) && n >= 1) || 'Must be a positive integer'; }
  },
  {
    key: 'MODEL_ROUTER_EXPLORATION',
    displayName: 'Router Exploration (Thompson)',
    description: "Opt-in explore/exploit for model='auto'. When ON, the router draws a posterior sample per model and routes to the sampled-argmax — giving thinly-sampled models a chance so the matrix stops being self-confirming. When OFF (default), routing is the conservative greedy trust-gated pick. Pair with MODEL_ROUTER_EXCLUDE to keep exploration off banned models.",
    type: 'boolean',
    category: 'model_router',
    default: 'false'
  },
  {
    key: 'MODEL_ROUTER_EXCLUDE',
    displayName: 'Router Exclude List',
    description: "Comma-separated model IDs the router must NEVER auto-select (cost/policy bans). An entry ending in '*' is a prefix wildcard. Defaults to 'grok*' so router exploration can never auto-route a sub-agent to any xAI model (honors the standing cost constraint). Applies to exploration routing.",
    type: 'string',
    category: 'model_router',
    default: 'grok*'
  },

  // ============================================
  // AGENT TEAM WORKSPACE
  // ============================================
  {
    key: 'AGENT_TMUX_MONITOR',
    displayName: 'Agent Tmux Monitor',
    description: 'Enable tmux visual monitoring for parallel agent teams. Creates a tmux session with one pane per agent showing live progress.',
    type: 'boolean',
    category: 'agent_workspace',
    default: 'false'
  },

  // ============================================
  // MISSING API KEYS (already in interface, now in metadata)
  // ============================================
  {
    key: 'GEMINI_API_KEY',
    displayName: 'Gemini API Key',
    description: 'Preferred API key for Gemini models (takes priority over GOOGLE_API_KEY)',
    type: 'secret',
    category: 'api_keys',
    secret: true,
    validation: (val) => val.startsWith('AIza') || 'Must start with AIza'
  },
  {
    key: 'NVIDIA_API_KEY',
    displayName: 'Nvidia API Key',
    description: 'API key for Nvidia models',
    type: 'secret',
    category: 'api_keys',
    secret: true
  },

  // ============================================
  // MISSING MENTORSHIP (already in interface/defaults, now in metadata)
  // ============================================
  {
    key: 'MENTORSHIP_ACTIVE_DISCOVERY',
    displayName: 'Active Discovery',
    description: 'Enable guidance that encourages thorough file reading before acting',
    type: 'boolean',
    category: 'mentorship',
    default: 'false'
  },
  {
    key: 'WEB_TOOLS_MODEL',
    displayName: 'Web Tools Model',
    description: 'Model backing WebSearch/WebFetch. Provider auto-detected from ID. Empty = auto-pick.',
    type: 'string',
    category: 'models',
    default: ''
  },

  // ============================================
  // ENDTURN GATE / TRAINING SUBSTRATE
  // ============================================
  {
    key: 'CORTEX_ENDTURN_GATE',
    displayName: 'EndTurn Gate',
    description: 'Mandatory EndTurn pre-delivery self-audit + Stage 2/3 verifiers. ON = graded training records.',
    type: 'boolean',
    category: 'training',
    default: 'false'
  },
  {
    key: 'CORTEX_ENDTURN_GATE',
    displayName: 'EndTurn Gate (alias)',
    description: 'Alias for CORTEX_ENDTURN_GATE. Code checks both — set together.',
    type: 'boolean',
    category: 'training',
    default: 'false'
  },
  {
    key: 'CORTEX_TOOL_PROFILE',
    displayName: 'Tool Profile',
    description: 'Tool-surface experiment arm: full (all tools), lean (essential tier only), bash-only (Bash + interaction). Stamped into decision/router records for the tool-profile A/B.',
    type: 'choice',
    category: 'training',
    choices: ['full', 'lean', 'bash-only'],
    default: 'full'
  },

  // ============================================
  // DECISION STORE
  // ============================================
  {
    key: 'CORTEX_RECORD_DECISIONS',
    displayName: 'Record Decisions',
    description: 'Append each tool decision to .cortex/decisions.jsonl for prior-recall',
    type: 'boolean',
    category: 'training',
    default: 'true'
  },
  {
    key: 'CORTEX_LOOKUP_PRIOR_DECISIONS',
    displayName: 'Lookup Prior Decisions',
    description: 'Inject prior decisions as a system-reminder before tool use',
    type: 'boolean',
    category: 'training',
    default: 'true'
  },
  {
    key: 'CORTEX_DECISIONS_MAX_BYTES',
    displayName: 'Decision File Cap',
    description: 'decisions.jsonl rotation cap in bytes (default 2 MB)',
    type: 'number',
    category: 'training',
    default: '2097152',
    validation: (val) => {
      const num = parseInt(val);
      return (!isNaN(num) && num > 0) || 'Must be a positive integer';
    }
  },

  // ============================================
  // RUNTIME FLAGS
  // ============================================
  {
    key: 'CORTEX_MODE',
    displayName: 'Orchestrator Mode',
    description: 'Orchestrator lifecycle: persistent (default), stateless (clean per request), server',
    type: 'choice',
    category: 'runtime',
    choices: ['persistent', 'stateless', 'server'],
    default: 'persistent'
  },
  {
    key: 'CORTEX_UPDATE_POLICY',
    displayName: 'Update Policy',
    description: 'On a newer release: auto (warn when interactive, error when programmatic), off (never check), warn (notice only), error (exit non-zero), force (auto-update then continue)',
    type: 'choice',
    category: 'runtime',
    choices: ['auto', 'off', 'warn', 'error', 'force'],
    default: 'auto'
  },
  {
    key: 'YOLO',
    displayName: 'YOLO Mode',
    description: 'Auto-approve ALL tool executions (bypasses permissions). Use with caution.',
    type: 'boolean',
    category: 'runtime',
    default: 'false'
  },
  {
    key: 'AUTO_RESUME',
    displayName: 'Auto Resume',
    description: 'Auto-resume last session on startup',
    type: 'boolean',
    category: 'runtime',
    default: 'false'
  },
  {
    key: 'PORT',
    displayName: 'Server Port',
    description: 'HTTP server port (default 4000)',
    type: 'number',
    category: 'runtime',
    default: '4000',
    validation: (val) => {
      const num = parseInt(val);
      return (!isNaN(num) && num >= 1 && num <= 65535) || 'Must be 1-65535';
    }
  },
  {
    key: 'CORTEX_SERVER_URL',
    displayName: 'Server URL',
    description: 'Server URL for HTTP client mode',
    type: 'string',
    category: 'runtime',
    default: 'http://localhost:4000'
  },
  {
    key: 'DEBUG_PAYLOAD',
    displayName: 'Debug Payloads',
    description: 'Show raw API request/response payloads',
    type: 'boolean',
    category: 'system',
    default: 'false'
  },
  {
    key: 'DEBUG_THINKING',
    displayName: 'Debug Thinking',
    description: 'Show thinking/reasoning block content in CLI output',
    type: 'boolean',
    category: 'system',
    default: 'false'
  },
  {
    key: 'ENABLE_SMOKE_TESTS',
    displayName: 'Smoke Tests',
    description: 'Enable real API smoke tests instead of mocked',
    type: 'boolean',
    category: 'system',
    default: 'false'
  },

  // ============================================
  // GIT / PR ACCESS CONTROL
  // ============================================
  {
    key: 'GIT_ALLOWED_REPOS',
    displayName: 'Git Allowed Repos',
    description:
      'Comma list of owner/repo the git/PR tools may touch (supports owner/* and *). Unset = all repos allowed (with a startup warning). Input validation is always enforced.',
    type: 'string',
    category: 'runtime',
    default: ''
  },
  {
    key: 'GIT_ALLOWED_ACTIONS',
    displayName: 'Git Allowed Actions',
    description:
      'Comma list of allowed git/PR actions: review,list,create,post-review,clone,worktree,diff,cleanup,status. Unset = all.',
    type: 'string',
    category: 'runtime',
    default: ''
  },
  {
    key: 'GIT_AUTH_TOKEN',
    displayName: 'Git Auth Token',
    description:
      'Token for gh/git operations. Injected into the subprocess env as GH_TOKEN/GITHUB_TOKEN only — never on argv or in a URL.',
    type: 'string',
    category: 'runtime',
    default: ''
  },
  {
    key: 'GIT_HOST',
    displayName: 'Git Host',
    description: 'GitHub (Enterprise) host for git/PR tools.',
    type: 'string',
    category: 'runtime',
    default: 'github.com'
  },
  {
    key: 'GITHUB_WEBHOOK_SECRET',
    displayName: 'GitHub Webhook Secret',
    description:
      'HMAC secret for /v1/pr/webhook (X-Hub-Signature-256). Unset = webhook disabled (401).',
    type: 'string',
    category: 'runtime',
    default: ''
  },
];

/**
 * Get settings by category
 */
export function getSettingsByCategory(category: SettingMetadata['category']): SettingMetadata[] {
  return SETTINGS_METADATA.filter(s => s.category === category);
}

/**
 * Get setting metadata by key
 */
export function getSettingMetadata(key: keyof EnvironmentVariables): SettingMetadata | undefined {
  return SETTINGS_METADATA.find(s => s.key === key);
}

/**
 * Validate setting value
 */
export function validateSetting(key: keyof EnvironmentVariables, value: string): true | string {
  const metadata = getSettingMetadata(key);
  if (!metadata) return true;

  if (metadata.validation) {
    return metadata.validation(value);
  }

  if (metadata.type === 'boolean') {
    if (value !== 'true' && value !== 'false') {
      return 'Must be true or false';
    }
  }

  if (metadata.type === 'number') {
    if (isNaN(parseInt(value))) {
      return 'Must be a number';
    }
  }

  if (metadata.type === 'choice' && metadata.choices) {
    if (!metadata.choices.includes(value)) {
      return `Must be one of: ${metadata.choices.join(', ')}`;
    }
  }

  return true;
}
