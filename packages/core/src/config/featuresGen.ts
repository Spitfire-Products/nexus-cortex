/**
 * R262 — the feature-payload GENERATOR logic (pure): effectiveConfig GROUPS → GrowthBook payload {features: {KEY: {defaultValue, rules,
 * meta}}}. The canonical copy lives HERE (library); `scripts/sync-features.mjs` carries the same rules for the dev-time regeneration and
 * `config/features.json` is the artifact both must agree on (the parity test in featurePayload.test.ts holds them together).
 * 4.124.82's test imported the repo-root script by a relative path that does not exist in the published tree → CI failed; hence this module.
 */
export const SECRET_RE = /(_API_KEY|_TOKEN|_SECRET|_ACCOUNT_ID|OAUTH)$/;
/** The payload layer's own levers never ride in a payload. */
export const SELF_RE = /^CORTEX_FEATURES?(_|$)/;

export interface LeverSpecLike { key: string; what?: string; codeDefault?: string; kind?: string }
export interface GroupLike { group: string; levers: LeverSpecLike[] }
export interface FeatureDef { defaultValue: unknown; rules: unknown[]; meta: { what?: string; group: string; kind: string } }
export interface FeaturesPayload { features: Record<string, FeatureDef> }

/** Extract the GROUPS array literal from effectiveConfig.ts source text (pure literals — evaluated, not parsed by hand). */
export function readGroups(sourceText: string): GroupLike[] {
  const m = sourceText.match(/const GROUPS[^=]*=\s*(\[[\s\S]*?\n\]);/);
  if (!m) throw new Error('[featuresGen] could not find `const GROUPS = [...]` in effectiveConfig.ts');
  const groups = new Function(`return ${m[1]};`)();
  if (!Array.isArray(groups)) throw new Error('[featuresGen] GROUPS is not an array');
  return groups as GroupLike[];
}

/** Typed defaultValue from a lever spec: flags → boolean (first word of codeDefault), numeric defaults → number, else string. */
export function defaultValueFor(spec: LeverSpecLike): unknown {
  const d = String(spec.codeDefault ?? '').trim();
  const first = d.split(/[\s(]/)[0]!.toLowerCase();
  if (spec.kind === 'flag-true') return first === 'true';
  if (spec.kind === 'flag-not-false') return first !== 'false';
  if (d !== '' && Number.isFinite(Number(d))) return Number(d);
  return String(spec.codeDefault ?? '');
}

/** GROUPS → payload. Secrets (kind or name) and the layer's own levers are excluded; keys sorted for stable output. */
export function buildFeaturePayload(groups: GroupLike[]): FeaturesPayload {
  const entries: Array<[string, FeatureDef]> = [];
  for (const { group, levers } of groups) {
    for (const spec of levers) {
      if (spec.kind === 'secret' || SECRET_RE.test(spec.key) || SELF_RE.test(spec.key)) continue;
      entries.push([spec.key, { defaultValue: defaultValueFor(spec), rules: [], meta: { what: spec.what, group, kind: spec.kind ?? 'value' } }]);
    }
  }
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return { features: Object.fromEntries(entries) };
}

export function renderPayload(payload: FeaturesPayload): string {
  return JSON.stringify(payload, null, 2) + '\n';
}
