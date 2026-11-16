/**
 * `cortex canon sync|translate|pull|list|rechunk` — CLI faces of the graduated canon
 * pipeline (@nexus-cortex/core `canon/`). One implementation serves these
 * verbs and the cron wrapper scripts; handlers here only map options in and
 * results to exit codes / --json output.
 */
import { canonList, canonPull, canonSync, canonTranslate } from '@nexus-cortex/core';

export interface CanonPipelineOptions {
  store?: string;
  dryRun?: boolean;
  json?: boolean;
}

export async function canonSyncCmd(o: CanonPipelineOptions): Promise<void> {
  const result = await canonSync({ store: o.store, dryRun: o.dryRun });
  if (o.json) console.log(JSON.stringify(result, null, 2));
}

export async function canonTranslateCmd(o: CanonPipelineOptions): Promise<void> {
  const result = await canonTranslate({ store: o.store, dryRun: o.dryRun });
  if (o.json) console.log(JSON.stringify(result, null, 2));
  if (result.errors.length) process.exitCode = 1;
}

export async function canonListCmd(o: CanonPipelineOptions & { all?: boolean; project?: string }): Promise<void> {
  if (o.project) {
    // Project-scoped listing via the derived project↔session map (leg 4).
    const { deriveProjectSessionMap, discoverCanonSessions, sessionProject, defaultCanonStore } = await import('@nexus-cortex/core');
    const store = o.store ?? defaultCanonStore();
    const projects = deriveProjectSessionMap(store);
    if (!projects[o.project]) {
      console.error(`[canon-list] unknown project '${o.project}' — known: ${Object.keys(projects).sort().join(', ')}`);
      process.exitCode = 1;
      return;
    }
    const rows = discoverCanonSessions(store)
      .filter((s) => sessionProject(projects, s) === o.project)
      .filter((s) => o.all || s.bytes > 4096);
    for (const s of rows) {
      const kb = (s.bytes / 1024).toFixed(0).padStart(7);
      console.log(`${s.uuid}  ${kb}KB  ${s.harness.padEnd(12)}  ${s.title ?? ''}`);
    }
    console.log(`\n[canon-list] ${rows.length} session(s) in project '${o.project}'`);
    if (o.json) console.log(JSON.stringify(rows, null, 2));
    return;
  }
  const sessions = await canonList({ store: o.store, all: o.all });
  if (o.json) console.log(JSON.stringify(sessions, null, 2));
}

export async function canonGraphCmd(o: CanonPipelineOptions & { project?: string; mergeGraph?: string; touched?: boolean }): Promise<void> {
  const { canonGraph } = await import('@nexus-cortex/core');
  const result = await canonGraph({ store: o.store, project: o.project, mergeGraph: o.mergeGraph, touched: o.touched, dryRun: o.dryRun });
  if (o.json) console.log(JSON.stringify(result, null, 2));
}

export async function canonPullCmd(
  o: CanonPipelineOptions & { session: string; to?: string; force?: boolean; target?: string; stripSignatures?: boolean; native?: boolean; project?: string; harness?: string; rel?: string; segment?: number },
): Promise<void> {
  if (o.native) {
    const { canonPullNative } = await import('@nexus-cortex/core');
    const rn = await canonPullNative({ session: o.session, to: o.to, project: o.project, harness: o.harness, force: o.force, store: o.store, rel: o.rel, segment: o.segment });
    if (o.json) console.log(JSON.stringify(rn, null, 2));
    if (rn.code !== 0) process.exitCode = rn.code;
    return;
  }
  // Default destination = the sessions dir cortex RESUMES from (ContextResolver: workspace / project / GLOBAL ~/.cortex/sessions),
  // not <cwd>/.cortex/sessions. They differ for any folder with no package.json above it: ContextResolver falls back to 'global'
  // (2026-11-15: a pulled segment in such a folder → resumeSession "not found or has no messages").
  const to = o.to ?? (await import('@nexus-cortex/core')).resolveContext({ cwd: process.cwd() }).sessionsDir;
  const result = await canonPull({ session: o.session, to, force: o.force, store: o.store, target: o.target as any, stripSignatures: o.stripSignatures, harness: o.harness, rel: o.rel, segment: o.segment });
  if (o.json) console.log(JSON.stringify(result, null, 2));
  if (result.code !== 0) process.exitCode = result.code;
}

/** `cortex canon list --segments <uuid>` — one session's compaction windows (nexus-canon canonSegments). */
export async function canonSegmentsCmd(o: CanonPipelineOptions & { session: string; native?: boolean; harness?: string; rel?: string }): Promise<void> {
  const { canonSegments } = await import('@nexus-cortex/core');
  const r = await canonSegments({ session: o.session, native: o.native, harness: o.harness, rel: o.rel, json: o.json, store: o.store });
  if (r.code !== 0) process.exitCode = r.code;
}

/** `cortex canon rechunk <uuid>` — store an existing native session by compaction segment (nothing deleted). */
export async function canonRechunkCmd(o: CanonPipelineOptions & { session: string; harness?: string; rel?: string }): Promise<void> {
  const { canonRechunk } = await import('@nexus-cortex/core');
  const r = await canonRechunk({ session: o.session, dryRun: o.dryRun, harness: o.harness, rel: o.rel, store: o.store });
  if (r.code !== 0) process.exitCode = r.code;
}

export async function canonArtifactsCmd(o: CanonPipelineOptions): Promise<void> {
  const { canonArtifacts } = await import('@nexus-cortex/core');
  const result = await canonArtifacts({ store: o.store, dryRun: o.dryRun });
  if (o.json) console.log(JSON.stringify(result, null, 2));
}

export async function canonWatchCmd(o: CanonPipelineOptions & { debounceMs?: number }): Promise<void> {
  const { canonWatch } = await import('@nexus-cortex/core');
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  console.log('[canon-watch] watching harness session roots — auto-sync on change (Ctrl-C to stop)');
  await canonWatch({
    store: o.store,
    debounceMs: o.debounceMs,
    dryRun: o.dryRun,
    signal: controller.signal,
    onWatch: (root) => console.log(`[canon-watch] watching ${root}`),
    onSync: (r) => console.log(
      `[canon-watch] synced: +${r.copied} copied, ${r.unchanged} unchanged` +
      `${r.chunked ? `, ${r.chunked} chunked` : ''}${r.scrubbedHits ? `, ${r.scrubbedHits} scrubbed` : ''}` +
      `${r.pushed ? ', pushed' : ''}`,
    ),
  });
  console.log('[canon-watch] stopped');
}
