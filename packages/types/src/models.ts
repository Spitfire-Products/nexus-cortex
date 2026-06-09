/**
 * Model Configuration Type Definitions
 *
 * @packageDocumentation
 * @module @nexus-cortex/types/models
 *
 * This module contains model configuration types for the Nexus Cortex system,
 * providing comprehensive model configuration schema that drives all provider-specific behavior.
 *
 * Phase 1.5: Multi-Provider Architecture
 * Based on: CORTEX_V4_PHASE_1.5_ARCHITECTURE.md, Part 2.2
 */

/**
 * Model Configuration
 *
 * Complete configuration for a single model, including API details,
 * tool support, parameters, streaming, and compaction strategy.
 */
export interface ModelConfig {
  // ============================================
  // IDENTITY
  // ============================================

  /** Unique model identifier (e.g., "claude-3-5-sonnet-20241022") */
  id: string;

  /**
   * API model ID to send to provider (optional)
   * Use when registry ID differs from API model ID
   * e.g., registry id: "gpt-5.1-reasoning" -> modelId: "gpt-5.1"
   */
  modelId?: string;

  /** Provider name (e.g., "anthropic", "openai", "google") */
  provider: string;

  /** Display name for UI (e.g., "Claude 3.5 Sonnet") */
  displayName: string;

  /** Model family (e.g., "claude-3-5", "gpt-4", "gemini-2.0") */
  family: string;

  // ============================================
  // API CONFIGURATION
  // ============================================

  api: {
    /** API pattern type (determines which adapter to use) */
    pattern: 'messages' | 'chat/completions' | 'generateContent' | 'google-genai' | 'google-sdk' | 'responses';

    /** API endpoint URL */
    endpoint: string;

    /** Environment variable name for API key */
    apiKeyEnvVar: string;

    /** Authorization header name (usually "Authorization" or "x-api-key") */
    authHeader: string;

    /** Authorization prefix (e.g., "Bearer", "Api-Key") */
    authPrefix?: string;

    /** API version header (for providers that require it) */
    versionHeader?: {
      name: string;
      value: string;
    };

    /** Additional headers required by provider */
    additionalHeaders?: Record<string, string>;
  };

  // ============================================
  // TOOL SYSTEM
  // ============================================

  tools: {
    /** Whether tools/functions are supported */
    supported: boolean;

    /** Which adapter to use for tool format conversion (API pattern-based) */
    adapter: 'GenerateContentAPIAdapter' | 'GoogleGenAPIAdapter' | 'MessagesAPIAdapter' | 'ChatCompletionsAPIAdapter' | 'ResponsesAPIAdapter';

    /** Naming convention for tool names */
    namingConvention: 'snake_case' | 'PascalCase';

    /** Maximum number of tools that can be sent in one request */
    maxTools: number;

    /** Whether parallel tool calls are supported */
    parallelToolCalls: boolean;

    /** Whether tool choice can be specified */
    supportsToolChoice?: boolean;

    /** Tool choice options */
    toolChoiceOptions?: ('auto' | 'required' | 'none' | 'specific')[];
  };

  // ============================================
  // SERVER-SIDE TOOLS (AGENTIC TOOLS)
  // ============================================

  /**
   * Server-Side Tool Configuration
   *
   * Enables provider-managed agentic tool execution where the provider's
   * server autonomously loops through tool calls rather than requiring
   * client-side execution.
   */
  serverSideTools?: {
    /** Whether this model supports server-side agentic tools */
    supported: boolean;

    /** Which API endpoints support server-side tools for this model */
    supportedEndpoints: Array<'messages' | 'chat/completions' | 'responses' | 'generateContent' | 'google-genai'>;

    /** Available server-side tools */
    availableTools: string[];

    /** Tool configuration schema (provider-specific) */
    toolConfig?: {
      /** Web search tool configuration (XAI) */
      web_search?: {
        allowed_domains?: string[];
        excluded_domains?: string[];
        enable_image_understanding?: boolean;
      };

      /** X (Twitter) search tool configuration (XAI) */
      x_search?: {
        allowed_x_handles?: string[];
        excluded_x_handles?: string[];
        from_date?: string;
        to_date?: string;
        enable_image_understanding?: boolean;
        enable_video_understanding?: boolean;
      };

      /** Code execution tool configuration (XAI) */
      code_execution?: {
        // No configuration needed currently
      };

      /** Future providers can add their own tool configs */
      [key: string]: any;
    };

    /** Metadata extraction configuration */
    metadata?: {
      /** Whether provider returns citations */
      supportsCitations?: boolean;

      /** Whether provider returns tool usage stats */
      supportsToolUsage?: boolean;

      /** Whether provider returns reasoning tokens */
      supportsReasoningTokens?: boolean;
    };
  };

  // ============================================
  // PARAMETERS
  // ============================================

  parameters: {
    /** Temperature parameter configuration */
    temperature: ParameterConfig<number>;

    /** Max tokens parameter configuration */
    maxTokens: ParameterConfig<number>;

    /** Top-P parameter configuration */
    topP: ParameterConfig<number>;

    /** Top-K parameter configuration (Gemini-specific) */
    topK?: ParameterConfig<number>;

    /** Frequency penalty (OpenAI-specific) */
    frequencyPenalty?: ParameterConfig<number>;

    /** Presence penalty (OpenAI-specific) */
    presencePenalty?: ParameterConfig<number>;

    /** Stop sequences */
    stop?: ParameterConfig<string[]>;
  };

  // ============================================
  // STREAMING
  // ============================================

  streaming: {
    /** Whether streaming is supported */
    supported: boolean;

    /** Stream format type */
    format?: 'sse' | 'json_stream';

    /** Event type mapping for SSE */
    eventTypes?: Record<string, string>;

    /** Whether tool calls are included in stream */
    toolCallsInStream?: boolean;

    /** Whether reasoning is included in stream (DeepSeek, o1) */
    reasoningInStream?: boolean;
  };

  // ============================================
  // STRUCTURED OUTPUT
  // ============================================

  structuredOutput?: {
    /** Whether structured output/JSON mode is supported */
    supported: boolean;

    /** Format specification method */
    format?: 'json_schema' | 'json_object' | 'response_format';

    /** Schema type (if using JSON schema) */
    schemaType?: 'json_schema' | 'openai_schema';
  };

  // ============================================
  // REASONING (DeepSeek, o1)
  // ============================================

  reasoning?: {
    /** Whether extended reasoning is supported */
    supported: boolean;

    /** How reasoning output is formatted */
    format?: 'reasoning_content' | 'thinking_block' | 'reasoning_item';

    /** How to extract reasoning from response */
    extractionMethod?: 'content_block' | 'separate_field' | 'output_item';

    /**
     * Reasoning pattern - how thinking blocks are organized in the response
     *
     * - 'upfront': All reasoning occurs in one block at the start (OpenAI O-series)
     * - 'interleaved': Thinking scattered throughout response (Claude, DeepSeek, Gemini, Grok)
     */
    pattern?: 'upfront' | 'interleaved';

    /**
     * Whether reasoning can be toggled on/off by user (Tab key)
     *
     * - `true`: Extended reasoning - user can toggle on/off (e.g., Grok-4, DeepSeek R1)
     * - `false`: Native interleaved thinking - always visible (e.g., Claude 4.5, grok-code-fast-1)
     * - `undefined`: Defaults to false (always visible)
     */
    toggleable?: boolean;

    /** Default reasoning effort sent when no per-request override is provided.
     *  Used by Responses API path; models without this field get no reasoning block. */
    defaultEffort?: 'low' | 'medium' | 'high';
  };

  // ============================================
  // PROGRAMMATIC TOOL CALLING (PTC)
  // ============================================

  /** Whether the model supports Anthropic Programmatic Tool Calling (PTC). */
  supportsPTC?: boolean;

  // ============================================
  // CONTEXT WINDOW & LIMITS
  // ============================================

  limits: {
    /** Maximum context window in tokens */
    contextWindow: number;

    /** Maximum output tokens per request */
    outputTokens: number;

    /** Rate limit: requests per minute */
    requestsPerMinute: number;

    /** Rate limit: tokens per minute */
    tokensPerMinute: number;
  };

  // ============================================
  // COMPACTION CONFIGURATION (PHASE 1.5)
  // ============================================

  compaction: {
    /** Compaction strategy */
    strategy: 'auto' | 'manual' | 'off';

    /** How to calculate the compaction threshold */
    thresholdCalculation: {
      /** Calculation method */
      method: 'percentage' | 'absolute';

      /** Percentage of context window (0.0-1.0) */
      percentage?: number;

      /** Absolute token count */
      absolute?: number;

      /** Safety margin (tokens to reserve for response + tools) */
      safetyMargin: number;
    };

    /** Compaction behavior */
    behavior: {
      /** Always preserve last N messages (never compact recent context) */
      preserveRecent: number;

      /** Compact messages beyond threshold */
      compactOlder: boolean;

      /** Use helper model for compaction */
      useHelperModel: boolean;

      /** Helper model ID (if using helper) */
      helperModelId?: string;
    };
  };

  // ============================================
  // COST (for helper model selection)
  // ============================================

  cost?: {
    /** Input token cost per million tokens */
    inputPerMillion: number;

    /** Output token cost per million tokens */
    outputPerMillion: number;

    /** Cached-input token cost per million tokens (prompt-cache reads), if the provider exposes it */
    cachedInputPerMillion?: number;
  };

  // ============================================
  // METADATA
  // ============================================

  metadata?: {
    /** Release date */
    releaseDate?: string;

    /** Deprecation date (if applicable) */
    deprecationDate?: string;

    /** Successor model ID */
    successor?: string;

    /** Whether this is a preview/beta model */
    preview?: boolean;

    /** Additional metadata */
    [key: string]: unknown;
  };
}

/**
 * Parameter Configuration
 *
 * Generic configuration for model parameters with provider-specific mapping.
 */
export interface ParameterConfig<T> {
  /** Whether this parameter is supported */
  supported: boolean;

  /** Parameter name in provider's API (may differ from canonical name) */
  paramName: string;

  /** Default value. Optional: when omitted, the request sends no value for
   *  this parameter and the provider applies its own default. Cards opt in
   *  to a fixed value by setting this explicitly. */
  default?: T;

  /** Minimum value (for numbers) */
  min?: number;

  /** Maximum value (for numbers) */
  max?: number;

  /** Nested path for parameter (e.g., Gemini: generationConfig.temperature) */
  path?: string;

  /** Additional constraints */
  constraints?: {
    /** Step size (for numbers) */
    step?: number;

    /** Allowed values (for enums) */
    enum?: T extends string[] ? string[] : never;
  };
}

/**
 * Helper Model Mapping
 *
 * Maps providers to their cheap helper models for cost-optimized compaction.
 */
export interface HelperModelMapping {
  /** Provider name */
  provider: string;

  /** Helper model ID */
  helperModelId: string;

  /** Cost ratio compared to main models (e.g., 0.05 = 20x cheaper) */
  costRatio: number;
}

/**
 * Model Registry Interface
 *
 * Registry of all available models with their configurations.
 */
export interface ModelRegistry {
  /**
   * Register a model configuration
   *
   * @param config - Model configuration
   */
  registerModel(config: ModelConfig): void;

  /**
   * Get model configuration by ID
   *
   * @param modelId - Model identifier
   * @returns Model configuration
   * @throws Error if model not found
   */
  getModel(modelId: string): ModelConfig;

  /**
   * Check if model is registered
   *
   * @param modelId - Model identifier
   * @returns true if model is registered
   */
  hasModel(modelId: string): boolean;

  /**
   * List all models for a provider
   *
   * @param provider - Provider name
   * @returns Array of model configurations
   */
  getModelsByProvider(provider: string): ModelConfig[];

  /**
   * List all models in a family
   *
   * @param family - Model family
   * @returns Array of model configurations
   */
  getModelsByFamily(family: string): ModelConfig[];

  /**
   * Get helper model for a provider
   *
   * @param provider - Provider name
   * @returns Helper model configuration
   */
  getHelperModel(provider: string): ModelConfig;

  /**
   * Calculate compaction threshold for a model
   *
   * @param modelId - Model identifier
   * @returns Threshold in tokens
   */
  getCompactionThreshold(modelId: string): number;

  /**
   * List all registered models
   *
   * @returns Array of model IDs
   */
  listModels(): string[];
}

/**
 * Model Capabilities
 *
 * High-level capabilities of a model.
 */
export interface ModelCapabilities {
  /** Whether the model supports tools/functions */
  tools: boolean;

  /** Whether the model supports streaming */
  streaming: boolean;

  /** Whether the model supports structured output */
  structuredOutput: boolean;

  /** Whether the model supports reasoning/thinking */
  reasoning: boolean;

  /** Whether the model supports server-side tools */
  serverSideTools: boolean;

  /** Whether the model supports parallel tool calls */
  parallelToolCalls: boolean;

  /** Whether the model supports tool choice */
  toolChoice: boolean;
}

/**
 * Model Provider
 *
 * Provider metadata and capabilities.
 */
export interface ModelProvider {
  /** Provider name */
  name: string;

  /** Display name */
  displayName: string;

  /** Provider API patterns */
  apiPatterns: string[];

  /** Provider-specific features */
  features: {
    /** Whether provider supports caching */
    caching?: boolean;

    /** Whether provider supports batch requests */
    batching?: boolean;

    /** Whether provider supports fine-tuning */
    fineTuning?: boolean;

    /** Whether provider supports embeddings */
    embeddings?: boolean;
  };
}