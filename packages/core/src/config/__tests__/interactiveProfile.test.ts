/**
 * R219 HB-INTERACTIVE-PROFILE — profile resolution (interactive vs headless, explicit env wins, off = byte-identical),
 * the bootstrapEnv layering (profile above .env.defaults, below user files, .env.local still overrides), the
 * effective-config `profile` source label, and the lift-plan session gate.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return { ...actual, homedir: () => process.env.__R219_HOME__ || actual.homedir() };
});

import {
  BENCH_LITE_LEVERS, BENCH_LITE_DEFERRED, STANDARD_LEVERS, STANDARD_EXTRA_LEVERS, BENCH_TB4_LEVERS, resolveInteractiveProfileName, resolveInteractiveProfile,
  applyInteractiveProfile, isInteractiveSession, liftPlanAllowedInSession, profileAppliedKeys, profileAppliesTo,
  USER_FAST_LEVERS, USER_HYBRID_LEVERS, USER_CAREFUL_LEVERS, LOCKED_PROFILES, profileLevers,
} from '../interactiveProfile.js';
import { bootstrapEnv, getGlobalEnvPath } from '../SettingsLoader.js';
import { collectEffectiveConfig } from '../effectiveConfig.js';

const LEVER_KEYS = BENCH_LITE_LEVERS.map((l) => l.key);

describe('R219 profile name', () => {
  it('unset / blank / unknown → off; bench-lite (any case, padded) → bench-lite', () => {
    expect(resolveInteractiveProfileName({})).toBe('off');
    expect(resolveInteractiveProfileName({ CORTEX_INTERACTIVE_PROFILE: '' })).toBe('off');
    expect(resolveInteractiveProfileName({ CORTEX_INTERACTIVE_PROFILE: 'bench-full' })).toBe('off');
    expect(resolveInteractiveProfileName({ CORTEX_INTERACTIVE_PROFILE: 'off' })).toBe('off');
    expect(resolveInteractiveProfileName({ CORTEX_INTERACTIVE_PROFILE: ' Bench-Lite ' })).toBe('bench-lite');
  });

  it('interactive = stdin AND stdout are TTYs', () => {
    expect(isInteractiveSession({ isTTY: true }, { isTTY: true })).toBe(true);
    expect(isInteractiveSession({ isTTY: true }, { isTTY: false })).toBe(false);
    expect(isInteractiveSession({}, { isTTY: true })).toBe(false);
  });
});

describe('2026-10-17 CORTEX_PROFILE: standard (shipped) + bench-tb4 (reproduction) apply to every session kind', () => {
  it('names: CORTEX_PROFILE wins over the legacy alias; standard / bench-tb4 resolve; unknown → off', () => {
    expect(resolveInteractiveProfileName({ CORTEX_PROFILE: 'standard' })).toBe('standard');
    expect(resolveInteractiveProfileName({ CORTEX_PROFILE: ' Bench-TB4 ' })).toBe('bench-tb4');
    expect(resolveInteractiveProfileName({ CORTEX_PROFILE: 'off', CORTEX_INTERACTIVE_PROFILE: 'bench-lite' })).toBe('off');
    expect(resolveInteractiveProfileName({ CORTEX_INTERACTIVE_PROFILE: 'bench-lite' })).toBe('bench-lite');
    expect(resolveInteractiveProfileName({ CORTEX_PROFILE: 'nope' })).toBe('off');
    expect(resolveInteractiveProfileName({ CORTEX_PROFILE: 'container' })).toBe('standard'); // the hosted sandboxes' pre-existing value
  });
  it('applies-to: bench-lite = interactive only; standard and bench-tb4 = headless too; off = never', () => {
    expect(profileAppliesTo('bench-lite', false)).toBe(false);
    expect(profileAppliesTo('standard', false)).toBe(true);
    expect(profileAppliesTo('bench-tb4', false)).toBe(true);
    expect(profileAppliesTo('off', true)).toBe(false);
  });
  it('standard = the bench-lite seven + the proven session-agnostic levers, filled in a HEADLESS session', () => {
    const r = resolveInteractiveProfile({ CORTEX_PROFILE: 'standard' }, { interactive: false });
    for (const l of BENCH_LITE_LEVERS) expect(r.apply[l.key]).toBe(l.value);
    expect(r.apply.CORTEX_OUTER_TOOL_TIMEOUT_MS).toBe('600000');
    expect(r.apply.CORTEX_WALL_RETRY_LADDER).toBe('65536,16384');
    expect(r.apply.CORTEX_WALL_FORCE_ACTION_AT).toBe('2');
    expect(r.apply.CORTEX_LIFT_PLAN_SCOPE).toBe('task');
    expect(r.apply.CORTEX_MENTOR_REASONING_ALLOWANCE).toBe('16000');
    expect(Object.keys(r.apply).length).toBe(STANDARD_LEVERS.length);
    expect(STANDARD_LEVERS.length).toBe(BENCH_LITE_LEVERS.length + STANDARD_EXTRA_LEVERS.length);
  });
  it('standard never touches the levers kept dark on purpose', () => {
    const keys = new Set(STANDARD_LEVERS.map((l) => l.key));
    for (const k of ['CORTEX_RULE_INPUTS', 'CORTEX_VERIFY_SCALE', 'CORTEX_TURN_STATUS', 'CORTEX_JUDGE_EVIDENCE_MAX_VETOES', 'CORTEX_INVENTORY',
      'CORTEX_WORKSPACE_CLEAN', 'CORTEX_SECOND_ATTEMPT', 'CORTEX_OUTPUT_CAP_TOKENS', 'CORTEX_MEETS_CONFIRM', 'CORTEX_ORIENT_BASELINE',
      'CORTEX_PID1_GUARD', 'CORTEX_PLATEAU_STOP', 'CORTEX_ACTION_EFFORT', 'MENTORSHIP_HELPER_MODEL', 'ENABLE_WEBTOOLS', 'CORTEX_LIFT_PLAN_INTERACTIVE']) {
      expect(keys.has(k)).toBe(false);
    }
  });
  it('bench-tb4 ⊇ standard keys, carries the TB4 cell bundle values, and the resolver is pinned to the canonical flash id', () => {
    const r = resolveInteractiveProfile({ CORTEX_PROFILE: 'bench-tb4' }, { interactive: false });
    for (const l of STANDARD_LEVERS) expect(r.apply[l.key]).toBeDefined();
    expect(r.apply.CORTEX_MENTOR_REASONING_ALLOWANCE).toBe('60000'); // bench value overrides the standard 16000
    expect(r.apply.CORTEX_TURN_STATUS).toBe('auto');
    expect(r.apply.CORTEX_JUDGE_EVIDENCE_MAX_VETOES).toBe('3');
    expect(r.apply.CORTEX_SECOND_ATTEMPT).toBe('1');
    expect(r.apply.CORTEX_SECOND_ATTEMPT_TRIGGER).toBe('accept-with-gap,accept-low-confidence,accept,none');
    expect(r.apply.MENTORSHIP_HELPER_MODEL).toBe('deepseek-v4-pro');
    expect(r.apply.CORTEX_ENDTURN_RESOLVER_MODEL).toBe('deepseek-flash');
    expect(r.apply.ENABLE_WEBTOOLS).toBe('false');
    const keys = BENCH_TB4_LEVERS.map((l) => l.key);
    expect(new Set(keys).size).toBe(keys.length); // no duplicate keys
  });
  it('explicit user values still win under standard (headless)', () => {
    const env: NodeJS.ProcessEnv = { CORTEX_PROFILE: 'standard', CORTEX_WALL_DROP: 'off', CORTEX_OUTER_TOOL_TIMEOUT_MS: '1' };
    const r = applyInteractiveProfile(env, { interactive: false });
    expect(env.CORTEX_WALL_DROP).toBe('off');
    expect(env.CORTEX_OUTER_TOOL_TIMEOUT_MS).toBe('1');
    expect(r.explicit.sort()).toEqual(['CORTEX_OUTER_TOOL_TIMEOUT_MS', 'CORTEX_WALL_DROP']);
    expect(env.CORTEX_LOOP_TOOL_BLOCK).toBe('true');
  });
});

describe('R219 resolveInteractiveProfile / applyInteractiveProfile', () => {
  it('bench-lite in an interactive session fills every SAFE lever with its bench value', () => {
    const r = resolveInteractiveProfile({ CORTEX_INTERACTIVE_PROFILE: 'bench-lite' }, { interactive: true });
    expect(r.apply).toEqual({
      CORTEX_LOOP_TOOL_BLOCK: 'true',
      CORTEX_EMPTY_TURN_CONTINUE: 'true',
      CORTEX_WALL_DROP: 'on',
      CORTEX_WALL_SUMMARY: 'on',
      CORTEX_REASONING_EXHAUST_BACKOFF: 'false',
      CORTEX_STEER_INPUTS: 'full',
      CORTEX_ORIENT_V2: '1',
    });
  });

  it('headless (non-TTY) session: nothing, even with the profile named', () => {
    const env: NodeJS.ProcessEnv = { CORTEX_INTERACTIVE_PROFILE: 'bench-lite' };
    const before = { ...env };
    const r = applyInteractiveProfile(env, { interactive: false });
    expect(r.apply).toEqual({});
    expect(env).toEqual(before);
  });

  it('off / unset: env byte-identical in an interactive session', () => {
    for (const name of [undefined, '', 'off', 'nonsense']) {
      const env: NodeJS.ProcessEnv = name === undefined ? { FOO: 'x' } : { FOO: 'x', CORTEX_INTERACTIVE_PROFILE: name };
      const before = JSON.stringify(env);
      applyInteractiveProfile(env, { interactive: true });
      expect(JSON.stringify(env)).toBe(before);
    }
  });

  it('explicit env wins (any non-blank value); blank counts as unset', () => {
    const env: NodeJS.ProcessEnv = {
      CORTEX_INTERACTIVE_PROFILE: 'bench-lite',
      CORTEX_WALL_DROP: 'off',
      CORTEX_REASONING_EXHAUST_BACKOFF: 'true',
      CORTEX_STEER_INPUTS: '',
    };
    const r = applyInteractiveProfile(env, { interactive: true });
    expect(env.CORTEX_WALL_DROP).toBe('off');
    expect(env.CORTEX_REASONING_EXHAUST_BACKOFF).toBe('true');
    expect(env.CORTEX_STEER_INPUTS).toBe('full');
    expect(r.explicit.sort()).toEqual(['CORTEX_REASONING_EXHAUST_BACKOFF', 'CORTEX_WALL_DROP']);
    expect([...profileAppliedKeys(env)].sort()).toEqual(LEVER_KEYS.filter((k) => k !== 'CORTEX_WALL_DROP' && k !== 'CORTEX_REASONING_EXHAUST_BACKOFF').sort());
  });

  it('idempotent: a second application adds nothing and keeps the marker', () => {
    const env: NodeJS.ProcessEnv = { CORTEX_INTERACTIVE_PROFILE: 'bench-lite' };
    applyInteractiveProfile(env, { interactive: true });
    const snap = JSON.stringify(env);
    const r2 = applyInteractiveProfile(env, { interactive: true });
    expect(r2.apply).toEqual({});
    expect(JSON.stringify(env)).toBe(snap);
  });

  it('fallback name (shipped default) is used only when env carries no profile name', () => {
    expect(Object.keys(resolveInteractiveProfile({}, { interactive: true }, 'bench-lite').apply)).toHaveLength(LEVER_KEYS.length);
    expect(resolveInteractiveProfile({ CORTEX_INTERACTIVE_PROFILE: 'off' }, { interactive: true }, 'bench-lite').apply).toEqual({});
  });

  it('SAFE set and deferred set are disjoint; the lift plan is never in the SAFE set', () => {
    const deferred = new Set(BENCH_LITE_DEFERRED.map((d) => d.key));
    for (const k of LEVER_KEYS) expect(deferred.has(k)).toBe(false);
    expect(LEVER_KEYS).not.toContain('CORTEX_LIFT_PLAN_INTERACTIVE');
    expect(LEVER_KEYS).not.toContain('CORTEX_LIFT_PLAN');
  });
});

describe('R219 lift-plan session gate', () => {
  it('headless always plans; interactive only with CORTEX_LIFT_PLAN_INTERACTIVE=true (old inline semantics)', () => {
    expect(liftPlanAllowedInSession(true, {})).toBe(true);
    expect(liftPlanAllowedInSession(false, {})).toBe(false);
    expect(liftPlanAllowedInSession(false, { CORTEX_LIFT_PLAN_INTERACTIVE: 'TRUE' })).toBe(false); // exact 'true' as before
    expect(liftPlanAllowedInSession(false, { CORTEX_LIFT_PLAN_INTERACTIVE: 'true' })).toBe(true);
  });

  it('bench-lite leaves the interactive gate closed; explicit opt-in still opens it', () => {
    const env: NodeJS.ProcessEnv = { CORTEX_INTERACTIVE_PROFILE: 'bench-lite' };
    applyInteractiveProfile(env, { interactive: true });
    expect(liftPlanAllowedInSession(false, env)).toBe(false);
    env.CORTEX_LIFT_PLAN_INTERACTIVE = 'true';
    expect(liftPlanAllowedInSession(false, env)).toBe(true);
  });
});

describe('R219 bootstrapEnv layering', () => {
  let home: string; let pkgRoot: string;
  const touched = [...LEVER_KEYS, ...STANDARD_EXTRA_LEVERS.map((l) => l.key), 'CORTEX_PROFILE', 'CORTEX_INTERACTIVE_PROFILE', 'CORTEX_INTERACTIVE_PROFILE_APPLIED', 'CORTEX_LIFT_PLAN_INTERACTIVE'];
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of touched) { saved[k] = process.env[k]; delete process.env[k]; }
    home = fs.mkdtempSync(path.join(tmpdir(), 'r219-home-'));
    pkgRoot = fs.mkdtempSync(path.join(tmpdir(), 'r219-pkg-'));
    process.env.__R219_HOME__ = home;
    // 2026-10-17: the repo's own ./.env (cwd user layer) ships CORTEX_PROFILE=standard; a BLANK real-env value counts as unset for the
    // resolver but blocks the file layer (first-wins), so these fixtures see only the profile they name.
    process.env.CORTEX_PROFILE = '';
    // shipped defaults: a profile lever set to a DIFFERENT value — the profile must sit above it.
    fs.writeFileSync(path.join(pkgRoot, '.env.defaults'), 'CORTEX_WALL_DROP=off\n');
  });
  afterEach(() => {
    delete process.env.__R219_HOME__;
    for (const k of touched) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    for (const d of [home, pkgRoot]) fs.rmSync(d, { recursive: true, force: true });
  });

  const writeGlobal = (body: string) => { fs.mkdirSync(path.dirname(getGlobalEnvPath()), { recursive: true }); fs.writeFileSync(getGlobalEnvPath(), body); };

  it('profile off: the shipped defaults load exactly as before, no marker', () => {
    bootstrapEnv(pkgRoot, { interactive: true });
    expect(process.env.CORTEX_WALL_DROP).toBe('off');
    expect(process.env.CORTEX_INTERACTIVE_PROFILE_APPLIED).toBeUndefined();
    for (const k of LEVER_KEYS.filter((k) => k !== 'CORTEX_WALL_DROP')) expect(process.env[k]).toBeUndefined();
  });

  it('profile named in ~/.cortex/.env + interactive: fills unset levers ABOVE .env.defaults, user values win', () => {
    writeGlobal('CORTEX_INTERACTIVE_PROFILE=bench-lite\nCORTEX_STEER_INPUTS=default\n');
    bootstrapEnv(pkgRoot, { interactive: true });
    expect(process.env.CORTEX_WALL_DROP).toBe('on');           // profile beats the shipped default
    expect(process.env.CORTEX_STEER_INPUTS).toBe('default');   // the user's own value wins
    expect(process.env.CORTEX_LOOP_TOOL_BLOCK).toBe('true');
    expect(profileAppliedKeys().has('CORTEX_STEER_INPUTS')).toBe(false);
    const lever = collectEffectiveConfig().flatMap((g) => g.levers);
    expect(lever.find((l) => l.key === 'CORTEX_LOOP_TOOL_BLOCK')!.source).toBe('profile');
    expect(lever.find((l) => l.key === 'CORTEX_STEER_INPUTS')!.source).toBe('env');
  });

  it('profile named but headless: shipped defaults only', () => {
    writeGlobal('CORTEX_INTERACTIVE_PROFILE=bench-lite\n');
    bootstrapEnv(pkgRoot, { interactive: false });
    expect(process.env.CORTEX_WALL_DROP).toBe('off');
    expect(process.env.CORTEX_LOOP_TOOL_BLOCK).toBeUndefined();
    expect(process.env.CORTEX_INTERACTIVE_PROFILE_APPLIED).toBeUndefined();
  });

  it('real-env lever beats the profile', () => {
    process.env.CORTEX_INTERACTIVE_PROFILE = 'bench-lite';
    process.env.CORTEX_EMPTY_TURN_CONTINUE = 'false';
    bootstrapEnv(pkgRoot, { interactive: true });
    expect(process.env.CORTEX_EMPTY_TURN_CONTINUE).toBe('false');
    expect(process.env.CORTEX_ORIENT_V2).toBe('1');
    delete process.env.CORTEX_EMPTY_TURN_CONTINUE;
  });

  it('2026-10-17 shipped default: CORTEX_PROFILE=standard in .env.defaults applies in a HEADLESS session, marker set, user name wins', () => {
    delete process.env.CORTEX_PROFILE;
    fs.writeFileSync(path.join(pkgRoot, '.env.defaults'), 'CORTEX_PROFILE=standard\nCORTEX_WALL_DROP=off\n');
    bootstrapEnv(pkgRoot, { interactive: false });
    expect(process.env.CORTEX_WALL_DROP).toBe('on');
    expect(process.env.CORTEX_OUTER_TOOL_TIMEOUT_MS).toBe('600000');
    expect(profileAppliedKeys().has('CORTEX_WALL_RETRY_LADDER')).toBe(true);
    for (const k of touched) delete process.env[k];
    process.env.CORTEX_PROFILE = 'off'; // real env (the top user layer; ./.env sits above ~/.cortex/.env, so a global-file name would not beat the repo's own file)
    bootstrapEnv(pkgRoot, { interactive: false });
    expect(process.env.CORTEX_WALL_DROP).toBe('off');
    expect(process.env.CORTEX_INTERACTIVE_PROFILE_APPLIED).toBeUndefined();
  });

  it('a profile name in the shipped .env.defaults applies (future default flip) unless the user names one', () => {
    fs.writeFileSync(path.join(pkgRoot, '.env.defaults'), 'CORTEX_INTERACTIVE_PROFILE=bench-lite\nCORTEX_WALL_DROP=off\n');
    bootstrapEnv(pkgRoot, { interactive: true });
    expect(process.env.CORTEX_WALL_DROP).toBe('on');
  });
});

describe('tools-only profile (2026-11-06)', () => {
  it('resolves by name and applies in headless sessions too', async () => {
    const m = await import('../interactiveProfile.js');
    expect(m.resolveInteractiveProfileName({ CORTEX_PROFILE: 'tools-only' } as any)).toBe('tools-only');
    const r = m.resolveInteractiveProfile({ CORTEX_PROFILE: 'tools-only' } as any, { interactive: false });
    expect(r.apply.CORTEX_ENDTURN_RESOLVER).toBe('false');
    expect(r.apply.CORTEX_BROWSE_TOOL).toBe('off');
    expect(r.apply.CORTEX_MCP_AUTOCONNECT).toBe('nexus-browser');
    expect(r.apply.MENTORSHIP_ENABLED).toBe('false');
    expect(r.apply.CORTEX_PROMPT_MASS).toBe('minimal');
    // the failure-path guards are kept
    expect(r.apply.CORTEX_EMPTY_TURN_CONTINUE).toBe('true');
    expect(r.apply.CORTEX_LOOP_TOOL_BLOCK).toBe('true');
    // it replaces standard: no standard-only lever (mentor model) leaks in
    expect(r.apply.MENTORSHIP_HELPER_MODEL).toBeUndefined();
  });
  it('a user-set lever wins over the profile', async () => {
    const m = await import('../interactiveProfile.js');
    const r = m.resolveInteractiveProfile({ CORTEX_PROFILE: 'tools-only', CORTEX_ENDTURN_RESOLVER: 'true' } as any, { interactive: false });
    expect(r.apply.CORTEX_ENDTURN_RESOLVER).toBeUndefined();
    expect(r.explicit).toContain('CORTEX_ENDTURN_RESOLVER');
  });
});

describe('user profiles (2026-11-12): user-fast / user-hybrid / user-careful, LOCKED once set', () => {
  const val = (ls: ReadonlyArray<{ key: string; value: string }>, k: string) => ls.find((l) => l.key === k)?.value;
  it('each profile names every lever once and carries the user surface', () => {
    for (const ls of [USER_FAST_LEVERS, USER_HYBRID_LEVERS, USER_CAREFUL_LEVERS]) {
      const keys = ls.map((l) => l.key);
      expect(new Set(keys).size).toBe(keys.length);
      expect(val(ls, 'MCP_AUTO_INJECT')).toBe('true');
      expect(val(ls, 'ENABLE_WEBTOOLS')).toBe('true');
      expect(val(ls, 'CORTEX_TOOL_ANCHOR')).toBe('bash-edit');
      expect(val(ls, 'CORTEX_SECOND_ATTEMPT')).toBe('0');
      expect(val(ls, 'CORTEX_LOOP_TOOL_BLOCK')).toBe('true');
    }
    expect(val(USER_FAST_LEVERS, 'CORTEX_ENDTURN_RESOLVER')).toBe('false');
    expect(val(USER_FAST_LEVERS, 'CORTEX_BROWSE_TOOL')).toBe('off');
    expect(val(USER_HYBRID_LEVERS, 'CORTEX_ENDTURN_RESOLVER')).toBe('true');
    expect(val(USER_HYBRID_LEVERS, 'CORTEX_ENDTURN_RESOLVER_WEB')).toBe('off');
    expect(val(USER_HYBRID_LEVERS, 'CORTEX_BROWSE_TOOL')).toBe('off');
    expect(val(USER_CAREFUL_LEVERS, 'CORTEX_BROWSE_TOOL')).toBeUndefined();
    expect(val(USER_CAREFUL_LEVERS, 'CORTEX_ENDTURN_RESOLVER_REASONING')).toBe('none');
    for (const n of ['user-fast', 'user-hybrid', 'user-careful'] as const) {
      expect(resolveInteractiveProfileName({ CORTEX_PROFILE: n })).toBe(n);
      expect(LOCKED_PROFILES.has(n)).toBe(true);
      expect(profileAppliesTo(n, false)).toBe(true);
      expect(profileLevers(n).length).toBeGreaterThan(10);
    }
  });
  it('LOCKED: a .env-file value is replaced; a real-env value still wins; standard stays unlocked', () => {
    const fileEnv = { CORTEX_PROFILE: 'user-hybrid', MCP_AUTO_INJECT: 'false', ENABLE_WEBTOOLS: 'false' } as NodeJS.ProcessEnv;
    const r = resolveInteractiveProfile(fileEnv, { interactive: true }, undefined, new Set(['CORTEX_PROFILE']));
    expect(r.apply.MCP_AUTO_INJECT).toBe('true');
    expect(r.lockedOver).toEqual(expect.arrayContaining(['MCP_AUTO_INJECT', 'ENABLE_WEBTOOLS']));
    const r2 = resolveInteractiveProfile(fileEnv, { interactive: true }, undefined, new Set(['CORTEX_PROFILE', 'MCP_AUTO_INJECT']));
    expect(r2.explicit).toContain('MCP_AUTO_INJECT');
    expect(r2.apply.MCP_AUTO_INJECT).toBeUndefined();
    const std = resolveInteractiveProfile({ CORTEX_PROFILE: 'standard', CORTEX_WALL_DROP: 'off' }, { interactive: true }, undefined, new Set(['CORTEX_PROFILE']));
    expect(std.explicit).toContain('CORTEX_WALL_DROP');   // unlocked: any set value wins, as before
    expect(std.lockedOver).toBeUndefined();
  });
  describe('bootstrapEnv', () => {
    let home: string; let pkgRoot: string;
    const keys = ['CORTEX_PROFILE', 'CORTEX_INTERACTIVE_PROFILE', 'CORTEX_INTERACTIVE_PROFILE_APPLIED', 'CORTEX_PROFILE_LOCKED_OVER',
      ...new Set([...USER_HYBRID_LEVERS, ...USER_FAST_LEVERS].map((l) => l.key))];
    const saved: Record<string, string | undefined> = {};
    beforeEach(() => {
      for (const k of keys) { saved[k] = process.env[k]; delete process.env[k]; }
      home = fs.mkdtempSync(path.join(tmpdir(), 'up-home-')); pkgRoot = fs.mkdtempSync(path.join(tmpdir(), 'up-pkg-'));
      process.env.__R219_HOME__ = home; process.env.CORTEX_PROFILE = '';   // blank real env: the repo ./.env profile line cannot leak in
      fs.writeFileSync(path.join(pkgRoot, '.env.defaults'), 'MCP_AUTO_INJECT=false\nENABLE_WEBTOOLS=auto\n');
    });
    afterEach(() => {
      delete process.env.__R219_HOME__;
      for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
      for (const d of [home, pkgRoot]) fs.rmSync(d, { recursive: true, force: true });
    });
    const writeGlobal = (body: string) => { fs.mkdirSync(path.dirname(getGlobalEnvPath()), { recursive: true }); fs.writeFileSync(getGlobalEnvPath(), body); };
    it('user-hybrid in ~/.cortex/.env overrides stale file levers and reports them', () => {
      writeGlobal('CORTEX_INTERACTIVE_PROFILE=user-hybrid\nMCP_AUTO_INJECT=false\nENABLE_WEBTOOLS=false\nCORTEX_FREE_LEVER=kept\n');
      bootstrapEnv(pkgRoot, { interactive: false });
      expect(process.env.MCP_AUTO_INJECT).toBe('true');
      expect(process.env.ENABLE_WEBTOOLS).toBe('true');
      expect(process.env.CORTEX_ENDTURN_RESOLVER_WEB).toBe('off');
      expect((process.env.CORTEX_PROFILE_LOCKED_OVER ?? '').split(',')).toEqual(expect.arrayContaining(['MCP_AUTO_INJECT', 'ENABLE_WEBTOOLS']));
      expect(process.env.CORTEX_FREE_LEVER).toBe('kept');   // levers the profile does not name stay mutable
      delete process.env.CORTEX_FREE_LEVER;
    });
    it('a real-env value wins over the locked profile; .env.local still overrides', () => {
      process.env.MCP_AUTO_INJECT = 'false';
      writeGlobal('CORTEX_INTERACTIVE_PROFILE=user-fast\n');
      fs.writeFileSync(path.join(pkgRoot, '.env.local'), 'ENABLE_WEBTOOLS=false\n');
      bootstrapEnv(pkgRoot, { interactive: false });
      expect(process.env.MCP_AUTO_INJECT).toBe('false');
      expect(process.env.ENABLE_WEBTOOLS).toBe('false');
      expect(process.env.CORTEX_ENDTURN_RESOLVER).toBe('false');
    });
  });
});
