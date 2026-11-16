/**
 * approvalChoices — the pure choice/key logic behind the Ink approval dialog (vault task T3, defect D1).
 *
 * No react, no ink: this file can be executed and unit-tested in a checkout where the TUI's runtime deps are absent.
 */
import { describe, it, expect } from 'vitest';
import {
  choicesForRequest, isLoadSessionRequest, answerFor, reduceApprovalKey, initialChoiceState,
  LOAD_SESSION_CHOICES, GENERIC_CHOICES,
} from './approvalChoices.js';

const loadSession = {
  toolName: 'nexus-browser__load_session',
  toolInput: { site: 'github.com' },
  reason: 'release github.com?',
  timestamp: new Date(),
  kind: 'load_session' as const,
  site: 'github.com',
};

const generic = { toolName: 'Bash', toolInput: { command: 'ls' }, reason: 'run ls?', timestamp: new Date() };

describe('isLoadSessionRequest / choicesForRequest', () => {
  it('detects a load_session request by kind', () => {
    expect(isLoadSessionRequest(loadSession)).toBe(true);
    expect(isLoadSessionRequest(generic)).toBe(false);
  });

  it('detects a load_session request by tool name even without kind', () => {
    expect(isLoadSessionRequest({ ...generic, toolName: 'load_session' })).toBe(true);
  });

  it('offers four choices for load_session', () => {
    expect(choicesForRequest(loadSession).map((c) => c.value)).toEqual(['once', 'session', 'always', 'no']);
  });

  it('prefers the choices carried by the request', () => {
    const choices = [{ value: 'once' as const, label: 'just once' }, { value: 'no' as const, label: 'nope' }];
    expect(choicesForRequest({ ...loadSession, choices })).toEqual(choices);
  });

  it('keeps the three legacy choices for a plain request', () => {
    expect(choicesForRequest(generic).map((c) => c.value)).toEqual(GENERIC_CHOICES.map((c) => c.value));
    expect(choicesForRequest(generic)).toHaveLength(3);
  });

  it('the load_session labels name the site', () => {
    const labels = LOAD_SESSION_CHOICES('github.com').map((c) => c.label).join(' ');
    expect(labels).toContain('github.com');
  });
});

describe('answerFor', () => {
  it('maps the four choices', () => {
    expect(answerFor({ value: 'once', label: 'x' })).toEqual({ approved: true, scope: 'once' });
    expect(answerFor({ value: 'session', label: 'x' })).toEqual({ approved: true, scope: 'session' });
    expect(answerFor({ value: 'always', label: 'x' })).toEqual({ approved: true, scope: 'always' });
    expect(answerFor({ value: 'no', label: 'x' })).toBe(false);
  });

  it('maps the legacy three (yes / yes+yolo / no)', () => {
    expect(answerFor({ value: 'once', label: 'x' })).toEqual({ approved: true, scope: 'once' });
    expect(answerFor({ value: 'no', label: 'x' })).toBe(false);
  });
});

describe('reduceApprovalKey', () => {
  const four = initialChoiceState(4);
  const three = initialChoiceState(3);

  it('starts on the first choice', () => {
    expect(four.index).toBe(0);
    expect(four.answer).toBeUndefined();
  });

  it('arrow down/up move within bounds', () => {
    let s = reduceApprovalKey(four, 'down', 4);
    expect(s.index).toBe(1);
    s = reduceApprovalKey(s, 'up', 4);
    expect(s.index).toBe(0);
    s = reduceApprovalKey(s, 'up', 4);
    expect(s.index).toBe(0);
    s = reduceApprovalKey(initialChoiceState(4), 'down', 4);
    s = reduceApprovalKey(s, 'down', 4);
    s = reduceApprovalKey(s, 'down', 4);
    expect(s.index).toBe(3);
    expect(reduceApprovalKey(s, 'down', 4).index).toBe(3);
  });

  it('enter answers the selected choice', () => {
    const s = reduceApprovalKey(reduceApprovalKey(four, 'down', 4), 'enter', 4);
    expect(s.answer).toEqual({ approved: true, scope: 'session' });
  });

  it('number keys answer directly', () => {
    expect(reduceApprovalKey(four, '3', 4).answer).toEqual({ approved: true, scope: 'always' });
    expect(reduceApprovalKey(four, '4', 4).answer).toBe(false);
  });

  it('esc answers no', () => {
    expect(reduceApprovalKey(four, 'escape', 4).answer).toBe(false);
  });

  it('y answers the first choice, n the last (legacy behaviour preserved)', () => {
    expect(reduceApprovalKey(three, 'y', 3).answer).toEqual({ approved: true, scope: 'once' });
    expect(reduceApprovalKey(three, 'n', 3).answer).toBe(false);
  });

  it('ignores unknown keys', () => {
    expect(reduceApprovalKey(four, 'q', 4)).toEqual(four);
  });
});
