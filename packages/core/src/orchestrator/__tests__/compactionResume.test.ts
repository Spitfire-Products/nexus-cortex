import { describe, it, expect } from 'vitest';
import {
  resolveCompactionResume, extractFirstUserText, pickDropped, buildCompactionResumeReminder,
  isCompactionResumeMessage, COMPACTION_RESUME_MARKER,
} from '../compactionResume';

const user = (text: string) => ({ type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } });
const toolResult = () => ({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x', content: 'ok' }] } });
const assistant = (text: string) => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } });

describe('HB-COMPACTION-RESUME (4.108.0)', () => {
  it('lever defaults ON and only explicit false/0/off disables it', () => {
    expect(resolveCompactionResume({})).toBe(true);
    expect(resolveCompactionResume({ CORTEX_COMPACTION_RESUME: '' })).toBe(true);
    expect(resolveCompactionResume({ CORTEX_COMPACTION_RESUME: 'true' })).toBe(true);
    expect(resolveCompactionResume({ CORTEX_COMPACTION_RESUME: 'false' })).toBe(false);
    expect(resolveCompactionResume({ CORTEX_COMPACTION_RESUME: ' OFF ' })).toBe(false);
    expect(resolveCompactionResume({ CORTEX_COMPACTION_RESUME: '0' })).toBe(false);
  });
  it('extracts the original task: first real user text, skipping reminders and tool-result turns', () => {
    const h = [user('<system-reminder>boot</system-reminder>'), toolResult(), user('Build the widget in /app'), assistant('ok'), user('more')];
    expect(extractFirstUserText(h)).toBe('Build the widget in /app');
    expect(extractFirstUserText([])).toBe('');
    expect(extractFirstUserText([user('x'.repeat(10))], 4)).toContain('truncated');
  });
  it('pickDropped is identity-based and order-preserving', () => {
    const a = user('a'), b = user('b'), c = user('c');
    expect(pickDropped([a, b, c], [c])).toEqual([a, b]);
    expect(pickDropped([a, b, c], [a, b, c])).toEqual([]);
  });
  it('builds a reminder carrying the marker, counts, the memory, and the verbatim task', () => {
    const t = buildCompactionResumeReminder({ turn: 41, droppedCount: 120, keptCount: 5, tokensBefore: 800000, tokensAfter: 40000, resumeText: 'Did X. Left Y.', taskText: 'Build the widget', helperModelId: 'deepseek-flash' });
    expect(t.startsWith(COMPACTION_RESUME_MARKER)).toBe(true);
    expect(t).toContain('turn 41'); expect(t).toContain('120 older'); expect(t).toContain('~760000 tokens');
    expect(t).toContain('Did X. Left Y.'); expect(t).toContain('ORIGINAL TASK (verbatim'); expect(t).toContain('Build the widget');
    expect(t.endsWith('</system-reminder>')).toBe(true);
    expect(isCompactionResumeMessage(user(t))).toBe(true);
    expect(isCompactionResumeMessage(user('hello'))).toBe(false);
  });
  it('degrades honestly when the helper summary is unavailable', () => {
    const t = buildCompactionResumeReminder({ turn: 1, droppedCount: 3, keptCount: 5, tokensBefore: 10, tokensAfter: 5, resumeText: '', taskText: '' });
    expect(t).toContain('RESUME MEMORY: unavailable'); expect(t).toContain('ORIGINAL TASK: not recoverable');
  });
});
