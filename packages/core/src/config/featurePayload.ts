/**
 * R262 FEATURE PAYLOAD LAYER (P0, 2026-10-15) — design: .cortex/research/feature-flags-parity-design-2026-10-15.md §3, §4.2.
 *
 * A GrowthBook-format payload ({features: {KEY: {defaultValue, rules: [...]}}}) evaluated OFFLINE with the
 * @growthbook/growthbook SDK (constructed with no apiHost / clientKey → no network path exists by construction).
 *
 *   CORTEX_FEATURES       = on (default) | off — off disables the layer entirely
 *   CORTEX_FEATURES_FILE  = <path> — payload file (wins over the inline form)
 *   CORTEX_FEATURES_JSON  = <inline JSON payload>
 *   CORTEX_FEATURE_ATTRS  = <JSON object> — targeting attributes, merged OVER the auto attributes
 *   CORTEX_FEATURES_HASH  = REPORTED: sha256 of the canonical (sorted-keys) payload
 *   CORTEX_FEATURES_APPLIED = REPORTED: JSON list of the levers the layer wrote (the effective-config `feature` source)
 *
 * Rules (enforced here, nowhere else):
 *   - a feature writes `env[key]` ONLY when a rule fired (evaluation source `force` | `experiment`) AND the key is
 *     unset — `undefined`, or filled only by the interactive profile (CORTEX_INTERACTIVE_PROFILE_APPLIED), which sits
 *     BELOW feature rules in the precedence real env / user files > feature rules > profile > shipped defaults;
 *   - `defaultValue` results write nothing (the code default already applies);
 *   - no payload / CORTEX_FEATURES=off → env untouched, {hash: null, applied: []} (byte-identical behaviour);
 *   - values are written as strings (booleans → 'true' / 'false', objects → JSON).
 */
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { GrowthBook } from '@growthbook/growthbook';
import { profileAppliedKeys } from './interactiveProfile.js';

export interface FeatureApplied {
  key: string;
  value: string;
  source: 'force' | 'experiment';
  ruleId?: string;
  experimentKey?: string;
  variationId?: number;
}

export interface FeaturePayloadResult {
  hash: string | null;
  applied: FeatureApplied[];
}

export interface FeaturePayloadOptions {
  /** Payload file; defaults to env.CORTEX_FEATURES_FILE. Wins over payloadJson. */
  payloadPath?: string;
  /** Inline payload; defaults to env.CORTEX_FEATURES_JSON. */
  payloadJson?: string;
  /** Extra attributes, merged over the auto + CORTEX_FEATURE_ATTRS attributes. */
  attributes?: Record<string, unknown>;
}

const APPLIED_ENV = 'CORTEX_FEATURES_APPLIED';

/** JSON with object keys sorted recursively — the hashing unit (key order never changes the hash). */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj).sort().filter((k) => obj[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

export function featurePayloadHash(payload: unknown): string {
  return createHash('sha256').update(canonicalJson(payload)).digest('hex');
}

function toEnvString(v: unknown): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'boolean' || typeof v === 'number') return String(v);
  return JSON.stringify(v);
}

/** Auto targeting attributes from the process env (undefined values dropped). */
export function featureAttributes(env: NodeJS.ProcessEnv, extra?: Record<string, unknown>): Record<string, unknown> {
  const auto: Record<string, unknown> = {
    surface: env.CORTEX_SURFACE || 'cli',
    model: env.DEFAULT_MODEL_ID,
    run: env.TB2_RUN,
    arm: env.TB2_ARM,
    task: env.TB2_TASK,
    id: env.TB2_TASK || env.CORTEX_SESSION_ID || 'session',
  };
  let user: Record<string, unknown> = {};
  const raw = env.CORTEX_FEATURE_ATTRS;
  if (raw && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) user = parsed;
    } catch { console.error('[WARN] CORTEX_FEATURE_ATTRS is not valid JSON — ignored'); }
  }
  const out: Record<string, unknown> = { ...auto, ...user, ...(extra ?? {}) };
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return out;
}

/** The levers this layer wrote in this process (key → record), for the effective-config `feature` source label. */
export function featureAppliedKeys(env: NodeJS.ProcessEnv = process.env): Map<string, FeatureApplied> {
  const out = new Map<string, FeatureApplied>();
  const raw = env[APPLIED_ENV];
  if (!raw) return out;
  try {
    const list = JSON.parse(raw);
    if (Array.isArray(list)) for (const r of list) if (r && typeof r.key === 'string') out.set(r.key, r as FeatureApplied);
  } catch { /* malformed record — report nothing */ }
  return out;
}

/** Evaluate the payload and fill the levers its rules set (unset keys only). See the module header for the rules. */
export function applyFeaturePayload(env: NodeJS.ProcessEnv, opts: FeaturePayloadOptions = {}): FeaturePayloadResult {
  const none: FeaturePayloadResult = { hash: null, applied: [] };
  if ((env.CORTEX_FEATURES ?? '').trim().toLowerCase() === 'off') return none;
  const file = opts.payloadPath ?? (env.CORTEX_FEATURES_FILE?.trim() || undefined);
  const inline = opts.payloadJson ?? (env.CORTEX_FEATURES_JSON?.trim() || undefined);
  if (!file && !inline) return none;

  let payload: { features?: Record<string, unknown> } & Record<string, unknown>;
  try {
    const text = file ? fs.readFileSync(path.resolve(file), 'utf-8') : (inline as string);
    payload = JSON.parse(text);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('payload is not an object');
  } catch (e: any) {
    console.error(`[WARN] feature payload ${file ? `file ${file}` : 'CORTEX_FEATURES_JSON'} unreadable — layer skipped: ${e?.message ?? e}`);
    return none;
  }

  const hash = featurePayloadHash(payload);
  env.CORTEX_FEATURES_HASH = hash;

  const prior = featureAppliedKeys(env);
  const fromProfile = profileAppliedKeys(env);
  const features = payload.features && typeof payload.features === 'object' ? payload.features : {};
  const keys = Object.keys(features).sort();
  const fresh: FeatureApplied[] = [];
  if (keys.length > 0) {
    // Offline only: no apiHost / clientKey / remote eval — evaluation never leaves the process.
    const gb = new GrowthBook({ attributes: featureAttributes(env, opts.attributes) });
    try {
      gb.initSync({ payload: payload as any, streaming: false });
      for (const key of keys) {
        if (prior.has(key)) continue; // already applied by an earlier bootstrap in this process
        const unset = env[key] === undefined || fromProfile.has(key);
        if (!unset) continue; // real env / user files win over a rule
        const res = gb.evalFeature(key);
        if (res.source !== 'force' && res.source !== 'experiment') continue; // defaultValue → write nothing
        if (res.value === null || res.value === undefined) continue;
        const rec: FeatureApplied = { key, value: toEnvString(res.value), source: res.source };
        if (res.ruleId) rec.ruleId = res.ruleId;
        if (res.source === 'experiment') {
          if (res.experiment?.key) rec.experimentKey = res.experiment.key;
          if (typeof res.experimentResult?.variationId === 'number') rec.variationId = res.experimentResult.variationId;
        }
        env[key] = rec.value;
        fresh.push(rec);
      }
    } finally {
      try { gb.destroy(); } catch { /* best-effort */ }
    }
  }

  if (fresh.length > 0) {
    const overtaken = fresh.filter((r) => fromProfile.has(r.key)).map((r) => r.key);
    if (overtaken.length > 0) {
      const left = [...fromProfile].filter((k) => !overtaken.includes(k));
      if (left.length > 0) env.CORTEX_INTERACTIVE_PROFILE_APPLIED = left.join(',');
      else delete env.CORTEX_INTERACTIVE_PROFILE_APPLIED;
    }
    env[APPLIED_ENV] = JSON.stringify([...prior.values(), ...fresh]);
  }
  return { hash, applied: [...prior.values(), ...fresh] };
}
