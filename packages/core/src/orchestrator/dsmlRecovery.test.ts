import { describe, it, expect } from 'vitest';
import { looksLikeLeakedDsml, recoverDsmlToolCalls } from './dsmlRecovery.js';

// ｜ = U+FF5C fullwidth vertical bar; the real leaked format captured from k5v2 (filter-js-from-html ctl r1).
const B = '｜';
const P = `${B}${B}DSML${B}${B}`;
const leaked =
  `I need to inspect the files first.\n\n` +
  `<${P}tool_calls><${P}invoke name="Bash">` +
  `<${P}parameter name="command">ls -la /app</${P}parameter>` +
  `</${P}invoke></${P}tool_calls>`;

describe('HB-DSML-PARSE — dsmlRecovery', () => {
  it('detects leaked DSML markup', () => {
    expect(looksLikeLeakedDsml(leaked)).toBe(true);
    expect(looksLikeLeakedDsml('a normal assistant answer with no tool call')).toBe(false);
  });

  it('recovers the leaked tool call into an OpenAI-shape tool_call + strips the markup', () => {
    const rec = recoverDsmlToolCalls(leaked);
    expect(rec).not.toBeNull();
    expect(rec!.toolCalls).toHaveLength(1);
    expect(rec!.toolCalls[0].function.name).toBe('Bash');
    expect(JSON.parse(rec!.toolCalls[0].function.arguments)).toEqual({ command: 'ls -la /app' });
    expect(rec!.cleanedContent).toBe('I need to inspect the files first.');
  });

  it('recovers multiple invokes', () => {
    const two =
      `<${P}invoke name="Read"><${P}parameter name="file_path">/a.txt</${P}parameter></${P}invoke>` +
      `<${P}invoke name="Bash"><${P}parameter name="command">pwd</${P}parameter></${P}invoke>`;
    const rec = recoverDsmlToolCalls(two);
    expect(rec!.toolCalls.map((t) => t.function.name)).toEqual(['Read', 'Bash']);
    expect(JSON.parse(rec!.toolCalls[1].function.arguments)).toEqual({ command: 'pwd' });
  });

  it('open-tag fallback (missing closing parameter tag)', () => {
    const malformed = `<${P}invoke name="Bash"><${P}parameter name="command">echo hi`;
    const rec = recoverDsmlToolCalls(malformed);
    expect(rec!.toolCalls[0].function.name).toBe('Bash');
    expect(JSON.parse(rec!.toolCalls[0].function.arguments)).toEqual({ command: 'echo hi' });
  });

  it('returns null when there is no DSML markup (never fabricates)', () => {
    expect(recoverDsmlToolCalls('just a plain answer, no tools here')).toBeNull();
  });
});
