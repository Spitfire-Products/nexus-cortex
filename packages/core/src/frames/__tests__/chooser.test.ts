import { describe, it, expect } from 'vitest';
import { buildChooserState, buildChooserQuestions, decideChooser, buildChooserRow, CHOOSER_DEFAULTS } from '../chooser.js';
import { buildMenu, applyKeyGuard } from '../terminusFrame.js';

const menu = buildMenu({ candidates: [{ label: 'run tests', keystrokes: 'pytest -q\n', durationS: 30 }, { label: 'inspect cfg', keystrokes: 'cat cfg.json\n', durationS: 2 }], taskTestCommand: 'make test' });

describe('R178 chooser — state and questions', () => {
  it('the reader state has the raw screen, the card, the candidates — and no field for a judge verdict (gate independence)', () => {
    const st = buildChooserState({ task: 'Fix the parser', criteria: 'all tests pass', screen: 'FAILED test_empty', stateCard: 'turn 3', menu, writerAnalysis: 'empty input crashes' });
    expect(Object.keys(st).sort()).toEqual(['candidates', 'screen', 'state', 'stated_criteria', 'task_instruction', 'writer_analysis']);
    expect((st.candidates as any[]).map((c) => c.id)).toEqual(['c1', 'c2', 't_test', 't_reread', 't_finish']);
    expect(JSON.stringify(st)).not.toMatch(/meets|verdict|judge/i);
  });
  it('R186: exactly one pick question per option and nothing else, all nouls; code facts ride in the question text', () => {
    const q = buildChooserQuestions(menu);
    expect(Object.keys(q)).toEqual(['pick_c1', 'pick_c2', 'pick_t_test', 'pick_t_reread', 'pick_t_finish']);
    const flagged = buildChooserQuestions(applyKeyGuard(buildMenu({ candidates: [{ label: 'clean', keystrokes: 'rm -rf /app/*\n', durationS: 2 }] }), { running: false }).menu);
    expect(flagged.pick_c1!.instructions).toMatch(/DESTRUCTIVE/);
    expect(Object.values(q).every((x) => x.type === 'noul')).toBe(true);
    expect(q.pick_c2!.instructions).toContain('inspect cfg');
  });
});

describe('R178 chooser — decisions', () => {
  it('fail-open: no answers → escape to c1, no consequences', () => {
    const d = decideChooser({ answers: null, menu });
    expect(d).toMatchObject({ action: 'escape', pickProbability: null, sendFullScreen: false }); expect(d.pick!.id).toBe('c1'); expect(d.consequences).toEqual([]);
  });
  it('executes the best candidate above the pick threshold; a non-c1 pick yields a consequence for the writer', () => {
    const d = decideChooser({ answers: { pick_c1: 0.2, pick_c2: 0.8, pick_t_test: 0.4, repeat: 0.1, unsafe: 0.05, unaddressed_error: 0.1 }, menu });
    expect(d.action).toBe('execute'); expect(d.pick!.id).toBe('c2'); expect(d.pickProbability).toBe(0.8);
    expect(d.consequences).toEqual(['The harness chose "inspect cfg" over your first candidate.']);
    const same = decideChooser({ answers: { pick_c1: 0.9, pick_c2: 0.1, repeat: 0, unsafe: 0, unaddressed_error: 0 }, menu });
    expect(same.pick!.id).toBe('c1'); expect(same.consequences).toEqual([]);
  });
  it('below the threshold everywhere → escape to c1 (the arm never does worse than the plain frame)', () => {
    const d = decideChooser({ answers: { pick_c1: 0.1, pick_c2: 0.2, pick_t_test: 0.25, repeat: 0, unsafe: 0, unaddressed_error: 0 }, menu });
    expect(d.action).toBe('escape'); expect(d.pick!.id).toBe('c1'); expect(d.reasons.join()).toContain(`no option ≥ ${CHOOSER_DEFAULTS.pick}`);
  });
  it('R186: gate answers in the payload are ignored — the pick decides (replay: gates changed 1.5% of E2 actions)', () => {
    const d = decideChooser({ answers: { pick_c1: 0.9, pick_c2: 0.5, unsafe: 0.95, repeat: 0.95, questionable: 0.95, unaddressed_error: 0.95 }, menu });
    expect(d.action).toBe('execute'); expect(d.pick!.id).toBe('c1'); expect(d.sendFullScreen).toBe(false); expect(d.consequences).toEqual([]);
  });
  it('thresholds are overridable', () => {
    const d = decideChooser({ answers: { pick_c1: 0.35, pick_c2: 0.1, repeat: 0, unsafe: 0, unaddressed_error: 0 }, menu, thresholds: { pick: 0.5 } });
    expect(d.action).toBe('escape');
  });
});

describe('R178 chooser — banking row (turn_predictions shape + additive fields)', () => {
  it('inserted when the reader\'s pick ran, shown when the escape ran c1, none when nothing ran', () => {
    const ex = decideChooser({ answers: { pick_c1: 0.2, pick_c2: 0.8, repeat: 0, unsafe: 0, unaddressed_error: 0 }, menu });
    const row = buildChooserRow({ sessionId: 's1', turn: 4, predictorModel: 'deepseek-flash+jev-chooser', menu, decision: ex, executedKeys: 'cat cfg.json\n', nowMs: 1000 });
    expect(row).toMatchObject({ record_id: 's1:4', predicted_next: 'pytest -q\n', actual_next: 'cat cfg.json\n', prefill_provenance: 'inserted', pick_id: 'c2', pick_probability: 0.8, chooser_action: 'execute' });
    expect(row.candidates.length).toBe(5);
    const esc = buildChooserRow({ sessionId: 's1', turn: 5, predictorModel: 'x', menu, decision: decideChooser({ answers: null, menu }), executedKeys: 'pytest -q\n', nowMs: 1 });
    expect(esc.prefill_provenance).toBe('shown');
    const none = buildChooserRow({ sessionId: 's1', turn: 6, predictorModel: 'x', menu, decision: { action: 'refuse', pick: null, pickProbability: null, consequences: [], sendFullScreen: false, reasons: ['all blocked'] }, executedKeys: null, nowMs: 1 });
    expect(none.prefill_provenance).toBe('none'); expect(none.chooser_action).toBe('refuse');
  });
});
