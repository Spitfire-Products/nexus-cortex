import type { InjectionConditions } from './SystemMessageRegistry.interface.js';

/**
 * R28f hybrid: is this system message turn-varying (must re-evaluate per turn)
 * or turn-0-static (safe to pin in the cached `system` field)?
 *
 * Turn-varying — routed to the moving user turn (after every provider's cache
 * boundary) so it changes as authored without busting the cached prefix:
 *   - `turnNumberModulo` set: genuinely periodic (e.g. a reminder every N turns)
 *   - `turnNumber` set and != 0: fires on a specific LATER turn
 *
 * Static — stays in the cached/pinned system field:
 *   - `turnNumber: 0`: content gated to the first turn purely as a token-saving
 *     heuristic; prompt caching makes keeping it (as cache reads) cheaper than
 *     dropping it, so the R28f pin is the correct, intended behavior here.
 *   - `sessionPhase`: content is static; phase gating is coarse and stable
 *     across the dominant start/ongoing span — pinning it preserves intent.
 *   - everything else (hasTools, modelCapabilities, apiPattern, none).
 */
export function isTurnVaryingSystemMessage(
  conditions: InjectionConditions | undefined
): boolean {
  if (!conditions) return false;
  if (conditions.turnNumberModulo) return true;
  if (conditions.turnNumber !== undefined && conditions.turnNumber !== 0) return true;
  return false;
}
