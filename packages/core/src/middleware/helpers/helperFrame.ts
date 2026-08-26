/**
 * Shared helper-model frame layer (HARNESS_IMPROVEMENT_BACKLOG item 11a).
 *
 * Before this module every helper surface hand-rolled its own frame: roles
 * were inconsistent ("helpful assistant" vs "AI mentor" vs none), the five
 * dialect adapters drifted independently, no surface carried an output
 * budget or a grounding rule, and new surfaces (item 10's doctrine curation)
 * would have become the eleventh ad-hoc frame. This module is the ONE
 * composition every helper call builds its frame from — implemented above
 * the adapters so all dialects inherit it.
 *
 * The frame is deliberately small: helpers are cheap one-shot side contexts;
 * the frame's job is consistency and discipline, not doctrine mass.
 */

export interface HelperFrameSpec {
  /** Surface id for provenance/telemetry (e.g. 'compaction', 'error-guidance'). */
  surface: string;
  /** One-line persona ("You are …"). */
  persona: string;
  /** One-to-three-line task statement. */
  task: string;
  /** Optional single workspace-context line (project name / path). */
  workspaceLine?: string;
  /** Hard output budget in tokens — always stated to the model. */
  outputBudgetTokens: number;
  /** Include the grounding rule (default true). */
  grounding?: boolean;
}

/** The uniform grounding rule every helper surface carries unless opted out. */
export const HELPER_GROUNDING_RULE =
  'Ground every statement in the provided material — preserve names, paths, commands, and ' +
  'error text verbatim; never invent content that is not present; if the material does not ' +
  'support a claim, omit the claim.';

/**
 * Build the system line for a helper call. Kept to a few sentences so it
 * costs ~50-80 tokens on a side context.
 */
export function buildHelperSystem(spec: HelperFrameSpec): string {
  const parts = [
    `${spec.persona} [surface: ${spec.surface}]`,
    spec.task,
  ];
  if (spec.workspaceLine) parts.push(`Workspace: ${spec.workspaceLine}`);
  if (spec.grounding !== false) parts.push(HELPER_GROUNDING_RULE);
  parts.push(`Hard output limit: ~${spec.outputBudgetTokens} tokens.`);
  return parts.join(' ');
}

/**
 * Frame a user-prompt body for surfaces that cannot carry a system message
 * (single-user-message one-shots): the same composition, prefixed to the body.
 */
export function frameHelperPrompt(spec: HelperFrameSpec, body: string): string {
  return `${buildHelperSystem(spec)}\n\n${body}`;
}
