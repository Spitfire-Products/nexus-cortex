/**
 * The starting auto-approve mode (operator 2026-11-14): set in the USER's ~/.cortex/config.json, decided once in the library,
 * the same for every surface and both turn routes. Temp CORTEX_HOME — never the real ~/.cortex.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { resolveInitialApprovalMode, describeInitialApprovalMode, globalUiConfigPath, persistAutoApprove } from './approvalSettings.js';
import { createOrchestrator } from '../orchestrator/OrchestratorFactory.js';

let home: string; let project: string; let prevHome: string | undefined;
const writeGlobal = (o: unknown) => { fs.mkdirSync(path.join(home, '.cortex'), { recursive: true }); fs.writeFileSync(path.join(home, '.cortex', 'config.json'), JSON.stringify(o)); };
const writeProject = (o: unknown) => { fs.mkdirSync(path.join(project, '.cortex'), { recursive: true }); fs.writeFileSync(path.join(project, '.cortex', 'config.json'), JSON.stringify(o)); };
const tty = (surface?: string) => resolveInitialApprovalMode({ surface, isInteractive: true, projectDir: project });

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-approve-home-'));
  project = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-approve-proj-'));
  prevHome = process.env.CORTEX_HOME; process.env.CORTEX_HOME = home;
});
afterEach(() => {
  if (prevHome === undefined) delete process.env.CORTEX_HOME; else process.env.CORTEX_HOME = prevHome;
  fs.rmSync(home, { recursive: true, force: true }); fs.rmSync(project, { recursive: true, force: true });
});

describe('resolveInitialApprovalMode', () => {
  it('no file: terminal OFF, no terminal ON (the old behaviour)', () => {
    expect(tty()).toEqual({ autoApproveActions: false, source: 'default' });
    expect(resolveInitialApprovalMode({ isInteractive: false, projectDir: project })).toEqual({ autoApproveActions: true, source: 'default' });
  });
  it('top-level autoApprove: true turns a terminal session ON', () => {
    writeGlobal({ theme: 'palenight', autoApprove: true });
    expect(tty('fuzzycortex')).toEqual({ autoApproveActions: true, source: 'config' });
  });
  it('the surface key wins over the top-level key, both ways', () => {
    writeGlobal({ autoApprove: true, neoncortex: { theme: 'cobalt2', autoApprove: false }, fuzzycortex: { autoApprove: true } });
    expect(tty('neoncortex')).toEqual({ autoApproveActions: false, source: 'config:surface' });
    expect(tty('fuzzycortex')).toEqual({ autoApproveActions: true, source: 'config:surface' });
    expect(tty('cli')).toEqual({ autoApproveActions: true, source: 'config' });
  });
  it('only a real boolean counts; malformed JSON changes nothing', () => {
    writeGlobal({ autoApprove: 'true', fuzzycortex: { autoApprove: 1 } });
    expect(tty('fuzzycortex').source).toBe('default');
    fs.writeFileSync(path.join(home, '.cortex', 'config.json'), '{ not json');
    expect(tty('fuzzycortex')).toEqual({ autoApproveActions: false, source: 'default' });
  });
  it('a PROJECT .cortex/config.json can never turn it on — reported as ignored', () => {
    writeProject({ autoApprove: true, fuzzycortex: { autoApprove: true } });
    const m = tty('fuzzycortex');
    expect(m.autoApproveActions).toBe(false);
    expect(m.ignored).toBe(path.join(project, '.cortex', 'config.json'));
    expect(describeInitialApprovalMode(m, 'fuzzycortex')).toContain('ignored autoApprove in project file');
  });
  it('when the project IS the home directory, its config.json is the global file and counts', () => {
    writeGlobal({ autoApprove: true });
    const m = resolveInitialApprovalMode({ surface: 'fuzzycortex', isInteractive: true, projectDir: home });
    expect(m).toEqual({ autoApproveActions: true, source: 'config' });
  });
  it('no terminal stays ON even when the file says false (nobody can answer a prompt)', () => {
    writeGlobal({ autoApprove: false, cortexserver: { autoApprove: false } });
    expect(resolveInitialApprovalMode({ surface: 'cortexserver', isInteractive: false, projectDir: project })).toEqual({ autoApproveActions: true, source: 'default' });
  });
  it('the banner names the file and key, nothing when unset', () => {
    expect(describeInitialApprovalMode(tty())).toBeUndefined();
    writeGlobal({ fuzzycortex: { autoApprove: true } });
    expect(describeInitialApprovalMode(tty('fuzzycortex'), 'fuzzycortex')).toBe(`auto-approve ON from ${globalUiConfigPath()} (fuzzycortex.autoApprove)`);
  });
});

describe('persistAutoApprove (cortex permissions auto-approve outside a session)', () => {
  it('writes the surface key, keeps theme/model, and the resolver then reads it', () => {
    writeGlobal({ theme: 'vscodeOneDark', fuzzycortex: { theme: 'palenight', defaultModel: 'deepseek-flash' } });
    const file = persistAutoApprove(true, { surface: 'fuzzycortex' });
    expect(file).toBe(globalUiConfigPath());
    const cfg = JSON.parse(fs.readFileSync(file, 'utf-8'));
    expect(cfg).toEqual({ theme: 'vscodeOneDark', fuzzycortex: { theme: 'palenight', defaultModel: 'deepseek-flash', autoApprove: true } });
    expect(tty('fuzzycortex')).toEqual({ autoApproveActions: true, source: 'config:surface' });
  });
  it('top-level write, then undefined removes it (back to the default)', () => {
    persistAutoApprove(true);
    expect(tty('neoncortex').source).toBe('config');
    persistAutoApprove(undefined);
    expect(JSON.parse(fs.readFileSync(globalUiConfigPath(), 'utf-8'))).toEqual({});
    expect(tty('neoncortex')).toEqual({ autoApproveActions: false, source: 'default' });
  });
});

describe('the orchestrator starts from it (one state for sendMessage and streamMessage)', () => {
  const setTTY = (v: boolean | undefined) => {
    Object.defineProperty(process.stdin, 'isTTY', { value: v, configurable: true });
    Object.defineProperty(process.stdout, 'isTTY', { value: v, configurable: true });
  };
  const prev = { i: process.stdin.isTTY, o: process.stdout.isTTY };
  afterEach(() => {
    Object.defineProperty(process.stdin, 'isTTY', { value: prev.i, configurable: true });
    Object.defineProperty(process.stdout, 'isTTY', { value: prev.o, configurable: true });
  });
  const make = (surface?: string) => createOrchestrator({
    defaultModelId: 'claude-haiku-4-5', projectPath: project, storageDir: path.join(project, '.cortex/sessions'),
    ...(surface ? { surface } : {}),
  });

  it('terminal + fuzzycortex.autoApprove: true → ON with source config:surface', async () => {
    writeGlobal({ fuzzycortex: { autoApprove: true } });
    setTTY(true);
    const o = await make('fuzzycortex');
    expect(o.getApprovalMode().autoApproveActions).toBe(true);
    expect(o.getInitialApprovalMode().source).toBe('config:surface');
  });
  it('terminal + no key → OFF (unchanged)', async () => {
    setTTY(true);
    const o = await make('fuzzycortex');
    expect(o.getApprovalMode().autoApproveActions).toBe(false);
    expect(o.getInitialApprovalMode().source).toBe('default');
  });
  it('terminal + the key on ANOTHER surface only → OFF', async () => {
    writeGlobal({ neoncortex: { autoApprove: true } });
    setTTY(true);
    const o = await make('fuzzycortex');
    expect(o.getApprovalMode().autoApproveActions).toBe(false);
  });
});
