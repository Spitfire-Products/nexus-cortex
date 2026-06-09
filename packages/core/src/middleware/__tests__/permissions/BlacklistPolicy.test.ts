/**
 * Tests for BlacklistPolicy
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { BlacklistPolicy } from '../../permissions/BlacklistPolicy.js';
import type { PermissionContext } from '../../contracts/MiddlewareContracts.js';

describe('BlacklistPolicy', () => {
  let policy: BlacklistPolicy;
  let context: PermissionContext;

  beforeEach(() => {
    // Using actual canonical tool names for blacklist
    policy = new BlacklistPolicy(['Write', 'Edit']);

    context = {
      toolName: 'Read',  // Use canonical PascalCase name
      toolInput: {},
      sessionId: 'test-session',
      timestamp: new Date(),
    };
  });

  it('should allow tools not in blacklist', async () => {
    const decision = await policy.evaluate(context);

    expect(decision.allowed).toBe(true);
  });

  it('should deny tools in blacklist', async () => {
    context.toolName = 'Write';  // This tool is in the blacklist

    const decision = await policy.evaluate(context);

    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.reason).toContain('blacklisted');
      expect(decision.canApprove).toBe(false); // Hard block
    }
  });

  it('should support adding tools dynamically', async () => {
    context.toolName = 'write_file';

    // Initially allowed
    let decision = await policy.evaluate(context);
    expect(decision.allowed).toBe(true);

    // Add to blacklist
    policy.addTool('write_file');

    // Now denied
    decision = await policy.evaluate(context);
    expect(decision.allowed).toBe(false);
  });

  it('should support removing tools', async () => {
    context.toolName = 'Edit';  // This tool is in the blacklist

    // Initially denied
    let decision = await policy.evaluate(context);
    expect(decision.allowed).toBe(false);

    // Remove from blacklist
    policy.removeTool('Edit');

    // Now allowed
    decision = await policy.evaluate(context);
    expect(decision.allowed).toBe(true);
  });

  it('should report all blocked tools', () => {
    const tools = policy.getBlockedTools();

    expect(tools).toContain('Write');
    expect(tools).toContain('Edit');
    expect(tools.length).toBe(2);
  });
});
