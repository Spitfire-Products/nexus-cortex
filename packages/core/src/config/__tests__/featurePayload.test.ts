import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyFeaturePayload, featureAppliedKeys, featurePayloadHash } from '../featurePayload.js';
import { collectEffectiveConfig, collectEffectiveConfigMeta } from '../effectiveConfig.js';
// @ts-ignore — plain .mjs generator script (no type declarations)
import { buildFeaturePayload, readGroups } from '../../../../../scripts/sync-features.mjs';

const KEY = 'CORTEX_LIFT_PLAN';

function lever(env: NodeJS.ProcessEnv, key: string) {
  for (const g of collectEffectiveConfig(env)) {
    const l = g.levers.find((x) => x.key === key);
    if (l) return l;
  }
  return undefined;
}

const forcePayload = {
  features: {
    [KEY]: { defaultValue: false, rules: [{ id: 'fr-lift', force: true }] },
    CORTEX_ENDTURN_TIER: { defaultValue: 'essential', rules: [] },
  },
};

describe('R262 applyFeaturePayload', () => {
  it('no payload → env unchanged and hash null', () => {
    const env: NodeJS.ProcessEnv = { DEFAULT_MODEL_ID: 'x', [KEY]: undefined };
    const before = JSON.stringify(env);
    const r = applyFeaturePayload(env);
    expect(r).toEqual({ hash: null, applied: [] });
    expect(JSON.stringify(env)).toBe(before);
    expect(collectEffectiveConfigMeta(env).featuresHash).toBeNull();
  });

  it('CORTEX_FEATURES=off disables the layer even with a payload', () => {
    const env: NodeJS.ProcessEnv = { CORTEX_FEATURES: 'off', CORTEX_FEATURES_JSON: JSON.stringify(forcePayload) };
    expect(applyFeaturePayload(env)).toEqual({ hash: null, applied: [] });
    expect(env[KEY]).toBeUndefined();
    expect(env.CORTEX_FEATURES_HASH).toBeUndefined();
  });

  it('a force rule applies to an unset key, reports source force, and the effective config labels it feature', () => {
    const env: NodeJS.ProcessEnv = { CORTEX_FEATURES_JSON: JSON.stringify(forcePayload) };
    const r = applyFeaturePayload(env);
    expect(r.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(env.CORTEX_FEATURES_HASH).toBe(r.hash);
    expect(env[KEY]).toBe('true');
    expect(r.applied).toEqual([{ key: KEY, value: 'true', source: 'force', ruleId: 'fr-lift' }]);
    expect(featureAppliedKeys(env).get(KEY)?.source).toBe('force');
    const l = lever(env, KEY)!;
    expect(l.source).toBe('feature');
    expect(l.featureRule).toEqual({ ruleId: 'fr-lift' });
    expect(l.active).toBe(true);
    expect(collectEffectiveConfigMeta(env).featuresHash).toBe(r.hash);
    // idempotent: a second bootstrap in the same process adds nothing new
    const again = applyFeaturePayload(env);
    expect(again.applied).toHaveLength(1);
  });

  it('a payload file wins over the inline form', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'feat-'));
    const file = path.join(dir, 'arm.features.json');
    fs.writeFileSync(file, JSON.stringify({ features: { [KEY]: { defaultValue: false, rules: [{ id: 'from-file', force: 'file' }] } } }));
    const env: NodeJS.ProcessEnv = { CORTEX_FEATURES_FILE: file, CORTEX_FEATURES_JSON: JSON.stringify(forcePayload) };
    applyFeaturePayload(env);
    expect(env[KEY]).toBe('file');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('an env value wins over a rule', () => {
    const env: NodeJS.ProcessEnv = { [KEY]: 'false', CORTEX_FEATURES_JSON: JSON.stringify(forcePayload) };
    const r = applyFeaturePayload(env);
    expect(env[KEY]).toBe('false');
    expect(r.applied).toEqual([]);
    expect(lever(env, KEY)!.source).toBe('env');
  });

  it('a rule takes a key the interactive profile filled (feature rules > profile)', () => {
    const env: NodeJS.ProcessEnv = {
      [KEY]: 'false', CORTEX_INTERACTIVE_PROFILE_APPLIED: `${KEY},CORTEX_WALL_DROP`, CORTEX_WALL_DROP: 'on',
      CORTEX_FEATURES_JSON: JSON.stringify(forcePayload),
    };
    applyFeaturePayload(env);
    expect(env[KEY]).toBe('true');
    expect(env.CORTEX_INTERACTIVE_PROFILE_APPLIED).toBe('CORTEX_WALL_DROP');
    expect(lever(env, KEY)!.source).toBe('feature');
  });

  it('a defaultValue-only feature writes nothing', () => {
    const env: NodeJS.ProcessEnv = { CORTEX_FEATURES_JSON: JSON.stringify(forcePayload) };
    applyFeaturePayload(env);
    expect(env.CORTEX_ENDTURN_TIER).toBeUndefined();
    const onlyDefaults = { features: { CORTEX_ENDTURN_TIER: { defaultValue: 'standard', rules: [] } } };
    const env2: NodeJS.ProcessEnv = { CORTEX_FEATURES_JSON: JSON.stringify(onlyDefaults) };
    const r = applyFeaturePayload(env2);
    expect(r.applied).toEqual([]);
    expect(env2.CORTEX_ENDTURN_TIER).toBeUndefined();
    expect(env2.CORTEX_FEATURES_APPLIED).toBeUndefined();
  });

  it('a condition-gated rule fires only for matching attributes (CORTEX_FEATURE_ATTRS + auto attributes)', () => {
    const p = { features: { [KEY]: { defaultValue: false, rules: [{ id: 'arm-b', condition: { arm: 'b', tier: 'pro' }, force: true }] } } };
    const miss: NodeJS.ProcessEnv = { TB2_ARM: 'a', CORTEX_FEATURE_ATTRS: '{"tier":"pro"}', CORTEX_FEATURES_JSON: JSON.stringify(p) };
    applyFeaturePayload(miss);
    expect(miss[KEY]).toBeUndefined();
    const hit: NodeJS.ProcessEnv = { TB2_ARM: 'b', CORTEX_FEATURE_ATTRS: '{"tier":"pro"}', CORTEX_FEATURES_JSON: JSON.stringify(p) };
    applyFeaturePayload(hit);
    expect(hit[KEY]).toBe('true');
  });

  it('an experiment rule reports source experiment with experimentKey + variationId', () => {
    const p = { features: { CORTEX_ENDTURN_TIER: { defaultValue: 'essential', rules: [{ id: 'exp-1', key: 'tier-ab', variations: ['standard', 'essential'], weights: [1, 0], coverage: 1 }] } } };
    const env: NodeJS.ProcessEnv = { TB2_TASK: 'task-1', CORTEX_FEATURES_JSON: JSON.stringify(p) };
    const r = applyFeaturePayload(env);
    expect(env.CORTEX_ENDTURN_TIER).toBe('standard');
    expect(r.applied[0]).toMatchObject({ key: 'CORTEX_ENDTURN_TIER', source: 'experiment', ruleId: 'exp-1', experimentKey: 'tier-ab', variationId: 0 });
  });

  it('hash is stable across key order', () => {
    const a = { features: { A: { defaultValue: 1, rules: [{ id: 'r', force: 2 }] }, B: { defaultValue: 'x', rules: [] } } };
    const b = { features: { B: { rules: [], defaultValue: 'x' }, A: { rules: [{ force: 2, id: 'r' }], defaultValue: 1 } } };
    expect(featurePayloadHash(a)).toBe(featurePayloadHash(b));
    expect(featurePayloadHash(a)).not.toBe(featurePayloadHash({ features: { A: { defaultValue: 2, rules: [] } } }));
    const e1: NodeJS.ProcessEnv = { CORTEX_FEATURES_JSON: JSON.stringify(a) };
    const e2: NodeJS.ProcessEnv = { CORTEX_FEATURES_JSON: JSON.stringify(b) };
    expect(applyFeaturePayload(e1).hash).toBe(applyFeaturePayload(e2).hash);
  });
});

describe('R262 sync-features generator', () => {
  it('secrets never appear in the generated payload (fixture)', () => {
    const fixture = [
      { group: 'g', levers: [
        { key: 'CORTEX_X', what: 'x', codeDefault: 'true', kind: 'flag-true' },
        { key: 'CORTEX_Y', what: 'y', codeDefault: '45000', kind: 'value' },
        { key: 'CORTEX_Z', what: 'z', codeDefault: '(unset)', kind: 'value' },
        { key: 'GEMINI_API_KEY', what: 'k', codeDefault: '(unset)', kind: 'secret' },
        { key: 'SOME_TOKEN', what: 'named like a secret, mis-kinded', codeDefault: '', kind: 'value' },
        { key: 'CORTEX_FEATURES_FILE', what: 'self', codeDefault: '(unset)', kind: 'value' },
      ] },
    ];
    const p = buildFeaturePayload(fixture);
    expect(Object.keys(p.features)).toEqual(['CORTEX_X', 'CORTEX_Y', 'CORTEX_Z']);
    expect(p.features.CORTEX_X).toEqual({ defaultValue: true, rules: [], meta: { what: 'x', group: 'g', kind: 'flag-true' } });
    expect(p.features.CORTEX_Y.defaultValue).toBe(45000);
    expect(p.features.CORTEX_Z.defaultValue).toBe('(unset)');
    expect(JSON.stringify(p)).not.toMatch(/API_KEY|TOKEN/);
  });

  it('the real registry generates no secret-kinded lever', () => {
    const src = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'effectiveConfig.ts'), 'utf8');
    const groups = readGroups(src);
    const secrets = groups.flatMap((g: any) => g.levers).filter((l: any) => l.kind === 'secret').map((l: any) => l.key);
    expect(secrets.length).toBeGreaterThan(0);
    const p = buildFeaturePayload(groups);
    for (const k of secrets) expect(p.features[k]).toBeUndefined();
  });
});
