/**
 * Tail-repetition detector (grok-build doom-loop port, 2026-08-01).
 *
 * grok-build's server watches the generation stream and emits
 * `response.doom_loop_check` events with triggers like `tail_repetition:8@thinking`
 * — "the last N units of the thinking channel are repeating." The public xAI
 * API does not expose that event, so this is the CLIENT-SIDE equivalent: a pure
 * detector over the accumulated thinking text, with NO server dependency.
 *
 * It targets the documented failure mode where a reasoning model gets stuck in
 * a thinking-channel attractor (the grok conceptual-grind / thinking-only loop),
 * repeating the same phrase or line block without terminating. Detection lets
 * the caller abort the doomed completion and resample.
 *
 * Pure and allocation-cheap: bounded to the tail window so it can run on every
 * thinking delta. Returns looping=false until the tail genuinely repeats.
 */

export interface TailRepetitionOptions {
  /** Chars of the tail to examine. Default 2400. */
  tailWindow: number;
  /** Shortest repeating cycle (chars) to consider. Default 24 — below this,
   *  natural language coincidentally repeats short fragments. */
  minCycleLen: number;
  /** Longest repeating cycle (chars) to consider. Default 600. */
  maxCycleLen: number;
  /** Consecutive identical cycles required to call it a loop. Default 4. */
  minRepeats: number;
}

export interface TailRepetitionResult {
  looping: boolean;
  /** Label mirroring grok-build's, e.g. "tail_repetition:5@thinking". */
  trigger?: string;
  /** The repeating unit (trimmed to 120 chars for logging). */
  cycle?: string;
  /** Number of consecutive repeats observed. */
  repeats?: number;
}

/**
 * Whether the tail-loop guard is active for a given provider.
 *   XAI_TAIL_LOOP_GUARD=true          -> xAI only (the documented failure mode)
 *   TAIL_LOOP_GUARD_ALL_PROVIDERS=true -> every provider's reasoning channel
 * Both default OFF. The all-provider mode is opt-in because each provider's
 * reasoning has a different natural-repetition profile — canary the
 * false-positive rate per provider before enabling it. When neither is set,
 * this is false and the guarded code path is byte-identical to unguarded.
 */
export function tailLoopGuardEnabled(provider?: string): boolean {
  if (process.env.TAIL_LOOP_GUARD_ALL_PROVIDERS === 'true') return true;
  return process.env.XAI_TAIL_LOOP_GUARD === 'true' && provider === 'xai';
}

const DEFAULTS: TailRepetitionOptions = {
  tailWindow: 2400,
  minCycleLen: 24,
  maxCycleLen: 600,
  minRepeats: 4,
};

/** Collapse runs of whitespace so cosmetic spacing differences don't hide a
 *  loop, but keep it a cheap single pass. */
function normalize(s: string): string {
  return s.replace(/\s+/g, ' ');
}

/**
 * Detect a repeating suffix in `text`. Two complementary checks:
 *  1. char-cycle: does the tail end with the same block repeated >= minRepeats?
 *  2. line-cycle: are the last minRepeats non-empty lines identical?
 * The line check catches loops that repeat whole reasoning lines separated by
 * newlines (the common grok thinking-loop shape); the char check catches
 * newline-free phrase spins.
 */
export function detectTailRepetition(
  text: string,
  opts: Partial<TailRepetitionOptions> = {},
): TailRepetitionResult {
  const o = { ...DEFAULTS, ...opts };
  if (!text) return { looping: false };

  // ── Line-cycle check (cheap, catches the common shape) ──
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length >= o.minRepeats) {
    const last = lines[lines.length - 1]!;
    if (last.length >= 8) {
      let same = 1;
      for (let i = lines.length - 2; i >= 0 && lines[i] === last; i--) same++;
      if (same >= o.minRepeats) {
        return {
          looping: true,
          trigger: `tail_repetition:${same}@thinking`,
          cycle: last.slice(0, 120),
          repeats: same,
        };
      }
    }
  }

  // ── Char-cycle check over the normalized tail ──
  const tail = normalize(text).slice(-o.tailWindow);
  const n = tail.length;
  const maxLen = Math.min(o.maxCycleLen, Math.floor(n / o.minRepeats));
  for (let len = o.minCycleLen; len <= maxLen; len++) {
    const unit = tail.slice(n - len, n);
    if (!unit.trim()) continue;
    let repeats = 1;
    let pos = n - len;
    while (pos - len >= 0 && tail.slice(pos - len, pos) === unit) {
      repeats++;
      pos -= len;
    }
    if (repeats >= o.minRepeats) {
      return {
        looping: true,
        trigger: `tail_repetition:${repeats}@thinking`,
        cycle: unit.trim().slice(0, 120),
        repeats,
      };
    }
  }

  return { looping: false };
}
