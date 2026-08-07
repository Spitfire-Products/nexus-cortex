/**
 * MiddlewareDashboard - Interactive middleware viewer
 *
 * View and configure middleware systems (retry, permissions, etc.)
 * in an interactive terminal UI.
 */

import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import SelectInput from 'ink-select-input';
import Spinner from 'ink-spinner';
import { CortexClient } from '@nexus-cortex/cli/dist/client/CortexClient.js';

type ViewMode = 'list' | 'detail';

interface MiddlewareConfig {
  middleware: Record<string, boolean>;
  enabledCount: number;
  config?: Record<string, any>;
  envVars?: Record<string, any[]>;
  defaults?: Record<string, any>;
}

interface MiddlewareDashboardProps {
  /** Server URL */
  serverUrl?: string;
  /** Callback when user exits dashboard */
  onExit?: () => void;
}

const MIDDLEWARE_NAMES: Record<string, string> = {
  'errorClassifier': 'Error Classifier',
  'retry': 'Retry',
  'permissions': 'Permissions',
  'systemMessage': 'System Message',
  'mentorship': 'Mentorship',
  'loopControl': 'Loop Control',
  'helper': 'Helper Model'
};

export const MiddlewareDashboard: React.FC<MiddlewareDashboardProps> = ({
  serverUrl = 'http://localhost:4000',
  onExit,
}) => {
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [middlewareConfig, setMiddlewareConfig] = useState<MiddlewareConfig | null>(null);
  const [selectedMiddleware, setSelectedMiddleware] = useState<string | null>(null);

  // Handle keyboard input
  useInput((input, key) => {
    if (key.escape || (input === 'q' && viewMode === 'list')) {
      onExit?.();
    }
    if ((key.escape || input === 'b') && viewMode === 'detail') {
      setViewMode('list');
      setSelectedMiddleware(null);
      setError(null);
    }
    if (key.ctrl && input === 'c') {
      onExit?.();
    }
    if (input === 'r' && viewMode === 'list') {
      // Refresh list
      fetchMiddlewareConfig();
    }
  });

  const fetchMiddlewareConfig = async () => {
    setLoading(true);
    setError(null);
    const client = new CortexClient(serverUrl);

    try {
      const response = await client.get('/middleware/config');
      setMiddlewareConfig(response);
      setLoading(false);
    } catch (err: any) {
      setError(err.message);
      setLoading(false);
    }
  };

  // Initial load
  useEffect(() => {
    fetchMiddlewareConfig();
  }, [serverUrl]);

  const handleMiddlewareSelect = (item: { value: string; label: string }) => {
    setSelectedMiddleware(item.value);
    setViewMode('detail');
  };

  const renderList = () => {
    if (loading) {
      return (
        <Box>
          <Text color="cyan"><Spinner type="dots" /></Text>
          <Text> Loading middleware configuration...</Text>
        </Box>
      );
    }

    if (!middlewareConfig || Object.keys(middlewareConfig.middleware).length === 0) {
      return (
        <Box flexDirection="column">
          <Text dimColor>No middleware systems found.</Text>
        </Box>
      );
    }

    const middlewareEntries = Object.entries(middlewareConfig.middleware);
    const enabledCount = middlewareConfig.enabledCount || 0;
    const totalCount = middlewareEntries.length;

    return (
      <Box flexDirection="column">
        <Box marginBottom={1}>
          <Text bold color="cyan">
            ⚙  Middleware Systems ({enabledCount}/{totalCount} enabled)
          </Text>
        </Box>

        <Text dimColor>Select a middleware to view details:</Text>
        <Box marginTop={1}>
          <SelectInput
            items={middlewareEntries.map(([name, enabled]) => ({
              label: `${enabled ? '✓ ' : '○ '}${MIDDLEWARE_NAMES[name] || name} ${enabled ? '' : '(disabled)'}`,
              value: name
            }))}
            onSelect={handleMiddlewareSelect}
          />
        </Box>

        <Box marginTop={2}>
          <Text dimColor>Press R to refresh, Q to exit</Text>
        </Box>
      </Box>
    );
  };

  const renderDetail = () => {
    if (!middlewareConfig || !selectedMiddleware) return null;

    const enabled = middlewareConfig.middleware[selectedMiddleware];
    const config = middlewareConfig.config?.[selectedMiddleware] || {};
    const envVars = middlewareConfig.envVars?.[selectedMiddleware] || [];
    const defaults = middlewareConfig.defaults?.[selectedMiddleware] || {};
    const friendlyName = MIDDLEWARE_NAMES[selectedMiddleware] || selectedMiddleware;

    return (
      <Box flexDirection="column">
        <Box marginBottom={1}>
          <Text bold color="cyan">
            ⚙  {friendlyName}
          </Text>
        </Box>

        {/* Status */}
        <Box flexDirection="column" marginBottom={1}>
          <Text bold color="white">Status</Text>
          <Box marginLeft={2}>
            <Text>
              <Text color="green">Enabled: </Text>
              <Text color={enabled ? 'green' : 'red'}>
                {enabled ? '✓ Yes' : '✗ No'}
              </Text>
            </Text>
          </Box>
          <Box marginLeft={2}>
            <Text>
              <Text color="green">Internal Name: </Text>
              <Text dimColor>{selectedMiddleware}</Text>
            </Text>
          </Box>
        </Box>

        {/* Current Configuration */}
        {Object.keys(config).length > 0 && (
          <Box flexDirection="column" marginBottom={1}>
            <Text bold color="white">Current Configuration</Text>
            <Box marginLeft={2} flexDirection="column">
              {Object.entries(config).map(([key, value]) => (
                <Text key={key}>
                  <Text color="green">{key}: </Text>
                  <Text color="cyan">{String(value)}</Text>
                </Text>
              ))}
            </Box>
          </Box>
        )}

        {/* Environment Variables */}
        {envVars.length > 0 && (
          <Box flexDirection="column" marginBottom={1}>
            <Text bold color="white">Environment Variables</Text>
            <Box marginLeft={2} flexDirection="column">
              {envVars.map((envVar: any, idx: number) => {
                const isSet = envVar.value !== undefined && envVar.value !== null;
                return (
                  <Box key={idx} flexDirection="column" marginBottom={1}>
                    <Text>
                      <Text color="green">{envVar.name}: </Text>
                      <Text color={isSet ? 'green' : 'red'}>
                        {isSet ? '✓ Set' : '○ Not set'}
                      </Text>
                    </Text>
                    {envVar.description && (
                      <Box marginLeft={2}>
                        <Text dimColor>{envVar.description}</Text>
                      </Box>
                    )}
                    {envVar.default !== undefined && (
                      <Box marginLeft={2}>
                        <Text dimColor>Default: {String(envVar.default)}</Text>
                      </Box>
                    )}
                  </Box>
                );
              })}
            </Box>
          </Box>
        )}

        {/* Default Values */}
        {Object.keys(defaults).length > 0 && (
          <Box flexDirection="column" marginBottom={1}>
            <Text bold color="white">Default Values</Text>
            <Box marginLeft={2} flexDirection="column">
              {Object.entries(defaults).map(([key, value]) => (
                <Text key={key} dimColor>
                  {key}: {String(value)}
                </Text>
              ))}
            </Box>
          </Box>
        )}

        <Box marginTop={1} flexDirection="column">
          <Text dimColor>Available commands:</Text>
          <Text dimColor>  cortex middleware enable {selectedMiddleware}</Text>
          <Text dimColor>  cortex middleware disable {selectedMiddleware}</Text>
          <Text dimColor>  cortex middleware status {selectedMiddleware}</Text>
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
