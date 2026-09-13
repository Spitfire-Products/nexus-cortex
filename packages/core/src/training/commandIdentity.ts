/**
 * commandIdentity — R136 HB-NEARDUP-SCRIPT-SHAPE (2026-09-13).
 *
 * The similarity near-dup lens (loopLadder observeSimilar, trigger `neardup-similarity`) compares the
 * whole normalized command text. Terminal-Bench 4.0 validation (mp-checkpoint-consolidation): five
 * DIFFERENT experiment scripts plus several different `python3 -c` bodies all shared one wrapper
 * (`cd /app && timeout 300 python3 -u … 2>&1 | grep …`), so bigram-Dice on the whole text crossed 0.9,
 * the ladder escalated diversify x4, loop_tool_block disabled Bash and the model abandoned a task it
 * had passed on the previous harness version.
 *
 * ONE pure helper: split a command into (a) the executed script/target paths, (b) the inline code
 * bodies (`-c` / `-e` / heredocs), and (c) the residual wrapper. Script identity dominates wrapper
 * shape: two commands whose identity differs are NOT near-duplicates; the same identity falls
 * through to the existing similarity scoring (a real retry of one script with tweaked flags still
 * counts). Commands with no identity at all (ls / grep / git …) keep the old whole-text behavior.
 */
import { createHash } from 'crypto';

export interface CommandIdentity {
  /** Executed script / target tokens (sorted, deduped): `python3 X.py`, `./bin`, `make target`, `cargo run --bin X`, … */
  scriptPaths: string[];
  /** Hash of the normalized inline code bodies (`python3 -c`, `node -e`, `bash -c`, heredocs). */
  inlineCodeHash?: string;
  /** Normalized inline code (digits → #, whitespace collapsed, capped) for similarity comparison. */
  inlineCode?: string;
  /** Residual wrapper text with the identity tokens removed, digit-stripped and whitespace-collapsed. */
  wrapper: string;
}

// Prefix commands that wrap the real command (stripped with their own flag arguments).
const PREFIX_WRAPPERS = new Set(['timeout', 'nice', 'nohup', 'sudo', 'env', 'time', 'stdbuf', 'xvfb-run', 'command', 'exec', 'ionice', 'chrt']);
// Prefix runners: `<runner> run <cmd…>` (uv run python x.py, poetry run pytest, …).
const RUN_WRAPPERS = new Set(['uv', 'poetry', 'pipenv', 'conda', 'npx', 'bunx', 'pnpx']);
const INTERPRETER_RE = /^(python[\d.]*|pypy[\d]*|node|nodejs|bash|sh|zsh|dash|ksh|ruby|perl|php|lua|julia|Rscript|tsx|ts-node|deno|bun)$/;
// Inline-body flags per interpreter family.
const INLINE_FLAGS: Record<string, ReadonlySet<string>> = {
  shell: new Set(['-c']),
  python: new Set(['-c']),
  node: new Set(['-e', '--eval', '-p', '--print']),
  ruby: new Set(['-e', '-E']),
  php: new Set(['-r']),
};
function inlineFlagsFor(head: string): ReadonlySet<string> {
  if (/^(bash|sh|zsh|dash|ksh)$/.test(head)) return INLINE_FLAGS.shell!;
  if (/^(python|pypy)/.test(head)) return INLINE_FLAGS.python!;
  if (/^(node|nodejs|tsx|ts-node|deno|bun)$/.test(head)) return INLINE_FLAGS.node!;
  if (/^(ruby|perl)$/.test(head)) return INLINE_FLAGS.ruby!;
  if (head === 'php') return INLINE_FLAGS.php!;
  return INLINE_FLAGS.python!;
}
// Executors whose non-flag arguments name the target (make target, pytest path, npm run script, …).
const TARGET_EXECUTORS = new Set(['make', 'pytest', 'py.test', 'cargo', 'npm', 'yarn', 'pnpm', 'go', 'gradle', 'mvn', 'rake', 'tox']);
// Flags of target executors that take a value which is NOT a target.
const VALUE_FLAGS = new Set(['-k', '-m', '-p', '--maxfail', '-n', '--tb', '-o', '--target', '-C', '-f', '--file', '-j', '--jobs']);
const IDENTITY_VALUE_FLAGS = new Set(['--bin', '--example', '--package', '-p', '--test', '--bench']);

const HEREDOC_RE = /<<-?\s*(['"]?)([A-Za-z_][\w]*)\1[^\n]*\n([\s\S]*?)\n[ \t]*\2[ \t]*(?=\n|$)/g;

function normalizeText(text: string, cap = 400): string {
  return text.replace(/\d+/g, '#').replace(/\s+/g, ' ').trim().slice(0, cap);
}

/** Split on unquoted `&&`, `||`, `;`, `|`, newline. Quotes ('…', "…", backslash) are respected. (Shared with pollPattern.) */
export function splitSegments(cmd: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quote: string | null = null;
  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i]!;
    if (quote) {
      cur += ch;
      if (ch === '\\' && quote === '"' && i + 1 < cmd.length) { cur += cmd[++i]; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '\\' && i + 1 < cmd.length) { cur += ch + cmd[++i]; continue; }
    if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
    if (ch === '\n' || ch === ';') { out.push(cur); cur = ''; continue; }
    if ((ch === '&' || ch === '|') && cmd[i + 1] === ch) { out.push(cur); cur = ''; i++; continue; }
    if (ch === '|') { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

/** Whitespace tokenizer that keeps quoted spans as one token; returns the UNQUOTED token text. */
function tokenize(seg: string): string[] {
  const toks: string[] = [];
  let cur = '';
  let inTok = false;
  let quote: string | null = null;
  for (let i = 0; i < seg.length; i++) {
    const ch = seg[i]!;
    if (quote) {
      if (ch === '\\' && quote === '"' && i + 1 < seg.length) { cur += seg[++i]; continue; }
      if (ch === quote) { quote = null; continue; }
      cur += ch;
      continue;
    }
    if (ch === '\\' && i + 1 < seg.length) { cur += seg[++i]; inTok = true; continue; }
    if (ch === '"' || ch === "'") { quote = ch; inTok = true; continue; }
    if (/\s/.test(ch)) { if (inTok) { toks.push(cur); cur = ''; inTok = false; } continue; }
    cur += ch;
    inTok = true;
  }
  if (inTok) toks.push(cur);
  return toks;
}

const REDIRECT_RE = /^(\d*>>?|<)(&\d+|\S+)?$/;
const ASSIGN_RE = /^[A-Za-z_]\w*=/;
const PATH_LIKE_RE = /^(\.{0,2}\/|~\/|[A-Za-z]:\\)|\/|\.(py|js|mjs|cjs|ts|sh|rb|pl|php|go|rs|c|cc|cpp|h|java|lua|jl|r|R|scm|wasm|txt|json|yaml|yml|toml|csv)$|::/;

/** Drop redirections (`2>&1`, `> file`, `2>/dev/null`, `< in`) — wrapper, never identity. */
function stripRedirects(toks: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]!;
    const m = REDIRECT_RE.exec(t);
    if (m) { if (!m[2]) i++; continue; } // bare `>` / `<` consumes the next token
    out.push(t);
  }
  return out;
}

/** Strip prefix wrappers (env assignments, timeout N, nice -n N, sudo -u X, uv run, …) to the real head. */
function stripPrefixes(toks: string[]): string[] {
  let i = 0;
  while (i < toks.length) {
    const t = toks[i]!;
    if (ASSIGN_RE.test(t)) { i++; continue; }
    if (t === 'timeout') { i++; while (i < toks.length && toks[i]!.startsWith('-')) i++; i++; continue; } // timeout [-k N] [-s SIG] DURATION
    if (t === 'nice' || t === 'ionice' || t === 'chrt' || t === 'stdbuf') { i++; while (i < toks.length && toks[i]!.startsWith('-')) { i += /^-[a-zA-Z]$/.test(toks[i]!) ? 2 : 1; } continue; }
    if (t === 'sudo') { i++; while (i < toks.length && toks[i]!.startsWith('-')) { i += /^-[uUgC]$/.test(toks[i]!) ? 2 : 1; } continue; }
    if (t === 'env') { i++; while (i < toks.length && (toks[i]!.startsWith('-') || ASSIGN_RE.test(toks[i]!))) i++; continue; }
    if (PREFIX_WRAPPERS.has(t)) { i++; while (i < toks.length && toks[i]!.startsWith('-')) i++; continue; }
    if (RUN_WRAPPERS.has(t)) { i++; while (i < toks.length && toks[i]!.startsWith('-')) i += 1; if (toks[i] === 'run') { i++; while (i < toks.length && (toks[i]!.startsWith('-') || ASSIGN_RE.test(toks[i]!))) { i += /^-[nwp]$|^--(with|python|project)$/.test(toks[i]!) ? 2 : 1; } } continue; }
    break;
  }
  return toks.slice(i);
}

function isFlag(t: string): boolean { return t.startsWith('-') && t !== '-' && t !== '--'; }

/** Extract the identity of ONE pipeline segment. */
function segmentIdentity(seg: string, paths: Set<string>, inline: string[]): void {
  const toks = stripPrefixes(stripRedirects(tokenize(seg)));
  const head = toks[0];
  if (!head) return;
  const base = head.replace(/^.*\//, '');
  // ./binary, /abs/bin, script.sh — the head itself is the identity.
  if (PATH_LIKE_RE.test(head) && !INTERPRETER_RE.test(base)) { paths.add(head); return; }
  const interp = INTERPRETER_RE.test(base) ? base : null;
  if (interp) {
    const flags = inlineFlagsFor(interp);
    for (let i = 1; i < toks.length; i++) {
      const t = toks[i]!;
      if (flags.has(t)) { if (toks[i + 1] !== undefined) inline.push(toks[i + 1]!); return; }
      if (t === '-m' && /^python|^pypy/.test(interp)) {
        const mod = toks[i + 1]; if (mod) paths.add(mod);
        for (let j = i + 2; j < toks.length; j++) if (!isFlag(toks[j]!) && PATH_LIKE_RE.test(toks[j]!)) paths.add(toks[j]!);
        return;
      }
      if (interp === 'deno' || interp === 'bun') { if (t === 'run' || t === 'eval' || t === 'test') continue; }
      if (t === '-' || t === '--') return; // stdin (heredoc handled globally) / end of options
      if (isFlag(t)) continue;
      paths.add(t);
      return;
    }
    return;
  }
  if (TARGET_EXECUTORS.has(base)) {
    for (let i = 1; i < toks.length; i++) {
      const t = toks[i]!;
      if (t === '--') break;
      if (IDENTITY_VALUE_FLAGS.has(t) && base === 'cargo') { const v = toks[i + 1]; if (v) paths.add(v); i++; continue; }
      if (VALUE_FLAGS.has(t)) { i++; continue; }
      if (isFlag(t) || ASSIGN_RE.test(t)) continue;
      if (base === 'npm' && (t === 'run' || t === 'run-script' || t === 'exec')) continue;
      if ((base === 'yarn' || base === 'pnpm') && t === 'run') continue;
      if (base === 'pytest' || base === 'py.test' || base === 'go') { if (PATH_LIKE_RE.test(t) || (base === 'go' && i === 1)) paths.add(t); continue; }
      paths.add(t);
    }
  }
}

/** Pure: split a shell command into script identity (paths + inline code) and residual wrapper. */
export function extractCommandIdentity(command: string): CommandIdentity {
  const raw = String(command ?? '');
  const inline: string[] = [];
  const paths = new Set<string>();
  // Heredoc bodies are inline code; replace with a marker so segment splitting never sees them.
  const noHeredoc = raw.replace(HEREDOC_RE, (_m, _q, _d, body: string) => { inline.push(body); return ' <<HEREDOC'; });
  for (const seg of splitSegments(noHeredoc)) segmentIdentity(seg, paths, inline);
  const scriptPaths = [...paths].sort();
  let wrapper = noHeredoc;
  for (const p of scriptPaths) wrapper = wrapper.split(p).join(' ');
  for (const body of inline) wrapper = wrapper.split(body).join(' ');
  const out: CommandIdentity = { scriptPaths, wrapper: normalizeText(wrapper) };
  if (inline.length) {
    const code = normalizeText(inline.join('\n'));
    out.inlineCode = code;
    out.inlineCodeHash = createHash('sha256').update(code).digest('hex').slice(0, 16);
  }
  return out;
}

/**
 * R136b: short stable digest of a command's identity for the approach KEY (the neardup-hash lens and the
 * failure ladder), applied the way R128 suffixes chunk-read ranges: approachHash collapses every script path
 * into `<path>` and every inline body into `<q>`, so different scripts under one wrapper shared ONE hash
 * bucket. Undefined when the command carries no identity (ls / grep / git …) — those keys are unchanged.
 */
export function commandIdentityDigest(identity: CommandIdentity | undefined): string | undefined {
  if (!identity) return undefined;
  // SCRIPT PATHS ONLY (2026-09-13 decision): inline `-c`/heredoc bodies are deliberately NOT part of the key digest — an
  // edited `python3 -c` grind must keep accumulating on the failure ladder (HB-LOOP-NEARDUP's founding case); the
  // similarity lens (R136) already separates genuinely different inline bodies by body Dice.
  if (identity.scriptPaths.length === 0) return undefined;
  return createHash('sha256').update(identity.scriptPaths.join('\u0000')).digest('hex').slice(0, 12);
}

/** Bigram Dice similarity in [0,1] (same criterion as toolOutcome.diceSimilarity; local copy avoids an import cycle). */
function dice(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const grams = (s: string) => { const g = new Map<string, number>(); for (let k = 0; k < s.length - 1; k++) { const x = s.slice(k, k + 2); g.set(x, (g.get(x) ?? 0) + 1); } return g; };
  const ga = grams(a), gb = grams(b);
  let inter = 0;
  for (const [k, v] of ga) inter += Math.min(v, gb.get(k) ?? 0);
  return (2 * inter) / ((a.length - 1) + (b.length - 1));
}

/**
 * True when two commands are provably DIFFERENT approaches: a different script/target set, or inline
 * bodies that are not near-identical (Dice < bodySim — a minor edit of one body is the same identity;
 * genuinely different code is not). Commands with no identity on either side never "differ" here —
 * they fall through to the whole-text similarity scoring.
 */
export function commandIdentityDiffers(a: CommandIdentity | undefined, b: CommandIdentity | undefined, bodySim = 0.9): boolean {
  if (!a || !b) return false;
  if (a.scriptPaths.length !== b.scriptPaths.length || a.scriptPaths.some((p, i) => p !== b.scriptPaths[i])) return true;
  const ai = a.inlineCode, bi = b.inlineCode;
  if (ai === undefined && bi === undefined) return false;
  if (ai === undefined || bi === undefined) return true;
  return ai !== bi && dice(ai, bi) < bodySim;
}
