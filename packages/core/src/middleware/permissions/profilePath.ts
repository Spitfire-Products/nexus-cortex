import * as fs from 'fs';
import * as path from 'path';

export type PermissionProfileName = 'dev' | 'test' | 'prod';

/**
 * Resolve the on-disk path for a named permission profile.
 *
 * Resolution order (project override wins):
 *   1. <projectRoot>/.cortex/permissions.<profile>.json
 *   2. <projectRoot>/.cortex/permissions/<profile>.json
 *   3. ~/.cortex/permissions.<profile>.json        (global default)
 *   4. ~/.cortex/permissions/<profile>.json         (global default, subdir form)
 *
 * Returns the absolute path of the first file that exists, or `null` when
 * none is present.
 */
export function resolvePermissionProfilePath(
  profile: PermissionProfileName,
  projectRoot: string,
): string | null {
  // Project-level (override)
  const dotted = path.join(projectRoot, '.cortex', `permissions.${profile}.json`);
  if (fs.existsSync(dotted)) return dotted;

  const sub = path.join(projectRoot, '.cortex', 'permissions', `${profile}.json`);
  if (fs.existsSync(sub)) return sub;

  // Global default (~/.cortex/)
  const home = process.env.HOME || process.env.USERPROFILE || '';
  if (home) {
    const globalDotted = path.join(home, '.cortex', `permissions.${profile}.json`);
    if (fs.existsSync(globalDotted)) return globalDotted;

    const globalSub = path.join(home, '.cortex', 'permissions', `${profile}.json`);
    if (fs.existsSync(globalSub)) return globalSub;
  }

  return null;
}
