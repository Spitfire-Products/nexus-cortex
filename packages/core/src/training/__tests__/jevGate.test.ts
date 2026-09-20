import { describe, it, expect } from 'vitest';
import { jevAvailable, jevNoul, buildGapHoldState, GAP_HOLD_QUESTIONS } from '../jevGate.js';

const fakeFetch = (body: unknown, ok = true) => (async () => ({ ok, json: async () => body, text: async () => JSON.stringify(body) })) as unknown as typeof fetch;

describe('jevGate — R173b typed gap-hold gate', () => {
  it('is unavailable without a key and returns null (fail-open) instead of throwing', async () => {
    expect(jevAvailable({} as any)).toBe(false);
    expect(await jevNoul({ a: 1 }, GAP_HOLD_QUESTIONS, { env: {} as any, fetchImpl: fakeFetch({}) })).toBeNull();
    expect(await jevNoul({ a: 1 }, GAP_HOLD_QUESTIONS, { env: { TYPESAFE_API_KEY: 'k' } as any, fetchImpl: fakeFetch({}, false) })).toBeNull();
    expect(await jevNoul({ a: 1 }, GAP_HOLD_QUESTIONS, { env: { TYPESAFE_API_KEY: 'k' } as any, fetchImpl: (async () => { throw new Error('net'); }) as any })).toBeNull();
  });
  it('reads noul probabilities (either wire shape) and the usage', async () => {
    const r = await jevNoul({ a: 1 }, GAP_HOLD_QUESTIONS, { env: { TYPESAFE_API_KEY: 'k' } as any, fetchImpl: fakeFetch({ answers: { fixable_with_more_turns: { noul: 0.42 } }, usage: { input_tokens: 123 } }) });
    expect(r?.probabilities.fixable_with_more_turns).toBe(0.42); expect(r?.inputTokens).toBe(123); expect(r?.latencyMs).toBeGreaterThanOrEqual(0);
    const r2 = await jevNoul({ a: 1 }, GAP_HOLD_QUESTIONS, { env: { TYPESAFE_API_KEY: 'k' } as any, fetchImpl: fakeFetch({ answers: { fixable_with_more_turns: { probability: 0.7 } } }) });
    expect(r2?.probabilities.fixable_with_more_turns).toBe(0.7);
    expect(await jevNoul({ a: 1 }, GAP_HOLD_QUESTIONS, { env: { TYPESAFE_API_KEY: 'k' } as any, fetchImpl: fakeFetch({ answers: {} }) })).toBeNull();
  });
  it('builds a compact state (caps, counts, minutes) — no work product, no prose', () => {
    const st = buildGapHoldState({ task: 'T'.repeat(9000), plan: 'P'.repeat(5000), remainingFrac: 0.7345, remainingMs: 5_400_000, openItems: ['a', 'b'], rejects: 1 });
    expect((st.task_instruction as string).length).toBe(6000); expect((st.reviewer_open_items as string).length).toBe(3000);
    expect(st.remaining_budget_fraction).toBe(0.735); expect(st.remaining_budget_minutes).toBe(90); expect(st.agent_own_open_items).toEqual(['a', 'b']); expect(st.prior_vetoes_this_task).toBe(1);
    expect(GAP_HOLD_QUESTIONS.fixable_with_more_turns.type).toBe('noul');
  });
});
