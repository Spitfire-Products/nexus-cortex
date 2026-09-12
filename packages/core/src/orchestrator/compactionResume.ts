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
