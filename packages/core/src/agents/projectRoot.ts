/**
 * Project-root resolution for agent discovery.
 *
 * Agents declared in a project's `.cortex/agents/` should be discoverable when
 * the tool is launched from any subdirectory of that project — not only from
 * the project root. This walks up from a starting directory to the nearest
 * ancestor that actually contains a `.cortex/agents` directory.
 *
 * Bounded so it never treats `$HOME` (or anything above it) as a project root —
 * `~/.cortex/agents` is the personal tier, not the project tier. Falls back to
 * `<startDir>/.cortex/agents` when no ancestor project root is found.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export function resolveProjectAgentsDir(
  startDir: string,
  homeDir: string = os.homedir(),
): string {
  const home = path.resolve(homeDir);
  const fallback = path.join(path.resolve(startDir), '.cortex', 'agents');
  let dir = path.resolve(startDir);

  // Walk up, but stop before reaching $HOME (personal tier) or the FS root.
  while (dir !== home) {
    const candidate = path.join(dir, '.cortex', 'agents');
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      // ignore fs errors and keep walking
    }
    const parent = path.dirname(dir);
    if (parent === dir) break; // filesystem root
    dir = parent;
  }

  return fallback;
}
