/**
 * canonWatch — a long-running fs-watcher that fires `canonSync()` when any
 * declared harness session root changes. This is the reactive-capture path for
 * EXTERNAL harnesses (grok/gemini/other-machine sessions): their turn loop is not
 * this process, so the in-process turn hook (canonSyncScheduler.ts) never sees
 * them — a watcher on their on-disk `*.jsonl` roots does.
 *
 * The watch signal only needs to be coarse: `canonSync` already diffs every file
 * against its mtime/size manifest, so a change anywhere → one debounced sync that
 * copies exactly what actually changed (idempotent, catch-up by construction).
 *
 * Modeled on the codebase's proven `fs.watch` pattern (AgentStore.startWatching):
 * `fs.watch` + `AbortController` + async-iterator + debounce. Session files nest
 * one level (`{root}/{workspace}/{uuid}.jsonl`), and Linux `fs.watch` is not
 * reliably recursive, so we watch each root AND its subdirectories, adding a watch
 * for any subdir created while running.
 *
 * @module canon/canonWatch
 */
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { canonSync, loadHarnessSources, type CanonSyncOptions, type CanonSyncResult } from './canonSync.js';

export interface CanonWatchOptions extends CanonSyncOptions {
  /** Debounce window before a sync fires after the last change (default 60s). */
  debounceMs?: number;
  /** Abort to stop watching (a SIGINT handler wires this). */
  signal?: AbortSignal;
  /** Called after each auto-sync (CLI logging). */
  onSync?: (result: CanonSyncResult) => void;
  /** Called once per watched root at startup (CLI logging). */
  onWatch?: (root: string) => void;
}

const DEFAULT_DEBOUNCE_MS = 60_000;

/**
 * Watch every declared harness session root and auto-sync (debounced) on change.
 * Runs until `options.signal` aborts. An initial catch-up sync is scheduled at
 * startup so anything accumulated while the watcher was down is captured.
 */
export async function canonWatch(options: CanonWatchOptions = {}): Promise<void> {
  const HOME = options.home ?? process.env.HOME ?? '/home/runner/workspace';
  const STORE = options.store ?? '/tmp/canon-store';
  const debounceMs = options.debounceMs && options.debounceMs > 0 ? options.debounceMs : DEFAULT_DEBOUNCE_MS;

  // Derive the watch list + capture extensions from the SAME declarative source
  // canonSync uses, so `HARNESSES.json` overrides apply to the watcher too.
  const sources = loadHarnessSources(STORE, HOME);
  const exts = new Set<string>();
  const roots: string[] = [];
  for (const src of Object.values(sources)) {
    for (const e of src.exts) exts.add(e);
    for (const r of src.roots) roots.push(typeof r === 'string' ? r : r.path);
  }
  const isCaptureFile = (name: string) => [...exts].some((e) => name.endsWith(e));

  let timer: ReturnType<typeof setTimeout> | null = null;
  let syncing = false;
  let pendingWhileSyncing = false;

  const runSync = async (): Promise<void> => {
    if (syncing) { pendingWhileSyncing = true; return; }
    syncing = true;
    try {
      const result = await canonSync({ store: STORE, home: HOME, dryRun: options.dryRun, repoUrl: options.repoUrl });
      options.onSync?.(result);
    } catch (err) {
      console.warn(`[canon-watch] sync failed: ${(err as Error)?.message ?? String(err)}`);
    } finally {
      syncing = false;
      if (pendingWhileSyncing) { pendingWhileSyncing = false; schedule(); }
    }
  };

  const schedule = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; void runSync(); }, debounceMs);
  };

  const watched = new Set<string>();
  const watchDir = (dir: string): void => {
    if (watched.has(dir)) return;
    watched.add(dir);
    void (async () => {
      try {
        const watcher = fsp.watch(dir, { recursive: false, signal: options.signal });
        for await (const ev of watcher) {
          const name = ev.filename ?? '';
          if (isCaptureFile(name)) { schedule(); continue; }
          // A new/renamed entry that is a directory → watch it too (covers the
          // {root}/{workspace}/ nesting and dirs created while running).
          try {
            const st = await fsp.stat(path.join(dir, name));
            if (st.isDirectory()) watchDir(path.join(dir, name));
          } catch { /* entry vanished between the event and the stat */ }
        }
      } catch (err) {
        if ((err as { name?: string })?.name !== 'AbortError') {
          console.warn(`[canon-watch] watch error on ${dir}: ${(err as Error)?.message ?? String(err)}`);
        }
      }
    })();
  };

  for (const root of roots) {
    try {
      if (!(await fsp.stat(root)).isDirectory()) continue;
    } catch { continue; } // root doesn't exist here — harness not installed on this machine
    watchDir(root);
    options.onWatch?.(root);
    try {
      for (const entry of await fsp.readdir(root, { withFileTypes: true })) {
        if (entry.isDirectory()) watchDir(path.join(root, entry.name));
      }
    } catch { /* unreadable root — the root-level watch still catches new files */ }
  }

  if (watched.size === 0) {
    throw new Error('[canon-watch] no harness session roots found to watch on this machine');
  }

  schedule(); // initial catch-up: sync anything accumulated while the watcher was down

  // Run until aborted; clean up the pending timer on stop.
  await new Promise<void>((resolve) => {
    if (options.signal?.aborted) { if (timer) clearTimeout(timer); return resolve(); }
    options.signal?.addEventListener('abort', () => {
      if (timer) clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}
