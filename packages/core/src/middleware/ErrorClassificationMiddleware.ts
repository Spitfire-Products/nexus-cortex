/**
 * Error Classification Middleware
 *
 * Provides error classification and retry eligibility determination for the orchestrator.
 * Extracted from CortexOrchestrator.ts (lines 2197-2252) as part of the parallel
 * refactor project.
 *
 * This component is standalone and can be used independently of the orchestrator.
 *
 * @version 1.0.0
 * @author Agent 1 - Parallel Refactor Wave 1
 */

import type {
  IErrorClassifier,
  ErrorClassification,
} from './contracts/MiddlewareContracts.js';

/**
 * ErrorClassificationMiddleware
 *
 * Classifies errors into categories and determines whether they are retryable.
 * Supports network errors, HTTP status codes, file system errors, permission errors,
 * and abort errors.
 *
 * @example
 * ```typescript
 * const classifier = new ErrorClassificationMiddleware();
 *
 * const error = new Error('ECONNRESET');
 * const classification = classifier.classify(error);
 * console.log(classification.isRetryable); // true
 * console.log(classification.errorType); // 'network'
 * ```
 */
export class ErrorClassificationMiddleware implements IErrorClassifier {
  /**
   * Network error patterns that indicate transient connectivity issues
   */
  private readonly networkErrorPatterns = [
    'econnreset',
    'econnrefused',
    'etimedout',
    'enetunreach',
    'ehostunreach',
    'socket hang up',
    'network error',
    'fetch failed',
  ];

  /**
   * HTTP status codes that are typically retryable
   */
  private readonly retryableStatusCodes = [408, 429, 500, 502, 503, 504];

  /**
   * File system error patterns that indicate temporary resource contention
   */
  private readonly temporaryFsErrorPatterns = ['ebusy', 'eagain'];

  /**
   * Permission and validation error patterns that are not retryable
   */
  private readonly nonRetryablePatterns = [
    'permission denied',
    'eacces',
    'eperm',
    'enoent', // File not found
    'invalid',
    'validation failed',
    'unauthorized',
    'forbidden',
  ];

  /**
   * Classify an error and provide detailed information
   *
   * @param error - The error to classify
   * @returns Complete error classification with type, retryability, and metadata
   *
   * @example
   * ```typescript
   * const error = new Error('ETIMEDOUT');
   * const result = classifier.classify(error);
   * // {
   * //   isRetryable: true,
   * //   errorType: 'network',
   * //   message: 'ETIMEDOUT',
   * //   metadata: { errorName: 'error' }
   * // }
   * ```
   */
  classify(error: any): ErrorClassification {
    const statusCode = error?.status || error?.statusCode;

    // Determine error type
    const errorType = this.getErrorType(error);

    // Determine if retryable
    const isRetryable = this.isRetryable(error);

    // Build classification result
    const classification: ErrorClassification = {
      isRetryable,
      errorType,
      message: error?.message || String(error),
      metadata: {
        errorName: error?.name,
      },
    };

    // Add status code if present
    if (statusCode !== undefined) {
      classification.statusCode = statusCode;
      classification.metadata!.statusCode = statusCode;
    }

    return classification;
  }

  /**
   * Determine if an error is retryable
   *
   * @param error - The error to check
   * @returns true if the error is transient and should be retried
   *
   * @example
   * ```typescript
   * const error = { status: 503 };
   * classifier.isRetryable(error); // true
   *
   * const permError = new Error('EACCES');
   * classifier.isRetryable(permError); // false
   * ```
   */
  isRetryable(error: any): boolean {
    const errorMessage = this.normalizeString(error?.message);
    const errorName = this.normalizeString(error?.name);

    // R13 (parallel-bench): HTTP status code is AUTHORITATIVE. A 401 with
    // "ECONNRESET" in the body is still an auth error — message patterns must
    // not override it. Only fall back to pattern matching when there is no
    // status code at all.
    const statusCode = error?.status || error?.statusCode;
    if (statusCode) {
      return this.retryableStatusCodes.includes(statusCode) || statusCode >= 500;
    }

    // No status code → fall back to message-pattern matching.
    // Network/connection errors - retryable
    if (this.matchesPattern(errorMessage, errorName, this.networkErrorPatterns)) {
      return true;
    }

    // Temporary file system errors - retryable
    if (this.matchesPattern(errorMessage, errorName, this.temporaryFsErrorPatterns)) {
      return true;
    }

    // Abort errors - NOT retryable (user/timeout initiated)
    if (errorName === 'aborterror' || errorMessage.includes('abort')) {
      return false;
    }

    // Permission/validation errors - NOT retryable
    if (this.matchesPattern(errorMessage, errorName, this.nonRetryablePatterns)) {
      return false;
    }

    // Default: don't retry unknown errors
    return false;
  }

  /**
   * Get the type of error
   *
   * @param error - The error to classify
   * @returns The error type category
   *
   * @example
   * ```typescript
   * const error = new Error('ECONNRESET');
   * classifier.getErrorType(error); // 'network'
   *
   * const permError = new Error('EACCES');
   * classifier.getErrorType(permError); // 'permission'
   * ```
   */
  getErrorType(error: any): ErrorClassification['errorType'] {
    const errorMessage = this.normalizeString(error?.message);
    const errorName = this.normalizeString(error?.name);

    // R13 (parallel-bench): status code is AUTHORITATIVE — a 429 with
    // "invalid" in the body is rate_limit, not validation. Pattern matching
    // only applies when there is no status code.
    const statusCode = error?.status || error?.statusCode;
    if (statusCode) {
      if (statusCode === 429) return 'rate_limit';
      if (statusCode === 401 || statusCode === 403) return 'permission';
      if (statusCode >= 500) return 'network';
      if (statusCode >= 400) return 'validation';
    }

    // Check for network errors
    if (this.matchesPattern(errorMessage, errorName, this.networkErrorPatterns)) {
      return 'network';
    }

    // Check for abort errors
    if (errorName === 'aborterror' || errorMessage.includes('abort')) {
      return 'abort';
    }

    // Check for permission errors
    const permissionPatterns = ['permission denied', 'eacces', 'eperm', 'unauthorized', 'forbidden'];
    if (this.matchesPattern(errorMessage, errorName, permissionPatterns)) {
      return 'permission';
    }

    // Check for validation errors
    const validationPatterns = ['invalid', 'validation failed', 'enoent'];
    if (this.matchesPattern(errorMessage, errorName, validationPatterns)) {
      return 'validation';
    }

    // Default to unknown
    return 'unknown';
  }

  /**
   * Normalize a string for case-insensitive comparison
   *
   * @param value - The string to normalize
   * @returns Lowercase string or empty string if null/undefined
   */
  private normalizeString(value: any): string {
    return value?.toLowerCase() || '';
  }

  /**
   * Check if error message or name matches any of the given patterns
   *
   * @param errorMessage - Normalized error message
   * @param errorName - Normalized error name
   * @param patterns - Array of patterns to match against
   * @returns true if any pattern matches
   */
  private matchesPattern(
    errorMessage: string,
    errorName: string,
    patterns: string[]
  ): boolean {
    return patterns.some(
      pattern => errorMessage.includes(pattern) || errorName.includes(pattern)
    );
  }
}
