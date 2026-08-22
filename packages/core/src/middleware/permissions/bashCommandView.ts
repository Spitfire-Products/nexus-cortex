/**
 * Heredoc/redirect-aware structural view of a bash command for permission
 * analysis (2026-08-22, operator-commissioned).
 *
 * WHY: the original whitelist rule treated EVERY `<`/`>` character as an
 * unsafe operator, so all heredocs — including pure stdin feeds that write
 * nothing — fell out of the safe whitelist. That rule dates from when models
 * were unreliable with heredocs; the narrow-door program showed current and
 * bash-focused trained models use them proficiently, so the analysis becomes
 * structural:
 *
 *  - heredoc BODIES are data, not commands — they are stripped from the view
 *    used for whitelist matching and (for non-interpreter targets) dangerous-
 *    pattern scanning. Writing a script that CONTAINS `rm -rf ./dist` is a
 *    write, not an execution.
 *  - a heredoc fed to an INTERPRETER (`bash <<EOF`) IS executed — those
 *    bodies stay in scope for danger scans (`interpreterFed`).
 *  - `>`/`>>` to a real file = a WRITE (graylist tier, parity with the Write
 *    tool). Null sinks (`>/dev/null`, `2>&1`, fd dups) are not writes.
 *  - `<` stdin feeds are reads and never disqualify a safe command.
 */

// (D61 context: the pre-2026-08-22 rules here and the ShellTool redirect guard
// were ACTIVE during the P-series door benches — see BASH_PLUS_SPEC "D61
// instrument caveat". The guard fired 218 times across canon-recorded harness
// sessions, including inside anchoring bench cells.)

export interface BashCommandView {
  /** Command text with heredoc bodies removed (operators/markers retained). */
  view: string;
  /** At least one heredoc (`<<`/`<<-`) operator was present. */
  hadHeredoc: boolean;
  /** A `>`/`>>` redirect targets a real file (null sinks/fd dups excluded). */
  hasFileWriteRedirect: boolean;
  /** The command line feeds stdin to an interpreter that executes it. */
  interpreterFed: boolean;
}

/** Interpreters that execute their stdin — heredoc bodies fed to these are
 *  live code and must stay visible to dangerous-pattern scanning. */
const STDIN_INTERPRETERS = new Set([
  'bash', 'sh', 'zsh', 'dash', 'ksh', 'fish',
  'node', 'python', 'python2', 'python3', 'perl', 'ruby', 'php', 'deno', 'bun',
]);

const HEREDOC_RE = /<<-?\s*(["']?)([A-Za-z_][\w]*)\1/;

/** Strip one heredoc body (marker line retained). Returns null when no
 *  heredoc remains. Unterminated bodies extend to end-of-string. */
function stripFirstHeredocBody(text: string): string | null {
  const m = HEREDOC_RE.exec(text);
  if (!m) return null;
  const markerEnd = m.index + m[0].length;
  const delim = m[2]!;
  const bodyStart = text.indexOf('\n', markerEnd);
  if (bodyStart === -1) return text; // marker but no body yet — nothing to strip
  // Body runs to a line that is exactly the delimiter (leading tabs ok for <<-).
  const lines = text.slice(bodyStart + 1).split('\n');
  let end = lines.length; // unterminated → strip to end
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.replace(/^\t+/, '') === delim) { end = i; break; }
  }
  const after = lines.slice(end + 1).join('\n');
  return text.slice(0, bodyStart) + (after ? '\n' + after : '');
}

/** Analyze a bash command into its permission-relevant structure. */
export function analyzeBashCommand(command: string): BashCommandView {
  const raw = command ?? '';
  const hadHeredoc = HEREDOC_RE.test(raw);

  let view = raw;
  if (hadHeredoc) {
    // Iteratively strip bodies; guard against pathological loops.
    for (let i = 0; i < 8; i++) {
      const next = stripFirstHeredocBody(view);
      if (next === null || next === view) break;
      view = next;
    }
  }

  // Write redirects on the BODY-FREE view: `>`/`>>` (optionally fd-prefixed)
  // to a target that is not /dev/null and not an fd duplication (`>&1`).
  let hasFileWriteRedirect = false;
  const redir = /(?<![<>])[0-9]?>{1,2}\s*([^\s|;&<>]+)/g;
  for (const m of view.matchAll(redir)) {
    const target = m[1]!;
    if (target.startsWith('&')) continue;        // fd dup (2>&1)
    if (target === '/dev/null') continue;        // null sink
    hasFileWriteRedirect = true;
    break;
  }

  // Interpreter-fed heredoc: first command token (skipping env prefixes and
  // sudo) is a stdin interpreter.
  let interpreterFed = false;
  if (hadHeredoc) {
    const tokens = view.trim().split(/\s+/);
    let idx = 0;
    while (idx < tokens.length && (/^[A-Za-z_][\w]*=/.test(tokens[idx]!) || tokens[idx] === 'sudo' || tokens[idx] === 'env')) idx++;
    const base = (tokens[idx] ?? '').split('/').pop() ?? '';
    interpreterFed = STDIN_INTERPRETERS.has(base);
  }

  return { view, hadHeredoc, hasFileWriteRedirect, interpreterFed };
}
