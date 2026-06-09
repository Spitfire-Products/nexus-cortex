/**
 * Context Budget Manager
 *
 * Manages dynamic context window budgeting for different model sizes.
 * Replaces hardcoded 155K threshold with model-specific calculations.
 *
 * Phase 1.5: Week 3 Implementation
 * Based on: CORTEX_V4_PHASE_1.5_ARCHITECTURE.md, Part 5
 */

import type { ModelConfig } from '../models/ModelConfig.interface.js';
import type { Message } from '../session/MessageTypes.js';
import { isSystemMessage, isToolUseMessage, isToolResultMessage } from '../session/MessageTypes.js';
import { TokenCounter } from '../utils/TokenCounter.js';

/**
 * Context budget allocation for a specific model
 */
export interface ContextBudget {
  /** Total context window available (from model config) */
  totalAvailable: number;

  /** Tokens reserved for model output */
  reservedForOutput: number;

  /** Tokens reserved for tool definitions */
  reservedForTools: number;

  /** Tokens reserved for system messages/reminders */
  reservedForSystem: number;

  /** Tokens available for conversation history */
  availableForHistory: number;

  /** Metadata about the budget calculation */
  metadata: {
    modelId: string;
    provider: string;
    calculatedAt: string;
    strategy: 'percentage' | 'absolute';
  };
}

/**
 * Message selection strategy for context window management
 */
export type SelectionStrategy =
  | 'sliding-window' // Keep most recent messages
  | 'preserve-critical' // Keep tool calls + recent messages
  | 'compact-and-fit';    // Summarize older, keep recent full

/**
 * Result of model switch validation
 */
export interface ValidationResult {
  /** Whether the switch is possible */
  canSwitch: boolean;

  /** Reason if switch is not possible */
  reason?: string;

  /** Current history token count */
  currentTokens: number;

  /** Available tokens in new model */
  availableTokens: number;

  /** Suggested strategy if switch requires adjustment */
  suggestedStrategy?: SelectionStrategy;

  /** Estimated tokens after applying strategy */
  estimatedTokensAfterStrategy?: number;
}

/**
 * Options for message selection
 */
export interface SelectionOptions {
  /** Strategy to use for selection */
  strategy: SelectionStrategy;

  /** Whether to preserve tool call pairs */
  preserveToolCalls?: boolean;

  /** Minimum recent messages to keep */
  minRecentMessages?: number;

  /** Include system messages */
  includeSystemMessages?: boolean;
}

/**
 * Manages context window budgets across different models
 */
export class ContextBudgetManager {
  private static readonly DEFAULT_TOOL_TOKENS = 2000;
  private static readonly DEFAULT_SYSTEM_TOKENS = 1000;
  private static readonly MIN_RECENT_MESSAGES = 5;
  // Reserved for future use
  // private static readonly TOKENS_PER_MESSAGE_ESTIMATE = 100;

  // Optional model config for accurate token counting
  private modelConfig?: ModelConfig;

  /**
   * Calculate context budget for a given model
   *
   * @param modelConfig - Model configuration
   * @param overrides - Optional overrides for actual token counts when available.
   *   - actualToolTokens: Real token count from serialized tool schemas.
   *     Tool definitions are NOT in messageHistory — they're passed separately to the API,
   *     so we must reserve space for them. Default estimate (30/tool, cap 2000) is wildly
   *     low for 29 tools with detailed schemas (~8-10K actual).
   *   - actualSystemTokens: Explicit system message tokens. In this architecture, system
   *     messages are embedded as <system-reminder> tags in user message content and are
   *     already counted by estimateTotalTokens(messageHistory). Set to 0 to avoid
   *     double-counting. Defaults to DEFAULT_SYSTEM_TOKENS for backwards compatibility.
   */
  public calculateBudget(
    modelConfig: ModelConfig,
    overrides?: { actualToolTokens?: number; actualSystemTokens?: number }
  ): ContextBudget {
    const total = modelConfig.limits.contextWindow;
    const outputReserve = Math.min(modelConfig.limits.outputTokens, total * 0.5);

    // For very small contexts, reduce reserves proportionally
    const scaleFactor = total < 5000 ? (total / 5000) : 1.0;

    // Use actual tool token count when available, fall back to estimate
    const rawToolsReserve = overrides?.actualToolTokens !== undefined
      ? overrides.actualToolTokens
      : this.estimateToolTokens(modelConfig);
    const toolsReserve = Math.floor(rawToolsReserve * scaleFactor);

    // System messages are embedded in user message content (counted in history estimate).
    // When caller passes actualSystemTokens: 0, we avoid double-counting.
    const rawSystemReserve = overrides?.actualSystemTokens !== undefined
      ? overrides.actualSystemTokens
      : ContextBudgetManager.DEFAULT_SYSTEM_TOKENS;
    const systemReserve = Math.floor(rawSystemReserve * scaleFactor);

    const availableForHistory = Math.max(
      100, // Always reserve at least 100 tokens for history
      total - outputReserve - toolsReserve - systemReserve
    );

    return {
      totalAvailable: total,
      reservedForOutput: outputReserve,
      reservedForTools: toolsReserve,
      reservedForSystem: systemReserve,
      availableForHistory,
      metadata: {
        modelId: modelConfig.id,
        provider: modelConfig.provider,
        calculatedAt: new Date().toISOString(),
        strategy: modelConfig.compaction.thresholdCalculation.method
      }
    };
  }

  /**
   * Select messages that fit within the budget
   *
   * @param messages - Messages to select from
   * @param budget - Token budget
   * @param options - Selection options
   * @param modelConfig - Optional model config for accurate token counting
   */
  public selectMessages(
    messages: Message[],
    budget: number,
    options: SelectionOptions = { strategy: 'sliding-window' },
    modelConfig?: ModelConfig
  ): Message[] {
    // Store modelConfig for use in private methods
    this.modelConfig = modelConfig;

    try {
      switch (options.strategy) {
        case 'sliding-window':
          return this.selectSlidingWindow(messages, budget, options);

        case 'preserve-critical':
          return this.selectPreserveCritical(messages, budget, options);

        case 'compact-and-fit':
          return this.selectCompactAndFit(messages, budget, options);

        default:
          return this.selectSlidingWindow(messages, budget, options);
      }
    } finally {
      // Clean up modelConfig reference
      this.modelConfig = undefined;
    }
  }

  /**
   * Validate if model switch is possible with current history
   */
  public validateModelSwitch(
    currentHistory: Message[],
    newModel: ModelConfig
  ): ValidationResult {
    const currentTokens = this.estimateTotalTokens(currentHistory);
    const newBudget = this.calculateBudget(newModel);

    if (currentTokens <= newBudget.availableForHistory) {
      return {
        canSwitch: true,
        currentTokens,
        availableTokens: newBudget.availableForHistory
      };
    }

    // Check if sliding window would work (try without min for better fit)
    const recentMessages = this.selectSlidingWindow(
      currentHistory,
      newBudget.availableForHistory,
      { strategy: 'sliding-window' }
    );
    const recentTokens = this.estimateTotalTokens(recentMessages);

    if (recentTokens <= newBudget.availableForHistory && recentMessages.length > 0) {
      return {
        canSwitch: true,
        reason: 'Requires sliding window strategy',
        currentTokens,
        availableTokens: newBudget.availableForHistory,
        suggestedStrategy: 'sliding-window',
        estimatedTokensAfterStrategy: recentTokens
      };
    }

    // Check if preserving critical would work
    const criticalMessages = this.selectPreserveCritical(
      currentHistory,
      newBudget.availableForHistory,
      { strategy: 'preserve-critical' }
    );
    const criticalTokens = this.estimateTotalTokens(criticalMessages);

    // Only allow if we have meaningful content (at least 5 messages)
    if (criticalTokens <= newBudget.availableForHistory && criticalMessages.length >= 5) {
      return {
        canSwitch: true,
        reason: 'Requires preserving only critical messages',
        currentTokens,
        availableTokens: newBudget.availableForHistory,
        suggestedStrategy: 'preserve-critical',
        estimatedTokensAfterStrategy: criticalTokens
      };
    }

    // Would require compaction
    return {
      canSwitch: false,
      reason: `History too large (${currentTokens} tokens) for new model (${newBudget.availableForHistory} available). Requires compaction.`,
      currentTokens,
      availableTokens: newBudget.availableForHistory,
      suggestedStrategy: 'compact-and-fit'
    };
  }

  /**
   * Calculate dynamic compaction threshold for a model
   */
  public getCompactionThreshold(
    modelConfig: ModelConfig,
    overrides?: { actualToolTokens?: number; actualSystemTokens?: number }
  ): number {
    const { thresholdCalculation } = modelConfig.compaction;
    const budget = this.calculateBudget(modelConfig, overrides);

    if (thresholdCalculation.method === 'percentage') {
      // Clamp percentage between 0 and 1
      let percentage = thresholdCalculation.percentage || 0.75;
      percentage = Math.min(1.0, Math.max(0.0, percentage));
      return Math.floor(budget.availableForHistory * percentage);
    } else {
      // Absolute method
      return Math.min(
        thresholdCalculation.absolute || 155000,
        budget.availableForHistory - thresholdCalculation.safetyMargin
      );
    }
  }

  /**
   * Check if compaction is needed
   */
  public shouldCompact(
    currentTokens: number,
    modelConfig: ModelConfig
  ): boolean {
    if (modelConfig.compaction.strategy === 'off') {
      return false;
    }

    const threshold = this.getCompactionThreshold(modelConfig);
    return currentTokens >= threshold;
  }

  // Thinking block stripping was removed entirely — it mutates messageHistory,
  // breaks prompt-cache prefix continuity across all providers, and causes model
  // confusion. Context overflow is handled by compaction (helper-model summarization
  // or sliding-window message removal), which drops whole messages.

  // ============================================
  // PRIVATE METHODS
  // ============================================

  /**
   * Estimate tokens needed for tool definitions
   */
  private estimateToolTokens(modelConfig: ModelConfig): number {
    if (!modelConfig.tools.supported) {
      return 0;
    }

    // More reasonable estimate: average of 30 tokens per tool, cap at reasonable max
    const avgToolDefinitionTokens = 30;
    const estimatedTokens = Math.min(
      modelConfig.tools.maxTools * avgToolDefinitionTokens,
      ContextBudgetManager.DEFAULT_TOOL_TOKENS
    );

    // Never use more than 25% of context for tools
    const maxToolTokens = Math.floor(modelConfig.limits.contextWindow * 0.25);
    return Math.min(estimatedTokens, maxToolTokens);
  }

  /**
   * Sliding window selection - keep most recent messages
   */
  private selectSlidingWindow(
    messages: Message[],
    budget: number,
    options: SelectionOptions
  ): Message[] {
    if (budget <= 0) {
      return [];
    }

    // R34: Group messages into atomic units. An assistant message with
    // tool_use blocks and its consecutive tool_result user messages form
    // one indivisible group — removing the assistant but keeping its tool
    // results produces a structurally invalid conversation for chat/completions.
    const groups = this.groupToolPairs(messages);

    const minRecent = options.minRecentMessages || ContextBudgetManager.MIN_RECENT_MESSAGES;
    const result: Message[] = [];
    let totalTokens = 0;
    let msgCount = 0;

    for (let g = groups.length - 1; g >= 0; g--) {
      const group = groups[g]!;
      let groupTokens = 0;
      for (const msg of group) {
        groupTokens += this.estimateMessageTokens(msg);
      }

      if (totalTokens + groupTokens <= budget || msgCount < minRecent) {
        result.unshift(...group);
        totalTokens += groupTokens;
        msgCount += group.length;
      } else {
        break;
      }
    }

    // Safety net: strip any remaining orphaned tool_results at the front
    // (can happen if minRecent forced inclusion of a partial group).
    return this.stripLeadingOrphanedToolResults(result);
  }

  private groupToolPairs(messages: Message[]): Message[][] {
    const groups: Message[][] = [];
    let i = 0;
    while (i < messages.length) {
      const msg = messages[i]!;
      const content = (msg as any).message?.content ?? (msg as any).content;
      const hasToolUse = Array.isArray(content) &&
        content.some((b: any) => b && b.type === 'tool_use');

      if (hasToolUse) {
        const group: Message[] = [msg];
        let j = i + 1;
        while (j < messages.length) {
          const next = messages[j]!;
          const nc = (next as any).message?.content ?? (next as any).content;
          const isToolResult = Array.isArray(nc) && nc.length > 0 &&
            nc.every((b: any) => b && b.type === 'tool_result');
          if (!isToolResult) break;
          group.push(next);
          j++;
        }
        groups.push(group);
        i = j;
      } else {
        groups.push([msg]);
        i++;
      }
    }
    return groups;
  }

  private stripLeadingOrphanedToolResults(messages: Message[]): Message[] {
    let start = 0;
    while (start < messages.length) {
      const msg = messages[start]!;
      const content = (msg as any).message?.content ?? (msg as any).content;
      if (!Array.isArray(content)) break;
      const isToolResult = content.length > 0 && content.every(
        (b: any) => b && b.type === 'tool_result'
      );
      if (!isToolResult) break;
      start++;
    }
    return start === 0 ? messages : messages.slice(start);
  }

  /**
   * Preserve critical messages + recent
   */
  private selectPreserveCritical(
    messages: Message[],
    budget: number,
    options: SelectionOptions
  ): Message[] {
    const critical = this.identifyCriticalMessages(messages);
    const criticalTokens = this.estimateTotalTokens(critical);

    // If no critical messages, fall back to sliding window
    if (critical.length === 0) {
      return this.selectSlidingWindow(messages, budget, options);
    }

    if (criticalTokens >= budget) {
      // Even critical messages exceed budget, take most recent critical
      return this.selectSlidingWindow(critical, budget, options);
    }

    // Add recent messages to critical
    const remainingBudget = budget - criticalTokens;
    const nonCritical = messages.filter(m => !critical.includes(m));
    const recentNonCritical = this.selectSlidingWindow(
      nonCritical,
      remainingBudget,
      options
    );

    // Merge and sort by timestamp
    return [...critical, ...recentNonCritical].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
  }

  /**
   * Compact older messages and keep recent
   *
   * Strategy:
   * 1. Keep most recent messages within budget (last ~20% of budget)
   * 2. Identify older messages that need compaction
   * 3. Return messages flagged for compaction (caller will trigger compaction)
   *
   * Note: This returns what WOULD be selected if compaction were applied.
   * Actual compaction is triggered by CompactionManager when shouldCompact() is true.
   */
  private selectCompactAndFit(
    messages: Message[],
    budget: number,
    options: SelectionOptions
  ): Message[] {
    if (budget <= 0 || messages.length === 0) {
      return [];
    }

    // Reserve last 20% of budget for recent messages
    const recentBudget = Math.floor(budget * 0.2);
    const compactedBudget = budget - recentBudget;

    // Get recent messages using sliding window
    const recentMessages = this.selectSlidingWindow(messages, recentBudget, options);

    // Find where recent messages start
    const firstRecentMsg = recentMessages[0] ?? messages[messages.length - 1];
    const firstRecentIndex = firstRecentMsg ? messages.indexOf(firstRecentMsg) : messages.length;

    // Older messages (before recent) are candidates for compaction
    const olderMessages = messages.slice(0, firstRecentIndex);

    if (olderMessages.length === 0) {
      // No old messages to compact, just return recent
      return recentMessages;
    }

    // Calculate tokens in older messages
    const olderTokens = this.estimateTotalTokens(olderMessages);

    // If older messages fit in compacted budget, keep them
    if (olderTokens <= compactedBudget) {
      return messages; // Everything fits
    }

    // Mark that compaction is needed by including critical older messages
    // Preserve critical messages from older section
    const criticalOlder = this.identifyCriticalMessages(olderMessages);

    // Combine critical older + recent messages
    const result = [...criticalOlder, ...recentMessages].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    // Note: Compaction recommendation is signaled by returning fewer messages than requested
    // Caller can detect this and trigger StoredCompaction
    // Future enhancement: Add compactionRecommended flag to timeline metadata

    return result;
  }

  /**
   * Identify critical messages that should be preserved
   */
  private identifyCriticalMessages(messages: Message[]): Message[] {
    const critical: Message[] = [];

    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];
      if (!message) continue;

      // Tool use messages and their results must stay together
      if (isToolUseMessage(message)) {
        critical.push(message);

        // Find corresponding tool result
        const nextMessage = messages[i + 1];
        if (nextMessage && isToolResultMessage(nextMessage)) {
          critical.push(nextMessage);
        }
      }

      // System messages with important context
      if (isSystemMessage(message)) {
        // Check for checkpoint, compaction boundary, or file snapshot
        if (message.content && (
          message.content.includes('checkpoint') ||
          message.content.includes('compact_boundary') ||
          message.content.includes('file-history-snapshot')
        )) {
          critical.push(message);
        }
      }

      // Note: Future enhancement could add preserve flag to timeline metadata
      // For now, we preserve based on message type and content
    }

    return critical;
  }

  /**
   * Estimate token count for messages
   */
  private estimateTotalTokens(messages: Message[]): number {
    return messages.reduce((sum, msg) => sum + this.estimateMessageTokens(msg), 0);
  }

  /**
   * R4 (parallel-bench): per-message token memo. estimateTotalTokens runs
   * once per tool iteration; without this the tokenizer fires
   * history-length × iteration-count times per turn. Messages are
   * uuid-keyed and append-only (immutable once persisted), so a
   * modelId+uuid key is sound. Messages without a uuid pass through
   * uncached. Keyed by modelId because different models tokenize
   * differently.
   */
  private msgTokenCache: Map<string, number> = new Map();

  /**
   * Estimate tokens for a single message (memoized — see msgTokenCache).
   */
  private estimateMessageTokens(message: Message): number {
    const uuid = (message as { uuid?: string }).uuid;
    const cacheable = typeof uuid === 'string' && uuid.length > 0;
    const key = cacheable ? `${this.modelConfig?.id ?? ''}:${uuid}` : '';
    if (cacheable) {
      const hit = this.msgTokenCache.get(key);
      if (hit !== undefined) return hit;
    }
    const tokens = this.computeMessageTokens(message);
    if (cacheable) this.msgTokenCache.set(key, tokens);
    return tokens;
  }

  /**
   * Compute tokens for a single message (uncached).
   * Uses TokenCounter when modelConfig is available, falls back to estimation
   */
  private computeMessageTokens(message: Message): number {
    // If we have modelConfig, use accurate tokenizer
    if (this.modelConfig) {
      try {
        return TokenCounter.count(message, this.modelConfig).tokens;
      } catch (error) {
        // Fall back to estimation if tokenizer fails
        console.warn('TokenCounter failed, falling back to estimation:', error);
      }
    }

    // Fallback: Simple estimation (~4 characters per token)
    let charCount = 0;

    // System messages have direct content
    if (isSystemMessage(message)) {
      charCount += message.content.length;
    }
    // Other message types have message.content
    else if ('message' in message && message.message.content) {
      if (typeof message.message.content === 'string') {
        charCount += message.message.content.length;
      } else {
        // Content is an array of blocks
        charCount += JSON.stringify(message.message.content).length;
      }
    }

    // Add overhead for message structure (uuid, timestamp, type)
    charCount += JSON.stringify({
      type: message.type,
      timestamp: message.timestamp,
      uuid: message.uuid
    }).length;

    return Math.ceil(charCount / 4);
  }
}