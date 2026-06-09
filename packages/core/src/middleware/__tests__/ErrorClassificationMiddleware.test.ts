/**
 * ErrorClassificationMiddleware Tests
 *
 * Comprehensive test suite for error classification and retry eligibility determination.
 * Achieves 100% code coverage of the ErrorClassificationMiddleware component.
 *
 * @author Agent 1 - Parallel Refactor Wave 1
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ErrorClassificationMiddleware } from '../ErrorClassificationMiddleware.js';
import type { ErrorClassification } from '../contracts/MiddlewareContracts.js';

describe('ErrorClassificationMiddleware', () => {
  let classifier: ErrorClassificationMiddleware;

  beforeEach(() => {
    classifier = new ErrorClassificationMiddleware();
  });

  describe('Network Errors - Retryable', () => {
    it('should classify ECONNRESET as retryable network error', () => {
      const error = new Error('ECONNRESET');
      const result = classifier.classify(error);

      expect(result.isRetryable).toBe(true);
      expect(result.errorType).toBe('network');
      expect(result.message).toBe('ECONNRESET');
    });

    it('should classify ECONNREFUSED as retryable network error', () => {
      const error = new Error('Connection refused: ECONNREFUSED');
      const result = classifier.classify(error);

      expect(result.isRetryable).toBe(true);
      expect(result.errorType).toBe('network');
    });

    it('should classify ETIMEDOUT as retryable network error', () => {
      const error = new Error('Request timed out: ETIMEDOUT');
      const result = classifier.classify(error);

      expect(result.isRetryable).toBe(true);
      expect(result.errorType).toBe('network');
    });

    it('should classify ENETUNREACH as retryable network error', () => {
      const error = { message: 'Network is unreachable: ENETUNREACH', name: 'NetworkError' };
      const result = classifier.classify(error);

      expect(result.isRetryable).toBe(true);
      expect(result.errorType).toBe('network');
    });

    it('should classify EHOSTUNREACH as retryable network error', () => {
      const error = { message: 'Host unreachable', name: 'EHOSTUNREACH' };
      const result = classifier.classify(error);

      expect(result.isRetryable).toBe(true);
      expect(result.errorType).toBe('network');
    });

    it('should classify socket hang up as retryable network error', () => {
      const error = new Error('socket hang up');
      const result = classifier.classify(error);

      expect(result.isRetryable).toBe(true);
      expect(result.errorType).toBe('network');
    });

    it('should classify network error as retryable', () => {
      const error = new Error('network error occurred');
      const result = classifier.classify(error);

      expect(result.isRetryable).toBe(true);
      expect(result.errorType).toBe('network');
    });

    it('should classify fetch failed as retryable network error', () => {
      const error = new Error('fetch failed');
      const result = classifier.classify(error);

      expect(result.isRetryable).toBe(true);
      expect(result.errorType).toBe('network');
    });

    it('should be case-insensitive for network errors', () => {
      const error1 = new Error('ECONNRESET');
      const error2 = new Error('EConnReset');
      const error3 = new Error('econnreset');

      expect(classifier.isRetryable(error1)).toBe(true);
      expect(classifier.isRetryable(error2)).toBe(true);
      expect(classifier.isRetryable(error3)).toBe(true);
    });
  });

  describe('HTTP Status Codes - Retryable', () => {
    it('should classify 408 Request Timeout as retryable', () => {
      const error = { status: 408, message: 'Request Timeout' };
      const result = classifier.classify(error);

      expect(result.isRetryable).toBe(true);
      expect(result.statusCode).toBe(408);
      expect(result.metadata?.statusCode).toBe(408);
    });

    it('should classify 429 Too Many Requests as retryable', () => {
      const error = { statusCode: 429, message: 'Too Many Requests' };
      const result = classifier.classify(error);

      expect(result.isRetryable).toBe(true);
      expect(result.statusCode).toBe(429);
    });

    it('should classify 500 Internal Server Error as retryable', () => {
      const error = { status: 500, message: 'Internal Server Error' };
      const result = classifier.classify(error);

      expect(result.isRetryable).toBe(true);
      expect(result.statusCode).toBe(500);
    });

    it('should classify 502 Bad Gateway as retryable', () => {
      const error = { status: 502, message: 'Bad Gateway' };
      const result = classifier.classify(error);

      expect(result.isRetryable).toBe(true);
      expect(result.statusCode).toBe(502);
    });

    it('should classify 503 Service Unavailable as retryable', () => {
      const error = { status: 503, message: 'Service Unavailable' };
      const result = classifier.classify(error);

      expect(result.isRetryable).toBe(true);
      expect(result.statusCode).toBe(503);
    });

    it('should classify 504 Gateway Timeout as retryable', () => {
      const error = { status: 504, message: 'Gateway Timeout' };
      const result = classifier.classify(error);

      expect(result.isRetryable).toBe(true);
      expect(result.statusCode).toBe(504);
    });
  });

  describe('File System Errors - Retryable', () => {
    it('should classify EBUSY as retryable', () => {
      const error = new Error('Resource busy: EBUSY');
      const result = classifier.classify(error);

      expect(result.isRetryable).toBe(true);
      expect(result.errorType).toBe('unknown'); // EBUSY is retryable but not categorized
    });

    it('should classify EAGAIN as retryable', () => {
      const error = new Error('Try again: EAGAIN');
      const result = classifier.classify(error);

      expect(result.isRetryable).toBe(true);
    });
  });

  describe('Permission Errors - Non-Retryable', () => {
    it('should classify EACCES as non-retryable permission error', () => {
      const error = new Error('Permission denied: EACCES');
      const result = classifier.classify(error);

      expect(result.isRetryable).toBe(false);
      expect(result.errorType).toBe('permission');
    });

    it('should classify EPERM as non-retryable permission error', () => {
      const error = { message: 'Operation not permitted', name: 'EPERM' };
      const result = classifier.classify(error);

      expect(result.isRetryable).toBe(false);
      expect(result.errorType).toBe('permission');
    });

    it('should classify permission denied as non-retryable', () => {
      const error = new Error('permission denied');
      const result = classifier.classify(error);

      expect(result.isRetryable).toBe(false);
      expect(result.errorType).toBe('permission');
    });

    it('should classify unauthorized as non-retryable permission error', () => {
      const error = new Error('unauthorized access');
      const result = classifier.classify(error);

      expect(result.isRetryable).toBe(false);
      expect(result.errorType).toBe('permission');
    });

    it('should classify forbidden as non-retryable permission error', () => {
      const error = new Error('forbidden resource');
      const result = classifier.classify(error);

      expect(result.isRetryable).toBe(false);
      expect(result.errorType).toBe('permission');
    });
  });

  describe('Validation Errors - Non-Retryable', () => {
    it('should classify ENOENT as non-retryable validation error', () => {
      const error = new Error('File not found: ENOENT');
      const result = classifier.classify(error);

      expect(result.isRetryable).toBe(false);
      expect(result.errorType).toBe('validation');
    });

    it('should classify invalid input as non-retryable', () => {
      const error = new Error('invalid input provided');
      const result = classifier.classify(error);

      expect(result.isRetryable).toBe(false);
      expect(result.errorType).toBe('validation');
    });

    it('should classify validation failed as non-retryable', () => {
      const error = new Error('validation failed');
      const result = classifier.classify(error);

      expect(result.isRetryable).toBe(false);
      expect(result.errorType).toBe('validation');
    });
  });

  describe('Abort Errors - Non-Retryable', () => {
    it('should classify AbortError by name as non-retryable', () => {
      const error = { name: 'AbortError', message: 'The operation was aborted' };
      const result = classifier.classify(error);

      expect(result.isRetryable).toBe(false);
      expect(result.errorType).toBe('abort');
    });

    it('should classify abort in message as non-retryable', () => {
      const error = new Error('Request was aborted');
      const result = classifier.classify(error);

      expect(result.isRetryable).toBe(false);
      expect(result.errorType).toBe('abort');
    });

    it('should be case-insensitive for abort errors', () => {
      const error = { name: 'ABORTERROR', message: 'aborted' };
      const result = classifier.classify(error);

      expect(result.isRetryable).toBe(false);
      expect(result.errorType).toBe('abort');
    });
  });

  describe('Unknown Errors - Non-Retryable by Default', () => {
    it('should classify unknown error as non-retryable', () => {
      const error = new Error('Something went wrong');
      const result = classifier.classify(error);

      expect(result.isRetryable).toBe(false);
      expect(result.errorType).toBe('unknown');
    });

    it('should handle error without message', () => {
      const error = { name: 'UnknownError' };
      const result = classifier.classify(error);

      expect(result.isRetryable).toBe(false);
      expect(result.errorType).toBe('unknown');
      expect(result.message).toBeDefined();
    });

    it('should handle null error', () => {
      const result = classifier.classify(null);

      expect(result.isRetryable).toBe(false);
      expect(result.errorType).toBe('unknown');
    });

    it('should handle undefined error', () => {
      const result = classifier.classify(undefined);

      expect(result.isRetryable).toBe(false);
      expect(result.errorType).toBe('unknown');
    });

    it('should handle string error', () => {
      const result = classifier.classify('An error occurred');

      expect(result.isRetryable).toBe(false);
      expect(result.errorType).toBe('unknown');
      expect(result.message).toBe('An error occurred');
    });

    it('should handle non-retryable HTTP status code', () => {
      const error = { status: 404, message: 'Not Found' };
      const result = classifier.classify(error);

      expect(result.isRetryable).toBe(false);
      expect(result.statusCode).toBe(404);
    });
  });

  describe('getErrorType() Method', () => {
    it('should return network for network errors', () => {
      const error = new Error('ECONNRESET');
      expect(classifier.getErrorType(error)).toBe('network');
    });

    it('should return permission for permission errors', () => {
      const error = new Error('EACCES');
      expect(classifier.getErrorType(error)).toBe('permission');
    });

    it('should return validation for validation errors', () => {
      const error = new Error('invalid request');
      expect(classifier.getErrorType(error)).toBe('validation');
    });

    it('should return abort for abort errors', () => {
      const error = { name: 'AbortError' };
      expect(classifier.getErrorType(error)).toBe('abort');
    });

    it('should return unknown for unclassified errors', () => {
      const error = new Error('random error');
      expect(classifier.getErrorType(error)).toBe('unknown');
    });
  });

  describe('isRetryable() Method', () => {
    it('should return true for network errors', () => {
      const error = new Error('ETIMEDOUT');
      expect(classifier.isRetryable(error)).toBe(true);
    });

    it('should return true for retryable status codes', () => {
      const error = { status: 503 };
      expect(classifier.isRetryable(error)).toBe(true);
    });

    it('should return false for permission errors', () => {
      const error = new Error('EACCES');
      expect(classifier.isRetryable(error)).toBe(false);
    });

    it('should return false for abort errors', () => {
      const error = { name: 'AbortError' };
      expect(classifier.isRetryable(error)).toBe(false);
    });

    it('should return false for unknown errors', () => {
      const error = new Error('unknown error');
      expect(classifier.isRetryable(error)).toBe(false);
    });
  });

  describe('Error Classification Metadata', () => {
    it('should include error name in metadata', () => {
      const error = { name: 'CustomError', message: 'Something failed' };
      const result = classifier.classify(error);

      expect(result.metadata?.errorName).toBe('CustomError');
    });

    it('should include status code in metadata when present', () => {
      const error = { status: 500, message: 'Server Error' };
      const result = classifier.classify(error);

      expect(result.metadata?.statusCode).toBe(500);
    });

    it('should preserve original error message', () => {
      const error = new Error('Original error message');
      const result = classifier.classify(error);

      expect(result.message).toBe('Original error message');
    });
  });

  describe('Edge Cases and Error Priority', () => {
    it('should prioritize abort detection over network patterns', () => {
      // An error with both abort and network patterns should be classified as abort
      const error = new Error('Network request was aborted');
      const result = classifier.classify(error);

      expect(result.isRetryable).toBe(false);
      expect(result.errorType).toBe('abort');
    });

    it('should prioritize permission errors over other patterns', () => {
      const error = new Error('Permission denied: EACCES');
      const result = classifier.classify(error);

      expect(result.isRetryable).toBe(false);
      expect(result.errorType).toBe('permission');
    });

    it('should handle mixed case error patterns', () => {
      const error = { message: 'Connection EtImEdOuT occurred', name: 'NetworkError' };
      const result = classifier.classify(error);

      expect(result.isRetryable).toBe(true);
      expect(result.errorType).toBe('network');
    });

    it('should handle error with both status and statusCode', () => {
      const error = { status: 503, statusCode: 500, message: 'Error' };
      const result = classifier.classify(error);

      expect(result.isRetryable).toBe(true);
      expect(result.statusCode).toBe(503); // status takes precedence
    });

    it('should handle error with statusCode only', () => {
      const error = { statusCode: 429, message: 'Too Many Requests' };
      const result = classifier.classify(error);

      expect(result.isRetryable).toBe(true);
      expect(result.statusCode).toBe(429);
    });
  });

  describe('Integration Tests', () => {
    it('should correctly classify a series of real-world errors', () => {
      const testCases: Array<{ error: any; expectedRetryable: boolean; expectedType: ErrorClassification['errorType'] }> = [
        { error: new Error('ECONNRESET'), expectedRetryable: true, expectedType: 'network' },
        { error: { status: 503 }, expectedRetryable: true, expectedType: 'network' }, // R13: 5xx status authoritative (was 'unknown' — pre-fix bug)
        { error: new Error('EACCES'), expectedRetryable: false, expectedType: 'permission' },
        { error: { name: 'AbortError' }, expectedRetryable: false, expectedType: 'abort' },
        { error: new Error('invalid input'), expectedRetryable: false, expectedType: 'validation' },
        { error: new Error('socket hang up'), expectedRetryable: true, expectedType: 'network' },
        { error: { status: 404 }, expectedRetryable: false, expectedType: 'validation' }, // R13: 4xx status authoritative (was 'unknown' — pre-fix bug)
        { error: new Error('EBUSY'), expectedRetryable: true, expectedType: 'unknown' },
      ];

      testCases.forEach(({ error, expectedRetryable, expectedType }) => {
        const result = classifier.classify(error);
        expect(result.isRetryable).toBe(expectedRetryable);
        expect(result.errorType).toBe(expectedType);
      });
    });
  });
});
