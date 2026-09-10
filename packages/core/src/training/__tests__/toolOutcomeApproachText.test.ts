import { describe, it, expect } from 'vitest';
import { approachText, diceSimilarity, classifyToolOutcome } from '../toolOutcome.js';

describe('approachText / diceSimilarity (HB-LOOP-NEARDUP)', () => {
  it('normalizes executing-tool inputs (digits → #, whitespace collapsed) and is empty for non-exec tools', () => {
    expect(approachText('Bash', { command: 'python3 run.py  --n 12' })).toBe('python# run.py --n #');
    expect(approachText('Write', { file_path: '/app/a.py', content: 'x = 1\n' })).toBe('/app/a.py x = #');
    expect(approachText('Read', { file_path: '/app/a.py' })).toBe('');
  });
  it('slice-reads are excluded (sed -n / head -n / tail -n)', () => {
    expect(approachText('Bash', { command: "sed -n '10,40p' /app/x.c" })).toBe('');
    expect(approachText('Bash', { command: 'head -n 20 file' })).toBe('');
    expect(approachText('Bash', { command: 'cat file | grep x' })).not.toBe('');
  });
  it('dice: identical 1, unrelated ~0, small edit ≥ 0.9', () => {
    expect(diceSimilarity('abcdef', 'abcdef')).toBe(1);
    expect(diceSimilarity('abcdefghij', 'zzzzzzzzzz')).toBe(0);
    const a = 'cd /app && python3 -c "import re; lines=open(\'t.gcode\').read().splitlines(); print(len(lines))"';
    expect(diceSimilarity(a, a.replace('len(lines)', 'len(lines)+1'))).toBeGreaterThanOrEqual(0.9);
  });
  it('classifyToolOutcome carries approachText for exec tools only', () => {
    expect(classifyToolOutcome('Bash', { command: 'ls -la' }, { content: 'ok' }).approachText).toBe('ls -la');
    expect(classifyToolOutcome('Read', { file_path: '/x' }, { content: 'ok' }).approachText).toBeUndefined();
  });
});
