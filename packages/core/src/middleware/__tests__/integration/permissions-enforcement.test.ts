/**
 * Integration test for permissions enforcement
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { PermissionsMiddleware } from '../../PermissionsMiddleware.js';
import { WhitelistPolicy } from '../../permissions/WhitelistPolicy.js';
import { BlacklistPolicy } from '../../permissions/BlacklistPolicy.js';
import { FileOperationPolicy } from '../../permissions/FileOperationPolicy.js';
import { BashCommandPolicy } from '../../permissions/BashCommandPolicy.js';
import { PermissionAuditLogger } from '../../permissions/PermissionAuditLogger.js';
import { AutoApproveHandler } from '../../permissions/AutoApproveHandler.js';
import type { MiddlewareContext } from '../../contracts/MiddlewareContracts.js';

describe('Permissions Enforcement Integration', () => {
  let middleware: PermissionsMiddleware;
  let context: MiddlewareContext;
  let tempDir: string;
  let auditLogPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'permissions-test-'));
    auditLogPath = path.join(tempDir, 'audit.log');

    context = {
      sessionId: 'integration-test-session',
      conversationId: 'test-conversation',
      turnNumber: 1,
      modelId: 'test-model',
      config: {} as any,
    };
  });

  afterEach(async () => {
    if (middleware) {
      await middleware.close();
    }

    // Cleanup temp directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('real-world scenario: development environment', () => {
    beforeEach(() => {
      middleware = new PermissionsMiddleware({
        policies: [
          new WhitelistPolicy([
            'Read',
            'Write',
            'Edit',
            'Bash',
            'Glob'  // List files uses Glob tool,
          ]),
          new FileOperationPolicy({
            allowedPaths: [tempDir],
            blockedPaths: ['/etc', '/root', '/.git'],
            requireApprovalForDelete: true,
          }),
          new BashCommandPolicy({
            allowedCommands: [],
            blockedCommands: ['sudo', 'rm -rf /'],
            requireApprovalForDangerous: true,
          }),
        ],
        approvalHandler: new AutoApproveHandler(),
        auditLogger: new PermissionAuditLogger(auditLogPath),
        defaultPolicy: 'deny',
      });
    });

    it('should allow safe file read operations', async () => {
      const decision = await middleware.checkPermission(
        'Read',
        { file_path: path.join(tempDir, 'file.txt') },
        context
      );

      expect(decision.allowed).toBe(true);
    });

    it('should block access to /etc files', async () => {
      const decision = await middleware.checkPermission(
        'Read',
        { file_path: '/etc/passwd' },
        context
      );

      expect(decision.allowed).toBe(false);
    });

    it('should allow safe bash commands', async () => {
      const decision = await middleware.checkPermission(
        'Bash',
        { command: 'ls -la' },
        context
      );

      expect(decision.allowed).toBe(true);
    });

    it('should block dangerous bash commands', async () => {
      const decision = await middleware.checkPermission(
        'Bash',
        { command: 'sudo apt-get install' },
        context
      );

      expect(decision.allowed).toBe(false);
    });

    it('should require approval for delete operations', async () => {
      // With AutoApproveHandler, this should be approved
      const decision = await middleware.checkPermission(
        'Bash',  // Delete operations use Bash with rm
        { command: 'rm ' + path.join(tempDir, 'file.txt') },
        context
      );

      expect(decision.allowed).toBe(true); // Auto-approved
    });

    it('should block tools not in whitelist', async () => {
      const decision = await middleware.checkPermission(
        'format_disk',
        { disk: '/dev/sda' },
        context
      );

      expect(decision.allowed).toBe(false);
    });

    it('should log all decisions to audit log', async () => {
      await middleware.checkPermission(
        'Read',
        { file_path: path.join(tempDir, 'file.txt') },
        context
      );

      await middleware.checkPermission(
        'Write',
        { file_path: path.join(tempDir, 'file.txt') },
        context
      );

      await middleware.checkPermission(
        'Read',
        { file_path: '/etc/passwd' },
        context
      );

      const entries = await middleware.getAuditLogFromStorage(
        'integration-test-session'
      );

      expect(entries.length).toBe(3);
      expect(entries[0].toolName).toBe('Read');
      expect(entries[0].decision.allowed).toBe(true);
      expect(entries[2].decision.allowed).toBe(false);
    });
  });

  describe('real-world scenario: production environment (strict)', () => {
    beforeEach(() => {
      middleware = new PermissionsMiddleware({
        policies: [
          new BlacklistPolicy(['Bash', 'Write'], 100),  // Bash handles delete operations via rm
          new WhitelistPolicy(['Read', 'Glob'], 40),  // Glob is for listing files
          new FileOperationPolicy({
            allowedPaths: [path.join(tempDir, 'public')],
            blockedPaths: [],
          }),
        ],
        defaultPolicy: 'deny',
      });
    });

    it('should only allow read and list operations', async () => {
      let decision = await middleware.checkPermission(
        'Read',
        { file_path: path.join(tempDir, 'public', 'file.txt') },
        context
      );
      expect(decision.allowed).toBe(true);

      decision = await middleware.checkPermission(
        'Glob',  // List files uses Glob tool
        { pattern: '*' },
        context
      );
      expect(decision.allowed).toBe(true);

      decision = await middleware.checkPermission(
        'Write',
        { file_path: path.join(tempDir, 'public', 'file.txt') },
        context
      );
      expect(decision.allowed).toBe(false);
    });

    it('should block all bash execution', async () => {
      const decision = await middleware.checkPermission(
        'Bash',
        { command: 'ls' },
        context
      );

      expect(decision.allowed).toBe(false);
    });
  });

  describe('policy priority enforcement', () => {
    it('should respect priority order', async () => {
      middleware = new PermissionsMiddleware({
        policies: [
          new WhitelistPolicy(['Bash'], 40), // Low priority - allows Bash
          new BlacklistPolicy(['Bash'], 100), // High priority - blocks Bash
        ],
      });

      const decision = await middleware.checkPermission(
        'Bash',
        { command: 'rm file.txt' },
        context
      );

      // Blacklist (higher priority) should win
      expect(decision.allowed).toBe(false);
    });
  });

  describe('audit statistics', () => {
    beforeEach(() => {
      middleware = new PermissionsMiddleware({
        policies: [new WhitelistPolicy(['Read', 'Write'])],
        auditLogger: new PermissionAuditLogger(auditLogPath),
      });
    });

    it('should provide audit statistics', async () => {
      await middleware.checkPermission('Read', { file_path: '/test.txt' }, context);
      await middleware.checkPermission('Write', { file_path: '/test.txt' }, context);
      await middleware.checkPermission('Bash', { command: 'rm test.txt' }, context);

      const stats = await middleware.getStatistics();

      expect(stats).toBeDefined();
      expect(stats!.totalEntries).toBe(3);
      expect(stats!.allowedCount).toBe(2);
      expect(stats!.deniedCount).toBe(1);
    });
  });
});
