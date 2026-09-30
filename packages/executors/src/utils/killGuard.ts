/**
 * HB-KILL-GUARD (CORTEX_KILL_GUARD, default on — 2026-09-30).
 *
 * The Bash tool runs every command as `bash -c "<command>"`, so a model's `pkill -f "<pattern>"` always matches its OWN shell (the
 * pattern is in that shell's command line) and a broad `pkill -f node` / `killall node` / `kill $(pgrep -f node)` reaches the harness
 * server itself. TB4.0 c21ba cumulative-layout-shift r3 (2026-09-30): `pkill -f "next-server"; pkill -f "next start"; …` killed the
 * tool's own shell (SIGTERM) and the run ended as NonZeroAgentExitCodeError 29 min in.
 *
 * The guard puts `pkill`, `killall` and `pgrep` wrappers first on the Bash tool's PATH. Each resolves its targets with the real
 * pgrep and drops PROTECTED processes before signalling / listing:
 *   - the calling shell and every ancestor of it;
 *   - the harness server (CORTEX_SERVER_PID) and every ancestor of it (pid 0/1 excluded);
 *   - every process descended from one of those ancestors OTHER than through the server (the bench adapter's request, its process
 *     recorder, the harbor exec wrappers).
 * Anything the model started — a tool-shell child, a run_in_background job, a daemon it detached to init — stays killable.
 * A skipped target is reported on stderr: "[harness] pkill: left N protected process(es) alone (pids …)".
 * Not covered: the `kill` builtin with literal pids, `ps | xargs kill`, persistent tmux panes (TmuxSession).
 *
 *   CORTEX_KILL_GUARD = on (default) | off (no PATH change; byte-identical spawn env)
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export function killGuardEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = String(env.CORTEX_KILL_GUARD ?? '').trim().toLowerCase();
  return !(v === 'off' || v === 'false' || v === '0');
}

/** First executable `name` on PATH, skipping `skipDir`; '' when absent. */
export function resolveReal(name: string, pathEnv: string | undefined, skipDir?: string): string {
  for (const d of String(pathEnv ?? '').split(path.delimiter)) {
    if (!d || (skipDir && path.resolve(d) === path.resolve(skipDir))) continue;
    const p = path.join(d, name);
    try { fs.accessSync(p, fs.constants.X_OK); if (fs.statSync(p).isFile()) return p; } catch { /* next */ }
  }
  return '';
}

/** Shared POSIX-sh preamble: protected-set test over /proc. */
const PROTECT_SH = `
ppid_of() { awk '/^PPid:/{print $2}' "/proc/$1/status" 2>/dev/null; }
SELF=" "; p=$$; while [ -n "$p" ] && [ "$p" -gt 0 ] 2>/dev/null; do SELF="$SELF$p "; p=$(ppid_of "$p"); done
SRV="\${CORTEX_SERVER_PID:-}"; HA=" "
if [ -n "$SRV" ] && [ -d "/proc/$SRV" ]; then p=$SRV; while [ -n "$p" ] && [ "$p" -gt 1 ] 2>/dev/null; do HA="$HA$p "; p=$(ppid_of "$p"); done; fi
is_protected() {
  case "$SELF" in *" $1 "*) return 0;; esac
  case "$HA" in *" $1 "*) return 0;; esac
  [ -n "$SRV" ] || return 1
  q=$(ppid_of "$1")
  while [ -n "$q" ] && [ "$q" -gt 1 ] 2>/dev/null; do
    [ "$q" = "$SRV" ] && return 1
    case "$HA" in *" $q "*) return 0;; esac
    q=$(ppid_of "$q")
  done
  return 1
}
`;

function pkillScript(realPgrep: string): string {
  return `#!/bin/sh
# nexus-cortex HB-KILL-GUARD pkill: never signals this shell, the harness server or the harness's own processes.
REAL_PGREP='${realPgrep}'
${PROTECT_SH}
sig=TERM; echo_kill=0; count=0; nextsig=0; first=1
for a do
  if [ $first = 1 ]; then set --; first=0; fi
  if [ $nextsig = 1 ]; then sig=$a; nextsig=0; continue; fi
  case $a in
    --signal) nextsig=1;;
    --signal=*) sig=\${a#--signal=};;
    -e|--echo) echo_kill=1;;
    -c|--count) count=1;;
    -[0-9]*) sig=\${a#-};;
    -SIG*) sig=\${a#-SIG};;
    -[A-Z][A-Z]*) sig=\${a#-};;
    *) set -- "$@" "$a";;
  esac
done
pids=$("$REAL_PGREP" "$@"); rc=$?
[ $rc -gt 1 ] && exit $rc
n=0; skipped=""
for pid in $pids; do
  if is_protected "$pid"; then skipped="$skipped $pid"; continue; fi
  if kill -s "$sig" "$pid" 2>/dev/null; then n=$((n+1)); [ $echo_kill = 1 ] && echo "killed (pid $pid)"; fi
done
[ -n "$skipped" ] && echo "[harness] pkill: left $(echo $skipped | wc -w) protected process(es) alone (this shell / the harness:$skipped)" >&2
[ $count = 1 ] && echo $n
[ $n -gt 0 ] && exit 0 || exit 1
`;
}

function pgrepScript(realPgrep: string): string {
  return `#!/bin/sh
# nexus-cortex HB-KILL-GUARD pgrep: hides this shell, the harness server and the harness's own processes.
REAL_PGREP='${realPgrep}'
${PROTECT_SH}
count=0; first=1
for a do
  if [ $first = 1 ]; then set --; first=0; fi
  case $a in -c|--count) count=1;; *) set -- "$@" "$a";; esac
done
out=$("$REAL_PGREP" "$@"); rc=$?
[ $rc -gt 1 ] && exit $rc
n=0; hid=0; res=""
nl='
'
IFS_OLD=$IFS; IFS=$nl
for line in $out; do
  pid=\${line%% *}
  if is_protected "$pid"; then hid=$((hid+1)); continue; fi
  n=$((n+1)); res="$res$line$nl"
done
IFS=$IFS_OLD
if [ $count = 1 ]; then echo $n; else printf '%s' "$res"; fi
[ $hid -gt 0 ] && echo "[harness] pgrep: hid $hid protected process(es) (this shell / the harness)" >&2
[ $n -gt 0 ] && exit 0 || exit 1
`;
}

function killallScript(realPgrep: string): string {
  return `#!/bin/sh
# nexus-cortex HB-KILL-GUARD killall: never signals this shell, the harness server or the harness's own processes.
REAL_PGREP='${realPgrep}'
${PROTECT_SH}
sig=TERM; quiet=0; regex=0; icase=0; user=""; nextsig=0; nextuser=0; names=""
for a do
  if [ $nextsig = 1 ]; then sig=$a; nextsig=0; continue; fi
  if [ $nextuser = 1 ]; then user=$a; nextuser=0; continue; fi
  case $a in
    -s|--signal) nextsig=1;;
    --signal=*) sig=\${a#--signal=};;
    -u|--user) nextuser=1;;
    -q|--quiet) quiet=1;;
    -r|--regexp) regex=1;;
    -I|--ignore-case) icase=1;;
    -[0-9]*) sig=\${a#-};;
    -SIG*) sig=\${a#-SIG};;
    -[A-Z][A-Z]*) sig=\${a#-};;
    -*) ;;
    *) names="$names $a";;
  esac
done
[ -n "$names" ] || { echo "killall: no process name given" >&2; exit 1; }
n=0; skipped=""; missing=0
for name in $names; do
  set --
  [ $regex = 1 ] || set -- -x
  [ $icase = 1 ] && set -- "$@" -i
  [ -n "$user" ] && set -- "$@" -u "$user"
  pids=$("$REAL_PGREP" "$@" "$name")
  [ -n "$pids" ] || { missing=1; [ $quiet = 1 ] || echo "$name: no process found" >&2; continue; }
  for pid in $pids; do
    if is_protected "$pid"; then skipped="$skipped $pid"; continue; fi
    kill -s "$sig" "$pid" 2>/dev/null && n=$((n+1))
  done
done
[ -n "$skipped" ] && echo "[harness] killall: left $(echo $skipped | wc -w) protected process(es) alone (this shell / the harness:$skipped)" >&2
[ $n -gt 0 ] && exit 0 || exit 1
`;
}

let cachedDir: string | null | undefined;

/** Writes the wrappers once per process (idempotent); returns their dir, or null when disabled / no real pgrep / not linux. */
export function ensureKillGuardDir(env: NodeJS.ProcessEnv = process.env, baseDir?: string): string | null {
  if (!killGuardEnabled(env) || process.platform === 'win32') return null;
  if (cachedDir !== undefined && !baseDir) return cachedDir;
  try {
    const dir = path.join(baseDir ?? os.tmpdir(), `cortex-kill-guard-${process.getuid?.() ?? 'u'}`, 'bin');
    const realPgrep = resolveReal('pgrep', env.PATH, dir);
    if (!realPgrep || !fs.existsSync('/proc/self/status')) { if (!baseDir) cachedDir = null; return null; }
    fs.mkdirSync(dir, { recursive: true });
    const write = (name: string, body: string) => {
      const p = path.join(dir, name);
      const tmp = `${p}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, body, { mode: 0o755 });
      fs.renameSync(tmp, p);
    };
    write('pgrep', pgrepScript(realPgrep));
    if (resolveReal('pkill', env.PATH, dir)) write('pkill', pkillScript(realPgrep));
    if (resolveReal('killall', env.PATH, dir)) write('killall', killallScript(realPgrep));
    if (!baseDir) cachedDir = dir;
    return dir;
  } catch {
    if (!baseDir) cachedDir = null;
    return null;
  }
}

/** Spawn env for a Bash tool shell: the guard dir first on PATH + CORTEX_SERVER_PID. Undefined when the guard is off/unavailable
 *  (callers pass `env: undefined` → the child inherits process.env exactly as before). */
export function killGuardSpawnEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv | undefined {
  const dir = ensureKillGuardDir(env);
  if (!dir) return undefined;
  return { ...env, PATH: `${dir}${path.delimiter}${env.PATH ?? ''}`, CORTEX_SERVER_PID: String(process.pid) };
}
