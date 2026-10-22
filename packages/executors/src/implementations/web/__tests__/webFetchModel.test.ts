import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getWebToolsModel } from '../webBackends.js';

// 2026-10-22: WebFetch must resolve its model through the shared webBackends resolver. With WEB_TOOLS_MODEL blank and a Gemini key
// present (every hosted container) its old private reader returned '' and Gemini was called with an empty model name.
const KEYS = ['WEB_TOOLS_MODEL', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'DEEPSEEK_API_KEY', 'ANTHROPIC_API_KEY', 'XAI_API_KEY', 'OPENAI_API_KEY'] as const;
const saved: Record<string, string | undefined> = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
afterEach(() => { for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });
const clear = () => { for (const k of KEYS) delete process.env[k]; };

describe('WebFetch model resolution', () => {
  it('blank WEB_TOOLS_MODEL + a Gemini key auto-picks a real Gemini model, never ""', () => {
    clear(); process.env.WEB_TOOLS_MODEL = ''; process.env.GEMINI_API_KEY = 'narjob_x';
    expect(getWebToolsModel()).toBe('gemini-2.5-flash');
  });
  it('an explicit WEB_TOOLS_MODEL wins', () => {
    clear(); process.env.WEB_TOOLS_MODEL = 'deepseek-flash'; process.env.GEMINI_API_KEY = 'k';
    expect(getWebToolsModel()).toBe('deepseek-flash');
  });
  it('no key at all → "" (direct-fetch fallback)', () => {
    clear(); expect(getWebToolsModel()).toBe('');
  });
  it('WebFetchTool imports the shared resolver and keeps no private reader', () => {
    const src = readFileSync(fileURLToPath(new URL('../WebFetchTool.ts', import.meta.url)), 'utf8');
    expect(src).toMatch(/import \{[^}]*getWebToolsModel[^}]*\} from '\.\/webBackends\.js'/s);
    expect(src).not.toMatch(/const getWebToolsModel\s*=/);
  });
});
