/**
 * MCP Server Registry
 *
 * Registry of known MCP servers (community + custom).
 * Provides server definitions, capabilities, and search functionality.
 *
 * Phase 2.5 Day 4.5: MCP Auto-Injection System
 */

export type McpServerCategory =
  | 'filesystem'
  | 'database'
  | 'browser'
  | 'api'
  | 'development'
  | 'productivity'
  | 'custom';

/**
 * MCP Server Definition
 */
export interface McpServerDefinition {
  /** Unique server name */
  name: string;

  /** Display name for UI */
  displayName: string;

  /** Human-readable description */
  description: string;

  /** Category for grouping */
  category: McpServerCategory;

  /** Executable command */
  command: string;

  /** Default command arguments */
  defaultArgs?: string[];

  /** Default environment variables */
  defaultEnv?: Record<string, string>;

  /** Required environment variables (must be provided by user) */
  requiredEnv?: string[];

  /** Whether this is a verified/official server */
  verified: boolean;

  /** NPM package name (if applicable) */
  npmPackage?: string;

  /** Documentation URL */
  documentation?: string;

  /** Capabilities/tools this server provides */
  capabilities?: string[];

  /** Project types this server is useful for */
  recommendedFor?: string[];
}

/**
 * MCP Server Registry
 *
 * Manages known MCP servers and provides search/discovery functionality.
 */
export class McpServerRegistry {
  private servers: Map<string, McpServerDefinition> = new Map();

  constructor() {
    // Auto-load community registry on construction
    this.loadCommunityRegistry();
  }

  /**
   * Load community registry (built-in verified servers)
   */
  private loadCommunityRegistry(): void {
    const communityServers: McpServerDefinition[] = [
      // Filesystem server
      {
        name: 'filesystem',
        displayName: 'Filesystem',
        description: 'File system operations (read, write, list, search files and directories)',
        category: 'filesystem',
        command: 'npx',
        defaultArgs: ['-y', '@modelcontextprotocol/server-filesystem'],
        verified: true,
        npmPackage: '@modelcontextprotocol/server-filesystem',
        documentation: 'https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem',
        capabilities: ['read_file', 'write_file', 'list_directory', 'search_files', 'get_file_info'],
        recommendedFor: ['node', 'web', 'general']
      },

      // Puppeteer server
      {
        name: 'puppeteer',
        displayName: 'Puppeteer',
        description: 'Browser automation and web scraping using headless Chrome',
        category: 'browser',
        command: 'npx',
        defaultArgs: ['-y', '@modelcontextprotocol/server-puppeteer'],
        verified: true,
        npmPackage: '@modelcontextprotocol/server-puppeteer',
        documentation: 'https://github.com/modelcontextprotocol/servers/tree/main/src/puppeteer',
        capabilities: ['puppeteer_navigate', 'puppeteer_screenshot', 'puppeteer_click', 'puppeteer_fill', 'puppeteer_select'],
        recommendedFor: ['web', 'testing', 'scraping']
      },

      // PostgreSQL server
      {
        name: 'postgres',
        displayName: 'PostgreSQL',
        description: 'PostgreSQL database access and query execution',
        category: 'database',
        command: 'npx',
        defaultArgs: ['-y', '@modelcontextprotocol/server-postgres'],
        requiredEnv: ['DATABASE_URL'],
        verified: true,
        npmPackage: '@modelcontextprotocol/server-postgres',
        documentation: 'https://github.com/modelcontextprotocol/servers/tree/main/src/postgres',
        capabilities: ['query', 'list_tables', 'describe_table', 'get_schema'],
        recommendedFor: ['database', 'backend']
      },

      // SQLite server
      {
        name: 'sqlite',
        displayName: 'SQLite',
        description: 'SQLite database access and query execution',
        category: 'database',
        command: 'npx',
        defaultArgs: ['-y', '@modelcontextprotocol/server-sqlite'],
        verified: true,
        npmPackage: '@modelcontextprotocol/server-sqlite',
        documentation: 'https://github.com/modelcontextprotocol/servers/tree/main/src/sqlite',
        capabilities: ['query', 'list_tables', 'describe_table', 'create_table'],
        recommendedFor: ['database', 'mobile', 'desktop']
      },

      // GitHub server
      {
        name: 'github',
        displayName: 'GitHub',
        description: 'GitHub API integration for repository operations',
        category: 'api',
        command: 'npx',
        defaultArgs: ['-y', '@modelcontextprotocol/server-github'],
        requiredEnv: ['GITHUB_TOKEN'],
        verified: true,
        npmPackage: '@modelcontextprotocol/server-github',
        documentation: 'https://github.com/modelcontextprotocol/servers/tree/main/src/github',
        capabilities: ['create_issue', 'list_issues', 'get_file_contents', 'create_pull_request', 'search_repositories'],
        recommendedFor: ['git', 'development']
      },

      // Slack server
      {
        name: 'slack',
        displayName: 'Slack',
        description: 'Slack workspace integration for messaging and collaboration',
        category: 'productivity',
        command: 'npx',
        defaultArgs: ['-y', '@modelcontextprotocol/server-slack'],
        requiredEnv: ['SLACK_BOT_TOKEN'],
        verified: true,
        npmPackage: '@modelcontextprotocol/server-slack',
        documentation: 'https://github.com/modelcontextprotocol/servers/tree/main/src/slack',
        capabilities: ['send_message', 'list_channels', 'get_channel_history', 'add_reaction'],
        recommendedFor: ['productivity', 'communication']
      },

      // Git server
      {
        name: 'git',
        displayName: 'Git',
        description: 'Git repository operations and version control',
        category: 'development',
        command: 'npx',
        defaultArgs: ['-y', '@modelcontextprotocol/server-git'],
        verified: true,
        npmPackage: '@modelcontextprotocol/server-git',
        documentation: 'https://github.com/modelcontextprotocol/servers/tree/main/src/git',
        capabilities: ['git_status', 'git_diff', 'git_log', 'git_commit', 'git_branch'],
        recommendedFor: ['git', 'development']
      },

      // Memory server
      {
        name: 'memory',
        displayName: 'Memory',
        description: 'Persistent memory storage for conversations across sessions',
        category: 'productivity',
        command: 'npx',
        defaultArgs: ['-y', '@modelcontextprotocol/server-memory'],
        verified: true,
        npmPackage: '@modelcontextprotocol/server-memory',
        documentation: 'https://github.com/modelcontextprotocol/servers/tree/main/src/memory',
        capabilities: ['store_memory', 'retrieve_memory', 'search_memory', 'delete_memory'],
        recommendedFor: ['general', 'productivity']
      },

      // Brave Search server
      {
        name: 'brave-search',
        displayName: 'Brave Search',
        description: 'Web search using Brave Search API',
        category: 'api',
        command: 'npx',
        defaultArgs: ['-y', '@modelcontextprotocol/server-brave-search'],
        requiredEnv: ['BRAVE_API_KEY'],
        verified: true,
        npmPackage: '@modelcontextprotocol/server-brave-search',
        documentation: 'https://github.com/modelcontextprotocol/servers/tree/main/src/brave-search',
        capabilities: ['web_search', 'local_search', 'news_search'],
        recommendedFor: ['research', 'general']
      },

      // Google Drive server
      {
        name: 'gdrive',
        displayName: 'Google Drive',
        description: 'Google Drive file access and management',
        category: 'productivity',
        command: 'npx',
        defaultArgs: ['-y', '@modelcontextprotocol/server-gdrive'],
        requiredEnv: ['GDRIVE_CLIENT_ID', 'GDRIVE_CLIENT_SECRET'],
        verified: true,
        npmPackage: '@modelcontextprotocol/server-gdrive',
        documentation: 'https://github.com/modelcontextprotocol/servers/tree/main/src/gdrive',
        capabilities: ['list_files', 'read_file', 'write_file', 'search_files'],
        recommendedFor: ['productivity', 'collaboration']
      }
    ];

    // Register all community servers
    communityServers.forEach(server => {
      this.servers.set(server.name, server);
    });
  }

  /**
   * Register a custom server
   */
  registerServer(definition: McpServerDefinition): void {
    this.servers.set(definition.name, definition);
  }

  /**
   * Get server definition by name
   */
  getServer(name: string): McpServerDefinition | undefined {
    return this.servers.get(name);
  }

  /**
   * Get all registered servers
   */
  getAllServers(): McpServerDefinition[] {
    return Array.from(this.servers.values());
  }

  /**
   * Get servers by category
   */
  getServersByCategory(category: McpServerCategory): McpServerDefinition[] {
    return Array.from(this.servers.values())
      .filter(server => server.category === category);
  }

  /**
   * Search servers by capability
   */
  searchByCapability(capability: string): McpServerDefinition[] {
    return Array.from(this.servers.values())
      .filter(server =>
        server.capabilities?.some(cap =>
          cap.toLowerCase().includes(capability.toLowerCase())
        )
      );
  }

  /**
   * Get recommended servers for a project type
   */
  getRecommendedServers(projectType: string): McpServerDefinition[] {
    return Array.from(this.servers.values())
      .filter(server =>
        server.recommendedFor?.includes(projectType.toLowerCase())
      );
  }

  /**
   * Search servers by query (searches name, description, capabilities)
   */
  search(query: string): McpServerDefinition[] {
    const lowerQuery = query.toLowerCase();

    return Array.from(this.servers.values())
      .filter(server => {
        // Search in name
        if (server.name.toLowerCase().includes(lowerQuery)) {
          return true;
        }

        // Search in display name
        if (server.displayName.toLowerCase().includes(lowerQuery)) {
          return true;
        }

        // Search in description
        if (server.description.toLowerCase().includes(lowerQuery)) {
          return true;
        }

        // Search in capabilities
        if (server.capabilities?.some(cap => cap.toLowerCase().includes(lowerQuery))) {
          return true;
        }

        return false;
      });
  }

  /**
   * Get verified (official) servers only
   */
  getVerifiedServers(): McpServerDefinition[] {
    return Array.from(this.servers.values())
      .filter(server => server.verified);
  }

  /**
   * Check if a server is registered
   */
  hasServer(name: string): boolean {
    return this.servers.has(name);
  }

  /**
   * Get count of registered servers
   */
  getServerCount(): number {
    return this.servers.size;
  }

  /**
   * Remove a server from registry
   */
  unregisterServer(name: string): void {
    this.servers.delete(name);
  }

  /**
   * Clear all servers (except community servers)
   */
  clearCustomServers(): void {
    const communityServerNames = Array.from(this.servers.values())
      .filter(s => s.verified)
      .map(s => s.name);

    // Remove all non-verified servers
    Array.from(this.servers.keys()).forEach(name => {
      if (!communityServerNames.includes(name)) {
        this.servers.delete(name);
      }
    });
  }
}
