/**
 * ThompsonRouter — explore/exploit model selection by posterior sampling.
 *
 * `recommend()`/`recommendTrusted()` are greedy: they always return the current
 * argmax. That locks the router onto early winners and never re-checks a model
 * that looked weak on thin data — a form of overfitting in the routing policy
 * itself. Thompson sampling fixes this: instead of taking the top mean, it draws
 * one sample from each model's score POSTERIOR and routes to the sampled-argmax.
 *
 * A model with a high mean and many samples (tight posterior) usually wins
 * (exploit). A model with few samples (wide posterior) occasionally samples high
 * and gets a chance (explore) — which generates the very data that sharpens its
 * posterior. Over many dispatches the matrix stops being self-confirming.
 *
 * POSTERIOR: a Gaussian approximation on the 0-100 composite score. mean =
 * compositeScore; sd = explorationSpread / sqrt(sampleCount + 1). Cold-start
 * (sampleCount 0) → widest sd → maximal exploration; as observations accumulate,
 * sd shrinks toward exploitation. Simple, continuous, no Gamma sampler needed.
 *
 * OPT-IN + SAFE: this is only consulted when MODEL_ROUTER_EXPLORATION is on
 * (default off — greedy routing is unchanged). `exclude` drops models that must
 * never be auto-selected (e.g. the operator's cost-constrained providers); the
 * caller passes MODEL_ROUTER_EXCLUDE so exploration can never route to a banned
 * model.
 */

import type { ModelScore } from './ModelRouterMatrix.js';
import type { RNG } from './AutoResearchStats.js';

export interface ThompsonOptions {
  /** RNG in [0,1). Defaults to Math.random (fresh draw per dispatch). Inject a
   *  seeded RNG (mulberry32) for deterministic tests. */
  rng?: RNG;
  /** posterior sd at zero samples, on the 0-100 scale (default 20). Bigger =
   *  more exploration of thinly-sampled models. */
  explorationSpread?: number;
  /** floor on posterior sd so a heavily-sampled model still has a little jitter
   *  (default 1). Prevents total lock-in. */
  minSpread?: number;
  /** model IDs that must never be selected (cost/policy bans). An entry ending
   *  in '*' is a prefix wildcard — e.g. 'grok*' excludes every xAI model,
   *  present and future, in one rule. */
  exclude?: string[];
}

/** Exact match, or prefix match when the exclude entry ends in '*'. */
function isExcluded(modelId: string, exclude: string[]): boolean {
  for (const e of exclude) {
    if (e.endsWith('*')) { if (modelId.startsWith(e.slice(0, -1))) return true; }
    else if (modelId === e) return true;
  }
  return false;
}

/** Standard normal via Box-Muller, driven by the injected RNG. */
function sampleNormal(rng: RNG): number {
  let u = 0, v = 0;
  while (u === 0) u = rng(); // avoid log(0)
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * Draw one posterior sample per model and return the sampled-argmax model id.
 * Returns null if there are no eligible models (all excluded / empty input) —
 * the caller then falls back to its safe default.
 */
export function thompsonSelect(scores: ModelScore[], opts: ThompsonOptions = {}): string | null {
  const rng = opts.rng ?? Math.random;
  const spread = opts.explorationSpread ?? 20;
  const minSpread = opts.minSpread ?? 1;
  const exclude = opts.exclude ?? [];

  let bestId: string | null = null;
  let bestDraw = -Infinity;
  for (const s of scores) {
    if (isExcluded(s.modelId, exclude)) continue;
    const sd = Math.max(minSpread, spread / Math.sqrt(s.sampleCount + 1));
    const draw = s.compositeScore + sd * sampleNormal(rng);
    if (draw > bestDraw) { bestDraw = draw; bestId = s.modelId; }
  }
  return bestId;
}
