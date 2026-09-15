/** R152 HB-EMPTY-COMPLETION-RETRY — pure guard + classifier hookup. */
import { describe, it, expect } from 'vitest';
import { assertCompletionBody, completionBodyProblem, EmptyCompletionBodyError } from '../completionBodyGuard.js';
import { ErrorClassificationMiddleware } from '../../middleware/ErrorClassificationMiddleware.js';

describe('R152 completion body guard', () => {
  it('rejects null, non-object, error-only and choices-less bodies', () => {
    expect(completionBodyProblem(null)).toMatch(/null/);
    expect(completionBodyProblem(undefined)).toMatch(/null/);
    expect(completionBodyProblem('oops')).toMatch(/string/);
    expect(completionBodyProblem({ error: { message: 'overloaded' } })).toMatch(/error object/);
    expect(completionBodyProblem({ id: 'x', object: 'chat.completion' })).toMatch(/no choices/);
    expect(completionBodyProblem({ choices: [] })).toMatch(/empty choices/);
  });
  it('accepts a real completion and returns it', () => {
    const body = { id: 'x', choices: [{ message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop' }], usage: {} };
    expect(completionBodyProblem(body)).toBeNull();
    expect(assertCompletionBody(body, 'deepseek')).toBe(body);
  });
  it('throws an EmptyCompletionBodyError that the classifier treats as a retryable network fault', () => {
    let err: any;
    try { assertCompletionBody(null, 'deepseek'); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(EmptyCompletionBodyError);
    const c = new ErrorClassificationMiddleware().classify(err);
    expect(c.isRetryable).toBe(true);
    expect(c.errorType).toBe('network');
  });
});
