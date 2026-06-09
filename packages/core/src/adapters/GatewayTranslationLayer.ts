/**
 * Gateway Translation Layer
 *
 * Orchestrates bidirectional message and tool format conversion between
 * canonical internal format and provider-specific formats.
 *
 * Phase 1.5: Multi-Provider Architecture
 * Based on: CORTEX_V4_PHASE_1.5_ARCHITECTURE.md
 */

import {
  CanonicalTool,
  CanonicalMessage
} from '../adapters/FormatAdapter.interface.js';
import { ModelConfig } from '../models/ModelConfig.interface.js';
import { AdapterRegistry } from '../adapters/AdapterRegistry.js';
import { ToolNamingHandler } from '../adapters/ToolNamingHandler.js';

/**
 * Decode HTML entities in tool arguments (recursive).
 *
 * Some models (notably XAI grok-4-1-fast) HTML-encode special characters
 * in tool call arguments (e.g. && becomes &amp;&amp;). The streaming paths
 * in APIClient already decode these; this function covers the non-streaming
 * response conversion path.
 */
function decodeHtmlEntities(obj: any): any {
  if (typeof obj === 'string') {
    return obj
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&apos;/g, "'");
  }
  if (Array.isArray(obj)) {
    return obj.map(item => decodeHtmlEntities(item));
  }
  if (obj !== null && typeof obj === 'object') {
    const decoded: any = {};
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        decoded[key] = decodeHtmlEntities(obj[key]);
      }
    }
    return decoded;
  }
  return obj;
}

/**
 * Request preparation result
 */
export interface PreparedRequest {
  /** Provider-specific messages */
  messages: unknown[];

  /** Provider-specific tools (if applicable) */
  tools?: unknown[];

  /** Request headers */
  headers: Record<string, string>;

  /** Request parameters */
  parameters: Record<string, unknown>;

  /** System message (handled separately for some providers) */
  systemMessage?: string;

  /** Model ID to use */
  modelId: string;

  /** Previous response ID for stateful Responses API chaining (XAI, OpenAI) */
  previousResponseId?: string;

  /**
   * Conversation/session identifier for cache-routing.
   * Used as `x-grok-conv-id` header (Chat Completions / Messages API) and
   * `prompt_cache_key` body field (Responses API).
   */
  conversationId?: string;
}

/**
 * Cache performance metrics
 */
export interface CacheMetrics {
  /** Tokens written to cache (cache creation) */
  cacheCreationTokens: number;

  /** Tokens read from cache (cache hits) */
  cacheReadTokens: number;

  /** Uncached input tokens */
  uncachedInputTokens: number;

  /** Cache hit rate (0.0 to 1.0) */
  cacheHitRate: number;

  /** Estimated cost savings ratio (0.0 to 1.0) */
  costSavingsRatio: number;
}

/**
 * Token usage with optional cache breakdown
 */
export interface TokenUsageMetrics {
  /** Total input tokens (cached + uncached) */
  inputTokens: number;

  /** Generated output tokens */
  outputTokens: number;

  /** Total tokens (input + output) */
  totalTokens: number;

  /** Cache-specific metrics (optional - provider-dependent) */
  cache?: CacheMetrics;

  /**
   * Provider-authoritative billed cost for THIS request, in xAI "ticks"
   * (1 USD = 1e10 ticks). xAI returns `usage.cost_in_usd_ticks` on chat
   * completions, Responses API, and agentic loops — the actual amount
   * billed after caching discounts, inclusive of all token AND server-side
   * tool/reasoning costs (the otherwise-opaque server-side spend). Absent
   * for providers that don't report it.
   */
  costUsdTicks?: number;

  /** `costUsdTicks` converted to dollars (costUsdTicks / 1e10). */
  costUsd?: number;

  /** Number of server-side tool invocations xAI billed for this request. */
  serverSideToolsUsed?: number;
}

/**
 * Response conversion result
 */
export interface ConvertedResponse {
  /** Canonical messages */
  messages: CanonicalMessage[];

  /** Token usage information with cache metrics */
  usage?: TokenUsageMetrics;

  /** Stop reason */
  stopReason?: string;

  /** Raw provider response (for debugging) */
  rawResponse?: unknown;
}

/**
 * Session Context
 *
 * Required for timeline tracking in canonical messages
 */
export interface SessionContext {
  /** Session ID */
  sessionId: string;

  /** Conversation ID (for branching) */
  conversationId: string;

  /** Current turn number */
  turnNumber: number;
}

/**
 * Gateway Translation Layer
 *
 * Central orchestrator for format conversion between canonical and provider formats.
 */
export class GatewayTranslationLayer {
  private adapterRegistry: AdapterRegistry;
  private toolNamingHandler: ToolNamingHandler;

  constructor(adapterRegistry?: AdapterRegistry, toolNamingHandler?: ToolNamingHandler) {
    this.adapterRegistry = adapterRegistry || new AdapterRegistry();
    this.toolNamingHandler = toolNamingHandler || new ToolNamingHandler();
  }

  /**
   * Prepare request for provider API
   *
   * Converts canonical messages and tools to provider-specific format,
   * adds headers, authentication, and parameters.
   *
   * @param messages - Canonical messages
   * @param tools - Canonical tools (optional)
   * @param modelConfig - Model configuration
   * @param options - Additional options
   * @returns Prepared request ready for API call
   */
  prepareRequest(
    messages: CanonicalMessage[],
    tools: CanonicalTool[] | undefined,
    modelConfig: ModelConfig,
    options?: {
      temperature?: number;
      maxTokens?: number;
      topP?: number;
      topK?: number;
      stream?: boolean;
      disableThinking?: boolean; // Phase 2.8: Disable thinking for continuation requests
      reasoningEffort?: 'none' | 'low' | 'medium' | 'high'; // GPT-5.1 reasoning level
      /**
       * R28: byte-stable static system prompt. When set, used as the system
       * field instead of scanning for role:'system' messages — so the prompt
       * lives in the provider `system` field (cacheable prefix) rather than
       * riding the moving latest-user-message slot.
       */
      staticSystemPrompt?: string;
      /**
       * R28b: session/conversation id → `x-grok-conv-id` header. xAI's
       * prompt-cache prefix lives on a specific backend instance; consistent
       * routing via this id is required for cache hits even when the prefix
       * is byte-stable. Without it the header is never sent and every request
       * may hit a cold instance.
       */
      conversationId?: string;
    }
  ): PreparedRequest {
    // Get appropriate adapter
    const adapter = this.adapterRegistry.getAdapterForModel(modelConfig);

    // Extract system message (handled separately for some providers).
    // R28: prefer the explicit byte-stable static prompt when provided.
    const systemMessage = options?.staticSystemPrompt ?? this.extractSystemMessage(messages);
    const nonSystemMessages = messages.filter(msg => msg.role !== 'system');

    // Convert messages to provider format
    const providerMessages = adapter.toProviderMessages(nonSystemMessages, modelConfig);

    // Convert tools to provider format (if provided)
    let providerTools: unknown[] | undefined;
    if (tools && tools.length > 0 && modelConfig.tools.supported) {
      // Apply naming convention BEFORE passing to adapter
      // This is the key architectural change - gateway handles naming
      const toolsWithCorrectNaming = this.toolNamingHandler.applyNamingConvention(
        tools,
        modelConfig.tools.namingConvention
      );

      // Dedupe by post-naming name. Two canonical tools with different cases
      // (e.g. PascalCase `SearchTools` from BaseToolRegistry and camelCase
      // `searchTools` from an MCP server) collapse to the same `search_tools`
      // after snake_case conversion and would be rejected by Anthropic/XAI as
      // a duplicate function definition. First registration wins.
      const seen = new Set<string>();
      const dedupedTools = toolsWithCorrectNaming.filter((t) => {
        if (seen.has(t.name)) return false;
        seen.add(t.name);
        return true;
      });

      // Adapter now receives tools with correct naming and only handles API format
      providerTools = adapter.toProviderTools(dedupedTools, modelConfig);
    }

    // Prepare headers
    const headers = this.prepareHeaders(modelConfig);

    // Prepare parameters
    const parameters = this.prepareParameters(modelConfig, options);

    // Phase 2.8: Use provider-specific model ID if available
    // Priority: modelId (explicit API ID) > openRouterModelId > id (registry ID)
    // This allows model cards to have different registry IDs (e.g., "gpt-5.1-reasoning")
    // while sending the correct API model ID (e.g., "gpt-5.1")
    const modelIdToSend = (modelConfig as any).modelId || (modelConfig as any).openRouterModelId || modelConfig.id;

    return {
      messages: providerMessages,
      tools: providerTools,
      headers,
      parameters,
      systemMessage,
      modelId: modelIdToSend,
      conversationId: options?.conversationId // R28b: enables x-grok-conv-id sticky routing
    };
  }

  /**
   * Prepare tools with PTC support.
   * Essential tools sent normally, standard tools get defer_loading: true,
   * PTC system tools (code_execution, tool_search) appended.
   *
   * @param tools - Canonical tools
   * @param modelConfig - Model configuration
   * @returns Array of provider-formatted tools with PTC system tools
   */
  prepareToolsWithPTC(
    tools: CanonicalTool[],
    modelConfig: ModelConfig,
  ): unknown[] {
    const adapter = this.adapterRegistry.getAdapterForModel(modelConfig);
    const toolsWithCorrectNaming = this.toolNamingHandler.applyNamingConvention(
      tools,
      modelConfig.tools.namingConvention,
    );

    // Dedupe by post-naming name (see prepareRequest for rationale).
    const seen = new Set<string>();
    const dedupedTools = toolsWithCorrectNaming.filter((t) => {
      if (seen.has(t.name)) return false;
      seen.add(t.name);
      return true;
    });

    // Convert to provider format
    const providerTools = adapter.toProviderTools(dedupedTools, modelConfig);

    // Apply defer_loading to non-essential tools
    const ptcTools = (providerTools as any[]).map((tool: any) => {
      // Find the canonical tool to check discoveryTier
      const canonicalName = tool.name;
      const canonical = tools.find(
        (t) => t.name === canonicalName || this.toolNamingHandler.applyNamingConvention([t], modelConfig.tools.namingConvention)[0]?.name === canonicalName,
      );
      const isEssential = canonical?.discoveryTier === 'essential';

      if (!isEssential) {
        return { ...tool, defer_loading: true };
      }
      return tool;
    });

    // Append PTC system tools
    ptcTools.push({ type: 'code_execution_20260120' });
    ptcTools.push({ type: 'tool_search_tool_bm25_20251119' });

    return ptcTools;
  }

  /**
   * Convert provider response to canonical format
   *
   * @param providerResponse - Raw provider response
   * @param modelConfig - Model configuration
   * @param sessionContext - Session context for timeline tracking
   * @returns Converted canonical messages with metadata
   */
  convertResponse(
    providerResponse: unknown,
    modelConfig: ModelConfig,
    sessionContext: SessionContext
  ): ConvertedResponse {
    // Get appropriate adapter
    const adapter = this.adapterRegistry.getAdapterForModel(modelConfig);

    // Extract messages from provider response
    const providerMessages = this.extractMessagesFromResponse(providerResponse, modelConfig);

    // Convert to canonical format
    const canonicalMessages = adapter.fromProviderMessages(
      providerMessages,
      modelConfig,
      sessionContext
    );

    // Post-process tool_use blocks:
    // 1. Decode HTML entities in tool arguments (fixes grok-4-1-fast && → &amp;&amp; bug)
    // 2. Apply reverse naming conversion back to PascalCase
    for (const message of canonicalMessages) {
      for (const block of message.content) {
        if (block.type === 'tool_use' && block.toolUse) {
          // Decode HTML entities in tool input
          if (block.toolUse.input) {
            block.toolUse.input = decodeHtmlEntities(block.toolUse.input);
          }

          // Convert tool name back to PascalCase for executor lookup
          if (modelConfig.tools.supported && modelConfig.tools.namingConvention !== 'PascalCase') {
            const convertedToolUse = this.toolNamingHandler.applyNamingToToolUse(
              block.toolUse,
              'PascalCase'
            );
            block.toolUse = convertedToolUse;
          }
        }
      }
    }

    // Extract usage information
    const usage = this.extractUsage(providerResponse, modelConfig);

    // Extract stop reason
    const stopReason = this.extractStopReason(providerResponse, modelConfig);

    return {
      messages: canonicalMessages,
      usage,
      stopReason,
      rawResponse: providerResponse
    };
  }

  /**
   * Validate request before sending
   *
   * @param messages - Canonical messages
   * @param tools - Canonical tools
   * @param modelConfig - Model configuration
   * @returns Validation result
   */
  validateRequest(
    messages: CanonicalMessage[],
    tools: CanonicalTool[] | undefined,
    modelConfig: ModelConfig
  ): {
    valid: boolean;
    errors?: string[];
    warnings?: string[];
  } {
    const errors: string[] = [];
    const warnings: string[] = [];
    const adapter = this.adapterRegistry.getAdapterForModel(modelConfig);

    // Validate messages
    if (!messages || messages.length === 0) {
      errors.push('At least one message is required');
    }

    // Validate tools if provided
    if (tools && tools.length > 0) {
      if (!modelConfig.tools.supported) {
        errors.push(`Model ${modelConfig.id} does not support tools`);
      }

      // Check tool count limit
      const maxTools = adapter.getMaxTools(modelConfig);
      if (tools.length > maxTools) {
        errors.push(`Too many tools: ${tools.length} (max: ${maxTools})`);
      }

      // Validate naming convention at gateway level (NEW)
      const namingValidation = this.toolNamingHandler.validateNaming(
        tools,
        modelConfig.tools.namingConvention
      );
      if (!namingValidation.valid && namingValidation.errors) {
        warnings.push(...namingValidation.errors);
        warnings.push(`Tools will be automatically converted to ${modelConfig.tools.namingConvention}`);
      }

      // Apply naming convention before adapter validation
      const toolsWithCorrectNaming = this.toolNamingHandler.applyNamingConvention(
        tools,
        modelConfig.tools.namingConvention
      );

      // Validate each tool (adapter validates API format, not naming)
      for (const tool of toolsWithCorrectNaming) {
        const validation = adapter.validateTool(tool, modelConfig);
        if (!validation.valid && validation.errors) {
          errors.push(...validation.errors);
        }
      }

      // Check parallel tool calls support
      if (!adapter.supportsParallelToolCalls(modelConfig)) {
        warnings.push('This model does not support parallel tool calls');
      }
    }

    // Validate context window
    const totalTokens = this.estimateTokenCount(messages, tools);
    const contextWindow = modelConfig.limits.contextWindow;
    if (totalTokens > contextWindow) {
      errors.push(
        `Estimated tokens (${totalTokens}) exceed context window (${contextWindow})`
      );
    }

    return {
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined,
      warnings: warnings.length > 0 ? warnings : undefined
    };
  }

  // ============================================
  // PRIVATE HELPER METHODS
  // ============================================

  /**
   * Extract system message from messages
   */
  private extractSystemMessage(messages: CanonicalMessage[]): string | undefined {
    const systemMessages = messages.filter(msg => msg.role === 'system');
    if (systemMessages.length === 0) {
      return undefined;
    }

    // Combine all system messages
    return systemMessages
      .map(msg =>
        msg.content
          .filter(block => block.type === 'text')
          .map(block => block.text || '')
          .join('\n')
      )
      .join('\n\n');
  }

  /**
   * Prepare HTTP headers for provider API
   */
  private prepareHeaders(modelConfig: ModelConfig): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };

    // Add authentication header
    const apiKey = process.env[modelConfig.api.apiKeyEnvVar];
    if (!apiKey) {
      throw new Error(
        `API key not found in environment variable: ${modelConfig.api.apiKeyEnvVar}`
      );
    }

    const authPrefix = modelConfig.api.authPrefix || 'Bearer';
    headers[modelConfig.api.authHeader] = `${authPrefix} ${apiKey}`;

    // Add version header if specified
    if (modelConfig.api.versionHeader) {
      headers[modelConfig.api.versionHeader.name] = modelConfig.api.versionHeader.value;
    }

    return headers;
  }

  /**
   * Prepare request parameters based on model config
   */
  private prepareParameters(
    modelConfig: ModelConfig,
    options?: {
      temperature?: number;
      maxTokens?: number;
      topP?: number;
      topK?: number;
      stream?: boolean;
      disableThinking?: boolean; // Phase 2.8: Disable thinking for continuation requests
      reasoningEffort?: 'none' | 'low' | 'medium' | 'high'; // GPT-5.1 reasoning level
    }
  ): Record<string, unknown> {
    const params: Record<string, unknown> = {};

    // Add model ID
    params.model = modelConfig.id;

    // Add temperature. Per-request value wins; otherwise fall back to the
    // model card's parameters.temperature.default. When BOTH are undefined no
    // temperature is sent and the provider applies its own default — cards
    // opt in to a fixed temperature by setting parameters.temperature.default.
    const effectiveTemperature =
      options?.temperature ?? modelConfig.parameters.temperature.default;
    if (effectiveTemperature !== undefined && modelConfig.parameters.temperature.supported) {
      const paramName = modelConfig.parameters.temperature.paramName;
      const value = Math.max(
        modelConfig.parameters.temperature.min ?? 0,
        Math.min(modelConfig.parameters.temperature.max ?? 2, effectiveTemperature)
      );

      if (modelConfig.parameters.temperature.path) {
        // Nested parameter (e.g., Gemini's generationConfig.temperature)
        this.setNestedParam(params, modelConfig.parameters.temperature.path, value);
      } else {
        params[paramName] = value;
      }
    }

    // Add max tokens
    // Default to model's output limit if not specified, to prevent premature cutoffs
    if (modelConfig.parameters.maxTokens.supported) {
      const paramName = modelConfig.parameters.maxTokens.paramName;
      const requestedTokens = options?.maxTokens ?? modelConfig.limits.outputTokens;
      const value = Math.min(modelConfig.limits.outputTokens, requestedTokens);

      if (modelConfig.parameters.maxTokens.path) {
        this.setNestedParam(params, modelConfig.parameters.maxTokens.path, value);
      } else {
        params[paramName] = value;
      }
    }

    // Add top_p
    if (options?.topP !== undefined && modelConfig.parameters.topP?.supported) {
      const paramName = modelConfig.parameters.topP.paramName;
      const value = Math.max(0, Math.min(1, options.topP));

      if (modelConfig.parameters.topP.path) {
        this.setNestedParam(params, modelConfig.parameters.topP.path, value);
      } else {
        params[paramName] = value;
      }
    }

    // Add top_k
    if (options?.topK !== undefined && modelConfig.parameters.topK?.supported) {
      const paramName = modelConfig.parameters.topK.paramName;

      if (modelConfig.parameters.topK.path) {
        this.setNestedParam(params, modelConfig.parameters.topK.path, options.topK);
      } else {
        params[paramName] = options.topK;
      }
    }

    // Add streaming
    if (options?.stream !== undefined && modelConfig.streaming.supported) {
      params.stream = options.stream;
    }

    // Phase 2.8: Pass through disableThinking flag for continuation requests
    // IMPORTANT: Only pass disableThinking to models that support it as an API parameter
    // Anthropic, XAI, and other /messages API providers support this
    // Gemini does NOT - thinking is handled via streaming chunks (part.thought flag)
    if (options?.disableThinking !== undefined) {
      // Exclude only Google's generateContent API (doesn't support this parameter)
      if (modelConfig.api.pattern !== 'generateContent') {
        params.disableThinking = options.disableThinking;
      }
      // For Gemini (generateContent API), thinking is handled at the chunk level via part.thought
      // Don't pass disableThinking to Gemini's API - it will reject it
    }

    // Extended reasoning effort (Tab toggle)
    // Passed through for models with toggleable reasoning:
    //   - Anthropic Claude: controls budget_tokens in thinking parameter
    //   - OpenAI GPT-5: maps to reasoning_effort API parameter
    // NOT passed for native thinkers with no API control (XAI grok — toggleable: false)
    if (options?.reasoningEffort !== undefined
        && modelConfig.reasoning?.supported
        && modelConfig.reasoning?.toggleable) {
      params.reasoningEffort = options.reasoningEffort;
    }

    // Enable parallel tool calls for ChatCompletions API models that support tools
    // This allows models to output multiple tool_use blocks in a single response
    // OpenAI docs: https://platform.openai.com/docs/guides/function-calling/parallel-function-calling
    if (modelConfig.api.pattern === 'chat/completions' && modelConfig.tools.supported) {
      params.parallel_tool_calls = true;
    }

    return params;
  }

  /**
   * Set nested parameter using dot notation path
   */
  private setNestedParam(params: Record<string, unknown>, path: string, value: unknown): void {
    const parts = path.split('.');
    let current: any = params;

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (!part) continue; // Skip undefined parts
      if (!current[part]) {
        current[part] = {};
      }
      current = current[part];
    }

    const lastPart = parts[parts.length - 1];
    if (lastPart) {
      current[lastPart] = value;
    }
  }

  /**
   * Extract messages from provider response
   */
  private extractMessagesFromResponse(
    response: unknown,
    modelConfig: ModelConfig
  ): unknown[] {
    const resp = response as any;

    // Handle different response formats
    if (modelConfig.api.pattern === 'messages') {
      // Anthropic/XAI: { content: [...] }
      return resp.content ? [{ role: 'assistant', content: resp.content }] : [];
    } else if (modelConfig.api.pattern === 'chat/completions') {
      // OpenAI: { choices: [{ message: {...} }] }
      return resp.choices ? resp.choices.map((c: any) => c.message) : [];
    } else if (modelConfig.api.pattern === 'responses') {
      // OpenAI/XAI Responses API: { output: [...] }
      // Return the full response as a single-item array so ResponsesAPIAdapter can handle it
      return [resp];
    } else if (modelConfig.api.pattern === 'generateContent' || modelConfig.api.pattern === 'google-sdk') {
      // Gemini REST API or Google GenAI SDK: { candidates: [{ content: {...} }] }
      // Both use the same structure with candidates array
      return resp.candidates ? resp.candidates.map((c: any) => c.content) : [];
    } else if (modelConfig.api.pattern === 'google-genai') {
      // Google GenAI (@google/genai): { text: string }
      // Used by FREE Gemma models
      return resp.text ? [{ role: 'assistant', content: resp.text }] : [];
    }

    return [];
  }

  /**
   * Extract token usage from provider response with cache metrics
   */
  private extractUsage(response: unknown, modelConfig: ModelConfig): TokenUsageMetrics | undefined {
    const resp = response as any;

    if (!resp.usage && !resp.usageMetadata) {
      return undefined;
    }

    const provider = modelConfig.provider.toLowerCase();
    const apiPattern = modelConfig.api.pattern;

    // Extract base metrics
    let inputTokens = 0;
    let outputTokens = 0;
    let totalTokens = 0;

    // Extract cache metrics (provider-specific)
    let cacheMetrics: CacheMetrics | undefined;

    if (apiPattern === 'messages' && (provider === 'anthropic' || provider === 'xai')) {
      // Anthropic Messages API OR XAI Messages API (Anthropic-compatible).
      // The three input fields are MUTUALLY EXCLUSIVE (partitioned by cache
      // breakpoint): `input_tokens` is ONLY the post-breakpoint, non-cached
      // remainder — NOT the grand total. True total input =
      // input_tokens + cache_creation_input_tokens + cache_read_input_tokens.
      // (Other providers' prompt_tokens/promptTokenCount DO include cached
      // tokens — only this branch needs the recombination.)
      const cacheCreation = resp.usage.cache_creation_input_tokens || 0;
      const cacheRead = resp.usage.cache_read_input_tokens || 0;
      const postBreakpointInput = resp.usage.input_tokens || 0;
      inputTokens = postBreakpointInput + cacheCreation + cacheRead;
      outputTokens = resp.usage.output_tokens || 0;
      totalTokens = inputTokens + outputTokens;

      if (cacheCreation > 0 || cacheRead > 0) {
        // input_tokens already IS the uncached remainder — do not subtract.
        const uncached = postBreakpointInput;
        const hitRate = inputTokens > 0 ? cacheRead / inputTokens : 0;

        // Provider-specific discount rates
        let discountRate: number;
        if (provider === 'anthropic') {
          // Anthropic: cache writes = 25% markup, cache reads = 90% discount
          discountRate = 0.9;
        } else {
          // XAI: cache reads = 75% discount (no cache creation - always automatic)
          discountRate = 0.75;
        }

        const costSavings = (cacheRead * discountRate) / inputTokens;

        cacheMetrics = {
          cacheCreationTokens: cacheCreation,
          cacheReadTokens: cacheRead,
          uncachedInputTokens: Math.max(0, uncached),
          cacheHitRate: hitRate,
          costSavingsRatio: costSavings
        };
      }
    } else if (apiPattern === 'chat/completions' && provider === 'openai') {
      // OpenAI Chat Completions API
      inputTokens = resp.usage.prompt_tokens || 0;
      outputTokens = resp.usage.completion_tokens || 0;
      totalTokens = resp.usage.total_tokens || (inputTokens + outputTokens);

      // Extract OpenAI cache fields
      const cachedTokens = resp.usage.prompt_tokens_details?.cached_tokens || 0;

      if (cachedTokens > 0) {
        const uncached = inputTokens - cachedTokens;
        const hitRate = inputTokens > 0 ? cachedTokens / inputTokens : 0;

        // OpenAI pricing: cached tokens = 50% discount
        const costSavings = (cachedTokens * 0.5) / inputTokens;

        cacheMetrics = {
          cacheCreationTokens: 0, // OpenAI doesn't report cache creation separately
          cacheReadTokens: cachedTokens,
          uncachedInputTokens: Math.max(0, uncached),
          cacheHitRate: hitRate,
          costSavingsRatio: costSavings
        };
      }
    } else if (apiPattern === 'chat/completions' && provider === 'deepseek') {
      // DeepSeek Chat Completions API — reports caching at usage top-level
      // (prompt_cache_hit_tokens / prompt_cache_miss_tokens), NOT via OpenAI's
      // prompt_tokens_details.cached_tokens. Automatic prefix caching, no
      // separate cache-creation accounting. Without this branch the generic
      // catch-all reads 0 and DeepSeek's real server-side caching is invisible.
      inputTokens = resp.usage.prompt_tokens || 0;
      outputTokens = resp.usage.completion_tokens || 0;
      totalTokens = resp.usage.total_tokens || (inputTokens + outputTokens);

      const cacheRead = resp.usage.prompt_cache_hit_tokens || 0;

      if (cacheRead > 0) {
        const miss = resp.usage.prompt_cache_miss_tokens;
        const uncached = typeof miss === 'number'
          ? miss
          : Math.max(0, inputTokens - cacheRead);
        const hitRate = inputTokens > 0 ? cacheRead / inputTokens : 0;
        // DeepSeek pricing: cache-hit input ≈ 26% of cache-miss → ~75% discount.
        const costSavings = inputTokens > 0 ? (cacheRead * 0.75) / inputTokens : 0;

        cacheMetrics = {
          cacheCreationTokens: 0,
          cacheReadTokens: cacheRead,
          uncachedInputTokens: Math.max(0, uncached),
          cacheHitRate: hitRate,
          costSavingsRatio: costSavings
        };
      }
    } else if (apiPattern === 'chat/completions' || apiPattern === 'responses') {
      // OpenAI/XAI/Other: { usage: { prompt_tokens, completion_tokens, total_tokens } }
      // OR Responses API: { usage: { input_tokens, output_tokens, total_tokens } }
      inputTokens = resp.usage.input_tokens || resp.usage.prompt_tokens || 0;
      outputTokens = resp.usage.output_tokens || resp.usage.completion_tokens || 0;
      totalTokens = resp.usage.total_tokens || 0;

      // Extract cache tokens: Responses API uses input_tokens_details.cached_tokens,
      // Chat Completions uses prompt_tokens_details.cached_tokens, and Inception
      // (Mercury) reports a top-level usage.cached_input_tokens. The Inception
      // entry is a MONITORING HOOK: their automatic prefix caching is ~0% in
      // practice today (flat ~4 tokens), so this surfaces it the moment it ever
      // starts working — see the mercury-2 caching note in .cortex/MEMORY.md.
      const cachedTokens =
        resp.usage.input_tokens_details?.cached_tokens ||
        resp.usage.prompt_tokens_details?.cached_tokens ||
        resp.usage.cached_input_tokens ||
        0;

      if (cachedTokens > 0 && inputTokens > 0) {
        const uncached = Math.max(0, inputTokens - cachedTokens);
        const hitRate = cachedTokens / inputTokens;
        // Provider-specific cached-token discount:
        //   OpenAI Chat Completions: 50% · XAI Responses: 75% (= XAI Messages)
        //   Mercury/Inception: 90% ($0.025 cached read vs $0.25 input)
        const discountRate =
          provider === 'openai' ? 0.5 : provider === 'mercury' ? 0.9 : 0.75;
        const costSavings = (cachedTokens * discountRate) / inputTokens;
        cacheMetrics = {
          cacheCreationTokens: 0, // Neither API reports cache creation separately
          cacheReadTokens: cachedTokens,
          uncachedInputTokens: uncached,
          cacheHitRate: hitRate,
          costSavingsRatio: costSavings
        };
      }
    } else if ((apiPattern === 'generateContent' || apiPattern === 'google-sdk') && provider === 'google') {
      // Google Gemini REST API or Google GenAI SDK
      inputTokens = resp.usageMetadata?.promptTokenCount || 0;
      outputTokens = resp.usageMetadata?.candidatesTokenCount || 0;
      totalTokens = resp.usageMetadata?.totalTokenCount || (inputTokens + outputTokens);

      // Extract Google cache fields
      const cachedTokens = resp.usageMetadata?.cachedContentTokenCount || 0;

      if (cachedTokens > 0) {
        const uncached = inputTokens - cachedTokens;
        const hitRate = inputTokens > 0 ? cachedTokens / inputTokens : 0;

        // Google pricing: cached tokens = 75% discount
        const costSavings = (cachedTokens * 0.75) / inputTokens;

        cacheMetrics = {
          cacheCreationTokens: 0, // Google doesn't report cache creation separately
          cacheReadTokens: cachedTokens,
          uncachedInputTokens: Math.max(0, uncached),
          cacheHitRate: hitRate,
          costSavingsRatio: costSavings
        };
      }
    } else if (apiPattern === 'generateContent' || apiPattern === 'google-sdk') {
      // Gemini (non-Google provider): { usageMetadata: { promptTokenCount, candidatesTokenCount, totalTokenCount } }
      inputTokens = resp.usageMetadata?.promptTokenCount || 0;
      outputTokens = resp.usageMetadata?.candidatesTokenCount || 0;
      totalTokens = resp.usageMetadata?.totalTokenCount || 0;
    } else if (apiPattern === 'google-genai') {
      // Google GenAI: { usage: { inputTokens, outputTokens } }
      inputTokens = resp.usage?.inputTokens || 0;
      outputTokens = resp.usage?.outputTokens || 0;
      totalTokens = (resp.usage?.inputTokens || 0) + (resp.usage?.outputTokens || 0);
    }

    // xAI returns the authoritative billed cost for the request (post-discount,
    // inclusive of server-side tool + reasoning spend that is otherwise opaque
    // to the client). Provider-agnostic read — undefined elsewhere.
    const costTicksRaw = resp.usage?.cost_in_usd_ticks;
    const costUsdTicks = typeof costTicksRaw === 'number' ? costTicksRaw : undefined;
    const serverSideToolsRaw = resp.usage?.num_server_side_tools_used;

    return {
      inputTokens,
      outputTokens,
      totalTokens,
      cache: cacheMetrics,
      ...(costUsdTicks !== undefined
        ? { costUsdTicks, costUsd: costUsdTicks / 1e10 }
        : {}),
      ...(typeof serverSideToolsRaw === 'number'
        ? { serverSideToolsUsed: serverSideToolsRaw }
        : {})
    };
  }

  /**
   * Extract stop reason from provider response
   */
  private extractStopReason(response: unknown, modelConfig: ModelConfig): string | undefined {
    const resp = response as any;

    if (modelConfig.api.pattern === 'messages') {
      // Anthropic: { stop_reason }
      return resp.stop_reason;
    } else if (modelConfig.api.pattern === 'chat/completions') {
      // OpenAI: { choices: [{ finish_reason }] }
      return resp.choices?.[0]?.finish_reason;
    } else if (modelConfig.api.pattern === 'generateContent' || modelConfig.api.pattern === 'google-sdk') {
      // Gemini REST API or Google GenAI SDK: { candidates: [{ finishReason }] }
      return resp.candidates?.[0]?.finishReason;
    }

    return undefined;
  }

  /**
   * Estimate token count for messages and tools
   *
   * Simple estimation: ~4 characters per token
   */
  private estimateTokenCount(
    messages: CanonicalMessage[],
    tools?: CanonicalTool[]
  ): number {
    let totalChars = 0;

    // Count message characters
    for (const msg of messages) {
      for (const block of msg.content) {
        if (block.type === 'text') {
          totalChars += (block.text || '').length;
        } else if (block.type === 'tool_use' && block.toolUse) {
          totalChars += JSON.stringify(block.toolUse).length;
        } else if (block.type === 'tool_result' && block.toolResult) {
          totalChars += JSON.stringify(block.toolResult.content).length;
        }
      }
    }

    // Count tool characters
    if (tools) {
      for (const tool of tools) {
        totalChars += JSON.stringify(tool).length;
      }
    }

    // Rough estimate: 4 characters per token
    return Math.ceil(totalChars / 4);
  }
}

/**
 * Default singleton instance
 */
export const gatewayTranslationLayer = new GatewayTranslationLayer();
