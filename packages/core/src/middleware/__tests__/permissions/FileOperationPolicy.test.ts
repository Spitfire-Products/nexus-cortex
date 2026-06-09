/**
 * Tests for FileOperationPolicy
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { FileOperationPolicy } from '../../permissions/FileOperationPolicy.js';
import type { PermissionContext } from '../../contracts/MiddlewareContracts.js';

describe('FileOperationPolicy', () => {
  let policy: FileOperationPolicy;
  let context: PermissionContext;

  beforeEach(() => {
    policy = new FileOperationPolicy({
      allowedPaths: ['/home/user/workspace'],
      blockedPaths: ['/etc', '/root'],
      requireApprovalForDelete: true,
    });

    context = {
      toolName: 'Read',  // Use canonical PascalCase name
      toolInput: { file_path: '/home/user/workspace/file.txt' },
      sessionId: 'test-session',
      timestamp: new Date(),
    };
  });

  describe('allowed paths', () => {
    it('should allow access to files in allowed paths', async () => {
      const decision = await policy.evaluate(context);

      expect(decision.allowed).toBe(true);
    });

    it('should deny access to files outside allowed paths', async () => {
      context.toolInput = { file_path: '/home/other/file.txt' };

      const decision = await policy.evaluate(context);

      expect(decision.allowed).toBe(false);
      expect(decision).toHaveProperty('reason');
      if (!decision.allowed) {
        expect(decision.canApprove).toBe(true); // Can approve
      }
    });

    it('should allow all paths when allowedPaths is empty', async () => {
      policy = new FileOperationPolicy({
        allowedPaths: [],
        blockedPaths: [],
      });

      context.toolInput = { file_path: '/any/path/file.txt' };

      const decision = await policy.evaluate(context);

      expect(decision.allowed).toBe(true);
    });
  });

  describe('blocked paths', () => {
    it('should block access to /etc files', async () => {
      context.toolInput = { file_path: '/etc/passwd' };

      const decision = await policy.evaluate(context);

      expect(decision.allowed).toBe(false);
      if (!decision.allowed) {
        expect(decision.canApprove).toBe(false); // Hard block
        expect(decision.reason).toContain('restricted');
      }
    });

    it('should block access to /root files', async () => {
      context.toolInput = { file_path: '/root/.ssh/id_rsa' };

      const decision = await policy.evaluate(context);

      expect(decision.allowed).toBe(false);
      if (!decision.allowed) {
        expect(decision.canApprove).toBe(false);
      }
    });

    it('should block access to sensitive directories', async () => {
      // Use absolute path that will be blocked
      context.toolInput = { file_path: '/.git/config' };

      const decision = await policy.evaluate(context);

      expect(decision.allowed).toBe(false);
      if (!decision.allowed) {
        expect(decision.canApprove).toBe(false);
      }
    });
  });

  describe('path traversal detection', () => {
    it('should detect ../ path traversal', async () => {
      context.toolInput = { file_path: '/home/user/workspace/../../../etc/passwd' };

      const decision = await policy.evaluate(context);

      expect(decision.allowed).toBe(false);
      if (!decision.allowed) {
        expect(decision.reason).toContain('traversal');
      }
    });

    it('should detect ./ patterns', async () => {
      context.toolInput = { file_path: './../../etc/passwd' };

      const decision = await policy.evaluate(context);

      expect(decision.allowed).toBe(false);
    });
  });

  // Note: Delete operations are done via Bash tool with rm commands,
  // not through a separate delete_file tool. Delete approval should be
  // tested in BashCommandPolicy tests for rm commands.

  describe('non-file operations', () => {
    it('should allow non-file operations', async () => {
      context.toolName = 'Bash';  // Use canonical PascalCase name
      context.toolInput = { command: 'ls -la' };

      const decision = await policy.evaluate(context);

      expect(decision.allowed).toBe(true);
    });
  });

  describe('path length validation', () => {
    it('should reject paths exceeding maximum length', async () => {
      policy = new FileOperationPolicy({
        allowedPaths: ['/home/user/workspace'],
        blockedPaths: [],
        maxPathLength: 100,
      });

      context.toolInput = { file_path: '/home/user/workspace/' + 'a'.repeat(200) };

      const decision = await policy.evaluate(context);

      expect(decision.allowed).toBe(false);
      if (!decision.allowed) {
        expect(decision.reason).toContain('maximum length');
      }
    });
  });
});
