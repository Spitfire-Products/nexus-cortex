/**
 * ReconnectMcpServer (2026-11-14, operator: agents must be able to restart MCP servers after an update, without restarting the TUI).
 */
import { describe, it, expect } from 'vitest';
import { ReconnectMcpServer } from '../ReconnectMcpServer.js';

function fakeManager(opts: { names: string[]; fail?: string[] }) {
  const calls: string[] = [];
  return {
    calls,
    getServerNames: () => opts.names,
    reconnectServer: async (n: string) => {
      calls.push(n);
      if (opts.fail?.includes(n)) throw new Error(`spawn ${n} ENOENT`);
      return { server: n, tools: 3 };
    },
  } as any;
}

describe('ReconnectMcpServer', () => {
  it('restarts the named server and reports its tool count', async () => {
    const m = fakeManager({ names: ['nexus-desktop', 'nexus-browser'] });
    const r = await ReconnectMcpServer.execute({ server_name: 'nexus-desktop' }, m);
    expect(r.status).toBe('success'); expect(m.calls).toEqual(['nexus-desktop']);
    expect(r.reconnected).toEqual([{ server: 'nexus-desktop', tools: 3 }]); expect(r.message).toMatch(/reconnected, 3 tool/);
  });
  it('all:true restarts every configured server; one failure → partial, named with its error', async () => {
    const m = fakeManager({ names: ['a', 'b'], fail: ['b'] });
    const r = await ReconnectMcpServer.execute({ all: true }, m);
    expect(r.status).toBe('partial'); expect(m.calls).toEqual(['a', 'b']);
    expect(r.failed).toEqual([{ server: 'b', error: 'spawn b ENOENT' }]); expect(r.message).toMatch(/b: FAILED — spawn b ENOENT/);
  });
  it('no target → error listing the configured servers; no MCP → error', async () => {
    const r = await ReconnectMcpServer.execute({}, fakeManager({ names: ['x'] }));
    expect(r.status).toBe('error'); expect(r.message).toMatch(/Configured servers: x/);
    expect((await ReconnectMcpServer.execute({ all: true }, undefined)).status).toBe('error');
  });
  it('the tool definition names the update use case', () => {
    const d = ReconnectMcpServer.toCanonicalTool();
    expect(d.name).toBe('ReconnectMcpServer'); expect(d.description).toMatch(/npm i -g/);
  });
});
