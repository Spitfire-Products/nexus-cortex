/**
 * Lifecycle hooks — configuration (2026-11-17, docs/HOOKS_PLAN.md; user guide docs/hooks.md).
 *
 * Two files, merged user first, then project:
 *   <CORTEX_HOME or ~>/.cortex/hooks.json      (user)
 *   <project>/.cortex/hooks.json               (project)
 * Schema = Claude Code's settings `hooks` block, so hook files port 1:1:
 *   { "<Event>": [ { "matcher"?: "<regex>", "hooks": [ { "type": "command", "command": "…", "timeout"?: <s> } | { "type": "prompt", "text": "…" } ] } ] }
 * A Claude Code settings file (`{ "hooks": { … } }`) is accepted as-is. A file that fails validation logs ONE warning and is ignored.
 * No file = no hooks = no change at all (dark by default).
 *
 * PROJECT TRUST (2026-11-17): a project file runs shell commands, and a cloned repository can carry one — so it loads only after the
 * user trusts THAT file's exact contents (`cortex hooks trust` in the project → <CORTEX_HOME or ~>/.cortex/hooks-trust.json maps the
 * absolute path to the file's sha256). A changed file must be trusted again. Untrusted → skipped with one warning. The user file is the
 * user's own and always loads. CORTEX_HOOKS_TRUST_PROJECTS=1 trusts every project file (CI / containers that build their own repo).
 */
import fs from 'fs';
import { createHash } from 'crypto';
import os from 'os';
import path from 'path';

export const HOOK_EVENTS = [
  'SessionStart', 'PreCompact', 'PostCompact', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop', 'SessionEnd',
] as const;
export type HookEvent = (typeof HOOK_EVENTS)[number];

/** Where a session came from (the SessionStart `source`, and what its matcher tests). */
export const SESSION_START_SOURCES = ['new', 'resume', 'compact', 'update', 'schedule'] as const;
export type SessionStartSource = (typeof SESSION_START_SOURCES)[number];
export const isSessionStartSource = (v: unknown): v is SessionStartSource =>
  typeof v === 'string' && (SESSION_START_SOURCES as readonly string[]).includes(v);

export type HookHandler =
  | { type: 'command'; command: string; timeout?: number }
  | { type: 'prompt'; text: string };

export interface HookMatcherGroup {
  matcher?: string;
  hooks: HookHandler[];
  /** the file this group came from (logs) */
  file: string;
}

export type HooksConfig = Partial<Record<HookEvent, HookMatcherGroup[]>>;

/** `<CORTEX_HOME or ~>/.cortex` — the same rule as every other cortex user file (schedule.ts, sessionVault.ts …). */
export const cortexUserDir = (env: NodeJS.ProcessEnv = process.env): string => path.join(env.CORTEX_HOME || os.homedir(), '.cortex');

export function hooksConfigPaths(projectDir: string | undefined, env: NodeJS.ProcessEnv = process.env): string[] {
  const user = path.join(cortexUserDir(env), 'hooks.json');
  const out = [user];
  if (projectDir) {
    const project = path.join(path.resolve(projectDir), '.cortex', 'hooks.json');
    if (path.resolve(project) !== path.resolve(user)) out.push(project);   // project = home → one file, read once
  }
  return out;
}

/** Validate one parsed file. Structural problems → { error } (the whole file is ignored); unknown event names → ignored, listed. */
export function validateHooksFile(raw: unknown, file: string): { config?: HooksConfig; error?: string; unknownEvents?: string[] } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'top level must be a JSON object of events' };
  let obj = raw as Record<string, unknown>;
  // A Claude Code settings file nests the block under "hooks".
  if (obj.hooks && typeof obj.hooks === 'object' && !Array.isArray(obj.hooks) && !HOOK_EVENTS.some((e) => e in obj)) {
    obj = obj.hooks as Record<string, unknown>;
  }
  const config: HooksConfig = {};
  const unknownEvents: string[] = [];
  for (const [event, groups] of Object.entries(obj)) {
    if (!(HOOK_EVENTS as readonly string[]).includes(event)) { unknownEvents.push(event); continue; }
    if (!Array.isArray(groups)) return { error: `${event}: must be an array of { matcher?, hooks: [...] }` };
    const out: HookMatcherGroup[] = [];
    for (const [gi, g] of groups.entries()) {
      if (!g || typeof g !== 'object' || Array.isArray(g)) return { error: `${event}[${gi}]: must be an object` };
      const { matcher, hooks } = g as { matcher?: unknown; hooks?: unknown };
      if (matcher !== undefined) {
        if (typeof matcher !== 'string') return { error: `${event}[${gi}].matcher: must be a string` };
        if (!compileMatcher(matcher)) return { error: `${event}[${gi}].matcher: invalid regular expression ${JSON.stringify(matcher)}` };
      }
      if (!Array.isArray(hooks) || hooks.length === 0) return { error: `${event}[${gi}].hooks: must be a non-empty array` };
      const handlers: HookHandler[] = [];
      for (const [hi, h] of hooks.entries()) {
        const where = `${event}[${gi}].hooks[${hi}]`;
        if (!h || typeof h !== 'object') return { error: `${where}: must be an object` };
        const hh = h as Record<string, unknown>;
        if (hh.type === 'command') {
          if (typeof hh.command !== 'string' || !hh.command.trim()) return { error: `${where}.command: must be a non-empty string` };
          if (hh.timeout !== undefined && !(typeof hh.timeout === 'number' && hh.timeout > 0)) return { error: `${where}.timeout: must be a positive number of seconds` };
          handlers.push({ type: 'command', command: hh.command, ...(hh.timeout !== undefined ? { timeout: hh.timeout as number } : {}) });
        } else if (hh.type === 'prompt') {
          if (typeof hh.text !== 'string' || !hh.text.trim()) return { error: `${where}.text: must be a non-empty string` };
          handlers.push({ type: 'prompt', text: hh.text });
        } else {
          return { error: `${where}.type: must be "command" or "prompt"` };
        }
      }
      out.push({ ...(matcher !== undefined ? { matcher } : {}), hooks: handlers, file });
    }
    config[event as HookEvent] = out;
  }
  return { config, ...(unknownEvents.length ? { unknownEvents } : {}) };
}

/** Matcher → anchored regex (Claude Code semantics: "Edit|Write" matches Edit and Write, not MultiEdit). ''/'*'/undefined = everything. */
export function compileMatcher(matcher: string | undefined): RegExp | null {
  if (matcher === undefined || matcher === '' || matcher === '*') return /^[\s\S]*$/;
  try { return new RegExp(`^(?:${matcher})$`); } catch { return null; }
}

export function matcherMatches(matcher: string | undefined, value: string | undefined): boolean {
  if (matcher === undefined || matcher === '' || matcher === '*') return true;
  const re = compileMatcher(matcher);
  return !!re && re.test(value ?? '');
}

/** Merge: user groups first, then project groups, per event. */
export function mergeHooksConfigs(configs: HooksConfig[]): HooksConfig {
  const out: HooksConfig = {};
  for (const c of configs) for (const e of HOOK_EVENTS) if (c[e]?.length) out[e] = [...(out[e] ?? []), ...c[e]!];
  return out;
}

// ── loading (cached by path + mtime; a warning is printed once per bad file version) ───────────────────────────────────────────────
const fileCache = new Map<string, { mtimeMs: number; size: number; config: HooksConfig }>();
const warned = new Set<string>();

export type HooksWarn = (message: string) => void;
const defaultWarn: HooksWarn = (m) => console.warn(m);

function loadOne(file: string, warn: HooksWarn): HooksConfig {
  let st: fs.Stats;
  try { st = fs.statSync(file); } catch { fileCache.delete(file); return {}; }   // the common case: no file
  const hit = fileCache.get(file);
  if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.config;
  let config: HooksConfig = {};
  const once = (msg: string) => { const k = `${file}:${st.mtimeMs}:${msg}`; if (!warned.has(k)) { warned.add(k); warn(msg); } };
  try {
    const v = validateHooksFile(JSON.parse(fs.readFileSync(file, 'utf8')), file);
    if (v.error) once(`[hooks] ignoring ${file}: ${v.error}`);
    else {
      config = v.config!;
      if (v.unknownEvents?.length) once(`[hooks] ${file}: events not supported by cortex are ignored: ${v.unknownEvents.join(', ')}`);
    }
  } catch (e: any) {
    once(`[hooks] ignoring ${file}: ${e?.message ?? e}`);
  }
  fileCache.set(file, { mtimeMs: st.mtimeMs, size: st.size, config });
  return config;
}

// ── project trust ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export const hooksTrustPath = (env: NodeJS.ProcessEnv = process.env): string => path.join(cortexUserDir(env), 'hooks-trust.json');
const sha256File = (file: string): string | null => { try { return createHash('sha256').update(fs.readFileSync(file)).digest('hex'); } catch { return null; } };
function readTrust(env: NodeJS.ProcessEnv): Record<string, string> {
  try { const j = JSON.parse(fs.readFileSync(hooksTrustPath(env), 'utf8')); return j && typeof j === 'object' && !Array.isArray(j) ? j : {}; } catch { return {}; }
}
/** 'trusted' | 'untrusted' (never trusted) | 'changed' (trusted, then edited) | 'absent' (no file). */
export function projectHooksTrust(file: string, env: NodeJS.ProcessEnv = process.env): 'trusted' | 'untrusted' | 'changed' | 'absent' {
  const sha = sha256File(file);
  if (!sha) return 'absent';
  if (env.CORTEX_HOOKS_TRUST_PROJECTS === '1') return 'trusted';
  const t = readTrust(env)[path.resolve(file)];
  return t === sha ? 'trusted' : t ? 'changed' : 'untrusted';
}
/** Trust the CURRENT contents of `<projectDir>/.cortex/hooks.json` (validated first). */
export function trustProjectHooks(projectDir: string, env: NodeJS.ProcessEnv = process.env): { file: string; sha256: string } {
  const file = path.resolve(projectDir, '.cortex', 'hooks.json');
  const raw = fs.readFileSync(file, 'utf8');
  const v = validateHooksFile(JSON.parse(raw), file);
  if (v.error) throw new Error(`${file} is not a valid hooks file: ${v.error}`);
  const sha = createHash('sha256').update(raw).digest('hex');
  const trust = readTrust(env); trust[file] = sha;
  fs.mkdirSync(cortexUserDir(env), { recursive: true });
  fs.writeFileSync(hooksTrustPath(env), JSON.stringify(trust, null, 2) + '\n', { mode: 0o600 });
  return { file, sha256: sha };
}
/** Forget the trust entry of `<projectDir>/.cortex/hooks.json`. Returns true when one was removed. */
export function untrustProjectHooks(projectDir: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const file = path.resolve(projectDir, '.cortex', 'hooks.json');
  const trust = readTrust(env);
  if (!(file in trust)) return false;
  delete trust[file];
  fs.writeFileSync(hooksTrustPath(env), JSON.stringify(trust, null, 2) + '\n', { mode: 0o600 });
  return true;
}

export function loadHooksConfig(opts: { projectDir?: string; env?: NodeJS.ProcessEnv; warn?: HooksWarn } = {}): HooksConfig {
  const warn = opts.warn ?? defaultWarn;
  const env = opts.env ?? process.env;
  const user = path.resolve(cortexUserDir(env), 'hooks.json');
  return mergeHooksConfigs(hooksConfigPaths(opts.projectDir, env).map((f) => {
    if (path.resolve(f) === user) return loadOne(f, warn);
    const t = projectHooksTrust(f, env);
    if (t === 'trusted' || t === 'absent') return loadOne(f, warn);
    const k = `trust:${f}:${t}:${sha256File(f)}`;
    if (!warned.has(k)) {
      warned.add(k);
      warn(`[hooks] NOT loading project hooks ${f}: ${t === 'changed' ? 'it changed since you trusted it' : 'it is not trusted'}. `
        + `Read it, then run \`cortex hooks trust\` in ${path.dirname(path.dirname(f))} to allow it.`);
    }
    return {};
  }));
}

/** Test helper: forget cached files and printed warnings. */
export function resetHooksConfigCache(): void { fileCache.clear(); warned.clear(); }
