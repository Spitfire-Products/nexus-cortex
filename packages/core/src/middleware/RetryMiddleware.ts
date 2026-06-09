/**
 * Retry Middleware
 *
 * Provides retry orchestration with exponential backoff and jitter for failed operations.
 * Uses error classification from ErrorClassificationMiddleware to determine retry eligibility.
 *
 * This component is standalone and can be used independently of the orchestrator.
 *
 * @version 1.0.0
 * @author Agent 5 - Parallel Refactor Wave 1
 */

import type {
  IRetryExecutor,
  IErrorClassifier,
  RetryOptions,
  RetryResult,
  ErrorClassification,
} from './contracts/MiddlewareContracts.js';

/**
 * Default retry options
 *
 * These defaults provide a reasonable balance between resilience and performance:
 * - 3 retries allows for transient network hiccups without excessive delays
 * - 1 second base delay is short enough for quick recovery
 * - 30 second max delay prevents indefinite waiting
 * - 2x backoff multiplier follows industry standard exponential backoff
 * - 10% jitter prevents thundering herd problem
 */
const DEFAULT_OPTIONS: RetryOptions = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  jitterFactor: 0.1,
};

/**
 * RetryMiddleware
 *
 * Orchestrates retry logic for failed operations using exponential backoff with jitter.
 * Works in conjunction with ErrorClassificationMiddleware to determine which errors
 * are retryable.
 *
 * **Exponential Backoff Algorithm:**
 * ```
 * delay = baseDelay * (backoffMultiplier ^ attempt)
 * delay = min(delay, maxDelayMs)
 * delay = delay ± (delay * jitterFactor * random())
 * ```
 *
 * **Example backoff sequence (default options):**
 * - Attempt 1: 1000ms ± 100ms = 900-1100ms
 * - Attempt 2: 2000ms ± 200ms = 1800-2200ms
 * - Attempt 3: 4000ms ± 400ms = 3600-4400ms
 * - Attempt 4: 8000ms ± 800ms = 7200-8800ms
 * - Capped at: 30000ms ± 3000ms = 27000-33000ms
 *
 * @example
 * ```typescript
 * const errorClassifier = new ErrorClassificationMiddleware();
 * const retryMiddleware = new RetryMiddleware(errorClassifier, {
 *   maxRetries: 3,
 *   baseDelayMs: 1000,
 *   maxDelayMs: 30000,
 *   backoffMultiplier: 2,
 *   jitterFactor: 0.1
 * });
 *
 * const result = await retryMiddleware.executeWithRetry(
 *   async () => {
 *     return await fetchDataFromAPI();
 *   },
 *   'fetchDataFromAPI'
 * );
 *
 * console.log(`Success after ${result.attemptCount} attempts`);
 * console.log(`Total delay: ${result.totalDelayMs}ms`);
 * ```
 */
export class RetryMiddleware implements IRetryExecutor {
  private readonly options: RetryOptions;

  /**
   * Create a new RetryMiddleware instance
   *
   * @param errorClassifier - Error classifier for determining retry eligibility
   * @param options - Retry configuration options (merged with defaults)
   */
  constructor(
    private readonly errorClassifier: IErrorClassifier,
    options: Partial<RetryOptions> = {}
  ) {
    // Merge provided options with defaults
    this.options = {
      ...DEFAULT_OPTIONS,
      ...options,
    };

    // Validate options
    if (this.options.maxRetries < 0) {
      throw new Error('maxRetries must be non-negative');
    }
    if (this.options.baseDelayMs < 0) {
      throw new Error('baseDelayMs must be non-negative');
    }
    if (this.options.maxDelayMs < this.options.baseDelayMs) {
      throw new Error('maxDelayMs must be greater than or equal to baseDelayMs');
    }
    if (this.options.backoffMultiplier < 1) {
      throw new Error('backoffMultiplier must be at least 1');
    }
    if (this.options.jitterFactor < 0 || this.options.jitterFactor > 1) {
      throw new Error('jitterFactor must be between 0 and 1');
    }
  }

  /**
   * Execute an operation with retry logic
   *
   * This method will:
   * 1. Attempt the operation
   * 2. If it fails, classify the error
   * 3. If the error is retryable, wait with exponential backoff
   * 4. Retry up to maxRetries times
   * 5. If all retries fail, throw the last error with accumulated metadata
   *
   * @param operation - The async operation to execute
   * @param context - Context string for logging/debugging (e.g., "fetchUserData", "executeToolX")
   * @returns RetryResult containing the successful result and retry metadata
   * @throws The last error if all retry attempts are exhausted or if a non-retryable error occurs
   *
   * @example
   * ```typescript
   * // Successful on first attempt
   * const result = await retry.executeWithRetry(
   *   async () => ({ data: 'success' }),
   *   'testOperation'
   * );
   * // result.attemptCount === 1
   * // result.totalDelayMs === 0
   * // result.errors.length === 0
   *
   * // Retries on transient error
   * let attempts = 0;
   * const result = await retry.executeWithRetry(
   *   async () => {
   *     if (attempts++ < 2) throw new Error('ECONNRESET');
   *     return { data: 'success' };
   *   },
   *   'retryOperation'
   * );
   * // result.attemptCount === 3
   * // result.errors.length === 2
   * ```
   */
  async executeWithRetry<T>(
    operation: () => Promise<T>,
    context: string
  ): Promise<RetryResult<T>> {
    const errors: ErrorClassification[] = [];
    let totalDelayMs = 0;

    for (let attempt = 0; attempt <= this.options.maxRetries; attempt++) {
      try {
        // Attempt the operation
        const result = await operation();

        // Success! Return result with metadata
        return {
          result,
          attemptCount: attempt + 1,
          totalDelayMs,
          errors,
        };
      } catch (error: any) {
        // Classify the error
        const classification = this.errorClassifier.classify(error);
        errors.push(classification);

        // Check if we should retry
        const isLastAttempt = attempt === this.options.maxRetries;
        const shouldRetry = classification.isRetryable && !isLastAttempt;

        if (!shouldRetry) {
          // Either non-retryable or exhausted retries - throw error
          const enhancedError = this.enhanceError(
            error,
            context,
            attempt + 1,
            totalDelayMs,
            errors
          );
          throw enhancedError;
        }

        // Calculate delay with exponential backoff and jitter
        const delayMs = this.calculateDelay(attempt);
        totalDelayMs += delayMs;

        // Wait before retrying
        await this.sleep(delayMs);
      }
    }

    // This should never be reached due to the throw in the loop,
    // but TypeScript needs this for type safety
    throw new Error(`Retry loop completed unexpectedly for context: ${context}`);
  }

  /**
   * Calculate delay for a given attempt number using exponential backoff with jitter
   *
   * The algorithm:
   * 1. Calculate exponential delay: baseDelay * (multiplier ^ attempt)
   * 2. Cap at maxDelayMs
   * 3. Add random jitter: ± (delay * jitterFactor)
   *
   * **Jitter Purpose:**
   * Jitter prevents the "thundering herd" problem where many clients retry
   * simultaneously, potentially overwhelming a recovering service.
   *
   * @param attempt - The attempt number (0-indexed)
   * @returns Delay in milliseconds (always non-negative)
   *
   * @example
   * ```typescript
   * // With default options (baseDelayMs=1000, backoffMultiplier=2, jitterFactor=0.1)
   * retry.calculateDelay(0); // ~1000ms ± 10% = 900-1100ms
   * retry.calculateDelay(1); // ~2000ms ± 10% = 1800-2200ms
   * retry.calculateDelay(2); // ~4000ms ± 10% = 3600-4400ms
   * retry.calculateDelay(10); // capped at maxDelayMs (30000ms) ± 10%
   * ```
   */
  calculateDelay(attempt: number): number {
    // Calculate exponential delay
    const exponentialDelay =
      this.options.baseDelayMs * Math.pow(this.options.backoffMultiplier, attempt);

    // Cap at maximum delay
    const cappedDelay = Math.min(exponentialDelay, this.options.maxDelayMs);

    // Add jitter: random value between -jitterRange and +jitterRange
    const jitterRange = cappedDelay * this.options.jitterFactor;
    const jitter = (Math.random() * 2 - 1) * jitterRange; // -jitterRange to +jitterRange

    // Ensure non-negative delay
    const finalDelay = Math.max(0, cappedDelay + jitter);

    return Math.round(finalDelay); // Round to whole milliseconds
  }

  /**
   * Sleep for the specified duration
   *
   * @param ms - Milliseconds to sleep
   * @returns Promise that resolves after the delay
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Enhance an error with retry metadata
   *
   * This adds useful debugging information to the error object without
   * modifying the original error message or stack trace.
   *
   * @param error - The original error
   * @param context - Context string
   * @param attemptCount - Number of attempts made
   * @param totalDelayMs - Total time spent waiting
   * @param errors - Array of all error classifications
   * @returns Enhanced error object
   */
  private enhanceError(
    error: any,
    context: string,
    attemptCount: number,
    totalDelayMs: number,
    errors: ErrorClassification[]
  ): any {
    // Create a new error object to avoid mutating the original
    const enhanced = error instanceof Error ? error : new Error(String(error));

    // Add retry metadata as a property (non-enumerable to avoid pollution)
    Object.defineProperty(enhanced, 'retryMetadata', {
      value: {
        context,
        attemptCount,
        totalDelayMs,
        errors,
        lastErrorType: errors[errors.length - 1]?.errorType,
        wasRetryable: errors[errors.length - 1]?.isRetryable,
      },
      enumerable: false,
      writable: false,
      configurable: true,
    });

    return enhanced;
  }

  /**
   * Get the current retry options
   *
   * @returns Current retry options (readonly)
   */
  getOptions(): Readonly<RetryOptions> {
    return { ...this.options };
  }
}
