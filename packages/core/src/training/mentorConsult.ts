/**
 * mentorConsult — the AskForAdvice mentor logic (MENTORSHIP_ASK_FOR_ADVICE_SPEC §4–§5).
 *
 * Pure core of the AskForAdvice executor: the graduated-escalation RUNG decision, the
 * mentor system prompts (HINT, never the solution), and the context assembled for the
 * mentor. The actual off-main model call (via HelperModelMiddleware / MENTORSHIP_HELPER_MODEL)
 * is the orchestrator's integration; everything here is deterministic + unit-testable.
 *
 * Ladder (§4):
 *   rung 0 'bounce'      — premature (not thrash-eligible): cheap self-help refuse, no LLM.
 *   rung 1 'reframe'     — first honored consult: mentor's DIRECTED reframe from the trace.
 *   rung 2 'interview'   — consult again after following the reframe + still failing:
 *                          structured diagnostic Q&A (à la AskUserQuestion).
 *   'ratelimited'        — beyond the consult cap: execute the guidance you have.
 */

export type ConsultRung = 'bounce' | 'reframe' | 'interview' | 'ratelimited';

export interface MentorConfig {
  /** Max HONORED consults per task (rate-limit). Default 2 (reframe + interview). */
  maxConsults: number;
}

const DEFAULTS: MentorConfig = { maxConsults: 2 };

export function resolveMentorConfig(env: NodeJS.ProcessEnv = process.env): MentorConfig {
  const n = parseInt((env.CORTEX_MENTOR_MAX_CONSULTS ?? '').trim(), 10);
  return { maxConsults: Number.isInteger(n) && n > 0 ? n : DEFAULTS.maxConsults };
}

/**
 * Which rung a given AskForAdvice call lands on.
 * @param honoredCount  consults already HONORED this task (mentor actually invoked).
 * @param thrashing     is the agent thrash-eligible right now?
 */
export function resolveConsultRung(
  honoredCount: number,
  thrashing: boolean,
  cfg: MentorConfig = resolveMentorConfig(),
): ConsultRung {
  if (honoredCount >= cfg.maxConsults) return 'ratelimited';
  if (!thrashing) return 'bounce';          // premature — send them back to self-work
  return honoredCount === 0 ? 'reframe' : 'interview';
}

/** Rung-0 self-help refuse (no LLM). Constructive: reframe + try a distinct approach. */
export function bounceMessage(attempts: number): string {
  return (
    `You've made ${attempts} attempt${attempts === 1 ? '' : 's'} — reframe the goal and try a ` +
    `different solution before calling AskForAdvice again. Re-read the task, restate what you're ` +
    `actually trying to achieve, and try a genuinely distinct approach first.`
  );
}

/** Beyond the consult cap. */
export function rateLimitedMessage(maxConsults: number): string {
  return (
    `You have already consulted ${maxConsults} time${maxConsults === 1 ? '' : 's'}. ` +
    `Execute the guidance you have — do not consult again for this task.`
  );
}

/** Mentor system prompt for rung 1 (directed reframe). HINT, never the solution. */
export const MENTOR_REFRAME_SYSTEM =
  'You are a senior engineer. A junior agent is stuck on a coding task after several failed ' +
  'attempts. Give a HINT or REDIRECTION — name what they are missing, the wrong assumption ' +
  "they're making, or the direction to try — in 1–3 sentences. NEVER write the solution, the " +
  'code, or the exact commands. They must do the work themselves.';

/** Mentor system prompt for rung 2 (structured diagnostic interview). */
export const MENTOR_INTERVIEW_SYSTEM =
  'You are a senior engineer. The junior followed your earlier hint and is still stuck. Run a ' +
  'SHORT structured diagnosis: state the 2–3 most likely blockers as concrete options and ask ' +
  'which matches what they see, or pose one focused diagnostic question whose answer isolates ' +
  'the issue. Do NOT provide the solution or the code — isolate the blocker so they can fix it.';

export interface MentorContext {
  /** The task statement (last real user text). */
  task: string;
  /** Recent FAILED tool calls: { call, error } — command/input + its error snippet. */
  failed: Array<{ call: string; error: string }>;
  /** The junior's optional question. */
  question?: string;
}

/**
 * Build the user prompt sent to the mentor. Bounded — most-recent failures only.
 */
export function buildMentorUserPrompt(ctx: MentorContext, maxFailed = 6): string {
  const parts: string[] = [];
  parts.push(`TASK:\n${ctx.task.trim().slice(0, 1500)}`);
  const recent = ctx.failed.slice(-maxFailed);
  if (recent.length) {
    parts.push(
      'RECENT FAILED ATTEMPTS (newest last):\n' +
        recent
          .map((f, i) => `${i + 1}. ${f.call.slice(0, 240)}\n   → ${f.error.slice(0, 240)}`)
          .join('\n'),
    );
  }
  if (ctx.question && ctx.question.trim()) {
    parts.push(`THE JUNIOR ASKS:\n${ctx.question.trim().slice(0, 500)}`);
  }
  parts.push('Give your hint (or diagnostic question) now. Be specific. Do not write code.');
  return parts.join('\n\n');
}

/** Templated reframe (ablation-ladder rung 1, no-LLM mentor — operator design 2026-09-01):
 *  a FIXED self-interrogation injected at the same rung the LLM reframe would fire.
 *  The template cannot NAME the wrong assumption (no trace access) — it forces the
 *  model to name it itself (the child/rubber-duck mechanism). Gated
 *  CORTEX_MENTOR_TEMPLATE=true; hint CONTENT is the only difference vs the LLM arm. */
export const TEMPLATE_REFRAME =
  'You have made several similar failed attempts. Stop retrying variants. ' +
  '(1) State, in one sentence, the assumption your current approach depends on. ' +
  '(2) Verify that assumption directly with one check before any further attempt. ' +
  '(3) If it holds, name two structurally different approaches - a different tool, ' +
  'a different entry point - and take one. (4) If an existing implementation of what ' +
  'you need exists (a test file, a library\'s own code path, a reference config), ' +
  'inspect it instead of reconstructing it.';

/** Templated interview (rung 2 analog): generic structured diagnosis. */
export const TEMPLATE_INTERVIEW =
  'You followed the earlier redirection and are still stuck. Run a short structured ' +
  'diagnosis on yourself: (1) Write down the 2-3 most plausible blockers as concrete ' +
  'options. (2) For each, state the single command or file-read that would confirm or ' +
  'eliminate it. (3) Execute those checks FIRST, before any further solution attempt. ' +
  '(4) Then attack only the confirmed blocker.';
