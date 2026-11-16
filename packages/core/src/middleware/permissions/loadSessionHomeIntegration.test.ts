/**
 * HOME REVIEW (T3): floor-load-session inside the WHOLE resolved policy set, exactly as OrchestratorFactory builds it
 * (default branch + every shipped profile dev/test/prod), run through the real PermissionsMiddleware in the three modes:
 * interactive (approval handler present, auto-approve OFF), auto-approve ON, headless (bypassAll).
 * Vault + grants under a temp CORTEX_HOME — never the real ~/.cortex.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { putSite, type SiteEntry } from '../../config/sessionVault.js';
import { setGrant, clearSessionGrants } from '../../config/sessionRelease.js';
import { PermissionsMiddleware } from '../PermissionsMiddleware.js';
import { createDefaultPolicies } from '../../orchestrator/OrchestratorFactory.js';

const repoRoot = path.resolve(__dirname, '../../../../..');
const entry: SiteEntry = {
  site: 'github.com', source: 'chrome:Default', importedAt: 1700000000000,
  cookies: [{ name: 'session', value: 'v-0001', domain: 'github.com', path: '/', expires: 1800000000, secure: true, httpOnly: true, sameSite: 'Lax' }],
} as SiteEntry;

let home: string; let prevHome: string | undefined; let prevKey: string | undefined;
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-t3-int-'));
  prevHome = process.env.CORTEX_HOME; prevKey = process.env.CORTEX_SECRETS_KEY;
  process.env.CORTEX_HOME = home; process.env.CORTEX_SECRETS_KEY = 'test-master-1';
  clearSessionGrants();
  putSite(entry, undefined, process.env);
});
afterEach(() => {
  clearSessionGrants();
  if (prevHome === undefined) delete process.env.CORTEX_HOME; else process.env.CORTEX_HOME = prevHome;
  if (prevKey === undefined) delete process.env.CORTEX_SECRETS_KEY; else process.env.CORTEX_SECRETS_KEY = prevKey;
  fs.rmSync(home, { recursive: true, force: true });
});

const branches: Array<[string, any]> = [
  ['default', { workingDirectory: repoRoot, projectPath: repoRoot }],
  ['profile dev', { workingDirectory: repoRoot, projectPath: repoRoot, permissionProfile: 'dev' }],
  ['profile test', { workingDirectory: repoRoot, projectPath: repoRoot, permissionProfile: 'test' }],
  ['profile prod', { workingDirectory: repoRoot, projectPath: repoRoot, permissionProfile: 'prod' }],
];

async function build(cfg: any, mode: 'interactive' | 'auto' | 'headless') {
  const { policies, defaultPolicy } = await createDefaultPolicies(cfg);
  let asked = 0;
  const approvalHandler = { requestApproval: async () => { asked++; return false; } } as any;
  const mw = new PermissionsMiddleware({ policies, defaultPolicy, approvalHandler, bypassAll: mode === 'headless' } as any);
  const check = (tool: string, site: string) => mw.checkPermission(tool, { site }, { sessionId: 's1', approvalMode: { autoApproveActions: mode === 'auto' } } as any);
  return { check, asked: () => asked, names: policies.map((p) => p.name) };
}

describe.each(branches)('T3 floor in the resolved set — %s', (_label, cfg) => {
  it('the floor is in the set', async () => {
    const { names } = await build(cfg, 'interactive');
    expect(names).toContain('floor-load-session');
  });
  for (const tool of ['nexus-browser__load_session', 'load_session']) {
    it(`${tool}: auto-approve ON, no grant → refused, nobody asked`, async () => {
      const b = await build(cfg, 'auto');
      const d = await b.check(tool, 'github.com');
      expect(d.allowed).toBe(false); expect(b.asked()).toBe(0);
    });
    it(`${tool}: headless, no grant → refused, nobody asked`, async () => {
      const b = await build(cfg, 'headless');
      const d = await b.check(tool, 'github.com');
      expect(d.allowed).toBe(false); expect(b.asked()).toBe(0);
    });
    it(`${tool}: interactive, no grant → the person is asked (and a "no" refuses)`, async () => {
      const b = await build(cfg, 'interactive');
      const d = await b.check(tool, 'GitHub.com ');
      expect(d.allowed).toBe(false); expect(b.asked()).toBe(1);
    });
    it(`${tool}: valid always grant → allowed in all three modes, nobody asked`, async () => {
      setGrant('github.com', 1700000003000, 1700000000000);
      for (const m of ['interactive', 'auto', 'headless'] as const) {
        const b = await build(cfg, m);
        const d = await b.check(tool, 'github.com');
        expect(d.allowed, m).toBe(true); expect(b.asked(), m).toBe(0);
      }
    });
    it(`${tool}: stale always grant (re-imported entry) → refused under auto-approve`, async () => {
      setGrant('github.com', 1700000003000, 1600000000000);
      const b = await build(cfg, 'auto');
      expect((await b.check(tool, 'github.com')).allowed).toBe(false);
    });
  }
});
