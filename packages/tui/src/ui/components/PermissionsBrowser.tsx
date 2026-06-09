/**
 * PermissionsBrowser - Interactive permissions viewer
 *
 * Browse and view permission modes, policies, and tool permissions
 * in an interactive terminal UI.
 */

import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import SelectInput from 'ink-select-input';
import Spinner from 'ink-spinner';
import { CortexClient } from '@nexus-cortex/cli/dist/client/CortexClient.js';

type ViewMode = 'menu' | 'mode' | 'policies' | 'tools';

interface Policy {
  name: string;
  type: string;
  enabled: boolean;
  description?: string;
}

interface ToolPermission {
  granted: boolean;
  reason?: string;
}

interface ApprovalMode {
  yoloMode: boolean;
  autoApproveActions: boolean;
  context?: string;
}

interface PermissionsBrowserProps {
  /** Server URL */
  serverUrl?: string;
  /** Callback when user exits browser */
  onExit?: () => void;
}

export const PermissionsBrowser: React.FC<PermissionsBrowserProps> = ({
  serverUrl = 'http://localhost:4000',
  onExit,
}) => {
  const [viewMode, setViewMode] = useState<ViewMode>('menu');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Data states
  const [approvalMode, setApprovalMode] = useState<ApprovalMode | null>(null);
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [toolPermissions, setToolPermissions] = useState<Record<string, ToolPermission>>({});

  // Handle keyboard input
  useInput((input, key) => {
    if (key.escape || (input === 'q' && viewMode !== 'menu')) {
      setViewMode('menu');
      setError(null);
    }
    if (key.ctrl && input === 'c') {
      onExit?.();
    }
  });

  // Fetch data based on view mode
  useEffect(() => {
    if (viewMode === 'menu') return;

    const fetchData = async () => {
      setLoading(true);
      setError(null);
      const client = new CortexClient(serverUrl);

      try {
        switch (viewMode) {
          case 'mode':
            const mode = await client.getApprovalMode();
            setApprovalMode(mode);
            break;

          case 'policies':
            const policiesResp = await client.get('/permissions/policies');
            setPolicies(policiesResp.policies || []);
            break;

          case 'tools':
            const toolsResp = await client.get('/permissions/tools');
            setToolPermissions(toolsResp.permissions || {});
            break;
        }
        setLoading(false);
      } catch (err: any) {
        setError(err.message);
        setLoading(false);
      }
    };

    fetchData();
  }, [viewMode, serverUrl]);

  const handleMenuSelect = (item: { value: ViewMode }) => {
    if (item.value === 'menu') {
      onExit?.();
    } else {
      setViewMode(item.value);
    }
  };

  const renderMenu = () => (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold color="magenta">  Permissions Browser</Text>
      </Box>
      <Text dimColor>Select a view:</Text>
      <Box marginTop={1}>
        <SelectInput
          items={[
            { label: ' Permission Mode', value: 'mode' },
            { label: ' Active Policies', value: 'policies' },
            { label: ' Tool Permissions', value: 'tools' },
            { label: '← Exit', value: 'menu' },
          ]}
          onSelect={handleMenuSelect}
        />
      </Box>
    </Box>
  );

  const renderMode = () => {
    if (loading) {
      return (
        <Box>
          <Text color="cyan"><Spinner type="dots" /></Text>
          <Text> Loading permission mode...</Text>
        </Box>
      );
    }

    if (!approvalMode) return null;

    let mode: string;
    if (approvalMode.yoloMode) {
      mode = 'auto (YOLO)';
    } else if (approvalMode.autoApproveActions) {
      mode = 'interactive (auto-approve)';
    } else {
      mode = 'interactive';
    }

    return (
      <Box flexDirection="column">
        <Box marginBottom={1}>
          <Text bold color="cyan"> Permission Mode</Text>
        </Box>

        <Box flexDirection="column" marginTop={1}>
          <Text>
            <Text color="green">Current Mode: </Text>
            <Text bold color={approvalMode.yoloMode ? 'yellow' : 'white'}>{mode}</Text>
          </Text>

          <Box marginTop={1}>
            <Text>
              <Text color="green">Auto-Approve:  </Text>
              <Text color={approvalMode.autoApproveActions ? 'green' : 'red'}>
                {approvalMode.autoApproveActions ? 'enabled' : 'disabled'}
              </Text>
            </Text>
          </Box>

          {approvalMode.yoloMode && (
            <Box marginTop={1}>
              <Text color="yellow">⚠ YOLO Mode active - All actions auto-approved!</Text>
            </Box>
          )}

          {approvalMode.context && (
            <Box marginTop={1}>
              <Text dimColor>Context: {approvalMode.context}</Text>
            </Box>
          )}
        </Box>

        <Box marginTop={2} flexDirection="column">
          <Text dimColor>Available modes:</Text>
          <Text dimColor>  • interactive - Prompt for approval on each tool</Text>
          <Text dimColor>  • auto - Auto-approve all tools (YOLO)</Text>
        </Box>

        <Box marginTop={2}>
          <Text dimColor>Press ESC or Q to return to menu</Text>
        </Box>
      </Box>
    );
  };

  const renderPolicies = () => {
    if (loading) {
      return (
        <Box>
          <Text color="cyan"><Spinner type="dots" /></Text>
          <Text> Loading policies...</Text>
        </Box>
      );
    }

    return (
      <Box flexDirection="column">
        <Box marginBottom={1}>
          <Text bold color="cyan"> Active Policies ({policies.length})</Text>
        </Box>

        {policies.length === 0 ? (
          <Box marginTop={1}>
            <Text dimColor>No active policies configured.</Text>
          </Box>
        ) : (
          <Box flexDirection="column" marginTop={1}>
            {policies.map((policy, index) => (
              <Box key={index} flexDirection="column" marginBottom={1}>
                <Text bold color="white">{policy.name}</Text>
                <Box marginLeft={2} flexDirection="column">
                  <Text>
                    <Text color="green">Type:   </Text>
                    <Text>{policy.type}</Text>
                  </Text>
                  <Text>
                    <Text color="green">Status: </Text>
                    <Text color={policy.enabled ? 'green' : 'red'}>
                      {policy.enabled ? 'Enabled' : 'Disabled'}
                    </Text>
                  </Text>
                  {policy.description && (
                    <Text dimColor>{policy.description}</Text>
                  )}
                </Box>
              </Box>
            ))}
          </Box>
        )}

        <Box marginTop={2}>
          <Text dimColor>Press ESC or Q to return to menu</Text>
        </Box>
      </Box>
    );
  };

  const renderTools = () => {
    if (loading) {
      return (
        <Box>
          <Text color="cyan"><Spinner type="dots" /></Text>
          <Text> Loading tool permissions...</Text>
        </Box>
      );
    }

    const toolEntries = Object.entries(toolPermissions);

    return (
      <Box flexDirection="column">
        <Box marginBottom={1}>
          <Text bold color="cyan"> Tool Permissions ({toolEntries.length})</Text>
        </Box>

        {toolEntries.length === 0 ? (
          <Box marginTop={1}>
            <Text dimColor>No tool permissions configured.</Text>
          </Box>
        ) : (
          <Box flexDirection="column" marginTop={1}>
            {toolEntries.map(([toolName, permission], index) => (
              <Box key={index} flexDirection="column" marginBottom={1}>
                <Text>
                  <Text color="white">{toolName}: </Text>
                  <Text color={permission.granted ? 'green' : 'red'}>
                    {permission.granted ? '✓ Granted' : '✗ Denied'}
                  </Text>
                </Text>
                {permission.reason && (
                  <Box marginLeft={2}>
                    <Text dimColor>{permission.reason}</Text>
                  </Box>
                )}
              </Box>
            ))}
          </Box>
        )}

        <Box marginTop={2} flexDirection="column">
          <Text dimColor>Manage permissions:</Text>
          <Text dimColor>  cortex permissions grant &lt;tool&gt;</Text>
          <Text dimColor>  cortex permissions revoke &lt;tool&gt;</Text>
        </Box>

        <Box marginTop={2}>
          <Text dimColor>Press ESC or Q to return to menu</Text>
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
            <Text dimColor>Press ESC or Q to return to menu</Text>
          </Box>
        </Box>
      ) : (
        <>
          {viewMode === 'menu' && renderMenu()}
          {viewMode === 'mode' && renderMode()}
          {viewMode === 'policies' && renderPolicies()}
          {viewMode === 'tools' && renderTools()}
        </>
      )}

      <Box marginTop={1}>
        <Text dimColor>Press Ctrl+C to exit</Text>
      </Box>
    </Box>
  );
};
