/**
 * Sliding window must not orphan tool_result messages.
 *
 * When the context budget trims older messages via sliding-window,
 * it can cut an assistant message (with tool_calls) while keeping its
 * subsequent tool_result user messages. Chat/completions APIs reject
 * `tool` role messages not preceded by an assistant with `tool_calls`.
 *
 * stripLeadingOrphanedToolResults removes any leading tool_result-only
 * user messages from the window so the remaining history is structurally
 * valid for all API patterns.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ContextBudgetManager } from '../ContextBudgetManager.js';
import { TokenCounter } from '../../utils/TokenCounter.js';
import type { ModelConfig } from '../../models/ModelConfig.interface.js';
import type { Message } from '../../session/MessageTypes.js';

const SMALL_MODEL: ModelConfig = {
  id: 'test-small',
  provider: 'deepseek',
  displayName: 'Test Small',
  family: 'test',
  contextWindow: 4000,
  outputTokens: 1000,
  api: { pattern: 'chat/completions', endpoint: 'x', apiKeyEnvVar: 'X', authHeader: 'x' },
  tools: { supported: true, adapter: 'ChatCompletionsAPIAdapter', namingConvention: 'snake_case', maxTools: 64, parallelToolCalls: true },
  reasoning: { supported: false },
  streaming: { supported: true },
  compaction: {
    strategy: 'auto',
    thresholdCalculation: { method: 'percentage', percentage: 0.8, safetyMargin: 200 },
    behavior: { preserveRecent: 4, compactOlder: false, useHelperModel: false },
  },
} as any;

let idCounter = 0;
const uid = () => `uuid-${++idCounter}`;

const userTextMsg = (text: string): Message => ({
  uuid: uid(),
  timestamp: new Date().toISOString(),
  type: 'user',
  message: { role: 'user', content: text },
} as any);

const assistantToolUseMsg = (toolNames: string[]): Message => ({
  uuid: uid(),
  timestamp: new Date().toISOString(),
  type: 'assistant',
  message: {
    role: 'assistant',
    content: toolNames.map(name => ({
      type: 'tool_use',
      toolUse: { id: `call_${uid()}`, name, input: {} },
    })),
  },
} as any);

const userToolResultMsg = (toolUseId: string): Message => ({
  uuid: uid(),
  timestamp: new Date().toISOString(),
  type: 'user',
  message: {
    role: 'user',
    content: [{
      type: 'tool_result',
      tool_use_id: toolUseId,
      toolResult: { tool_use_id: toolUseId, content: 'x'.repeat(200), is_error: false },
    }],
  },
} as any);

const assistantTextMsg = (text: string): Message => ({
  uuid: uid(),
  timestamp: new Date().toISOString(),
  type: 'assistant',
  message: { role: 'assistant', content: [{ type: 'text', text }] },
} as any);

describe('sliding window strips orphaned tool_result messages', () => {
  let mgr: ContextBudgetManager;

  beforeEach(() => {
    idCounter = 0;
    mgr = new ContextBudgetManager();
    (mgr as any).modelConfig = SMALL_MODEL;
    vi.spyOn(TokenCounter, 'count').mockReturnValue({
      tokens: 100,
      method: 'tiktoken' as any,
      modelId: SMALL_MODEL.id,
    } as any);
  });

  it('strips leading tool_result messages when assistant is trimmed', () => {
    const assistant = assistantToolUseMsg(['Read', 'Read']);
    const content = (assistant as any).message.content;
    const id1 = content[0].toolUse.id;
    const id2 = content[1].toolUse.id;

    const messages: Message[] = [
      userTextMsg('initial prompt'),
      assistant,
      userToolResultMsg(id1),
      userToolResultMsg(id2),
      assistantTextMsg('Here are the results...'),
      userTextMsg('follow-up question'),
      assistantTextMsg('follow-up answer'),
    ];

    // Budget for 2 messages (200 tokens). minRecentMessages: 1 overrides
    // MIN_RECENT_MESSAGES=5 so budget pressure actually forces trimming.
    // The tool_use group (assistant+2 results = 300 tokens) exceeds budget,
    // so the window takes only the tail — orphaned tool_results must be stripped.
    const selected = mgr.selectMessages(messages, 200, { strategy: 'sliding-window', minRecentMessages: 1 }, SMALL_MODEL);

    const firstContent = (selected[0] as any).message?.content;
    const isToolResult = Array.isArray(firstContent) &&
      firstContent.every((b: any) => b.type === 'tool_result');

    expect(isToolResult).toBe(false);
    expect(selected.length).toBeLessThan(messages.length);
  });

  it('does NOT strip when tool_result follows its assistant', () => {
    const assistant = assistantToolUseMsg(['Read']);
    const id1 = (assistant as any).message.content[0].toolUse.id;

    const messages: Message[] = [
      userTextMsg('prompt'),
      assistant,
      userToolResultMsg(id1),
      assistantTextMsg('Done'),
    ];

    const selected = mgr.selectMessages(messages, 10000, { strategy: 'sliding-window' }, SMALL_MODEL);
    expect(selected.length).toBe(4);
  });

  it('strips multiple consecutive orphaned tool_result messages', () => {
    const assistant = assistantToolUseMsg(['Read', 'Grep', 'Bash']);
    const content = (assistant as any).message.content;

    const messages: Message[] = [
      userTextMsg('prompt'),
      assistant,
      userToolResultMsg(content[0].toolUse.id),
      userToolResultMsg(content[1].toolUse.id),
      userToolResultMsg(content[2].toolUse.id),
      assistantTextMsg('intermediate summary'),
      userTextMsg('another question'),
      assistantTextMsg('final answer'),
    ];

    // Budget for 2 messages (200 tokens). minRecentMessages: 1 ensures
    // budget pressure forces trimming past the tool group.
    const selected = mgr.selectMessages(messages, 200, { strategy: 'sliding-window', minRecentMessages: 1 }, SMALL_MODEL);

    expect(selected.length).toBeLessThan(messages.length);

    for (const msg of selected) {
      const c = (msg as any).message?.content;
      if (Array.isArray(c) && c.every((b: any) => b.type === 'tool_result')) {
        const assistantPresent = selected.some((m: any) => {
          const mc = m.message?.content;
          return Array.isArray(mc) && mc.some((b: any) => b.type === 'tool_use');
        });
        expect(assistantPresent).toBe(true);
      }
    }
  });
});
