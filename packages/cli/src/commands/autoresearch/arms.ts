/**
 * `cortex autoresearch arms` — print the arm plan (which model each arm/attempt runs) as JSON.
 *
 * The same planner the multi-provider loop uses (`planArms`: explicit --arm-models, else --providers' flagship models, else every
 * provider with a configured key; the base --model leads; --missing-provider-key-policy decides unfunded arms). Exposed as a command so a
 * caller outside the Node CLI — the bench adapter's TB2_ATTEMPTS serial best-of-N — resolves per-attempt models from the harness's own
 * registry and key detection instead of re-implementing the pool. Pure: spawns nothing, reads only the model registry + env.
 */
import { planArms, parseMissingKeyPolicy } from './armPlan.js';

export interface AutoResearchArmsOptions {
  width?: string;
  model?: string;
  armModels?: string;
  providers?: string;
  strategy?: string;
  missingProviderKeyPolicy?: string;
  json?: boolean;
}

const list = (s?: string) => (s ? s.split(',').map((x) => x.trim()).filter(Boolean) : undefined);

export async function autoResearchArms(options: AutoResearchArmsOptions): Promise<void> {
  const plan = planArms({
    width: parseInt(options.width ?? '1', 10) || 1,
    baseModel: options.model ?? process.env.DEFAULT_MODEL_ID,
    armModels: list(options.armModels),
    providers: list(options.providers),
    strategy: options.strategy,
    policy: parseMissingKeyPolicy(options.missingProviderKeyPolicy),
  });
  if (options.json) {
    console.log(JSON.stringify(plan));
    return;
  }
  for (const a of plan.arms) {
    console.log(`arm ${a.arm}: ${a.model ?? '(default model)'}${a.funded ? '' : '  [no key in env]'}`);
  }
  for (const n of plan.notes) console.log(`note: ${n}`);
}
