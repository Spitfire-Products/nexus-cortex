/**
 * Round 13 (parallel-bench output): status-code-authoritative classification.
 *
 * Cortex: `isRetryable` allowed network-pattern matches to win over status
 * codes, so a 401 auth error with "ECONNRESET" in the body would be
 * retried indefinitely.
 *
 * Opus: `getErrorType` ignored status codes entirely; 429s with "invalid"
 * in the body were classified `'validation'` instead of `'rate_limit'`.
 */

import { describe, it, expect } from 'vitest';
import { ErrorClassificationMiddleware } from '../ErrorClassificationMiddleware.js';

describe('ErrorClassificationMiddleware — Round 13 fixes', () => {
  const mw = new ErrorClassificationMiddleware();

  describe('isRetryable — status code authoritative (cortex finding)', () => {
    it('does NOT retry 401 auth errors even when body contains "ECONNRESET"', () => {
      const err = { status: 401, message: 'auth failed: ECONNRESET in upstream' };
      expect(mw.isRetryable(err)).toBe(false);
    });

    it('does NOT retry 403 even with retry-friendly message', () => {
      const err = { status: 403, message: 'connection reset by peer' };
      expect(mw.isRetryable(err)).toBe(false);
    });

    it('does NOT retry 400 bad-request even with timeout in message', () => {
      const err = { status: 400, message: 'timeout while parsing' };
      expect(mw.isRetryable(err)).toBe(false);
    });

    it('DOES retry 429 rate-limit', () => {
      const err = { status: 429, message: 'rate limit exceeded' };
      expect(mw.isRetryable(err)).toBe(true);
    });

    it('DOES retry 503 service unavailable', () => {
      const err = { status: 503, message: 'service unavailable' };
      expect(mw.isRetryable(err)).toBe(true);
    });

    it('falls back to message-pattern matching when NO status code', () => {
      const err = new Error('ECONNRESET');
      expect(mw.isRetryable(err)).toBe(true);
    });

    it('non-retryable when no status and no retryable pattern', () => {
      const err = new Error('permission denied for user X');
      expect(mw.isRetryable(err)).toBe(false);
    });
  });

  describe('getErrorType — status code authoritative (Opus finding)', () => {
    it('429 classified as rate_limit, NOT validation (despite "invalid" in body)', () => {
      const err = { status: 429, message: 'invalid request quota - rate limited' };
      expect(mw.getErrorType(err)).toBe('rate_limit');
    });

    it('401 classified as permission, NOT validation (despite "invalid" in body)', () => {
      const err = { status: 401, message: 'invalid x-api-key supplied' };
      expect(mw.getErrorType(err)).toBe('permission');
    });

    it('403 classified as permission', () => {
      const err = { status: 403, message: 'forbidden' };
      expect(mw.getErrorType(err)).toBe('permission');
    });

    it('5xx classified as network', () => {
      expect(mw.getErrorType({ status: 500, message: 'oops' })).toBe('network');
      expect(mw.getErrorType({ status: 502, message: 'gateway' })).toBe('network');
      expect(mw.getErrorType({ status: 503, message: 'down' })).toBe('network');
    });

    it('falls back to message-pattern matching when no status', () => {
      expect(mw.getErrorType(new Error('ECONNRESET'))).toBe('network');
      expect(mw.getErrorType(new Error('invalid input'))).toBe('validation');
    });
  });
});
