import { describe, it, expect } from 'vitest';
import { resolvePid1Guard, parseStatPpid, formatCmdline, readPid1Info, buildPid1Note, detectPid1Note, type ProcReader } from '../pid1Guard.js';

/** Fake /proc: pid → { cmd (space-separated, stored NUL-joined), ppid }. */
function fakeProc(procs: Record<number, { cmd: string; ppid: number; comm?: string }>, opts: { throwOn?: number } = {}): ProcReader {
  return {
    listPids: () => Object.keys(procs).map(Number),
    cmdline: (pid) => { if (pid === opts.throwOn) throw new Error('EACCES'); const p = procs[pid]; return p ? p.cmd.split(' ').join('\0') + '\0' : ''; },
    stat: (pid) => { const p = procs[pid]; return p ? `${pid} (${p.comm ?? 'x'}) S ${p.ppid} ${pid} ${pid} 0 -1` : ''; },
  };
}

// The c23gb r1 shape: entrypoint.sh is PID 1 and waits on supervisord; the harness came in via `docker exec` (ppid 0).
const C23GB = {
  1: { cmd: '/bin/bash /app/entrypoint.sh', ppid: 0 },
  7: { cmd: '/usr/bin/python3 /usr/bin/supervisord -n -c /etc/supervisor/supervisord.conf', ppid: 1 },
  20: { cmd: 'python3 app.py', ppid: 7 },
  300: { cmd: 'node /usr/lib/node_modules/nexus-cortex/bin/cortex serve', ppid: 0 },
  310: { cmd: 'bash -c python3 kill.py', ppid: 300 },
};

describe('R209 pid1Guard — lever', () => {
  it('is off by default and on for on|true|1', () => {
    expect(resolvePid1Guard({})).toBe(false);
    expect(resolvePid1Guard({ CORTEX_PID1_GUARD: 'off' })).toBe(false);
    expect(resolvePid1Guard({ CORTEX_PID1_GUARD: 'on' })).toBe(true);
    expect(resolvePid1Guard({ CORTEX_PID1_GUARD: 'TRUE' })).toBe(true);
    expect(resolvePid1Guard({ CORTEX_PID1_GUARD: '1' })).toBe(true);
  });
});

describe('R209 pid1Guard — /proc parsing', () => {
  it('reads ppid after the LAST paren (comm may hold spaces and parens)', () => {
    expect(parseStatPpid('42 (weird (name) here) S 7 42 42 0')).toBe(7);
    expect(parseStatPpid('garbage')).toBeNull();
    expect(parseStatPpid('')).toBeNull();
  });
  it('joins NUL-separated cmdline and bounds it', () => {
    expect(formatCmdline('a\0b\0c\0')).toBe('a b c');
    expect(formatCmdline('x'.repeat(300), 20)).toHaveLength(20);
  });
});

describe('R209 pid1Guard — note builder from fake /proc', () => {
  it('c23gb shape: names PID 1, the supervisord child and supervisorctl', () => {
    const info = readPid1Info(fakeProc(C23GB), 300)!;
    expect(info.pid1Cmd).toBe('/bin/bash /app/entrypoint.sh');
    expect(info.children.map((c) => c.pid)).toEqual([7]); // grandchild 20 and the harness tree are not direct children of PID 1
    const note = buildPid1Note(info);
    expect(note).toContain('PID 1 is `/bin/bash /app/entrypoint.sh`');
    expect(note).toContain('(pid 7)');
    expect(note).toContain('Killing pid 7 (or PID 1) stops the container and ends your session');
    expect(note).toContain('supervisorctl restart <name>');
  });
  it('excludes the harness and its ancestors from the children', () => {
    const procs = { 1: { cmd: '/sbin/tini -- /start.sh', ppid: 0 }, 5: { cmd: 'sh /start.sh', ppid: 1 }, 9: { cmd: 'node cortex serve', ppid: 5 }, 11: { cmd: 'nginx: master', ppid: 1 } };
    const info = readPid1Info(fakeProc(procs), 9)!;
    expect(info.children.map((c) => c.pid)).toEqual([11]);
    expect(buildPid1Note(info)).toContain('through their supervisor or init script'); // no supervisord → generic wording
  });
  it('no children → PID 1 line only', () => {
    const info = readPid1Info(fakeProc({ 1: { cmd: 'sleep infinity', ppid: 0 } }), 50)!;
    expect(info.children).toEqual([]);
    expect(buildPid1Note(info)).toMatch(/^Container init: PID 1 is `sleep infinity`\. Killing PID 1 stops the container/);
  });
  it('keeps at most 3 children', () => {
    const procs: Record<number, { cmd: string; ppid: number }> = { 1: { cmd: 'init', ppid: 0 } };
    for (let i = 2; i < 10; i++) procs[i] = { cmd: `svc${i}`, ppid: 1 };
    expect(readPid1Info(fakeProc(procs), 99)!.children).toHaveLength(3);
    expect(buildPid1Note(readPid1Info(fakeProc(procs), 99)!)).toContain('Killing PID 1, or the child it waits on, stops the container');
  });
  it('the harness IS PID 1 → no note', () => {
    expect(readPid1Info(fakeProc(C23GB), 1)).toBeNull();
  });
  it('fail-safe: unreadable PID 1 or a throwing reader → null, never throws', () => {
    expect(readPid1Info(fakeProc({ 7: { cmd: 'x', ppid: 1 } }), 300)).toBeNull();
    expect(readPid1Info(fakeProc(C23GB, { throwOn: 1 }), 300)).toBeNull();
    const broken: ProcReader = { listPids: () => { throw new Error('ENOENT'); }, cmdline: () => 'init\0', stat: () => '' };
    expect(readPid1Info(broken, 300)).toBeNull();
  });
  it('non-Linux → null', () => {
    expect(detectPid1Note(fakeProc(C23GB), 300, 'darwin')).toBeNull();
    expect(detectPid1Note(fakeProc(C23GB), 300, 'linux')?.note).toContain('supervisord');
  });
});
