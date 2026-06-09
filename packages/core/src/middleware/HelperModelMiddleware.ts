/**
 * Helper Model Middleware
 * Based on: CORTEX_V4_PHASE_1.5_ARCHITECTURE.md Part 6
 *
 * Two-Tier Token Economy:
 * - Expensive models (Claude, GPT-4) for actual work
 * - Cheap helper models (Haiku, GPT-3.5, Flash) for context management
 *
 * Features:
 * - Automatic fallback on context rejection
 * - Transparent processing (helper does work, returns to main)
 * - Cost tracking (60-80% savings on context operations)
 *
 * Week 2 Integration:
 * - Uses independent helper middleware adapter system
 * - Real API calls via pattern-based adapters
 * - Supports Messages API, Chat Completions API, Google GenAI API
 */

import { ModelConfig, ModelRegistry } from '../models/ModelConfig.interface.js';
import {
  HelperModelMiddlewareRegistry,
  helperRegistry,
  registerDefaultHelperAdapters,
  type HelperCanonicalMessage
} from './helpers/index.js';
import { StoredCompactionManager, type CompactionSummaries, type CompactionProcessing, type TimelineReference } from '../conversation/StoredCompactionManager.js';
import { SessionTimeline } from '../session/SessionTimeline.js';
import type { Message } from '../session/MessageTypes.js';
import { TokenCounter } from '../utils/TokenCounter.js';
import { ErrorDetector } from '../utils/ErrorDetector.js';

/**
 * Context Limit Error
 *
 * Represents an error when a model rejects a request due to context window limits
 */
export interface ContextLimitError extends Error {
  type: 'context_limit';
  provider: string;
  modelId: string;
  requestedTokens?: number;
  maxTokens?: number;
  details?: any;
}

/**
 * Context Rejection Analysis
 */
export interface RejectionAnalysis {
  reason: 'history_too_large' | 'tool_results_too_large' | 'combined_overflow';
  historyTokens: number;
  toolResultTokens: number;
  totalTokens: number;
  maxTokens: number;
  excessTokens: number;
}

/**
 * Model Request (generic)
 */
export interface ModelRequest {
  messages: any[];
  tools?: any[];
  parameters?: Record<string, any>;
  systemPrompt?: string;
}

/**
 * Model Response (generic)
 */
export interface ModelResponse {
  content: string | any[];
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  stopReason?: string;
  metadata?: Record<string, any>;
}

/**
 * Helper Model Registry
 *
 * Maps main model providers to their appropriate helper models
 */
export const HELPER_MODEL_REGISTRY: Record<string, string> = {
  // Anthropic: Claude -> Haiku ($1/1M tokens)
  anthropic: 'claude-haiku-4-5',

  // OpenAI: cheap helper -> GPT-4.1 mini (registered, current; gpt-3.5-turbo deprecated/unregistered)
  openai: 'gpt-4.1-mini',

  // Google: cheap helper -> Gemini 2.5 Flash Lite (registered, current; 1.5/2.0-flash deprecated)
  google: 'gemini-2.5-flash-lite',

  // XAI: -> grok-4.3 (the live model; grok-4 family incl. -1-fast-* deprecated → redirects here anyway)
  xai: 'grok-4.3',

  // DeepSeek: DeepSeek Coder -> DeepSeek Chat ($0.14/1M tokens)
  deepseek: 'deepseek-chat',

  // Mistral: Use same model (cost-effective already)
  mistral: 'mistral-small',

  // Groq: Use same model (fast and cheap)
  groq: 'llama-3.1-8b-instant',
};

/**
 * Compaction Request
 */
export interface CompactionRequest {
  messages: any[];
  targetTokenCount: number;
  preserveRecent?: number;
}

/**
 * Compaction Result
 */
export interface CompactionResult {
  compactedMessages: any[];
  summary: string;
  originalTokens: number;
  compressedTokens: number;
  tokensSaved: number;
  helperModelId: string;
  processingTime: number;
  cost: number;
}

/**
 * Cost Tracking
 */
export interface CostTracking {
  helperModelCalls: number;
  helperTokensProcessed: number;
  helperCost: number;
  mainModelCalls: number;
  mainTokensProcessed: number;
  mainCost: number;
  totalCost: number;
  savings: number;
  savingsPercentage: number;
}

/**
 * Helper Model Middleware
 *
 * Automatically handles context rejections by routing to cheaper helper models
 */
export class HelperModelMiddleware {
  private costTracking: CostTracking = {
    helperModelCalls: 0,
    helperTokensProcessed: 0,
    helperCost: 0,
    mainModelCalls: 0,
    mainTokensProcessed: 0,
    mainCost: 0,
    totalCost: 0,
    savings: 0,
    savingsPercentage: 0,
  };

  private helperAdapterRegistry: HelperModelMiddlewareRegistry;
  private compactionManager?: StoredCompactionManager;
  private timeline?: SessionTimeline;
  private modelRegistry?: ModelRegistry;

  constructor(options?: {
    compactionManager?: StoredCompactionManager;
    timeline?: SessionTimeline;
    modelRegistry?: ModelRegistry;
  }) {
    // Initialize helper adapter registry
    this.helperAdapterRegistry = helperRegistry;

    // Register default adapters (Messages API, Chat Completions API, Google GenAI API)
    registerDefaultHelperAdapters(this.helperAdapterRegistry);

    // Optional integrations for persistence
    this.compactionManager = options?.compactionManager;
    this.timeline = options?.timeline;
    this.modelRegistry = options?.modelRegistry;
  }

  /**
   * Handle context rejection with automatic fallback
   *
   * Main entry point for context limit errors
   */
  async handleContextRejection(
    originalRequest: ModelRequest,
    rejectionError: ContextLimitError,
    mainModel: ModelConfig
  ): Promise<ModelResponse> {
    console.log('⚠  Context limit reached - activating helper model...');

    // Select appropriate helper model
    // Priority: 1) User-configured helperModelId, 2) Provider-based default
    const helperModelId = mainModel.compaction?.behavior?.helperModelId
      || this.selectHelperModel(mainModel.provider);

    const source = mainModel.compaction?.behavior?.helperModelId ? 'user-configured' : 'provider-default';
    console.log(` Using helper model: ${helperModelId} (${source})`);

    // Analyze rejection to determine strategy
    const analysis = this.analyzeRejection(originalRequest, rejectionError, mainModel);

    console.log(
      ` Reason: ${analysis.reason} (${analysis.excessTokens} tokens over limit)`
    );

    // Route to appropriate handler based on rejection reason
    let response: ModelResponse;

    switch (analysis.reason) {
      case 'history_too_large':
        response = await this.handleHistoryOverflow(
          originalRequest,
          mainModel,
          helperModelId,
          analysis
        );
        break;

      case 'tool_results_too_large':
        response = await this.handleToolResultOverflow(
          originalRequest,
          mainModel,
          helperModelId,
          analysis
        );
        break;

      case 'combined_overflow':
        response = await this.handleCombinedOverflow(
          originalRequest,
          mainModel,
          helperModelId,
          analysis
        );
        break;
    }

    console.log('[OK] Request processed via helper model fallback');
    return response;
  }

  /**
   * Handle history overflow
   *
   * Strategy: Compact conversation history via helper model
   */
  private async handleHistoryOverflow(
    request: ModelRequest,
    mainModel: ModelConfig,
    helperModelId: string,
    analysis: RejectionAnalysis
  ): Promise<ModelResponse> {
    const startTime = Date.now();

    // Calculate target token count (main model's available history budget)
    const targetTokens = this.calculateHistoryBudget(mainModel);

    // Get helper model configuration from ID
    const helperConfig = this.getHelperModelConfig(helperModelId);

    // Compact history using helper model
    const compaction = await this.compactHistoryViaHelper(
      request.messages,
      targetTokens,
      helperConfig
    );

    // Store compaction record (integrated with timeline in Week 3)
    if (this.compactionManager && this.timeline) {
      try {
        const currentConversation = this.timeline.getCurrentConversation();

        if (currentConversation) {
          // Prepare timeline reference
          const timelineRef: TimelineReference = {
            sessionId: this.timeline.sessionId,
            conversationId: currentConversation.id,
            eventId: `compaction-${Date.now()}`,
            turnRange: {
              start: Math.max(0, currentConversation.turnCount - request.messages.length),
              end: currentConversation.turnCount
            }
          };

          // Prepare compaction summaries
          const summaries: CompactionSummaries = {
            compressed: compaction.summary.substring(0, 500), // ~100-200 tokens
            standard: compaction.summary, // Full summary
            detailed: compaction.summary, // Use same for now
            metadata: {
              topics: this.extractTopics(compaction.summary),
              decisions: [],
              toolsUsed: this.extractTools(request.messages),
              filesModified: [],
              modelsInvolved: [mainModel.id, helperModelId],
              keyMoments: []
            }
          };

          // Prepare processing details
          const processing: CompactionProcessing = {
            helperModelId: compaction.helperModelId,
            helperProvider: helperConfig.provider,
            processingTime: compaction.processingTime,
            cost: compaction.cost,
            tokens: {
              input: compaction.originalTokens,
              output: compaction.compressedTokens
            }
          };

          // Convert compacted messages to Message format
          // Use a simple user message format for storage
          const originalMessages: Message[] = request.messages.map((msg: any, idx: number) => ({
            uuid: `msg-${idx}-${Date.now()}`,
            type: 'user',
            role: 'user',
            message: {
              role: msg.role || 'user',
              content: msg.content || ''
            },
            timestamp: new Date().toISOString()
          } as unknown as Message));

          // Store compaction
          await this.compactionManager.createCompaction({
            type: 'helper-fallback',
            timeline: timelineRef,
            originalMessages,
            summaries,
            processing
          });

          // Record compaction in timeline
          this.timeline.recordCompaction(
            timelineRef.eventId,
            timelineRef.turnRange.start,
            timelineRef.turnRange.end,
            request.messages.length,
            compaction.originalTokens,
            compaction.compressedTokens,
            'helper-fallback',
            helperModelId
          );

          console.log(` [OK] Compaction stored (ID: ${timelineRef.eventId})`);
        }
      } catch (error) {
        console.warn(` ⚠  Failed to store compaction: ${(error as Error).message}`);
        // Continue even if storage fails - compaction still worked
      }
    }

    const processingTime = Date.now() - startTime;

    // Track costs
    this.trackHelperModelUsage(
      compaction.originalTokens + compaction.compressedTokens,
      compaction.cost
    );

    // Return response that indicates caller should retry with compacted messages
    // The actual main model request is made by the calling code, not by this middleware
    return {
      content: compaction.compactedMessages,
      usage: {
        inputTokens: compaction.compressedTokens,
        outputTokens: 0, // No output yet - this is for retry
        totalTokens: compaction.compressedTokens,
      },
      stopReason: 'needs_retry',
      metadata: {
        usedHelperModel: true,
        helperModelId,
        compaction: {
          ...compaction,
          analysis, // Include original analysis
          compactedMessages: compaction.compactedMessages
        },
        processingTime,
        action: 'retry_with_compacted_history'
      },
    };
  }

  /**
   * Handle tool result overflow
   *
   * Strategy: Summarize large tool results via helper model
   */
  private async handleToolResultOverflow(
    request: ModelRequest,
    _mainModel: ModelConfig,
    helperModelId: string,
    analysis: RejectionAnalysis
  ): Promise<ModelResponse> {
    const startTime = Date.now();

    // Get helper model configuration
    const helperConfig = this.getHelperModelConfig(helperModelId);
    const adapter = this.helperAdapterRegistry.getAdapterForModel(helperConfig);

    // Find messages with large tool results
    const modifiedMessages = [...request.messages];
    let totalSaved = 0;
    let totalCost = 0;

    for (let i = 0; i < modifiedMessages.length; i++) {
      const msg = modifiedMessages[i];

      // Check if this is a tool result message
      if (msg.role === 'tool' || msg.type === 'tool_result') {
        const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
        const estimatedTokens = content.length / 4;

        // If tool result is large (>2000 tokens), summarize it
        if (estimatedTokens > 2000) {
          const targetTokens = Math.min(500, Math.floor(estimatedTokens * 0.25)); // Reduce to 25%

          console.log(` Summarizing tool result ${i} (${Math.floor(estimatedTokens)} → ${targetTokens} tokens)...`);

          try {
            // Summarize via helper model
            const result = await adapter.summarizeToolResult(content, helperConfig, targetTokens);

            // Replace with summarized version
            modifiedMessages[i] = {
              ...msg,
              content: result.summary,
              metadata: {
                ...msg.metadata,
                summarized: true,
                originalTokens: result.originalTokens,
                summaryTokens: result.summaryTokens
              }
            };

            totalSaved += result.tokensSaved;
            totalCost += result.cost;

            console.log(` [OK] Tool result ${i} summarized: ${result.originalTokens} → ${result.summaryTokens} tokens`);
          } catch (error) {
            console.warn(` ⚠  Failed to summarize tool result ${i}: ${(error as Error).message}`);
            // Keep original message if summarization fails
          }
        }
      }
    }

    const processingTime = Date.now() - startTime;

    // Track costs
    this.trackHelperModelUsage(analysis.toolResultTokens + totalSaved, totalCost);

    // Return response with modified messages for retry
    return {
      content: modifiedMessages,
      usage: {
        inputTokens: analysis.totalTokens - totalSaved,
        outputTokens: 0,
        totalTokens: analysis.totalTokens - totalSaved,
      },
      stopReason: 'needs_retry',
      metadata: {
        usedHelperModel: true,
        helperModelId,
        strategy: 'tool_result_summarization',
        summarization: {
          toolResultsSummarized: modifiedMessages.filter(m => m.metadata?.summarized).length,
          tokensSaved: totalSaved,
          cost: totalCost
        },
        processingTime,
        action: 'retry_with_summarized_tools'
      },
    };
  }

  /**
   * Handle combined overflow
   *
   * Strategy: Compact history AND summarize tool results
   */
  private async handleCombinedOverflow(
    request: ModelRequest,
    mainModel: ModelConfig,
    helperModelId: string,
    analysis: RejectionAnalysis
  ): Promise<ModelResponse> {
    const startTime = Date.now();

    console.log(' Using combined strategy: compacting history AND summarizing tool results...');

    // Step 1: Summarize tool results first (more targeted reduction)
    const toolSummarizationResult = await this.handleToolResultOverflow(
      request,
      mainModel,
      helperModelId,
      analysis
    );

    // Extract modified messages from tool summarization
    const messagesAfterToolSummary = toolSummarizationResult.content as any[];
    const toolSummaryCost = toolSummarizationResult.metadata?.summarization?.cost || 0;
    const toolTokensSaved = toolSummarizationResult.metadata?.summarization?.tokensSaved || 0;

    // Step 2: Check if we still need history compaction
    const remainingTokens = analysis.totalTokens - toolTokensSaved;
    const maxTokens = analysis.maxTokens;

    if (remainingTokens > maxTokens * 0.9) {
      // Still need history compaction
      console.log(` Still ${remainingTokens} tokens (limit: ${maxTokens}), compacting history...`);

      const historyCompactionRequest = {
        ...request,
        messages: messagesAfterToolSummary
      };

      const historyResult = await this.handleHistoryOverflow(
        historyCompactionRequest,
        mainModel,
        helperModelId,
        {
          ...analysis,
          totalTokens: remainingTokens,
          excessTokens: remainingTokens - maxTokens
        }
      );

      const processingTime = Date.now() - startTime;
      const historyCost = historyResult.metadata?.compaction?.cost || 0;
      const historyTokensSaved = historyResult.metadata?.compaction?.tokensSaved || 0;

      // Return combined result
      return {
        content: historyResult.content, // Compacted messages
        usage: {
          inputTokens: remainingTokens - historyTokensSaved,
          outputTokens: 0,
          totalTokens: remainingTokens - historyTokensSaved,
        },
        stopReason: 'needs_retry',
        metadata: {
          usedHelperModel: true,
          helperModelId,
          strategy: 'combined',
          combined: {
            toolSummarization: toolSummarizationResult.metadata?.summarization,
            historyCompaction: historyResult.metadata?.compaction,
            totalTokensSaved: toolTokensSaved + historyTokensSaved,
            totalCost: toolSummaryCost + historyCost
          },
          processingTime,
          action: 'retry_with_combined_reduction'
        },
      };
    } else {
      // Tool summarization was enough
      const processingTime = Date.now() - startTime;

      console.log(` [OK] Tool summarization sufficient (now ${remainingTokens} tokens)`);

      return {
        content: messagesAfterToolSummary,
        usage: {
          inputTokens: remainingTokens,
          outputTokens: 0,
          totalTokens: remainingTokens,
        },
        stopReason: 'needs_retry',
        metadata: {
          usedHelperModel: true,
          helperModelId,
          strategy: 'combined',
          combined: {
            toolSummarization: toolSummarizationResult.metadata?.summarization,
            historyCompaction: null,
            totalTokensSaved: toolTokensSaved,
            totalCost: toolSummaryCost
          },
          processingTime,
          action: 'retry_with_tool_summarization_only'
        },
      };
    }
  }

  /**
   * Compact conversation history using helper model
   *
   * Week 2 Integration: Uses real API calls via helper middleware adapters
   */
  private async compactHistoryViaHelper(
    messages: any[],
    targetTokens: number,
    helperConfig: ModelConfig
  ): Promise<CompactionResult> {
    console.log(` Compacting ${messages.length} messages via ${helperConfig.id}...`);

    // Convert messages to HelperCanonicalMessage format
    const canonicalMessages: HelperCanonicalMessage[] = messages.map(msg => ({
      role: msg.role || 'user',
      content: msg.content || '',
      timestamp: msg.timestamp
    }));

    // Get the appropriate adapter for this helper model's API pattern
    const adapter = this.helperAdapterRegistry.getAdapterForModel(helperConfig);

    console.log(` Using adapter: ${adapter.name} (pattern: ${adapter.apiPattern})`);

    // Make REAL API call via adapter
    const result = await adapter.compact(canonicalMessages, helperConfig, targetTokens);

    console.log(
      ` [OK] Compaction complete: ${result.originalTokens} → ${result.compressedTokens} tokens ` +
      `(saved ${result.tokensSaved}, cost: $${result.cost.toFixed(4)})`
    );

    // Update cost tracking
    this.costTracking.helperModelCalls++;
    this.costTracking.helperTokensProcessed += result.originalTokens + result.compressedTokens;
    this.costTracking.helperCost += result.cost;

    // Convert back to the original message format expected by CompactionResult
    const compactedMessages = result.compactedMessages.map(msg => ({
      role: msg.role,
      content: msg.content,
      ...(msg.timestamp && { timestamp: msg.timestamp })
    }));

    return {
      compactedMessages,
      summary: result.summary,
      originalTokens: result.originalTokens,
      compressedTokens: result.compressedTokens,
      tokensSaved: result.tokensSaved,
      helperModelId: result.helperModelId,
      processingTime: result.processingTime,
      cost: result.cost
    };
  }

  /**
   * Select helper model based on main model provider
   */
  selectHelperModel(provider: string): string {
    // Last-resort default = Gemma 4 on Cloudflare Workers AI
    // (@cf/google/gemma-4-26b-a4b-it). Cheap, registered, strong for the
    // text-only helper role (compaction/mentorship — no tool-calling, so
    // the gemma-4 function-synthesis caveat doesn't apply here).
    return HELPER_MODEL_REGISTRY[provider.toLowerCase()] || '@cf/google/gemma-4-26b-a4b-it';
  }

  /**
   * Get ModelConfig for a helper/mentorship model by ID
   *
   * Priority:
   * 1. Main model registry (allows ANY model including premium models for mentorship)
   * 2. Fallback to hardcoded cheap helper models (for backward compatibility)
   */
  private static _helperConfigsCache: Record<string, Partial<ModelConfig>> | null = null;

  /**
   * R11 (Opus finding): the helper-config dictionary was rebuilt as an
   * object literal on every getHelperModelConfig call. Hoisted to a
   * memoized static — built once, same reference across calls.
   */
  static getHelperConfigsCached(): Record<string, Partial<ModelConfig>> {
    if (HelperModelMiddleware._helperConfigsCache) {
      return HelperModelMiddleware._helperConfigsCache;
    }
    const helperConfigs: Record<string, Partial<ModelConfig>> = {
      // Messages API (pattern: 'messages')
      'claude-haiku-4-5': {
        id: 'claude-haiku-4-5',
        displayName: 'Claude 3.5 Haiku',
        provider: 'anthropic',
        family: 'claude-3.5',
        api: {
          pattern: 'messages',
          endpoint: 'https://api.anthropic.com/v1/messages',
          apiKeyEnvVar: 'ANTHROPIC_API_KEY',
          authHeader: 'x-api-key',
          authPrefix: '',
          versionHeader: { name: 'anthropic-version', value: '2023-06-01' }
        },
        limits: {
          contextWindow: 200000,
          outputTokens: 8192,
          requestsPerMinute: 4000,
          tokensPerMinute: 400000
        }
      },
      // Chat Completions API (pattern: 'chat/completions')
      'gpt-3.5-turbo': {
        id: 'gpt-3.5-turbo',
        displayName: 'GPT-3.5 Turbo',
        provider: 'openai',
        family: 'gpt-3.5',
        api: {
          pattern: 'chat/completions',
          endpoint: 'https://api.openai.com/v1/chat/completions',
          apiKeyEnvVar: 'OPENAI_API_KEY',
          authHeader: 'Authorization',
          authPrefix: 'Bearer'
        },
        limits: {
          contextWindow: 16385,
          outputTokens: 4096,
          requestsPerMinute: 10000,
          tokensPerMinute: 2000000
        }
      },
      // Google GenAI API (pattern: 'google-genai') - FREE Gemma models
      'gemma-3-27b-it': {
        id: 'gemma-3-27b-it',
        displayName: 'Gemma 3 27B (FREE)',
        provider: 'google',
        family: 'gemma-3',
        api: {
          pattern: 'google-genai',
          endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemma-3-27b-it:generateContent',
          apiKeyEnvVar: 'GOOGLE_API_KEY',
          authHeader: 'x-goog-api-key',
          authPrefix: ''
        },
        limits: {
          contextWindow: 128000,
          outputTokens: 8192,
          requestsPerMinute: 60,
          tokensPerMinute: 1000000
        }
      },
      // GenerateContent API (pattern: 'generateContent') - Paid Gemini models
      'gemini-2.0-flash-lite': {
        id: 'gemini-2.0-flash-lite',
        displayName: 'Gemini 2.0 Flash Lite',
        provider: 'google',
        family: 'gemini-2.0',
        api: {
          pattern: 'generateContent',
          endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent',
          apiKeyEnvVar: 'GOOGLE_API_KEY',
          authHeader: 'x-goog-api-key',
          authPrefix: ''
        },
        limits: {
          contextWindow: 1000000,
          outputTokens: 8192,
          requestsPerMinute: 1000,
          tokensPerMinute: 4000000
        }
      },
      // ResponsesAPI (pattern: 'responses') - OpenAI stateful conversation API
      'gpt-5-codex': {
        id: 'gpt-5-codex',
        displayName: 'GPT-5 Codex',
        provider: 'openai',
        family: 'gpt-5',
        api: {
          pattern: 'responses',
          endpoint: 'https://api.openai.com/v1/responses',
          apiKeyEnvVar: 'OPENAI_API_KEY',
          authHeader: 'Authorization',
          authPrefix: 'Bearer'
        },
        limits: {
          contextWindow: 400000,
          outputTokens: 128000,
          requestsPerMinute: 500,
          tokensPerMinute: 1000000
        }
      },
      // X.AI Grok 4.1 Fast Non-Reasoning (pattern: 'chat/completions') - OpenAI-compatible API
      'grok-4-1-fast-non-reasoning': {
        id: 'grok-4-1-fast-non-reasoning',
        displayName: 'Grok 4.1 Fast (Non-Reasoning)',
        provider: 'xai',
        family: 'grok-4',
        api: {
          pattern: 'chat/completions',
          endpoint: 'https://api.x.ai/v1/chat/completions',
          apiKeyEnvVar: 'XAI_API_KEY',
          authHeader: 'Authorization',
          authPrefix: 'Bearer'
        },
        limits: {
          contextWindow: 131072,
          outputTokens: 16384,
          requestsPerMinute: 60,
          tokensPerMinute: 100000
        }
      },
      // X.AI Grok Beta (legacy alias, pattern: 'chat/completions')
      'grok-beta': {
        id: 'grok-beta',
        displayName: 'Grok Beta (deprecated)',
        provider: 'xai',
        family: 'grok',
        api: {
          pattern: 'chat/completions',
          endpoint: 'https://api.x.ai/v1/chat/completions',
          apiKeyEnvVar: 'XAI_API_KEY',
          authHeader: 'Authorization',
          authPrefix: 'Bearer'
        },
        limits: {
          contextWindow: 131072,
          outputTokens: 4096,
          requestsPerMinute: 60,
          tokensPerMinute: 100000
        }
      }
    };
    // grok-4.3 = live xAI model (grok-4 family deprecated → redirects here).
    helperConfigs['grok-4.3'] = {
      id: 'grok-4.3',
      displayName: 'Grok 4.3',
      provider: 'xai',
      family: 'grok-4.3',
      api: {
        pattern: 'chat/completions',
        endpoint: 'https://api.x.ai/v1/chat/completions',
        apiKeyEnvVar: 'XAI_API_KEY',
        authHeader: 'Authorization',
        authPrefix: 'Bearer'
      },
      limits: {
        contextWindow: 1000000,
        outputTokens: 16384,
        requestsPerMinute: 60,
        tokensPerMinute: 100000
      }
    };
    // Current cheap helpers matching the modernized HELPER_MODEL_REGISTRY
    // defaults — so the no-registry fallback path resolves them too.
    helperConfigs['gpt-4.1-mini'] = {
      id: 'gpt-4.1-mini',
      displayName: 'GPT-4.1 mini',
      provider: 'openai',
      family: 'gpt-4.1',
      api: {
        pattern: 'chat/completions',
        endpoint: 'https://api.openai.com/v1/chat/completions',
        apiKeyEnvVar: 'OPENAI_API_KEY',
        authHeader: 'Authorization',
        authPrefix: 'Bearer'
      },
      limits: {
        contextWindow: 1000000,
        outputTokens: 32768,
        requestsPerMinute: 5000,
        tokensPerMinute: 2000000
      }
    };
    helperConfigs['gemini-2.5-flash-lite'] = {
      id: 'gemini-2.5-flash-lite',
      displayName: 'Gemini 2.5 Flash Lite',
      provider: 'google',
      family: 'gemini-2.5',
      api: {
        pattern: 'generateContent',
        endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent',
        apiKeyEnvVar: 'GOOGLE_API_KEY',
        authHeader: 'x-goog-api-key',
        authPrefix: ''
      },
      limits: {
        contextWindow: 1000000,
        outputTokens: 8192,
        requestsPerMinute: 1000,
        tokensPerMinute: 4000000
      }
    };
    // DeepSeek — current cheap helper (OpenAI-compatible chat/completions).
    helperConfigs['deepseek-chat'] = {
      id: 'deepseek-chat',
      displayName: 'DeepSeek Chat',
      provider: 'deepseek',
      family: 'deepseek',
      api: {
        pattern: 'chat/completions',
        endpoint: 'https://api.deepseek.com/chat/completions',
        apiKeyEnvVar: 'DEEPSEEK_API_KEY',
        authHeader: 'Authorization',
        authPrefix: 'Bearer'
      },
      limits: {
        contextWindow: 64000,
        outputTokens: 8192,
        requestsPerMinute: 1000,
        tokensPerMinute: 1000000
      }
    };
    helperConfigs['deepseek-v4-flash'] = {
      id: 'deepseek-v4-flash',
      displayName: 'DeepSeek V4 Flash',
      provider: 'deepseek',
      family: 'deepseek-v4',
      api: {
        pattern: 'chat/completions',
        endpoint: 'https://api.deepseek.com/chat/completions',
        apiKeyEnvVar: 'DEEPSEEK_API_KEY',
        authHeader: 'Authorization',
        authPrefix: 'Bearer'
      },
      limits: {
        contextWindow: 1000000,
        outputTokens: 8192,
        requestsPerMinute: 1000,
        tokensPerMinute: 1000000
      }
    };
    // FREE Gemma 3 family — zero-cost helpers (provider google, google-genai
    // pattern). Preferred for compaction/mentorship since they cost nothing.
    for (const g of [
      { id: 'gemma-3-1b-it', name: 'Gemma 3 1B IT (FREE)' },
      { id: 'gemma-3-4b-it', name: 'Gemma 3 4B IT (FREE)' },
      { id: 'gemma-3-12b-it', name: 'Gemma 3 12B IT (FREE)' },
      { id: 'gemma-3-27b-it', name: 'Gemma 3 27B IT (FREE)' },
    ]) {
      helperConfigs[g.id] = {
        id: g.id,
        displayName: g.name,
        provider: 'google',
        family: 'gemma-3',
        api: {
          pattern: 'google-genai',
          endpoint: 'https://generativelanguage.googleapis.com/v1beta/models',
          apiKeyEnvVar: 'GEMINI_API_KEY',
          authHeader: 'x-goog-api-key',
          authPrefix: ''
        },
        limits: {
          contextWindow: 8192,
          outputTokens: 8192,
          requestsPerMinute: 1000,
          tokensPerMinute: 1000000
        }
      };
    }
    // Gemma 4 via Cloudflare Workers AI (OpenAI-compatible chat/completions).
    // The default helper; also the "function gemma" model (gemma-4 +
    // function-call synthesis — N/A for the text-only helper role).
    helperConfigs['@cf/google/gemma-4-26b-a4b-it'] = {
      id: '@cf/google/gemma-4-26b-a4b-it',
      displayName: 'Gemma 4 26B A4B (Cloudflare)',
      provider: 'cloudflare',
      family: 'gemma',
      api: {
        pattern: 'chat/completions',
        endpoint: 'https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/ai/v1/chat/completions',
        apiKeyEnvVar: 'CLOUDFLARE_API_TOKEN',
        authHeader: 'Authorization',
        authPrefix: 'Bearer'
      },
      limits: {
        contextWindow: 256000,
        outputTokens: 8192,
        requestsPerMinute: 300,
        tokensPerMinute: 1000000
      }
    };
    HelperModelMiddleware._helperConfigsCache = helperConfigs;
    return helperConfigs;
  }

  private getHelperModelConfig(modelId: string): ModelConfig {
    // PRIORITY 1: Try main model registry first (enables premium models for mentorship)
    if (this.modelRegistry && this.modelRegistry.hasModel(modelId)) {
      return this.modelRegistry.getModel(modelId);
    }

    // PRIORITY 2: Fallback to hardcoded cheap helper configurations
    // Using partial configs with type assertion - full configs should come from central registry
    // Covers ALL 5 API patterns: messages, chat/completions, google-genai, generateContent, responses
    const helperConfigs = HelperModelMiddleware.getHelperConfigsCached();

    const config = helperConfigs[modelId];
    if (!config) {
      throw new Error(
        `HelperModelMiddleware: No configuration found for helper model "${modelId}". ` +
        `Available: ${Object.keys(helperConfigs).join(', ')}`
      );
    }

    // Type assertion: These partial configs have all fields needed by helper adapters
    // Full ModelConfig validation should happen in central model registry
    return config as ModelConfig;
  }

  /**
   * Analyze context rejection to determine cause
   */
  analyzeRejection(
    request: ModelRequest,
    _error: ContextLimitError,
    model: ModelConfig
  ): RejectionAnalysis {
    // Use provider-specific tokenizer for accurate counting
    const countTokens = (obj: any): number => {
      return TokenCounter.count(obj, model).tokens;
    };

    const historyTokens = request.messages.reduce(
      (sum, m) => sum + countTokens(m),
      0
    );

    // Calculate token count specifically from tool result messages
    const toolResultTokens = request.messages.reduce((sum, msg) => {
      if (msg.role === 'tool' || msg.type === 'tool_result') {
        return sum + countTokens(msg);
      }
      return sum;
    }, 0);

    // R11 (Cortex finding): toolResultTokens is a SUBSET breakdown of
    // historyTokens (tool messages are already counted in historyTokens) —
    // adding it again double-counts every tool_result.
    const totalTokens = historyTokens;
    const maxTokens = model.limits.contextWindow;
    const excessTokens = totalTokens - maxTokens;

    // Determine primary cause
    let reason: RejectionAnalysis['reason'];
    if (toolResultTokens > maxTokens * 0.3) {
      if (historyTokens > maxTokens * 0.5) {
        reason = 'combined_overflow';
      } else {
        reason = 'tool_results_too_large';
      }
    } else {
      reason = 'history_too_large';
    }

    return {
      reason,
      historyTokens,
      toolResultTokens,
      totalTokens,
      maxTokens,
      excessTokens,
    };
  }

  /**
   * Calculate available history budget for a model
   */
  private calculateHistoryBudget(model: ModelConfig): number {
    const total = model.limits.contextWindow;
    const outputReserve = model.limits.outputTokens || 4096;
    const toolsReserve = 2000; // Reserve for tool definitions
    const systemReserve = 500; // Reserve for system prompts

    return total - outputReserve - toolsReserve - systemReserve;
  }

  /**
   * Check if error is a context limit error using provider-specific detection
   */
  isContextLimitError(error: any, provider?: string): error is ContextLimitError {
    // Use ErrorDetector for provider-specific detection
    return ErrorDetector.isContextLimitError(error, provider);
  }

  /**
   * Track helper model usage for cost analysis
   */
  private trackHelperModelUsage(tokens: number, cost: number): void {
    this.costTracking.helperModelCalls++;
    this.costTracking.helperTokensProcessed += tokens;
    this.costTracking.helperCost += cost;
    this.costTracking.totalCost += cost;

    // Calculate savings (compared to using main model)
    // Assuming main model is ~10x more expensive
    const mainModelEquivalentCost = cost * 10;
    this.costTracking.savings += mainModelEquivalentCost - cost;
    this.costTracking.savingsPercentage =
      (this.costTracking.savings / (this.costTracking.totalCost + this.costTracking.savings)) *
      100;
  }

  /**
   * Track main model usage
   */
  trackMainModelUsage(tokens: number, cost: number): void {
    this.costTracking.mainModelCalls++;
    this.costTracking.mainTokensProcessed += tokens;
    this.costTracking.mainCost += cost;
    this.costTracking.totalCost += cost;
  }

  /**
   * Get cost tracking statistics
   */
  getCostTracking(): CostTracking {
    return { ...this.costTracking };
  }

  /**
   * Reset cost tracking
   */
  resetCostTracking(): void {
    this.costTracking = {
      helperModelCalls: 0,
      helperTokensProcessed: 0,
      helperCost: 0,
      mainModelCalls: 0,
      mainTokensProcessed: 0,
      mainCost: 0,
      totalCost: 0,
      savings: 0,
      savingsPercentage: 0,
    };
  }

  /**
   * Extract topics from summary text
   * Simple heuristic: look for key phrases and noun phrases
   */
  private extractTopics(summary: string): string[] {
    const topics: string[] = [];
    const lines = summary.split('\n');

    for (const line of lines) {
      // Look for bullet points or numbered items
      if (line.match(/^[-*•]\s+/) || line.match(/^\d+\.\s+/)) {
        const topic = line.replace(/^[-*•]\s+/, '').replace(/^\d+\.\s+/, '').trim();
        if (topic.length > 10 && topic.length < 100) {
          topics.push(topic);
        }
      }
    }

    // If no topics found, extract first few sentences
    if (topics.length === 0) {
      const sentences = summary.match(/[^.!?]+[.!?]+/g) || [];
      topics.push(...sentences.slice(0, 3).map(s => s.trim()));
    }

    return topics.slice(0, 10); // Max 10 topics
  }

  /**
   * Extract tool names from messages
   */
  private extractTools(messages: any[]): string[] {
    const tools = new Set<string>();

    for (const msg of messages) {
      if (msg.type === 'tool_use' || msg.role === 'assistant') {
        // Check for tool calls in various formats
        if (msg.tool_calls) {
          for (const call of msg.tool_calls) {
            if (call.function?.name) tools.add(call.function.name);
            if (call.name) tools.add(call.name);
          }
        }
        if (msg.toolUse) {
          tools.add(msg.toolUse.name || msg.toolUse.toolName);
        }
      }
    }

    return Array.from(tools);
  }

  // ============================================
  // REACTIVE MENTORSHIP METHODS
  // ============================================

  /**
   * Generate error guidance using helper model
   *
   * Reactive Mentorship: Phase 1 - Error-Triggered Mentorship
   *
   * Analyzes tool errors and provides strategic guidance for recovery
   */
  async generateErrorGuidance(context: {
    toolName: string;
    toolUseId: string;
    error: string | object;
    recentHistory: Message[];
    helperModelId?: string;
  }): Promise<string> {
    // Format error for display
    const errorText = typeof context.error === 'string'
      ? context.error
      : JSON.stringify(context.error, null, 2);

    // Format recent history for context
    const historyContext = this.formatRecentHistory(context.recentHistory);

    // Build mentorship prompt
    const prompt = `You are an AI mentor analyzing a tool execution error. Provide concise, actionable guidance.

**Tool Used**: ${context.toolName}
**Tool Use ID**: ${context.toolUseId}
**Error**: ${errorText}

**Recent Actions**:
${historyContext}

Provide your analysis in this exact format:

<thinking>
**Error Analysis**: [What went wrong - 1-2 sentences]
**Immediate Fix**: [Specific steps to fix - 2-3 bullet points]
**Why This Works**: [Brief explanation of the solution]
</thinking>

Keep it concise and actionable. Focus on the immediate next steps.`;

    // Get helper model configuration
    const helperModelId = context.helperModelId || 'grok-4-1-fast-non-reasoning'; // Default to grok-beta for mentorship
    const helperConfig = this.getHelperModelConfig(helperModelId);

    // Get appropriate adapter for helper model
    const adapter = this.helperAdapterRegistry.getAdapterForModel(helperConfig);

    // Convert prompt to HelperCanonicalMessage format
    const messages: HelperCanonicalMessage[] = [{
      role: 'user',
      content: prompt
    }];

    // Make API call via adapter (using compact method as it does single-turn generation)
    // We use targetTokens=500 for concise guidance
    const result = await adapter.compact(messages, helperConfig, 500);

    // Extract thinking content from the response
    return this.extractThinkingContent(result.summary);
  }

  /**
   * Generate a concise session title from the first user message.
   * Fire-and-forget on turn 0 — result is saved to session metadata.
   */
  async generateSessionTitle(
    firstUserMessage: string,
    helperModelId?: string,
  ): Promise<string> {
    const truncated = firstUserMessage.slice(0, 500);
    const prompt = `Generate a concise 5-10 word title for this conversation. Return ONLY the title, no quotes, no explanation.\n\nUser message: ${truncated}`;

    const modelId = helperModelId || process.env.HELPER_MODEL_ID || 'deepseek-v4-flash';
    const helperConfig = this.getHelperModelConfig(modelId);
    const adapter = this.helperAdapterRegistry.getAdapterForModel(helperConfig);

    const messages: HelperCanonicalMessage[] = [{ role: 'user', content: prompt }];
    const text = await adapter.generate(messages, helperConfig, 100);

    return (text || '').split('\n')[0]!.trim().replace(/^["']|["']$/g, '');
  }

  /**
   * Generate a turn summary and predict the user's next action.
   * Called post-turn when TURN_SUMMARY_PREDICTION=true.
   */
  async generateTurnSummaryAndPrediction(context: {
    lastAssistantText: string;
    lastUserText: string;
    toolsUsed: string[];
    helperModelId?: string;
  }): Promise<{ summary: string; prediction: string }> {
    const assistantSnippet = context.lastAssistantText.slice(0, 800);
    const userSnippet = context.lastUserText.slice(0, 400);
    const tools = context.toolsUsed.length > 0
      ? `Tools used: ${context.toolsUsed.join(', ')}\n`
      : '';

    const prompt = `Given this conversation turn, produce two things:
1. SUMMARY: A single sentence (under 15 words) describing what just happened.
2. PREDICTION: The most likely thing the user will type next (a realistic prompt, 5-20 words).

User said: ${userSnippet}
${tools}Assistant responded: ${assistantSnippet}

Respond in exactly this format (no other text):
SUMMARY: <summary>
PREDICTION: <prediction>`;

    const modelId = context.helperModelId || process.env.HELPER_MODEL_ID || 'deepseek-v4-flash';
    const helperConfig = this.getHelperModelConfig(modelId);
    const adapter = this.helperAdapterRegistry.getAdapterForModel(helperConfig);

    const messages: HelperCanonicalMessage[] = [{ role: 'user', content: prompt }];
    const text = await adapter.generate(messages, helperConfig, 150);

    const summaryMatch = text.match(/SUMMARY:\s*(.+)/i);
    const predictionMatch = text.match(/PREDICTION:\s*(.+)/i);

    return {
      summary: (summaryMatch?.[1] || '').trim(),
      prediction: (predictionMatch?.[1] || '').trim(),
    };
  }

  /**
   * Generate keyword-based guidance using helper model
   *
   * Reactive Mentorship: Phase 1 - Keyword-Triggered Mentorship
   *
   * Handles @ultrathink, @analyze, @rethink keyword requests
   */
  async generateKeywordGuidance(context: {
    keyword: string;
    recentHistory: Message[];
    helperModelId?: string;
  }): Promise<string> {
    const historyContext = this.formatRecentHistory(context.recentHistory);

    // Build keyword-specific prompt
    const prompt = this.buildKeywordPrompt(context.keyword, historyContext);

    // Get helper model configuration
    const helperModelId = context.helperModelId || 'grok-4-1-fast-non-reasoning';
    const helperConfig = this.getHelperModelConfig(helperModelId);

    // Get appropriate adapter
    const adapter = this.helperAdapterRegistry.getAdapterForModel(helperConfig);

    // Convert to message format
    const messages: HelperCanonicalMessage[] = [{
      role: 'user',
      content: prompt
    }];

    // Get guidance (use higher token limit for keyword-based analysis)
    const targetTokens = context.keyword === '@ultrathink' ? 1000 : 500;
    const result = await adapter.compact(messages, helperConfig, targetTokens);

    // Extract thinking content
    return this.extractThinkingContent(result.summary);
  }

  /**
   * Format recent history for mentorship context
   */
  private formatRecentHistory(messages: Message[]): string {
    // Take last 5 messages for context
    const recentMessages = messages.slice(-5);

    return recentMessages.map((msg, idx) => {
      const role = msg.type || 'unknown';
      const content = this.extractTextContent(msg);
      return `${idx + 1}. [${role}] ${content.substring(0, 200)}${content.length > 200 ? '...' : ''}`;
    }).join('\n');
  }

  /**
   * Extract text content from a message
   */
  private extractTextContent(msg: Message): string {
    const content = (msg as any).message?.content || (msg as any).content;

    if (typeof content === 'string') {
      return content;
    }

    if (Array.isArray(content)) {
      return content
        .filter(block => block.type === 'text')
        .map(block => block.text)
        .join(' ');
    }

    return JSON.stringify(content);
  }

  /**
   * Build keyword-specific prompt
   */
  private buildKeywordPrompt(keyword: string, historyContext: string): string {
    const keywordPrompts: Record<string, string> = {
      '@ultrathink': `You are an AI mentor providing comprehensive strategic analysis.

**Recent Context**:
${historyContext}

The user requested @ultrathink - provide deep strategic guidance:

<thinking>
**Current Situation**: [What's happening - 2-3 sentences]
**Strategy Options**:
1. [Option 1: Approach and trade-offs]
2. [Option 2: Approach and trade-offs]
3. [Option 3: Approach and trade-offs]
**Recommended Approach**: [Which option and why - 2-3 sentences]
**Next Steps**: [Concrete actions to take]
</thinking>`,

      '@analyze': `You are an AI mentor providing efficiency assessment.

**Recent Context**:
${historyContext}

The user requested @analyze - provide quick efficiency analysis:

<thinking>
**What Worked**: [Successful approaches - 2-3 bullet points]
**What Could Improve**: [Inefficiencies identified - 2-3 bullet points]
**Quick Wins**: [Immediate improvements to try]
</thinking>`,

      '@rethink': `You are an AI mentor challenging current assumptions.

**Recent Context**:
${historyContext}

The user requested @rethink - reconsider from first principles:

<thinking>
**Current Assumptions**: [What we're assuming - 2-3 points]
**Alternative Perspectives**: [Different ways to think about this]
**Recommended Shift**: [New approach to try and why]
</thinking>`
    };

    // Return the matching prompt or default to @analyze
    const prompt = keywordPrompts[keyword];
    return prompt !== undefined ? prompt : keywordPrompts['@analyze']!;
  }

  /**
   * Extract thinking content from response
   */
  private extractThinkingContent(response: string): string {
    // Look for <thinking>...</thinking> tags
    const thinkingMatch = response.match(/<thinking>([\s\S]*?)<\/thinking>/);

    if (thinkingMatch && thinkingMatch[1]) {
      return thinkingMatch[1].trim();
    }

    // If no tags, return the response as-is
    return response;
  }

  // ============================================================
  // Phase 2 Mentorship Features
  // ============================================================

  /**
   * Generate periodic review guidance (Phase 2)
   * Triggered every N turns for strategic check-in
   */
  async generatePeriodicReview(context: {
    turnNumber: number;
    recentHistory: Message[];
    includeStrategicAdvice: boolean;
    helperModelId?: string;
  }): Promise<string> {
    // Build appropriate prompt
    const prompt = context.includeStrategicAdvice
      ? this.buildStrategicReviewPrompt(context)
      : this.buildSummaryReviewPrompt(context);

    // Get helper model configuration
    const helperModelId = context.helperModelId || 'grok-4-1-fast-non-reasoning';
    const helperConfig = this.getHelperModelConfig(helperModelId);

    // Get appropriate adapter
    const adapter = this.helperAdapterRegistry.getAdapterForModel(helperConfig);

    // Convert to message format
    const messages: HelperCanonicalMessage[] = [{
      role: 'user',
      content: prompt
    }];

    // Get guidance (strategic reviews get more tokens)
    const targetTokens = context.includeStrategicAdvice ? 800 : 400;
    const result = await adapter.compact(messages, helperConfig, targetTokens);

    // Extract thinking content
    return this.extractThinkingContent(result.summary);
  }

  /**
   * Build strategic review prompt (comprehensive)
   */
  private buildStrategicReviewPrompt(context: {
    turnNumber: number;
    recentHistory: Message[];
  }): string {
    const historyContext = this.formatRecentHistory(context.recentHistory);

    return `You are an AI mentor conducting a periodic review.

**Current Turn**: ${context.turnNumber}
**Conversation Snapshot** (last 5 messages):
${historyContext}

Provide strategic review:

<thinking>
 **Periodic Review (Turn ${context.turnNumber})**

**Progress Summary**: [What's been accomplished in recent turns - 2-3 sentences]

**Current Trajectory**: [Is the approach effective? Any concerns?]

**Strategic Recommendations**:
- [Recommendation 1]
- [Recommendation 2]

**Watch Out For**: [Potential issues to monitor]
</thinking>

Be concise but insightful. Focus on maintaining momentum.`;
  }

  /**
   * Build summary review prompt (lightweight)
   */
  private buildSummaryReviewPrompt(context: {
    turnNumber: number;
    recentHistory: Message[];
  }): string {
    const historyContext = this.formatRecentHistory(context.recentHistory.slice(-3));

    return `Provide brief progress summary.

**Turn**: ${context.turnNumber}
**Recent**: ${historyContext}

<thinking>
 **Progress Check (Turn ${context.turnNumber})**

**Summary**: [What's been done - 1-2 sentences]
**Status**: [On track / Needs adjustment / Going well]
</thinking>

Very brief - just a quick check-in.`;
  }

  /**
   * Generate pattern detection guidance (Phase 2)
   * Triggered when repeated error patterns are detected
   */
  async generatePatternDetectionGuidance(context: {
    errorPattern: string;
    occurrences: number;
    recentHistory: Message[];
    helperModelId?: string;
  }): Promise<string> {
    const historyContext = this.formatRecentHistory(context.recentHistory);

    const prompt = `You are an AI mentor detecting a repeated error pattern.

**Pattern Detected**: ${context.errorPattern}
**Occurrences**: ${context.occurrences} times

**Recent Context**:
${historyContext}

Provide pattern-breaking guidance:

<thinking>
 **Pattern Detected: ${context.errorPattern}**

**Why This Keeps Happening**: [Root cause analysis - 2-3 sentences]

**Breaking the Pattern**:
1. [First step to try a different approach]
2. [Second step to avoid the error]
3. [Third step to verify success]

**Alternative Strategy**: [Completely different approach to consider]
</thinking>

Focus on helping break out of the repeated failure loop.`;

    // Get helper model configuration
    const helperModelId = context.helperModelId || 'grok-4-1-fast-non-reasoning';
    const helperConfig = this.getHelperModelConfig(helperModelId);

    // Get appropriate adapter
    const adapter = this.helperAdapterRegistry.getAdapterForModel(helperConfig);

    // Convert to message format
    const messages: HelperCanonicalMessage[] = [{
      role: 'user',
      content: prompt
    }];

    // Get guidance
    const targetTokens = 600;
    const result = await adapter.compact(messages, helperConfig, targetTokens);

    // Extract thinking content
    return this.extractThinkingContent(result.summary);
  }

  /**
   * Generate interleaved thinking assistance (Phase 2)
   * Provides reasoning guidance for non-reasoning models
   */
  async generateInterleavedThinking(context: {
    userMessage: string;
    recentHistory: Message[];
    helperModelId?: string;
  }): Promise<string> {
    const historyContext = this.formatRecentHistory(context.recentHistory);

    const prompt = `You are an AI mentor helping a non-reasoning model think through a problem.

**User Request**: ${context.userMessage}

**Recent Context**:
${historyContext}

Provide thinking assistance:

<thinking>
 **Thinking Assistance**

**Problem Understanding**: [Restate the core challenge - 2 sentences]

**Key Considerations**:
- [Important factor 1]
- [Important factor 2]
- [Important factor 3]

**Approach**: [Suggested reasoning path to solve this]

**First Step**: [Concrete action to start with]
</thinking>

Help the model reason through the problem step by step.`;

    // Get helper model configuration
    const helperModelId = context.helperModelId || 'grok-4-1-fast-non-reasoning';
    const helperConfig = this.getHelperModelConfig(helperModelId);

    // Get appropriate adapter
    const adapter = this.helperAdapterRegistry.getAdapterForModel(helperConfig);

    // Convert to message format
    const messages: HelperCanonicalMessage[] = [{
      role: 'user',
      content: prompt
    }];

    // Get guidance
    const targetTokens = 500;
    const result = await adapter.compact(messages, helperConfig, targetTokens);

    // Extract thinking content
    return this.extractThinkingContent(result.summary);
  }

  /**
   * Generate interleaved continuation thinking (between tool iterations)
   * Short, subtle inner monologue — not a full structured analysis.
   * Reflects on what just happened and suggests next step.
   */
  async generateInterleavedContinuationThinking(context: {
    userMessage: string;
    toolResults: Array<{ toolName: string; isError: boolean; summary: string }>;
    iterationNumber: number;
    recentHistory: Message[];
    helperModelId?: string;
  }): Promise<string> {
    const toolResultsSummary = context.toolResults
      .map(r => `- ${r.toolName}: ${r.isError ? 'FAILED — ' : ''}${r.summary}`)
      .join('\n');

    const prompt = `You are providing brief inner thoughts for an AI assistant between tool calls.
Be concise — 2-3 sentences max. Think out loud about what just happened and what to do next.
Do NOT use headers, bullet points, or structured formatting. Write naturally, like stream of consciousness.

Tool call iteration ${context.iterationNumber} just completed.

Tool results:
${toolResultsSummary}

Original user request: ${context.userMessage}

Provide a brief reflection:`;

    // Get helper model configuration
    const helperModelId = context.helperModelId || 'grok-4-1-fast-non-reasoning';
    const helperConfig = this.getHelperModelConfig(helperModelId);

    // Get appropriate adapter
    const adapter = this.helperAdapterRegistry.getAdapterForModel(helperConfig);

    // Convert to message format
    const messages: HelperCanonicalMessage[] = [{
      role: 'user',
      content: prompt
    }];

    // Short target — this is a subtle nudge, not a lecture
    const targetTokens = 150;
    const result = await adapter.compact(messages, helperConfig, targetTokens);

    // Extract thinking content
    return this.extractThinkingContent(result.summary);
  }

  /**
   * Generate Active Discovery guidance (Phase 2)
   * Encourages thorough file reading and evidence-based analysis
   * Works for ALL models (reasoning and non-reasoning)
   */
  async generateActiveDiscoveryGuidance(context: {
    userMessage: string;
    recentHistory: Message[];
    filesRead: string[];
    helperModelId?: string;
  }): Promise<string> {
    const historyContext = this.formatRecentHistory(context.recentHistory);
    const filesReadList = context.filesRead.length > 0
      ? context.filesRead.join('\n- ')
      : 'None yet';

    const prompt = `You are an AI research methodology advisor enforcing the Active Discovery methodology.

**Core Rule**: NEVER infer how code works from documentation, imports, or comments alone. ALWAYS verify by reading the actual source.

**User Request**: ${context.userMessage}

**Files Already Read**:
- ${filesReadList}

**Recent Context**:
${historyContext}

Analyze what the user is asking about and provide guidance on what files MUST be read to answer accurately:

<thinking>
 **Active Discovery Guidance**

**What needs investigation**: [Identify the core question or system being analyzed]

**Files read so far**: [List what's been read — are these sufficient?]

**Critical gaps — files that MUST be read**:
- [File 1 — why it's needed: what import, function call, or type reference leads here]
- [File 2 — why it's needed]
- [File 3 — why it's needed]

**Anti-pattern warning**: Do NOT:
- Infer behavior from documentation or file names
- Cite line numbers in files you haven't read
- Say "this likely calls..." without verifying
- Use CLAUDE.md or system message context as a substitute for reading source

**Research plan**: [Specific files to read and what to look for in each]
</thinking>

Focus on tracing the complete dependency chain — imports, function calls, type references. Every claim must cite a specific file and line that was actually read.`;

    // Get helper model configuration
    const helperModelId = context.helperModelId || 'grok-4-1-fast-non-reasoning';
    const helperConfig = this.getHelperModelConfig(helperModelId);

    // Get appropriate adapter
    const adapter = this.helperAdapterRegistry.getAdapterForModel(helperConfig);

    // Convert to message format
    const messages: HelperCanonicalMessage[] = [{
      role: 'user',
      content: prompt
    }];

    // Get guidance (slightly more tokens for detailed file analysis)
    const targetTokens = 600;
    const result = await adapter.compact(messages, helperConfig, targetTokens);

    // Extract thinking content
    return this.extractThinkingContent(result.summary);
  }
}
