/**
 * Scope check (2026-11-04, CORTEX_SCOPE_CHECK, default on) — EndTurn Stage 6, deterministic, zero model calls, at most one hold per turn.
 *
 * Field: the audited multi-site runs (ms-after-r5/r6, .bench/eval/om2w/groundtruth.json) lost CarMax twice the same way — the store was
 * set to Kentwood, MI, but the distance facet stayed "Nationwide" and the agent reported "44 of 14,610 results" as the local answer; BBB
 * named a Massachusetts charity for "near 12023" with the distance filter on "All distances". The citation, requirement and integrity gates
 * all passed (the quotes WERE on the page). What failed is SCOPE: the task names a place and the result set the agent read is not scoped to it.
 *
 * Rule: when the task text names a place (a US ZIP, "near / around / close to <Place>", "within N miles|km"), and the turn's LATEST tool
 * outputs show an unscoped result set — an explicit marker (Nationwide, All distances, Anywhere, a nationwide radius id) or a result count of
 * 5,000+ with no radius beside it — the finish is held ONCE: apply the scope on the source itself, or say explicitly that it cannot be
 * applied / nothing matches inside it (a valid answer). The same check runs in Browse delegates (mechanical gates), where the page is still
 * open. It is inert on tasks that name no place. Pure; the gate wiring lives in orchestrator/endTurnGates.ts.
 */

export function scopeCheckEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return !/^(off|false|0)$/i.test(String(env.CORTEX_SCOPE_CHECK ?? '').trim());
}

export interface TaskScope { places: string[]; radius?: string }

const ZIP_RE = /\b(?:zip(?:\s*code)?\s*)?(\d{5})(?:-\d{4})?\b/gi;
const NEAR_RE = /\b(?:near|around|close to|nearby|in the area of)\s+((?:zip(?:\s*code)?\s*)?[A-Z0-9][\w.'-]*(?:[ ,]+[A-Z][\w.'-]*){0,3})/g;
const RADIUS_RE = /\bwithin\s+(\d+(?:\.\d+)?)\s*(mi|miles?|km|kilometers?)\b/i;

/** Place / radius scope the task text states. Pure. */
export function taskScope(taskText: string): TaskScope {
  const t = String(taskText ?? '');
  const places = new Set<string>();
  for (const m of t.matchAll(ZIP_RE)) {
    const before = t.slice(Math.max(0, m.index! - 24), m.index!);
    // A 5-digit number that is a money amount, a count or part of a longer id is not a ZIP.
    if (/[$£€]\s*$|#\s*$|\d[,.]$/.test(before)) continue;
    const after = t.slice(m.index! + m[0].length, m.index! + m[0].length + 12);
    if (/^\s*(?:dollars?|usd|miles?|mi\b|km|results?|items?|people|users|records?|rows?|lines?|bytes?|ms|seconds?)/i.test(after)) continue;
    if (/zip|postal|near|in |around|area|code/i.test(before) || /zip/i.test(m[0])) places.add(m[1]!);
  }
  for (const m of t.matchAll(NEAR_RE)) {
    // Stop at a sentence break and drop trailing connective words ("12023. When", "49512 AND").
    let p = m[1]!.split(/[.;:!?]\s/)[0]!.replace(/[.,;:]+$/, '').trim();
    p = p.replace(/(?:[ ,]+(?:and|or|when|with|for|to|the|then|that|which|while|if|AND|OR|WHEN))+$/i, '').replace(/^zip(?:\s*code)?\s*/i, '').trim();
    if (p.length >= 3 && !/^(me|you|here|there|it|the end|the top|the bottom|now|zip|zip code)$/i.test(p)) places.add(p);
  }
  const r = t.match(RADIUS_RE);
  return { places: [...places], radius: r ? `${r[1]} ${r[2]}` : undefined };
}

// An UNSCOPED result set: a nationwide/all-distance choice that is SELECTED or DISPLAYED as the current value — never the bare word (page
// titles say "Used Vehicles for Sale Nationwide"; option lists name every radius).
const UNSCOPED_SELECTED_RE = new RegExp([
  String.raw`"displayValue"\s*:\s*"(?:Nationwide|All distances|Anywhere)"`,
  String.raw`\bradius-nationwide\b`, String.raw`"isNationwide"\s*:\s*true`,
  String.raw`Nationwide"?\s*,\s*"?isSelected"?\s*:\s*true`,
  String.raw`(?:selected|checked|active|current(?:ly)?|showing)[^\n]{0,40}\b(?:Nationwide|All distances)\b`,
  String.raw`\b(?:Nationwide|All distances)\b[^\n]{0,20}\b(?:selected|checked|active)\b`,
  String.raw`\b(?:distance|radius)\b[^\n]{0,24}[:=]\s*"?(?:Nationwide|All distances|Any(?:where)?)\b`,
].join('|'), 'i');
// SCOPED: a radius/distance that is applied — a URL parameter, a "within N mi" statement, a selected N-mile choice.
const SCOPED_RE = new RegExp([
  String.raw`[?&](?:max(?:imum)?_?distance|distance|radius|filter_distance|searchRadius|miles)=\d+`,
  String.raw`\bwithin\s+\d+\s*(?:mi|miles?|km)\b`,
  String.raw`"displayValue"\s*:\s*"\d+\s*(?:mi|miles?|km)"`,
  String.raw`\d+\s*(?:mi|miles?|km)"?\s*,\s*"?isSelected"?\s*:\s*true`,
  String.raw`(?:selected|checked|active)[^\n]{0,30}\b\d+\s*(?:mi|miles?|km)\b`,
].join('|'), 'i');
const BIG_COUNT_RE = /\b(\d{1,3}(?:,\d{3})+|\d{5,})\s+(results?|matches|listings|vehicles|cars|items|products|homes|properties|jobs|businesses|stores|providers)\b/gi;

export interface ScopeFinding { kind: 'marker' | 'count'; text: string }

const clip = (t: string, at: number, len: number): string => t.slice(Math.max(0, at - 80), at + len + 80).replace(/\s+/g, ' ').trim().slice(0, 200);

/** Scope state of the NEWEST output that shows one (`latest` = newest last): an unscoped finding, or null when the newest result-set
 *  signal is scoped or there is none. Older outputs never override a newer scoped state (the agent may have fixed the filter). Pure. */
export function unscopedEvidence(latest: string[], minCount = 5000): ScopeFinding | null {
  for (let i = latest.length - 1; i >= 0; i--) {
    const t = String(latest[i] ?? '');
    const mk = t.match(UNSCOPED_SELECTED_RE);
    if (mk) return { kind: 'marker', text: clip(t, mk.index ?? 0, mk[0].length) };
    if (SCOPED_RE.test(t)) return null;
    // When the output names its MAIN result count (page_state's mainCount), judge that count only — the other counts on a page are facet
    // totals, suggestions and site-wide figures (r3 CarMax: mainCount "22 matches" beside a nationwide total in otherCounts).
    const main = t.match(/"mainCount"\s*:\s*\{\s*"text"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    const pool = main ? main[1]! : t;
    if (main && !BIG_COUNT_RE.test(pool)) { BIG_COUNT_RE.lastIndex = 0; return null; }
    BIG_COUNT_RE.lastIndex = 0;
    for (const m of pool.matchAll(BIG_COUNT_RE)) {
      const n = parseInt(m[1]!.replace(/,/g, ''), 10);
      if (!Number.isFinite(n) || n < minCount) continue;
      // A big count the text itself sets aside ("the site-wide unfiltered total", a carousel/suggestion header) is not the result set.
      const ctx = pool.slice(Math.max(0, m.index! - 140), m.index! + m[0].length + 140);
      if (/site-?wide|unfiltered|overall total|carousel|suggestion|not (?:the|our|my) (?:answer|result)/i.test(ctx)) continue;
      return { kind: 'count', text: clip(pool, m.index!, m[0].length) };
    }
  }
  return null;
}

export interface ScopeVerdict { ok: boolean; scope?: TaskScope; finding?: ScopeFinding; nudge?: string }

/** Stage 6: hold once when the task is place-scoped and the latest outputs show an unscoped result set. Pure. */
export function scopeCheck(input: { taskText?: string; latestOutputs: string[]; alreadyHeld: boolean }): ScopeVerdict {
  if (input.alreadyHeld) return { ok: true };
  const scope = taskScope(input.taskText ?? '');
  if (scope.places.length === 0 && !scope.radius) return { ok: true, scope };
  const finding = unscopedEvidence(input.latestOutputs);
  if (!finding) return { ok: true, scope };
  const where = [...scope.places.slice(0, 3), ...(scope.radius ? [`within ${scope.radius}`] : [])].join(', ');
  const what = finding.kind === 'marker' ? `the results are not limited to that area (the page shows: "${finding.text}")`
    : `the result count is far larger than one area could hold (the page shows: "${finding.text}")`;
  return {
    ok: false, scope, finding,
    nudge: `EndTurn HELD (scope check — once) — the task is scoped to ${where}, but ${what}. Apply the task's scope on the source ` +
      `itself — the site's distance / location / radius filter or the equivalent query constraint — and report the scoped result (the count ` +
      `and items inside the area). If the scope cannot be applied, or nothing matches inside it, say so explicitly in your answer — that is a ` +
      `valid answer — then call EndTurn again.`,
  };
}
