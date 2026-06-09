import { describe, it, expect } from 'vitest';
import { classifyApiError, isFatalApiError } from '../apiErrorClassifier.js';

describe('classifyApiError', () => {
  it('flags Anthropic thinking.signature 400 as structural', () => {
    const msg = '400 {"type":"error","error":{"type":"invalid_request_error","message":"messages.17.content.0.thinking.signature: Field required"}}';
    expect(classifyApiError(msg)).toBe('structural');
    expect(isFatalApiError(msg)).toBe(true);
  });

  it("flags OpenAI/DeepSeek tool_calls precedence 400 as structural", () => {
    const msg = "400 Messages with role 'tool' must be a response to a preceding message with 'tool_calls'";
    expect(classifyApiError(msg)).toBe('structural');
  });

  it('flags capacity errors separately', () => {
    expect(classifyApiError('Rate limit exceeded for org_abc')).toBe('capacity');
    expect(classifyApiError('429 Too Many Requests')).toBe('capacity');
    expect(classifyApiError('context length exceeded: 200000 tokens')).toBe('capacity');
  });

  it('returns recoverable for transient errors', () => {
    expect(classifyApiError('ECONNRESET — socket hang up')).toBe('recoverable');
    expect(classifyApiError('500 Internal Server Error')).toBe('recoverable');
    expect(classifyApiError('Tool execution failed: ENOENT')).toBe('recoverable');
  });

  it('handles empty / undefined messages safely', () => {
    expect(classifyApiError('')).toBe('recoverable');
    expect(classifyApiError(undefined as any)).toBe('recoverable');
  });

  it('isFatalApiError mirrors capacity OR structural classification', () => {
    expect(isFatalApiError('Rate limit')).toBe(true);
    expect(isFatalApiError('400 invalid_request_error: Field required at messages.5')).toBe(true);
    expect(isFatalApiError('ECONNRESET')).toBe(false);
  });

  it('does NOT mistake an arbitrary message containing "400" elsewhere as structural', () => {
    // Must START with "400 " — a tool error mentioning "400 records found"
    // shouldn't trip the structural classifier.
    expect(classifyApiError('Found 400 records matching pattern')).toBe('recoverable');
  });
});
