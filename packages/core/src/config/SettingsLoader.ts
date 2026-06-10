/**
 * Settings Loader
 *
 * Loads and writes configuration to .env file and creates OrchestratorConfig.
 * Supports both reading and writing settings while preserving comments and formatting.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { OrchestratorConfig } from '../orchestrator/CortexOrchestrator.js';
import type { EnvironmentVariables } from './SettingsSchema.js';
import { DEFAULT_SETTINGS, validateSetting, getSettingMetadata } from './SettingsSchema.js';

/**
 * Result of a write operation
 */
export interface WriteResult {
  success: boolean;
  error?: string;
  previousValue?: string;
  newValue: string;
}

/**
 * Parse .env file content into key-value pairs
 */
export function parseEnvFile(content: string): EnvironmentVariables {
  const env: EnvironmentVariables = {};
  const lines = content.split('\n');

  for (const line of lines) {
    // Skip empty lines and comments
    if (!line.trim() || line.trim().startsWith('#')) {
      continue;
    }

    // Parse KEY=VALUE
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (match && match[2] !== undefined) {
      const key = match[1] as keyof EnvironmentVariables;
      let value = match[2].trim();

      // Remove quotes if present
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }

      env[key] = value;
    }
  }

  return env;
}

/**
 * Load .env file from project root
 */
export function loadEnvFile(projectPath: string = process.cwd()): EnvironmentVariables {
  const envPath = path.join(projectPath, '.env');

  if (!fs.existsSync(envPath)) {
    console.log(`[SettingsLoader] No .env file found at ${envPath}, using defaults`);
    return {};
  }

  try {
    const content = fs.readFileSync(envPath, 'utf-8');
    return parseEnvFile(content);
  } catch (error: any) {
    console.error(`[SettingsLoader] Error reading .env file: ${error.message}`);
    return {};
  }
}

/**
 * Update a single setting in the .env file while preserving comments and formatting
 */
export function writeEnvSetting(
  projectPath: string,
  key: keyof EnvironmentVariables,
  value: string
): WriteResult {
  const envPath = path.join(projectPath, '.env');

  // Validate the setting if metadata exists
  const metadata = getSettingMetadata(key);
  if (metadata) {
    const validation = validateSetting(key, value);
    if (validation !== true) {
      return {
        success: false,
        error: validation,
        newValue: value
      };
    }
  }

  let content: string;
  let previousValue: string | undefined;

  try {
    if (fs.existsSync(envPath)) {
      content = fs.readFileSync(envPath, 'utf-8');
    } else {
      // Create new .env file with header
      content = `# Nexus Cortex Configuration\n# Generated ${new Date().toISOString()}\n\n`;
    }
  } catch (error: any) {
    return {
      success: false,
      error: `Failed to read .env file: ${error.message}`,
      newValue: value
    };
  }

  // Parse to find existing value
  const env = parseEnvFile(content);
  previousValue = env[key];

  // Check if key exists in file
  const keyRegex = new RegExp(`^${key}=.*$`, 'm');
  const keyExists = keyRegex.test(content);

  // Quote value if it contains spaces or special characters
  const needsQuotes = /[\s#'"\\]/.test(value) || value.includes('=');
  const formattedValue = needsQuotes ? `"${value.replace(/"/g, '\\"')}"` : value;

  let newContent: string;

  if (keyExists) {
    // Replace existing line
    newContent = content.replace(keyRegex, `${key}=${formattedValue}`);
  } else {
    // Add new setting
    // Try to add it in the appropriate category based on metadata
    const section = metadata?.category;

    if (section) {
      // Look for section comment
      const sectionComment = `# ${section}`;
      const sectionIndex = content.indexOf(sectionComment);

      if (sectionIndex !== -1) {
        // Find the end of the section (next section comment or end of file)
        const nextSectionMatch = content.slice(sectionIndex + sectionComment.length).match(/\n#\s*[A-Z]/);
        let insertIndex: number;

        if (nextSectionMatch && nextSectionMatch.index !== undefined) {
          insertIndex = sectionIndex + sectionComment.length + nextSectionMatch.index;
        } else {
          // Add at end of file
          insertIndex = content.length;
        }

        // Insert before next section or at end
        const beforeInsert = content.slice(0, insertIndex).trimEnd();
        const afterInsert = content.slice(insertIndex);
        newContent = `${beforeInsert}\n${key}=${formattedValue}${afterInsert.startsWith('\n') ? '' : '\n'}${afterInsert}`;
      } else {
        // Section doesn't exist, add at end with section comment
        const sectionHeader = `\n# ${section}\n`;
        newContent = content.trimEnd() + sectionHeader + `${key}=${formattedValue}\n`;
      }
    } else {
      // No section info, add at end
      newContent = content.trimEnd() + `\n${key}=${formattedValue}\n`;
    }
  }

  try {
    fs.writeFileSync(envPath, newContent, 'utf-8');
    return {
      success: true,
      previousValue,
      newValue: value
    };
  } catch (error: any) {
    return {
      success: false,
      error: `Failed to write .env file: ${error.message}`,
      previousValue,
      newValue: value
    };
  }
}

/**
 * Update multiple settings in the .env file
 */
export function writeEnvSettings(
  projectPath: string,
  settings: Partial<EnvironmentVariables>
): Record<string, WriteResult> {
  const results: Record<string, WriteResult> = {};

  for (const [key, value] of Object.entries(settings)) {
    if (value !== undefined) {
      results[key] = writeEnvSetting(
        projectPath,
        key as keyof EnvironmentVariables,
        value
      );
    }
  }

  return results;
}

/**
 * Get Google/Gemini API key with proper fallback
 * Priority: GEMINI_API_KEY (recommended by Google) -> GOOGLE_API_KEY (legacy)
 *
 * @returns The API key to use for Google/Gemini models
 */
export function getGoogleApiKey(): string {
  return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
}

/**
 * Merge environment variables with defaults
 */
export function mergeWithDefaults(env: EnvironmentVariables): Required<EnvironmentVariables> {
  // Apply Google/Gemini API key fallback to process.env for backward compatibility
  // Priority: GEMINI_API_KEY (recommended) -> GOOGLE_API_KEY (legacy)
  if (!process.env.GEMINI_API_KEY && process.env.GOOGLE_API_KEY) {
    process.env.GEMINI_API_KEY = process.env.GOOGLE_API_KEY;
  }

  return {
    // API Keys (no defaults, use empty string if not set)
    ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY || '',
    OPENAI_API_KEY: env.OPENAI_API_KEY || process.env.OPENAI_API_KEY || '',
    GOOGLE_API_KEY: env.GOOGLE_API_KEY || process.env.GOOGLE_API_KEY || '',
    GEMINI_API_KEY: env.GEMINI_API_KEY || process.env.GEMINI_API_KEY || '',
    XAI_API_KEY: env.XAI_API_KEY || process.env.XAI_API_KEY || '',
    DEEPSEEK_API_KEY: env.DEEPSEEK_API_KEY || process.env.DEEPSEEK_API_KEY || '',
    INCEPTION_API_KEY: env.INCEPTION_API_KEY || process.env.INCEPTION_API_KEY || '',
    DASHSCOPE_API_KEY: env.DASHSCOPE_API_KEY || process.env.DASHSCOPE_API_KEY || '',
    ZHIPU_API_KEY: env.ZHIPU_API_KEY || process.env.ZHIPU_API_KEY || '',
    MOONSHOT_API_KEY: env.MOONSHOT_API_KEY || process.env.MOONSHOT_API_KEY || '',
    MINIMAX_API_KEY: env.MINIMAX_API_KEY || process.env.MINIMAX_API_KEY || '',
    CLOUDFLARE_API_TOKEN: env.CLOUDFLARE_API_TOKEN || process.env.CLOUDFLARE_API_TOKEN || '',
    CLOUDFLARE_ACCOUNT_ID: env.CLOUDFLARE_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID || '',
    NVIDIA_API_KEY: env.NVIDIA_API_KEY || process.env.NVIDIA_API_KEY || '',

    // Anthropic Authentication
    ANTHROPIC_AUTH_METHOD: env.ANTHROPIC_AUTH_METHOD || process.env.ANTHROPIC_AUTH_METHOD || DEFAULT_SETTINGS.ANTHROPIC_AUTH_METHOD,
    CLAUDE_CODE_OAUTH_TOKEN: env.CLAUDE_CODE_OAUTH_TOKEN || process.env.CLAUDE_CODE_OAUTH_TOKEN || '',

    // Prompt Caching
    ANTHROPIC_PROMPT_CACHING: env.ANTHROPIC_PROMPT_CACHING || process.env.ANTHROPIC_PROMPT_CACHING || DEFAULT_SETTINGS.ANTHROPIC_PROMPT_CACHING,

    // Model Configuration
    DEFAULT_MODEL_ID: env.DEFAULT_MODEL_ID || DEFAULT_SETTINGS.DEFAULT_MODEL_ID,
    HELPER_MODEL_ID: env.HELPER_MODEL_ID || DEFAULT_SETTINGS.HELPER_MODEL_ID,

    // System Settings
    DEBUG: env.DEBUG || DEFAULT_SETTINGS.DEBUG,
    USE_EMOJI: env.USE_EMOJI || DEFAULT_SETTINGS.USE_EMOJI,
    PROJECT_PATH: env.PROJECT_PATH || DEFAULT_SETTINGS.PROJECT_PATH,

    // Reactive Mentorship
    MENTORSHIP_ENABLED: env.MENTORSHIP_ENABLED || DEFAULT_SETTINGS.MENTORSHIP_ENABLED,
    MENTORSHIP_TRIGGER_ON_ERROR: env.MENTORSHIP_TRIGGER_ON_ERROR || DEFAULT_SETTINGS.MENTORSHIP_TRIGGER_ON_ERROR,
    MENTORSHIP_ERROR_THRESHOLD: env.MENTORSHIP_ERROR_THRESHOLD || DEFAULT_SETTINGS.MENTORSHIP_ERROR_THRESHOLD,
    MENTORSHIP_KEYWORDS_ENABLED: env.MENTORSHIP_KEYWORDS_ENABLED || DEFAULT_SETTINGS.MENTORSHIP_KEYWORDS_ENABLED,
    MENTORSHIP_CUSTOM_KEYWORDS: env.MENTORSHIP_CUSTOM_KEYWORDS || DEFAULT_SETTINGS.MENTORSHIP_CUSTOM_KEYWORDS,
    MENTORSHIP_HELPER_MODEL: env.MENTORSHIP_HELPER_MODEL || DEFAULT_SETTINGS.MENTORSHIP_HELPER_MODEL,
    MENTORSHIP_TURN_BASED_ENABLED: env.MENTORSHIP_TURN_BASED_ENABLED || DEFAULT_SETTINGS.MENTORSHIP_TURN_BASED_ENABLED,
    MENTORSHIP_TURN_INTERVAL: env.MENTORSHIP_TURN_INTERVAL || DEFAULT_SETTINGS.MENTORSHIP_TURN_INTERVAL,
    MENTORSHIP_INTERLEAVED_THINKING: env.MENTORSHIP_INTERLEAVED_THINKING || DEFAULT_SETTINGS.MENTORSHIP_INTERLEAVED_THINKING,
    MENTORSHIP_PATTERN_DETECTION: env.MENTORSHIP_PATTERN_DETECTION || DEFAULT_SETTINGS.MENTORSHIP_PATTERN_DETECTION,
    MENTORSHIP_PATTERN_THRESHOLD: env.MENTORSHIP_PATTERN_THRESHOLD || DEFAULT_SETTINGS.MENTORSHIP_PATTERN_THRESHOLD,
    MENTORSHIP_ACTIVE_DISCOVERY: env.MENTORSHIP_ACTIVE_DISCOVERY || DEFAULT_SETTINGS.MENTORSHIP_ACTIVE_DISCOVERY,

    // Turn Summary & Prediction
    TURN_SUMMARY_PREDICTION: env.TURN_SUMMARY_PREDICTION || DEFAULT_SETTINGS.TURN_SUMMARY_PREDICTION,

    // Context Management
    CONTEXT_BUDGET_STRATEGY: env.CONTEXT_BUDGET_STRATEGY || DEFAULT_SETTINGS.CONTEXT_BUDGET_STRATEGY,

    // Session Configuration
    SESSION_STORAGE_DIR: env.SESSION_STORAGE_DIR || DEFAULT_SETTINGS.SESSION_STORAGE_DIR,
    MCP_AUTO_INJECT: env.MCP_AUTO_INJECT || DEFAULT_SETTINGS.MCP_AUTO_INJECT,
    SYSTEM_MESSAGE_DOC_MAX_BYTES: env.SYSTEM_MESSAGE_DOC_MAX_BYTES || DEFAULT_SETTINGS.SYSTEM_MESSAGE_DOC_MAX_BYTES,

    // Loop Control
    MAX_TOOL_ITERATIONS: env.MAX_TOOL_ITERATIONS || DEFAULT_SETTINGS.MAX_TOOL_ITERATIONS,
    MAX_CONSECUTIVE_ERRORS: env.MAX_CONSECUTIVE_ERRORS || DEFAULT_SETTINGS.MAX_CONSECUTIVE_ERRORS,
    TOOL_BUDGET_SOFT: env.TOOL_BUDGET_SOFT || DEFAULT_SETTINGS.TOOL_BUDGET_SOFT,
    TOOL_TIMEOUT_MS: env.TOOL_TIMEOUT_MS || DEFAULT_SETTINGS.TOOL_TIMEOUT_MS,
    MAX_LOOP_REPETITIONS: env.MAX_LOOP_REPETITIONS || DEFAULT_SETTINGS.MAX_LOOP_REPETITIONS,

    // Web Tools
    WEB_TOOLS_MODEL: env.WEB_TOOLS_MODEL || process.env.WEB_TOOLS_MODEL || DEFAULT_SETTINGS.WEB_TOOLS_MODEL,

    // Server-Side Tools
    ENABLE_SERVER_SIDE_TOOLS: env.ENABLE_SERVER_SIDE_TOOLS || process.env.ENABLE_SERVER_SIDE_TOOLS || DEFAULT_SETTINGS.ENABLE_SERVER_SIDE_TOOLS,
    XAI_API_MODE: env.XAI_API_MODE || process.env.XAI_API_MODE || DEFAULT_SETTINGS.XAI_API_MODE,
    OPENAI_API_MODE: env.OPENAI_API_MODE || process.env.OPENAI_API_MODE || DEFAULT_SETTINGS.OPENAI_API_MODE,

    // Agent Team Monitoring
    AGENT_TMUX_MONITOR: env.AGENT_TMUX_MONITOR || process.env.AGENT_TMUX_MONITOR || DEFAULT_SETTINGS.AGENT_TMUX_MONITOR,

    // PTC / Code Execution / Deferred Loading
    ENABLE_PTC: env.ENABLE_PTC || process.env.ENABLE_PTC || DEFAULT_SETTINGS.ENABLE_PTC,
    ENABLE_LOCAL_CODE_EXECUTION: env.ENABLE_LOCAL_CODE_EXECUTION || process.env.ENABLE_LOCAL_CODE_EXECUTION || DEFAULT_SETTINGS.ENABLE_LOCAL_CODE_EXECUTION,
    ENABLE_DEFERRED_TOOL_LOADING: env.ENABLE_DEFERRED_TOOL_LOADING || process.env.ENABLE_DEFERRED_TOOL_LOADING || DEFAULT_SETTINGS.ENABLE_DEFERRED_TOOL_LOADING,

    // Model Router
    MODEL_ROUTER_ENABLED: env.MODEL_ROUTER_ENABLED || process.env.MODEL_ROUTER_ENABLED || DEFAULT_SETTINGS.MODEL_ROUTER_ENABLED,
    MODEL_ROUTER_STRATEGY: env.MODEL_ROUTER_STRATEGY || process.env.MODEL_ROUTER_STRATEGY || DEFAULT_SETTINGS.MODEL_ROUTER_STRATEGY,
    MODEL_ROUTER_RECORD: env.MODEL_ROUTER_RECORD || process.env.MODEL_ROUTER_RECORD || DEFAULT_SETTINGS.MODEL_ROUTER_RECORD,
    ROUTER_MIN_CONFIDENCE: env.ROUTER_MIN_CONFIDENCE || process.env.ROUTER_MIN_CONFIDENCE || DEFAULT_SETTINGS.ROUTER_MIN_CONFIDENCE,
    ROUTER_MIN_SAMPLES: env.ROUTER_MIN_SAMPLES || process.env.ROUTER_MIN_SAMPLES || DEFAULT_SETTINGS.ROUTER_MIN_SAMPLES,
    MODEL_ROUTER_EXPLORATION: env.MODEL_ROUTER_EXPLORATION || process.env.MODEL_ROUTER_EXPLORATION || DEFAULT_SETTINGS.MODEL_ROUTER_EXPLORATION,
    MODEL_ROUTER_EXCLUDE: env.MODEL_ROUTER_EXCLUDE ?? process.env.MODEL_ROUTER_EXCLUDE ?? DEFAULT_SETTINGS.MODEL_ROUTER_EXCLUDE,

    // Endturn Gate / Training
    CORTEX_ENDTURN_GATE: env.CORTEX_ENDTURN_GATE || process.env.CORTEX_ENDTURN_GATE || DEFAULT_SETTINGS.CORTEX_ENDTURN_GATE,

    // Decision Store
    CORTEX_RECORD_DECISIONS: env.CORTEX_RECORD_DECISIONS || process.env.CORTEX_RECORD_DECISIONS || DEFAULT_SETTINGS.CORTEX_RECORD_DECISIONS,
    CORTEX_LOOKUP_PRIOR_DECISIONS: env.CORTEX_LOOKUP_PRIOR_DECISIONS || process.env.CORTEX_LOOKUP_PRIOR_DECISIONS || DEFAULT_SETTINGS.CORTEX_LOOKUP_PRIOR_DECISIONS,
    CORTEX_DECISIONS_MAX_BYTES: env.CORTEX_DECISIONS_MAX_BYTES || process.env.CORTEX_DECISIONS_MAX_BYTES || DEFAULT_SETTINGS.CORTEX_DECISIONS_MAX_BYTES,

    // Runtime
    CORTEX_MODE: env.CORTEX_MODE || DEFAULT_SETTINGS.CORTEX_MODE,
    YOLO: env.YOLO || process.env.YOLO || DEFAULT_SETTINGS.YOLO,
    AUTO_RESUME: env.AUTO_RESUME || process.env.AUTO_RESUME || DEFAULT_SETTINGS.AUTO_RESUME,
    PORT: env.PORT || process.env.PORT || DEFAULT_SETTINGS.PORT,
    CORTEX_SERVER_URL: env.CORTEX_SERVER_URL || DEFAULT_SETTINGS.CORTEX_SERVER_URL,
    DEBUG_PAYLOAD: env.DEBUG_PAYLOAD || process.env.DEBUG_PAYLOAD || DEFAULT_SETTINGS.DEBUG_PAYLOAD,
    DEBUG_THINKING: env.DEBUG_THINKING || process.env.DEBUG_THINKING || DEFAULT_SETTINGS.DEBUG_THINKING,
    ENABLE_SMOKE_TESTS: env.ENABLE_SMOKE_TESTS || process.env.ENABLE_SMOKE_TESTS || DEFAULT_SETTINGS.ENABLE_SMOKE_TESTS,

    // Git / PR access control
    GIT_ALLOWED_REPOS: env.GIT_ALLOWED_REPOS || process.env.GIT_ALLOWED_REPOS || DEFAULT_SETTINGS.GIT_ALLOWED_REPOS,
    GIT_ALLOWED_ACTIONS: env.GIT_ALLOWED_ACTIONS || process.env.GIT_ALLOWED_ACTIONS || DEFAULT_SETTINGS.GIT_ALLOWED_ACTIONS,
    GIT_AUTH_TOKEN: env.GIT_AUTH_TOKEN || process.env.GIT_AUTH_TOKEN || '',
    GIT_HOST: env.GIT_HOST || process.env.GIT_HOST || DEFAULT_SETTINGS.GIT_HOST,
    GITHUB_WEBHOOK_SECRET: env.GITHUB_WEBHOOK_SECRET || process.env.GITHUB_WEBHOOK_SECRET || '',
  };
}

/**
 * Convert environment variables to OrchestratorConfig
 */
export function envToOrchestratorConfig(env: Required<EnvironmentVariables>): OrchestratorConfig {
  const config: OrchestratorConfig = {
    // Required fields
    defaultModelId: env.DEFAULT_MODEL_ID,
    projectPath: env.PROJECT_PATH,

    // Optional fields
    debug: env.DEBUG === 'true',
    storageDir: env.SESSION_STORAGE_DIR,

    // Reactive Mentorship
    reactiveMentorship: env.MENTORSHIP_ENABLED === 'true' ? {
      enabled: true,
      triggerOnError: env.MENTORSHIP_TRIGGER_ON_ERROR === 'true',
      errorSeverityThreshold: env.MENTORSHIP_ERROR_THRESHOLD as 'low' | 'medium' | 'high',
      enableKeywords: env.MENTORSHIP_KEYWORDS_ENABLED === 'true',
      customKeywords: env.MENTORSHIP_CUSTOM_KEYWORDS
        ? env.MENTORSHIP_CUSTOM_KEYWORDS.split(',').map(k => k.trim()).filter(k => k)
        : undefined,
      helperModelId: env.MENTORSHIP_HELPER_MODEL,
      turnBasedEnabled: env.MENTORSHIP_TURN_BASED_ENABLED === 'true',
      turnInterval: parseInt(env.MENTORSHIP_TURN_INTERVAL),
      interleavedThinking: env.MENTORSHIP_INTERLEAVED_THINKING === 'true',
      patternDetection: env.MENTORSHIP_PATTERN_DETECTION === 'true',
      patternThreshold: parseInt(env.MENTORSHIP_PATTERN_THRESHOLD),
      activeDiscovery: env.MENTORSHIP_ACTIVE_DISCOVERY === 'true'
    } : undefined,

    // Loop Control (inline detection)
    loopControl: {
      maxToolIterations: parseInt(env.MAX_TOOL_ITERATIONS),
      maxConsecutiveErrors: parseInt(env.MAX_CONSECUTIVE_ERRORS),
      toolBudgetSoft: parseInt(env.TOOL_BUDGET_SOFT),
      toolTimeoutMs: parseInt(env.TOOL_TIMEOUT_MS),
      maxLoopRepetitions: parseInt(env.MAX_LOOP_REPETITIONS)
    }
  };

  return config;
}

/**
 * Load OrchestratorConfig from .env file
 */
export function loadOrchestratorConfig(projectPath: string = process.cwd()): OrchestratorConfig {
  const env = loadEnvFile(projectPath);
  const mergedEnv = mergeWithDefaults(env);
  return envToOrchestratorConfig(mergedEnv);
}

/**
 * Settings Loader Class
 */
export class SettingsLoader {
  private projectPath: string;
  private env: Required<EnvironmentVariables>;

  constructor(projectPath: string = process.cwd()) {
    this.projectPath = projectPath;
    this.env = mergeWithDefaults(loadEnvFile(projectPath));
  }

  /**
   * Get full environment variables
   */
  getEnvironment(): Required<EnvironmentVariables> {
    return { ...this.env };
  }

  /**
   * Get specific environment variable
   */
  get<K extends keyof EnvironmentVariables>(key: K): string {
    return this.env[key as keyof Required<EnvironmentVariables>];
  }

  /**
   * Get OrchestratorConfig
   */
  getOrchestratorConfig(): OrchestratorConfig {
    return envToOrchestratorConfig(this.env);
  }

  /**
   * Check if API key is configured
   */
  hasApiKey(provider: 'anthropic' | 'openai' | 'google' | 'xai' | 'deepseek'): boolean {
    const keyMap = {
      anthropic: 'ANTHROPIC_API_KEY',
      openai: 'OPENAI_API_KEY',
      google: 'GOOGLE_API_KEY',
      xai: 'XAI_API_KEY',
      deepseek: 'DEEPSEEK_API_KEY',
      mercury: 'INCEPTION_API_KEY',
      qwen: 'DASHSCOPE_API_KEY',
      zhipu: 'ZHIPU_API_KEY',
      moonshot: 'MOONSHOT_API_KEY',
      minimax: 'MINIMAX_API_KEY'
    };

    const key = keyMap[provider];

    // Special handling for Google: check both GEMINI_API_KEY and GOOGLE_API_KEY
    if (provider === 'google') {
      return this.getGoogleApiKey().length > 0;
    }

    return this.env[key as keyof Required<EnvironmentVariables>].length > 0;
  }

  /**
   * Get Google API key with proper fallback
   * Priority: GEMINI_API_KEY (recommended by Google) -> GOOGLE_API_KEY (legacy)
   */
  getGoogleApiKey(): string {
    return this.env.GEMINI_API_KEY || this.env.GOOGLE_API_KEY || '';
  }

  /**
   * Get configured API providers
   */
  getConfiguredProviders(): string[] {
    const providers: string[] = [];

    if (this.hasApiKey('anthropic')) providers.push('anthropic');
    if (this.hasApiKey('openai')) providers.push('openai');
    if (this.hasApiKey('google')) providers.push('google');
    if (this.hasApiKey('xai')) providers.push('xai');
    if (this.hasApiKey('deepseek')) providers.push('deepseek');

    return providers;
  }

  /**
   * Reload configuration from file
   */
  reload(): void {
    const env = loadEnvFile(this.projectPath);
    this.env = mergeWithDefaults(env);
  }

  /**
   * Set a single environment variable and persist to .env file
   */
  set<K extends keyof EnvironmentVariables>(key: K, value: string): WriteResult {
    const result = writeEnvSetting(this.projectPath, key, value);
    if (result.success) {
      // Update in-memory copy
      this.env[key as keyof Required<EnvironmentVariables>] = value;
    }
    return result;
  }

  /**
   * Set multiple environment variables and persist to .env file
   */
  setMultiple(settings: Partial<EnvironmentVariables>): Record<string, WriteResult> {
    const results = writeEnvSettings(this.projectPath, settings);

    // Update in-memory copy for successful writes
    for (const [key, result] of Object.entries(results)) {
      if (result.success) {
        this.env[key as keyof Required<EnvironmentVariables>] = result.newValue;
      }
    }

    return results;
  }

  /**
   * Reset a setting to its default value
   */
  resetToDefault<K extends keyof EnvironmentVariables>(key: K): WriteResult {
    const defaultValue = DEFAULT_SETTINGS[key as keyof typeof DEFAULT_SETTINGS];
    if (defaultValue === undefined) {
      return {
        success: false,
        error: `No default value for ${key}`,
        newValue: ''
      };
    }
    return this.set(key, defaultValue);
  }

  /**
   * Reset all settings to defaults
   */
  resetAllToDefaults(): Record<string, WriteResult> {
    const results: Record<string, WriteResult> = {};

    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
      results[key] = this.set(key as keyof EnvironmentVariables, value);
    }

    return results;
  }

  /**
   * Get configuration summary for display
   */
  getSummary(): {
    providers: string[];
    defaultModel: string;
    helperModel: string;
    mentorshipEnabled: boolean;
    debugEnabled: boolean;
    mentorship?: {
      triggerOnError: boolean;
      errorThreshold: string;
      keywordsEnabled: boolean;
      helperModel: string;
      turnBasedEnabled: boolean;
      turnInterval: number;
      interleavedThinking: boolean;
      patternDetection: boolean;
      patternThreshold: number;
      activeDiscovery: boolean;
    };
  } {
    const mentorshipEnabled = this.env.MENTORSHIP_ENABLED === 'true';

    return {
      providers: this.getConfiguredProviders(),
      defaultModel: this.env.DEFAULT_MODEL_ID,
      helperModel: this.env.HELPER_MODEL_ID,
      mentorshipEnabled,
      debugEnabled: this.env.DEBUG === 'true',
      mentorship: mentorshipEnabled ? {
        triggerOnError: this.env.MENTORSHIP_TRIGGER_ON_ERROR === 'true',
        errorThreshold: this.env.MENTORSHIP_ERROR_THRESHOLD,
        keywordsEnabled: this.env.MENTORSHIP_KEYWORDS_ENABLED === 'true',
        helperModel: this.env.MENTORSHIP_HELPER_MODEL,
        turnBasedEnabled: this.env.MENTORSHIP_TURN_BASED_ENABLED === 'true',
        turnInterval: parseInt(this.env.MENTORSHIP_TURN_INTERVAL),
        interleavedThinking: this.env.MENTORSHIP_INTERLEAVED_THINKING === 'true',
        patternDetection: this.env.MENTORSHIP_PATTERN_DETECTION === 'true',
        patternThreshold: parseInt(this.env.MENTORSHIP_PATTERN_THRESHOLD),
        activeDiscovery: this.env.MENTORSHIP_ACTIVE_DISCOVERY === 'true'
      } : undefined
    };
  }
}
