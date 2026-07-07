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
  // work-swarm lease (claim/release with TTL) — lets N workers pull DIFFERENT
  // items from ONE pool without double-claiming. Only set by claim()/claimNext().
  claimedBy?: string;                // worker/arm/persona id holding the lease
  claimedAt?: string;                // ISO when claimed
  leaseExpiresAt?: string;           // ISO; a stale lease past this is reclaimable
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

  // ───────────────────────────────────────────────────────────────────────────
  // Work-swarm claim/release (lease with TTL)
  //
  // Lets N workers pull DIFFERENT items from ONE pool concurrently without
  // double-claiming (the §5.4 "claim/release, 15-min TTL" mechanic). An advisory
  // lock file makes the read-check-append sequence atomic on a single machine
  // (the local work-swarm case: N worker processes, one repo). Distributed
  // workers coordinate via the STDB `deficiency` mirror instead, not this JSONL.
  // ───────────────────────────────────────────────────────────────────────────

  static readonly DEFAULT_TTL_MS = 15 * 60 * 1000; // 15 minutes

  private get lockPath(): string { return this.storePath + '.lock'; }

  /** Run `fn` while holding an exclusive advisory lock. Spins briefly for the
   *  lock; steals a lock older than staleMs (holder presumed dead). */
  private withLock<T>(fn: () => T, opts: { timeoutMs?: number; staleMs?: number } = {}): T {
    const timeoutMs = opts.timeoutMs ?? 4000;
    const staleMs = opts.staleMs ?? 30_000;
    fs.mkdirSync(path.dirname(this.storePath), { recursive: true });
    const deadline = Date.now() + timeoutMs;
    let fd: number | undefined;
    for (;;) {
      try {
        fd = fs.openSync(this.lockPath, 'wx'); // exclusive create → fails if held
        break;
      } catch {
        // Steal a stale lock (prior holder crashed without releasing).
        try {
          const age = Date.now() - fs.statSync(this.lockPath).mtimeMs;
          if (age > staleMs) { try { fs.unlinkSync(this.lockPath); } catch { /* raced */ } continue; }
        } catch { /* lock vanished — retry acquire */ }
        if (Date.now() > deadline) {
          // Give up on the lock rather than hang; proceed unlocked (best-effort).
          break;
        }
        // brief busy-wait (sync context; keep it short)
        const until = Date.now() + 25;
        while (Date.now() < until) { /* spin */ }
      }
    }
    try {
      return fn();
    } finally {
      if (fd !== undefined) { try { fs.closeSync(fd); } catch { /* ignore */ } try { fs.unlinkSync(this.lockPath); } catch { /* ignore */ } }
    }
  }

  private isLeaseLive(r: DeficiencyRecord, nowMs: number): boolean {
    return !!r.leaseExpiresAt && Date.parse(r.leaseExpiresAt) > nowMs;
  }

  /** Claim ONE specific item for `owner`. Returns the claimed record, or
   *  undefined if it does not exist, is already resolved, or is held by another
   *  worker under a LIVE lease. Idempotent for the same owner (re-extends lease). */
  claim(id: string, owner: string, ttlMs: number = ResearchBacklog.DEFAULT_TTL_MS): DeficiencyRecord | undefined {
    return this.withLock(() => {
      const cur = this.get(id);
      if (!cur) return undefined;
      // Only open/triaged (or already-mine in_progress) are claimable.
      const claimableStatus = cur.status === 'open' || cur.status === 'triaged' || cur.status === 'in_progress';
      if (!claimableStatus) return undefined;
      const now = Date.now();
      if (cur.claimedBy && cur.claimedBy !== owner && this.isLeaseLive(cur, now)) return undefined; // held by another
      return this.writeClaim(cur, owner, now, ttlMs);
    });
  }

  /** Release-expired + claim the highest-priority UNCLAIMED workable item.
   *  The core work-swarm pull: each worker calls this to get its own task. */
  claimNext(owner: string, ttlMs: number = ResearchBacklog.DEFAULT_TTL_MS): DeficiencyRecord | undefined {
    return this.withLock(() => {
      this.releaseExpiredUnlocked();
      const now = Date.now();
      const candidate = this.list({ status: ['open', 'triaged'], sortByPriority: true })
        .find((r) => !r.claimedBy || r.claimedBy === owner || !this.isLeaseLive(r, now));
      if (!candidate) return undefined;
      return this.writeClaim(candidate, owner, now, ttlMs);
    });
  }

  /** Revert every in_progress item whose lease has EXPIRED back to triaged so
   *  another worker can pick it up. Returns the reclaimed records. Items marked
   *  in_progress WITHOUT a lease (legacy markInProgress) are left untouched. */
  releaseExpired(): DeficiencyRecord[] {
    return this.withLock(() => this.releaseExpiredUnlocked());
  }

  /** Explicitly release a claim you hold (work finished/abandoned) → back to triaged. */
  release(id: string, owner?: string): DeficiencyRecord | undefined {
    return this.withLock(() => {
      const cur = this.get(id);
      if (!cur || !cur.claimedBy) return cur;
      if (owner && cur.claimedBy !== owner) return undefined; // not yours
      return this.append2({ ...cur, status: 'triaged', claimedBy: undefined, claimedAt: undefined, leaseExpiresAt: undefined });
    });
  }

  // -- claim internals (assume lock held) -------------------------------------

  private writeClaim(cur: DeficiencyRecord, owner: string, nowMs: number, ttlMs: number): DeficiencyRecord {
    const nowIso = new Date(nowMs).toISOString();
    return this.append2({
      ...cur,
      status: 'in_progress',
      claimedBy: owner,
      claimedAt: nowIso,
      leaseExpiresAt: new Date(nowMs + ttlMs).toISOString(),
      experimentTag: cur.experimentTag ?? owner,
    });
  }

  private releaseExpiredUnlocked(): DeficiencyRecord[] {
    const now = Date.now();
    const released: DeficiencyRecord[] = [];
    for (const r of this.list({ status: ['in_progress'], sortByPriority: false })) {
      if (r.leaseExpiresAt && Date.parse(r.leaseExpiresAt) <= now) {
        released.push(this.append2({ ...r, status: 'triaged', claimedBy: undefined, claimedAt: undefined, leaseExpiresAt: undefined }));
      }
    }
    return released;
  }

  /** append with priority recompute + updatedAt bump (like update(), but takes a
   *  full record and is safe to call under the lock without a re-read). */
  private append2(rec: DeficiencyRecord): DeficiencyRecord {
    const merged: DeficiencyRecord = { ...rec, updatedAt: new Date().toISOString() };
    merged.priorityScore = computePriority(merged.severity, merged.impact, merged.effort, merged.confidence);
    this.append(merged);
    return merged;
  }
}
