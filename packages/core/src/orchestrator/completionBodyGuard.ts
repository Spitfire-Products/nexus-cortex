/**
 * R152 HB-EMPTY-COMPLETION-RETRY (2026-09-15, tb21-a21 + tb4-flash-v3): during a 27-minute DeepSeek incident (1:30-1:57 AM PT) the
 * chat/completions endpoint answered with a body that parsed to `null`; the OpenAI SDK handed it back as the response, the translation
 * layer dereferenced `resp.choices` and the tool loop ended the turn on the TypeError ("Cannot read properties of null (reading
 * 'choices')") — 30 sessions across three runs, most of them at iteration 1-20, i.e. a lost task each. A body that is not a completion
 * is a transport-class fault: throw an error the ErrorClassificationMiddleware classifies as `network` so the R150 budget ladder retries it.
 */
export class EmptyCompletionBodyError extends Error {
  readonly retryable = true;
  constructor(provider: string, detail: string) {
    super(`Empty completion body from ${provider}: ${detail}`);
    this.name = 'EmptyCompletionBodyError';
  }
}

/** Describe why a body is not a usable completion, or null when it is. */
export function completionBodyProblem(body: unknown): string | null {
  if (body === null || body === undefined) return 'response parsed to null';
  if (typeof body !== 'object') return `response is a ${typeof body}`;
  const b = body as Record<string, unknown>;
  if (b.error && typeof b.error === 'object') return `error object without choices: ${JSON.stringify(b.error).slice(0, 160)}`;
  if (!Array.isArray(b.choices)) return `no choices array (keys: ${Object.keys(b).slice(0, 8).join(',') || 'none'})`;
  if (b.choices.length === 0) return 'empty choices array';
  return null;
}

/** Throw EmptyCompletionBodyError when the body is not a completion; otherwise return it typed. */
export function assertCompletionBody<T>(body: T, provider: string): T {
  const problem = completionBodyProblem(body);
  if (problem) throw new EmptyCompletionBodyError(provider, problem);
  return body;
}
