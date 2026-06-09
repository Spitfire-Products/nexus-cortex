/**
 * SessionBrowser Component
 * Interactive UI for browsing and selecting chat sessions
 */

import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import SelectInput from 'ink-select-input';
import Spinner from 'ink-spinner';
import { CortexClient } from '@nexus-cortex/cli/dist/client/CortexClient.js';

export interface Session {
  id: string;
  model: string;
  messageCount: number;
  created: string;
  lastActive?: string;
}

export interface SessionBrowserProps {
  serverUrl?: string;
  onSelect: (session: Session) => void;
  onExit: () => void;
}

interface SelectItem {
  label: string;
  value: Session | null;
}

export const SessionBrowser: React.FC<SessionBrowserProps> = ({
  serverUrl = 'http://localhost:4000',
  onSelect,
  onExit,
}) => {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const client = new CortexClient(serverUrl);

    client
      .get('/sessions')
      .then((data: any) => {
        // Handle both array and object with sessions property
        const sessionList = Array.isArray(data) ? data : data.sessions || [];
        setSessions(sessionList);
        setLoading(false);
      })
      .catch((err: Error) => {
        setError(err.message);
        setLoading(false);
      });
  }, [serverUrl]);

  // Loading state
  if (loading) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="cyan">
          <Spinner type="dots" /> Loading sessions...
        </Text>
      </Box>
    );
  }

  // Error state
  if (error) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="red">✗ Error loading sessions: {error}</Text>
        <Text color="gray" dimColor>
          Press any key to exit
        </Text>
      </Box>
    );
  }

  // No sessions found
  if (sessions.length === 0) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="yellow">⚠ No sessions found</Text>
        <Text color="gray" dimColor>
          Start a new chat to create a session
        </Text>
        <Box marginTop={1}>
          <Text color="gray" dimColor>
            Press any key to exit
          </Text>
        </Box>
      </Box>
    );
  }

  // Format sessions for selection
  const items: SelectItem[] = sessions.map((session) => {
    const sessionId = session.id.slice(0, 8);
    const messageInfo = `${session.messageCount || 0} messages`;
    const dateInfo = session.created
      ? new Date(session.created).toLocaleDateString()
      : 'Unknown date';

    return {
      label: `${sessionId} - ${session.model} - ${messageInfo} - ${dateInfo}`,
      value: session,
    };
  });

  // Add exit option
  items.push({ label: '← Exit', value: null });

  const handleSelect = (item: SelectItem) => {
    if (item.value) {
      onSelect(item.value);
    } else {
      onExit();
    }
  };

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="cyan">
         Session Browser
      </Text>
      <Text color="gray" dimColor>
        Use ↑/↓ to navigate, Enter to select, Ctrl+C to exit
      </Text>
      <Box marginTop={1}>
        <SelectInput items={items} onSelect={handleSelect} />
      </Box>
    </Box>
  );
};
