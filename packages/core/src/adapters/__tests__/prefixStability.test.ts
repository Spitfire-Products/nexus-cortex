/**
 * Item 11d — the CACHE-COMPLIANCE CONTRACT's enforcement test
 * (HARNESS_IMPROVEMENT_BACKLOG).
 *
 * Provider prompt caches (the 10-13x cost multiplier measured on TB2) require
 * the serialized request prefix to be BYTE-STABLE across tool-loop
 * iterations: appending new turns must never change how earlier messages
 * convert. This test asserts per-message conversion purity — converting a
 * history H and an extended history H+Δ must yield identical output for the
 * shared prefix. Any middleware/adapter change that makes conversion depend
 * on later messages (or on call-order state) fails here instead of silently
 * costing the cache multiplier in production.
 *
 * Also regression-guards the item-9 delivery shape: a user message carrying
 * [tool_result, text] (the deferred-corpus lift delivery) must emit BOTH the
 * tool message AND the user text — verified live on the 4.72.0 smoke
 * (DEBUG_PAYLOAD: 28.7KB corpus on the wire).
 */
import { describe, it, expect } from 'vitest';
import { ChatCompletionsAPIAdapter } from '../ChatCompletionsAPIAdapter.js';
import type { ModelConfig } from '../../models/ModelConfig.interface.js';

const model = {
  id: 'deepseek-v4-flash',
  api: { pattern: 'chat/completions' },
  reasoning: { supported: true, format: 'reasoning_content', extractionMethod: 'separate_field', pattern: 'interleaved' },
  tools: { supported: true },
  streaming: { supported: true },
} as unknown as ModelConfig;

const user = (text: string) => ({
  role: 'user', content: [{ type: 'text', text }],
});
const assistantTool = (id: string, cmd: string) => ({
  role: 'assistant',
  content: [{ type: 'tool_use', toolUse: { id, name: 'Bash', input: { command: cmd } } }],
});
const toolResult = (id: string, out: string, extraText?: string) => ({
  role: 'user',
  content: [
    { type: 'tool_result', toolResult: { toolUseId: id, content: [{ type: 'text', text: out }], is_error: false } },
    ...(extraText ? [{ type: 'text', text: extraText }] : []),
  ],
});

describe('cache-compliance: conversion prefix stability (item 11d)', () => {
  const adapter = new ChatCompletionsAPIAdapter();

  it('appending turns never changes how earlier messages convert', () => {
    const H = [
      user('run the tests'),
      assistantTool('t1', 'npm test'),
      toolResult('t1', 'all green'),
      assistantTool('t2', 'ls'),
    ] as any[];
    const delta = [
      toolResult('t2', 'a.ts b.ts'),
      assistantTool('t3', 'cat a.ts'),
    ] as any[];

    const out1 = adapter.toProviderMessages(H, model);
    const out2 = adapter.toProviderMessages([...H, ...delta], model);

    // the shared prefix must convert byte-identically
    expect(out2.length).toBeGreaterThan(out1.length);
    expect(JSON.stringify(out2.slice(0, out1.length)))
      .toBe(JSON.stringify(out1));
  });

  it('conversion is call-order pure (no internal state leaks between calls)', () => {
    const H = [user('hi'), assistantTool('x1', 'pwd'), toolResult('x1', '/app')] as any[];
    const a = JSON.stringify(adapter.toProviderMessages(H, model));
    // interleave an unrelated conversion, then repeat
    adapter.toProviderMessages([user('other')] as any[], model);
    const b = JSON.stringify(adapter.toProviderMessages(H, model));
    expect(b).toBe(a);
  });

  it('mixed [tool_result, text] user message emits BOTH tool msg and user text (item 9 delivery shape)', () => {
    const corpus = '<system-reminder>\nFull session context follows.\n</system-reminder>\nTOOL GUIDE BODY HERE';
    const H = [
      user('task'),
      assistantTool('t1', 'sh .cortex/orient'),
      toolResult('t1', 'WORKSPACE MAP...', corpus),
    ] as any[];
    const out = adapter.toProviderMessages(H, model);
    const roles = out.map(m => m.role);
    expect(roles).toContain('tool');
    const userTail = out.filter(m => m.role === 'user').map(m => m.content).join('\n');
    expect(userTail).toContain('TOOL GUIDE BODY HERE'); // corpus survives conversion
  });
});
