/**
 * Card/registry-scoped framing for ShellTool's dedicated-tool steering
 * (2026-08-22 follow-up to D61): the steering default must resolve from the
 * MODEL CARD's anchorProfile threaded into ExecutorConfig (per-orchestrator),
 * not from process-global env — production door sessions (deepseek cards =
 * bash-edit) never set CORTEX_TOOL_ANCHOR.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ShellTool } from '../../implementations/execution/ShellTool.js';
import type { ExecutorConfig } from '@nexus-cortex/types';

const ac = () => new AbortController().signal;
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'shell-card-'));
  writeFileSync(join(dir, 'probe.txt'), 'hello\n');
  delete process.env.CORTEX_TOOL_REDIRECTS;
  delete process.env.CORTEX_TOOL_ANCHOR;
  delete process.env.CORTEX_TOOL_PROFILE;
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.CORTEX_TOOL_REDIRECTS;
  delete process.env.CORTEX_TOOL_ANCHOR;
  delete process.env.CORTEX_TOOL_PROFILE;
});

function tool(cfg: Partial<ExecutorConfig> = {}): ShellTool {
  return new ShellTool({ workingDirectory: dir, enableSandbox: false, allowedCommands: [], ...cfg });
}

describe('ShellTool steering default is card/registry-scoped', () => {
  it('card anchorProfile=bash-edit (no env) → bare cat EXECUTES (no redirect)', async () => {
    const r = await tool({ activeAnchorProfile: 'bash-edit' }).execute({ command: 'cat probe.txt' }, ac());
    expect(String(r.llmContent)).not.toContain('Use the Read tool');
  });

  it('no card, no env → full-profile default keeps the redirect', async () => {
    const r = await tool().execute({ command: 'cat probe.txt' }, ac());
    expect(String(r.llmContent)).toContain('Use the Read tool');
  });

  it('updateConfig-style mutation flips the default live (by-reference config)', async () => {
    const cfg: ExecutorConfig = { workingDirectory: dir, enableSandbox: false, allowedCommands: [] };
    const t = new ShellTool(cfg);
    const r1 = await t.execute({ command: 'cat probe.txt' }, ac());
    expect(String(r1.llmContent)).toContain('Use the Read tool');
    (cfg as { activeAnchorProfile?: string }).activeAnchorProfile = 'bash-edit'; // what ExecutorRegistry.updateConfig does
    const r2 = await t.execute({ command: 'cat probe.txt' }, ac());
    expect(String(r2.llmContent)).not.toContain('Use the Read tool');
  });

  it('env CORTEX_TOOL_REDIRECTS=on overrides the card framing', async () => {
    process.env.CORTEX_TOOL_REDIRECTS = 'on';
    const r = await tool({ activeAnchorProfile: 'bash-edit' }).execute({ command: 'cat probe.txt' }, ac());
    expect(String(r.llmContent)).toContain('Use the Read tool');
  });

  it('env CORTEX_TOOL_ANCHOR=none cancels the card framing (resolver parity)', async () => {
    process.env.CORTEX_TOOL_ANCHOR = 'none';
    const r = await tool({ activeAnchorProfile: 'bash-edit' }).execute({ command: 'cat probe.txt' }, ac());
    expect(String(r.llmContent)).toContain('Use the Read tool');
  });

  it('non-bash card anchor (lean) does not disable steering', async () => {
    const r = await tool({ activeAnchorProfile: 'lean' }).execute({ command: 'cat probe.txt' }, ac());
    expect(String(r.llmContent)).toContain('Use the Read tool');
  });
});
