/**
 * R29b: escalating, imperative tool-budget brake.
 *
 * Replaces the old ratio-of-maxIterations soft hint (which fired late and
 * was a skippable "[Tool budget: ...]" bracket weak models ignored). This
 * escalates on the ABSOLUTE tool-call count against a soft budget, with
 * progressively firmer <system-reminder> imperatives — strong enough that a
 * cheaper model actually stops and synthesizes instead of spinning.
 *
 * Returned text is injected into the next tool_result so the model sees it
 * in-context. The HARD stop (force-synthesis) is enforced separately in the
 * orchestrator loop; this is the in-band nudge that precedes it.
 */
export function computeToolBudgetSignal(
  toolCallCount: number,
  softBudget: number,
  progressStalled = false,
): string | null {
  if (!Number.isFinite(softBudget) || softBudget <= 0) return null;

  if (toolCallCount >= Math.ceil(softBudget * 1.5)) {
    // At 1.5x the firmness depends on PROGRESS, not raw count. Telling a model
    // that is still advancing (new files/edits each call) to "STOP, do not call
    // any more tools" is the same overreach as a flat hard cap — it severs real
    // long-running work. Only command a hard STOP when the model is cycling.
    if (progressStalled) {
      return (
        `<system-reminder>STOP gathering. You have made ${toolCallCount} tool calls and are ` +
        `re-running searches you already ran — well past the point of diminishing returns. ` +
        `Do not call any more tools. Synthesize your final answer NOW from what you already ` +
        `have; if something is genuinely missing, state the assumption and answer anyway.</system-reminder>`
      );
    }
    return (
      `<system-reminder>You have made ${toolCallCount} tool calls — well past the typical ` +
      `budget. If you are still making genuine progress, finish the current thread and ` +
      `synthesize as soon as you can; do NOT open new lines of investigation. Prefer ` +
      `answering now with a stated assumption over continuing to explore.</system-reminder>`
    );
  }
  if (toolCallCount >= softBudget) {
    return (
      `<system-reminder>You have made ${toolCallCount} tool calls — you very ` +
      `likely have enough. Provide your final answer now unless one specific ` +
      `missing fact blocks you (if so, make that the only next call).</system-reminder>`
    );
  }
  return null;
}

/**
 * Progress gate for the R29b HARD tool-budget cap (force-synthesis).
 *
 * A flat call-count cap cannot distinguish a model thrashing on a small task
 * from one doing genuine long-running work (migration, audit, broad refactor) —
 * a raw threshold kills the second to stop the first, which is unacceptable for
 * a harness meant to do real work. This returns true only when the model is
 * CYCLING: of its most recent calls, a majority re-issue a (tool, exact-input)
 * signature it already used this turn. The orchestrator gates the force-stop on
 * this, so the backstop fires on non-progress, not on volume; diverse, advancing
 * work runs to MAX_TOOL_ITERATIONS (the absolute ceiling) untouched.
 *
 * Signatures are exact (caller passes a JSON-stringified input hash), so this
 * catches literal re-issuing/cycling. Near-duplicate searches (reordered grep
 * alternations) are handled separately by anti-repeat-search prompt guidance
 * and inline loop detection.
 *
 * @param calls         per-call signatures in issue order ({name, inputHash})
 * @param window        how many most-recent calls to judge (default 8)
 * @param repeatFraction fraction of the window that must be repeats to count as
 *                       stalled (default 0.5)
 */
export function isToolProgressStalled(
  calls: Array<{ name: string; inputHash: string }>,
  window = 8,
  repeatFraction = 0.5,
): boolean {
  if (calls.length < window) return false; // too early to judge — assume progress
  const recent = calls.slice(-window);
  const priorSigs = new Set(calls.slice(0, -window).map(c => `${c.name}|${c.inputHash}`));
  const seen = new Set<string>();
  let repeats = 0;
  for (const c of recent) {
    const sig = `${c.name}|${c.inputHash}`;
    if (priorSigs.has(sig) || seen.has(sig)) repeats++;
    seen.add(sig);
  }
  return repeats / recent.length >= repeatFraction; // mostly re-issuing known calls → stalled
}
