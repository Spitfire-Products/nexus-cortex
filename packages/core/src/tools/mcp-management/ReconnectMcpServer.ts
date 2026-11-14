/**
 * ReconnectMcpServer Tool (2026-11-14)
 *
 * Restarts MCP server connections in the CURRENT session — after `npm i -g` of a newer server package (e.g. @nexus-cortex/desktop), or
 * when a server died or hangs. A stdio server's process is stopped and started again, so the newly installed version is the one that
 * runs, and its tools are rediscovered. Operator 11-14: agents "can stop and update and restart cortex as needed to reconnect mcps";
 * before this tool the only way was restarting the whole TUI, which an agent cannot do from inside it.
 */
import type { CanonicalTool } from '../types/CanonicalTool.js';
import type { McpClientManager } from '../../mcp/McpClientManager.js';

export interface ReconnectMcpServerInput { server_name?: string; all?: boolean }
export interface ReconnectMcpServerOutput {
  status: 'success' | 'partial' | 'error';
  reconnected: Array<{ server: string; tools: number }>;
  failed: Array<{ server: string; error: string }>;
  message: string;
}

export class ReconnectMcpServer {
  static async execute(input: ReconnectMcpServerInput, manager: McpClientManager | undefined): Promise<ReconnectMcpServerOutput> {
    if (!manager) return { status: 'error', reconnected: [], failed: [], message: 'MCP is not enabled in this session.' };
    const names = input.all ? manager.getServerNames() : input.server_name ? [input.server_name] : [];
    if (!names.length) {
      return { status: 'error', reconnected: [], failed: [], message: `Give server_name or all:true. Configured servers: ${manager.getServerNames().join(', ') || 'none'}.` };
    }
    const reconnected: ReconnectMcpServerOutput['reconnected'] = []; const failed: ReconnectMcpServerOutput['failed'] = [];
    for (const n of names) {
      try { reconnected.push(await manager.reconnectServer(n)); }
      catch (e) { failed.push({ server: n, error: e instanceof Error ? e.message : String(e) }); }
    }
    const status = failed.length === 0 ? 'success' : reconnected.length ? 'partial' : 'error';
    const parts = [
      ...reconnected.map((r) => `${r.server}: reconnected, ${r.tools} tool(s) — the newly installed version (if any) is now running`),
      ...failed.map((f) => `${f.server}: FAILED — ${f.error}`),
    ];
    return { status, reconnected, failed, message: parts.join('\n') };
  }

  static toCanonicalTool(): CanonicalTool {
    return {
      name: 'ReconnectMcpServer',
      description: 'Restart an MCP server connection in THIS session: the server process is stopped and started again and its tools are rediscovered. Use it after updating a server package (npm i -g @nexus-cortex/desktop@<version>) so the new version runs without restarting the TUI, or when a server stopped answering. Check the version afterwards (e.g. the desktop tool\'s info/stats).',
      schema: {
        type: 'object',
        properties: {
          server_name: { type: 'string', description: 'The MCP server to restart (e.g. nexus-desktop, nexus-browser)' },
          all: { type: 'boolean', description: 'Restart every configured MCP server' },
        },
      },
    };
  }
}
