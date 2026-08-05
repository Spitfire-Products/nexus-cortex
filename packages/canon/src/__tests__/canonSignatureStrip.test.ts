/**
 * G1 signature-strip: the pull-side lossy projection for foreign-account replay.
 * Thinking → <prior_reasoning> text (the harness fallback convention),
 * redacted_thinking dropped, empty messages stubbed, unrelated lines untouched.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { stripThinkingSignatures } from '../canonPull.js';

const write = (recs: (object | string)[]): string => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'g1-')), 's.jsonl');
  fs.writeFileSync(f, recs.map((r) => (typeof r === 'string' ? r : JSON.stringify(r))).join('\n') + '\n');
  return f;
};
const read = (f: string) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

describe('stripThinkingSignatures', () => {
  it('converts signed thinking to <prior_reasoning> text and drops redacted blocks', () => {
    const f = write([
      { uuid: 'u1', message: { role: 'user', content: 'q' } },
      { uuid: 'a1', message: { role: 'assistant', content: [
        { type: 'thinking', thinking: 'step by step', signature: 'sig-org-A' },
        { type: 'redacted_thinking', data: 'opaque' },
        { type: 'text', text: 'answer' },
      ] } },
    ]);
    const r = stripThinkingSignatures(f);
    expect(r).toEqual({ stripped: 1, dropped: 1 });
    const [u1, a1] = read(f);
    expect(u1.message.content).toBe('q'); // untouched
    expect(a1.message.content).toEqual([
      { type: 'text', text: '<prior_reasoning>\nstep by step\n</prior_reasoning>' },
      { type: 'text', text: 'answer' },
    ]);
    expect(JSON.stringify(a1)).not.toContain('sig-org-A'); // signature gone
  });

  it('stubs a message whose only block was redacted (empty content is replay-invalid)', () => {
    const f = write([{ uuid: 'a', message: { role: 'assistant', content: [{ type: 'redacted_thinking', data: 'x' }] } }]);
    expect(stripThinkingSignatures(f).dropped).toBe(1);
    const [a] = read(f);
    expect(a.message.content).toHaveLength(1);
    expect(a.message.content[0].type).toBe('text');
  });

  it('is a no-op on sessions without thinking; unparseable lines pass through verbatim', () => {
    const f = write([{ uuid: 'u', message: { role: 'user', content: [{ type: 'text', text: 'hi' }] } }, 'not-json{{{']);
    expect(stripThinkingSignatures(f)).toEqual({ stripped: 0, dropped: 0 });
    expect(fs.readFileSync(f, 'utf8')).toContain('not-json{{{');
  });
});
