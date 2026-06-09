import { describe, it, expect, beforeEach } from 'vitest';
import { ContextBudgetManager } from '../ContextBudgetManager.js';
import type { Message } from '../../session/MessageTypes.js';

let idCounter = 0;
const uid = () => `uuid-${++idCounter}`;

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
      toolResult: { tool_use_id: toolUseId, content: 'result', is_error: false },
    }],
  },
} as any);

const userTextMsg = (text: string): Message => ({
  uuid: uid(),
  timestamp: new Date().toISOString(),
  type: 'user',
  message: { role: 'user', content: text },
} as any);

const assistantTextMsg = (text: string): Message => ({
  uuid: uid(),
  timestamp: new Date().toISOString(),
  type: 'assistant',
  message: { role: 'assistant', content: [{ type: 'text', text }] },
} as any);

describe('groupToolPairs', () => {
  let mgr: ContextBudgetManager;

  beforeEach(() => {
    idCounter = 0;
    mgr = new ContextBudgetManager();
  });

  it('groups an assistant message with tool_use blocks together with its consecutive tool_result user messages', () => {
    const assistant = assistantToolUseMsg(['Read', 'Grep']);
    const content = (assistant as any).message.content;
    const id1 = content[0].toolUse.id;
    const id2 = content[1].toolUse.id;

    const messages: Message[] = [
      userTextMsg('initial prompt'),
      assistant,
      userToolResultMsg(id1),
      userToolResultMsg(id2),
      assistantTextMsg('summary'),
    ];

    const groups: Message[][] = (mgr as any).groupToolPairs(messages);

    expect(groups).toHaveLength(3);

    // Group 0: standalone user text message
    expect(groups[0]).toHaveLength(1);
    expect(groups[0]![0]!.type).toBe('user');

    // Group 1: assistant + its two tool_result messages
    expect(groups[1]).toHaveLength(3);
    expect(groups[1]![0]!.type).toBe('assistant');
    const g1Content = (groups[1]![0] as any).message.content;
    expect(g1Content.some((b: any) => b.type === 'tool_use')).toBe(true);
    expect(groups[1]![1]!.type).toBe('user');
    expect(groups[1]![2]!.type).toBe('user');
    const g1r1Content = (groups[1]![1] as any).message.content;
    const g1r2Content = (groups[1]![2] as any).message.content;
    expect(g1r1Content.every((b: any) => b.type === 'tool_result')).toBe(true);
    expect(g1r2Content.every((b: any) => b.type === 'tool_result')).toBe(true);

    // Group 2: standalone assistant text message
    expect(groups[2]).toHaveLength(1);
    expect(groups[2]![0]!.type).toBe('assistant');
  });

  it('stops collecting tool_results when a regular user message is encountered', () => {
    const assistant = assistantToolUseMsg(['Read']);
    const id1 = (assistant as any).message.content[0].toolUse.id;

    const messages: Message[] = [
      assistant,
      userToolResultMsg(id1),
      userTextMsg('interrupting question'),
      assistantTextMsg('answer'),
    ];

    const groups: Message[][] = (mgr as any).groupToolPairs(messages);

    expect(groups).toHaveLength(3);

    // Group 0: assistant + its single tool_result (stopped before interrupt)
    expect(groups[0]).toHaveLength(2);
    expect(groups[0]![0]!.type).toBe('assistant');
    expect(groups[0]![1]!.type).toBe('user');
    const g0rContent = (groups[0]![1] as any).message.content;
    expect(g0rContent.every((b: any) => b.type === 'tool_result')).toBe(true);

    // Group 1: standalone user text message
    expect(groups[1]).toHaveLength(1);
    expect(groups[1]![0]!.type).toBe('user');

    // Group 2: standalone assistant text message
    expect(groups[2]).toHaveLength(1);
    expect(groups[2]![0]!.type).toBe('assistant');
  });

  it('groups an assistant message without tool_use content blocks as its own single-element group', () => {
    const messages: Message[] = [
      userTextMsg('hello'),
      assistantTextMsg('plain response'),
      userTextMsg('follow up'),
    ];

    const groups: Message[][] = (mgr as any).groupToolPairs(messages);

    expect(groups).toHaveLength(3);

    // Each group should be a single element
    expect(groups[0]).toHaveLength(1);
    expect(groups[0]![0]!.type).toBe('user');

    expect(groups[1]).toHaveLength(1);
    expect(groups[1]![0]!.type).toBe('assistant');
    const g1Content = (groups[1]![0] as any).message.content;
    expect(Array.isArray(g1Content) && g1Content.some((b: any) => b.type === 'tool_use')).toBe(false);

    expect(groups[2]).toHaveLength(1);
    expect(groups[2]![0]!.type).toBe('user');
  });

  it('returns an empty array when given an empty messages array', () => {
    const messages: Message[] = [];

    const groups: Message[][] = (mgr as any).groupToolPairs(messages);

    expect(groups).toEqual([]);
  });

  it('preserves original message order within each group', () => {
    const assistant = assistantToolUseMsg(['Read', 'Bash', 'Grep']);
    const content = (assistant as any).message.content;
    const id1 = content[0].toolUse.id;
    const id2 = content[1].toolUse.id;
    const id3 = content[2].toolUse.id;

    const messages: Message[] = [
      assistant,
      userToolResultMsg(id1),
      userToolResultMsg(id2),
      userToolResultMsg(id3),
    ];

    const groups: Message[][] = (mgr as any).groupToolPairs(messages);

    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(4);
    expect((groups[0]![0] as any).message.content[0].type).toBe('tool_use');
    expect((groups[0]![1] as any).message.content[0].type).toBe('tool_result');
    expect((groups[0]![2] as any).message.content[0].type).toBe('tool_result');
    expect((groups[0]![3] as any).message.content[0].type).toBe('tool_result');
  });
});
