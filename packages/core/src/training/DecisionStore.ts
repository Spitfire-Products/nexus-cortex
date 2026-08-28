/**
 * DecisionStore — append-only JSONL log of tool-call decisions for the
 * lookup-before-action prior injection pattern (a lookup-before-action prior pipeline,
 * simplified
 * for the standalone nexus-cortex OSS harness which has no STDB dependency).
 *
 * Each line is a self-contained Decision record:
 *   { ts, sessionId, toolName, inputHash, inputSummary, success, errorSnippet? }
 *
 * Lookup is O(N) over the file because the file is expected to stay small
 * (one line per tool call). When this becomes a problem, swap the backend
 * for a real index — the surface here (record/lookup/stats) is stable.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { classifyErrorFamily } from './errorFamily.js';
import { createHash } from 'crypto';

export interface DecisionInput {
  sessionId: string;
  toolName: string;
  /** Raw tool input. Hashed (key-stable) for matching. */
  input: unknown;
  success: boolean;
  /** First ~200 chars of error message, if any. */
  errorSnippet?: string;
  /** Normalized command-SHAPE fingerprint (toolOutcome.approachHash): version
   *  pins / flags / digits / paths collapse, so varied retries of one approach
   *  land in one bucket. The cross-turn key for the ×98 varied-retry lens
   *  (BUILD 1a). Optional — rows written before this stay approach-invisible. */
  approachHash?: string;
}

export interface Decision {
  ts: number;
  sessionId: string;
  toolName: string;
  inputHash: string;
  inputSummary: string;
  success: boolean;
  errorSnippet?: string;
  /** Normalized command-shape fingerprint (BUILD 1a) — the varied-retry lens
   *  key. Absent on event rows and on rows written before 1a. */
  approachHash?: string;
  /** Active tool-surface arm (CORTEX_TOOL_PROFILE) — stamped when not 'full',
   *  so the tool-profile A/B can slice selection/success per arm. */
  toolProfile?: string;
  /** Present ONLY on event rows (recordEvent) — steering/guard observability
   *  records riding the same JSONL. Rows with `kind` set are EXCLUDED from
   *  every prior-lookup path (lookup/recent/familyFailures/stats) so events
   *  can never pollute priors. TB2 finding: injected steering (budget/
   *  diversity/ladder signals) mutates tool_results AFTER session persist, so
   *  the durable session lacks what the model saw — these records are the
   *  distiller's only view of it. */
  kind?: SteeringEventKind;
  /** Free-shape event payload (small — truncated summaries only). */
  detail?: Record<string, unknown>;
}

/** Observability event kinds (docs/HARNESS_IMPROVEMENT_BACKLOG.md item 3). */
export type SteeringEventKind =
  | 'steering_injected'
  | 'loop_escalation'
  | 'endturn_gate_fallback'
  | 'inaction_nudge'
  // Item 10: doctrine-curation provenance (helper-curated CORTEX.md refresh
  // at session-start/lift boundaries; timeout = fail-open to previous doc).
  | 'doctrine_curation'
  | 'doctrine_curation_timeout'
  // Item 12 layer 4: EndTurn Stage-5 integrity flags (web transplant /
  // solution-seeking query) — pre-labeled rows for the distiller lens.
  | 'integrity_flag'
  // Item 13b: execute-your-plan nudge on honest-premature-surrender finishes.
  | 'surrender_nudge'
  // AskForAdvice (MENTORSHIP_ASK_FOR_ADVICE_SPEC §10): a mentor consult episode — the
  // reward-labeled thrash→ask→hint→follow trajectory that trains the apprentice's
  // self-refer + hint-follow behavior. detail carries {rung, trigger, hint (truncated),
  // helperModel}; the junior's subsequent tool rows join by sessionId + ts.
  | 'mentor_consult';

export interface SteeringEventInput {
  sessionId: string;
  kind: SteeringEventKind;
  /** Tool the event concerns, when there is one (ladder escalations). */
  toolName?: string;
  detail?: Record<string, unknown>;
}

export interface DecisionStats {
  total: number;
  successes: number;
  failures: number;
  /** Most recent failure's error snippet, when available. */
  lastError?: string;
}

const MAX_INPUT_SUMMARY = 300;
const MAX_ERROR_SNIPPET = 200;

/**
 * Stable, order-independent hash of a tool input value. Keys are sorted at
 * every nesting level so `{a:1,b:2}` and `{b:2,a:1}` collide, but `[1,2,3]`
 * and `[3,2,1]` do not (array order is semantically meaningful).
 */
export function stableInputHash(value: unknown): string {
  const canonical = canonicalJSON(value);
  return createHash('sha256').update(canonical).digest('hex').slice(0, 32);
}

function canonicalJSON(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalJSON).join(',') + ']';
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const parts = keys.map(
    (k) => JSON.stringify(k) + ':' + canonicalJSON((value as Record<string, unknown>)[k]),
  );
  return '{' + parts.join(',') + '}';
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max) + '…';
}

/** Default size cap before the store rotates (2 MB). Bounds both disk and
 *  the per-lookup full-file scan. One rotated generation (`.1`) is kept so
 *  priors survive the rotation boundary; total ≤ ~2×cap. */
export const DEFAULT_MAX_STORE_BYTES = 2 * 1024 * 1024;

/** Resolve the rotation cap from `CORTEX_DECISIONS_MAX_BYTES`. Must be a
 *  positive integer byte count; anything else (unset, zero, negative,
 *  non-numeric, float) falls back to {@link DEFAULT_MAX_STORE_BYTES}. */
export function resolveMaxStoreBytes(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env.CORTEX_DECISIONS_MAX_BYTES?.trim();
  if (!raw || !/^\d+$/.test(raw)) return DEFAULT_MAX_STORE_BYTES;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_MAX_STORE_BYTES;
}

export class DecisionStore {
  constructor(
    private readonly storePath: string,
    private readonly maxBytes: number = resolveMaxStoreBytes(),
  ) {}

  /** Rotate main → `.1` (replacing any prior `.1`) once it exceeds the cap.
   *  Single generation: bounds disk to ~2×cap and lookup cost to O(cap),
   *  not O(history). Best-effort — a rotation failure must not break
   *  recording. */
  private async rotateIfNeeded(): Promise<void> {
    try {
      const { size } = await fs.stat(this.storePath);
      if (size <= this.maxBytes) return;
      await fs.rename(this.storePath, this.storePath + '.1'); // replaces .1
    } catch {
      /* stat ENOENT or rename race — non-fatal */
    }
  }

  /** Append a decision. Idempotent at the filesystem level (mkdir -p). */
  async record(input: DecisionInput): Promise<void> {
    const decision: Decision = {
      ts: Date.now(),
      sessionId: input.sessionId,
      toolName: input.toolName,
      inputHash: stableInputHash(input.input),
      inputSummary: truncate(canonicalJSON(input.input), MAX_INPUT_SUMMARY),
      success: input.success,
      ...(input.errorSnippet
        ? { errorSnippet: truncate(input.errorSnippet, MAX_ERROR_SNIPPET) }
        : {}),
      ...(input.approachHash ? { approachHash: input.approachHash } : {}),
      // Tool-profile arm provenance (env-stamped; omitted for the default so
      // existing rows stay comparable as implicit 'full').
      ...(process.env.CORTEX_TOOL_PROFILE && process.env.CORTEX_TOOL_PROFILE !== 'full'
        ? { toolProfile: process.env.CORTEX_TOOL_PROFILE }
        : {}),
    };
    await fs.mkdir(path.dirname(this.storePath), { recursive: true });
    // Rotate BEFORE appending so the main file always exists (with at least
    // the just-written record) when record() returns — no empty window.
    await this.rotateIfNeeded();
    await fs.appendFile(this.storePath, JSON.stringify(decision) + '\n', 'utf-8');
  }

  /** Append a steering/guard observability EVENT row. Event rows carry `kind`
   *  and are invisible to every prior-lookup path — they exist for the
   *  distiller/harvest side (the steering the model saw but the session
   *  record does not show). Best-effort by design at call sites. */
  async recordEvent(input: SteeringEventInput): Promise<void> {
    const row: Decision = {
      ts: Date.now(),
      sessionId: input.sessionId,
      toolName: input.toolName ?? '',
      inputHash: '',
      inputSummary: '',
      success: true,
      kind: input.kind,
      ...(input.detail ? { detail: input.detail } : {}),
    };
    await fs.mkdir(path.dirname(this.storePath), { recursive: true });
    await this.rotateIfNeeded();
    await fs.appendFile(this.storePath, JSON.stringify(row) + '\n', 'utf-8');
  }

  /** All event rows, oldest→newest (optionally one kind). Harvest-side read. */
  async readEvents(kind?: SteeringEventKind): Promise<Decision[]> {
    const readMaybe = async (p: string): Promise<string> => {
      try { return await fs.readFile(p, 'utf-8'); }
      catch (err: any) { if (err.code === 'ENOENT') return ''; throw err; }
    };
    const rotated = await readMaybe(this.storePath + '.1');
    const main = await readMaybe(this.storePath);
    const out: Decision[] = [];
    for (const line of (rotated + main).split('\n')) {
      if (!line.trim()) continue;
      try {
        const d = JSON.parse(line) as Decision;
        if (d.kind && (!kind || d.kind === kind)) out.push(d);
      } catch { /* torn line — skip */ }
    }
    return out;
  }

  /**
   * Read all decisions matching the given (toolName, inputHash). Lines that
   * fail to parse are skipped — the store is resilient to partial writes
   * from crashes.
   */
  async lookup(toolName: string, inputHash: string): Promise<Decision[]> {
    // Read rotated `.1` (older) THEN main (newer) so combined order stays
    // oldest→newest, which `recent()` relies on. Bounded to ≤ ~2×cap.
    const readMaybe = async (p: string): Promise<string> => {
      try {
        return await fs.readFile(p, 'utf-8');
      } catch (err: any) {
        if (err.code === 'ENOENT') return '';
        throw err;
      }
    };
    const rotated = await readMaybe(this.storePath + '.1');
    const main = await readMaybe(this.storePath);
    const raw = rotated + (rotated && !rotated.endsWith('\n') ? '\n' : '') + main;
    if (!raw) return [];
    const out: Decision[] = [];
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      let parsed: Decision;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }
      if (parsed.kind) continue; // event rows never feed priors
      if (parsed.toolName === toolName && parsed.inputHash === inputHash) {
        out.push(parsed);
      }
    }
    return out;
  }

  /**
   * Return the most recent matching decisions in reverse chronological
   * order, capped at `limit`. Used by the prior-injector to surface
   * specific recent outcomes rather than just aggregate counts.
   */
  async recent(toolName: string, inputHash: string, limit: number): Promise<Decision[]> {
    if (limit <= 0) return [];
    const all = await this.lookup(toolName, inputHash);
    // `lookup` returns in file order (oldest first). Reverse and slice.
    return all.slice().reverse().slice(0, limit);
  }


  /**
   * Failures for (toolName, error FAMILY) across ALL inputs — the
   * repeated-approach lens (see errorFamily.ts). `distinctInputs` lets the
   * caller require the family to span >=2 different inputs before hinting
   * (identical retries are the exact-input reminder's job).
   */
  async familyFailures(
    toolName: string,
    family: string,
    recentLimit = 3,
  ): Promise<{ count: number; distinctInputs: number; recent: Decision[] }> {
    if (!family) return { count: 0, distinctInputs: 0, recent: [] };
    const all = await this.readAllForTool(toolName);
    const matches = all.filter(
      (d) => !d.success && classifyErrorFamily(d.errorSnippet ?? '') === family,
    );
    const distinct = new Set(matches.map((d) => d.inputHash));
    return {
      count: matches.length,
      distinctInputs: distinct.size,
      recent: matches.slice(-recentLimit).reverse(),
    };
  }

  /**
   * Failures for (toolName, command-SHAPE approachHash) across ALL inputs —
   * the varied-retry lens (BUILD 1a; the ×98 class). Unlike familyFailures
   * (which groups by ERROR family) this groups by the normalized COMMAND
   * shape, so it catches "retry the same approach with tweaked args" even when
   * each attempt fails with a DIFFERENT error (or none the family lens knows).
   * `distinctInputs` (distinct exact inputHash among the failures) lets the
   * caller require >=2 so identical retries stay the exact-input reminder's
   * job and the two lenses never stack for one cause. Rows lacking an
   * approachHash (pre-1a, or event rows) never match.
   */
  async approachFailures(
    toolName: string,
    approachHash: string,
    recentLimit = 3,
  ): Promise<{ count: number; distinctInputs: number; recent: Decision[] }> {
    if (!approachHash) return { count: 0, distinctInputs: 0, recent: [] };
    const all = await this.readAllForTool(toolName);
    const matches = all.filter(
      (d) => !d.success && d.approachHash === approachHash,
    );
    const distinct = new Set(matches.map((d) => d.inputHash));
    return {
      count: matches.length,
      distinctInputs: distinct.size,
      recent: matches.slice(-recentLimit).reverse(),
    };
  }

  /**
   * The most recent FAILED tool decisions across ALL tools, newest first, capped
   * at `limit` — the mentor's context for AskForAdvice (the recent failed trace).
   * Event rows (kind set) are excluded. Reads both generations (rotated + main).
   */
  async recentFailures(limit = 6): Promise<Decision[]> {
    if (limit <= 0) return [];
    const readMaybe = async (p: string): Promise<string> => {
      try { return await fs.readFile(p, 'utf-8'); }
      catch (err: any) { if (err.code === 'ENOENT') return ''; throw err; }
    };
    const rotated = await readMaybe(this.storePath + '.1');
    const main = await readMaybe(this.storePath);
    const out: Decision[] = [];
    for (const line of (rotated + main).split('\n')) {
      if (!line.trim()) continue;
      try {
        const d = JSON.parse(line) as Decision;
        if (!d.kind && !d.success) out.push(d); // failures only, non-event
      } catch { /* torn line — skip */ }
    }
    return out.slice(-limit).reverse();
  }

  /** All decisions for a tool, oldest->newest (rotated gen first). */
  private async readAllForTool(toolName: string): Promise<Decision[]> {
    const readMaybe = async (p: string): Promise<string> => {
      try { return await fs.readFile(p, 'utf-8'); }
      catch (err: any) { if (err.code === 'ENOENT') return ''; throw err; }
    };
    const rotated = await readMaybe(this.storePath + '.1');
    const main = await readMaybe(this.storePath);
    const out: Decision[] = [];
    for (const line of (rotated + main).split('\n')) {
      if (!line.trim()) continue;
      try {
        const d = JSON.parse(line) as Decision;
        if (!d.kind && d.toolName === toolName) out.push(d);
      } catch { /* torn line — skip */ }
    }
    return out;
  }

  async stats(toolName: string, inputHash: string): Promise<DecisionStats> {
    const hits = await this.lookup(toolName, inputHash);
    let lastError: string | undefined;
    let successes = 0;
    let failures = 0;
    for (const h of hits) {
      if (h.success) successes++;
      else {
        failures++;
        if (h.errorSnippet) lastError = h.errorSnippet;
      }
    }
    return {
      total: hits.length,
      successes,
      failures,
      ...(lastError ? { lastError } : {}),
    };
  }
}
