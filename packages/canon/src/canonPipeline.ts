/**
 * canonPipeline — the full reactive maintenance pass: sync → translate → graph.
 *
 * `canonSync` alone copies native files; the canonical line (`/canon/`) and the
 * project knowledge graphs (`/projects/<id>/graph.json`, §27l) only advance when
 * translate + graph run. The reactive triggers (turn-hook scheduler, `canon
 * watch`) call THIS so the store's derived layers stay current automatically —
 * both stages are incremental (manifest/cache-keyed), so a debounced pass is
 * cheap. Translate/graph failures never abort the pass (sync already pushed);
 * they surface in the summary and the store heals on the next cycle.
 *
 * GRAPH CADENCE (2026-11-17): the graph is a DERIVED layer and every rebuild rewrote each project's multi-MB graph.json (its
 * session sizes / segment spans move with every new record) — ~260 MB of graph blobs in 6 h of syncs. The pipeline now rebuilds
 * it at most once per CANON_GRAPH_MIN_INTERVAL_MS (default 24 h; option graphMinIntervalMs; 0 = every pass, the old behaviour).
 * The last build time is kept per store in `<home>/.canon/graph-built.json`. `canon graph` builds on demand at any time.
 *
 * @module canon/canonPipeline
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { canonSync, type CanonSyncOptions, type CanonSyncResult } from './canonSync.js';
import { defaultCanonStore } from './storePath.js';

export interface CanonPipelineOptions extends CanonSyncOptions {
  /** Minimum ms between two graph rebuilds by the pipeline (default env CANON_GRAPH_MIN_INTERVAL_MS, else 24 h; 0 = every pass). */
  graphMinIntervalMs?: number;
  /** Test seam: the clock. */
  now?: () => number;
}

export interface CanonPipelineResult {
  sync: CanonSyncResult;
  translated: boolean;
  graphed: boolean;
  /** Why the graph was not rebuilt this pass (cadence), when it was not. */
  graphSkipped?: string;
  errors: string[];
}

export const DEFAULT_GRAPH_MIN_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** The graph cadence in effect: option, else env CANON_GRAPH_MIN_INTERVAL_MS, else 24 h. */
export function graphMinIntervalMs(opt?: number, env: NodeJS.ProcessEnv = process.env): number {
  if (opt !== undefined && opt >= 0) return opt;
  const e = Number(env.CANON_GRAPH_MIN_INTERVAL_MS);
  return env.CANON_GRAPH_MIN_INTERVAL_MS !== undefined && Number.isFinite(e) && e >= 0 ? e : DEFAULT_GRAPH_MIN_INTERVAL_MS;
}

const stampPath = (home: string) => path.join(home, '.canon', 'graph-built.json');
function readStamps(home: string): Record<string, number> {
  try { return JSON.parse(fs.readFileSync(stampPath(home), 'utf8')) ?? {}; } catch { return {}; }
}
/** When the pipeline last rebuilt the graph of `store` (ms epoch; 0 = never). */
export function lastGraphBuild(home: string, store: string): number {
  return Number(readStamps(home)[path.resolve(store)] ?? 0) || 0;
}
export function recordGraphBuild(home: string, store: string, at: number): void {
  const s = readStamps(home);
  s[path.resolve(store)] = at;
  try { fs.mkdirSync(path.dirname(stampPath(home)), { recursive: true }); fs.writeFileSync(stampPath(home), JSON.stringify(s)); } catch { /* best-effort */ }
}

/** sync → translate → graph (graph at most once per graphMinIntervalMs), best-effort after the sync stage. */
export async function canonPipeline(o: CanonPipelineOptions = {}): Promise<CanonPipelineResult> {
  const errors: string[] = [];
  const sync = await canonSync(o);
  let translated = false;
  let graphed = false;
  let graphSkipped: string | undefined;
  // Only derive when something changed — keeps quiet cycles free.
  if (sync.copied > 0 || sync.chunked > 0) {
    try {
      const { canonTranslate } = await import('./canonTranslate.js');
      const t = await canonTranslate({ store: o.store, repoUrl: o.repoUrl, sealBytes: o.sealBytes, dryRun: o.dryRun });
      translated = true;
      if (t.errors.length) errors.push(...t.errors.map((e) => `translate: ${e}`));
    } catch (e) {
      errors.push(`translate: ${(e as Error)?.message ?? String(e)}`);
    }
    const home = o.home ?? process.env.HOME ?? os.homedir();
    const store = o.store ?? defaultCanonStore();
    const now = (o.now ?? Date.now)();
    const every = graphMinIntervalMs(o.graphMinIntervalMs);
    const last = lastGraphBuild(home, store);
    if (o.dryRun) graphSkipped = 'dry run';
    else if (every > 0 && last > 0 && now - last < every) {
      graphSkipped = `built ${Math.round((now - last) / 60_000)} min ago (cadence ${Math.round(every / 60_000)} min; \`canon graph\` builds on demand)`;
    } else {
      try {
        const { canonGraph } = await import('./canonGraph.js');
        await canonGraph({ store: o.store });
        graphed = true;
        recordGraphBuild(home, store, now);
      } catch (e) {
        errors.push(`graph: ${(e as Error)?.message ?? String(e)}`);
      }
    }
  }
  return { sync, translated, graphed, graphSkipped, errors };
}
