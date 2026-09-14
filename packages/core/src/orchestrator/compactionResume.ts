/**
 * HB-COMPACTION-RESUME (4.108.0, 2026-09-12) — pure helpers for the proactive-compaction resume memory.
 *
 * Before 4.108.0 `ensureHistoryFitsModel` DROPPED the oldest message groups at the compaction threshold
 * (~747K tokens on a 1M card) with no summary, no event and no on-disk trace; the task statement itself
 * (the first user message) was not protected. These helpers build the resume reminder the orchestrator
 * prepends after a compaction, pin the original task text, and gate the feature on CORTEX_COMPACTION_RESUME.
 */

export const COMPACTION_RESUME_MARKER = '<system-reminder>[CONTEXT COMPACTED';

/** Lever: CORTEX_COMPACTION_RESUME — default ON; 'false' | '0' | 'off' disables. */
export function resolveCompactionResume(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = String(env.CORTEX_COMPACTION_RESUME ?? '').trim().toLowerCase();
  return !(v === 'false' || v === '0' || v === 'off');
}

function textOf(message: any): string {
  const m = message?.message ?? message;
  const content = m?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((b: any) => b && b.type === 'text' && typeof b.text === 'string')
      .map((b: any) => b.text)
      .join('\n');
  }
  return '';
}

function roleOf(message: any): string {
  return message?.message?.role ?? message?.role ?? message?.type ?? '';
}

/** True for a reminder this module produced (so a later compaction keeps only the newest). */
export function isCompactionResumeMessage(message: any): boolean {
  return roleOf(message) === 'user' && textOf(message).startsWith(COMPACTION_RESUME_MARKER);
}

/**
 * The ORIGINAL TASK: the first user message that carries real text (not a tool_result-only turn, not a
 * harness `<system-reminder>`). Capped so a huge instruction cannot itself blow the budget.
 */
export function extractFirstUserText(messages: any[], maxChars = 6000): string {
  for (const m of messages ?? []) {
    if (roleOf(m) !== 'user') continue;
    const t = textOf(m).trim();
    if (!t) continue;
    if (t.startsWith('<system-reminder>')) continue;
    return t.length > maxChars ? t.slice(0, maxChars) + '\n[… task text truncated at ' + maxChars + ' chars]' : t;
  }
  return '';
}

/** Identity-based diff: everything in `all` that the selector did not keep. */
export function pickDropped<T>(all: T[], kept: T[]): T[] {
  const keep = new Set<T>(kept);
  return all.filter((m) => !keep.has(m));
}

export interface CompactionResumeInput {
  turn: number;
  droppedCount: number;
  keptCount: number;
  tokensBefore: number;
  tokensAfter: number;
  resumeText: string;      // helper-model summary of the DROPPED messages ('' when unavailable)
  taskText: string;        // original task, verbatim
  helperModelId?: string;
  rebuild?: string;       // post-compaction wake protocol text (v2)
  memorySource?: 'checkpoint' | 'dropped' | 'rolled' | 'none';
  workspaceState?: string; // 4.108.4: git repository state (or mtime delta) read from disk AT compaction
}

/** The `<system-reminder>` prepended to the compacted history. */
export function buildCompactionResumeReminder(i: CompactionResumeInput): string {
  const head =
    `${COMPACTION_RESUME_MARKER} at turn ${i.turn}: ${i.droppedCount} older message(s) (~${Math.max(0, i.tokensBefore - i.tokensAfter)} tokens) ` +
    `were removed from your context to stay within the model window; ${i.keptCount} recent message(s) were kept verbatim.]`;
  const src = i.memorySource === 'checkpoint' ? 'at the pre-compaction checkpoint (whole conversation)'
    : i.memorySource === 'rolled' ? 'from the removed messages, carrying the earlier resume memory forward'
    : 'from the removed messages';
  const memory = i.resumeText.trim()
    ? `RESUME MEMORY (written by ${i.helperModelId ?? 'the helper model'} ${src}):\n${i.resumeText.trim()}`
    : 'RESUME MEMORY: unavailable (the helper summary failed); rely on the files on disk and the recent messages below.';
  const task = i.taskText.trim()
    ? `ORIGINAL TASK (verbatim — this is still the goal):\n${i.taskText.trim()}`
    : 'ORIGINAL TASK: not recoverable from history; re-read any task file in the working directory.';
  const ws = i.workspaceState && i.workspaceState.trim()
    ? `WORKSPACE STATE (read from disk at this compaction — your own edits so far):\n${i.workspaceState.trim()}\n`
    : '';
  const tail = (i.rebuild && i.rebuild.trim()
    ? i.rebuild.trim()
    : 'Continue from the CURRENT state: files already written are on disk (re-read before editing), commands already run need not be repeated, ' +
      'and completed sub-goals in the resume memory are done. Do not restart from scratch.') + '</system-reminder>';
  return `${head}\n${memory}\n${ws}${task}\n${tail}`;
}

/** Recover the ORIGINAL TASK text from a prior compaction reminder (the task message itself is gone after the first compaction). */
export function extractTaskFromReminder(reminderText: string): string {
  const m = reminderText.match(/ORIGINAL TASK \(verbatim[^\n]*\):\n([\s\S]*?)\n(?:REBUILD PROTOCOL|Continue from the CURRENT state)/);
  return m && m[1] ? m[1].trim() : '';
}

/**
 * The task, from the first plain user message if it still exists, else from the newest compaction reminder in the history,
 * else the pinned copy the orchestrator kept from an earlier compaction.
 */
export function resolveTaskText(messages: any[], pinned: string, maxChars = 6000): string {
  const direct = extractFirstUserText(messages, maxChars);
  if (direct) return direct;
  for (let i = (messages ?? []).length - 1; i >= 0; i--) {
    const m = messages[i];
    if (isCompactionResumeMessage(m)) {
      const t = extractTaskFromReminder(textOf(m));
      if (t) return t;
    }
  }
  return pinned || '';
}

/** Resume-memory size: ~10% of the compaction threshold, clamped to [1500, 6000] tokens (a forced 14K test window gets ~1.5K). */
export function resumeMemoryTargetTokens(threshold: number): number {
  if (!(threshold > 0)) return 6000;
  return Math.max(1500, Math.min(6000, Math.floor(threshold * 0.1)));
}

/**
 * v3 (4.108.3, from the live proof): a checkpoint may be REUSED at compaction only if it already covered every message being
 * dropped. The v2 rule compared token distance, which goes negative once a compaction shrinks the history — so one stale checkpoint
 * was replayed into every later reminder and the model's progress after it was erased each time (27 compactions, 0 fresh memories).
 */
export function coversAll(covered: WeakSet<object> | undefined, dropped: any[]): boolean {
  if (!covered) return false;
  return (dropped ?? []).every((m) => !!m && typeof m === 'object' && covered.has(m));
}

/**
 * v3: when the checkpoint is stale, the new summary must ROLL the prior memory forward — the helper sees the prior memory as the
 * first message, then the newly dropped messages, and writes one memory covering both (otherwise each compaction forgets the last).
 */
export function buildRollingSeedMessage(priorText: string): any {
  const text =
    'PRIOR RESUME MEMORY (already summarizes everything before the messages that follow — carry every DONE / OUTSTANDING / DECISION ' +
    'item forward unless the messages below supersede it):\n' + String(priorText ?? '').trim();
  return {
    uuid: `resume-seed-${Date.now().toString(36)}`,
    timestamp: new Date().toISOString(),
    type: 'user',
    message: { role: 'user', content: [{ type: 'text', text }] },
  };
}

/** 4.108.4: the resume file is a first-class memory — index it in `.cortex/MEMORY.md` exactly as MemoryWrite would. */
export const MEMORY_INDEX_HEADER =
  '# Memory\n\nCurated index — one line per memory; detail lives in `.cortex/memory/<name>.md`\n(use MemoryRecall to load one).\n';

export function memoryIndexLine(name: string, description: string): string {
  return `- [${name}](memory/${name}.md) — ${description.replace(/\s+/g, ' ').trim()}`;
}

/** Pure: replace any existing line for `name` (matched by its `(memory/<name>.md)` marker) with `line`; empty content gets the header. */
export function upsertMemoryIndex(content: string, name: string, line: string | null): string {
  const base = content && content.trim() ? content : MEMORY_INDEX_HEADER;
  const marker = `(memory/${name}.md)`;
  const lines = base.split('\n').filter((l) => !l.includes(marker));
  if (line) lines.push(line);
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\n*$/, '\n');
}

/**
 * 4.108.5 (R129, TB4.0 cad-model): the compaction threshold was compared against the STORED history estimate (raw tool outputs —
 * 1.08M "tokens" at 82 messages) while the request sent the aged-pruned view (68K real tokens), so the checkpoint rung and the
 * proactive drop fired on a false reading and re-fired every iteration. Scale the history estimate by the pruned-view/raw
 * char ratio so compaction judges what the request actually carries. Ratio is clamped to [0.05, 1]; a zero raw size returns
 * the estimate unchanged.
 */
export function scaleEstimateToRequestView(historyEstimate: number, rawChars: number, prunedChars: number): number {
  if (!(historyEstimate > 0) || !(rawChars > 0) || !(prunedChars >= 0)) return Math.max(0, historyEstimate | 0);
  const ratio = Math.min(1, Math.max(0.05, prunedChars / rawChars));
  return Math.max(1, Math.round(historyEstimate * ratio));
}

/**
 * R132 HB-COMPACTION-ESTIMATE (2026-09-13): the heuristic estimator (TokenCounter over the WHOLE stored Message — uuid,
 * timestamp, timeline, usage, base64 — at chars/4 for non-OpenAI/Anthropic providers) over-read the request ~5-7x: compaction
 * rows logged 760K..1.0M "tokens" vs a 733K threshold while the same session's API usage never exceeded prompt_tokens 151763.
 * Anchor the estimate on the LAST REAL prompt_tokens instead: tokens = anchor + (chars grown since that request)/4; when the
 * history SHRANK (post-compaction) scale the anchor proportionally. With no usable anchor (none yet, or a 0 usage such as
 * the synthesized streaming chat/completions usage) fall back to the heuristic (R129 scaleEstimateToRequestView).
 */
export function anchoredRequestEstimate(input: {
  anchorTokens: number; anchorChars: number; currentChars: number; heuristicTokens: number;
}): { tokens: number; source: 'usage-anchored' | 'heuristic' } {
  const { anchorTokens, anchorChars, currentChars, heuristicTokens } = input;
  if (!(anchorTokens > 0) || !(anchorChars > 0) || !(currentChars >= 0)) {
    return { tokens: Math.max(0, heuristicTokens | 0), source: 'heuristic' };
  }
  if (currentChars < anchorChars) {
    return { tokens: Math.round(anchorTokens * (currentChars / anchorChars)), source: 'usage-anchored' };
  }
  return { tokens: anchorTokens + Math.max(0, Math.ceil((currentChars - anchorChars) / 4)), source: 'usage-anchored' };
}

/** Char size of a canonical/request-shaped message list, the same way pruneAgedForRequest measures it. */
export function approxCharsOf(messages: any[]): number {
  let n = 0;
  for (const m of messages ?? []) {
    const content = (m?.message ?? m)?.content;
    if (typeof content === 'string') { n += content.length; continue; }
    if (!Array.isArray(content)) continue;
    for (const b of content) {
      if (!b || typeof b !== 'object') continue;
      if (b.type === 'text' && typeof b.text === 'string') n += b.text.length;
      else if (b.type === 'thinking' && typeof b.thinking === 'string') n += b.thinking.length;
      else { try { n += JSON.stringify(b).length; } catch { /* skip */ } }
    }
  }
  return n;
}

/**
 * R143 HB-HANDOFF-QA-SUMMARY (2026-09-14) — the Terminus 2 `_summarize` gap-question round (terminus_2.py:865+), dark behind
 * CORTEX_COMPACTION_HANDOFF_QA. After the resume memory is written: (1) a FRESH helper call with NO history sees only the task,
 * the memory and the workspace state and asks "what is missing that the successor will need?" (numbered questions); (2) a helper
 * call WITH the covered history answers them ("not recorded" when unknown); (3) the memory gains a `## GAPS (Q/A)` section.
 * Rationale: the gap-question round catches facts the summary dropped. Bounded: two helper calls, any failure keeps the plain memory.
 */

/** Lever: CORTEX_COMPACTION_HANDOFF_QA — default OFF (dark, A/B-able); 'true' | '1' | 'on' enables. */
export function resolveCompactionHandoffQA(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = String(env.CORTEX_COMPACTION_HANDOFF_QA ?? '').trim().toLowerCase();
  return v === 'true' || v === '1' || v === 'on';
}

/** Lever: CORTEX_COMPACTION_HANDOFF_QA_MAX_QUESTIONS — default 6, clamped to [1, 20]. */
export function resolveHandoffQAMaxQuestions(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(String(env.CORTEX_COMPACTION_HANDOFF_QA_MAX_QUESTIONS ?? '').trim());
  if (!Number.isFinite(n) || n < 1) return 6;
  return Math.min(20, Math.floor(n));
}

export const HANDOFF_GAPS_HEADER = '## GAPS (Q/A)';

/** Step 1: the history-free prompt (no {{CONVERSATION}} placeholder — the adapter substitutes nothing). */
export function buildGapQuestionPrompt(i: { task: string; summary: string; workspaceState?: string; maxQuestions: number }): string {
  const ws = i.workspaceState && i.workspaceState.trim()
    ? `\nWORKSPACE STATE (read from disk right now):\n${i.workspaceState.trim()}\n`
    : '';
  const given = ws ? 'ORIGINAL TASK, the RESUME MEMORY and the WORKSPACE STATE below' : 'ORIGINAL TASK and the RESUME MEMORY below';
  return `An autonomous coding agent is about to lose its conversation history. The agent that continues will have ONLY the
${given}. You have NOT seen the conversation. Your job: find what the
memory FAILS to record that the next agent will need to continue without redoing or breaking work — exact file paths, values,
ports, commands, chosen approaches, open errors, verification results, partially finished steps.

ORIGINAL TASK:
${String(i.task ?? '').trim() || '(not recoverable)'}

RESUME MEMORY:
${String(i.summary ?? '').trim()}
${ws}
Write at most ${i.maxQuestions} precise questions whose answers the next agent needs, as a numbered list (1. 2. 3. ...), one question
per line, no prose, no headings, no answers. Ask only for information the memory does not already state. If nothing is missing,
reply with the single word NONE.`;
}

/** Parse the helper's question list: numbered/bulleted lines only; markers and bold stripped; junk, near-empty and duplicate lines dropped; capped at max. */
export function parseGapQuestions(text: string, max: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const cap = Math.max(0, max | 0);
  if (!text || /^\s*none\.?\s*$/i.test(text)) return out;
  for (const raw of String(text).split('\n')) {
    const m = raw.match(/^\s*(?:\d+\s*[.):]|[-*•])\s+(.+?)\s*$/);
    if (!m) continue;
    const q = (m[1] ?? '').replace(/\*\*/g, '').replace(/^["']|["']$/g, '').trim();
    if (q.length < 8) continue;
    const key = q.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(q);
    if (out.length >= cap) break;
  }
  return out;
}

/** Step 2: the answer prompt — {{CONVERSATION}} is substituted with the covered history by the helper adapter. */
export function buildGapAnswerPrompt(i: { questions: string[] }): string {
  const list = i.questions.map((q, n) => `${n + 1}. ${q}`).join('\n');
  return `Below is the conversation history of an autonomous coding agent, followed by questions from a reviewer who has NOT seen it.
Answer each question from the history ONLY. Quote values VERBATIM (paths, commands, numbers, error text). When the history does
not contain the answer, write exactly: not recorded. Do not guess. Reply as a numbered list matching the question numbers
(1. answer, 2. answer, ...), one answer per number, no prose before or after.

CONVERSATION HISTORY:
{{CONVERSATION}}

QUESTIONS:
${list}

Answers:`;
}

/** Align the helper's answers to the question count (multi-line answers fold into the preceding number; missing ones = "not recorded"). */
export function parseGapAnswers(text: string, count: number): string[] {
  const n = Math.max(0, count | 0);
  const answers: string[] = new Array(n).fill('not recorded');
  let current = -1;
  for (const raw of String(text ?? '').split('\n')) {
    const m = raw.match(/^\s*(?:A\s*)?(\d+)\s*[.):]\s*(.*)$/i);
    if (m) {
      const idx = Number(m[1]) - 1;
      if (idx >= 0 && idx < n) { current = idx; answers[idx] = (m[2] ?? '').trim(); continue; }
      current = -1;
      continue;
    }
    if (current >= 0 && raw.trim()) answers[current] = (answers[current] + '\n' + raw.trim()).trim();
  }
  return answers.map((a) => (a.trim() ? a.trim() : 'not recorded'));
}

export function isNotRecorded(answer: string): boolean {
  return /^\s*not\s+recorded\b/i.test(answer || '');
}

/** Step 3: append the GAPS section (replacing any earlier one) after the template sections; no questions = memory unchanged. */
export function mergeHandoffMemory(summary: string, questions: string[], answers: string[]): string {
  if (!questions.length) return summary;
  const idx = summary.indexOf(HANDOFF_GAPS_HEADER);
  const base = (idx >= 0 ? summary.slice(0, idx) : summary).replace(/\s+$/, '');
  const body = questions.map((q, n) => `Q${n + 1}: ${q}\nA${n + 1}: ${answers[n] ?? 'not recorded'}`).join('\n\n');
  return `${base}\n\n${HANDOFF_GAPS_HEADER}\n${body}\n`;
}

export interface HandoffQAResult {
  questions: number;
  answered: number;      // answers that carry a value (not "not recorded")
  notRecorded: number;
  cost: number;
  helperModelId?: string;
  error?: string;
}

/** The orchestrator's helper call shape (HelperModelMiddleware.summarizeForResume): messages, main model, target tokens, prompt override. */
export type HandoffSummarizer = (messages: any[], model: any, targetTokens: number, prompt: string) =>
  Promise<{ summary?: string; helperModelId?: string; cost?: number } | undefined>;

/**
 * Run the round. `enabled: false` returns the memory byte-identical with no helper call. Never throws: a failure at either step
 * keeps the plain memory and reports `error` (with whatever was learned before the failure).
 */
export async function runHandoffQA(i: {
  enabled: boolean;
  summarize: HandoffSummarizer;
  model: any;
  task: string;
  summary: string;
  workspaceState?: string;
  history: any[];          // the exact message set the memory summarizer saw
  maxQuestions: number;
  answerTargetTokens: number;
}): Promise<{ text: string; handoffQA?: HandoffQAResult }> {
  if (!i.enabled) return { text: i.summary };
  const result: HandoffQAResult = { questions: 0, answered: 0, notRecorded: 0, cost: 0 };
  try {
    const max = Math.max(1, i.maxQuestions | 0);
    const q = await i.summarize([], i.model, 120 + 60 * max, buildGapQuestionPrompt({ task: i.task, summary: i.summary, workspaceState: i.workspaceState, maxQuestions: max }));
    result.cost += Number(q?.cost ?? 0);
    result.helperModelId = q?.helperModelId;
    const questions = parseGapQuestions(String(q?.summary ?? ''), max);
    result.questions = questions.length;
    if (!questions.length) return { text: i.summary, handoffQA: result };
    const a = await i.summarize(i.history, i.model, i.answerTargetTokens, buildGapAnswerPrompt({ questions }));
    result.cost += Number(a?.cost ?? 0);
    result.helperModelId = a?.helperModelId ?? result.helperModelId;
    const answers = parseGapAnswers(String(a?.summary ?? ''), questions.length);
    result.notRecorded = answers.filter(isNotRecorded).length;
    result.answered = answers.length - result.notRecorded;
    return { text: mergeHandoffMemory(i.summary, questions, answers), handoffQA: result };
  } catch (e: any) {
    result.error = String(e?.message ?? e);
    return { text: i.summary, handoffQA: result };
  }
}
