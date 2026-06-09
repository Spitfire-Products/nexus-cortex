/**
 * McpConfigManager Unit Tests
 *
 * Tests the MCP_CONFIG.md parsing, writing, and management functionality including:
 * - Markdown parsing (valid, minimal, malformed)
 * - Config writing and generation
 * - Project/global config merging
 * - Server entry management (upsert, remove, update status)
 * - Helper methods (getAutoStartServers, etc.)
 *
 * Phase 2.5 Day 5: End-to-End Testing
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { McpConfigManager } from '../McpConfigManager.js';
import type { McpConfig, McpConfigServerEntry } from '../McpConfigManager.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import { tmpdir } from 'os';

describe('McpConfigManager', () => {
  let configManager: McpConfigManager;
  let testDir: string;

  beforeEach(async () => {
    // Create temp directory for testing
    testDir = path.join(tmpdir(), `mcp-config-test-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });

    configManager = new McpConfigManager(testDir);
  });

  afterEach(async () => {
    // Clean up test directory
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('Initialization', () => {
    it('should create config manager with project path', () => {
      expect(configManager).toBeDefined();
    });

    it('should create config manager without project path', () => {
      const manager = new McpConfigManager();
      expect(manager).toBeDefined();
    });
  });

  describe('configExists', () => {
    it('should return false when config does not exist', async () => {
      const exists = await configManager.configExists('project');
      expect(exists).toBe(false);
    });

    it('should return true when project config exists', async () => {
      const configPath = path.join(testDir, 'MCP_CONFIG.md');
      await fs.writeFile(configPath, '# MCP Server Configuration');

      const exists = await configManager.configExists('project');
      expect(exists).toBe(true);
    });

    it('should handle global config path', async () => {
      // Global config exists check (won't actually exist in test)
      const exists = await configManager.configExists('global');
      expect(typeof exists).toBe('boolean');
    });
  });

  describe('readConfig', () => {
    it('should return null when config does not exist', async () => {
      const config = await configManager.readConfig('project');
      expect(config).toBeNull();
    });

    it('should parse valid config file', async () => {
      const configContent = `# MCP Server Configuration

## Enabled Servers

### filesystem
**Status**: ✅ Enabled
**Description**: File system operations
**Command**: \`npx -y @modelcontextprotocol/server-filesystem\`
**Args**: \`/workspace\`
**Auto-start**: true
**Timeout**: 30000
`;

      const configPath = path.join(testDir, 'MCP_CONFIG.md');
      await fs.writeFile(configPath, configContent);

      const config = await configManager.readConfig('project');

      expect(config).toBeDefined();
      expect(config?.servers).toHaveLength(1);
      expect(config?.servers[0]?.name).toBe('filesystem');
      expect(config?.servers[0]?.status).toBe('enabled');
      expect(config?.servers[0]?.description).toBe('File system operations');
      expect(config?.servers[0]?.command).toBe('npx -y @modelcontextprotocol/server-filesystem');
      expect(config?.servers[0]?.args).toEqual(['/workspace']);
      expect(config?.servers[0]?.autoStart).toBe(true);
      expect(config?.servers[0]?.timeout).toBe(30000);
    });

    it('should parse config with multiple servers', async () => {
      const configContent = `# MCP Server Configuration

## Enabled Servers

### filesystem
**Status**: ✅ Enabled
**Description**: File operations
**Command**: \`npx\`
**Args**: \`-y\`, \`@modelcontextprotocol/server-filesystem\`, \`/workspace\`
**Auto-start**: true

### postgres
**Status**: ✅ Enabled
**Description**: Database operations
**Command**: \`npx\`
**Args**: \`-y\`, \`@modelcontextprotocol/server-postgres\`
**Env**: \`DATABASE_URL=postgresql://localhost\`
**Auto-start**: false
`;

      const configPath = path.join(testDir, 'MCP_CONFIG.md');
      await fs.writeFile(configPath, configContent);

      const config = await configManager.readConfig('project');

      expect(config?.servers).toHaveLength(2);
      expect(config?.servers[0]?.name).toBe('filesystem');
      expect(config?.servers[1]?.name).toBe('postgres');
      expect(config?.servers[1]?.env).toEqual({ DATABASE_URL: 'postgresql://localhost' });
    });

    it('should handle minimal config (only required fields)', async () => {
      const configContent = `# MCP Server Configuration

### myserver
**Status**: ✅ Enabled
**Description**: My server
**Command**: \`node server.js\`
`;

      const configPath = path.join(testDir, 'MCP_CONFIG.md');
      await fs.writeFile(configPath, configContent);

      const config = await configManager.readConfig('project');

      expect(config?.servers).toHaveLength(1);
      expect(config?.servers[0]?.name).toBe('myserver');
      expect(config?.servers[0]?.status).toBe('enabled');
      expect(config?.servers[0]?.autoStart).toBe(false); // Default
    });

    it('should handle different status values', async () => {
      const configContent = `# MCP Server Configuration

### server1
**Status**: ✅ Enabled
**Description**: Server 1
**Command**: \`cmd1\`

### server2
**Status**: ⏸️ Available
**Description**: Server 2
**Command**: \`cmd2\`

### server3
**Status**: ❌ Disabled
**Description**: Server 3
**Command**: \`cmd3\`
`;

      const configPath = path.join(testDir, 'MCP_CONFIG.md');
      await fs.writeFile(configPath, configContent);

      const config = await configManager.readConfig('project');

      expect(config?.servers).toHaveLength(3);
      expect(config?.servers[0]?.status).toBe('enabled');
      expect(config?.servers[1]?.status).toBe('available');
      expect(config?.servers[2]?.status).toBe('disabled');
    });

    it('should parse args correctly', async () => {
      const configContent = `# MCP Server Configuration

### server1
**Status**: ✅ Enabled
**Description**: Test
**Command**: \`npx\`
**Args**: \`-y\`, \`@package/name\`, \`arg1\`, \`arg2\`
`;

      const configPath = path.join(testDir, 'MCP_CONFIG.md');
      await fs.writeFile(configPath, configContent);

      const config = await configManager.readConfig('project');

      expect(config?.servers[0]?.args).toEqual(['-y', '@package/name', 'arg1', 'arg2']);
    });

    it('should parse env correctly', async () => {
      const configContent = `# MCP Server Configuration

### server1
**Status**: ✅ Enabled
**Description**: Test
**Command**: \`cmd\`
**Env**: \`KEY1=value1\`, \`KEY2=value2\`, \`KEY3=value=with=equals\`
`;

      const configPath = path.join(testDir, 'MCP_CONFIG.md');
      await fs.writeFile(configPath, configContent);

      const config = await configManager.readConfig('project');

      expect(config?.servers[0]?.env).toEqual({
        KEY1: 'value1',
        KEY2: 'value2',
        KEY3: 'value=with=equals'
      });
    });

    it('should handle config with notes section', async () => {
      const configContent = `# MCP Server Configuration

### server1
**Status**: ✅ Enabled
**Description**: Test
**Command**: \`cmd\`

---

**Notes**:
- This is a note
- Another note
`;

      const configPath = path.join(testDir, 'MCP_CONFIG.md');
      await fs.writeFile(configPath, configContent);

      const config = await configManager.readConfig('project');

      expect(config?.notes).toBeDefined();
      expect(config?.notes).toContain('This is a note');
    });
  });

  describe('writeConfig', () => {
    it('should write valid config file', async () => {
      const config: McpConfig = {
        servers: [
          {
            name: 'filesystem',
            status: 'enabled',
            description: 'File operations',
            command: 'npx -y @modelcontextprotocol/server-filesystem',
            args: ['/workspace'],
            autoStart: true,
            timeout: 30000
          }
        ]
      };

      await configManager.writeConfig('project', config);

      const configPath = path.join(testDir, 'MCP_CONFIG.md');
      const exists = await fs.access(configPath).then(() => true).catch(() => false);
      expect(exists).toBe(true);

      const content = await fs.readFile(configPath, 'utf-8');
      expect(content).toContain('# MCP Server Configuration');
      expect(content).toContain('### filesystem');
      expect(content).toContain('**Status**: ✅ Enabled');
      expect(content).toContain('**Auto-start**: true');
    });

    it('should group servers by status', async () => {
      const config: McpConfig = {
        servers: [
          {
            name: 'server1',
            status: 'enabled',
            description: 'Enabled server',
            command: 'cmd1'
          },
          {
            name: 'server2',
            status: 'available',
            description: 'Available server',
            command: 'cmd2'
          },
          {
            name: 'server3',
            status: 'disabled',
            description: 'Disabled server',
            command: 'cmd3'
          }
        ]
      };

      await configManager.writeConfig('project', config);

      const configPath = path.join(testDir, 'MCP_CONFIG.md');
      const content = await fs.readFile(configPath, 'utf-8');

      expect(content).toContain('## Enabled Servers');
      expect(content).toContain('## Available Servers');
      expect(content).toContain('## Disabled Servers');
    });

    it('should create directory if it does not exist', async () => {
      const deepDir = path.join(testDir, 'deep', 'nested', 'path');
      const manager = new McpConfigManager(deepDir);

      const config: McpConfig = {
        servers: [{
          name: 'test',
          status: 'enabled',
          description: 'Test',
          command: 'test'
        }]
      };

      await manager.writeConfig('project', config);

      const configPath = path.join(deepDir, 'MCP_CONFIG.md');
      const exists = await fs.access(configPath).then(() => true).catch(() => false);
      expect(exists).toBe(true);

      // Cleanup
      await fs.rm(path.join(testDir, 'deep'), { recursive: true, force: true });
    });
  });

  describe('mergeConfigs', () => {
    it('should return null when both configs are null', () => {
      const merged = configManager.mergeConfigs(null, null);
      expect(merged).toBeNull();
    });

    it('should return project config when global is null', () => {
      const projectConfig: McpConfig = {
        servers: [{ name: 'server1', status: 'enabled', description: 'Test', command: 'cmd' }]
      };

      const merged = configManager.mergeConfigs(projectConfig, null);
      expect(merged).toEqual(projectConfig);
    });

    it('should return global config when project is null', () => {
      const globalConfig: McpConfig = {
        servers: [{ name: 'server1', status: 'enabled', description: 'Test', command: 'cmd' }]
      };

      const merged = configManager.mergeConfigs(null, globalConfig);
      expect(merged).toEqual(globalConfig);
    });

    it('should merge unique servers from both configs', () => {
      const projectConfig: McpConfig = {
        servers: [{ name: 'server1', status: 'enabled', description: 'Project', command: 'cmd1' }]
      };

      const globalConfig: McpConfig = {
        servers: [{ name: 'server2', status: 'enabled', description: 'Global', command: 'cmd2' }]
      };

      const merged = configManager.mergeConfigs(projectConfig, globalConfig);

      expect(merged?.servers).toHaveLength(2);
      expect(merged?.servers.some(s => s.name === 'server1')).toBe(true);
      expect(merged?.servers.some(s => s.name === 'server2')).toBe(true);
    });

    it('should override global servers with project servers (same name)', () => {
      const projectConfig: McpConfig = {
        servers: [{
          name: 'filesystem',
          status: 'enabled',
          description: 'Project filesystem',
          command: 'project-cmd',
          args: ['/project']
        }]
      };

      const globalConfig: McpConfig = {
        servers: [{
          name: 'filesystem',
          status: 'enabled',
          description: 'Global filesystem',
          command: 'global-cmd',
          args: ['/global']
        }]
      };

      const merged = configManager.mergeConfigs(projectConfig, globalConfig);

      expect(merged?.servers).toHaveLength(1);
      expect(merged?.servers[0]?.description).toBe('Project filesystem');
      expect(merged?.servers[0]?.command).toBe('project-cmd');
      expect(merged?.servers[0]?.args).toEqual(['/project']);
    });

    it('should prefer project notes over global notes', () => {
      const projectConfig: McpConfig = {
        servers: [],
        notes: 'Project notes'
      };

      const globalConfig: McpConfig = {
        servers: [],
        notes: 'Global notes'
      };

      const merged = configManager.mergeConfigs(projectConfig, globalConfig);
      expect(merged?.notes).toBe('Project notes');
    });
  });

  describe('getEnabledServers', () => {
    it('should return only enabled servers', () => {
      const config: McpConfig = {
        servers: [
          { name: 's1', status: 'enabled', description: 'Test', command: 'cmd' },
          { name: 's2', status: 'available', description: 'Test', command: 'cmd' },
          { name: 's3', status: 'enabled', description: 'Test', command: 'cmd' },
          { name: 's4', status: 'disabled', description: 'Test', command: 'cmd' }
        ]
      };

      const enabled = configManager.getEnabledServers(config);
      expect(enabled).toHaveLength(2);
      expect(enabled.every(s => s.status === 'enabled')).toBe(true);
    });

    it('should return empty array when no enabled servers', () => {
      const config: McpConfig = {
        servers: [
          { name: 's1', status: 'available', description: 'Test', command: 'cmd' },
          { name: 's2', status: 'disabled', description: 'Test', command: 'cmd' }
        ]
      };

      const enabled = configManager.getEnabledServers(config);
      expect(enabled).toHaveLength(0);
    });
  });

  describe('getAutoStartServers', () => {
    it('should return only enabled servers with autoStart true', () => {
      const config: McpConfig = {
        servers: [
          { name: 's1', status: 'enabled', description: 'Test', command: 'cmd', autoStart: true },
          { name: 's2', status: 'enabled', description: 'Test', command: 'cmd', autoStart: false },
          { name: 's3', status: 'available', description: 'Test', command: 'cmd', autoStart: true },
          { name: 's4', status: 'enabled', description: 'Test', command: 'cmd', autoStart: true }
        ]
      };

      const autoStart = configManager.getAutoStartServers(config);
      expect(autoStart).toHaveLength(2);
      expect(autoStart.every(s => s.status === 'enabled' && s.autoStart === true)).toBe(true);
    });

    it('should return empty array when no auto-start servers', () => {
      const config: McpConfig = {
        servers: [
          { name: 's1', status: 'enabled', description: 'Test', command: 'cmd', autoStart: false }
        ]
      };

      const autoStart = configManager.getAutoStartServers(config);
      expect(autoStart).toHaveLength(0);
    });
  });

  describe('toServerConfig', () => {
    it('should convert config entry to server config', () => {
      const entry: McpConfigServerEntry = {
        name: 'filesystem',
        status: 'enabled',
        description: 'File operations',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', '/workspace'],
        env: { KEY: 'value' },
        workingDir: '/tmp',
        timeout: 30000
      };

      const serverConfig = configManager.toServerConfig(entry);

      expect(serverConfig.name).toBe('filesystem');
      expect(serverConfig.command).toBe('npx');
      expect(serverConfig.args).toEqual(['-y', '@modelcontextprotocol/server-filesystem', '/workspace']);
      expect(serverConfig.env).toEqual({ KEY: 'value' });
      expect(serverConfig.cwd).toBe('/tmp');
      expect(serverConfig.timeout).toBe(30000);
    });
  });

  describe('upsertServer', () => {
    it('should add new server', () => {
      const config: McpConfig = {
        servers: [
          { name: 's1', status: 'enabled', description: 'Test', command: 'cmd' }
        ]
      };

      const newServer: McpConfigServerEntry = {
        name: 's2',
        status: 'enabled',
        description: 'New server',
        command: 'cmd2'
      };

      const updated = configManager.upsertServer(config, newServer);
      expect(updated.servers).toHaveLength(2);
      expect(updated.servers.some(s => s.name === 's2')).toBe(true);
    });

    it('should update existing server', () => {
      const config: McpConfig = {
        servers: [
          { name: 's1', status: 'enabled', description: 'Old', command: 'old-cmd' }
        ]
      };

      const updatedServer: McpConfigServerEntry = {
        name: 's1',
        status: 'disabled',
        description: 'Updated',
        command: 'new-cmd'
      };

      const updated = configManager.upsertServer(config, updatedServer);
      expect(updated.servers).toHaveLength(1);
      expect(updated.servers[0]?.description).toBe('Updated');
      expect(updated.servers[0]?.status).toBe('disabled');
    });
  });

  describe('removeServer', () => {
    it('should remove server by name', () => {
      const config: McpConfig = {
        servers: [
          { name: 's1', status: 'enabled', description: 'Test', command: 'cmd' },
          { name: 's2', status: 'enabled', description: 'Test', command: 'cmd' }
        ]
      };

      const updated = configManager.removeServer(config, 's1');
      expect(updated.servers).toHaveLength(1);
      expect(updated.servers[0]?.name).toBe('s2');
    });

    it('should handle removing non-existent server', () => {
      const config: McpConfig = {
        servers: [
          { name: 's1', status: 'enabled', description: 'Test', command: 'cmd' }
        ]
      };

      const updated = configManager.removeServer(config, 'nonexistent');
      expect(updated.servers).toHaveLength(1);
    });
  });

  describe('env-var interpolation in Headers / Env values', () => {
    afterEach(() => {
      delete process.env.__TEST_NEXUS_BROWSER_KEY;
      delete process.env.__TEST_GH_TOKEN;
    });

    it('substitutes ${VAR} in Headers values from process.env', async () => {
      process.env.__TEST_NEXUS_BROWSER_KEY = 'nb_test_secret';

      const md = `# MCP Server Configuration

## Enabled Servers

### nexus-browser
**Status**: ✅ Enabled
**Description**: HTTP MCP test
**Transport**: http
**URL**: \`https://example.com/mcp\`
**Headers**: \`Authorization=Bearer \${__TEST_NEXUS_BROWSER_KEY}\`
**Auto-start**: true
`;

      const filePath = path.join(testDir, 'MCP_CONFIG.md');
      await fs.writeFile(filePath, md, 'utf-8');

      const cfg = await configManager.readConfig('project');
      expect(cfg).not.toBeNull();
      const server = cfg!.servers.find((s) => s.name === 'nexus-browser');
      expect(server).toBeDefined();
      expect(server!.headers).toEqual({
        Authorization: 'Bearer nb_test_secret',
      });
    });

    it('substitutes ${VAR} in Env values from process.env', async () => {
      process.env.__TEST_GH_TOKEN = 'ghp_test123';

      const md = `# MCP Server Configuration

## Enabled Servers

### github
**Status**: ✅ Enabled
**Description**: stdio test
**Command**: \`npx\`
**Args**: \`-y\`, \`gh-mcp\`
**Env**: \`GITHUB_TOKEN=\${__TEST_GH_TOKEN}\`
**Auto-start**: true
`;

      const filePath = path.join(testDir, 'MCP_CONFIG.md');
      await fs.writeFile(filePath, md, 'utf-8');

      const cfg = await configManager.readConfig('project');
      expect(cfg).not.toBeNull();
      const server = cfg!.servers.find((s) => s.name === 'github');
      expect(server!.env).toEqual({ GITHUB_TOKEN: 'ghp_test123' });
    });

    it('leaves ${VAR} placeholder verbatim when env var is missing', async () => {
      delete process.env.__TEST_MISSING;

      const md = `# MCP Server Configuration

## Enabled Servers

### no-key
**Status**: ✅ Enabled
**Description**: HTTP MCP test
**Transport**: http
**URL**: \`https://example.com/mcp\`
**Headers**: \`Authorization=Bearer \${__TEST_MISSING}\`
**Auto-start**: true
`;

      const filePath = path.join(testDir, 'MCP_CONFIG.md');
      await fs.writeFile(filePath, md, 'utf-8');

      const cfg = await configManager.readConfig('project');
      const server = cfg!.servers.find((s) => s.name === 'no-key');
      // Placeholder retained verbatim so misconfig is visible at connect time
      // rather than producing an "Authorization: Bearer " header that looks
      // valid until the server returns 401.
      expect(server!.headers!.Authorization).toBe('Bearer ${__TEST_MISSING}');
    });
  });

  describe('updateServerStatus', () => {
    it('should update server status', () => {
      const config: McpConfig = {
        servers: [
          { name: 's1', status: 'enabled', description: 'Test', command: 'cmd' }
        ]
      };

      const updated = configManager.updateServerStatus(config, 's1', 'disabled');
      expect(updated.servers[0]?.status).toBe('disabled');
    });

    it('should handle updating non-existent server', () => {
      const config: McpConfig = {
        servers: [
          { name: 's1', status: 'enabled', description: 'Test', command: 'cmd' }
        ]
      };

      const updated = configManager.updateServerStatus(config, 'nonexistent', 'disabled');
      expect(updated.servers[0]?.status).toBe('enabled'); // Unchanged
    });
  });
});
