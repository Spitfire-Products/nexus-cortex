/**
 * ResearchBacklog — the recursive auto-research task lifecycle.
 *
 * Every harness deficiency found during benchmarking is auto-added here as a
 * tracked, triaged task. The harness identifies its own weaknesses, prioritizes
 * them (severity × impact × confidence ÷ effort), and walks each through a
 * lifecycle: open → triaged → in_progress → fixed → verified → closed.
 *
 * OVERFITTING GUARD (first-class — see operator note "be wary of overfitting as
 * recursion progresses"): a deficiency is NOT `verified` just because the fix
 * passes the task that SURFACED it — that is only `fixed`. It becomes `verified`
 * only after the fix is confirmed on HELD-OUT tasks it was never tuned against.
 * The `fixed`→`verified` gap is the guard against the harness gaming its own eval.
 * (Pair with ModelRouterMatrix's `split:'holdout'` records — keep/discard uses
 * `train`, verification uses `holdout`.)
 *
 * Store: append-only JSONL at `.cortex/research-backlog.jsonl`. Concurrent-safe
 * for two agents sharing the tree — latest snapshot per `id` wins; never
 * rewritten in place.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

export type DeficiencyStatus =
  | 'open' // freshly found, not yet triaged
  | 'triaged' // scored + prioritized
  | 'in_progress' // being fixed in a worktree experiment
  | 'fixed' // fix passes the DISCOVERY task — NOT yet generalized
  | 'verified' // fix ALSO holds on HELD-OUT tasks — overfitting-cleared
  | 'closed' // merged + verified + done
  | 'wont_fix' // deliberately not fixing (documented model behavior, etc.)
  | 'regressed';  // a previously-verified fix broke again

export type Severity = 'low' | 'medium' | 'high' | 'critical';

export interface DeficiencyRecord {
  id: string;
  title: string;
  description: string;
  /** Adapter | Streaming | Caching | Loop control | Routing | Config | Model card | State | Infrastructure | TUI | Other */
  bugClass: string;
  status: DeficiencyStatus;
  // triage
  severity: Severity;
  impact: number;     // 1-5: how much it degrades the harness
  effort: number;     // 1-5: estimated fix cost (clamped >= 1)
  confidence: number; // 0-1: how sure it's a real deficiency (not model noise)
  priorityScore: number; // computed; higher = fix first
  // provenance / links
  discoveredRound?: string;
  discoveredRef?: string;            // harness commit at discovery
  affectedModels?: string[];
  affectedTaskFingerprints?: string[];
  experimentTag?: string;            // worktree experiment addressing it
  fixedRef?: string;                 // commit that fixed it
  verifiedRound?: string;            // bench round confirming on held-out
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

const SEVERITY_WEIGHT: Record<Severity, number> = { low: 1, medium: 2, high: 3, critical: 5 };

/**
 * Triage priority: severity-weighted value per unit effort, scaled by confidence.
 * `(severityWeight × impact × confidence) / effort`. Higher = fix first.
 * Confidence scaling is the overfitting/ noise guard at the triage layer —
 * low-confidence "deficiencies" (could be model noise) sink in priority.
 */
export function computePriority(severity: Severity, impact: number, effort: number, confidence: number): number {
  const sw = SEVERITY_WEIGHT[severity] ?? 1;
  const e = Math.max(1, effort);
  const c = Math.min(1, Math.max(0, confidence));
  return Math.round(((sw * impact * c) / e) * 100) / 100;
}

export interface NewDeficiency {
  title: string;
  description: string;
  bugClass?: string;
  severity?: Severity;
  impact?: number;
  effort?: number;
  confidence?: number;
  discoveredRound?: string;
  discoveredRef?: string;
  affectedModels?: string[];
  affectedTaskFingerprints?: string[];
  notes?: string;
}

const STORE_RELATIVE_PATH = path.join('.cortex', 'research-backlog.jsonl');

export class ResearchBacklog {
  private readonly storePath: string;

  constructor(projectRoot: string) {
    this.storePath = path.join(projectRoot, STORE_RELATIVE_PATH);
  }

  /** Stable id derived from the title, so re-finding the same deficiency updates
   *  rather than duplicating. */
  static idFor(title: string): string {
    return 'def-' + crypto.createHash('sha256').update(title.trim().toLowerCase(), 'utf8').digest('hex').slice(0, 10);
  }

  private append(rec: DeficiencyRecord): void {
    fs.mkdirSync(path.dirname(this.storePath), { recursive: true });
    fs.appendFileSync(this.storePath, JSON.stringify(rec) + '\n', 'utf8');
  }

  /** Current state = latest snapshot per id (append-only; last write wins). */
  list(opts: { status?: DeficiencyStatus | DeficiencyStatus[]; sortByPriority?: boolean } = {}): DeficiencyRecord[] {
    let raw = '';
    try { raw = fs.readFileSync(this.storePath, 'utf8'); } catch { return []; }
    const byId = new Map<string, DeficiencyRecord>();
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try { const r = JSON.parse(line) as DeficiencyRecord; byId.set(r.id, r); } catch { /* skip corrupt line */ }
    }
    let out = [...byId.values()];
    if (opts.status) {
      const want = Array.isArray(opts.status) ? opts.status : [opts.status];
      out = out.filter(r => want.includes(r.status));
    }
    if (opts.sortByPriority !== false) out.sort((a, b) => b.priorityScore - a.priorityScore);
    return out;
  }

  get(id: string): DeficiencyRecord | undefined {
    return this.list({ sortByPriority: false }).find(r => r.id === id);
  }

  /** Auto-add a found deficiency. Idempotent by title; triage runs automatically
   *  so `priorityScore` is set on add. */
  add(d: NewDeficiency): DeficiencyRecord {
    const id = ResearchBacklog.idFor(d.title);
    const existing = this.get(id);
    const now = new Date().toISOString();
    const severity = d.severity ?? existing?.severity ?? 'medium';
    const impact = d.impact ?? existing?.impact ?? 3;
    const effort = d.effort ?? existing?.effort ?? 3;
    const confidence = d.confidence ?? existing?.confidence ?? 0.6;
    const triaged = d.severity !== undefined || d.impact !== undefined || d.effort !== undefined;
    const rec: DeficiencyRecord = {
      id,
      title: d.title,
      description: d.description,
      bugClass: d.bugClass ?? existing?.bugClass ?? 'Other',
      // never downgrade an already-progressing item back to 'open' on re-find
      status: existing && existing.status !== 'open' ? existing.status : (triaged ? 'triaged' : 'open'),
      severity, impact, effort, confidence,
      priorityScore: computePriority(severity, impact, effort, confidence),
      discoveredRound: d.discoveredRound ?? existing?.discoveredRound,
      discoveredRef: d.discoveredRef ?? existing?.discoveredRef,
      affectedModels: d.affectedModels ?? existing?.affectedModels,
      affectedTaskFingerprints: d.affectedTaskFingerprints ?? existing?.affectedTaskFingerprints,
      experimentTag: existing?.experimentTag,
      fixedRef: existing?.fixedRef,
      verifiedRound: existing?.verifiedRound,
      notes: d.notes ?? existing?.notes,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.append(rec);
    return rec;
  }

  /** Patch fields + re-snapshot. Recomputes priority when triage fields change. */
  update(id: string, patch: Partial<DeficiencyRecord>): DeficiencyRecord | undefined {
    const cur = this.get(id);
    if (!cur) return undefined;
    const merged: DeficiencyRecord = { ...cur, ...patch, id, updatedAt: new Date().toISOString() };
    merged.priorityScore = computePriority(merged.severity, merged.impact, merged.effort, merged.confidence);
    this.append(merged);
    return merged;
  }

  triage(id: string, t: { severity?: Severity; impact?: number; effort?: number; confidence?: number }): DeficiencyRecord | undefined {
    return this.update(id, { ...t, status: 'triaged' });
  }

  /** Highest-priority actionable item (open/triaged) — what the recursion fixes next. */
  next(): DeficiencyRecord | undefined {
    return this.list({ status: ['open', 'triaged'], sortByPriority: true })[0];
  }

  markInProgress(id: string, experimentTag: string): DeficiencyRecord | undefined {
    return this.update(id, { status: 'in_progress', experimentTag });
  }

  /** Fix passes the DISCOVERY task — but NOT yet generalized. Do not close here. */
  markFixed(id: string, fixedRef: string): DeficiencyRecord | undefined {
    return this.update(id, { status: 'fixed', fixedRef });
  }

  /** OVERFITTING GUARD: only call after the fix holds on HELD-OUT tasks it was not tuned against. */
  markVerified(id: string, verifiedRound: string): DeficiencyRecord | undefined {
    return this.update(id, { status: 'verified', verifiedRound });
  }

  close(id: string): DeficiencyRecord | undefined { return this.update(id, { status: 'closed' }); }
  wontFix(id: string, reason: string): DeficiencyRecord | undefined { return this.update(id, { status: 'wont_fix', notes: reason }); }
  reopenRegressed(id: string): DeficiencyRecord | undefined { return this.update(id, { status: 'regressed' }); }
}
