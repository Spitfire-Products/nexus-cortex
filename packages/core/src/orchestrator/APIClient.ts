/**
 * API Client
 * Handles actual HTTP requests to AI provider APIs
 *
 * Phase 2.1: Real API Integration
 */

// Install the AI-provider proxy-fetch wrapper FIRST (before the SDKs load), so
// outbound provider calls route through CORTEX_PROXY_BASE_URL when set (autoresearch
// user-funded jobs). Inert unless the env var is present.
import './cortexProxyFetch.js';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { GoogleGenAI } from '@google/genai';
import { v4 as uuidv4 } from 'uuid';
import type { ModelConfig } from '../models/ModelConfig.interface.js';
import type { PreparedRequest } from '../adapters/GatewayTranslationLayer.js';
import type { CanonicalToolUse } from '@nexus-cortex/types';
import {
  anthropicCredentialService,
  type AuthMethod,
  CredentialError
} from '../config/AnthropicCredentialService.js';

/**
 * Anthropic families on the adaptive-thinking-only request surface — sending
 * thinking.type 'enabled'/budget_tokens returns a 400 (sampling params are
 * rejected too, but cards opt out by leaving temperature.default unset).
 * Fable 5 is stricter still: an explicit {type:'disabled'} also 400s — both
 * request paths already OMIT thinking instead of disabling it explicitly.
 */
const ANTHROPIC_ADAPTIVE_THINKING_FAMILIES = new Set([
  'claude-4.7',
  'claude-4.8',
  'claude-fable-5'
]);

/**
 * API Response (provider-agnostic)
 */
export interface APIResponse {
  /** Provider-specific response object */
  data: any;

  /** HTTP status code */
  status: number;

  /** Response headers */
  headers: Record<string, string>;
}

/**
 * Stream chunk for real-time UI updates
 *
 * Phase 2.8: Streaming Tool Execution
 * Added 'tool_use_complete' type and toolUse field for streaming tool execution
 * Added 'tool_result' type for emitting tool results during streaming
 * Added 'thinking_delta' type for Gemini reasoning blocks (UI filters via Shift+Tab)
 */
export interface StreamChunk {
  /** Chunk type */
  type: 'text_delta' | 'content_block_start' | 'content_block_delta' | 'content_block_stop' | 'message_start' | 'message_delta' | 'message_stop' | 'tool_use_complete' | 'tool_result' | 'thinking_delta' | 'error' | 'turn_summary';

  /** Chunk data (provider-specific) */
  data?: any;

  /** Text delta (for text chunks) */
  delta?: string;

  /** Accumulated snapshot (optional) */
  snapshot?: string;

  /** Tool use block (for type === 'tool_use_complete') */
  toolUse?: CanonicalToolUse;

  /** Tool result (for type === 'tool_result') */
  toolResult?: {
    tool_use_id: string;
    tool_name: string;
    content: string;
    is_error?: boolean;
    metadata?: any;
  };

  /** Error details (for type === 'error') */
  error?: {
    type: string;
    message: string;
  };
}

/**
 * Streaming response with chunks and final message
 */
export interface StreamingResponse {
  /** Async generator for real-time chunks */
  chunks: AsyncGenerator<StreamChunk, void, unknown>;

  /** Promise that resolves to final accumulated message */
  finalMessage: Promise<any>;
}

/**
 * API Client for making requests to AI providers
 *
 * Supports: Anthropic, OpenAI, Google (Gemini + Gemma)
 */
export class APIClient {
  private anthropicClient?: Anthropic;
  private openaiClient?: OpenAI;
  private googleClient?: GoogleGenerativeAI;
  private googleGenAIClient?: GoogleGenAI;

  constructor() {
    // Initialize clients lazily when needed
  }

  /**
   * Decode HTML entities in an object (recursive)
   *
   * WORKAROUND for model bugs (e.g., grok-4-1-fast) that incorrectly
   * encode special characters in tool call arguments.
   *
   * @param obj - Object to decode (may contain nested objects/arrays)
   * @returns Decoded object with HTML entities converted to plain characters
   */
  private decodeHtmlEntitiesInObject(obj: any): any {
    if (typeof obj === 'string') {
      // Decode common HTML entities
      return obj
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&apos;/g, "'");
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.decodeHtmlEntitiesInObject(item));
    }

    if (obj !== null && typeof obj === 'object') {
      const decoded: any = {};
      for (const key in obj) {
        if (obj.hasOwnProperty(key)) {
          decoded[key] = this.decodeHtmlEntitiesInObject(obj[key]);
        }
      }
      return decoded;
    }

    return obj;
  }

  /**
   * Attempt to repair truncated JSON from streaming tool arguments.
   * When providers truncate output (max_tokens), the accumulated JSON is incomplete.
   * Tries progressively aggressive repairs: closing open strings, objects, arrays.
   */
  private repairTruncatedJSON(raw: string): Record<string, unknown> {
    const trimmed = raw.trim();
    if (!trimmed) throw new Error('Empty JSON');

    // Try direct parse first
    try { return JSON.parse(trimmed); } catch { /* continue */ }

    // Try closing open string + object combinations
    const repairs = [
      trimmed + '"}',
      trimmed + '"}}',
      trimmed + '"]',
      trimmed + '"}]',
      trimmed + '}',
      trimmed + '}}',
    ];

    for (const attempt of repairs) {
      try {
        const parsed = JSON.parse(attempt);
        if (typeof parsed === 'object' && parsed !== null) {
          if (process.env.DEBUG === 'true') console.log(`[APIClient] Repaired truncated JSON (${raw.length} chars) by appending ${attempt.slice(trimmed.length)}`);
          return parsed;
        }
      } catch { /* continue */ }
    }

    throw new Error(`Cannot repair truncated JSON (${raw.length} chars)`);
  }

  /**
   * Send request to provider API
   *
   * Routes by API PATTERN (not provider) to maintain architectural consistency.
   * The pattern is specified in modelConfig.api.pattern and determines which
   * adapter and API endpoint to use.
   *
   * @param request - Prepared request from GatewayTranslationLayer
   * @param modelConfig - Model configuration
   * @returns Provider response
   */
  async sendRequest(request: PreparedRequest, modelConfig: ModelConfig): Promise<APIResponse> {
    // Clamp any requested temperature to THIS model's valid range before dispatch — the
    // cross-provider gate (e.g. Anthropic is 0–1, OpenAI/DeepSeek 0–2). Lets a per-subagent
    // temperature (an auto-research diversity lever) vary freely without 400-ing a model whose
    // range is narrower. Applies to every API pattern below.
    const tRange = (modelConfig as any).parameters?.temperature;
    const t = (request as any).parameters?.temperature;
    if (typeof t === 'number' && Number.isFinite(t) && tRange) {
      const clamped = Math.max(tRange.min ?? 0, Math.min(tRange.max ?? 2, t));
      if (clamped !== t) (request as any).parameters.temperature = clamped;
    }

    const apiPattern = modelConfig.api.pattern;

    switch (apiPattern) {
      case 'messages':
        // Anthropic Messages API (used by Anthropic, XAI)
        return this.sendMessagesAPI(request, modelConfig);

      case 'chat/completions':
        // OpenAI Chat Completions API (used by OpenAI, XAI, DeepSeek, Groq)
        return this.sendChatCompletionsAPI(request, modelConfig);

      case 'responses':
        // OpenAI Responses API (used by OpenAI gpt-5-codex, XAI stateful)
        return this.sendResponsesAPI(request, modelConfig);

      case 'generateContent':
        // Google Gemini GenerateContent API
        return this.sendGenerateContentAPI(request, modelConfig);

      case 'google-genai':
        // Google GenAI API (FREE Gemma models)
        return this.sendGoogleGenAIRequest(request, modelConfig);

      case 'google-sdk':
        // Google SDK with full tool support
        return this.sendGoogleSDK(request, modelConfig);

      default:
        throw new Error(`Unsupported API pattern: ${apiPattern}`);
    }
  }

  /**
   * Stream request to provider API (with real-time chunks)
   *
   * Routes by API PATTERN (not provider) to maintain architectural consistency
   * with non-streaming sendRequest() method
   *
   * @param request - Prepared request from GatewayTranslationLayer
   * @param modelConfig - Model configuration
   * @returns Streaming response with chunks and final message
   */
  streamRequest(request: PreparedRequest, modelConfig: ModelConfig): StreamingResponse {
    const apiPattern = modelConfig.api.pattern;

    switch (apiPattern) {
      case 'messages':
        // Anthropic Messages API (used by Anthropic, XAI)
        return this.streamMessagesAPI(request, modelConfig);

      case 'chat/completions':
        // OpenAI Chat Completions API (used by OpenAI, XAI, DeepSeek, Groq)
        return this.streamChatCompletionsAPI(request, modelConfig);

      case 'responses':
        // OpenAI Responses API (used by OpenAI gpt-5-codex, XAI stateful)
        return this.streamResponsesAPI(request, modelConfig);

      case 'generateContent':
        // Google Gemini GenerateContent API
        return this.streamGenerateContentAPI(request, modelConfig);

      case 'google-genai':
        throw new Error('Streaming not supported for google-genai pattern');

      case 'google-sdk':
        // Google SDK with full tool support (experimental)
        return this.streamGoogleSDK(request, modelConfig);

      default:
        throw new Error(`Unsupported API pattern for streaming: ${apiPattern}`);
    }
  }

  /**
   * Send request using Messages API pattern
   *
   * Used by: Anthropic (native), XAI (Anthropic-compatible)
   * Format: Anthropic Messages API
   */
  private async sendMessagesAPI(
    request: PreparedRequest,
    modelConfig: ModelConfig
  ): Promise<APIResponse> {
    const provider = modelConfig.provider.toLowerCase();

    // Anthropic: Use native SDK
    if (provider === 'anthropic') {
      return this.sendAnthropicMessagesAPI(request, modelConfig);
    }

    // XAI: Use Anthropic-compatible Messages API
    if (provider === 'xai') {
      return this.sendXAIMessagesAPI(request, modelConfig);
    }

    throw new Error(`Messages API not supported for provider: ${provider}`);
  }

  /**
   * Send request to Anthropic Messages API (native)
   *
   * Supports:
   * - OAuth authentication (Claude.ai Max subscriptions)
   * - API key authentication (traditional)
   * - Prompt caching for 90% cost reduction
   */
  private async sendAnthropicMessagesAPI(
    request: PreparedRequest,
    modelConfig: ModelConfig
  ): Promise<APIResponse> {
    // Initialize Anthropic client with OAuth or API key
    if (!this.anthropicClient) {
      this.anthropicClient = this.initializeAnthropicClient();
    }

    // Phase 2.8: Extract internal flags before building request
    // Note: Anthropic requires thinking blocks to precede tool_use in assistant messages
    // when thinking is enabled. Continuations after tool execution must respect this ordering.
    const disableThinking = (request.parameters as any).disableThinking;
    const reasoningEffort = (request.parameters as any).reasoningEffort as string | undefined;

    // Exclude internal flags from API request parameters
    const { disableThinking: _, reasoningEffort: _re, ...apiParameters } = request.parameters;

    // Check if prompt caching is enabled
    const enableCaching = process.env.ANTHROPIC_PROMPT_CACHING !== 'false';

    // Build Anthropic request
    const anthropicRequest: any = {
      model: request.modelId,
      messages: request.messages,
      max_tokens: request.parameters.max_tokens || request.parameters.maxTokens || 4096,
      ...apiParameters
    };

    // Add system message if present (with cache_control for caching)
    if (request.systemMessage) {
      if (enableCaching) {
        // Use array format with cache_control for prompt caching
        anthropicRequest.system = [{
          type: 'text',
          text: request.systemMessage,
          cache_control: { type: 'ephemeral' }
        }];
      } else {
        anthropicRequest.system = request.systemMessage;
      }
    }

    // Add tools if present (with cache_control on last tool for caching)
    if (request.tools && request.tools.length > 0) {
      if (enableCaching) {
        // Clone tools and add cache_control to last tool
        const tools = request.tools.map((tool, index) => {
          if (index === request.tools!.length - 1) {
            return { ...(tool as object), cache_control: { type: 'ephemeral' } };
          }
          return tool;
        });
        anthropicRequest.tools = tools;
      } else {
        anthropicRequest.tools = request.tools;
      }
    }

    // Phase 2.8: Enable extended thinking for Claude 4+ models with reasoning support
    // Requires beta header: anthropic-beta: interleaved-thinking-2025-05-14
    // Skip if disableThinking option is set (used for continuation requests)
    // reasoningEffort scales budget_tokens: none/undefined=10000 (default), low=5000, medium=10000, high=50000
    // Note: 'none' means "no extra effort" = default budget. Thinking is always on for supported models.
    if (modelConfig.reasoning?.supported && modelConfig.reasoning?.pattern === 'interleaved' && !disableThinking) {
      // Opus 4.7/4.8 and Fable 5 REMOVED thinking.type=enabled / budget_tokens (400).
      // They require thinking.type=adaptive (+ optional output_config.effort). Older
      // Claude families still accept enabled.
      const useAdaptive = ANTHROPIC_ADAPTIVE_THINKING_FAMILIES.has(modelConfig.family);
      if (useAdaptive) {
        // Opus 4.7/4.8 adaptive thinking defaults to display:'omitted' (empty thinking
        // blocks, $0 reasoning tokens). DEBUG_THINKING opts into 'summarized' to surface
        // reasoning in the CLI — costs extra output tokens, so it's off by default.
        anthropicRequest.thinking =
          process.env.DEBUG_THINKING === 'true'
            ? { type: 'adaptive', display: 'summarized' }
            : { type: 'adaptive' };
      } else {
        const budgetMap: Record<string, number> = {
          none: 10000,
          low: 5000,
          medium: 10000,
          high: 50000,
        };
        const budgetTokens = reasoningEffort ? (budgetMap[reasoningEffort] || 10000) : 10000;
        anthropicRequest.thinking = {
          type: 'enabled',
          budget_tokens: budgetTokens
        };
      }
    }

    // Build beta headers
    const betaFeatures: string[] = [];

    if (anthropicRequest.thinking) {
      betaFeatures.push('interleaved-thinking-2025-05-14');
    }

    if (enableCaching) {
      betaFeatures.push('prompt-caching-2024-07-31');
    }

    const headers = betaFeatures.length > 0
      ? { 'anthropic-beta': betaFeatures.join(',') }
      : undefined;

    const response = await this.anthropicClient.messages.create(anthropicRequest, { headers });

    return {
      data: response,
      status: 200,
      headers: {}
    };
  }

  /**
   * Initialize Anthropic client with OAuth or API key
   *
   * Priority:
   * 1. ~/.claude/.credentials.json (OAuth from Claude.ai Max)
   * 2. CLAUDE_CODE_OAUTH_TOKEN env var (OAuth override)
   * 3. ANTHROPIC_API_KEY env var (API key fallback)
   */
  private initializeAnthropicClient(): Anthropic {
    const authMethod = (process.env.ANTHROPIC_AUTH_METHOD || 'auto') as AuthMethod;

    try {
      const credential = anthropicCredentialService.loadCredential(authMethod);

      if (process.env.DEBUG === 'true') {
        console.log(`[APIClient] Using Anthropic credential: ${anthropicCredentialService.getCredentialSummary(credential)}`);
      }

      // Check for token expiry warning (7 days)
      const daysUntilExpiry = anthropicCredentialService.getDaysUntilExpiry(credential);
      if (daysUntilExpiry !== null && daysUntilExpiry <= 7) {
        console.warn(`[APIClient] OAuth token expires in ${daysUntilExpiry} days. Run \`claude login\` to refresh.`);
      }

      // For OAuth tokens, use authToken parameter (Bearer auth)
      // For API keys, use apiKey parameter (x-api-key header)
      if (credential.type === 'oauth') {
        return new Anthropic({
          authToken: credential.token, // Uses Authorization: Bearer header
        });
      } else {
        return new Anthropic({
          apiKey: credential.token, // Uses x-api-key header
        });
      }
    } catch (error) {
      if (error instanceof CredentialError) {
        throw new Error(`Anthropic authentication failed: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Send request to XAI Messages API (Anthropic-compatible)
   */
  private async sendXAIMessagesAPI(
    request: PreparedRequest,
    modelConfig: ModelConfig
  ): Promise<APIResponse> {
    const apiKey = process.env[modelConfig.api.apiKeyEnvVar];
    if (!apiKey) {
      throw new Error(`Missing API key: ${modelConfig.api.apiKeyEnvVar}`);
    }

    // Extract internal flags before spreading into API request
    // XAI Messages API does NOT support Anthropic's thinking parameter —
    // XAI models think natively (embedded <thinking> tags or thinking content blocks)
    const { disableThinking, reasoningEffort, ...apiParameters } = request.parameters;

    // Build request (Anthropic Messages API format)
    const messagesRequest: any = {
      model: request.modelId,
      messages: request.messages,
      max_tokens: apiParameters.max_tokens || apiParameters.maxTokens || 4096,
      ...apiParameters
    };

    if (request.systemMessage) {
      messagesRequest.system = request.systemMessage;
    }

    if (request.tools && request.tools.length > 0) {
      messagesRequest.tools = request.tools;
    }

    const debugPayloadXai = process.env.DEBUG_PAYLOAD;
    if (debugPayloadXai === '1' || debugPayloadXai === '2') {
      try {
        const msgBytes = JSON.stringify(messagesRequest.messages || []).length;
        const toolBytes = JSON.stringify(messagesRequest.tools || []).length;
        const totalBytes = JSON.stringify(messagesRequest).length;
        const sysBytes = messagesRequest.system ? JSON.stringify(messagesRequest.system).length : 0;
        const toolCount = messagesRequest.tools?.length || 0;
        const msgCount = messagesRequest.messages?.length || 0;
        const lastUserMsg = messagesRequest.messages?.filter((m: any) => m.role === 'user').slice(-1)[0];
        const lastUserBytes = lastUserMsg ? JSON.stringify(lastUserMsg).length : 0;
        console.error(`[DEBUG_PAYLOAD-xai] model=${request.modelId} total=${totalBytes}B msgs=${msgCount}/${msgBytes}B tools=${toolCount}/${toolBytes}B sysMsg=${sysBytes}B lastUserMsg=${lastUserBytes}B`);
        if (debugPayloadXai === '2') {
          const breakdown = (messagesRequest.messages || []).map((m: any, i: number) => `${i}:${m.role}=${JSON.stringify(m).length}B`).join(' ');
          console.error(`[DEBUG_PAYLOAD-xai] msg breakdown: ${breakdown}`);
          if (messagesRequest.system) {
            const sysContent = typeof messagesRequest.system === 'string' ? messagesRequest.system : JSON.stringify(messagesRequest.system);
            console.error(`[DEBUG_PAYLOAD-xai] sysMsg first 600c: ${sysContent.slice(0, 600)}`);
            console.error(`[DEBUG_PAYLOAD-xai] sysMsg last 400c: ${sysContent.slice(-400)}`);
          }
          if (lastUserMsg) {
            const lastUserContent = typeof lastUserMsg.content === 'string' ? lastUserMsg.content : JSON.stringify(lastUserMsg.content);
            // Find user prompts vs system-reminder boundaries
            const blocks: string[] = [];
            if (Array.isArray(lastUserMsg.content)) {
              for (const block of lastUserMsg.content) {
                const text = block.text || block.content || JSON.stringify(block);
                const trimmed = text.length > 200 ? text.slice(0, 100) + '...[' + (text.length - 200) + 'B truncated]...' + text.slice(-100) : text;
                const cacheMarker = block.cache_control ? ` cache=${JSON.stringify(block.cache_control)}` : '';
                blocks.push(`{type=${block.type}${cacheMarker}, len=${text.length}: ${trimmed}}`);
              }
              console.error(`[DEBUG_PAYLOAD-xai] lastUserMsg blocks (${lastUserMsg.content.length}): ${blocks.join(' | ')}`);
            } else {
              console.error(`[DEBUG_PAYLOAD-xai] lastUserMsg first 1500c: ${lastUserContent.slice(0, 1500)}`);
              console.error(`[DEBUG_PAYLOAD-xai] lastUserMsg last 500c: ${lastUserContent.slice(-500)}`);
            }
          }
          // Also dump first user message to see what user originally sent
          const firstUserMsg = messagesRequest.messages?.find((m: any) => m.role === 'user');
          if (firstUserMsg && firstUserMsg !== lastUserMsg) {
            const firstUserContent = typeof firstUserMsg.content === 'string' ? firstUserMsg.content : JSON.stringify(firstUserMsg.content);
            console.error(`[DEBUG_PAYLOAD-xai] firstUserMsg: ${firstUserContent.slice(0, 400)}`);
          }
          if (messagesRequest.tools && messagesRequest.tools.length > 0) {
            const toolNames = messagesRequest.tools.map((t: any) => (t.name || t.function?.name) + '=' + JSON.stringify(t).length + 'B').join(', ');
            console.error(`[DEBUG_PAYLOAD-xai] tools: ${toolNames}`);
          }
        }
      } catch (e) {
        console.error(`[DEBUG_PAYLOAD-xai] failed to log:`, e);
      }
    }

    // Make raw HTTP request to XAI Messages API.
    // `x-grok-conv-id` routes same-session requests to same server for cache hits —
    // per XAI docs (advanced-api-usage/prompt-caching/maximizing-cache-hits).
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      [modelConfig.api.authHeader]: apiKey,
      'anthropic-version': '2023-06-01'
    };
    if (request.conversationId) {
      headers['x-grok-conv-id'] = request.conversationId;
    }

    const httpResponse = await fetch(modelConfig.api.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(messagesRequest)
    });

    if (!httpResponse.ok) {
      const errorText = await httpResponse.text();
      throw new Error(`XAI Messages API error (${httpResponse.status}): ${errorText}`);
    }

    const data = await httpResponse.json() as any;

    // Post-process: extract <thinking> tags from text content into separate thinking blocks
    // grok-4-1-fast-reasoning embeds thinking in text as <thinking>...</thinking> tags
    if (data.content && Array.isArray(data.content)) {
      data.content = this.extractThinkingFromTextBlocks(data.content);
    }

    return {
      data,
      status: httpResponse.status,
      headers: Object.fromEntries(httpResponse.headers.entries())
    };
  }

  /**
   * Extract <thinking> tags from text content blocks into separate thinking content blocks.
   * XAI grok-4-1-fast-reasoning embeds native thinking in text as <thinking>...</thinking> tags.
   * This converts them to proper thinking blocks so the UI can display them correctly.
   */
  private extractThinkingFromTextBlocks(content: any[]): any[] {
    const result: any[] = [];

    for (const block of content) {
      if (block.type !== 'text' || !block.text) {
        result.push(block);
        continue;
      }

      const text = block.text;
      const thinkingRegex = /<thinking>([\s\S]*?)<\/thinking>/g;
      let lastIndex = 0;
      let match;
      let hasThinking = false;

      while ((match = thinkingRegex.exec(text)) !== null) {
        hasThinking = true;

        // Add any text before the thinking tag
        const beforeText = text.slice(lastIndex, match.index).trim();
        if (beforeText) {
          result.push({ type: 'text', text: beforeText });
        }

        // Add thinking block
        result.push({
          type: 'thinking',
          thinking: (match[1] ?? '').trim()
        });

        lastIndex = match.index + match[0].length;
      }

      if (hasThinking) {
        // Add any remaining text after the last thinking tag
        const afterText = text.slice(lastIndex).trim();
        if (afterText) {
          result.push({ type: 'text', text: afterText });
        }
      } else {
        // No thinking tags — keep original block
        result.push(block);
      }
    }

    return result;
  }

  /**
   * Round 7 (parallel-bench output): shared request-construction helper.
   *
   * `sendChatCompletionsAPI` and `streamChatCompletionsAPI` previously
   * duplicated ~100 lines each (API key check, baseURL strip, OpenRouter
   * headers, client construction, max_tokens→max_completion_tokens rename,
   * reasoning_effort handling, tool attachment, DEBUG_PAYLOAD logging).
   * This helper builds {client, chatRequest} for both callers; the streaming
   * caller passes `stream: true` and continues into its generator loop.
   *
   * Behavior note (called out in commit): non-streaming previously did NOT
   * reuse `this.openaiClient` for the openai provider — the unified helper
   * does. This reduces socket churn and matches the streaming path; no
   * external semantics change.
   */
  private buildChatCompletionsRequest(
    request: PreparedRequest,
    modelConfig: ModelConfig,
    opts: { stream: boolean }
  ): { client: OpenAI; chatRequest: any } {
    const apiKey = process.env[modelConfig.api.apiKeyEnvVar];
    if (!apiKey) {
      throw new Error(`Missing API key: ${modelConfig.api.apiKeyEnvVar}`);
    }

    // Extract base URL (remove endpoint-specific paths)
    const baseURL = modelConfig.api.endpoint
      .replace('/chat/completions', '')
      .replace('/messages', '')
      .replace('/responses', '');

    const defaultHeaders: Record<string, string> = {};

    // Reuse cached openai client when possible (matches the streaming path's
    // pre-refactor behavior; now applied uniformly).
    const client = modelConfig.provider.toLowerCase() === 'openai' && this.openaiClient
      ? this.openaiClient
      : new OpenAI({
          apiKey,
          baseURL,
          ...(Object.keys(defaultHeaders).length > 0 && { defaultHeaders })
        });

    // Phase 2.8: Exclude internal flags from API request parameters
    const { disableThinking, ...apiParameters } = request.parameters;

    // Transform max_tokens to max_completion_tokens if model requires it (GPT-5 family)
    const maxTokensParamName = modelConfig.parameters?.maxTokens?.paramName || 'max_tokens';
    let transformedParams = { ...apiParameters };
    if (maxTokensParamName === 'max_completion_tokens') {
      if ('max_tokens' in transformedParams) {
        transformedParams.max_completion_tokens = transformedParams.max_tokens;
        delete transformedParams.max_tokens;
      }
      if ('maxTokens' in transformedParams) {
        transformedParams.max_completion_tokens = transformedParams.maxTokens;
        delete transformedParams.maxTokens;
      }
    }

    // Extract reasoningEffort before spreading (custom param, not OpenAI)
    const reasoningEffort = (transformedParams as any).reasoningEffort || 'medium';
    delete (transformedParams as any).reasoningEffort;

    // Build the request body
    const chatRequest: any = {
      model: request.modelId,
      messages: request.messages,
      ...transformedParams,
      ...(opts.stream ? { stream: true } : {}),
    };

    // R19b: OpenAI chat/completions REJECTS `reasoning_effort` + tools for
    // some gpt-5 variants (`gpt-5.4`, possibly others) with
    // "400 Function tools with reasoning_effort are not supported for ... in /v1/chat/completions".
    // Drop reasoning_effort silently when both are present on chat/completions;
    // the model still works without explicit reasoning effort (defaults apply).
    const willAttachTools = !!(request.tools && request.tools.length > 0);
    const isChatCompletionsRoute = modelConfig.api.pattern === 'chat/completions';
    const dropReasoningForToolCompat = willAttachTools && isChatCompletionsRoute && modelConfig.provider === 'openai';

    // Enable reasoning for OpenAI models that support it (GPT-5 family, o-series)
    if (
      modelConfig.reasoning?.supported &&
      !disableThinking &&
      reasoningEffort !== 'none' &&
      !dropReasoningForToolCompat
    ) {
      chatRequest.reasoning_effort = reasoningEffort;
      delete chatRequest.temperature;
      delete chatRequest.top_p;
      delete chatRequest.logprobs;
      if (process.env.DEBUG === 'true' || process.env.DEBUG_THINKING === 'true') {
        const tag = opts.stream ? 'streaming ' : '';
        console.log(`[DEBUG APIClient] Reasoning ENABLED for ${tag}${modelConfig.id} (effort: ${reasoningEffort}, removed temperature/top_p)`);
      }
    } else if (dropReasoningForToolCompat && (process.env.DEBUG === 'true' || process.env.DEBUG_THINKING === 'true')) {
      console.log(`[DEBUG APIClient] Reasoning DROPPED for ${modelConfig.id} — chat/completions doesn't support reasoning_effort+tools combo (R19b)`);
    } else if (process.env.DEBUG === 'true' || process.env.DEBUG_THINKING === 'true') {
      const tag = opts.stream ? 'streaming ' : '';
      console.log(`[DEBUG APIClient] Reasoning DISABLED for ${tag}${modelConfig.id} (effort: ${reasoningEffort}, disableThinking: ${disableThinking})`);
    }

    // Attach tools
    if (request.tools && request.tools.length > 0) {
      chatRequest.tools = request.tools;
    }

    this.logChatCompletionsPayload(chatRequest, request.modelId, opts.stream);

    return { client, chatRequest };
  }

  /**
   * DEBUG_PAYLOAD logging extracted from both send/stream methods.
   * Same observable output as before; suffix `-stream` on the log tag
   * distinguishes streaming-side breakdowns.
   */
  private logChatCompletionsPayload(
    chatRequest: any,
    modelId: string,
    streaming: boolean,
  ): void {
    const debugPayload = process.env.DEBUG_PAYLOAD;
    if (debugPayload !== '1' && debugPayload !== '2') return;
    const tag = streaming ? 'DEBUG_PAYLOAD-stream' : 'DEBUG_PAYLOAD';
    try {
      const msgBytes = JSON.stringify(chatRequest.messages || []).length;
      const toolBytes = JSON.stringify(chatRequest.tools || []).length;
      const totalBytes = JSON.stringify(chatRequest).length;
      const sysMsg = chatRequest.messages?.find((m: any) => m.role === 'system');
      const sysBytes = sysMsg ? JSON.stringify(sysMsg).length : 0;
      const toolCount = chatRequest.tools?.length || 0;
      const msgCount = chatRequest.messages?.length || 0;
      const lastUserMsg = chatRequest.messages?.filter((m: any) => m.role === 'user').slice(-1)[0];
      const lastUserBytes = lastUserMsg ? JSON.stringify(lastUserMsg).length : 0;
      console.error(`[${tag}] model=${modelId} total=${totalBytes}B msgs=${msgCount}/${msgBytes}B tools=${toolCount}/${toolBytes}B sysMsg=${sysBytes}B lastUserMsg=${lastUserBytes}B`);
      if (debugPayload === '2') {
        const breakdown = (chatRequest.messages || []).map((m: any, i: number) => `${i}:${m.role}=${JSON.stringify(m).length}B`).join(' ');
        console.error(`[${tag}] msg breakdown: ${breakdown}`);
        if (sysMsg) {
          const previewLen = streaming ? 800 : 500;
          const sysPreview = (typeof sysMsg.content === 'string' ? sysMsg.content : JSON.stringify(sysMsg.content)).slice(0, previewLen);
          console.error(`[${tag}] sysMsg preview: ${sysPreview}`);
        }
        if (streaming && chatRequest.tools && chatRequest.tools.length > 0) {
          const toolNames = chatRequest.tools.map((t: any) => (t.function?.name || t.name) + '=' + JSON.stringify(t).length + 'B').join(', ');
          console.error(`[${tag}] tools: ${toolNames}`);
        }
      }
    } catch (e) {
      console.error(`[${tag}] failed to log:`, e);
    }
  }

  /**
   * Send request using Chat Completions API pattern
   *
   * Used by: OpenAI, XAI, DeepSeek, Groq
   * Format: OpenAI Chat Completions API
   */
  private async sendChatCompletionsAPI(
    request: PreparedRequest,
    modelConfig: ModelConfig
  ): Promise<APIResponse> {
    const { client, chatRequest } = this.buildChatCompletionsRequest(
      request,
      modelConfig,
      { stream: false },
    );

    // Send request
    const response = await client.chat.completions.create(chatRequest);

    return {
      data: response,
      status: 200,
      headers: {}
    };
  }

  /**
   * Extract <system-reminder> content from Responses API input items.
   *
   * System messages are injected as <system-reminder> tags inside user message
   * content by SystemMessageMiddleware. For the Responses API, we extract these
   * into the dedicated `instructions` parameter so the provider can cache them
   * separately. The tags are stripped from the user message to avoid duplication.
   *
   * Other API methods (Messages, Chat Completions) are unaffected — they continue
   * to receive system context embedded in user content as before.
   */
  private extractSystemRemindersForResponsesAPI(inputItems: any[]): {
    instructions: string | undefined;
    cleanedItems: any[];
  } {
    const systemReminderRegex = /<system-reminder>\n([\s\S]*?)\n<\/system-reminder>/g;
    const extractedParts: string[] = [];
    const cleanedItems: any[] = [];

    for (const item of inputItems) {
      if (item.type === 'message' && item.role === 'user' && Array.isArray(item.content)) {
        const cleanedContent: any[] = [];

        for (const block of item.content) {
          if (block.type === 'input_text' && block.text) {
            // Extract all <system-reminder> blocks from this text
            let text = block.text;
            let match: RegExpExecArray | null;
            const reminders: string[] = [];

            // Reset regex state
            systemReminderRegex.lastIndex = 0;
            while ((match = systemReminderRegex.exec(text)) !== null) {
              reminders.push(match[1] ?? '');
            }

            if (reminders.length > 0) {
              extractedParts.push(...reminders);
              // Strip the tags from the text
              const strippedText = text.replace(systemReminderRegex, '').trim();
              if (strippedText) {
                cleanedContent.push({ ...block, text: strippedText });
              }
            } else {
              cleanedContent.push(block);
            }
          } else {
            cleanedContent.push(block);
          }
        }

        if (cleanedContent.length > 0) {
          cleanedItems.push({ ...item, content: cleanedContent });
        }
        // If all content was system-reminder, skip the empty message
      } else {
        cleanedItems.push(item);
      }
    }

    return {
      instructions: extractedParts.length > 0 ? extractedParts.join('\n\n') : undefined,
      cleanedItems
    };
  }

  /**
   * Send request using Responses API pattern
   *
   * Used by: OpenAI (gpt-5-codex), XAI (stateful)
   * Format: OpenAI Responses API with server-side tools
   */
  private async sendResponsesAPI(
    request: PreparedRequest,
    modelConfig: ModelConfig
  ): Promise<APIResponse> {
    const apiKey = process.env[modelConfig.api.apiKeyEnvVar];
    if (!apiKey) {
      throw new Error(`Missing API key: ${modelConfig.api.apiKeyEnvVar}`);
    }

    // Use provider-formatted input items directly from ResponsesAPIAdapter.toProviderMessages()
    // The adapter already creates correctly typed items (message, function_call_output, etc.)
    // Re-wrapping them would strip tool results and function calls, breaking the tool loop.
    //
    // Extract <system-reminder> content from user messages into `instructions` parameter.
    // This lets the Responses API cache system context separately from conversation content.
    const { instructions, cleanedItems: inputItems } = this.extractSystemRemindersForResponsesAPI(request.messages);

    // Check reasoning support
    const supportsReasoning = modelConfig.reasoning?.supported;
    const { disableThinking, reasoningEffort, ...apiParameters } = request.parameters;

    // Transform parameters: max_tokens / max_completion_tokens / maxTokens →
    // max_output_tokens for Responses API.
    // R20c: GPT-5 cards default to chat/completions and use
    // max_completion_tokens. On a dynamic switch to Responses, that key was
    // forwarded unchanged and OpenAI 400'd ("Unsupported parameter:
    // 'max_completion_tokens'. In the Responses API, this parameter has moved
    // to 'max_output_tokens'"). Normalize all three input forms.
    let transformedParams = { ...apiParameters };
    for (const oldKey of ['max_tokens', 'max_completion_tokens', 'maxTokens'] as const) {
      if (oldKey in transformedParams) {
        transformedParams.max_output_tokens = (transformedParams as any)[oldKey];
        delete (transformedParams as any)[oldKey];
      }
    }

    // Remove model from params to prevent overwriting
    const { model: _ignoredModel, ...paramsWithoutModel } = transformedParams as any;

    // Use modelId from config (for alias resolution)
    const actualModelId = modelConfig.modelId || request.modelId;

    const isXAI = modelConfig.provider?.toLowerCase() === 'xai';

    const responsesRequest: any = {
      model: actualModelId,
      input: inputItems,
      ...paramsWithoutModel
    };

    // Stateful chaining: use previous_response_id when available
    // This lets the server preserve reasoning state across tool loop iterations,
    // dramatically improving coherence for long tool chains (XAI, OpenAI).
    if (request.previousResponseId) {
      responsesRequest.previous_response_id = request.previousResponseId;
    }

    // XAI stores conversations server-side by default (store: true).
    // Being explicit ensures server-side reasoning preservation.
    if (isXAI) {
      responsesRequest.store = true;

      // Cache-routing: `prompt_cache_key` routes requests with same session id to
      // the same server, maximizing cache hits. Per XAI docs
      // (advanced-api-usage/prompt-caching/maximizing-cache-hits).
      if (request.conversationId) {
        responsesRequest.prompt_cache_key = request.conversationId;
      }

      // NOTE: tried adding `include: ["reasoning.encrypted_content"]` to capture
      // encrypted reasoning for JSONL preservation (per XAI docs_guides_responses-api.md
      // lines 93-95), but that triggered a regression where visible output tokens
      // dropped to near-zero (~6 visible vs ~220 reasoning) on a basic 3-turn test.
      // Deferred until we can investigate: possibly needs to be paired with
      // different content-block wiring in ResponsesAPIAdapter, or only applied
      // when we've explicitly asked for reasoning via the `reasoning` param.
    }

    // Set extracted system context as instructions (enables provider-side caching)
    // XAI does NOT support the `instructions` parameter — skip for XAI provider.
    if (instructions && !isXAI) {
      responsesRequest.instructions = instructions;
    }

    // Add reasoning if supported and not disabled.
    // Per-request reasoningEffort takes priority; fall back to card's defaultEffort.
    // Models without defaultEffort (e.g. grok-4) get no reasoning block — grok-4
    // rejects reasoning_effort per XAI docs.
    const effectiveReasoningEffort = reasoningEffort || modelConfig.reasoning?.defaultEffort;
    if (supportsReasoning && !disableThinking && effectiveReasoningEffort && effectiveReasoningEffort !== 'none') {
      // R20: OpenAI Responses API rejects 'xhigh' (XAI-only effort level).
      // Cross-provider sessions where the prior turn was XAI at xhigh would
      // 400 on switch. Clamp at egress — standard cross-provider guard.
      const effort = (!isXAI && effectiveReasoningEffort === 'xhigh' as any) ? 'high' : effectiveReasoningEffort;
      responsesRequest.reasoning = { effort, summary: 'auto' };
    }

    // Add tools if present (already in correct format from ResponsesAPIAdapter)
    if (request.tools && request.tools.length > 0) {
      responsesRequest.tools = request.tools;
    }

    if (process.env.DEBUG === 'true') {
      const { input, tools, instructions: instr, ...requestSummary } = responsesRequest;
      const inputTypes = (input || []).map((i: any) => i.type);
      console.log(`[DEBUG APIClient] Responses API (non-streaming) request:`, JSON.stringify({
        ...requestSummary,
        input: `[${input?.length || 0} items: ${inputTypes.join(', ')}]`,
        tools: tools ? `[${tools.length} tools]` : undefined,
        max_output_tokens: responsesRequest.max_output_tokens,
        has_instructions: !!responsesRequest.instructions,
        has_previous_response_id: !!responsesRequest.previous_response_id
      }, null, 2));
    }

    // R27: XAI's /v1/responses route rejects the OpenAI SDK's request shape
    // (404 "No handler found on route") and, without server-side tools, returns
    // a body the SDK path surfaces as empty content. Use a raw fetch with
    // Bearer auth — standard Responses API transport auth.
    // OpenAI's own Responses API still uses the SDK (R20-proven, unaffected).
    if (isXAI) {
      const httpResponse = await fetch(modelConfig.api.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify(responsesRequest),
      });
      if (!httpResponse.ok) {
        const errorText = await httpResponse.text().catch(() => 'Unknown error');
        throw new Error(`XAI Responses API error ${httpResponse.status}: ${errorText}`);
      }
      const data = await httpResponse.json();
      return { data, status: 200, headers: {} };
    }

    // OpenAI Responses API — SDK path (R20-proven working)
    const OpenAI = (await import('openai')).default;
    const baseURL = modelConfig.api.endpoint.replace(/\/(messages|responses)$/, '');
    const client = new OpenAI({ apiKey, baseURL });
    const data = await client.responses.create(responsesRequest);

    return {
      data,
      status: 200,
      headers: {}
    };
  }


  /**
   * Send request using GenerateContent API pattern
   *
   * Used by: Google Gemini (Vertex AI, AI Studio)
   * Format: Google GenerativeAI GenerateContent API
   */
  private async sendGenerateContentAPI(
    request: PreparedRequest,
    modelConfig: ModelConfig
  ): Promise<APIResponse> {
    const apiKey = process.env[modelConfig.api.apiKeyEnvVar];
    if (!apiKey) {
      throw new Error(`Missing API key: ${modelConfig.api.apiKeyEnvVar}`);
    }

    // For models with tools, use direct HTTP to ensure v1beta endpoint is used
    // The SDK sometimes uses v1 which doesn't support tools for newer models
    if (request.tools && request.tools.length > 0) {
      return this.sendGenerateContentHTTP(request, modelConfig, apiKey);
    }

    // For non-tool requests, use SDK as before
    if (!this.googleClient) {
      this.googleClient = new GoogleGenerativeAI(apiKey);
    }

    // Get model - models/gemini-1.5-flash format
    const modelName = request.modelId.startsWith('models/') ? request.modelId : `models/${request.modelId}`;
    const model = this.googleClient.getGenerativeModel({ model: modelName });

    // Build generation config (exclude model parameter - disableThinking is NOT an API parameter)
    const { model: _model, ...generationConfig } = request.parameters;

    // Build request
    const geminiRequest: any = {
      contents: request.messages,
      generationConfig
    };

    // Send request
    const result = await model.generateContent(geminiRequest);
    const response = result.response;

    // Return response with usageMetadata for proper token tracking
    // The usageMetadata is at the response level, not nested
    // Based on gemini-cli implementation (packages/core/src/core/turn.ts:308)
    // and official docs: https://ai.google.dev/api/generate-content
    return {
      data: response,  // response already has usageMetadata
      status: 200,
      headers: {}
    };
  }

  /**
   * Send GenerateContent request via direct HTTP
   * Ensures v1beta endpoint is used for tool support
   */
  private async sendGenerateContentHTTP(
    request: PreparedRequest,
    modelConfig: ModelConfig,
    apiKey: string
  ): Promise<APIResponse> {
    // Get model ID (no models/ prefix - endpoint already includes it)
    const modelId = request.modelId.startsWith('models/')
      ? request.modelId.replace('models/', '')
      : request.modelId;

    // Build URL using configured endpoint (should be v1beta)
    // Endpoint already ends with /models, so just append modelId
    const url = `${modelConfig.api.endpoint}/${modelId}:generateContent`;

    // Build generation config (exclude model parameter - disableThinking is NOT an API parameter)
    // Extract the nested generationConfig object from request.parameters
    const { generationConfig } = request.parameters;

    // Build request body (REST API uses snake_case)
    const requestBody: any = {
      contents: request.messages,
      generation_config: generationConfig  // Use the nested object directly
    };

    // Add tools if present
    if (request.tools && request.tools.length > 0) {
      // REST API uses snake_case "function_declarations", not camelCase "functionDeclarations"
      requestBody.tools = [{ function_declarations: request.tools }];

      // DEBUG: Log Gemini tool request details
      if (process.env.DEBUG === 'true') {
        console.log(`[DEBUG APIClient] Gemini HTTP request with ${request.tools.length} tools:`);
        console.log(`[DEBUG APIClient] Tool names: ${request.tools.map((t: any) => t.name).join(', ')}`);
        console.log(`[DEBUG APIClient] First tool structure:`, JSON.stringify(request.tools[0], null, 2));
        console.log(`[DEBUG APIClient] Request body tools wrapper:`, JSON.stringify(requestBody.tools[0], null, 2).substring(0, 500));
      }
    }

    // Make HTTP request
    const httpResponse = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [modelConfig.api.authHeader]: apiKey
      },
      body: JSON.stringify(requestBody)
    });

    if (!httpResponse.ok) {
      const errorText = await httpResponse.text();
      throw new Error(`Google GenerateContent API error (${httpResponse.status}): ${errorText}`);
    }

    const data: any = await httpResponse.json();

    // Return full response (same structure as SDK)
    // The response has: candidates, usageMetadata, modelVersion, responseId
    return {
      data: data,
      status: httpResponse.status,
      headers: Object.fromEntries(httpResponse.headers.entries())
    };
  }

  /**
   * Send request using Google GenAI API pattern
   *
   * Used by: Google Gemma (FREE models)
   * Format: @google/genai simplified API
   * Note: This is different from GenerateContent API used by Gemini
   */
  private async sendGoogleGenAIRequest(
    request: PreparedRequest,
    modelConfig: ModelConfig
  ): Promise<APIResponse> {
    if (!this.googleGenAIClient) {
      const apiKey = process.env[modelConfig.api.apiKeyEnvVar];
      if (!apiKey) {
        throw new Error(`Missing API key: ${modelConfig.api.apiKeyEnvVar}`);
      }
      this.googleGenAIClient = new GoogleGenAI({ apiKey });
    }

    // Build request for GoogleGenAI (simpler format)
    // Convert messages array to conversation history
    const messages = request.messages.map((msg: any) => ({
      role: msg.role === 'model' ? 'model' : 'user',
      content: typeof msg.content === 'string'
        ? msg.content
        : msg.parts?.map((p: any) => p.text || '').join('') || ''
    }));

    // Use last message as prompt
    const lastMessage = messages[messages.length - 1];
    const prompt = lastMessage?.content || '';

    // Send request using simplified API
    const response = await this.googleGenAIClient.models.generateContent({
      model: request.modelId,
      contents: prompt
    });

    // Return response in standard format
    // Note: GoogleGenAI doesn't provide detailed usage metadata
    return {
      data: {
        text: response.text,
        // Estimate token usage (no actual counts from this API)
        usage: {
          inputTokens: Math.ceil((prompt.length) / 4),
          outputTokens: Math.ceil((response.text?.length || 0) / 4),
        }
      },
      status: 200,
      headers: {}
    };
  }

  /**
   * Stream request using Messages API pattern
   *
   * Used by: Anthropic (native), XAI (Anthropic-compatible)
   * Format: Anthropic Messages API with SSE events
   */
  private streamMessagesAPI(
    request: PreparedRequest,
    modelConfig: ModelConfig
  ): StreamingResponse {
    const provider = modelConfig.provider.toLowerCase();

    // Anthropic: Use native SDK with OAuth or API key + prompt caching
    if (provider === 'anthropic') {
      if (!this.anthropicClient) {
        this.anthropicClient = this.initializeAnthropicClient();
      }

      // Phase 2.8: Extract internal flags before building request
      const disableThinking = (request.parameters as any).disableThinking;
      const reasoningEffort = (request.parameters as any).reasoningEffort as string | undefined;

      // Exclude internal flags from API request parameters
      const { disableThinking: _, reasoningEffort: _re, ...apiParameters } = request.parameters;

      // Check if prompt caching is enabled
      const enableCaching = process.env.ANTHROPIC_PROMPT_CACHING !== 'false';

      // Build request (same as non-streaming)
      const anthropicRequest: any = {
        model: request.modelId,
        messages: request.messages,
        max_tokens: request.parameters.max_tokens || request.parameters.maxTokens || 4096,
        ...apiParameters
      };

      // Add system message with cache_control for prompt caching
      if (request.systemMessage) {
        if (enableCaching) {
          anthropicRequest.system = [{
            type: 'text',
            text: request.systemMessage,
            cache_control: { type: 'ephemeral' }
          }];
        } else {
          anthropicRequest.system = request.systemMessage;
        }
      }

      // Add tools with cache_control on last tool for caching
      if (request.tools && request.tools.length > 0) {
        if (enableCaching) {
          const tools = request.tools.map((tool, index) => {
            if (index === request.tools!.length - 1) {
              return { ...(tool as object), cache_control: { type: 'ephemeral' } };
            }
            return tool;
          });
          anthropicRequest.tools = tools;
        } else {
          anthropicRequest.tools = request.tools;
        }
      }

      // Phase 2.8: Enable extended thinking for Claude 4+ models with reasoning support
      // Requires beta header: anthropic-beta: interleaved-thinking-2025-05-14
      // Skip if disableThinking option is set (used for continuation requests)
      // reasoningEffort scales budget_tokens: none/undefined=10000 (default), low=5000, medium=10000, high=50000
      // 'none' = default budget (thinking stays on). Anthropic thinking always enabled for supported models.
      if (modelConfig.reasoning?.supported && modelConfig.reasoning?.pattern === 'interleaved' && !disableThinking) {
        // Opus 4.7/4.8 and Fable 5 require adaptive thinking — enabled/budget_tokens
        // 400s (parity with the non-streaming path above).
        const useAdaptive = ANTHROPIC_ADAPTIVE_THINKING_FAMILIES.has(modelConfig.family);
        if (useAdaptive) {
          // display:'summarized' surfaces reasoning in the CLI but costs extra output
          // tokens; default 'omitted' streams empty thinking blocks for $0. Gated on
          // DEBUG_THINKING (parity with the non-streaming path above).
          anthropicRequest.thinking =
            process.env.DEBUG_THINKING === 'true'
              ? { type: 'adaptive', display: 'summarized' }
              : { type: 'adaptive' };
          if (process.env.DEBUG === 'true' || process.env.DEBUG_THINKING === 'true') {
            console.log(`[DEBUG APIClient] Adaptive thinking for ${modelConfig.id}${process.env.DEBUG_THINKING === 'true' ? ' (display: summarized)' : ''}`);
          }
        } else {
        const budgetMap: Record<string, number> = {
          none: 10000,    // default budget — thinking stays on
          low: 5000,
          medium: 10000,
          high: 50000,
        };
        const budgetTokens = reasoningEffort ? (budgetMap[reasoningEffort] || 10000) : 10000;

        anthropicRequest.thinking = {
          type: 'enabled',
          budget_tokens: budgetTokens
        };
        if (process.env.DEBUG === 'true' || process.env.DEBUG_THINKING === 'true') {
          console.log(`[DEBUG APIClient] Thinking ENABLED for ${modelConfig.id} (budget: ${budgetTokens}, effort: ${reasoningEffort || 'default'})`);
        }
        }
      } else if (process.env.DEBUG === 'true' || process.env.DEBUG_THINKING === 'true') {
        console.log(`[DEBUG APIClient] Thinking NOT enabled: supported=${modelConfig.reasoning?.supported}, pattern=${modelConfig.reasoning?.pattern}, disableThinking=${disableThinking}`);
      }

      // PTC: Add container for session persistence
      const enablePTC = (request.parameters as any).enablePTC;
      const ptcContainerId = (request.parameters as any).containerId;
      if (enablePTC && modelConfig.supportsPTC) {
        if (ptcContainerId) {
          anthropicRequest.container = { id: ptcContainerId };
        } else {
          anthropicRequest.container = {};
        }
      }

      // Build beta headers for thinking, tool streaming, and caching
      const betaFeatures: string[] = [];

      if (anthropicRequest.thinking) {
        betaFeatures.push('interleaved-thinking-2025-05-14');
        betaFeatures.push('fine-grained-tool-streaming-2025-05-14');
      }

      if (enablePTC && modelConfig.supportsPTC) {
        betaFeatures.push('code-execution-2026-01-20');
      }

      if (enableCaching) {
        betaFeatures.push('prompt-caching-2024-07-31');
      }

      const headers = betaFeatures.length > 0
        ? { 'anthropic-beta': betaFeatures.join(',') }
        : undefined;

      const stream = this.anthropicClient.messages.stream(anthropicRequest, { headers });

      // Capture 'this' context before entering async generator
      const self = this;

      // Track thinking blocks and signatures for proper accumulation
      // SDK's finalMessage() doesn't include signatures streamed via signature_delta
      // This map is shared between the generator and finalMessage handler
      const thinkingSignatures: Map<number, string> = new Map();

      // SDK's finalMessage() might not accumulate tool inputs correctly with beta features
      // Track accumulated inputs by block index for injection into finalMessage
      const toolInputs: Map<number, Record<string, unknown>> = new Map();

      // Create async generator for chunks
      const chunks = async function* () {
        // Phase 2.8: Track tool use accumulation for streaming tool execution
        let currentToolUse: Partial<CanonicalToolUse> | null = null;
        let partialJson = '';
        let currentToolUseIndex = -1;

        // Track current thinking block for signature association
        let currentThinkingIndex = -1;
        let signatureAccumulator = '';

        try {
        // Use SDK's async iteration for events
        for await (const event of stream) {
          // DEBUG: Log important event types (skip repetitive text_delta)
          if (process.env.DEBUG_THINKING === 'true') {
            const delta = (event as any).delta;
            if (event.type === 'content_block_delta') {
              // Only log non-text delta types to reduce noise
              if (delta?.type && delta.type !== 'text_delta') {
                console.log(`[DEBUG APIClient] Claude event: ${event.type}, delta.type: ${delta?.type}`);
              }
            } else if (event.type === 'content_block_start') {
              if (process.env.DEBUG === 'true') console.log(`[DEBUG APIClient] Claude event: ${event.type}, content_block.type: ${(event as any).content_block?.type}, index: ${(event as any).index}`);
            }
          }

          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            yield {
              type: 'text_delta' as const,
              delta: event.delta.text,
              data: event
            };
          } else if (event.type === 'content_block_delta' && (event.delta as any).type === 'thinking_delta') {
            // Anthropic Claude extended thinking (interleaved reasoning)
            yield {
              type: 'content_block_delta' as const,
              delta: (event.delta as any).thinking,
              data: { ...event, reasoning: true }
            };
          } else if (event.type === 'content_block_start') {
            // Track content block index from event
            const blockIndex = (event as any).index;

            // Phase 2.8: Check if this is a tool_use block
            if ((event as any).content_block?.type === 'tool_use') {
              currentToolUse = {
                id: (event as any).content_block.id,
                name: (event as any).content_block.name,
                input: {}
              };
              currentToolUseIndex = blockIndex;
              partialJson = '';
            } else if ((event as any).content_block?.type === 'server_tool_use') {
              // PTC: Server-side tool use — accumulate same as tool_use
              currentToolUse = {
                id: (event as any).content_block.id,
                name: (event as any).content_block.name,
                input: {}
              };
              currentToolUseIndex = blockIndex;
              partialJson = '';
            }

            // Track thinking blocks for signature association
            if ((event as any).content_block?.type === 'thinking') {
              currentThinkingIndex = blockIndex;
              signatureAccumulator = '';
            }

            yield {
              type: 'content_block_start' as const,
              data: event
            };
          } else if (event.type === 'content_block_delta' && (event.delta as any).type === 'signature_delta') {
            // Accumulate signature for current thinking block
            signatureAccumulator += (event.delta as any).signature || '';
          } else if (event.type === 'content_block_delta' && (event.delta as any).type === 'input_json_delta') {
            // Phase 2.8: Accumulate tool input JSON incrementally
            partialJson += (event.delta as any).partial_json;

            // Try parsing accumulated JSON
            try {
              currentToolUse!.input = JSON.parse(partialJson);
            } catch {
              // JSON not complete yet, continue accumulating
            }

            yield {
              type: 'content_block_delta' as const,
              delta: (event.delta as any).partial_json,
              data: event
            };
          } else if (event.type === 'content_block_stop') {
            // Phase 2.8: If we have a complete tool use, emit it
            if (currentToolUse) {
              // If incremental JSON parsing never succeeded, try repair on the full accumulated string
              if ((!currentToolUse.input || Object.keys(currentToolUse.input).length === 0) && partialJson.length > 0) {
                try {
                  currentToolUse.input = self.repairTruncatedJSON(partialJson);
                } catch {
                  console.error(`[APIClient Anthropic] Failed to repair tool JSON (${partialJson.length} chars): ${partialJson.slice(0, 200)}...`);
                }
              }

              const decodedInput = self.decodeHtmlEntitiesInObject(currentToolUse.input);
              currentToolUse.input = decodedInput;

              // Save accumulated input for injection into finalMessage
              // SDK's finalMessage might not accumulate input_json_delta correctly with beta features
              if (currentToolUseIndex >= 0 && decodedInput && Object.keys(decodedInput).length > 0) {
                toolInputs.set(currentToolUseIndex, decodedInput);
                if (process.env.DEBUG === 'true' || process.env.DEBUG_THINKING === 'true') {
                  console.log(`[DEBUG APIClient] Captured tool input for block ${currentToolUseIndex}, keys: ${Object.keys(decodedInput).join(', ')}`);
                }
              }

              yield {
                type: 'tool_use_complete' as const,
                toolUse: currentToolUse as CanonicalToolUse,
                data: event
              };

              // Reset for next tool use
              currentToolUse = null;
              currentToolUseIndex = -1;
              partialJson = '';
            }

            // Save accumulated signature for thinking block
            if (currentThinkingIndex >= 0 && signatureAccumulator) {
              thinkingSignatures.set(currentThinkingIndex, signatureAccumulator);
              if (process.env.DEBUG === 'true' || process.env.DEBUG_THINKING === 'true') {
                console.log(`[DEBUG APIClient] Captured signature for thinking block ${currentThinkingIndex}, length: ${signatureAccumulator.length}`);
              }
              currentThinkingIndex = -1;
              signatureAccumulator = '';
            }

            yield {
              type: 'content_block_stop' as const,
              data: event
            };
          } else if (event.type === 'message_start') {
            yield {
              type: 'message_start' as const,
              data: event
            };
          } else if (event.type === 'message_delta') {
            yield {
              type: 'message_delta' as const,
              data: event
            };
          } else if (event.type === 'message_stop') {
            yield {
              type: 'message_stop' as const,
              data: event
            };
          }
        }
        } catch (streamError: any) {
          // Handle stream errors gracefully (e.g., "request ended without sending any chunks")
          const errorMessage = streamError?.message || 'Unknown streaming error';
          console.error(`[APIClient Anthropic] Stream error: ${errorMessage}`);

          // Yield an error event that the orchestrator can handle
          yield {
            type: 'error' as const,
            error: {
              type: 'stream_error',
              message: `API stream failed: ${errorMessage}. This is usually a transient error - please retry.`
            }
          };
        }
      }();

      // Get final message promise (SDK accumulates internally)
      // Inject signatures that were captured from signature_delta events
      const finalMessage = stream.finalMessage().then(msg => {
        // Inject captured signatures into thinking blocks
        // The SDK doesn't accumulate signature_delta into the final message
        if ((msg as any).content && thinkingSignatures.size > 0) {
          let thinkingBlockIndex = 0;
          for (let i = 0; i < (msg as any).content.length; i++) {
            const block = (msg as any).content[i];
            if (block.type === 'thinking') {
              const signature = thinkingSignatures.get(i);
              if (signature) {
                block.signature = signature;
                if (process.env.DEBUG === 'true' || process.env.DEBUG_THINKING === 'true') {
                  console.log(`[DEBUG APIClient] Injected signature into thinking block ${i}`);
                }
              }
              thinkingBlockIndex++;
            }
          }
        }

        // Inject captured tool inputs into tool_use blocks
        // SDK's finalMessage might not accumulate input_json_delta correctly with beta features
        if ((msg as any).content && toolInputs.size > 0) {
          for (let i = 0; i < (msg as any).content.length; i++) {
            const block = (msg as any).content[i];
            if (block.type === 'tool_use') {
              const accumulatedInput = toolInputs.get(i);
              // Only inject if SDK's input is empty but we have accumulated input
              if (accumulatedInput && (!block.input || Object.keys(block.input).length === 0)) {
                block.input = accumulatedInput;
                if (process.env.DEBUG === 'true' || process.env.DEBUG_THINKING === 'true') {
                  console.log(`[DEBUG APIClient] Injected accumulated tool input into block ${i}, keys: ${Object.keys(accumulatedInput).join(', ')}`);
                }
              }
            }
          }
        }

        // DEBUG: Log final message content to diagnose thinking block signatures
        if (process.env.DEBUG === 'true' || process.env.DEBUG_THINKING === 'true') {
          console.log(`[DEBUG APIClient] Claude finalMessage content types:`,
            (msg as any).content?.map((b: any) => `${b.type}${b.type === 'thinking' ? ` (sig: ${b.signature ? 'yes' : 'no'})` : ''}`));
          // Log tool_use input to debug parameter extraction
          for (const block of (msg as any).content || []) {
            if (block.type === 'tool_use') {
              console.log(`[DEBUG APIClient] Tool use block:`, {
                id: block.id,
                name: block.name,
                input: block.input,
                inputKeys: Object.keys(block.input || {})
              });
            }
          }
        }
        return msg;
      });

      return {
        chunks,
        finalMessage
      };
    }

    // XAI Messages API: Anthropic-compatible, use Anthropic SDK with custom baseURL
    if (provider === 'xai') {
      const apiKey = process.env[modelConfig.api.apiKeyEnvVar];
      if (!apiKey) {
        throw new Error(`Missing API key: ${modelConfig.api.apiKeyEnvVar}`);
      }

      // Create Anthropic client with XAI base URL.
      // `x-grok-conv-id` default header routes same-session requests to same server
      // for cache hits — per XAI docs (advanced-api-usage/prompt-caching/maximizing-cache-hits).
      const xaiDefaultHeaders: Record<string, string> = {};
      if (request.conversationId) {
        xaiDefaultHeaders['x-grok-conv-id'] = request.conversationId;
      }
      const xaiClient = new Anthropic({
        apiKey,
        baseURL: modelConfig.api.endpoint.replace('/v1/messages', ''), // Strip path, keep base
        defaultHeaders: xaiDefaultHeaders
      });

      // Extract internal flags before spreading into API request
      // XAI Messages API does NOT support Anthropic's thinking parameter —
      // XAI models think natively (embedded <thinking> tags or thinking content blocks)
      const { disableThinking: _xaiDisableThinking, reasoningEffort: _xaiReasoningEffort, ...xaiApiParameters } = request.parameters;

      // Build request (same format as Anthropic)
      const anthropicRequest: any = {
        model: request.modelId,
        messages: request.messages,
        max_tokens: xaiApiParameters.max_tokens || xaiApiParameters.maxTokens || 4096,
        ...xaiApiParameters
      };

      if (request.systemMessage) {
        anthropicRequest.system = request.systemMessage;
      }

      if (request.tools && request.tools.length > 0) {
        // XAI requires complete tool schemas with descriptions for ALL tools and parameters
        anthropicRequest.tools = this.validateXAITools(request.tools);
      }

      // Use SDK streaming (same as Anthropic!)
      const stream = xaiClient.messages.stream(anthropicRequest);

      // Phase 2.8: XAI Bug Fix - Build our own finalMessage because SDK doesn't accumulate tool inputs
      const accumulatedContent: any[] = [];
      let textAccumulator = '';
      let thinkingAccumulator = '';
      let streamCompleteResolve: any;
      const streamCompletePromise = new Promise(resolve => {
        streamCompleteResolve = resolve;
      });

      // Create async generator for chunks (same pattern as Anthropic)
      const chunks = async function* () {
        // Phase 2.8: Track tool use accumulation
        let currentToolUse: Partial<CanonicalToolUse> | null = null;
        let partialJson = '';
        let currentBlockType: string | null = null;
        let redactedThinkingData: string = '';
        // R28c (Cache-Hit Contract Rule 2): capture the thinking-block
        // signature from signature_delta so it round-trips to XAI. Omitting
        // reasoning signature is xAI's documented #1 cause of cache misses.
        // The Anthropic path already does this (signatureAccumulator); the
        // XAI stream previously did not — that broke the XAI prompt cache.
        let xaiSignatureAccumulator = '';

        try {
        // Use SDK's async iteration for events (same as Anthropic)
        for await (const event of stream) {

          if (event.type === 'content_block_start') {
            currentBlockType = (event as any).content_block?.type;

            // Phase 2.8: Check if this is a tool_use block
            if ((event as any).content_block?.type === 'tool_use') {
              currentToolUse = {
                id: (event as any).content_block.id,
                name: (event as any).content_block.name,
                input: {}
              };
              partialJson = '';
            } else if ((event as any).content_block?.type === 'server_tool_use') {
              // PTC: Server-side tool use — accumulate same as tool_use
              currentToolUse = {
                id: (event as any).content_block.id,
                name: (event as any).content_block.name,
                input: {}
              };
              partialJson = '';
            } else if ((event as any).content_block?.type === 'text') {
              textAccumulator = '';
            } else if ((event as any).content_block?.type === 'thinking') {
              thinkingAccumulator = '';
            } else if ((event as any).content_block?.type === 'redacted_thinking') {
              // XAI grok-4/4.1 encrypted reasoning — accumulate data field
              redactedThinkingData = (event as any).content_block?.data || '';
            } else if ((event as any).content_block?.type === 'code_execution_tool_result') {
              // PTC: Code execution result — accumulate text output
              textAccumulator = '';
            }

            yield {
              type: 'content_block_start' as const,
              data: event
            };
          } else if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            textAccumulator += event.delta.text;
            yield {
              type: 'text_delta' as const,
              delta: event.delta.text,
              data: event
            };
          } else if (event.type === 'content_block_delta' && (event.delta as any).type === 'thinking_delta') {
            // XAI Grok reasoning traces (grok-code-fast-1 exposes plaintext thinking)
            thinkingAccumulator += (event.delta as any).thinking;
            yield {
              type: 'content_block_delta' as const,
              delta: (event.delta as any).thinking,
              data: { ...event, reasoning: true }
            };
          } else if (event.type === 'content_block_delta' && (event.delta as any).type === 'redacted_thinking_delta') {
            // XAI grok-4/4.1 encrypted reasoning delta
            redactedThinkingData += (event.delta as any).data || '';
            yield {
              type: 'content_block_delta' as const,
              delta: (event.delta as any).data || '',
              data: { ...event, reasoning: true, redacted: true }
            };
          } else if (event.type === 'content_block_delta' && (event.delta as any).type === 'signature_delta') {
            // R28c: accumulate the thinking-block signature (Cache-Hit Contract Rule 2)
            xaiSignatureAccumulator += (event.delta as any).signature || '';
          } else if (event.type === 'content_block_delta' && (event.delta as any).type === 'input_json_delta') {
            // Phase 2.8: Accumulate tool input JSON incrementally
            partialJson += (event.delta as any).partial_json;

            // Try parsing accumulated JSON
            try {
              currentToolUse!.input = JSON.parse(partialJson);
            } catch {
              // JSON not complete yet, continue accumulating
            }

            yield {
              type: 'content_block_delta' as const,
              delta: (event.delta as any).partial_json,
              data: event
            };
          } else if (event.type === 'content_block_stop') {
            // Phase 2.8: Save completed content block to our accumulator
            if (currentBlockType === 'text' && textAccumulator) {
              accumulatedContent.push({ type: 'text', text: textAccumulator });
            } else if (currentBlockType === 'thinking' && thinkingAccumulator) {
              // R28c: attach the captured signature so it round-trips to XAI (Rule 2)
              accumulatedContent.push({
                type: 'thinking',
                thinking: thinkingAccumulator,
                ...(xaiSignatureAccumulator && { signature: xaiSignatureAccumulator })
              });
              xaiSignatureAccumulator = '';
            } else if (currentBlockType === 'redacted_thinking' && redactedThinkingData) {
              accumulatedContent.push({ type: 'redacted_thinking', data: redactedThinkingData });
              redactedThinkingData = '';
            } else if (currentBlockType === 'tool_use' && currentToolUse) {
              // Use our accumulated input, not the SDK's empty one!
              accumulatedContent.push({
                type: 'tool_use',
                id: currentToolUse.id,
                name: currentToolUse.name,
                input: currentToolUse.input
              });

              yield {
                type: 'tool_use_complete' as const,
                toolUse: currentToolUse as CanonicalToolUse,
                data: event
              };

              // Reset for next tool use
              currentToolUse = null;
              partialJson = '';
            } else if (currentBlockType === 'server_tool_use' && currentToolUse) {
              // PTC: Server-side tool use — push as server_tool_use
              accumulatedContent.push({
                type: 'server_tool_use',
                id: currentToolUse.id,
                name: currentToolUse.name,
                input: currentToolUse.input
              });

              yield {
                type: 'tool_use_complete' as const,
                toolUse: currentToolUse as CanonicalToolUse,
                data: event
              };

              currentToolUse = null;
              partialJson = '';
            } else if (currentBlockType === 'code_execution_tool_result' && textAccumulator) {
              // PTC: Code execution result — push accumulated output
              accumulatedContent.push({
                type: 'code_execution_tool_result',
                tool_use_id: '',
                content: textAccumulator
              });
            }

            yield {
              type: 'content_block_stop' as const,
              data: event
            };
          } else if (event.type === 'message_start') {
            yield {
              type: 'message_start' as const,
              data: event
            };
          } else if (event.type === 'message_delta') {
            yield {
              type: 'message_delta' as const,
              data: event
            };
          } else if (event.type === 'message_stop') {
            yield {
              type: 'message_stop' as const,
              data: event
            };
          }
        }
        } catch (streamError: any) {
          // Handle stream errors gracefully (e.g., "request ended without sending any chunks")
          const errorMessage = streamError?.message || 'Unknown streaming error';
          console.error(`[APIClient XAI] Stream error: ${errorMessage}`);

          // Yield an error event that the orchestrator can handle
          yield {
            type: 'error' as const,
            error: {
              type: 'stream_error',
              message: `XAI API stream failed: ${errorMessage}. This is usually a transient error - please retry.`
            }
          };
        }
        // Stream complete - resolve promise so finalMessage can build
        streamCompleteResolve();
      }();

      // Phase 2.8: Build our own finalMessage with correctly accumulated tool inputs
      // The SDK's finalMessage() doesn't accumulate tool inputs for XAI, so we build our own
      const finalMessage = Promise.all([stream.finalMessage(), streamCompletePromise]).then(([sdkMessage]) => {
        // After stream completes, replace the SDK's broken content with our correctly accumulated content
        let finalContent = accumulatedContent.length > 0 ? accumulatedContent : sdkMessage.content;

        // XAI: Check for reasoning_content field in the message
        // XAI can include reasoning_content or encrypted_content at the message level
        if ((sdkMessage as any).reasoning_content) {
          // Insert reasoning content as first block (upfront thinking)
          finalContent = [
            { type: 'thinking', thinking: (sdkMessage as any).reasoning_content },
            ...finalContent
          ];
        }

        // Extract <thinking> tags from text blocks (grok-4-1 embeds thinking in text)
        finalContent = this.extractThinkingFromTextBlocks(finalContent);

        return {
          ...sdkMessage,
          content: finalContent
        };
      });

      return {
        chunks,
        finalMessage
      };
    }

    throw new Error(`Streaming not yet implemented for ${provider} with Messages API pattern`);
  }

  /**
   * Stream request using Chat Completions API pattern
   *
   * Used by: OpenAI, XAI, DeepSeek, Groq, Anthropic (OpenAI-compatible)
   * Format: OpenAI Chat Completions with SSE chunks
   * SDK: Uses OpenAI SDK's ChatCompletionStream with .finalMessage() accumulation
   */
  private streamChatCompletionsAPI(
    request: PreparedRequest,
    modelConfig: ModelConfig
  ): StreamingResponse {
    // Round 7: shared request construction (env check, baseURL strip,
    // OpenRouter headers, client cache, param rename, reasoning_effort,
    // tool attachment, DEBUG_PAYLOAD logging).
    const { client, chatRequest: openaiRequest } = this.buildChatCompletionsRequest(
      request,
      modelConfig,
      { stream: true },
    );

    // Import ChatCompletionStream dynamically (avoid top-level import issues)
    // Note: We'll use the client's .create() with stream: true which returns Stream<ChatCompletionChunk>
    // However, we want the ChatCompletionStream helper for .finalMessage()

    // For now, use manual iteration and accumulation (SDK's Stream doesn't have finalMessage)
    // TODO: Investigate if there's a better way to use ChatCompletionStream.createChatCompletion

    let fullContent = '';
    let fullReasoningContent = '';
    let firstChunk: any = null;
    let finalMessageResolve!: (value: any) => void;
    const finalMessagePromise = new Promise<any>((resolve) => {
      finalMessageResolve = resolve;
    });

    // Phase 2.8: Track tool calls for streaming tool execution
    const accumulatedToolCalls = new Map<number, { id?: string; name?: string; arguments: string }>();

    // Capture this context before entering generator
    const self = this;

    // Create async generator that both yields chunks AND accumulates final message
    const chunks = async function* () {
      if (process.env.DEBUG === 'true' || process.env.DEBUG_THINKING === 'true') {
        console.log(`[DEBUG APIClient] OpenAI request:`, JSON.stringify(openaiRequest, null, 2));
      }

      const stream = await client.chat.completions.create(openaiRequest) as any;

      let chunkCount = 0;
      for await (const chunk of stream) {
        if (!firstChunk) firstChunk = chunk;
        chunkCount++;

        const delta = chunk.choices[0]?.delta;

        // Debug: Log first few chunks to see what fields are present
        if ((process.env.DEBUG === 'true' || process.env.DEBUG_THINKING === 'true') && chunkCount <= 3) {
          console.log(`[DEBUG APIClient] Chunk ${chunkCount} delta keys:`, delta ? Object.keys(delta) : 'null');
          if (delta?.reasoning_content) {
            console.log(`[DEBUG APIClient] Found reasoning_content in chunk ${chunkCount}`);
          }
        }

        // Extract reasoning content (for models with native interleaved thinking)
        // XAI: chunk.choices[0].delta.reasoning_content
        // DeepSeek: chunk.choices[0].delta.reasoning_content
        // GPT-5: chunk.choices[0].delta.reasoning_content (when reasoning_effort != 'none')
        if (delta?.reasoning_content) {
          fullReasoningContent += delta.reasoning_content;

          yield {
            type: 'content_block_delta' as const,
            delta: delta.reasoning_content,
            data: { ...chunk, reasoning: true }
          };
        }

        // Extract regular text content
        if (delta?.content) {
          fullContent += delta.content;

          yield {
            type: 'text_delta' as const,
            delta: delta.content,
            data: chunk
          };
        }

        // Phase 2.8: Handle streaming tool_calls
        if (delta?.tool_calls && Array.isArray(delta.tool_calls)) {
          for (const toolCallDelta of delta.tool_calls) {
            const index = toolCallDelta.index;

            // Initialize tool call accumulator if needed
            if (!accumulatedToolCalls.has(index)) {
              accumulatedToolCalls.set(index, { arguments: '' });
            }

            const accumulated = accumulatedToolCalls.get(index)!;

            // Accumulate tool call properties
            if (toolCallDelta.id) {
              accumulated.id = toolCallDelta.id;
            }
            if (toolCallDelta.function?.name) {
              accumulated.name = toolCallDelta.function.name;
            }
            if (toolCallDelta.function?.arguments) {
              accumulated.arguments += toolCallDelta.function.arguments;
            }
          }
        }

        // Check if finish_reason indicates tool_calls completion (or length-truncated tool call)
        const finishReason = chunk.choices[0]?.finish_reason;
        if ((finishReason === 'tool_calls' || finishReason === 'length') && accumulatedToolCalls.size > 0) {
          // Emit tool_use_complete events for each accumulated tool call
          for (const [_, toolCall] of accumulatedToolCalls) {
            if (toolCall.id && toolCall.name) {
              try {
                let input: Record<string, unknown>;
                try {
                  input = JSON.parse(toolCall.arguments);
                } catch {
                  input = self.repairTruncatedJSON(toolCall.arguments);
                }

                const decodedInput = self.decodeHtmlEntitiesInObject(input);

                yield {
                  type: 'tool_use_complete' as const,
                  toolUse: {
                    id: toolCall.id,
                    name: toolCall.name,
                    input: decodedInput
                  },
                  data: chunk
                };
              } catch (error) {
                console.error(`[APIClient] Failed to parse tool arguments (${toolCall.arguments.length} chars): ${toolCall.arguments.slice(0, 200)}...`);
              }
            }
          }
        }
      }

      // Stream complete - log summary
      if (process.env.DEBUG === 'true' || process.env.DEBUG_THINKING === 'true') {
        console.log(`[DEBUG APIClient] Stream complete - total chunks: ${chunkCount}, reasoning content length: ${fullReasoningContent.length}, content length: ${fullContent.length}`);
      }

      // Stream complete - resolve final message in OpenAI Chat Completions format
      // Include accumulated tool_calls in the final message
      const finalToolCalls = Array.from(accumulatedToolCalls.values())
        .filter(tc => tc.id && tc.name)
        .map(tc => ({
          id: tc.id!,
          type: 'function' as const,
          function: {
            name: tc.name!,
            arguments: tc.arguments
          }
        }));

      finalMessageResolve({
        id: firstChunk?.id || 'chatcmpl-' + Date.now(),
        object: 'chat.completion',
        created: firstChunk?.created || Math.floor(Date.now() / 1000),
        model: firstChunk?.model || request.modelId,
        choices: [{
          index: 0,
          message: {
            role: 'assistant',
            content: fullContent || null,
            ...(fullReasoningContent && { reasoning_content: fullReasoningContent }),
            ...(finalToolCalls.length > 0 && { tool_calls: finalToolCalls })
          },
          finish_reason: finalToolCalls.length > 0 ? 'tool_calls' : 'stop'
        }],
        usage: {
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0
        }
      });
    }();

    return {
      chunks,
      finalMessage: finalMessagePromise
    };
  }

  /**
   * Stream request using Responses API pattern
   *
   * Used by: OpenAI (gpt-5-codex)
   * Format: OpenAI Responses API with structured streaming events
   * SDK: Uses OpenAI SDK's client.responses.create() with stream: true
   */
  private streamResponsesAPI(
    request: PreparedRequest,
    modelConfig: ModelConfig
  ): StreamingResponse {
    const apiKey = process.env[modelConfig.api.apiKeyEnvVar];
    if (!apiKey) {
      throw new Error(`Missing API key: ${modelConfig.api.apiKeyEnvVar}`);
    }

    // Use provider-formatted input items directly from ResponsesAPIAdapter.toProviderMessages()
    // The adapter already creates correctly typed items (message, function_call_output, etc.)
    // Re-wrapping them would strip tool results and function calls, breaking the tool loop.
    //
    // Extract <system-reminder> content from user messages into `instructions` parameter.
    const { instructions, cleanedItems: inputItems } = this.extractSystemRemindersForResponsesAPI(request.messages);

    // Accumulate content from stream
    let fullContent = '';
    let fullReasoningContent = '';
    let responseId: string | null = null;
    let finalResponse: any = null;
    const accumulatedToolCalls: Array<{ id: string; name: string; arguments: string }> = [];
    let finalMessageResolve!: (value: any) => void;
    const finalMessagePromise = new Promise<any>((resolve) => {
      finalMessageResolve = resolve;
    });

    // Check if reasoning is supported and enabled
    const supportsReasoning = modelConfig.reasoning?.supported;
    const { disableThinking, reasoningEffort, ...apiParameters } = request.parameters;

    // Transform parameters for Responses API.
    // Responses API uses max_output_tokens instead of max_tokens.
    // R20c: also accept max_completion_tokens (GPT-5 chat/completions default key)
    // — needed on dynamic switch where the card never re-resolved the param name.
    let transformedParams = { ...apiParameters };
    for (const oldKey of ['max_tokens', 'max_completion_tokens', 'maxTokens'] as const) {
      if (oldKey in transformedParams) {
        transformedParams.max_output_tokens = (transformedParams as any)[oldKey];
        delete (transformedParams as any)[oldKey];
      }
    }

    const isXAI = modelConfig.provider?.toLowerCase() === 'xai';

    const chunks = async function* () {
      // Import OpenAI SDK dynamically — set baseURL from model config endpoint
      const OpenAI = (await import('openai')).default;
      const streamBaseURL = modelConfig.api.endpoint.replace(/\/(messages|responses)$/, '');
      const client = new OpenAI({ apiKey, baseURL: streamBaseURL });

      // Create streaming request
      // Use modelConfig.modelId if available (for alias models like gpt-5.1-reasoning -> gpt-5.1)
      const actualModelId = modelConfig.modelId || request.modelId;

      // Remove model from transformedParams to prevent overwriting
      const { model: _ignoredModel, ...paramsWithoutModel } = transformedParams as any;

      const responsesRequest: any = {
        model: actualModelId,
        input: inputItems,
        stream: true,
        ...paramsWithoutModel
      };

      // Stateful chaining: use previous_response_id when available
      if (request.previousResponseId) {
        responsesRequest.previous_response_id = request.previousResponseId;
      }

      // XAI stores conversations server-side by default. Being explicit ensures preservation.
      // `prompt_cache_key` routes same-session requests to same server for cache hits.
      // NOTE: `include: ["reasoning.encrypted_content"]` triggered empty-output regression —
      // see sendResponsesAPI comment for details. Not sending it for now.
      if (isXAI) {
        responsesRequest.store = true;
        if (request.conversationId) {
          responsesRequest.prompt_cache_key = request.conversationId;
        }
      }

      // Set extracted system context as instructions (enables provider-side caching)
      // XAI does NOT support the `instructions` parameter — skip for XAI provider.
      if (instructions && !isXAI) {
        responsesRequest.instructions = instructions;
      }

      // Add reasoning if supported and not disabled
      // Responses API uses 'reasoning' object with 'effort' parameter
      // summary: 'auto' requests visible reasoning summaries for interleaved thinking
      if (supportsReasoning && !disableThinking && reasoningEffort && reasoningEffort !== 'none') {
        // R20: OpenAI Responses API rejects 'xhigh' (XAI-only effort level). Clamp at egress.
        const effectiveEffort = (!isXAI && reasoningEffort === 'xhigh' as any) ? 'high' : reasoningEffort;
        responsesRequest.reasoning = { effort: effectiveEffort, summary: 'auto' };

        if (process.env.DEBUG === 'true' || process.env.DEBUG_THINKING === 'true') {
          console.log(`[DEBUG APIClient] Responses API reasoning ENABLED (effort: ${effectiveEffort}, summary: auto)`);
        }
      }

      if (request.tools && request.tools.length > 0) {
        responsesRequest.tools = request.tools;
      }

      if (process.env.DEBUG === 'true' || process.env.DEBUG_THINKING === 'true') {
        // Log summary without full tools/messages to avoid excessive output
        const { input, tools, ...requestSummary } = responsesRequest;
        console.log(`[DEBUG APIClient] Responses API request:`, JSON.stringify({
          ...requestSummary,
          input: `[${input?.length || 0} items]`,
          tools: tools ? `[${tools.length} tools]` : undefined
        }, null, 2));
      }

      // Stream using OpenAI SDK
      // client.responses.create() with stream:true returns a Promise<Stream>
      // We await it to get the Stream object which is async iterable
      const stream: any = await client.responses.create(responsesRequest);

      let chunkCount = 0;
      try {
        for await (const chunk of stream) {
          chunkCount++;

          // Store response ID and full response
          if (chunk.response?.id && !responseId) {
            responseId = chunk.response.id;
          }
          if (chunk.response) {
            finalResponse = chunk.response;
          }

          // Debug: Log chunks to see event types (only with DEBUG=true)
          if (process.env.DEBUG === 'true' && chunkCount <= 10) {
            console.log(`[APIClient] Responses chunk ${chunkCount}:`, chunk.type, chunk.item?.type || '');
          }

          // Handle reasoning items (when modalities includes 'reasoning')
          // Responses API returns reasoning as output items with type: 'reasoning'
          if (chunk.type === 'response.output_item.added' && chunk.item?.type === 'reasoning') {
            // Reasoning item started
            if (process.env.DEBUG === 'true' || process.env.DEBUG_THINKING === 'true') {
              console.log(`[DEBUG APIClient] Reasoning item started`);
            }
          } else if (chunk.type === 'response.output_item.done' && chunk.item?.type === 'reasoning') {
            // Reasoning item completed - extract summary
            const reasoningSummary = chunk.item.summary || '';
            if (reasoningSummary) {
              fullReasoningContent += reasoningSummary;
              yield {
                type: 'content_block_delta' as const,
                delta: reasoningSummary,
                data: { ...chunk, reasoning: true }
              };
            }
          }

          // Handle reasoning content deltas (streamed reasoning text)
          if (chunk.type === 'response.reasoning_summary_text.delta' && chunk.delta) {
            fullReasoningContent += chunk.delta;
            yield {
              type: 'content_block_delta' as const,
              delta: chunk.delta,
              data: { ...chunk, reasoning: true }
            };
          }

          // Handle text content deltas
          if (chunk.type === 'response.output_text.delta' && chunk.delta) {
            fullContent += chunk.delta;
            yield {
              type: 'text_delta' as const,
              delta: chunk.delta,
              data: chunk
            };
          }

          // Handle function calls (tool use)
          // Responses API sends function_call items with name and arguments
          if (chunk.type === 'response.output_item.done' && chunk.item?.type === 'function_call') {
            const item = chunk.item;
            if (item.name && item.call_id) {
              // Round 18a: dedupe by call_id. Without this guard, the
              // OpenAI Responses streaming protocol can re-emit the same
              // `response.output_item.done` event multiple times (observed
              // in gpt-5.1-reasoning: 5 identical tool_use blocks with the
              // SAME call_id reached the orchestrator). Each duplicate
              // pushed to accumulatedToolCalls AND yielded as
              // tool_use_complete, causing the same tool to "execute" N
              // times.
              const alreadyEmitted = accumulatedToolCalls.some(
                (tc) => tc.id === item.call_id,
              );
              if (alreadyEmitted) {
                continue;
              }

              // Accumulate for finalMessage
              accumulatedToolCalls.push({
                id: item.call_id,
                name: item.name,
                arguments: item.arguments || '{}'
              });

              try {
                const input = typeof item.arguments === 'string'
                  ? JSON.parse(item.arguments)
                  : item.arguments;

                yield {
                  type: 'tool_use_complete' as const,
                  toolUse: {
                    id: item.call_id,
                    name: item.name,
                    input: input
                  },
                  data: chunk
                };
              } catch (error) {
                console.error(`[APIClient] Failed to parse function call arguments:`, item.arguments);
              }
            }
          }

          // Extract text deltas from output items (fallback for non-streaming format)
          if (chunk.type === 'response.output_item.added' && chunk.item) {
            const item = chunk.item;
            if (item.type === 'message' && item.content) {
              for (const block of item.content) {
                if (block.type === 'output_text' && block.text) {
                  fullContent += block.text;
                  yield {
                    type: 'text_delta' as const,
                    delta: block.text,
                    data: chunk
                  };
                }
              }
            }
          } else if (chunk.type === 'response.output_item.done' && chunk.item) {
            const item = chunk.item;
            if (item.type === 'message' && item.content) {
              for (const block of item.content) {
                if (block.type === 'output_text' && block.text) {
                  const text = block.text;
                  if (text && !fullContent.includes(text)) {
                    fullContent += text;
                    yield {
                      type: 'text_delta' as const,
                      delta: text,
                      data: chunk
                    };
                  }
                }
              }
            }
          }
        }
      } catch (error: any) {
        throw new Error(`Responses API streaming error: ${error.message}`);
      }

      // Log summary
      if (process.env.DEBUG === 'true' || process.env.DEBUG_THINKING === 'true') {
        console.log(`[DEBUG APIClient] Responses stream complete - chunks: ${chunkCount}, reasoning: ${fullReasoningContent.length}, content: ${fullContent.length}`);
      }

      // Resolve final message in Responses API format
      // Build output array with message and any function calls
      const outputItems: any[] = [];

      // Add function calls first (they come before the message in the response)
      for (const toolCall of accumulatedToolCalls) {
        outputItems.push({
          type: 'function_call',
          call_id: toolCall.id,
          name: toolCall.name,
          arguments: toolCall.arguments
        });
      }

      // Add message if there's content
      if (fullContent) {
        outputItems.push({
          type: 'message',
          role: 'assistant',
          content: [
            {
              type: 'output_text',
              text: fullContent
            }
          ]
        });
      }

      finalMessageResolve({
        id: responseId || 'resp-' + Date.now(),
        object: 'response',
        created: finalResponse?.created_at || Math.floor(Date.now() / 1000),
        model: request.modelId,
        output: outputItems.length > 0 ? outputItems : [
          {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: '' }]
          }
        ],
        usage: finalResponse?.usage || {
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0
        }
      });
    }();

    return {
      chunks,
      finalMessage: finalMessagePromise
    };
  }

  /**
   * Stream request using Google GenerateContent API pattern
   *
   * Used by: Google Gemini (Vertex AI, AI Studio)
   * Format: Google GenerateContent API
   * SDK: Uses Google SDK's generateContentStream()
   */
  private streamGenerateContentAPI(
    request: PreparedRequest,
    modelConfig: ModelConfig
  ): StreamingResponse {
    const apiKey = process.env[modelConfig.api.apiKeyEnvVar];
    if (!apiKey) {
      throw new Error(`Missing API key: ${modelConfig.api.apiKeyEnvVar}`);
    }

    // For models with tools, use direct HTTP streaming to ensure v1beta endpoint
    // The SDK sometimes uses v1 which doesn't support tools for newer models
    if (request.tools && request.tools.length > 0) {
      return this.streamGenerateContentHTTP(request, modelConfig, apiKey);
    }

    // For non-tool requests, use SDK streaming
    if (!this.googleClient) {
      this.googleClient = new GoogleGenerativeAI(apiKey);
    }

    const modelName = request.modelId.startsWith('models/') ? request.modelId : `models/${request.modelId}`;
    const model = this.googleClient.getGenerativeModel({ model: modelName });

    // Filter out internal flags and non-generation parameters
    // NOTE: disableThinking is NOT an API parameter - it's a UI-level flag
    const { model: _model, stream, tools: _tools, ...validGenerationConfig } = request.parameters;

    const geminiRequest: any = {
      contents: request.messages,
      generationConfig: validGenerationConfig
    };

    // Google SDK has generateContentStream
    const streamPromise = model.generateContentStream(geminiRequest);

    const chunks = async function* () {
      const { stream } = await streamPromise;

      for await (const chunk of stream) {
        const text = chunk.text();
        if (text) {
          yield {
            type: 'text_delta' as const,
            delta: text,
            data: chunk
          };
        }
      }
    }();

    const finalMessage = (async () => {
      const { response } = await streamPromise;
      return response;
    })();

    return {
      chunks,
      finalMessage
    };
  }

  /**
   * Stream GenerateContent request via direct HTTP with tools
   * Ensures v1beta endpoint is used for tool support
   */
  private streamGenerateContentHTTP(
    request: PreparedRequest,
    modelConfig: ModelConfig,
    apiKey: string
  ): StreamingResponse {
    // Get model ID (no models/ prefix - endpoint already includes it)
    const modelId = request.modelId.startsWith('models/')
      ? request.modelId.replace('models/', '')
      : request.modelId;

    // Build URL using configured endpoint (should be v1beta)
    const url = `${modelConfig.api.endpoint}/${modelId}:streamGenerateContent?alt=sse&key=${apiKey}`;

    // Build generation config (exclude stream, tools, and model - these are handled separately)
    // NOTE: disableThinking is NOT an API parameter - it's a UI-level flag
    // Extract the nested generationConfig object from request.parameters
    const { generationConfig } = request.parameters;

    // Build request body (REST API uses snake_case)
    const requestBody: any = {
      contents: request.messages,
      generation_config: generationConfig  // Use the nested object directly
    };

    // Add tools if present - REST API uses snake_case "function_declarations"
    if (request.tools && request.tools.length > 0) {
      requestBody.tools = [{ function_declarations: request.tools }];

      // DEBUG: Log Gemini streaming tool request details
      if (process.env.DEBUG === 'true') {
        console.log(`[DEBUG APIClient] Gemini streaming request with ${request.tools.length} tools:`);
        console.log(`[DEBUG APIClient] Tool names: ${request.tools.map((t: any) => t.name).join(', ')}`);
      }
    }

    // Add system instruction if present
    if (request.systemMessage) {
      requestBody.system_instruction = {
        parts: [{ text: request.systemMessage }]
      };
    }

    // DEBUG: Log the request body for diagnosing empty responses
    if (process.env.DEBUG === 'true') {
      console.log(`[DEBUG APIClient HTTP] Request URL: ${url.replace(/key=[^&]+/, 'key=***')}`);
      console.log(`[DEBUG APIClient HTTP] generation_config: ${JSON.stringify(requestBody.generation_config)}`);
      console.log(`[DEBUG APIClient HTTP] tools count: ${requestBody.tools?.[0]?.function_declarations?.length ?? 0}`);
      console.log(`[DEBUG APIClient HTTP] system_instruction present: ${!!requestBody.system_instruction}`);
      console.log(`[DEBUG APIClient HTTP] contents length: ${requestBody.contents?.length ?? 0}`);
      // Dump contents structure (roles and parts types, not full text)
      for (let i = 0; i < (requestBody.contents?.length ?? 0); i++) {
        const c = requestBody.contents[i];
        const partsInfo = (c.parts || []).map((p: any) => {
          if (p.text) return `text(${p.text.length}chars)`;
          if (p.functionCall) return `functionCall(${p.functionCall.name})`;
          if (p.functionResponse) return `functionResponse(${p.functionResponse.name})`;
          return Object.keys(p).join(',');
        });
        if (process.env.DEBUG === 'true') console.log(`[DEBUG APIClient HTTP] contents[${i}]: role=${c.role}, parts=[${partsInfo.join(', ')}]`);
      }
      // Write full request body to file for inspection
      import('fs').then(fs => fs.writeFileSync('/tmp/gemini-request-' + modelId + '.json', JSON.stringify(requestBody, null, 2)));
    }

    // Start the fetch request
    const fetchPromise = fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    // Shared state for collecting all chunks
    const allChunks: any[] = [];
    let fullText = '';
    let lastCandidate: any = null;
    let streamingError: Error | null = null;

    // Resolve function for completion signal
    let resolveCompletion: (() => void) | null = null;
    const completionPromise = new Promise<void>((resolve) => {
      resolveCompletion = resolve;
    });

    // Create async generator for streaming chunks
    const chunks = async function* () {
      try {
        const response = await fetchPromise;

        if (!response.ok) {
          const errorText = await response.text();
          console.error(`[APIClient] Gemini API error ${response.status}:`, errorText);
          throw new Error(`Gemini API error: ${response.status} - ${errorText}`);
        }

        if (!response.body) {
          throw new Error('Response body is null');
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            if (process.env.DEBUG === 'true') {
              console.log('[DEBUG APIClient] Stream reader done, exiting loop');
            }
            break;
          }

          buffer += decoder.decode(value, { stream: true });

          // Process complete SSE messages
          const lines = buffer.split('\n');
          buffer = lines.pop() || ''; // Keep incomplete line in buffer

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const jsonStr = line.slice(6); // Remove 'data: ' prefix
              if (jsonStr.trim() === '') continue;

              try {
                const chunk = JSON.parse(jsonStr);

                // DEBUG: Log chunk structure
                if (process.env.DEBUG === 'true') {
                  console.log('[DEBUG APIClient] Gemini chunk:', JSON.stringify(chunk).substring(0, 200));
                  if (chunk.candidates?.[0]?.finishReason) {
                    console.log(`[DEBUG APIClient] finishReason: ${chunk.candidates[0].finishReason}`);
                  }
                }

                // Store last candidate for final response
                if (chunk.candidates?.[0]) {
                  lastCandidate = chunk.candidates[0];
                }

                // Extract parts from candidates
                const parts = chunk.candidates?.[0]?.content?.parts;
                if (parts && Array.isArray(parts)) {
                  for (const part of parts) {
                    // Handle thinking parts (reasoning blocks)
                    // Following gemini-cli pattern: yield ALL chunks including thinking
                    // UI will filter based on disableThinking flag
                    if (part.thought && part.text) {
                      const thinkingChunk = {
                        type: 'thinking_delta' as const,
                        delta: part.text,
                        data: chunk
                      };
                      allChunks.push(thinkingChunk);
                      // Don't add to fullText - thinking is filtered from final response
                      yield thinkingChunk;
                    }
                    // Handle regular text (non-thinking)
                    else if (part.text && !part.thought) {
                      const chunkData = {
                        type: 'text_delta' as const,
                        delta: part.text,
                        data: chunk
                      };
                      allChunks.push(chunkData);
                      fullText += part.text;
                      yield chunkData;
                    }

                    // Handle function calls (tool uses)
                    if (part.functionCall) {
                      // R19c: preserve thoughtSignature for Gemini 2.5+/3+
                      // multi-turn function calling. SDK streaming path (~line
                      // 2944) already does this; the raw-fetch streaming path
                      // (used by gemini-3-pro-preview via apiPattern
                      // 'generateContent') was dropping it, causing Gemini 3 to
                      // 400 with "Function call is missing a thought_signature"
                      // on every continuation and looping until MAX_TOOL_ITER.
                      const thoughtSig = (part as any).thoughtSignature as string | undefined;
                      const toolUse: any = {
                        // R19a: uuidv4 instead of Date.now()+Math.random — same
                        // collision-free reasoning as adapters.
                        id: `call_${uuidv4()}`,
                        name: part.functionCall.name,
                        input: part.functionCall.args
                      };
                      if (thoughtSig) {
                        toolUse.metadata = { thoughtSignature: thoughtSig };
                      }
                      const toolChunk = {
                        type: 'tool_use_complete' as const,
                        toolUse,
                        data: chunk
                      };
                      allChunks.push(toolChunk);
                      yield toolChunk;
                    }
                  }
                }
              } catch (parseError) {
                console.error('Error parsing SSE chunk:', parseError);
              }
            }
          }
        }
      } catch (error) {
        streamingError = error as Error;
        throw error;
      } finally {
        // Signal that streaming is complete (success or error)
        if (resolveCompletion) {
          resolveCompletion();
        }
      }
    }();

    // Final message promise that waits for streaming to complete
    const finalMessage = (async () => {
      // Wait for streaming to complete (without consuming the chunks)
      await completionPromise;

      // If there was an error, throw it
      if (streamingError) {
        throw streamingError;
      }

      // Return final response structure matching Google SDK format
      return {
        text: () => fullText,
        candidates: lastCandidate ? [lastCandidate] : [],
        usageMetadata: lastCandidate?.usageMetadata
      };
    })();

    return {
      chunks,
      finalMessage
    };
  }

  /**
   * Validate and enhance tools for XAI Messages API
   * XAI requires ALL tools and parameters to have descriptions
   */
  private validateXAITools(tools: any[]): any[] {
    return tools.map((tool, index) => {
      const enhancedTool = { ...tool };

      // Ensure tool has a name
      if (!enhancedTool.name || typeof enhancedTool.name !== 'string') {
        enhancedTool.name = `tool_${index}`;
      }

      // REQUIRED: Ensure tool has a description
      if (!enhancedTool.description || typeof enhancedTool.description !== 'string') {
        enhancedTool.description = enhancedTool.name ?
          `Execute ${enhancedTool.name} tool` :
          `Tool ${index}`;
        if (process.env.DEBUG === 'true') console.log(`[XAI Validation] Added missing description for tool: ${enhancedTool.name}`);
      }

      // REQUIRED: Ensure input_schema exists
      if (!enhancedTool.input_schema) {
        console.error(`[XAI Validation] Tool ${enhancedTool.name} missing input_schema! Creating default.`);
        enhancedTool.input_schema = {
          type: 'object',
          properties: {},
          required: []
        };
      }

      // Ensure input_schema has proper structure
      if (!enhancedTool.input_schema.type) {
        enhancedTool.input_schema.type = 'object';
      }

      if (!enhancedTool.input_schema.properties) {
        enhancedTool.input_schema.properties = {};
      }

      // REQUIRED: Ensure all parameters have descriptions
      if (enhancedTool.input_schema.properties) {
        const properties = enhancedTool.input_schema.properties;

        for (const [key, prop] of Object.entries(properties) as [string, any][]) {
          if (!prop.description || typeof prop.description !== 'string') {
            prop.description = `Parameter ${key} for ${enhancedTool.name || 'tool'}`;
            if (process.env.DEBUG === 'true') console.log(`[XAI Validation] Added missing description for parameter: ${key}`);
          }
        }

        // Ensure required field exists (XAI expects it)
        if (!enhancedTool.input_schema.required) {
          enhancedTool.input_schema.required = [];
        }
      }

      return enhancedTool;
    });
  }

  /**
   * Send non-streaming request using Google GenAI SDK
   * Mirrors streamGoogleSDK() but uses generateContent() instead of generateContentStream()
   */
  private async sendGoogleSDK(
    request: PreparedRequest,
    _modelConfig: ModelConfig
  ): Promise<APIResponse> {
    // Initialize Google GenAI client (same as streaming path)
    if (!this.googleGenAIClient) {
      const apiKey = process.env['GEMINI_API_KEY'];
      if (!apiKey) {
        throw new Error('GEMINI_API_KEY environment variable is required for Google SDK models');
      }
      const oldGoogleKey = process.env['GOOGLE_API_KEY'];
      delete process.env['GOOGLE_API_KEY'];
      try {
        this.googleGenAIClient = new GoogleGenAI({ apiKey });
      } finally {
        if (oldGoogleKey) {
          process.env['GOOGLE_API_KEY'] = oldGoogleKey;
        }
      }
    }

    // Strip -sdk suffix for actual API model ID
    let modelId = request.modelId;
    if (modelId.endsWith('-sdk')) {
      modelId = modelId.replace(/-sdk$/, '');
    }

    const { generationConfig, disableThinking } = request.parameters;
    const config: any = {};

    if (generationConfig) {
      Object.assign(config, generationConfig);
    }

    // CRITICAL: thinkingConfig and tools CANNOT coexist
    const hasTools = request.tools && request.tools.length > 0;
    if (_modelConfig.reasoning?.supported && _modelConfig.reasoning?.pattern === 'interleaved' && !disableThinking && !hasTools) {
      config.thinkingConfig = {
        includeThoughts: true,
        thinkingBudget: 10000
      };
    }

    // Add tools to config if present
    if (hasTools && request.tools) {
      config.tools = request.tools.map((tool: any) => ({
        functionDeclarations: [{
          name: tool.name,
          description: tool.description,
          parameters: tool.input_schema
        }]
      }));
    }

    const sdkRequest: any = {
      model: modelId,
      contents: request.messages,
      config
    };

    if (request.systemMessage) {
      sdkRequest.systemInstruction = request.systemMessage;
    }

    if (process.env.DEBUG === 'true') {
      console.log(`[DEBUG APIClient SDK] Non-streaming request for model: ${modelId}`);
    }

    const response = await this.googleGenAIClient.models.generateContent(sdkRequest);

    return {
      data: response,
      status: 200,
      headers: {}
    };
  }

  /**
   * Stream using Google GenAI SDK (EXPERIMENTAL)
   * Uses @google/genai SDK directly instead of REST API
   *
   * Key differences from streamGenerateContentAPI:
   * - Uses new @google/genai package (not @google/generative-ai)
   * - Automatically reads GEMINI_API_KEY from environment
   * - Simpler API with better stability
   * - Matches Google's official documentation examples
   */
  private streamGoogleSDK(
    request: PreparedRequest,
    _modelConfig: ModelConfig
  ): StreamingResponse {
    // Initialize Google GenAI client (explicitly use GEMINI_API_KEY per docs)
    if (!this.googleGenAIClient) {
      const apiKey = process.env['GEMINI_API_KEY'];
      if (!apiKey) {
        throw new Error('GEMINI_API_KEY environment variable is required for Google SDK models');
      }

      // Temporarily unset GOOGLE_API_KEY to prevent SDK from preferring it
      // The SDK checks both GEMINI_API_KEY and GOOGLE_API_KEY, but prefers GOOGLE_API_KEY
      const oldGoogleKey = process.env['GOOGLE_API_KEY'];
      delete process.env['GOOGLE_API_KEY'];

      try {
        this.googleGenAIClient = new GoogleGenAI({ apiKey });
      } finally {
        // Restore GOOGLE_API_KEY for other providers
        if (oldGoogleKey) {
          process.env['GOOGLE_API_KEY'] = oldGoogleKey;
        }
      }
    }

    // Use actual Google model ID (strip our custom suffix if present)
    // e.g., "gemini-2.5-flash-sdk" -> "gemini-2.5-flash"
    let modelId = request.modelId;
    if (modelId.endsWith('-sdk')) {
      modelId = modelId.replace(/-sdk$/, '');
    }

    // Extract parameters
    const { generationConfig, disableThinking } = request.parameters;

    // Build config object (tools go inside config per Google SDK docs)
    const config: any = {};

    // Add generation parameters to config
    if (generationConfig) {
      Object.assign(config, generationConfig);
    }

    // Enable extended thinking for models with reasoning support (Gemini 2.5+)
    // Following Claude/Grok pattern: Skip if disableThinking flag is set (used for continuation requests)
    // CRITICAL: thinkingConfig and tools CANNOT coexist — Google API returns empty responses when both present
    const hasTools = request.tools && request.tools.length > 0;
    if (_modelConfig.reasoning?.supported && _modelConfig.reasoning?.pattern === 'interleaved' && !disableThinking && !hasTools) {
      config.thinkingConfig = {
        includeThoughts: true,  // Enable thought summaries in response
        // Gemini 2.5 Flash supports thinkingBudget (0-24576)
        // -1 = dynamic (model decides), or set explicit budget like Claude's 10000
        // Set to 10000 tokens to encourage verbose reasoning like Claude
        thinkingBudget: 10000
      };

      if (process.env.DEBUG === 'true') {
        console.log(`[DEBUG APIClient SDK] Extended thinking enabled for ${modelId} with budget: 10000`);
      }
    } else if (hasTools && process.env.DEBUG === 'true') {
      console.log(`[DEBUG APIClient SDK] Skipping thinkingConfig for ${modelId} — incompatible with tools`);
    }

    // Add tools to config if present (per SDK docs, tools are inside config)
    if (request.tools && request.tools.length > 0) {
      config.tools = request.tools.map((tool: any) => ({
        functionDeclarations: [{
          name: tool.name,
          description: tool.description,
          parameters: tool.input_schema
        }]
      }));

      if (process.env.DEBUG === 'true') {
        console.log(`[DEBUG APIClient SDK] Gemini SDK request with ${request.tools.length} tools`);
        console.log(`[DEBUG APIClient SDK] Tool names: ${request.tools.map((t: any) => t.name).join(', ')}`);
      }
    }

    // Build request for new SDK
    const sdkRequest: any = {
      model: modelId,
      contents: request.messages,
      config  // Config contains both generation params and tools
    };

    // Add system instruction if present (top level, not in config)
    if (request.systemMessage) {
      sdkRequest.systemInstruction = request.systemMessage;
    }

    if (process.env.DEBUG === 'true') {
      console.log(`[DEBUG APIClient SDK] Using model: ${modelId}`);
      console.log(`[DEBUG APIClient SDK] Request keys: ${Object.keys(sdkRequest).join(', ')}`);
      if (config.tools) {
        console.log(`[DEBUG APIClient SDK] Config has ${config.tools.length} tool(s)`);
      }
    }

    // Shared state between chunks generator and finalMessage
    let lastChunk: any = null;
    let fullText = '';
    let chunkCount = 0;  // Track number of chunks for debugging
    let resolveComplete!: () => void;
    const streamCompletePromise = new Promise<void>((resolve) => {
      resolveComplete = resolve;
    });

    const chunks = async function* (client: GoogleGenAI) {
      try {
        // Stream using new SDK (SINGLE API call)
        const stream = await client.models.generateContentStream(sdkRequest);

        if (process.env.DEBUG === 'true') {
          console.log(`[DEBUG APIClient SDK] Stream started for model: ${modelId}`);
        }

        for await (const chunk of stream) {
          // Store for final message
          lastChunk = chunk;
          chunkCount++;

          if (process.env.DEBUG === 'true') {
            console.log(`[DEBUG APIClient SDK] Chunk ${chunkCount}: candidates=${chunk.candidates?.length || 0}, finishReason=${chunk.candidates?.[0]?.finishReason || 'none'}`);
          }

          // Process candidates array (similar to REST API approach)
          const candidates = chunk.candidates;
          if (candidates && Array.isArray(candidates)) {
            for (const candidate of candidates) {
              const parts = candidate.content?.parts;
              if (parts && Array.isArray(parts)) {
                for (const part of parts) {
                  // Handle thinking parts (extended reasoning) - similar to Claude's extended thinking
                  // Following gemini-cli pattern: yield ALL chunks including thinking
                  if ((part as any).thought && part.text) {
                    if (process.env.DEBUG === 'true') {
                      console.log(`[DEBUG APIClient SDK] Thinking chunk length: ${part.text.length}`);
                    }

                    yield {
                      type: 'thinking_delta' as const,
                      delta: part.text,
                      data: chunk
                    };
                    continue;  // Skip adding to fullText (thinking is separate)
                  }

                  // Handle regular text
                  if (part.text && !part.functionCall) {
                    const text = part.text;
                    fullText += text;

                    if (process.env.DEBUG === 'true') {
                      console.log(`[DEBUG APIClient SDK] Chunk text length: ${text.length}`);
                    }

                    // BREAK DOWN LARGE TEXT CHUNKS FOR SMOOTH STREAMING
                    // SDK yields larger chunks (full lines/sentences) unlike HTTP SSE which is more granular
                    // Split into smaller pieces to provide smoother streaming experience
                    if (text.length > 50) {
                      // For large chunks, yield in smaller pieces
                      const words = text.split(/(\s+)/); // Split on whitespace but keep delimiters
                      let currentChunk = '';

                      for (const word of words) {
                        currentChunk += word;

                        // Yield when we have a reasonable chunk size or hit natural breaks
                        if (currentChunk.length >= 20 || word.includes('\n') || word.includes('.') || word.includes('?') || word.includes('!')) {
                          yield {
                            type: 'text_delta' as const,
                            delta: currentChunk,
                            data: chunk
                          };
                          currentChunk = '';
                        }
                      }

                      // Yield any remaining text
                      if (currentChunk.length > 0) {
                        yield {
                          type: 'text_delta' as const,
                          delta: currentChunk,
                          data: chunk
                        };
                      }
                    } else {
                      // For smaller chunks, yield as-is
                      yield {
                        type: 'text_delta' as const,
                        delta: text,
                        data: chunk
                      };
                    }
                  }

                  // Handle function calls (tool uses)
                  if (part.functionCall) {
                    if (process.env.DEBUG === 'true') {
                      console.log(`[DEBUG APIClient SDK] Function call: ${part.functionCall.name}`);
                      if ((part as any).thoughtSignature) {
                        console.log(`[DEBUG APIClient SDK] Has thought signature: ${(part as any).thoughtSignature.substring(0, 50)}...`);
                      }
                    }

                    // Build toolUse with thought signature preserved in metadata
                    const rand: number = Math.random();
                    const toolUse: any = {
                      id: `call_${Date.now()}_${rand.toString(36).substring(2, 11)}`,
                      name: part.functionCall.name || 'unknown',  // Ensure name is always string
                      input: part.functionCall.args || {}        // Ensure input is always object
                    };

                    // CRITICAL: Preserve thought signature for multi-turn function calling (Gemini 2.5+/3+)
                    const thoughtSig = (part as any).thoughtSignature;
                    if (thoughtSig) {
                      toolUse.metadata = { thoughtSignature: thoughtSig };
                    }

                    yield {
                      type: 'tool_use_complete' as const,
                      toolUse,
                      data: chunk
                    };
                  }
                }
              }
            }
          }
        }

        if (process.env.DEBUG === 'true') {
          console.log(`[DEBUG APIClient SDK] Stream complete after ${chunkCount} chunks`);
          console.log(`[DEBUG APIClient SDK] Full text length: ${fullText.length}`);
          console.log(`[DEBUG APIClient SDK] lastChunk keys: ${Object.keys(lastChunk || {}).join(', ')}`);
          if (lastChunk?.candidates) {
            console.log(`[DEBUG APIClient SDK] candidates length: ${lastChunk.candidates.length}`);
            if (lastChunk.candidates.length > 0) {
              if (process.env.DEBUG === 'true') console.log(`[DEBUG APIClient SDK] candidates[0] keys: ${Object.keys(lastChunk.candidates[0] || {}).join(', ')}`);
              console.log(`[DEBUG APIClient SDK] finishReason: ${lastChunk.candidates[0]?.finishReason || 'none'}`);
              if (lastChunk.candidates[0]?.content) {
                console.log(`[DEBUG APIClient SDK] content.parts length: ${lastChunk.candidates[0].content.parts?.length || 0}`);
              }
            }
          } else {
            console.warn(`[DEBUG APIClient SDK] No candidates in final chunk!`);
          }
          if (lastChunk?.usageMetadata) {
            if (process.env.DEBUG === 'true') console.log(`[DEBUG APIClient SDK] Token usage: ${JSON.stringify(lastChunk.usageMetadata)}`);
          }
        }

        // Check for problematic finish reasons
        const finishReason = lastChunk?.candidates?.[0]?.finishReason;
        if (finishReason && finishReason !== 'STOP') {
          console.warn(`[APIClient SDK] Unexpected finishReason: ${finishReason}`);
          if (finishReason === 'SAFETY' || finishReason === 'RECITATION') {
            console.warn(`[APIClient SDK] Response was blocked. Check safety ratings.`);
          } else if (finishReason === 'MAX_TOKENS') {
            console.warn(`[APIClient SDK] Response truncated due to token limit.`);
          }
        }

        // Yield message_stop chunk to signal completion (triggers markdown flush in CLI)
        yield {
          type: 'message_stop' as const,
          data: lastChunk
        };

        // Signal that stream is complete
        resolveComplete();
      } catch (error) {
        console.error('[APIClient SDK] Streaming error:', error);
        // Signal completion even on error
        resolveComplete();
        throw error;
      }
    }(this.googleGenAIClient);

    const finalMessage = (async () => {
      // Wait for chunks generator to complete
      await streamCompletePromise;

      // Return final response structure matching Google SDK format
      // This matches the structure expected by the orchestrator
      return {
        text: () => fullText,
        candidates: lastChunk?.candidates || [],
        usageMetadata: lastChunk?.usageMetadata
      };
    })();

    return {
      chunks,
      finalMessage
    };
  }
}
