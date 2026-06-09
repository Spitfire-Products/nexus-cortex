/**
 * Tests for BashCommandPolicy
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { BashCommandPolicy } from '../../permissions/BashCommandPolicy.js';
import type { PermissionContext } from '../../contracts/MiddlewareContracts.js';

describe('BashCommandPolicy', () => {
  let policy: BashCommandPolicy;
  let context: PermissionContext;

  beforeEach(() => {
    policy = new BashCommandPolicy({
      allowedCommands: [],
      blockedCommands: [],
      requireApprovalForDangerous: true,
    });

    context = {
      toolName: 'Bash',  // Use canonical PascalCase name
      toolInput: { command: 'ls -la' },
      sessionId: 'test-session',
      timestamp: new Date(),
    };
  });

  describe('safe commands', () => {
    it('should allow safe commands', async () => {
      const decision = await policy.evaluate(context);

      expect(decision.allowed).toBe(true);
    });

    it('should allow git commands', async () => {
      context.toolInput = { command: 'git status' };

      const decision = await policy.evaluate(context);

      expect(decision.allowed).toBe(true);
    });

    it('should allow npm commands', async () => {
      context.toolInput = { command: 'npm install' };

      const decision = await policy.evaluate(context);

      expect(decision.allowed).toBe(true);
    });
  });

  describe('dangerous patterns', () => {
    it('should detect rm -rf', async () => {
      context.toolInput = { command: 'rm -rf /tmp/files' };

      const decision = await policy.evaluate(context);

      expect(decision.allowed).toBe(false);
      if (!decision.allowed) {
        expect(decision.reason).toContain('dangerous');
        expect(decision.canApprove).toBe(true);
      }
    });

    it('should detect sudo commands', async () => {
      context.toolInput = { command: 'sudo apt-get install' };

      const decision = await policy.evaluate(context);

      expect(decision.allowed).toBe(false);
      if (!decision.allowed) {
        expect(decision.reason).toContain('dangerous');
      }
    });

    it('should detect chmod 777', async () => {
      context.toolInput = { command: 'chmod 777 file.txt' };

      const decision = await policy.evaluate(context);

      expect(decision.allowed).toBe(false);
    });

    it('should detect shutdown commands', async () => {
      context.toolInput = { command: 'shutdown now' };

      const decision = await policy.evaluate(context);

      expect(decision.allowed).toBe(false);
    });

    it('should detect format commands', async () => {
      context.toolInput = { command: 'format /dev/sda' };

      const decision = await policy.evaluate(context);

      expect(decision.allowed).toBe(false);
    });

    it('should detect piped downloads', async () => {
      context.toolInput = { command: 'curl | bash' };

      const decision = await policy.evaluate(context);

      expect(decision.allowed).toBe(false);
    });
  });

  describe('blocked commands', () => {
    beforeEach(() => {
      policy = new BashCommandPolicy({
        allowedCommands: [],
        blockedCommands: ['sudo', 'rm -rf /'],
        requireApprovalForDangerous: true,
      });
    });

    it('should block commands in blacklist', async () => {
      context.toolInput = { command: 'sudo rm -rf /' };

      const decision = await policy.evaluate(context);

      expect(decision.allowed).toBe(false);
      if (!decision.allowed) {
        expect(decision.canApprove).toBe(false); // Hard block from blacklist
      }
    });

    it('should block exact blacklist match', async () => {
      context.toolInput = { command: 'rm -rf /' };

      const decision = await policy.evaluate(context);

      expect(decision.allowed).toBe(false);
      if (!decision.allowed) {
        expect(decision.canApprove).toBe(false);
      }
    });
  });

  describe('whitelist mode', () => {
    beforeEach(() => {
      policy = new BashCommandPolicy({
        allowedCommands: ['ls', 'git', 'npm'],
        blockedCommands: [],
      });
    });

    it('should allow whitelisted commands', async () => {
      context.toolInput = { command: 'ls -la' };

      const decision = await policy.evaluate(context);

      expect(decision.allowed).toBe(true);
    });

    it('should deny non-whitelisted commands', async () => {
      context.toolInput = { command: 'echo hello' };

      const decision = await policy.evaluate(context);

      expect(decision.allowed).toBe(false);
      if (!decision.allowed) {
        expect(decision.reason).toContain('not in the allowed commands');
        expect(decision.canApprove).toBe(true);
      }
    });
  });

  describe('non-bash operations', () => {
    it('should allow non-bash operations', async () => {
      context.toolName = 'read_file';
      context.toolInput = { file_path: '/file.txt' };

      const decision = await policy.evaluate(context);

      expect(decision.allowed).toBe(true);
    });
  });
});
