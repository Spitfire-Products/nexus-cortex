/**
 * `cortex schedule` — durable loops / crons for the cortex agent (2026-11-14). Core + rationale: ../lifecycle/schedule.ts.
 *   cortex schedule add "<tag>" --every <min> (--prompt <text> | --prompt-file <f>) [--mail-name <addr> --mail-only] [--yolo] [--cwd <dir>] [--session <id>] [--model <id>]
 *   cortex schedule list | remove "<tag>" | enable|disable "<tag>" | run-due [--dry-run] | install | uninstall
 * `install` registers ONE OS ticker (launchd every 60 s on macOS, a crontab line on Linux) that runs `cortex schedule run-due`.
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { acquireTickLock, dueJobs, jobInvocation, loadJobs, mailGate, removeJob, saveJobs, schedulesFile, upsertJob, type ScheduleJob } from '../lifecycle/schedule.js';

const CORTEX_JS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin', 'cortex.js');
const LOG = path.join(os.homedir(), '.cortex', 'schedule.log');
const LOCK = path.join(os.homedir(), '.cortex', 'schedule-tick.lock');
const PLIST = path.join(os.homedir(), 'Library', 'LaunchAgents', 'com.nexus-cortex.schedule.plist');
const CRON_MARK = '# nexus-cortex schedule ticker';

function log(line: string) { fs.mkdirSync(path.dirname(LOG), { recursive: true }); fs.appendFileSync(LOG, `${new Date().toISOString()} ${line}\n`); }

function peekMail(addr: string): string {
  const mail = path.join(os.homedir(), 'agent-home', 'scripts', 'mail.py');
  if (!fs.existsSync(mail)) return '';
  const r = spawnSync('python3', [mail, 'read', '--peek'], { encoding: 'utf8', timeout: 90_000, env: { ...process.env, ...(addr ? { AGENT_HOME_MAIL_NAME: addr } : {}) } });
  return (r.stdout || '').trim();
}

/** PATH for the OS ticker. launchd/cron give a minimal PATH, so tools the agent relies on vanished in scheduled turns (macbook 11-14: cliclick in
 *  ~/.local/bin, screencapture in /usr/sbin; /opt/homebrew is the Apple-silicon prefix only). Use the INSTALLING shell's PATH (the user's own),
 *  plus node's dir, ~/.cortex/bin, ~/.local/bin and the standard system dirs — deduplicated, order kept. */
export function tickerPath(envPath = process.env.PATH || ''): string {
  const home = os.homedir();
  const parts = [path.dirname(process.execPath), path.join(home, '.cortex', 'bin'), path.join(home, '.local', 'bin'), ...envPath.split(':'),
    '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/local/sbin', '/usr/sbin', '/sbin'];
  return [...new Set(parts.filter(Boolean))].join(':');
}

export async function scheduleCli(op: string, tag: string | undefined, o: Record<string, any>): Promise<void> {
  const file = schedulesFile(); let jobs = loadJobs(file);
  switch (op) {
    case 'add': {
      if (!tag) throw new Error('add needs a tag, e.g. "[mail poll]"');
      const prompt = o.promptFile ? fs.readFileSync(o.promptFile, 'utf8').trim() : String(o.prompt || '').trim();
      const every = Number(o.every);
      if (!prompt || !(every >= 1)) throw new Error('add needs --every <minutes ≥ 1> and --prompt or --prompt-file');
      const j: ScheduleJob = { tag, everyMin: every, prompt, ...(o.session ? { session: o.session } : {}), ...(o.model ? { model: o.model } : {}),
        ...(o.cwd ? { cwd: path.resolve(o.cwd) } : {}), ...(o.mailName ? { mailName: o.mailName } : {}), mailOnly: !!o.mailOnly, yolo: !!o.yolo, enabled: true };
      saveJobs(file, upsertJob(jobs, j)); console.log(`[schedule] ${tag}: every ${every} min${j.mailOnly ? `, only with unread mail for ${j.mailName}` : ''}${j.yolo ? ', auto-approve ON' : ''}`); return;
    }
    case 'remove': saveJobs(file, removeJob(jobs, tag || '')); console.log(`[schedule] removed ${tag}`); return;
    case 'enable': case 'disable': saveJobs(file, jobs.map((j) => j.tag === tag ? { ...j, enabled: op === 'enable' } : j)); console.log(`[schedule] ${op}d ${tag}`); return;
    case 'list': {
      if (!jobs.length) { console.log('[schedule] no jobs (cortex schedule add …)'); return; }
      for (const j of jobs) console.log(`${j.enabled === false ? 'off' : 'on '} ${j.tag}  every ${j.everyMin} min${j.mailOnly ? ` · mail-only (${j.mailName})` : ''}${j.yolo ? ' · yolo' : ''} · last ${j.lastRunMs ? new Date(j.lastRunMs).toISOString() : 'never'}${j.lastRc !== undefined ? ` rc ${j.lastRc}` : ''}`);
      console.log(`ticker: ${process.platform === 'darwin' ? (fs.existsSync(PLIST) ? 'launchd installed' : 'NOT installed (cortex schedule install)') : 'crontab (cortex schedule install)'} · log ${LOG}`);
      return;
    }
    case 'run-due': {
      const release = acquireTickLock(LOCK); if (!release) return;   // a previous tick's turn is still running
      try {
        for (const j of dueJobs(jobs, Date.now())) {
          if (!mailGate(j, peekMail)) continue;                        // mail-only and nothing unread: no turn, no spend
          if (o.dryRun) { console.log(`[schedule] would run ${j.tag}`); continue; }
          jobs = loadJobs(file).map((x) => x.tag === j.tag ? { ...x, lastRunMs: Date.now() } : x); saveJobs(file, jobs);   // stamp BEFORE: a crash never re-fires in a loop
          const inv = jobInvocation(j, CORTEX_JS); const t0 = Date.now();
          const r = spawnSync(process.execPath, inv.args, { cwd: j.cwd || os.homedir(), encoding: 'utf8', timeout: 45 * 60_000, env: { ...process.env, ...inv.env } });
          const rc = r.status ?? -1;
          log(`${j.tag} rc=${rc} ${Math.round((Date.now() - t0) / 1000)}s ${String(r.stdout || r.stderr || '').replace(/\s+/g, ' ').slice(0, 300)}`);
          jobs = loadJobs(file).map((x) => x.tag === j.tag ? { ...x, lastRc: rc } : x); saveJobs(file, jobs);
        }
      } finally { release(); }
      return;
    }
    case 'install': {
      if (process.platform === 'darwin') {
        const pathEnv = tickerPath();
        fs.mkdirSync(path.dirname(PLIST), { recursive: true });
        fs.writeFileSync(PLIST, `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>\n<key>Label</key><string>com.nexus-cortex.schedule</string>\n<key>ProgramArguments</key><array><string>${process.execPath}</string><string>${CORTEX_JS}</string><string>schedule</string><string>run-due</string></array>\n<key>EnvironmentVariables</key><dict><key>PATH</key><string>${pathEnv}</string></dict>\n<key>StartInterval</key><integer>60</integer>\n<key>StandardOutPath</key><string>${LOG}</string><key>StandardErrorPath</key><string>${LOG}</string>\n</dict></plist>\n`);
        spawnSync('launchctl', ['unload', PLIST]); const r = spawnSync('launchctl', ['load', '-w', PLIST], { encoding: 'utf8' });
        console.log(r.status === 0 ? `[schedule] ticker installed (launchd, every 60 s): ${PLIST}` : `[schedule] launchctl load failed: ${r.stderr}`); return;
      }
      const cur = spawnSync('crontab', ['-l'], { encoding: 'utf8' }).stdout || '';
      if (cur.includes(CRON_MARK)) { console.log('[schedule] ticker already in crontab'); return; }
      const line = `* * * * * PATH=${tickerPath()} ${process.execPath} ${CORTEX_JS} schedule run-due >> ${LOG} 2>&1 ${CRON_MARK}`;
      const r = spawnSync('crontab', ['-'], { input: cur.replace(/\n?$/, '\n') + line + '\n', encoding: 'utf8' });
      console.log(r.status === 0 ? '[schedule] ticker installed (crontab, every minute)' : `[schedule] crontab failed: ${r.stderr}`); return;
    }
    case 'uninstall': {
      if (process.platform === 'darwin') { spawnSync('launchctl', ['unload', PLIST]); fs.rmSync(PLIST, { force: true }); console.log('[schedule] launchd ticker removed'); return; }
      const cur = spawnSync('crontab', ['-l'], { encoding: 'utf8' }).stdout || '';
      spawnSync('crontab', ['-'], { input: cur.split('\n').filter((l) => !l.includes(CRON_MARK)).join('\n'), encoding: 'utf8' }); console.log('[schedule] crontab ticker removed'); return;
    }
    default: throw new Error(`unknown op ${op} (add | list | remove | enable | disable | run-due | install | uninstall)`);
  }
}
