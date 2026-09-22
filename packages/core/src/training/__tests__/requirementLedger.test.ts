import { describe, it, expect } from 'vitest';
import { parseRequirementLedger, initLedger, updateLedger, ledgerCounts, ledgerHoldable, formatLedgerForWriter, formatLedgerHoldMessage, formatLedgerForJudge, buildRequirementLedgerPrompt, buildLedgerJevState, buildLedgerJevQuestions, applyLedgerJevAnswers, isBoilerplateRequirement, looksLikeBrokenCheck, REQ_LEDGER_SYSTEM, ledgerFailVetoable, buildLedgerFailJevState, buildLedgerFailJevQuestions, applyLedgerFailJevAnswers, formatLedgerFailVetoMessage } from '../requirementLedger.js';

const RAW = `REQ 1 | contract | a second identical submission must not rewrite crm_leads.json | CHECK: cmp -s a b || { echo "rewritten"; exit 1; }
- REQ 2 | threshold | global recall >= 0.96 | CHECK: \`python3 /tests/score.py --min-recall 0.96\`
REQ 3 | bogus-kind | the DOM must not change | CHECK: NONE
REQ 4 | threshold | global recall >= 0.96 | CHECK: dup line
noise
REQ 5 | latency | notifications within 5 s after a respawn | CHECK: none at all`;

describe('R187 requirement ledger — parse', () => {
  it('parses typed lines, normalizes ids and kinds, strips backticks, treats NONE as no check, dedups by text, caps', () => {
    const l = parseRequirementLedger(RAW, 8);
    expect(l.map((x) => x.id)).toEqual(['R1', 'R2', 'R3', 'R4']);
    expect(l[0]).toMatchObject({ kind: 'contract', check: 'cmp -s a b || { echo "rewritten"; exit 1; }' });
    expect(l[1]).toMatchObject({ kind: 'threshold', check: 'python3 /tests/score.py --min-recall 0.96' });
    expect(l[2]).toMatchObject({ kind: 'other', check: null });
    expect(l[3]).toMatchObject({ kind: 'latency', check: null, text: 'notifications within 5 s after a respawn' });
    expect(parseRequirementLedger(RAW, 2).length).toBe(2);
    expect(parseRequirementLedger('nothing here')).toEqual([]);
  });
  it('the prompt carries the task and the example line', () => {
    expect(buildRequirementLedgerPrompt('Do X', 'python3 present', 6)).toMatch(/TASK:\nDo X/); expect(buildRequirementLedgerPrompt('Do X', undefined, 6)).toMatch(/at most 6 REQ lines/);
  });
});

describe('R187 requirement ledger — state', () => {
  const entries = initLedger(parseRequirementLedger(RAW, 8));
  it('starts open when a check exists, unverifiable when none', () => {
    expect(entries.map((e) => e.status)).toEqual(['open', 'open', 'unverifiable', 'unverifiable']);
  });
  it('passed → exercised, failed → failed, inconclusive leaves the status; counts follow', () => {
    const u = updateLedger(entries, [{ id: 'R1', result: 'CHECK RUN: x → PASSED', cls: 'passed' }, { id: 'R2', result: 'CHECK RUN: y → FAILED\nrecall 0.91', cls: 'failed' }]);
    expect(u.map((e) => e.status)).toEqual(['exercised', 'failed', 'unverifiable', 'unverifiable']);
    const u2 = updateLedger(u, [{ id: 'R2', result: '', cls: 'inconclusive' }]);
    expect(u2[1]!.status).toBe('failed'); expect(u2[1]!.runs).toBe(2);
    expect(ledgerCounts(u2)).toEqual({ lines: 4, open: 0, exercised: 1, failed: 1, unverifiable: 2 });
  });
  it('holds once on open lines while budget remains; never below the floor; never on failed-only', () => {
    expect(ledgerHoldable({ open: 2, holdsUsed: 0, maxHolds: 1, remainingFrac: 0.8, minRemaining: 0.25 })).toBe(true);
    expect(ledgerHoldable({ open: 2, holdsUsed: 1, maxHolds: 1, remainingFrac: 0.8, minRemaining: 0.25 })).toBe(false);
    expect(ledgerHoldable({ open: 2, holdsUsed: 0, maxHolds: 1, remainingFrac: 0.1, minRemaining: 0.25 })).toBe(false);
    expect(ledgerHoldable({ open: 0, holdsUsed: 0, maxHolds: 1, remainingFrac: 0.9, minRemaining: 0.25 })).toBe(false);
    expect(ledgerHoldable({ open: 1, holdsUsed: 0, maxHolds: 1, remainingFrac: null, minRemaining: 0.25 })).toBe(true);
  });
  it('the writer text names every line and its check; the hold names only open lines; the judge block shows status', () => {
    const w = formatLedgerForWriter(entries); expect(w).toMatch(/R1 \[contract\]/); expect(w).toMatch(/harness check: cmp/); expect(w).toMatch(/no shell check/);
    const u = updateLedger(entries, [{ id: 'R1', result: 'ok', cls: 'passed' }]);
    const h = formatLedgerHoldMessage({ entries: u, holdIndex: 1, maxHolds: 1, remainingFrac: 0.7 });
    expect(h).toMatch(/hold 1\/1/); expect(h).toMatch(/70%/); expect(h).toMatch(/R2 \[threshold\]/); expect(h).not.toMatch(/R1 \[contract\]/);
    expect(formatLedgerForJudge(u)).toMatch(/R1 \[contract\] EXERCISED/);
    expect(formatLedgerForWriter([])).toBe('');
  });
});

describe('R187b Jev as the per-line verifier', () => {
  const entries = initLedger(parseRequirementLedger(RAW, 8));
  it('asks one question per pending line only, with the evidence in the state and never a verdict', () => {
    const u = updateLedger(entries, [{ id: 'R1', result: 'ok', cls: 'passed' }]);
    const q = buildLedgerJevQuestions(u);
    expect(Object.keys(q)).toEqual(['met_R2', 'met_R3', 'met_R4']);
    const st = buildLedgerJevState({ task: 'T', entries: u, attestation: '{"requirements":[...]}', workProduct: 'tail' });
    expect((st.requirements_to_decide as any[]).map((r) => r.id)).toEqual(['R2', 'R3', 'R4']);
    expect(JSON.stringify(st)).not.toMatch(/meets|verdict|judge/i);
  });
  it('closes lines at or above the threshold with jev provenance, leaves the rest pending', () => {
    const r = applyLedgerJevAnswers(entries, { met_R1: 0.9, met_R2: 0.4, met_R3: 0.75 }, 0.7);
    expect(r.closed).toEqual(['R1', 'R3']); expect(r.asked).toBe(3);
    expect(r.entries.map((e) => e.status)).toEqual(['exercised', 'open', 'exercised', 'unverifiable']);
    expect(r.entries[0]!.lastResult).toMatch(/jev: met/); expect(r.entries[1]!.lastResult).toMatch(/not shown met/);
    expect(applyLedgerJevAnswers(entries, null).closed).toEqual([]);
  });
});

describe('R191 extractor hygiene (L7 09-23: persona example copied into a ledger; conduct lines wasting slots; a guessed checker CLI failing every finish)', () => {
  it('the persona carries no task-specific example text and the prompt marks the format example as unrelated', () => {
    expect(REQ_LEDGER_SYSTEM).not.toMatch(/DOM must not change|crm_leads|recall ≥ 0\.96|after a respawn/);
    expect(REQ_LEDGER_SYSTEM).toMatch(/never copy the example/); expect(REQ_LEDGER_SYSTEM).toMatch(/SKIP instructions about the agent/); expect(REQ_LEDGER_SYSTEM).toMatch(/EXACTLY as the task text or the environment report/);
    expect(buildRequirementLedgerPrompt('Do X', undefined, 6)).toMatch(/UNRELATED task — never copy it/);
  });
  it('drops conduct lines (time budget, no cheating, no online hints) and keeps stated requirements', () => {
    expect(isBoilerplateRequirement('Complete within 28800 seconds')).toBe(true);
    expect(isBoilerplateRequirement('Complete task within 28800 seconds')).toBe(true);
    expect(isBoilerplateRequirement('Must not cheat by using online solutions or hints specific to this task')).toBe(true);
    expect(isBoilerplateRequirement('must not use online solutions or hints specific to this task')).toBe(true);
    expect(isBoilerplateRequirement('notifications within 5 s after a respawn')).toBe(false);
    expect(isBoilerplateRequirement('global pairwise precision ≥ 0.98 across all records')).toBe(false);
    const l = parseRequirementLedger(`REQ 1 | artifact | write /app/out.json | CHECK: test -f /app/out.json\nREQ 2 | constraint | Complete within 28800 seconds | CHECK: NONE\nREQ 3 | constraint | Do not cheat by using online solutions | CHECK: NONE\nREQ 4 | threshold | recall >= 0.9 | CHECK: NONE`, 8);
    expect(l.map((x) => x.text)).toEqual(['write /app/out.json', 'recall >= 0.9']); expect(l.map((x) => x.id)).toEqual(['R1', 'R2']);
  });
  it('a usage error, missing script or syntax error in the CHECK is broken, not a failure; a real failing check and a pass are not', () => {
    expect(looksLikeBrokenCheck('CHECK RUN: `python3 /app/check.py a b` → FAILED (exit 2) in 90 ms\nusage: check.py [-h] [--layout N]\ncheck.py: error: unrecognized arguments: a b')).toBe(true);
    expect(looksLikeBrokenCheck('CHECK RUN: `python3 /app/nope.py` → FAILED (exit 2) in 9 ms\npython3: can\'t open file \'/app/nope.py\': [Errno 2] No such file or directory')).toBe(true);
    expect(looksLikeBrokenCheck('CHECK RUN: `python3 -c "import json; d=json.load(open(x)); exit(1 if"` → FAILED (exit 1) in 9 ms\n  File "<string>", line 1\nSyntaxError: invalid syntax')).toBe(true);
    expect(looksLikeBrokenCheck('CHECK RUN: `jq . x` → FAILED (exit 127) in 2 ms\nsh: 1: jq: not found')).toBe(true);
    expect(looksLikeBrokenCheck('CHECK RUN: `python3 -c "..."` → FAILED (exit 1) in 40 ms\nmissing nets: [\'net_07\', \'net_08\']')).toBe(false);
    expect(looksLikeBrokenCheck('CHECK RUN: `test -f /app/out.json` → FAILED (exit 1) in 1 ms\nmissing /app/out.json')).toBe(false);
    expect(looksLikeBrokenCheck('CHECK RUN: `python3 /app/check.py` → PASSED in 40 ms\nusage note: fine')).toBe(false);
  });
  it('a broken check makes the line unverifiable with its check dropped, so it is never re-run or counted failed and falls to Jev', () => {
    const e = initLedger(parseRequirementLedger('REQ 1 | command | checker passes | CHECK: python3 /app/check.py a b', 8));
    const u = updateLedger(e, [{ id: 'R1', result: 'CHECK RUN: `python3 /app/check.py a b` → FAILED (exit 2) in 9 ms\nusage: check.py [-h]', cls: 'broken' }]);
    expect(u[0]).toMatchObject({ status: 'unverifiable', check: null, runs: 1 }); expect(u[0]!.lastResult).toMatch(/malformed and has been dropped \(usage: check.py/);
    expect(ledgerCounts(u)).toEqual({ lines: 1, open: 0, exercised: 0, failed: 0, unverifiable: 1 });
    expect(Object.keys(buildLedgerJevQuestions(u))).toEqual(['met_R1']);
    expect(formatLedgerForJudge(u)).toMatch(/R1 \[command\] UNVERIFIABLE/);
  });
});

describe('R192 ledger-failed veto + Jev arbitration in shadow', () => {
  const base = initLedger(parseRequirementLedger('REQ 1 | constraint | min separation 10 um | CHECK: python3 /app/check.py\nREQ 2 | artifact | /app/out.json exists | CHECK: test -f /app/out.json\nREQ 3 | contract | duplicate submit is a no-op | CHECK: NONE', 8));
  const failed = updateLedger(base, [{ id: 'R1', result: 'CHECK RUN: `python3 /app/check.py` → FAILED (exit 1) in 40 ms\nnet_03 separation 7.2 um < 10 um', cls: 'failed' }, { id: 'R2', result: 'CHECK RUN: `test -f /app/out.json` → PASSED in 1 ms', cls: 'passed' }]);
  it('fires only on accept-with-gap with a line failed at THIS finish, under the cap and above its own floor', () => {
    const ok = { action: 'accept-with-gap', failedNow: ['R1'], vetoesUsed: 0, max: 2, remainingFrac: 0.6, minRemaining: 0.25 };
    expect(ledgerFailVetoable(ok)).toBe(true);
    expect(ledgerFailVetoable({ ...ok, action: 'accept' })).toBe(false);
    expect(ledgerFailVetoable({ ...ok, action: 'veto' })).toBe(false);
    expect(ledgerFailVetoable({ ...ok, failedNow: [] })).toBe(false);
    expect(ledgerFailVetoable({ ...ok, vetoesUsed: 2 })).toBe(false);
    expect(ledgerFailVetoable({ ...ok, remainingFrac: 0.2 })).toBe(false);
    expect(ledgerFailVetoable({ ...ok, remainingFrac: null })).toBe(true);
    expect(ledgerFailVetoable({ ...ok, minRemaining: 0, remainingFrac: 0.01 })).toBe(true);
  });
  it('asks Jev one defect question per failed line with the check, its output and the attestation in the state', () => {
    const q = buildLedgerFailJevQuestions(failed, ['R1']);
    expect(Object.keys(q)).toEqual(['defect_R1']); expect(q.defect_R1!.instructions).toMatch(/DEFECT OF THE CHECK ITSELF/); expect(q.defect_R1!.instructions).not.toMatch(/accept|verdict/i);
    const st = buildLedgerFailJevState({ task: 'route nets', entries: failed, failedNow: ['R1'], attestation: 'I ran the checker: all good' }) as any;
    expect(st.failed_checks).toHaveLength(1); expect(st.failed_checks[0]).toMatchObject({ id: 'R1', harness_check: 'python3 /app/check.py' }); expect(st.failed_checks[0].harness_output).toMatch(/7.2 um/); expect(st.writer_attestation).toMatch(/all good/);
    expect(Object.keys(buildLedgerFailJevQuestions(failed, ['R2']))).toEqual([]); // passed lines are never asked
  });
  it('shadow banks the probabilities and changes nothing; on downgrades a confident defect to unverifiable and drops it from failedNow', () => {
    const sh = applyLedgerFailJevAnswers(failed, ['R1'], { defect_R1: 0.91 }, 0.7, false);
    expect(sh).toMatchObject({ asked: 1, defects: ['R1'], probs: { R1: 0.91 }, failedNow: ['R1'] }); expect(sh.entries[0]!.status).toBe('failed'); expect(sh.entries[0]!.check).toBe('python3 /app/check.py');
    const on = applyLedgerFailJevAnswers(failed, ['R1'], { defect_R1: 0.91 }, 0.7, true);
    expect(on.failedNow).toEqual([]); expect(on.entries[0]).toMatchObject({ status: 'unverifiable', check: null }); expect(on.entries[0]!.lastResult).toMatch(/check itself is defective \(0.91\)/);
    const low = applyLedgerFailJevAnswers(failed, ['R1'], { defect_R1: 0.3 }, 0.7, true);
    expect(low.failedNow).toEqual(['R1']); expect(low.defects).toEqual([]); expect(low.entries[0]!.status).toBe('failed');
    expect(applyLedgerFailJevAnswers(failed, ['R1'], null, 0.7, true)).toMatchObject({ asked: 0, defects: [], failedNow: ['R1'] });
  });
  it('the veto message names only the lines failed at this finish, with check and output, and the budget left', () => {
    const m = formatLedgerFailVetoMessage({ entries: failed, failedNow: ['R1'], vetoIndex: 1, max: 2, remainingFrac: 0.53 });
    expect(m).toMatch(/hold 1\/2/); expect(m).toMatch(/53%/); expect(m).toMatch(/R1 \[constraint\] min separation/); expect(m).toMatch(/harness check: python3 \/app\/check.py/); expect(m).toMatch(/7.2 um < 10 um/);
    expect(m).not.toMatch(/R2 \[artifact\]/); expect(m).not.toMatch(/R3 \[contract\]/); expect(m).toMatch(/If you believe a check is itself wrong/);
  });
});
