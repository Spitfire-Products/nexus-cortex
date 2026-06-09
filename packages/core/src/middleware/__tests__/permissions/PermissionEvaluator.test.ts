/**
 * Tests for PermissionEvaluator
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { PermissionEvaluator } from '../../permissions/PermissionEvaluator.js';
import { WhitelistPolicy } from '../../permissions/WhitelistPolicy.js';
import { BlacklistPolicy } from '../../permissions/BlacklistPolicy.js';
import { FileOperationPolicy } from '../../permissions/FileOperationPolicy.js';
import type { PermissionContext, PermissionPolicy } from '../../contracts/MiddlewareContracts.js';

describe('PermissionEvaluator', () => {
  let evaluator: PermissionEvaluator;
  let context: PermissionContext;

  beforeEach(() => {
    evaluator = new PermissionEvaluator({ defaultPolicy: 'deny' });

    context = {
      toolName: 'Read',  // Use canonical PascalCase name
      toolInput: { file_path: '/workspace/file.txt' },
      sessionId: 'test-session',
      timestamp: new Date(),
    };
  });

  describe('policy registration', () => {
    it('should register policies', () => {
      const policy = new WhitelistPolicy(['Read']);

      evaluator.registerPolicy(policy);

      expect(evaluator.getPolicies()).toContain(policy);
    });

    it('should throw on duplicate policy names', () => {
      const policy1 = new WhitelistPolicy(['Read']);
      const policy2 = new WhitelistPolicy(['Write']);

      evaluator.registerPolicy(policy1);

      expect(() => evaluator.registerPolicy(policy2)).toThrow();
    });

    it('should unregister policies', () => {
      const policy = new WhitelistPolicy(['Read']);

      evaluator.registerPolicy(policy);
      const removed = evaluator.unregisterPolicy('whitelist');

      expect(removed).toBe(true);
      expect(evaluator.getPolicies().length).toBe(0);
    });

    it('should return false when unregistering non-existent policy', () => {
      const removed = evaluator.unregisterPolicy('non-existent');

      expect(removed).toBe(false);
    });
  });

  describe('policy priority', () => {
    it('should evaluate policies in priority order', async () => {
      // High priority blacklist (100)
      const blacklist = new BlacklistPolicy(['Read']);

      // Low priority whitelist (40)
      const whitelist = new WhitelistPolicy(['Read']);

      // Register in reverse order
      evaluator.registerPolicy(whitelist);
      evaluator.registerPolicy(blacklist);

      const result = await evaluator.evaluate(context);

      // Blacklist (higher priority) should win
      expect(result.decision.allowed).toBe(false);
      expect(result.decidingPolicy).toBe('blacklist');
    });

    it('should continue evaluating after allow', async () => {
      const whitelist = new WhitelistPolicy(['Read']);
      const filePolicy = new FileOperationPolicy({
        allowedPaths: ['/workspace'],
        blockedPaths: ['/etc'],
      });

      evaluator.registerPolicy(whitelist);
      evaluator.registerPolicy(filePolicy);

      // Both should allow
      const result = await evaluator.evaluate(context);

      expect(result.decision.allowed).toBe(true);
      expect(result.evaluatedPolicies).toContain('whitelist');
      expect(result.evaluatedPolicies).toContain('file-operation');
    });

    it('should stop on first hard deny', async () => {
      const blacklist = new BlacklistPolicy(['Read']);
      const whitelist = new WhitelistPolicy(['Read']);

      evaluator.registerPolicy(blacklist);
      evaluator.registerPolicy(whitelist);

      const result = await evaluator.evaluate(context);

      expect(result.decision.allowed).toBe(false);
      // Should not evaluate whitelist (stopped at blacklist)
      expect(result.evaluatedPolicies).toContain('blacklist');
      expect(result.evaluatedPolicies.length).toBe(1);
    });
  });

  describe('approval flow', () => {
    it('should return decision with canApprove=true', async () => {
      const filePolicy = new FileOperationPolicy({
        allowedPaths: ['/workspace'],
        blockedPaths: [],
        requireApprovalForWrite: true,  // Test with Write approval
      });

      evaluator.registerPolicy(filePolicy);

      context.toolName = 'Write';  // Use canonical tool name
      context.toolInput = { file_path: '/workspace/file.txt' };

      const result = await evaluator.evaluate(context);

      expect(result.decision.allowed).toBe(false);
      if (!result.decision.allowed) {
        expect(result.decision.canApprove).toBe(true);
      }
    });
  });

  describe('default policy', () => {
    it('should deny by default when no policies match', async () => {
      const result = await evaluator.evaluate(context);

      expect(result.decision.allowed).toBe(false);
      expect(result.decidingPolicy).toBe('default');
    });

    it('should allow by default when configured', async () => {
      evaluator = new PermissionEvaluator({ defaultPolicy: 'allow' });

      const result = await evaluator.evaluate(context);

      expect(result.decision.allowed).toBe(true);
      expect(result.decidingPolicy).toBe('default');
    });
  });

  describe('error handling', () => {
    it('should fail closed on policy evaluation error', async () => {
      const faultyPolicy: PermissionPolicy = {
        name: 'faulty',
        priority: 50,
        enabled: true,
        evaluate: async () => {
          throw new Error('Policy error');
        },
      };

      evaluator.registerPolicy(faultyPolicy);

      const result = await evaluator.evaluate(context);

      expect(result.decision.allowed).toBe(false);
      if (!result.decision.allowed) {
        expect(result.decision.reason).toContain('error');
        expect(result.decision.canApprove).toBe(false);
      }
    });
  });

  describe('disabled policies', () => {
    it('should skip disabled policies', async () => {
      // Create fresh evaluator with default deny
      const testEvaluator = new PermissionEvaluator({ defaultPolicy: 'deny' });
      const policy = new BlacklistPolicy(['Read'], 100, false); // Disabled

      testEvaluator.registerPolicy(policy);

      const result = await testEvaluator.evaluate(context);

      // Should use default policy (deny) since all policies disabled
      expect(result.decision.allowed).toBe(false);
      expect(result.decidingPolicy).toBe('default');
      expect(result.evaluatedPolicies.length).toBe(0);
    });
  });
});
