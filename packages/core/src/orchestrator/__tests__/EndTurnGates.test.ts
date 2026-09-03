/**
 * endTurnGates — the shared Stage-2/4/5 evaluation (4.91.0). Table: evidence accumulation, grounding
 * corpus (Write content counts for citations, Bash commands only for strict verified_how), exception
 * safety (a throwing verifier becomes an error result, never an exception), Stage-1 reminder text.
 */
import { describe, it, expect, vi } from 'vitest';
import { TurnEvidence, evaluateEndTurnGates, buildMissingEndTurnReminder } from '../endTurnGates.js';

const deps = (over: Partial<Parameters<typeof evaluateEndTurnGates>[3]> = {}) => ({
  userTaskText: 'Write the answer to /app/move.txt and print it',
  env: { CORTEX_ENDTURN_REQUIREMENTS: 'strict' } as any,
  recordEvent: vi.fn(),
  log: () => {},
  ...over,
});
const endTurn = (input: any) => ({ id: 'et1', name: 'EndTurn', input });
const etResult = () => ({ tool_use_id: 'et1', tool_name: 'EndTurn', content: 'ok', is_error: false as boolean | undefined });

describe('TurnEvidence — accumulation + corpora', () => {
  it('collects outputs, write inputs, commands, web content and the tool-class flags', () => {
    const ev = new TurnEvidence();
    ev.noteToolUses([
      { id: '1', name: 'Bash', input: { command: 'cat /app/move.txt' } },
      { id: '2', name: 'Write', input: { file_path: '/app/x.py', content: 'print("hello world")' } },
      { id: '3', name: 'Read', input: { file_path: '/app/y' } },
      { id: '4', name: 'WebSearch', input: { query: 'neb q5 primers' } },
    ]);
    ev.noteToolResults([
      { tool_use_id: '1', tool_name: 'Bash', content: 'Nf3\n' },
      { tool_use_id: '4', tool_name: 'WebSearch', content: 'results…' },
      { tool_use_id: '9', tool_name: 'Bash', content: 'boom', is_error: true },
    ]);
    expect(ev.usedTools && ev.usedMutatingTool && ev.usedReadishTool).toBe(true);
    expect(ev.commands).toEqual(['cat /app/move.txt']);
    expect(ev.writeInputs).toEqual(['print("hello world")']);
    expect(ev.webQueries).toEqual(['neb q5 primers']);
    expect(ev.outputs).toEqual(['Nf3\n', 'results…']); // error results are not evidence
    expect(ev.citationCorpus()).toContain('print("hello world")');
    expect(ev.citationCorpus()).not.toContain('cat /app/move.txt');
    expect(ev.verificationCorpus()).toContain('cat /app/move.txt');
  });
});

describe('evaluateEndTurnGates', () => {
  it('accepts a citation grounded in text the model WROTE this turn (Write content)', () => {
    const ev = new TurnEvidence();
    ev.noteToolUses([{ id: 'w', name: 'Write', input: { content: 'def solve():\n    return 42' } }]);
    const tr = etResult();
    evaluateEndTurnGates(ev, [tr], [endTurn({
      citations: [{ reference: 'solve returns 42', verbatim_source: 'return 42' }],
      requirements: [{ requirement: 'print it', satisfied_by: 'x', verified_how: 'UNVERIFIED' }],
    })], deps({ env: {} as any }));
    expect(tr.is_error).toBe(false);
    expect(ev.endTurnCalled).toBe(true);
  });
  it('rejects an ungrounded citation with the per-turn re-run guidance', () => {
    const ev = new TurnEvidence();
    ev.noteToolResults([{ tool_use_id: 'b', tool_name: 'Bash', content: 'total 0' }]);
    const tr = etResult();
    evaluateEndTurnGates(ev, [tr], [endTurn({ citations: [{ reference: 'x', verbatim_source: 'line that was never shown' }] })], deps({ env: {} as any }));
    expect(tr.is_error).toBe(true);
    expect(String(tr.content)).toMatch(/RE-RUN the command/);
    expect(ev.endTurnCalled).toBe(false);
  });
  it('strict verified_how may be grounded by a Bash command that RAN this turn', () => {
    const ev = new TurnEvidence();
    ev.noteToolUses([{ id: 'b', name: 'Bash', input: { command: 'cat /app/move.txt' } }]);
    ev.noteToolResults([{ tool_use_id: 'b', tool_name: 'Bash', content: 'Nf3' }]);
    const tr = etResult();
    evaluateEndTurnGates(ev, [tr], [endTurn({
      citations: [],
      requirements: [{ requirement: 'Write the answer to /app/move.txt', satisfied_by: 'wrote it', verified_how: '$ cat /app/move.txt → Nf3' }],
      verification: [{ command: 'cat /app/move.txt', observed_result: 'Nf3' }],
    })], deps());
    expect(tr.is_error).toBe(false);
    expect(ev.endTurnCalled).toBe(true);
  });
  it('NEVER throws: a malformed EndTurn under strict becomes an error result (4.90.0 crash class)', () => {
    const ev = new TurnEvidence();
    const tr = etResult();
    expect(() => evaluateEndTurnGates(ev, [tr], [endTurn(null)], deps())).not.toThrow();
    expect(() => evaluateEndTurnGates(ev, [tr], [endTurn({ citations: 'not-an-array', requirements: 5 })], deps())).not.toThrow();
  });
  it('a verifier exception is converted to an error EndTurn result, not rethrown', () => {
    const ev = new TurnEvidence();
    const tr = etResult();
    // citations getter that throws simulates any internal fault on the gate path
    const evil: any = {}; Object.defineProperty(evil, 'citations', { get() { throw new Error('synthetic gate fault'); } });
    expect(() => evaluateEndTurnGates(ev, [tr], [endTurn(evil)], deps())).not.toThrow();
    expect(tr.is_error).toBe(true);
    expect(String(tr.content)).toMatch(/gate evaluation failed internally/);
  });
  it('effort tail bounces the first EndTurn once and arms elevated effort', () => {
    const ev = new TurnEvidence();
    const arm = vi.fn(); const tr = etResult();
    evaluateEndTurnGates(ev, [tr], [endTurn({ citations: [] })], deps({ env: { CORTEX_EFFORT_TAIL: 'true' } as any, effortTail: { remaining: () => 0, arm } }));
    expect(tr.is_error).toBe(true); expect(arm).toHaveBeenCalledWith(2); expect(ev.effortTailBounced).toBe(true);
    const tr2 = etResult();
    evaluateEndTurnGates(ev, [tr2], [endTurn({ citations: [] })], deps({ env: { CORTEX_EFFORT_TAIL: 'true' } as any, effortTail: { remaining: () => 2, arm } }));
    expect(tr2.is_error).toBe(false);
  });
});

describe('buildMissingEndTurnReminder', () => {
  it('names requirements when the requirements mode is on', () => {
    const ev = new TurnEvidence(); ev.usedMutatingTool = true;
    expect(buildMissingEndTurnReminder(ev, { CORTEX_ENDTURN_REQUIREMENTS: 'strict' } as any)).toMatch(/`requirements`/);
    expect(buildMissingEndTurnReminder(ev, {} as any)).not.toMatch(/Also include `requirements`/);
  });
});
