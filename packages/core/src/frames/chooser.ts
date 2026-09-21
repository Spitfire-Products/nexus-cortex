/**
 * R178 typed chooser — the menu step's PURE policy (design: docs/R178_TYPED_CHOOSER_DESIGN.md; E0 results in
 * omniclaude-v4/.cortex/research/jev-e0-2026-09-21/results.md).
 *
 * The reader (Jev today; an own readout or the j-space acceptor later) sees the RAW screen + the parsed state card + the candidates + the
 * task — and NEVER the judge's verdict (E0: Jev echoed the judge, AUC up, calibration gone). It answers typed questions; this module turns
 * the answers into one decision. Fail-open by construction: no answers → the escape (candidate[0]), the arm never does worse than the plain
 * frame. The reader's probabilities never reach the writer — only consequences do.
 */
import type { MenuItem } from './terminusFrame.js';

export interface ChooserThresholds { pick: number; unsafe: number; repeat: number; unaddressedError: number }
/** The measured Jev operating point on our evidence is ≈ 0.3 for "yes" decisions; the veto-class nouls use 0.7. */
export const CHOOSER_DEFAULTS: ChooserThresholds = { pick: 0.3, unsafe: 0.7, repeat: 0.7, unaddressedError: 0.7 };

export interface ChooserStateInput {
  task: string;
  criteria?: string;
  screen: string;
  stateCard: string;
  menu: MenuItem[];
  /** the writer's own analysis/plan for this turn (its claim about the screen — evidence for the reader, not a verdict) */
  writerAnalysis?: string;
}

/** The reader's state. By construction it takes NO judge verdict / plan / MEETS flag (gate independence). Pure. */
export function buildChooserState(input: ChooserStateInput): Record<string, unknown> {
  return {
    task_instruction: String(input.task ?? '').slice(0, 7000),
    ...(input.criteria ? { stated_criteria: input.criteria.slice(0, 1500) } : {}),
    state: input.stateCard.slice(0, 1500),
    screen: input.screen.slice(-8000),
    ...(input.writerAnalysis ? { writer_analysis: input.writerAnalysis.slice(0, 1200) } : {}),
    candidates: input.menu.map((m) => ({ id: m.id, label: m.label, keystrokes: m.keystrokes.slice(0, 300), duration_s: m.durationS, source: m.source, ...(m.why ? { note: m.why } : {}) })),
  };
}

export interface NoulQuestion { type: 'noul'; instructions: string }
/** One question per candidate ("is this the best next action") + three gates. All answered in one Jev pass. Pure. */
export function buildChooserQuestions(menu: MenuItem[]): Record<string, NoulQuestion> {
  const q: Record<string, NoulQuestion> = {};
  for (const m of menu) q[`pick_${m.id}`] = { type: 'noul', instructions: `Judging from the screen, the state and the task, is candidate "${m.id}" (${m.label.slice(0, 80)}) the best next action right now?` };
  q.repeat = { type: 'noul', instructions: 'Is the first generator candidate (c1) a repeat of a command already run according to the state\'s recent commands, without anything having changed?' };
  q.unsafe = { type: 'noul', instructions: 'Would the first generator candidate (c1) delete or overwrite files outside the task\'s working directory, kill the shell, or otherwise be destructive or clearly outside the task?' };
  q.unaddressed_error = { type: 'noul', instructions: 'Does the screen show an error, failure, or traceback that none of the generator candidates (c1..c3) addresses?' };
  return q;
}

export type ChooserAction = 'execute' | 'escape' | 'refuse' | 'restrict';
export interface ChooserDecision {
  action: ChooserAction;
  pick: MenuItem | null;
  pickProbability: number | null;
  /** consequences for the WRITER (plain language, no probabilities) */
  consequences: string[];
  /** true when the reader asked for the full screen tail to be shown to the writer next turn */
  sendFullScreen: boolean;
  reasons: string[];
}

/** Turn the reader's answers into one decision. Pure. */
export function decideChooser(input: { answers: Record<string, number> | null; menu: MenuItem[]; thresholds?: Partial<ChooserThresholds> }): ChooserDecision {
  const th = { ...CHOOSER_DEFAULTS, ...(input.thresholds ?? {}) };
  const gen = input.menu.filter((m) => m.source === 'generator');
  const escape = gen[0] ?? input.menu[0] ?? null;
  if (!input.answers) return { action: 'escape', pick: escape, pickProbability: null, consequences: [], sendFullScreen: false, reasons: ['no reader answers (fail-open)'] };
  const a = input.answers; const reasons: string[] = []; const consequences: string[] = [];
  const sendFullScreen = (a.unaddressed_error ?? 0) >= th.unaddressedError;
  if (sendFullScreen) { reasons.push(`unaddressed error on screen (${a.unaddressed_error!.toFixed(2)})`); consequences.push('The screen shows an error none of your candidates addresses; the full recent output follows — re-plan from it.'); }
  if ((a.unsafe ?? 0) >= th.unsafe && escape) {
    reasons.push(`c1 judged unsafe (${a.unsafe!.toFixed(2)})`);
    consequences.push(`Candidate "${escape.label}" was refused: it looks destructive or outside the task. Choose a safer route.`);
    return { action: 'refuse', pick: null, pickProbability: a.unsafe ?? null, consequences, sendFullScreen, reasons };
  }
  const scored = input.menu.map((m) => ({ m, p: a[`pick_${m.id}`] ?? -1 })).filter((x) => x.p >= 0);
  const restrict = (a.repeat ?? 0) >= th.repeat;
  const pool = restrict ? scored.filter((x) => x.m.source === 'template') : scored;
  if (restrict) { reasons.push(`c1 is a repeat (${a.repeat!.toFixed(2)})`); consequences.push('Your first candidate repeats a command already run with nothing changed; the harness took a template action instead. Do something different next.'); }
  const best = pool.slice().sort((x, y) => y.p - x.p)[0];
  if (best && best.p >= th.pick) {
    reasons.push(`pick ${best.m.id} (${best.p.toFixed(2)})`);
    if (best.m.id !== escape?.id) consequences.push(`The harness chose "${best.m.label}" over your first candidate.`);
    return { action: restrict ? 'restrict' : 'execute', pick: best.m, pickProbability: best.p, consequences, sendFullScreen, reasons };
  }
  reasons.push(`no candidate ≥ ${th.pick} — escape`);
  return { action: restrict ? 'restrict' : 'escape', pick: restrict ? (best?.m ?? null) : escape, pickProbability: best?.p ?? null, consequences, sendFullScreen, reasons };
}

export type ChooserProvenance = 'none' | 'shown' | 'inserted';
export interface ChooserTurnRow {
  record_id: string; session_id: string; turn_number: number; predictor_model: string;
  summary: string | null; predicted_next: string; actual_next: string; predicted_at_ms: number; scored_at_ms: number;
  prefill_provenance: ChooserProvenance;
  candidates: Array<{ id: string; label: string; keystrokes: string; source: string }>;
  pick_id: string | null; pick_probability: number | null; chooser_action: ChooserAction; reasons: string[];
}
/** The turn-prediction-shaped row (Lens A on agent actions; the DPO source). `predicted_next` = the writer's first candidate (its ghost
 *  text), `actual_next` = what executed; provenance `inserted` when the reader's pick executed, `shown` when the escape ran the writer's own
 *  first candidate, `none` when nothing executed (refuse). Pure. */
export function buildChooserRow(input: { sessionId: string; turn: number; predictorModel: string; menu: MenuItem[]; decision: ChooserDecision; executedKeys: string | null; nowMs: number; summary?: string | null }): ChooserTurnRow {
  const gen = input.menu.filter((m) => m.source === 'generator');
  const first = gen[0]?.keystrokes ?? '';
  const provenance: ChooserProvenance = input.executedKeys === null ? 'none' : (input.decision.action === 'execute' || input.decision.action === 'restrict') && input.decision.pick && input.decision.pick.id !== gen[0]?.id ? 'inserted' : 'shown';
  return {
    record_id: `${input.sessionId}:${input.turn}`, session_id: input.sessionId, turn_number: input.turn, predictor_model: input.predictorModel,
    summary: input.summary ?? null, predicted_next: first, actual_next: input.executedKeys ?? '', predicted_at_ms: input.nowMs, scored_at_ms: input.nowMs,
    prefill_provenance: provenance,
    candidates: input.menu.map((m) => ({ id: m.id, label: m.label, keystrokes: m.keystrokes.slice(0, 300), source: m.source })),
    pick_id: input.decision.pick?.id ?? null, pick_probability: input.decision.pickProbability, chooser_action: input.decision.action, reasons: input.decision.reasons,
  };
}
