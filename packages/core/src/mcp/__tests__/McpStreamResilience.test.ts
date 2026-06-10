/**
 * MCP HTTP stream resilience.
 *
 * The StreamableHTTP transport holds one long-lived SSE stream open. When that
 * stream idles out (undici body-inactivity timeout ~300s) or the network blips,
 * the SDK auto-reconnects. Previously McpClient.onerror blasted a raw stack via
 * console.error (corrupting the Ink TUI) and flipped the client to a permanent
 * ERROR state. Now:
 *   - transient stream drops -> RECONNECTING (still usable), debug-only log
 *   - terminal "max retries exceeded" / protocol errors -> ERROR
 *   - an undici dispatcher with bodyTimeout:0 keeps the idle SSE stream open
 */

import { describe, it, expect } from 'vitest';
import { McpClient, McpConnectionStatus } from '../McpClient.js';

function httpClient(): any {
  return new McpClient({
    name: 'test',
    transport: 'http',
    url: 'https://example.com/mcp',
  });
}

describe('MCP stream resilience', () => {
  it('classifies transient SSE/network drops as recoverable', () => {
    const c = httpClient();
    for (const msg of [
      'SSE stream disconnected: TypeError: terminated',
      'Failed to reconnect SSE stream: terminated',
      'socket hang up',
      'read ECONNRESET',
      'fetch failed',
      'This operation was aborted',
    ]) {
      expect(c.isRecoverableStreamError(msg)).toBe(true);
    }
  });

  it('treats exhausted retries / protocol errors as NON-recoverable', () => {
    const c = httpClient();
    expect(c.isRecoverableStreamError('Maximum reconnection attempts (10) exceeded.')).toBe(false);
    expect(c.isRecoverableStreamError('Invalid JSON-RPC response')).toBe(false);
  });

  it('counts RECONNECTING as connected so tool calls are not blocked mid-reconnect', () => {
    const c = httpClient();
    c.status = McpConnectionStatus.RECONNECTING;
    expect(c.isConnected()).toBe(true);
    c.status = McpConnectionStatus.ERROR;
    expect(c.isConnected()).toBe(false);
    c.status = McpConnectionStatus.DISCONNECTED;
    expect(c.isConnected()).toBe(false);
  });

  it('builds an undici dispatcher (bodyTimeout disabled) for the SSE stream', async () => {
    const c = httpClient();
    const dispatcher = await c.createNoIdleTimeoutDispatcher();
    expect(dispatcher).toBeDefined();
    // An undici Dispatcher exposes a dispatch() method.
    expect(typeof dispatcher.dispatch).toBe('function');
  });
});
