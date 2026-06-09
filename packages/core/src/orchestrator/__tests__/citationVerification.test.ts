/**
 * Stage 2: deterministic citation grounding. The model can rubber-stamp an
 * attestation (Stage 1 plateaued ~5/6) — a fabricated coordinate is a
 * regurgitated training prior, not an observation. The only fix is
 * mechanically rejecting a citation whose verbatim_source does not actually
 * occur in THIS turn's tool output. Pure, so it is unit-tested directly.
 */
import { describe, it, expect } from 'vitest';
import { verifyCitationsGrounded } from '../citationVerification.js';

const READ_OUT = `   78→  private estimateMessageTokens(message: Message): number {
   79→    const cacheable = typeof uuid === 'string' && uuid.length > 0;
   80→    const key = cacheable ? \`\${this.modelConfig?.id ?? ''}:\${uuid}\` : '';
  224→      if (err?.code === 'ENOENT') {`;

describe('verifyCitationsGrounded', () => {
  it('passes when every verbatim_source occurs in tool output', () => {
    const r = verifyCitationsGrounded(
      [
        { reference: 'cacheable guard', verbatim_source: "const cacheable = typeof uuid === 'string' && uuid.length > 0;" },
        { reference: 'ENOENT guard', verbatim_source: "if (err?.code === 'ENOENT') {" },
      ],
      READ_OUT,
    );
    expect(r.grounded).toBe(true);
    expect(r.ungrounded).toEqual([]);
  });

  it('tolerates markdown backticks and whitespace differences', () => {
    const r = verifyCitationsGrounded(
      [{ reference: 'key', verbatim_source: "`const key = cacheable ? ... `" }],
      READ_OUT,
    );
    // backtick-wrapped + the model elided the middle with ... → still must
    // reject: the elided form is NOT a verbatim transcription.
    expect(r.grounded).toBe(false);
  });

  it('rejects a fabricated source not present in tool output', () => {
    const r = verifyCitationsGrounded(
      [{ reference: 'made up', verbatim_source: 'const totallyInvented = doesNotExist();' }],
      READ_OUT,
    );
    expect(r.grounded).toBe(false);
    expect(r.ungrounded).toHaveLength(1);
    expect(r.ungrounded[0]!.reference).toBe('made up');
  });

  it('matches real code even when backtick-wrapped and re-indented', () => {
    const r = verifyCitationsGrounded(
      [{ reference: 'ENOENT', verbatim_source: '```\nif (err?.code === \'ENOENT\') {\n```' }],
      READ_OUT,
    );
    expect(r.grounded).toBe(true);
  });

  it('empty citations is vacuously grounded (model declared none)', () => {
    expect(verifyCitationsGrounded([], READ_OUT).grounded).toBe(true);
  });

  it('skips trivially short sources (cannot meaningfully verify a few chars)', () => {
    const r = verifyCitationsGrounded(
      [{ reference: 'brace', verbatim_source: '{' }],
      READ_OUT,
    );
    // too short to be a real transcription claim → not counted as ungrounded
    expect(r.grounded).toBe(true);
  });

  it('flags only the ungrounded entries in a mixed set', () => {
    const r = verifyCitationsGrounded(
      [
        { reference: 'real', verbatim_source: "if (err?.code === 'ENOENT') {" },
        { reference: 'fake', verbatim_source: 'return this.fabricatedHelper(1234);' },
      ],
      READ_OUT,
    );
    expect(r.grounded).toBe(false);
    expect(r.ungrounded.map((u) => u.reference)).toEqual(['fake']);
  });
});
