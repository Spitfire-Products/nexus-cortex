/**
 * `cortex autoresearch backlog` — view + manage the DEFICIENCY POOL
 * (`.cortex/research-backlog.jsonl`): the prioritized task board the auto-research
 * loop pulls from (`loop` uses `backlog.next()` as its default goal). Producers
 * (bench/experiment/gate) append deficiencies; this surfaces them for humans.
 *
 *   backlog list [--status s] [--all] [--json]   — prioritized list
 *   backlog show <id> [--json]                    — one item, full detail
 *   backlog next [--json]                         — the top workable item
 *   backlog resolve <id> [--verified|--wont-fix <reason>|--close|--fixed <ref>]
 *   backlog claim <id> / claim-next / release   (work-swarm lease with TTL)
 *
 * TODO (TUI): these are the headless CLI verbs. An INTERACTIVE backlog menu still
 * needs building in the neoncortex TUI (`packages/tui`, e.g. alongside
 * `ink-ui/components/MenuRenderer.tsx`) — a browsable/filterable deficiency list
 * with keyboard claim/resolve/next actions over the same ResearchBacklog API, and
 * (when the SPA hosts the TUI) the origin-scoped public/private/platform views.
 * See modules/database-ai/DEFICIENCY_VISIBILITY_WORKSWARM_PLAN.md §3.3.
 */
import { ResearchBacklog, type DeficiencyRecord, type DeficiencyStatus } from '@nexus-cortex/core';
import { ThemeManager } from '../../themes/ThemeManager.js';
import { findProjectRoot } from '../config/utils.js';

/** Which project's pool to operate on. Explicit --repo wins so a worker (or the
 *  user) can target ANY repo's .cortex/research-backlog.jsonl — findProjectRoot()
 *  otherwise resolves to the CLI's own install location, not the user's cwd. */
function resolveRoot(opts: { repo?: string }): string {
  return opts.repo || process.env.CORTEX_ROOT || findProjectRoot();
}

function statusColored(theme: ReturnType<typeof ThemeManager.getTheme>, s: DeficiencyStatus): string {
  const label = s.toUpperCase().padEnd(11);
  switch (s) {
    case 'verified':
    case 'closed':
      return theme.colors.success(label);
    case 'in_progress':
    case 'fixed':
      return theme.colors.highlight(label);
    case 'wont_fix':
    case 'regressed':
      return theme.colors.error(label);
    default:
      return theme.colors.muted(label); // open / triaged
  }
}

function row(theme: ReturnType<typeof ThemeManager.getTheme>, d: DeficiencyRecord): string {
  const pri = String(d.priorityScore).padStart(6);
  const sev = d.severity.padEnd(8);
  return (
    ` ${theme.colors.highlight(pri)}  ${statusColored(theme, d.status)} ` +
    `${theme.colors.muted(d.id.padEnd(16))} ${theme.colors.muted(sev)} ${d.title}`
  );
}

export interface BacklogListOptions { repo?: string; status?: string; all?: boolean; json?: boolean }

export async function autoResearchBacklogList(options: BacklogListOptions): Promise<void> {
  const theme = ThemeManager.getTheme();
  const backlog = new ResearchBacklog(resolveRoot(options));
  const status = options.status
    ? (options.status.split(',').map((s) => s.trim()) as DeficiencyStatus[])
    : undefined;
  let records = backlog.list({ status, sortByPriority: true });
  // Default view hides resolved noise unless a status filter or --all is given.
  if (!status && !options.all) {
    records = records.filter((d) => d.status !== 'closed' && d.status !== 'wont_fix');
  }

  if (options.json) { console.log(JSON.stringify(records, null, 2)); return; }
  if (records.length === 0) { console.log(theme.colors.muted(' Backlog empty (no matching deficiencies).')); return; }

  console.log();
  console.log(theme.colors.muted(`  ${records.length} deficiency(ies) · .cortex/research-backlog.jsonl · sorted by priority`));
  console.log(theme.colors.muted('  PRIORITY  STATUS      ID               SEVERITY TITLE'));
  for (const d of records) console.log(row(theme, d));
  console.log();
}

export interface BacklogShowOptions { repo?: string; json?: boolean }

export async function autoResearchBacklogShow(id: string, options: BacklogShowOptions): Promise<void> {
  const theme = ThemeManager.getTheme();
  const backlog = new ResearchBacklog(resolveRoot(options));
  const d = backlog.get(id);
  if (!d) { console.error(theme.colors.error(` No deficiency with id '${id}'.`)); process.exitCode = 1; return; }
  if (options.json) { console.log(JSON.stringify(d, null, 2)); return; }

  console.log();
  console.log(` ${theme.colors.highlight(d.id)}  ${statusColored(theme, d.status)}  priority ${theme.colors.highlight(String(d.priorityScore))}`);
  console.log(` ${theme.colors.highlight(d.title)}`);
  console.log();
  console.log(theme.colors.muted(` class      `) + d.bugClass);
  console.log(theme.colors.muted(` triage     `) + `severity=${d.severity} impact=${d.impact} effort=${d.effort} confidence=${d.confidence}`);
  if (d.experimentTag) console.log(theme.colors.muted(` experiment `) + d.experimentTag);
  if (d.fixedRef) console.log(theme.colors.muted(` fixed@     `) + d.fixedRef);
  if (d.verifiedRound) console.log(theme.colors.muted(` verified@  `) + d.verifiedRound);
  if (d.affectedModels?.length) console.log(theme.colors.muted(` models     `) + d.affectedModels.join(', '));
  if (d.discoveredRound) console.log(theme.colors.muted(` found      `) + `round ${d.discoveredRound}${d.discoveredRef ? ` @ ${d.discoveredRef}` : ''}`);
  console.log(theme.colors.muted(` created    `) + d.createdAt + theme.colors.muted(`   updated `) + d.updatedAt);
  console.log();
  console.log(d.description);
  if (d.notes) { console.log(); console.log(theme.colors.muted(' notes: ') + d.notes); }
  console.log();
}

export interface BacklogNextOptions { repo?: string; json?: boolean }

export async function autoResearchBacklogNext(options: BacklogNextOptions): Promise<void> {
  const theme = ThemeManager.getTheme();
  const backlog = new ResearchBacklog(resolveRoot(options));
  const d = backlog.next();
  if (!d) { if (options.json) { console.log('null'); } else { console.log(theme.colors.muted(' Backlog dry — no workable (open/triaged) deficiency.')); } return; }
  await autoResearchBacklogShow(d.id, options);
}

export interface BacklogResolveOptions { repo?: string;
  verified?: boolean;
  wontFix?: string;
  close?: boolean;
  fixed?: string;
  round?: string;
  json?: boolean;
}

export async function autoResearchBacklogResolve(id: string, options: BacklogResolveOptions): Promise<void> {
  const theme = ThemeManager.getTheme();
  const backlog = new ResearchBacklog(resolveRoot(options));
  const existing = backlog.get(id);
  if (!existing) { console.error(theme.colors.error(` No deficiency with id '${id}'.`)); process.exitCode = 1; return; }

  let updated: DeficiencyRecord | undefined;
  if (options.wontFix !== undefined) updated = backlog.wontFix(id, options.wontFix || 'manually marked wont_fix');
  else if (options.close) updated = backlog.close(id);
  else if (options.fixed !== undefined) updated = backlog.markFixed(id, options.fixed || 'manual');
  else updated = backlog.markVerified(id, options.round || 'manual'); // default: mark verified (PM keep)

  if (!updated) { console.error(theme.colors.error(` Failed to update '${id}'.`)); process.exitCode = 1; return; }
  if (options.json) { console.log(JSON.stringify(updated, null, 2)); return; }
  console.log(` ${theme.colors.success('updated')} ${theme.colors.highlight(updated.id)} → ${statusColored(theme, updated.status).trim()}`);
}

// ── work-swarm claim/release (lease with TTL) ──────────────────────────────

export interface BacklogClaimOptions { repo?: string; owner?: string; ttl?: string; json?: boolean }

function ttlMs(opts: BacklogClaimOptions): number {
  const mins = opts.ttl ? Number(opts.ttl) : 15;
  return (Number.isFinite(mins) && mins > 0 ? mins : 15) * 60 * 1000;
}

export async function autoResearchBacklogClaim(id: string, options: BacklogClaimOptions): Promise<void> {
  const theme = ThemeManager.getTheme();
  const backlog = new ResearchBacklog(resolveRoot(options));
  const owner = options.owner || `cli-${process.pid}`;
  const claimed = backlog.claim(id, owner, ttlMs(options));
  if (!claimed) { console.error(theme.colors.error(` Could not claim '${id}' — missing, resolved, or held by another worker.`)); process.exitCode = 1; return; }
  if (options.json) { console.log(JSON.stringify(claimed, null, 2)); return; }
  console.log(` ${theme.colors.success('claimed')} ${theme.colors.highlight(claimed.id)} by ${owner} · lease → ${claimed.leaseExpiresAt}`);
}

export async function autoResearchBacklogClaimNext(options: BacklogClaimOptions): Promise<void> {
  const theme = ThemeManager.getTheme();
  const backlog = new ResearchBacklog(resolveRoot(options));
  const owner = options.owner || `cli-${process.pid}`;
  const claimed = backlog.claimNext(owner, ttlMs(options));
  if (!claimed) { if (options.json) console.log('null'); else console.log(theme.colors.muted(' No unclaimed workable deficiency to claim.')); return; }
  if (options.json) { console.log(JSON.stringify(claimed, null, 2)); return; }
  console.log(` ${theme.colors.success('claimed')} ${theme.colors.highlight(claimed.id)} by ${owner} · lease → ${claimed.leaseExpiresAt}`);
  await autoResearchBacklogShow(claimed.id, {});
}

export interface BacklogReleaseOptions { repo?: string; owner?: string; json?: boolean }

export async function autoResearchBacklogRelease(id: string | undefined, options: BacklogReleaseOptions & { expired?: boolean }): Promise<void> {
  const theme = ThemeManager.getTheme();
  const backlog = new ResearchBacklog(resolveRoot(options));
  if (options.expired || !id) {
    const released = backlog.releaseExpired();
    if (options.json) { console.log(JSON.stringify(released, null, 2)); return; }
    console.log(` ${theme.colors.success('released')} ${released.length} expired lease(s)${released.length ? ': ' + released.map((r) => r.id).join(', ') : ''}`);
    return;
  }
  const rel = backlog.release(id, options.owner);
  if (!rel) { console.error(theme.colors.error(` Could not release '${id}' (not found or not owned by ${options.owner}).`)); process.exitCode = 1; return; }
  if (options.json) { console.log(JSON.stringify(rel, null, 2)); return; }
  console.log(` ${theme.colors.success('released')} ${theme.colors.highlight(rel.id)} → ${statusColored(theme, rel.status).trim()}`);
}
