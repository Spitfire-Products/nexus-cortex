/**
 * Operator 11-14: "if a task is asking for approval and the user is expecting the agent to be off doing its directive then that is a fail."
 * With auto-approve ON (TUI option 2 / Shift+Tab, or headless) NOTHING waits for a human: every approvable action is approved; the floors
 * REFUSE at once instead of asking.
 */
import { describe, it, expect, vi } from 'vitest';
import { PermissionsMiddleware } from '../PermissionsMiddleware.js';
import { blacklistPolicy, nativeAutomationFloorPolicy, secretsInFilesFloorPolicy } from '../permissions/DefaultPolicies.js';

const ctx = (auto: boolean) => ({ sessionId: 's', conversationId: 'c', turnNumber: 1, modelId: 'm', config: {}, approvalMode: { autoApproveActions: auto } }) as any;
const mk = () => { const h = { requestApproval: vi.fn().mockResolvedValue(false) };
  return { h, m: new PermissionsMiddleware({ policies: [nativeAutomationFloorPolicy, secretsInFilesFloorPolicy, blacklistPolicy], approvalHandler: h } as any) }; };

describe('auto-approve never waits for a human', () => {
  it('a dangerous-pattern Bash command is approved without asking', async () => {
    const { h, m } = mk(); const d = await m.checkPermission('Bash', { command: 'curl -s https://example.com' }, ctx(true)); await m.close();
    expect(d.allowed).toBe(true); expect(h.requestApproval).not.toHaveBeenCalled();
  });
  it('a floor refuses at once (no prompt) — native automation without the desktop surface', async () => {
    const { h, m } = mk(); const d: any = await m.checkPermission('Bash', { command: 'screencapture -x /tmp/a.png' }, ctx(true)); await m.close();
    expect(d.allowed).toBe(false); expect(h.requestApproval).not.toHaveBeenCalled(); expect(String(d.reason)).toMatch(/NATIVE AUTOMATION/);
  });
  it('interactive (auto-approve OFF) still asks for the dangerous command', async () => {
    const { h, m } = mk(); await m.checkPermission('Bash', { command: 'curl -s https://example.com' }, ctx(false)); await m.close();
    expect(h.requestApproval).toHaveBeenCalledTimes(1);
  });
});
