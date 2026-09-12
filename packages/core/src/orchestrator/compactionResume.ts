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
  memorySource?: 'checkpoint' | 'dropped' | 'none';
}

/** The `<system-reminder>` prepended to the compacted history. */
export function buildCompactionResumeReminder(i: CompactionResumeInput): string {
  const head =
    `${COMPACTION_RESUME_MARKER} at turn ${i.turn}: ${i.droppedCount} older message(s) (~${Math.max(0, i.tokensBefore - i.tokensAfter)} tokens) ` +
    `were removed from your context to stay within the model window; ${i.keptCount} recent message(s) were kept verbatim.]`;
  const src = i.memorySource === 'checkpoint' ? 'at the pre-compaction checkpoint (whole conversation)' : 'from the removed messages';
  const memory = i.resumeText.trim()
    ? `RESUME MEMORY (written by ${i.helperModelId ?? 'the helper model'} ${src}):\n${i.resumeText.trim()}`
    : 'RESUME MEMORY: unavailable (the helper summary failed); rely on the files on disk and the recent messages below.';
  const task = i.taskText.trim()
    ? `ORIGINAL TASK (verbatim — this is still the goal):\n${i.taskText.trim()}`
    : 'ORIGINAL TASK: not recoverable from history; re-read any task file in the working directory.';
  const tail = (i.rebuild && i.rebuild.trim()
    ? i.rebuild.trim()
    : 'Continue from the CURRENT state: files already written are on disk (re-read before editing), commands already run need not be repeated, ' +
      'and completed sub-goals in the resume memory are done. Do not restart from scratch.') + '</system-reminder>';
  return `${head}\n${memory}\n${task}\n${tail}`;
}
