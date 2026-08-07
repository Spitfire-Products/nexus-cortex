/**
 * System Message Browser - Browse available system messages
 */
import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import SelectInput from 'ink-select-input';
import Spinner from 'ink-spinner';
import { ThemeManager } from '@nexus-cortex/cli/dist/themes/ThemeManager.js';

interface SystemMessageBrowserProps {
  serverUrl?: string;
  onExit: () => void;
}

interface SystemMessage {
  id: string;
  name: string;
  category: string;
  description: string;
  content?: string;
}

type ViewMode = 'list' | 'detail';

export const SystemMessageBrowser: React.FC<SystemMessageBrowserProps> = ({
  serverUrl = 'http://localhost:4000',
  onExit,
}) => {
  const theme = ThemeManager.getTheme();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<SystemMessage[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [selectedMessage, setSelectedMessage] = useState<SystemMessage | null>(null);

  useEffect(() => {
    fetchMessages();
  }, [serverUrl]);

  const fetchMessages = async () => {
    try {
      setLoading(true);
      const response = await fetch(`${serverUrl}/system-messages`);

      if (!response.ok) {
        throw new Error(`Failed to fetch system messages: ${response.statusText}`);
      }

      const data: any = await response.json();
      setMessages(data.messages || []);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchMessageDetail = async (id: string) => {
    try {
      const response = await fetch(`${serverUrl}/system-messages/${id}`);

      if (!response.ok) {
        throw new Error(`Failed to fetch message details: ${response.statusText}`);
      }

      const data: any = await response.json();
      setSelectedMessage(data);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleSelect = (item: any) => {
    if (item.value === 'exit') {
      onExit();
    } else if (item.value === 'back') {
      setViewMode('list');
      setSelectedMessage(null);
    } else if (item.value.startsWith('message:')) {
      const messageId = item.value.replace('message:', '');
      const message = messages.find(m => m.id === messageId);
      if (message) {
        fetchMessageDetail(message.id);
        setViewMode('detail');
      }
    } else if (item.value === 'refresh') {
      fetchMessages();
    }
  };

  if (loading) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="cyan">
          <Spinner type="dots" /> Loading system messages...
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
    // Group messages by category
    const categories = Array.from(new Set(messages.map(m => m.category)));

    const items = [
      ...messages.map(msg => ({
        label: `[${msg.category}] ${msg.name}`,
        value: `message:${msg.id}`,
      })),
      { label: '↻ Refresh', value: 'refresh' },
      { label: '← Exit', value: 'exit' },
    ];

    return (
      <Box flexDirection="column" padding={1}>
        <Text color="cyan" bold>
           System Message Browser
        </Text>
        <Text color="gray">
          Use ↑/↓ to navigate, Enter to select, Ctrl+C to exit
        </Text>
        <Box marginTop={1} flexDirection="column">
          <Text color="yellow">
            Available Messages ({messages.length} across {categories.length} categories):
          </Text>
          <Box marginTop={1}>
            <SelectInput items={items} onSelect={handleSelect} />
          </Box>
        </Box>
      </Box>
    );
  }

  // Detail view
  if (!selectedMessage) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="red">No message selected</Text>
      </Box>
    );
  }

  // Truncate content for display
  const displayContent = selectedMessage.content
    ? selectedMessage.content.length > 500
      ? selectedMessage.content.slice(0, 500) + '...'
      : selectedMessage.content
    : 'No content available';

  return (
    <Box flexDirection="column" padding={1}>
      <Text color="cyan" bold>
         System Message: {selectedMessage.name}
      </Text>
      <Text color="gray">{selectedMessage.category}</Text>

      <Box marginTop={1} flexDirection="column" borderStyle="round" borderColor="cyan" padding={1}>
        <Box>
          <Text color="blue">ID: </Text>
          <Text>{selectedMessage.id}</Text>
        </Box>
        <Box>
          <Text color="blue">Category: </Text>
          <Text>{selectedMessage.category}</Text>
        </Box>
        <Box marginTop={1} flexDirection="column">
          <Text color="blue">Description:</Text>
          <Text>{selectedMessage.description}</Text>
        </Box>
        <Box marginTop={1} flexDirection="column">
          <Text color="blue">Content Preview:</Text>
          <Text color="gray">{displayContent}</Text>
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
