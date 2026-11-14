/**
 * 2026-11-14 (m2 battery C5 on 4.137.4): every CLI-started server is detached (no TTY) → headlessAutoApprove → permissionMode 'auto' →
 * bypassAll: true, which skipped EVERY policy including the floors. Floors are never bypassed: headless (no one to ask) they REFUSE.
 */
import { describe, it, expect } from 'vitest';
import { PermissionsMiddleware } from '../PermissionsMiddleware.js';
import { AutoApproveHandler } from '../permissions/AutoApproveHandler.js';
import { nativeAutomationFloorPolicy, secretsInFilesFloorPolicy } from '../permissions/DefaultPolicies.js';

const ctx = { sessionId: 's', conversationId: 'c', turnNumber: 1, modelId: 'm', config: {} } as any;
const allowAll = { name: 'allow-all', priority: 1, enabled: true, evaluate: async () => ({ allowed: true }) } as any;
const fakeKey = ['sk', '-test-', '0'.repeat(22)].join('');
const mw = () => new PermissionsMiddleware({ policies: [nativeAutomationFloorPolicy, secretsInFilesFloorPolicy, allowAll],
  approvalHandler: new AutoApproveHandler({ enableLogging: false }), bypassAll: true } as any);

describe('floors under bypassAll (headless auto-approve)', () => {
  it('refuses Bash screen capture with the floor reason', async () => {
    const m = mw(); const d: any = await m.checkPermission('Bash', { command: '/usr/sbin/screencapture -x /tmp/a.png' }, ctx); await m.close();
    expect(d.allowed).toBe(false); expect(String(d.reason)).toMatch(/NATIVE AUTOMATION/);
  });
  it('refuses writing a key into a file', async () => {
    const m = mw(); const d: any = await m.checkPermission('Write', { file_path: '/x/key.txt', content: fakeKey }, ctx); await m.close();
    expect(d.allowed).toBe(false); expect(String(d.reason)).toMatch(/cortex setup/);
  });
  it('everything else stays bypassed (auto-approve still works)', async () => {
    const m = mw(); const d: any = await m.checkPermission('Bash', { command: 'rm -rf ./build' }, ctx); await m.close();
    expect(d.allowed).toBe(true);
  });
});
