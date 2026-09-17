/**
 * turnContractValidator — HB-TURN-CONTRACT-ENFORCE (2026-09-17, pilot-12 field read).
 *
 * CORTEX_TURN_CONTRACT=channel (4.115.0) asked, in the prompt, for every response to carry ANALYSIS + PLAN before its tool
 * calls — the Terminus 2 turn shape. As a prompt clause it did not take: 8 of 10 pilot sessions ignored it (6% of tool-calling
 * turns carried both sections). Terminus 2 does not ask; its parser REJECTS a response that lacks the fields and re-prompts,
 * so the model cannot skip them. This module is that structural half: a pure check over the visible assistant text of a
 * tool-calling response, a bounded rejection count per turn, and the re-prompt the rejected tool calls carry back as error
 * results (nothing executes). After CORTEX_TURN_CONTRACT_ENFORCE_MAX rejections in a turn the batch runs as-is (liveness).
 * Finish turns (a batch containing EndTurn) are exempt — the finish path has its own gates and judge.
 */

export interface TurnContractEnforce {
  enforce: boolean;
  /** Rejections per turn before the batch executes anyway (default 2, 0..10). */
  max: number;
}

export function resolveTurnContractEnforce(env: NodeJS.ProcessEnv = process.env): TurnContractEnforce {
  const v = String(env.CORTEX_TURN_CONTRACT_ENFORCE ?? '').trim().toLowerCase();
  const m = parseInt(String(env.CORTEX_TURN_CONTRACT_ENFORCE_MAX ?? '').trim(), 10);
  return {
    enforce: v === 'true' || v === '1' || v === 'on',
    max: Number.isInteger(m) && m >= 0 ? Math.min(10, m) : 2,
  };
}

const ANALYSIS_RE = /(^|\n)\s*(?:[#*_>\-\d.)\s]*)ANALYSIS\b/i;
const PLAN_RE = /(^|\n)\s*(?:[#*_>\-\d.)\s]*)PLAN\b/i;

/** Does the visible text carry the contract's two sections (as headings/labels at a line start)? */
export function checkTurnFormat(visibleText: string): { ok: boolean; missing: Array<'ANALYSIS' | 'PLAN'> } {
  const t = visibleText || '';
  const missing: Array<'ANALYSIS' | 'PLAN'> = [];
  if (!ANALYSIS_RE.test(t)) missing.push('ANALYSIS');
  if (!PLAN_RE.test(t)) missing.push('PLAN');
  return { ok: missing.length === 0, missing };
}

/** The error every tool_use in a rejected batch carries back. Same shape every time so the model learns the rule, not the wording. */
export function buildFormatRejectMessage(missing: string[], rejectIndex: number, max: number, toolNames: string[]): string {
  const names = Array.from(new Set(toolNames)).slice(0, 6).join(', ');
  return (
    `RESPONSE FORMAT REJECTED — the tool call${toolNames.length > 1 ? 's were' : ' was'} NOT executed (${names}). ` +
    `Your response is missing: ${missing.join(' and ')}. Every response must contain, in this order: ` +
    `ANALYSIS — what the latest outputs show, what is done and what is still open; PLAN — the next concrete steps and what each ` +
    `should prove; then the tool call(s) that carry out the first step. Re-issue the response with both sections as labelled lines ` +
    `followed by the same tool call(s). (rejection ${rejectIndex} of ${max}${rejectIndex >= max ? '; the next response executes as-is' : ''})`
  );
}
