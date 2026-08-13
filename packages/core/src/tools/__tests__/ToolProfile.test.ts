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
  applyToolProfile,
  isToolAllowedByProfile,
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
});
