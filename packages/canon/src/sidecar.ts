/**
 * Events-sidecar resolution (2026-11-11). `<session>.events.jsonl` is written through the same chunk-aware writer as the main
 * canon file, so a sidecar over 50 MB lands as `<session>.events.jsonl.part-NNNN` (GitHub rejects files > 100 MB; the 824 MB
 * faee1cf3 session produced a 135.65 MB sidecar). Readers resolve a sidecar with sidecarFiles(): the single file when it
 * exists, else its parts in order, else nothing.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

/** The sidecar path for a logical session file (`…/<id>.jsonl` → `…/<id>.events.jsonl`). */
export function sidecarLogical(logicalAbs: string): string {
  return logicalAbs.replace(/\.part-\d{4}$/, '').replace(/\.jsonl$/, '.events.jsonl');
}

/** The on-disk files holding a session's sidecar: [single] | sorted parts | []. */
export function sidecarFiles(logicalAbs: string): string[] {
  const side = sidecarLogical(logicalAbs);
  if (fs.existsSync(side)) return [side];
  const dir = path.dirname(side); const base = path.basename(side) + '.part-';
  let names: string[] = [];
  try { names = fs.readdirSync(dir); } catch { return []; }
  return names.filter((n) => n.startsWith(base) && /^\d{4}$/.test(n.slice(base.length))).sort().map((n) => path.join(dir, n));
}

/** True for a sidecar file name, single or part (`x.events.jsonl`, `x.events.jsonl.part-0003`). */
export function isSidecarName(name: string): boolean {
  return /\.events\.jsonl(\.part-\d{4})?$/.test(name);
}
