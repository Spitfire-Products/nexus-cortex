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

/** The static-corpus filter mode a preset implies for the mass partition. */
export function presetMassMode(preset: PromptPreset | undefined): 'minimal' | 'full' {
  return preset === 'boot-minimal' ? 'minimal' : 'full';
}

/** The replacement core system prompt a preset implies (undefined = keep). */
export function presetSystemPrompt(preset: PromptPreset | undefined): string | undefined {
  return preset === 'boot-minimal' ? BOOT_MINIMAL_PROMPT : undefined;
}
