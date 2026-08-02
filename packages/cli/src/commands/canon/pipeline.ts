/**
 * `cortex canon sync|translate|pull|list` — CLI faces of the graduated canon
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
    const { deriveProjectSessionMap, discoverCanonSessions, sessionProject } = await import('@nexus-cortex/core');
    const store = o.store ?? '/tmp/canon-store';
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
  o: CanonPipelineOptions & { session: string; to?: string; force?: boolean },
): Promise<void> {
  const result = await canonPull({ session: o.session, to: o.to, force: o.force, store: o.store });
  if (o.json) console.log(JSON.stringify(result, null, 2));
  if (result.code !== 0) process.exitCode = result.code;
}

export async function canonArtifactsCmd(o: CanonPipelineOptions): Promise<void> {
  const { canonArtifacts } = await import('@nexus-cortex/core');
  const result = await canonArtifacts({ store: o.store, dryRun: o.dryRun });
  if (o.json) console.log(JSON.stringify(result, null, 2));
}
