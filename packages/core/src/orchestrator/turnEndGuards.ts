/**
 * turnEndGuards — item 13b: the SURRENDER guard (pure half).
 *
 * The honest-premature-surrender class (first specimen: train-fasttext,
 * mini-persist-gate, 4.74.1): the model ends the turn with an impeccably
 * honest status report that ENUMERATES the remaining steps — a self-written
 * recovery plan — instead of executing them, with most of its budget unused.
 * Not wrong-artifact (nothing false claimed), not paralysis (plenty of
 * action), not a loop: capitulation-with-a-plan-in-hand.
 *
 * Armed by CORTEX_SURRENDER_NUDGE=true (default off; bench/serving profiles
 * arm it). One nudge per turn, riding the EndTurn gate's continuation
 * plumbing: "you wrote the plan — execute it now."
 */

export function resolveSurrenderNudgeMode(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.CORTEX_SURRENDER_NUDGE ?? '').trim().toLowerCase() === 'true';
}

/** Remaining-work shapes observed in surrender finishes. Deliberately narrow:
 *  a plain succinct answer must never trip this. */
const SURRENDER_RES = [
  /\bwhat remains to (finish|complete|do)\b/i,
  /\bremains? to finish the task\b/i,
  /\bsteps? (remaining|left)\b/i,
  /\bnext steps?:/i,
  /\btask is (incomplete|not (yet )?complete)\b/i,
  /\bi (did|could) not (finish|complete) the task\b/i,
  /\bto finish the task:?\b/i,
  // 4.76.1 — live-specimen phrasings the first set missed (mini-vision rerun):
  /\bwhat remains to complete\b/i,
  /\bhave not (claimed|marked) the task (as )?complete\b/i,
  /\bdeliverable[^.]{0,60}not (yet )?(produced|in place|created)\b/i,
  /\bnot claiming completion\b/i,
];

export function detectSurrenderText(finalText: string): boolean {
  if (!finalText || finalText.length < 80) return false;
  return SURRENDER_RES.some(re => re.test(finalText));
}

export const SURRENDER_REMINDER =
  '<system-reminder>You ended with a list of remaining steps — a plan you wrote yourself. ' +
  'Resources are still available: EXECUTE those steps now instead of concluding. Work through ' +
  'your own plan (adapt it as results come in — e.g. a smaller variant if limits forced the ' +
  'failure). Only conclude when you have attempted the plan or hit a hard limit you can name — ' +
  'and then state that limit explicitly.</system-reminder>';

/** R151 HB-BUDGET-VISIBILITY — open-items finish shapes (tb4-flash-v2 specimens: "Open items:", "did not get to execute it
 *  within budget", "not yet verified", "could not verify", "left untouched"). Broader than the surrender set on purpose: it
 *  only fires when a large fraction of the wall budget remains (the orchestrator gates it), so a plain answer with a caveat
 *  costs at most one continue nudge per turn. */
const OPEN_ITEMS_RES = [
  /\bopen items?\b/i,
  /\bnot (yet )?(verified|validated|executed|run|tested|implemented|finished|exercised)\b/i,
  /\bdid not (get to|have time to|manage to)\b/i,
  /\bcould not (verify|run|execute|complete|finish|test|confirm)\b/i,
  /\bremaining (work|items|issues|gaps|steps)\b/i,
  /\bleft (it |them |that |this |these |those )?(untouched|unresolved|unverified|as[- ]is|for later|undone)\b/i,
  /\bunresolved\b/i,
  /\bwithin (the )?(time |wall |iteration )?budget\b/i,
  /\bran out of (time|budget|iterations)\b/i,
  /\b(unverified|untested) (against|on|with|because)\b/i,
  /\bwould (need|require) (more|further|additional) (time|work|investigation|runs?)\b/i,
  // R157 (2026-09-16, tb4-flash-v3 audit): explicit surrenders the first set missed — "TASK NOT COMPLETE", "I did not
  // prove", "did not fully solve", "honest status report", "fails the task's real success criterion", "unable to".
  /\bnot (fully )?(complete|completed|solved|done|finished)\b/i,
  /\btask is not\b/i,
  /\bdid not (fully )?(complete|solve|finish|prove|fix|implement|apply|achieve|reach|get|find|succeed)\b/i,
  /\bcould not (prove|solve|find|get|make|reproduce|achieve|reach|meet|fix|determine|identify|resolve)\b/i,
  /\bunable to\b/i,
  /\bincomplete\b/i,
  /\bhonest (status|account|bottom line|accounting|summary)\b/i,
  /\bfails? (the|its|this) [^.]{0,40}(criterion|criteria|check|test|requirement|gate|bar|threshold)\b/i,
  /\bnot (a |the )?(working|full|complete) (fix|solution|implementation|proof)\b/i,
  /\bpartial(ly)? (solved|complete|implemented|working|solution)\b/i,
  /\bstill (fails?|failing|missing|broken|wrong|incorrect)\b/i,
];

export function detectOpenItemsText(finalText: string): boolean {
  if (!finalText || finalText.length < 120) return false;
  return OPEN_ITEMS_RES.some((re) => re.test(finalText));
}

export function buildBudgetContinueReminder(remainingMs: number, deadlineMs: number, nudgeIndex: number = 1): string {
  const h = (ms: number) => { const t = Math.max(0, Math.round(ms / 60000)); const hh = Math.floor(t / 60); const mm = t % 60; return hh > 0 ? `${hh}h${String(mm).padStart(2, '0')}m` : `${mm}m`; };
  const pct = deadlineMs > 0 ? Math.round((remainingMs / deadlineMs) * 100) : 0;
  if (nudgeIndex >= 2) {
    // R157: the re-armed nudge — the first one was answered with another open-items finish.
    return (
      `<system-reminder>This is the ${nudgeIndex === 2 ? 'second' : `${nudgeIndex}th`} time you are finishing with open, unverified ` +
      `or failed items while ~${h(remainingMs)} of the ${h(deadlineMs)} wall budget (${pct}%) remains. Stopping now forfeits that ` +
      `time. Pick the single most valuable open item, work it with tools until it is closed or you hit a hard limit you can ` +
      `name, then re-check the task's own acceptance criteria before you finish. Do not summarize again; act.</system-reminder>`
    );
  }
  return (
    `<system-reminder>You are finishing with open, unverified or unexecuted items while ~${h(remainingMs)} of the ` +
    `${h(deadlineMs)} wall budget (${pct}%) remains. That budget is yours to spend: go back and CLOSE those items now — ` +
    `run the task's own checks, execute the steps you listed, verify every claim you flagged as unverified — and only ` +
    `then finish. Do not re-describe the plan; do it. If an item is truly impossible, name the hard limit.</system-reminder>`
  );
}
