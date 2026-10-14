/**
 * compactionTarget — R256 (4.124.77, 2026-10-14): HYSTERESIS for proactive compaction.
 *
 * Before: the kept set was sized to `budget.availableForHistory`, which sits ABOVE the trigger (the threshold is availableForHistory ×
 * 0.75 for percentage cards). So a compaction dropped only the 1–9 oldest messages, the next turn's tool output re-crossed the threshold,
 * and EVERY turn paid a helper summary call plus a full prompt-cache bust (the dropped prefix invalidates the cache). payments
 * (t4in, 2026-10-13): 57 proactive compactions in 60 minutes, 30 M uncached input tokens, $17.65 — half the cell's spend on one task.
 *
 * Now: the kept set is sized to CORTEX_COMPACTION_TARGET_PCT (default 0.5) of the THRESHOLD — one compaction buys ~half a threshold of
 * headroom (≈ 235 K tokens on the DeepSeek Flash card). The `CORTEX_COMPACTION_THRESHOLD_TOKENS` override path already used 0.5.
 */
export function resolveCompactionTargetPct(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(String(env.CORTEX_COMPACTION_TARGET_PCT ?? '').trim());
  if (!Number.isFinite(raw) || raw <= 0) return 0.5;
  return Math.min(1, Math.max(0.1, raw));
}

/** The history budget to compact down to: min(availableForHistory, floor(threshold × pct)), never below 100 tokens. Pure. */
export function resolveCompactionTargetTokens(threshold: number, availableForHistory: number, env: NodeJS.ProcessEnv = process.env): number {
  const t = Math.floor(Math.max(0, threshold) * resolveCompactionTargetPct(env));
  return Math.max(100, Math.min(Math.max(100, availableForHistory), t));
}
