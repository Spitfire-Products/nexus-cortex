/**
 * AgentStore builtin tier — agents shipped with the install ($CORTEX_ROOT) are
 * discoverable from any cwd, at the lowest priority (project > personal >
 * builtin), with path dedup so the same directory isn't double-loaded.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AgentStore } from '../AgentStore.js';

function writeAgent(dir: string, name: string, marker: string): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `${name}.md`),
    `---\nname: ${name}\ndescription: ${marker}\nmodel: inherit\n---\n${marker} body\n`,
    'utf-8',
  );
}

describe('AgentStore builtin tier', () => {
  let root: string;
  let builtinDir: string;
  let personalDir: string;
  let projectDir: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentstore-'));
    builtinDir = path.join(root, 'builtin');
    personalDir = path.join(root, 'personal');
    projectDir = path.join(root, 'project');
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('loads builtin agents and lets personal/project override by name', async () => {
    writeAgent(builtinDir, 'shared', 'from-builtin');
    writeAgent(builtinDir, 'only-builtin', 'from-builtin');
    writeAgent(personalDir, 'shared', 'from-personal');
    writeAgent(personalDir, 'only-personal', 'from-personal');
    writeAgent(projectDir, 'shared', 'from-project');
    writeAgent(projectDir, 'only-project', 'from-project');

    const store = new AgentStore({ builtinDir, personalDir, projectDir });
    await store.initialize();

    const names = store.getAll().map((a) => a.name).sort();
    expect(names).toEqual(['only-builtin', 'only-personal', 'only-project', 'shared']);

    // project wins the override; builtin-only survives at builtin priority
    expect(store.getAgent('shared')!.location).toBe('project');
    expect(store.getAgent('shared')!.description).toBe('from-project');
    expect(store.getAgent('only-builtin')!.location).toBe('builtin');
    expect(store.getAgent('only-personal')!.location).toBe('personal');
  });

  it('dedups when a higher-priority tier points at the same directory', async () => {
    // builtin and project resolve to the SAME dir (e.g. launched from install)
    writeAgent(builtinDir, 'shared', 'same-dir');
    const store = new AgentStore({
      builtinDir,
      personalDir,
      projectDir: builtinDir, // same path as builtin
    });
    await store.initialize();

    const shared = store.getAll().filter((a) => a.name === 'shared');
    expect(shared).toHaveLength(1); // not double-loaded
    expect(shared[0]!.location).toBe('project'); // labeled by the higher tier
  });
});
