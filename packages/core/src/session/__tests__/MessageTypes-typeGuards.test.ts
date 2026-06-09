/**
 * Tests for isToolUseMessage() and isToolResultMessage() type guards
 *
 * These guards identify messages that contain tool-related content blocks
 * within their message.content array:
 * - isToolUseMessage:  assistant messages with at least one tool_use block
 * - isToolResultMessage: user messages with at least one tool_result block
 */

import { describe, it, expect } from 'vitest';
import {
  isToolUseMessage,
  isToolResultMessage,
  isAssistantMessage,
  isUserMessage,
  isSystemMessage,
} from '../MessageTypes.js';
import type {
  Message,
  AssistantMessage,
  UserMessage,
  SystemMessage,
} from '../MessageTypes.js';

// ---------------------------------------------------------------------------
// Helpers — construct minimal messages that satisfy the Message union type
// ---------------------------------------------------------------------------

function assistantMessage(
  content: string | unknown[],
  overrides: Partial<AssistantMessage> = {},
): Message {
  return {
    uuid: 'uuid-assistant',
    timestamp: '2025-01-01T00:00:00.000Z',
    type: 'assistant',
    message: { role: 'assistant', content: content as string | any[] },
    ...overrides,
  } as Message;
}

function userMessage(
  content: string | unknown[],
  overrides: Partial<UserMessage> = {},
): Message {
  return {
    uuid: 'uuid-user',
    timestamp: '2025-01-01T00:00:00.000Z',
    type: 'user',
    message: { role: 'user', content: content as string | any[] },
    ...overrides,
  } as Message;
}

function systemMessage(
  overrides: Partial<SystemMessage> = {},
): Message {
  return {
    uuid: 'uuid-system',
    timestamp: '2025-01-01T00:00:00.000Z',
    type: 'system',
    content: 'System message content',
    ...overrides,
  } as Message;
}

// ---------------------------------------------------------------------------
// Content-block factories
// ---------------------------------------------------------------------------

function textBlock(text = 'Hello') {
  return { type: 'text' as const, text };
}

function toolUseBlock(id = 'toolu_abc123', name = 'read', input: Record<string, unknown> = { path: '/tmp/foo' }) {
  return { type: 'tool_use' as const, id, name, input };
}

function toolResultBlock(
  toolUseId = 'toolu_abc123',
  content = 'Result content',
  isError = false,
) {
  return { type: 'tool_result' as const, tool_use_id: toolUseId, content, is_error: isError };
}

// =========================================================================
// isToolUseMessage
// =========================================================================

describe('isToolUseMessage', () => {
  // ── Positive cases ──────────────────────────────────────────────────

  it('returns true for assistant message with a tool_use content block', () => {
    const msg = assistantMessage([toolUseBlock()]);
    expect(isToolUseMessage(msg)).toBe(true);
  });

  it('returns true for assistant message with tool_use at the start of the array', () => {
    const msg = assistantMessage([toolUseBlock(), textBlock('Follow-up')]);
    expect(isToolUseMessage(msg)).toBe(true);
  });

  it('returns true for assistant message with tool_use at the end of the array', () => {
    const msg = assistantMessage([textBlock('Reasoning'), toolUseBlock()]);
    expect(isToolUseMessage(msg)).toBe(true);
  });

  it('returns true for assistant message with multiple tool_use blocks', () => {
    const msg = assistantMessage([
      toolUseBlock('toolu_001', 'read', { path: '/a' }),
      toolUseBlock('toolu_002', 'write', { path: '/b', content: 'data' }),
      toolUseBlock('toolu_003', 'bash', { command: 'ls' }),
    ]);
    expect(isToolUseMessage(msg)).toBe(true);
  });

  it('returns true for assistant message with mixed text + tool_use blocks (mixed content)', () => {
    const msg = assistantMessage([
      textBlock('Let me check that file.'),
      toolUseBlock(),
      textBlock('Here is what I found.'),
    ]);
    expect(isToolUseMessage(msg)).toBe(true);
  });

  // ── Negative cases ──────────────────────────────────────────────────

  it('returns false for assistant message with only text content blocks', () => {
    const msg = assistantMessage([textBlock('Hello'), textBlock('World')]);
    expect(isToolUseMessage(msg)).toBe(false);
  });

  it('returns false for assistant message with string content (not array)', () => {
    const msg = assistantMessage('Just a plain string response');
    expect(isToolUseMessage(msg)).toBe(false);
  });

  it('returns false for assistant message with empty content array', () => {
    const msg = assistantMessage([]);
    expect(isToolUseMessage(msg)).toBe(false);
  });

  it('returns false for assistant message with only tool_result blocks', () => {
    const msg = assistantMessage([toolResultBlock()]);
    expect(isToolUseMessage(msg)).toBe(false);
  });

  it('returns false for user message (wrong role) even with tool_use blocks', () => {
    const msg = userMessage([toolUseBlock()]);
    expect(isToolUseMessage(msg)).toBe(false);
  });

  it('returns false for user message with string content', () => {
    const msg = userMessage('A plain user message');
    expect(isToolUseMessage(msg)).toBe(false);
  });

  it('returns false for system messages', () => {
    expect(isToolUseMessage(systemMessage())).toBe(false);
  });

  it('returns false for system message with compact boundary subtype', () => {
    const msg = systemMessage({ subtype: 'compact_boundary', content: 'Conversation compacted' as any });
    expect(isToolUseMessage(msg)).toBe(false);
  });

  it('returns false for user message with tool_result blocks (not tool_use)', () => {
    const msg = userMessage([toolResultBlock()]);
    expect(isToolUseMessage(msg)).toBe(false);
  });

  // ── Edge cases ──────────────────────────────────────────────────────

  it('returns false when content is null or undefined (type narrowing safety)', () => {
    // These are structurally valid but exercise the guard's defensive logic
    const msg1 = assistantMessage(null as unknown as string);
    const msg2 = assistantMessage(undefined as unknown as string);
    expect(isToolUseMessage(msg1)).toBe(false);
    expect(isToolUseMessage(msg2)).toBe(false);
  });

  it('returns false for assistant message with content containing only unknown block types', () => {
    const msg = assistantMessage([
      { type: 'thinking', thinking: 'hmm' },
      { type: 'redacted_thinking', data: 'REDACTED' },
    ]);
    expect(isToolUseMessage(msg)).toBe(false);
  });
});

// =========================================================================
// isToolResultMessage
// =========================================================================

describe('isToolResultMessage', () => {
  // ── Positive cases ──────────────────────────────────────────────────

  it('returns true for user message with a tool_result content block', () => {
    const msg = userMessage([toolResultBlock()]);
    expect(isToolResultMessage(msg)).toBe(true);
  });

  it('returns true for user message with tool_result at the start of the array', () => {
    const msg = userMessage([toolResultBlock(), textBlock('Here is the file.')]);
    expect(isToolResultMessage(msg)).toBe(true);
  });

  it('returns true for user message with tool_result at the end of the array', () => {
    const msg = userMessage([textBlock('Processing...'), toolResultBlock()]);
    expect(isToolResultMessage(msg)).toBe(true);
  });

  it('returns true for user message with multiple tool_result blocks', () => {
    const msg = userMessage([
      toolResultBlock('toolu_001', 'Output A'),
      toolResultBlock('toolu_002', 'Output B', true),  // one with error
    ]);
    expect(isToolResultMessage(msg)).toBe(true);
  });

  it('returns true for user message with mixed text + tool_result blocks', () => {
    const msg = userMessage([
      textBlock('Here are the results:'),
      toolResultBlock(),
      textBlock('Let me know if you need more.'),
    ]);
    expect(isToolResultMessage(msg)).toBe(true);
  });

  // ── Negative cases ──────────────────────────────────────────────────

  it('returns false for user message with only text content blocks', () => {
    const msg = userMessage([textBlock('Hello'), textBlock('World')]);
    expect(isToolResultMessage(msg)).toBe(false);
  });

  it('returns false for user message with string content (not array)', () => {
    const msg = userMessage('Just a plain text user message');
    expect(isToolResultMessage(msg)).toBe(false);
  });

  it('returns false for user message with empty content array', () => {
    const msg = userMessage([]);
    expect(isToolResultMessage(msg)).toBe(false);
  });

  it('returns false for user message with only tool_use blocks (wrong block type)', () => {
    const msg = userMessage([toolUseBlock()]);
    expect(isToolResultMessage(msg)).toBe(false);
  });

  it('returns false for assistant message (wrong role) even with tool_result blocks', () => {
    const msg = assistantMessage([toolResultBlock()]);
    expect(isToolResultMessage(msg)).toBe(false);
  });

  it('returns false for assistant message with string content', () => {
    const msg = assistantMessage('A plain assistant response');
    expect(isToolResultMessage(msg)).toBe(false);
  });

  it('returns false for system messages', () => {
    expect(isToolResultMessage(systemMessage())).toBe(false);
  });

  it('returns false for system message with compact boundary subtype', () => {
    const msg = systemMessage({ subtype: 'compact_boundary', content: 'Conversation compacted' as any });
    expect(isToolResultMessage(msg)).toBe(false);
  });

  // ── Edge cases ──────────────────────────────────────────────────────

  it('returns false when content is null or undefined (type narrowing safety)', () => {
    const msg1 = userMessage(null as unknown as string);
    const msg2 = userMessage(undefined as unknown as string);
    expect(isToolResultMessage(msg1)).toBe(false);
    expect(isToolResultMessage(msg2)).toBe(false);
  });

  it('returns false for user message with content containing only unknown block types', () => {
    const msg = userMessage([
      { type: 'thinking', thinking: 'hmm' },
    ]);
    expect(isToolResultMessage(msg)).toBe(false);
  });

  it('returns false for user message with tool_result in a string-typed content (not array)', () => {
    // When content is a plain string that happens to look like tool_result — still false
    const msg = userMessage(JSON.stringify({ type: 'tool_result', tool_use_id: 'abc' }));
    expect(isToolResultMessage(msg)).toBe(false);
  });
});

// =========================================================================
// Cross-guard sanity checks — the two guards should not overlap
// =========================================================================

describe('type guard exclusivity', () => {
  it('isToolUseMessage and isToolResultMessage are mutually exclusive for any message', () => {
    const assistantToolMsg = assistantMessage([toolUseBlock()]);
    const userToolMsg = userMessage([toolResultBlock()]);
    const textOnlyAssistant = assistantMessage([textBlock('Hi')]);
    const textOnlyUser = userMessage([textBlock('Hi')]);
    const sysMsg = systemMessage();

    // Only the correct guard returns true for each
    expect(isToolUseMessage(assistantToolMsg)).toBe(true);
    expect(isToolResultMessage(assistantToolMsg)).toBe(false);

    expect(isToolResultMessage(userToolMsg)).toBe(true);
    expect(isToolUseMessage(userToolMsg)).toBe(false);

    expect(isToolUseMessage(textOnlyAssistant)).toBe(false);
    expect(isToolResultMessage(textOnlyAssistant)).toBe(false);

    expect(isToolUseMessage(textOnlyUser)).toBe(false);
    expect(isToolResultMessage(textOnlyUser)).toBe(false);

    expect(isToolUseMessage(sysMsg)).toBe(false);
    expect(isToolResultMessage(sysMsg)).toBe(false);
  });
});
