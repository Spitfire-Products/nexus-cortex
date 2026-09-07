/**
 * Lazy undici long-timeout dispatcher.
 *
 * 🔴 Why this exists — a top-level `import { Agent } from 'undici'` POISONS the
 * process's global fetch. packages/cli depends on undici v7, but Node 20's
 * BUILT-IN fetch is undici v5. Merely importing undici v7 runs its module init,
 * which sets the process-global dispatcher stored under the cross-version
 * REGISTERED symbol `Symbol.for('undici.globalDispatcher.1')`. Node's built-in
 * (v5) fetch reads that SAME symbol on every call, so it starts routing
 * un-dispatched global fetches through v7's stricter `Request` constructor —
 * which rejects the OpenAI SDK's request with
 * `InvalidArgumentError: invalid content-length header` (UND_ERR_INVALID_ARG).
 *
 * In DIRECT mode the in-process LLM fetch runs on the global fetch, so a
 * module-scope undici import silently killed ALL direct-mode TUI output (the
 * `[Orchestrator] Stream interrupted…` error is swallowed by the REPL's
 * `[`-prefixed debug-log filter → the model "thinks" then prints nothing).
 * Verified 2026-09-06: importing undici v7 alone flips the global-dispatcher
 * symbol; a clean process streams DeepSeek fine, an undici-v7-loaded one throws.
 *
 * The fix: never import undici at module scope. Load it lazily here, ONLY when a
 * server/bench HTTP fetch actually needs the long-timeout dispatcher (those
 * fetches pass it EXPLICITLY, so they stay on undici v7 consistently). Direct
 * mode never calls this → undici v7 is never loaded → the global fetch the
 * in-process orchestrator uses stays clean. Version-agnostic: correct even if a
 * future install bumps undici again.
 *
 * The Agent disables undici's default headersTimeout/bodyTimeout (300s), which
 * otherwise abort slow local-model / think-mode turns as a bare "fetch failed".
 */

// Memoized per timeout value (callers use distinct client/bench timeouts).
const cache = new Map<number, unknown>();

export async function getLongTimeoutDispatcher(timeoutMs: number): Promise<unknown> {
  let agent = cache.get(timeoutMs);
  if (!agent) {
    const { Agent } = await import('undici');
    agent = new Agent({ headersTimeout: timeoutMs, bodyTimeout: timeoutMs });
    cache.set(timeoutMs, agent);
  }
  return agent;
}
