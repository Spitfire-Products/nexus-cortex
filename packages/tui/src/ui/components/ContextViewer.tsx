/**
 * ContextViewer - Interactive context budget viewer
 *
 * View context budget usage, compaction boundaries, and token savings
 * in an interactive terminal UI.
 */

import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import Spinner from 'ink-spinner';
import { CortexClient } from '@nexus-cortex/cli/dist/client/CortexClient.js';

interface ContextStatus {
  model: {
    id: string;
    name: string;
    contextWindow: number;
  };
  budget: {
    maxTokens: number;
    reservedForOutput: number;
    availableForInput: number;
    systemMessageAllocation: number;
  };
  usage: {
    estimatedTokens: number;
    utilization: number;
    remaining: number;
  };
}

interface CompactionBoundary {
  turn: number;
  timestamp: string;
  tokensSaved: number;
}

interface ContextViewerProps {
  /** Session ID to view context for */
  sessionId: string;
  /** Server URL */
  serverUrl?: string;
  /** Callback when user exits viewer */
  onExit?: () => void;
}

export const ContextViewer: React.FC<ContextViewerProps> = ({
  sessionId,
  serverUrl = 'http://localhost:4000',
  onExit,
}) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [contextStatus, setContextStatus] = useState<ContextStatus | null>(null);
  const [boundaries, setBoundaries] = useState<CompactionBoundary[]>([]);
  const [boundariesLoading, setBoundariesLoading] = useState(false);

  // Handle keyboard input
  useInput((input, key) => {
    if (key.escape || input === 'q') {
      onExit?.();
    }
    if (key.ctrl && input === 'c') {
      onExit?.();
    }
    if (input === 'r') {
      // Refresh data
      fetchContextStatus();
      fetchBoundaries();
    }
  });

  const fetchContextStatus = async () => {
    setLoading(true);
    setError(null);
    const client = new CortexClient(serverUrl);

    try {
      const response = await client.get(`/sessions/${sessionId}/context`);
      setContextStatus(response);
      setLoading(false);
    } catch (err: any) {
      setError(err.message);
      setLoading(false);
    }
  };

  const fetchBoundaries = async () => {
    setBoundariesLoading(true);
    const client = new CortexClient(serverUrl);

    try {
      const response = await client.get(`/sessions/${sessionId}/compaction/boundaries`);
      setBoundaries(response.boundaries || []);
      setBoundariesLoading(false);
    } catch (err: any) {
      // Silently fail for boundaries (not critical)
      setBoundaries([]);
      setBoundariesLoading(false);
    }
  };

  // Initial load
  useEffect(() => {
    fetchContextStatus();
    fetchBoundaries();
  }, [sessionId, serverUrl]);

  if (loading) {
    return (
      <Box padding={1}>
        <Text color="cyan"><Spinner type="dots" /></Text>
        <Text> Loading context status...</Text>
      </Box>
    );
  }

  if (error) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="red">✗ Error: {error}</Text>
        <Box marginTop={1}>
          <Text dimColor>Press Q or ESC to exit</Text>
        </Box>
      </Box>
    );
  }

  if (!contextStatus) return null;

  const utilization = contextStatus.usage.utilization;
  const utilizationColor =
    utilization > 90 ? 'red' :
    utilization > 70 ? 'yellow' :
    'green';

  // Calculate progress bar
  const barWidth = 50;
  const filledWidth = Math.round((utilization / 100) * barWidth);
  const emptyWidth = barWidth - filledWidth;
  const progressBar = '█'.repeat(filledWidth) + '░'.repeat(emptyWidth);

  const totalSaved = boundaries.reduce((sum, b) => sum + b.tokensSaved, 0);

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan"> Context Budget Viewer</Text>
      </Box>

      <Box marginBottom={1}>
        <Text dimColor>Session: {sessionId}</Text>
      </Box>

      {/* Model Information */}
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color="white">Model</Text>
        <Box marginLeft={2} flexDirection="column">
          <Text>{contextStatus.model.name}</Text>
          <Text dimColor>{contextStatus.model.id}</Text>
          <Text>
            <Text color="green">Context Window: </Text>
            <Text>{contextStatus.model.contextWindow.toLocaleString()} tokens</Text>
          </Text>
        </Box>
      </Box>

      {/* Budget Allocation */}
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color="white">Budget Allocation</Text>
        <Box marginLeft={2} flexDirection="column">
          <Text>
            <Text color="green">Max Tokens:          </Text>
            <Text color="cyan">{contextStatus.budget.maxTokens.toLocaleString()}</Text>
          </Text>
          <Text>
            <Text color="green">Reserved for Output: </Text>
            <Text dimColor>{contextStatus.budget.reservedForOutput.toLocaleString()}</Text>
          </Text>
          <Text>
            <Text color="green">Available for Input: </Text>
            <Text dimColor>{contextStatus.budget.availableForInput.toLocaleString()}</Text>
          </Text>
          <Text>
            <Text color="green">System Messages:     </Text>
            <Text dimColor>{contextStatus.budget.systemMessageAllocation.toLocaleString()}</Text>
          </Text>
        </Box>
      </Box>

      {/* Current Usage */}
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color="white">Current Usage</Text>
        <Box marginLeft={2} flexDirection="column">
          <Text>
            <Text color="green">Estimated Tokens: </Text>
            <Text color="cyan">{contextStatus.usage.estimatedTokens.toLocaleString()}</Text>
          </Text>
          <Text>
            <Text color="green">Utilization:      </Text>
            <Text color={utilizationColor}>{utilization.toFixed(1)}%</Text>
          </Text>
          <Text>
            <Text color="green">Remaining:        </Text>
            <Text dimColor>{contextStatus.usage.remaining.toLocaleString()} tokens</Text>
          </Text>
        </Box>
      </Box>

      {/* Progress Bar */}
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color="white">Utilization</Text>
        <Box marginLeft={2}>
          <Text color={utilizationColor}>{progressBar}</Text>
        </Box>
      </Box>

      {/* Compaction Boundaries */}
      {boundariesLoading ? (
        <Box>
          <Text color="cyan"><Spinner type="dots" /></Text>
          <Text> Loading compaction history...</Text>
        </Box>
      ) : (
        <Box flexDirection="column" marginBottom={1}>
          <Text bold color="white">
            Compaction History ({boundaries.length} boundaries)
          </Text>
          {boundaries.length > 0 ? (
            <>
              <Box marginLeft={2} flexDirection="column">
                <Text>
                  <Text color="green">Total Tokens Saved: </Text>
                  <Text color="cyan">{totalSaved.toLocaleString()}</Text>
                </Text>
              </Box>
              <Box marginTop={1} marginLeft={2} flexDirection="column">
                {boundaries.slice(0, 5).map((boundary, index) => (
                  <Box key={index} flexDirection="column" marginBottom={1}>
                    <Text>
                      <Text color="green">Boundary {index + 1}: </Text>
                      <Text>Turn {boundary.turn}</Text>
                    </Text>
                    <Box marginLeft={2}>
                      <Text dimColor>{boundary.timestamp}</Text>
                    </Box>
                    <Box marginLeft={2}>
                      <Text color="yellow">Saved: {boundary.tokensSaved.toLocaleString()} tokens</Text>
                    </Box>
                  </Box>
                ))}
                {boundaries.length > 5 && (
                  <Text dimColor>... and {boundaries.length - 5} more</Text>
                )}
              </Box>
            </>
          ) : (
            <Box marginLeft={2}>
              <Text dimColor>No compactions yet</Text>
            </Box>
          )}
        </Box>
      )}

      <Box marginTop={1} flexDirection="column">
        <Text dimColor>Available commands:</Text>
        <Text dimColor>  cortex context compact {sessionId} - Trigger compaction</Text>
        <Text dimColor>  cortex context strategy {sessionId} - View compaction strategy</Text>
      </Box>

      <Box marginTop={2}>
        <Text dimColor>Press R to refresh, Q or ESC to exit, Ctrl+C to quit</Text>
      </Box>
    </Box>
  );
};
