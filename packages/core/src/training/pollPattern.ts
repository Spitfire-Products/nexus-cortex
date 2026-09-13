/**
 * pollPattern — R135 HB-POLL-LOOP (2026-09-13).
 *
 * Terminal-Bench 4.0 ctr-optimization (a 48-sim-hour task, 1 sim hour = 6 real minutes): the model had to
 * observe an eval window hours later and polled with `sleep 115; curl -s …/config | python3 -c "…print(…)"`
 * variants. The near-dup similarity lens scored every poll as a repeat: loop_escalation diversify x3 →
 * loop_tool_block neardup-similarity x3 (redirect Read/Write/Edit) → "Bash is disabled" → the model routed
 * around via CreateArtifactTool oneshot x14 and finalized WITHOUT observing its eval window.
 *
 * ONE pure helper: recognize a POLL — a WAIT (`sleep N`, `timeout N` wrapping a wait, `until`/`while … sleep`
 * loop) combined with a READ-ONLY probe (curl/wget/http GET, cat/tail/ls/stat/ps/pgrep/docker ps|logs/
 * kubectl get/systemctl status/nc -z/ss/netstat/test -f, `python3 -c` bodies that only GET and print). A
 * bare read-only probe with NO wait is reported with its probe identity (isPoll=false) so the ladder can
 * treat an immediate repeat of the same probe as a poll. CONSERVATIVE: any write verb (POST/PUT/DELETE,
 * `-d`, a `>` redirect outside /tmp, rm/mv/cp, git commit/push, installs, build/test runners, scripts that
 * are not obviously probes) or anything unrecognized → NOT a poll.
 */
import { splitSegments } from './commandIdentity.js';

export interface PollPattern {
  /** A wait combined with a read-only probe (and nothing else). */
  isPoll: boolean;
  /** Total foreground wait in seconds when known (sum of sleeps; the per-iteration sleep of a loop). */
  waitSec?: number;
  /** Stable identity of the probe (`curl localhost:5000/api/v1/config`, `tail /tmp/train.log`, …); set for
   *  bare read-only probes too so an immediate repeat can be recognized as a poll. */
  probe?: string;
}

type SegKind = 'wait' | 'probe' | 'neutral' | 'unsafe';
/** `status`: a network/process/service/log probe — the only kind whose BARE immediate repeat (no wait) counts as a poll;
 *  inspection probes (ls/grep/test/python -c print) repeated bare stay visible to the loop lenses (R136/R136b classes). */
interface Seg { kind: SegKind; waitSec?: number; probe?: string; status?: boolean }

const LOOP_KEYWORDS = /^(until|while|done|do|then|else|elif|fi|if|for|in)\b\s*|^!\s*/;
const WRAPPERS = new Set(['time', 'nice', 'nohup', 'stdbuf', 'command', 'env', 'sudo']);
const NEUTRAL_HEADS = new Set(['cd', 'echo', 'printf', 'true', ':', 'export', 'set', 'date', 'pwd', 'sync']);
// Read-only probe heads (first token). Verbs of multi-verb tools are checked separately below.
const PROBE_HEADS = new Set([
  'cat', 'tail', 'head', 'ls', 'stat', 'wc', 'ps', 'pgrep', 'ss', 'netstat', 'lsof', 'df', 'du', 'free', 'uptime',
  'test', '[', '[[', 'grep', 'egrep', 'fgrep', 'rg', 'jq', 'nvidia-smi', 'top', 'nc', 'ncat', 'ping', 'dig', 'nslookup',
  'journalctl', 'id', 'whoami', 'hostname', 'file', 'find', 'md5sum', 'sha256sum', 'sqlite3',
]);
const STATUS_HEADS = new Set(['tail', 'cat', 'ps', 'pgrep', 'ss', 'netstat', 'nc', 'ncat', 'lsof', 'nvidia-smi', 'top', 'journalctl', 'ping', 'df', 'free', 'uptime']);
const VERB_TOOLS: Record<string, ReadonlySet<string>> = {
  docker: new Set(['ps', 'logs', 'inspect', 'stats', 'top', 'port', 'images', 'version', 'info']),
  kubectl: new Set(['get', 'describe', 'logs', 'top', 'version']),
  systemctl: new Set(['status', 'is-active', 'is-enabled', 'is-failed', 'show', 'list-units']),
  git: new Set(['status', 'log', 'diff', 'show', 'branch', 'rev-parse']),
  podman: new Set(['ps', 'logs', 'inspect', 'stats']),
  'docker-compose': new Set(['ps', 'logs']),
};
const CURL_WRITE_FLAGS = /^(-d|--data(-\w+)?|-F|--form|-T|--upload-file|--json)$/;
const WGET_WRITE_FLAGS = /^(--post-data|--post-file|--method|--body-data|--body-file)/;
const URL_RE = /(?:https?:\/\/[^\s'"|;&)]+|\b(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?(?:\/[^\s'"|;&)]*)?)/;
const PY_WRITE_RE = /\b(requests\.(post|put|delete|patch)|urllib\.request\.Request\([^)]*data=|urlopen\([^)]*data=|method\s*=\s*['"](POST|PUT|DELETE|PATCH)|open\([^)]*['"][wax][b+]*['"]|\.write\(|json\.dump\(|subprocess|os\.system|os\.(remove|unlink|rename|makedirs|mkdir)|shutil\.|Popen|pickle\.dump\()/;
const PY_PROBE_RE = /\b(print\(|requests\.(get|head)\(|urlopen\(|sys\.stdin|json\.load\()/;

/** `sleep 115` → 115, `sleep 2m` → 120, `sleep 1.5` → 1.5; undefined when not a literal. */
function parseSeconds(tok: string | undefined): number | undefined {
  if (!tok) return undefined;
  const m = /^(\d+(?:\.\d+)?)([smhd]?)$/.exec(tok);
  if (!m) return undefined;
  const n = parseFloat(m[1]!);
  const mult = { '': 1, s: 1, m: 60, h: 3600, d: 86400 }[m[2] as '' | 's' | 'm' | 'h' | 'd'];
  return n * mult;
}

/** Whitespace tokenizer keeping quoted spans (unquoted text) as one token. */
function tokenize(seg: string): string[] {
  const toks: string[] = [];
  let cur = '';
  let inTok = false;
  let quote: string | null = null;
  for (let i = 0; i < seg.length; i++) {
    const ch = seg[i]!;
    if (quote) {
      if (ch === quote) { quote = null; continue; }
      if (ch === '\\' && quote === '"' && i + 1 < seg.length) { cur += seg[++i]; continue; }
      cur += ch; continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; inTok = true; continue; }
    if (ch === '\\' && i + 1 < seg.length) { cur += seg[++i]; inTok = true; continue; }
    if (/\s/.test(ch)) { if (inTok) { toks.push(cur); cur = ''; inTok = false; } continue; }
    cur += ch; inTok = true;
  }
  if (inTok) toks.push(cur);
  return toks;
}

/** A `>`/`>>` redirect to anything but /dev/null or /tmp is a write. Returns the segment with redirects stripped, or null. */
function stripRedirects(seg: string): string | null {
  let unsafe = false;
  const out = seg.replace(/(?:\d*|&)>{1,2}\s*([^\s;|&]+)/g, (_m, target: string) => {
    if (target === '/dev/null' || target === '&1' || target === '&2' || target.startsWith('/tmp/')) return ' ';
    unsafe = true;
    return ' ';
  }).replace(/<\s*[^\s;|&]+/g, ' ');
  return unsafe ? null : out;
}

function outputTargetOk(target: string | undefined): boolean {
  return !!target && (target === '-' || target === '/dev/null' || target.startsWith('/tmp/'));
}

function probeId(head: string, args: string[]): string {
  const url = URL_RE.exec(args.join(' '))?.[0];
  if (url) return `${head} ${url.replace(/^https?:\/\//, '')}`;
  const target = args.find((a) => !a.startsWith('-'));
  return target ? `${head} ${target}` : head;
}

function classifyCurl(args: string[]): Seg {
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (CURL_WRITE_FLAGS.test(a)) return { kind: 'unsafe' };
    if (a === '-X' || a === '--request') { if (!/^(GET|HEAD)$/i.test(args[i + 1] ?? '')) return { kind: 'unsafe' }; i++; continue; }
    if (/^(-X|--request=)/.test(a) && !/^(-X|--request=)(GET|HEAD)$/i.test(a)) return { kind: 'unsafe' };
    if (a === '-o' || a === '--output') { if (!outputTargetOk(args[i + 1])) return { kind: 'unsafe' }; i++; continue; }
    if (a === '-O' || a === '--remote-name') return { kind: 'unsafe' };
  }
  return { kind: 'probe', probe: probeId('curl', args), status: true };
}

function classifyWget(args: string[]): Seg {
  let stdout = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (WGET_WRITE_FLAGS.test(a)) return { kind: 'unsafe' };
    if (a === '--spider') stdout = true;
    if (a === '-O' || a === '--output-document') { if (!outputTargetOk(args[i + 1])) return { kind: 'unsafe' }; stdout = true; i++; continue; }
    if (/^-q?O-$/.test(a) || /^--output-document=/.test(a)) { if (a.endsWith('-') || outputTargetOk(a.split('=')[1])) stdout = true; else return { kind: 'unsafe' }; }
  }
  return stdout ? { kind: 'probe', probe: probeId('wget', args), status: true } : { kind: 'unsafe' }; // a plain wget downloads a file into cwd
}

function classifyHttpie(args: string[]): Seg {
  const method = /^[A-Z]+$/.test(args[0] ?? '') ? args[0]! : 'GET';
  if (!/^(GET|HEAD)$/.test(method)) return { kind: 'unsafe' };
  if (args.some((a) => /^[\w-]+(:=|=)(?!=)/.test(a) && !a.includes(':') )) return { kind: 'unsafe' }; // request items = an implicit POST
  return { kind: 'probe', probe: probeId('http', args), status: true };
}

/** `python3 -c BODY`: a probe only when the body GETs/prints and never writes. */
function classifyPythonInline(body: string): Seg {
  if (PY_WRITE_RE.test(body)) return { kind: 'unsafe' };
  const sleep = /time\.sleep\(\s*(\d+(?:\.\d+)?)\s*\)/.exec(body);
  if (!PY_PROBE_RE.test(body)) {
    return sleep && /^\s*import\s+time\s*;?\s*time\.sleep\([^)]*\)\s*$/.test(body) ? { kind: 'wait', waitSec: parseFloat(sleep[1]!) } : { kind: 'unsafe' };
  }
  const url = URL_RE.exec(body)?.[0];
  return { kind: 'probe', probe: url ? `python3 ${url.replace(/^https?:\/\//, '')}` : 'python3 -c probe', ...(sleep ? { waitSec: parseFloat(sleep[1]!) } : {}) };
}

function classifySegment(raw: string): Seg {
  let bare = raw.trim();
  if (/^for\s+\w+\s+in\b/.test(bare)) return { kind: 'neutral' }; // `for i in 1 2 3` header (the body segments are classified on their own)
  for (let prev = ''; prev !== bare; ) { prev = bare; bare = bare.replace(LOOP_KEYWORDS, '').trim(); }
  const stripped = stripRedirects(bare);
  if (stripped === null) return { kind: 'unsafe' };
  let toks = tokenize(stripped.trim());
  while (toks.length && /^[A-Za-z_]\w*=/.test(toks[0]!)) toks = toks.slice(1); // VAR=x prefix
  if (toks.length === 0) return { kind: 'neutral' };
  let head = toks[0]!;
  // Wrappers: `timeout N cmd` is a wait only when cmd is itself a wait / blocking probe; other wrappers are transparent.
  let timeoutSec: number | undefined;
  for (;;) {
    if (head === 'timeout') {
      let j = 1;
      while (toks[j]?.startsWith('-')) j += /^(-s|--signal|-k|--kill-after)$/.test(toks[j]!) ? 2 : 1;
      timeoutSec = parseSeconds(toks[j]);
      toks = toks.slice(j + 1); head = toks[0] ?? '';
      continue;
    }
    if (WRAPPERS.has(head)) { toks = toks.slice(1); while (toks[0]?.startsWith('-')) toks = toks.slice(1); head = toks[0] ?? ''; continue; }
    break;
  }
  if (!head) return { kind: 'neutral' };
  const args = toks.slice(1);
  if (head === 'sleep') return { kind: 'wait', waitSec: parseSeconds(args[0]) };
  if (/^(bash|sh|zsh|dash)$/.test(head) && args[0] === '-c' && args[1]) {
    const inner = detectPollPattern(args[1]);
    if (inner.isPoll) return { kind: 'probe', probe: inner.probe, waitSec: inner.waitSec ?? timeoutSec, status: true };
    return { kind: 'unsafe' };
  }
  if (/^(python[\d.]*|pypy[\d]*)$/.test(head)) {
    const c = args.indexOf('-c');
    return c >= 0 && args[c + 1] ? classifyPythonInline(args[c + 1]!) : { kind: 'unsafe' };
  }
  if (head === 'curl') return classifyCurl(args);
  if (head === 'wget') return classifyWget(args);
  if (head === 'http' || head === 'https' || head === 'xh') return classifyHttpie(args);
  if (NEUTRAL_HEADS.has(head)) return { kind: 'neutral' };
  const verbs = VERB_TOOLS[head];
  if (verbs) return verbs.has(args[0] ?? '') ? { kind: 'probe', probe: probeId(`${head} ${args[0]}`, args.slice(1)), status: head !== 'git' } : { kind: 'unsafe' };
  if (PROBE_HEADS.has(head)) {
    if (head === 'sqlite3' && !args.some((a) => /^\s*select\b/i.test(a))) return { kind: 'unsafe' };
    if ((head === 'nc' || head === 'ncat') && !args.includes('-z')) return { kind: 'unsafe' };
    if (head === 'find' && args.some((a) => /^-(delete|exec|execdir|ok)$/.test(a))) return { kind: 'unsafe' };
    if (head === 'grep' && args.includes('-r') && args.length > 8) return { kind: 'unsafe' }; // a scan, not a status probe
    const blocking = head === 'tail' && args.some((a) => /^-[a-zA-Z]*[fF]/.test(a));
    return { kind: 'probe', probe: probeId(head, args), status: STATUS_HEADS.has(head), ...(blocking && timeoutSec ? { waitSec: timeoutSec } : {}) };
  }
  return { kind: 'unsafe' };
}

/**
 * Recognize a poll-and-wait command. `isPoll` requires at least one wait AND at least one read-only probe
 * and NO unsafe segment; `probe` is the identity of the first probe (set for bare probes too).
 */
export function detectPollPattern(command: string): PollPattern {
  const cmd = String(command ?? '').trim();
  if (!cmd) return { isPoll: false };
  const loop = /\b(until|while)\b[\s\S]*\bdo\b[\s\S]*\bdone\b/.test(cmd);
  const segs = splitSegments(cmd).map(classifySegment);
  if (segs.some((s) => s.kind === 'unsafe')) return { isPoll: false };
  const probes = segs.filter((s) => s.kind === 'probe');
  const probe = probes[0]?.probe;
  const waits = segs.filter((s) => s.kind === 'wait' || s.waitSec !== undefined);
  if (probes.length === 0) return { isPoll: false };
  if (waits.length === 0 && !loop) return { isPoll: false, ...(probes[0]!.status ? { probe } : {}) }; // bare status probe: identity only
  const known = waits.map((w) => w.waitSec).filter((n): n is number => typeof n === 'number' && Number.isFinite(n));
  const waitSec = known.length ? (loop ? Math.max(...known) : known.reduce((a, b) => a + b, 0)) : undefined;
  return { isPoll: true, ...(waitSec !== undefined ? { waitSec } : {}), probe };
}
