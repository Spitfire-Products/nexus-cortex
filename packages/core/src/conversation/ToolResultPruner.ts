/**
 * ToolResultPruner — age-tiered tool-result pruning for OUTGOING REQUEST
 * copies of the canonical history.
 *
 * Ported from grok-build's request-builder pruning (2026-08-01): when context
 * pressure is high, tool results outside the most recent turns are
 * middle-trimmed (soft tier) or fully elided (hard tier). This is a relief
 * valve BELOW compaction — it defers whole-message removal/summarization and
 * costs nothing while context is comfortable (the caller gates on
 * utilization; see CortexOrchestrator.pruneAgedForRequest).
 *
 * Contract:
 * - PURE: never mutates the input. Touched messages get a new wrapper, a new
 *   content array, new block objects, and a new toolResult object; untouched
 *   messages pass through by reference. Canonical history, JSONL, and the
 *   canonicalConversionCache are never affected.
 * - ONLY tool_result payloads are touched. text, tool_use, thinking,
 *   redacted_thinking, and server-tool blocks are never modified, so
 *   tool_use/tool_result pairing stays structurally intact (blocks are
 *   rewritten in place, never removed) and provider validators stay happy.
 * - Prompt-cache note: rewriting an old tool result invalidates the cached
 *   prefix from that message onward. That is why the CALLER gates this on
 *   high utilization — where the alternative is compaction, which busts the
 *   entire prefix anyway.
 */

import type { CanonicalMessage, CanonicalContentBlock } from '../adapters/FormatAdapter.interface.js';

export interface ToolResultPruneOptions {
  /** Turns whose tool results are never touched, counting back from newest. Default 3. */
  keepLastNTurns?: number;
  /** Rendered char size above which aged results are middle-trimmed. Default 4000. */
  softTrimThreshold?: number;
  /** Chars kept from each end when middle-trimming. Default 1500. */
  softTrimKeep?: number;
  /** Turn age at which tool results are fully elided. Default 10. */
  hardClearAgeTurns?: number;
}

export interface ToolResultPruneResult {
  messages: CanonicalMessage[];
  /** Number of tool-result payloads trimmed or elided. */
  prunedCount: number;
  /** Total rendered characters removed. */
  savedChars: number;
}

/** A genuine user turn starts at a user message carrying no tool results
 *  (tool-result carriers are loop continuations of the previous turn). */
function isGenuineUserTurn(msg: CanonicalMessage): boolean {
  return msg.role === 'user' && !msg.content.some((b) => b.type === 'tool_result');
}

function renderPayload(content: string | object): string {
  if (typeof content === 'string') return content;
  try {
    return JSON.stringify(content);
  } catch {
    return String(content);
  }
}

export function pruneAgedToolResults(
  messages: CanonicalMessage[],
  options: ToolResultPruneOptions = {},
): ToolResultPruneResult {
  const keepLastNTurns = options.keepLastNTurns ?? 3;
  const softTrimThreshold = options.softTrimThreshold ?? 4000;
  const softTrimKeep = options.softTrimKeep ?? 1500;
  const hardClearAgeTurns = options.hardClearAgeTurns ?? 10;

  // Forward pass: assign a turn index to every message.
  const turnIndex: number[] = new Array(messages.length);
  let turn = 0;
  for (let i = 0; i < messages.length; i++) {
    if (isGenuineUserTurn(messages[i]!)) turn += 1;
    turnIndex[i] = turn;
  }
  const currentTurn = turn;

  let prunedCount = 0;
  let savedChars = 0;

  const pruneRendered = (rendered: string, age: number): string | null => {
    if (age >= hardClearAgeTurns) {
      return `[Tool result omitted - too old (${rendered.length} chars)]`;
    }
    if (rendered.length > softTrimThreshold) {
      const head = rendered.slice(0, softTrimKeep);
      const tail = rendered.slice(-softTrimKeep);
      return `${head}\n[... trimmed ${rendered.length - 2 * softTrimKeep} of ${rendered.length} chars ...]\n${tail}`;
    }
    return null; // untouched
  };

  const result = messages.map((msg, i) => {
    const age = currentTurn - (turnIndex[i] ?? currentTurn);
    if (age <= keepLastNTurns) return msg;

    let touched = false;
    const newContent: CanonicalContentBlock[] = msg.content.map((block) => {
      if (block.type !== 'tool_result' || !block.toolResult) return block;
      const rendered = renderPayload(block.toolResult.content);
      const replaced = pruneRendered(rendered, age);
      if (replaced === null || replaced.length >= rendered.length) return block;
      touched = true;
      prunedCount += 1;
      savedChars += rendered.length - replaced.length;
      return {
        ...block,
        toolResult: { ...block.toolResult, content: replaced },
      };
    });

    if (!touched) return msg;
    return { ...msg, content: newContent };
  });

  return { messages: result, prunedCount, savedChars };
}
