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
import { createHash } from 'crypto';

export interface DecisionInput {
  sessionId: string;
  toolName: string;
  /** Raw tool input. Hashed (key-stable) for matching. */
  input: unknown;
  success: boolean;
  /** First ~200 chars of error message, if any. */
  errorSnippet?: string;
}

export interface Decision {
  ts: number;
  sessionId: string;
  toolName: string;
  inputHash: string;
  inputSummary: string;
  success: boolean;
  errorSnippet?: string;
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
    };
    await fs.mkdir(path.dirname(this.storePath), { recursive: true });
    // Rotate BEFORE appending so the main file always exists (with at least
    // the just-written record) when record() returns — no empty window.
    await this.rotateIfNeeded();
    await fs.appendFile(this.storePath, JSON.stringify(decision) + '\n', 'utf-8');
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
