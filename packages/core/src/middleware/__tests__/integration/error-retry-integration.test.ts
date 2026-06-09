/**
 * Error Classification + Retry Integration Tests
 *
 * End-to-end integration tests verifying that RetryMiddleware works correctly
 * with the real ErrorClassificationMiddleware implementation.
 *
 * @version 1.0.0
 * @author Agent 5 - Parallel Refactor Wave 1
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RetryMiddleware } from '../../RetryMiddleware.js';
import { ErrorClassificationMiddleware } from '../../ErrorClassificationMiddleware.js';

describe('Error Classification + Retry Integration', () => {
  let errorClassifier: ErrorClassificationMiddleware;
  let retryMiddleware: RetryMiddleware;

  beforeEach(() => {
    // Use REAL implementations - no mocks
    errorClassifier = new ErrorClassificationMiddleware();
    retryMiddleware = new RetryMiddleware(errorClassifier, {
      maxRetries: 3,
      baseDelayMs: 50, // Short delays for faster tests
      maxDelayMs: 500,
      backoffMultiplier: 2,
      jitterFactor: 0.1,
    });
  });

  describe('Network Error Scenarios', () => {
    it('should retry ECONNRESET errors and eventually succeed', async () => {
      let attempts = 0;
      const operation = vi.fn().mockImplementation(async () => {
        attempts++;
        if (attempts < 3) {
          const error = new Error('Connection reset by peer');
          error.message = 'ECONNRESET';
          throw error;
        }
        return { status: 'success', data: 'retrieved' };
      });

      const result = await retryMiddleware.executeWithRetry(operation, 'fetchData');

      // Verify retry behavior
      expect(result.attemptCount).toBe(3);
      expect(result.result).toEqual({ status: 'success', data: 'retrieved' });
      expect(result.errors).toHaveLength(2);

      // Verify error classification
      expect(result.errors[0].errorType).toBe('network');
      expect(result.errors[0].isRetryable).toBe(true);
      expect(result.errors[1].errorType).toBe('network');
      expect(result.errors[1].isRetryable).toBe(true);

      // Verify delays occurred
      expect(result.totalDelayMs).toBeGreaterThan(0);
    });

    it('should retry ETIMEDOUT errors', async () => {
      let attempts = 0;
      const operation = vi.fn().mockImplementation(async () => {
        attempts++;
        if (attempts === 1) {
          throw new Error('ETIMEDOUT');
        }
        return { data: 'success' };
      });

      const result = await retryMiddleware.executeWithRetry(operation, 'timeout');

      expect(result.attemptCount).toBe(2);
      expect(result.errors[0].errorType).toBe('network');
      expect(result.errors[0].isRetryable).toBe(true);
    });

    it('should retry ECONNREFUSED errors', async () => {
      let attempts = 0;
      const operation = vi.fn().mockImplementation(async () => {
        attempts++;
        if (attempts === 1) {
          throw new Error('ECONNREFUSED: connection refused');
        }
        return { data: 'success' };
      });

      const result = await retryMiddleware.executeWithRetry(operation, 'refused');

      expect(result.attemptCount).toBe(2);
      expect(result.errors[0].errorType).toBe('network');
      expect(result.errors[0].isRetryable).toBe(true);
    });

    it('should retry "socket hang up" errors', async () => {
      let attempts = 0;
      const operation = vi.fn().mockImplementation(async () => {
        attempts++;
        if (attempts === 1) {
          throw new Error('socket hang up');
        }
        return { data: 'success' };
      });

      const result = await retryMiddleware.executeWithRetry(operation, 'socketHangup');

      expect(result.attemptCount).toBe(2);
      expect(result.errors[0].errorType).toBe('network');
      expect(result.errors[0].isRetryable).toBe(true);
    });

    it('should retry "fetch failed" errors', async () => {
      let attempts = 0;
      const operation = vi.fn().mockImplementation(async () => {
        attempts++;
        if (attempts === 1) {
          throw new Error('fetch failed');
        }
        return { data: 'success' };
      });

      const result = await retryMiddleware.executeWithRetry(operation, 'fetchFailed');

      expect(result.attemptCount).toBe(2);
      expect(result.errors[0].errorType).toBe('network');
      expect(result.errors[0].isRetryable).toBe(true);
    });
  });

  describe('HTTP Status Code Scenarios', () => {
    it('should retry HTTP 408 (Request Timeout)', async () => {
      let attempts = 0;
      const operation = vi.fn().mockImplementation(async () => {
        attempts++;
        if (attempts === 1) {
          const error: any = new Error('Request Timeout');
          error.status = 408;
          throw error;
        }
        return { data: 'success' };
      });

      const result = await retryMiddleware.executeWithRetry(operation, 'http408');

      expect(result.attemptCount).toBe(2);
      expect(result.errors[0].statusCode).toBe(408);
      expect(result.errors[0].isRetryable).toBe(true);
    });

    it('should retry HTTP 429 (Too Many Requests)', async () => {
      let attempts = 0;
      const operation = vi.fn().mockImplementation(async () => {
        attempts++;
        if (attempts < 3) {
          const error: any = new Error('Too Many Requests');
          error.status = 429;
          throw error;
        }
        return { data: 'success' };
      });

      const result = await retryMiddleware.executeWithRetry(operation, 'http429');

      expect(result.attemptCount).toBe(3);
      expect(result.errors[0].statusCode).toBe(429);
      expect(result.errors[0].isRetryable).toBe(true);
    });

    it('should retry HTTP 500 (Internal Server Error)', async () => {
      let attempts = 0;
      const operation = vi.fn().mockImplementation(async () => {
        attempts++;
        if (attempts === 1) {
          const error: any = new Error('Internal Server Error');
          error.statusCode = 500; // Test statusCode as well
          throw error;
        }
        return { data: 'success' };
      });

      const result = await retryMiddleware.executeWithRetry(operation, 'http500');

      expect(result.attemptCount).toBe(2);
      expect(result.errors[0].statusCode).toBe(500);
      expect(result.errors[0].isRetryable).toBe(true);
    });

    it('should retry HTTP 502 (Bad Gateway)', async () => {
      let attempts = 0;
      const operation = vi.fn().mockImplementation(async () => {
        attempts++;
        if (attempts === 1) {
          const error: any = new Error('Bad Gateway');
          error.status = 502;
          throw error;
        }
        return { data: 'success' };
      });

      const result = await retryMiddleware.executeWithRetry(operation, 'http502');

      expect(result.attemptCount).toBe(2);
      expect(result.errors[0].statusCode).toBe(502);
      expect(result.errors[0].isRetryable).toBe(true);
    });

    it('should retry HTTP 503 (Service Unavailable)', async () => {
      let attempts = 0;
      const operation = vi.fn().mockImplementation(async () => {
        attempts++;
        if (attempts === 1) {
          const error: any = new Error('Service Unavailable');
          error.status = 503;
          throw error;
        }
        return { data: 'success' };
      });

      const result = await retryMiddleware.executeWithRetry(operation, 'http503');

      expect(result.attemptCount).toBe(2);
      expect(result.errors[0].statusCode).toBe(503);
      expect(result.errors[0].isRetryable).toBe(true);
    });

    it('should retry HTTP 504 (Gateway Timeout)', async () => {
      let attempts = 0;
      const operation = vi.fn().mockImplementation(async () => {
        attempts++;
        if (attempts === 1) {
          const error: any = new Error('Gateway Timeout');
          error.status = 504;
          throw error;
        }
        return { data: 'success' };
      });

      const result = await retryMiddleware.executeWithRetry(operation, 'http504');

      expect(result.attemptCount).toBe(2);
      expect(result.errors[0].statusCode).toBe(504);
      expect(result.errors[0].isRetryable).toBe(true);
    });

    it('should NOT retry HTTP 400 (Bad Request)', async () => {
      const operation = vi.fn().mockImplementation(async () => {
        const error: any = new Error('Bad Request');
        error.status = 400;
        throw error;
      });

      await expect(
        retryMiddleware.executeWithRetry(operation, 'http400')
      ).rejects.toThrow('Bad Request');

      expect(operation).toHaveBeenCalledTimes(1); // No retry
    });

    it('should NOT retry HTTP 401 (Unauthorized)', async () => {
      const operation = vi.fn().mockImplementation(async () => {
        const error: any = new Error('Unauthorized');
        error.status = 401;
        throw error;
      });

      await expect(
        retryMiddleware.executeWithRetry(operation, 'http401')
      ).rejects.toThrow('Unauthorized');

      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should NOT retry HTTP 403 (Forbidden)', async () => {
      const operation = vi.fn().mockImplementation(async () => {
        const error: any = new Error('Forbidden');
        error.status = 403;
        throw error;
      });

      await expect(
        retryMiddleware.executeWithRetry(operation, 'http403')
      ).rejects.toThrow('Forbidden');

      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should NOT retry HTTP 404 (Not Found)', async () => {
      const operation = vi.fn().mockImplementation(async () => {
        const error: any = new Error('Not Found');
        error.status = 404;
        throw error;
      });

      await expect(
        retryMiddleware.executeWithRetry(operation, 'http404')
      ).rejects.toThrow('Not Found');

      expect(operation).toHaveBeenCalledTimes(1);
    });
  });

  describe('File System Error Scenarios', () => {
    it('should retry EBUSY errors (temporary FS contention)', async () => {
      let attempts = 0;
      const operation = vi.fn().mockImplementation(async () => {
        attempts++;
        if (attempts === 1) {
          throw new Error('EBUSY: resource busy');
        }
        return { data: 'success' };
      });

      const result = await retryMiddleware.executeWithRetry(operation, 'fsbusy');

      expect(result.attemptCount).toBe(2);
      expect(result.errors[0].isRetryable).toBe(true);
    });

    it('should retry EAGAIN errors (resource temporarily unavailable)', async () => {
      let attempts = 0;
      const operation = vi.fn().mockImplementation(async () => {
        attempts++;
        if (attempts === 1) {
          throw new Error('EAGAIN: try again');
        }
        return { data: 'success' };
      });

      const result = await retryMiddleware.executeWithRetry(operation, 'fsagain');

      expect(result.attemptCount).toBe(2);
      expect(result.errors[0].isRetryable).toBe(true);
    });

    it('should NOT retry ENOENT errors (file not found)', async () => {
      const operation = vi.fn().mockImplementation(async () => {
        throw new Error('ENOENT: no such file or directory');
      });

      await expect(
        retryMiddleware.executeWithRetry(operation, 'fsnoent')
      ).rejects.toThrow('ENOENT');

      expect(operation).toHaveBeenCalledTimes(1);
    });
  });

  describe('Permission Error Scenarios', () => {
    it('should NOT retry EACCES errors', async () => {
      const operation = vi.fn().mockImplementation(async () => {
        throw new Error('EACCES: permission denied');
      });

      await expect(
        retryMiddleware.executeWithRetry(operation, 'eacces')
      ).rejects.toThrow('EACCES');

      expect(operation).toHaveBeenCalledTimes(1);

      try {
        await retryMiddleware.executeWithRetry(operation, 'eacces');
      } catch (error: any) {
        expect(error.retryMetadata.lastErrorType).toBe('permission');
        expect(error.retryMetadata.wasRetryable).toBe(false);
      }
    });

    it('should NOT retry EPERM errors', async () => {
      const operation = vi.fn().mockImplementation(async () => {
        throw new Error('EPERM: operation not permitted');
      });

      await expect(
        retryMiddleware.executeWithRetry(operation, 'eperm')
      ).rejects.toThrow('EPERM');

      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should NOT retry "permission denied" errors', async () => {
      const operation = vi.fn().mockImplementation(async () => {
        throw new Error('permission denied');
      });

      await expect(
        retryMiddleware.executeWithRetry(operation, 'permDenied')
      ).rejects.toThrow('permission denied');

      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should NOT retry "forbidden" errors', async () => {
      const operation = vi.fn().mockImplementation(async () => {
        throw new Error('Access forbidden');
      });

      await expect(
        retryMiddleware.executeWithRetry(operation, 'forbidden')
      ).rejects.toThrow('forbidden');

      expect(operation).toHaveBeenCalledTimes(1);
    });
  });

  describe('Validation Error Scenarios', () => {
    it('should NOT retry "Invalid" errors', async () => {
      const operation = vi.fn().mockImplementation(async () => {
        throw new Error('Invalid input provided');
      });

      await expect(
        retryMiddleware.executeWithRetry(operation, 'invalid')
      ).rejects.toThrow('Invalid');

      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should NOT retry "validation failed" errors', async () => {
      const operation = vi.fn().mockImplementation(async () => {
        throw new Error('validation failed');
      });

      await expect(
        retryMiddleware.executeWithRetry(operation, 'validation')
      ).rejects.toThrow('validation failed');

      expect(operation).toHaveBeenCalledTimes(1);
    });
  });

  describe('Abort Error Scenarios', () => {
    it('should NOT retry AbortError', async () => {
      const operation = vi.fn().mockImplementation(async () => {
        const error = new Error('Operation was aborted');
        error.name = 'AbortError';
        throw error;
      });

      await expect(
        retryMiddleware.executeWithRetry(operation, 'abort')
      ).rejects.toThrow('aborted');

      expect(operation).toHaveBeenCalledTimes(1);

      try {
        await retryMiddleware.executeWithRetry(operation, 'abort');
      } catch (error: any) {
        expect(error.retryMetadata.lastErrorType).toBe('abort');
        expect(error.retryMetadata.wasRetryable).toBe(false);
      }
    });

    it('should NOT retry errors containing "abort"', async () => {
      const operation = vi.fn().mockImplementation(async () => {
        throw new Error('User aborted the operation');
      });

      await expect(
        retryMiddleware.executeWithRetry(operation, 'userAbort')
      ).rejects.toThrow('abort');

      expect(operation).toHaveBeenCalledTimes(1);
    });
  });

  describe('Mixed Error Type Scenarios', () => {
    it('should retry different transient errors in sequence', async () => {
      let attempts = 0;
      const operation = vi.fn().mockImplementation(async () => {
        attempts++;
        if (attempts === 1) {
          throw new Error('ECONNRESET');
        }
        if (attempts === 2) {
          const error: any = new Error('Service Unavailable');
          error.status = 503;
          throw error;
        }
        if (attempts === 3) {
          throw new Error('ETIMEDOUT');
        }
        return { data: 'success' };
      });

      const result = await retryMiddleware.executeWithRetry(operation, 'mixed');

      expect(result.attemptCount).toBe(4);
      expect(result.errors).toHaveLength(3);
      expect(result.errors[0].errorType).toBe('network');
      expect(result.errors[1].statusCode).toBe(503);
      expect(result.errors[2].errorType).toBe('network');

      // All should be retryable
      result.errors.forEach(error => {
        expect(error.isRetryable).toBe(true);
      });
    });

    it('should stop retrying when encountering non-retryable error', async () => {
      let attempts = 0;
      const operation = vi.fn().mockImplementation(async () => {
        attempts++;
        if (attempts === 1) {
          throw new Error('ECONNRESET'); // Retryable
        }
        if (attempts === 2) {
          throw new Error('EACCES'); // Not retryable - should stop here
        }
        return { data: 'success' }; // Should never reach
      });

      await expect(
        retryMiddleware.executeWithRetry(operation, 'stopOnNonRetryable')
      ).rejects.toThrow('EACCES');

      expect(operation).toHaveBeenCalledTimes(2);
    });

    it('should exhaust retries with all retryable errors', async () => {
      const operation = vi.fn().mockImplementation(async () => {
        throw new Error('ECONNRESET');
      });

      await expect(
        retryMiddleware.executeWithRetry(operation, 'exhaustRetries')
      ).rejects.toThrow('ECONNRESET');

      // maxRetries=3 means 4 total attempts
      expect(operation).toHaveBeenCalledTimes(4);
    });
  });

  describe('Real-World Scenarios', () => {
    it('should handle API rate limiting scenario', async () => {
      let attempts = 0;
      const operation = vi.fn().mockImplementation(async () => {
        attempts++;
        if (attempts < 3) {
          const error: any = new Error('Rate limit exceeded');
          error.status = 429;
          throw error;
        }
        return { data: 'api response', attempts };
      });

      const result = await retryMiddleware.executeWithRetry(operation, 'rateLimit');

      expect(result.attemptCount).toBe(3);
      expect(result.result.data).toBe('api response');
      expect(result.totalDelayMs).toBeGreaterThan(0);
    });

    it('should handle intermittent network failures', async () => {
      let attempts = 0;
      const operation = vi.fn().mockImplementation(async () => {
        attempts++;
        // Simulate random network failures
        if (attempts === 1 || attempts === 3) {
          throw new Error('ETIMEDOUT');
        }
        if (attempts === 2) {
          return { data: 'success on attempt 2' };
        }
        return { data: 'never reached' };
      });

      const result = await retryMiddleware.executeWithRetry(operation, 'intermittent');

      expect(result.attemptCount).toBe(2);
      expect(result.result.data).toBe('success on attempt 2');
      expect(result.errors).toHaveLength(1);
    });

    it('should handle service recovery scenario', async () => {
      let attempts = 0;
      const operation = vi.fn().mockImplementation(async () => {
        attempts++;
        // Simulate service being down then recovering
        if (attempts <= 2) {
          const error: any = new Error('Service Unavailable');
          error.status = 503;
          throw error;
        }
        return { data: 'service recovered', recoveredAfter: attempts };
      });

      const result = await retryMiddleware.executeWithRetry(operation, 'recovery');

      expect(result.attemptCount).toBe(3);
      expect(result.result.data).toBe('service recovered');
      expect(result.errors).toHaveLength(2);
      expect(result.errors.every(e => e.statusCode === 503)).toBe(true);
    });

    it('should handle authentication failure (no retry)', async () => {
      const operation = vi.fn().mockImplementation(async () => {
        const error: any = new Error('Invalid API key');
        error.status = 401;
        throw error;
      });

      await expect(
        retryMiddleware.executeWithRetry(operation, 'authFail')
      ).rejects.toThrow('Invalid API key');

      // Should fail immediately without retries
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should handle file system contention resolution', async () => {
      let attempts = 0;
      const operation = vi.fn().mockImplementation(async () => {
        attempts++;
        if (attempts === 1) {
          throw new Error('EBUSY: resource busy or locked');
        }
        return { data: 'file written successfully' };
      });

      const result = await retryMiddleware.executeWithRetry(operation, 'fsContention');

      expect(result.attemptCount).toBe(2);
      expect(result.result.data).toBe('file written successfully');
    });
  });

  describe('Error Metadata Propagation', () => {
    it('should provide complete error classification in retry metadata', async () => {
      let attempts = 0;
      const operation = vi.fn().mockImplementation(async () => {
        attempts++;
        if (attempts < 2) {
          const error: any = new Error('ETIMEDOUT');
          error.code = 'ETIMEDOUT';
          throw error;
        }
        return { data: 'success' };
      });

      const result = await retryMiddleware.executeWithRetry(operation, 'metadata');

      expect(result.errors[0]).toMatchObject({
        isRetryable: true,
        errorType: 'network',
        message: 'ETIMEDOUT',
        metadata: expect.objectContaining({
          errorName: expect.any(String),
        }),
      });
    });

    it('should accumulate all error classifications', async () => {
      let attempts = 0;
      const operation = vi.fn().mockImplementation(async () => {
        attempts++;
        if (attempts === 1) throw new Error('ECONNRESET');
        if (attempts === 2) {
          const error: any = new Error('Too Many Requests');
          error.status = 429;
          throw error;
        }
        if (attempts === 3) throw new Error('ETIMEDOUT');
        return { data: 'success' };
      });

      const result = await retryMiddleware.executeWithRetry(operation, 'accumulate');

      expect(result.errors).toHaveLength(3);
      expect(result.errors[0].message).toContain('ECONNRESET');
      expect(result.errors[1].statusCode).toBe(429);
      expect(result.errors[2].message).toContain('ETIMEDOUT');
    });
  });
});
