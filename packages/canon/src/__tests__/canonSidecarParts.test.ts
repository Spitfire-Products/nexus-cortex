/** Events-sidecar resolution (2026-11-11): single file, split parts in order, or none — and part names are never sessions. */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { sidecarFiles, sidecarLogical, isSidecarName } from '../sidecar.js';

describe('sidecar resolution', () => {
  it('resolves single, split and missing sidecars', () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-side-'));
    const main = path.join(d, 's1.jsonl');
    expect(sidecarLogical(main + '.part-0003')).toBe(path.join(d, 's1.events.jsonl'));
    expect(sidecarFiles(main)).toEqual([]);
    fs.writeFileSync(path.join(d, 's1.events.jsonl.part-0001'), 'b\n');
    fs.writeFileSync(path.join(d, 's1.events.jsonl.part-0000'), 'a\n');
    fs.writeFileSync(path.join(d, 's1.events.jsonl.part-0000.tmp'), 'x\n');
    expect(sidecarFiles(main + '.part-0000')).toEqual([path.join(d, 's1.events.jsonl.part-0000'), path.join(d, 's1.events.jsonl.part-0001')]);
    fs.writeFileSync(path.join(d, 's1.events.jsonl'), 'one\n');
    expect(sidecarFiles(main)).toEqual([path.join(d, 's1.events.jsonl')]);
    fs.rmSync(d, { recursive: true, force: true });
  });
  it('recognises sidecar names, split or not', () => {
    expect(isSidecarName('a.events.jsonl')).toBe(true);
    expect(isSidecarName('a.events.jsonl.part-0012')).toBe(true);
    expect(isSidecarName('a.jsonl.part-0012')).toBe(false);
    expect(isSidecarName('a.jsonl')).toBe(false);
  });
});
