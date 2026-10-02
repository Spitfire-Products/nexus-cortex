/**
 * R209 HB-CONTAINER-PID1 (CORTEX_PID1_GUARD=on, dark, 2026-10-01).
 *
 * c23gb r1: the agent SIGKILLed `supervisord` (os.kill inside a Python script, so no shell kill guard could see it). The container's
 * PID 1 was `/app/entrypoint.sh`, which `wait`s on supervisord — PID 1 exited, the container stopped and the harness died (exit 137).
 * With the guard on, the harness reads PID 1's command line and its direct children once, at the first tool_result boundary (the boot
 * observation — normally orient's output), and when PID 1 is not the harness itself appends ONE short note naming what keeps the
 * container alive. Linux-only, cheap (one pass over /proc), fail-safe: any read error → no note, never throws.
 *
 *   CORTEX_PID1_GUARD = off (default) | on
 */
import { readFileSync, readdirSync } from 'fs';

export function resolvePid1Guard(env: NodeJS.ProcessEnv = process.env): boolean {
  return /^(on|true|1)$/i.test((env.CORTEX_PID1_GUARD ?? '').trim());
}

/** The /proc surface the guard reads — injectable so the note builder is testable from fake data. */
export interface ProcReader {
  /** Numeric pid directory names under /proc. */
  listPids(): number[];
  /** Raw /proc/<pid>/cmdline (NUL-separated); '' when unreadable. */
  cmdline(pid: number): string;
  /** Raw /proc/<pid>/stat; '' when unreadable. */
  stat(pid: number): string;
}

export const realProcReader: ProcReader = {
  listPids: () => readdirSync('/proc').filter((d) => /^\d+$/.test(d)).map(Number),
  cmdline: (pid) => { try { return readFileSync(`/proc/${pid}/cmdline`, 'utf8'); } catch { return ''; } },
  stat: (pid) => { try { return readFileSync(`/proc/${pid}/stat`, 'utf8'); } catch { return ''; } },
};

/** ppid from a /proc/<pid>/stat line; the comm field may hold spaces and parens, so parse after the LAST ')'. */
export function parseStatPpid(stat: string): number | null {
  const i = stat.lastIndexOf(')');
  if (i < 0) return null;
  const f = stat.slice(i + 1).trim().split(/\s+/); // [state, ppid, ...]
  const p = Number(f[1]);
  return Number.isInteger(p) && p >= 0 ? p : null;
}

/** NUL-separated cmdline → one display string, bounded. */
export function formatCmdline(raw: string, max = 100): string {
  const s = raw.split('\0').filter(Boolean).join(' ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export interface Pid1Info { pid1Cmd: string; children: Array<{ pid: number; cmd: string }> }

/**
 * Read PID 1 and its direct children. Returns null when PID 1 IS the harness (selfPid === 1), when PID 1's cmdline is unreadable,
 * or on any error. Children that are the harness or one of its ancestors are left out (the kill guard covers those); at most 3 kept.
 */
export function readPid1Info(reader: ProcReader, selfPid: number, maxScan = 4096): Pid1Info | null {
  try {
    if (selfPid === 1) return null;
    const pid1Cmd = formatCmdline(reader.cmdline(1));
    if (!pid1Cmd) return null;
    const ancestry = new Set<number>([selfPid]);
    for (let p = selfPid, hops = 0; p > 1 && hops < 64; hops++) {
      const pp = parseStatPpid(reader.stat(p));
      if (pp === null || pp <= 1) break;
      ancestry.add(pp); p = pp;
    }
    const children: Array<{ pid: number; cmd: string }> = [];
    for (const pid of reader.listPids().slice(0, maxScan)) {
      if (pid <= 1 || ancestry.has(pid)) continue;
      if (parseStatPpid(reader.stat(pid)) !== 1) continue;
      const cmd = formatCmdline(reader.cmdline(pid));
      if (cmd) children.push({ pid, cmd });
      if (children.length >= 3) break;
    }
    return { pid1Cmd, children };
  } catch {
    return null;
  }
}

/** The one-paragraph boot note. Pure. */
export function buildPid1Note(info: Pid1Info): string {
  const kids = info.children.map((c) => `\`${c.cmd}\` (pid ${c.pid})`).join(', ');
  const pids = info.children.map((c) => `pid ${c.pid}`).join(', ');
  const supervisor = /supervisord/.test(`${info.pid1Cmd} ${info.children.map((c) => c.cmd).join(' ')}`);
  const how = supervisor ? 'through their supervisor (e.g. `supervisorctl restart <name>`)' : 'through their supervisor or init script';
  if (info.children.length > 1) // which child PID 1 waits on is not knowable from /proc — say so instead of claiming every child is fatal
    return `Container init: PID 1 is \`${info.pid1Cmd}\`; it supervises ${kids}. Killing PID 1, or the child it waits on, stops the container and ends your session — restart services ${how} instead.`;
  return info.children.length
    ? `Container init: PID 1 is \`${info.pid1Cmd}\`; it supervises ${kids}. Killing ${pids} (or PID 1) stops the container and ends your session — restart services ${how} instead.`
    : `Container init: PID 1 is \`${info.pid1Cmd}\`. Killing PID 1 stops the container and ends your session — restart services ${how} instead.`;
}

/** Linux-only entry point: the note, or null (off-platform / harness is PID 1 / any error). Never throws. */
export function detectPid1Note(reader: ProcReader = realProcReader, selfPid: number = process.pid, platform: string = process.platform): { note: string; info: Pid1Info } | null {
  if (platform !== 'linux') return null;
  const info = readPid1Info(reader, selfPid);
  return info ? { note: buildPid1Note(info), info } : null;
}
