/**
 * Unified Outcome Ladder — layer 1: classifyToolOutcome + approachHash.
 * (docs/UNIFIED_OUTCOME_LADDER.md; TB2 retry-loop root cause: bash exit!=0
 * returns a SUCCESS result, so every failure-adjacent guard missed the loops.)
 */
import { describe, it, expect } from 'vitest';
import { classifyToolOutcome, approachHash } from '../toolOutcome.js';

const res = (over: Partial<{ content: string; is_error: boolean; metadata: any }> = {}) => ({
  tool_use_id: 't1',
  tool_name: 'Bash',
  content: 'ok',
  ...over,
});

describe('classifyToolOutcome', () => {
  it('ok: exitCode 0', () => {
    const o = classifyToolOutcome('Bash', { cmd: 'ls' }, res({ metadata: { exitCode: 0 } }));
    expect(o.status).toBe('ok');
    expect(o.family).toBeUndefined();
  });

  it('failed: nonzero exitCode in metadata even though is_error is unset (THE root-cause case)', () => {
    const o = classifyToolOutcome(
      'Bash',
      { cmd: 'apt-get install foo' },
      res({ content: 'E: Unable to locate package foo\nCommand failed with exit code 100', metadata: { exitCode: 100 } }),
    );
    expect(o.status).toBe('failed');
    expect(o.family).toBeTruthy();
  });

  it('failed: content failure signature when metadata has no exit code', () => {
    const o = classifyToolOutcome('Bash', { cmd: 'make' }, res({ content: 'gcc: fatal error\nCommand failed with exit code 2' }));
    expect(o.status).toBe('failed');
  });

  it('error: is_error results stay errors', () => {
    const o = classifyToolOutcome('Bash', { cmd: 'x' }, res({ is_error: true, content: 'Command was cancelled by user.' }));
    expect(o.status).toBe('error');
    expect(o.family).toBeTruthy();
  });

  it('ok: non-shell tool without exit semantics and no error', () => {
    const o = classifyToolOutcome('Read', { file_path: '/a' }, res({ content: 'file contents' }));
    expect(o.status).toBe('ok');
  });

  it('exposes both exactHash (byte-sensitive) and approachHash (normalized)', () => {
    const a = classifyToolOutcome('Bash', { cmd: 'pip install foo==1.2.3' }, res({ metadata: { exitCode: 1 } }));
    const b = classifyToolOutcome('Bash', { cmd: 'pip install foo==1.2.4' }, res({ metadata: { exitCode: 1 } }));
    expect(a.exactHash).not.toBe(b.exactHash);
    expect(a.approachHash).toBe(b.approachHash);
  });
});

describe('approachHash (normalized near-duplicate collisions)', () => {
  it('collides retries that differ only in digits/versions', () => {
    expect(approachHash('Bash', { cmd: 'curl -o out1.tar http://x/v1.2/pkg.tar' }))
      .toBe(approachHash('Bash', { cmd: 'curl -o out2.tar http://x/v1.3/pkg.tar' }));
  });

  it('collides retries that differ only in paths', () => {
    expect(approachHash('Bash', { cmd: 'python /tmp/a/run.py' }))
      .toBe(approachHash('Bash', { cmd: 'python /tmp/b/run.py' }));
  });

  it('collides retries that differ only in quoted strings', () => {
    expect(approachHash('Bash', { cmd: 'grep "foo" f.txt' }))
      .toBe(approachHash('Bash', { cmd: 'grep "bar" f.txt' }));
  });

  it('does NOT collide genuinely different approaches', () => {
    expect(approachHash('Bash', { cmd: 'apt-get install gcc' }))
      .not.toBe(approachHash('Bash', { cmd: 'gcc -o main main.c' }));
  });

  it('does NOT collide across tools', () => {
    expect(approachHash('Bash', { cmd: 'ls' })).not.toBe(approachHash('Read', { cmd: 'ls' }));
  });
});

describe('classifyToolOutcome on reminder-augmented content (loop-level reuse)', () => {
  it('ignores a prepended <system-reminder> block when classifying family', () => {
    const augmented =
      '<system-reminder>\nPrior failures for this input...\n</system-reminder>\n' +
      'E: Unable to locate package foo\nCommand failed with exit code 100';
    const o = classifyToolOutcome('Bash', { cmd: 'apt-get install foo' }, {
      tool_use_id: 't', tool_name: 'Bash', content: augmented, metadata: { exitCode: 100 },
    });
    expect(o.status).toBe('failed');
    expect(o.family).not.toContain('system-reminder');
    expect(o.family).toContain('unable to locate');
  });
});

describe('approachHash version-pin and flag insensitivity (probe-3 finding)', () => {
  it('collides pin variants (==X.Y skeletons stripped)', () => {
    expect(approachHash('Bash', { command: 'pip install glorbex-missing-pkg-55501; echo "exit=$?"' }))
      .toBe(approachHash('Bash', { command: 'pip install glorbex-missing-pkg-55501==2.1; echo "exit=$?"' }));
  });
  it('collides flag variants (--word flags stripped)', () => {
    expect(approachHash('Bash', { command: 'pip install glorbex-missing-pkg-55501 --no-cache-dir' }))
      .toBe(approachHash('Bash', { command: 'pip install glorbex-missing-pkg-55501 --retries 3' }));
  });
  it('still does NOT collide different programs', () => {
    expect(approachHash('Bash', { command: 'pip install foo' }))
      .not.toBe(approachHash('Bash', { command: 'npm install foo' }));
  });
});
