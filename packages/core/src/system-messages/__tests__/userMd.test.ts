/**
 * USER.md — the always-on user-level instructions slot (2026-11-14). ~/.cortex/CORTEX.md is only a fallback that a project's own
 * CORTEX.md replaces, so a user's standing rules vanished inside real projects. USER.md loads in every project, beside the project docs.
 * Path: $CORTEX_USER_MD (a file) or $HOME/.cortex/USER.md; CORTEX_USER_MD=off|false|0 disables it.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SystemMessageLoader } from '../SystemMessageLoader.js';
import type { InjectionContext } from '../SystemMessageRegistry.interface.js';

const ctx: InjectionContext = { turnNumber: 0, sessionPhase: 'start', hasTools: true, modelCapabilities: [], apiPattern: 'messages', sessionId: 't' };

describe('USER.md user-level instructions', () => {
  let home: string; let proj: string; const saved = { HOME: process.env.HOME, U: process.env.CORTEX_USER_MD };
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'umd-home-')); proj = mkdtempSync(join(tmpdir(), 'umd-proj-'));
    process.env.HOME = home; delete process.env.CORTEX_USER_MD;
    mkdirSync(join(home, '.cortex'), { recursive: true });
    writeFileSync(join(home, '.cortex', 'USER.md'), 'USER-RULES-MARKER map before assert');
    mkdirSync(join(proj, '.cortex'), { recursive: true });
    writeFileSync(join(proj, '.cortex', 'CORTEX.md'), 'PROJECT-CORTEX-MARKER');
  });
  afterEach(() => {
    process.env.HOME = saved.HOME; if (saved.U === undefined) delete process.env.CORTEX_USER_MD; else process.env.CORTEX_USER_MD = saved.U;
    rmSync(home, { recursive: true, force: true }); rmSync(proj, { recursive: true, force: true });
  });
  const load = async () => { const l = new SystemMessageLoader({ projectPath: proj }); await l.loadRegistry(); return l.getMessagesForContext(ctx); };

  it('loads ~/.cortex/USER.md even when the project has its own CORTEX.md', async () => {
    const m = await load();
    expect(m.find(x => x.definition.id === 'user_md')?.content).toContain('USER-RULES-MARKER');
    expect(m.find(x => x.definition.id === 'cortex')?.content).toContain('PROJECT-CORTEX-MARKER');
  });
  it('CORTEX_USER_MD points at another file', async () => {
    const f = join(home, 'other.md'); writeFileSync(f, 'OTHER-MARKER'); process.env.CORTEX_USER_MD = f;
    expect((await load()).find(x => x.definition.id === 'user_md')?.content).toContain('OTHER-MARKER');
  });
  it('CORTEX_USER_MD=off disables it', async () => {
    process.env.CORTEX_USER_MD = 'off';
    expect((await load()).find(x => x.definition.id === 'user_md')).toBeUndefined();
  });
  it('finds ~/.cortex/USER.md via the OS home dir when HOME is unset (launchd-started servers, m2 11-14)', async () => {
    const os = await import('node:os'); const saved = os.default.homedir;
    (os.default as any).homedir = () => home; delete process.env.HOME;
    try { expect((await load()).find(x => x.definition.id === 'user_md')?.content).toContain('USER-RULES-MARKER'); }
    finally { (os.default as any).homedir = saved; process.env.HOME = home; }
  });
  it('absent file = no message, no error', async () => {
    rmSync(join(home, '.cortex', 'USER.md'));
    expect((await load()).find(x => x.definition.id === 'user_md')).toBeUndefined();
  });
});
