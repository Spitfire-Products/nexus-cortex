import { describe, it, expect } from 'vitest';
import {
  resolveCompactionResume, extractFirstUserText, pickDropped, buildCompactionResumeReminder,
  isCompactionResumeMessage, COMPACTION_RESUME_MARKER, coversAll, buildRollingSeedMessage, upsertMemoryIndex, memoryIndexLine, MEMORY_INDEX_HEADER, scaleEstimateToRequestView, approxCharsOf, anchoredRequestEstimate,
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

import { extractTaskFromReminder, resolveTaskText, resumeMemoryTargetTokens } from '../compactionResume';
describe('HB-COMPACTION-RESUME 4.108.3 fixes (from the live proof)', () => {
  it('recovers the task from a prior reminder once the original message is gone, else from the pinned copy', () => {
    const rem = buildCompactionResumeReminder({ turn: 2, droppedCount: 3, keptCount: 5, tokensBefore: 10, tokensAfter: 5, resumeText: 'mem', taskText: 'Build the widget in /app', rebuild: 'REBUILD PROTOCOL — x' });
    expect(extractTaskFromReminder(rem)).toBe('Build the widget in /app');
    const history = [user(rem), assistant('ok'), toolResult()];
    expect(resolveTaskText(history, '')).toBe('Build the widget in /app');
    expect(resolveTaskText([assistant('ok')], 'pinned task')).toBe('pinned task');
    expect(resolveTaskText([user('Do X'), user(rem)], 'pinned')).toBe('Do X');
  });
  it('sizes the memory to ~10% of the threshold within [1500, 6000]', () => {
    expect(resumeMemoryTargetTokens(14000)).toBe(1500);
    expect(resumeMemoryTargetTokens(40000)).toBe(4000);
    expect(resumeMemoryTargetTokens(747000)).toBe(6000);
    expect(resumeMemoryTargetTokens(0)).toBe(6000);
  });
});

describe('HB-COMPACTION-RESUME v3 — rolling memory (from the hardened live proof)', () => {
  it('coversAll: a checkpoint is reusable only when every dropped message was already covered', () => {
    const a = user('a'), b = assistant('b'), c = user('c');
    const covered = new WeakSet<object>([a, b]);
    expect(coversAll(covered, [a, b])).toBe(true);
    expect(coversAll(covered, [a, c])).toBe(false);   // c was appended after the checkpoint
    expect(coversAll(covered, [])).toBe(true);
    expect(coversAll(undefined, [a])).toBe(false);
  });
  it('buildRollingSeedMessage carries the prior memory as the first user message of the summary input', () => {
    const m = buildRollingSeedMessage('## 1. STATE — DONE\n- chunk 1 read');
    expect(m.type).toBe('user'); expect(m.message.role).toBe('user');
    const t = m.message.content[0].text as string;
    expect(t.startsWith('PRIOR RESUME MEMORY')).toBe(true);
    expect(t).toContain('- chunk 1 read');
  });
  it('the reminder names a rolled memory as such', () => {
    const r = buildCompactionResumeReminder({ turn: 3, droppedCount: 5, keptCount: 6, tokensBefore: 15000, tokensAfter: 8000,
      resumeText: 'memory', taskText: 'task', helperModelId: 'h', memorySource: 'rolled' });
    expect(r).toContain('carrying the earlier resume memory forward');
  });
});

describe('4.108.4 — workspace state in the reminder + MEMORY.md index', () => {
  it('the reminder carries the workspace state block between the memory and the task', () => {
    const r = buildCompactionResumeReminder({ turn: 2, droppedCount: 3, keptCount: 6, tokensBefore: 15000, tokensAfter: 8000,
      resumeText: 'memory', taskText: 'task', memorySource: 'checkpoint', workspaceState: 'Branch: main\nUncommitted changes:\n M a.py' });
    const iMem = r.indexOf('RESUME MEMORY'), iWs = r.indexOf('WORKSPACE STATE'), iTask = r.indexOf('ORIGINAL TASK');
    expect(iMem).toBeGreaterThan(-1); expect(iWs).toBeGreaterThan(iMem); expect(iTask).toBeGreaterThan(iWs);
    expect(r).toContain(' M a.py');
    expect(buildCompactionResumeReminder({ turn: 2, droppedCount: 3, keptCount: 6, tokensBefore: 1, tokensAfter: 1, resumeText: 'm', taskText: 't' })).not.toContain('WORKSPACE STATE');
  });
  it('upsertMemoryIndex adds the header to an empty index, replaces the line for the same name, keeps others', () => {
    const line1 = memoryIndexLine('resume-s1', 'resume memory — checkpoint band 1');
    const a = upsertMemoryIndex('', 'resume-s1', line1);
    expect(a.startsWith(MEMORY_INDEX_HEADER.split('\n')[0])).toBe(true);
    expect(a).toContain('- [resume-s1](memory/resume-s1.md) — resume memory — checkpoint band 1');
    const b = upsertMemoryIndex(a + '- [other](memory/other.md) — keep me\n', 'resume-s1', memoryIndexLine('resume-s1', 'compaction at turn 3'));
    expect(b.split('\n').filter((l) => l.includes('(memory/resume-s1.md)')).length).toBe(1);
    expect(b).toContain('compaction at turn 3'); expect(b).not.toContain('checkpoint band 1'); expect(b).toContain('keep me');
    expect(b.endsWith('\n')).toBe(true);
  });
});

describe('4.108.5 — compaction judges the request view, not the raw history (R129)', () => {
  it('scales the history estimate by pruned/raw chars, clamped, and is the identity when nothing was pruned', () => {
    expect(scaleEstimateToRequestView(1_080_000, 4_000_000, 250_000)).toBe(67_500);
    expect(scaleEstimateToRequestView(100_000, 400_000, 400_000)).toBe(100_000);
    expect(scaleEstimateToRequestView(100_000, 400_000, 1)).toBe(5_000);        // floor 5%
    expect(scaleEstimateToRequestView(100_000, 0, 0)).toBe(100_000);            // no raw size → unchanged
    expect(scaleEstimateToRequestView(100_000, 400_000, 900_000)).toBe(100_000); // never scales up
  });
  it('approxCharsOf measures text, thinking and JSON-encoded blocks on both message shapes', () => {
    const a = { type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'abcd' }] } };
    const b = { role: 'assistant', content: [{ type: 'thinking', thinking: 'xy' }, { type: 'tool_result', content: 'zz' }] };
    const n = approxCharsOf([a, b]);
    expect(n).toBeGreaterThanOrEqual(4 + 2 + JSON.stringify({ type: 'tool_result', content: 'zz' }).length);
    expect(approxCharsOf([{ message: { content: 'hello' } }])).toBe(5);
  });
});

describe('R132 HB-COMPACTION-ESTIMATE — usage-anchored request estimate', () => {
  it('anchor present: grows by the char delta / 4 on top of the real prompt_tokens', () => {
    // last request: 150K real prompt tokens at 600K chars; history grew by 40K chars since → +10K tokens
    expect(anchoredRequestEstimate({ anchorTokens: 150_000, anchorChars: 600_000, currentChars: 640_000, heuristicTokens: 900_000 }))
      .toEqual({ tokens: 160_000, source: 'usage-anchored' });
    // no growth → exactly the anchor
    expect(anchoredRequestEstimate({ anchorTokens: 150_000, anchorChars: 600_000, currentChars: 600_000, heuristicTokens: 900_000 }))
      .toEqual({ tokens: 150_000, source: 'usage-anchored' });
    // odd delta rounds UP
    expect(anchoredRequestEstimate({ anchorTokens: 10, anchorChars: 100, currentChars: 101, heuristicTokens: 999 }).tokens).toBe(11);
  });
  it('history shrank (post-compaction): scales the anchor proportionally', () => {
    expect(anchoredRequestEstimate({ anchorTokens: 150_000, anchorChars: 600_000, currentChars: 300_000, heuristicTokens: 900_000 }))
      .toEqual({ tokens: 75_000, source: 'usage-anchored' });
    expect(anchoredRequestEstimate({ anchorTokens: 150_000, anchorChars: 600_000, currentChars: 0, heuristicTokens: 900_000 }))
      .toEqual({ tokens: 0, source: 'usage-anchored' });
  });
  it('no anchor → the heuristic (R129 scaled estimate) is returned unchanged', () => {
    expect(anchoredRequestEstimate({ anchorTokens: 0, anchorChars: 0, currentChars: 640_000, heuristicTokens: 900_000 }))
      .toEqual({ tokens: 900_000, source: 'heuristic' });
  });
  it('anchor 0 tokens (streaming chat/completions synthesizes prompt_tokens 0) → heuristic, never anchored', () => {
    expect(anchoredRequestEstimate({ anchorTokens: 0, anchorChars: 600_000, currentChars: 640_000, heuristicTokens: 900_000 }))
      .toEqual({ tokens: 900_000, source: 'heuristic' });
    // anchor chars 0 is equally unusable (no request view to diff against)
    expect(anchoredRequestEstimate({ anchorTokens: 150_000, anchorChars: 0, currentChars: 640_000, heuristicTokens: 900_000 }))
      .toEqual({ tokens: 900_000, source: 'heuristic' });
  });
});

// R143 HB-HANDOFF-QA-SUMMARY (2026-09-14): the Terminus `_summarize` gap-question round, dark behind CORTEX_COMPACTION_HANDOFF_QA.
import {
  resolveCompactionHandoffQA, resolveHandoffQAMaxQuestions, buildGapQuestionPrompt, parseGapQuestions,
  buildGapAnswerPrompt, parseGapAnswers, mergeHandoffMemory, runHandoffQA, HANDOFF_GAPS_HEADER,
} from '../compactionResume';

describe('R143 HB-HANDOFF-QA-SUMMARY: gap-question round on the resume memory', () => {
  it('lever is DARK by default; only explicit true/1/on enables; max questions defaults to 6 and is clamped', () => {
    expect(resolveCompactionHandoffQA({})).toBe(false);
    expect(resolveCompactionHandoffQA({ CORTEX_COMPACTION_HANDOFF_QA: '' })).toBe(false);
    expect(resolveCompactionHandoffQA({ CORTEX_COMPACTION_HANDOFF_QA: 'false' })).toBe(false);
    expect(resolveCompactionHandoffQA({ CORTEX_COMPACTION_HANDOFF_QA: 'true' })).toBe(true);
    expect(resolveCompactionHandoffQA({ CORTEX_COMPACTION_HANDOFF_QA: ' ON ' })).toBe(true);
    expect(resolveCompactionHandoffQA({ CORTEX_COMPACTION_HANDOFF_QA: '1' })).toBe(true);
    expect(resolveHandoffQAMaxQuestions({})).toBe(6);
    expect(resolveHandoffQAMaxQuestions({ CORTEX_COMPACTION_HANDOFF_QA_MAX_QUESTIONS: '3' })).toBe(3);
    expect(resolveHandoffQAMaxQuestions({ CORTEX_COMPACTION_HANDOFF_QA_MAX_QUESTIONS: 'junk' })).toBe(6);
    expect(resolveHandoffQAMaxQuestions({ CORTEX_COMPACTION_HANDOFF_QA_MAX_QUESTIONS: '0' })).toBe(6);
    expect(resolveHandoffQAMaxQuestions({ CORTEX_COMPACTION_HANDOFF_QA_MAX_QUESTIONS: '500' })).toBe(20);
  });
  it('gap-question prompt is history-free (no {{CONVERSATION}}), carries task + summary + workspace state + the cap', () => {
    const p = buildGapQuestionPrompt({ task: 'Build /app/widget', summary: '## 1. STATE — DONE\n- wrote /app/a.py', workspaceState: 'M app/a.py', maxQuestions: 4 });
    expect(p).not.toContain('{{CONVERSATION}}');
    expect(p).toContain('Build /app/widget'); expect(p).toContain('wrote /app/a.py'); expect(p).toContain('M app/a.py');
    expect(p).toContain('at most 4'); expect(p).toContain('NONE');
    const q = buildGapQuestionPrompt({ task: 't', summary: 's', maxQuestions: 2 });
    expect(q).not.toContain('WORKSPACE STATE');
  });
  it('parseGapQuestions: numbered/bulleted lines only, markers + bold stripped, junk dropped, deduped, capped, NONE → []', () => {
    const text = 'Here are the questions the next agent needs:\n1. What is the exact path of the config file?\n2) **Which port** did the server bind to?\n- What was the verbatim error from pytest?\n\nShort?\n3. What is the exact path of the config file?\nThanks.';
    expect(parseGapQuestions(text, 6)).toEqual([
      'What is the exact path of the config file?',
      'Which port did the server bind to?',
      'What was the verbatim error from pytest?',
    ]);
    expect(parseGapQuestions(text, 2)).toHaveLength(2);
    expect(parseGapQuestions('NONE', 6)).toEqual([]);
    expect(parseGapQuestions('', 6)).toEqual([]);
    expect(parseGapQuestions('The summary looks complete to me.', 6)).toEqual([]);
  });
  it('answer prompt numbers the questions, demands verbatim values + "not recorded", and carries the history placeholder', () => {
    const p = buildGapAnswerPrompt({ questions: ['Which port?', 'Which file?'] });
    expect(p).toContain('{{CONVERSATION}}'); expect(p).toContain('1. Which port?'); expect(p).toContain('2. Which file?');
    expect(p).toContain('not recorded'); expect(p.toLowerCase()).toContain('verbatim');
  });
  it('parseGapAnswers aligns answers to the question count and pads the missing ones as "not recorded"', () => {
    expect(parseGapAnswers('1. 8080\n2. not recorded\n', 3)).toEqual(['8080', 'not recorded', 'not recorded']);
    expect(parseGapAnswers('A1: /app/x.py\nA2: Not Recorded (never printed)', 2)).toEqual(['/app/x.py', 'Not Recorded (never printed)']);
    expect(parseGapAnswers('1. line one\ncontinued here\n2. two', 2)).toEqual(['line one\ncontinued here', 'two']);
    expect(parseGapAnswers('', 2)).toEqual(['not recorded', 'not recorded']);
  });
  it('mergeHandoffMemory appends one GAPS (Q/A) section after the template sections and replaces a stale one', () => {
    const summary = '## 0. WORK ORDER\nx\n\n## 6. CURRENT WORK\nlast step\n';
    const m = mergeHandoffMemory(summary, ['Which port?', 'Which file?'], ['8080', 'not recorded']);
    expect(m.startsWith('## 0. WORK ORDER\nx\n\n## 6. CURRENT WORK\nlast step')).toBe(true);
    expect(m).toContain(HANDOFF_GAPS_HEADER);
    expect(m).toContain('Q1: Which port?\nA1: 8080'); expect(m).toContain('Q2: Which file?\nA2: not recorded');
    expect(m.split(HANDOFF_GAPS_HEADER)).toHaveLength(2);
    const again = mergeHandoffMemory(m, ['New?'], ['yes']);
    expect(again.split(HANDOFF_GAPS_HEADER)).toHaveLength(2); expect(again).not.toContain('Q1: Which port?'); expect(again).toContain('Q1: New?');
    expect(mergeHandoffMemory(summary, [], [])).toBe(summary);
  });
  it('runHandoffQA: lever OFF = byte-identical memory and zero helper calls', async () => {
    const calls: any[] = [];
    const summarize = async (...a: any[]) => { calls.push(a); return { summary: 'ignored', cost: 1 }; };
    const r = await runHandoffQA({ enabled: false, summarize, model: {}, task: 't', summary: 'MEMORY', history: [user('h')], maxQuestions: 6, answerTargetTokens: 500 });
    expect(r.text).toBe('MEMORY'); expect(r.handoffQA).toBeUndefined(); expect(calls).toHaveLength(0);
  });
  it('runHandoffQA: lever ON = fresh history-free question call, then an answer call WITH the covered history; GAPS section + counts banked', async () => {
    const calls: any[] = [];
    const history = [user('task'), assistant('bound port 8080')];
    const summarize = async (messages: any[], _model: any, tgt: number, prompt: string) => {
      calls.push({ messages, tgt, prompt });
      if (calls.length === 1) return { summary: '1. Which port did the server bind to?\n2. Where is the log file?\n3. What was the test exit code?', helperModelId: 'h', cost: 0.001 };
      return { summary: '1. 8080\n2. not recorded\n3. 0', helperModelId: 'h', cost: 0.002 };
    };
    const r = await runHandoffQA({ enabled: true, summarize, model: { id: 'm' }, task: 'Run the server', summary: 'MEMORY', workspaceState: 'M a.py', history, maxQuestions: 6, answerTargetTokens: 500 });
    expect(calls).toHaveLength(2);
    expect(calls[0].messages).toEqual([]); expect(calls[0].prompt).toContain('Run the server'); expect(calls[0].prompt).toContain('M a.py'); expect(calls[0].prompt).not.toContain('{{CONVERSATION}}');
    expect(calls[1].messages).toBe(history); expect(calls[1].prompt).toContain('{{CONVERSATION}}'); expect(calls[1].prompt).toContain('1. Which port did the server bind to?'); expect(calls[1].tgt).toBe(500);
    expect(r.text.startsWith('MEMORY')).toBe(true); expect(r.text).toContain(HANDOFF_GAPS_HEADER); expect(r.text).toContain('A1: 8080'); expect(r.text).toContain('A2: not recorded');
    expect(r.handoffQA).toEqual({ questions: 3, answered: 2, notRecorded: 1, cost: 0.003, helperModelId: 'h' });
  });
  it('runHandoffQA: no questions (NONE) = memory unchanged, one call, questions 0', async () => {
    let n = 0;
    const summarize = async () => { n++; return { summary: 'NONE', cost: 0.001 }; };
    const r = await runHandoffQA({ enabled: true, summarize, model: {}, task: 't', summary: 'MEMORY', history: [], maxQuestions: 6, answerTargetTokens: 500 });
    expect(n).toBe(1); expect(r.text).toBe('MEMORY'); expect(r.handoffQA).toEqual({ questions: 0, answered: 0, notRecorded: 0, cost: 0.001, helperModelId: undefined });
  });
  it('runHandoffQA: a helper failure keeps the plain memory and banks the error — never throws', async () => {
    const summarize = async () => { throw new Error('helper 503'); };
    const r = await runHandoffQA({ enabled: true, summarize, model: {}, task: 't', summary: 'MEMORY', history: [], maxQuestions: 6, answerTargetTokens: 500 });
    expect(r.text).toBe('MEMORY'); expect(r.handoffQA).toEqual({ questions: 0, answered: 0, notRecorded: 0, cost: 0, error: 'helper 503' });
    let n = 0;
    const flaky = async () => { n++; if (n === 2) throw new Error('answer step died'); return { summary: '1. Which port?', cost: 0.5 }; };
    const r2 = await runHandoffQA({ enabled: true, summarize: flaky, model: {}, task: 't', summary: 'MEMORY', history: [], maxQuestions: 6, answerTargetTokens: 500 });
    expect(r2.text).toBe('MEMORY'); expect(r2.handoffQA).toEqual({ questions: 1, answered: 0, notRecorded: 0, cost: 0.5, error: 'answer step died' });
  });
});
