/**
 * 2026-11-14 (macbook battery C5): the 4.136.1 native-automation guard lived ONLY in the code-level blacklistPolicy, which the factory
 * uses just when NO permission-profile file exists. Real installs ship ~/.cortex/permissions.*.json → the profile's own policies loaded and
 * `/usr/sbin/screencapture` ran unasked on a non-YOLO server. The guard is now a FLOOR policy prepended to every resolved policy set.
 */
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createDefaultPolicies } from '../OrchestratorFactory.js';
import { vi } from 'vitest';
import { PermissionsMiddleware } from '../../middleware/PermissionsMiddleware.js';

let dir: string | undefined;
afterEach(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }); dir = undefined; });

async function decisionFor(command: string, withProfile: boolean) {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'floor-'));
  if (withProfile) {
    fs.mkdirSync(path.join(dir, '.cortex'), { recursive: true });
    // a maximally permissive profile: Bash whitelisted outright
    fs.writeFileSync(path.join(dir, '.cortex', 'permissions.dev.json'), JSON.stringify({
      name: 'dev', defaultPolicy: 'allow',
      policies: [{ type: 'whitelist', name: 'allow-all', priority: 500, enabled: true, tools: ['Bash', 'Read', 'Write', 'Edit'] }],
    }));
  }
  const resolved = await createDefaultPolicies({ permissionProfile: 'dev', projectPath: dir, workingDirectory: dir } as any);
  const handler = { requestApproval: vi.fn().mockResolvedValue(false) };
  const mw = new PermissionsMiddleware({ policies: resolved.policies, defaultPolicy: resolved.defaultPolicy, approvalHandler: handler } as any);
  const d = await mw.checkPermission('Bash', { command }, { sessionId: 's', conversationId: 'c', turnNumber: 1, modelId: 'm', config: {} } as any);
  await mw.close();
  const req = handler.requestApproval.mock.calls[0]?.[0];
  return { allowed: d.allowed, asked: !!req, tier: req?.tier, reason: req?.reason };
}

describe('native-automation floor policy', () => {
  for (const withProfile of [true, false]) {
    it(`asks for /usr/sbin/screencapture ${withProfile ? 'WITH a permissive profile file' : 'with no profile file'}`, async () => {
      const d: any = await decisionFor('/usr/sbin/screencapture -x /tmp/c5-shot.png', withProfile);
      expect(d.asked).toBe(true);                 // the user is asked (the mock says no)
      expect(d.allowed).toBe(false);
      expect(d.tier).toBe('blacklist');
      expect(String(d.reason)).toMatch(/NATIVE AUTOMATION/);
    });
  }
  it('asks before Bash writes a key into a file WITH a permissive profile (battery C7)', async () => {
    const fake = ['sk', '-test-', '0'.repeat(22)].join('');   // assembled: no key-shaped literal in source
    const d: any = await decisionFor(`echo '${fake}' > ~/bat/key.txt`, true);
    expect(d.asked).toBe(true); expect(d.tier).toBe('blacklist'); expect(String(d.reason)).toMatch(/cortex setup/);
  });
  it('leaves ordinary Bash to the profile', async () => {
    const d: any = await decisionFor('ls -la', true);
    expect(d.asked).toBe(false); expect(d.allowed).toBe(true);
  });
});
