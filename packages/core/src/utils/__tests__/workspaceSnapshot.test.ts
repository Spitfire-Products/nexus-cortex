/** R239 / P4 — WorkspaceSnapshot: shadow-git snapshot / restore on a scratch tree (the adapter's 09-24 validation, in the library). */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { WorkspaceSnapshot, SNAPSHOT_EXCLUDES } from '../workspaceSnapshot.js';

const hasGit = WorkspaceSnapshot.gitAvailable();

describe.skipIf(!hasGit)('WorkspaceSnapshot (shadow git outside the tree)', () => {
  it('lift → attempt tags → restore puts the tree back; excluded dirs + big files untouched', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wsnap-'));
    const ws = path.join(root, 'ws'); const gitDir = path.join(root, 'state', 'shadow.git');
    try {
      fs.mkdirSync(path.join(ws, 'src'), { recursive: true }); fs.mkdirSync(path.join(ws, 'node_modules', 'dep'), { recursive: true }); fs.mkdirSync(path.join(ws, '.cortex'), { recursive: true });
      fs.writeFileSync(path.join(ws, 'answer.txt'), 'lift\n'); fs.writeFileSync(path.join(ws, 'src', 'main.py'), 'x = 1\n');
      fs.writeFileSync(path.join(ws, 'node_modules', 'dep', 'index.js'), 'v1'); fs.writeFileSync(path.join(ws, '.cortex', 'state'), 's1');
      fs.writeFileSync(path.join(ws, 'big.bin'), Buffer.alloc(3 * 1024 * 1024, 1)); // above the 2 MiB test threshold → excluded
      const snap = new WorkspaceSnapshot({ workspace: ws, gitDir, bigFileBytes: 2 * 1024 * 1024 });
      expect(snap.init()).toBe(true);
      expect(fs.readFileSync(path.join(gitDir, 'info', 'exclude'), 'utf-8')).toContain('big.bin');
      for (const e of SNAPSHOT_EXCLUDES) expect(fs.readFileSync(path.join(gitDir, 'info', 'exclude'), 'utf-8')).toContain(e);
      expect(snap.commit('lift')).toBe(true);
      expect(snap.fileCount()).toBe(2); // answer.txt + src/main.py (big.bin, node_modules, .cortex excluded)
      expect(fs.existsSync(path.join(ws, '.git'))).toBe(false); // the git dir is OUTSIDE the tree

      // attempt 1 edits + adds + deletes; vendor + state + big file also change
      fs.writeFileSync(path.join(ws, 'answer.txt'), 'bad1\n'); fs.writeFileSync(path.join(ws, 'new1.txt'), 'n1'); fs.rmSync(path.join(ws, 'src', 'main.py'));
      fs.writeFileSync(path.join(ws, 'node_modules', 'dep', 'index.js'), 'v2'); fs.writeFileSync(path.join(ws, '.cortex', 'state'), 's2'); fs.writeFileSync(path.join(ws, 'big.bin'), Buffer.alloc(3 * 1024 * 1024, 2));
      expect(snap.commit('attempt1')).toBe(true);

      // back to lift: tracked files restored, untracked new file cleaned, excluded paths untouched
      expect(snap.restore('lift')).toBe(true);
      expect(fs.readFileSync(path.join(ws, 'answer.txt'), 'utf-8')).toBe('lift\n');
      expect(fs.existsSync(path.join(ws, 'src', 'main.py'))).toBe(true);
      expect(fs.existsSync(path.join(ws, 'new1.txt'))).toBe(false);
      expect(fs.readFileSync(path.join(ws, 'node_modules', 'dep', 'index.js'), 'utf-8')).toBe('v2');
      expect(fs.readFileSync(path.join(ws, '.cortex', 'state'), 'utf-8')).toBe('s2');
      expect(fs.readFileSync(path.join(ws, 'big.bin'))[0]).toBe(2);

      // attempt 2, then restore attempt 1 (the selection)
      fs.writeFileSync(path.join(ws, 'answer.txt'), 'good2\n');
      expect(snap.commit('attempt2')).toBe(true);
      expect(snap.tags().sort()).toEqual(['attempt1', 'attempt2', 'lift']);
      expect(snap.restore('attempt1')).toBe(true);
      expect(fs.readFileSync(path.join(ws, 'answer.txt'), 'utf-8')).toBe('bad1\n');
      expect(fs.existsSync(path.join(ws, 'new1.txt'))).toBe(true);
      expect(fs.existsSync(path.join(ws, 'src', 'main.py'))).toBe(false);
      expect(snap.restore('attempt2')).toBe(true);
      expect(fs.readFileSync(path.join(ws, 'answer.txt'), 'utf-8')).toBe('good2\n');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
  it('reports failure instead of throwing: unknown tag, missing workspace, verbs before init', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wsnap-'));
    try {
      const ws = path.join(root, 'ws'); fs.mkdirSync(ws);
      const snap = new WorkspaceSnapshot({ workspace: ws, gitDir: path.join(root, 'g') });
      expect(snap.commit('lift')).toBe(false); expect(snap.restore('lift')).toBe(false); expect(snap.tags()).toEqual([]);
      expect(snap.init()).toBe(true); expect(snap.commit('lift')).toBe(true);
      expect(snap.restore('nope')).toBe(false);
      expect(new WorkspaceSnapshot({ workspace: path.join(root, 'missing'), gitDir: path.join(root, 'g2') }).init()).toBe(false);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
});
