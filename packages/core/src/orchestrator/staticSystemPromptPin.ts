/**
 * R28f: pin the static system prompt per conversation for xAI cross-turn
 * prompt-cache stability.
 *
 * The static system prompt is assembled from a turn-conditional system-message
 * loader (`SystemMessageLoader.checkConditions` filters on turnNumber /
 * turnNumberModulo / sessionPhase). A large first-turn-only block drops out by
 * the next turn, so the provider `system` field was byte-unstable across turns
 * (measured 68854 -> 12134 chars in one conversation). xAI prefix caching
 * requires a byte-identical `system` across turns; the collapse capped every
 * cross-turn request at the ~128-token floor.
 *
 * This pins the first non-empty computed system prompt per conversation and
 * replays it byte-identically on every later turn, so the first-turn superset
 * persists and the cached prefix survives. The extra tokens on later turns are
 * served as cache reads (~$0.20/M on xAI), which is far cheaper than
 * re-processing an uncached prefix every turn.
 */
export function pinStaticSystemPrompt(
  store: Map<string, string>,
  conversationId: string | undefined,
  computed: string | undefined
): string | undefined {
  // No conversation id (e.g. stateless mode) → cannot key a memo; pass through.
  if (!conversationId) return computed;

  const pinned = store.get(conversationId);
  if (pinned !== undefined) return pinned;

  // Establish the baseline from the first DEFINED, non-empty turn. Until then
  // (undefined/empty), pass through and let a later turn set the baseline.
  if (computed !== undefined && computed.length > 0) {
    store.set(conversationId, computed);
  }
  return computed;
}
