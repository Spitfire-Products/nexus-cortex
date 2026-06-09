/**
 * Round 15 (Opus parallel-bench finding): McpClientManager.connectToServer
 * must serialize concurrent calls for the same server name. Without this,
 * a second caller during CONNECTING tore down the first caller's
 * half-built transport, silently leaving the connection map broken.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpClientManager } from '../McpClientManager.js';

// Per-server connect counts + ability to control resolution timing.
const connectCallCounts = new Map<string, number>();
let connectDelayMs = 0;

vi.mock('../McpClient.js', () => {
  return {
    McpClient: class {
      private name: string;
      constructor(public config: any) {
        this.name = config.name;
      }
      async connect(): Promise<void> {
        connectCallCounts.set(this.name, (connectCallCounts.get(this.name) || 0) + 1);
        if (connectDelayMs > 0) {
          await new Promise((r) => setTimeout(r, connectDelayMs));
        }
      }
      async disconnect(): Promise<void> {
        /* immediate */
      }
      isConnected(): boolean { return true; }
      getStatus(): string { return 'connected'; }
      getServerInfo(): any { return { status: 'connected', toolCount: 0 }; }
      async discoverTools(): Promise<any[]> { return []; }
      async discoverResources(): Promise<any[]> { return []; }
      async discoverPrompts(): Promise<any[]> { return []; }
    },
  };
});

describe('McpClientManager — connectToServer race serialization (Round 15)', () => {
  let mgr: McpClientManager;

  beforeEach(() => {
    connectCallCounts.clear();
    connectDelayMs = 0;
    mgr = new McpClientManager();
    mgr.addServerConfig('s1', { command: 'echo', args: [], env: {} } as any);
    mgr.addServerConfig('s2', { command: 'echo', args: [], env: {} } as any);
  });

  it('two concurrent connectToServer("s1") calls only invoke McpClient.connect() ONCE', async () => {
    // Slow the underlying connect so the second call can race in
    connectDelayMs = 50;
    const p1 = mgr.connectToServer('s1');
    const p2 = mgr.connectToServer('s1');
    await Promise.all([p1, p2]);
    // Pre-fix: would be 2 (second caller raced through, tearing down first).
    // After-fix: in-flight promise shared → exactly 1.
    expect(connectCallCounts.get('s1') || 0).toBe(1);
  });

  it('after first connect resolves, a subsequent call kicks off a fresh connect', async () => {
    await mgr.connectToServer('s1');
    await mgr.connectToServer('s1');
    // Two distinct connect cycles (the second call is sequential, not concurrent)
    expect(connectCallCounts.get('s1') || 0).toBe(2);
  });

  it('concurrent connects to DIFFERENT servers do not block each other', async () => {
    connectDelayMs = 20;
    const p1 = mgr.connectToServer('s1');
    const p2 = mgr.connectToServer('s2');
    await Promise.all([p1, p2]);
    expect(connectCallCounts.get('s1') || 0).toBe(1);
    expect(connectCallCounts.get('s2') || 0).toBe(1);
  });

  it('5 concurrent connects to same server still result in 1 actual connect', async () => {
    connectDelayMs = 30;
    await Promise.all([
      mgr.connectToServer('s1'),
      mgr.connectToServer('s1'),
      mgr.connectToServer('s1'),
      mgr.connectToServer('s1'),
      mgr.connectToServer('s1'),
    ]);
    expect(connectCallCounts.get('s1') || 0).toBe(1);
  });
});
