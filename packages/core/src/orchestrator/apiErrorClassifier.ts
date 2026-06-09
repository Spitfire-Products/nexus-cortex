/**
 * Classify API errors so the orchestrator's tool-loop knows when to abort
 * (unrecoverable) vs continue (model-recoverable).
 *
 * Two fatal categories:
 *   - **Capacity**: token / context / rate-limit errors. Retrying with the
 *     same payload makes no sense; the caller should compact or back off.
 *   - **Structural**: 400 `invalid_request_error` shapes — signature-less
 *     thinking blocks, orphaned tool_result, etc. Retrying with the SAME
 *     messages[] produces the same 400 forever. Surfaced by round-12's
 *     drift-audit benchmark, which caught the non-streaming loop burning
 *     50 iterations of the same `thinking.signature: Field required`.
 */

export type ApiErrorCategory = 'capacity' | 'structural' | 'recoverable';

export function classifyApiError(errorMessage: string): ApiErrorCategory {
  const msg = errorMessage || '';

  const isCapacity =
    msg.includes('Request too large') ||
    msg.includes('Rate limit') ||
    msg.includes('429') ||
    msg.includes('context length exceeded') ||
    msg.includes('maximum context') ||
    msg.includes('token limit');
  if (isCapacity) return 'capacity';

  const isStructural =
    msg.startsWith('400 ') &&
    (
      msg.includes('invalid_request_error') ||
      msg.includes('Field required') ||
      msg.includes('messages.') ||
      msg.includes('must be a response to') ||
      msg.includes('must be a preceding')
    );
  if (isStructural) return 'structural';

  return 'recoverable';
}

export function isFatalApiError(errorMessage: string): boolean {
  const c = classifyApiError(errorMessage);
  return c === 'capacity' || c === 'structural';
}
