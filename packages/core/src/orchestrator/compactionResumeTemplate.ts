/**
 * HB-COMPACTION-RESUME v2 (4.108.2, 2026-09-12) — the resume-memory PROTOCOL, ported from the operator's own
 * `resume-session` skill (the routine used in Claude Code sessions for months: checkpoint BEFORE compaction,
 * rebuild from the checkpoint AFTER). Three pieces:
 *   1. `RESUME_MEMORY_PROMPT` — what the helper model writes at the pressure rung / at compaction (the skill's §2 template).
 *   2. `buildRebuildInstructions` — the post-compaction wake protocol injected with the memory (the skill's §4).
 *   3. `resolveCheckpointBand` — the pressure rung: checkpoint at N% of the compaction threshold, refreshed per band.
 */

/** The skill's §2 template, addressed to the helper model. `{{CONVERSATION}}` is replaced with the history text. */
export const RESUME_MEMORY_PROMPT = `You are writing a RESUME MEMORY for an autonomous coding agent whose conversation context is about to be
compacted (older messages removed). The agent that continues will have ONLY this memory, the original task, and the
most recent few messages. Write it so that agent can continue with NO loss of useful work. Be concrete: real paths,
real commands, real values, verbatim error text. Never paraphrase a constraint. Target ~{{TARGET_TOKENS}} tokens.

Use EXACTLY these sections:

## 0. WORK ORDER — the task, VERBATIM
Quote the user's task/instructions word for word (every constraint, every literal). If the task evolved, quote each user message in order.

## 1. STATE — DONE (with evidence)
Bullet list of what is COMPLETE: files created/edited (absolute paths + what changed), commands run and their results,
tests/verifications that passed, sub-goals satisfied. Mark anything only partially done as PARTIAL with what remains.

## 2. STATE — OUTSTANDING, in order, with the exact next commands
Ordered list of what remains. For each: the concrete next action (a command line, a file to edit and how, a check to run).
The first item is what the agent should do immediately after reading this.

## 3. DECISIONS and REJECTED APPROACHES
Choices made and why; approaches tried that FAILED, with the error text, so they are not repeated.

## 4. ARTIFACTS and POINTERS
Every path that matters (source files, outputs, logs, temp dirs), key line numbers, environment facts (installed tools,
versions, ports, credentials locations — never the secret values), and any external state (services started, containers).

## 5. TRAPS
Gotchas discovered (environment quirks, flaky commands, wrong assumptions corrected). One line each.

## 6. CURRENT WORK — the last few actions
What was happening right before this memory was written (last tool calls and their results), so the agent can pick up mid-step.

CONVERSATION HISTORY:
{{CONVERSATION}}

Write the resume memory now (sections 0–6, nothing else):`;

/** The skill's §4 wake protocol, spoken to the resumed agent. */
export function buildRebuildInstructions(): string {
  return (
    'REBUILD PROTOCOL — do these in order before new work: ' +
    '(1) Re-read the WORK ORDER above; that is still the goal. ' +
    '(2) Trust the files on disk over this memory: verify the state of every artifact in §4 (ls / cat / git status / the check commands in §2) before acting on it. ' +
    '(3) Do NOT redo anything listed as DONE in §1; do NOT retry anything listed as REJECTED in §3. ' +
    '(4) Start with §2 item 1. ' +
    '(5) If something in this memory contradicts what you observe, the observation wins — note the discrepancy and continue.'
  );
}

/**
 * Pressure rung: the checkpoint band. `pct` = fraction of the compaction threshold at which the FIRST checkpoint is
 * written (default 0.75, env CORTEX_COMPACTION_CHECKPOINT_PCT); after that a refresh happens every `stepPct` of the
 * threshold (default 0.10). Returns the band index the current token count is in (0 = below the first rung), so the
 * caller checkpoints exactly once per band.
 */
export function resolveCheckpointBand(
  currentTokens: number,
  threshold: number,
  env: NodeJS.ProcessEnv = process.env,
): number {
  if (!(threshold > 0) || !(currentTokens > 0)) return 0;
  const pct = clampPct(env.CORTEX_COMPACTION_CHECKPOINT_PCT, 0.75);
  const step = clampPct(env.CORTEX_COMPACTION_CHECKPOINT_STEP, 0.10, 0.02, 0.5);
  const ratio = currentTokens / threshold;
  if (ratio < pct) return 0;
  return 1 + Math.floor((ratio - pct) / step + 1e-9); // epsilon: 0.85-0.75 is 0.0999… in binary
}

function clampPct(raw: string | undefined, dflt: number, lo = 0.3, hi = 0.99): number {
  const n = Number(String(raw ?? '').trim());
  if (!Number.isFinite(n) || n <= 0) return dflt;
  return Math.min(hi, Math.max(lo, n));
}

/** Fill the prompt template. */
export function renderResumeMemoryPrompt(conversationText: string, targetTokens: number): string {
  return RESUME_MEMORY_PROMPT.replace('{{TARGET_TOKENS}}', String(targetTokens)).replace('{{CONVERSATION}}', conversationText);
}
