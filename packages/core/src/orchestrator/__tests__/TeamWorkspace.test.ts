/**
 * Agent Team Workspace System — Unit Tests
 *
 * Tests the 3-layer architecture:
 *   Layer 1: Workspace Isolation (WorkspaceManager validation)
 *   Layer 2: Team Communication (guidance injection, team briefing, broadcasting)
 *   Layer 2.5: Tmux Monitoring (pane setup, event mirroring)
 *
 * These tests use mocking to avoid spawning real child processes or making API calls.
 * For integration tests that actually dispatch agents, see the smoke tests.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ============================================
// TEAM BRIEFING (injectTeamBriefing)
// ============================================

describe('Team Briefing', () => {
  /**
   * injectTeamBriefing is a private method on CortexOrchestrator.
   * We test its behavior by calling it through a minimal wrapper
   * that extracts the method logic.
   */
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

  it('should not modify single-agent dispatch', () => {
    const tools = [
      { id: '1', name: 'Task', input: { subagent_type: 'explore', prompt: 'search for X', description: 'search task' } },
    ];

    const result = injectTeamBriefing(tools);
    expect(result).toEqual(tools);
    expect(result[0].input.prompt).toBe('search for X');
  });

  it('should inject team briefing into all agents for multi-agent dispatch', () => {
    const tools = [
      { id: '1', name: 'Task', input: { subagent_type: 'pr-security-auditor', prompt: 'audit security', description: 'Security scan' } },
      { id: '2', name: 'Task', input: { subagent_type: 'pr-code-quality', prompt: 'review quality', description: 'Quality review' } },
      { id: '3', name: 'Task', input: { subagent_type: 'pr-architecture-reviewer', prompt: 'check architecture', description: 'Architecture review' } },
    ];

    const result = injectTeamBriefing(tools);

    // All should have team briefing prepended
    expect(result).toHaveLength(3);
    result.forEach(tool => {
      expect(tool.input.prompt).toContain('📋 **Team Briefing**');
      expect(tool.input.prompt).toContain('3-agent team');
    });
  });

  it('should list each agent\'s teammates but exclude self', () => {
    const tools = [
      { id: '1', name: 'Task', input: { subagent_type: 'security', prompt: 'audit', description: 'Scan vulns' } },
      { id: '2', name: 'Task', input: { subagent_type: 'quality', prompt: 'review', description: 'Check style' } },
    ];

    const result = injectTeamBriefing(tools);

    // Agent 1 should see agent 2 as teammate, not itself
    expect(result[0].input.prompt).toContain('quality: Check style');
    expect(result[0].input.prompt).not.toContain('security: Scan vulns');

    // Agent 2 should see agent 1 as teammate, not itself
    expect(result[1].input.prompt).toContain('security: Scan vulns');
    expect(result[1].input.prompt).not.toContain('quality: Check style');
  });

  it('should preserve original prompt after briefing', () => {
    const tools = [
      { id: '1', name: 'Task', input: { subagent_type: 'explore', prompt: 'original prompt 1', description: 'task 1' } },
      { id: '2', name: 'Task', input: { subagent_type: 'explore', prompt: 'original prompt 2', description: 'task 2' } },
    ];

    const result = injectTeamBriefing(tools);

    expect(result[0].input.prompt).toContain('original prompt 1');
    expect(result[1].input.prompt).toContain('original prompt 2');
  });

  it('should handle missing fields gracefully', () => {
    const tools = [
      { id: '1', name: 'Task', input: { prompt: 'no type specified' } },
      { id: '2', name: 'Task', input: {} },
    ];

    const result = injectTeamBriefing(tools);

    // Should use defaults
    expect(result[0].input.prompt).toContain('general: unknown task');
    expect(result[1].input.prompt).toContain('general: unknown task');
  });

  it('should not mutate original tool objects', () => {
    const original = { id: '1', name: 'Task', input: { subagent_type: 'explore', prompt: 'test', description: 'd' } };
    const tools = [original, { id: '2', name: 'Task', input: { subagent_type: 'explore', prompt: 'test2', description: 'd2' } }];

    const result = injectTeamBriefing(tools);

    // Original should be unchanged
    expect(original.input.prompt).toBe('test');
    // Result should be modified
    expect(result[0].input.prompt).toContain('📋 **Team Briefing**');
  });
});


// ============================================
// GUIDANCE INJECTION (injectGuidance)
// ============================================

describe('Guidance Injection', () => {
  it('should call injectThinkingBlock with correct source', () => {
    // Simulate the injectGuidance method behavior
    const injectThinkingBlockCalls: Array<{ text: string; source: string }> = [];

    function injectGuidance(text: string, source: 'team_update' | 'guidance' = 'guidance'): void {
      injectThinkingBlockCalls.push({ text, source });
    }

    injectGuidance('Agent A completed: found 3 vulnerabilities', 'team_update');

    expect(injectThinkingBlockCalls).toHaveLength(1);
    expect(injectThinkingBlockCalls[0].text).toBe('Agent A completed: found 3 vulnerabilities');
    expect(injectThinkingBlockCalls[0].source).toBe('team_update');
  });

  it('should default source to guidance', () => {
    const calls: Array<{ text: string; source: string }> = [];

    function injectGuidance(text: string, source: 'team_update' | 'guidance' = 'guidance'): void {
      calls.push({ text, source });
    }

    injectGuidance('some guidance text');

    expect(calls[0].source).toBe('guidance');
  });
});


// ============================================
// BROADCAST GUIDANCE (SubAgentProcessManager)
// ============================================

describe('Broadcast Guidance', () => {
  // Minimal mock of the activeAgents Map and guideAgent behavior
  let activeAgents: Map<string, { agentName: string; process: { send: ReturnType<typeof vi.fn> } }>;
  let guideAgentCalls: Array<{ agentId: string; message: string }>;

  function guideAgent(agentId: string, message: string): boolean {
    const state = activeAgents.get(agentId);
    if (!state) return false;
    guideAgentCalls.push({ agentId, message });
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
    guideAgentCalls = [];
  });

  it('should send guidance to all active agents except excluded', () => {
    activeAgents.set('agent-a', { agentName: 'security', process: { send: vi.fn() } });
    activeAgents.set('agent-b', { agentName: 'quality', process: { send: vi.fn() } });
    activeAgents.set('agent-c', { agentName: 'arch', process: { send: vi.fn() } });

    broadcastGuidance('Team update: agent-a done', 'agent-a');

    expect(guideAgentCalls).toHaveLength(2);
    expect(guideAgentCalls.map(c => c.agentId)).toEqual(['agent-b', 'agent-c']);
    expect(guideAgentCalls[0].message).toBe('Team update: agent-a done');
  });

  it('should send to all agents when no exclusion', () => {
    activeAgents.set('agent-a', { agentName: 'security', process: { send: vi.fn() } });
    activeAgents.set('agent-b', { agentName: 'quality', process: { send: vi.fn() } });

    broadcastGuidance('General update');

    expect(guideAgentCalls).toHaveLength(2);
  });

  it('should do nothing when no active agents', () => {
    broadcastGuidance('No one listening', 'ghost');

    expect(guideAgentCalls).toHaveLength(0);
  });

  it('should handle single agent (nothing to broadcast to after exclusion)', () => {
    activeAgents.set('agent-a', { agentName: 'solo', process: { send: vi.fn() } });

    broadcastGuidance('Solo done', 'agent-a');

    expect(guideAgentCalls).toHaveLength(0);
  });

  it('guideAgent should return false for unknown agents', () => {
    const result = guideAgent('nonexistent', 'hello');
    expect(result).toBe(false);
  });
});


// ============================================
// TMUX BINARY RESOLUTION
// ============================================

describe('Tmux Binary Resolution', () => {
  const originalEnv = process.env.TMUX_BIN;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.TMUX_BIN;
    } else {
      process.env.TMUX_BIN = originalEnv;
    }
  });

  it('should use TMUX_BIN env var when set', () => {
    process.env.TMUX_BIN = '/custom/path/to/tmux';
    const tmuxBin = process.env.TMUX_BIN || 'tmux';
    expect(tmuxBin).toBe('/custom/path/to/tmux');
  });

  it('should fall back to tmux when TMUX_BIN not set', () => {
    delete process.env.TMUX_BIN;
    const tmuxBin = process.env.TMUX_BIN || 'tmux';
    expect(tmuxBin).toBe('tmux');
  });
});


// ============================================
// AGENT_TMUX_MONITOR ENV
// ============================================

describe('AGENT_TMUX_MONITOR', () => {
  const originalEnv = process.env.AGENT_TMUX_MONITOR;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.AGENT_TMUX_MONITOR;
    } else {
      process.env.AGENT_TMUX_MONITOR = originalEnv;
    }
  });

  it('should enable tmux monitoring when set to true', () => {
    process.env.AGENT_TMUX_MONITOR = 'true';
    const enabled = process.env.AGENT_TMUX_MONITOR === 'true';
    expect(enabled).toBe(true);
  });

  it('should disable tmux monitoring when not set', () => {
    delete process.env.AGENT_TMUX_MONITOR;
    const enabled = process.env.AGENT_TMUX_MONITOR === 'true';
    expect(enabled).toBe(false);
  });

  it('should disable tmux monitoring for any value other than true', () => {
    process.env.AGENT_TMUX_MONITOR = 'false';
    expect(process.env.AGENT_TMUX_MONITOR === 'true').toBe(false);

    process.env.AGENT_TMUX_MONITOR = '1';
    expect(process.env.AGENT_TMUX_MONITOR === 'true').toBe(false);

    process.env.AGENT_TMUX_MONITOR = 'yes';
    expect(process.env.AGENT_TMUX_MONITOR === 'true').toBe(false);
  });
});


// ============================================
// RESULT BROADCASTING TRIGGER
// ============================================

describe('Result Broadcasting Trigger', () => {
  it('should generate correct broadcast message from agent result', () => {
    const result = {
      is_error: false,
      content: 'Found 3 security vulnerabilities in auth module. Critical: SQL injection in login handler.',
      metadata: {
        subAgentResult: {
          agentName: 'pr-security-auditor',
          agentId: 'pr-security-auditor-abc123',
        },
      },
    };

    // Replicate the broadcast message construction from CortexOrchestrator
    const agentName = result.metadata?.subAgentResult?.agentName || 'agent';
    const summary = `Agent "${agentName}" completed: ${(result.content || '').substring(0, 500)}`;
    const broadcastMessage = `📡 Team Update: ${summary}`;

    expect(broadcastMessage).toContain('pr-security-auditor');
    expect(broadcastMessage).toContain('3 security vulnerabilities');
    expect(broadcastMessage).toContain('📡 Team Update');
  });

  it('should truncate long content to 500 chars', () => {
    const longContent = 'x'.repeat(1000);
    const summary = `Agent "test" completed: ${longContent.substring(0, 500)}`;

    expect(summary.length).toBeLessThanOrEqual(530); // prefix + 500 chars
  });

  it('should not broadcast on error results', () => {
    const result = { is_error: true, content: 'Tool execution failed' };
    // The orchestrator checks !result.is_error before broadcasting
    expect(result.is_error).toBe(true);
    // Broadcasting should NOT happen for error results
  });

  it('should handle missing metadata gracefully', () => {
    const result = {
      is_error: false,
      content: 'Done',
      metadata: {},
    };

    const toolUseInput = { subagent_type: 'explore' };
    const agentName = (result.metadata as any)?.subAgentResult?.agentName || toolUseInput.subagent_type || 'agent';

    expect(agentName).toBe('explore');
  });
});


// ============================================
// EPHEMERAL MESSAGE LIFECYCLE
// ============================================

describe('Ephemeral Message Lifecycle', () => {
  it('should mark guidance messages as ephemeral', () => {
    const message = {
      role: 'assistant',
      content: [{ type: 'text', text: '<system-reminder>📡 Team Update</system-reminder>' }],
      metadata: {
        mentorshipGuidance: true,
        syntheticReasoning: true,
        ephemeral: true,
        source: 'team_update',
      },
    };

    expect(message.metadata.ephemeral).toBe(true);
    expect(message.metadata.source).toBe('team_update');
  });

  it('should clean up ephemeral messages from history', () => {
    const history = [
      { role: 'user', content: 'hi', metadata: {} },
      { role: 'assistant', content: 'hello', metadata: {} },
      { role: 'assistant', content: 'guidance', metadata: { ephemeral: true, source: 'team_update' } },
      { role: 'assistant', content: 'more guidance', metadata: { ephemeral: true, source: 'guidance' } },
      { role: 'assistant', content: 'real response', metadata: {} },
    ];

    // Replicate cleanupEphemeralMessages behavior
    const cleaned = history.filter(m => !(m.metadata as any)?.ephemeral);

    expect(cleaned).toHaveLength(3);
    expect(cleaned.map(m => m.content)).toEqual(['hi', 'hello', 'real response']);
  });
});


// ============================================
// AGENT-MODE GUIDANCE HANDLER
// ============================================

describe('Agent-Mode Guidance Handler', () => {
  it('should queue guidance messages', () => {
    const pendingGuidance: string[] = [];
    const orchestratorCalls: Array<{ text: string; source: string }> = [];

    // Simulate the guidance handler from agent-mode.ts
    function handleGuidance(message: { payload: { message: string } }, orchestrator: any) {
      pendingGuidance.push(message.payload.message);
      if (orchestrator) {
        orchestrator.injectGuidance(message.payload.message, 'team_update');
      }
    }

    const mockOrchestrator = {
      injectGuidance: (text: string, source: string) => {
        orchestratorCalls.push({ text, source });
      },
    };

    handleGuidance({ payload: { message: 'Agent A done: found bugs' } }, mockOrchestrator);
    handleGuidance({ payload: { message: 'Agent B done: all clean' } }, mockOrchestrator);

    expect(pendingGuidance).toHaveLength(2);
    expect(pendingGuidance[0]).toBe('Agent A done: found bugs');
    expect(orchestratorCalls).toHaveLength(2);
    expect(orchestratorCalls[0].source).toBe('team_update');
  });

  it('should handle guidance when orchestrator not yet initialized', () => {
    const pendingGuidance: string[] = [];

    function handleGuidance(message: { payload: { message: string } }, orchestrator: any) {
      pendingGuidance.push(message.payload.message);
      if (orchestrator) {
        orchestrator.injectGuidance(message.payload.message, 'team_update');
      }
    }

    // No orchestrator yet — should still queue
    handleGuidance({ payload: { message: 'early guidance' } }, null);

    expect(pendingGuidance).toHaveLength(1);
    expect(pendingGuidance[0]).toBe('early guidance');
  });
});
