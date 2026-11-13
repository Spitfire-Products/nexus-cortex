/**
 * 2026-11-13 (operator): (1) a user-stopped desktop turn finishes as a report — the EndTurn gate accepts it without its stages and the
 * judge skips it (CORTEX_ENDTURN_USER_HALT, keyed on the desktop tool's latched STOP refusal, never on model text); (2) desktop
 * observations count like web pages for the web-turn judge skip; (3) the browser driven directly through the nexus-browser MCP is web
 * evidence (before this a direct-browser finish was never a "web turn").
 */
import { describe, it, expect, vi } from 'vitest';
import { TurnEvidence, evaluateEndTurnGates, isDesktopTool, userHaltShortCircuit } from '../endTurnGates.js';
import { webTurnEvidenced } from '../../training/endTurnResolver.js';

const STOP = 'desktop control is STOPPED by the user (failsafe tripped: cursor parked at the top spot). Do not try to resume, move the cursor, or touch the stop file: end this task now and tell the user what you were doing.';
const deps = (env: Record<string, string> = { CORTEX_ENDTURN_REQUIREMENTS: 'strict' }) => ({ userTaskText: 'Type eight lines into TextEdit', env: env as any, recordEvent: vi.fn(), log: () => {} });
const endTurn = (input: any) => ({ id: 'et1', name: 'EndTurn', input });
const etResult = () => ({ tool_use_id: 'et1', tool_name: 'EndTurn', content: 'ok', is_error: false as boolean | undefined });

describe('desktop user-stop short-circuit', () => {
  it('the latched STOP refusal from the desktop tool marks the turn user-halted', () => {
    const ev = new TurnEvidence();
    ev.noteToolResults([{ tool_use_id: 'd1', tool_name: 'nexus-desktop__desktop', content: STOP, is_error: true }]);
    expect(ev.userHalted).toBe(true);
  });
  it('the same text from any OTHER tool (or the model) does not halt', () => {
    const ev = new TurnEvidence();
    ev.noteToolResults([{ tool_use_id: 'b1', tool_name: 'Bash', content: STOP, is_error: true }, { tool_use_id: 'w1', tool_name: 'Write', content: STOP }]);
    expect(ev.userHalted).toBe(false);
  });
  it('a non-error desktop result mentioning the phrase does not halt', () => {
    const ev = new TurnEvidence();
    ev.noteToolResults([{ tool_use_id: 'd1', tool_name: 'nexus-desktop__desktop', content: STOP, is_error: false }]);
    expect(ev.userHalted).toBe(false);
  });
  it('the gate accepts a halted turn without its stages (a finish that would otherwise be rejected)', () => {
    const ev = new TurnEvidence();
    ev.noteToolResults([{ tool_use_id: 'd1', tool_name: 'nexus-desktop__desktop', content: STOP, is_error: true }]);
    const tr = etResult(); const d = deps();
    evaluateEndTurnGates(ev, [tr], [endTurn({ citations: [{ reference: 'x', verbatim_source: 'a line that was never shown' }] })], d);
    expect(ev.endTurnCalled).toBe(true);
    expect(tr.is_error).toBe(false);
    expect(d.recordEvent).toHaveBeenCalledWith('endturn_user_halt', expect.objectContaining({ stage: 'gate' }), 'EndTurn');
  });
  it('CORTEX_ENDTURN_USER_HALT=off restores the normal gate', () => {
    const ev = new TurnEvidence();
    ev.noteToolResults([{ tool_use_id: 'd1', tool_name: 'nexus-desktop__desktop', content: STOP, is_error: true }]);
    const tr = etResult();
    evaluateEndTurnGates(ev, [tr], [endTurn({ citations: [{ reference: 'x', verbatim_source: 'a line that was never shown' }] })], deps({ CORTEX_ENDTURN_REQUIREMENTS: 'strict', CORTEX_ENDTURN_USER_HALT: 'off' }));
    expect(tr.is_error).toBe(true);
    expect(userHaltShortCircuit({ CORTEX_ENDTURN_USER_HALT: 'off' } as any)).toBe(false);
    expect(userHaltShortCircuit({} as any)).toBe(true);
  });
});

describe('desktop + direct-browser evidence for the web-turn judge skip', () => {
  it('desktop observations with no file writes are a web-like turn', () => {
    const ev = new TurnEvidence();
    ev.noteToolResults([{ tool_use_id: 'd1', tool_name: 'nexus-desktop__desktop', content: 'screen: iTerm, fuzzycortex prompt' }]);
    expect(ev.desktopContent.length).toBe(1);
    expect(webTurnEvidenced(ev, {} as any)).toBe(true);
  });
  it('a desktop turn that also edited a file is NOT skipped (code changes keep the judge)', () => {
    const ev = new TurnEvidence();
    ev.noteToolUses([{ id: 'w', name: 'Write', input: { file_path: '/tmp/a.ts', content: 'x' } }]);
    ev.noteToolResults([{ tool_use_id: 'd1', tool_name: 'nexus-desktop__desktop', content: 'screen' }]);
    expect(webTurnEvidenced(ev, {} as any)).toBe(false);
  });
  it('nexus-browser MCP results are web evidence for the judge skip (and stay out of webContent, which the integrity sources check reads)', () => {
    const ev = new TurnEvidence();
    ev.noteToolResults([{ tool_use_id: 'b1', tool_name: 'nexus-browser__get_content', content: 'page text' }]);
    expect(ev.webContent.length).toBe(0);
    expect(ev.browserContent.length).toBe(1);
    expect(webTurnEvidenced(ev, {} as any)).toBe(true);
  });
  it('desktop tool names', () => {
    expect(isDesktopTool('nexus-desktop__desktop')).toBe(true);
    expect(isDesktopTool('desktop')).toBe(true);
    expect(isDesktopTool('nexus-browser__browse')).toBe(false);
  });
});
