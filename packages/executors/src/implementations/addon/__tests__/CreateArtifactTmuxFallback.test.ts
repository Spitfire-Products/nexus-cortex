/**
 * HB-TMUX-FALLBACK (R134, 2026-09-13): CreateArtifactTool persistent/dev mode
 * without tmux degrades to a plain detached process artifact (registered in
 * BackgroundProcessRegistry so BashOutput can poll it) instead of throwing
 * "tmux is not installed. Persistent mode requires tmux for session management."
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { CreateArtifactToolExecutor as CreateArtifactTool } from '../CreateArtifactTool.js';
import { TmuxManager } from '../../../utils/TmuxManager.js';
import { BackgroundProcessRegistry } from '../../execution/BackgroundProcessRegistry.js';

const WARN_LINE =
  '[WARN] tmux not available: persistent mode downgraded to a detached background process (attach/reconnect and dashboard restart are not available); poll with BashOutput';

describe('HB-TMUX-FALLBACK (R134): CreateArtifactTool persistent mode without tmux', () => {
  const dirs: string[] = [];
  afterEach(() => {
    vi.restoreAllMocks();
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });

  it('creates a detached process artifact with the [WARN] line instead of throwing', async () => {
    vi.spyOn(TmuxManager.getInstance(), 'isAvailable').mockResolvedValue(false);
    const createSession = vi.spyOn(TmuxManager.getInstance(), 'createSession');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifact-tmux-fallback-'));
    dirs.push(dir);
    const tool = new CreateArtifactTool({ workingDirectory: dir });

    const res = await tool.execute(
      {
        name: 'sim-monitor',
        description: 'long-running monitor',
        parameters: {},
        implementation: {
          language: 'javascript',
          code: 'console.log("monitor-started"); setInterval(() => {}, 1000);',
        },
        mode: 'persistent',
      },
      new AbortController().signal,
    );

    expect(res.success).toBe(true);
    expect(createSession).not.toHaveBeenCalled();
    const text = typeof res.llmContent === 'string' ? res.llmContent : JSON.stringify(res);
    expect(text.split('\n')[0].startsWith(WARN_LINE)).toBe(true);
    expect(text).not.toContain('tmux is not installed');
    expect(res.metadata?.status).toBe('running');
    expect(res.metadata?.mode).toBe('persistent');
    expect(res.metadata?.persistentDegraded).toBe(true);
    const bashId = res.metadata?.bash_id as string;
    expect(bashId).toMatch(/^artifact-/);
    expect(text).toContain(`BashOutput({ bash_id: "${bashId}" })`);

    const session = CreateArtifactTool.getActiveArtifact(res.metadata?.artifactId as string);
    expect(session).toBeDefined();
    expect(session?.tmuxSessionId).toBeUndefined();
    expect(session?.process?.pid).toBeGreaterThan(0);

    const reg = BackgroundProcessRegistry.getInstance();
    expect(reg.hasProcess(bashId)).toBe(true);
    await new Promise((r) => setTimeout(r, 800));
    expect(reg.getOutput(bashId).join('\n')).toContain('monitor-started');

    reg.killProcess(bashId); reg.removeProcess(bashId);
    session?.process?.kill('SIGKILL');
  }, 20000);
});
