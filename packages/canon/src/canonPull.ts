/**
 * canonPull — the canon rehydration leg, graduated from
 * `scripts/canon/canon-pull.ts` (Phase C part 2; the script is now a thin
 * wrapper over this module).
 *
 * Materializes a canon session into the RECEIVING harness's native session
 * directory, where that harness's own resume UI already looks — no proxy
 * layer, the filesystem is the interface. For nexus-cortex the projection is
 * identity (canon IS the cortex dialect): pull = freshen store + reassemble
 * parts + copy. Pull refuses to overwrite an existing local session unless
 * forced — resuming elsewhere is a BRANCH of the canonical line, never a
 * clobber. Discovery/materialization bodies transplanted from the proven
 * script; exit codes become return codes for library use.
 *
 * @module canon/canonPull
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { renderCompat, sessionToolNames, toolCompatibility, type HarnessName } from './canonTools.js';

export interface CanonStoreOptions {
  /** Canon store working clone (default /tmp/canon-store — off-quota; auto-cloned). */
  store?: string;
  /** Store remote for the auto-clone (default env CANON_REPO or the canonical repo). */
  repoUrl?: string;
}

export interface CanonSession {
  uuid: string;
  rel: string;
  parts: string[];
  bytes: number;
  harness: string;
  title?: string;
}

export interface CanonPullOptions extends CanonStoreOptions {
  /** Session uuid (or unique prefix) to materialize. */
  session: string;
  /** Target harness for the tool-compatibility report (default nexus-cortex — where pull lands). */
  target?: HarnessName;
  /** Destination directory (default {home}/omniclaude-v4/.cortex/sessions). */
  to?: string;
  /** Overwrite an existing local session file (default false — pull is a branch, never a clobber). */
  force?: boolean;
  home?: string;
}

export interface CanonPullResult {
  /** 0 = materialized; 1 = not found / ambiguous / exists-without-force. */
  code: 0 | 1;
  dest?: string;
  session?: CanonSession;
}

/** Clone the store if absent, else pull — rehydrate freshness on arrival. */
function ensureFreshStore(store: string, repoUrl?: string, label = 'canon-pull'): void {
  const repo = repoUrl ?? process.env.CANON_REPO ?? 'https://github.com/Spitfire-Products/nexus-canon-store';
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
  if (!fs.existsSync(path.join(store, '.git'))) {
    console.log(`[${label}] no store at ${store} — cloning ${repo}`);
    execFileSync('git', ['clone', '-q', repo, store], { encoding: 'utf8', env });
  } else {
    execFileSync('git', ['pull', '-q', 'origin', 'main'], { cwd: store, encoding: 'utf8', env });
  }
}

/** Discover canon sessions (part-aware; titles recovered from event sidecars). */
export function discoverCanonSessions(store: string): CanonSession[] {
  const root = path.join(store, 'canon');
  const groups = new Map<string, string[]>();
  const walk = (dir: string) => {
    let entries: fs.Dirent[] = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!e.isFile()) continue;
      const m = e.name.match(/^(.*\.jsonl)\.part-\d{4}$/);
      const logical = m ? path.join(dir, m[1]!) : p;
      if (!logical.endsWith('.jsonl') || logical.endsWith('.events.jsonl')) continue;
      const g = groups.get(logical) ?? [];
      g.push(p);
      groups.set(logical, g);
    }
  };
  walk(root);
  const out: CanonSession[] = [];
  for (const [logical, parts] of groups) {
    parts.sort();
    const rel = path.relative(root, logical);
    let uuid = path.basename(rel, '.jsonl');
    // Dir-per-session envelopes (grok-build: <uuid>/chat_history.jsonl) name
    // the session by DIRECTORY; adopt the parent when the basename isn't
    // uuid-ish and the parent is. (claude-code subagents live under a
    // 'subagents' dir — non-uuid parent — and keep their basename ids.)
    const parent = path.basename(path.dirname(rel));
    if (!/^[0-9a-f]{8}-/i.test(uuid) && /^[0-9a-f]{8}-[0-9a-f-]{10,}$/i.test(parent)) uuid = parent;
    const bytes = parts.reduce((n, p) => n + fs.statSync(p).size, 0);
    if (bytes === 0) continue; // empty canon mains (telemetry-only grok sessions) — nothing to pull
    let title: string | undefined;
    const eventsPath = logical.replace(/\.jsonl$/, '.events.jsonl');
    if (fs.existsSync(eventsPath)) {
      for (const line of fs.readFileSync(eventsPath, 'utf8').split('\n')) {
        if (!line.trim()) continue;
        try { const r = JSON.parse(line); if (r.type === 'ai-title' && r.aiTitle) title = r.aiTitle; } catch { /* skip */ }
      }
    }
    out.push({ uuid, rel, parts, bytes, harness: rel.split(path.sep)[0] ?? '?', title });
  }
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}

/** List canon sessions (prints rows; returns them). `all` includes <4KB sessions. */
export async function canonList(o: CanonStoreOptions & { all?: boolean } = {}): Promise<CanonSession[]> {
  const store = o.store ?? '/tmp/canon-store';
  ensureFreshStore(store, o.repoUrl);
  const sessions = discoverCanonSessions(store);
  const rows = sessions.filter((s) => o.all || s.bytes > 4096);
  for (const s of rows) {
    const kb = (s.bytes / 1024).toFixed(0).padStart(7);
    console.log(`${s.uuid}  ${kb}KB  ${s.harness.padEnd(12)}  ${s.title ?? ''}`);
  }
  console.log(`\n[canon-pull] ${rows.length} session(s)${o.all ? '' : ' >4KB (--all for every one)'} in ${store}/canon`);
  return rows;
}

/** Materialize one canon session into a native session directory. */
export async function canonPull(o: CanonPullOptions): Promise<CanonPullResult> {
  const store = o.store ?? '/tmp/canon-store';
  const home = o.home ?? process.env.HOME ?? '/home/runner/workspace';
  ensureFreshStore(store, o.repoUrl);
  const sessions = discoverCanonSessions(store);
  const matches = sessions.filter((s) => s.uuid === o.session || s.uuid.startsWith(o.session));
  if (matches.length === 0) {
    console.error(`[canon-pull] no canon session matches '${o.session}'`);
    return { code: 1 };
  }
  if (matches.length > 1) {
    console.error(`[canon-pull] ambiguous — ${matches.length} matches:`);
    for (const m of matches) console.error(`  ${m.uuid}  (${m.rel})`);
    return { code: 1 };
  }
  const s = matches[0]!;
  const destDir = o.to ?? path.join(home, 'omniclaude-v4', '.cortex', 'sessions');
  const dest = path.join(destDir, `${s.uuid}.jsonl`);
  if (fs.existsSync(dest) && !o.force) {
    console.error(`[canon-pull] ${dest} already exists — resuming elsewhere is a BRANCH; use --force to overwrite the local copy`);
    return { code: 1, dest, session: s };
  }
  fs.mkdirSync(destDir, { recursive: true });
  fs.writeFileSync(dest, '');
  for (const p of s.parts) fs.appendFileSync(dest, fs.readFileSync(p));
  const lines = fs.readFileSync(dest, 'utf8').split('\n').filter(Boolean).length;
  console.log(`[canon-pull] materialized ${s.uuid} (${s.harness}${s.title ? ` — "${s.title}"` : ''})`);
  console.log(`[canon-pull]   ${lines} canonical message(s), ${(s.bytes / 1024).toFixed(0)}KB → ${dest}`);
  console.log(`[canon-pull]   resume with: cortex --resume ${s.uuid} "..."`);
  // Phase E rung 1: the pull-time tool-ontology compatibility report — the
  // receiving side learns up front which referenced tools are native, which
  // map by name, and which need relay/re-expression (P4 ladder).
  try {
    const names = await sessionToolNames(dest);
    if (names.length) console.log(renderCompat(toolCompatibility(names, o.target ?? 'nexus-cortex')));
  } catch { /* report is best-effort — never block a pull */ }
  return { code: 0, dest, session: s };
}
