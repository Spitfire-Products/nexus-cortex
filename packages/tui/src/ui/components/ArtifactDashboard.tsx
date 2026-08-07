/**
 * ArtifactDashboard - Interactive artifact viewer
 *
 * View and manage running artifacts (web apps, dashboards, etc.)
 * in an interactive terminal UI.
 */

import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import SelectInput from 'ink-select-input';
import Spinner from 'ink-spinner';
import { CortexClient } from '@nexus-cortex/cli/dist/client/CortexClient.js';

type ViewMode = 'list' | 'detail';

interface Artifact {
  id: string;
  name?: string;
  type?: string;
  mode?: string;
  status: 'running' | 'stopped';
  port?: number;
  url?: string;
  pid?: number;
  uptime?: string;
  created?: string;
  resources?: {
    cpu?: string;
    memory?: string;
    disk?: string;
  };
  env?: string;
}

interface ArtifactDashboardProps {
  /** Server URL */
  serverUrl?: string;
  /** Callback when user exits dashboard */
  onExit?: () => void;
}

export const ArtifactDashboard: React.FC<ArtifactDashboardProps> = ({
  serverUrl = 'http://localhost:4000',
  onExit,
}) => {
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [selectedArtifact, setSelectedArtifact] = useState<Artifact | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Handle keyboard input
  useInput((input, key) => {
    if (key.escape || (input === 'q' && viewMode === 'list')) {
      onExit?.();
    }
    if ((key.escape || input === 'b') && viewMode === 'detail') {
      setViewMode('list');
      setSelectedArtifact(null);
      setError(null);
    }
    if (key.ctrl && input === 'c') {
      onExit?.();
    }
    if (input === 'r' && viewMode === 'list') {
      // Refresh list
      fetchArtifacts();
    }
  });

  const fetchArtifacts = async () => {
    setLoading(true);
    setError(null);
    const client = new CortexClient(serverUrl);

    try {
      const response = await client.get('/artifact/list');
      setArtifacts(response.artifacts || []);
      setLoading(false);
    } catch (err: any) {
      setError(err.message);
      setLoading(false);
    }
  };

  const fetchArtifactDetail = async (id: string) => {
    setDetailLoading(true);
    setError(null);
    const client = new CortexClient(serverUrl);

    try {
      const response = await client.get(`/artifact/status/${id}`);
      setSelectedArtifact(response);
      setDetailLoading(false);
    } catch (err: any) {
      setError(err.message);
      setDetailLoading(false);
    }
  };

  // Initial load
  useEffect(() => {
    fetchArtifacts();
  }, [serverUrl]);

  const handleArtifactSelect = (item: { value: string; label: string }) => {
    const artifact = artifacts.find(a => a.id === item.value);
    if (artifact) {
      setViewMode('detail');
      fetchArtifactDetail(artifact.id);
    }
  };

  const renderList = () => {
    if (loading) {
      return (
        <Box>
          <Text color="cyan"><Spinner type="dots" /></Text>
          <Text> Loading artifacts...</Text>
        </Box>
      );
    }

    if (artifacts.length === 0) {
      return (
        <Box flexDirection="column">
          <Text dimColor>No artifacts found.</Text>
          <Box marginTop={1}>
            <Text dimColor>Create artifacts through chat or use artifact commands.</Text>
          </Box>
        </Box>
      );
    }

    const runningCount = artifacts.filter(a => a.status === 'running').length;
    const stoppedCount = artifacts.length - runningCount;

    return (
      <Box flexDirection="column">
        <Box marginBottom={1}>
          <Text bold color="cyan"> Artifacts Dashboard ({artifacts.length} total)</Text>
        </Box>

        <Box marginBottom={1} flexDirection="column">
          <Text>
            <Text color="green">Running: {runningCount}</Text>
            <Text>  </Text>
            <Text dimColor>Stopped: {stoppedCount}</Text>
          </Text>
        </Box>

        <Text dimColor>Select an artifact to view details:</Text>
        <Box marginTop={1}>
          <SelectInput
            items={artifacts.map(artifact => ({
              label: `${artifact.status === 'running' ? '● ' : '○ '}${artifact.name || artifact.id} ${artifact.type ? `(${artifact.type})` : ''} ${artifact.port ? `:${artifact.port}` : ''}`,
              value: artifact.id
            }))}
            onSelect={handleArtifactSelect}
          />
        </Box>

        <Box marginTop={2}>
          <Text dimColor>Press R to refresh, Q to exit</Text>
        </Box>
      </Box>
    );
  };

  const renderDetail = () => {
    if (detailLoading) {
      return (
        <Box>
          <Text color="cyan"><Spinner type="dots" /></Text>
          <Text> Loading artifact details...</Text>
        </Box>
      );
    }

    if (!selectedArtifact) return null;

    const isRunning = selectedArtifact.status === 'running';

    return (
      <Box flexDirection="column">
        <Box marginBottom={1}>
          <Text bold color="cyan">
             {selectedArtifact.name || selectedArtifact.id}
          </Text>
        </Box>

        {/* Basic Information */}
        <Box flexDirection="column" marginBottom={1}>
          <Text bold color="white">Basic Information</Text>
          <Box marginLeft={2} flexDirection="column">
            <Text>
              <Text color="green">ID:     </Text>
              <Text dimColor>{selectedArtifact.id}</Text>
            </Text>
            {selectedArtifact.type && (
              <Text>
                <Text color="green">Type:   </Text>
                <Text>{selectedArtifact.type}</Text>
              </Text>
            )}
            {selectedArtifact.mode && (
              <Text>
                <Text color="green">Mode:   </Text>
                <Text>{selectedArtifact.mode}</Text>
              </Text>
            )}
            <Text>
              <Text color="green">Status: </Text>
              <Text color={isRunning ? 'green' : 'red'}>
                {selectedArtifact.status}
              </Text>
            </Text>
            {selectedArtifact.created && (
              <Text>
                <Text color="green">Created:</Text>
                <Text dimColor> {selectedArtifact.created}</Text>
              </Text>
            )}
          </Box>
        </Box>

        {/* Runtime Information */}
        {(selectedArtifact.port || selectedArtifact.pid || selectedArtifact.uptime) && (
          <Box flexDirection="column" marginBottom={1}>
            <Text bold color="white">Runtime Information</Text>
            <Box marginLeft={2} flexDirection="column">
              {selectedArtifact.port && (
                <Text>
                  <Text color="green">Port:   </Text>
                  <Text color="cyan">{selectedArtifact.port}</Text>
                </Text>
              )}
              {selectedArtifact.url && (
                <Text>
                  <Text color="green">URL:    </Text>
                  <Text color="cyan">{selectedArtifact.url}</Text>
                </Text>
              )}
              {selectedArtifact.pid && (
                <Text>
                  <Text color="green">PID:    </Text>
                  <Text dimColor>{selectedArtifact.pid}</Text>
                </Text>
              )}
              {selectedArtifact.uptime && (
                <Text>
                  <Text color="green">Uptime: </Text>
                  <Text dimColor>{selectedArtifact.uptime}</Text>
                </Text>
              )}
            </Box>
          </Box>
        )}

        {/* Resource Usage */}
        {selectedArtifact.resources && (
          <Box flexDirection="column" marginBottom={1}>
            <Text bold color="white">Resource Usage</Text>
            <Box marginLeft={2} flexDirection="column">
              {selectedArtifact.resources.cpu && (
                <Text>
                  <Text color="green">CPU:    </Text>
                  <Text color="yellow">{selectedArtifact.resources.cpu}%</Text>
                </Text>
              )}
              {selectedArtifact.resources.memory && (
                <Text>
                  <Text color="green">Memory: </Text>
                  <Text color="yellow">{selectedArtifact.resources.memory}</Text>
                </Text>
              )}
              {selectedArtifact.resources.disk && (
                <Text>
                  <Text color="green">Disk:   </Text>
                  <Text dimColor>{selectedArtifact.resources.disk}</Text>
                </Text>
              )}
            </Box>
          </Box>
        )}

        {/* Environment */}
        {selectedArtifact.env && (
          <Box flexDirection="column" marginBottom={1}>
            <Text bold color="white">Environment</Text>
            <Box marginLeft={2}>
              <Text dimColor>{selectedArtifact.env}</Text>
            </Box>
          </Box>
        )}

        <Box marginTop={1} flexDirection="column">
          <Text dimColor>Available commands:</Text>
          <Text dimColor>  cortex artifact view {selectedArtifact.id} - Open in browser</Text>
          <Text dimColor>  cortex artifact stop {selectedArtifact.id} - Stop artifact</Text>
        </Box>

        <Box marginTop={2}>
          <Text dimColor>Press ESC or B to go back, Ctrl+C to exit</Text>
        </Box>
      </Box>
    );
  };

  return (
    <Box flexDirection="column" padding={1}>
      {error ? (
        <Box flexDirection="column">
          <Text color="red">✗ Error: {error}</Text>
          <Box marginTop={1}>
            <Text dimColor>Press ESC to {viewMode === 'detail' ? 'go back' : 'exit'}</Text>
          </Box>
        </Box>
      ) : (
        <>
          {viewMode === 'list' && renderList()}
          {viewMode === 'detail' && renderDetail()}
        </>
      )}

      <Box marginTop={1}>
        <Text dimColor>Press Ctrl+C to exit</Text>
      </Box>
    </Box>
  );
};
