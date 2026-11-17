/**
 * Lifecycle hooks — config load / merge / validation (docs/hooks.md).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  loadHooksConfig, validateHooksFile, hooksConfigPaths, matcherMatches, resetHooksConfigCache, isSessionStartSource,
  projectHooksTrust, trustProjectHooks, untrustProjectHooks, hooksTrustPath,
} from '../hooksConfig.js';

let home: string; let project: string;
const write = (file: string, v: unknown) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, typeof v === 'string' ? v : JSON.stringify(v)); };
const userFile = () => path.join(home, '.cortex', 'hooks.json');
const projectFile = () => path.join(project, '.cortex', 'hooks.json');

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'hooks-home-'));
  project = fs.mkdtempSync(path.join(os.tmpdir(), 'hooks-proj-'));
  resetHooksConfigCache();
});
afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); fs.rmSync(project, { recursive: true, force: true }); });

describe('hooksConfigPaths', () => {
  it('user file under CORTEX_HOME/.cortex, then the project file; one file when the project is home', () => {
    expect(hooksConfigPaths(project, { CORTEX_HOME: home })).toEqual([userFile(), projectFile()]);
    expect(hooksConfigPaths(home, { CORTEX_HOME: home })).toEqual([userFile()]);
  });
});

describe('loadHooksConfig', () => {
  it('no files → empty config (dark by default)', () => {
    expect(loadHooksConfig({ projectDir: project, env: { CORTEX_HOME: home, CORTEX_HOOKS_TRUST_PROJECTS: '1' } })).toEqual({});
  });

  it('merges user groups first, then project groups, per event', () => {
    write(userFile(), { SessionStart: [{ hooks: [{ type: 'prompt', text: 'user' }] }], Stop: [{ hooks: [{ type: 'command', command: 'true' }] }] });
    write(projectFile(), { SessionStart: [{ matcher: 'resume', hooks: [{ type: 'prompt', text: 'project' }] }] });
    const c = loadHooksConfig({ projectDir: project, env: { CORTEX_HOME: home, CORTEX_HOOKS_TRUST_PROJECTS: '1' } });
    expect(c.SessionStart!.map((g) => (g.hooks[0] as any).text)).toEqual(['user', 'project']);
    expect(c.SessionStart![1]!.matcher).toBe('resume');
    expect(c.SessionStart![0]!.file).toBe(userFile());
    expect(c.Stop).toHaveLength(1);
  });

  it('a bad file logs ONE warning and is ignored; the other file still loads', () => {
    write(userFile(), '{ not json');
    write(projectFile(), { Stop: [{ hooks: [{ type: 'prompt', text: 'ok' }] }] });
    const warn = vi.fn();
    const a = loadHooksConfig({ projectDir: project, env: { CORTEX_HOME: home, CORTEX_HOOKS_TRUST_PROJECTS: '1' }, warn });
    const b = loadHooksConfig({ projectDir: project, env: { CORTEX_HOME: home, CORTEX_HOOKS_TRUST_PROJECTS: '1' }, warn });
    expect(a.Stop).toHaveLength(1); expect(b.Stop).toHaveLength(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain(userFile());
  });

  it('accepts a Claude Code settings file ({ "hooks": { … } }) and ignores events cortex does not have (one warning)', () => {
    write(userFile(), { permissions: {}, hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo hi', timeout: 5 }] }], Notification: [] } });
    const warn = vi.fn();
    const c = loadHooksConfig({ projectDir: project, env: { CORTEX_HOME: home, CORTEX_HOOKS_TRUST_PROJECTS: '1' }, warn });
    expect(c.PreToolUse![0]!.hooks[0]).toEqual({ type: 'command', command: 'echo hi', timeout: 5 });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain('Notification');
  });

  it('re-reads a file after it changes', () => {
    write(userFile(), { Stop: [{ hooks: [{ type: 'prompt', text: 'a' }] }] });
    expect((loadHooksConfig({ projectDir: project, env: { CORTEX_HOME: home, CORTEX_HOOKS_TRUST_PROJECTS: '1' } }).Stop![0]!.hooks[0] as any).text).toBe('a');
    write(userFile(), { Stop: [{ hooks: [{ type: 'prompt', text: 'bb' }] }] });
    expect((loadHooksConfig({ projectDir: project, env: { CORTEX_HOME: home, CORTEX_HOOKS_TRUST_PROJECTS: '1' } }).Stop![0]!.hooks[0] as any).text).toBe('bb');
  });
});

describe('validateHooksFile', () => {
  const bad = (v: unknown) => validateHooksFile(v, 'f').error;
  it('rejects malformed shapes with a pointed message', () => {
    expect(bad([])).toMatch(/object/);
    expect(bad({ Stop: {} })).toMatch(/Stop: must be an array/);
    expect(bad({ Stop: [{ hooks: [] }] })).toMatch(/non-empty array/);
    expect(bad({ Stop: [{ hooks: [{ type: 'command', command: '' }] }] })).toMatch(/command/);
    expect(bad({ Stop: [{ hooks: [{ type: 'command', command: 'x', timeout: 0 }] }] })).toMatch(/timeout/);
    expect(bad({ Stop: [{ hooks: [{ type: 'prompt', text: 3 }] }] })).toMatch(/text/);
    expect(bad({ Stop: [{ hooks: [{ type: 'agent' }] }] })).toMatch(/type/);
    expect(bad({ PreToolUse: [{ matcher: '(', hooks: [{ type: 'prompt', text: 'x' }] }] })).toMatch(/regular expression/);
  });
  it('accepts every event cortex supports', () => {
    const g = [{ hooks: [{ type: 'prompt', text: 'x' }] }];
    const v = validateHooksFile({ SessionStart: g, PreCompact: g, PostCompact: g, UserPromptSubmit: g, PreToolUse: g, PostToolUse: g, Stop: g, SessionEnd: g }, 'f');
    expect(v.error).toBeUndefined();
    expect(Object.keys(v.config!)).toHaveLength(8);
  });
});

describe('matcherMatches (Claude Code semantics: anchored regex; empty / * = all)', () => {
  it('matches', () => {
    expect(matcherMatches(undefined, 'Bash')).toBe(true);
    expect(matcherMatches('*', 'Bash')).toBe(true);
    expect(matcherMatches('Edit|Write', 'Write')).toBe(true);
    expect(matcherMatches('Edit', 'MultiEdit')).toBe(false);
    expect(matcherMatches('mcp__.*', 'mcp__github__x')).toBe(true);
    expect(matcherMatches('resume|compact', 'new')).toBe(false);
  });
  it('session sources', () => {
    expect(['new', 'resume', 'compact', 'update', 'schedule'].every(isSessionStartSource)).toBe(true);
    expect(isSessionStartSource('clear')).toBe(false);
  });
});

describe('project trust (a cloned repo cannot run commands on its own)', () => {
  const env = () => ({ CORTEX_HOME: home });
  const cfg = { SessionStart: [{ hooks: [{ type: 'command', command: 'echo pwned' }] }] };
  it('an untrusted project file is NOT loaded and warns once; the user file still loads', () => {
    write(userFile(), { Stop: [{ hooks: [{ type: 'prompt', text: 'user' }] }] });
    write(projectFile(), cfg);
    const warn = vi.fn();
    const c = loadHooksConfig({ projectDir: project, env: env(), warn });
    expect(c.SessionStart).toBeUndefined();
    expect((c.Stop![0]!.hooks[0] as any).text).toBe('user');
    loadHooksConfig({ projectDir: project, env: env(), warn });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain('cortex hooks trust');
    expect(projectHooksTrust(projectFile(), env())).toBe('untrusted');
  });
  it('trust loads it; editing the file revokes trust until trusted again; untrust removes it', () => {
    write(projectFile(), cfg);
    const r = trustProjectHooks(project, env());
    expect(r.file).toBe(projectFile());
    expect(loadHooksConfig({ projectDir: project, env: env(), warn: () => {} }).SessionStart).toHaveLength(1);
    expect((fs.statSync(hooksTrustPath(env())).mode & 0o777)).toBe(0o600);
    write(projectFile(), { SessionStart: [{ hooks: [{ type: 'command', command: 'echo changed' }] }] });
    expect(projectHooksTrust(projectFile(), env())).toBe('changed');
    expect(loadHooksConfig({ projectDir: project, env: env(), warn: () => {} }).SessionStart).toBeUndefined();
    trustProjectHooks(project, env());
    expect(projectHooksTrust(projectFile(), env())).toBe('trusted');
    expect(untrustProjectHooks(project, env())).toBe(true);
    expect(projectHooksTrust(projectFile(), env())).toBe('untrusted');
  });
  it('trust refuses an invalid file; CORTEX_HOOKS_TRUST_PROJECTS=1 trusts every project file', () => {
    write(projectFile(), '{ not json');
    expect(() => trustProjectHooks(project, env())).toThrow();
    write(projectFile(), cfg);
    expect(projectHooksTrust(projectFile(), { ...env(), CORTEX_HOOKS_TRUST_PROJECTS: '1' })).toBe('trusted');
  });
});
