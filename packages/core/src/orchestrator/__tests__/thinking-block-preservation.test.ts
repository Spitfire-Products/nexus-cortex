/**
 * Thinking Block Preservation Tests
 *
 * Phase 2.8: Validate that thinking blocks are preserved during history conversion
 * Critical bug fix: thinking blocks were being stringified into text during convertToCanonicalMessages()
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createOrchestrator } from '../OrchestratorFactory.js';
import type { CortexOrchestrator } from '../CortexOrchestrator.js';
import type { Message } from '../../session/MessageTypes.js';

describe('Thinking Block Preservation', () => {
  let orchestrator: CortexOrchestrator;

  beforeEach(async () => {
    orchestrator = await createOrchestrator({
      defaultModelId: 'claude-sonnet-4-5-20250929',
      projectPath: '/tmp/test-thinking-preservation',
      storageDir: '/tmp/test-thinking-preservation/.claude',
      debug: false
    });

    await orchestrator.createSession('/tmp/test-thinking-preservation');
  });

  // Note: `convertToCanonicalMessages` runs validate-and-repair afterwards,
  // which appends a synthetic user message (tool_result with is_error: true)
  // whenever an assistant message has an orphaned `tool_use`. The test inputs
  // below contain orphaned tool_use blocks (no following user message with
  // matching tool_result), so the converter correctly emits N+1 messages —
  // the original assistant message plus a synthetic repair message.
  // We assert on the assistant message specifically (looked up by uuid).
  it('should preserve thinking blocks in convertToCanonicalMessages', () => {
    // Simulate an assistant message with interleaved thinking
    const assistantMessage: Message = {
      uuid: 'msg-123',
      timestamp: new Date().toISOString(),
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'Let me analyze the file structure first...' },
          { type: 'text', text: 'I should use the Glob tool to find TypeScript files.' },
          { type: 'tool_use', id: 'tool-456', name: 'Glob', input: { pattern: '**/*.ts' } }
        ]
      },
      model: {
        id: 'claude-sonnet-4-5-20250929',
        provider: 'anthropic',
        apiPattern: 'messages'
      }
    } as any;

    // Access the private method via type casting
    const convertToCanonicalMessages = (orchestrator as any).convertToCanonicalMessages.bind(orchestrator);
    const canonicalMessages = convertToCanonicalMessages([assistantMessage]);

    // Find the original assistant message (orphan-repair may append extras).
    const canonical = canonicalMessages.find((m: any) => m.uuid === 'msg-123');
    expect(canonical).toBeDefined();
    expect(canonical.content).toHaveLength(3);

    // Validate thinking block is preserved (not stringified)
    expect(canonical.content[0].type).toBe('thinking');
    expect(canonical.content[0].thinking).toBe('Let me analyze the file structure first...');

    // Validate text block
    expect(canonical.content[1].type).toBe('text');
    expect(canonical.content[1].text).toBe('I should use the Glob tool to find TypeScript files.');

    // Validate tool_use block
    expect(canonical.content[2].type).toBe('tool_use');
    expect(canonical.content[2].toolUse?.name).toBe('Glob');
  });

  it('should preserve interleaved thinking order during conversion', () => {
    // Multiple thinking blocks interleaved with text and tool use
    const assistantMessage: Message = {
      uuid: 'msg-789',
      timestamp: new Date().toISOString(),
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'First, I need to understand the codebase structure.' },
          { type: 'text', text: 'Let me search for files.' },
          { type: 'thinking', thinking: 'I should use Glob for pattern matching.' },
          { type: 'tool_use', id: 'tool-1', name: 'Glob', input: { pattern: '*.ts' } },
          { type: 'thinking', thinking: 'Now I should read the main file.' },
          { type: 'tool_use', id: 'tool-2', name: 'Read', input: { filePath: 'main.ts' } }
        ]
      },
      model: {
        id: 'claude-sonnet-4-5-20250929',
        provider: 'anthropic',
        apiPattern: 'messages'
      }
    } as any;

    const convertToCanonicalMessages = (orchestrator as any).convertToCanonicalMessages.bind(orchestrator);
    const canonicalMessages = convertToCanonicalMessages([assistantMessage]);

    // Orphan repair may append extras — locate the original by uuid.
    const canonical = canonicalMessages.find((m: any) => m.uuid === 'msg-789');
    expect(canonical).toBeDefined();
    expect(canonical.content).toHaveLength(6);

    // Verify exact order and types
    expect(canonical.content[0].type).toBe('thinking');
    expect(canonical.content[0].thinking).toBe('First, I need to understand the codebase structure.');

    expect(canonical.content[1].type).toBe('text');
    expect(canonical.content[1].text).toBe('Let me search for files.');

    expect(canonical.content[2].type).toBe('thinking');
    expect(canonical.content[2].thinking).toBe('I should use Glob for pattern matching.');

    expect(canonical.content[3].type).toBe('tool_use');
    expect(canonical.content[3].toolUse?.name).toBe('Glob');

    expect(canonical.content[4].type).toBe('thinking');
    expect(canonical.content[4].thinking).toBe('Now I should read the main file.');

    expect(canonical.content[5].type).toBe('tool_use');
    expect(canonical.content[5].toolUse?.name).toBe('Read');
  });

  it('should handle messages without thinking blocks', () => {
    // Regular message without thinking
    const assistantMessage: Message = {
      uuid: 'msg-abc',
      timestamp: new Date().toISOString(),
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Here is the result.' }
        ]
      },
      model: {
        id: 'claude-haiku-20240307',
        provider: 'anthropic',
        apiPattern: 'messages'
      }
    } as any;

    const convertToCanonicalMessages = (orchestrator as any).convertToCanonicalMessages.bind(orchestrator);
    const canonicalMessages = convertToCanonicalMessages([assistantMessage]);

    expect(canonicalMessages).toHaveLength(1);
    expect(canonicalMessages[0].content).toHaveLength(1);
    expect(canonicalMessages[0].content[0].type).toBe('text');
  });

  it('should not stringify thinking blocks into text', () => {
    // This test validates the bug fix
    const assistantMessage: Message = {
      uuid: 'msg-bug-test',
      timestamp: new Date().toISOString(),
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'Critical reasoning content' }
        ]
      },
      model: {
        id: 'claude-sonnet-4-5-20250929',
        provider: 'anthropic',
        apiPattern: 'messages'
      }
    } as any;

    const convertToCanonicalMessages = (orchestrator as any).convertToCanonicalMessages.bind(orchestrator);
    const canonicalMessages = convertToCanonicalMessages([assistantMessage]);

    const content = canonicalMessages[0].content[0];

    // Before fix: type would be 'text' with stringified JSON like '{"type":"thinking","thinking":"..."}'
    // After fix: type should be 'thinking' with actual thinking content
    expect(content.type).toBe('thinking');
    expect(content.thinking).toBe('Critical reasoning content');

    // Should NOT be a text block with stringified thinking
    expect(content.type).not.toBe('text');
    expect(content.text).toBeUndefined();

    // The key validation: thinking is a direct property, not nested within stringified JSON
    // Before fix: { type: 'text', text: '{"type":"thinking","thinking":"..."}' }
    // After fix: { type: 'thinking', thinking: '...' }
    expect(typeof content.thinking).toBe('string');
    expect(content.thinking).not.toContain('"type"'); // thinking content should be plain string, not JSON
  });

  // #19 (2026-05-11) — convertToCanonicalMessages must preserve
  // `thinkingMetadata.source` so the adapter's signature-aware drop logic
  // (MessagesAPIAdapter #16) classifies extended-thinking blocks correctly.
  // Without this, in-memory continuations get classified as 'native' and
  // signature-less extended blocks are sent to Anthropic, which rejects
  // with `thinking.signature: Field required`.
  it('preserves thinkingMetadata.source through history conversion (#19)', () => {
    const assistantMessage: Message = {
      uuid: 'msg-19',
      timestamp: new Date().toISOString(),
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          {
            type: 'thinking',
            thinking: 'Extended reasoning content',
            signature: 'sig_abc123',
            thinkingMetadata: { source: 'extended' },
          },
          { type: 'text', text: 'Visible answer.' },
        ],
      },
      model: {
        id: 'claude-opus-4-6',
        provider: 'anthropic',
        apiPattern: 'messages',
      },
    } as any;

    const convertToCanonicalMessages = (orchestrator as any).convertToCanonicalMessages.bind(orchestrator);
    const canonicalMessages = convertToCanonicalMessages([assistantMessage]);

    const canonical = canonicalMessages.find((m: any) => m.uuid === 'msg-19');
    expect(canonical).toBeDefined();
    const thinking = canonical.content.find((b: any) => b.type === 'thinking');
    expect(thinking).toBeDefined();
    expect(thinking.signature).toBe('sig_abc123');
    expect(thinking.thinkingMetadata).toEqual({ source: 'extended' });
  });

  it('preserves thinkingMetadata even when signature is absent (#19)', () => {
    // Same case minus signature: this is the path that previously got
    // mis-classified as 'native' and sent to Anthropic.
    const assistantMessage: Message = {
      uuid: 'msg-19b',
      timestamp: new Date().toISOString(),
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          {
            type: 'thinking',
            thinking: 'Extended reasoning, signature lost in transit',
            thinkingMetadata: { source: 'extended' },
          },
        ],
      },
      model: {
        id: 'claude-opus-4-6',
        provider: 'anthropic',
        apiPattern: 'messages',
      },
    } as any;

    const convertToCanonicalMessages = (orchestrator as any).convertToCanonicalMessages.bind(orchestrator);
    const canonicalMessages = convertToCanonicalMessages([assistantMessage]);

    const canonical = canonicalMessages.find((m: any) => m.uuid === 'msg-19b');
    const thinking = canonical.content.find((b: any) => b.type === 'thinking');
    expect(thinking).toBeDefined();
    expect(thinking.signature).toBeUndefined();
    // Metadata must survive so the adapter can decide to drop the block.
    expect(thinking.thinkingMetadata).toEqual({ source: 'extended' });
  });

  // #29 (2026-05-11) — Cache control breakpoint must survive the
  // ContentBlock → CanonicalContentBlock conversion. SystemMessageMiddleware
  // attaches cache_control to the last prepend reminder for Anthropic/XAI,
  // and stripping it during canonical conversion would silently kill prompt
  // caching across requests.
  it('preserves cache_control on text blocks through canonical conversion (#29)', () => {
    const userMessage: Message = {
      uuid: 'msg-29',
      timestamp: new Date().toISOString(),
      type: 'user',
      message: {
        role: 'user',
        content: [
          { type: 'text', text: 'first reminder' },
          // The middleware marks the last prepend like this:
          { type: 'text', text: 'last reminder', cache_control: { type: 'ephemeral' } },
          { type: 'text', text: 'actual user query' },
        ],
      },
    } as any;

    const convertToCanonicalMessages = (orchestrator as any).convertToCanonicalMessages.bind(orchestrator);
    const canonicalMessages = convertToCanonicalMessages([userMessage]);

    const canonical = canonicalMessages.find((m: any) => m.uuid === 'msg-29');
    expect(canonical).toBeDefined();
    expect(canonical.content[0].cache_control).toBeUndefined();
    expect(canonical.content[1].cache_control).toEqual({ type: 'ephemeral' });
    expect(canonical.content[2].cache_control).toBeUndefined();
  });
});
