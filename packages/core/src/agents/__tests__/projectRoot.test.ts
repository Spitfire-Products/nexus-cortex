/**
 * resolveProjectAgentsDir — walk up from a (sub)directory to the nearest
 * project root containing .cortex/agents, bounded so $HOME (the personal tier)
 * is never treated as a project root.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resolveProjectAgentsDir } from '../projectRoot.js';

describe('resolveProjectAgentsDir', () => {
  let home: string;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'home-'));
  });
  afterEach(() => {
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('finds the project root when launched from a subdirectory', () => {
    const projectRoot = path.join(home, 'myproject');
    const agentsDir = path.join(projectRoot, '.cortex', 'agents');
    const subdir = path.join(projectRoot, 'packages', 'core', 'src');
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.mkdirSync(subdir, { recursive: true });

    expect(resolveProjectAgentsDir(subdir, home)).toBe(agentsDir);
  });

  it('does NOT treat $HOME/.cortex/agents as a project root', () => {
    // Only HOME has .cortex/agents; a subdir below it must NOT resolve to it.
    fs.mkdirSync(path.join(home, '.cortex', 'agents'), { recursive: true });
    const subdir = path.join(home, 'someproject', 'src');
    fs.mkdirSync(subdir, { recursive: true });

    // No project root found before HOME → falls back to <startDir>/.cortex/agents
    expect(resolveProjectAgentsDir(subdir, home)).toBe(
      path.join(subdir, '.cortex', 'agents'),
    );
  });

  it('falls back to <startDir>/.cortex/agents when no ancestor has one', () => {
    const subdir = path.join(home, 'plain', 'dir');
    fs.mkdirSync(subdir, { recursive: true });
    expect(resolveProjectAgentsDir(subdir, home)).toBe(
      path.join(subdir, '.cortex', 'agents'),
    );
  });

  it('returns the nearest ancestor when multiple ancestors qualify', () => {
    const outer = path.join(home, 'outer');
    const inner = path.join(outer, 'inner');
    const start = path.join(inner, 'deep');
    fs.mkdirSync(path.join(outer, '.cortex', 'agents'), { recursive: true });
    fs.mkdirSync(path.join(inner, '.cortex', 'agents'), { recursive: true });
    fs.mkdirSync(start, { recursive: true });

    expect(resolveProjectAgentsDir(start, home)).toBe(
      path.join(inner, '.cortex', 'agents'),
    );
  });
});
