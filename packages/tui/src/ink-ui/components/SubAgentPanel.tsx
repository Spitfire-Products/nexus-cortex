/**
 * SubAgentPanel - Compact display for parallel sub-agent activity
 *
 * Claude Code style display:
 * ● Task(agent name - task summary)
 *   ⎿  > current action/output
 *      … +N lines (ctrl+o to expand)
 */

import React from 'react';
import { Box, Text } from 'ink';
import { Colors } from '@nexus-cortex/cli/dist/themes/colors.js';

/**
 * Status of a sub-agent
 */
export type SubAgentStatus = 'starting' | 'running' | 'completed' | 'error' | 'interrupted' | 'timeout';

/**
 * Tool call info for display
 */
export interface SubAgentToolCall {
  toolName: string;
  summary: string;
  timestamp: Date;
}

/**
 * State of a single sub-agent for UI display
 */
export interface SubAgentState {
  agentId: string;
  agentName: string;
  model: string;
  status: SubAgentStatus;
  startTime: Date;
  turnNumber: number;
  totalTokens: number;
  elapsedMs: number;
  recentToolCalls: SubAgentToolCall[];
  lastResponse?: string;
  error?: string;
}

/**
 * Props for SubAgentPanel
 */
export interface SubAgentPanelProps {
  /** Map of active sub-agents by ID */
  agents: Map<string, SubAgentState>;
  /** Maximum tool calls to show per agent */
  maxToolCalls?: number;
  /** Terminal width for proper display */
  terminalWidth?: number;
}

/**
 * Get status indicator
 */
function getStatusIndicator(status: SubAgentStatus): { icon: string; color: string } {
  switch (status) {
    case 'starting':
      return { icon: '○', color: Colors.AccentYellow };
    case 'running':
      return { icon: '●', color: Colors.AccentCyan };
    case 'completed':
      return { icon: '●', color: Colors.AccentGreen };
    case 'error':
      return { icon: '●', color: Colors.AccentRed };
    case 'interrupted':
      return { icon: '○', color: Colors.AccentYellow };
    case 'timeout':
      return { icon: '○', color: Colors.AccentYellow };
    default:
      return { icon: '○', color: Colors.Gray };
  }
}

/**
 * Format elapsed time compactly
 */
function formatElapsed(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Single sub-agent line item display
 */
const SubAgentItem: React.FC<{
  agent: SubAgentState;
  maxToolCalls?: number;
}> = ({ agent, maxToolCalls = 2 }) => {
  const { icon, color } = getStatusIndicator(agent.status);

  // Get the most recent tool calls
  const recentCalls = agent.recentToolCalls.slice(-maxToolCalls);
  const hiddenCount = Math.max(0, agent.recentToolCalls.length - maxToolCalls);

  // Build the header: ● Task(agent name)
  const isActive = agent.status === 'starting' || agent.status === 'running';

  return (
    <Box flexDirection="column" marginBottom={0}>
      {/* Header line: ● Task(agent name - task) */}
      <Box>
        <Text color={color}>{icon} </Text>
        <Text color={Colors.AccentCyan}>Task</Text>
        <Text color={Colors.Gray}>(</Text>
        <Text color={Colors.text}>{agent.agentName}</Text>
        <Text color={Colors.Gray}>)</Text>
        {isActive && (
          <Text color={Colors.Gray}> {formatElapsed(agent.elapsedMs)}</Text>
        )}
        {agent.status === 'completed' && (
          <Text color={Colors.AccentGreen}> ✓</Text>
        )}
        {agent.status === 'error' && (
          <Text color={Colors.AccentRed}> ✗</Text>
        )}
      </Box>

      {/* Current activity with ⎿ connector */}
      {recentCalls.length > 0 && (
        <Box flexDirection="column" marginLeft={2}>
          {recentCalls.map((tc, idx) => (
            <Box key={idx}>
              <Text color={Colors.Gray}>{idx === 0 ? '⎿  ' : ' '}</Text>
              <Text color={Colors.AccentCyan}>&gt; </Text>
              <Text color={Colors.text}>{tc.toolName}</Text>
              {tc.summary && (
                <Text color={Colors.Gray}> {tc.summary}</Text>
              )}
            </Box>
          ))}

          {/* Hidden lines indicator */}
          {hiddenCount > 0 && (
            <Box marginLeft={3}>
              <Text color={Colors.Gray}>… +{hiddenCount} actions</Text>
            </Box>
          )}
        </Box>
      )}

      {/* Error message */}
      {agent.error && (
        <Box marginLeft={2}>
          <Text color={Colors.Gray}>⎿  </Text>
          <Text color={Colors.AccentRed}>{agent.error}</Text>
        </Box>
      )}

      {/* Final response snippet for completed agents */}
      {agent.status === 'completed' && agent.lastResponse && (
        <Box marginLeft={2}>
          <Text color={Colors.Gray}>⎿  </Text>
          <Text color={Colors.Gray} wrap="truncate-end">
            {agent.lastResponse.slice(0, 60)}{agent.lastResponse.length > 60 ? '…' : ''}
          </Text>
        </Box>
      )}
    </Box>
  );
};

/**
 * Main SubAgentPanel component
 *
 * Displays all active sub-agents in Claude Code style
 */
export const SubAgentPanel: React.FC<SubAgentPanelProps> = ({
  agents,
  maxToolCalls = 2,
}) => {
  const agentList = Array.from(agents.values());

  if (agentList.length === 0) {
    return null;
  }

  // Sort: active agents first, then completed
  const sortedAgents = agentList.sort((a, b) => {
    const aActive = a.status === 'starting' || a.status === 'running';
    const bActive = b.status === 'starting' || b.status === 'running';
    if (aActive && !bActive) return -1;
    if (!aActive && bActive) return 1;
    return 0;
  });

  return (
    <Box flexDirection="column" marginY={1}>
      {sortedAgents.map(agent => (
        <SubAgentItem
          key={agent.agentId}
          agent={agent}
          maxToolCalls={maxToolCalls}
        />
      ))}
    </Box>
  );
};

/**
 * Hook to manage sub-agent state from IPC events
 */
export function createSubAgentStateManager() {
  const agents = new Map<string, SubAgentState>();

  return {
    agents,

    handleStarted(payload: { agentId: string; agentName: string; model: string }) {
      agents.set(payload.agentId, {
        agentId: payload.agentId,
        agentName: payload.agentName,
        model: payload.model,
        status: 'running',
        startTime: new Date(),
        turnNumber: 0,
        totalTokens: 0,
        elapsedMs: 0,
        recentToolCalls: [],
      });
    },

    handleProgress(payload: { agentId: string; turnNumber: number; totalTokens: number; elapsedMs: number }) {
      const agent = agents.get(payload.agentId);
      if (agent) {
        agent.turnNumber = payload.turnNumber;
        agent.totalTokens = payload.totalTokens;
        agent.elapsedMs = payload.elapsedMs;
      }
    },

    handleToolCall(payload: { agentId: string; toolName: string; toolInput: Record<string, unknown> }) {
      const agent = agents.get(payload.agentId);
      if (agent) {
        // Build compact summary from input
        let summary = '';
        if (payload.toolInput.file_path) {
          summary = String(payload.toolInput.file_path);
        } else if (payload.toolInput.command) {
          const cmd = String(payload.toolInput.command);
          summary = cmd.length > 40 ? cmd.slice(0, 40) + '…' : cmd;
        } else if (payload.toolInput.pattern) {
          summary = `"${payload.toolInput.pattern}"`;
        }

        agent.recentToolCalls.push({
          toolName: payload.toolName,
          summary,
          timestamp: new Date(),
        });

        // Keep only last 10
        if (agent.recentToolCalls.length > 10) {
          agent.recentToolCalls = agent.recentToolCalls.slice(-10);
        }
      }
    },

    handleText(payload: { agentId: string; text: string; isFinal: boolean }) {
      const agent = agents.get(payload.agentId);
      if (agent && payload.isFinal) {
        agent.lastResponse = payload.text;
      }
    },

    handleCompleted(payload: { agentId: string; result: { status: string; durationMs: number; turnCount: number } }) {
      const agent = agents.get(payload.agentId);
      if (agent) {
        agent.status = payload.result.status as SubAgentStatus;
        agent.elapsedMs = payload.result.durationMs;
        agent.turnNumber = payload.result.turnCount;
      }
    },

    handleError(payload: { agentId: string; agentName: string; error: Error }) {
      const agent = agents.get(payload.agentId);
      if (agent) {
        agent.status = 'error';
        agent.error = payload.error.message;
      }
    },

    clear() {
      agents.clear();
    },

    removeCompleted() {
      for (const [id, agent] of agents) {
        if (agent.status !== 'starting' && agent.status !== 'running') {
          agents.delete(id);
        }
      }
    },
  };
}

export default SubAgentPanel;
