/**
 * Frame-coherent read/write permissions (backlog item 6) + CORTEX_BASH_PIPEFAIL
 * (item 4) — integration through the real tools.
 *
 * The TB2 wedge under test: persist frame = {Bash, Edit}, no Read tool.
 * (a) bash reads must satisfy the read-first guard;
 * (b) denial advice must be followable on a Read-less surface;
 * (c) bash in-place writes must invalidate read state;
 * (d) a Write-created file must be editable without a redundant read.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fsp from 'fs/promises';
import fs from 'fs';
import path from 'path';
import { tmpdir } from 'os';
import { ShellTool } from '../../implementations/execution/ShellTool.js';
import { EditTool, FileReadTracker } from '../../implementations/file/EditTool.js';
import { WriteFileTool } from '../../implementations/file/WriteFileTool.js';
import type { ExecutorConfig } from '../../base/ToolRegistry.js';

let dir: string;
let config: ExecutorConfig;
let shell: ShellTool;
let edit: EditTool;
let write: WriteFileTool;
const signal = new AbortController().signal;

const ENV_KEYS = ['CORTEX_TOOL_PROFILE', 'CORTEX_TOOL_ANCHOR', 'CORTEX_BASH_PIPEFAIL', 'CORTEX_TOOL_REDIRECTS'];
const saved: Record<string, string | undefined> = {};

beforeEach(async () => {
  dir = await fsp.mkdtemp(path.join(tmpdir(), 'frame-coherence-'));
  config = { workingDirectory: dir } as ExecutorConfig;
  shell = new ShellTool(config);
  edit = new EditTool(config);
  write = new WriteFileTool(config);
  FileReadTracker.clearSession();
  for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  // Redirect steering off so bare `cat file` executes instead of being
  // redirected to the Read tool (we are testing the bash channel itself).
  process.env.CORTEX_TOOL_REDIRECTS = 'off';
});

afterEach(async () => {
  await fsp.rm(dir, { recursive: true, force: true });
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

async function seed(name: string, content: string): Promise<string> {
  const p = path.join(dir, name);
  await fsp.writeFile(p, content, 'utf-8');
  return p;
}

describe('bash-read registration (6a)', () => {
  it('cat → Edit now succeeds (the persist-frame keystone)', async () => {
    const p = await seed('app.py', 'x = 1\ny = 2\n');
    // Without a read, Edit denies.
    expect(edit.validateToolParams({ file_path: p, old_string: 'x = 1', new_string: 'x = 42' })).toMatch(
      /must read the file/i,
    );
    // A bash cat registers the read...
    const r = await shell.execute({ command: `cat -n ${p}` }, signal);
    expect(r.is_error).toBeFalsy();
    // ...and the same Edit is now legal.
    expect(edit.validateToolParams({ file_path: p, old_string: 'x = 1', new_string: 'x = 42' })).toBeNull();
  });

  it('sed -n range read registers too', async () => {
    const p = await seed('util.rs', 'fn a() {}\nfn b() {}\n');
    await shell.execute({ command: `sed -n '1,2p' ${p}` }, signal);
    expect(edit.validateToolParams({ file_path: p, old_string: 'fn a() {}', new_string: 'fn a() { 1; }' })).toBeNull();
  });

  it('a FAILING command registers nothing', async () => {
    const p = await seed('c.txt', 'hello\n');
    await shell.execute({ command: `cat ${p} && false` }, signal);
    expect(edit.validateToolParams({ file_path: p, old_string: 'hello', new_string: 'bye' })).toMatch(
      /must read the file/i,
    );
  });
});

describe('bash-write staleness (6c)', () => {
  it('sed -i invalidates a prior read — next Edit demands re-read', async () => {
    const p = await seed('server.py', 'PORT = 80\n');
    await shell.execute({ command: `cat ${p}` }, signal);
    expect(edit.validateToolParams({ file_path: p, old_string: 'PORT = 80', new_string: 'PORT = 8080' })).toBeNull();
    await shell.execute({ command: `sed -i 's/80/9090/' ${p}` }, signal);
    const denial = edit.validateToolParams({ file_path: p, old_string: 'PORT = 9090', new_string: 'PORT = 80' });
    expect(denial).toMatch(/read/i);
    // Re-reading through bash restores edit rights.
    await shell.execute({ command: `cat ${p}` }, signal);
    expect(edit.validateToolParams({ file_path: p, old_string: 'PORT = 9090', new_string: 'PORT = 80' })).toBeNull();
  });

  it('redirect overwrite (>) invalidates read state', async () => {
    const p = await seed('conf.txt', 'a=1\n');
    await shell.execute({ command: `cat ${p}` }, signal);
    await shell.execute({ command: `echo "b=2" > ${p}` }, signal);
    expect(edit.validateToolParams({ file_path: p, old_string: 'b=2', new_string: 'b=3' })).toMatch(/read/i);
  });
});

describe('Write → Edit coherence (6, WriteFileTool defect)', () => {
  it('a Write-created file is editable without a redundant read', async () => {
    const p = path.join(dir, 'new_module.py');
    const w = await write.execute({ file_path: p, content: 'VALUE = 1\n' }, signal);
    expect(w.is_error).toBeFalsy();
    expect(edit.validateToolParams({ file_path: p, old_string: 'VALUE = 1', new_string: 'VALUE = 2' })).toBeNull();
  });
});

describe('frame-aware denial advice (6b)', () => {
  it('under bash-edit profile the denial advises bash, not the Read tool', async () => {
    process.env.CORTEX_TOOL_PROFILE = 'bash-edit';
    const p = await seed('gen_gates.py', 'def gate(): pass\n');
    const denial = edit.validateToolParams({ file_path: p, old_string: 'def gate(): pass', new_string: 'def gate(): return 1' });
    expect(denial).toMatch(/bash/i);
    expect(denial).not.toMatch(/Read\(file_path/);
    expect(denial).toMatch(/sed -n|cat -n/);
  });

  it('under bash-edit CARD anchor (activeAnchorProfile) same advice', async () => {
    (config as any).activeAnchorProfile = 'bash-edit';
    const p = await seed('x.py', 'a\n');
    const denial = edit.validateToolParams({ file_path: p, old_string: 'a', new_string: 'b' });
    expect(denial).toMatch(/cat -n|sed -n/);
  });

  it('full surface keeps the classic Read-tool advice', async () => {
    const p = await seed('y.py', 'a\n');
    const denial = edit.validateToolParams({ file_path: p, old_string: 'a', new_string: 'b' });
    expect(denial).toMatch(/Read/);
  });

  it('CORTEX_TOOL_ANCHOR=none cancels a Read-less card anchor', async () => {
    (config as any).activeAnchorProfile = 'bash-edit';
    process.env.CORTEX_TOOL_ANCHOR = 'none';
    const p = await seed('z.py', 'a\n');
    const denial = edit.validateToolParams({ file_path: p, old_string: 'a', new_string: 'b' });
    expect(denial).toMatch(/Read/);
  });
});

describe('CORTEX_BASH_PIPEFAIL (item 4)', () => {
  it('default: piped failure masks the exit code (documented behavior)', async () => {
    const r = await shell.execute({ command: 'false | cat' }, signal);
    expect((r.metadata as any)?.exitCode).toBe(0);
  });

  it('armed: piped failure propagates', async () => {
    process.env.CORTEX_BASH_PIPEFAIL = 'true';
    const r = await shell.execute({ command: 'false | cat' }, signal);
    expect((r.metadata as any)?.exitCode).not.toBe(0);
  });

  it('armed: succeeding pipelines still exit 0', async () => {
    process.env.CORTEX_BASH_PIPEFAIL = 'true';
    const r = await shell.execute({ command: 'echo ok | cat' }, signal);
    expect((r.metadata as any)?.exitCode).toBe(0);
  });
});
