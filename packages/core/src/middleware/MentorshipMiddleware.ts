/**
 * Mentorship Middleware
 *
 * Implements reactive mentorship system that:
 * - Detects error patterns from tool execution results
 * - Tracks recurring errors with timestamps and counts
 * - Triggers mentorship guidance based on patterns
 * - Injects thinking blocks into assistant responses
 * - Maintains session-isolated pattern storage
 *
 * Extracted from CortexOrchestrator.ts as part of parallel refactor (Wave 1, Agent 4)
 *
 * @version 1.0.0
 * @author Agent 4
 */

import type {
  IMentorshipProvider,
  MentorshipToolResult,
  ErrorPattern,
  MiddlewareContext
} from './contracts/MiddlewareContracts.js';

/**
 * Error severity classification
 * @internal - Reserved for future severity-based mentorship
 */
// type ErrorSeverity = 'low' | 'medium' | 'high';

/**
 * MentorshipMiddleware
 *
 * Provides intelligent error pattern detection and mentorship guidance injection.
 * Maintains separate error pattern tracking for each session to ensure isolation.
 *
 * Key Features:
 * - Session-scoped error pattern storage
 * - Intelligent pattern matching (normalizes numbers, quotes)
 * - Severity-based triggering (high/medium/low)
 * - Thinking block injection with guidance
 * - Pattern count tracking with timestamps
 *
 * @example
 * ```typescript
 * const mentorship = new MentorshipMiddleware();
 *
 * // Check if error should trigger mentorship
 * if (mentorship.shouldTriggerMentorship(toolResult, context)) {
 *   // Generate and inject guidance
 * }
 *
 * // Track error patterns
 * mentorship.trackErrorPattern(error, 'bash_execute');
 *
 * // Get patterns for analysis
 * const patterns = mentorship.getErrorPatterns(sessionId);
 * ```
 */
/** Threshold for sequential tool call nudges */
const SEQUENTIAL_TOOL_CALL_THRESHOLD = 3;

export class MentorshipMiddleware implements IMentorshipProvider {
  /**
   * Error patterns stored per session
   * Outer Map: sessionId -> Inner Map
   * Inner Map: pattern string -> ErrorPattern
   */
  private errorPatterns: Map<string, Map<string, ErrorPattern>> = new Map();

  /** Sequential tool call counts per session (for CodeExecute nudges) */
  private sequentialCallCounts = new Map<string, number>();

  /**
   * High severity error patterns (always trigger on 'high' threshold)
   */
  private readonly highSeverityPatterns = [
    'permission denied',
    'access denied',
    'eacces',
    'fatal',
    'critical',
    'cannot',
    'failed to',
    'unable to'
  ];

  /**
   * Medium severity error patterns
   */
  private readonly mediumSeverityPatterns = [
    'error',
    'exception',
    'not found',
    'enoent',
    'invalid',
    'timeout'
  ];

  /**
   * Check if a tool result should trigger mentorship
   *
   * Evaluates:
   * 1. Is mentorship enabled in config?
   * 2. Is error triggering enabled?
   * 3. Is this an error result?
   * 4. Does error meet severity threshold?
   *
   * @param toolResult - Tool execution result with error status
   * @param context - Middleware context with configuration
   * @returns true if mentorship should be triggered
   */
  shouldTriggerMentorship(
    toolResult: MentorshipToolResult,
    context: MiddlewareContext
  ): boolean {
    // Check if mentorship is enabled
    if (!context.config.reactiveMentorship?.enabled ||
        !context.config.reactiveMentorship?.triggerOnError) {
      return false;
    }

    // Must be an error
    if (!toolResult.is_error) {
      return false;
    }

    // Apply severity threshold
    const threshold = context.config.reactiveMentorship.errorSeverityThreshold || 'medium';
    const errorContent = toolResult.content.toLowerCase();

    // Check high severity
    const isHighSeverity = this.highSeverityPatterns.some(
      pattern => errorContent.includes(pattern)
    );

    if (threshold === 'high' && !isHighSeverity) {
      return false;
    }

    // Check medium severity
    const isMediumSeverity = this.mediumSeverityPatterns.some(
      pattern => errorContent.includes(pattern)
    );

    if (threshold === 'medium' && !isHighSeverity && !isMediumSeverity) {
      return false;
    }

    // Low severity: trigger on any error
    return true;
  }

  /**
   * Track an error pattern for pattern detection
   *
   * Extracts a normalized pattern from the error and tracks:
   * - Occurrence count
   * - First seen timestamp
   * - Last seen timestamp
   *
   * Pattern normalization:
   * - Takes first 100 characters
   * - Replaces numbers with 'N' (e.g., "port 3000" -> "port N")
   * - Removes quotes
   * - Converts to lowercase
   *
   * @param error - Error object or message string
   * @param toolName - Name of the tool that generated the error
   */
  trackErrorPattern(error: any, toolName: string): void {
    // Extract error message
    const errorMessage = typeof error === 'string'
      ? error
      : error?.message || error?.toString() || 'Unknown error';

    // Extract normalized pattern
    const pattern = this.extractErrorPattern(errorMessage);

    // Get session-specific pattern storage
    // Note: We use toolName as a proxy for sessionId in standalone mode
    // In production, this would be injected via context
    const sessionId = toolName; // Simplified for middleware isolation

    if (!this.errorPatterns.has(sessionId)) {
      this.errorPatterns.set(sessionId, new Map());
    }

    const sessionPatterns = this.errorPatterns.get(sessionId)!;

    // Update or create pattern entry
    const existingPattern = sessionPatterns.get(pattern);
    const now = new Date();

    if (existingPattern) {
      // Update existing pattern
      existingPattern.count += 1;
      existingPattern.lastSeen = now;
    } else {
      // Create new pattern entry
      sessionPatterns.set(pattern, {
        pattern,
        count: 1,
        firstSeen: now,
        lastSeen: now
      });
    }
  }

  /**
   * Extract normalized error pattern from error message
   *
   * Normalization strategy:
   * - Truncate to 100 chars (focus on error type, not specifics)
   * - Replace all numbers with 'N' (generalize)
   * - Remove quotes (normalize formatting)
   * - Lowercase (case-insensitive matching)
   *
   * Examples:
   * - "Error on line 42" -> "error on line n"
   * - "Port 3000 in use" -> "port n in use"
   * - 'File "test.js" not found' -> "file test.js not found"
   *
   * @param errorMessage - Raw error message
   * @returns Normalized pattern string
   */
  // R12 (Cortex finding): compiled two regex literals per call. Hoisted to
  // static fields (global-flag regexes are safe to reuse across `.replace`).
  private static readonly NUMBER_REGEX = /[0-9]+/g;
  private static readonly QUOTE_REGEX = /['"]/g;

  private extractErrorPattern(errorMessage: string): string {
    return errorMessage
      .substring(0, 100)
      .replace(MentorshipMiddleware.NUMBER_REGEX, 'N')  // Replace numbers
      .replace(MentorshipMiddleware.QUOTE_REGEX, '')     // Remove quotes
      .toLowerCase();            // Normalize case
  }

  /**
   * Handle detected error pattern
   *
   * Called when a pattern reaches the detection threshold.
   * Responsibilities:
   * - Log pattern detection
   * - Coordinate with helper model for guidance generation
   * - Inject thinking block with guidance
   *
   * Note: In standalone middleware, this is a coordination point.
   * Actual guidance generation happens in HelperModelMiddleware.
   *
   * @param pattern - Detected error pattern
   * @param context - Middleware context
   */
  async handlePatternDetection(
    pattern: string,
    context: MiddlewareContext
  ): Promise<void> {
    // Get pattern details
    const sessionPatterns = this.errorPatterns.get(context.sessionId);
    const errorPattern = sessionPatterns?.get(pattern);

    if (!errorPattern) {
      return; // Pattern not found, nothing to do
    }

    // Log pattern detection (if debug enabled)
    if (context.config.debug) {
      console.log(
        `[MentorshipMiddleware] Pattern detected: "${pattern}" ` +
        `(count: ${errorPattern.count}, session: ${context.sessionId})`
      );
    }

    // In production, this would coordinate with HelperModelMiddleware
    // to generate guidance and then inject thinking block
    // For now, we track that pattern detection occurred
  }

  /**
   * Inject thinking block into response
   *
   * Creates a thinking block with mentorship guidance and injects it
   * into the assistant's response. The thinking block format depends
   * on the model's expectations.
   *
   * Thinking block format:
   * ```
   * {
   *   type: 'thinking',
   *   thinking: ' **AI Mentor Insight**\n\n[guidance]'
   * }
   * ```
   *
   * @param response - Assistant response to modify
   * @param guidance - Mentorship guidance to inject
   * @returns Modified response with thinking block
   */
  injectThinkingBlock(response: any, guidance: string): any {
    // Handle different response formats
    if (!response) {
      return response;
    }

    // If response has content array, inject thinking block
    if (response.content && Array.isArray(response.content)) {
      // Create thinking block
      const thinkingBlock = {
        type: 'thinking',
        thinking: ` **AI Mentor Insight**\n\n${guidance}`
      };

      // Inject at beginning of content
      return {
        ...response,
        content: [thinkingBlock, ...response.content]
      };
    }

    // If response is string content, wrap in array with thinking block
    if (typeof response.content === 'string') {
      return {
        ...response,
        content: [
          {
            type: 'thinking',
            thinking: ` **AI Mentor Insight**\n\n${guidance}`
          },
          {
            type: 'text',
            text: response.content
          }
        ]
      };
    }

    // Return unmodified if format not recognized
    return response;
  }

  /**
   * Get all error patterns for a session
   *
   * Returns error patterns tracked for the specified session.
   * Patterns are sorted by count (descending) for analysis.
   *
   * @param sessionId - Session identifier
   * @returns Array of error patterns for the session
   */
  getErrorPatterns(sessionId: string): ErrorPattern[] {
    const sessionPatterns = this.errorPatterns.get(sessionId);

    if (!sessionPatterns) {
      return [];
    }

    // Convert map to array and sort by count (descending)
    return Array.from(sessionPatterns.values())
      .sort((a, b) => b.count - a.count);
  }

  /**
   * Clear all patterns for a session
   *
   * Removes all tracked error patterns for the specified session.
   * Useful for:
   * - Session cleanup
   * - Testing
   * - Manual pattern reset after intervention
   *
   * @param sessionId - Session identifier
   */
  clearPatterns(sessionId: string): void {
    this.errorPatterns.delete(sessionId);
  }

  /**
   * Check if pattern has reached detection threshold
   *
   * Used internally to determine when to trigger pattern detection.
   *
   * @param pattern - Pattern to check
   * @param sessionId - Session identifier
   * @param threshold - Detection threshold (default: 3)
   * @returns true if pattern count >= threshold
   */
  hasReachedThreshold(
    pattern: string,
    sessionId: string,
    threshold: number = 3
  ): boolean {
    const sessionPatterns = this.errorPatterns.get(sessionId);
    if (!sessionPatterns) {
      return false;
    }

    const errorPattern = sessionPatterns.get(pattern);
    return errorPattern ? errorPattern.count >= threshold : false;
  }

  /**
   * Reset pattern count after intervention
   *
   * Called after mentorship guidance is provided to prevent
   * repeated interventions for the same pattern.
   *
   * @param pattern - Pattern to reset
   * @param sessionId - Session identifier
   */
  resetPatternCount(pattern: string, sessionId: string): void {
    const sessionPatterns = this.errorPatterns.get(sessionId);
    if (!sessionPatterns) {
      return;
    }

    const errorPattern = sessionPatterns.get(pattern);
    if (errorPattern) {
      errorPattern.count = 0;
      errorPattern.lastSeen = new Date();
    }
  }

  /**
   * Get total error count for a session
   *
   * Utility method for monitoring and analytics.
   *
   * @param sessionId - Session identifier
   * @returns Total number of errors tracked in session
   */
  getTotalErrorCount(sessionId: string): number {
    const sessionPatterns = this.errorPatterns.get(sessionId);
    if (!sessionPatterns) {
      return 0;
    }

    return Array.from(sessionPatterns.values())
      .reduce((total, pattern) => total + pattern.count, 0);
  }

  /**
   * Get unique pattern count for a session
   *
   * Returns the number of distinct error patterns encountered.
   *
   * @param sessionId - Session identifier
   * @returns Number of unique patterns
   */
  getUniquePatternCount(sessionId: string): number {
    const sessionPatterns = this.errorPatterns.get(sessionId);
    return sessionPatterns ? sessionPatterns.size : 0;
  }

  /**
   * Check if session has any patterns
   *
   * @param sessionId - Session identifier
   * @returns true if session has tracked patterns
   */
  hasPatterns(sessionId: string): boolean {
    const sessionPatterns = this.errorPatterns.get(sessionId);
    return sessionPatterns ? sessionPatterns.size > 0 : false;
  }

  /**
   * Check sequential tool calls and nudge toward CodeExecute.
   *
   * When a non-PTC model makes 3+ sequential tool calls that could be
   * batched, returns a nudge suggesting CodeExecute for efficiency.
   *
   * @param sessionId - Session identifier
   * @param _toolName - Name of the tool just called (reserved for future filtering)
   * @param enableLocalCodeExecution - Whether local code execution is available
   * @returns Nudge string if threshold reached, null otherwise
   */
  checkSequentialToolCalls(
    sessionId: string,
    _toolName: string,
    enableLocalCodeExecution: boolean,
  ): string | null {
    const count = (this.sequentialCallCounts.get(sessionId) ?? 0) + 1;
    this.sequentialCallCounts.set(sessionId, count);

    if (count >= SEQUENTIAL_TOOL_CALL_THRESHOLD && enableLocalCodeExecution) {
      this.sequentialCallCounts.set(sessionId, 0);
      return `You've made ${count} sequential tool calls. Consider using CodeExecute to chain operations and reduce round-trips.`;
    }

    return null;
  }

  /**
   * Reset sequential call counter for a session.
   * Call at the start of each user turn.
   *
   * @param sessionId - Session identifier
   */
  resetSequentialCalls(sessionId: string): void {
    this.sequentialCallCounts.delete(sessionId);
  }
}
