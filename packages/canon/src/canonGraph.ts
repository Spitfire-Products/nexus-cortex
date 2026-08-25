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
import { requireCanonRepo, redactRepoUrl, canonGit, guardedAddAll, atomicClone, guardedPush } from './canonRepo.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { discoverCanonSessions, type CanonSession } from './canonPull.js';
import { buildTouchedIndex } from './canonTouched.js';
import { extractCognition, readSessionCognitionRecords } from './canonCognition.js';
import { scrubSecrets } from './canonSync.js';

const CONFIDENCE_SCORE: Record<string, number> = { EXTRACTED: 1.0, INFERRED: 0.5, AMBIGUOUS: 0.2 };

export interface ProjectEntry {
  id: string;
  /** Best-effort decoded root (claude-code encoding is lossy on dashes — encoded form is authoritative). */
  root: string;
  /** Store-relative canon session dir prefixes per harness. */
  sessionPaths: Record<string, string[]>;
  sessionCounts: Record<string, number>;
}

const encodeCC = (root: string) => root.replace(/[/.]/g, '-');

/**
 * Optional user overrides at `<store>/projects/ROOTS.json` — for the cases
 * derivation cannot decide (dash-ambiguous encodings, sessions recorded on
 * another machine, cortex sub-root labels belonging to a parent project):
 * `{ roots: {id: absPath}, claudeDirs: {encodedDirName: id}, cortexLabels: {label: id} }`
 */
interface RootsConfig {
  roots?: Record<string, string>;
  claudeDirs?: Record<string, string>;
  cortexLabels?: Record<string, string>;
}

/**
 * Decode a Claude-Code-encoded path remainder against the real filesystem.
 * The encoding maps both `/` and `.` to `-`, so it is lossy; we DFS the
 * segment joins ('-'-in-name vs '/'-descend) preferring paths that exist.
 * Falls back to `<base>/<remainder-verbatim>` (unverified) when nothing
 * matches — e.g. a store cloned on a machine that never held the code.
 */
function fsResolveEncoded(base: string, remainder: string): { root: string; verified: boolean } {
  const segs = remainder.split('-');
  let best: string | undefined;
  const walk = (dir: string, i: number, budget: { n: number }): void => {
    if (best || budget.n-- <= 0) return;
    if (i >= segs.length) { if (fs.existsSync(dir)) best = dir; return; }
    // Greedily extend the current path component before descending.
    for (let j = segs.length; j > i; j--) {
      const component = segs.slice(i, j).join('-');
      const candidate = path.join(dir, component);
      if (fs.existsSync(candidate)) { walk(candidate, j, budget); if (best) return; }
    }
  };
  walk(base, 0, { n: 256 });
  return best ? { root: best, verified: true } : { root: path.join(base, remainder), verified: false };
}

/**
 * Derive the authoritative project ↔ session-path map from store paths.
 * Fully environment-derived ($HOME + filesystem + the store's own dirs);
 * `projects/ROOTS.json` overrides win where present. No hardcoded roots.
 */
export function deriveProjectSessionMap(store: string): Record<string, ProjectEntry> {
  const HOME = process.env.HOME ?? process.env.USERPROFILE ?? '';
  let cfg: RootsConfig = {};
  try { cfg = JSON.parse(fs.readFileSync(path.join(store, 'projects', 'ROOTS.json'), 'utf8')); } catch { /* optional */ }

  const projects: Record<string, ProjectEntry> = {};
  const entry = (id: string, root: string) =>
    (projects[id] ??= { id, root, sessionPaths: {}, sessionCounts: {} });
  const add = (id: string, root: string, harness: string, rel: string) => {
    const e = entry(id, root);
    if (!e.root && root) e.root = root;
    (e.sessionPaths[harness] ??= []).push(rel);
    e.sessionCounts[harness] = (e.sessionCounts[harness] ?? 0) + 0; // counts filled from sessions below
  };
  const homeEnc = HOME ? encodeCC(HOME) : '';

  const ccRoot = path.join(store, 'canon', 'claude-code');
  let ccDirs: string[] = [];
  try { ccDirs = fs.readdirSync(ccRoot).filter((d) => fs.statSync(path.join(ccRoot, d)).isDirectory()); } catch { /* none */ }
  for (const dir of ccDirs.sort()) {
    const rel = path.join('claude-code', dir);
    const overrideId = cfg.claudeDirs?.[dir];
    if (overrideId) { add(overrideId, cfg.roots?.[overrideId] ?? '', 'claude-code', rel); continue; }
    if (homeEnc && dir === homeEnc) { add(path.basename(HOME), HOME, 'claude-code', rel); continue; }
    if (homeEnc && dir.startsWith(homeEnc + '-')) {
      const remainder = dir.slice(homeEnc.length + 1);
      const { root, verified } = fsResolveEncoded(HOME, remainder);
      // Prefer the resolved basename as the id; keep the raw remainder when
      // the basename is already claimed by a different root (collision).
      let id = verified ? path.basename(root) : remainder;
      if (projects[id] && projects[id]!.root && projects[id]!.root !== root) id = remainder;
      add(id, cfg.roots?.[id] ?? root, 'claude-code', rel);
      continue;
    }
    // Foreign-machine or unrecognized encoding: its own project, no local root
    // (sessions still list/graph; touched/auto-detect need a root override).
    add(dir, cfg.roots?.[dir] ?? '', 'claude-code', rel);
  }

  const cxRoot = path.join(store, 'canon', 'nexus-cortex');
  let cxDirs: string[] = [];
  try { cxDirs = fs.readdirSync(cxRoot).filter((d) => fs.statSync(path.join(cxRoot, d)).isDirectory()); } catch { /* none */ }
  for (const label of cxDirs.sort()) {
    const id = cfg.cortexLabels?.[label] ?? label;
    const existing = projects[id]?.root;
    const guess = HOME && label === path.basename(HOME) ? HOME
      : HOME && fs.existsSync(path.join(HOME, label)) ? path.join(HOME, label) : '';
    add(id, existing ?? cfg.roots?.[id] ?? guess, 'nexus-cortex', path.join('nexus-cortex', label));
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
  /** Scan session content for session→file `touched` edges (default true; cached, incremental). */
  touched?: boolean;
  /**
   * OPT-IN COGNITION DIMENSION (default false → default graph output byte-
   * identical). Folds each session's reasoning into `thought` nodes joined on
   * session_id+turn, with thought→tool_call / thought→source_file /
   * thought→thought edges. Thought nodes carry ONLY structural/derived data
   * (session_id, turn, block_type, counts, a secret-scrubbed ~80-char label) —
   * see `includeThoughtText` before widening what a SHAREABLE graph exposes.
   */
  cognition?: boolean;
  /** SHARING RISK: include fuller (still-scrubbed) thinking text on thought nodes. Only meaningful with `cognition`. Default false. */
  includeThoughtText?: boolean;
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
  // Auto-clone like every other verb — /tmp stores are disposable by design.
  if (!fs.existsSync(path.join(STORE, '.git'))) {
    const repo = requireCanonRepo(undefined, STORE, 'canon-graph');
    console.log(`[canon-graph] no store at ${STORE} — cloning ${redactRepoUrl(repo)}`);
    atomicClone(repo, STORE, 'canon-graph');
  }
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
  try { head = canonGit(STORE, 'canon-graph')(['rev-parse', 'HEAD']).trim(); } catch { /* untracked */ }

  const wanted = o.project ? [o.project] : Object.keys(projects).sort();
  let totalNodes = 0, totalLinks = 0, unchangedGraphs = 0;
  const built: string[] = [];

  // Session-content scan (touched edges) — streamed once per changed session,
  // cache-served afterwards. Scans ALL mapped sessions (not just the wanted
  // projects'): cross-project touches route to the OWNING project's graph, so
  // a foreign session's edges into a wanted project must be discoverable.
  let touchedIdx: Awaited<ReturnType<typeof buildTouchedIndex>> | undefined;
  if (o.touched !== false) {
    const mapped = sessions.filter((s) => sessionProject(projects, s) !== undefined);
    touchedIdx = await buildTouchedIndex(mapped);
    console.log(`[canon-graph] touched scan: ${touchedIdx.scanned} session(s) scanned, ${touchedIdx.cached} from cache`);
  }

  // Touched paths are assigned to their MOST SPECIFIC project root (roots nest:
  // the workspace root contains the others — longest-match, never first-match).
  const rootsByLength = Object.values(projects)
    .filter((p) => p.root) // rootless projects (foreign-machine dirs w/o override) own no paths
    .map((p) => ({ pid: p.id, prefix: (p.root.endsWith(path.sep) ? p.root : p.root + path.sep) }))
    .sort((a, b) => b.prefix.length - a.prefix.length);
  const ownerOf = (abs: string): { pid: string; rel: string } | undefined => {
    for (const r of rootsByLength) if (abs.startsWith(r.prefix)) return { pid: r.pid, rel: abs.slice(r.prefix.length) };
    return undefined;
  };

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

    // CODE half (mode A): fold an external graphify node-link graph. An explicit
    // --merge-graph targets the selected project; otherwise AUTO-DETECT the
    // standard graphify output at the project root (graphify-out/graph.json —
    // written by `graphify update <root>`), so keeping the code half fresh is
    // just re-running graphify; the next canon graph build folds it in.
    const codeGraphPath = o.mergeGraph && (!o.project || o.project === pid)
      ? o.mergeGraph
      : path.join(proj.root, 'graphify-out', 'graph.json');
    let codeHalf: { source: string; nodes: number; links: number } | undefined;
    if (fs.existsSync(codeGraphPath)) {
      try {
        const g = JSON.parse(fs.readFileSync(codeGraphPath, 'utf8'));
        const gn = g.nodes ?? [];
        const gl = g.links ?? g.edges ?? [];
        for (const n of gn) nodes.push(n); // graphify ids are un-namespaced; canon ids can't collide (namespaced)
        for (const l of gl) {
          if (l.confidence_score === undefined) l.confidence_score = CONFIDENCE_SCORE[l.confidence ?? 'EXTRACTED'] ?? 1.0;
          links.push(l);
        }
        codeHalf = { source: codeGraphPath, nodes: gn.length, links: gl.length };
      } catch { /* malformed external graph — skip, lint covers our own outputs */ }
    }

    // HISTORY↔CODE JOIN: session→file `touched` edges from the content scan.
    // Edges route to the OWNING project (longest-root-match): every session —
    // home or foreign — contributes edges for the paths THIS project owns. A
    // foreign session (homed elsewhere) gets a marked sess: node here
    // (foreign_home = its own project) so cross-project work is first-class,
    // not a tally. Target resolution: prefer the code half's FILE-level node
    // (source_location L1 + label = basename — graphify's file-node shape);
    // otherwise a lightweight file: node is created so no touch is dropped.
    // Paths owned by NO mapped project are tallied (unownedPaths), not edged.
    let touchedStats:
      | { edges: number; inferredEdges: number; ambiguousEdges: number; toCodeNodes: number; toFileNodes: number; foreignSessions: number; unownedPaths: number }
      | undefined;
    if (touchedIdx) {
      const fileNodeByPath = new Map<string, string>();
      for (const n of nodes) {
        if (/^(sess|art|proj|file):/.test(n.id)) continue; // code-half nodes only
        if (n.source_file && n.source_location === 'L1' && n.label === path.basename(n.source_file)) {
          if (!fileNodeByPath.has(n.source_file)) fileNodeByPath.set(n.source_file, n.id);
        }
      }
      touchedStats = { edges: 0, inferredEdges: 0, ambiguousEdges: 0, toCodeNodes: 0, toFileNodes: 0, foreignSessions: 0, unownedPaths: 0 };
      const madeFileNodes = new Map<string, string>();
      const presentSessionNodes = new Set(nodes.filter((n) => n.id.startsWith('sess:')).map((n) => n.id));
      // Edges dedupe by (session node, target): dual-lineage copies of one
      // session share a uuid — overlapping touches keep the MAX weight
      // (lineages are copies; summing would double-count).
      const RANK: Record<string, number> = { EXTRACTED: 3, INFERRED: 2, AMBIGUOUS: 1 };
      const touchedEdges = new Map<string, { source: string; target: string; weight: number; source_file: string; conf: string }>();
      for (const s of sessions) {
        const home = sessionProject(projects, s);
        if (home === undefined) continue;
        const sessNodeId = `sess:${s.uuid}`;
        const sessSource = path.join('canon', s.rel);
        // Pass 1 = tier 1/2 structured evidence (EXTRACTED); pass 2 = tier 3
        // Bash-parsed paths (INFERRED). Structured evidence wins per edge.
        for (const [files, conf] of [
          [touchedIdx.byRel.get(s.rel), 'EXTRACTED'],
          [touchedIdx.inferredByRel.get(s.rel), 'INFERRED'],
          [touchedIdx.ambiguousByRel.get(s.rel), 'AMBIGUOUS'],
        ] as [Map<string, number> | undefined, string][]) {
          if (!files || files.size === 0) continue;
          const inferred = conf !== 'EXTRACTED';
          for (const [abs, count] of files) {
            const owner = ownerOf(abs);
            if (!owner) { if (home === pid && !inferred) touchedStats.unownedPaths++; continue; }
            if (owner.pid !== pid) continue; // routed to the owning project's graph
            const rel = owner.rel;
            let target = fileNodeByPath.get(rel);
            if (target) { if (!inferred) touchedStats.toCodeNodes++; }
            else {
              target = madeFileNodes.get(rel);
              if (!target) {
                target = `file:${rel}`;
                madeFileNodes.set(rel, target);
                nodes.push({ id: target, label: path.basename(rel), file_type: 'document', source_file: rel, source_location: '' });
              }
              if (!inferred) touchedStats.toFileNodes++;
            }
            if (!presentSessionNodes.has(sessNodeId)) {
              // Foreign session touching this project's files — first-class, marked.
              nodes.push({ id: sessNodeId, label: s.title ?? s.uuid.slice(0, 8), file_type: 'document', source_file: path.join('canon', s.rel), source_location: '', harness: s.harness, foreign_home: home });
              presentSessionNodes.add(sessNodeId);
              touchedStats.foreignSessions++;
            }
            const ek = sessNodeId + '|' + target;
            const prev = touchedEdges.get(ek);
            if (prev) {
              if (RANK[conf]! > RANK[prev.conf]!) { prev.conf = conf; prev.weight = count; }
              else if (RANK[conf] === RANK[prev.conf]) prev.weight = Math.max(prev.weight, count);
            } else touchedEdges.set(ek, { source: sessNodeId, target, weight: count, source_file: sessSource, conf });
          }
        }
      }
      for (const e of touchedEdges.values()) {
        links.push({ source: e.source, target: e.target, relation: 'touched', confidence: e.conf, confidence_score: CONFIDENCE_SCORE[e.conf], source_file: e.source_file, source_location: '', weight: e.weight });
        if (e.conf === 'EXTRACTED') touchedStats.edges++;
        else if (e.conf === 'INFERRED') touchedStats.inferredEdges++;
        else touchedStats.ambiguousEdges++;
      }
    }

    // COGNITION dimension (opt-in): the reasoning half. Runs AFTER touched so
    // it reuses the file nodes already present (code-half FILE nodes + touched's
    // `file:` nodes); its resolveFile mirrors the touched join — path→owning
    // project (longest-root-match) → the project-relative file node, creating a
    // lightweight `file:` node only when nothing represents the path yet. Thought
    // labels/text route through the SAME push-boundary scrub as canonSync, so a
    // thought node can never be a leak vector in a shareable graph.
    let cognitionStats: { thoughts: number; toolEdges: number; fileEdges: number; continuityEdges: number } | undefined;
    if (o.cognition) {
      cognitionStats = { thoughts: 0, toolEdges: 0, fileEdges: 0, continuityEdges: 0 };
      // Index file nodes present so far (code-half FILE-level + any `file:` node).
      const cogFileByRel = new Map<string, string>();
      const nodeIds = new Set<string>();
      for (const n of nodes) {
        nodeIds.add(n.id);
        if (n.id.startsWith('file:') && n.source_file) { if (!cogFileByRel.has(n.source_file)) cogFileByRel.set(n.source_file, n.id); }
        else if (!/^(sess|art|proj|thought|tool):/.test(n.id) && n.source_file && n.source_location === 'L1' && n.label === path.basename(n.source_file)) {
          if (!cogFileByRel.has(n.source_file)) cogFileByRel.set(n.source_file, n.id);
        }
      }
      const resolveFile = (abs: string): string | undefined => {
        const owner = ownerOf(abs);
        if (!owner || owner.pid !== pid) return undefined; // routed to the owning project's graph
        const rel = owner.rel;
        const existing = cogFileByRel.get(rel);
        if (existing) return existing;
        const id = `file:${rel}`;
        cogFileByRel.set(rel, id);
        if (!nodeIds.has(id)) {
          nodeIds.add(id);
          nodes.push({ id, label: path.basename(rel), file_type: 'document', source_file: rel, source_location: '' });
        }
        return id;
      };
      for (const s of sessions) {
        if (sessionProject(projects, s) !== pid) continue;
        let recs: any[] = [];
        try { recs = await readSessionCognitionRecords(s.parts); } catch { continue; }
        if (!recs.length) continue;
        const cog = extractCognition(recs, {
          sessionSourceFile: path.join('canon', s.rel),
          scrub: scrubSecrets,
          includeThoughtText: o.includeThoughtText === true,
          resolveFile,
        });
        for (const n of cog.nodes) nodes.push(n);
        for (const l of cog.links) links.push(l);
        cognitionStats.thoughts += cog.thoughts;
        cognitionStats.toolEdges += cog.toolEdges;
        cognitionStats.fileEdges += cog.fileEdges;
        cognitionStats.continuityEdges += cog.continuityEdges;
      }
      console.log(`[canon-graph] cognition: ${cognitionStats.thoughts} thought(s), ${cognitionStats.toolEdges} tool + ${cognitionStats.fileEdges} file + ${cognitionStats.continuityEdges} continuity edge(s) [${pid}]`);
    }

    const meta: any = {};
    if (codeHalf) meta.code_half = codeHalf;
    if (touchedStats) meta.touched_stats = touchedStats;
    if (cognitionStats) meta.cognition_stats = cognitionStats;
    // built_at_commit is stamped ONLY when content actually changed — otherwise
    // every store commit would rewrite the (multi-MB) graph for a HEAD-only
    // diff, bloating history for zero information (the G2 churn class). The
    // guard compares the body sans stamp; an unchanged graph keeps its file
    // (and its original stamp) untouched.
    const body: any = { directed: true, multigraph: false, graph: meta, nodes, links };
    totalNodes += nodes.length; totalLinks += links.length;
    built.push(pid);
    if (!o.dryRun) {
      const pj = path.join(STORE, 'projects', `${pid}.json`);
      fs.mkdirSync(path.dirname(pj), { recursive: true });
      fs.writeFileSync(pj, JSON.stringify(proj, null, 2) + '\n');
      const gp = path.join(STORE, 'projects', pid, 'graph.json');
      let unchangedGraph = false;
      if (fs.existsSync(gp)) {
        try {
          const prev = JSON.parse(fs.readFileSync(gp, 'utf8'));
          delete prev.built_at_commit;
          unchangedGraph = JSON.stringify(prev) === JSON.stringify(body);
        } catch { /* rewrite */ }
      }
      if (unchangedGraph) unchangedGraphs++;
      else {
        if (head) body.built_at_commit = head;
        fs.mkdirSync(path.dirname(gp), { recursive: true });
        fs.writeFileSync(gp, JSON.stringify(body, null, 2) + '\n');
      }
    }
  }

  let pushed = false;
  const summary = `${built.length} project graph(s), ${totalNodes} nodes, ${totalLinks} links` + (unchangedGraphs ? `, ${unchangedGraphs} unchanged (stamp kept)` : '');
  if (!o.dryRun) {
    const git = canonGit(STORE, 'canon-graph');
    if (guardedAddAll(git, 'canon-graph')) {
      git(['commit', '-q', '-m', `canon-graph: ${summary}`]);
      pushed = guardedPush(git, 'canon-graph');
      if (pushed) console.log(`[canon-graph] pushed: ${summary}`);
      else console.log(`[canon-graph] committed locally, push deferred to next cycle: ${summary}`);
    } else console.log(`[canon-graph] no changes (${summary})`);
  } else console.log(`[canon-graph DRY] ${summary}`);
  return { projects: built, nodes: totalNodes, links: totalLinks, pushed };
}
