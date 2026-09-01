/**
 * canonArtifacts — the capability/artifact dimension capture leg
 * (CANON_CROSS_HARNESS_PLAN.md §27p; Phase C part 2, leg 3).
 *
 * Discovers native capability artifacts and the intent layer, normalizes each
 * into the store's taxonomy dirs (the CAPTURE side of the per-kind layout
 * adapters: skill-dir → /skills/<id>/, agent-file → /agents/<id>.md,
 * mcp/plugin registries → normalized JSON, project manifests → JSON with a
 * thin `state` field), and writes one ArtifactManifest record per artifact
 * under /canon/artifacts/<kind>/<id>.json. Content is blob-addressed with git
 * blob SHAs computed locally (sha1 of "blob <len>\0"+bytes — identical to
 * git's object id, so provenance survives any clone). Secret scrub at the
 * push boundary, same pattern set as canonSync. Absences are VISIBLE in
 * /canon/artifacts/ARTIFACTS.md (D8: never silent). Incremental via
 * ~/.canon/artifacts-manifest.json keyed by primary-file blob refs.
 * Projection-BACK (store → receiving harness layout) arrives with the
 * artifact pull leg; stated in ARTIFACTS.md rather than implied.
 *
 * @module canon/canonArtifacts
 */
import { requireCanonRepo, redactRepoUrl, canonGit, guardedAddAll, atomicClone, guardedPush, requireFullSurfaceStore } from './canonRepo.js';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ArtifactManifest, ArtifactContentEntry } from '@nexus-cortex/types';

export interface CanonArtifactsOptions {
  store?: string;
  home?: string;
  dryRun?: boolean;
  repoUrl?: string;
}

export interface CanonArtifactsResult {
  captured: number;
  unchanged: number;
  kinds: Record<string, number>;
  pushed: boolean;
}

const SECRET_PATTERNS: [RegExp, string][] = [
  [/sk-[A-Za-z0-9_-]{16,}/g, '[redacted:sk]'],
  [/ghp_[A-Za-z0-9]{20,}/g, '[redacted:ghp]'],
  [/github_pat_[A-Za-z0-9_]{20,}/g, '[redacted:ghpat]'],
  [/hf_[A-Za-z0-9]{20,}/g, '[redacted:hf]'],
  [/AIza[A-Za-z0-9_-]{20,}/g, '[redacted:aiza]'],
  [/xai-[A-Za-z0-9]{20,}/g, '[redacted:xai]'],
  [/nar_[A-Za-z0-9]{16,}/g, '[redacted:nar]'],
  [/gsk_[A-Za-z0-9]{20,}/g, '[redacted:gsk]'],
  [/xox[bpars]-[A-Za-z0-9-]{10,}/g, '[redacted:slack]'],
  [/AKIA[A-Z0-9]{16}/g, '[redacted:akia]'],
  [/eyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/g, '[redacted:jwt]'],
];
const scrub = (s: string) => SECRET_PATTERNS.reduce((v, [re, sub]) => v.replace(re, sub), s);

/** git blob id (12 hex) computed locally — identical to `git hash-object`. */
const blobRef = (content: Buffer | string): string => {
  const buf = Buffer.isBuffer(content) ? content : Buffer.from(content);
  return crypto.createHash('sha1')
    .update(`blob ${buf.length}\0`).update(buf).digest('hex').slice(0, 12);
};

const walkFiles = (dir: string): string[] => {
  const out: string[] = [];
  const rec = (d: string) => {
    let es: fs.Dirent[] = [];
    try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of es) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) rec(p);
      else if (e.isFile()) out.push(p);
    }
  };
  rec(dir);
  return out.sort();
};

export async function canonArtifacts(o: CanonArtifactsOptions = {}): Promise<CanonArtifactsResult> {
  const HOME = o.home ?? process.env.HOME ?? '/home/runner/workspace';
  const DRY = o.dryRun ?? false;
  const STORE = o.store ?? '/tmp/canon-store';
  const MANIFEST_PATH = path.join(HOME, '.canon', 'artifacts-manifest.json');
  if (!fs.existsSync(path.join(STORE, '.git'))) {
    const CANON_REPO = requireCanonRepo(o.repoUrl, STORE, 'canon-artifacts');
    console.log(`[canon-artifacts] no store at ${STORE} — cloning ${redactRepoUrl(CANON_REPO)}`);
    atomicClone(CANON_REPO, STORE, 'canon-artifacts');
  }
  // Artifact capture writes across the whole surface — refuse scoped stores.
  requireFullSurfaceStore(STORE, 'canon-artifacts');
  const incr: Record<string, string> = fs.existsSync(MANIFEST_PATH)
    ? JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8')) : {};
  let captured = 0, unchanged = 0;
  const kinds: Record<string, number> = {};
  const absences: string[] = [];

  /** Normalize one artifact into the store + write its manifest record. */
  const capture = (m: Omit<ArtifactManifest, 'recordKind' | 'timestamp' | 'version' | 'content'>, files: { rel: string; bytes: Buffer }[]) => {
    const primaryFile = files.find((f) => f.rel === m.primary);
    if (!primaryFile) return;
    const version = blobRef(primaryFile.bytes);
    const key = `${m.kind}/${m.id}`;
    kinds[m.kind] = (kinds[m.kind] ?? 0) + 1;
    if (incr[key] === version) { unchanged++; return; }
    if (!DRY) {
      const destRoot = m.kind === 'skill' || m.kind === 'plugin'
        ? path.join(STORE, m.kind + 's', m.id)
        : path.join(STORE, m.kind === 'mcp' ? 'mcp' : m.kind + 's');
      const content: ArtifactContentEntry[] = [];
      for (const f of files) {
        const scrubbed = Buffer.from(scrub(f.bytes.toString('utf8')));
        const dest = m.kind === 'skill' || m.kind === 'plugin'
          ? path.join(destRoot, f.rel)
          : path.join(destRoot, f.rel);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, scrubbed);
        content.push({ path: f.rel, ref: blobRef(scrubbed), bytes: scrubbed.length });
      }
      const record: ArtifactManifest = {
        recordKind: 'artifact-manifest',
        ...m,
        version,
        timestamp: new Date().toISOString(),
        content,
      };
      const recPath = path.join(STORE, 'canon', 'artifacts', m.kind, `${m.id}.json`);
      fs.mkdirSync(path.dirname(recPath), { recursive: true });
      fs.writeFileSync(recPath, JSON.stringify(record, null, 2) + '\n');
    }
    incr[key] = version;
    captured++;
  };

  // ── skills: dir + SKILL.md (layout adapter: skill-dir → /skills/<id>/) ─────
  for (const [harness, root] of [['claude-code', path.join(HOME, '.claude', 'skills')], ['agents-dir', path.join(HOME, '.agents', 'skills')]] as const) {
    let entries: string[] = [];
    try { entries = fs.readdirSync(root); } catch { absences.push(`${harness} skills root absent (${root})`); continue; }
    for (const name of entries.sort()) {
      const dir = path.join(root, name);
      if (!fs.existsSync(path.join(dir, 'SKILL.md'))) continue;
      const files = walkFiles(dir).map((p) => ({ rel: path.relative(dir, p), bytes: fs.readFileSync(p) }));
      const desc = /^description:\s*(.+)$/m.exec(fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8'))?.[1];
      capture({
        kind: 'skill', id: name, name, description: desc?.slice(0, 200), primary: 'SKILL.md',
        provenance: { harness, native: dir, ref: blobRef(fs.readFileSync(path.join(dir, 'SKILL.md'))) },
        harnessCompat: { 'claude-code': 'supported', 'nexus-cortex': 'supported' },
        projectionRules: { 'claude-code': '.claude/skills/<id>/', 'agents-dir': '.agents/skills/<id>/' },
      }, files);
    }
  }

  // ── agents: single .md w/ frontmatter (layout adapter: file → /agents/) ────
  const agentsRoot = path.join(HOME, '.claude', 'agents');
  let agentFiles: string[] = [];
  try { agentFiles = fs.readdirSync(agentsRoot).filter((f) => f.endsWith('.md')).sort(); } catch { absences.push(`claude-code agents root absent (${agentsRoot})`); }
  for (const f of agentFiles) {
    const abs = path.join(agentsRoot, f);
    const bytes = fs.readFileSync(abs);
    const id = path.basename(f, '.md');
    const desc = /^description:\s*(.+)$/m.exec(bytes.toString('utf8'))?.[1];
    capture({
      kind: 'agent', id, name: id, description: desc?.slice(0, 200), primary: f,
      provenance: { harness: 'claude-code', native: abs, ref: blobRef(bytes) },
      harnessCompat: { 'claude-code': 'supported' },
      projectionRules: { 'claude-code': '.claude/agents/<id>.md' },
    }, [{ rel: f, bytes }]);
  }

  // ── mcp: config registries (normalized json) ───────────────────────────────
  const mcpSources = [
    ['workspace', path.join(HOME, '.mcp.json')],
    ['nexus-terminal', path.join(HOME, 'nexus-terminal', '.mcp.json')],
    ['omniclaude-v4', path.join(HOME, 'omniclaude-v4', '.mcp.json')],
  ] as const;
  for (const [label, p] of mcpSources) {
    if (!fs.existsSync(p)) { absences.push(`mcp config absent (${p})`); continue; }
    const bytes = fs.readFileSync(p);
    capture({
      kind: 'mcp', id: label, name: `${label} MCP servers`, primary: `${label}.json`,
      provenance: { harness: 'claude-code', native: p, ref: blobRef(bytes) },
      projectionRules: { 'claude-code': '.mcp.json' },
    }, [{ rel: `${label}.json`, bytes }]);
  }

  // ── plugins: registry snapshot (bundle capture = follow-up, stated) ────────
  const pluginsReg = path.join(HOME, '.claude', 'plugins', 'installed_plugins.json');
  if (fs.existsSync(pluginsReg)) {
    const bytes = fs.readFileSync(pluginsReg);
    capture({
      kind: 'plugin', id: 'installed-registry', name: 'Installed plugins registry', primary: 'installed_plugins.json',
      provenance: { harness: 'claude-code', native: pluginsReg, ref: blobRef(bytes) },
      projectionRules: { 'claude-code': '.claude/plugins/installed_plugins.json' },
    }, [{ rel: 'installed_plugins.json', bytes }]);
  } else absences.push(`plugins registry absent (${pluginsReg})`);

  // ── plans: doc-snapshot + thin state (fork 1 — never an event log) ─────────
  const plansRoot = path.join(HOME, '.claude', 'plans');
  let planFiles: string[] = [];
  try { planFiles = fs.readdirSync(plansRoot).filter((f) => f.endsWith('.md')).sort(); } catch { absences.push(`plans root absent (${plansRoot})`); }
  for (const f of planFiles) {
    const abs = path.join(plansRoot, f);
    const bytes = fs.readFileSync(abs);
    const id = path.basename(f, '.md');
    capture({
      kind: 'plan', id, primary: f,
      provenance: { harness: 'claude-code', native: abs, ref: blobRef(bytes) },
      state: { status: 'snapshot', capturedFrom: 'claude-code-plans' },
    }, [{ rel: f, bytes }]);
  }

  // ── projects: manifests for known roots (roots + per-harness session dirs) ─
  const projects: [string, string][] = [
    ['workspace', HOME],
    ['omniclaude-v4', path.join(HOME, 'omniclaude-v4')],
    ['nexus-terminal', path.join(HOME, 'nexus-terminal')],
  ];
  for (const [id, root] of projects) {
    if (!fs.existsSync(root)) continue;
    const doc = JSON.stringify({
      id, root,
      sessionDirs: { 'nexus-cortex': path.join(root, '.cortex', 'sessions'), 'claude-code': `~/.claude/projects/${root.replace(/\//g, '-')}` },
    }, null, 2) + '\n';
    capture({
      kind: 'project', id, primary: `${id}.json`,
      provenance: { harness: 'workspace', native: root, ref: blobRef(doc) },
      state: { status: 'active' },
    }, [{ rel: `${id}.json`, bytes: Buffer.from(doc) }]);
  }

  // ── visibility doc + commit ────────────────────────────────────────────────
  const summary = `${captured} captured, ${unchanged} unchanged (${Object.entries(kinds).map(([k, n]) => `${k}:${n}`).join(', ') || 'none'})`;
  let pushed = false;
  if (!DRY) {
    const md = `# /canon/artifacts — ArtifactManifest records (§27p second record kind)\n\n` +
      `One JSON manifest per artifact: identity, content-derived version (primary-file git\n` +
      `blob ref), blob-addressed content listing, provenance, harnessCompat, projectionRules.\n` +
      `Bytes live in the store taxonomy dirs (/skills /agents /mcp /plugins /plans /projects).\n\n` +
      `## Not captured this run (visible, never silent — D8)\n` +
      (absences.length ? absences.map((a) => `- ${a}\n`).join('') : '- none\n') +
      `\n## Projection-back\nRendering artifacts INTO a receiving harness's layout (the pull side of the\n` +
      `per-kind layout adapters) arrives with the artifact pull leg; until then its\nabsence is stated here rather than implied.\n`;
    const mdPath = path.join(STORE, 'canon', 'artifacts', 'ARTIFACTS.md');
    fs.mkdirSync(path.dirname(mdPath), { recursive: true });
    fs.writeFileSync(mdPath, md);
    fs.mkdirSync(path.dirname(MANIFEST_PATH), { recursive: true });
    fs.writeFileSync(MANIFEST_PATH, JSON.stringify(incr));
    const git = canonGit(STORE, 'canon-artifacts');
    if (guardedAddAll(git, 'canon-artifacts')) {
      git(['commit', '-q', '-m', `canon-artifacts: ${summary}`]);
      pushed = guardedPush(git, 'canon-artifacts');
      if (pushed) console.log(`[canon-artifacts] pushed: ${summary}`);
      else console.log(`[canon-artifacts] committed locally, push deferred to next cycle: ${summary}`);
    } else {
      console.log(`[canon-artifacts] no changes (${summary})`);
    }
  } else {
    console.log(`[canon-artifacts DRY] would capture ${captured}, unchanged ${unchanged}`);
  }
  return { captured, unchanged, kinds, pushed };
}
