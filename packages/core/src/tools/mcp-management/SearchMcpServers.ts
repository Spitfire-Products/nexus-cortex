/**
 * SearchMcpServers Tool
 *
 * Allows models to search for MCP servers by capability, keyword, or project type.
 * Helps models find the right server for their needs.
 *
 * Phase 2.6: MCP Model Management Tools
 */

import type { CanonicalTool } from '../types/CanonicalTool.js';
import type { McpServerRegistry, McpServerDefinition } from '../../mcp/McpServerRegistry.js';

export interface SearchMcpServersInput {
  query?: string;
  capability?: string;
  project_type?: 'general' | 'web' | 'database' | 'api' | 'data-science' | 'mobile';
}

export interface SearchMcpServersOutput {
  servers: Array<{
    name: string;
    displayName: string;
    description: string;
    category: string;
    relevanceReason: string;
    capabilities?: string[];
    npmPackage?: string;
    requiredEnv?: string[];
  }>;
  total: number;
  searchType: 'query' | 'capability' | 'recommendations';
}

export class SearchMcpServers {
  /**
   * Execute the search_mcp_servers tool
   *
   * @param input Tool input parameters
   * @param serverRegistry MCP server registry
   * @returns Search results with relevance information
   */
  static async execute(
    input: SearchMcpServersInput,
    serverRegistry: McpServerRegistry
  ): Promise<SearchMcpServersOutput> {
    let servers: McpServerDefinition[];
    let searchType: 'query' | 'capability' | 'recommendations';
    let relevanceReasons: Map<string, string> = new Map();

    // Determine search type and execute
    if (input.query) {
      // Search by keyword
      servers = serverRegistry.search(input.query);
      searchType = 'query';
      servers.forEach(s => {
        relevanceReasons.set(s.name, `Matched search query "${input.query}"`);
      });
    } else if (input.capability) {
      // Search by capability
      servers = serverRegistry.searchByCapability(input.capability);
      searchType = 'capability';
      servers.forEach(s => {
        relevanceReasons.set(s.name, `Has capability "${input.capability}"`);
      });
    } else if (input.project_type) {
      // Get recommendations for project type
      servers = serverRegistry.getRecommendedServers(input.project_type);
      searchType = 'recommendations';
      servers.forEach(s => {
        relevanceReasons.set(s.name, `Recommended for ${input.project_type} projects`);
      });
    } else {
      // No search criteria - return empty
      servers = [];
      searchType = 'query';
    }

    // Transform to output format
    const serverList = servers.map(server => ({
      name: server.name,
      displayName: server.displayName,
      description: server.description,
      category: server.category,
      relevanceReason: relevanceReasons.get(server.name) || 'Matched search criteria',
      capabilities: server.capabilities,
      npmPackage: server.npmPackage,
      requiredEnv: server.requiredEnv
    }));

    return {
      servers: serverList,
      total: serverList.length,
      searchType
    };
  }

  /**
   * Convert to canonical tool format for registration
   */
  static toCanonicalTool(): CanonicalTool {
    return {
      name: 'SearchMcpServers',
      description: 'Search for MCP servers by capability, keyword, or get recommendations for project type. Use this to find specific servers that meet your needs.',
      schema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search query (searches name, description, capabilities). Example: "browser", "database", "file"'
          },
          capability: {
            type: 'string',
            description: 'Filter by specific capability. Examples: "read_file", "query", "screenshot", "search"'
          },
          project_type: {
            type: 'string',
            description: 'Get recommendations for project type',
            enum: ['general', 'web', 'database', 'api', 'data-science', 'mobile']
          }
        }
      }
    };
  }
}
