/**
 * R173b — a typed yes/no gate over TypeSafe AI's Jev (System One decision model). Zero output tokens, ~0.3 s, $0.042/M input.
 * The harness sends a COMPACT state and one or more `noul` questions; the answer is a calibrated probability that changes
 * CONTROL FLOW (a hold / no-hold), never prose for the model. Fail-open: any error → null (the caller keeps its default policy).
 * Key: TYPESAFE_API_KEY (Replit Secrets / the bench .bench.env); endpoint POST https://api.typesafe.ai/v1/systemone.
 * Measured on 262 TB4.0 sessions (jev-assessment-2026-09-18 §7): AUC 0.72, ECE 0.06 — a calibrated gate, not a judge.
 */
export interface JevNoulQuestion { type: 'noul'; instructions: string }
export interface JevGateResult { probabilities: Record<string, number>; latencyMs: number; inputTokens?: number }

export function jevAvailable(env: NodeJS.ProcessEnv = process.env): boolean {
  return !!(env.TYPESAFE_API_KEY ?? '').trim();
}

export async function jevNoul(
  state: Record<string, unknown>,
  questions: Record<string, JevNoulQuestion>,
  opts: { env?: NodeJS.ProcessEnv; timeoutMs?: number; fetchImpl?: typeof fetch; endpoint?: string } = {},
): Promise<JevGateResult | null> {
  const env = opts.env ?? process.env;
  const key = (env.TYPESAFE_API_KEY ?? '').trim();
  if (!key) return null;
  const f = opts.fetchImpl ?? fetch;
  const t0 = Date.now();
  try {
    const resp = await f(opts.endpoint ?? (env.TYPESAFE_API_URL || 'https://api.typesafe.ai/v1/systemone'), {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ state, model: env.TYPESAFE_JEV_MODEL || 'jev-latest', questions }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 8000),
    });
    if (!resp.ok) return null;
    const j = await resp.json() as { answers?: Record<string, { noul?: number; probability?: number }>; usage?: { input_tokens?: number } };
    const probabilities: Record<string, number> = {};
    for (const [name, a] of Object.entries(j.answers ?? {})) {
      const p = typeof a?.noul === 'number' ? a.noul : (typeof a?.probability === 'number' ? a.probability : NaN);
      if (Number.isFinite(p)) probabilities[name] = p;
    }
    if (!Object.keys(probabilities).length) return null;
    return { probabilities, latencyMs: Date.now() - t0, inputTokens: j.usage?.input_tokens };
  } catch {
    return null;
  }
}

/** R173b: the gap-hold question. State = the task, the judge's named items, the budget, the junior's own open items. */
export const GAP_HOLD_QUESTIONS: Record<string, JevNoulQuestion> = {
  fixable_with_more_turns: {
    type: 'noul',
    instructions: 'Given the task, the reviewer\'s named open items and the remaining wall budget, could the agent plausibly close these open items by continuing to work in this container with tools (rather than the items being impossible, out of scope, or already done)?',
  },
};
export function buildGapHoldState(input: { task: string; plan: string; remainingFrac: number | null; remainingMs: number | null; openItems?: unknown; rejects: number }): Record<string, unknown> {
  const items = Array.isArray(input.openItems) ? input.openItems.map((x) => String(x).slice(0, 300)).slice(0, 6) : [];
  return {
    task_instruction: (input.task || '').slice(0, 6000),
    reviewer_open_items: (input.plan || '').slice(0, 3000),
    agent_own_open_items: items,
    remaining_budget_fraction: input.remainingFrac === null ? null : Number(input.remainingFrac.toFixed(3)),
    remaining_budget_minutes: input.remainingMs === null ? null : Math.round(input.remainingMs / 60000),
    prior_vetoes_this_task: input.rejects,
  };
}
