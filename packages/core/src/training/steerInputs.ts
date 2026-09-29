/**
 * Steering-model input sizing (CORTEX_STEER_INPUTS=full) and the canonical workspace inventory (CORTEX_INVENTORY=1). Both dark, 2026-09-29.
 *
 * Every steering prompt (lift planner, EndTurn judge, loop-exit planner, deadline-exit mentor, spec checks, requirement ledger, independent
 * derivation) sliced its inputs to fixed sizes with NO marker — the model could not tell it was judging or planning from a partial view.
 * Measured (r-steering-input-truncation-2026-09-29): the judge's workspace delta ("THE ARTIFACT … ground truth") cut in 56% of verdicts, the
 * lift plan cut for the judge / exit planner in >=62%, the planner saw 2000 chars of the TB4.0 orient output in 100% of sessions.
 *
 * `clipIn` is the one cut used at those sites. Default mode = the old `slice(0, cap)` byte for byte (the lever is dark). `full` raises the cap
 * to the FULL_CAPS value and, when something is still cut, ends the text with "[… N more chars of <what> not shown — <hint>]" so the model
 * knows it has a partial view and how to get the rest (operator: "make sure that the section caps dont truncate needed context, or they inform
 * the model to chase up the truncated sections").
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export type SteerInputsMode = 'default' | 'full';

export function resolveSteerInputs(env: NodeJS.ProcessEnv = process.env): SteerInputsMode {
  return (env.CORTEX_STEER_INPUTS ?? '').trim().toLowerCase() === 'full' ? 'full' : 'default';
}

/** Caps used in `full` mode — sized from the banked maxima (lift plans ≤ 8.6K, orient/inventory outputs a few K, TB4 task texts ≤ ~10K),
 *  never below the largest default cap (6000), so `full` never shows less than the default. */
export const FULL_CAPS = {
  task: 16000,
  plan: 16000,
  env: 16000,
  observations: 12000,
  delta: 16500,
  check: 8000,
  workProduct: 10000,
  attestation: 6000,
  prior: 6000,
  progress: 6000,
  evidence: 12000,
  deliverable: 8000,
  summary: 6000,
} as const;

export function clipIn(
  text: string | undefined,
  cap: number,
  fullCap: number,
  what: string,
  hint?: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const s = text ?? '';
  if (resolveSteerInputs(env) !== 'full') return s.slice(0, cap);
  if (s.length <= fullCap) return s;
  return `${s.slice(0, fullCap)}\n[… ${s.length - fullCap} more chars of ${what} not shown${hint ? ` — ${hint}` : ''}]`;
}

/** Delta collection cap: the default 6000 stays; `full` collects up to 16000 (the resolver's full cap leaves room for the delta's own
 *  "…[delta truncated]" marker, which the old 6000/6000 pairing sliced off). */
export function resolveDeltaMaxChars(defaultCap: number, env: NodeJS.ProcessEnv = process.env): number {
  return resolveSteerInputs(env) === 'full' ? 16000 : defaultCap;
}

export function resolveInventory(env: NodeJS.ProcessEnv = process.env): boolean {
  return /^(1|true|on)$/i.test((env.CORTEX_INVENTORY ?? '').trim());
}

/** Same lookup order as the orient scaffold: the project's own .cortex/inventory, else the installed package's copy ($CORTEX_ROOT). */
export function resolveInventoryPath(projectPath?: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const candidates = [join(projectPath || process.cwd(), '.cortex', 'inventory')];
  if (env.CORTEX_ROOT) candidates.push(join(env.CORTEX_ROOT, '.cortex', 'inventory'));
  return candidates.find((c) => existsSync(c));
}

/** Hints shown after a cut (full mode). Phrased as what the reader can do or rely on. */
export const HINTS = {
  task: 'the agent has the full task text',
  plan: 'the full plan was delivered to the agent at lift',
  env: 'the full report is from the task box',
  observations: 'the agent saw the full output',
  delta: 'every changed file is listed in the summary above; the files are in the workspace',
  check: 'the full check output is in the workspace run',
  workProduct: 'earlier output is in the transcript',
  attestation: 'the full attestation is in the transcript',
} as const;
