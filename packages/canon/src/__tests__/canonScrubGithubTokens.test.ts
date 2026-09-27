/**
 * Every GitHub token family is scrubbed at the push boundary (2026-09-26): gho_ (OAuth — what `gh auth token` returns)
 * and ghr_ (refresh) were missing, and an agent printed the store's own gho_ credential into a captured transcript.
 */
import { describe, it, expect } from 'vitest';
import { scrubSecrets } from '../canonSync.js';

const tok = (p: string) => `${p}_${'A1b2C3d4'.repeat(5)}`;

describe('scrubSecrets — GitHub token families', () => {
  for (const p of ['ghp', 'gho', 'ghu', 'ghs', 'ghr']) {
    it(`redacts ${p}_ tokens, including inside a URL`, () => {
      const out = scrubSecrets(`url = https://${tok(p)}@github.com/org/repo and bare ${tok(p)}`);
      expect(out).not.toContain(tok(p));
      expect(out).toContain(`[redacted:${p}]`);
    });
  }
});
