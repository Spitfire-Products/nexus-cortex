/**
 * Inaction guard detector — unit table (backlog item 2).
 * The guard is the loop ladder's inverse: fires on LONG actless first-turn
 * responses in tool-capable requests, and ONLY there. Default off.
 */

import { describe, it, expect } from 'vitest';
import {
  shouldNudgeInaction,
  resolveInactionConfig,
  formatInactionNudge,
} from '../inactionGuard.js';

const armed = { CORTEX_INACTION_NUDGE: 'true' } as NodeJS.ProcessEnv;

const base = {
  responseChars: 8000,
  toolUseBlocksThisResponse: 0,
  executedToolCallsThisTurn: 0,
  toolsOffered: 12,
  turnNumber: 0,
  alreadyNudged: false,
};

describe('resolveInactionConfig', () => {
  it('is OFF by default', () => {
    expect(resolveInactionConfig({} as NodeJS.ProcessEnv).enabled).toBe(false);
  });
  it('arms only on the exact string true', () => {
    expect(resolveInactionConfig(armed).enabled).toBe(true);
    expect(resolveInactionConfig({ CORTEX_INACTION_NUDGE: '1' } as NodeJS.ProcessEnv).enabled).toBe(false);
  });
  it('threshold default 4000, env-tunable, garbage falls back', () => {
    expect(resolveInactionConfig(armed).minChars).toBe(4000);
    expect(resolveInactionConfig({ ...armed, CORTEX_INACTION_MIN_CHARS: '2500' }).minChars).toBe(2500);
    expect(resolveInactionConfig({ ...armed, CORTEX_INACTION_MIN_CHARS: '-5' }).minChars).toBe(4000);
    expect(resolveInactionConfig({ ...armed, CORTEX_INACTION_MIN_CHARS: 'nope' }).minChars).toBe(4000);
  });
});

describe('shouldNudgeInaction', () => {
  it('fires: long + actless + agentic + first turn', () => {
    expect(shouldNudgeInaction(base, armed)).toBe(true);
  });
  it('never fires when unarmed (default off)', () => {
    expect(shouldNudgeInaction(base, {} as NodeJS.ProcessEnv)).toBe(false);
  });
  it('short answer → no (a direct reply is legitimate)', () => {
    expect(shouldNudgeInaction({ ...base, responseChars: 900 }, armed)).toBe(false);
  });
  it('pure-chat (no tools offered) → no', () => {
    expect(shouldNudgeInaction({ ...base, toolsOffered: 0 }, armed)).toBe(false);
  });
  it('second turn of the session → no (conservative v1 gate)', () => {
    expect(shouldNudgeInaction({ ...base, turnNumber: 2 }, armed)).toBe(false);
  });
  it('turn already acted (tool calls earlier this turn) → no', () => {
    expect(shouldNudgeInaction({ ...base, executedToolCallsThisTurn: 3 }, armed)).toBe(false);
  });
  it('response itself contains tool_use → no', () => {
    expect(shouldNudgeInaction({ ...base, toolUseBlocksThisResponse: 1 }, armed)).toBe(false);
  });
  it('single-nudge bound: already nudged → no', () => {
    expect(shouldNudgeInaction({ ...base, alreadyNudged: true }, armed)).toBe(false);
  });
  it('threshold boundary: fires at exactly minChars', () => {
    expect(shouldNudgeInaction({ ...base, responseChars: 4000 }, armed)).toBe(true);
    expect(shouldNudgeInaction({ ...base, responseChars: 3999 }, armed)).toBe(false);
  });
});

describe('formatInactionNudge', () => {
  it('tells the model to act first, concretely', () => {
    const t = formatInactionNudge();
    expect(t).toMatch(/ran no commands/i);
    expect(t).toMatch(/Act first/);
  });
});
