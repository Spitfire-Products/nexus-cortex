/**
 * HB-HERDR-TERMINAL-BACKEND (R146, 2026-09-14): CreateArtifactTool persistent mode on the
 * herdr backend hosts the artifact process in a herdr pane (split from ours, no focus),
 * registers a BashOutput handle whose read pulls `pane read`, and never touches tmux.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const state = vi.hoisted(() => ({ backend: null as any }));
vi.mock('../../../utils/TerminalBackend.js', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../../utils/TerminalBackend.js')>();
  return {
    ...orig,
    resolveTerminalBackend: vi.fn(async (...args: any[]) =>
      state.backend ?? (orig.resolveTerminalBackend as any)(...args)),
  };
});

import { CreateArtifactToolExecutor as CreateArtifactTool } from '../CreateArtifactTool.js';
import { TmuxManager } from '../../../utils/TmuxManager.js';
import { HerdrTerminalBackend, resetTerminalBackendCache, type BackendExecFn, type BackendExecResult } from '../../../utils/TerminalBackend.js';
import { BackgroundProcessRegistry } from '../../execution/BackgroundProcessRegistry.js';

const ok = (stdout = ''): BackendExecResult => ({ stdout, stderr: '', code: 0 });

describe('R146: CreateArtifactTool persistent mode on the herdr backend', () => {
  const dirs: string[] = [];
  afterEach(() => {
    state.backend = null;
    resetTerminalBackendCache();
    vi.restoreAllMocks();
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });

  it('hosts the process in a herdr pane with the [INFO] line, BashOutput handle, no tmux', async () => {
    const calls: string[][] = [];
    const exec: BackendExecFn = async (_bin, args) => {
      calls.push(args);
      if (args[1] === 'split') return ok(JSON.stringify({ result: { pane: { pane_id: 'w1:p6' } } }));
      if (args[1] === 'read') return ok('$ PORT=3000 node index.js\nmonitor-started\n$ ');
      if (args[1] === 'close') return ok('{"result":{"type":"ok"}}');
      return ok();
    };
    state.backend = new HerdrTerminalBackend({ bin: '/fake/herdr', parentPaneId: 'w1:p1', exec });
    const tmux = TmuxManager.getInstance();
    const avail = vi.spyOn(tmux, 'isAvailable');
    const createSession = vi.spyOn(tmux, 'createSession');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifact-herdr-'));
    dirs.push(dir);
    const tool = new CreateArtifactTool({ workingDirectory: dir });

    const res = await tool.execute(
      {
        name: 'sim-monitor',
        description: 'long-running monitor',
        parameters: {},
        implementation: { language: 'javascript', code: 'console.log("monitor-started"); setInterval(() => {}, 1000);' },
        mode: 'persistent',
      },
      new AbortController().signal,
    );

    expect(res.success).toBe(true);
    expect(avail).not.toHaveBeenCalled();
    expect(createSession).not.toHaveBeenCalled();
    const text = typeof res.llmContent === 'string' ? res.llmContent : JSON.stringify(res);
    expect(text.split('\n')[0]).toBe('[INFO] persistent session via herdr pane w1:p6');
    expect(text).not.toContain('[WARN] tmux not available');
    expect(res.metadata?.status).toBe('running');
    expect(res.metadata?.persistentDegraded).toBe(false);
    expect(res.metadata?.herdrPaneId).toBe('w1:p6');
    const bashId = res.metadata?.bash_id as string;
    expect(bashId).toMatch(/^artifact-/);
    expect(text).toContain(`BashOutput({ bash_id: "${bashId}" })`);

    const split = calls.find((c) => c[1] === 'split')!;
    expect(split.slice(0, 6)).toEqual(['pane', 'split', 'w1:p1', '--direction', 'down', '--no-focus']);
    expect(split[split.indexOf('--cwd') + 1]).toMatch(/\.cortex\/artifacts\/[0-9a-f-]+\/workspace$/);
    expect(calls.some((c) => c[1] === 'rename' && c[3] === bashId)).toBe(true);
    const run = calls.find((c) => c[1] === 'run')!;
    expect(run[2]).toBe('w1:p6');
    expect(run[3]).toMatch(/^PORT=\d+ node index\.js; printf '\\n__CORTEX_DONE_[0-9a-f]+_%s__\\n' \$\?$/);
    expect(calls.some((c) => c[1] === 'wait-output')).toBe(false);

    const session = CreateArtifactTool.getActiveArtifact(res.metadata?.artifactId as string);
    expect(session?.tmuxSessionId).toBeUndefined();
    expect(session?.herdrPaneId).toBe('w1:p6');
    expect(session?.process).toBeUndefined();

    const reg = BackgroundProcessRegistry.getInstance();
    const handle = reg.getProcess(bashId)!;
    expect(handle).toBeDefined();
    expect(handle.pid).toBe(0);
    await handle.refresh!();
    expect(handle.output.join('\n')).toContain('monitor-started');
    expect(handle.isRunning).toBe(true);
    expect(reg.killProcess(bashId)).toBe(true);
    await new Promise((r) => setTimeout(r, 10));
    expect(calls[calls.length - 1]).toEqual(['pane', 'close', 'w1:p6']);
    reg.removeProcess(bashId);
  }, 20000);
});
