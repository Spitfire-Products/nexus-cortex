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
