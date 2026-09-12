import { describe, it, expect } from 'vitest';
import { ContextBudgetManager } from '../ContextBudgetManager';
import { buildCompactionResumeReminder } from '../../orchestrator/compactionResume';

const msg = (role: 'user' | 'assistant', text: string, ts: number) => ({
  uuid: `u${ts}`, type: role, timestamp: new Date(ts).toISOString(),
  message: { role, content: [{ type: 'text', text }] },
} as any);

describe('HB-COMPACTION-RESUME: the resume reminder survives further compactions', () => {
  it('preserve-critical keeps the compaction reminder even when it is the oldest message', () => {
    const cbm = new ContextBudgetManager();
    const reminderText = buildCompactionResumeReminder({ turn: 3, droppedCount: 9, keptCount: 5, tokensBefore: 9000, tokensAfter: 500, resumeText: 'Did A, B.', taskText: 'Build X' });
    const reminder = msg('user', reminderText, 1000);
    const filler: any[] = [reminder];
    for (let i = 0; i < 40; i++) filler.push(msg(i % 2 ? 'user' : 'assistant', 'x'.repeat(2000), 2000 + i * 1000));
    const budget = 3000; // tokens — far smaller than the history
    const kept = cbm.selectMessages(filler, budget, { strategy: 'preserve-critical', preserveToolCalls: true } as any);
    expect(kept).toContain(reminder);
    expect(kept[0]).toBe(reminder); // oldest timestamp → first after the timestamp sort
  });
  it('sliding-window (no critical protection) would drop it — documents why the marker matters', () => {
    const cbm = new ContextBudgetManager();
    const reminder = msg('user', buildCompactionResumeReminder({ turn: 1, droppedCount: 1, keptCount: 1, tokensBefore: 10, tokensAfter: 1, resumeText: '', taskText: 'T' }), 1000);
    const filler: any[] = [reminder];
    for (let i = 0; i < 40; i++) filler.push(msg(i % 2 ? 'user' : 'assistant', 'x'.repeat(2000), 2000 + i * 1000));
    const kept = cbm.selectMessages(filler, 3000, { strategy: 'sliding-window' } as any);
    expect(kept).not.toContain(reminder);
  });
});
