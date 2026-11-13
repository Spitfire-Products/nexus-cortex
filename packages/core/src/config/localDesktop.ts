/**
 * The DESKTOP surface (2026-11-12, operator: browser and desktop are separate surfaces): host-computer control through the optional
 * @nexus-cortex/desktop package (AGPL-3.0-only OR commercial). Core never imports the package — it finds it and, when NEXUS_DESKTOP is
 * virtual|real (`cortex desktop enable`), registers the "nexus-desktop" MCP server, served IN-PROCESS (createDesktopMCP over InMemoryTransport).
 *   virtual — a private X display (Linux, Xvfb), never the user's screen; the only mode for containers / headless runs.
 *   real    — the user's own screen (macOS, or Linux $DISPLAY); enabled only interactively.
 */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

export interface DesktopSurface { mode: 'off' | 'virtual' | 'real'; using: boolean; reason: string; indexJs?: string; packageDir?: string }

export function localDesktopPackageDir(): string | null {
  try { return path.dirname(createRequire(import.meta.url).resolve('@nexus-cortex/desktop/package.json')); } catch { return null; }
}

export function resolveDesktop(env: NodeJS.ProcessEnv = process.env): DesktopSurface {
  const m = String(env.NEXUS_DESKTOP ?? '').trim().toLowerCase();
  const mode = m === 'virtual' || m === 'real' ? m : 'off';
  if (mode === 'off') return { mode, using: false, reason: 'NEXUS_DESKTOP is not set (off by default) — `cortex desktop enable` turns it on' };
  const dir = localDesktopPackageDir();
  if (!dir) return { mode, using: false, reason: 'the @nexus-cortex/desktop package is not installed (cortex desktop install)' };
  const indexJs = path.join(dir, 'dist', 'index.js');
  if (!fs.existsSync(indexJs)) return { mode, using: false, reason: `${indexJs} is missing (package not built)`, packageDir: dir };
  return { mode, using: true, reason: `desktop ${mode} — served in-process as nexus-desktop`, indexJs, packageDir: dir };
}
