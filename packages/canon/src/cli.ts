/**
 * nexus-canon CLI — minimal, dependency-free verb dispatcher.
 * (The full themed experience lives in the nexus-cortex harness as
 * `cortex canon <verb>`; this bin serves harness-less installs.)
 */
import { canonArtifacts } from './canonArtifacts.js';
import { canonGraph } from './canonGraph.js';
import { canonInit } from './canonInit.js';
import { canonList, canonPull } from './canonPull.js';
import { canonSync } from './canonSync.js';
import { canonTranslate } from './canonTranslate.js';

const USAGE = `nexus-canon — portable agent memory in a git repo you own

Usage: nexus-canon <verb> [options]

Verbs:
  init [dir] [--remote <url>]         scaffold a canon store repository
  sync [--dry-run] [--store <dir>]    native harness sessions -> store (scrubbed)
  translate [--dry-run] [--store <dir>]  native -> canonical line + projections
  list [--all] [--project N/A] [--store <dir>]  list canon sessions
  pull <uuid> [--to <dir>] [--force] [--store <dir>]  materialize a session
  artifacts [--dry-run] [--store <dir>]  capture capability artifacts
  graph [--project <id>] [--merge-graph <path>] [--dry-run] [--store <dir>]

Default store: /tmp/canon-store (override with --store or CANON_REPO env for the remote).
Spec: docs/CANON.md in the nexus-cortex repository.`;

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const [verb, ...rest] = argv;
  const flag = (k: string) => rest.includes(k);
  const opt = (k: string) => (rest.includes(k) ? rest[rest.indexOf(k) + 1] : undefined);
  const positional = rest.find((a) => !a.startsWith('--') && a !== opt('--to') && a !== opt('--store') && a !== opt('--remote') && a !== opt('--merge-graph') && a !== opt('--project'));

  switch (verb) {
    case 'init': {
      const r = await canonInit({ dir: positional, remote: opt('--remote') });
      console.log(`Canon store ${r.repoInitialized ? 'initialized' : 'updated'} at ${r.root}`);
      for (const c of r.created) console.log(`  + ${c}`);
      for (const s of r.skipped) console.log(`  = ${s} (exists, untouched)`);
      return 0;
    }
    case 'sync':
      await canonSync({ dryRun: flag('--dry-run'), store: opt('--store') });
      return 0;
    case 'translate': {
      const r = await canonTranslate({ dryRun: flag('--dry-run'), store: opt('--store') });
      return r.errors.length ? 1 : 0;
    }
    case 'list':
      await canonList({ store: opt('--store'), all: flag('--all') });
      return 0;
    case 'pull': {
      if (!positional) { console.error('usage: nexus-canon pull <sessionUuid> [--to <dir>] [--force]'); return 2; }
      const r = await canonPull({ session: positional, to: opt('--to'), force: flag('--force'), store: opt('--store') });
      return r.code;
    }
    case 'artifacts':
      await canonArtifacts({ dryRun: flag('--dry-run'), store: opt('--store') });
      return 0;
    case 'graph':
      await canonGraph({ store: opt('--store'), project: opt('--project'), mergeGraph: opt('--merge-graph'), dryRun: flag('--dry-run') });
      return 0;
    default:
      console.log(USAGE);
      return verb ? 2 : 0;
  }
}
