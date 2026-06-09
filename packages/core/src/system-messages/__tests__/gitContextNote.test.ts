/**
 * SystemReminderInjector.buildGitContextSection — git-context + cross-agent
 * staleness harness-note. Git output is environment-dependent, so these tests
 * point at a NON-git temp dir (git resolves to null → no branch/status/commit
 * sections) and exercise the deterministic parts: the env gate, the staleness
 * provider plumbing, and the harness-note wrapper.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { SystemReminderInjector } from '../SystemReminderInjector.js';

describe('buildGitContextSection', () => {
  let nonGitDir: string;
  const prevFlag = process.env.CORTEX_GIT_CONTEXT;

  beforeEach(() => {
    nonGitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitnote-'));
    delete process.env.CORTEX_GIT_CONTEXT;
  });

  afterEach(() => {
    fs.rmSync(nonGitDir, { recursive: true, force: true });
    if (prevFlag === undefined) delete process.env.CORTEX_GIT_CONTEXT;
    else process.env.CORTEX_GIT_CONTEXT = prevFlag;
  });

  it('returns null when CORTEX_GIT_CONTEXT=false, even with stale files', () => {
    process.env.CORTEX_GIT_CONTEXT = 'false';
    const inj = new SystemReminderInjector();
    inj.setStaleFilesProvider(() => [{ path: '/x/y.ts', deleted: false }]);
    expect(inj.buildGitContextSection(nonGitDir)).toBeNull();
  });

  it('returns null in a non-git dir with nothing stale', () => {
    const inj = new SystemReminderInjector();
    expect(inj.buildGitContextSection(nonGitDir)).toBeNull();
  });

  it('surfaces stale files in a harness-note (changed + deleted variants)', () => {
    const inj = new SystemReminderInjector();
    inj.setStaleFilesProvider(() => [
      { path: '/repo/a.ts', deleted: false },
      { path: '/repo/b.ts', deleted: true },
    ]);

    const note = inj.buildGitContextSection(nonGitDir);
    expect(note).not.toBeNull();
    expect(note).toContain('<harness-note source="automated-harness" from-user="false">');
    expect(note).toContain('</harness-note>');
    expect(note).toContain('STALE');
    expect(note).toContain('/repo/a.ts  (CHANGED on disk)');
    expect(note).toContain('/repo/b.ts  (DELETED/MOVED on disk)');
  });

  it('marks the note as not-from-user so self-talk reasoners do not read it as instruction', () => {
    const inj = new SystemReminderInjector();
    inj.setStaleFilesProvider(() => [{ path: '/repo/a.ts', deleted: false }]);
    const note = inj.buildGitContextSection(nonGitDir)!;
    expect(note).toContain('from-user="false"');
    expect(note).toContain('not a user message');
  });
});
