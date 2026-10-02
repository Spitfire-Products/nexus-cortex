/**
 * R210 HB-PLATEAU-STOP (CORTEX_PLATEAU_STOP=on, dark, 2026-10-02).
 *
 * v39a layout-config-recreation2: on an optimization task the agent cannot see the grader's pass threshold, so it polished a
 * self-computed score for 5.3 h (483 iterations, 840,636 → 851,547 with ever-finer searches); per-turn budget steering reports time
 * left, never "enough". Operator design — a PLATEAU VARIATION TARGET: the model prints `PLATEAU_METRIC <name>=<number> dir=<max|min>`
 * after every evaluation (one boot instruction asks for it); the harness keeps a per-session series per metric name and, when the
 * best value over the last WINDOW reports improves on the best before that window by less than REL (relative), steers ONE reminder:
 * stop optimizing, make sure the deliverable holds the best result, run the task's own verification once, finish. At most two
 * reminders per session (the second only after >= WINDOW more reports with still no real gain).
 *
 *   CORTEX_PLATEAU_STOP       = off (default) | on | status
 *     status (2026-10-02, dark): boot instruction + metric tracking + the STATUS score segment only — the detector still runs on the
 *     same cadence (same firing cap and re-fire spacing) but steers NO reminder; each would-be firing is returned as `detected` and
 *     banked as a plateau_detected event, so a run measures when `on` would have fired without changing what the model sees beyond
 *     the instruction and the segment (the segment omits the ` — PLATEAU` label in this mode).
 *   CORTEX_PLATEAU_REL        = relative-improvement target (default 0.002 = 0.2%)
 *   CORTEX_PLATEAU_WINDOW     = most recent reports compared (default 6)
 *   CORTEX_PLATEAU_MIN_POINTS = reports needed before any stop can fire (default 8)
 *
 * Pure apart from the env read; never throws (every entry point is fail-safe).
 */

export type PlateauDir = 'max' | 'min';

export interface PlateauConfig { rel: number; window: number; minPoints: number }

export const PLATEAU_DEFAULTS: PlateauConfig = { rel: 0.002, window: 6, minPoints: 8 };
export const PLATEAU_MAX_FIRINGS = 2;

export type PlateauMode = 'on' | 'status';

/** on | true | 1 → 'on'; status → 'status'; anything else (off/unset) → null. */
export function resolvePlateauMode(env: NodeJS.ProcessEnv = process.env): PlateauMode | null {
  const v = (env.CORTEX_PLATEAU_STOP ?? '').trim().toLowerCase();
  return /^(on|true|1)$/.test(v) ? 'on' : v === 'status' ? 'status' : null;
}

/** null when the lever is off (both `on` and `status` track). Bad numeric values fall back to the defaults. */
export function resolvePlateauStop(env: NodeJS.ProcessEnv = process.env): PlateauConfig | null {
  if (!resolvePlateauMode(env)) return null;
  const num = (raw: string | undefined, dflt: number, ok: (n: number) => boolean): number => {
    const n = Number((raw ?? '').trim());
    return (raw ?? '').trim() !== '' && Number.isFinite(n) && ok(n) ? n : dflt;
  };
  const window = Math.floor(num(env.CORTEX_PLATEAU_WINDOW, PLATEAU_DEFAULTS.window, (n) => n >= 1));
  const minPoints = Math.floor(num(env.CORTEX_PLATEAU_MIN_POINTS, PLATEAU_DEFAULTS.minPoints, (n) => n >= 2));
  const rel = num(env.CORTEX_PLATEAU_REL, PLATEAU_DEFAULTS.rel, (n) => n >= 0);
  return { rel, window, minPoints };
}

/** The one boot instruction (CORTEX_PLATEAU_STOP=on|status), or null when off. */
export function plateauBootInstruction(env: NodeJS.ProcessEnv = process.env): string | null {
  if (!resolvePlateauStop(env)) return null;
  return 'If you are tuning a continuous objective (a similarity score, error, latency, size…), print one line after every evaluation: ' +
    '`PLATEAU_METRIC <name>=<number> dir=<max|min>`. Never report pass/fail or test counts this way. Keep the task\'s deliverable ' +
    'updated with your best result so far.';
}

const METRIC_RE = /PLATEAU_METRIC (\S+)=(-?[0-9.eE+]+) dir=(max|min)/g;

/** All PLATEAU_METRIC reports in one tool_result text; the LAST occurrence wins per metric name. Malformed numbers are skipped. */
export function parsePlateauMetrics(text: string): Map<string, { value: number; dir: PlateauDir }> {
  const out = new Map<string, { value: number; dir: PlateauDir }>();
  if (typeof text !== 'string' || !text.includes('PLATEAU_METRIC')) return out;
  for (const m of text.matchAll(METRIC_RE)) {
    const name = m[1] ?? '';
    const value = Number(m[2]);
    if (!name || !Number.isFinite(value)) continue;
    out.delete(name); // re-insert so iteration order reflects the last report
    out.set(name, { value, dir: m[3] as PlateauDir });
  }
  return out;
}

export interface PlateauDecision {
  plateau: boolean;
  /** Relative improvement of the recent window's best over the best before it (negative = got worse). */
  improvement: number;
  best: number;
  bestRecent: number;
  bestBefore: number;
  points: number;
}

const TINY = 1e-12;

/**
 * Decide plateau for one series. Needs n >= minPoints AND at least one point before the window (n > window); otherwise
 * plateau=false. improvement = (bestRecent − bestBefore) / max(|bestBefore|, tiny) for max, (bestBefore − bestRecent) / … for min.
 * Plateau when improvement < rel — a series that got worse has negative improvement and counts as plateau.
 */
export function decidePlateau(series: readonly number[], dir: PlateauDir, cfg: PlateauConfig): PlateauDecision | null {
  const n = series.length;
  if (n === 0) return null;
  const better = dir === 'max' ? Math.max : Math.min;
  const best = series.reduce((a, b) => better(a, b));
  if (n < cfg.minPoints || n <= cfg.window) return { plateau: false, improvement: NaN, best, bestRecent: NaN, bestBefore: NaN, points: n };
  const before = series.slice(0, n - cfg.window);
  const recent = series.slice(n - cfg.window);
  const bestBefore = before.reduce((a, b) => better(a, b));
  const bestRecent = recent.reduce((a, b) => better(a, b));
  const denom = Math.max(Math.abs(bestBefore), TINY);
  const improvement = dir === 'max' ? (bestRecent - bestBefore) / denom : (bestBefore - bestRecent) / denom;
  return { plateau: improvement < cfg.rel, improvement, best, bestRecent, bestBefore, points: n };
}

/** Compact display: up to 3 significant digits, no exponent for ordinary magnitudes. */
export function formatPct(fraction: number): string {
  const p = fraction * 100;
  if (!Number.isFinite(p)) return String(p);
  return String(Number(p.toPrecision(3)));
}

export function buildPlateauReminder(name: string, d: PlateauDecision, cfg: PlateauConfig): string {
  return `<system-reminder>PLATEAU: your ${name} improved only ${formatPct(d.improvement)}% over the last ${cfg.window} evaluations ` +
    `(target ≥ ${formatPct(cfg.rel)}%). Stop optimizing. Make sure the deliverable holds the best result (${d.best}), ` +
    `run the task's own verification/tests once, then finish. If the task's required checks are not yet passing, this is not a ` +
    `stop signal — keep fixing them.</system-reminder>`;
}

export interface PlateauStopFire {
  name: string; dir: PlateauDir; best: number; improvementPct: number; points: number; firing: number;
}

export interface PlateauStepResult {
  /** The steering reminder to append on this round, or null. */
  signal: string | null;
  /** Metric names reported for the first time this round. */
  newMetrics: Array<{ name: string; dir: PlateauDir; value: number }>;
  fire: PlateauStopFire | null;
  /** status mode only: the firing `on` would have made this round (no signal is steered). Absent in `on` mode. */
  detected?: PlateauStopFire | null;
}

const EMPTY: PlateauStepResult = { signal: null, newMetrics: [], fire: null };

/** Per-session tracker (one per orchestrator). */
export class PlateauStopTracker {
  readonly series = new Map<string, { dir: PlateauDir; values: number[]; lastFirePoints: number | null }>();
  firings = 0;
  /** The most recently reported metric name (drives the STATUS segment). */
  lastName: string | null = null;

  /**
   * One tool round: scan each result text (strings, or tool results carrying a string `content`) (one point per metric per result; last occurrence wins), extend the series, and decide
   * whether to fire. Off (env) → no scanning at all, nothing recorded. Never throws.
   */
  step(texts: readonly unknown[], env: NodeJS.ProcessEnv = process.env): PlateauStepResult {
    try {
      const cfg = resolvePlateauStop(env);
      if (!cfg) return EMPTY;
      const statusOnly = resolvePlateauMode(env) === 'status';
      const newMetrics: PlateauStepResult['newMetrics'] = [];
      const touched = new Set<string>();
      for (const item of texts) {
        const t = typeof item === 'string' ? item : (item as { content?: unknown } | null)?.content; // a text or a {content} tool result
        if (typeof t !== 'string' || !t.includes('PLATEAU_METRIC')) continue;
        for (const [name, { value, dir }] of parsePlateauMetrics(t)) {
          let s = this.series.get(name);
          if (!s) {
            s = { dir, values: [], lastFirePoints: null };
            this.series.set(name, s);
            newMetrics.push({ name, dir, value });
          }
          s.dir = dir;
          s.values.push(value);
          touched.add(name);
          this.lastName = name;
        }
      }
      let fire: PlateauStopFire | null = null;
      let signal: string | null = null;
      if (this.firings < PLATEAU_MAX_FIRINGS) {
        for (const name of touched) {
          const s = this.series.get(name)!;
          if (s.lastFirePoints !== null && s.values.length < s.lastFirePoints + cfg.window) continue;
          const d = decidePlateau(s.values, s.dir, cfg);
          if (!d?.plateau) continue;
          this.firings++;
          s.lastFirePoints = s.values.length;
          fire = { name, dir: s.dir, best: d.best, improvementPct: Number(formatPct(d.improvement)), points: d.points, firing: this.firings };
          signal = buildPlateauReminder(name, d, cfg);
          break; // one reminder per round
        }
      }
      if (statusOnly) return { signal: null, newMetrics, fire: null, detected: fire }; // status: measure, never steer
      return { signal, newMetrics, fire };
    } catch {
      return EMPTY;
    }
  }
}

/**
 * HB-TURN-STATUS segment (operator scope addition): the most recently reported metric, e.g.
 * `score latency: best 0.41 (9 evals); +0.1% over last 6 (target ≥0.2%) — PLATEAU`. The improvement part appears once the series is
 * long enough to compare (n >= minPoints and n > window); ` — PLATEAU` when the detector says plateau now. null when the lever is
 * off or no metric was reported this session (STATUS line byte-identical then). Pure; never throws.
 */
export function plateauStatusSegment(tracker: PlateauStopTracker | null | undefined, env: NodeJS.ProcessEnv = process.env): string | null {
  try {
    const cfg = resolvePlateauStop(env);
    if (!cfg || !tracker?.lastName) return null;
    const s = tracker.series.get(tracker.lastName);
    if (!s || !s.values.length) return null;
    const d = decidePlateau(s.values, s.dir, cfg);
    if (!d) return null;
    let seg = `score ${tracker.lastName}: best ${d.best} (${d.points} eval${d.points === 1 ? '' : 's'})`;
    if (Number.isFinite(d.improvement)) {
      const pct = formatPct(d.improvement);
      seg += `; ${d.improvement >= 0 ? '+' : ''}${pct}% over last ${cfg.window} (target ≥${formatPct(cfg.rel)}%)`;
      if (d.plateau && resolvePlateauMode(env) === 'on') seg += ' — PLATEAU'; // status mode: numbers only, no stop label
    }
    return seg;
  } catch {
    return null;
  }
}
