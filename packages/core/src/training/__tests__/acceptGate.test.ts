import { describe, it, expect } from 'vitest';
import { resolveAcceptGateConfig, buildAcceptGateState, decideAcceptGate, decisionNoul, formatAcceptGateHoldMessage, isAcceptClass, ACCEPT_GATE_QUESTIONS, ACCEPT_GATE_FORBIDDEN_KEYS } from '../acceptGate.js';

const fakeFetch = (body: unknown, ok = true, seen: { url?: string; headers?: Record<string, string> } = {}) =>
  (async (url: string, init: any) => { seen.url = url; seen.headers = init?.headers; return { ok, json: async () => body, text: async () => JSON.stringify(body) }; }) as unknown as typeof fetch;

describe('R260 accept gate — config', () => {
  it('defaults off / 0.3 / 2 / jev and parses the levers with bounds', () => {
    expect(resolveAcceptGateConfig({} as any)).toEqual({ mode: 'off', min: 0.3, max: 2, model: 'jev', url: '', timeoutMs: 8000 });
    const c = resolveAcceptGateConfig({ CORTEX_JUDGE_ACCEPT_GATE: 'GATE', CORTEX_JUDGE_ACCEPT_GATE_MIN: '0.35', CORTEX_JUDGE_ACCEPT_GATE_MAX: '9', CORTEX_DECISION_MODEL: 'amos', CORTEX_DECISION_URL: 'http://h:8000/v1/systemone', CORTEX_JUDGE_ACCEPT_GATE_TIMEOUT_MS: '500' } as any);
    expect(c).toEqual({ mode: 'gate', min: 0.35, max: 6, model: 'amos', url: 'http://h:8000/v1/systemone', timeoutMs: 8000 });
    expect(resolveAcceptGateConfig({ CORTEX_JUDGE_ACCEPT_GATE: 'shadow', CORTEX_JUDGE_ACCEPT_GATE_MIN: '7' } as any).min).toBe(0.3);
  });
});

describe('R260 accept gate — state independence', () => {
  it('carries task, final message, last 8 tool outputs (capped), delta, check output, budget — and none of the judge\'s opinion', () => {
    const tools = Array.from({ length: 12 }, (_, i) => ({ tool_name: `t${i}`, content: 'x'.repeat(3000), is_error: i % 2 === 0 }));
    const st = buildAcceptGateState({ task: 'T'.repeat(9000), workspaceDelta: 'D'.repeat(7000), checkOutput: 'C'.repeat(4000), finalMessage: 'F'.repeat(5000), toolResults: tools, remainingFrac: 0.4567 });
    expect((st.task_instruction as string).length).toBe(7000); expect((st.final_message as string).length).toBe(4000);
    expect((st.workspace_delta as string).length).toBe(6000); expect((st.harness_check_output as string).length).toBe(3000);
    const calls = st.recent_tool_calls as Array<{ tool: string; output: string; error: boolean }>;
    expect(calls.length).toBe(8); expect(calls[0].tool).toBe('t4'); expect(calls[0].output.length).toBe(1500); expect(calls[0].error).toBe(true);
    expect(st.remaining_budget_fraction).toBe(0.457);
    for (const k of ACCEPT_GATE_FORBIDDEN_KEYS) expect(k in st).toBe(false);
    expect(JSON.stringify(st)).not.toMatch(/verdict|GAP|MEETS/);
    expect(Object.keys(ACCEPT_GATE_QUESTIONS)).toEqual(['done', 'verified']);
  });
});

describe('R260 accept gate — decision', () => {
  const base = { mode: 'gate' as const, action: 'accept-with-gap', pDone: 0.12, min: 0.3, holdsUsed: 0, max: 2, remainingFrac: 0.6, minRemaining: 0.15 };
  it('shadow never holds; off never holds', () => {
    expect(decideAcceptGate({ ...base, mode: 'shadow' })).toEqual({ held: false, reason: 'shadow' });
    expect(decideAcceptGate({ ...base, mode: 'off' })).toEqual({ held: false, reason: 'off' });
  });
  it('gate holds an accept-class action below the floor, within the cap, above the budget floor', () => {
    expect(decideAcceptGate(base)).toEqual({ held: true, reason: 'below-min' });
    expect(decideAcceptGate({ ...base, action: 'accept' }).held).toBe(true);
    expect(decideAcceptGate({ ...base, action: 'accept-low-confidence' }).held).toBe(true);
    expect(decideAcceptGate({ ...base, action: 'veto' })).toEqual({ held: false, reason: 'not-accept-class' });
    expect(decideAcceptGate({ ...base, pDone: 0.3 })).toEqual({ held: false, reason: 'above-min' });
    expect(decideAcceptGate({ ...base, holdsUsed: 2 })).toEqual({ held: false, reason: 'cap' });
    expect(decideAcceptGate({ ...base, remainingFrac: 0.1 })).toEqual({ held: false, reason: 'below-floor' });
    expect(decideAcceptGate({ ...base, remainingFrac: 0.1, minRemaining: 0 }).held).toBe(true);
  });
  it('fails open when the model gave no probability', () => {
    expect(decideAcceptGate({ ...base, pDone: null })).toEqual({ held: false, reason: 'fail-open' });
    expect(decideAcceptGate({ ...base, pDone: NaN })).toEqual({ held: false, reason: 'fail-open' });
  });
  it('isAcceptClass covers exactly the three accept actions', () => {
    expect(['accept', 'accept-with-gap', 'accept-low-confidence'].every(isAcceptClass)).toBe(true);
    expect(['veto', 'escalate', 'hold'].some(isAcceptClass)).toBe(false);
  });
  it('the hold message names the probability, the floor, the hold index and asks for the task\'s own checks', () => {
    const m = formatAcceptGateHoldMessage({ pDone: 0.123, pVerified: 0.2, min: 0.3, holdIndex: 1, max: 2, remainingFrac: 0.55 });
    expect(m).toMatch(/hold 1\/2/); expect(m).toMatch(/0\.12/); expect(m).toMatch(/0\.30 floor/); expect(m).toMatch(/P\(verified[^)]*\)=0\.20/); expect(m).toMatch(/55% of the budget/); expect(m).toMatch(/own tests/);
    expect(formatAcceptGateHoldMessage({ pDone: 0.1, pVerified: null, min: 0.3, holdIndex: 2, max: 2, remainingFrac: null })).not.toMatch(/verified by/);
  });
});

describe('R260 accept gate — the typed call', () => {
  it('jev: needs the key; reads done/verified', async () => {
    const cfg = resolveAcceptGateConfig({ CORTEX_JUDGE_ACCEPT_GATE: 'shadow' } as any);
    expect(await decisionNoul({ a: 1 }, ACCEPT_GATE_QUESTIONS, cfg, { env: {} as any, fetchImpl: fakeFetch({ answers: { done: { noul: 0.4 } } }) })).toBeNull();
    const r = await decisionNoul({ a: 1 }, ACCEPT_GATE_QUESTIONS, cfg, { env: { TYPESAFE_API_KEY: 'k' } as any, fetchImpl: fakeFetch({ answers: { done: { noul: 0.4 }, verified: { noul: 0.1 } }, usage: { input_tokens: 9 } }) });
    expect(r?.probabilities).toEqual({ done: 0.4, verified: 0.1 }); expect(r?.inputTokens).toBe(9);
  });
  it('amos: posts to CORTEX_DECISION_URL without a key; no url → fail-open null', async () => {
    const seen: { url?: string; headers?: Record<string, string> } = {};
    const cfg = resolveAcceptGateConfig({ CORTEX_JUDGE_ACCEPT_GATE: 'gate', CORTEX_DECISION_MODEL: 'amos', CORTEX_DECISION_URL: 'http://box:8000/v1/systemone' } as any);
    const r = await decisionNoul({ a: 1 }, ACCEPT_GATE_QUESTIONS, cfg, { env: {} as any, fetchImpl: fakeFetch({ answers: { done: { noul: 0.77 } } }, true, seen) });
    expect(r?.probabilities.done).toBe(0.77); expect(seen.url).toBe('http://box:8000/v1/systemone'); expect(seen.headers?.Authorization).toBeUndefined();
    const cfg2 = resolveAcceptGateConfig({ CORTEX_JUDGE_ACCEPT_GATE: 'gate', CORTEX_DECISION_MODEL: 'amos' } as any);
    expect(await decisionNoul({ a: 1 }, ACCEPT_GATE_QUESTIONS, cfg2, { env: {} as any, fetchImpl: fakeFetch({ answers: { done: { noul: 0.77 } } }) })).toBeNull();
  });
});
