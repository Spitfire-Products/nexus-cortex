/**
 * MemoryTools.test.ts — P-A two-tier memory tools (stages 2+3).
 * Real-filesystem tests over a temp dir (no mocks — the tools ARE fs operations).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { MemoryWrite, MemoryRecall } from '../MemoryTools.js';

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'memtools-'));
  delete process.env.CORTEX_SUBAGENT;
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
  delete process.env.CORTEX_SUBAGENT;
});

const idx = () => fs.readFile(path.join(dir, '.cortex', 'MEMORY.md'), 'utf-8');

describe('MemoryWrite', () => {
  it('creates a per-fact file with frontmatter + one index line', async () => {
    const r = await MemoryWrite.execute(
      { name: 'deploy-flow', type: 'project', description: 'deploy via script X', content: 'detail' }, dir);
    expect(r.success).toBe(true);
    const fact = await fs.readFile(path.join(dir, '.cortex', 'memory', 'deploy-flow.md'), 'utf-8');
    expect(fact).toContain('name: deploy-flow');
    expect(fact).toContain('type: project');
    const index = await idx();
    expect(index.split('\n').filter((l) => l.includes('(memory/deploy-flow.md)'))).toHaveLength(1);
  });

  it('dedupes by name: re-writing UPDATES the file and replaces the index line', async () => {
    await MemoryWrite.execute({ name: 'a', description: 'old desc', content: 'v1' }, dir);
    const r = await MemoryWrite.execute({ name: 'a', description: 'new desc', content: 'v2' }, dir);
    expect(r.message).toMatch(/^Updated/);
    const index = await idx();
    expect(index.split('\n').filter((l) => l.includes('(memory/a.md)'))).toHaveLength(1);
    expect(index).toContain('new desc');
    expect(index).not.toContain('old desc');
  });

  it('delete removes the file and the index line', async () => {
    await MemoryWrite.execute({ name: 'gone', description: 'd', content: 'c' }, dir);
    await MemoryWrite.execute({ action: 'delete', name: 'gone' }, dir);
    expect((await idx())).not.toContain('gone');
    await expect(fs.access(path.join(dir, '.cortex', 'memory', 'gone.md'))).rejects.toThrow();
  });

  it('rejects invalid slugs and types; requires description+content', async () => {
    expect((await MemoryWrite.execute({ name: 'Bad Name!' }, dir)).success).toBe(false);
    expect((await MemoryWrite.execute({ name: 'ok', type: 'nope', description: 'd', content: 'c' }, dir)).success).toBe(false);
    expect((await MemoryWrite.execute({ name: 'ok', description: '', content: 'c' }, dir)).success).toBe(false);
  });

  it('is READ-ONLY in sub-agents (stage-3 ownership rule)', async () => {
    process.env.CORTEX_SUBAGENT = '1';
    const r = await MemoryWrite.execute({ name: 'x', description: 'd', content: 'c' }, dir);
    expect(r.success).toBe(false);
    expect(r.message).toContain('read-only');
  });
});

describe('MemoryRecall', () => {
  it('recalls full detail by name and searches by query', async () => {
    await MemoryWrite.execute({ name: 'tdd-rule', type: 'feedback', description: 'user wants TDD', content: 'red green refactor' }, dir);
    const byName = await MemoryRecall.execute({ name: 'tdd-rule' }, dir);
    expect(byName.success).toBe(true);
    expect(byName.message).toContain('red green refactor');
    const byQuery = await MemoryRecall.execute({ query: 'tdd' }, dir);
    expect(byQuery.success).toBe(true);
    expect(byQuery.message).toContain('tdd-rule');
  });

  it('falls back to legacy monolith + archive when no per-fact files exist', async () => {
    await fs.mkdir(path.join(dir, '.cortex'), { recursive: true });
    await fs.writeFile(path.join(dir, '.cortex', 'MEMORY.md'), 'head\nthe khazarai verdict lives here\ntail');
    const r = await MemoryRecall.execute({ query: 'khazarai' }, dir);
    expect(r.success).toBe(true);
    expect(r.message).toContain('legacy');
    expect(r.message).toContain('khazarai verdict');
  });

  it('reports cleanly when nothing matches', async () => {
    const r = await MemoryRecall.execute({ query: 'zzz-not-there' }, dir);
    expect(r.success).toBe(false);
  });
});
