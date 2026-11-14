/**
 * ReconnectMcpServer — REAL in-process server, no mocks (2026-11-14). nexus-desktop runs in-process; Node caches ES modules by URL, so
 * before the mtime-tagged import a reconnect after `npm i -g` kept running the OLD version (macbook-cortex ran a task on desktop 0.11.4
 * after installing 0.11.5). The scenario runs in a CHILD node process against the built core (dist/), because vitest's module runner
 * ignores import-URL queries and would hide the bug either way.
 */
import { describe, it, expect, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

const dir = path.join(__dirname, '.tmp-reconnect');   // inside the package so @modelcontextprotocol/sdk resolves
const dist = path.resolve(__dirname, '..', '..', '..', 'dist', 'mcp', 'McpClientManager.js');
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('reconnectServer on an in-process server loads the newly installed version', () => {
  it('v0.11.4 → rewrite to v0.11.5 → reconnect → the new tool is served', () => {
    fs.mkdirSync(dir, { recursive: true });
    const script = path.join(dir, 'run.mjs');
    fs.writeFileSync(script, `
import fs from 'node:fs';
import { McpClientManager } from ${JSON.stringify(dist)};
const mod = ${JSON.stringify(path.join(dir, 'index.mjs'))};
const write = (v) => fs.writeFileSync(mod, "import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';\\n" +
  "export async function createDesktopMCP() { const server = new McpServer({ name: 'fake', version: '" + v + "' });\\n" +
  "server.tool('version_" + v.split('.').join('_') + "', 'v', async () => ({ content: [{ type: 'text', text: '" + v + "' }] }));\\n" +
  "return { server, close: async () => {} }; }\\n");
write('0.11.4');
const m = new McpClientManager(false);
m.addServerConfig('nexus-desktop', { name: 'nexus-desktop', transport: 'inprocess', inProcessModule: mod, inProcessFactory: 'createDesktopMCP' });
await m.connectToServer('nexus-desktop'); await m.discoverServerTools('nexus-desktop');
const before = m.getAllTools().map((t) => t.name);
write('0.11.5'); const t = new Date(Date.now() + 5000); fs.utimesSync(mod, t, t);
const r = await m.reconnectServer('nexus-desktop');
const after = m.getAllTools().map((t) => t.name);
await m.cleanup();
console.log(JSON.stringify({ before, after, r }));
`);
    const out = execFileSync(process.execPath, [script], { encoding: 'utf8', cwd: dir, timeout: 60_000 }).trim().split('\n').pop()!;
    const j = JSON.parse(out);
    expect(j.before).toEqual(['version_0_11_4']);
    expect(j.after).toEqual(['version_0_11_5']);
    expect(j.r).toEqual({ server: 'nexus-desktop', tools: 1 });
  });
});
