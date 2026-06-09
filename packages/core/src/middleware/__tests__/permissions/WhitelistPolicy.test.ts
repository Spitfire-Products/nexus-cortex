/**
 * Tests for WhitelistPolicy
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { WhitelistPolicy } from '../../permissions/WhitelistPolicy.js';
import type { PermissionContext } from '../../contracts/MiddlewareContracts.js';

describe('WhitelistPolicy', () => {
  let policy: WhitelistPolicy;
  let context: PermissionContext;

  beforeEach(() => {
    // Using canonical PascalCase tool names
    policy = new WhitelistPolicy(['Read', 'Write', 'Bash']);

    context = {
      toolName: 'Read',  // Use canonical PascalCase name
      toolInput: {},
      sessionId: 'test-session',
      timestamp: new Date(),
    };
  });

  it('should allow tools in whitelist', async () => {
    const decision = await policy.evaluate(context);

    expect(decision.allowed).toBe(true);
  });

  it('should deny tools not in whitelist', async () => {
    context.toolName = 'Edit';  // This tool is not in the whitelist

    const decision = await policy.evaluate(context);

    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.reason).toContain('not in the whitelist');
      expect(decision.canApprove).toBe(false); // Hard block
    }
  });

  it('should support adding tools dynamically', async () => {
    context.toolName = 'delete_file';

    // Initially denied
    let decision = await policy.evaluate(context);
    expect(decision.allowed).toBe(false);

    // Add to whitelist
    policy.addTool('delete_file');

    // Now allowed
    decision = await policy.evaluate(context);
    expect(decision.allowed).toBe(true);
  });

  it('should support removing tools', async () => {
    // Initially allowed
    let decision = await policy.evaluate(context);
    expect(decision.allowed).toBe(true);

    // Remove from whitelist
    policy.removeTool('Read');

    // Now denied
    decision = await policy.evaluate(context);
    expect(decision.allowed).toBe(false);
  });

  it('should report all allowed tools', () => {
    const tools = policy.getAllowedTools();

    expect(tools).toContain('Read');
    expect(tools).toContain('Write');
    expect(tools).toContain('Bash');
    expect(tools.length).toBe(3);
  });
});
