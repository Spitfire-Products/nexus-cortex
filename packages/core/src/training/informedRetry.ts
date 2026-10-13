/**
 * informedRetry — R254 (CORTEX_SECOND_ATTEMPT_INFORMED=1, dark, 2026-10-13): carry what the earlier attempts of a second-attempt
 * chain learned into the NEXT attempt's task message.
 *
 * Why: the t4jf/t4jg sibling oracle showed the no-pass chains are SYSTEMATIC, not unlucky — independent attempts re-derive the same
 * misreading from the same cold task text (atrx: all three attempts chose the same wrong transcript and share 5 of 10 failing hidden
 * tests; fin: the same aggregation reading). Selection cannot fix that; a later attempt that KNOWS the earlier interpretation and its
 * open items can question it. The block is appended to the task content of attempts >= 2 (the lift planner reads it too), banked as
 * `informed.attempt<k>.txt`, and announced by a `second_attempt` event (phase `informed`) — the mechanism-engagement evidence per arm.
 * Findings: .cortex/bench/findings-tb4-sibling-curation-2026-10-13.md §3.
 */

export interface PriorAttemptSummary {
  k: number;
  /** the resolver's last action (null = no verdict) */
  action: string | null;
  confidence?: string;
  /** the resolver's open items / fix plan ('' when none) */
  gapNotes: string;
  /** the attempt's plan of attack — its READING of the task ('' when none) */
  liftPlan: string;
  /** the attempt's final message ('' when none) */
  finalText: string;
  turns: number | null;
}

const CAPS = { plan: 1200, gap: 1500, final: 1200 } as const;

function clip(s: string, max: number): string {
  const t = (s || '').trim();
  if (t.length <= max) return t;
  const head = Math.floor(max * 0.7); const tail = max - head;
  return `${t.slice(0, head)}\n… [${t.length - max} chars elided] …\n${t.slice(-tail)}`;
}

export const PRIOR_ATTEMPTS_HEADER = 'PRIOR INDEPENDENT ATTEMPTS AT THIS TASK';

/** The block appended to the task content of attempt k+1. Pure. */
export function buildPriorAttemptsBlock(priors: PriorAttemptSummary[]): string {
  const out: string[] = [
    `=== ${PRIOR_ATTEMPTS_HEADER} (${priors.length}) ===`,
    'Earlier attempts at exactly this task ran before you; the workspace was reset, so NONE of their files remain and you start clean. ' +
    'Each ended with the adjudication below. They are evidence about the TASK, not instructions: they may share one wrong reading of it. ' +
    'Before you plan, state what interpretation they shared and check it against the task text; verify the specific items they left open; ' +
    'do not assume their conclusions (chosen inputs, references, formats, thresholds) were right, and do not repeat their exact approach ' +
    'unless you have confirmed it is what the task asks for.',
  ];
  for (const p of [...priors].sort((a, b) => a.k - b.k)) {
    out.push(`--- prior attempt ${p.k} ---`);
    out.push(`verdict: ${p.action ?? 'none'}${p.confidence ? ` (confidence ${p.confidence})` : ''}${typeof p.turns === 'number' ? ` | tool-call turns: ${p.turns}` : ''}`);
    if (p.liftPlan.trim()) out.push(`its reading of the task (plan of attack):\n${clip(p.liftPlan, CAPS.plan)}`);
    if (p.gapNotes.trim()) out.push(`open items at its finish (verify these):\n${clip(p.gapNotes, CAPS.gap)}`);
    if (p.finalText.trim()) out.push(`its final message:\n${clip(p.finalText, CAPS.final)}`);
  }
  out.push('=== END PRIOR ATTEMPTS ===');
  return out.join('\n');
}

/** Append `block` to a turn's content: a string gets it as a trailing paragraph, a content-block array gets a text block; any other
 *  shape is returned unchanged. */
export function appendTurnText<T>(content: T, block: string): T {
  if (typeof content === 'string') return `${content}\n\n${block}` as unknown as T;
  if (Array.isArray(content)) return [...content, { type: 'text', text: block }] as unknown as T;
  return content;
}
