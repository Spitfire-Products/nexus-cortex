/**
 * canonGraph — the §27l knowledge-graph leg (Phase C part 2, leg 4) plus the
 * project↔session normalization it requires.
 *
 * PROJECT MAP (the prerequisite): project identity in the store is implicit
 * and split across two conventions — Claude Code's normalized-path dirs
 * (`-home-runner-workspace-nexus-terminal`) and canonSync's CORTEX_ROOTS
 * labels (`nexus-terminal`). `deriveProjectSessionMap` joins them, DERIVED
 * entirely from store paths (never hand-maintained — §27l's rule): known
 * roots match exactly by their encoded form; UNKNOWN claude-code dirs become
 * their own project (closing the hand-listed-roots blind spot: new roots
 * surface instead of vanishing). No `project` field is added to Message
 * records — that would break the verbatim-superset rule; the map is a
 * derived artifact written to /projects/<id>.json.
 *
 * GRAPH (🔒 v1 acceptance criteria, non-negotiable): the writer emits
 * NetworkX node-link JSON ({directed, multigraph, graph, nodes, links}) and
 * stamps EVERY edge with confidence ∈ {EXTRACTED, INFERRED, AMBIGUOUS} plus
 * numeric confidence_score {1.0, 0.5, 0.2} — baked in at genesis, never
 * retrofitted. Nodes carry graphify-compatible fields (id, label, file_type,
 * source_file, source_location) and canon ids are NAMESPACED (sess:/art:/
 * proj:) to dodge graphify's stem-id collisions. The HISTORY half consumes
 * BOTH canonical record kinds (Message sessions + ArtifactManifests); the
 * CODE half is graphify's job (adopted at arm's length, mode A): pass
 * `mergeGraph` to fold a graphify graph.json into the same node-link
 * structure, joined on source_file. graphify stays replaceable; never Penpax.
 *
 * @module canon/canonGraph
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { discoverCanonSessions, type CanonSession } from './canonPull.js';

const CONFIDENCE_SCORE: Record<string, number> = { EXTRACTED: 1.0, INFERRED: 0.5, AMBIGUOUS: 0.2 };

export interface ProjectEntry {
  id: string;
  /** Best-effort decoded root (claude-code encoding is lossy on dashes — encoded form is authoritative). */
  root: string;
  /** Store-relative canon session dir prefixes per harness. */
  sessionPaths: Record<string, string[]>;
  sessionCounts: Record<string, number>;
}

/** Known roots: exact encoded-form matches. Everything else derives its own entry. */
const KNOWN_ROOTS: [id: string, root: string][] = [
  ['workspace', '/home/runner/workspace'],
  ['omniclaude-v4', '/home/runner/workspace/omniclaude-v4'],
  ['nexus-terminal', '/home/runner/workspace/nexus-terminal'],
];
const encodeCC = (root: string) => root.replace(/[/.]/g, '-');
/** cortex label → project id (labels that are sub-roots of a project). */
const CORTEX_LABEL_PROJECT: Record<string, string> = {
  workspace: 'workspace', 'omniclaude-v4': 'omniclaude-v4', server: 'omniclaude-v4', 'nexus-terminal': 'nexus-terminal',
};

/** Derive the authoritative project ↔ session-path map from store paths. */
export function deriveProjectSessionMap(store: string): Record<string, ProjectEntry> {
  const projects: Record<string, ProjectEntry> = {};
  const entry = (id: string, root: string) =>
    (projects[id] ??= { id, root, sessionPaths: {}, sessionCounts: {} });
  const add = (id: string, root: string, harness: string, rel: string) => {
    const e = entry(id, root);
    (e.sessionPaths[harness] ??= []).push(rel);
    e.sessionCounts[harness] = (e.sessionCounts[harness] ?? 0) + 0; // counts filled from sessions below
  };
  const ccByEncoding = new Map(KNOWN_ROOTS.map(([id, root]) => [encodeCC(root), { id, root }]));
  const wsPrefix = encodeCC('/home/runner/workspace') + '-';

  const ccRoot = path.join(store, 'canon', 'claude-code');
  let ccDirs: string[] = [];
  try { ccDirs = fs.readdirSync(ccRoot).filter((d) => fs.statSync(path.join(ccRoot, d)).isDirectory()); } catch { /* none */ }
  for (const dir of ccDirs.sort()) {
    const known = ccByEncoding.get(dir);
    if (known) add(known.id, known.root, 'claude-code', path.join('claude-code', dir));
    else if (dir.startsWith(wsPrefix)) {
      // Unknown root — surfaces as its OWN project (blind-spot closure).
      const id = dir.slice(wsPrefix.length);
      add(id, `/home/runner/workspace/${id}` /* best-effort decode */, 'claude-code', path.join('claude-code', dir));
    } else add(dir, dir, 'claude-code', path.join('claude-code', dir));
  }
  const cxRoot = path.join(store, 'canon', 'nexus-cortex');
  let cxDirs: string[] = [];
  try { cxDirs = fs.readdirSync(cxRoot).filter((d) => fs.statSync(path.join(cxRoot, d)).isDirectory()); } catch { /* none */ }
  for (const label of cxDirs.sort()) {
    const id = CORTEX_LABEL_PROJECT[label] ?? label;
    const root = projects[id]?.root ?? KNOWN_ROOTS.find(([k]) => k === id)?.[1] ?? label;
    add(id, root, 'nexus-cortex', path.join('nexus-cortex', label));
  }
  return projects;
}

/** Resolve which project a canon session belongs to (by path prefix). */
export function sessionProject(projects: Record<string, ProjectEntry>, s: CanonSession): string | undefined {
  for (const p of Object.values(projects)) {
    for (const prefixes of Object.values(p.sessionPaths)) {
      if (prefixes.some((pre) => s.rel.startsWith(pre + path.sep))) return p.id;
    }
  }
  return undefined;
}

export interface CanonGraphOptions {
  store?: string;
  /** Limit to one project id (default: all mapped projects). */
  project?: string;
  /** Path to an external (graphify) node-link graph.json to fold into each project graph. */
  mergeGraph?: string;
  dryRun?: boolean;
}

export interface CanonGraphResult {
  projects: string[];
  nodes: number;
  links: number;
  pushed: boolean;
}

/** Generate /projects/<id>.json manifests + /projects/<id>/graph.json (node-link, 🔒 criteria). */
export async function canonGraph(o: CanonGraphOptions = {}): Promise<CanonGraphResult> {
  const STORE = o.store ?? '/tmp/canon-store';
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
  const projects = deriveProjectSessionMap(STORE);
  const sessions = discoverCanonSessions(STORE);
  for (const s of sessions) {
    const pid = sessionProject(projects, s);
    if (pid) projects[pid]!.sessionCounts[s.harness] = (projects[pid]!.sessionCounts[s.harness] ?? 0) + 1;
  }

  // Load artifact manifests (the second record kind).
  const artRoot = path.join(STORE, 'canon', 'artifacts');
  const artifacts: any[] = [];
  const walkJson = (d: string) => {
    let es: fs.Dirent[] = [];
    try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of es) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walkJson(p);
      else if (e.name.endsWith('.json')) {
        try { artifacts.push({ ...JSON.parse(fs.readFileSync(p, 'utf8')), _manifestPath: path.relative(STORE, p) }); } catch { /* lint's job */ }
      }
    }
  };
  walkJson(artRoot);

  let head = '';
  try { head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: STORE, encoding: 'utf8', env }).trim(); } catch { /* untracked */ }

  const wanted = o.project ? [o.project] : Object.keys(projects).sort();
  let totalNodes = 0, totalLinks = 0;
  const built: string[] = [];

  for (const pid of wanted) {
    const proj = projects[pid];
    if (!proj) continue;
    const nodes: any[] = [];
    const links: any[] = [];
    const edge = (source: string, target: string, relation: string, confidence: 'EXTRACTED' | 'INFERRED' | 'AMBIGUOUS', source_file: string) =>
      links.push({ source, target, relation, confidence, confidence_score: CONFIDENCE_SCORE[confidence], source_file, source_location: '', weight: 1.0 });

    const projNodeId = `proj:${pid}`;
    nodes.push({ id: projNodeId, label: pid, file_type: 'concept', source_file: `projects/${pid}.json`, source_location: '', community: 0 });

    for (const s of sessions) {
      if (sessionProject(projects, s) !== pid) continue;
      const nid = `sess:${s.uuid}`;
      nodes.push({ id: nid, label: s.title ?? s.uuid.slice(0, 8), file_type: 'document', source_file: path.join('canon', s.rel), source_location: '', harness: s.harness, bytes: s.bytes });
      edge(projNodeId, nid, 'contains', 'EXTRACTED', path.join('canon', s.rel));
    }
    for (const a of artifacts) {
      const nid = `art:${a.kind}:${a.id}`;
      nodes.push({ id: nid, label: a.name ?? a.id, file_type: a.kind === 'plan' || a.kind === 'project' ? 'document' : 'concept', source_file: a._manifestPath, source_location: '', kind: a.kind, version: a.version });
      // User-scope artifacts are AVAILABLE to every project (inferred), except
      // project manifests which bind exactly to their project (extracted).
      if (a.kind === 'project') { if (a.id === pid) edge(nid, projNodeId, 'describes', 'EXTRACTED', a._manifestPath); }
      else edge(nid, projNodeId, 'available_to', 'INFERRED', a._manifestPath);
    }

    // Optional CODE half: fold an external graphify node-link graph (mode A join).
    if (o.mergeGraph && fs.existsSync(o.mergeGraph)) {
      try {
        const g = JSON.parse(fs.readFileSync(o.mergeGraph, 'utf8'));
        for (const n of g.nodes ?? []) nodes.push(n); // graphify ids are un-namespaced; canon ids can't collide (namespaced)
        for (const l of g.links ?? g.edges ?? []) {
          if (l.confidence_score === undefined) l.confidence_score = CONFIDENCE_SCORE[l.confidence ?? 'EXTRACTED'] ?? 1.0;
          links.push(l);
        }
      } catch { /* malformed external graph — skip, lint covers our own outputs */ }
    }

    const graph: any = { directed: true, multigraph: false, graph: {}, nodes, links };
    if (head) graph.built_at_commit = head;
    totalNodes += nodes.length; totalLinks += links.length;
    built.push(pid);
    if (!o.dryRun) {
      const pj = path.join(STORE, 'projects', `${pid}.json`);
      fs.mkdirSync(path.dirname(pj), { recursive: true });
      fs.writeFileSync(pj, JSON.stringify(proj, null, 2) + '\n');
      const gp = path.join(STORE, 'projects', pid, 'graph.json');
      fs.mkdirSync(path.dirname(gp), { recursive: true });
      fs.writeFileSync(gp, JSON.stringify(graph, null, 2) + '\n');
    }
  }

  let pushed = false;
  const summary = `${built.length} project graph(s), ${totalNodes} nodes, ${totalLinks} links`;
  if (!o.dryRun) {
    const git = (a: string[]) => execFileSync('git', a, { cwd: STORE, encoding: 'utf8', env });
    git(['add', '-A']);
    if (git(['status', '--porcelain']).trim()) {
      git(['commit', '-q', '-m', `canon-graph: ${summary}`]);
      git(['push', '-q', 'origin', 'main']);
      console.log(`[canon-graph] pushed: ${summary}`);
      pushed = true;
    } else console.log(`[canon-graph] no changes (${summary})`);
  } else console.log(`[canon-graph DRY] ${summary}`);
  return { projects: built, nodes: totalNodes, links: totalLinks, pushed };
}
