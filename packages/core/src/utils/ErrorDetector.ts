/**
 * Error Detector Utility
 *
 * Provides provider-specific error detection for better error handling
 * and automatic fallback strategies. Uses SDK error types when available.
 *
 * Phase 1.5 Enhancement: Priority 1.2
 * Based on: WEEK_3_COMPLETION_HANDOFF.md Lines 525-578
 */

/**
 * Context limit error type
 */
export interface ContextLimitError extends Error {
  type: 'context_limit_error';
  provider: string;
  modelId?: string;
  maxTokens?: number;
  actualTokens?: number;
  originalError: any;
}

/**
 * Error Detector class with provider-specific detection
 */
export class ErrorDetector {
  /**
   * Check if error is a context limit error
   *
   * @param error - Error to check
   * @param provider - Provider name (anthropic, openai, google, etc.)
   * @returns True if error is a context limit error
   */
  static isContextLimitError(error: any, provider?: string): error is ContextLimitError {
    if (!error) return false;

    // If provider is specified, use provider-specific detection
    if (provider) {
      const providerLower = provider.toLowerCase();

      if (providerLower === 'anthropic') {
        return this.isAnthropicContextError(error);
      }

      if (providerLower === 'openai') {
        return this.isOpenAIContextError(error);
      }

      if (providerLower === 'google') {
        return this.isGoogleContextError(error);
      }

      if (providerLower === 'xai' || providerLower === 'x.ai') {
        return this.isXAIContextError(error);
      }

      if (providerLower === 'deepseek') {
        return this.isDeepSeekContextError(error);
      }
    }

    // Fallback to generic detection
    return this.isGenericContextError(error);
  }

  /**
   * Detect Anthropic-specific context limit errors
   */
  private static isAnthropicContextError(error: any): boolean {
    // Check Anthropic SDK error types
    if (error.type === 'invalid_request_error') {
      if (error.error?.type === 'context_length_exceeded') {
        return true;
      }
    }

    // Check error message patterns
    const message = (error.message || '').toLowerCase();
    return (
      message.includes('prompt is too long') ||
      message.includes('maximum context length') ||
      message.includes('context_length_exceeded') ||
      message.includes('too many tokens')
    );
  }

  /**
   * Detect OpenAI-specific context limit errors
   */
  private static isOpenAIContextError(error: any): boolean {
    // Check OpenAI SDK error codes
    if (error.code === 'context_length_exceeded') {
      return true;
    }

    // Check error type and param
    if (error.type === 'invalid_request_error') {
      if (error.param === 'messages' || error.param === 'prompt') {
        const message = (error.message || '').toLowerCase();
        if (message.includes('maximum context') || message.includes('token limit')) {
          return true;
        }
      }
    }

    // Check status code (400 with context message)
    if (error.status === 400 || error.statusCode === 400) {
      const message = (error.message || '').toLowerCase();
      return (
        message.includes('maximum context length') ||
        message.includes('context length') ||
        message.includes('token limit')
      );
    }

    return false;
  }

  /**
   * Detect Google-specific context limit errors
   */
  private static isGoogleContextError(error: any): boolean {
    // Check Google SDK error status
    if (error.message?.includes('RESOURCE_EXHAUSTED')) {
      return true;
    }

    // Check status code (400 with context message)
    if (error.status === 400 || error.statusCode === 400) {
      const message = (error.message || '').toLowerCase();
      return (
        message.includes('context') ||
        message.includes('token limit') ||
        message.includes('exceeds maximum')
      );
    }

    // Check error details
    if (error.details) {
      const details = JSON.stringify(error.details).toLowerCase();
      return details.includes('context') || details.includes('token');
    }

    return false;
  }

  /**
   * Detect XAI-specific context limit errors
   */
  private static isXAIContextError(error: any): boolean {
    // XAI uses Messages API format (similar to Anthropic)
    if (error.type === 'invalid_request_error') {
      const message = (error.message || '').toLowerCase();
      return (
        message.includes('context') ||
        message.includes('token limit') ||
        message.includes('maximum length')
      );
    }

    return false;
  }

  /**
   * Detect DeepSeek-specific context limit errors
   */
  private static isDeepSeekContextError(error: any): boolean {
    // DeepSeek uses OpenAI-compatible API
    return this.isOpenAIContextError(error);
  }

  /**
   * Generic context limit error detection (fallback)
   */
  private static isGenericContextError(error: any): boolean {
    // Check error message for common patterns
    const message = (error.message || '').toLowerCase();
    const patterns = [
      'context',
      'token limit',
      'maximum context',
      'too many tokens',
      'context window',
      'context length',
      'exceeds maximum',
      'prompt is too long',
    ];

    return patterns.some(pattern => message.includes(pattern));
  }

  /**
   * Extract token information from error
   *
   * @param error - Error to extract from
   * @returns Object with maxTokens and actualTokens if available
   */
  static extractTokenInfo(error: any): {
    maxTokens?: number;
    actualTokens?: number;
  } {
    const result: { maxTokens?: number; actualTokens?: number } = {};

    // Try to extract from error message
    const message = error.message || '';

    // Pattern: "Maximum context length is X tokens"
    const maxMatch = message.match(/maximum\s+(?:context\s+)?(?:length\s+is\s+)?(\d+)\s+tokens/i);
    if (maxMatch) {
      result.maxTokens = parseInt(maxMatch[1], 10);
    }

    // Pattern: "This model's maximum context length is X tokens"
    const modelMaxMatch = message.match(/maximum\s+context\s+length\s+is\s+(\d+)\s+tokens/i);
    if (modelMaxMatch) {
      result.maxTokens = parseInt(modelMaxMatch[1], 10);
    }

    // Pattern: "you requested X tokens"
    const actualMatch = message.match(/you\s+requested\s+(\d+)\s+tokens/i);
    if (actualMatch) {
      result.actualTokens = parseInt(actualMatch[1], 10);
    }

    // Pattern: "X tokens in the messages"
    const messagesMatch = message.match(/(\d+)\s+tokens\s+in\s+the\s+messages/i);
    if (messagesMatch) {
      result.actualTokens = parseInt(messagesMatch[1], 10);
    }

    return result;
  }

  /**
   * Create a normalized context limit error
   *
   * @param error - Original error
   * @param provider - Provider name
   * @param modelId - Model ID
   * @returns Normalized ContextLimitError
   */
  static createContextLimitError(
    error: any,
    provider: string,
    modelId?: string
  ): ContextLimitError {
    const tokenInfo = this.extractTokenInfo(error);

    const contextError = new Error(error.message || 'Context limit exceeded') as ContextLimitError;
    contextError.type = 'context_limit_error';
    contextError.provider = provider;
    contextError.modelId = modelId;
    contextError.maxTokens = tokenInfo.maxTokens;
    contextError.actualTokens = tokenInfo.actualTokens;
    contextError.originalError = error;

    return contextError;
  }

  /**
   * Check if error is a rate limit error
   *
   * @param error - Error to check
   * @returns True if error is a rate limit error
   */
  static isRateLimitError(error: any): boolean {
    if (!error) return false;

    // Check status codes
    if (error.status === 429 || error.statusCode === 429) {
      return true;
    }

    // Check error types
    if (error.type === 'rate_limit_error') {
      return true;
    }

    // Check error message
    const message = (error.message || '').toLowerCase();
    return (
      message.includes('rate limit') ||
      message.includes('too many requests') ||
      message.includes('quota exceeded')
    );
  }

  /**
   * Check if error is an authentication error
   *
   * @param error - Error to check
   * @returns True if error is an authentication error
   */
  static isAuthenticationError(error: any): boolean {
    if (!error) return false;

    // Check status codes
    if (error.status === 401 || error.statusCode === 401) {
      return true;
    }

    // Check error types
    if (error.type === 'authentication_error' || error.type === 'invalid_api_key') {
      return true;
    }

    // Check error message
    const message = (error.message || '').toLowerCase();
    return (
      message.includes('authentication') ||
      message.includes('api key') ||
      message.includes('unauthorized') ||
      message.includes('invalid credentials')
    );
  }
}

/**
 * Helper function for quick context limit error detection
 *
 * @param error - Error to check
 * @param provider - Provider name
 * @returns True if error is a context limit error
 */
export function isContextLimitError(error: any, provider?: string): error is ContextLimitError {
  return ErrorDetector.isContextLimitError(error, provider);
}
