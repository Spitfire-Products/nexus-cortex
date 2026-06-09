/**
 * Regression tests for permission-system deficiencies surfaced by the
 * 2026-05-10 cortex parity benchmark.
 *
 *  #1 — Profile path lookup tries the dotted form first
 *       (`.cortex/permissions.dev.json`), falls back to the subdirectory form
 *       (`.cortex/permissions/dev.json`) for backward compatibility.
 *
 *  #2 — `PermissionConfigLoader` skips a `type: whitelist` entry whose
 *       `allowedTools: []`. An empty hard whitelist denies every tool, which
 *       is a footgun the loader should refuse to honor.
 *
 *  #3 — `defaultPolicy` from the JSON profile is honored end-to-end.
 *       Previously `OrchestratorFactory` hardcoded `'deny'`, which override
 *       the JSON's `'allow'` setting and silently denied everything.
 *
 *  #4 — `PermissionsMiddleware` supports a `bypassAll` option so YOLO mode
 *       short-circuits before policy evaluation. Hard-deny policies (e.g.
 *       a whitelist with `canApprove: false`) cannot otherwise be bypassed.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  PermissionConfigLoader,
} from '../../permissions/PermissionConfigLoader.js';
import { PermissionsMiddleware } from '../../PermissionsMiddleware.js';
import { resolvePermissionProfilePath } from '../../permissions/profilePath.js';
import type { MiddlewareContext } from '../../contracts/MiddlewareContracts.js';

const ctx: MiddlewareContext = {
  sessionId: 'test-session',
  conversationId: 'test-convo',
  turnNumber: 1,
  modelId: 'test-model',
  // Minimal config — middleware only reads approvalMode/autoApproveActions which is optional.
  config: {} as any,
};

// ── #1: Profile path resolution ───────────────────────────────────────────────

describe('Deficiency #1 — profile path resolution', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-perm-'));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('prefers the dotted form (.cortex/permissions.dev.json) when present', () => {
    const cortexDir = path.join(tmp, '.cortex');
    fs.mkdirSync(cortexDir);
    const dotted = path.join(cortexDir, 'permissions.dev.json');
    fs.writeFileSync(dotted, '{}');

    expect(resolvePermissionProfilePath('dev', tmp)).toBe(dotted);
  });

  it('falls back to the subdirectory form when the dotted form is absent', () => {
    const subdir = path.join(tmp, '.cortex', 'permissions');
    fs.mkdirSync(subdir, { recursive: true });
    const sub = path.join(subdir, 'dev.json');
    fs.writeFileSync(sub, '{}');

    expect(resolvePermissionProfilePath('dev', tmp)).toBe(sub);
  });

  it('prefers dotted when both exist', () => {
    const cortexDir = path.join(tmp, '.cortex');
    const subdir = path.join(cortexDir, 'permissions');
    fs.mkdirSync(subdir, { recursive: true });
    const dotted = path.join(cortexDir, 'permissions.dev.json');
    fs.writeFileSync(dotted, '{}');
    fs.writeFileSync(path.join(subdir, 'dev.json'), '{}');

    expect(resolvePermissionProfilePath('dev', tmp)).toBe(dotted);
  });

  it('returns null when neither file exists', () => {
    // Stub HOME so the global fallback doesn't find real ~/.cortex/ files
    const origHome = process.env.HOME;
    process.env.HOME = tmp; // tmp has no .cortex/ either
    try {
      expect(resolvePermissionProfilePath('dev', tmp)).toBeNull();
    } finally {
      process.env.HOME = origHome;
    }
  });

  it('falls back to global ~/.cortex/ when project has no profile', () => {
    // Create a separate "home" directory with a global profile
    const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-home-'));
    const globalDir = path.join(fakeHome, '.cortex');
    fs.mkdirSync(globalDir);
    const globalProfile = path.join(globalDir, 'permissions.dev.json');
    fs.writeFileSync(globalProfile, '{}');

    const origHome = process.env.HOME;
    process.env.HOME = fakeHome;
    try {
      // tmp has no .cortex/ — should fall back to global
      expect(resolvePermissionProfilePath('dev', tmp)).toBe(globalProfile);
    } finally {
      process.env.HOME = origHome;
      fs.rmSync(fakeHome, { recursive: true, force: true });
    }
  });

  it('project profile overrides global profile', () => {
    // Set up global
    const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-home-'));
    const globalDir = path.join(fakeHome, '.cortex');
    fs.mkdirSync(globalDir);
    fs.writeFileSync(path.join(globalDir, 'permissions.dev.json'), '{}');

    // Set up project
    const projectDir = path.join(tmp, '.cortex');
    fs.mkdirSync(projectDir);
    const projectProfile = path.join(projectDir, 'permissions.dev.json');
    fs.writeFileSync(projectProfile, '{}');

    const origHome = process.env.HOME;
    process.env.HOME = fakeHome;
    try {
      expect(resolvePermissionProfilePath('dev', tmp)).toBe(projectProfile);
    } finally {
      process.env.HOME = origHome;
      fs.rmSync(fakeHome, { recursive: true, force: true });
    }
  });
});

// ── #2: Empty-whitelist footgun ───────────────────────────────────────────────

describe('Deficiency #2 — empty whitelist policy is rejected with warning', () => {
  it('skips a whitelist policy with allowedTools: [] and warns', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const loader = new PermissionConfigLoader();

    const middleware = loader.loadFromConfig({
      enabled: true,
      defaultPolicy: 'allow',
      policies: [
        {
          type: 'whitelist',
          enabled: true,
          priority: 100,
          config: { allowedTools: [] },
        },
      ],
    });

    // If the empty whitelist had loaded, it would hard-deny every tool.
    // After the fix, it is skipped, so defaultPolicy: 'allow' takes effect.
    const decision = await middleware.checkPermission('AnyTool', {}, ctx);
    expect(decision.allowed).toBe(true);

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('empty allowedTools'),
    );
    warnSpy.mockRestore();
  });

  it('still enforces a whitelist policy with at least one allowed tool', async () => {
    const loader = new PermissionConfigLoader();
    const middleware = loader.loadFromConfig({
      enabled: true,
      defaultPolicy: 'allow',
      policies: [
        {
          type: 'whitelist',
          enabled: true,
          priority: 100,
          config: { allowedTools: ['Read'] },
        },
      ],
    });

    // Read should be allowed (in the whitelist).
    const readDecision = await middleware.checkPermission('Read', {}, ctx);
    expect(readDecision.allowed).toBe(true);

    // Anything else hits the whitelist's hard deny (canApprove: false).
    const otherDecision = await middleware.checkPermission('AnyTool', {}, ctx);
    expect(otherDecision.allowed).toBe(false);
  });
});

// ── #3: defaultPolicy from JSON is honored ────────────────────────────────────

describe('Deficiency #3 — JSON defaultPolicy is honored end-to-end', () => {
  it('PermissionsMiddleware allows tools by default when defaultPolicy: allow and no policy matches', async () => {
    const middleware = new PermissionsMiddleware({
      policies: [],
      defaultPolicy: 'allow',
    });

    const decision = await middleware.checkPermission(
      'WebSearch',
      { query: 'foo' },
      ctx,
    );
    expect(decision.allowed).toBe(true);
  });

  it('PermissionsMiddleware denies tools by default when defaultPolicy: deny and no policy matches', async () => {
    const middleware = new PermissionsMiddleware({
      policies: [],
      defaultPolicy: 'deny',
    });

    const decision = await middleware.checkPermission(
      'WebSearch',
      { query: 'foo' },
      ctx,
    );
    expect(decision.allowed).toBe(false);
  });
});

// ── #4: YOLO bypass — hard-deny policies cannot block when bypassAll is set ──

describe('Deficiency #4 — bypassAll short-circuits before policy evaluation', () => {
  it('allows any tool when bypassAll is true, even with a hard-deny policy', async () => {
    const middleware = new PermissionsMiddleware({
      // A whitelist with empty allowedTools would normally hard-deny everything.
      policies: [],
      defaultPolicy: 'deny',
      bypassAll: true,
    });

    const decision = await middleware.checkPermission(
      'AnyToolName',
      {},
      ctx,
    );
    expect(decision.allowed).toBe(true);
  });

  it('respects defaultPolicy: deny when bypassAll is false', async () => {
    const middleware = new PermissionsMiddleware({
      policies: [],
      defaultPolicy: 'deny',
      bypassAll: false,
    });

    const decision = await middleware.checkPermission(
      'AnyToolName',
      {},
      ctx,
    );
    expect(decision.allowed).toBe(false);
  });
});
