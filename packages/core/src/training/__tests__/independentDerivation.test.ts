import { describe, it, expect } from 'vitest';
import { DERIVATION_SYSTEM, buildDerivationPrompt, parseDerivationReply, methodsDiffer, parseValueLines, extractNumbers, reconcile, buildDerivationHoldMessage, isValueShapedTask, isDerivationCommandAllowed, checkRunPassed, checkRunBody } from '../independentDerivation.js';
import { isInvestigateCommandAllowed } from '../judgeEvidence.js';

describe('R176 independentDerivation — elicitation + parsing', () => {
  it('persona demands a different route and VALUE lines; prompt carries task, deliverable, summary, value names', () => {
    expect(DERIVATION_SYSTEM).toContain('genuinely different route'); expect(DERIVATION_SYSTEM).toContain('VALUE <name>=');
    const p = buildDerivationPrompt({ task: 'Compute beta activity', deliverable: '{"beta": 0.412}', agentSummary: 'used numpy trapezoid', values: ['beta'] });
    expect(p).toContain('TASK:'); expect(p).toContain('"beta": 0.412'); expect(p).toContain('numpy trapezoid'); expect(p).toContain('VALUES TO RECOMPUTE'); expect(p).toContain('beta');
  });
  it('parses METHOD lines and CHECK lines, deduped and capped', () => {
    const r = parseDerivationReply('METHOD_AGENT: numpy trapezoid over the spectrum\nMETHOD_INDEPENDENT: analytic integral of the fitted gaussian\nCHECK: python3 /tmp/a.py\n- CHECK: `python3 /tmp/b.py`\nCHECK: python3 /tmp/a.py\nCHECK: c\nCHECK: d\n', 3);
    expect(r.methodAgent).toBe('numpy trapezoid over the spectrum'); expect(r.methodIndependent).toBe('analytic integral of the fitted gaussian');
    expect(r.checks).toEqual(['python3 /tmp/a.py', 'python3 /tmp/b.py', 'c']);
    expect(parseDerivationReply('nothing here').checks).toEqual([]);
  });
  it('methodsDiffer: same tokens → not different; distinct routes → different', () => {
    expect(methodsDiffer('numpy trapezoid over the spectrum', 'numpy trapezoid over the spectrum again')).toBe(false);
    expect(methodsDiffer('numpy trapezoid over the spectrum', 'analytic integral of the fitted gaussian')).toBe(true);
    expect(methodsDiffer('', 'brute force enumeration')).toBe(true);
  });
});

describe('R176 independentDerivation — reconciliation', () => {
  it('parses VALUE lines and extracts numbers from JSON/CSV/prose', () => {
    expect(parseValueLines('junk\nVALUE total=82\nVALUE max_id = 4\nVALUE name=Alice Smith\n')).toEqual({ total: '82', max_id: '4', name: 'Alice Smith' });
    expect(extractNumbers('{"total": 82, "ratio": 0.4125, "id": "x1"}')).toEqual([82, 0.4125]);
    expect(extractNumbers('a,b\n1.5e3,-2\n')).toEqual([1500, -2]);
  });
  it('agrees within tolerance, disagrees outside it, string values by containment, inconclusive with nothing derived', () => {
    const d = '{"total": 82, "max_id": 4, "beta": 0.41249}';
    expect(reconcile(d, { total: '82', beta: '0.4125' }).agreement).toBe('agree');
    expect(reconcile(d, { total: '91' }).agreement).toBe('disagree');
    expect(reconcile(d, { beta: '0.4131' }, 1e-3).agreement).toBe('disagree');
    expect(reconcile(d, { beta: '0.4131' }, 5e-3).agreement).toBe('agree');
    expect(reconcile('answer: c.1234A>G', { hgvs: 'c.1234A>G' }).agreement).toBe('agree');
    expect(reconcile('answer: c.1234A>G', { hgvs: 'c.1235A>G' }).agreement).toBe('disagree');
    expect(reconcile(d, {}).agreement).toBe('inconclusive');
    expect(reconcile(d, { total: '82', keys: 'max_id,mean,total' }).agreement).toBe('agree'); // numbers decide; a descriptive string cannot override them
    const r = reconcile(d, { total: '91' }); expect(r.compared[0]).toMatchObject({ name: 'total', derived: '91', matched: null }); expect(r.compared[0]!.rel).toBeCloseTo(0.0989, 3);
  });
  it('hold message names the disputed values and the independent method', () => {
    const r = reconcile('{"total": 82}', { total: '91', count: '4' });
    const m = buildDerivationHoldMessage({ methodIndependent: 'awk sum over the CSV', compared: r.compared, remainingFrac: 0.7 });
    expect(m).toContain('EndTurn HELD (independent check)'); expect(m).toContain('awk sum over the CSV'); expect(m).toContain('total: your deliverable contains no value matching it; an independent recomputation gives 91');
    expect(m).toContain('count: your deliverable contains no value matching it; an independent recomputation gives 4'); expect(m).toContain('70% of the wall budget');
  });
});

describe('R176 independentDerivation — value-shaped task heuristic (v1.1, measured on the 64 TB4.0 texts 2026-09-21)', () => {
  it('needs an OUTPUT artifact AND value language', () => {
    expect(isValueShapedTask('Compute the beta activity of the sample and write it to /app/results.txt with 3 decimals.').valueShaped).toBe(true);
    expect(isValueShapedTask('Decrypt the ciphertext in /app/data/cipher.txt and write the plaintext to /app/out/plain.txt').valueShaped).toBe(true);
    expect(isValueShapedTask('Fix the failing build of the web server so that `make test` passes.').valueShaped).toBe(false);
    expect(isValueShapedTask('Write /app/out.step containing the CAD model described in the drawing.').valueShaped).toBe(false);
    expect(isValueShapedTask('Calculate the total but do not write any file').valueShaped).toBe(false);
    expect(isValueShapedTask('Compute X and save /app/out/summary.json').artifacts).toEqual(['/app/out/summary.json']);
  });
  it('an input path is not a deliverable; save-as / named-and-save-inside / Create: lists are', () => {
    expect(isValueShapedTask('Use the `/app/data/InterPro-domain-information.tsv` table to determine the most C-terminal domain.').valueShaped).toBe(false);
    expect(isValueShapedTask('The measurements are in `/app/data/TB3_Conf_Properties.csv`. Provide your answers as a CSV file named `TB3_Conf_Answers.csv` and save it inside `/results/`.').artifacts).toEqual(['/results/']);
    expect(isValueShapedTask('Transcribe the four-part SATB chorale in `/app/audio/task.mp3` into MusicXML and save it as `/app/score.musicxml`.').valueShaped).toBe(true);
    const r = isValueShapedTask('Recover the ordered rule set. Create:\n- `/app/rules.json` — a JSON array of rule objects\n- `/app/ordering.txt` — one rule name per line');
    expect(r.valueShaped).toBe(true); expect(r.artifacts).toEqual(['/app/rules.json', '/app/ordering.txt']);
    expect(isValueShapedTask('Determine the detection limit. Report the results in a file named `results.txt` at `/app/results.txt`, using exactly this format.').artifacts).toEqual(['/app/results.txt']);
    expect(isValueShapedTask('Compute the total. The training observations are in `/app/data/temperature_profiles.csv`; the key set must match `/app/reference_output/expected_keys.json` exactly.').valueShaped).toBe(false);
    expect(isValueShapedTask('Build a `dispatch` CLI as described in `/app/packet/OUTPUT_SCHEMA.md`; the executable must be available at `/workspace/dispatch`.').valueShaped).toBe(false);
  });
});

describe('R176 independentDerivation — runner allow rule', () => {
  it('allows scratch writes under /tmp, refuses writes elsewhere and the R170 denylist', () => {
    const ok = (c: string) => isDerivationCommandAllowed(c, isInvestigateCommandAllowed);
    expect(ok("cat > /tmp/d.py <<'EOF'\nprint(1)\nEOF\npython3 /tmp/d.py")).toBe(true);
    expect(ok('python3 -c "print(sum(1 for _ in open(\'/app/data/x.csv\')))" > /tmp/out.txt; cat /tmp/out.txt')).toBe(true);
    expect(ok('awk -F, "NR>1{s+=$2} END{print \"VALUE total=\" s}" data/scores.csv | tee /tmp/v.txt')).toBe(true);
    expect(ok('python3 -c "print(1)" > /app/out/summary.json')).toBe(false);
    expect(ok('rm -rf /app/out; python3 /tmp/d.py')).toBe(false);
    expect(ok('sort data/scores.csv > results.txt')).toBe(false);
    expect(ok('python3 -c "import csv; print(\"VALUE total=1\")"')).toBe(true);
  });
});

describe('R176b — multi-line CHECK blocks, failed checks derive nothing, heredoc bodies are not redirects (cell r176 field read 2026-09-21)', () => {
  it('a heredoc CHECK is kept whole; fences stripped; the next marker ends it', () => {
    const r = parseDerivationReply("METHOD_AGENT: xlrd\nMETHOD_INDEPENDENT: openpyxl from first principles\nCHECK: cat > /tmp/d.py <<'EOF'\nimport sys\nif 3 > 2: print('VALUE eff=0.412')\nEOF\npython3 /tmp/d.py\nCHECK: ```sh\nawk 'NR>1{s+=$2} END{print \"VALUE total=\" s}' /app/data/x.csv\n```\n");
    expect(r.checks.length).toBe(2);
    expect(r.checks[0]).toBe("cat > /tmp/d.py <<'EOF'\nimport sys\nif 3 > 2: print('VALUE eff=0.412')\nEOF\npython3 /tmp/d.py");
    expect(r.checks[1]).toBe("awk 'NR>1{s+=$2} END{print \"VALUE total=\" s}' /app/data/x.csv");
    expect(parseDerivationReply('CHECK: python3 -c "\nprint(1)\n"').checks[0]).toBe('python3 -c "\nprint(1)\n"');
  });
  it('checkRunPassed / checkRunBody read the harness header; a FAILED run must not feed the fallback', () => {
    const failed = 'CHECK RUN: `python3 -c "` → FAILED (exit 2) in 9 ms\n/bin/sh: 1: Syntax error: Unterminated quoted string';
    const passed = 'CHECK RUN: `python3 /tmp/d.py` → PASSED in 40 ms\n0.412\nVALUE eff=0.412';
    expect(checkRunPassed(failed)).toBe(false); expect(checkRunPassed(passed)).toBe(true);
    const multi = "CHECK RUN: `python3 - <<'EOF'\nimport pandas as pd\nprint('VALUE eff=0.412')\nEOF` → PASSED in 812 ms\nVALUE eff=0.412\n";
    expect(checkRunPassed(multi)).toBe(true); expect(checkRunBody(multi)).toBe('VALUE eff=0.412\n'); // R176c: the verdict sits after a multi-line command
    const multiFail = "CHECK RUN: `python3 - <<'EOF'\nprint(1)\nEOF` → FAILED (exit 1) in 30 ms\nTraceback\n";
    expect(checkRunPassed(multiFail)).toBe(false); expect(checkRunBody(multiFail)).toBe('Traceback\n');
    expect(checkRunBody(passed)).toBe('0.412\nVALUE eff=0.412');
    expect(parseValueLines(checkRunBody(passed))).toEqual({ eff: '0.412' });
    expect(extractNumbers(checkRunBody(failed))).toEqual([1]); // the trap: this "1" is a shell diagnostic — callers must gate on checkRunPassed first
  });
  it('the heredoc body may contain > comparisons and still pass the allow rule; a real redirect outside /tmp is still refused', () => {
    const ok = (c: string) => isDerivationCommandAllowed(c, isInvestigateCommandAllowed);
    expect(ok("cat > /tmp/d.py <<'EOF'\nimport csv\nrows=[r for r in csv.reader(open('/app/data/x.csv')) if float(r[1]) > 0.5]\nprint('VALUE n=' + str(len(rows)))\nEOF\npython3 /tmp/d.py")).toBe(true);
    expect(ok("cat > /tmp/d.py <<'EOF'\nprint(1)\nEOF\npython3 /tmp/d.py > /app/out.txt")).toBe(false);
  });
});
