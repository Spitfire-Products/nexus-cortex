/**
 * Tests for PermissionsMiddleware
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PermissionsMiddleware } from '../PermissionsMiddleware.js';
import { WhitelistPolicy } from '../permissions/WhitelistPolicy.js';
import { BlacklistPolicy } from '../permissions/BlacklistPolicy.js';
import { FileOperationPolicy } from '../permissions/FileOperationPolicy.js';
import { BashCommandPolicy } from '../permissions/BashCommandPolicy.js';
import { AutoApproveHandler } from '../permissions/AutoApproveHandler.js';
import { DenyAllHandler } from '../permissions/DenyAllHandler.js';
import type { MiddlewareContext, ApprovalHandler } from '../contracts/MiddlewareContracts.js';

describe('PermissionsMiddleware', () => {
  let middleware: PermissionsMiddleware;
  let context: MiddlewareContext;

  beforeEach(() => {
    context = {
      sessionId: 'test-session',
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
  });

  describe('basic permission checks', () => {
    it('should allow operations when policies permit', async () => {
      middleware = new PermissionsMiddleware({
        policies: [new WhitelistPolicy(['read_file'])],
      });

      const decision = await middleware.checkPermission(
        'read_file',
        { file_path: '/file.txt' },
        context
      );

      expect(decision.allowed).toBe(true);
    });

    it('should deny operations when policies block', async () => {
      middleware = new PermissionsMiddleware({
        policies: [new BlacklistPolicy(['Write'])],  // Blacklist the Write tool
      });

      const decision = await middleware.checkPermission(
        'Write',  // Use canonical tool name
        { file_path: '/file.txt' },
        context
      );

      expect(decision.allowed).toBe(false);
    });
  });

  describe('approval flow', () => {
    it('should request approval when policy requires it', async () => {
      const approvalHandler: ApprovalHandler = {
        requestApproval: vi.fn().mockResolvedValue(true),
      };

      middleware = new PermissionsMiddleware({
        policies: [
          new FileOperationPolicy({
            allowedPaths: ['/workspace'],
            blockedPaths: [],
            requireApprovalForWrite: true,  // Require approval for Write operations
          }),
        ],
        approvalHandler,
      });

      const decision = await middleware.checkPermission(
        'Write',  // Use canonical tool name
        { file_path: '/workspace/file.txt' },
        context
      );

      expect(approvalHandler.requestApproval).toHaveBeenCalled();
      expect(decision.allowed).toBe(true); // Approved
    });

    it('should deny when approval is rejected', async () => {
      const approvalHandler: ApprovalHandler = {
        requestApproval: vi.fn().mockResolvedValue(false),
      };

      middleware = new PermissionsMiddleware({
        policies: [
          new FileOperationPolicy({
            allowedPaths: ['/workspace'],
            blockedPaths: [],
            requireApprovalForWrite: true,  // Require approval for Write operations
          }),
        ],
        approvalHandler,
      });

      const decision = await middleware.checkPermission(
        'Write',  // Use canonical tool name
        { file_path: '/workspace/file.txt' },
        context
      );

      expect(decision.allowed).toBe(false);
    });

    it('should use auto-approve handler', async () => {
      middleware = new PermissionsMiddleware({
        policies: [
          new FileOperationPolicy({
            allowedPaths: ['/workspace'],
            blockedPaths: [],
            requireApprovalForWrite: true,  // Require approval for Write operations
          }),
        ],
        approvalHandler: new AutoApproveHandler(),
      });

      const decision = await middleware.checkPermission(
        'Write',  // Use canonical tool name
        { file_path: '/workspace/file.txt' },
        context
      );

      expect(decision.allowed).toBe(true); // Auto-approved
    });

    it('should use deny-all handler', async () => {
      middleware = new PermissionsMiddleware({
        policies: [
          new FileOperationPolicy({
            allowedPaths: ['/workspace'],
            blockedPaths: [],
            requireApprovalForWrite: true,  // Require approval for Write operations
          }),
        ],
        approvalHandler: new DenyAllHandler(),
      });

      const decision = await middleware.checkPermission(
        'Write',  // Use canonical tool name
        { file_path: '/workspace/file.txt' },
        context
      );

      expect(decision.allowed).toBe(false); // Denied
    });
  });

  describe('audit logging', () => {
    it('should track decisions in memory', async () => {
      middleware = new PermissionsMiddleware({
        policies: [new WhitelistPolicy(['read_file'])],
      });

      await middleware.checkPermission('read_file', {}, context);

      const auditLog = middleware.getAuditLog('test-session');

      expect(auditLog.length).toBe(1);
      expect(auditLog[0].toolName).toBe('read_file');
      expect(auditLog[0].sessionId).toBe('test-session');
    });

    it('should track multiple decisions', async () => {
      middleware = new PermissionsMiddleware({
        policies: [new WhitelistPolicy(['read_file', 'write_file'])],
      });

      await middleware.checkPermission('read_file', {}, context);
      await middleware.checkPermission('write_file', {}, context);

      const auditLog = middleware.getAuditLog('test-session');

      expect(auditLog.length).toBe(2);
    });

    it('should clear session cache', async () => {
      middleware = new PermissionsMiddleware({
        policies: [new WhitelistPolicy(['read_file'])],
      });

      await middleware.checkPermission('read_file', {}, context);

      middleware.clearSessionCache('test-session');

      const auditLog = middleware.getAuditLog('test-session');

      expect(auditLog.length).toBe(0);
    });
  });

  describe('policy management', () => {
    it('should register policies dynamically', async () => {
      middleware = new PermissionsMiddleware();

      middleware.registerPolicy(new WhitelistPolicy(['read_file']));

      const decision = await middleware.checkPermission(
        'read_file',
        {},
        context
      );

      expect(decision.allowed).toBe(true);
    });

    it('should unregister policies', async () => {
      middleware = new PermissionsMiddleware({
        policies: [new WhitelistPolicy(['read_file'])],
      });

      middleware.unregisterPolicy('whitelist');

      const decision = await middleware.checkPermission(
        'read_file',
        {},
        context
      );

      expect(decision.allowed).toBe(false); // Default deny
    });
  });

  describe('multiple policies', () => {
    it('should evaluate multiple policies correctly', async () => {
      middleware = new PermissionsMiddleware({
        policies: [
          new WhitelistPolicy(['Read', 'Write']),  // Use canonical names
          new FileOperationPolicy({
            allowedPaths: ['/workspace'],
            blockedPaths: ['/etc'],
          }),
        ],
      });

      // Allowed by both policies
      let decision = await middleware.checkPermission(
        'Read',  // Use canonical name
        { file_path: '/workspace/file.txt' },
        context
      );
      expect(decision.allowed).toBe(true);

      // Blocked by file policy
      decision = await middleware.checkPermission(
        'Read',  // Use canonical name
        { file_path: '/etc/passwd' },
        context
      );
      expect(decision.allowed).toBe(false);

      // Blocked by whitelist (Edit is not in the whitelist)
      decision = await middleware.checkPermission(
        'Edit',  // Tool not in whitelist
        { file_path: '/workspace/file.txt' },
        context
      );
      expect(decision.allowed).toBe(false);
    });
  });

  describe('createDefault factory', () => {
    it('should create default middleware', async () => {
      middleware = await PermissionsMiddleware.createDefault('/workspace');

      expect(middleware.getPolicies().length).toBeGreaterThan(0);
    });
  });
});
