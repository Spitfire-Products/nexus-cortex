/**
 * #11 — McpClient HTTP transport supplies sensible reconnection defaults.
 *
 * The MCP SDK's StreamableHTTPClientTransport defaults to maxRetries: 2 — far
 * too low for long-running cortex sessions where the SSE channel may drop
 * during a multi-minute tool sequence. Bench 3 surfaced this as
 * `Error: SSE stream disconnected: TypeError: terminated at processStream`.
 *
 * McpClient now applies its own defaults (10 retries, 1s initial / 30s max
 * delay, 1.5x growth) and accepts overrides via `McpServerConfig.reconnectionOptions`.
 */

import { describe, it, expect } from 'vitest';
import { McpClient } from '../McpClient.js';

describe('#11 — McpClient HTTP reconnection defaults', () => {
  it('exposes the resolved reconnection options for HTTP transport', () => {
    const client = new McpClient({
      name: 'test',
      transport: 'http',
      url: 'https://example.com/mcp',
    });

    const opts = client.getReconnectionOptions();
    expect(opts).toBeDefined();
    expect(opts!.maxRetries).toBeGreaterThanOrEqual(5);
    expect(opts!.initialReconnectionDelay).toBeGreaterThan(0);
    expect(opts!.maxReconnectionDelay).toBeGreaterThan(opts!.initialReconnectionDelay);
  });

  it('accepts user-provided reconnectionOptions and prefers them over defaults', () => {
    const client = new McpClient({
      name: 'test',
      transport: 'http',
      url: 'https://example.com/mcp',
      reconnectionOptions: {
        maxRetries: 99,
        initialReconnectionDelay: 500,
        maxReconnectionDelay: 60000,
        reconnectionDelayGrowFactor: 2,
      },
    });

    const opts = client.getReconnectionOptions();
    expect(opts!.maxRetries).toBe(99);
    expect(opts!.initialReconnectionDelay).toBe(500);
    expect(opts!.maxReconnectionDelay).toBe(60000);
    expect(opts!.reconnectionDelayGrowFactor).toBe(2);
  });

  it('returns undefined for stdio transport (no reconnection concept)', () => {
    const client = new McpClient({
      name: 'test',
      transport: 'stdio',
      command: 'echo',
    });

    expect(client.getReconnectionOptions()).toBeUndefined();
  });
});
