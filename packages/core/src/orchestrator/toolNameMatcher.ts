/**
 * Suggest the most-likely correct tool name when the model calls an unknown
 * one — used by the orchestrator's "Unknown tool" error path to nudge the
 * model toward self-correction instead of stalling on the bare error.
 *
 * Strategy: case-insensitive Levenshtein distance, ranked ascending, with a
 * sanity cap that filters out candidates whose distance exceeds half the
 * input length (otherwise "Bash" would suggest "WebSearch" — too far off to
 * be a useful nudge).
 */

/**
 * Compute the Levenshtein edit distance between two strings.
 * Standard 2-row dynamic programming — O(m * n) time, O(min(m, n)) space.
 */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  // Make `a` the shorter to minimize space.
  if (a.length > b.length) [a, b] = [b, a];

  let prev = new Array(a.length + 1);
  let curr = new Array(a.length + 1);
  for (let i = 0; i <= a.length; i++) prev[i] = i;

  for (let j = 1; j <= b.length; j++) {
    curr[0] = j;
    for (let i = 1; i <= a.length; i++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[i] = Math.min(
        curr[i - 1] + 1,        // insertion
        prev[i] + 1,            // deletion
        prev[i - 1] + cost,     // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[a.length];
}

/**
 * Return the top-N closest tool names to `query`, sorted by ascending
 * distance. Empty result if no candidate is close enough to be a useful
 * suggestion.
 *
 * "Close enough" = edit distance ≤ max(2, floor(query.length / 2)). This
 * keeps short typos like "Gorp"→"Grep" (distance 1) suggested while
 * avoiding "Bash"→"WebSearch" (distance 8 vs query length 4).
 */
export function closestToolMatches(
  query: string,
  candidates: string[],
  limit: number,
): string[] {
  if (!query || candidates.length === 0 || limit <= 0) return [];

  const qLower = query.toLowerCase();
  const maxDistance = Math.max(2, Math.floor(query.length / 2));

  const scored = candidates
    .map((name) => {
      const nLower = name.toLowerCase();
      const distance = levenshtein(qLower, nLower);
      // Prefix/substring nudges past the distance cap: a model writing
      // "Todo" should still see "TodoList"/"TodoCreate" as suggestions
      // even though their Levenshtein distance exceeds half the query.
      const isPrefix = nLower.startsWith(qLower) || qLower.startsWith(nLower);
      return { name, distance, isPrefix };
    })
    .filter((s) => s.distance <= maxDistance || s.isPrefix)
    .sort((a, b) => a.distance - b.distance || a.name.localeCompare(b.name));

  return scored.slice(0, limit).map((s) => s.name);
}
