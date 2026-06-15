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
  // CONTEXT MANAGEMENT
  // ============================================

  /** Context budget strategy */
  CONTEXT_BUDGET_STRATEGY?: string; // 'sliding-window' | 'priority-based'

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
  DEFAULT_MODEL_ID: 'deepseek-v4-pro',
  HELPER_MODEL_ID: 'deepseek-v4-flash',

  // System Settings
  DEBUG: 'false',
  PROJECT_PATH: process.cwd(),
  USE_EMOJI: 'false',

  // Reactive Mentorship
  MENTORSHIP_ENABLED: 'false',
  MENTORSHIP_TRIGGER_ON_ERROR: 'true',
  MENTORSHIP_ERROR_THRESHOLD: 'medium',
  MENTORSHIP_KEYWORDS_ENABLED: 'false',
  MENTORSHIP_CUSTOM_KEYWORDS: '',
  MENTORSHIP_HELPER_MODEL: 'deepseek-v4-flash',
  MENTORSHIP_TURN_BASED_ENABLED: 'false',
  MENTORSHIP_TURN_INTERVAL: '10',
  MENTORSHIP_INTERLEAVED_THINKING: 'false',
  MENTORSHIP_PATTERN_DETECTION: 'false',
  MENTORSHIP_PATTERN_THRESHOLD: '3',
  MENTORSHIP_ACTIVE_DISCOVERY: 'false',

  // Turn Summary & Prediction
  TURN_SUMMARY_PREDICTION: 'false',

  // Context Management
  CONTEXT_BUDGET_STRATEGY: 'priority-based',
  // Session Configuration
  SESSION_STORAGE_DIR: '.cortex/sessions',
  MCP_AUTO_INJECT: 'false',
  AUTORESEARCH_AGENTS: 'off',
  SYSTEM_MESSAGE_DOC_MAX_BYTES: '0',

  // Loop Control
  MAX_TOOL_ITERATIONS: '50',
  MAX_CONSECUTIVE_ERRORS: '3',
  TOOL_BUDGET_SOFT: '15',
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

  // Model Router
  MODEL_ROUTER_ENABLED: 'false',
  MODEL_ROUTER_STRATEGY: 'auto',
  MODEL_ROUTER_RECORD: 'true',
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
    default: 'deepseek-v4-pro'
  },
  {
    key: 'HELPER_MODEL_ID',
    displayName: 'Helper Model',
    description: 'Model for context management and summarization (any registered model ID)',
    type: 'string',
    category: 'models',
    default: 'deepseek-v4-flash'
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
    default: 'false'
  },
  {
    key: 'MENTORSHIP_TRIGGER_ON_ERROR',
    displayName: 'Error-Triggered Mentorship',
    description: 'Automatically trigger mentorship on tool errors',
    type: 'boolean',
    category: 'mentorship',
    default: 'true'
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
    default: 'deepseek-v4-flash'
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
  // CONTEXT MANAGEMENT
  // ============================================
  {
    key: 'CONTEXT_BUDGET_STRATEGY',
    displayName: 'Context Budget Strategy',
    description: 'Strategy when context overflows (priority-based preserves critical context + tool pairs; sliding-window is dumb recency and can orphan tool_use → Anthropic 400)',
    type: 'choice',
    category: 'context',
    choices: ['sliding-window', 'priority-based'],
    default: 'priority-based'
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

  // ============================================
  // LOOP CONTROL
  // ============================================
  {
    key: 'MAX_TOOL_ITERATIONS',
    displayName: 'Max Tool Iterations',
    description: 'Maximum tool execution iterations per turn',
    type: 'number',
    category: 'loop_control',
    default: '50'
  },
  {
    key: 'MAX_CONSECUTIVE_ERRORS',
    displayName: 'Max Consecutive Errors',
    description: 'Maximum consecutive tool errors before stopping',
    type: 'number',
    category: 'loop_control',
    default: '3'
  },
  {
    key: 'TOOL_BUDGET_SOFT',
    displayName: 'Soft Tool Budget',
    description: 'Tool calls per turn before escalating firm "synthesize now" reminders (1x and 1.5x); a hard force-synthesis cap fires at 2x. Brakes runaway exploration by weaker models on vague prompts.',
    type: 'number',
    category: 'loop_control',
    default: '15'
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
    description: 'Load only essential tools upfront; discover others on-demand via search_tools. Reduces token cost per request.',
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
    default: 'true'
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
