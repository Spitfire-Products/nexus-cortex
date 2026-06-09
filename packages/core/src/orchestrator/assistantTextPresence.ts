/**
 * R29a: does an assistant turn contain at least one non-empty text block?
 *
 * Used to decide whether a synthesis turn must be forced. The tool loop can
 * exit for many reasons (no more tools, MAX_CONSECUTIVE_ERRORS, loop
 * detection, max iterations); if it exits with the final assistant turn being
 * a bare tool_use or thinking-only, there is no deliverable for the user.
 * R18b's inline check covered only the "no tool_use" path; this predicate is
 * shared so the post-loop net catches every exit reason.
 */
export function hasVisibleAssistantText(content: unknown): boolean {
  if (!Array.isArray(content)) return false;
  return content.some(
    (b: any) =>
      b &&
      b.type === 'text' &&
      typeof b.text === 'string' &&
      b.text.trim().length > 0,
  );
}

/**
 * Does the assistant turn contain an unexecuted tool_use block?
 *
 * At the POST-LOOP synthesis point, a trailing tool_use only occurs on an
 * abnormal exit (loop detection / hard cap / max iterations / consecutive
 * errors) — a normal completion returns NO tool_use. So it is a reliable
 * "the model was interrupted mid-action and never delivered an answer" signal,
 * even when a short preamble ("Let me check X...") is also present.
 */
export function hasUnexecutedToolUse(content: unknown): boolean {
  if (!Array.isArray(content)) return false;
  return content.some((b: any) => b && b.type === 'tool_use');
}

/**
 * Should the post-loop R29a synthesis net fire?
 *
 * True when synthesis hasn't already been attempted AND the final turn either
 * has no visible text (bare tool_use / thinking-only) OR ends with an
 * unexecuted tool_use (short-preamble + interrupted mid-action). The second
 * arm fixes the edge case where a preamble counts as "visible text" and the
 * user would otherwise receive the preamble instead of a real answer.
 */
export function shouldForceSynthesis(
  content: unknown,
  alreadyAttempted: boolean,
): boolean {
  if (alreadyAttempted) return false;
  return !hasVisibleAssistantText(content) || hasUnexecutedToolUse(content);
}
