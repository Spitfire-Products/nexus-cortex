/**
 * grok-build ports (2026-08-01) — retry/classification hardening:
 * 1. Context-length veto: overflow errors are NEVER retryable, even under an
 *    otherwise-retryable status (the one deliberate exception to R13).
 * 2. Raw-fetch status extraction: xAI/Google paths throw bare
 *    `Error("... (429): body")` with no .status — previously never retried.
 * 3. Rate-limit low cap: 429s stop after rateLimitMaxRetries (default 2).
 * 4. classifyApiError capacity patterns extended with cross-provider
 *    overflow phrasings.
 */

import { describe, it, expect, vi } from 'vitest';
import { ErrorClassificationMiddleware } from '../ErrorClassificationMiddleware.js';
import { RetryMiddleware } from '../RetryMiddleware.js';
import { classifyApiError } from '../../orchestrator/apiErrorClassifier.js';

function statusError(status: number, message: string): Error & { status: number } {
  const err = new Error(message) as Error & { status: number };
  err.status = status;
  return err;
}

describe('context-length veto (ErrorClassificationMiddleware)', () => {
  const classifier = new ErrorClassificationMiddleware();

  it.each([
    'This model\'s maximum context length is 128000 tokens',
    'prompt is too long: 210000 tokens > 200000 maximum',
    'context_length_exceeded',
  ])('never retries "%s" even with a retryable status', (message) => {
    expect(classifier.isRetryable(statusError(429, message))).toBe(false);
    expect(classifier.isRetryable(statusError(500, message))).toBe(false);
    expect(classifier.isRetryable(new Error(message))).toBe(false);
  });

  it('does not veto ordinary rate-limit messages (R13 still authoritative)', () => {
    expect(classifier.isRetryable(statusError(429, 'Too Many Requests'))).toBe(true);
  });
});

describe('raw-fetch message status extraction', () => {
  const classifier = new ErrorClassificationMiddleware();

  it('retries raw-fetch 429/5xx errors with "(NNN):" shape and no .status', () => {
    expect(classifier.isRetryable(new Error('XAI Messages API error (429): {"error":"rate limited"}'))).toBe(true);
    expect(classifier.isRetryable(new Error('Google GenerateContent API error (503): upstream connect error'))).toBe(true);
  });

  it('retries the bare + colon raw-fetch shapes (xAI Responses / Gemini) — 2026-08-02', () => {
    // These two throw sites lack the "(NNN):" parens, so they were NOT retried
    // before the extractor was anchored on "API error".
    expect(classifier.isRetryable(new Error('XAI Responses API error 429: slow down'))).toBe(true);
    expect(classifier.isRetryable(new Error('Gemini API error: 503 - upstream unavailable'))).toBe(true);
    expect(classifier.isRetryable(new Error('XAI Responses API error 400: invalid'))).toBe(false);
    expect(classifier.classify(new Error('Gemini API error: 429 - quota')).errorType).toBe('rate_limit');
  });

  it('does not retry raw-fetch 4xx errors', () => {
    expect(classifier.isRetryable(new Error('XAI Messages API error (400): bad request'))).toBe(false);
    expect(classifier.isRetryable(new Error('API error (401): unauthorized'))).toBe(false);
  });

  it('ignores plain numbers without the "(NNN):" marker (false-positive guard)', () => {
    expect(classifier.isRetryable(new Error('Found 429 records matching pattern'))).toBe(false);
    expect(classifier.isRetryable(new Error('processed 500 rows'))).toBe(false);
  });

  it('classifies raw-fetch 429 as rate_limit errorType (feeds the retry cap)', () => {
    const c = classifier.classify(new Error('XAI Messages API error (429): slow down'));
    expect(c.errorType).toBe('rate_limit');
  });
});

describe('rate-limit low cap (RetryMiddleware)', () => {
  // Real timers with sub-millisecond delays — omniclaude's classifier does NOT
  // set a 60s retryAfterMs for 429 (calculateDelay caps at maxDelayMs), so the
  // whole retry ladder finishes in a few ms. This avoids the fake-timer +
  // async-rejection pattern that leaks unhandled rejections and fails CI.
  const classifier = new ErrorClassificationMiddleware();
  const fastOpts = { maxRetries: 3, rateLimitMaxRetries: 2, baseDelayMs: 1, maxDelayMs: 2, jitterFactor: 0 };

  it('caps 429 retries at rateLimitMaxRetries instead of maxRetries', async () => {
    const retry = new RetryMiddleware(classifier, fastOpts);
    const fn = vi.fn().mockRejectedValue(statusError(429, 'Too Many Requests'));
    await expect(retry.executeWithRetry(fn, 'op')).rejects.toThrow('Too Many Requests');
    expect(fn).toHaveBeenCalledTimes(3); // initial + 2, NOT initial + 3
  });

  it('non-rate-limit retryable errors still use the full maxRetries budget', async () => {
    const retry = new RetryMiddleware(classifier, fastOpts);
    const fn = vi.fn().mockRejectedValue(statusError(503, 'Service Unavailable'));
    await expect(retry.executeWithRetry(fn, 'op')).rejects.toThrow('Service Unavailable');
    expect(fn).toHaveBeenCalledTimes(4); // initial + 3
  });

  it('context-length errors are thrown immediately with no retry', async () => {
    const retry = new RetryMiddleware(classifier, fastOpts);
    const fn = vi.fn().mockRejectedValue(statusError(429, 'context_length_exceeded'));
    await expect(retry.executeWithRetry(fn, 'op')).rejects.toThrow('context_length_exceeded');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('classifyApiError capacity extension', () => {
  it.each([
    'context_length_exceeded',
    'prompt is too long: 210000 tokens',
    'input is too long for requested model',
    'request exceeds the maximum number of tokens allowed',
    'Please reduce the length of the messages',
  ])('classifies "%s" as capacity', (message) => {
    expect(classifyApiError(message)).toBe('capacity');
  });

  it('keeps the pinned false-positive guard intact', () => {
    expect(classifyApiError('Found 400 records matching pattern')).toBe('recoverable');
  });
});
