/**
 * ToolProfile — the CORTEX_TOOL_PROFILE experiment surface.
 *
 * Pins: profile resolution (unknown → full), the three filter behaviors,
 * EndTurn/AskUserQuestion retention (subordinate gates must not silently
 * break), the ToolFactory choke point (essential backstop cannot re-admit
 * hidden tools), and the dispatch-guard face.
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  resolveToolProfile,
  resolveToolAnchor,
  isNarrowProfile,
  applyToolProfile,
  isToolAllowedByProfile,
  resolveFrameProfile,
} from '../ToolProfile.js';
import { toolFactory } from '../ToolFactory.js';

const ORIG = process.env.CORTEX_TOOL_PROFILE;
afterEach(() => {
  if (ORIG === undefined) delete process.env.CORTEX_TOOL_PROFILE;
  else process.env.CORTEX_TOOL_PROFILE = ORIG;
});

const T = (name: string, discoveryTier?: string) => ({ name, discoveryTier });
const SAMPLE = [
  T('Read', 'essential'), T('Bash', 'essential'), T('Grep', 'essential'),
  T('ListSessions', 'standard'), T('CanonPullSession', 'standard'),
  T('EndTurn', 'standard'), T('AskUserQuestion', 'essential'),
  T('SomeMcpTool'), // no tier — MCP/context-shaped
];

describe('resolveToolProfile', () => {
  it('defaults to full; unknown values fail open to full', () => {
    delete process.env.CORTEX_TOOL_PROFILE;
    expect(resolveToolProfile()).toBe('full');
    process.env.CORTEX_TOOL_PROFILE = 'nonsense';
    expect(resolveToolProfile()).toBe('full');
  });
  it('resolves lean and bash-only (case/space-insensitive)', () => {
    process.env.CORTEX_TOOL_PROFILE = ' LEAN ';
    expect(resolveToolProfile()).toBe('lean');
    process.env.CORTEX_TOOL_PROFILE = 'bash-only';
    expect(resolveToolProfile()).toBe('bash-only');
  });
});

describe('applyToolProfile', () => {
  it('full is identity', () => {
    expect(applyToolProfile(SAMPLE, 'full')).toEqual(SAMPLE);
  });
  it('lean keeps essential tier + EndTurn, drops standard/untiered', () => {
    const names = applyToolProfile(SAMPLE, 'lean').map((t) => t.name);
    expect(names).toEqual(['Read', 'Bash', 'Grep', 'EndTurn', 'AskUserQuestion']);
  });
  it('bash-only keeps only Bash + the always-keep set', () => {
    const names = applyToolProfile(SAMPLE, 'bash-only').map((t) => t.name);
    expect(names).toEqual(['Bash', 'EndTurn', 'AskUserQuestion']);
  });
  it('bash-plus keeps the minimal-harness surface (Bash+Read+Edit+Write) + always-keep', () => {
    const S = [...SAMPLE, T('Edit', 'essential'), T('Write', 'essential'), T('WebSearch', 'essential')];
    const names = applyToolProfile(S, 'bash-plus').map((t) => t.name);
    expect(names).toEqual(['Read', 'Bash', 'EndTurn', 'AskUserQuestion', 'Edit', 'Write']);
    expect(names).not.toContain('WebSearch');
    expect(names).not.toContain('Grep');
  });
});

describe('resolveToolAnchor + isNarrowProfile (BASH_PLUS_SPEC P0)', () => {
  const OA = process.env.CORTEX_TOOL_ANCHOR;
  afterEach(() => {
    if (OA === undefined) delete process.env.CORTEX_TOOL_ANCHOR;
    else process.env.CORTEX_TOOL_ANCHOR = OA;
  });
  it('unset / full / unknown → no anchor', () => {
    delete process.env.CORTEX_TOOL_ANCHOR;
    expect(resolveToolAnchor()).toBeNull();
    process.env.CORTEX_TOOL_ANCHOR = 'full';
    expect(resolveToolAnchor()).toBeNull();
    process.env.CORTEX_TOOL_ANCHOR = 'nonsense';
    expect(resolveToolAnchor()).toBeNull();
  });
  it('resolves the three narrow profiles', () => {
    process.env.CORTEX_TOOL_ANCHOR = 'bash-plus';
    expect(resolveToolAnchor()).toBe('bash-plus');
    process.env.CORTEX_TOOL_ANCHOR = ' BASH-ONLY ';
    expect(resolveToolAnchor()).toBe('bash-only');
    process.env.CORTEX_TOOL_ANCHOR = 'lean';
    expect(resolveToolAnchor()).toBe('lean');
  });
  it('isNarrowProfile: bash-only/bash-plus/bash-edit suppress MCP ride-alongs; full/lean do not', () => {
    expect(isNarrowProfile('bash-only')).toBe(true);
    expect(isNarrowProfile('bash-plus')).toBe(true);
    expect(isNarrowProfile('bash-edit')).toBe(true);
    expect(isNarrowProfile('lean')).toBe(false);
    expect(isNarrowProfile('full')).toBe(false);
  });
  it('bash-edit is the dsh-Minimal shape: Bash+Edit+always-keep only', () => {
    const S = [...SAMPLE, T('Edit', 'essential'), T('Write', 'essential')];
    const names = applyToolProfile(S, 'bash-edit').map((t) => t.name);
    expect(names).toEqual(['Bash', 'EndTurn', 'AskUserQuestion', 'Edit']);
    expect(isToolAllowedByProfile('Edit', () => 'essential', 'bash-edit')).toBe(true);
    expect(isToolAllowedByProfile('Read', () => 'essential', 'bash-edit')).toBe(false);
    expect(isToolAllowedByProfile('Write', () => 'essential', 'bash-edit')).toBe(false);
  });
  it('card anchor: used when env unset; env value overrides; env off disables card', () => {
    delete process.env.CORTEX_TOOL_ANCHOR;
    expect(resolveToolAnchor(process.env, 'bash-edit')).toBe('bash-edit');
    process.env.CORTEX_TOOL_ANCHOR = 'bash-plus';
    expect(resolveToolAnchor(process.env, 'bash-edit')).toBe('bash-plus');
    process.env.CORTEX_TOOL_ANCHOR = 'none';
    expect(resolveToolAnchor(process.env, 'bash-edit')).toBeNull();
    process.env.CORTEX_TOOL_ANCHOR = '';
    expect(resolveToolAnchor(process.env, 'garbage')).toBeNull();
  });
});

describe('ToolFactory choke point', () => {
  it('bash-only removes Read/Edit from getAllTools AND the essential backstop cannot re-admit them', () => {
    process.env.CORTEX_TOOL_PROFILE = 'bash-only';
    const all = toolFactory.getAllTools().map((t) => t.name);
    expect(all).toContain('Bash');
    expect(all).not.toContain('Read');
    expect(all).not.toContain('Edit');
    // getEssentialTools filters FROM getAllTools — the backstop name set must
    // not resurrect hidden tools.
    const essential = toolFactory.getEssentialTools().map((t) => t.name);
    expect(essential).not.toContain('Read');
  });
  it('lean equals the essential tier (+ always-keep) of the full surface', () => {
    process.env.CORTEX_TOOL_PROFILE = 'full';
    const fullEssential = new Set(
      toolFactory.getAllTools().filter((t) => t.discoveryTier === 'essential').map((t) => t.name),
    );
    process.env.CORTEX_TOOL_PROFILE = 'lean';
    for (const t of toolFactory.getAllTools()) {
      expect(fullEssential.has(t.name) || t.name === 'EndTurn' || t.name === 'AskUserQuestion').toBe(true);
    }
  });
});

describe('isToolAllowedByProfile (dispatch-guard face)', () => {
  const tier = (n: string) => SAMPLE.find((t) => t.name === n)?.discoveryTier;
  it('full allows everything', () => {
    expect(isToolAllowedByProfile('CanonPullSession', tier, 'full')).toBe(true);
  });
  it('bash-only blocks a hallucinated Read call but allows Bash', () => {
    expect(isToolAllowedByProfile('Read', tier, 'bash-only')).toBe(false);
    expect(isToolAllowedByProfile('Bash', tier, 'bash-only')).toBe(true);
    expect(isToolAllowedByProfile('AskUserQuestion', tier, 'bash-only')).toBe(true);
  });
  it('lean blocks standard-tier, allows essential', () => {
    expect(isToolAllowedByProfile('ListSessions', tier, 'lean')).toBe(false);
    expect(isToolAllowedByProfile('Grep', tier, 'lean')).toBe(true);
  });
  it('bash-plus allows the file quartet + always-keep, blocks the rest', () => {
    expect(isToolAllowedByProfile('Bash', tier, 'bash-plus')).toBe(true);
    expect(isToolAllowedByProfile('Read', tier, 'bash-plus')).toBe(true);
    expect(isToolAllowedByProfile('Edit', tier, 'bash-plus')).toBe(true);
    expect(isToolAllowedByProfile('Write', tier, 'bash-plus')).toBe(true);
    expect(isToolAllowedByProfile('AskUserQuestion', tier, 'bash-plus')).toBe(true);
    expect(isToolAllowedByProfile('Grep', tier, 'bash-plus')).toBe(false);
    expect(isToolAllowedByProfile('WebSearch', tier, 'bash-plus')).toBe(false);
  });
});

describe('resolveFrameProfile (backlog item 5 — per-model frame defaults)', () => {

  it('defaults to lifted (no env, no card)', () => {
    expect(resolveFrameProfile({} as NodeJS.ProcessEnv, null)).toBe('lifted');
  });
  it('card frameProfile persist is honored', () => {
    expect(resolveFrameProfile({} as NodeJS.ProcessEnv, 'persist')).toBe('persist');
  });
  it('env true overrides card lifted', () => {
    expect(resolveFrameProfile({ CORTEX_TOOL_ANCHOR_PERSIST: 'true' } as NodeJS.ProcessEnv, 'lifted')).toBe('persist');
  });
  it('env false overrides card persist (experiment kill-switch)', () => {
    expect(resolveFrameProfile({ CORTEX_TOOL_ANCHOR_PERSIST: 'false' } as NodeJS.ProcessEnv, 'persist')).toBe('lifted');
  });
  it('env accepts 1/0/persist/lifted/off spellings', () => {
    expect(resolveFrameProfile({ CORTEX_TOOL_ANCHOR_PERSIST: '1' } as NodeJS.ProcessEnv, null)).toBe('persist');
    expect(resolveFrameProfile({ CORTEX_TOOL_ANCHOR_PERSIST: 'persist' } as NodeJS.ProcessEnv, null)).toBe('persist');
    expect(resolveFrameProfile({ CORTEX_TOOL_ANCHOR_PERSIST: '0' } as NodeJS.ProcessEnv, 'persist')).toBe('lifted');
    expect(resolveFrameProfile({ CORTEX_TOOL_ANCHOR_PERSIST: 'off' } as NodeJS.ProcessEnv, 'persist')).toBe('lifted');
  });
  it('garbage env falls through to card', () => {
    expect(resolveFrameProfile({ CORTEX_TOOL_ANCHOR_PERSIST: 'banana' } as NodeJS.ProcessEnv, 'persist')).toBe('persist');
    expect(resolveFrameProfile({ CORTEX_TOOL_ANCHOR_PERSIST: 'banana' } as NodeJS.ProcessEnv, null)).toBe('lifted');
  });
  it('garbage card falls back to lifted', () => {
    expect(resolveFrameProfile({} as NodeJS.ProcessEnv, 'sideways')).toBe('lifted');
  });
});
