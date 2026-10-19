import { describe, it, expect } from 'vitest';
import { wrapLines, tailText, windowForViewport } from './streamViewport.js';
import { tuiRenderOptions, streamViewportBudget } from '../renderOptions.js';

describe('R265 stream viewport', () => {
  it('wrapLines wraps on words and hard-breaks long tokens', () => {
    expect(wrapLines('aaa bbb ccc', 7)).toEqual(['aaa bbb', 'ccc']);
    expect(wrapLines('abcdefghij', 4)).toEqual(['abcd', 'efgh', 'ij']);
    expect(wrapLines('', 10)).toEqual(['']);
  });
  it('tailText keeps the last rows that fit and reopens a dangling code fence', () => {
    const text = ['intro', '```js', 'a', 'b', 'c', '```', 'after'].join('\n');
    expect(tailText(text, 100, 80)).toEqual({ text, hidden: 0 });
    const cut = tailText(text, 3, 80);
    expect(cut.text).toBe(['```', 'c', '```', 'after'].join('\n'));
    expect(cut.hidden).toBe(4);
  });
  it('windowForViewport is a no-op within budget or with an infinite budget', () => {
    const items = [{ type: 'user' as const, content: 'hi', id: 'u' }, { type: 'text' as const, content: 'one\ntwo', id: 't' }];
    expect(windowForViewport(items, Number.POSITIVE_INFINITY, 80)).toEqual({ items, hiddenLines: 0 });
    expect(windowForViewport(items, 50, 80)).toEqual({ items, hiddenLines: 0 });
  });
  it('windowForViewport drops leading items and tail-cuts the first kept text', () => {
    const lines = Array.from({ length: 70 }, (_, i) => `${i + 1}. line ${i + 1}`).join('\n');
    const items = [{ type: 'user' as const, content: 'count', id: 'u' }, { type: 'tool' as const, id: 'k' }, { type: 'text' as const, content: lines, id: 't' }];
    const r = windowForViewport(items, 20, 80);
    expect(r.items.map((i) => i.id)).toEqual(['t']);
    expect(r.items[0]!.content!.split('\n')).toHaveLength(20);
    expect(r.items[0]!.content!.split('\n')[0]).toBe('51. line 51');
    expect(r.hiddenLines).toBe(50 + 3 + 3);
  });
  it('render levers: defaults and overrides', () => {
    expect(tuiRenderOptions({})).toEqual({ incrementalRendering: true, maxFps: 20 });
    expect(tuiRenderOptions({ CORTEX_TUI_INCREMENTAL_RENDER: 'false', CORTEX_TUI_MAX_FPS: '0' })).toEqual({ incrementalRendering: false, maxFps: 0 });
    expect(streamViewportBudget(30, {})).toBe(18);
    expect(streamViewportBudget(undefined, {})).toBe(12);
    expect(streamViewportBudget(30, {}, 18)).toBe(4);           // approval dialog open: the turn yields the rows
    expect(streamViewportBudget(50, {}, 18)).toBe(20);
    expect(streamViewportBudget(30, { CORTEX_TUI_STREAM_VIEWPORT_RESERVE: '0' })).toBe(Number.POSITIVE_INFINITY);
    expect(streamViewportBudget(8, {})).toBe(4);
  });
});
