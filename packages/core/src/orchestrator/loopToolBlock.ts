/**
 * Loop tool-block decision (CORTEX_LOOP_TOOL_BLOCK — the hard loop intervention).
 *
 * When the LoopLadder detects a non-converging same-approach loop on a tool
 * (diversify/break rung), a soft <system-reminder> nudge is provably IGNORED
 * (bench specimen make-mips: got the diversify nudge, edited to the budget wall
 * anyway). This module decides a HARD, non-ignorable intervention instead:
 *
 *   For ONE turn, the looping tool's EXECUTOR is disabled — the model still has
 *   the tool in its list (so the prompt cache is NOT busted; the tools array is
 *   unchanged), but if it calls the tool it gets an append-only tool_result
 *   REDIRECT ERROR steering it to the complementary tools. Next turn the tool
 *   is restored.
 *
 * The redirect is keyed to the looping tool (never remove the only verify path):
 *   - a Bash-loop  → "Bash disabled this turn, use Read/Write/Edit"
 *   - an Edit-loop → "Edit disabled this turn, Read the ground truth + Bash to
 *      inspect first" (Bash stays — it's the verify channel)
 *   - anything else → "inspect the state and take a genuinely different step".
 *
 * After 2 blocks on the same tool without the loop clearing, ESCALATE to a
 * mentor consult instead of a 3rd block (the caller wires the direct-invoke).
 *
 * PURE + deterministic — all state (the per-tool block count) lives in the
 * orchestrator; this module only maps (tool, priorBlocks) → a decision.
 */

export type LoopBlockAction = 'block' | 'escalate' | 'none';

export interface LoopBlockDecision {
  action: LoopBlockAction;
  /** The tool whose executor is disabled for the turn (the looping tool). */
  tool: string;
  /** Tools to steer the model toward this turn. */
  redirectTools: string[];
  /** The tool_result error text the model gets if it calls the blocked tool. */
  message: string;
}

/** Max hard blocks on one tool before escalating to a mentor consult. */
export const LOOP_BLOCK_MAX = 2;

interface Redirect { tools: string[]; hint: string; }

// Keyed by canonical (PascalCase) tool name. The default covers any other
// looping tool (WebFetch, Grep, etc.) without a bespoke entry.
const REDIRECTS: Record<string, Redirect> = {
  Bash: {
    tools: ['Read', 'Write', 'Edit'],
    hint: 'Read the relevant files and your current output, then make ONE deliberate change with Write/Edit',
  },
  Edit: {
    // Edit-loop: keep Bash (the verify channel) — force a Read of ground truth first.
    tools: ['Read', 'Bash'],
    hint: 'Read the failing test and the full section you keep editing IN FULL first, then make ONE deliberate edit',
  },
};

const DEFAULT_REDIRECT: Redirect = {
  tools: ['Read', 'Bash'],
  hint: 'inspect the actual state and take a genuinely different step',
};

/**
 * Decide the intervention for a detected loop on `tool`, given how many times
 * this tool has ALREADY been hard-blocked this task (`priorBlocks`).
 */
export function decideLoopBlock(tool: string, priorBlocks: number): LoopBlockDecision {
  if (priorBlocks >= LOOP_BLOCK_MAX) {
    return { action: 'escalate', tool, redirectTools: [], message: '' };
  }
  const r = REDIRECTS[tool] ?? DEFAULT_REDIRECT;
  const nth = priorBlocks + 1;
  const message =
    `Loop intervention #${nth}: you keep repeating the same "${tool}" approach and it is NOT ` +
    `producing results — repeating the same action and expecting a different outcome will not work. ` +
    `To break the loop, "${tool}" is DISABLED for this turn. Do NOT retry "${tool}". Step back and use ` +
    `${r.tools.join(', ')} instead to ${r.hint}. "${tool}" is available again on your next turn.`;
  return { action: 'block', tool, redirectTools: r.tools, message };
}

/** Whether a ladder result should trigger the hard intervention (diversify or break). */
export function isLoopBlockTrigger(action: string | undefined): boolean {
  return action === 'diversify' || action === 'break';
}
