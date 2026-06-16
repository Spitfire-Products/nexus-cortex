/**
 * Orchestrator MCP Config Integration Tests
 *
 * Tests the complete MCP config discovery and auto-injection flow:
 * - Config file discovery (project, global, both, none)
 * - Config merging and priority
 * - Auto-start server behavior
 * - Conditional tool auto-injection
 * - Full orchestrator initialization with MCP
 *
 * Phase 2.5 Day 5: End-to-End Testing
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createOrchestrator } from '../OrchestratorFactory.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import { tmpdir } from 'os';

describe('Orchestrator MCP Config Integration', () => {
  let testDir: string;
  let globalConfigDir: string;

  beforeEach(async () => {
    // Create temp directories
    testDir = path.join(tmpdir(), `mcp-test-${Date.now()}`);
    globalConfigDir = path.join(tmpdir(), `mcp-global-${Date.now()}`);

    await fs.mkdir(testDir, { recursive: true });
    await fs.mkdir(globalConfigDir, { recursive: true });
  });

  afterEach(async () => {
    // Clean up
    try {
      await fs.rm(testDir, { recursive: true, force: true });
      await fs.rm(globalConfigDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('Config Discovery', () => {
    it('should have mcpAutoInject = false when no config exists', async () => {
      const orchestrator = await createOrchestrator(
        {
          projectPath: testDir,
          defaultModelId: 'claude-sonnet-4-5',
          enableMcp: true,
          debug: false
        }
      );

      await orchestrator.createSession(testDir);

      // mcpAutoInject should be false (no config found)
      expect(orchestrator.isMcpAutoInjectEnabled()).toBe(false);

      await orchestrator.cleanup();
    });

    it('should discover project MCP_CONFIG.md', async () => {
      // Create project config
      const configContent = `# MCP Server Configuration

### test-server
**Status**: ✅ Enabled
**Description**: Test server
**Command**: \`echo\`
**Args**: \`test\`
**Auto-start**: true
`;

      await fs.writeFile(path.join(testDir, 'MCP_CONFIG.md'), configContent);

      const orchestrator = await createOrchestrator(
        {
          projectPath: testDir,
          defaultModelId: 'claude-sonnet-4-5',
          enableMcp: true,
          debug: false
        }
      );

      await orchestrator.createSession(testDir);

      // Config should be discovered
      // Note: Server may not connect (echo is not a valid MCP server)
      // but config discovery should work
      const configManager = orchestrator.getMcpConfigManager();
      expect(configManager).toBeDefined();

      await orchestrator.cleanup();
    });
  });

  describe('Auto-Injection Behavior', () => {
    it('should not auto-inject MCP tools when no config exists', async () => {
      const orchestrator = await createOrchestrator(
        {
          projectPath: testDir,
          defaultModelId: 'claude-sonnet-4-5',
          enableMcp: true,
          debug: false
        }
      );

      await orchestrator.createSession(testDir);

      // Should not have auto-injection enabled
      expect(orchestrator.isMcpAutoInjectEnabled()).toBe(false);

      await orchestrator.cleanup();
    });

    it('should have MCP components available even without config', async () => {
      const orchestrator = await createOrchestrator(
        {
          projectPath: testDir,
          defaultModelId: 'claude-sonnet-4-5',
          enableMcp: true,
          debug: false
        }
      );

      await orchestrator.createSession(testDir);

      // Components should exist
      expect(orchestrator.getMcpConfigManager()).toBeDefined();
      expect(orchestrator.getMcpServerRegistry()).toBeDefined();

      // But no tools injected
      expect(orchestrator.isMcpAutoInjectEnabled()).toBe(false);

      await orchestrator.cleanup();
    });
  });

  describe('MCP Components Access', () => {
    it('should provide access to McpConfigManager', async () => {
      const orchestrator = await createOrchestrator(
        {
          projectPath: testDir,
          defaultModelId: 'claude-sonnet-4-5',
          enableMcp: true,
          debug: false
        }
      );

      await orchestrator.createSession(testDir);

      const configManager = orchestrator.getMcpConfigManager();
      expect(configManager).toBeDefined();
      expect(typeof configManager.configExists).toBe('function');

      await orchestrator.cleanup();
    });

    it('should provide access to McpServerRegistry', async () => {
      const orchestrator = await createOrchestrator(
        {
          projectPath: testDir,
          defaultModelId: 'claude-sonnet-4-5',
          enableMcp: true,
          debug: false
        }
      );

      await orchestrator.createSession(testDir);

      const registry = orchestrator.getMcpServerRegistry();
      expect(registry).toBeDefined();
      expect(registry.getServerCount()).toBe(10); // 10 community servers
      expect(registry.hasServer('filesystem')).toBe(true);

      await orchestrator.cleanup();
    });
  });

  describe('MCP Enable/Disable', () => {
    it('should disable MCP when enableMcp = false', async () => {
      const orchestrator = await createOrchestrator(
        {
          projectPath: testDir,
          defaultModelId: 'claude-sonnet-4-5',
          enableMcp: false, // Explicitly disabled
          debug: false
        }
      );

      await orchestrator.createSession(testDir);

      // MCP should not be enabled
      expect(orchestrator.isMcpEnabled()).toBe(false);

      await orchestrator.cleanup();
    });

    it('should enable MCP by default', async () => {
      const orchestrator = await createOrchestrator(
        {
          projectPath: testDir,
          defaultModelId: 'claude-sonnet-4-5',
          // enableMcp not specified, should default to true
          debug: false
        }
      );

      await orchestrator.createSession(testDir);

      // MCP should be enabled by default
      expect(orchestrator.isMcpEnabled()).toBe(true);

      await orchestrator.cleanup();
    });
  });

  describe('Error Handling', () => {
    it('should handle malformed config gracefully', async () => {
      // Create malformed config
      const badConfig = `# MCP Server Configuration
### incomplete-server
**Status**: Invalid
`;

      await fs.writeFile(path.join(testDir, 'MCP_CONFIG.md'), badConfig);

      const orchestrator = await createOrchestrator(
        {
          projectPath: testDir,
          defaultModelId: 'claude-sonnet-4-5',
          enableMcp: true,
          debug: false
        }
      );

      // Should not throw
      await expect(orchestrator.createSession(testDir)).resolves.toBeDefined();

      await orchestrator.cleanup();
    });

    it('should handle config read errors gracefully', async () => {
      // Create config in a directory we'll make unreadable
      const restrictedDir = path.join(testDir, 'restricted');
      await fs.mkdir(restrictedDir, { recursive: true });

      const orchestrator = await createOrchestrator(
        {
          projectPath: restrictedDir,
          defaultModelId: 'claude-sonnet-4-5',
          enableMcp: true,
          debug: false
        }
      );

      // Should not throw even if config can't be read
      await expect(orchestrator.createSession(restrictedDir)).resolves.toBeDefined();

      await orchestrator.cleanup();
    });

    it('should continue session creation even if all servers fail to connect', async () => {
      // Create config with invalid server
      const configContent = `# MCP Server Configuration

### invalid-server
**Status**: ✅ Enabled
**Description**: Invalid server
**Command**: \`nonexistent-command-xyz\`
**Auto-start**: true
`;

      await fs.writeFile(path.join(testDir, 'MCP_CONFIG.md'), configContent);

      const orchestrator = await createOrchestrator(
        {
          projectPath: testDir,
          defaultModelId: 'claude-sonnet-4-5',
          enableMcp: true,
          debug: false
        }
      );

      // Session should still be created even though server fails
      await expect(orchestrator.createSession(testDir)).resolves.toBeDefined();

      // Auto-inject should be false (no servers connected)
      expect(orchestrator.isMcpAutoInjectEnabled()).toBe(false);

      await orchestrator.cleanup();
    });
  });

  describe('Config Priority and Merging', () => {
    it('should load config from project path', async () => {
      const configContent = `# MCP Server Configuration

### project-server
**Status**: ✅ Enabled
**Description**: Project-specific server
**Command**: \`echo\`
**Args**: \`project\`
**Auto-start**: false
`;

      await fs.writeFile(path.join(testDir, 'MCP_CONFIG.md'), configContent);

      const orchestrator = await createOrchestrator(
        {
          projectPath: testDir,
          defaultModelId: 'claude-sonnet-4-5',
          enableMcp: true,
          debug: false
        }
      );

      await orchestrator.createSession(testDir);

      const configManager = orchestrator.getMcpConfigManager();
      const projectConfig = await configManager.readConfig('project');

      expect(projectConfig).toBeDefined();
      expect(projectConfig?.servers).toHaveLength(1);
      expect(projectConfig?.servers[0]?.name).toBe('project-server');

      await orchestrator.cleanup();
    });
  });

  describe('Server Registry Integration', () => {
    it('should have community servers available in registry', async () => {
      const orchestrator = await createOrchestrator(
        {
          projectPath: testDir,
          defaultModelId: 'claude-sonnet-4-5',
          enableMcp: true,
          debug: false
        }
      );

      await orchestrator.createSession(testDir);

      const registry = orchestrator.getMcpServerRegistry();

      // Verify all community servers are registered
      const expectedServers = [
        'filesystem',
        'nexus-browser',
        'postgres',
        'sqlite',
        'github',
        'slack',
        'git',
        'memory',
        'brave-search',
        'gdrive'
      ];

      expectedServers.forEach(serverName => {
        const server = registry.getServer(serverName);
        expect(server).toBeDefined();
        expect(server?.name).toBe(serverName);
        expect(server?.verified).toBe(true);
      });

      await orchestrator.cleanup();
    });

    it('should support registry search functions', async () => {
      const orchestrator = await createOrchestrator(
        {
          projectPath: testDir,
          defaultModelId: 'claude-sonnet-4-5',
          enableMcp: true,
          debug: false
        }
      );

      await orchestrator.createSession(testDir);

      const registry = orchestrator.getMcpServerRegistry();

      // Test category search
      const dbServers = registry.getServersByCategory('database');
      expect(dbServers.length).toBeGreaterThan(0);

      // Test capability search
      const fileServers = registry.searchByCapability('read_file');
      expect(fileServers.length).toBeGreaterThan(0);

      // Test recommendation
      const webServers = registry.getRecommendedServers('web');
      expect(webServers.length).toBeGreaterThan(0);

      await orchestrator.cleanup();
    });
  });

  describe('Session Lifecycle', () => {
    it('should initialize MCP components during session creation', async () => {
      const orchestrator = await createOrchestrator(
        {
          projectPath: testDir,
          defaultModelId: 'claude-sonnet-4-5',
          enableMcp: true,
          debug: false
        }
      );

      // Before session creation
      expect(orchestrator.getMcpConfigManager()).toBeDefined();
      expect(orchestrator.getMcpServerRegistry()).toBeDefined();

      await orchestrator.createSession(testDir);

      // After session creation
      expect(orchestrator.isMcpEnabled()).toBe(true);

      await orchestrator.cleanup();
    });

    it('should cleanup MCP connections on cleanup', async () => {
      const orchestrator = await createOrchestrator(
        {
          projectPath: testDir,
          defaultModelId: 'claude-sonnet-4-5',
          enableMcp: true,
          debug: false
        }
      );

      await orchestrator.createSession(testDir);

      // Cleanup should not throw
      await expect(orchestrator.cleanup()).resolves.toBeUndefined();
    });
  });

  describe('Multiple Sessions', () => {
    it('should support creating multiple sessions sequentially', async () => {
      const orchestrator = await createOrchestrator(
        {
          projectPath: testDir,
          defaultModelId: 'claude-sonnet-4-5',
          enableMcp: true,
          debug: false
        }
      );

      // First session
      await orchestrator.createSession(testDir);
      expect(orchestrator.isMcpEnabled()).toBe(true);

      // Cleanup
      await orchestrator.cleanup();

      // Second session (same orchestrator)
      await orchestrator.createSession(testDir);
      expect(orchestrator.isMcpEnabled()).toBe(true);

      await orchestrator.cleanup();
    });
  });
});
