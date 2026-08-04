/**
 * canonSyncScheduler — the NODE analog of the browser SPA's event-driven canon
 * capture (`recordSessionTurn` → `scheduleCanonSync`). The node orchestrator calls
 * `scheduleCanonSync()` at each turn-completion seam; a burst of turns collapses
 * into ONE debounced `canonSync()`.
 *
 * OPT-IN: a no-op unless `CANON_AUTO_SYNC` is set — reactive capture pushes to a
 * git remote, so it never fires without the user asking for it (same discipline
 * as the browser's default-off auto-push). Best-effort: errors are swallowed so a
 * capture failure can never affect the turn — the exact contract as the adjacent
 * `scoreAndRecordTurnPrediction` post-turn side effect in the orchestrator.
 *
 * There is no session-write event to subscribe to (JSONLHistoryStore emits
 * nothing), so this imperative debounced trigger IS the analog of the browser
 * hook. External harnesses (grok/gemini) whose turn loop this process never runs
 * are covered instead by `cortex canon watch` (see canonWatch.ts).
 *
 * @module canon/canonSyncScheduler
 */
import { canonSync, type CanonSyncOptions } from './canonSync.js';

export interface CanonAutoSyncConfig {
  /** Opt-in gate. False → scheduleCanonSync is a no-op. */
  enabled: boolean;
  /** Debounce window before a sync fires after the last trigger. */
  debounceMs: number;
  /** Options forwarded to canonSync (store / repoUrl). */
  options: CanonSyncOptions;
}

const TRUTHY = new Set(['1', 'true', 'on', 'yes', 'push']);
const DEFAULT_DEBOUNCE_MS = 60_000; // 60s — the node analog of the browser's 45s window

/** Resolve the auto-sync config from the environment (opt-in via CANON_AUTO_SYNC). */
export function canonAutoSyncConfig(env: NodeJS.ProcessEnv = process.env): CanonAutoSyncConfig {
  const enabled = TRUTHY.has((env.CANON_AUTO_SYNC ?? '').toLowerCase());
  const parsed = Number(env.CANON_AUTO_SYNC_DEBOUNCE_MS);
  const debounceMs = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_DEBOUNCE_MS;
  const options: CanonSyncOptions = {};
  if (env.CANON_STORE) options.store = env.CANON_STORE;
  if (env.CANON_REPO) options.repoUrl = env.CANON_REPO;
  return { enabled, debounceMs, options };
}

let _timer: ReturnType<typeof setTimeout> | null = null;
let _pending = false;
let _syncing = false;
let _cfg: CanonAutoSyncConfig | null = null;

// Test seam — override what the debounce fires (see canonSyncScheduler.test.ts).
let _runner: (o: CanonSyncOptions) => unknown | Promise<unknown> = (o) => canonSync(o);
export function __setCanonSyncRunner(fn: ((o: CanonSyncOptions) => unknown | Promise<unknown>) | null): void {
  _runner = fn ?? ((o) => canonSync(o));
}

async function runAutoSync(options: CanonSyncOptions): Promise<void> {
  if (_syncing) { _pending = true; return; } // coalesce a trigger arriving during an in-flight sync
  _syncing = true;
  try {
    await _runner(options);
  } catch {
    /* best-effort — a capture failure must never affect the turn */
  } finally {
    _syncing = false;
    if (_pending) { _pending = false; void runAutoSync(options); } // a write landed mid-sync → one more pass
  }
}

/**
 * HOOK — call on each session write / turn completion. Debounced: a burst of
 * turns collapses into one `canonSync`. No-op unless `CANON_AUTO_SYNC` is set.
 * The timer is `unref`'d so a pending sync never keeps the process alive by itself.
 * `overrides` merge over the env config (tests force `{ enabled, debounceMs }`).
 */
export function scheduleCanonSync(overrides: Partial<CanonAutoSyncConfig> = {}): void {
  const cfg = { ...canonAutoSyncConfig(), ...overrides };
  if (!cfg.enabled) return;
  _cfg = cfg;
  _pending = true;
  if (_timer) clearTimeout(_timer);
  _timer = setTimeout(() => { _timer = null; _pending = false; void runAutoSync(cfg.options); }, cfg.debounceMs);
  (_timer as { unref?: () => void }).unref?.();
}

/**
 * Flush a pending sync NOW and await it (process shutdown / explicit flush).
 * No-op when nothing was scheduled — so opting out (never calling
 * `scheduleCanonSync`) can never trigger a capture.
 */
export async function flushCanonSync(): Promise<void> {
  if (!_pending || !_cfg) return;
  if (_timer) { clearTimeout(_timer); _timer = null; }
  _pending = false;
  await runAutoSync(_cfg.options);
}
