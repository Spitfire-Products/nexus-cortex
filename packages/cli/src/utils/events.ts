/**
 * Application Events for Nexus Cortex CLI
 *
 * Based on gemini-cli events system for compatibility with ink-ui components.
 */

import { EventEmitter } from 'node:events';

export enum AppEvent {
  OpenDebugConsole = 'open-debug-console',
  OauthDisplayMessage = 'oauth-display-message',
  Flicker = 'flicker',
  McpClientUpdate = 'mcp-client-update',
  SelectionWarning = 'selection-warning',
  PasteTimeout = 'paste-timeout',
}

export interface AppEvents {
  [AppEvent.OpenDebugConsole]: never[];
  [AppEvent.OauthDisplayMessage]: string[];
  [AppEvent.Flicker]: never[];
  [AppEvent.McpClientUpdate]: Array<Map<string, unknown> | never>;
  [AppEvent.SelectionWarning]: never[];
  [AppEvent.PasteTimeout]: never[];
}

export const appEvents = new EventEmitter<AppEvents>();
