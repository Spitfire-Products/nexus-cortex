/**
 * outerToolTimeout — D-A (verified 2026-09-04, CortexOrchestrator.ts:2487-2491 + streaming twin).
 *
 * The orchestrator wraps every tool batch in an OUTER AbortController as a last-resort cap for a HUNG
 * tool. It fired at a STATIC `TOOL_TIMEOUT_MS + grace` (~150s), ignoring the model's REQUESTED Bash
 * timeout. ShellTool honors requested timeouts up to MAX_TIMEOUT_MS (600000ms) and, in headless mode,
 * PROMOTES a still-running command to the background at its own deadline — but the outer abort at 150s
 * killed it first. So a legitimate `Bash({ command: "sleep 200; ...", timeout: 250000 })` was cancelled
 * at 150s regardless (fix-ocaml-gc, mcmc-sampling-stan, compile-compcert — 62 occurrences, both models).
 *
 * The outer deadline must sit ABOVE the largest requested Bash timeout in the batch (clamped to
 * ShellTool's own ceiling), plus the grace — so ShellTool's deadline/promote governs, and the outer
 * timer is only ever the true last-resort for a hung tool.
 */
const SHELL_MAX_TIMEOUT_MS = 600_000; // mirrors ShellTool.MAX_TIMEOUT_MS (requested timeouts are clamped there)

export type ToolUseBlockLike = { name?: string; input?: unknown };

/**
 * CORTEX_OUTER_TOOL_TIMEOUT_MS (2026-09-13): a FLOOR (ms) for the outer batch deadline. Non-Bash tools
 * without a limit of their own (CreateArtifactTool persistent launches, ctr-optimization) and Task
 * sub-agents mid-turn were still killed at the static ~150s (5 TB4.0 kills). With the floor set the
 * deadline becomes max(computed, floor + grace). Unset / 0 / junk = no floor (behaviour unchanged).
 */
export function resolveOuterToolTimeoutFloorMs(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(String(env.CORTEX_OUTER_TOOL_TIMEOUT_MS ?? '').trim() || 0);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/**
 * R133 HB-SUBAGENT-TIMEOUT (2026-09-13): a Task batch was aborted at this same ~150s, BELOW the sub-agent's
 * own timeout (300s hardcoded then; now derived from the parent's remaining turn budget). The optional
 * `blockTimeoutMs` lookup lets the caller contribute a per-block resolved timeout (Task → resolveSubAgentTimeoutMs)
 * so the batch abort is >= the sub-agent timeout + grace. Not clamped to the shell ceiling — a sub-agent
 * legitimately runs for hours under a long turn deadline.
 *
 * `floorMs` (CORTEX_OUTER_TOOL_TIMEOUT_MS, resolved by the caller once per turn) lifts the deadline to at
 * least floor + grace; 0 / undefined / non-finite = no floor.
 */
export function resolveOuterToolDeadlineMs(
  toolUseBlocks: ReadonlyArray<ToolUseBlockLike>,
  toolTimeoutMs: number,
  graceMs: number,
  blockTimeoutMs?: (block: ToolUseBlockLike, index: number) => number | undefined,
  floorMs?: number,
): number {
  let maxRequested = 0;
  let maxResolved = 0;
  for (let i = 0; i < toolUseBlocks.length; i++) {
    const b = toolUseBlocks[i];
    if (!b) continue;
    if (blockTimeoutMs) {
      const r = Number(blockTimeoutMs(b, i));
      if (Number.isFinite(r) && r > maxResolved) maxResolved = r;
    }
    if (b?.name !== 'Bash') continue; // only Bash carries a requested `timeout`
    const t = Number((b.input as { timeout?: unknown } | undefined)?.timeout);
    if (Number.isFinite(t) && t > maxRequested) maxRequested = t;
  }
  const honored = Math.max(Math.min(maxRequested, SHELL_MAX_TIMEOUT_MS), maxResolved);
  const floor = Number.isFinite(floorMs) && (floorMs as number) > 0 ? (floorMs as number) : 0;
  return Math.max(toolTimeoutMs, honored, floor) + graceMs;
}
