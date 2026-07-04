/**
 * Arm planning for the multi-provider autoresearch loop (`--width` > 1).
 *
 * A "round" of the loop can fan out into N parallel candidate ARMS — each arm gets its
 * own worktree and its own Fixer model, so provider/model diversity competes on the SAME
 * deficiency and the statistical gate (FWER-adjusted with family width N) picks the
 * winner. This module decides WHICH model each arm runs:
 *
 *   pool resolution (first match wins):
 *     1. --arm-models a,b,c        explicit model ids, rotated across arms
 *     2. --providers x,y           each provider contributes its most capable
 *                                  tool-supporting model (highest combined cost —
 *                                  the inverse of the registry's helper-model pick)
 *     3. neither (width > 1)       every provider with a configured API key contributes
 *                                  its most capable model (env-scan via the model cards'
 *                                  declared apiKeyEnvVar)
 *   arm 1 always keeps the loop's --model when given (baseline continuity).
 *
 * Missing-key policy (`--missing-provider-key-policy`) decides what happens to an arm
 * whose model's provider key is NOT present in the environment:
 *   - platform_fallback (default): keep the arm — in the container/proxy world the key
 *     may be funded upstream (job-token proxy, platform fallback), and locally a failed
 *     arm surfaces as a no-verdict skip with the captured reason.
 *   - omit: drop the arm (the family shrinks; logged in plan notes).
 *   - redistribute: reassign the arm to the next funded model in the pool.
 *
 * Pure planning — no processes are spawned here; the loop consumes the plan.
 */
import { ModularModelRegistry, hasApiKeyForModel } from '@nexus-cortex/core';

export type MissingKeyPolicy = 'platform_fallback' | 'omit' | 'redistribute';

export const MISSING_KEY_POLICIES: MissingKeyPolicy[] = ['platform_fallback', 'omit', 'redistribute'];

export interface ArmAssignment {
  /** 1-based arm index within the round's family. */
  arm: number;
  /** Fixer model for this arm; undefined = harness default (DEFAULT_MODEL_ID). */
  model?: string;
  /** Effectiveness-arm label recorded with the arm's scored runs (matrix attribution). */
  strategy?: string;
  /** Whether the model's provider key was present in the environment at plan time. */
  funded: boolean;
}

export interface ArmPlanInput {
  width: number;
  /** The loop's --model (arm 1 baseline; also the single-arm model). */
  baseModel?: string;
  /** Explicit --arm-models list (comma-split upstream). */
  armModels?: string[];
  /** --providers list (comma-split upstream). */
  providers?: string[];
  /** Global --strategy label; when set it overrides the per-arm fixer:<model> label. */
  strategy?: string;
  policy: MissingKeyPolicy;
}

export interface ArmPlan {
  arms: ArmAssignment[];
  /** Human-readable planning decisions (dropped arms, redistributions, empty pools). */
  notes: string[];
}

/** True when SOME model of the provider declares an API-key env var that is set.
 *  Stricter than hasApiKeyForModel (which is permissive for undeclared keys) so that
 *  keyless/local providers don't masquerade as configured. */
function providerHasKey(registry: ModularModelRegistry, provider: string): boolean {
  try {
    return registry.getModelsByProvider(provider).some((m) => {
      const envVar = (m as { api?: { apiKeyEnvVar?: string } }).api?.apiKeyEnvVar;
      return !!(envVar && process.env[envVar] && process.env[envVar]!.trim());
    });
  } catch {
    return false;
  }
}

/** The provider's most capable tool-supporting model (highest combined per-million cost —
 *  the deliberate inverse of the registry's cheapest-helper pick). */
function flagshipModel(registry: ModularModelRegistry, provider: string): string | undefined {
  try {
    const models = registry
      .getModelsByProvider(provider)
      .filter((m) => (m as { tools?: { supported?: boolean } }).tools?.supported);
    if (!models.length) return undefined;
    const scored = models
      .map((m) => {
        const cost = (m as { cost?: { inputPerMillion?: number; outputPerMillion?: number } }).cost;
        return { id: (m as { id: string }).id, cost: (cost?.inputPerMillion ?? 0) + (cost?.outputPerMillion ?? 0) };
      })
      .sort((a, b) => b.cost - a.cost);
    return scored[0]?.id;
  } catch {
    return undefined;
  }
}

/** All card providers that currently have a configured key, in registry order. */
function configuredProviders(registry: ModularModelRegistry): string[] {
  const seen = new Set<string>();
  for (const m of registry.getAllModels()) {
    const provider = (m as { provider?: string }).provider;
    if (provider && !seen.has(provider) && providerHasKey(registry, provider)) seen.add(provider);
  }
  return [...seen];
}

export function planArms(input: ArmPlanInput): ArmPlan {
  const notes: string[] = [];
  const width = Math.max(1, Math.floor(input.width || 1));
  const registry = new ModularModelRegistry();

  // ---- Resolve the model pool ------------------------------------------------
  let pool: (string | undefined)[];
  if (input.armModels?.length) {
    pool = [...input.armModels];
  } else if (input.providers?.length) {
    pool = input.providers.map((p) => {
      const m = flagshipModel(registry, p.trim());
      if (!m) notes.push(`provider '${p.trim()}' has no tool-supporting model in the registry — skipped`);
      return m;
    }).filter(Boolean) as string[];
  } else if (width > 1) {
    const providers = configuredProviders(registry);
    pool = providers.map((p) => flagshipModel(registry, p)).filter(Boolean) as string[];
    // The AUTO-derived pool honors the router ban list (MODEL_ROUTER_EXCLUDE — exact ids
    // or 'prefix*' wildcards, default grok*). Explicit --arm-models/--providers override it.
    const exclude = (process.env.MODEL_ROUTER_EXCLUDE ?? 'grok*')
      .split(',').map((s) => s.trim()).filter(Boolean);
    const banned = (id: string) => exclude.some((e) =>
      e.endsWith('*') ? id.startsWith(e.slice(0, -1)) : id === e);
    const before = pool.length;
    pool = pool.filter((m) => m && !banned(m as string));
    if (pool.length < before) notes.push(`auto-pool: excluded ${before - pool.length} model(s) via MODEL_ROUTER_EXCLUDE`);
    if (!pool.length) {
      notes.push('no configured providers detected — all arms use the default model');
    }
  } else {
    pool = [];
  }

  // Baseline continuity: the loop's --model leads the rotation (dedup keeps one copy).
  if (input.baseModel) pool = [input.baseModel, ...pool.filter((m) => m !== input.baseModel)];
  // Dedup while preserving order.
  pool = [...new Set(pool.filter(Boolean))] as string[];

  // ---- Missing-key policy ------------------------------------------------------
  const funded = (m: string | undefined) => (m ? hasApiKeyForModel(m) : true);
  if (pool.length && input.policy === 'redistribute') {
    const fundedPool = pool.filter((m) => funded(m));
    if (fundedPool.length) {
      let i = 0;
      pool = pool.map((m) => {
        if (funded(m)) return m;
        const sub = fundedPool[i++ % fundedPool.length];
        notes.push(`redistribute: '${m}' has no key → arm reassigned to '${sub}'`);
        return sub;
      });
      pool = [...new Set(pool)];
    } else {
      notes.push('redistribute: no funded model in the pool — arms kept as planned (platform may fund)');
    }
  }

  // ---- Cycle the pool across the family width ---------------------------------
  // Assign first, THEN apply omit — omit drops only UNFUNDED arms; a fully-funded
  // pool smaller than the width still cycles to fill every requested arm.
  let arms: ArmAssignment[] = [];
  for (let k = 0; k < width; k++) {
    const model = pool.length ? pool[k % pool.length] : input.baseModel;
    arms.push({
      arm: k + 1,
      model,
      strategy: input.strategy ?? (model && width > 1 ? `fixer:${model}` : undefined),
      funded: funded(model),
    });
  }
  if (input.policy === 'omit') {
    const dropped = arms.filter((a) => !a.funded);
    if (dropped.length) {
      notes.push(`omit: dropped ${dropped.length} unfunded arm(s): ${dropped.map((a) => a.model).join(', ')}`);
      arms = arms.filter((a) => a.funded).map((a, k) => ({ ...a, arm: k + 1 }));
      if (!arms.length) {
        notes.push('omit: every arm was unfunded — keeping one default-model arm');
        arms = [{ arm: 1, model: input.baseModel, strategy: input.strategy, funded: true }];
      }
    }
  }
  return { arms, notes };
}

export function parseMissingKeyPolicy(raw: string | undefined): MissingKeyPolicy {
  if (!raw) return 'platform_fallback';
  const v = raw.trim().toLowerCase().replace(/-/g, '_') as MissingKeyPolicy;
  if (!MISSING_KEY_POLICIES.includes(v)) {
    throw new Error(`invalid --missing-provider-key-policy '${raw}' (expected ${MISSING_KEY_POLICIES.join(' | ')})`);
  }
  return v;
}
