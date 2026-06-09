/**
 * RetryMiddleware Tests
 *
 * Comprehensive test suite for retry orchestration with exponential backoff and jitter.
 *
 * @version 1.0.0
 * @author Agent 5 - Parallel Refactor Wave 1
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RetryMiddleware } from '../RetryMiddleware.js';
import { ErrorClassificationMiddleware } from '../ErrorClassificationMiddleware.js';
import type {
  IErrorClassifier,
  ErrorClassification,
} from '../contracts/MiddlewareContracts.js';

describe('RetryMiddleware', () => {
  let errorClassifier: IErrorClassifier;
  let retryMiddleware: RetryMiddleware;

  beforeEach(() => {
    errorClassifier = new ErrorClassificationMiddleware();
    retryMiddleware = new RetryMiddleware(errorClassifier, {
      maxRetries: 3,
      baseDelayMs: 100, // Use shorter delays for faster tests
      maxDelayMs: 1000,
      backoffMultiplier: 2,
      jitterFactor: 0.1,
    });
  });

  describe('Constructor and Options', () => {
    it('should create instance with default options', () => {
      const middleware = new RetryMiddleware(errorClassifier);
      const options = middleware.getOptions();

      expect(options.maxRetries).toBe(3);
      expect(options.baseDelayMs).toBe(1000);
      expect(options.maxDelayMs).toBe(30000);
      expect(options.backoffMultiplier).toBe(2);
      expect(options.jitterFactor).toBe(0.1);
    });

    it('should merge custom options with defaults', () => {
      const middleware = new RetryMiddleware(errorClassifier, {
        maxRetries: 5,
        baseDelayMs: 2000,
      });
      const options = middleware.getOptions();

      expect(options.maxRetries).toBe(5);
      expect(options.baseDelayMs).toBe(2000);
      expect(options.maxDelayMs).toBe(30000); // Default
      expect(options.backoffMultiplier).toBe(2); // Default
    });

    it('should validate maxRetries is non-negative', () => {
      expect(() => {
        new RetryMiddleware(errorClassifier, { maxRetries: -1 });
      }).toThrow('maxRetries must be non-negative');
    });

    it('should validate baseDelayMs is non-negative', () => {
      expect(() => {
        new RetryMiddleware(errorClassifier, { baseDelayMs: -100 });
      }).toThrow('baseDelayMs must be non-negative');
    });

    it('should validate maxDelayMs >= baseDelayMs', () => {
      expect(() => {
        new RetryMiddleware(errorClassifier, {
          baseDelayMs: 5000,
          maxDelayMs: 1000,
        });
      }).toThrow('maxDelayMs must be greater than or equal to baseDelayMs');
    });

    it('should validate backoffMultiplier >= 1', () => {
      expect(() => {
        new RetryMiddleware(errorClassifier, { backoffMultiplier: 0.5 });
      }).toThrow('backoffMultiplier must be at least 1');
    });

    it('should validate jitterFactor is between 0 and 1', () => {
      expect(() => {
        new RetryMiddleware(errorClassifier, { jitterFactor: -0.1 });
      }).toThrow('jitterFactor must be between 0 and 1');

      expect(() => {
        new RetryMiddleware(errorClassifier, { jitterFactor: 1.5 });
      }).toThrow('jitterFactor must be between 0 and 1');
    });
  });

  describe('Successful Execution', () => {
    it('should return result on first successful attempt', async () => {
      const operation = vi.fn().mockResolvedValue({ data: 'success' });

      const result = await retryMiddleware.executeWithRetry(operation, 'testOp');

      expect(result.result).toEqual({ data: 'success' });
      expect(result.attemptCount).toBe(1);
      expect(result.totalDelayMs).toBe(0);
      expect(result.errors).toHaveLength(0);
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should return correct result type', async () => {
      const operation = vi.fn().mockResolvedValue('string result');

      const result = await retryMiddleware.executeWithRetry(operation, 'stringOp');

      expect(result.result).toBe('string result');
      expect(typeof result.result).toBe('string');
    });

    it('should handle complex return types', async () => {
      const complexData = {
        id: 123,
        name: 'test',
        nested: { value: [1, 2, 3] },
      };
      const operation = vi.fn().mockResolvedValue(complexData);

      const result = await retryMiddleware.executeWithRetry(operation, 'complexOp');

      expect(result.result).toEqual(complexData);
    });
  });

  describe('Retry on Transient Errors', () => {
    it('should retry on network errors (ECONNRESET)', async () => {
      let attempts = 0;
      const operation = vi.fn().mockImplementation(async () => {
        attempts++;
        if (attempts < 3) {
          const error = new Error('ECONNRESET');
          throw error;
        }
        return { data: 'success' };
      });

      const result = await retryMiddleware.executeWithRetry(operation, 'networkOp');

      expect(result.result).toEqual({ data: 'success' });
      expect(result.attemptCount).toBe(3);
      expect(result.errors).toHaveLength(2);
      expect(result.errors[0].errorType).toBe('network');
      expect(result.errors[0].isRetryable).toBe(true);
      expect(operation).toHaveBeenCalledTimes(3);
    });

    it('should retry on HTTP 503 errors', async () => {
      let attempts = 0;
      const operation = vi.fn().mockImplementation(async () => {
        attempts++;
        if (attempts < 2) {
          const error: any = new Error('Service Unavailable');
          error.status = 503;
          throw error;
        }
        return { data: 'success' };
      });

      const result = await retryMiddleware.executeWithRetry(operation, 'http503Op');

      expect(result.result).toEqual({ data: 'success' });
      expect(result.attemptCount).toBe(2);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].statusCode).toBe(503);
      expect(result.errors[0].isRetryable).toBe(true);
    });

    it('should retry on multiple different transient errors', async () => {
      let attempts = 0;
      const operation = vi.fn().mockImplementation(async () => {
        attempts++;
        if (attempts === 1) {
          throw new Error('ETIMEDOUT');
        }
        if (attempts === 2) {
          const error: any = new Error('Server Error');
          error.status = 500;
          throw error;
        }
        return { data: 'success' };
      });

      const result = await retryMiddleware.executeWithRetry(operation, 'multiErrorOp');

      expect(result.attemptCount).toBe(3);
      expect(result.errors).toHaveLength(2);
      expect(result.errors[0].message).toContain('ETIMEDOUT');
      expect(result.errors[1].statusCode).toBe(500);
    });

    it('should accumulate delays when retrying', async () => {
      let attempts = 0;
      const operation = vi.fn().mockImplementation(async () => {
        attempts++;
        if (attempts < 3) {
          throw new Error('ECONNRESET');
        }
        return { data: 'success' };
      });

      const result = await retryMiddleware.executeWithRetry(operation, 'delayOp');

      expect(result.totalDelayMs).toBeGreaterThan(0);
      // With 2 retries, total delay should be roughly: delay(0) + delay(1)
      // With baseDelayMs=100, this should be around 100 + 200 = 300ms (± jitter)
      expect(result.totalDelayMs).toBeGreaterThan(200); // At least 200ms
      expect(result.totalDelayMs).toBeLessThan(500); // But not too much
    });
  });

  describe('Stop on Non-Retryable Errors', () => {
    it('should not retry permission errors (EACCES)', async () => {
      const operation = vi.fn().mockRejectedValue(new Error('EACCES'));

      await expect(
        retryMiddleware.executeWithRetry(operation, 'permissionOp')
      ).rejects.toThrow('EACCES');

      expect(operation).toHaveBeenCalledTimes(1); // Only one attempt
    });

    it('should not retry validation errors', async () => {
      const operation = vi.fn().mockRejectedValue(new Error('Invalid input'));

      await expect(
        retryMiddleware.executeWithRetry(operation, 'validationOp')
      ).rejects.toThrow('Invalid input');

      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should not retry abort errors', async () => {
      const error = new Error('Operation aborted');
      error.name = 'AbortError';
      const operation = vi.fn().mockRejectedValue(error);

      await expect(
        retryMiddleware.executeWithRetry(operation, 'abortOp')
      ).rejects.toThrow('Operation aborted');

      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should not retry HTTP 401 errors', async () => {
      const error: any = new Error('Unauthorized');
      error.status = 401;
      const operation = vi.fn().mockRejectedValue(error);

      await expect(
        retryMiddleware.executeWithRetry(operation, 'unauthorizedOp')
      ).rejects.toThrow('Unauthorized');

      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should preserve error metadata for non-retryable errors', async () => {
      const operation = vi.fn().mockRejectedValue(new Error('EACCES'));

      try {
        await retryMiddleware.executeWithRetry(operation, 'metadataOp');
        expect.fail('Should have thrown');
      } catch (error: any) {
        expect(error.retryMetadata).toBeDefined();
        expect(error.retryMetadata.context).toBe('metadataOp');
        expect(error.retryMetadata.attemptCount).toBe(1);
        expect(error.retryMetadata.wasRetryable).toBe(false);
      }
    });
  });

  describe('Max Retries Exhausted', () => {
    it('should throw after maxRetries attempts', async () => {
      const operation = vi.fn().mockRejectedValue(new Error('ECONNRESET'));

      await expect(
        retryMiddleware.executeWithRetry(operation, 'maxRetriesOp')
      ).rejects.toThrow('ECONNRESET');

      // maxRetries=3 means 4 total attempts (initial + 3 retries)
      expect(operation).toHaveBeenCalledTimes(4);
    });

    it('should include all error classifications when exhausted', async () => {
      const operation = vi.fn().mockRejectedValue(new Error('ECONNRESET'));

      try {
        await retryMiddleware.executeWithRetry(operation, 'allErrorsOp');
        expect.fail('Should have thrown');
      } catch (error: any) {
        expect(error.retryMetadata.errors).toHaveLength(4);
        expect(error.retryMetadata.attemptCount).toBe(4);
        expect(error.retryMetadata.lastErrorType).toBe('network');
      }
    });

    it('should respect maxRetries=0 (no retries)', async () => {
      const noRetryMiddleware = new RetryMiddleware(errorClassifier, {
        maxRetries: 0,
        baseDelayMs: 100,
      });
      const operation = vi.fn().mockRejectedValue(new Error('ECONNRESET'));

      await expect(
        noRetryMiddleware.executeWithRetry(operation, 'noRetryOp')
      ).rejects.toThrow('ECONNRESET');

      expect(operation).toHaveBeenCalledTimes(1); // Only initial attempt
    });

    it('should accumulate total delay across all retries', async () => {
      const operation = vi.fn().mockRejectedValue(new Error('ECONNRESET'));

      try {
        await retryMiddleware.executeWithRetry(operation, 'totalDelayOp');
        expect.fail('Should have thrown');
      } catch (error: any) {
        expect(error.retryMetadata.totalDelayMs).toBeGreaterThan(0);
        // With 3 retries: delay(0) + delay(1) + delay(2)
        // ~100 + ~200 + ~400 = ~700ms (± jitter)
        expect(error.retryMetadata.totalDelayMs).toBeGreaterThan(500);
      }
    });
  });

  describe('Exponential Backoff Calculation', () => {
    it('should calculate exponential backoff correctly', () => {
      const middleware = new RetryMiddleware(errorClassifier, {
        baseDelayMs: 1000,
        maxDelayMs: 30000,
        backoffMultiplier: 2,
        jitterFactor: 0, // No jitter for predictable testing
      });

      expect(middleware.calculateDelay(0)).toBe(1000); // 1000 * 2^0 = 1000
      expect(middleware.calculateDelay(1)).toBe(2000); // 1000 * 2^1 = 2000
      expect(middleware.calculateDelay(2)).toBe(4000); // 1000 * 2^2 = 4000
      expect(middleware.calculateDelay(3)).toBe(8000); // 1000 * 2^3 = 8000
      expect(middleware.calculateDelay(4)).toBe(16000); // 1000 * 2^4 = 16000
    });

    it('should cap delay at maxDelayMs', () => {
      const middleware = new RetryMiddleware(errorClassifier, {
        baseDelayMs: 1000,
        maxDelayMs: 5000,
        backoffMultiplier: 2,
        jitterFactor: 0,
      });

      expect(middleware.calculateDelay(0)).toBe(1000);
      expect(middleware.calculateDelay(1)).toBe(2000);
      expect(middleware.calculateDelay(2)).toBe(4000);
      expect(middleware.calculateDelay(3)).toBe(5000); // Capped
      expect(middleware.calculateDelay(10)).toBe(5000); // Still capped
    });

    it('should apply jitter within bounds', () => {
      const middleware = new RetryMiddleware(errorClassifier, {
        baseDelayMs: 1000,
        maxDelayMs: 30000,
        backoffMultiplier: 2,
        jitterFactor: 0.1, // 10% jitter
      });

      // Test multiple times due to randomness
      for (let i = 0; i < 10; i++) {
        const delay = middleware.calculateDelay(0);
        // Expected: 1000ms ± 10% = 900-1100ms
        expect(delay).toBeGreaterThanOrEqual(900);
        expect(delay).toBeLessThanOrEqual(1100);
      }
    });

    it('should handle jitterFactor of 0 (no jitter)', () => {
      const middleware = new RetryMiddleware(errorClassifier, {
        baseDelayMs: 1000,
        backoffMultiplier: 2,
        jitterFactor: 0,
      });

      // Should be deterministic with no jitter
      expect(middleware.calculateDelay(0)).toBe(1000);
      expect(middleware.calculateDelay(0)).toBe(1000);
      expect(middleware.calculateDelay(1)).toBe(2000);
      expect(middleware.calculateDelay(1)).toBe(2000);
    });

    it('should handle jitterFactor of 1 (full jitter)', () => {
      const middleware = new RetryMiddleware(errorClassifier, {
        baseDelayMs: 1000,
        backoffMultiplier: 1,
        jitterFactor: 1, // 100% jitter
      });

      // Test multiple times due to randomness
      for (let i = 0; i < 10; i++) {
        const delay = middleware.calculateDelay(0);
        // Expected: 1000ms ± 100% = 0-2000ms
        expect(delay).toBeGreaterThanOrEqual(0);
        expect(delay).toBeLessThanOrEqual(2000);
      }
    });

    it('should never return negative delay', () => {
      const middleware = new RetryMiddleware(errorClassifier, {
        baseDelayMs: 10,
        backoffMultiplier: 1,
        jitterFactor: 1, // High jitter can potentially go negative
      });

      // Test many times to ensure no negative values
      for (let i = 0; i < 100; i++) {
        const delay = middleware.calculateDelay(0);
        expect(delay).toBeGreaterThanOrEqual(0);
      }
    });

    it('should handle multiplier of 1 (linear backoff)', () => {
      const middleware = new RetryMiddleware(errorClassifier, {
        baseDelayMs: 1000,
        backoffMultiplier: 1,
        jitterFactor: 0,
      });

      expect(middleware.calculateDelay(0)).toBe(1000);
      expect(middleware.calculateDelay(1)).toBe(1000);
      expect(middleware.calculateDelay(2)).toBe(1000);
    });
  });

  describe('Error Metadata Enhancement', () => {
    it('should enhance error with retry metadata', async () => {
      const operation = vi.fn().mockRejectedValue(new Error('EACCES'));

      try {
        await retryMiddleware.executeWithRetry(operation, 'enhanceOp');
        expect.fail('Should have thrown');
      } catch (error: any) {
        expect(error.retryMetadata).toBeDefined();
        expect(error.retryMetadata.context).toBe('enhanceOp');
        expect(error.retryMetadata.attemptCount).toBe(1);
        expect(error.retryMetadata.totalDelayMs).toBe(0);
        expect(error.retryMetadata.errors).toHaveLength(1);
        expect(error.retryMetadata.lastErrorType).toBe('permission');
        expect(error.retryMetadata.wasRetryable).toBe(false);
      }
    });

    it('should preserve original error message and stack', async () => {
      const originalError = new Error('Original message');
      const operation = vi.fn().mockRejectedValue(originalError);

      try {
        await retryMiddleware.executeWithRetry(operation, 'preserveOp');
        expect.fail('Should have thrown');
      } catch (error: any) {
        expect(error.message).toBe('Original message');
        expect(error.stack).toBeDefined();
        expect(error).toBe(originalError); // Same error object
      }
    });

    it('should handle non-Error objects', async () => {
      const operation = vi.fn().mockRejectedValue('string error');

      try {
        await retryMiddleware.executeWithRetry(operation, 'nonErrorOp');
        expect.fail('Should have thrown');
      } catch (error: any) {
        expect(error.retryMetadata).toBeDefined();
        expect(error.message).toBe('string error');
      }
    });
  });

  describe('Context Propagation', () => {
    it('should propagate context string through retry cycle', async () => {
      let attempts = 0;
      const operation = vi.fn().mockImplementation(async () => {
        attempts++;
        if (attempts < 2) {
          throw new Error('ECONNRESET');
        }
        return { data: 'success' };
      });

      await retryMiddleware.executeWithRetry(operation, 'contextTest');

      // Context should be available in metadata if we force an error
      const failOp = vi.fn().mockRejectedValue(new Error('EACCES'));
      try {
        await retryMiddleware.executeWithRetry(failOp, 'contextCheck');
      } catch (error: any) {
        expect(error.retryMetadata.context).toBe('contextCheck');
      }
    });
  });

  describe('Integration with ErrorClassificationMiddleware', () => {
    it('should use real error classifier for network errors', async () => {
      const realClassifier = new ErrorClassificationMiddleware();
      const middleware = new RetryMiddleware(realClassifier, {
        maxRetries: 2,
        baseDelayMs: 50,
      });

      let attempts = 0;
      const operation = vi.fn().mockImplementation(async () => {
        attempts++;
        if (attempts < 2) {
          throw new Error('ECONNRESET');
        }
        return { data: 'success' };
      });

      const result = await middleware.executeWithRetry(operation, 'realClassifierOp');

      expect(result.attemptCount).toBe(2);
      expect(result.errors[0].errorType).toBe('network');
      expect(result.errors[0].isRetryable).toBe(true);
    });

    it('should use real error classifier for permission errors', async () => {
      const realClassifier = new ErrorClassificationMiddleware();
      const middleware = new RetryMiddleware(realClassifier, {
        maxRetries: 2,
        baseDelayMs: 50,
      });

      const operation = vi.fn().mockRejectedValue(new Error('EACCES'));

      try {
        await middleware.executeWithRetry(operation, 'realPermissionOp');
        expect.fail('Should have thrown');
      } catch (error: any) {
        expect(error.retryMetadata.attemptCount).toBe(1);
        expect(error.retryMetadata.lastErrorType).toBe('permission');
        expect(error.retryMetadata.wasRetryable).toBe(false);
      }
    });

    it('should work with all error types from classifier', async () => {
      const realClassifier = new ErrorClassificationMiddleware();
      const middleware = new RetryMiddleware(realClassifier, {
        maxRetries: 1,
        baseDelayMs: 50,
      });

      // Test network error
      const networkOp = vi.fn().mockRejectedValue(new Error('ETIMEDOUT'));
      try {
        await middleware.executeWithRetry(networkOp, 'networkTest');
      } catch (error: any) {
        expect(error.retryMetadata.lastErrorType).toBe('network');
      }

      // Test permission error
      const permOp = vi.fn().mockRejectedValue(new Error('EPERM'));
      try {
        await middleware.executeWithRetry(permOp, 'permTest');
      } catch (error: any) {
        expect(error.retryMetadata.lastErrorType).toBe('permission');
      }

      // Test validation error
      const validOp = vi.fn().mockRejectedValue(new Error('Invalid input'));
      try {
        await middleware.executeWithRetry(validOp, 'validTest');
      } catch (error: any) {
        expect(error.retryMetadata.lastErrorType).toBe('validation');
      }

      // Test abort error
      const abortError = new Error('Aborted');
      abortError.name = 'AbortError';
      const abortOp = vi.fn().mockRejectedValue(abortError);
      try {
        await middleware.executeWithRetry(abortOp, 'abortTest');
      } catch (error: any) {
        expect(error.retryMetadata.lastErrorType).toBe('abort');
      }
    });
  });

  describe('Edge Cases', () => {
    it('should handle operations that return undefined', async () => {
      const operation = vi.fn().mockResolvedValue(undefined);

      const result = await retryMiddleware.executeWithRetry(operation, 'undefinedOp');

      expect(result.result).toBeUndefined();
      expect(result.attemptCount).toBe(1);
    });

    it('should handle operations that return null', async () => {
      const operation = vi.fn().mockResolvedValue(null);

      const result = await retryMiddleware.executeWithRetry(operation, 'nullOp');

      expect(result.result).toBeNull();
      expect(result.attemptCount).toBe(1);
    });

    it('should handle operations that return false', async () => {
      const operation = vi.fn().mockResolvedValue(false);

      const result = await retryMiddleware.executeWithRetry(operation, 'falseOp');

      expect(result.result).toBe(false);
      expect(result.attemptCount).toBe(1);
    });

    it('should handle synchronous exceptions', async () => {
      const operation = vi.fn().mockImplementation(() => {
        throw new Error('Synchronous error');
      });

      await expect(
        retryMiddleware.executeWithRetry(operation, 'syncErrorOp')
      ).rejects.toThrow('Synchronous error');
    });

    it('should handle empty context string', async () => {
      const operation = vi.fn().mockResolvedValue({ data: 'success' });

      const result = await retryMiddleware.executeWithRetry(operation, '');

      expect(result.result).toEqual({ data: 'success' });
    });
  });

  describe('Performance Characteristics', () => {
    it('should complete fast operations quickly', async () => {
      const operation = vi.fn().mockResolvedValue({ data: 'success' });
      const start = Date.now();

      await retryMiddleware.executeWithRetry(operation, 'fastOp');

      const duration = Date.now() - start;
      expect(duration).toBeLessThan(50); // Should be nearly instant
    });

    it('should respect timing for retries', async () => {
      const middleware = new RetryMiddleware(errorClassifier, {
        maxRetries: 2,
        baseDelayMs: 100,
        backoffMultiplier: 2,
        jitterFactor: 0, // No jitter for predictable timing
      });

      let attempts = 0;
      const operation = vi.fn().mockImplementation(async () => {
        attempts++;
        if (attempts < 3) {
          throw new Error('ECONNRESET');
        }
        return { data: 'success' };
      });

      const start = Date.now();
      const result = await middleware.executeWithRetry(operation, 'timingOp');
      const duration = Date.now() - start;

      // Should have delays: 100ms (attempt 0) + 200ms (attempt 1) = 300ms
      expect(duration).toBeGreaterThanOrEqual(280); // Allow some variance
      expect(duration).toBeLessThan(400); // But not too much
      expect(result.totalDelayMs).toBeGreaterThanOrEqual(280);
    });
  });
});
