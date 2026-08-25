/**
 * bashFileAccess — conservative parser extracting file READ and WRITE targets
 * from a bash command, for frame-coherent read/write permissions
 * (docs/HARNESS_IMPROVEMENT_BACKLOG.md item 6).
 *
 * TB2 2×2 evidence: under the persist frame the tool surface is {Bash, Edit} —
 * no Read tool — so EditTool's read-first guard denied 54/27 edits with advice
 * ("Use the Read tool…") the model could not follow, and bash `cat` reads did
 * not register. Denied writes then routed to sed -i/heredoc which bypass all
 * guards blind (67-83% of in-place sed had no detected prior read).
 *
 * Design bias: FALSE NEGATIVES over false positives. Marking an unread file
 * "read" weakens the guard, so every pattern is exact-command, simple-argument
 * only; anything ambiguous (substitution, wildcards, variables, complex
 * quoting) contributes nothing.
 */

export interface BashFileAccess {
  /** Files the command READ in full-content fashion (cat/head/tail/nl/less/
   *  more/sed -n) — candidates for FileReadTracker.markAsRead. */
  reads: string[];
  /** Files the command MUTATED in place or by redirection (sed -i/perl -i/
   *  >/>>/tee) — candidates for read-state invalidation. */
  writes: string[];
}

const READ_CMDS = new Set(['cat', 'head', 'tail', 'nl', 'less', 'more']);
/** Flags whose VALUE follows as a separate token (`head -n 50 file`). */
const VALUE_FLAGS = new Set(['-n', '-c', '--lines', '--bytes']);

/** A token is a plausible literal file path: no expansion, no wildcard, no
 *  redirection char, not a bare operator. */
function isPlainPath(tok: string): boolean {
  if (!tok || tok.startsWith('-')) return false;
  if (/[*?[\]{}$`\\<>|;&]/.test(tok)) return false;
  if (tok === '/dev/null' || tok.startsWith('/dev/') || tok.startsWith('/proc/')) return false;
  return true;
}

function stripQuotes(tok: string): string {
  const m = tok.match(/^(["'])(.*)\1$/);
  return m ? m[2]! : tok;
}

/** Split a command into pipeline/sequence segments on unquoted | ; && ||.
 *  Quote-aware at the single/double level only; anything with backticks or
 *  $( is rejected upstream. */
function splitSegments(command: string): string[] {
  const segs: string[] = [];
  let cur = '';
  let quote: string | null = null;
  for (let i = 0; i < command.length; i++) {
    const ch = command[i]!;
    if (quote) {
      cur += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
      continue;
    }
    if (ch === '|' || ch === ';' || (ch === '&' && command[i + 1] === '&')) {
      segs.push(cur);
      cur = '';
      if ((ch === '&' || ch === '|') && command[i + 1] === ch) i++;
      continue;
    }
    cur += ch;
  }
  segs.push(cur);
  return segs.map((s) => s.trim()).filter(Boolean);
}

/** Tokenize a segment quote-aware (quoted spans become single tokens with
 *  quotes retained; stripQuotes applied at use sites). */
function tokenize(segment: string): string[] {
  const toks: string[] = [];
  let cur = '';
  let quote: string | null = null;
  for (const ch of segment) {
    if (quote) {
      cur += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (cur) toks.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur) toks.push(cur);
  return toks;
}

export function parseBashFileAccess(command: string): BashFileAccess {
  const none: BashFileAccess = { reads: [], writes: [] };
  if (!command || command.includes('`') || command.includes('$(')) return none;
  // Heredocs write content we cannot attribute simply — but the TARGET of
  // `cat > file <<EOF` is still a write; handled by the redirect scan below.

  const reads = new Set<string>();
  const writes = new Set<string>();

  for (const segment of splitSegments(command)) {
    const tokens = tokenize(segment);
    if (tokens.length === 0) continue;

    // ---- redirection targets (any segment): > file / >> file / N> file ----
    // Scan the RAW segment for redirect operators outside quotes.
    {
      let quote: string | null = null;
      for (let i = 0; i < segment.length; i++) {
        const ch = segment[i]!;
        if (quote) {
          if (ch === quote) quote = null;
          continue;
        }
        if (ch === '"' || ch === "'") { quote = ch; continue; }
        if (ch === '<') break; // heredoc/input redirect — stop attributing this segment
        if (ch === '>') {
          let j = i + 1;
          if (segment[j] === '>') j++;
          while (j < segment.length && /\s/.test(segment[j]!)) j++;
          let target = '';
          while (j < segment.length && !/[\s<>|;&]/.test(segment[j]!)) target += segment[j++]!;
          target = stripQuotes(target);
          if (isPlainPath(target)) writes.add(target);
          i = j - 1;
        }
      }
    }

    const cmd = stripQuotes(tokens[0]!);

    // ---- in-place edits: sed -i / perl -i ----
    if (cmd === 'sed' && tokens.some((t) => t === '-i' || t.startsWith('-i.') || t === '--in-place')) {
      // file operands = trailing plain-path tokens (the script is quoted or
      // contains sed metachars, so isPlainPath excludes it).
      for (const t of tokens.slice(1)) {
        const v = stripQuotes(t);
        if (!t.startsWith('-') && isPlainPath(v) && !/^s[#/|,]/.test(v)) writes.add(v);
      }
      continue;
    }
    if (cmd === 'perl' && tokens.some((t) => /^-[a-z]*i/.test(t) && t.startsWith('-'))) {
      for (let i = 1; i < tokens.length; i++) {
        const t = tokens[i]!;
        if (t.startsWith('-')) {
          if (t === '-e' || t.endsWith('e')) i++; // -e / -pe / -pie: next token is the script
          continue;
        }
        const v = stripQuotes(t);
        if (isPlainPath(v)) writes.add(v);
      }
      continue;
    }

    // ---- tee [-a] file... ----
    if (cmd === 'tee') {
      for (const t of tokens.slice(1)) {
        const v = stripQuotes(t);
        if (!t.startsWith('-') && isPlainPath(v)) writes.add(v);
      }
      continue;
    }

    // ---- full-content reads ----
    if (READ_CMDS.has(cmd)) {
      // Value-taking flags only exist on head/tail (`head -n 50 file`);
      // cat's -n is bare (number lines) — treating it as value-taking would
      // swallow the file operand (probe finding).
      const hasValueFlags = cmd === 'head' || cmd === 'tail';
      for (let i = 1; i < tokens.length; i++) {
        const t = tokens[i]!;
        if (t.startsWith('-')) {
          if (hasValueFlags && VALUE_FLAGS.has(t)) i++; // skip the flag's value token
          continue;
        }
        const v = stripQuotes(t);
        if (isPlainPath(v)) reads.add(v);
      }
      continue;
    }

    // ---- sed -n 'RANGEp' file (print-mode read; no -i) ----
    if (cmd === 'sed' && tokens.includes('-n')) {
      const positionals = tokens.slice(1).filter((t) => !t.startsWith('-'));
      // last positional is the file; earlier ones are the script.
      const last = positionals[positionals.length - 1];
      if (last) {
        const v = stripQuotes(last);
        if (isPlainPath(v) && !/[0-9]+,?[0-9]*p$/.test(v)) reads.add(v);
      }
      continue;
    }
  }

  // A path both read and written in one command (cat a > a) — treat as write.
  for (const w of writes) reads.delete(w);

  return { reads: [...reads], writes: [...writes] };
}
