/**
 * Image-path bridge (backlog item 7) — adapter conversion tests.
 *
 * The contract under test: a canonical {type:'image'} block in a USER message
 * renders as a provider-dialect image part ONLY for probe-verified vision
 * cards; every other card keeps the byte-identical plain-string wire, and
 * tool messages never carry image parts.
 */

import { describe, it, expect } from 'vitest';
import { ChatCompletionsAPIAdapter } from '../ChatCompletionsAPIAdapter';
import { MessagesAPIAdapter } from '../MessagesAPIAdapter';
import type { CanonicalMessage } from '../FormatAdapter.interface';
import { ModelConfig } from '../../models/ModelConfig.interface';

const PNG_B64 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString('base64');

const baseCfg = (over: Partial<ModelConfig>): ModelConfig =>
  ({
    id: 'deepseek-v4-flash-vision-exp',
    provider: 'deepseek',
    displayName: 'x',
    family: 'deepseek-v4',
    tools: {
      supported: true,
      adapter: 'ChatCompletionsAPIAdapter',
      namingConvention: 'snake_case',
      maxTools: 128,
      parallelToolCalls: true,
    },
    ...over,
  }) as ModelConfig;

const userImageMsg = (text?: string): CanonicalMessage =>
  ({
    uuid: 'u1',
    role: 'user',
    timestamp: new Date().toISOString(),
    content: [
      ...(text ? [{ type: 'text' as const, text }] : []),
      { type: 'image' as const, image: { mediaType: 'image/png' as const, data: PNG_B64 } },
    ],
  }) as unknown as CanonicalMessage;

describe('chat/completions image rendering', () => {
  const adapter = new ChatCompletionsAPIAdapter();

  it('vision card: user text+image becomes a parts array with data URI', () => {
    const out = adapter.toProviderMessages([userImageMsg('what port is shown?')], baseCfg({ vision: true }));
    expect(out).toHaveLength(1);
    const content = out[0]!.content as any[];
    expect(Array.isArray(content)).toBe(true);
    expect(content[0]).toEqual({ type: 'text', text: 'what port is shown?' });
    expect(content[1].type).toBe('image_url');
    expect(content[1].image_url.url).toBe(`data:image/png;base64,${PNG_B64}`);
  });

  it('vision card: image-only user message still emits (no silent drop)', () => {
    const out = adapter.toProviderMessages([userImageMsg()], baseCfg({ vision: true }));
    expect(out).toHaveLength(1);
    const content = out[0]!.content as any[];
    expect(content.some((p) => p.type === 'image_url')).toBe(true);
  });

  it('NON-vision card: wire unchanged — plain string, image dropped', () => {
    const out = adapter.toProviderMessages([userImageMsg('hello')], baseCfg({ vision: undefined }));
    expect(out).toHaveLength(1);
    expect(out[0]!.content).toBe('hello');
  });

  it('NON-vision card: image-only message emits nothing (legacy behavior)', () => {
    const out = adapter.toProviderMessages([userImageMsg()], baseCfg({}));
    expect(out).toHaveLength(0);
  });

  it('tool_result messages stay plain-string tool messages (images never ride role:tool)', () => {
    const msg = {
      uuid: 'u2',
      role: 'user',
      timestamp: new Date().toISOString(),
      content: [
        { type: 'tool_result', toolResult: { tool_use_id: 't1', tool_name: 'Bash', content: 'ok', is_error: false } },
      ],
    } as unknown as CanonicalMessage;
    const out = adapter.toProviderMessages([msg], baseCfg({ vision: true }));
    expect(out[0]!.role).toBe('tool');
    expect(typeof out[0]!.content).toBe('string');
  });
});

describe('Messages (Anthropic dialect) image parity', () => {
  it('renders the canonical image block as a base64 source block', () => {
    const adapter = new MessagesAPIAdapter();
    const cfg = baseCfg({
      provider: 'anthropic',
      tools: {
        supported: true,
        adapter: 'MessagesAPIAdapter',
        namingConvention: 'PascalCase',
        maxTools: 128,
        parallelToolCalls: true,
      },
    } as Partial<ModelConfig>);
    const out = adapter.toProviderMessages([userImageMsg('see this')], cfg) as any[];
    const content = out[0].content;
    const img = content.find((b: any) => b.type === 'image');
    expect(img).toBeDefined();
    expect(img.source).toEqual({ type: 'base64', media_type: 'image/png', data: PNG_B64 });
  });
});
