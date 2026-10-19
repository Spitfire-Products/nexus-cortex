import { describe, it, expect } from 'vitest';
import { applyAllowlistKeepingCore, mergeExtraTools } from '../toolAllowlist.js';
import { anchorAppliesToProcess, resolveToolAnchor, delegateAnchorEnv, delegateMcpEnv } from '../../tools/ToolProfile.js';

const tools = ['Bash', 'Edit', 'Read', 'Grep', 'Glob', 'SearchTools', 'EndTurn', 'TodoCreate', 'nexus-browser__browse'].map((name) => ({ name }));

describe('R266 delegate frame', () => {
  it('allowlist keeps SearchTools + EndTurn even when the agent definition omits them', () => {
    const out = applyAllowlistKeepingCore(tools, ['Read', 'Grep', 'Glob', 'TodoCreate']).map((t) => t.name);
    expect(out).toEqual(['Read', 'Grep', 'Glob', 'SearchTools', 'EndTurn', 'TodoCreate']);
    expect(applyAllowlistKeepingCore(tools, undefined)).toBe(tools);
    expect(applyAllowlistKeepingCore(tools, [])).toBe(tools);
  });
  it('the first-turn anchor applies to the main process only', () => {
    expect(anchorAppliesToProcess({})).toBe(true);
    expect(anchorAppliesToProcess({ CORTEX_AGENT_MODE: 'true' })).toBe(false);
    expect(anchorAppliesToProcess({ CORTEX_AGENT_MODE: 'false' })).toBe(true);
    // belt and braces: the Browse delegate also sets the anchor off explicitly
    expect(resolveToolAnchor({ CORTEX_TOOL_ANCHOR: 'none' }, 'bash-edit')).toBeNull();
  });
  it('R267: a definition-declared anchor re-arms the door for that delegate; Task.tools widens the allowlist', () => {
    expect(delegateAnchorEnv('bash-edit')).toEqual({ CORTEX_TOOL_ANCHOR: 'bash-edit', CORTEX_DELEGATE_ANCHOR: 'true' });
    expect(delegateAnchorEnv('none')).toEqual({ CORTEX_TOOL_ANCHOR: 'none' });
    expect(delegateAnchorEnv(undefined)).toEqual({});
    expect(delegateAnchorEnv('bogus')).toEqual({});
    expect(anchorAppliesToProcess({ CORTEX_AGENT_MODE: 'true', CORTEX_DELEGATE_ANCHOR: 'true' })).toBe(true);
    expect(mergeExtraTools(['Read', 'Grep'], ['Write', 'read', 'WebSearch'])).toEqual(['Read', 'Grep', 'Write', 'WebSearch']);
    expect(mergeExtraTools('all', ['Write'])).toBe('all');
    expect(mergeExtraTools(['Read'], 'nope')).toEqual(['Read']);
    expect(delegateMcpEnv(['nexus-browser'])).toEqual({ MCP_AUTO_INJECT: 'true', CORTEX_MCP_AUTOCONNECT: 'nexus-browser' });
    expect(delegateMcpEnv([])).toEqual({});
    expect(delegateMcpEnv('x')).toEqual({});
  });
});
