import { describe, it, expect } from 'vitest';
import { stripAnsi, parsePromptRc, promptIsBack, clipScreen, buildStateCard, repeatCount, parseFrameAction, buildMenu, buildFrameSuffix, waitPolicy, extractTaskTestCommand, FRAME_DEFAULTS } from '../terminusFrame.js';

const SCREEN = '\x1b[?2004hroot@16e9a8fba9d5:/app# python3 run.py\r\n\x1b[?2004l\rroute: NAN -> SUV\r\nsummary: {"total": 568.7}\r\n__RC=0\r\n\x1b[?2004hroot@16e9a8fba9d5:/app# ';

describe('R179 terminusFrame — screen', () => {
  it('strips ANSI/bracketed-paste and normalizes CRLF; reads the prompt rc; detects the prompt', () => {
    const s = stripAnsi(SCREEN);
    expect(s).not.toMatch(/\x1b/); expect(s).not.toMatch(/\r/);
    expect(parsePromptRc(SCREEN)).toBe(0);
    expect(parsePromptRc('a\n__RC=2\nb\n__RC=127\nroot@x:/# ')).toBe(127);
    expect(parsePromptRc('no rc here')).toBeNull();
    expect(promptIsBack(SCREEN)).toBe(true);
    expect(promptIsBack('root@x:/app# make test\ncompiling…\n[ 40%] Building')).toBe(false);
    expect(promptIsBack('$ ')).toBe(true);
  });
  it('clips a long capture to its tail and says so', () => {
    const long = Array.from({ length: 400 }, (_, i) => `line ${i}`).join('\n');
    const r = clipScreen(long, 500); expect(r.clipped).toBe(true); expect(r.text.startsWith('…[earlier output hidden')).toBe(true); expect(r.text.endsWith('line 399')).toBe(true);
    expect(clipScreen('short').clipped).toBe(false);
  });
});

describe('R179 terminusFrame — state card', () => {
  const history = [
    { keystrokes: 'ls /app\n', rc: 0, outcome: '12 files' },
    { keystrokes: 'pytest -q\n', rc: 1, outcome: '2 failed' },
    { keystrokes: 'pytest -q\n', rc: 1, outcome: '2 failed' },
  ];
  it('computes counts, repeats and the digest in code; bounded', () => {
    const card = buildStateCard({ cwd: '/app', turn: 7, budgetUsedFrac: 0.42, budgetLeftS: 3600, history, lastElapsedS: 12.4, openItems: 'the hidden test for empty input', planStep: 'fix the parser' });
    expect(card).toContain('turn 7 · commands run 3 · repeated commands 1');
    expect(card).toContain('last command: pytest -q → rc 1 in 12 s');
    expect(card).toContain('budget used 42%, 60 min left');
    expect(card).toContain('plan step: fix the parser'); expect(card).toContain('open items from the last hold: the hidden test');
    expect(card).toContain('1. ls /app → rc 0 · 12 files');
    expect(buildStateCard({ cwd: '/app', turn: 1, budgetUsedFrac: null, budgetLeftS: null, history: [] })).toContain('last command: (none yet)');
    expect(buildStateCard({ cwd: '/app', turn: 1, budgetUsedFrac: 0, budgetLeftS: 100, history, openItems: 'x'.repeat(5000) }, 800).length).toBeLessThanOrEqual(800);
    expect(buildStateCard({ cwd: '/app', turn: 2, budgetUsedFrac: 0.1, budgetLeftS: 10, history, commandStillRunning: true })).toContain('(STILL RUNNING)');
  });
  it('repeatCount is exact and whitespace-normalized', () => {
    expect(repeatCount(history, 'pytest   -q\n')).toBe(2); expect(repeatCount(history, 'pytest -q -x\n')).toBe(0); expect(repeatCount(history, '')).toBe(0);
  });
});

describe('R179 terminusFrame — action parsing (ours and Terminus 2\'s shape)', () => {
  it('parses our shape, fenced, with k candidates capped and durations bounded', () => {
    const a = parseFrameAction('```json\n{"analysis":"tests fail on empty input","plan":"add a guard","candidates":[{"label":"edit parser","keystrokes":"vim parser.py\\n","durationS":3,"why":"guard"},{"keystrokes":"pytest -q\\n","duration_s":900},{"keystrokes":"","duration":10},{"keystrokes":"echo 4\\n"}],"task_complete":false}\n```');
    expect(a.parsed).toBe(true); expect(a.candidates.length).toBe(FRAME_DEFAULTS.maxCandidates);
    expect(a.candidates[0]).toMatchObject({ label: 'edit parser', keystrokes: 'vim parser.py\n', durationS: 3, why: 'guard' });
    expect(a.candidates[1]!.durationS).toBe(FRAME_DEFAULTS.maxDurationS); // 900 requested → capped at 60 expect(a.candidates[1]!.label).toBe('pytest -q');
    expect(a.candidates[2]).toMatchObject({ label: 'wait', keystrokes: '', durationS: 10 });
  });
  it('accepts Terminus 2\'s {commands:[{keystrokes,duration}]} and task_complete-only; rejects empty', () => {
    const t = parseFrameAction('{"analysis":"a","plan":"p","commands":[{"keystrokes":"ls\\n","duration":1}],"task_complete":false}');
    expect(t.parsed).toBe(true); expect(t.candidates[0]!.keystrokes).toBe('ls\n');
    const done = parseFrameAction('Here you go: {"analysis":"done","plan":"none","commands":[],"task_complete":true} thanks');
    expect(done.parsed).toBe(true); expect(done.taskComplete).toBe(true); expect(done.candidates).toEqual([]);
    expect(parseFrameAction('I will now run the tests.').parsed).toBe(false);
    expect(parseFrameAction('{"analysis":"x","plan":"y"}').error).toMatch(/no candidates/);
    expect(parseFrameAction('{"commands":[{"command":"make test"}]}').candidates[0]!.keystrokes).toBe('make test\n');
  });
});

describe('R179 terminusFrame — menu, suffix, waiting, test command', () => {
  const cands = [{ label: 'run tests', keystrokes: 'pytest -q\n', durationS: 30 }, { label: 'inspect', keystrokes: 'cat cfg.json\n', durationS: 2 }];
  it('menu = generator candidates first (c1 escape), then only the templates that apply; repeats annotated', () => {
    const m = buildMenu({ candidates: cands, taskTestCommand: 'make test', commandStillRunning: true, screenClipped: true, history: [{ keystrokes: 'pytest -q\n', rc: 1, outcome: '' }] });
    expect(m[0]).toMatchObject({ id: 'c1', source: 'generator', why: 'already run 1×' });
    expect(m.map((x) => x.id)).toEqual(['c1', 'c2', 't_wait', 't_interrupt', 't_more', 't_test', 't_reread', 't_finish']);
    expect(m.find((x) => x.id === 't_interrupt')!.keystrokes).toBe('C-c');
    expect(m.find((x) => x.id === 't_test')!.keystrokes).toBe('make test\n');
    const quiet = buildMenu({ candidates: cands });
    expect(quiet.map((x) => x.id)).toEqual(['c1', 'c2', 't_reread', 't_finish']);
  });
  it('the suffix carries state, screen, consequences and the template list — never probabilities', () => {
    const s = buildFrameSuffix({ screen: 'root@x:/app# ', stateCard: 'turn 3', menu: buildMenu({ candidates: cands }), consequences: ['The harness chose "inspect" over your first candidate.'] });
    expect(s).toContain('STATE:\nturn 3'); expect(s).toContain('SCREEN'); expect(s).toContain('FROM THE HARNESS:\n- The harness chose'); expect(s).toContain('- FINISH'); expect(s).not.toMatch(/0\.\d\d/);
    const quiet = buildFrameSuffix({ screen: 'x', stateCard: 'turn 4', menu: buildMenu({ candidates: cands }), templatesChanged: false });
    expect(quiet).not.toContain('- FINISH'); // unchanged standing templates are not resent (token diet)
    const running = buildFrameSuffix({ screen: 'x', stateCard: 'turn 5', menu: buildMenu({ candidates: cands, commandStillRunning: true }), templatesChanged: false });
    expect(running).toContain('MENU: WAIT'); expect(running).toContain('INTERRUPT');
  });
  it('waitPolicy: exactly the requested duration, one short grace while the screen still changes, then hand back STILL RUNNING', () => {
    expect(waitPolicy({ promptBack: true, screenChanged: false, waitedS: 1, durationS: 5 })).toBe('done');
    expect(waitPolicy({ promptBack: false, screenChanged: false, waitedS: 2, durationS: 5 })).toBe('extend');   // still inside the requested wait
    expect(waitPolicy({ promptBack: false, screenChanged: true, waitedS: 7, durationS: 5, graceS: 5 })).toBe('extend'); // grace, screen moving
    expect(waitPolicy({ promptBack: false, screenChanged: false, waitedS: 6, durationS: 5, graceS: 5 })).toBe('cap');   // nothing moving → hand back
    expect(waitPolicy({ promptBack: false, screenChanged: true, waitedS: 11, durationS: 5, graceS: 5 })).toBe('cap');   // grace exhausted
  });
  it('extracts a stated test command, else empty', () => {
    expect(extractTaskTestCommand('The build command `coqc -Q . Top Main.v` must exit 0. Run `make test` from /app.')).toBe('make test');
    expect(extractTaskTestCommand('Verify with `python3 -m pytest tests/ -q` before finishing')).toBe('python3 -m pytest tests/ -q');
    expect(extractTaskTestCommand('Write the answer to /app/results.txt')).toBe('');
  });
});
