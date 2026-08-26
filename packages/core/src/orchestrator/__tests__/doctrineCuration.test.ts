/**
 * Item 10 — doctrine curation staging/apply mechanics + item 11a frame layer.
 * The apply path is the containment boundary for helper-written doctrine:
 * size budget, .prev rollback, atomic rename, staging cleanup.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { readStagedDoctrine, applyCuratedDoctrine, withTimeout } from '../doctrineCuration.js';
import { buildHelperSystem, frameHelperPrompt, HELPER_GROUNDING_RULE } from '../../middleware/helpers/helperFrame.js';

let proj: string;
beforeEach(() => {
  proj = fs.mkdtempSync(path.join(os.tmpdir(), 'doct-'));
  fs.mkdirSync(path.join(proj, '.cortex'));
});
afterEach(() => fs.rmSync(proj, { recursive: true, force: true }));

const stage = (doc: string, next: string, diff = 'DIFF') => {
  fs.writeFileSync(path.join(proj, '.cortex', 'CORTEX.md'), doc);
  fs.writeFileSync(path.join(proj, '.cortex', 'CORTEX.md.next'), next);
  fs.writeFileSync(path.join(proj, '.cortex', 'CORTEX.md.diff'), diff);
};

describe('doctrine curation mechanics (item 10)', () => {
  it('no staging → null (the common no-drift session)', () => {
    expect(readStagedDoctrine(proj)).toBeNull();
  });

  it('applies curated doc atomically with .prev rollback + staging cleanup', () => {
    stage('# old doc with curated wisdom', '# staged next');
    const staged = readStagedDoctrine(proj)!;
    expect(staged.staleDoc).toContain('curated wisdom');
    const { bytes } = applyCuratedDoctrine(staged, '# curated final doc — merged machine + curated content', 16384);
    expect(bytes).toBeGreaterThan(40);
    expect(fs.readFileSync(staged.docPath, 'utf8')).toContain('curated final doc');
    expect(fs.readFileSync(`${staged.docPath}.prev`, 'utf8')).toContain('curated wisdom');
    expect(fs.existsSync(staged.nextPath)).toBe(false);
    expect(fs.existsSync(staged.diffPath)).toBe(false);
  });

  it('rejects oversize output (budget containment) — doc untouched', () => {
    stage('# old', '# next');
    const staged = readStagedDoctrine(proj)!;
    expect(() => applyCuratedDoctrine(staged, 'x'.repeat(20000), 16384)).toThrow(/budget/);
    expect(fs.readFileSync(staged.docPath, 'utf8')).toBe('# old');
  });

  it('rejects degenerate tiny output — doc untouched', () => {
    stage('# old doc that must survive', '# next');
    const staged = readStagedDoctrine(proj)!;
    expect(() => applyCuratedDoctrine(staged, 'ok', 16384)).toThrow(/too small/);
    expect(fs.readFileSync(staged.docPath, 'utf8')).toContain('must survive');
  });

  it('withTimeout: resolves in time, null on expiry (fail-open)', async () => {
    expect(await withTimeout(Promise.resolve('done'), 1000)).toBe('done');
    expect(await withTimeout(new Promise(res => setTimeout(res, 200)), 20)).toBeNull();
  });
});

describe('helper frame layer (item 11a)', () => {
  it('composes persona + surface + grounding + budget', () => {
    const sys = buildHelperSystem({
      surface: 'doctrine-curation', persona: 'You are a curator.',
      task: 'Merge things.', outputBudgetTokens: 4000,
    });
    expect(sys).toContain('[surface: doctrine-curation]');
    expect(sys).toContain(HELPER_GROUNDING_RULE);
    expect(sys).toContain('~4000 tokens');
  });

  it('frameHelperPrompt prefixes the frame to the body', () => {
    const p = frameHelperPrompt(
      { surface: 's', persona: 'P.', task: 'T.', outputBudgetTokens: 100 },
      'BODY'
    );
    expect(p.endsWith('BODY')).toBe(true);
    expect(p).toContain('[surface: s]');
  });

  it('grounding rule can be opted out', () => {
    const sys = buildHelperSystem({ surface: 's', persona: 'P.', task: 'T.', outputBudgetTokens: 10, grounding: false });
    expect(sys).not.toContain(HELPER_GROUNDING_RULE);
  });
});
