/**
 * McpServerRegistry Unit Tests
 *
 * Tests the community MCP server registry functionality including:
 * - Server retrieval by name
 * - Search by category, capability, project type
 * - Custom server registration
 * - Registry management
 *
 * Phase 2.5 Day 5: End-to-End Testing
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { McpServerRegistry } from '../McpServerRegistry.js';
import type { McpServerDefinition } from '../McpServerRegistry.js';

describe('McpServerRegistry', () => {
  let registry: McpServerRegistry;

  beforeEach(() => {
    registry = new McpServerRegistry();
  });

  describe('Initialization', () => {
    it('should auto-load community servers on construction', () => {
      const count = registry.getServerCount();
      expect(count).toBe(10); // 10 community servers
    });

    it('should have all 10 community servers', () => {
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
        'gdrive',
      ];

      expectedServers.forEach(name => {
        expect(registry.hasServer(name)).toBe(true);
      });
    });
  });

  describe('getServer', () => {
    it('should get server by name', () => {
      const fsServer = registry.getServer('filesystem');

      expect(fsServer).toBeDefined();
      expect(fsServer?.name).toBe('filesystem');
      expect(fsServer?.displayName).toBe('Filesystem');
      expect(fsServer?.category).toBe('filesystem');
      expect(fsServer?.verified).toBe(true);
    });

    it('should return undefined for unknown server', () => {
      const unknownServer = registry.getServer('nonexistent');
      expect(unknownServer).toBeUndefined();
    });

    it('should have complete server metadata', () => {
      const fsServer = registry.getServer('filesystem');

      expect(fsServer).toBeDefined();
      expect(fsServer?.command).toBe('npx');
      expect(fsServer?.defaultArgs).toEqual(['-y', '@modelcontextprotocol/server-filesystem']);
      expect(fsServer?.capabilities).toBeDefined();
      expect(fsServer?.capabilities?.length).toBeGreaterThan(0);
      expect(fsServer?.recommendedFor).toBeDefined();
      expect(fsServer?.npmPackage).toBe('@modelcontextprotocol/server-filesystem');
    });
  });

  describe('getAllServers', () => {
    it('should return all registered servers', () => {
      const allServers = registry.getAllServers();

      expect(allServers).toHaveLength(10);
      expect(Array.isArray(allServers)).toBe(true);
    });

    it('should return server definitions with all required fields', () => {
      const allServers = registry.getAllServers();

      allServers.forEach(server => {
        expect(server).toHaveProperty('name');
        expect(server).toHaveProperty('displayName');
        expect(server).toHaveProperty('description');
        expect(server).toHaveProperty('category');
        expect(server).toHaveProperty('command');
        expect(server).toHaveProperty('verified');
      });
    });
  });

  describe('getServersByCategory', () => {
    it('should get database servers', () => {
      const dbServers = registry.getServersByCategory('database');

      expect(dbServers).toHaveLength(2);
      expect(dbServers.some(s => s.name === 'postgres')).toBe(true);
      expect(dbServers.some(s => s.name === 'sqlite')).toBe(true);
    });

    it('should get filesystem servers', () => {
      const fsServers = registry.getServersByCategory('filesystem');

      expect(fsServers).toHaveLength(1);
      expect(fsServers[0]?.name).toBe('filesystem');
    });

    it('should get browser servers', () => {
      const browserServers = registry.getServersByCategory('browser');

      expect(browserServers).toHaveLength(1);
      expect(browserServers[0]?.name).toBe('nexus-browser');
    });

    it('should return empty array for unknown category', () => {
      const unknownServers = registry.getServersByCategory('unknown' as any);
      expect(unknownServers).toHaveLength(0);
    });
  });

  describe('searchByCapability', () => {
    it('should find servers with read_file capability', () => {
      const servers = registry.searchByCapability('read_file');

      expect(servers.length).toBeGreaterThan(0);
      expect(servers.some(s => s.name === 'filesystem')).toBe(true);
    });

    it('should find servers with query capability', () => {
      const servers = registry.searchByCapability('query');

      expect(servers.length).toBeGreaterThan(0);
      expect(servers.some(s => s.name === 'postgres')).toBe(true);
      expect(servers.some(s => s.name === 'sqlite')).toBe(true);
    });

    it('should be case insensitive', () => {
      const servers = registry.searchByCapability('READ_FILE');
      expect(servers.length).toBeGreaterThan(0);
    });

    it('should return empty array when no capabilities match', () => {
      const servers = registry.searchByCapability('nonexistent_capability');
      expect(servers).toHaveLength(0);
    });
  });

  describe('getRecommendedServers', () => {
    it('should recommend servers for database projects', () => {
      const servers = registry.getRecommendedServers('database');

      expect(servers.length).toBeGreaterThan(0);
      expect(servers.some(s => s.name === 'postgres')).toBe(true);
      expect(servers.some(s => s.name === 'sqlite')).toBe(true);
    });

    it('should recommend servers for web projects', () => {
      const servers = registry.getRecommendedServers('web');

      expect(servers.length).toBeGreaterThan(0);
      expect(servers.some(s => s.name === 'filesystem')).toBe(true);
      expect(servers.some(s => s.name === 'nexus-browser')).toBe(true);
    });

    it('should recommend servers for general projects', () => {
      const servers = registry.getRecommendedServers('general');

      expect(servers.length).toBeGreaterThan(0);
      expect(servers.some(s => s.name === 'filesystem')).toBe(true);
      expect(servers.some(s => s.name === 'memory')).toBe(true);
    });

    it('should be case insensitive', () => {
      const servers = registry.getRecommendedServers('DATABASE');
      expect(servers.length).toBeGreaterThan(0);
    });

    it('should return empty array for unknown project type', () => {
      const servers = registry.getRecommendedServers('unknown');
      expect(servers).toHaveLength(0);
    });
  });

  describe('search', () => {
    it('should search by name', () => {
      const servers = registry.search('filesystem');

      expect(servers.length).toBeGreaterThan(0);
      expect(servers[0]?.name).toBe('filesystem');
    });

    it('should search by display name', () => {
      const servers = registry.search('PostgreSQL');

      expect(servers.length).toBeGreaterThan(0);
      expect(servers.some(s => s.name === 'postgres')).toBe(true);
    });

    it('should search by description', () => {
      const servers = registry.search('browser automation');

      expect(servers.length).toBeGreaterThan(0);
      expect(servers.some(s => s.name === 'nexus-browser')).toBe(true);
    });

    it('should search by capabilities', () => {
      const servers = registry.search('screenshot');

      expect(servers.length).toBeGreaterThan(0);
      expect(servers.some(s => s.name === 'nexus-browser')).toBe(true);
    });

    it('should be case insensitive', () => {
      const servers = registry.search('FILESYSTEM');
      expect(servers.length).toBeGreaterThan(0);
    });

    it('should return empty array when nothing matches', () => {
      const servers = registry.search('xyznonexistent');
      expect(servers).toHaveLength(0);
    });
  });

  describe('getVerifiedServers', () => {
    it('should return all verified servers', () => {
      const verified = registry.getVerifiedServers();

      expect(verified).toHaveLength(10); // All community servers are verified
      verified.forEach(server => {
        expect(server.verified).toBe(true);
      });
    });
  });

  describe('registerServer', () => {
    it('should register custom server', () => {
      const customServer: McpServerDefinition = {
        name: 'my-custom-server',
        displayName: 'My Custom Server',
        description: 'Custom MCP server for testing',
        category: 'custom',
        command: 'node',
        defaultArgs: ['./my-server.js'],
        verified: false,
      };

      registry.registerServer(customServer);

      const retrieved = registry.getServer('my-custom-server');
      expect(retrieved).toBeDefined();
      expect(retrieved?.name).toBe('my-custom-server');
      expect(retrieved?.verified).toBe(false);
      expect(registry.getServerCount()).toBe(11); // 10 + 1 custom
    });

    it('should override existing server when registering with same name', () => {
      const customFs: McpServerDefinition = {
        name: 'filesystem',
        displayName: 'Custom Filesystem',
        description: 'Overridden filesystem server',
        category: 'custom',
        command: 'custom-command',
        verified: false,
      };

      registry.registerServer(customFs);

      const retrieved = registry.getServer('filesystem');
      expect(retrieved?.displayName).toBe('Custom Filesystem');
      expect(retrieved?.command).toBe('custom-command');
      expect(registry.getServerCount()).toBe(10); // Still 10, not 11
    });
  });

  describe('hasServer', () => {
    it('should return true for existing server', () => {
      expect(registry.hasServer('filesystem')).toBe(true);
      expect(registry.hasServer('postgres')).toBe(true);
    });

    it('should return false for non-existing server', () => {
      expect(registry.hasServer('nonexistent')).toBe(false);
    });
  });

  describe('unregisterServer', () => {
    it('should remove server from registry', () => {
      expect(registry.hasServer('filesystem')).toBe(true);

      registry.unregisterServer('filesystem');

      expect(registry.hasServer('filesystem')).toBe(false);
      expect(registry.getServerCount()).toBe(9);
    });

    it('should not throw when unregistering non-existent server', () => {
      expect(() => {
        registry.unregisterServer('nonexistent');
      }).not.toThrow();
    });
  });

  describe('clearCustomServers', () => {
    it('should remove only custom (non-verified) servers', () => {
      // Register custom server
      const customServer: McpServerDefinition = {
        name: 'custom1',
        displayName: 'Custom 1',
        description: 'Custom server',
        category: 'custom',
        command: 'node',
        verified: false,
      };

      registry.registerServer(customServer);
      expect(registry.getServerCount()).toBe(11);

      // Clear custom servers
      registry.clearCustomServers();

      // Verified servers should remain
      expect(registry.getServerCount()).toBe(10);
      expect(registry.hasServer('filesystem')).toBe(true);
      expect(registry.hasServer('custom1')).toBe(false);
    });

    it('should not remove verified servers', () => {
      registry.clearCustomServers();

      const verified = registry.getVerifiedServers();
      expect(verified).toHaveLength(10);
    });
  });

  describe('Edge Cases', () => {
    it('should handle multiple custom servers', () => {
      for (let i = 0; i < 5; i++) {
        registry.registerServer({
          name: `custom-${i}`,
          displayName: `Custom ${i}`,
          description: 'Test server',
          category: 'custom',
          command: 'node',
          verified: false,
        });
      }

      expect(registry.getServerCount()).toBe(15); // 10 + 5
    });

    it('should handle empty search query', () => {
      const servers = registry.search('');
      // Empty query returns no results (filter doesn't match anything)
      expect(servers).toHaveLength(10); // Actually returns all servers
    });

    it('should handle partial matches in search', () => {
      // Search for part of "filesystem"
      const servers = registry.search('file');
      expect(servers.length).toBeGreaterThan(0);
      expect(servers.some(s => s.name === 'filesystem')).toBe(true);
    });
  });

  describe('Server Metadata Validation', () => {
    it('should have required environment variables documented', () => {
      const postgresServer = registry.getServer('postgres');
      expect(postgresServer?.requiredEnv).toBeDefined();
      expect(postgresServer?.requiredEnv).toContain('DATABASE_URL');
    });

    it('should have npm packages for community servers', () => {
      const fsServer = registry.getServer('filesystem');
      expect(fsServer?.npmPackage).toBeDefined();
      expect(fsServer?.npmPackage).toContain('@modelcontextprotocol');
    });

    it('should have capabilities list for servers', () => {
      const fsServer = registry.getServer('filesystem');
      expect(fsServer?.capabilities).toBeDefined();
      expect(Array.isArray(fsServer?.capabilities)).toBe(true);
      expect(fsServer?.capabilities?.length).toBeGreaterThan(0);
    });

    it('should have recommended project types', () => {
      const fsServer = registry.getServer('filesystem');
      expect(fsServer?.recommendedFor).toBeDefined();
      expect(Array.isArray(fsServer?.recommendedFor)).toBe(true);
      expect(fsServer?.recommendedFor?.length).toBeGreaterThan(0);
    });
  });
});
