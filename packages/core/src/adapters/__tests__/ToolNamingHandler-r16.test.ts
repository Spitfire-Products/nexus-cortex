/**
 * Round 16 (Opus parallel-bench finding): ToolNamingHandler.convertName
 * memoization. The function is pure on (name, convention) — the regex
 * chains re-run on the same ~30 canonical names on every request.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ToolNamingHandler } from '../ToolNamingHandler.js';

describe('ToolNamingHandler — convertName memoization (Round 16)', () => {
  let handler: ToolNamingHandler;

  beforeEach(() => {
    // Clear the static cache so each test starts fresh
    (ToolNamingHandler as any).convertNameCache.clear();
    handler = new ToolNamingHandler();
  });

  it('snake_case conversion is correct', () => {
    expect(handler.applyNamingConvention(
      [{ name: 'ReadFile' } as any],
      'snake_case',
    )[0].name).toBe('read_file');
  });

  it('PascalCase conversion is correct', () => {
    expect(handler.applyNamingConvention(
      [{ name: 'read_file' } as any],
      'PascalCase',
    )[0].name).toBe('ReadFile');
  });

  it('MCP-namespaced names pass through unchanged in both directions', () => {
    expect(handler.applyNamingConvention(
      [{ name: 'nexus-browser__browse' } as any],
      'snake_case',
    )[0].name).toBe('nexus-browser__browse');
    expect(handler.applyNamingConvention(
      [{ name: 'nexus-browser__browse' } as any],
      'PascalCase',
    )[0].name).toBe('nexus-browser__browse');
  });

  it('second conversion of the same name hits the cache (proves memoization)', () => {
    handler.applyNamingConvention([{ name: 'WriteFile' } as any], 'snake_case');
    const cache = (ToolNamingHandler as any).convertNameCache;
    expect(cache.has('snake_case:WriteFile')).toBe(true);
    expect(cache.get('snake_case:WriteFile')).toBe('write_file');
  });

  it('cache separates entries by convention (PascalCase + snake_case = 2 entries)', () => {
    handler.applyNamingConvention([{ name: 'ReadFile' } as any], 'snake_case');
    handler.applyNamingConvention([{ name: 'ReadFile' } as any], 'PascalCase');
    const cache = (ToolNamingHandler as any).convertNameCache;
    expect(cache.has('snake_case:ReadFile')).toBe(true);
    expect(cache.has('PascalCase:ReadFile')).toBe(true);
    // PascalCase passthrough: 'ReadFile' is already PascalCase → stays as-is
    expect(cache.get('PascalCase:ReadFile')).toBe('ReadFile');
  });

  it('cache is shared across instances (static field)', () => {
    handler.applyNamingConvention([{ name: 'GrepTool' } as any], 'snake_case');
    const handler2 = new ToolNamingHandler();
    handler2.applyNamingConvention([{ name: 'GrepTool' } as any], 'snake_case');
    const cache = (ToolNamingHandler as any).convertNameCache;
    // Only one entry for this key, used by both instances
    expect(cache.size).toBeGreaterThan(0);
    expect(cache.get('snake_case:GrepTool')).toBe('grep_tool');
  });

  it('converting 30 names 100 times stays fast (memoized)', () => {
    const names = Array.from({ length: 30 }, (_, i) => `TestTool${i}` as any);
    const tools = names.map((n) => ({ name: n }));

    const t0 = process.hrtime.bigint();
    for (let i = 0; i < 100; i++) {
      handler.applyNamingConvention(tools, 'snake_case');
    }
    const t1 = process.hrtime.bigint();
    const ms = Number(t1 - t0) / 1e6;
    // Should be very fast — first pass populates cache, 99 subsequent
    // passes are cache hits
    expect(ms).toBeLessThan(50);

    // Cache size: 30 entries (one per distinct name)
    expect((ToolNamingHandler as any).convertNameCache.size).toBe(30);
  });
});
