/**
 * 2026-11-14 (operator: "I was having to continue to approve actions after every option 2 auto-approval choice"): auto-approve covers the
 * GRAYLIST only; a BLACKLIST action (dangerous / screen-and-app automation) still asks. The handler now learns the tier and that
 * auto-approve is already on, so the UI can say why it is asking instead of looking broken.
 */
import { describe, it, expect, vi } from 'vitest';
import { PermissionsMiddleware } from '../PermissionsMiddleware.js';
import { blacklistPolicy } from '../permissions/DefaultPolicies.js';
import type { ApprovalHandler, MiddlewareContext } from '../contracts/MiddlewareContracts.js';

const ctx = (auto: boolean) => ({ sessionId: 's', conversationId: 'c', turnNumber: 1, modelId: 'm', config: {} as any,
  approvalMode: { autoApproveActions: auto } }) as unknown as MiddlewareContext;

describe('approval request carries the tier', () => {
  it('a blacklist action with auto-approve ON still asks, and says so', async () => {
    const handler: ApprovalHandler = { requestApproval: vi.fn().mockResolvedValue(true) };
    const mw = new PermissionsMiddleware({ policies: [blacklistPolicy], approvalHandler: handler });
    const d = await mw.checkPermission('Bash', { command: 'screencapture -x /tmp/a.png' }, ctx(true));
    expect(handler.requestApproval).toHaveBeenCalledTimes(1);
    const req = (handler.requestApproval as any).mock.calls[0][0];
    expect(req.tier).toBe('blacklist');
    expect(req.autoApproveOn).toBe(true);
    expect(d.allowed).toBe(true);
    await mw.close();
  });
  it('auto-approve OFF: no autoApproveOn flag', async () => {
    const handler: ApprovalHandler = { requestApproval: vi.fn().mockResolvedValue(false) };
    const mw = new PermissionsMiddleware({ policies: [blacklistPolicy], approvalHandler: handler });
    await mw.checkPermission('Bash', { command: 'screencapture -x /tmp/a.png' }, ctx(false));
    const req = (handler.requestApproval as any).mock.calls[0][0];
    expect(req.tier).toBe('blacklist'); expect(req.autoApproveOn).toBeUndefined();
    await mw.close();
  });
});
