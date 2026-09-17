/**
 * Named prompt presets (P6c/P6e/P6f program, 2026-08-18).
 *
 * 'boot-minimal' is the measured winner of the prompt-composition sweeps on
 * BOTH DeepSeek family members (P6c flash 56/56, P6e pro 42/42: −68% input,
 * −37..85% output, equal accuracy vs the full corpus): a ~400-byte system
 * prompt whose one orientation pointer nudges the model to PULL workspace
 * context via its own first tool call (boot-observation — context arrives as
 * observation-mass, not instruction-mass).
 *
 * PORTABILITY NOTE: the benched artifact pointed at a repo-specific orient
 * script. This packaged text is the portable variant: it prefers a
 * project-provided `.cortex/orient` script and falls back to generic
 * orientation. Projects wanting the full measured effect ship their own
 * `.cortex/orient` (see docs/prompts/orient.sh for the reference shape).
 *
 * Resolution order (SystemMessageMiddleware): env CORTEX_PROMPT_MASS /
 * CORTEX_SYSTEM_PROMPT_FILE always win (experiment levers); otherwise a model
 * card's `promptPreset` applies; otherwise full corpus (default unchanged).
 */

export type PromptPreset = 'boot-minimal';

export const BOOT_MINIMAL_PROMPT =
  'You are Cortex, a coding agent working in this workspace through the provided tools. ' +
  'Complete the user\'s task by reading and running real code — never answer from memory ' +
  'when a command can verify. Prefer acting over deliberating. For workspace tasks, orient ' +
  'first: if a `.cortex/orient` script exists, run it via Bash (`sh .cortex/orient`) — its ' +
  'output maps the workspace; otherwise orient with `ls` and the project README as the task ' +
  'warrants. If you did not finish the task, say so plainly — never claim work you have not ' +
  'done. When the task is complete, reply with the final answer only.';

/**
 * Item 9b (HARNESS_IMPROVEMENT_BACKLOG): when a REAL orient script path is
 * resolved (project .cortex/orient, else the shipped scaffold's copy via
 * CORTEX_ROOT), the clause points at it definitely instead of the conditional
 * relative probe — TB2 fleet evidence: 101/251 sessions obeyed the clause
 * verbatim against a nonexistent relative path (~40% single-clause obedience),
 * while the scaffold sat unreached one directory over. The oriented variant
 * also names the capability index the script prints (skills guides), closing
 * the zero-discovery gap (0 Skill/SearchTools calls in ~11K bench tool calls).
 */
export function buildBootMinimalPrompt(orientPath?: string, env: NodeJS.ProcessEnv = process.env): string {
  const hint = resolveDelegationHint(env) ? DELEGATION_HINT_CLAUSE : '';
  if (!orientPath) return applyTurnContract(BOOT_MINIMAL_PROMPT + hint, env);
  return applyTurnContract(
    'You are Cortex, a coding agent working in this workspace through the provided tools. ' +
    'Complete the user\'s task by reading and running real code — never answer from memory ' +
    'when a command can verify. Prefer acting over deliberating. For workspace tasks, orient ' +
    `first: run \`sh ${orientPath}\` via Bash — its output maps the workspace and indexes ` +
    'your skill guides; consult a guide when the task matches its domain. If you did not ' +
    'finish the task, say so plainly — never claim work you have not done. When the task is ' +
    'complete, reply with the final answer only.' + hint,
    env,
  );
}

/**
 * HB-TURN-CONTRACT (2026-09-17, Terminus-2 disparity #3 — suppress vs channel). The boot-minimal door SUPPRESSES
 * deliberation ("Prefer acting over deliberating") and was tuned at low effort; at high effort the model fought it
 * (R153: 58 turns/63 sessions reasoned to the 65536 cap and emitted nothing). Terminus 2 CHANNELS deliberation instead:
 * think as long as you like, then every response must carry analysis + plan + the action. CORTEX_TURN_CONTRACT=channel
 * swaps the suppression clause for that output contract; '' (default) = the shipped door, byte-identical.
 */
export type TurnContract = 'channel' | '';
export function resolveTurnContract(env: NodeJS.ProcessEnv = process.env): TurnContract {
  const v = String(env.CORTEX_TURN_CONTRACT ?? '').trim().toLowerCase();
  return v === 'channel' ? 'channel' : '';
}
export const SUPPRESS_CLAUSE = 'Prefer acting over deliberating. ';
export const TURN_CONTRACT_CLAUSE =
  ' Think as long as you need before you answer. Then every response must contain, in this order: ANALYSIS — what the ' +
  'latest outputs show, what is done and what is still open; PLAN — the next concrete steps and what each should ' +
  'prove; then the tool call(s) that carry out the first step. Keep each step small enough that its output fits ' +
  'comfortably, and verify against the task\'s own criteria, not your own tests.';
export function applyTurnContract(prompt: string, env: NodeJS.ProcessEnv = process.env): string {
  if (resolveTurnContract(env) !== 'channel') return prompt;
  return prompt.replace(SUPPRESS_CLAUSE, '') + TURN_CONTRACT_CLAUSE;
}

/**
 * HB-DELEGATION-DOCTRINE (4.108.1, DARK by default): CORTEX_DELEGATION_HINT=true appends one clause to the boot-minimal
 * prompt naming the Task tool for large independent sub-tasks / output-heavy exploration. Fleet evidence: 0 Task
 * calls in every bench run to date — the tool is essential-tier but the narrow door never mentions it. Prompt mass
 * on the ~400-byte door is a measured lever, so this ships OFF until an A/B reads (population: long-horizon tasks).
 */
export function resolveDelegationHint(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = String(env.CORTEX_DELEGATION_HINT ?? '').trim().toLowerCase();
  return v === 'true' || v === '1' || v === 'on';
}
export const DELEGATION_HINT_CLAUSE =
  ' When a sub-task is large, independent, or would flood your context with output (broad exploration, a long build, ' +
  'a parallel branch), delegate it with the Task tool — give the sub-agent a self-contained prompt (it has no memory of ' +
  'this conversation) and continue from its summary; keep your own context for decisions.';

/** The static-corpus filter mode a preset implies for the mass partition. */
export function presetMassMode(preset: PromptPreset | undefined): 'minimal' | 'full' {
  return preset === 'boot-minimal' ? 'minimal' : 'full';
}

/** The replacement core system prompt a preset implies (undefined = keep). */
export function presetSystemPrompt(
  preset: PromptPreset | undefined,
  orientPath?: string
): string | undefined {
  return preset === 'boot-minimal' ? buildBootMinimalPrompt(orientPath) : undefined;
}
