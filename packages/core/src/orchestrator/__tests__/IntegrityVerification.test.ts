/**
 * EndTurn Stage 5 — task-integrity checks (item 12 layer 4).
 * A: web-content transplant · B: solution-seeking queries · C: show-your-work
 * attestation for any web usage (operator-directed).
 */
import { describe, it, expect } from 'vitest';
import { verifyIntegrity, resolveEndTurnIntegrityMode } from '../integrityVerification.js';

const base = { webQueries: [], webContent: [], writeInputs: [], userTaskText: 'train a fasttext model on the given corpus' };

describe('EndTurn Stage 5 integrity', () => {
  it('clean turn (no web, honest work): ok', () => {
    const v = verifyIntegrity({ ...base, writeInputs: ['def train(): pass'] });
    expect(v.ok).toBe(true);
    expect(v.flags).toHaveLength(0);
  });

  it('B: solution-shaped query is AUDIT-ONLY when attested (justify-not-block)', () => {
    const v = verifyIntegrity({ ...base, webQueries: ['terminal-bench train-fasttext solution walkthrough'],
      sourcesAttestation: [{ accessed: 'q', purpose: 'p', used_for: 'u' }] });
    expect(v.ok).toBe(true); // attested → passes; flag banks for the distiller
    expect(v.flags.some(f => f.check === 'solution_query')).toBe(true);
  });

  it('B: task-statement-verbatim query flags', () => {
    const task = 'implement a compression tool that beats gzip on the provided corpus using arithmetic coding techniques today';
    const v = verifyIntegrity({ ...base, userTaskText: task,
      webQueries: ['implement a compression tool that beats gzip on the provided corpus'],
      sourcesAttestation: [{ accessed: 'q', purpose: 'p', used_for: 'u' }] });
    expect(v.flags.some(f => f.check === 'solution_query')).toBe(true);
  });

  it('A: >=20-word transplant from fetched content into an artifact flags', () => {
    const run = Array.from({ length: 25 }, (_, i) => `token${i}`).join(' ');
    const v = verifyIntegrity({ ...base,
      webQueries: ['fasttext documentation'], webContent: [`docs preamble ${run} trailing text`],
      writeInputs: [`# my solution\n${run}\n`],
      sourcesAttestation: [{ accessed: 'fasttext documentation', purpose: 'api', used_for: 'params' }] });
    expect(v.ok).toBe(true); // attested → audit-only
    expect(v.flags.some(f => f.check === 'web_transplant')).toBe(true);
  });

  it('A: short overlaps (idioms, <20 words) do NOT flag', () => {
    const v = verifyIntegrity({ ...base,
      webQueries: ['fasttext docs'], webContent: ['use model.train_supervised with lr and epoch params'],
      writeInputs: ['model.train_supervised(lr=0.5)'],
      sourcesAttestation: [{ accessed: 'fasttext docs', purpose: 'api', used_for: 'params' }] });
    expect(v.flags.some(f => f.check === 'web_transplant')).toBe(false);
  });

  it('C: web used with NO attestation → unattested_web_use flag', () => {
    const v = verifyIntegrity({ ...base, webQueries: ['fasttext parameter docs'] });
    expect(v.ok).toBe(false);
    expect(v.flags.some(f => f.check === 'unattested_web_use')).toBe(true);
    expect(v.nudge).toContain('SHOW YOUR WORK');
  });

  it('C: complete attestation for documentation research: ok', () => {
    const v = verifyIntegrity({ ...base, webQueries: ['fasttext parameter docs'],
      webContent: ['lr: learning rate. epoch: passes over data.'],
      sourcesAttestation: [{ accessed: 'fasttext parameter docs', purpose: 'confirm hyperparameter names', used_for: 'wrote my own training script then verified by running it' }] });
    expect(v.ok).toBe(true);
  });

  it('C: degenerate attestation (empty fields) still flags', () => {
    const v = verifyIntegrity({ ...base, webQueries: ['docs'],
      sourcesAttestation: [{ accessed: 'docs', purpose: '', used_for: '' }] });
    expect(v.flags.some(f => f.check === 'unattested_web_use')).toBe(true);
  });

  it('no web usage: attestation not demanded', () => {
    const v = verifyIntegrity({ ...base, writeInputs: ['code'] });
    expect(v.ok).toBe(true);
  });

  it('env gate resolves', () => {
    const prev = process.env.CORTEX_ENDTURN_INTEGRITY;
    try {
      process.env.CORTEX_ENDTURN_INTEGRITY = 'true';
      expect(resolveEndTurnIntegrityMode()).toBe(true);
      delete process.env.CORTEX_ENDTURN_INTEGRITY;
      expect(resolveEndTurnIntegrityMode()).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.CORTEX_ENDTURN_INTEGRITY;
      else process.env.CORTEX_ENDTURN_INTEGRITY = prev;
    }
  });
});
