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
  const v = (env.CORTEX_ENDTURN_REQUIREMENTS ?? '').trim().toLowerCase();
  return v === 'true' || v === 'strict';
}

/** CORTEX_ENDTURN_REQUIREMENTS=strict (2026-09-02, "attestation backed by a run"): Stage-4 additionally
 *  requires (a) each `requirement` to be a verbatim clause of the task statement and (b) each
 *  `verified_how` to be grounded in an EXECUTED check's output this turn. Motivation: four pro fails
 *  (cancel-async-tasks, dna-assembly, dna-insert, pytorch-model-cli) were 85-95% complete with TRUE
 *  attestations that verified against the model's own tests, not the task's exact constraints — the
 *  gate accepted a wrong artifact three times in one week. */
export function resolveEndTurnRequirementsStrict(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return (env.CORTEX_ENDTURN_REQUIREMENTS ?? '').trim().toLowerCase() === 'strict';
}

const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, ' ').trim();
/** Is `needle` (≥ minLen chars) a verbatim substring of `hay`, whitespace/case-insensitively? */
function verbatimIn(needle: string, hay: string, minLen: number): boolean {
  const n = norm(needle); const h = norm(hay);
  if (n.length < minLen) return true; // too short to be a meaningful claim — do not block
  if (h.includes(n)) return true;
  // 4.90.1 (v4 protein-assembly: 11 honest condensations rejected as "paraphrases"): accept a
  // requirement that carries the task's own words even when condensed — any 24-char window of it
  // present verbatim, OR ≥70% of its content tokens (≥4 chars) present in the task text.
  if (windowGrounded(n, h, 24)) return true;
  const toks = n.split(' ').filter((t) => t.length >= 4);
  if (toks.length === 0) return true;
  const hit = toks.filter((t) => h.includes(t)).length;
  return hit / toks.length >= 0.7;
}
/** Does any window of `text` of `win` chars appear in `outputs`? (Stage-2-style grounding.) */
function windowGrounded(text: string, outputs: string, win: number): boolean {
  const t = norm(text); const o = norm(outputs);
  if (t.length <= win) return o.includes(t);
  for (let i = 0; i + win <= t.length; i += Math.max(4, Math.floor(win / 2))) {
    if (o.includes(t.slice(i, i + win))) return true;
  }
  return o.includes(t.slice(t.length - win));
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

// 4.92 (strict-bug audit 2026-09-04): match "UNVERIFIED" AND "UNVERIFIED (reason)" — the honest way to
// admit non-verification. The old bare-word-only regex (`/^\s*unverified\s*$/i`) treated
// `verified_how: "UNVERIFIED (no hidden tests in sandbox)"` as a CLAIM, so strict 4e rejected it as
// "claims, not runs" → an unwinnable loop (seen in merge-diff-arc-agi, custom-memory-heap-crash). `\b`
// after the word accepts a trailing reason/paren/colon while still rejecting `unverifiedX`.
const UNVERIFIED_RE = /^\s*unverified\b/i;

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
  /** STRICT mode (CORTEX_ENDTURN_REQUIREMENTS=strict): verbatim requirements + run-grounded verification. */
  strict?: boolean;
  /** This turn's tool outputs, joined — the grounding corpus for `verified_how` in strict mode. */
  toolOutputs?: string;
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

    // 4e (STRICT) — attestation backed by a run: requirements must be verbatim task clauses and
    // verified_how must be grounded in an executed check's OUTPUT this turn (not a claim).
    // 🔴 4.90.1: guarded on `reqs` — 4.90.0 threw `null.filter` on EndTurn({}) under strict (v4 flash/dna-insert ×4).
    if (input.strict && reqs && reqs.length > 0) {
      const rows = reqs as RequirementRow[];
      const notVerbatim = rows.filter((r) => !verbatimIn(r.requirement, input.userTaskText || '', 12));
      if (notVerbatim.length > 0 && (input.userTaskText || '').trim().length > 0) {
        const names = notVerbatim.slice(0, 3).map((r) => `"${r.requirement.slice(0, 80)}"`).join(', ');
        return {
          ok: false,
          nudge:
            `EndTurn REJECTED (requirements/strict) — ${notVerbatim.length} requirement(s) are paraphrases, not the task's own words: ${names}. ` +
            'Re-read the task statement and copy each requirement VERBATIM (the exact clause, including numbers, ' +
            'file names, formats and thresholds) — paraphrasing is where constraints get lost. Then call EndTurn again.',
        };
      }
      const outputs = input.toolOutputs || '';
      const nout = norm(outputs);
      // 4.92 (D-C, verified 2026-09-04): the 12-char window alone (4.91.0) cannot ground a SHORT
      // command→output claim like `$ ls /app → "run.py"` — the connective scaffold ($ → quotes) breaks
      // every 12-char window even when the command AND its output are both present verbatim in the corpus
      // (reproduced: windowGrounded('$ ls /app -> "run.py"','ls /app\nrun.py',12) === false), producing
      // unwinnable rejection loops (cancel-async-tasks ×3). Mirror verbatimIn's fallback (line ~56): accept
      // when ≥70% of the claim's content tokens (≥4 chars, scaffold stripped) appear in the outputs.
      const howGrounded = (how: string): boolean => {
        if (windowGrounded(how, outputs, 12)) return true;
        const toks = norm(how).replace(/->|→|[$"'>]/g, ' ').split(' ').filter((t) => t.length >= 4);
        if (toks.length === 0) return false;
        return toks.filter((t) => nout.includes(t)).length / toks.length >= 0.7;
      };
      const ungrounded = rows.filter((r) => !UNVERIFIED_RE.test(r.verified_how) && !howGrounded(r.verified_how));
      if (ungrounded.length > 0) {
        const names = ungrounded.slice(0, 3).map((r) => `"${r.requirement.slice(0, 60)}" ⇐ "${r.verified_how.slice(0, 60)}"`).join('; ');
        return {
          ok: false,
          nudge:
            `EndTurn REJECTED (requirements/strict) — ${ungrounded.length} verification(s) are claims, not runs: ${names}. ` +
            '`verified_how` must quote the ACTUAL output of a check you executed THIS turn — paste the real result line, e.g. ' +
            '"$ ./cli_tool weights.json image.png → 2" (a sentence like "ran the tests, they passed" is a claim and will be rejected again). ' +
            'If you did not run it, run it now — against the task\'s stated constraint, not your own test — or mark it "UNVERIFIED". Then call EndTurn again.',
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
