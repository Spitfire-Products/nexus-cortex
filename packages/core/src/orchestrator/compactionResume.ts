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
  const tail = (i.rebuild && i.rebuild.trim()
    ? i.rebuild.trim()
    : 'Continue from the CURRENT state: files already written are on disk (re-read before editing), commands already run need not be repeated, ' +
      'and completed sub-goals in the resume memory are done. Do not restart from scratch.') + '</system-reminder>';
  return `${head}\n${memory}\n${task}\n${tail}`;
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
