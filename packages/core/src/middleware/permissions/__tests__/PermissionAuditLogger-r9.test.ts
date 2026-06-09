/**
 * Regression test: PermissionAuditLogger.rotateIfNeeded
 * previously called fs.existsSync inside an async hot path. Now it relies
 * on the async fs.promises.stat throwing ENOENT for missing files.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PermissionAuditLogger } from '../PermissionAuditLogger.js';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('PermissionAuditLogger.rotateIfNeeded — async stat path (Round 9)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'r9-audit-'));
  });

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('handles missing log file gracefully via ENOENT catch (no throw)', async () => {
    const logger = new PermissionAuditLogger(
      join(tmpDir, 'never-created.log'),
      {
        enableRotation: true,
        maxFileSizeBytes: 1024,
        maxFiles: 3,
      } as any,
    );

    // First log() write creates the file; we just need rotateIfNeeded to
    // not throw when the file doesn't exist yet.
    await expect(
      logger.log({
        timestamp: new Date().toISOString(),
        toolName: 'Read',
        toolInput: {},
        decision: { allowed: true },
        policyName: 'test',
      } as any),
    ).resolves.toBeUndefined();

    await logger.close().catch(() => {});
  });
});
