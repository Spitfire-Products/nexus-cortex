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
export function buildBootMinimalPrompt(orientPath?: string): string {
  if (!orientPath) return BOOT_MINIMAL_PROMPT;
  return (
    'You are Cortex, a coding agent working in this workspace through the provided tools. ' +
    'Complete the user\'s task by reading and running real code — never answer from memory ' +
    'when a command can verify. Prefer acting over deliberating. For workspace tasks, orient ' +
    `first: run \`sh ${orientPath}\` via Bash — its output maps the workspace and indexes ` +
    'your skill guides; consult a guide when the task matches its domain. If you did not ' +
    'finish the task, say so plainly — never claim work you have not done. When the task is ' +
    'complete, reply with the final answer only.'
  );
}

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
