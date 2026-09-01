/**
 * nexus-canon CLI — minimal, dependency-free verb dispatcher.
 * (The full themed experience lives in the nexus-cortex harness as
 * `cortex canon <verb>`; this bin serves harness-less installs.)
 */
import { canonArchive } from './canonArchive.js';
import { canonArtifacts } from './canonArtifacts.js';
import { canonGraph } from './canonGraph.js';
import { canonInit } from './canonInit.js';
import { canonList, canonPull, canonPullNative, canonPullNativeAll } from './canonPull.js';
import { canonSync } from './canonSync.js';
import { deriveToolInventory, TOOL_CONCEPTS } from './canonTools.js';
import { canonTranslate } from './canonTranslate.js';
import { canonWatch } from './canonWatch.js';

const USAGE = `nexus-canon — portable agent memory in a git repo you own

Usage: nexus-canon <verb> [options]

Verbs:
  init [dir] [--remote <url>]         scaffold a canon store repository
  sync [--dry-run] [--store <dir>] [--scope auto|<labels>]  native harness sessions -> store (scrubbed); --scope = sparse sync-only clone of just those legs (auto = harnesses present on this machine)
  translate [--dry-run] [--store <dir>]  native -> canonical line + projections
  list [--all] [--project N/A] [--store <dir>]  list canon sessions
  pull <uuid> [--native] [--to <dir>] [--project <cwd>] [--harness <h>] [--force] [--store <dir>]  materialize a session (--native = byte-exact original-harness files, e.g. into ~/.claude/projects for claude --resume)
  artifacts [--dry-run] [--store <dir>]  capture capability artifacts
  archive [--days N] [--dry-run] [--no-push] [--store <dir>]  move sessions older than N days (default 30) to archive/ (remote keeps all; local goes sparse + FLAT)
  tools [--store <dir>] [--json]      observed tool inventory + cross-harness concept map
  graph [--project <id>] [--merge-graph <path>] [--cognition] [--include-thought-text] [--dry-run] [--store <dir>]
  watch [--debounce <ms>] [--dry-run] [--store <dir>]  watch harness roots & auto-sync on change

Default store: /tmp/canon-store (override with --store or CANON_REPO env for the remote).
Spec: docs/CANON.md in the nexus-cortex repository.`;

function signal(): AbortSignal {
  const ctrl = new AbortController();
  process.once('SIGINT', () => ctrl.abort());
  process.once('SIGTERM', () => ctrl.abort());
  return ctrl.signal;
}

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
      await canonSync({ dryRun: flag('--dry-run'), store: opt('--store'), scope: opt('--scope') });
      return 0;
    case 'translate': {
      const r = await canonTranslate({ dryRun: flag('--dry-run'), store: opt('--store') });
      return r.errors.length ? 1 : 0;
    }
    case 'list':
      await canonList({ store: opt('--store'), all: flag('--all') });
      return 0;
    case 'pull': {
      if (flag('--native') && flag('--all')) {
        const maxMb = opt('--max-mb');
        const recent = opt('--recent');
        const recentMaxMb = opt('--recent-max-mb');
        const ra = await canonPullNativeAll({
          harness: opt('--harness'), to: opt('--to'), project: opt('--project') ?? process.cwd(),
          maxMb: maxMb ? parseInt(maxMb, 10) : undefined,
          recent: recent ? parseInt(recent, 10) : undefined,
          recentMaxMb: recentMaxMb ? parseInt(recentMaxMb, 10) : undefined,
          force: flag('--force'), store: opt('--store'),
        });
        return ra.failed.length ? 1 : 0;
      }
      if (!positional) { console.error('usage: nexus-canon pull <sessionUuid> [--native [--all]] [--to <dir>] [--project <cwd>] [--harness <h>] [--max-mb <n>] [--force] [--strip-signatures]'); return 2; }
      if (flag('--native')) {
        const rn = await canonPullNative({ session: positional, to: opt('--to'), project: opt('--project'), harness: opt('--harness'), force: flag('--force'), store: opt('--store') });
        return rn.code;
      }
      const r = await canonPull({ session: positional, to: opt('--to'), force: flag('--force'), store: opt('--store'), stripSignatures: flag('--strip-signatures') });
      return r.code;
    }
    case 'tools': {
      const inv = await deriveToolInventory(opt('--store') ?? '/tmp/canon-store');
      if (flag('--json')) { console.log(JSON.stringify({ inventory: inv, concepts: TOOL_CONCEPTS }, null, 2)); return 0; }
      for (const [h, tools] of Object.entries(inv)) {
        const top = Object.entries(tools).sort((a, b) => b[1] - a[1]);
        console.log(`${h} (${top.length} distinct): ${top.slice(0, 12).map(([n, c]) => `${n}:${c}`).join(', ')}`);
      }
      console.log(`concepts mapped: ${Object.keys(TOOL_CONCEPTS).length} (see TOOL_CONCEPTS via --json)`);
      return 0;
    }
    case 'artifacts':
      await canonArtifacts({ dryRun: flag('--dry-run'), store: opt('--store') });
      return 0;
    case 'graph':
      await canonGraph({ store: opt('--store'), project: opt('--project'), mergeGraph: opt('--merge-graph'), dryRun: flag('--dry-run'), cognition: flag('--cognition'), includeThoughtText: flag('--include-thought-text') });
      return 0;
    case 'archive': {
      const d = opt('--days');
      const days = d ? parseInt(d, 10) : undefined;
      if (d && (isNaN(days!) || days! < 1)) { console.error('--days must be a positive integer'); return 2; }
      return canonArchive({ store: opt('--store') ?? '/tmp/canon-store', days, dryRun: flag('--dry-run'), push: !flag('--no-push') });
    }
    case 'watch': {
      const debounceMs = opt('--debounce');
      const debounce = debounceMs ? parseInt(debounceMs, 10) : undefined;
      if (debounceMs && (isNaN(debounce!) || debounce! < 0)) { console.error('--debounce must be a non-negative ms value'); return 2; }
      console.log(`[canon-watch] watching harness session roots (debounce ${debounce ?? 60_000}ms)`);
      await canonWatch({
        store: opt('--store'),
        dryRun: flag('--dry-run'),
        debounceMs: debounce,
        onSync: (r) => console.log(`[canon-watch] synced ${r.copied} (${r.unchanged} unchanged, ${r.skipped.length} skipped, pushed=${r.pushed})`),
        onWatch: (root) => console.log(`[canon-watch] watching ${root}`),
        signal: signal(),
      });
      return 0;
    }
    default:
      console.log(USAGE);
      return verb ? 2 : 0;
  }
}
