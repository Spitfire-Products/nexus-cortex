/**
 * `cortex features show` — R262 FEATURE PAYLOAD LAYER (P0).
 *
 * Prints the payload hash and every effective lever whose value came from a feature payload rule
 * (source `feature`), with the rule id / experiment key / variation that filled it. The layer itself runs
 * in bootstrapEnv (bin/cortex.js), so this reads the already-resolved process env — no evaluation here.
 */
import { collectEffectiveConfig, collectEffectiveConfigMeta } from '@nexus-cortex/core';

export interface FeaturesShowOptions {
  json?: boolean;
}

export async function featuresShow(opts: FeaturesShowOptions = {}): Promise<void> {
  const { featuresHash } = collectEffectiveConfigMeta();
  const levers = collectEffectiveConfig()
    .flatMap((g) => g.levers.map((l) => ({ group: g.group, ...l })))
    .filter((l) => l.source === 'feature');
  const source = process.env.CORTEX_FEATURES_FILE?.trim() || (process.env.CORTEX_FEATURES_JSON?.trim() ? 'CORTEX_FEATURES_JSON (inline)' : null);
  const disabled = (process.env.CORTEX_FEATURES ?? '').trim().toLowerCase() === 'off';

  if (opts.json) {
    console.log(JSON.stringify({ featuresHash, payload: source, disabled, levers: levers.map(({ key, effective, featureRule, group }) => ({ key, effective, group, ...featureRule })) }, null, 2));
    return;
  }

  console.log(`Feature payload: ${disabled ? 'DISABLED (CORTEX_FEATURES=off)' : source ?? '(none — set CORTEX_FEATURES_FILE or CORTEX_FEATURES_JSON)'}`);
  console.log(`Hash:            ${featuresHash ?? '(none)'}`);
  if (levers.length === 0) {
    console.log('\nNo lever is set by a feature rule.');
    return;
  }
  console.log(`\n${levers.length} lever(s) set by a feature rule:\n`);
  const kw = Math.max(...levers.map((l) => l.key.length), 3);
  const vw = Math.min(Math.max(...levers.map((l) => l.effective.length), 5), 40);
  console.log(`  ${'KEY'.padEnd(kw)}  ${'VALUE'.padEnd(vw)}  RULE`);
  for (const l of levers) {
    const r = l.featureRule ?? {};
    const rule = [r.ruleId ? `rule=${r.ruleId}` : '', r.experimentKey ? `experiment=${r.experimentKey}` : '', typeof r.variationId === 'number' ? `variation=${r.variationId}` : '']
      .filter(Boolean).join(' ') || '(force, no id)';
    const v = l.effective.length > 40 ? l.effective.slice(0, 37) + '...' : l.effective;
    console.log(`  ${l.key.padEnd(kw)}  ${v.padEnd(vw)}  ${rule}`);
  }
}
