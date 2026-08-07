/**
 * Tmux Browser - Browse and manage tmux sessions
 */
import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import SelectInput from 'ink-select-input';
import Spinner from 'ink-spinner';
import { ThemeManager } from '@nexus-cortex/cli/dist/themes/ThemeManager.js';

interface TmuxBrowserProps {
  serverUrl?: string;
  onExit: () => void;
}

interface TmuxSession {
  id: string;
  name: string;
  windows: number;
  created: string;
  attached: boolean;
}

type ViewMode = 'list' | 'detail';

export const TmuxBrowser: React.FC<TmuxBrowserProps> = ({
  serverUrl = 'http://localhost:4000',
  onExit,
}) => {
  const theme = ThemeManager.getTheme();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<TmuxSession[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [selectedSession, setSelectedSession] = useState<TmuxSession | null>(null);

  useEffect(() => {
    fetchSessions();
  }, [serverUrl]);

  const fetchSessions = async () => {
    try {
      setLoading(true);
      const response = await fetch(`${serverUrl}/tmux`);

      if (!response.ok) {
        throw new Error(`Failed to fetch tmux sessions: ${response.statusText}`);
      }

      const data: any = await response.json();
      setSessions(data.sessions || []);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSelect = (item: any) => {
    if (item.value === 'exit') {
      onExit();
    } else if (item.value === 'back') {
      setViewMode('list');
      setSelectedSession(null);
    } else if (item.value.startsWith('session:')) {
      const sessionId = item.value.replace('session:', '');
      const session = sessions.find(s => s.id === sessionId);
      if (session) {
        setSelectedSession(session);
        setViewMode('detail');
      }
    } else if (item.value === 'refresh') {
      fetchSessions();
    }
  };

  if (loading) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="cyan">
          <Spinner type="dots" /> Loading tmux sessions...
        </Text>
      </Box>
    );
  }

  if (error) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="red">{theme.icons.error} Error: {error}</Text>
        <Text color="gray">Press Ctrl+C to exit</Text>
      </Box>
    );
  }

  if (viewMode === 'list') {
    const items = [
      ...sessions.map(session => ({
        label: `${session.name} (${session.windows} windows)${session.attached ? ' [attached]' : ''}`,
        value: `session:${session.id}`,
      })),
      { label: '↻ Refresh', value: 'refresh' },
      { label: '← Exit', value: 'exit' },
    ];

    return (
      <Box flexDirection="column" padding={1}>
        <Text color="cyan" bold>
            Tmux Session Browser
        </Text>
        <Text color="gray">
          Use ↑/↓ to navigate, Enter to select, Ctrl+C to exit
        </Text>
        <Box marginTop={1} flexDirection="column">
          <Text color="yellow">Sessions ({sessions.length}):</Text>
          <Box marginTop={1}>
            <SelectInput items={items} onSelect={handleSelect} />
          </Box>
        </Box>
      </Box>
    );
  }

  // Detail view
  if (!selectedSession) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="red">No session selected</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Text color="cyan" bold>
          Tmux Session: {selectedSession.name}
      </Text>
      <Text color="gray">Session Details</Text>

      <Box marginTop={1} flexDirection="column" borderStyle="round" borderColor="cyan" padding={1}>
        <Box>
          <Text color="blue">ID: </Text>
          <Text>{selectedSession.id}</Text>
        </Box>
        <Box>
          <Text color="blue">Name: </Text>
          <Text>{selectedSession.name}</Text>
        </Box>
        <Box>
          <Text color="blue">Windows: </Text>
          <Text>{selectedSession.windows}</Text>
        </Box>
        <Box>
          <Text color="blue">Created: </Text>
          <Text>{selectedSession.created}</Text>
        </Box>
        <Box>
          <Text color="blue">Status: </Text>
          <Text color={selectedSession.attached ? 'green' : 'gray'}>
            {selectedSession.attached ? 'Attached' : 'Detached'}
          </Text>
        </Box>
      </Box>

      <Box marginTop={1}>
        <SelectInput
          items={[
            { label: '← Back to List', value: 'back' },
            { label: '↻ Refresh', value: 'refresh' },
            { label: '← Exit', value: 'exit' },
          ]}
          onSelect={handleSelect}
        />
      </Box>
    </Box>
  );
};
