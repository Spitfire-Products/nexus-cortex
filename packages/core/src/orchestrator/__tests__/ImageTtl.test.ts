/**
 * Image TTL eviction (item 7 addendum — MEASURED: an image anywhere in a
 * vision-exp request disables cache reads for the whole request). The filter
 * runs on the request copy only, swaps arrays not blocks, and produces a
 * byte-stable stub.
 */

import { describe, it, expect } from 'vitest';
import {
  applyImageTtlForRequest,
  resolveImageTtlTurns,
  imageEvictionStub,
} from '../imageTtl.js';
import type { CanonicalMessage } from '../../adapters/FormatAdapter.interface.js';

const img = () => ({ type: 'image' as const, image: { mediaType: 'image/png' as const, data: 'QUJD' } });
const user = (blocks: any[]): CanonicalMessage =>
  ({ uuid: 'u', role: 'user', timestamp: 't', content: blocks }) as unknown as CanonicalMessage;
const assistant = (): CanonicalMessage =>
  ({ uuid: 'a', role: 'assistant', timestamp: 't', content: [{ type: 'text', text: 'ok' }] }) as unknown as CanonicalMessage;

describe('resolveImageTtlTurns', () => {
  it('default 3; env-tunable; off/never/0 disables; garbage → default', () => {
    expect(resolveImageTtlTurns({} as NodeJS.ProcessEnv)).toBe(3);
    expect(resolveImageTtlTurns({ CORTEX_IMAGE_TTL_TURNS: '5' } as NodeJS.ProcessEnv)).toBe(5);
    expect(resolveImageTtlTurns({ CORTEX_IMAGE_TTL_TURNS: 'off' } as NodeJS.ProcessEnv)).toBeNull();
    expect(resolveImageTtlTurns({ CORTEX_IMAGE_TTL_TURNS: '0' } as NodeJS.ProcessEnv)).toBeNull();
    expect(resolveImageTtlTurns({ CORTEX_IMAGE_TTL_TURNS: 'banana' } as NodeJS.ProcessEnv)).toBe(3);
  });
});

describe('applyImageTtlForRequest', () => {
  it('fresh image (age < ttl) is kept', () => {
    const msgs = [user([img()]), assistant(), assistant()];
    const out = applyImageTtlForRequest(msgs, 3);
    expect(out).toBe(msgs); // unchanged → same reference (cache-friendly)
    expect(out[0]!.content[0]!.type).toBe('image');
  });

  it('stale image (age >= ttl) becomes the deterministic stub', () => {
    const msgs = [user([{ type: 'text', text: 'ctx' }, img()]), assistant(), assistant(), assistant()];
    const out = applyImageTtlForRequest(msgs, 3);
    expect(out[0]!.content[0]).toEqual({ type: 'text', text: 'ctx' }); // sibling text kept
    expect(out[0]!.content[1]).toEqual(imageEvictionStub());
  });

  it('mixed ages: only the stale one evicts', () => {
    const msgs = [user([img()]), assistant(), assistant(), assistant(), user([img()]), assistant()];
    const out = applyImageTtlForRequest(msgs, 3);
    expect(out[0]!.content[0]!.type).toBe('text'); // 4 assistants after → evicted
    expect(out[4]!.content[0]!.type).toBe('image'); // 1 assistant after → kept
  });

  it('ttl null (disabled) is the identity', () => {
    const msgs = [user([img()]), assistant(), assistant(), assistant(), assistant()];
    expect(applyImageTtlForRequest(msgs, null)).toBe(msgs);
  });

  it('never mutates the input (swaps arrays, cache contract)', () => {
    const original = user([img()]);
    const originalContent = original.content;
    const msgs = [original, assistant(), assistant(), assistant()];
    applyImageTtlForRequest(msgs, 3);
    expect(original.content).toBe(originalContent);
    expect(originalContent[0]!.type).toBe('image');
  });

  it('stub is byte-stable across calls (prefix re-stabilizes)', () => {
    expect(JSON.stringify(imageEvictionStub())).toBe(JSON.stringify(imageEvictionStub()));
  });
});
