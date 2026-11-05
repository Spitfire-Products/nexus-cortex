import { describe, it, expect } from 'vitest';
import { inspect } from 'node:util';
import { redactLogText } from './logRedaction.js';

const KEY = 'sk-ant-api03-' + 'A'.repeat(40) + '-xyz';
const env = { ANTHROPIC_API_KEY: KEY, DEFAULT_MODEL_ID: 'claude-sonnet-5-5', MAX_TOKENS: '123456789012', DEBUG: 'true' } as NodeJS.ProcessEnv;

describe('redactLogText', () => {
  it('masks an env key value wherever it appears (SDK debug header dump)', () => {
    const line = 'Anthropic:DEBUG:request ' + inspect({ 'x-api-key': KEY, 'anthropic-version': '2023-06-01' });
    const out = redactLogText(line, env);
    expect(out).not.toContain(KEY);
    expect(out).toContain('«secret:ANTHROPIC_API_KEY»');
    expect(out).toContain('2023-06-01');
  });
  it('masks credential headers and bearer tokens it has no env value for', () => {
    const other = 'xai-' + 'b'.repeat(30);
    expect(redactLogText(`{ 'x-api-key': '${other}' }`, env)).not.toContain(other);
    expect(redactLogText(`authorization: Bearer ${other}`, env)).not.toContain(other);
  });
  it('leaves non-secret values alone', () => {
    const line = 'model claude-sonnet-5-5 max 123456789012';
    expect(redactLogText(line, env)).toBe(line);
  });
});

describe('redactLogText on JSON-escaped text (2026-11-04)', () => {
  it('keeps JSON valid when a cookie value sits next to an escaped quote', () => {
    const obj = { text: 'persisted in the site cookie: locStoreId=513"; recorded' };
    const line = JSON.stringify(obj);
    const out = redactLogText(line, {} as NodeJS.ProcessEnv);
    expect(() => JSON.parse(out)).not.toThrow();
    expect(out).not.toContain('locStoreId=513');
  });
  it('still masks a JSON-escaped quoted credential header value', () => {
    const line = JSON.stringify({ log: 'authorization: "sk-abcdefghijklmnop"' });
    const out = redactLogText(line, {} as NodeJS.ProcessEnv);
    expect(out).not.toContain('sk-abcdefghijklmnop');
    expect(() => JSON.parse(out)).not.toThrow();
  });
});
