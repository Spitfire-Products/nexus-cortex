import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const MONOREPO_NAME = 'nexus-cortex-monorepo';

function isProjectRoot(dir: string): boolean {
  const pkgPath = join(dir, 'package.json');
  if (!existsSync(pkgPath)) return false;
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    return pkg.name === MONOREPO_NAME;
  } catch {
    return false;
  }
}

/**
 * Find the project root that contains the .env config.
 *
 * Resolution order:
 * 1. CORTEX_ROOT / CORTEX_ROOT env var (explicit override)
 * 2. Walk up from this file's location to find the monorepo package.json
 * 3. Walk up from cwd to find the monorepo package.json
 * 4. cwd fallback
 *
 * Validates by checking package.json name === "nexus-cortex-monorepo",
 * so it works in both monorepo dev and flattened npm installs.
 */
export function findProjectRoot(): string {
  const envRoot = process.env.CORTEX_ROOT;
  if (envRoot && existsSync(envRoot)) return envRoot;

  try {
    const thisFile = fileURLToPath(import.meta.url);
    let d = dirname(thisFile);
    for (let i = 0; i < 8; i++) {
      if (isProjectRoot(d)) return d;
      const parent = dirname(d);
      if (parent === d) break;
      d = parent;
    }
  } catch {}

  let dir = process.cwd();
  while (dir !== dirname(dir)) {
    if (isProjectRoot(dir)) return dir;
    dir = dirname(dir);
  }

  return process.cwd();
}
