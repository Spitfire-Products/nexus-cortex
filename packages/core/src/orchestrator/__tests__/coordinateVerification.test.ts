/**
 * Stage 3: deterministic coordinate verification. Q1 proved the fabrication
 * is intrinsic regurgitation — grok emits `(line 446)` from training priors
 * even with no prompt asking for it. Steering/attestation can't fix that;
 * only mechanically rejecting a coordinate that does not correspond to
 * something actually read this turn can. Rule: a line number in the answer
 * is valid IFF some EndTurn citation's verbatim_source occurs at that exact
 * line in this turn's cat -n tool output. Bare prose numbers with no
 * backing citation are unverifiable → violation. Pure → unit-tested.
 */
import { describe, it, expect } from 'vitest';
import { verifyCoordinates, deterministicCoordinateScore } from '../coordinateVerification.js';

const READ_FOR_SCORE = [
  '    78\t    const cacheable = true;',
  '   224\t      if (err?.code === \'ENOENT\') {',
].join('\n');

describe('deterministicCoordinateScore (audit-off signal — no EndTurn citations)', () => {
  it('all claimed lines exist in this turn\'s cat -n reads → 1.0', () => {
    expect(deterministicCoordinateScore('see line 78 and line 224', READ_FOR_SCORE)).toBe(1);
  });

  it('half the claimed lines are regurgitated (not in reads) → 0.5', () => {
    expect(deterministicCoordinateScore('line 78 and line 446', READ_FOR_SCORE)).toBe(0.5);
  });

  it('no coordinate claims at all → 1.0 (no risk taken, nothing fabricated)', () => {
    expect(deterministicCoordinateScore('the guard deletes the memo and retries', READ_FOR_SCORE)).toBe(1);
  });

  it('claims present but no parseable cat -n reads → 0.5 (cannot verify, uncertain)', () => {
    expect(deterministicCoordinateScore('it is on line 999', 'raw content, no numbers')).toBe(0.5);
  });

  it('no reads and no claims → 1.0', () => {
    expect(deterministicCoordinateScore('a prose answer', 'raw content')).toBe(1);
  });

  it('all claimed lines fabricated → 0.0', () => {
    expect(deterministicCoordinateScore('line 446, line 530', READ_FOR_SCORE)).toBe(0);
  });
});

// Read tool output is `cat -n`: "   <n>→<code>" (also tolerate "<n>\t<code>").
const READ = [
  '   77→  private estimateMessageTokens(message: Message): number {',
  "   78→    const cacheable = typeof uuid === 'string' && uuid.length > 0;",
  "   79→    const key = cacheable ? `${this.modelConfig?.id}` : '';",
  '  224→      if (err?.code === \'ENOENT\') {',
].join('\n');

describe('verifyCoordinates', () => {
  it('passes when a cited line number matches where its verbatim_source really is', () => {
    const r = verifyCoordinates(
      'The cacheable guard is on line 78.',
      READ,
      [{ reference: 'cacheable guard', verbatim_source: "const cacheable = typeof uuid === 'string' && uuid.length > 0;" }],
    );
    expect(r.ok).toBe(true);
    expect(r.violations).toEqual([]);
  });

  it('flags a regurgitated number that no citation backs at that line', () => {
    const r = verifyCoordinates(
      'The cacheable guard is on line 446.',
      READ,
      [{ reference: 'cacheable guard', verbatim_source: "const cacheable = typeof uuid === 'string' && uuid.length > 0;" }],
    );
    // verbatim_source really sits at 78, answer claims 446 → violation
    expect(r.ok).toBe(false);
    expect(r.violations.map((v) => v.line)).toContain(446);
  });

  it('flags a bare prose line number with NO backing citation', () => {
    const r = verifyCoordinates('See line 530 for the set call.', READ, []);
    expect(r.ok).toBe(false);
    expect(r.violations.map((v) => v.line)).toContain(530);
  });

  it('catches file:NN form too', () => {
    const r = verifyCoordinates(
      'ContextBudgetManager.ts:786 has the set.',
      READ,
      [],
    );
    expect(r.ok).toBe(false);
    expect(r.violations.map((v) => v.line)).toContain(786);
  });

  it('no coordinates in the answer → trivially ok', () => {
    const r = verifyCoordinates(
      'The guard `if (err?.code === \'ENOENT\') {` deletes the memo and retries.',
      READ,
      [{ reference: 'g', verbatim_source: "if (err?.code === 'ENOENT') {" }],
    );
    expect(r.ok).toBe(true);
  });

  it('no parseable cat -n output → cannot verify, do not false-reject', () => {
    const r = verifyCoordinates('line 999 is interesting', 'no line numbers here at all', []);
    expect(r.ok).toBe(true);
  });

  it('tolerates backticks/whitespace when matching verbatim_source to the line', () => {
    const r = verifyCoordinates(
      'The ENOENT guard is at line 224.',
      READ,
      [{ reference: 'enoent', verbatim_source: "```\nif (err?.code === 'ENOENT') {\n```" }],
    );
    expect(r.ok).toBe(true);
  });

  it('multiple claims: only the unbacked/mismatched ones are violations', () => {
    const r = verifyCoordinates(
      'cacheable is line 78; the set is on line 999.',
      READ,
      [{ reference: 'cacheable', verbatim_source: "const cacheable = typeof uuid === 'string' && uuid.length > 0;" }],
    );
    expect(r.ok).toBe(false);
    expect(r.violations.map((v) => v.line).sort()).toEqual([999]);
  });
});
