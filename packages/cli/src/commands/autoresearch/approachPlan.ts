/**
 * approachPlan — give each parallel arm a DIFFERENT approach to the same goal
 * (autoresearch hardening B6).
 *
 * Arms that differ only by model tend to converge on the same idea, so a round of N arms
 * explores far less than N directions. Each round, arms take consecutive approaches from
 * a rotating queue: never the same approach for two arms in one round (as long as the
 * width does not exceed the list), and later rounds continue the rotation so every
 * approach gets tried. The Fixer's prompt names its approach; the approach slug becomes
 * the arm's strategy label in the matrix unless --strategy is set.
 *
 * The Fixer is also asked to DECLARE known flaws of its change in a file at the
 * worktree root (FLAWS_FILE); the loop reads and removes it before commit, and an arm
 * that declares flaws is benched but never merged (its attempt is kept for review).
 */

export interface Approach {
  slug: string;
  text: string;
}

/** Generic approaches for improving code against a measured goal. */
export const DEFAULT_APPROACHES: readonly Approach[] = [
  { slug: 'root-cause', text: 'Find the root cause and make the smallest change that fixes it where it originates.' },
  { slug: 'boundary', text: 'Fix it at the boundary: validate, normalize or handle the inputs and edge cases that trigger the failure.' },
  { slug: 'restructure', text: 'Restructure the code path involved so the failure cannot happen; a larger, focused refactor is allowed.' },
  { slug: 'algorithm', text: 'Replace the method this part uses with a better algorithm or data structure.' },
  { slug: 'configuration', text: 'Fix it through configuration, instructions, prompts or defaults rather than control flow.' },
  { slug: 'recovery', text: 'Improve how the failing operation detects errors and recovers from them.' },
];

/** File (at the worktree root) where the Fixer lists known flaws, one per line. */
export const FLAWS_FILE = '.autoresearch-flaws';

/** Parse `--approaches`: entries separated by `|`; an entry may be `slug: text`. */
export function parseApproaches(spec: string): Approach[] {
  return spec.split('|').map((s) => s.trim()).filter(Boolean).map((entry, i) => {
    const m = /^([a-z0-9][a-z0-9-]{0,40}):\s*(.+)$/i.exec(entry);
    return m ? { slug: m[1]!.toLowerCase(), text: m[2]!.trim() } : { slug: `approach-${i + 1}`, text: entry };
  });
}

/** The approaches for round `round` (1-based), one per arm. */
export function approachesForRound(approaches: readonly Approach[], round: number, width: number): Approach[] {
  if (!approaches.length) return [];
  const offset = ((round - 1) * width) % approaches.length;
  return Array.from({ length: width }, (_, i) => approaches[(offset + i) % approaches.length]!);
}

/** The Fixer prompt for one arm: the goal, its approach, and the flaws instruction. */
export function fixerPrompt(goal: string, approach: Approach | undefined, width: number): string {
  const parts = [goal];
  if (approach) {
    parts.push(
      `APPROACH FOR THIS ATTEMPT (${approach.slug}): ${approach.text}` +
      (width > 1 ? ' Other attempts in this round take different approaches; stay with this one.' : ''),
    );
  }
  parts.push(
    `If your change has known flaws or limitations (it only works for some inputs, skips a case, weakens or ` +
    `bypasses a check, or is untested), list them one per line in the file ${FLAWS_FILE} at the root of this ` +
    `checkout. Leave that file out if there are none. It is read and removed before the change is committed; ` +
    `a change with declared flaws is measured but held for review instead of merged.`,
  );
  return parts.join('\n\n');
}
