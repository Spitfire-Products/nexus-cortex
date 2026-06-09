/**
 * View Session Command
 * Display session details and messages
 */
import { CortexClient } from '../../client/CortexClient.js';
import { ConfigManager } from '../../config/ConfigManager.js';
import { ThemeManager } from '../../themes/ThemeManager.js';
import { formatDate } from '../../utils/formatters.js';

export interface ViewSessionOptions {
  serverUrl?: string;
  json?: boolean;
}

export async function viewSession(sessionId: string, options: ViewSessionOptions): Promise<void> {
  const theme = ThemeManager.getTheme();
  const serverUrl = options.serverUrl || ConfigManager.get('serverUrl');
  const client = new CortexClient(serverUrl);

  try {
    const session = await client.get(`/sessions/${sessionId}`);
    const messages = await client.get(`/sessions/${sessionId}/messages`);

    if (options.json) {
      console.log(JSON.stringify({ session, messages: messages.messages }, null, 2));
      return;
    }

    // Formatted output
    console.log(theme.colors.secondary(`\n Session: ${sessionId}\n`));
    console.log(theme.colors.muted(`Created: ${formatDate(session.metadata.startTime)}`));
    console.log(theme.colors.muted(`Messages: ${session.messageCount}`));
    console.log(theme.colors.muted(`Size: ${formatBytes(session.fileSize)}\n`));

    // Display messages
    console.log(theme.colors.secondary('Messages:\n'));

    for (const message of messages.messages) {
      displayMessage(message, theme);
    }
  } catch (error: any) {
    console.error(theme.colors.error('Error viewing session:'), error.message);
    process.exit(1);
  }
}

function displayMessage(message: any, theme: any): void {
  const role = message.role;
  const roleColor = role === 'user' ? theme.colors.success : role === 'assistant' ? theme.colors.info : theme.colors.warning;

  console.log(roleColor(`${role.toUpperCase()}:`));

  if (typeof message.content === 'string') {
    console.log(message.content);
  } else if (Array.isArray(message.content)) {
    for (const block of message.content) {
      if (block.type === 'text') {
        console.log(block.text);
      } else if (block.type === 'tool_use') {
        console.log(theme.colors.muted(` [Tool: ${block.name}]`));
      } else if (block.type === 'tool_result') {
        console.log(theme.colors.muted(` [Tool Result]`));
      }
    }
  }

  console.log();
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}
