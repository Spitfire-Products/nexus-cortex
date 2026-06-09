/**
 * Create a new session (clear current session history)
 */
import { ThemeManager } from '../../themes/ThemeManager.js';

export interface NewSessionOptions {
  serverUrl?: string;
}

/**
 * Create a new session by clearing the current one
 */
export async function newSession(_options: NewSessionOptions = {}): Promise<void> {
  const theme = ThemeManager.getExtendedTheme();

  console.log();
  console.log(theme.infoMessage('Creating new session...'));
  console.log();
  console.log(theme.warningMessage('Note: The server currently maintains one persistent session.'));
  console.log(theme.dimmed('To start fresh, restart the server with:'));
  console.log(theme.dimmed(' npm run dev:full  (in packages/cli)'));
  console.log();
  console.log(theme.infoMessage('Or delete the session file:'));
  console.log(theme.dimmed(' rm packages/server/.cortex/sessions/*.jsonl'));
  console.log();
  console.log(theme.successMessage('Tip: Use "clear" command in chat to reset conversation locally'));
  console.log();
}
