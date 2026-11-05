/**
 * The browse sub-agent may not start another sub-agent (operator 2026-11-03); every agent's allowlist governs what it is offered,
 * can discover (SearchTools) and can execute.
 */
import { describe, it, expect } from 'vitest';
import { filterAgentTools, isBlockedBaseToolCall, SUBAGENT_SPAWNING_TOOLS, agentDepth, childAgentDepth, mayNotSpawn } from '../toolAllowlist.js';

const T = (...names: string[]) => names.map((name) => ({ name }));
const ALL = ['Read', 'Grep', 'Glob', 'Bash', 'Write', 'Browse', 'Task', 'WebSearch', 'WebFetch', 'SearchTools', 'EndTurn'];
const BROWSE_ALLOW = ['Read', 'Grep', 'Glob', 'TodoCreate', 'TodoUpdate', 'TodoList'];

describe('browse agent: no sub-agent spawning', () => {
  const browse = { CORTEX_BROWSE_AGENT: 'true', CORTEX_AGENT_MODE: 'true' } as NodeJS.ProcessEnv;
  it('spawning tools are never offered, even with an unrestricted (all-tools) allowlist', () => {
    const names = filterAgentTools(T(...ALL), undefined, browse).map((t) => t.name);
    for (const s of SUBAGENT_SPAWNING_TOOLS) expect(names).not.toContain(s);
    expect(names).toContain('Bash');
  });
  it('its real allowlist keeps only Read/Grep/Glob + SearchTools/EndTurn', () => {
    expect(filterAgentTools(T(...ALL), BROWSE_ALLOW, browse).map((t) => t.name)).toEqual(['Read', 'Grep', 'Glob', 'SearchTools', 'EndTurn']);
  });
  it('execution refuses a spawning tool or an excluded base tool, never an MCP tool', () => {
    expect(isBlockedBaseToolCall('Browse', ALL, BROWSE_ALLOW, browse)).toBe(true);
    expect(isBlockedBaseToolCall('task', ALL, BROWSE_ALLOW, browse)).toBe(true);        // name normalisation
    expect(isBlockedBaseToolCall('Bash', ALL, BROWSE_ALLOW, browse)).toBe(true);
    expect(isBlockedBaseToolCall('Read', ALL, BROWSE_ALLOW, browse)).toBe(false);
    expect(isBlockedBaseToolCall('nexus-browser__browse', ALL, BROWSE_ALLOW, browse)).toBe(false);
  });
});

describe('other agents', () => {
  const task = { CORTEX_AGENT_MODE: 'true', CORTEX_AGENT_DEPTH: '1' } as NodeJS.ProcessEnv;
  it('default depth limit 1: a Task sub-agent with all tools is NOT offered Browse/Task/WebSearch (2026-10-19 design)', () => {
    const names = filterAgentTools(T(...ALL), undefined, task).map((t) => t.name);
    for (const s of SUBAGENT_SPAWNING_TOOLS) expect(names).not.toContain(s);
    expect(isBlockedBaseToolCall('Browse', ALL, undefined, task)).toBe(true);
  });
  it('with CORTEX_MAX_AGENT_DEPTH=2 a depth-1 sub-agent keeps Browse', () => {
    const t2 = { ...task, CORTEX_MAX_AGENT_DEPTH: '2' } as NodeJS.ProcessEnv;
    expect(filterAgentTools(T(...ALL), undefined, t2).map((t) => t.name)).toContain('Browse');
  });
  it('the parent (no allowlist, not a delegate) is unchanged', () => {
    expect(filterAgentTools(T(...ALL), undefined, {}).length).toBe(ALL.length);
  });
  it('any restricted agent: excluded base tools are blocked at execution', () => {
    expect(isBlockedBaseToolCall('Write', ALL, ['Read'], task)).toBe(true);
    expect(isBlockedBaseToolCall('SearchTools', ALL, ['Read'], task)).toBe(false);     // core tools always survive
  });
});

describe('bounded nesting (CORTEX_MAX_AGENT_DEPTH, default 1)', () => {
  it('depth: main 0, an agent-mode process without a depth counts as 1, children get parent + 1', () => {
    expect(agentDepth({})).toBe(0);
    expect(agentDepth({ CORTEX_AGENT_MODE: 'true' })).toBe(1);
    expect(childAgentDepth({})).toBe('1');
    expect(childAgentDepth({ CORTEX_AGENT_DEPTH: '1' })).toBe('2');
  });
  it('default: the main agent spawns, every sub-agent does not', () => {
    expect(mayNotSpawn({})).toBe(false);
    expect(mayNotSpawn({ CORTEX_AGENT_MODE: 'true', CORTEX_AGENT_DEPTH: '1' })).toBe(true);
    expect(mayNotSpawn({ CORTEX_AGENT_MODE: 'true' })).toBe(true);                    // depth unknown → treated as 1
  });
  it('CORTEX_MAX_AGENT_DEPTH=2: depth 1 may spawn, depth 2 may not', () => {
    expect(mayNotSpawn({ CORTEX_MAX_AGENT_DEPTH: '2', CORTEX_AGENT_MODE: 'true', CORTEX_AGENT_DEPTH: '1' })).toBe(false);
    const d2 = { CORTEX_MAX_AGENT_DEPTH: '2', CORTEX_AGENT_MODE: 'true', CORTEX_AGENT_DEPTH: '2' } as NodeJS.ProcessEnv;
    expect(mayNotSpawn(d2)).toBe(true);
    expect(isBlockedBaseToolCall('Task', ALL, undefined, d2)).toBe(true);
  });
  it('the browse agent never spawns, even when the limit would allow it', () => {
    expect(mayNotSpawn({ CORTEX_BROWSE_AGENT: 'true', CORTEX_AGENT_DEPTH: '1', CORTEX_MAX_AGENT_DEPTH: '5' })).toBe(true);
  });
});
