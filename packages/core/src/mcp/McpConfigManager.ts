/**
 * MCP Config Manager
 *
 * Manages MCP_CONFIG.md files for opt-in auto-injection.
 * Handles parsing, writing, and merging of project/global configurations.
 *
 * Phase 2.5 Day 4.5: MCP Auto-Injection System
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { McpServerConfig, McpTransportType } from './McpClient.js';

/**
 * Server status in MCP_CONFIG.md
 */
export type McpConfigStatus = 'enabled' | 'available' | 'disabled';

/**
 * Server entry in MCP_CONFIG.md
 */
export interface McpConfigServerEntry {
  name: string;
  status: McpConfigStatus;
  description: string;
  /** Transport — defaults to 'http' when url is set, else 'stdio' */
  transport?: McpTransportType;
  /** Command (stdio transport) */
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  /** URL (http transport) */
  url?: string;
  /** Static HTTP headers (http transport) */
  headers?: Record<string, string>;
  autoStart?: boolean;
  workingDir?: string;
  timeout?: number;
}

/**
 * Parsed MCP_CONFIG.md structure
 */
export interface McpConfig {
  servers: McpConfigServerEntry[];
  notes?: string;
}

/**
 * MCP Config Manager
 */
export class McpConfigManager {
  private projectPath?: string;
  private globalConfigPath: string;

  constructor(projectPath?: string) {
    this.projectPath = projectPath;
    // Global config in ~/.cortex/MCP_CONFIG.md
    this.globalConfigPath = path.join(
      process.env.HOME || process.env.USERPROFILE || '',
      '.cortex',
      'MCP_CONFIG.md'
    );
  }

  /**
   * Get config file path for given scope
   */
  private getConfigPath(scope: 'project' | 'global'): string {
    if (scope === 'global') {
      return this.globalConfigPath;
    }

    if (!this.projectPath) {
      throw new Error('Project path not set, cannot access project config');
    }

    return path.join(this.projectPath, 'MCP_CONFIG.md');
  }

  /**
   * Check if config exists
   */
  async configExists(scope: 'project' | 'global'): Promise<boolean> {
    try {
      const configPath = this.getConfigPath(scope);
      await fs.access(configPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Read and parse MCP_CONFIG.md
   */
  async readConfig(scope: 'project' | 'global'): Promise<McpConfig | null> {
    const configPath = this.getConfigPath(scope);

    try {
      const content = await fs.readFile(configPath, 'utf-8');
      return this.parseConfig(content);
    } catch (error) {
      // Config doesn't exist or can't be read
      return null;
    }
  }

  /**
   * Write MCP_CONFIG.md
   */
  async writeConfig(scope: 'project' | 'global', config: McpConfig): Promise<void> {
    const configPath = this.getConfigPath(scope);

    // Ensure directory exists
    const dir = path.dirname(configPath);
    await fs.mkdir(dir, { recursive: true });

    // Generate markdown
    const markdown = this.generateMarkdown(config);

    // Write file
    await fs.writeFile(configPath, markdown, 'utf-8');
  }

  /**
   * Parse markdown into McpConfig
   */
  private parseConfig(markdown: string): McpConfig {
    const servers: McpConfigServerEntry[] = [];
    let notes = '';

    const lines = markdown.split('\n');
    let currentServer: Partial<McpConfigServerEntry> | null = null;
    let inNotesSection = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]?.trim() || '';

      // Skip empty lines
      if (!line) continue;

      // Server name (### server-name)
      if (line.startsWith('### ')) {
        // Save previous server if exists
        if (currentServer && currentServer.name) {
          servers.push(currentServer as McpConfigServerEntry);
        }

        // Start new server
        currentServer = {
          name: line.substring(4).trim(),
          status: 'available', // Default
          description: '',
          command: '',
          autoStart: false
        };
        inNotesSection = false;
        continue;
      }

      // Notes section
      if (line.startsWith('**Notes**:') || line === '---') {
        inNotesSection = true;
        if (currentServer && currentServer.name) {
          servers.push(currentServer as McpConfigServerEntry);
          currentServer = null;
        }
        continue;
      }

      // If in notes section, collect notes
      if (inNotesSection) {
        notes += line + '\n';
        continue;
      }

      // Parse server fields
      if (currentServer) {
        // Status
        if (line.startsWith('**Status**:')) {
          const statusMatch = line.match(/\*\*Status\*\*:\s*(?:\[OK\]|\[ERROR\]|⏸️?|✅|❌)\s*(\w+)/);
          if (statusMatch && statusMatch[1]) {
            const statusText = statusMatch[1].toLowerCase();
            currentServer.status = statusText as McpConfigStatus;
          }
        }

        // Description
        else if (line.startsWith('**Description**:')) {
          currentServer.description = line.substring(16).trim();
        }

        // Command
        else if (line.startsWith('**Command**:')) {
          const commandMatch = line.match(/\*\*Command\*\*:\s*`([^`]+)`/);
          if (commandMatch && commandMatch[1]) {
            currentServer.command = commandMatch[1];
          }
        }

        // Args
        else if (line.startsWith('**Args**:')) {
          const argsText = line.substring(9).trim();
          currentServer.args = this.parseArgs(argsText);
        }

        // Env
        else if (line.startsWith('**Env**:')) {
          const envText = line.substring(8).trim();
          currentServer.env = this.parseEnv(envText);
        }

        // Transport
        else if (line.startsWith('**Transport**:')) {
          const transportMatch = line.match(/\*\*Transport\*\*:\s*(stdio|http)/i);
          if (transportMatch && transportMatch[1]) {
            currentServer.transport = transportMatch[1].toLowerCase() as McpTransportType;
          }
        }

        // URL (http transport)
        else if (line.startsWith('**URL**:')) {
          const urlMatch = line.match(/\*\*URL\*\*:\s*`?([^`]+?)`?\s*$/);
          if (urlMatch && urlMatch[1]) {
            currentServer.url = urlMatch[1].trim();
          }
        }

        // Headers (http transport)
        else if (line.startsWith('**Headers**:')) {
          const headersText = line.substring(12).trim();
          currentServer.headers = this.parseEnv(headersText);
        }

        // Auto-start
        else if (line.startsWith('**Auto-start**:')) {
          const autoStartMatch = line.match(/\*\*Auto-start\*\*:\s*(true|false|yes|no)/i);
          if (autoStartMatch && autoStartMatch[1]) {
            currentServer.autoStart = ['true', 'yes'].includes(autoStartMatch[1].toLowerCase());
          }
        }

        // Working Dir
        else if (line.startsWith('**Working Dir**:')) {
          currentServer.workingDir = line.substring(16).trim();
        }

        // Timeout
        else if (line.startsWith('**Timeout**:')) {
          const timeoutMatch = line.match(/\*\*Timeout\*\*:\s*(\d+)/);
          if (timeoutMatch && timeoutMatch[1]) {
            currentServer.timeout = parseInt(timeoutMatch[1], 10);
          }
        }
      }
    }

    // Save last server
    if (currentServer && currentServer.name) {
      servers.push(currentServer as McpConfigServerEntry);
    }

    return {
      servers,
      notes: notes.trim()
    };
  }

  /**
   * Parse args field (comma-separated or backtick-wrapped)
   */
  private parseArgs(argsText: string): string[] {
    const args: string[] = [];

    // Remove backticks and split by comma
    const cleaned = argsText.replace(/`/g, '');
    const parts = cleaned.split(',').map(s => s.trim());

    for (const part of parts) {
      if (part) {
        args.push(part);
      }
    }

    return args;
  }

  /**
   * Parse env field (KEY=value, comma-separated). Values may reference
   * environment variables via `${VAR}` syntax — substituted at parse time
   * from `process.env`. Unresolved placeholders are left verbatim so a
   * misconfig surfaces at connect time rather than as a bogus "Bearer "
   * header that the server only rejects with a 401.
   */
  private parseEnv(envText: string): Record<string, string> {
    const env: Record<string, string> = {};

    // Remove backticks and split by comma
    const cleaned = envText.replace(/`/g, '');
    const pairs = cleaned.split(',').map(s => s.trim());

    for (const pair of pairs) {
      const [key, ...valueParts] = pair.split('=');
      if (key && valueParts.length > 0) {
        const rawValue = valueParts.join('=').trim();
        env[key.trim()] = this.interpolateEnvVars(rawValue);
      }
    }

    return env;
  }

  /**
   * Replace `${VAR}` placeholders with `process.env[VAR]`. Leaves the
   * placeholder verbatim when the env var is unset (intentional — see
   * parseEnv() docstring).
   */
  private interpolateEnvVars(value: string): string {
    return value.replace(/\$\{([A-Z_][A-Z0-9_]*)\}/gi, (match, name) => {
      const resolved = process.env[name];
      return resolved !== undefined && resolved !== '' ? resolved : match;
    });
  }

  /**
   * Generate markdown from McpConfig
   */
  private generateMarkdown(config: McpConfig): string {
    let md = '# MCP Server Configuration\n\n';
    md += 'This file configures which MCP (Model Context Protocol) servers are automatically\n';
    md += 'enabled for this project. MCP servers provide additional tools and capabilities\n';
    md += 'beyond the base tool set.\n\n';

    // Group servers by status
    const enabled = config.servers.filter(s => s.status === 'enabled');
    const available = config.servers.filter(s => s.status === 'available');
    const disabled = config.servers.filter(s => s.status === 'disabled');

    // Enabled servers
    if (enabled.length > 0) {
      md += '## Enabled Servers\n\n';
      enabled.forEach(server => {
        md += this.generateServerEntry(server);
      });
    }

    // Available servers
    if (available.length > 0) {
      md += '## Available Servers\n\n';
      available.forEach(server => {
        md += this.generateServerEntry(server);
      });
    }

    // Disabled servers
    if (disabled.length > 0) {
      md += '## Disabled Servers\n\n';
      disabled.forEach(server => {
        md += this.generateServerEntry(server);
      });
    }

    // Notes
    if (config.notes) {
      md += '\n---\n\n';
      md += '**Notes**:\n';
      md += config.notes + '\n';
    } else {
      md += '\n---\n\n';
      md += '**Notes**:\n';
      md += '- Enabled servers auto-start when session begins\n';
      md += '- Available servers can be enabled on-demand\n';
      md += '- Custom servers require local installation\n';
    }

    return md;
  }

  /**
   * Generate markdown for a single server entry
   */
  private generateServerEntry(server: McpConfigServerEntry): string {
    let md = `### ${server.name}\n`;

    // Status emoji
    const emoji = server.status === 'enabled' ? '[OK]' : server.status === 'disabled' ? '[ERROR]' : '⏸';
    const statusText = server.status.charAt(0).toUpperCase() + server.status.slice(1);
    md += `**Status**: ${emoji} ${statusText}\n`;

    // Description
    md += `**Description**: ${server.description}\n`;

    // Transport (only emit when explicitly set or when http is implied by url)
    const effectiveTransport: McpTransportType =
      server.transport ?? (server.url ? 'http' : 'stdio');
    if (server.transport || server.url) {
      md += `**Transport**: ${effectiveTransport}\n`;
    }

    // HTTP transport: URL + Headers
    if (effectiveTransport === 'http') {
      if (server.url) {
        md += `**URL**: \`${server.url}\`\n`;
      }
      if (server.headers && Object.keys(server.headers).length > 0) {
        const headerPairs = Object.entries(server.headers).map(([k, v]) => `${k}=${v}`);
        md += `**Headers**: \`${headerPairs.join('`, `')}\`\n`;
      }
    } else {
      // stdio transport: Command + Args + Env
      if (server.command) {
        md += `**Command**: \`${server.command}\`\n`;
      }
      if (server.args && server.args.length > 0) {
        md += `**Args**: \`${server.args.join('`, `')}\`\n`;
      }
      if (server.env && Object.keys(server.env).length > 0) {
        const envPairs = Object.entries(server.env).map(([k, v]) => `${k}=${v}`);
        md += `**Env**: \`${envPairs.join('`, `')}\`\n`;
      }
    }

    // Auto-start
    if (server.autoStart !== undefined) {
      md += `**Auto-start**: ${server.autoStart}\n`;
    }

    // Working Dir
    if (server.workingDir) {
      md += `**Working Dir**: ${server.workingDir}\n`;
    }

    // Timeout
    if (server.timeout) {
      md += `**Timeout**: ${server.timeout}\n`;
    }

    md += '\n';
    return md;
  }

  /**
   * Merge project and global configs
   * Project config overrides global config
   */
  mergeConfigs(projectConfig: McpConfig | null, globalConfig: McpConfig | null): McpConfig | null {
    // No configs
    if (!projectConfig && !globalConfig) {
      return null;
    }

    // Only one config
    if (!projectConfig) return globalConfig;
    if (!globalConfig) return projectConfig;

    // Merge both configs
    const merged: McpConfig = {
      servers: [],
      notes: projectConfig.notes || globalConfig.notes
    };

    // Create map of project servers
    const projectServers = new Map(
      projectConfig.servers.map(s => [s.name, s])
    );

    // Start with global servers
    globalConfig.servers.forEach(globalServer => {
      const projectServer = projectServers.get(globalServer.name);

      if (projectServer) {
        // Project config overrides global
        merged.servers.push(projectServer);
        projectServers.delete(globalServer.name);
      } else {
        // Use global server
        merged.servers.push(globalServer);
      }
    });

    // Add remaining project-only servers
    projectServers.forEach(server => {
      merged.servers.push(server);
    });

    return merged;
  }

  /**
   * Convert McpConfigServerEntry to McpServerConfig
   */
  toServerConfig(entry: McpConfigServerEntry): McpServerConfig {
    return {
      name: entry.name,
      transport: entry.transport,
      command: entry.command,
      args: entry.args,
      env: entry.env,
      cwd: entry.workingDir,
      url: entry.url,
      headers: entry.headers,
      timeout: entry.timeout
    };
  }

  /**
   * Get enabled servers from config
   */
  getEnabledServers(config: McpConfig): McpConfigServerEntry[] {
    return config.servers.filter(s => s.status === 'enabled');
  }

  /**
   * Get auto-start servers from config
   */
  getAutoStartServers(config: McpConfig): McpConfigServerEntry[] {
    return config.servers.filter(s => s.status === 'enabled' && s.autoStart === true);
  }

  /**
   * Add or update a server in config
   */
  upsertServer(config: McpConfig, server: McpConfigServerEntry): McpConfig {
    const existingIndex = config.servers.findIndex(s => s.name === server.name);

    if (existingIndex >= 0) {
      // Update existing
      config.servers[existingIndex] = server;
    } else {
      // Add new
      config.servers.push(server);
    }

    return config;
  }

  /**
   * Remove a server from config
   */
  removeServer(config: McpConfig, serverName: string): McpConfig {
    config.servers = config.servers.filter(s => s.name !== serverName);
    return config;
  }

  /**
   * Update server status
   */
  updateServerStatus(
    config: McpConfig,
    serverName: string,
    status: McpConfigStatus
  ): McpConfig {
    const server = config.servers.find(s => s.name === serverName);
    if (server) {
      server.status = status;
    }
    return config;
  }
}
