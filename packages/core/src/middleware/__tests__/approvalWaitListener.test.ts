import { describe, it, expect, vi } from 'vitest';
import { PermissionsMiddleware } from '../PermissionsMiddleware.js';
import type { ApprovalHandler } from '../contracts/MiddlewareContracts.js';

const ctx = (toolName: string) => ({ toolName, toolInput: {}, sessionId: 's1', timestamp: new Date() });

describe('PermissionsMiddleware approval-wait listener (R145 HB-HERDR-LIFECYCLE)', () => {
  it('fires start before the handler is awaited and end after it resolves; the decision is untouched', async () => {
    const events: string[] = [];
    const handler: ApprovalHandler = {
      requestApproval: vi.fn(async () => { events.push('handler'); return true; }),
    };
    const pm = new PermissionsMiddleware({ approvalHandler: handler, enableLogging: false });
    pm.setApprovalWaitListener((phase, toolName) => { events.push(`${phase}:${toolName}`); });
    await expect(pm.requestApproval(ctx('Bash'), 'graylist')).resolves.toBe(true);
    expect(events).toEqual(['start:Bash', 'handler', 'end:Bash']);
  });

  it('end fires even when the handler rejects (decision falls back to denied)', async () => {
    const events: string[] = [];
    const handler: ApprovalHandler = { requestApproval: vi.fn(async () => { throw new Error('aborted'); }) };
    const pm = new PermissionsMiddleware({ approvalHandler: handler, enableLogging: false });
    pm.setApprovalWaitListener((phase) => { events.push(phase); });
    await expect(pm.requestApproval(ctx('Write'), 'graylist')).resolves.toBe(false);
    expect(events).toEqual(['start', 'end']);
  });

  it('a throwing listener never affects the approval decision; unsetting removes it', async () => {
    const handler: ApprovalHandler = { requestApproval: vi.fn(async () => true) };
    const pm = new PermissionsMiddleware({ approvalHandler: handler, enableLogging: false });
    const listener = vi.fn(() => { throw new Error('observer bug'); });
    pm.setApprovalWaitListener(listener);
    await expect(pm.requestApproval(ctx('Bash'), 'graylist')).resolves.toBe(true);
    expect(listener).toHaveBeenCalledTimes(2);
    pm.setApprovalWaitListener(undefined);
    await expect(pm.requestApproval(ctx('Bash'), 'graylist')).resolves.toBe(true);
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
