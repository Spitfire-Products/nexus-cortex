/**
 * `cortex schedule` core (2026-11-14). The harness had no agent-facing cron / loop / hook (grounded: no scheduler tool or route; the only
 * turn hook is the internal CANON_AUTO_SYNC capture). A team agent must stay responsive with nobody typing, so jobs live in a FILE
 * (~/.cortex/schedules.json) and the OS scheduler (launchd on macOS, cron on Linux) runs `cortex schedule run-due` every minute. Each
 * due job sends its prompt to the agent's session headlessly. Unlike session-only crons they survive crashes, restarts and compactions.
 *
 * Safety: a scheduled turn is unattended. By default it runs WITHOUT auto-approve, so a tool that needs approval fails fast instead of
 * waiting for a human (CLIApprovalHandler headless rule); `yolo: true` on a job opts in to auto-approve (the blacklist tier — Bash screen
 * capture / input / app scripting — still asks, i.e. is refused headless). `mailOnly` jobs fire only when the agent has unread mail.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

export interface ScheduleJob {
  tag: string;            // e.g. "[mail poll]" — unique key
  everyMin: number;       // period in minutes (>= 1)
  prompt: string;         // sent verbatim as the turn's user message
  session?: string;       // --resume <id>; omitted = a FRESH session per run (--new)
  model?: string;
  cwd?: string;           // project the turn runs in (default: home)
  mailName?: string;      // agent-home mail address for mailOnly (e.g. m2-cortex)
  mailOnly?: boolean;     // fire only when that address has unread mail
  yolo?: boolean;         // auto-approve tools for this job (operator decision)
  enabled?: boolean;
  lastRunMs?: number;
  lastRc?: number;
}

export function schedulesFile(): string { return path.join(os.homedir(), '.cortex', 'schedules.json'); }

export function loadJobs(file = schedulesFile()): ScheduleJob[] {
  try { const d = JSON.parse(fs.readFileSync(file, 'utf8')); return Array.isArray(d?.jobs) ? d.jobs : []; } catch { return []; }
}

export function saveJobs(file: string, jobs: ScheduleJob[]): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify({ jobs }, null, 1) + '\n'); fs.renameSync(tmp, file);   // atomic: a tick never reads half a file
}

export function upsertJob(jobs: ScheduleJob[], j: ScheduleJob): ScheduleJob[] {
  const i = jobs.findIndex((x) => x.tag === j.tag);
  if (i < 0) return [...jobs, j];
  const out = [...jobs]; out[i] = { ...jobs[i], ...j }; return out;
}

export function removeJob(jobs: ScheduleJob[], tag: string): ScheduleJob[] { return jobs.filter((j) => j.tag !== tag); }

/** Due when never run or a full period passed (20 s slack so a 60 s ticker does not slip a period). */
export function dueJobs(jobs: ScheduleJob[], nowMs: number): ScheduleJob[] {
  return jobs.filter((j) => j.enabled !== false && (!j.lastRunMs || nowMs - j.lastRunMs >= Math.max(1, j.everyMin) * 60_000 - 20_000));
}

/** argv + env for one headless turn. `cortexJs` = this install's bin/cortex.js (absolute: launchd has a minimal PATH). */
export function jobInvocation(j: ScheduleJob, cortexJs: string): { args: string[]; env: Record<string, string> } {
  const args = [cortexJs, '--quiet'];
  // a pinned session resumes it; otherwise EVERY run starts its own fresh session (m2 11-14): continuing "the server's current session"
  // mixed mail turns into whatever a human last ran (battery state), and sessions not started with --new missed the USER.md slot.
  if (j.session) args.push('--resume', j.session); else args.push('--new');
  if (j.model) args.push('-m', j.model);
  args.push(j.prompt);
  const env: Record<string, string> = {};
  if (j.yolo) env.YOLO = 'true';
  return { args, env };
}

/** mailOnly jobs pass only when `peek` (mail.py read --peek as the job's address) shows mail. Other jobs always pass. */
export function mailGate(j: ScheduleJob, peek: (mailName: string) => string): boolean {
  if (!j.mailOnly) return true;
  const out = (peek(j.mailName || '') || '').trim();
  return !!out && !/^no new mail/i.test(out);
}

/** One tick at a time (a turn can outlast the 60 s period). Returns a release fn, or null when another live tick holds it. */
export function acquireTickLock(lockFile: string, staleMs = 3 * 60 * 60_000): (() => void) | null {
  fs.mkdirSync(path.dirname(lockFile), { recursive: true });
  const take = () => { const fd = fs.openSync(lockFile, 'wx'); fs.writeSync(fd, String(process.pid)); fs.closeSync(fd); return () => { try { fs.rmSync(lockFile); } catch { /* gone */ } }; };
  try { return take(); } catch {
    try {
      const st = fs.statSync(lockFile);
      if (Date.now() - st.mtimeMs > staleMs) { fs.rmSync(lockFile, { force: true }); return take(); }
    } catch { /* raced */ }
    return null;
  }
}
