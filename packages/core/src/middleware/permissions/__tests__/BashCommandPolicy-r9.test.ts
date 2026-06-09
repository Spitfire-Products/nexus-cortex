/**
 * Round 9 (parallel-bench output): BashCommandPolicy pre-lowercases the
 * `dangerousPatterns` array once at construction so `findDangerousPattern`
 * doesn't lowercase every pattern on every Bash check. With ~32 default
 * patterns × 10-20 Bash calls per turn, this used to allocate 320-640
 * lowercase strings per turn.
 */

import { describe, it, expect } from 'vitest';
import { BashCommandPolicy } from '../BashCommandPolicy.js';

describe('BashCommandPolicy — pre-lowercased pattern matching (Round 9)', () => {
  it('matches commands regardless of pattern casing in stored array', async () => {
    const policy = new BashCommandPolicy({
      allowedCommands: [],
      blockedCommands: [],
      requireApprovalForDangerous: true,
      customDangerousPatterns: ['RM_DASH_RF_TEST_PATTERN'], // uppercase intentionally
    });
    const decision = await policy.evaluate({
      toolName: 'Bash',
      toolInput: { command: 'somecommand RM_DASH_RF_TEST_PATTERN' },
    } as any);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('RM_DASH_RF_TEST_PATTERN');
  });

  it('matches lowercase command against mixed-case dangerous pattern', async () => {
    const policy = new BashCommandPolicy({
      allowedCommands: [],
      blockedCommands: [],
      requireApprovalForDangerous: true,
      customDangerousPatterns: ['DangerousPattern'],
    });
    // Command is already lowercase
    const decision = await policy.evaluate({
      toolName: 'Bash',
      toolInput: { command: 'cmd dangerouspattern' },
    } as any);
    expect(decision.allowed).toBe(false);
    // Deny reason returns the ORIGINAL casing
    expect(decision.reason).toContain('DangerousPattern');
  });

  it('addDangerousPattern keeps the lowercase parallel array in sync', async () => {
    const policy = new BashCommandPolicy({
      allowedCommands: [],
      blockedCommands: [],
      requireApprovalForDangerous: true,
      customDangerousPatterns: [],
    });
    policy.addDangerousPattern('NewPattern');
    const decision = await policy.evaluate({
      toolName: 'Bash',
      toolInput: { command: 'echo newpattern' },
    } as any);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('NewPattern');
  });

  it('safe commands pass through (no false positives from new code path)', async () => {
    const policy = new BashCommandPolicy({
      allowedCommands: [],
      blockedCommands: [],
      requireApprovalForDangerous: true,
      customDangerousPatterns: [],
    });
    const decision = await policy.evaluate({
      toolName: 'Bash',
      toolInput: { command: 'ls -la' },
    } as any);
    expect(decision.allowed).toBe(true);
  });
});
