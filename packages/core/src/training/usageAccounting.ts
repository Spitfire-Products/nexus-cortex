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
  /** Task sub-agents (child processes with their own orchestrator) — 2026-10-01. Their EXACT main-model usage is ALSO folded into the
   *  totals above (so every consumer that prices the totals — the bench adapter's metrics, usageCost — includes sub-agent spend); this
   *  bucket is the breakdown. Their helper calls stay estimates and are priced here (helperInputTokensEst / helperOutputTokensEst). */
  subagents: { calls: number; requests: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; uncachedInputTokens: number; reasoningTokens: number; helperInputTokensEst: number; helperOutputTokensEst: number };
}

export function emptySessionUsage(): SessionUsage {
  return { requests: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, uncachedInputTokens: 0, reasoningTokens: 0, helper: { calls: 0, inputTokensEst: 0, outputTokensEst: 0, bySurface: {} }, subagents: { calls: 0, requests: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, uncachedInputTokens: 0, reasoningTokens: 0, helperInputTokensEst: 0, helperOutputTokensEst: 0 } };
}

/** Fold one finished sub-agent's own session ledger into the parent's: its exact main usage into the totals AND the subagents breakdown,
 *  its helper estimates into the breakdown only. Missing / malformed child usage → the call is still counted (calls + 1). Pure. */
export function addSubagentUsage(acc: SessionUsage, child: Partial<SessionUsage> | undefined | null): SessionUsage {
  const sa = acc.subagents ?? emptySessionUsage().subagents;
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);
  const c = child ?? {};
  const req = n(c.requests), inp = n(c.inputTokens), out = n(c.outputTokens), cr = n(c.cacheReadTokens), cc = n(c.cacheCreationTokens), un = n(c.uncachedInputTokens), rt = n(c.reasoningTokens);
  const hi = n(c.helper?.inputTokensEst), ho = n(c.helper?.outputTokensEst);
  return {
    ...acc,
    requests: acc.requests + req,
    inputTokens: acc.inputTokens + inp, outputTokens: acc.outputTokens + out,
    cacheReadTokens: acc.cacheReadTokens + cr, cacheCreationTokens: acc.cacheCreationTokens + cc, uncachedInputTokens: acc.uncachedInputTokens + un,
    reasoningTokens: acc.reasoningTokens + rt,
    subagents: { calls: sa.calls + 1, requests: sa.requests + req, inputTokens: sa.inputTokens + inp, outputTokens: sa.outputTokens + out, cacheReadTokens: sa.cacheReadTokens + cr, uncachedInputTokens: sa.uncachedInputTokens + un, reasoningTokens: sa.reasoningTokens + rt, helperInputTokensEst: sa.helperInputTokensEst + hi, helperOutputTokensEst: sa.helperOutputTokensEst + ho },
  };
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
  const hIn = acc.helper.inputTokensEst + (acc.subagents?.helperInputTokensEst ?? 0); const hOut = acc.helper.outputTokensEst + (acc.subagents?.helperOutputTokensEst ?? 0);
  const helperEst = (hIn * (p.helperInputPerM ?? p.inputPerM) + hOut * (p.helperOutputPerM ?? p.outputPerM)) / 1e6;
  const denom = acc.cacheReadTokens + acc.uncachedInputTokens;
  return { main, helperEst, total: main + helperEst, cacheHitRate: denom > 0 ? acc.cacheReadTokens / denom : 0 };
}

/** R239 / P4 (2026-10-07): the sum of two whole-session ledgers — for the second-attempt chain, whose response carries usage.session
 *  SUMMED over every attempt. Every numeric counter is added (known and unknown top-level keys alike), `helper` is summed field-wise with
 *  `bySurface` merged by key, `subagents` is summed field-wise; any other non-numeric key keeps the LATER ledger's non-null value (the
 *  bench adapter's sa_merge kept the latest non-null, too). Deep-summing helper/subagents is a deliberate parity difference from the
 *  adapter, which summed top-level numbers only. Pure. */
export function sumSessionUsage(a: Partial<SessionUsage> | undefined | null, b: Partial<SessionUsage> | undefined | null): SessionUsage {
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const e = emptySessionUsage();
  const A = (a ?? {}) as Record<string, unknown>; const B = (b ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = { ...e };
  for (const k of new Set([...Object.keys(A), ...Object.keys(B)])) {
    if (k === 'helper' || k === 'subagents') continue;
    const va = A[k], vb = B[k];
    if (typeof va === 'number' || typeof vb === 'number') out[k] = n(va) + n(vb);
    else out[k] = vb ?? va ?? out[k];
  }
  const ha = (A.helper ?? {}) as Partial<SessionUsage['helper']>, hb = (B.helper ?? {}) as Partial<SessionUsage['helper']>;
  const bySurface: Record<string, number> = { ...(ha.bySurface ?? {}) };
  for (const [k, v] of Object.entries(hb.bySurface ?? {})) bySurface[k] = n(bySurface[k]) + n(v);
  out.helper = { calls: n(ha.calls) + n(hb.calls), inputTokensEst: n(ha.inputTokensEst) + n(hb.inputTokensEst), outputTokensEst: n(ha.outputTokensEst) + n(hb.outputTokensEst), bySurface };
  const sa = (A.subagents ?? {}) as Partial<SessionUsage['subagents']>, sb = (B.subagents ?? {}) as Partial<SessionUsage['subagents']>;
  const sub: Record<string, number> = {};
  for (const k of Object.keys(e.subagents)) sub[k] = n((sa as Record<string, unknown>)[k]) + n((sb as Record<string, unknown>)[k]);
  out.subagents = sub;
  return out as unknown as SessionUsage;
}
