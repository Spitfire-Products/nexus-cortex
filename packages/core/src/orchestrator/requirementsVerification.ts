/**
 * requirementsVerification — EndTurn Stage 4 (docs/HARNESS_IMPROVEMENT_BACKLOG.md
 * item 1). The as-shipped gate verifies CITATIONS (Stage 2 grounding, Stage 3
 * coordinates) but not TASK REQUIREMENTS: a wrong-artifact finish passes with
 * honest citations and a legitimate empty `verification` ("none asked") —
 * TB2's 2nd-largest failure class (20 wrong-artifact fails, 11 in
 * flash-persist alone). Stage 4 makes the model re-read the task statement
 * and attest each stated requirement.
 *
 * Armed by CORTEX_ENDTURN_REQUIREMENTS=true (off by default; the
 * persist+EndTurn bench cell and server profiles arm it). Pure — the
 * orchestrator supplies all state.
 */

export interface RequirementRow {
  requirement: string;
  satisfied_by: string;
  verified_how: string;
}

export interface RequirementsVerdict {
  ok: boolean;
  /** Rejection text to surface on the EndTurn tool_result (Stage-2 style). */
  nudge?: string;
}

export function resolveEndTurnRequirementsMode(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return (env.CORTEX_ENDTURN_REQUIREMENTS ?? '').trim().toLowerCase() === 'true';
}

/** Conservative imperative/task-shape heuristic: does the user text ask for
 *  work (vs. a question/discussion)? False negatives are acceptable (no
 *  nudge); false positives are the cost to avoid. */
export function isTaskShaped(userText: string): boolean {
  if (!userText || userText.length < 8) return false;
  return /\b(fix|add|implement|create|write|build|make|update|refactor|convert|generate|install|configure|set up|setup|remove|delete|rename|migrate|optimi[sz]e|debug|repair|extract|compress|decompress|parse|train|deploy|run)\b/i.test(
    userText,
  );
}

const UNVERIFIED_RE = /^\s*unverified\s*$/i;

/**
 * Stage 4: verify the `requirements` attestation. Caller gates on
 * resolveEndTurnRequirementsMode() — this function assumes armed mode.
 */
export function verifyRequirements(input: {
  /** Raw `requirements` value from the EndTurn tool input. */
  requirements: unknown;
  /** Raw `verification` value from the EndTurn tool input. */
  verification: unknown;
  /** The turn's real user prompt text (empty string when unknown). */
  userTaskText: string;
  /** Did this turn run Edit/Write/Bash/NotebookEdit? */
  turnUsedMutatingTool: boolean;
}): RequirementsVerdict {
  const reqs = Array.isArray(input.requirements) ? input.requirements : null;
  const verification = Array.isArray(input.verification) ? input.verification : [];

  // 4a — task-shaped turn with no requirements enumerated.
  if ((!reqs || reqs.length === 0) && isTaskShaped(input.userTaskText)) {
    return {
      ok: false,
      nudge:
        'EndTurn REJECTED (requirements) — this turn has a stated task but you enumerated no requirements. ' +
        'Re-read the task statement and list EACH stated requirement in `requirements` ' +
        '[{requirement, satisfied_by, verified_how}]: `satisfied_by` = what in your artifact satisfies it; ' +
        '`verified_how` = the command/observation that proves it, or the literal string "UNVERIFIED". ' +
        'Then call EndTurn again.',
    };
  }

  // 4b — malformed rows.
  if (reqs) {
    const bad = reqs.findIndex(
      (r: unknown) =>
        !r ||
        typeof r !== 'object' ||
        typeof (r as RequirementRow).requirement !== 'string' ||
        typeof (r as RequirementRow).satisfied_by !== 'string' ||
        typeof (r as RequirementRow).verified_how !== 'string',
    );
    if (bad !== -1) {
      return {
        ok: false,
        nudge:
          `EndTurn REJECTED (requirements) — row ${bad + 1} is malformed. Each row must be ` +
          '{requirement, satisfied_by, verified_how} (strings). Use "UNVERIFIED" as verified_how ' +
          'when you did not verify a requirement — do not omit the field. Then call EndTurn again.',
      };
    }

    // 4c — unverified rows must be nudged ONCE toward verification.
    const unverified = (reqs as RequirementRow[]).filter((r) => UNVERIFIED_RE.test(r.verified_how));
    if (unverified.length > 0) {
      const names = unverified
        .slice(0, 3)
        .map((r) => `"${r.requirement.slice(0, 80)}"`)
        .join(', ');
      return {
        ok: false,
        nudge:
          `EndTurn REJECTED (requirements) — ${unverified.length} requirement(s) are UNVERIFIED: ${names}. ` +
          'For each: either RUN the check that proves it (then put the command + observed result in ' +
          '`verified_how`), or move it to `open_items` with a one-line justification and delete the row. ' +
          'Then call EndTurn again.',
      };
    }
  }

  // 4d — mutating turn that ran no checks at all.
  if (input.turnUsedMutatingTool && verification.length === 0) {
    return {
      ok: false,
      nudge:
        'EndTurn REJECTED (verification) — you modified files this turn but `verification` is empty: ' +
        'no build/test/lint/behavior check was run. Run at least one check that exercises what you ' +
        'changed and list it with the real result line, or state in `open_items` why no check is ' +
        'possible. Then call EndTurn again.',
    };
  }

  return { ok: true };
}
