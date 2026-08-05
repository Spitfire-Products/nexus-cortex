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
 * @module canon/canonPipeline
 */
import { canonSync, type CanonSyncOptions, type CanonSyncResult } from './canonSync.js';

export interface CanonPipelineResult {
  sync: CanonSyncResult;
  translated: boolean;
  graphed: boolean;
  errors: string[];
}

/** sync → translate → graph, best-effort after the sync stage. */
export async function canonPipeline(o: CanonSyncOptions = {}): Promise<CanonPipelineResult> {
  const errors: string[] = [];
  const sync = await canonSync(o);
  let translated = false;
  let graphed = false;
  // Only derive when something changed — keeps quiet cycles free.
  if (sync.copied > 0 || sync.chunked > 0) {
    try {
      const { canonTranslate } = await import('./canonTranslate.js');
      const t = await canonTranslate({ store: o.store, repoUrl: o.repoUrl });
      translated = true;
      if (t.errors.length) errors.push(...t.errors.map((e) => `translate: ${e}`));
    } catch (e) {
      errors.push(`translate: ${(e as Error)?.message ?? String(e)}`);
    }
    try {
      const { canonGraph } = await import('./canonGraph.js');
      await canonGraph({ store: o.store });
      graphed = true;
    } catch (e) {
      errors.push(`graph: ${(e as Error)?.message ?? String(e)}`);
    }
  }
  return { sync, translated, graphed, errors };
}
