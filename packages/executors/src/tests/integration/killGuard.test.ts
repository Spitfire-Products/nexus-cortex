/**
 * HB-KILL-GUARD on live processes. Mini bench tree:  adapter bash ─┬─ protected sibling (the adapter's request / recorder stand-in)
 *                                                                  └─ node "harness server" ── bash -c <model command>  (guard on PATH)
 * Every pattern is unique to this test run (a copied `sleep` with a random name, a random marker) so nothing else on the host can match.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn, execFileSync } from 'child_process';
import { ensureKillGuardDir, killGuardEnabled, killGuardSpawnEnv } from '../../utils/killGuard.js';
import { ShellTool } from '../../implementations/execution/ShellTool.js';

const linux = process.platform === 'linux' && fs.existsSync('/proc/self/status');
const tag = `kg${Math.random().toString(36).slice(2, 8)}`;
let dir = '';
let guard = '';
let sleepBin = '';

function alive(pattern: string): number[] {
  try { return execFileSync('pgrep', ['-f', pattern], { encoding: 'utf8' }).trim().split('\n').filter(Boolean).map(Number); } catch { return []; }
}

/** Runs `cmd` as the model would, under the mini tree; resolves with the harness server's report (null if the server died). */
function runTree(cmd: string, sibling: string): Promise<{ report: any; siblingAliveAfter: boolean }> {
  const harness = path.join(dir, `${tag}-harness.mjs`);
  fs.writeFileSync(harness, `
import { spawn } from 'child_process';
const env = { ...process.env, PATH: process.env.GUARD_DIR + ':' + process.env.PATH, CORTEX_SERVER_PID: String(process.pid) };
const sh = spawn('bash', ['-c', process.env.MODEL_CMD], { env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
let out = '', err = '';
sh.stdout.on('data', (d) => { out += d; }); sh.stderr.on('data', (d) => { err += d; });
sh.on('close', (code, signal) => { process.stdout.write('REPORT' + JSON.stringify({ out, err, code, signal }) + '\\n'); setTimeout(() => process.exit(0), 50); });
`);
  return new Promise((resolve) => {
    const adapter = spawn('bash', ['-c', `${sibling} & node ${harness} ${tag}-srv; sleep 0.3; kill %1 2>/dev/null; wait`], {
      env: { ...process.env, GUARD_DIR: guard, MODEL_CMD: cmd }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let siblingAliveAfter = false;
    adapter.stdout.on('data', (d) => {
      out += d;
      if (out.includes('REPORT')) siblingAliveAfter = siblingAliveAfter || alive(sibling.split(' ').slice(0, 2).join(' ')).length > 0;
    });
    adapter.on('close', () => {
      const m = out.match(/REPORT(.*)/);
      resolve({ report: m ? JSON.parse(m[1]) : null, siblingAliveAfter });
    });
  });
}

describe.skipIf(!linux)('HB-KILL-GUARD (live processes)', () => {
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'killguard-'));
    // A stub `killall` on PATH so the guard writes its killall wrapper even where psmisc is absent (the wrapper only uses pgrep).
    const fake = path.join(dir, 'fakebin'); fs.mkdirSync(fake);
    fs.writeFileSync(path.join(fake, 'killall'), '#!/bin/sh\necho REAL-KILLALL-SHOULD-NOT-RUN >&2; exit 9\n', { mode: 0o755 });
    guard = ensureKillGuardDir({ ...process.env, PATH: `${fake}:${process.env.PATH}` }, dir) as string;
    // A looping script, not a copied `sleep` (coreutils may be a multi-call binary that dispatches on argv[0]). Via the shebang the
    // kernel sets comm to the script's basename, so both `pgrep -f` and name-matching `killall` see a name unique to this test run.
    sleepBin = path.join(dir, `${tag}slp`);
    fs.writeFileSync(sleepBin, '#!/bin/sh\nwhile :; do sleep 1; done\n', { mode: 0o755 });
  });
  afterAll(() => {
    try { execFileSync('pkill', ['-f', tag]); } catch { /* none left */ }
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('writes pkill / pgrep / killall wrappers', () => {
    expect(guard).toBeTruthy();
    for (const n of ['pkill', 'pgrep', 'killall']) {
      expect(fs.existsSync(path.join(guard, n))).toBe(true);
    }
  });

  it('pkill -f <pattern in its own command line> kills the target, not its own shell (the c21ba r3 command shape)', async () => {
    const { report } = await runTree(`${sleepBin} 31 & sleep 0.3; pkill -f "${tag}slp 31"; echo SURVIVED-rc=$?`, `${sleepBin} 4011`);
    expect(report).not.toBeNull();
    expect(report.out).toContain('SURVIVED-rc=0');
    expect(report.signal).toBeNull();
    expect(alive(`${tag}slp 31`)).toEqual([]);
  });

  it('pkill -f <pattern matching the harness server + the adapter sibling> kills only the model-started process', async () => {
    const { report, siblingAliveAfter } = await runTree(`node -e "setTimeout(()=>{},60000)" ${tag}-srv & sleep 0.4; pkill -f "${tag}"; echo SURVIVED; sleep 0.2; pgrep -f "node -e.*${tag}" || echo DECOY-GONE`, `${sleepBin} 4012`);
    expect(report).not.toBeNull(); // the harness server survived to report
    expect(report.out).toContain('SURVIVED');
    expect(report.out).toContain('DECOY-GONE');
    expect(report.err).toMatch(/\[harness\] pkill: left \d+ protected process/);
    expect(siblingAliveAfter).toBe(true);
  });

  it('killall <name> kills the model-started copy but not the adapter sibling of the same name', async () => {
    const { report, siblingAliveAfter } = await runTree(`${sleepBin} 32 & sleep 0.3; killall ${tag}slp; echo rc=$?; sleep 0.2; pgrep -f "${tag}slp 32" || echo MODEL-COPY-GONE`, `${sleepBin} 4013`);
    expect(report).not.toBeNull();
    expect(report.out).toContain('MODEL-COPY-GONE');
    expect(report.err).toMatch(/\[harness\] killall: left \d+ protected process/);
    expect(siblingAliveAfter).toBe(true);
  });

  it('pgrep hides the harness server and the calling shell', async () => {
    const { report } = await runTree(`pgrep -f "${tag}-srv" ; echo rc=$?`, `${sleepBin} 4014`);
    expect(report).not.toBeNull();
    expect(report.out.trim()).toBe('rc=1');
    expect(report.err).toMatch(/\[harness\] pgrep: hid \d+ protected/);
  });

  it('through the real Bash tool: the c21ba r3 command shape (pkill -f "<server name>") leaves the tool shell and this process alive', async () => {
    // The test process plays the harness server (ShellTool passes CORTEX_SERVER_PID = process.pid). Its command line contains no
    // marker, so the marker is put into a model-started decoy AND into the tool shell's own command line.
    const tool = new ShellTool({ workingDirectory: dir, allowFileSystem: true } as any);
    const res = await tool.execute({ command: `node -e "setTimeout(()=>{},60000)" ${tag}-next-server & sleep 0.4; pkill -f "${tag}-next-server"; pkill -f "${tag}-next start"; echo AFTER-PKILL` } as any, new AbortController().signal);
    expect(String(res.llmContent)).toContain('AFTER-PKILL');
    expect(res.metadata?.exitCode).toBe(0);
    expect(alive(`node -e.*${tag}-next-server`)).toEqual([]);
  });

  it('CORTEX_KILL_GUARD=off → no wrappers, spawn env untouched', () => {
    expect(killGuardEnabled({ CORTEX_KILL_GUARD: 'off' })).toBe(false);
    expect(killGuardEnabled({})).toBe(true);
    expect(ensureKillGuardDir({ ...process.env, CORTEX_KILL_GUARD: 'off' }, dir)).toBeNull();
    expect(killGuardSpawnEnv({ ...process.env, CORTEX_KILL_GUARD: 'off' })).toBeUndefined();
  });
});
