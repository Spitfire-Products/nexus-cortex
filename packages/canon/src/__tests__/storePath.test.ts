import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { defaultCanonStore, LEGACY_CANON_STORE } from '../storePath.js';

describe('defaultCanonStore', () => {
  it('uses CANON_STORE when set (trimmed)', () => {
    expect(defaultCanonStore({ CANON_STORE: '  /data/canon  ' } as NodeJS.ProcessEnv)).toBe('/data/canon');
  });

  it('ignores a blank CANON_STORE', () => {
    const r = defaultCanonStore({ CANON_STORE: '   ', XDG_CACHE_HOME: '/xdg' } as NodeJS.ProcessEnv);
    expect(r).toBe(existsSync(LEGACY_CANON_STORE) ? LEGACY_CANON_STORE : '/xdg/nexus-canon/store');
  });

  it('falls back to XDG_CACHE_HOME, then ~/.cache, when no legacy /tmp store exists', () => {
    if (existsSync(LEGACY_CANON_STORE)) {
      // an existing pre-1.12 store wins so current installs keep their clone
      expect(defaultCanonStore({} as NodeJS.ProcessEnv)).toBe(LEGACY_CANON_STORE);
      return;
    }
    expect(defaultCanonStore({ XDG_CACHE_HOME: '/xdg' } as NodeJS.ProcessEnv)).toBe('/xdg/nexus-canon/store');
    expect(defaultCanonStore({} as NodeJS.ProcessEnv)).toBe(join(homedir(), '.cache', 'nexus-canon', 'store'));
  });
});
