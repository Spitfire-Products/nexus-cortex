/**
 * R190 HB-CUMULATIVE-USAGE (2026-09-23) — the session's token ledger.
 *
 * Field: every /v1/messages response (and the bench adapter's metrics.json built from it) carried the usage of the LAST request only, so every
 * "$ tokens" in the cell ledgers since the CF era was a lower bound (the 09-04 audit found the same 5x under-count). This module accumulates
 * every main-model request's provider-reported usage (exact) and every helper/mentor call's size (ESTIMATED at ~4 chars/token — the helper
 * adapters return text, not usage) into one session object that rides on the response as `usage.session`. Pure; the orchestrator feeds it.
 */
import type { TokenUsageMetrics } from '../adapters/GatewayTranslationLayer.js';

export interface SessionUsage {
  /** main-model requests seen (initial, continuations, retries, gate re-asks) */
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  uncachedInputTokens: number;
  reasoningTokens: number;
  /** helper + mentor calls (compaction, planner, judge, ledger, author, consults) — ESTIMATED from characters */
  helper: { calls: number; inputTokensEst: number; outputTokensEst: number; bySurface: Record<string, number> };
}

export function emptySessionUsage(): SessionUsage {
  return { requests: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, uncachedInputTokens: 0, reasoningTokens: 0, helper: { calls: 0, inputTokensEst: 0, outputTokensEst: 0, bySurface: {} } };
}

/** Add one main-model request's provider usage. A usage with no tokens at all (synthesized streaming usage) is ignored. Pure. */
export function addMainUsage(acc: SessionUsage, usage: TokenUsageMetrics | undefined | null): SessionUsage {
  if (!usage) return acc;
  const inp = Number(usage.inputTokens ?? 0); const out = Number(usage.outputTokens ?? 0);
  if (!(inp > 0) && !(out > 0)) return acc;
  const c = usage.cache;
  const cr = Number(c?.cacheReadTokens ?? 0); const cc = Number(c?.cacheCreationTokens ?? 0);
  const un = typeof c?.uncachedInputTokens === 'number' ? c.uncachedInputTokens : Math.max(0, inp - cr);
  return {
    ...acc,
    requests: acc.requests + 1,
    inputTokens: acc.inputTokens + inp, outputTokens: acc.outputTokens + out,
    cacheReadTokens: acc.cacheReadTokens + cr, cacheCreationTokens: acc.cacheCreationTokens + cc, uncachedInputTokens: acc.uncachedInputTokens + un,
    reasoningTokens: acc.reasoningTokens + Number((usage as { reasoningTokens?: number }).reasoningTokens ?? 0),
  };
}

/** Add one helper/mentor call by size (characters in, characters out). Pure. */
export function addHelperEstimate(acc: SessionUsage, promptChars: number, outputChars: number, surface = 'helper'): SessionUsage {
  const i = Math.ceil(Math.max(0, promptChars) / 4); const o = Math.ceil(Math.max(0, outputChars) / 4);
  return { ...acc, helper: { calls: acc.helper.calls + 1, inputTokensEst: acc.helper.inputTokensEst + i, outputTokensEst: acc.helper.outputTokensEst + o, bySurface: { ...acc.helper.bySurface, [surface]: (acc.helper.bySurface[surface] ?? 0) + i + o } } };
}

export interface UsagePrices { inputPerM: number; cacheHitPerM: number; outputPerM: number; helperInputPerM?: number; helperOutputPerM?: number }
/** Cost of the session at the given per-million prices; helper calls priced at the helper rates when given, else the main rates. Pure. */
export function usageCost(acc: SessionUsage, p: UsagePrices): { main: number; helperEst: number; total: number; cacheHitRate: number } {
  const main = (acc.uncachedInputTokens * p.inputPerM + acc.cacheReadTokens * p.cacheHitPerM + acc.outputTokens * p.outputPerM) / 1e6;
  const helperEst = (acc.helper.inputTokensEst * (p.helperInputPerM ?? p.inputPerM) + acc.helper.outputTokensEst * (p.helperOutputPerM ?? p.outputPerM)) / 1e6;
  const denom = acc.cacheReadTokens + acc.uncachedInputTokens;
  return { main, helperEst, total: main + helperEst, cacheHitRate: denom > 0 ? acc.cacheReadTokens / denom : 0 };
}
