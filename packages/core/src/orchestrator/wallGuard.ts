/**
 * Wall levers (2026-10-01; c22 evidence in the master .env ledger lines).
 *
 * HB-WALL-DROP (CORTEX_WALL_DROP=on, dark): on a reasoning-exhaustion wall (the response spent the whole output budget on reasoning and
 * delivered no text and no tool call) the walled assistant turn is removed from the IN-MEMORY history before the retry (the session file
 * keeps it) and the nudge is carried at the tail of the newest tool_result — the HB-TURN-STATUS carrier — so the retry is the exact
 * pre-wall prefix plus the nudge (cache-preserving) and the dead 65K reasoning no longer rides along in every later call. A turn that
 * carries a tool call is NEVER dropped (its reasoning must round-trip). When there is no tool_result before the wall (a wall on the
 * turn's first call) the caller pushes the nudge as a user message, as before.
 *
 * HB-OUTPUT-CAP (CORTEX_OUTPUT_CAP_TOKENS=<n>, dark): per-call output cap for the action model — fills the request's maxTokens only when
 * the request did not set one. Acting calls' reasoning in c22: p99 14K, p99.9 40K, 7 of 19,337 above 48K; a wall then costs ~48K
 * instead of 65,536 output tokens and minutes of decode.
 */
import { appendStatusToNewestToolResult } from './turnStatus.js';

export function resolveWallDrop(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = String(env.CORTEX_WALL_DROP ?? '').trim().toLowerCase();
  return v === 'on' || v === 'true' || v === '1';
}

export function resolveOutputCap(env: NodeJS.ProcessEnv = process.env): number | undefined {
  const raw = String(env.CORTEX_OUTPUT_CAP_TOKENS ?? '').trim();
  if (!/^\d+$/.test(raw)) return undefined;
  const n = Number(raw);
  return n >= 1024 ? n : undefined;
}

export interface WallDropResult { dropped: boolean; carrier?: 'tool_result' | 'none'; droppedChars?: number; carrierMessage?: any }

function roleOf(m: any): string | undefined { return m?.message?.role ?? m?.role ?? (m?.type === 'assistant' ? 'assistant' : undefined); }

/** Drops the newest message when it is a walled assistant turn (no tool call); appends `nudge` to the newest tool_result. Mutates.
 *  `carrierMessage` = the history record that received the nudge (R221: its cached conversion is stale and must be invalidated). */
export function dropWalledTurn(history: any[], nudge: string): WallDropResult {
  const last = history[history.length - 1];
  if (!last || roleOf(last) !== 'assistant') return { dropped: false };
  const content = last?.message?.content ?? last?.content;
  const blocks: any[] = Array.isArray(content) ? content : [];
  if (blocks.some((b) => b?.type === 'tool_use' || b?.toolUse)) return { dropped: false };
  let droppedChars = 0;
  for (const b of blocks) droppedChars += String(b?.thinking ?? b?.text ?? b?.reasoning ?? '').length;
  history.pop();
  const before = history.length;
  const carried = appendStatusToNewestToolResult(history, nudge);
  let carrierMessage: any;
  if (carried) {
    for (let i = before - 1; i >= 0; i--) {
      const c = history[i]?.message?.content ?? history[i]?.content;
      if (Array.isArray(c) && c.some((b: any) => b?.type === 'tool_result')) { carrierMessage = history[i]; break; }
    }
  }
  return { dropped: true, carrier: carried ? 'tool_result' : 'none', droppedChars, ...(carrierMessage ? { carrierMessage } : {}) };
}

/**
 * HB-WALL-SUMMARY (CORTEX_WALL_SUMMARY=on, dark): on a reasoning-exhaustion wall, one helper call (the EndTurn judge's mentor wire, small
 * budget) condenses the walled reasoning into CONCLUDED / STUCK ON / NEXT, and the result rides INSIDE the wall nudge (same cache-safe tail as
 * HB-WALL-DROP). Item-11c FOREIGN-THINKING doctrine: the text is attributed as written by the harness and delivered in a user-role
 * system-reminder — never in the model's thinking channel. Fail-open: timeout / error / empty → the plain nudge.
 *   CORTEX_WALL_SUMMARY = off (default) | on ; CORTEX_WALL_SUMMARY_TIMEOUT_MS (default 30000)
 */
export interface WallSummaryConfig { enabled: boolean; timeoutMs: number; headChars: number; tailChars: number }

export function resolveWallSummary(env: NodeJS.ProcessEnv = process.env): WallSummaryConfig {
  const v = String(env.CORTEX_WALL_SUMMARY ?? '').trim().toLowerCase();
  const t = Number(String(env.CORTEX_WALL_SUMMARY_TIMEOUT_MS ?? '').trim());
  return { enabled: v === 'on' || v === 'true' || v === '1', timeoutMs: Number.isFinite(t) && t >= 1000 ? Math.floor(t) : 30000, headChars: 4000, tailChars: 16000 };
}

/** Reasoning text of the newest assistant turn (thinking/reasoning blocks), '' when none. */
export function extractWalledReasoning(history: readonly any[]): string {
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i];
    if (roleOf(m) !== 'assistant') continue;
    const c = m?.message?.content ?? m?.content;
    const blocks: any[] = Array.isArray(c) ? c : [];
    return blocks.filter((b) => b?.type === 'thinking' || b?.type === 'reasoning').map((b) => String(b?.thinking ?? b?.reasoning ?? b?.text ?? '')).join('\n');
  }
  return '';
}

export function clipReasoning(text: string, head: number, tail: number): string {
  if (text.length <= head + tail) return text;
  return `${text.slice(0, head)}\n[… ${text.length - head - tail} characters omitted …]\n${text.slice(text.length - tail)}`;
}

export const WALL_SUMMARY_SYSTEM =
  'You condense the internal reasoning of a coding agent whose turn ran out of output budget while it was still thinking — it produced no ' +
  'answer and no tool call. Read the reasoning and reply with at most five short lines, nothing else:\n' +
  'CONCLUDED: the facts or decisions the reasoning had firmly established (or "nothing firm").\n' +
  'STUCK ON: the one open question it kept circling.\n' +
  'NEXT: one concrete command, test or edit that would settle that question or move the work forward.\n' +
  'Do not continue the reasoning, do not solve the task, do not add caveats.';

export function buildWallSummaryPrompt(clippedReasoning: string): string {
  return `AGENT REASONING (cut off at the output limit):\n${clippedReasoning}\n\nWrite the CONCLUDED / STUCK ON / NEXT lines.`;
}

/** The attributed block that rides inside the wall nudge; '' when the summary is empty. Capped. */
export function formatWallSummary(summary: string): string {
  const s = String(summary ?? '').trim().slice(0, 1200);
  if (!s) return '';
  return `\n\nA short summary written by the harness of where your cut-off reasoning had reached (not your own words):\n${s}\n` +
    'Act on it now: do not restart that analysis — run the NEXT step and let its result settle the open question.';
}
