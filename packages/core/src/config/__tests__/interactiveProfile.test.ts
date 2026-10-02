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
  BENCH_LITE_LEVERS, BENCH_LITE_DEFERRED, resolveInteractiveProfileName, resolveInteractiveProfile,
  applyInteractiveProfile, isInteractiveSession, liftPlanAllowedInSession, profileAppliedKeys,
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
  const touched = [...LEVER_KEYS, 'CORTEX_INTERACTIVE_PROFILE', 'CORTEX_INTERACTIVE_PROFILE_APPLIED', 'CORTEX_LIFT_PLAN_INTERACTIVE'];
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of touched) { saved[k] = process.env[k]; delete process.env[k]; }
    home = fs.mkdtempSync(path.join(tmpdir(), 'r219-home-'));
    pkgRoot = fs.mkdtempSync(path.join(tmpdir(), 'r219-pkg-'));
    process.env.__R219_HOME__ = home;
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

  it('a profile name in the shipped .env.defaults applies (future default flip) unless the user names one', () => {
    fs.writeFileSync(path.join(pkgRoot, '.env.defaults'), 'CORTEX_INTERACTIVE_PROFILE=bench-lite\nCORTEX_WALL_DROP=off\n');
    bootstrapEnv(pkgRoot, { interactive: true });
    expect(process.env.CORTEX_WALL_DROP).toBe('on');
  });
});
