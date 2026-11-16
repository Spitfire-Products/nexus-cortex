/**
 * Events-sidecar resolution (2026-11-11). `<session>.events.jsonl` is written through the same chunk-aware writer as the main
 * canon file, so a sidecar over 50 MB lands as `<session>.events.jsonl.part-NNNN` (GitHub rejects files > 100 MB; the 824 MB
 * faee1cf3 session produced a 135.65 MB sidecar). Readers resolve a sidecar with sidecarFiles(): the single file when it
 * exists, else its parts in order, else nothing.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { logicalPathOf } from './canonSegments.js';

/** The sidecar path for a logical session file (`…/<id>.jsonl` → `…/<id>.events.jsonl`). */
export function sidecarLogical(logicalAbs: string): string {
  return logicalPathOf(logicalAbs).replace(/\.jsonl$/, '.events.jsonl');
}

/** The on-disk files holding a session's sidecar: segmented sub-chunks (canonSegments — they win over an old layout kept
 *  beside them) | [single] | sorted parts | []. */
export function sidecarFiles(logicalAbs: string): string[] {
  const side = sidecarLogical(logicalAbs);
  const dir = path.dirname(side);
  let names: string[] | undefined;
  const list = () => { try { return (names ??= fs.readdirSync(dir)); } catch { return (names = []); } };
  const segBase = path.basename(side) + '.seg-';
  const seg = list().filter((n) => n.startsWith(segBase) && /^\d{4}\.part-\d{4}$/.test(n.slice(segBase.length))).sort();
  if (seg.length) return seg.map((n) => path.join(dir, n));
  if (fs.existsSync(side)) return [side];
  const base = path.basename(side) + '.part-';
  return list().filter((n) => n.startsWith(base) && /^\d{4}$/.test(n.slice(base.length))).sort().map((n) => path.join(dir, n));
}

/** True for a sidecar file name, single, part or segmented (`x.events.jsonl`, `….part-0003`, `….seg-0002.part-0000`). */
export function isSidecarName(name: string): boolean {
  return /\.events\.jsonl(\.seg-\d{4})?(\.part-\d{4})?$/.test(name);
}
