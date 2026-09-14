import { describe, it, expect, vi } from 'vitest';
import {
  resolveHerdrReporting,
  HerdrReporter,
  HERDR_SOURCE,
  HERDR_DISPLAY_SOURCE,
  type HerdrExecFn,
} from '../herdrReporter.js';

const BIN = '/fake/bin/herdr';
const PANE = 'pane-42';

function envOn(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return { HERDR_ENV: '1', HERDR_PANE_ID: PANE, PATH: '/fake/bin', ...extra };
}
const isExec = (p: string) => p === BIN;

function makeReporter(opts: Partial<ConstructorParameters<typeof HerdrReporter>[0]> = {}) {
  const calls: string[][] = [];
  const exec: HerdrExecFn = vi.fn((_binary, args) => { calls.push(args); });
  let now = 10_000;
  const timers: Array<{ at: number; fn: () => void }> = [];
  const reporter = new HerdrReporter({
    binary: BIN,
    paneId: PANE,
    agentName: 'cortex',
    exec,
    now: () => now,
    setTimer: (fn, ms) => { timers.push({ at: now + ms, fn }); return {} as NodeJS.Timeout; },
    warn: vi.fn(),
    ...opts,
  });
  const advance = (ms: number) => {
    now += ms;
    const due = timers.filter((t) => t.at <= now);
    timers.splice(0, timers.length, ...timers.filter((t) => t.at > now));
    for (const t of due) t.fn();
  };
  return { reporter, calls, exec, advance, timers };
}

describe('resolveHerdrReporting (R145 HB-HERDR-LIFECYCLE)', () => {
  it('disabled unless HERDR_ENV=1', () => {
    const r = resolveHerdrReporting({ PATH: '/fake/bin', HERDR_PANE_ID: PANE }, isExec);
    expect(r.enabled).toBe(false);
    expect(r.reason).toMatch(/HERDR_ENV/);
    expect(resolveHerdrReporting(envOn({ HERDR_ENV: '0' }), isExec).enabled).toBe(false);
  });

  it('CORTEX_HERDR_REPORTING=false disables even inside a herdr pane', () => {
    const r = resolveHerdrReporting(envOn({ CORTEX_HERDR_REPORTING: 'false' }), isExec);
    expect(r.enabled).toBe(false);
    expect(r.reason).toMatch(/CORTEX_HERDR_REPORTING/);
  });

  it('disabled when the herdr binary is not on PATH (never scans /nix/store)', () => {
    const scanned: string[] = [];
    const r = resolveHerdrReporting(envOn({ PATH: '/nope:/also/nope' }), (p) => { scanned.push(p); return false; });
    expect(r.enabled).toBe(false);
    expect(r.reason).toMatch(/PATH/);
    expect(scanned.some((p) => p.startsWith('/nix/store'))).toBe(false);
  });

  it('disabled when HERDR_PANE_ID is unset (herdr 0.9.0 report-agent needs a pane id)', () => {
    const r = resolveHerdrReporting({ HERDR_ENV: '1', PATH: '/fake/bin' }, isExec);
    expect(r.enabled).toBe(false);
    expect(r.reason).toMatch(/HERDR_PANE_ID/);
  });

  it('enabled inside a pane with herdr on PATH; agent name defaults to cortex; bin = resolved path', () => {
    const r = resolveHerdrReporting(envOn(), isExec);
    expect(r).toEqual({ enabled: true, bin: BIN, paneId: PANE, agentName: 'cortex' });
  });

  it('CORTEX_HERDR_BIN (or legacy HERDR_BIN) wins over everything; CORTEX_HERDR_AGENT_NAME is sanitized to the herdr name grammar', () => {
    const r = resolveHerdrReporting(envOn({ CORTEX_HERDR_BIN: '/opt/herdr', HERDR_BIN_PATH: '/pane/herdr', CORTEX_HERDR_AGENT_NAME: 'My Agent!' }), (p) => p === '/opt/herdr' || p === '/pane/herdr' || p === BIN);
    expect(r.enabled).toBe(true);
    expect(r.bin).toBe('/opt/herdr');
    expect(r.agentName).toBe('my-agent');
    const legacy = resolveHerdrReporting(envOn({ HERDR_BIN: '/opt/herdr', PATH: '' }), (p) => p === '/opt/herdr');
    expect(legacy.bin).toBe('/opt/herdr');
  });

  it('HERDR_BIN_PATH (the pane export) is used when executable, even with no PATH hit', () => {
    const r = resolveHerdrReporting(envOn({ HERDR_BIN_PATH: '/home/x/.local/bin/herdr', PATH: '/nope' }), (p) => p === '/home/x/.local/bin/herdr');
    expect(r.enabled).toBe(true);
    expect(r.bin).toBe('/home/x/.local/bin/herdr');
  });

  it('HERDR_BIN_PATH set but not executable falls through to the PATH probe', () => {
    const r = resolveHerdrReporting(envOn({ HERDR_BIN_PATH: '/stale/herdr' }), isExec);
    expect(r.enabled).toBe(true);
    expect(r.bin).toBe(BIN);
    const none = resolveHerdrReporting(envOn({ HERDR_BIN_PATH: '/stale/herdr', PATH: '/nope' }), isExec);
    expect(none.enabled).toBe(false);
    expect(none.reason).toMatch(/PATH/);
  });
});

describe('HerdrReporter', () => {
  it('report(working) spawns the exact report-agent argv against the pane id', () => {
    const { reporter, calls, exec } = makeReporter();
    reporter.report('working');
    expect(exec).toHaveBeenCalledTimes(1);
    expect(vi.mocked(exec).mock.calls[0]![0]).toBe(BIN);
    expect(calls[0]).toEqual(['pane', 'report-agent', PANE, '--source', HERDR_SOURCE, '--agent', 'cortex', '--state', 'working']);
  });

  it('a summary adds the separate report-metadata call with the summary token', () => {
    const { reporter, calls } = makeReporter();
    reporter.report('working', 'turn:1');
    expect(calls).toEqual([
      ['pane', 'report-agent', PANE, '--source', HERDR_SOURCE, '--agent', 'cortex', '--state', 'working'],
      ['pane', 'report-metadata', PANE, '--source', HERDR_DISPLAY_SOURCE, '--token', 'summary=turn:1'],
    ]);
  });

  it('dedupes: the same state+summary again is skipped; a summary-only change sends only metadata', () => {
    const { reporter, calls, advance } = makeReporter();
    reporter.report('working', 'turn:1');
    advance(300);
    reporter.report('working', 'turn:1');
    expect(calls).toHaveLength(2);
    advance(300);
    reporter.report('working', 'tool:Bash');
    expect(calls).toHaveLength(3);
    expect(calls[2]).toEqual(['pane', 'report-metadata', PANE, '--source', HERDR_DISPLAY_SOURCE, '--token', 'summary=tool:Bash']);
  });

  it('throttles to one emit per 250 ms and coalesces to the latest pending report', () => {
    const { reporter, calls, advance, timers } = makeReporter();
    reporter.report('working', 'turn:1');
    advance(50);
    reporter.report('working', 'tool:Read');
    reporter.report('working', 'tool:Bash');
    reporter.report('blocked', 'waiting-approval');
    expect(calls).toHaveLength(2); // only the first emit went out
    expect(timers).toHaveLength(1);
    advance(200); // 250 ms since the first emit
    expect(calls).toHaveLength(4);
    expect(calls[2]).toEqual(['pane', 'report-agent', PANE, '--source', HERDR_SOURCE, '--agent', 'cortex', '--state', 'blocked']);
    expect(calls[3]).toEqual(['pane', 'report-metadata', PANE, '--source', HERDR_DISPLAY_SOURCE, '--token', 'summary=waiting-approval']);
  });

  it('a coalesced pending report equal to the last emitted one is dropped', () => {
    const { reporter, calls, advance } = makeReporter();
    reporter.report('working', 'turn:1');
    advance(10);
    reporter.report('blocked');
    reporter.report('working', 'turn:1');
    advance(250);
    expect(calls).toHaveLength(2);
  });

  it('exec failure: one [WARN] and the reporter disables itself; never throws', () => {
    const warn = vi.fn();
    const exec: HerdrExecFn = (_b, _a, onError) => { onError(new Error('ENOENT')); };
    const { reporter } = makeReporter({ exec, warn });
    expect(() => reporter.report('working', 'turn:1')).not.toThrow();
    reporter.report('idle', 'turn:1');
    reporter.report('working', 'turn:3');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toMatch(/^\[WARN\] herdr lifecycle reporting disabled: /);
    expect(warn.mock.calls[0]![0]).toContain('ENOENT');
    expect(warn.mock.calls[0]![0]).toContain(`(bin ${BIN})`);
    expect(reporter.disabled).toBe(true);
  });

  it('a synchronously throwing exec is also contained', () => {
    const warn = vi.fn();
    const exec: HerdrExecFn = () => { throw new Error('spawn EACCES'); };
    const { reporter } = makeReporter({ exec, warn });
    expect(() => reporter.report('working')).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(reporter.disabled).toBe(true);
  });

  it('summary tokens are sanitized (no whitespace, bounded length)', () => {
    const { reporter, calls } = makeReporter();
    reporter.report('working', 'tool:Bash and then\nsomething ' + 'x'.repeat(200));
    const token = calls[1]![6]!;
    expect(token.startsWith('summary=tool:Bash_and_then_something_')).toBe(true);
    expect(token.length).toBeLessThanOrEqual('summary='.length + 64);
  });
});
