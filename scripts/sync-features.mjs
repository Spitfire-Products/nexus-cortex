#!/usr/bin/env node
/**
 * Generate `config/features.json` — the GrowthBook-format feature payload — from the
 * REPORTED levers in `packages/core/src/config/effectiveConfig.ts` (its GROUPS registry).
 * R262 FEATURE PAYLOAD LAYER, P0 (design: .cortex/research/feature-flags-parity-design-2026-10-15.md §4.1).
 *
 * `config/features.json` is GENERATED (like `.env.defaults`) — never hand-edit it. One feature per
 * reported lever: `defaultValue` = the lever's codeDefault (boolean for flag kinds, number when the
 * default parses as a finite number, else string), `rules: []`, `meta: {what, group, kind}`.
 * Rules are authored per environment in a SEPARATE payload (bench arm file / STDB), never here.
 *
 * 🔴 SECRET SAFETY: levers of kind 'secret' — and any secret-NAMED key, as a superset guard —
 * are EXCLUDED; secrets never enter a payload. The layer's own control levers (CORTEX_FEATURES*)
 * are excluded too (a payload cannot re-point or disable itself).
 *
 * Run:
 *   node scripts/sync-features.mjs          # regenerate config/features.json
 *   node scripts/sync-features.mjs --check   # exit 1 on drift
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(ROOT, 'packages/core/src/config/effectiveConfig.ts');
const OUT = join(ROOT, 'config/features.json');

// Same superset name guard as sync-env-defaults.mjs.
// NOTE (4.124.83): the canonical generator logic is packages/core/src/config/featuresGen.ts; this dev script keeps an identical copy
// (it runs before core is built) and the parity test in featurePayload.test.ts holds the two together through config/features.json.
export const SECRET_RE = /(_API_KEY|_TOKEN|_SECRET|_ACCOUNT_ID|OAUTH)$/;
// The payload layer's own levers never ride in a payload.
const SELF_RE = /^CORTEX_FEATURES?(_|$)/;

/** Extract the GROUPS array literal from effectiveConfig.ts (pure literals — evaluated, not parsed by hand). */
export function readGroups(sourceText) {
  const m = sourceText.match(/const GROUPS[^=]*=\s*(\[[\s\S]*?\n\]);/);
  if (!m) throw new Error('[sync-features] could not find `const GROUPS = [...]` in effectiveConfig.ts');
  const groups = new Function(`return ${m[1]};`)();
  if (!Array.isArray(groups)) throw new Error('[sync-features] GROUPS is not an array');
  return groups;
}

/** Typed defaultValue from a lever spec. */
export function defaultValueFor(spec) {
  const d = String(spec.codeDefault ?? '').trim();
  const first = d.split(/[\s(]/)[0].toLowerCase();
  if (spec.kind === 'flag-true') return first === 'true';
  if (spec.kind === 'flag-not-false') return first !== 'false';
  if (d !== '' && Number.isFinite(Number(d))) return Number(d);
  return String(spec.codeDefault ?? '');
}

/** The core: GROUPS → GrowthBook payload {features: {KEY: {defaultValue, rules, meta}}}. Keys sorted for stable output. */
export function buildFeaturePayload(groups) {
  const entries = [];
  for (const { group, levers } of groups) {
    for (const spec of levers) {
      if (spec.kind === 'secret' || SECRET_RE.test(spec.key) || SELF_RE.test(spec.key)) continue;
      entries.push([spec.key, { defaultValue: defaultValueFor(spec), rules: [], meta: { what: spec.what, group, kind: spec.kind ?? 'value' } }]);
    }
  }
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return { features: Object.fromEntries(entries) };
}

export function renderPayload(payload) {
  return JSON.stringify(payload, null, 2) + '\n';
}

function main() {
  const check = process.argv.includes('--check');
  const expected = renderPayload(buildFeaturePayload(readGroups(readFileSync(SOURCE, 'utf8'))));
  const current = existsSync(OUT) ? readFileSync(OUT, 'utf8') : null;
  const n = Object.keys(JSON.parse(expected).features).length;
  if (check) {
    if (current !== expected) {
      console.error('[sync-features] DRIFT: config/features.json is stale vs effectiveConfig.ts GROUPS. Fix: npm run sync:features');
      process.exit(1);
    }
    console.log(`[sync-features] OK — config/features.json matches (${n} features).`);
    return;
  }
  if (current !== expected) {
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, expected);
    console.log(`[sync-features] regenerated config/features.json (${n} features)`);
  } else {
    console.log(`[sync-features] config/features.json current (${n} features)`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
