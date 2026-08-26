/**
 * Item 10 — doctrine-curation staging/apply mechanics (pure, testable).
 *
 * The orient script stages a mechanical refresh (`.cortex/CORTEX.md.next` +
 * `.cortex/CORTEX.md.diff`) when the machine-authored sections drift from
 * live workspace state. The helper model curates the merge in a disposable
 * side context (HelperModelMiddleware.curateDoctrine); this module owns the
 * filesystem half: read the staging, validate the curated output, apply
 * ATOMICALLY with a `.prev` rollback. The MAIN model never participates —
 * its turn-1 surface stays zero-decision (operator-set doctrine).
 *
 * Cache compliance (item 11d contract): everything here happens at
 * prefix-rebuild boundaries (session start / the defer lift) — never
 * mid-session, never mutating delivered context.
 */
import { existsSync, readFileSync, writeFileSync, copyFileSync, renameSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

export interface StagedDoctrine {
  staleDoc: string;
  stagedNext: string;
  diff: string;
  docPath: string;
  nextPath: string;
  diffPath: string;
}

/** Read the staged refresh, if the orient script left one. */
export function readStagedDoctrine(projectPath: string): StagedDoctrine | null {
  const docPath = join(projectPath, '.cortex', 'CORTEX.md');
  const nextPath = join(projectPath, '.cortex', 'CORTEX.md.next');
  const diffPath = join(projectPath, '.cortex', 'CORTEX.md.diff');
  if (!existsSync(nextPath)) return null;
  return {
    staleDoc: existsSync(docPath) ? readFileSync(docPath, 'utf8') : '',
    stagedNext: readFileSync(nextPath, 'utf8'),
    diff: existsSync(diffPath) ? readFileSync(diffPath, 'utf8') : '',
    docPath, nextPath, diffPath,
  };
}

/**
 * Apply a curated doc: size-validated, `.prev` backup, atomic tmp+rename,
 * staging cleaned up. Throws on validation failure (caller fails open to the
 * previous doc and records the event).
 */
export function applyCuratedDoctrine(
  staged: StagedDoctrine,
  curated: string,
  maxBytes: number
): { bytes: number } {
  const body = curated.trim();
  if (body.length < 40) throw new Error(`curated doc too small (${body.length}B) — refusing to apply`);
  const bytes = Buffer.byteLength(body, 'utf8');
  if (bytes > maxBytes) throw new Error(`curated doc ${bytes}B exceeds budget ${maxBytes}B — refusing to apply`);
  if (existsSync(staged.docPath)) copyFileSync(staged.docPath, `${staged.docPath}.prev`);
  const tmp = `${staged.docPath}.tmp-${process.pid}`;
  writeFileSync(tmp, body + '\n');
  renameSync(tmp, staged.docPath);
  rmSync(staged.nextPath, { force: true });
  rmSync(staged.diffPath, { force: true });
  return { bytes };
}

/**
 * Full-mass pre-assembly leg: run the orient script harness-side so drift
 * staging exists BEFORE turn-0 prompt assembly (under defer the MODEL runs
 * orient on turn 1 instead — same script, same staging). Mechanical,
 * bounded, silent on any failure: orient itself always exits 0, and a
 * missing script simply means no staging.
 */
export function runOrientForStaging(projectPath: string, timeoutMs = 8000): void {
  const candidates = [
    join(projectPath, '.cortex', 'orient'),
    process.env.CORTEX_ROOT ? join(process.env.CORTEX_ROOT, '.cortex', 'orient') : '',
  ].filter(Boolean) as string[];
  const script = candidates.find(p => existsSync(p));
  if (!script) return;
  try {
    execFileSync('sh', [script], { cwd: projectPath, timeout: timeoutMs, stdio: 'ignore' });
  } catch { /* mechanical + optional — never blocks a session */ }
}

/** Bounded await helper — resolves to null on timeout instead of rejecting. */
export async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>(res => { timer = setTimeout(() => res(null), ms); });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
