import { describe, it, expect } from 'vitest';
import { repairToolJson } from '../repairToolJson.js';

describe('repairToolJson', () => {
  it('closes the openers above the one a closer matches (missing brace in nested args)', () => {
    const raw = '{"steps": [{"args": {"selector": "#a"}, "tool": "click"}, {"args": {"container": "#p", "selectorAll": "label", "tool": "grab"}]}';
    const r = repairToolJson(raw) as any;
    expect(r.steps).toHaveLength(2);
    expect(r.steps[1].args.tool).toBe('grab');
  });
  it('drops a stray closer', () => {
    expect(repairToolJson('{"a": {"b": 1}}}')).toEqual({ a: { b: 1 } });
  });
  it('drops trailing commas and closes what is still open', () => {
    expect(repairToolJson('{"a": [1, 2,], "b": {"c": 3,')).toEqual({ a: [1, 2], b: { c: 3 } });
  });
  it('escapes raw newlines inside strings and closes an unterminated string', () => {
    expect(repairToolJson('{"script": "line1\nline2", "x": "open')).toEqual({ script: 'line1\nline2', x: 'open' });
  });
  it('leaves braces inside strings alone', () => {
    expect(repairToolJson('{"s": "a } ] {", "n": 1')).toEqual({ s: 'a } ] {', n: 1 });
  });
  it('returns null for non-objects and garbage', () => {
    expect(repairToolJson('')).toBeNull();
    expect(repairToolJson('[1,2]')).toBeNull();
    expect(repairToolJson('not json')).toBeNull();
  });
  it('escapes an unescaped quote inside a string (a page script in steps args)', () => {
    const raw = '{"steps": [{"tool": "evaluate", "args": {"script": "document.querySelector("a.next").click()"}}]}';
    const r = repairToolJson(raw) as any;
    expect(r.steps[0].args.script).toBe('document.querySelector("a.next").click()');
  });
});
