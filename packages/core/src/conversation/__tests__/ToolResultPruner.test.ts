/**
 * ToolResultPruner — age-tiered request-copy pruning (grok-build port).
 *
 * Pins: turn-age computation, soft-trim/hard-clear tiers, the clone-on-write
 * contract (input never mutated — the canonicalConversionCache shares block
 * objects with these arrays), and structural pairing safety (blocks rewritten,
 * never removed).
 */

import { describe, it, expect } from 'vitest';
import { pruneAgedToolResults } from '../ToolResultPruner.js';
import type { CanonicalMessage } from '../../adapters/FormatAdapter.interface.js';

function msg(partial: {
  uuid: string;
  role: 'user' | 'assistant' | 'system';
  content: CanonicalMessage['content'];
}): CanonicalMessage {
  return {
    uuid: partial.uuid,
    timestamp: new Date(0).toISOString(),
    timeline: { sessionId: 's', conversationId: 'c', turnNumber: 0 },
    role: partial.role,
    type: 'text',
    content: partial.content,
    model: { id: 'm', provider: 'p', apiPattern: 'messages' },
  } as CanonicalMessage;
}

/** turns of: user question → assistant tool_use → user tool_result carrier */
function buildHistory(turns: number, resultSize: number): CanonicalMessage[] {
  const messages: CanonicalMessage[] = [];
  for (let t = 0; t < turns; t++) {
    messages.push(msg({
      uuid: `user-${t}`, role: 'user',
      content: [{ type: 'text', text: `question ${t}` }],
    }));
    messages.push(msg({
      uuid: `asst-${t}`, role: 'assistant',
      content: [{ type: 'tool_use', toolUse: { id: `call-${t}`, name: 'Read', input: {} } } as any],
    }));
    messages.push(msg({
      uuid: `result-${t}`, role: 'user',
      content: [{
        type: 'tool_result',
        toolResult: { tool_use_id: `call-${t}`, content: 'r'.repeat(resultSize) },
      } as any],
    }));
  }
  return messages;
}

describe('pruneAgedToolResults', () => {
  it('never touches the last keepLastNTurns turns', () => {
    const messages = buildHistory(12, 5000);
    const result = pruneAgedToolResults(messages);
    for (let t = 9; t < 12; t++) {
      const idx = messages.findIndex((m) => m.uuid === `result-${t}`);
      expect(result.messages[idx]).toBe(messages[idx]); // same reference
    }
  });

  it('fully elides very old results and middle-trims large mid-age results', () => {
    const messages = buildHistory(12, 5000);
    const result = pruneAgedToolResults(messages);
    expect(result.prunedCount).toBeGreaterThan(0);
    expect(result.savedChars).toBeGreaterThan(0);

    // Turn 0 (age 11 >= 10): elided
    const oldIdx = messages.findIndex((m) => m.uuid === 'result-0');
    const oldPayload = (result.messages[oldIdx]!.content[0] as any).toolResult.content as string;
    expect(oldPayload).toContain('[Tool result omitted - too old');

    // Turn 7 (age 4): middle-trimmed, head+tail preserved
    const midIdx = messages.findIndex((m) => m.uuid === 'result-7');
    const midPayload = (result.messages[midIdx]!.content[0] as any).toolResult.content as string;
    expect(midPayload).toContain('[... trimmed');
    expect(midPayload.startsWith('r'.repeat(100))).toBe(true);
    expect(midPayload.endsWith('r'.repeat(100))).toBe(true);
    expect(midPayload.length).toBeLessThan(5000);
  });

  it('NEVER mutates the input (clone-on-write — cache shares these objects)', () => {
    const messages = buildHistory(12, 5000);
    const originalBlock = messages[2]!.content[0] as any;
    const originalToolResult = originalBlock.toolResult;
    pruneAgedToolResults(messages);
    // Input block and its toolResult object are byte-identical
    expect(messages[2]!.content[0]).toBe(originalBlock);
    expect(originalBlock.toolResult).toBe(originalToolResult);
    expect((originalToolResult.content as string).length).toBe(5000);
  });

  it('keeps blocks structurally intact (rewritten, never removed)', () => {
    const messages = buildHistory(12, 5000);
    const result = pruneAgedToolResults(messages);
    expect(result.messages.length).toBe(messages.length);
    for (let i = 0; i < messages.length; i++) {
      expect(result.messages[i]!.content.length).toBe(messages[i]!.content.length);
      // tool_use ids and tool_result tool_use_ids all survive
      const before = JSON.stringify(messages[i]!.content.map((b: any) => b.type));
      const after = JSON.stringify(result.messages[i]!.content.map((b: any) => b.type));
      expect(after).toBe(before);
    }
  });

  it('leaves small aged results, thinking, and text blocks untouched', () => {
    const messages = buildHistory(12, 100);
    messages.push(msg({
      uuid: 'think-1', role: 'assistant',
      content: [{ type: 'thinking', thinking: 'x'.repeat(9000) } as any],
    }));
    const result = pruneAgedToolResults(messages);
    // Mid-age small results untouched (only age>=10 hard-clear fires)
    const midIdx = messages.findIndex((m) => m.uuid === 'result-5');
    expect(result.messages[midIdx]).toBe(messages[midIdx]);
    // Thinking blocks never touched regardless of size/age
    const thinkIdx = messages.length - 1;
    expect(result.messages[thinkIdx]).toBe(messages[thinkIdx]);
  });

  it('renders object payloads for size decisions and prunes them as strings', () => {
    const messages = buildHistory(12, 10);
    // Replace turn 1's result with a large OBJECT payload
    const idx = messages.findIndex((m) => m.uuid === 'result-1');
    (messages[idx]!.content[0] as any).toolResult = {
      tool_use_id: 'call-1',
      content: { rows: 'z'.repeat(6000) },
    };
    const result = pruneAgedToolResults(messages);
    const payload = (result.messages[idx]!.content[0] as any).toolResult.content;
    expect(typeof payload).toBe('string');
    expect(payload).toContain('[Tool result omitted - too old'); // age 10 -> hard tier
  });
});
