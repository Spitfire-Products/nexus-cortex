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
    max: Number.isInteger(m) && m >= 0 ? Math.min(10000, m) : 2, // 4.119.0: clamp raised 10 → 10000 so a Terminus-faithful never-relent arm is expressible
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

// ---------------------------------------------------------------------------------------------------------------------
// R172 HB-ACTION-PLAN-FIELDS (2026-09-18): the per-step analysis + plan as REQUIRED FIELDS of the action tool call itself —
// Terminus 2's shape (analysis and plan are fields of the same JSON object as the commands), expressed through the one JSON
// contract DeepSeek honors reliably (function calling). A Bash/Edit/Write call without both fields is invalid every time (no
// per-turn cap to relent); the fields are stripped before dispatch (executors and the loop guards see the bare input) and stay
// in the canonical message, so the trajectory records every action's rationale.

export const ACTION_PLAN_TOOLS: ReadonlySet<string> = new Set(['Bash', 'Edit', 'Write']);
export const ACTION_PLAN_FIELD_PROPERTIES = {
  analysis: { type: 'string', description: 'REQUIRED. What the latest tool outputs show: what is done, what is still open, what this call must resolve. One to three sentences.' },
  plan: { type: 'string', description: 'REQUIRED. The next concrete steps and what each should prove, starting with this call. One to three sentences.' },
} as const;

export function resolveActionPlanFields(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = String(env.CORTEX_ACTION_PLAN_FIELDS ?? '').trim().toLowerCase();
  return v === 'true' || v === '1' || v === 'on';
}

/** Which required fields are missing/blank on a call's input (empty array = valid). */
export function planFieldsMissing(input: unknown): Array<'analysis' | 'plan'> {
  const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const missing: Array<'analysis' | 'plan'> = [];
  if (typeof o.analysis !== 'string' || !o.analysis.trim()) missing.push('analysis');
  if (typeof o.plan !== 'string' || !o.plan.trim()) missing.push('plan');
  return missing;
}

/** A copy of the input without the plan fields (what the executor and the loop guards see). */
export function stripPlanFields(input: unknown): unknown {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input;
  const { analysis: _a, plan: _p, ...rest } = input as Record<string, unknown>;
  return rest;
}

export function buildPlanFieldsRejectMessage(toolName: string, missing: string[]): string {
  return (
    `${toolName} call REJECTED — not executed: the required field${missing.length > 1 ? 's' : ''} ${missing.join(' and ')} ` +
    `${missing.length > 1 ? 'are' : 'is'} missing or empty. Every ${toolName} call must carry \`analysis\` (what the latest outputs ` +
    `show, what is done and what is still open) and \`plan\` (the next concrete steps and what each should prove) alongside its ` +
    `other parameters. Re-issue the same call with both fields filled in.`
  );
}
