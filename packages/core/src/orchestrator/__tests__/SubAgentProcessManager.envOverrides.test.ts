/**
 * Verifies that SubAgentProcessManager.spawnAgent passes envOverrides into
 * the forked child process environment. This is the load-bearing wire
 * connecting Browse-style entry tools to their subagents — without it,
 * the subagent would inherit the parent's MCP_AUTO_INJECT=false and never
 * see the nexus-browser tool surface.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Mock child_process.fork BEFORE importing SubAgentProcessManager so the
// mock is what the module captures.
type ForkCall = { env: Record<string, string | undefined>; args: unknown[] };
const forkCalls: ForkCall[] = [];

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  const { EventEmitter } = await import('events');
  return {
    ...actual,
    fork: vi.fn((modulePath: string, args: any[], options: any) => {
      forkCalls.push({ env: options?.env || {}, args });
      // Minimal ChildProcess-shaped object — enough to satisfy
      // SubAgentProcessManager.setupProcessHandlers without crashing.
      const emitter = new EventEmitter() as any;
      emitter.pid = 99999;
      emitter.send = vi.fn();
      emitter.kill = vi.fn();
      emitter.disconnect = vi.fn();
      emitter.stdout = new EventEmitter();
      emitter.stderr = new EventEmitter();
      emitter.stdin = { write: vi.fn(), end: vi.fn() };
      emitter.connected = true;
      return emitter;
    }),
    execSync: actual.execSync,
  };
});

import { SubAgentProcessManager } from '../SubAgentProcessManager.js';
import type { AgentDefinition } from '../../agents/AgentStore.js';

describe('SubAgentProcessManager — envOverrides plumbing', () => {
  let manager: SubAgentProcessManager;
  const agentDef: AgentDefinition = {
    name: 'browse-agent',
    description: 'test',
    systemPrompt: 'test prompt',
    tools: [],
    model: 'inherit',
    location: 'project',
    filePath: '<inline>',
  } as any;

  beforeEach(() => {
    forkCalls.length = 0;
    manager = new SubAgentProcessManager({
      defaultModelId: 'claude-sonnet-4-5',
      projectPath: '/tmp/test',
      debug: false,
    } as any);
  });

  afterEach(() => {
    // Don't await — the mocked promise never resolves, that's fine for
    // env-passing assertions. The promise return is not what we're testing.
  });

  it('passes envOverrides into the forked child env, on top of process.env', () => {
    // Set a known value so we can verify overrides win
    process.env.MCP_AUTO_INJECT = 'false';
    process.env.UNRELATED_VAR = 'parent-value';

    manager.spawnAgent(agentDef, 'go look at hn', {
      envOverrides: { MCP_AUTO_INJECT: 'true' },
    });

    expect(forkCalls).toHaveLength(1);
    const { env } = forkCalls[0]!;
    // Override took effect:
    expect(env.MCP_AUTO_INJECT).toBe('true');
    // Unrelated parent vars still flowed through:
    expect(env.UNRELATED_VAR).toBe('parent-value');
    // Internal agent-mode markers were applied last (highest priority):
    expect(env.CORTEX_AGENT_MODE).toBe('true');
    expect(env.CORTEX_AGENT_ID).toBeDefined();
  });

  it('works when envOverrides is omitted (falls back to inherited env)', () => {
    process.env.MCP_AUTO_INJECT = 'false';

    manager.spawnAgent(agentDef, 'task');

    expect(forkCalls).toHaveLength(1);
    expect(forkCalls[0]!.env.MCP_AUTO_INJECT).toBe('false');
    expect(forkCalls[0]!.env.CORTEX_AGENT_MODE).toBe('true');
  });

  it('can add a new env var that did not exist on the parent', () => {
    delete process.env.BROWSE_MARKER;

    manager.spawnAgent(agentDef, 'task', {
      envOverrides: { BROWSE_MARKER: 'set-from-override' },
    });

    expect(forkCalls[0]!.env.BROWSE_MARKER).toBe('set-from-override');
  });

  it('CORTEX_AGENT_MODE cannot be clobbered by envOverrides (internal marker has last word)', () => {
    manager.spawnAgent(agentDef, 'task', {
      envOverrides: { CORTEX_AGENT_MODE: 'hijacked' } as any,
    });

    // The fork() env assembly is:
    //   { ...process.env, ...envOverrides, CORTEX_AGENT_MODE: 'true', ... }
    // so the internal marker wins over a user-supplied override. This is the
    // correct security posture — Browse can't accidentally disable the
    // subagent-mode flag.
    expect(forkCalls[0]!.env.CORTEX_AGENT_MODE).toBe('true');
  });
});
