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

export function resolveOuterToolDeadlineMs(
  toolUseBlocks: ReadonlyArray<{ name?: string; input?: unknown }>,
  toolTimeoutMs: number,
  graceMs: number,
): number {
  let maxRequested = 0;
  for (const b of toolUseBlocks) {
    if (b?.name !== 'Bash') continue; // only Bash carries a requested `timeout`
    const t = Number((b.input as { timeout?: unknown } | undefined)?.timeout);
    if (Number.isFinite(t) && t > maxRequested) maxRequested = t;
  }
  const honored = Math.min(maxRequested, SHELL_MAX_TIMEOUT_MS);
  return Math.max(toolTimeoutMs, honored) + graceMs;
}
