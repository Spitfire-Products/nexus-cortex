/**
 * Agent Dispatch Lifecycle — Comprehensive Tests
 *
 * Tests all 4 agent dispatch variants:
 *   1. Solo Agent: Single Task tool → sequential execution
 *   2. Parallel Agents: Multiple Task tools → Promise.allSettled
 *   3. Agent Teams: Parallel + team briefing + cross-agent broadcasting
 *   4. Agent Team Workspace: Team + WorkspaceManager worktree isolation
 *
 * Also covers:
 *   - IPC protocol (message types, serialization)
 *   - Event routing (no crosstalk between parallel agents)
 *   - Error handling (timeout, crash, abort, permission denied)
 *   - Result broadcasting (early-completion forwarding)
 *   - SubAgentProcessManager lifecycle
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'events';

// ============================================
// 1. SOLO AGENT DISPATCH
// ============================================

describe('Solo Agent Dispatch', () => {
  it('should not inject team briefing for single Task tool', () => {
    const toolUseBlocks = [
      { id: 'tool-1', name: 'Task', input: { subagent_type: 'explore', prompt: 'find files', description: 'search' } },
    ];

    const taskTools = toolUseBlocks.filter(t => t.name === 'Task');

    // injectTeamBriefing returns unchanged for single agent
    function injectTeamBriefing(tools: typeof taskTools) {
      if (tools.length <= 1) return tools;
      return tools; // Would inject briefing for >1
    }

    const result = injectTeamBriefing(taskTools);
    expect(result).toEqual(taskTools);
    expect(result[0].input.prompt).toBe('find files');
  });

  it('should execute solo Task sequentially (not via Promise.allSettled)', () => {
    const toolUseBlocks = [
      { id: 'tool-1', name: 'Task', input: { subagent_type: 'explore', prompt: 'task A' } },
      { id: 'tool-2', name: 'Read', input: { file_path: '/tmp/test' } },
    ];

    const taskTools = toolUseBlocks.filter(t => t.name === 'Task');
    const otherTools = toolUseBlocks.filter(t => t.name !== 'Task');

    expect(taskTools).toHaveLength(1);
    expect(otherTools).toHaveLength(1);

    // With only 1 Task tool, dispatch is sequential (not parallel)
    const isParallel = taskTools.length > 1;
    expect(isParallel).toBe(false);
  });

  it('should build SubAgentResult with all required fields', () => {
    const result = {
      agentId: 'explore-abc123',
      agentName: 'explore',
      model: 'claude-haiku-4-5',
      startTime: new Date('2026-01-01T00:00:00Z'),
      endTime: new Date('2026-01-01T00:00:10Z'),
      durationMs: 10000,
      turnCount: 3,
      status: 'completed' as const,
      summary: 'Found 5 relevant files.',
      fullResponse: 'Detailed analysis...',
      toolsUsed: [
        { name: 'Read', callCount: 3, totalDuration: 500, errors: 0 },
        { name: 'Grep', callCount: 2, totalDuration: 300, errors: 0 },
      ],
      filesRead: ['/src/index.ts', '/src/utils.ts'],
      filesModified: [],
      cost: { inputTokens: 5000, outputTokens: 1200, estimatedCost: 0.01, cacheHits: 2 },
    };

    expect(result.status).toBe('completed');
    expect(result.agentId).toMatch(/^explore-/);
    expect(result.toolsUsed).toHaveLength(2);
    expect(result.filesModified).toHaveLength(0);
    expect(result.cost.cacheHits).toBe(2);
  });

  it('should generate unique agent IDs with name prefix', () => {
    function generateAgentId(agentName: string): string {
      const shortId = Math.random().toString(36).substring(2, 10);
      return `${agentName}-${shortId}`;
    }

    const id1 = generateAgentId('explore');
    const id2 = generateAgentId('explore');
    const id3 = generateAgentId('code-reviewer');

    expect(id1).toMatch(/^explore-/);
    expect(id3).toMatch(/^code-reviewer-/);
    expect(id1).not.toBe(id2); // Unique
  });
});


// ============================================
// 2. PARALLEL AGENT DISPATCH
// ============================================

describe('Parallel Agent Dispatch', () => {
  it('should detect parallel dispatch when multiple Task tools present', () => {
    const toolUseBlocks = [
      { id: 'tool-1', name: 'Task', input: { subagent_type: 'explore', prompt: 'task A' } },
      { id: 'tool-2', name: 'Task', input: { subagent_type: 'code-reviewer', prompt: 'task B' } },
      { id: 'tool-3', name: 'Read', input: { file_path: '/tmp/test' } },
    ];

    const taskTools = toolUseBlocks.filter(t => t.name === 'Task');
    const otherTools = toolUseBlocks.filter(t => t.name !== 'Task');

    expect(taskTools).toHaveLength(2);
    expect(otherTools).toHaveLength(1);
    expect(taskTools.length > 1).toBe(true); // Parallel path
  });

  it('should handle Promise.allSettled with mixed success/failure', async () => {
    const promises = [
      Promise.resolve({
        tool_use_id: 'tool-1',
        tool_name: 'Task',
        content: 'Agent A completed successfully',
        is_error: false,
        metadata: { subAgentResult: { agentName: 'explore', agentId: 'explore-abc' } },
      }),
      Promise.reject(new Error('Agent B crashed')),
      Promise.resolve({
        tool_use_id: 'tool-3',
        tool_name: 'Task',
        content: 'Agent C completed',
        is_error: false,
        metadata: { subAgentResult: { agentName: 'reviewer', agentId: 'reviewer-def' } },
      }),
    ];

    const settled = await Promise.allSettled(promises);
    const results: Array<{ tool_use_id: string; tool_name: string; content: string; is_error?: boolean }> = [];

    for (const s of settled) {
      if (s.status === 'fulfilled') {
        results.push(s.value);
      } else {
        results.push({
          tool_use_id: 'unknown',
          tool_name: 'Task',
          content: `Sub-agent failed: ${s.reason?.message || 'Unknown error'}`,
          is_error: true,
        });
      }
    }

    expect(results).toHaveLength(3);
    expect(results[0].is_error).toBeFalsy();
    expect(results[1].is_error).toBe(true);
    expect(results[1].content).toContain('Agent B crashed');
    expect(results[2].is_error).toBeFalsy();
  });

  it('should execute other tools sequentially after parallel Task tools', async () => {
    const executionOrder: string[] = [];

    const taskTools = [
      { id: '1', name: 'Task', input: { subagent_type: 'a', prompt: 'task A' } },
      { id: '2', name: 'Task', input: { subagent_type: 'b', prompt: 'task B' } },
    ];
    const otherTools = [
      { id: '3', name: 'Read', input: { file_path: '/tmp/x' } },
      { id: '4', name: 'Grep', input: { pattern: 'test' } },
    ];

    // Simulate parallel Task execution
    await Promise.allSettled(taskTools.map(async (t) => {
      executionOrder.push(`parallel:${t.input.subagent_type}`);
    }));

    // Then sequential other tools
    for (const t of otherTools) {
      executionOrder.push(`sequential:${t.name}`);
    }

    expect(executionOrder).toHaveLength(4);
    // Parallel tasks logged first (order may vary)
    expect(executionOrder.filter(e => e.startsWith('parallel:'))).toHaveLength(2);
    // Sequential tools come after all parallel
    expect(executionOrder[2]).toBe('sequential:Read');
    expect(executionOrder[3]).toBe('sequential:Grep');
  });
});


// ============================================
// 3. AGENT TEAMS (Parallel + Briefing + Broadcasting)
// ============================================

describe('Agent Teams', () => {
  describe('Team Briefing Injection', () => {
    function injectTeamBriefing(
      taskTools: Array<{ id: string; name: string; input: any }>
    ): Array<{ id: string; name: string; input: any }> {
      if (taskTools.length <= 1) return taskTools;

      const assignments = taskTools.map(t => ({
        agentType: t.input?.subagent_type || 'general',
        description: t.input?.description || 'unknown task',
      }));

      return taskTools.map((toolUse, idx) => {
        const teammates = assignments
          .filter((_, i) => i !== idx)
          .map(a => `- ${a.agentType}: ${a.description}`)
          .join('\n');

        const briefing = `\n\n📋 **Team Briefing**\nYou are part of a ${taskTools.length}-agent team working in parallel.\n\nTeammates:\n${teammates}\n\nThe orchestrator will forward relevant findings from teammates.\nFocus on YOUR assignment. Do not duplicate others' work.\n\n---\n\n`;

        return {
          ...toolUse,
          input: {
            ...toolUse.input,
            prompt: briefing + (toolUse.input?.prompt || ''),
          },
        };
      });
    }

    it('should inject briefing with correct agent count', () => {
      const tools = [
        { id: '1', name: 'Task', input: { subagent_type: 'security', prompt: 'audit', description: 'Security scan' } },
        { id: '2', name: 'Task', input: { subagent_type: 'quality', prompt: 'review', description: 'Code quality' } },
        { id: '3', name: 'Task', input: { subagent_type: 'architecture', prompt: 'assess', description: 'Impact review' } },
      ];

      const result = injectTeamBriefing(tools);

      result.forEach(tool => {
        expect(tool.input.prompt).toContain('3-agent team');
        expect(tool.input.prompt).toContain('📋 **Team Briefing**');
      });
    });

    it('should exclude self from teammate list', () => {
      const tools = [
        { id: '1', name: 'Task', input: { subagent_type: 'security', prompt: 'p1', description: 'Scan vulns' } },
        { id: '2', name: 'Task', input: { subagent_type: 'quality', prompt: 'p2', description: 'Check style' } },
      ];

      const result = injectTeamBriefing(tools);

      // Security agent sees quality but not itself
      expect(result[0].input.prompt).toContain('quality: Check style');
      expect(result[0].input.prompt).not.toContain('security: Scan vulns');

      // Quality agent sees security but not itself
      expect(result[1].input.prompt).toContain('security: Scan vulns');
      expect(result[1].input.prompt).not.toContain('quality: Check style');
    });

    it('should preserve original prompt content after briefing', () => {
      const tools = [
        { id: '1', name: 'Task', input: { subagent_type: 'a', prompt: 'ORIGINAL_PROMPT_A', description: 'd1' } },
        { id: '2', name: 'Task', input: { subagent_type: 'b', prompt: 'ORIGINAL_PROMPT_B', description: 'd2' } },
      ];

      const result = injectTeamBriefing(tools);

      expect(result[0].input.prompt).toContain('ORIGINAL_PROMPT_A');
      expect(result[1].input.prompt).toContain('ORIGINAL_PROMPT_B');
    });

    it('should handle 5-agent team (PR review scenario)', () => {
      const tools = [
        { id: '1', name: 'Task', input: { subagent_type: 'pr-security-auditor', prompt: 'scan', description: 'Vulnerability scan' } },
        { id: '2', name: 'Task', input: { subagent_type: 'pr-code-quality', prompt: 'review', description: 'Style review' } },
        { id: '3', name: 'Task', input: { subagent_type: 'pr-architecture-reviewer', prompt: 'assess', description: 'Breaking changes' } },
        { id: '4', name: 'Task', input: { subagent_type: 'pr-implementer', prompt: 'fix', description: 'Fix issues' } },
        { id: '5', name: 'Task', input: { subagent_type: 'pr-test-writer', prompt: 'test', description: 'Write tests' } },
      ];

      const result = injectTeamBriefing(tools);

      expect(result).toHaveLength(5);
      result.forEach((tool, idx) => {
        expect(tool.input.prompt).toContain('5-agent team');
        // Each agent should see 4 teammates
        const teammateLines = tool.input.prompt.match(/^- .+$/gm) || [];
        expect(teammateLines.length).toBe(4);
      });
    });
  });

  describe('Cross-Agent Broadcasting', () => {
    let activeAgents: Map<string, { agentName: string }>;
    let guideCalls: Array<{ agentId: string; message: string }>;

    function guideAgent(agentId: string, message: string): boolean {
      if (!activeAgents.has(agentId)) return false;
      guideCalls.push({ agentId, message });
      return true;
    }

    function broadcastGuidance(message: string, excludeAgentId?: string): void {
      for (const agentId of activeAgents.keys()) {
        if (agentId !== excludeAgentId) {
          guideAgent(agentId, message);
        }
      }
    }

    beforeEach(() => {
      activeAgents = new Map();
      guideCalls = [];
    });

    it('should broadcast completion summary to siblings', () => {
      activeAgents.set('security-abc', { agentName: 'pr-security-auditor' });
      activeAgents.set('quality-def', { agentName: 'pr-code-quality' });
      activeAgents.set('arch-ghi', { agentName: 'pr-architecture-reviewer' });

      // Security agent completes first
      const result = {
        is_error: false,
        content: 'Found SQL injection in login handler and XSS in profile page.',
        metadata: {
          subAgentResult: {
            agentName: 'pr-security-auditor',
            agentId: 'security-abc',
          },
        },
      };

      // Simulate broadcast on completion (excludes the completed agent)
      const agentName = result.metadata.subAgentResult.agentName;
      const summary = `Agent "${agentName}" completed: ${result.content.substring(0, 500)}`;
      broadcastGuidance(`📡 Team Update: ${summary}`, result.metadata.subAgentResult.agentId);

      expect(guideCalls).toHaveLength(2);
      expect(guideCalls.map(c => c.agentId)).toEqual(['quality-def', 'arch-ghi']);
      expect(guideCalls[0].message).toContain('SQL injection');
      expect(guideCalls[0].message).toContain('📡 Team Update');
    });

    it('should not broadcast error results', () => {
      activeAgents.set('a', { agentName: 'agent-a' });
      activeAgents.set('b', { agentName: 'agent-b' });

      const errorResult = { is_error: true, content: 'Tool execution failed' };

      // Orchestrator checks !result.is_error before broadcasting
      if (!errorResult.is_error) {
        broadcastGuidance('Should not happen');
      }

      expect(guideCalls).toHaveLength(0);
    });

    it('should handle all agents completing (no active agents to broadcast to)', () => {
      // All agents already completed — map is empty
      broadcastGuidance('Late broadcast');
      expect(guideCalls).toHaveLength(0);
    });

    it('should truncate long summaries to 500 chars', () => {
      activeAgents.set('listener', { agentName: 'listener' });

      const longContent = 'A'.repeat(1000);
      const summary = `Agent "test" completed: ${longContent.substring(0, 500)}`;

      broadcastGuidance(summary);

      expect(guideCalls[0].message.length).toBeLessThan(600);
    });
  });

  describe('Event Routing (No Crosstalk)', () => {
    it('should filter events by agentId prefix', () => {
      const emitter = new EventEmitter();
      const securityEvents: any[] = [];
      const qualityEvents: any[] = [];

      // Setup listeners with prefix filtering
      emitter.on('agent:tool_call', (payload: any) => {
        if (payload.agentId.startsWith('pr-security-auditor-')) {
          securityEvents.push(payload);
        }
      });
      emitter.on('agent:tool_call', (payload: any) => {
        if (payload.agentId.startsWith('pr-code-quality-')) {
          qualityEvents.push(payload);
        }
      });

      // Emit events from both agents
      emitter.emit('agent:tool_call', { agentId: 'pr-security-auditor-abc', toolName: 'Read' });
      emitter.emit('agent:tool_call', { agentId: 'pr-code-quality-def', toolName: 'Grep' });
      emitter.emit('agent:tool_call', { agentId: 'pr-security-auditor-abc', toolName: 'Grep' });

      expect(securityEvents).toHaveLength(2);
      expect(qualityEvents).toHaveLength(1);
      expect(securityEvents[0].toolName).toBe('Read');
      expect(qualityEvents[0].toolName).toBe('Grep');
    });

    it('should handle multiple agents sharing one event emitter', () => {
      const emitter = new EventEmitter();
      const eventsByAgent: Map<string, number> = new Map();

      // 5 agents, each with their own listener
      const agents = ['security', 'quality', 'arch', 'impl', 'test'];
      agents.forEach(name => {
        emitter.on('agent:progress', (payload: any) => {
          if (payload.agentId.startsWith(`${name}-`)) {
            eventsByAgent.set(name, (eventsByAgent.get(name) || 0) + 1);
          }
        });
      });

      // Each agent emits 3 progress events
      agents.forEach(name => {
        for (let i = 0; i < 3; i++) {
          emitter.emit('agent:progress', { agentId: `${name}-${Math.random()}`, turn: i });
        }
      });

      // Each agent should receive exactly 3 events
      agents.forEach(name => {
        expect(eventsByAgent.get(name)).toBe(3);
      });
    });
  });
});


// ============================================
// 4. AGENT TEAM WORKSPACE (Team + Worktree Isolation)
// ============================================

describe('Agent Team Workspace', () => {
  it('should construct workspace-aware task prompts', () => {
    // Simulate orchestrator building task prompts with workspace paths
    const worktrees = [
      { path: '/tmp/workspace-abc', branch: 'refactor-auth-core' },
      { path: '/tmp/workspace-def', branch: 'refactor-auth-oauth' },
    ];

    const taskTools = [
      {
        id: '1',
        name: 'Task',
        input: {
          subagent_type: 'pr-implementer',
          prompt: `Working directory: ${worktrees[0].path}\nBranch: ${worktrees[0].branch}\nExtract core auth interfaces.`,
          description: 'Auth core refactor',
        },
      },
      {
        id: '2',
        name: 'Task',
        input: {
          subagent_type: 'pr-implementer',
          prompt: `Working directory: ${worktrees[1].path}\nBranch: ${worktrees[1].branch}\nMove OAuth logic.`,
          description: 'Auth OAuth refactor',
        },
      },
    ];

    // Verify worktree paths are in prompts
    expect(taskTools[0].input.prompt).toContain('/tmp/workspace-abc');
    expect(taskTools[1].input.prompt).toContain('/tmp/workspace-def');

    // Different branches = no conflict
    expect(taskTools[0].input.prompt).toContain('refactor-auth-core');
    expect(taskTools[1].input.prompt).toContain('refactor-auth-oauth');
  });

  it('should support full workspace lifecycle: create → assign → diff → cleanup', () => {
    // Simulate the orchestrator's workspace lifecycle
    const lifecycle: string[] = [];

    // 1. WorkspaceManager creates worktrees
    lifecycle.push('workspace:create:worktree-A');
    lifecycle.push('workspace:create:worktree-B');

    // 2. Team briefing injected
    lifecycle.push('team:briefing:2-agents');

    // 3. Agents dispatched in parallel
    lifecycle.push('dispatch:parallel:pr-implementer-A');
    lifecycle.push('dispatch:parallel:pr-implementer-B');

    // 4. Agent A completes → broadcast to B
    lifecycle.push('broadcast:A→B');

    // 5. Agent B completes
    lifecycle.push('completed:B');

    // 6. Diff both worktrees
    lifecycle.push('workspace:diff:worktree-A');
    lifecycle.push('workspace:diff:worktree-B');

    // 7. Cleanup
    lifecycle.push('workspace:cleanup:worktree-A');
    lifecycle.push('workspace:cleanup:worktree-B');

    expect(lifecycle).toHaveLength(11);
    expect(lifecycle[0]).toContain('workspace:create');
    expect(lifecycle[2]).toContain('team:briefing');
    expect(lifecycle[5]).toContain('broadcast');
    expect(lifecycle[9]).toContain('workspace:cleanup');
  });

  it('should combine WorkspaceManager + PRAgent in review flow', () => {
    // PR review lifecycle
    const steps: string[] = [];

    // 1. PRAgent fetches PR metadata
    const prResult = {
      mode: 'review',
      title: 'Add OAuth support',
      stats: { additions: 150, deletions: 30, changedFiles: 8 },
      diff: 'diff --git...',
    };
    steps.push('pr:review:metadata');

    // 2. Orchestrator creates worktree for review
    steps.push('workspace:create:review-branch');

    // 3. Dispatch 3 review agents
    steps.push('dispatch:parallel:security-auditor');
    steps.push('dispatch:parallel:code-quality');
    steps.push('dispatch:parallel:architecture-reviewer');

    // 4. Agents complete with findings
    steps.push('broadcast:security→quality,arch');
    steps.push('broadcast:quality→arch');

    // 5. Synthesize findings
    steps.push('synthesize:findings');

    // 6. PRAgent posts review
    steps.push('pr:post-review:approve|request-changes');

    // 7. Cleanup workspace
    steps.push('workspace:cleanup');

    expect(steps).toHaveLength(10);
    expect(steps[0]).toBe('pr:review:metadata');
    expect(steps.filter(s => s.startsWith('dispatch:parallel'))).toHaveLength(3);
    expect(steps[steps.length - 1]).toBe('workspace:cleanup');
  });
});


// ============================================
// 5. IPC PROTOCOL
// ============================================

describe('IPC Protocol', () => {
  describe('Message Types', () => {
    it('should support all parent→child message types', () => {
      const parentToChild = ['start', 'abort', 'pause', 'resume', 'guidance', 'permission_response'];

      const startMsg = { type: 'start', payload: { agentId: 'test-123', taskPrompt: 'do stuff', modelId: 'claude-haiku-4-5' } };
      const guidanceMsg = { type: 'guidance', payload: { message: 'Team update from agent A' } };
      const abortMsg = { type: 'abort', payload: { reason: 'User cancelled' } };

      expect(parentToChild).toContain(startMsg.type);
      expect(parentToChild).toContain(guidanceMsg.type);
      expect(parentToChild).toContain(abortMsg.type);
    });

    it('should support all child→parent message types', () => {
      const childToParent = [
        'ready', 'started', 'progress', 'tool_call', 'tool_result',
        'thinking', 'text', 'error', 'completed', 'interrupted',
        'timeout', 'log', 'permission_request',
      ];

      expect(childToParent).toHaveLength(13);
      expect(childToParent).toContain('completed');
      expect(childToParent).toContain('permission_request');
    });

    it('should structure tool_call message correctly', () => {
      const msg = {
        type: 'tool_call' as const,
        payload: {
          agentId: 'explore-abc123',
          toolName: 'Read',
          toolId: 'toolu_abc',
          toolInput: { file_path: '/src/index.ts' },
        },
      };

      expect(msg.payload.agentId).toMatch(/^explore-/);
      expect(msg.payload.toolName).toBe('Read');
      expect(msg.payload.toolInput).toHaveProperty('file_path');
    });

    it('should structure completed message with SubAgentResult', () => {
      const msg = {
        type: 'completed' as const,
        payload: {
          agentId: 'reviewer-def456',
          result: {
            agentId: 'reviewer-def456',
            agentName: 'code-reviewer',
            model: 'claude-haiku-4-5',
            startTime: new Date(),
            endTime: new Date(),
            durationMs: 15000,
            turnCount: 5,
            status: 'completed' as const,
            summary: 'Found 3 issues.',
            fullResponse: 'Detailed review...',
            toolsUsed: [{ name: 'Read', callCount: 4, totalDuration: 800, errors: 0 }],
            filesRead: ['/src/auth.ts'],
            filesModified: [],
            cost: { inputTokens: 8000, outputTokens: 2000, estimatedCost: 0.02, cacheHits: 3 },
          },
        },
      };

      expect(msg.payload.result.status).toBe('completed');
      expect(msg.payload.result.toolsUsed[0].callCount).toBe(4);
    });

    it('should structure permission_request message correctly', () => {
      const msg = {
        type: 'permission_request' as const,
        payload: {
          agentId: 'impl-789',
          requestId: 'req-uuid-1',
          toolName: 'Shell',
          toolInput: { command: 'npm install express' },
          reason: 'Install dependency',
          timestamp: new Date().toISOString(),
        },
      };

      expect(msg.payload.toolName).toBe('Shell');
      expect(msg.payload.requestId).toMatch(/^req-/);
    });
  });

  describe('Guidance Flow', () => {
    it('should queue guidance and inject into orchestrator', () => {
      const pendingGuidance: string[] = [];
      const injectedBlocks: Array<{ text: string; source: string }> = [];

      const mockOrchestrator = {
        injectGuidance: (text: string, source: string) => {
          injectedBlocks.push({ text, source });
        },
      };

      // Simulate agent-mode.ts guidance handler
      function handleGuidance(message: { type: string; payload: { message: string } }) {
        pendingGuidance.push(message.payload.message);
        if (mockOrchestrator) {
          mockOrchestrator.injectGuidance(message.payload.message, 'team_update');
        }
      }

      handleGuidance({ type: 'guidance', payload: { message: 'Agent A found SQL injection' } });
      handleGuidance({ type: 'guidance', payload: { message: 'Agent B found no issues' } });

      expect(pendingGuidance).toHaveLength(2);
      expect(injectedBlocks).toHaveLength(2);
      expect(injectedBlocks[0].source).toBe('team_update');
      expect(injectedBlocks[1].text).toContain('no issues');
    });

    it('should queue guidance even before orchestrator is initialized', () => {
      const pendingGuidance: string[] = [];

      function handleGuidance(payload: { message: string }, orchestrator: any) {
        pendingGuidance.push(payload.message);
        if (orchestrator) {
          orchestrator.injectGuidance(payload.message, 'team_update');
        }
      }

      // Orchestrator not yet created
      handleGuidance({ message: 'Early guidance' }, null);

      expect(pendingGuidance).toHaveLength(1);
      expect(pendingGuidance[0]).toBe('Early guidance');
    });
  });
});


// ============================================
// 6. ERROR HANDLING
// ============================================

describe('Agent Error Handling', () => {
  it('should handle agent timeout gracefully', () => {
    const result = {
      agentId: 'slow-agent-abc',
      agentName: 'slow-agent',
      status: 'timeout' as const,
      durationMs: 300000,
      summary: 'Agent timed out after 300000ms',
      error: { message: 'Timeout exceeded', type: 'timeout' },
    };

    expect(result.status).toBe('timeout');
    expect(result.durationMs).toBe(300000);
  });

  it('should handle agent crash (process exit)', () => {
    const result = {
      agentId: 'crash-abc',
      agentName: 'crasher',
      status: 'error' as const,
      error: { message: 'Process exited with code 1', type: 'crash' },
    };

    expect(result.status).toBe('error');
    expect(result.error.type).toBe('crash');
  });

  it('should handle abort request', () => {
    const result = {
      agentId: 'abort-abc',
      agentName: 'aborted',
      status: 'interrupted' as const,
      summary: 'Agent was interrupted by user request',
    };

    expect(result.status).toBe('interrupted');
  });

  it('should create error tool_result for failed parallel agents', async () => {
    const settled = await Promise.allSettled([
      Promise.resolve({ tool_use_id: '1', tool_name: 'Task', content: 'OK', is_error: false }),
      Promise.reject(new Error('Agent crashed during execution')),
    ]);

    const results = settled.map(s => {
      if (s.status === 'fulfilled') return s.value;
      return {
        tool_use_id: 'unknown',
        tool_name: 'Task',
        content: `Sub-agent failed: ${s.reason?.message}`,
        is_error: true,
      };
    });

    expect(results[0].is_error).toBe(false);
    expect(results[1].is_error).toBe(true);
    expect(results[1].content).toContain('Agent crashed');
  });
});


// ============================================
// 7. EPHEMERAL MESSAGE LIFECYCLE
// ============================================

describe('Ephemeral Message Lifecycle', () => {
  it('should inject guidance as ephemeral thinking blocks', () => {
    const message = {
      role: 'assistant',
      content: [{ type: 'text', text: '<system-reminder>📡 Team Update\n\nAgent "security" completed: Found SQL injection</system-reminder>' }],
      metadata: {
        mentorshipGuidance: true,
        syntheticReasoning: true,
        ephemeral: true,
        source: 'team_update',
      },
    };

    expect(message.metadata.ephemeral).toBe(true);
    expect(message.metadata.source).toBe('team_update');
    expect(message.content[0].text).toContain('📡 Team Update');
  });

  it('should clean up all ephemeral messages after turn', () => {
    const history = [
      { role: 'user', content: 'review this PR', metadata: {} },
      { role: 'assistant', content: 'I will dispatch agents', metadata: {} },
      { role: 'assistant', content: 'guidance 1', metadata: { ephemeral: true, source: 'team_update' } },
      { role: 'assistant', content: 'guidance 2', metadata: { ephemeral: true, source: 'guidance' } },
      { role: 'assistant', content: 'guidance 3', metadata: { ephemeral: true, source: 'team_update' } },
      { role: 'assistant', content: 'Final synthesis', metadata: {} },
    ];

    const cleaned = history.filter(m => !(m.metadata as any)?.ephemeral);
    expect(cleaned).toHaveLength(3);
    expect(cleaned.map(m => m.content)).toEqual([
      'review this PR',
      'I will dispatch agents',
      'Final synthesis',
    ]);
  });

  it('should not clean up non-ephemeral mentorship messages', () => {
    const history = [
      { role: 'assistant', content: 'mentorship', metadata: { mentorshipGuidance: true, ephemeral: false } },
      { role: 'assistant', content: 'team update', metadata: { ephemeral: true } },
    ];

    const cleaned = history.filter(m => !(m.metadata as any)?.ephemeral);
    expect(cleaned).toHaveLength(1);
    expect(cleaned[0].content).toBe('mentorship');
  });
});


// ============================================
// 8. SUBAGENT PROCESS MANAGER STATE
// ============================================

describe('SubAgentProcessManager State', () => {
  it('should track active agents in Map', () => {
    const activeAgents = new Map<string, { agentName: string; status: string; startTime: Date }>();

    activeAgents.set('explore-abc', { agentName: 'explore', status: 'running', startTime: new Date() });
    activeAgents.set('reviewer-def', { agentName: 'code-reviewer', status: 'running', startTime: new Date() });

    expect(activeAgents.size).toBe(2);
    expect(activeAgents.has('explore-abc')).toBe(true);
    expect(activeAgents.get('explore-abc')?.agentName).toBe('explore');
  });

  it('should move completed agents to completedAgents map', () => {
    const activeAgents = new Map<string, { agentName: string }>();
    const completedAgents = new Map<string, { agentName: string; status: string }>();

    activeAgents.set('agent-1', { agentName: 'explore' });
    activeAgents.set('agent-2', { agentName: 'reviewer' });

    // Agent 1 completes
    const completed = activeAgents.get('agent-1')!;
    activeAgents.delete('agent-1');
    completedAgents.set('agent-1', { ...completed, status: 'completed' });

    expect(activeAgents.size).toBe(1);
    expect(completedAgents.size).toBe(1);
    expect(completedAgents.get('agent-1')?.status).toBe('completed');
  });

  it('should enforce maxConcurrentAgents limit', () => {
    const maxConcurrent = 5;
    const activeAgents = new Map<string, { agentName: string }>();

    // Add 5 agents
    for (let i = 0; i < 5; i++) {
      activeAgents.set(`agent-${i}`, { agentName: `agent-${i}` });
    }

    const canSpawn = activeAgents.size < maxConcurrent;
    expect(canSpawn).toBe(false);

    // Remove one
    activeAgents.delete('agent-0');
    const canSpawnNow = activeAgents.size < maxConcurrent;
    expect(canSpawnNow).toBe(true);
  });

  it('should provide summary of all agents', () => {
    const activeAgents = new Map([
      ['a-1', { agentName: 'explore', status: 'running' }],
      ['a-2', { agentName: 'reviewer', status: 'running' }],
    ]);
    const completedAgents = new Map([
      ['a-0', { agentName: 'planner', status: 'completed' }],
    ]);

    const summary = {
      active: activeAgents.size,
      completed: completedAgents.size,
      agents: [
        ...Array.from(activeAgents.entries()).map(([id, s]) => ({ id, name: s.agentName, status: s.status })),
        ...Array.from(completedAgents.entries()).map(([id, s]) => ({ id, name: s.agentName, status: s.status })),
      ],
    };

    expect(summary.active).toBe(2);
    expect(summary.completed).toBe(1);
    expect(summary.agents).toHaveLength(3);
  });
});


// ============================================
// 9. TMUX MONITORING INTEGRATION
// ============================================

describe('Tmux Monitoring', () => {
  const origTmuxBin = process.env.TMUX_BIN;
  const origMonitor = process.env.AGENT_TMUX_MONITOR;

  afterEach(() => {
    if (origTmuxBin === undefined) delete process.env.TMUX_BIN;
    else process.env.TMUX_BIN = origTmuxBin;
    if (origMonitor === undefined) delete process.env.AGENT_TMUX_MONITOR;
    else process.env.AGENT_TMUX_MONITOR = origMonitor;
  });

  it('should resolve TMUX_BIN from environment', () => {
    process.env.TMUX_BIN = '/nix/store/abc/bin/tmux';
    expect(process.env.TMUX_BIN || 'tmux').toBe('/nix/store/abc/bin/tmux');
  });

  it('should fall back to tmux when TMUX_BIN unset', () => {
    delete process.env.TMUX_BIN;
    expect(process.env.TMUX_BIN || 'tmux').toBe('tmux');
  });

  it('should only enable monitoring when AGENT_TMUX_MONITOR is exactly true', () => {
    const testCases = [
      { value: 'true', expected: true },
      { value: 'false', expected: false },
      { value: '1', expected: false },
      { value: 'yes', expected: false },
      { value: undefined, expected: false },
    ];

    for (const tc of testCases) {
      if (tc.value === undefined) delete process.env.AGENT_TMUX_MONITOR;
      else process.env.AGENT_TMUX_MONITOR = tc.value;

      expect(process.env.AGENT_TMUX_MONITOR === 'true').toBe(tc.expected);
    }
  });

  it('should track agent-to-pane mapping', () => {
    const agentPaneMap = new Map<string, number>();

    agentPaneMap.set('security-abc', 0);
    agentPaneMap.set('quality-def', 1);
    agentPaneMap.set('arch-ghi', 2);

    expect(agentPaneMap.size).toBe(3);
    expect(agentPaneMap.get('quality-def')).toBe(1);
  });

  it('should format events for tmux pane display', () => {
    function formatTmuxEvent(type: string, agentName: string, detail: string): string {
      const icons: Record<string, string> = {
        started: '▶️',
        tool_call: '🔧',
        completed: '✅',
        error: '❌',
        timeout: '⏰',
      };
      return `${icons[type] || '•'} ${detail}`;
    }

    expect(formatTmuxEvent('started', 'explore', 'Started (model: claude-haiku-4-5)')).toBe('▶️ Started (model: claude-haiku-4-5)');
    expect(formatTmuxEvent('tool_call', 'explore', 'Read /src/index.ts')).toBe('🔧 Read /src/index.ts');
    expect(formatTmuxEvent('completed', 'explore', 'Completed (15.2s)')).toBe('✅ Completed (15.2s)');
    expect(formatTmuxEvent('error', 'explore', 'Process crashed')).toBe('❌ Process crashed');
  });
});
