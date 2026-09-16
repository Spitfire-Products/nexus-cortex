/**
 * R156 HB-OOM-CHILD-PRIORITY (2026-09-16, tb4-flash-v3 mp-checkpoint-consolidation + tb21-a21l
 * extract-moves-from-video, both `Command failed (exit 137)`).
 *
 * When a model-launched process (a multi-GB tensor fit, a video decode) drives the container into
 * memory pressure, the kernel's OOM killer picks by oom_score — and the long-lived cortex-server
 * (node, large heap) is a prime candidate. Killing it ends the whole session: no response, no
 * metrics row, the trajectory frozen mid-thought. The fix is to make every Bash child a MORE
 * attractive victim than the orchestrator: the spawned shell raises its own oom_score_adj to the
 * maximum (1000) before running the command, and every descendant inherits it. Raising one's own
 * score never needs privileges; the write is best-effort (non-Linux / read-only /proc → no-op).
 *
 * The model then sees "Killed" in the tool result and can adapt (smaller batch, streaming), which is
 * strictly better than the session vanishing. Lever CORTEX_BASH_OOM_PRIORITY: default on; 'false'
 * disables (byte-identical command composition).
 */

export function resolveBashOomPriority(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = (env.CORTEX_BASH_OOM_PRIORITY ?? '').trim().toLowerCase();
  if (v === '') return true;
  return !(v === 'false' || v === '0' || v === 'off');
}

/**
 * Shell prelude to prepend to a `bash -c` command. Empty when disabled or not on Linux, so the
 * command string is unchanged in those cases.
 */
export function bashOomPriorityPrelude(env: NodeJS.ProcessEnv = process.env, platform: string = process.platform): string {
  if (platform !== 'linux') return '';
  if (!resolveBashOomPriority(env)) return '';
  // Braces + redirect keep a missing/readonly /proc silent; `;` keeps the caller's own `{ ... }` grouping intact.
  return '{ echo 1000 > /proc/self/oom_score_adj; } 2>/dev/null; ';
}
