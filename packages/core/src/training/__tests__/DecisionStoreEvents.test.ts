/**
 * DecisionStore EVENT rows — steering/guard observability records
 * (docs/HARNESS_IMPROVEMENT_BACKLOG.md item 3).
 *
 * TB2 finding (micro-suite defect #4): injected steering signals mutate the
 * in-memory tool_result AFTER historyStore persisted it, so the durable
 * session lacks the reminders the model saw. Event rows in the decision
 * store are the harvest-side record of that steering. The invariant under
 * test: event rows are APPENDED to the same JSONL but are INVISIBLE to every
 * prior-lookup path — they must never pollute priors.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import { tmpdir } from 'os';
import { DecisionStore } from '../DecisionStore.js';

let dir: string;
let store: DecisionStore;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(tmpdir(), 'decision-events-'));
  store = new DecisionStore(path.join(dir, 'decisions.jsonl'));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('DecisionStore.recordEvent', () => {
  it('appends a kind-tagged row readable via readEvents', async () => {
    await store.recordEvent({
      sessionId: 's1',
      kind: 'loop_escalation',
      toolName: 'Bash',
      detail: { rung: 'diversify', approachHash: 'abc123', family: 'exit-nonzero' },
    });
    const events = await store.readEvents();
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('loop_escalation');
    expect(events[0].toolName).toBe('Bash');
    expect(events[0].detail).toMatchObject({ rung: 'diversify' });
  });

  it('readEvents filters by kind', async () => {
    await store.recordEvent({ sessionId: 's1', kind: 'steering_injected', detail: { kinds: ['budget'] } });
    await store.recordEvent({ sessionId: 's1', kind: 'inaction_nudge' });
    await store.recordEvent({ sessionId: 's1', kind: 'inaction_nudge', detail: { resolved: 'acted' } });
    expect(await store.readEvents('inaction_nudge')).toHaveLength(2);
    expect(await store.readEvents('steering_injected')).toHaveLength(1);
    expect(await store.readEvents()).toHaveLength(3);
  });

  it('event rows NEVER appear in lookup/recent/stats for the same tool', async () => {
    // A real decision and an event row for the same tool.
    await store.record({ sessionId: 's1', toolName: 'Bash', input: { command: 'ls' }, success: true });
    await store.recordEvent({ sessionId: 's1', kind: 'loop_escalation', toolName: 'Bash', detail: { rung: 'break' } });

    const { stableInputHash } = await import('../DecisionStore.js');
    const hash = stableInputHash({ command: 'ls' });
    const hits = await store.lookup('Bash', hash);
    expect(hits).toHaveLength(1);
    expect(hits[0].kind).toBeUndefined();

    const stats = await store.stats('Bash', hash);
    expect(stats.total).toBe(1);
    expect(stats.successes).toBe(1);
  });

  it('event rows never feed familyFailures (the family lens)', async () => {
    await store.record({
      sessionId: 's1', toolName: 'Bash', input: { command: 'make' },
      success: false, errorSnippet: 'Command failed with exit code 2',
    });
    await store.recordEvent({
      sessionId: 's1', kind: 'loop_escalation', toolName: 'Bash',
      detail: { family: 'exit-nonzero' },
    });
    // Whatever family the real failure classifies to, the count must be
    // derived from decision rows only — the event row adds nothing.
    const { classifyErrorFamily } = await import('../errorFamily.js');
    const family = classifyErrorFamily('Command failed with exit code 2');
    const ff = await store.familyFailures('Bash', family);
    expect(ff.count).toBe(1);
  });

  it('decision rows and event rows coexist in the same file', async () => {
    await store.record({ sessionId: 's1', toolName: 'Edit', input: { f: 1 }, success: true });
    await store.recordEvent({ sessionId: 's1', kind: 'endturn_gate_fallback', detail: { nudges: 2, reason: 'missing-EndTurn' } });
    const raw = await fs.readFile(path.join(dir, 'decisions.jsonl'), 'utf-8');
    const lines = raw.trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[1]).kind).toBe('endturn_gate_fallback');
  });

  it('readEvents ignores decision rows and survives torn lines', async () => {
    await store.record({ sessionId: 's1', toolName: 'Bash', input: {}, success: true });
    await fs.appendFile(path.join(dir, 'decisions.jsonl'), '{"torn\n', 'utf-8');
    await store.recordEvent({ sessionId: 's1', kind: 'steering_injected' });
    const events = await store.readEvents();
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('steering_injected');
  });
});
