import { describe, it, expect } from 'vitest';
import {
  resolveTurnStatusMode, turnStatusActive, formatStatusHM, formatStatusTokens, formatShellAge,
  backgroundShellsSegment, buildTurnStatusLine, appendStatusToNewestToolResult,
} from '../turnStatus.js';

const MIN = 60_000;
const H = 60 * MIN;

describe('HB-TURN-STATUS lever resolution', () => {
  it('unset / unknown = off', () => {
    expect(resolveTurnStatusMode({})).toBe('off');
    expect(resolveTurnStatusMode({ CORTEX_TURN_STATUS: '' })).toBe('off');
    expect(resolveTurnStatusMode({ CORTEX_TURN_STATUS: 'false' })).toBe('off');
    expect(resolveTurnStatusMode({ CORTEX_TURN_STATUS: 'bogus' })).toBe('off');
  });
  it('auto / on parse (case-insensitive)', () => {
    expect(resolveTurnStatusMode({ CORTEX_TURN_STATUS: 'AUTO' })).toBe('auto');
    expect(resolveTurnStatusMode({ CORTEX_TURN_STATUS: 'on' })).toBe('on');
    expect(resolveTurnStatusMode({ CORTEX_TURN_STATUS: 'true' })).toBe('on');
  });
  it('auto needs a deadline; on is always; off never', () => {
    expect(turnStatusActive('auto', 0)).toBe(false);
    expect(turnStatusActive('auto', 3_600_000)).toBe(true);
    expect(turnStatusActive('on', 0)).toBe(true);
    expect(turnStatusActive('off', 3_600_000)).toBe(false);
  });
});

describe('HB-TURN-STATUS formatting', () => {
  it('clock always carries hours', () => {
    expect(formatStatusHM(12 * MIN)).toBe('0h12m');
    expect(formatStatusHM(7 * H + 12 * MIN)).toBe('7h12m');
    expect(formatStatusHM(-5)).toBe('0h00m');
  });
  it('token counts compact', () => {
    expect(formatStatusTokens(840)).toBe('840');
    expect(formatStatusTokens(84_321)).toBe('84K');
    expect(formatStatusTokens(1_000_000)).toBe('1M');
    expect(formatStatusTokens(1_048_576)).toBe('1.05M');
  });
  it('shell age', () => {
    expect(formatShellAge(40_000)).toBe('0m40s');
    expect(formatShellAge(4 * MIN + 12_000)).toBe('4m12s');
    expect(formatShellAge(H + 4 * MIN)).toBe('1h04m');
  });
  it('full line with deadline + context window', () => {
    const line = buildTurnStatusLine({ elapsedMs: 12 * MIN, deadlineMs: 7 * H + 12 * MIN, contextTokens: 84_000, contextWindow: 1_000_000, shells: [] });
    expect(line).toBe('<system-reminder>STATUS: elapsed 0h12m of 7h12m (3%), ~7h00m left; context ~84K of 1M tokens (8%)</system-reminder>');
    // ~20-30 tokens: keep it short
    expect(line.length).toBeLessThan(130);
  });
  it('no deadline = elapsed only; unknown context omitted', () => {
    expect(buildTurnStatusLine({ elapsedMs: 5 * MIN, deadlineMs: 0 })).toBe('<system-reminder>STATUS: elapsed 0h05m</system-reminder>');
    expect(buildTurnStatusLine({ elapsedMs: 5 * MIN, deadlineMs: 0, contextTokens: 5000 })).toBe('<system-reminder>STATUS: elapsed 0h05m; context ~5K tokens</system-reminder>');
  });
});

describe('HB-TURN-STATUS background shells segment', () => {
  const now = 10 * H;
  it('none → omitted', () => {
    expect(backgroundShellsSegment([], now)).toBe('');
    expect(backgroundShellsSegment(null, now)).toBe('');
    expect(buildTurnStatusLine({ elapsedMs: MIN, deadlineMs: H, shells: [], nowMs: now })).not.toContain('bg:');
  });
  it('one running', () => {
    const seg = backgroundShellsSegment([{ shellId: 'bg-1a2b', command: 'npm run build', startTime: new Date(now - (4 * MIN + 12_000)), isRunning: true, exitCode: null }], now);
    expect(seg).toBe('bg: bg-1a2b "npm run build" 4m12s running');
  });
  it('exited shows the exit code', () => {
    const seg = backgroundShellsSegment([{ shellId: 'bg-5', command: 'pytest', startTime: now - 40_000, isRunning: false, exitCode: 1 }], now);
    expect(seg).toBe('bg: bg-5 "pytest" 0m40s exited 1');
  });
  it('several → 3 most recent, newest first, commands capped', () => {
    const long = 'python -m pytest tests/very/long/path/to/some/test_file.py -k "a and b" --maxfail=1 -x -q';
    const seg = backgroundShellsSegment([
      { shellId: 'bg-old', command: 'sleep 1000', startTime: now - 50 * MIN, isRunning: true, exitCode: null },
      { shellId: 'bg-a', command: long, startTime: now - 3 * MIN, isRunning: true, exitCode: null },
      { shellId: 'bg-b', command: 'make', startTime: now - 2 * MIN, isRunning: false, exitCode: 0 },
      { shellId: 'bg-c', command: 'tail -f log', startTime: now - 1 * MIN, isRunning: true, exitCode: null },
    ], now);
    expect(seg.startsWith('bg: bg-c "tail -f log" 1m00s running, bg-b "make" 2m00s exited 0, bg-a "')).toBe(true);
    expect(seg).not.toContain('bg-old');
    expect(seg).toContain('…');
    expect(seg).not.toContain('"a and b"'); // inner quotes neutralized
    const cmdChars = [...seg.matchAll(/"([^"]*)"/g)].reduce((n, m) => n + m[1].length, 0);
    expect(cmdChars).toBeLessThanOrEqual(80);
  });
  it('rides in the full line after context', () => {
    const line = buildTurnStatusLine({ elapsedMs: MIN, deadlineMs: H, contextTokens: 2000, contextWindow: 100_000, nowMs: now,
      shells: [{ shellId: 'bg-9', command: 'npm test', startTime: now - 30_000, isRunning: true, exitCode: null }] });
    expect(line).toMatch(/context ~2K of 100K tokens \(2%\); bg: bg-9 "npm test" 0m30s running<\/system-reminder>$/);
  });
});

function toolMsg(id: string, content: any) {
  return { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content }] } };
}

describe('HB-TURN-STATUS placement', () => {
  it('appends to the tail of the NEWEST tool_result of the round; earlier messages untouched', () => {
    const history: any[] = [
      { type: 'user', message: { role: 'user', content: 'task' } },
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 't0', name: 'Bash', input: {} }] } },
      toolMsg('t0', 'old result'),
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: {} }, { type: 'tool_use', id: 't2', name: 'Read', input: {} }] } },
      toolMsg('t1', 'r1'),
      toolMsg('t2', 'r2'),
    ];
    const before = JSON.stringify(history.slice(0, 5));
    expect(appendStatusToNewestToolResult(history, 'STATUS')).toBe(true);
    expect(history[5].message.content[0].content).toBe('r2\n\nSTATUS');
    expect(JSON.stringify(history.slice(0, 5))).toBe(before);
  });
  it('a persisted tail stays byte-identical when the next round appends its own', () => {
    const history: any[] = [
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 't1' }] } },
      toolMsg('t1', 'r1'),
    ];
    appendStatusToNewestToolResult(history, 'S1');
    const prefix = JSON.stringify(history);
    history.push({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 't2' }] } }, toolMsg('t2', 'r2'));
    appendStatusToNewestToolResult(history, 'S2');
    expect(JSON.stringify(history.slice(0, 2))).toBe(prefix);
    expect(history[3].message.content[0].content).toBe('r2\n\nS2');
  });
  it('skips trailing non-tool_result user messages (image/thinking) to reach the newest tool_result', () => {
    const history: any[] = [
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 't1' }] } },
      toolMsg('t1', 'r1'),
      { type: 'user', message: { role: 'user', content: [{ type: 'text', text: '<system-reminder>guidance</system-reminder>' }] } },
    ];
    expect(appendStatusToNewestToolResult(history, 'S')).toBe(true);
    expect(history[1].message.content[0].content).toBe('r1\n\nS');
    expect(history[2].message.content[0].text).toBe('<system-reminder>guidance</system-reminder>');
  });
  it('array tool_result content gets a trailing text block', () => {
    const history: any[] = [toolMsg('t1', [{ type: 'text', text: 'x' }])];
    appendStatusToNewestToolResult(history, 'S');
    expect(history[0].message.content[0].content).toEqual([{ type: 'text', text: 'x' }, { type: 'text', text: 'S' }]);
  });
  it('no tool_result in the current round → nothing appended (never reaches past the assistant turn)', () => {
    const history: any[] = [
      toolMsg('t0', 'old'),
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'done' }] } },
    ];
    const before = JSON.stringify(history);
    expect(appendStatusToNewestToolResult(history, 'S')).toBe(false);
    expect(JSON.stringify(history)).toBe(before);
  });
  it('off = byte-identical: an inactive lever never builds or appends anything', () => {
    const history: any[] = [toolMsg('t1', 'r1')];
    const before = JSON.stringify(history);
    for (const env of [{}, { CORTEX_TURN_STATUS: 'off' }, { CORTEX_TURN_STATUS: 'auto' }]) {
      const mode = resolveTurnStatusMode(env);
      if (turnStatusActive(mode, 0)) appendStatusToNewestToolResult(history, 'S');
    }
    expect(JSON.stringify(history)).toBe(before);
  });
});
