/**
 * Search Tools Tool
 *
 * Client-side tool discovery for non-PTC providers with deferred tool loading.
 * Searches the tool registry by name, description, or category and returns
 * matching tool schemas. Discovered tools are recorded in the progressive
 * loading filter so they're included in subsequent requests.
 */

import { BaseTool, type ToolResult } from '../../base/index.js';
import { SchemaValidator } from '../../utils/SchemaValidator.js';

export interface SearchToolsParams {
  /** Search query to match tool names and descriptions */
  query?: string;
  /** Filter by tool category (e.g., "execution", "search", "file") */
  category?: string;
}

interface ToolEntry {
  name: string;
  description: string;
  category?: string;
  schema: unknown;
}

interface ToolSearchResult {
  name: string;
  category?: string;
  description: string;
  schema: unknown;
}

export class SearchToolsTool extends BaseTool<SearchToolsParams> {
  private toolProvider?: () => ToolEntry[];

  constructor() {
    super(
      'SearchTools',
      'Search Tools',
      'Search the tool registry to discover available tools by name, description, or category.',
      {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search query — keywords matched against tool names and descriptions. Use "select:Name1,Name2" to fetch exact tools by name.',
          },
          category: {
            type: 'string',
            description: 'Filter by tool category',
          },
        },
      },
    );
  }

  setToolProvider(provider: () => ToolEntry[]): void {
    this.toolProvider = provider;
  }

  validateToolParams(params: SearchToolsParams): string | null {
    const error = SchemaValidator.validate(this.parameterSchema, params);
    if (error) return error;
    if (!params.query && !params.category) {
      return 'At least one of "query" or "category" is required';
    }
    return null;
  }

  async execute(params: SearchToolsParams, _signal: AbortSignal): Promise<ToolResult> {
    if (!this.toolProvider) {
      return {
        llmContent: JSON.stringify({ matches: 0, tools: [], error: 'Tool provider not configured' }),
        success: false,
        error: 'Tool provider not configured',
      };
    }

    const allTools = this.toolProvider();

    // "select:Name1,Name2" — exact name lookup (like CC's ToolSearch)
    if (params.query?.startsWith('select:')) {
      const names = params.query.slice(7).split(',').map((n) => n.trim());
      const nameSet = new Set(names.map((n) => n.toLowerCase()));
      const exact = allTools.filter((t) => nameSet.has(t.name.toLowerCase()));
      return {
        llmContent: JSON.stringify({ matches: exact.length, tools: this.toResults(exact) }),
        success: true,
      };
    }

    // Score-based keyword search
    const scored = allTools.map((t) => ({
      tool: t,
      score: this.scoreMatch(t, params.query, params.category),
    }));

    const matches = scored
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
      .map((s) => s.tool);

    return {
      llmContent: JSON.stringify({ matches: matches.length, tools: this.toResults(matches) }),
      success: true,
    };
  }

  private scoreMatch(tool: ToolEntry, query?: string, category?: string): number {
    let score = 0;
    const nameLower = tool.name.toLowerCase();
    const descLower = tool.description.toLowerCase();

    if (category) {
      const catLower = category.toLowerCase();
      if (tool.category?.toLowerCase() === catLower) {
        score += 5;
      } else if (nameLower.includes(catLower) || descLower.includes(catLower)) {
        score += 2;
      }
    }

    if (query) {
      const words = query.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
      for (const word of words) {
        if (nameLower === word) score += 10;
        else if (nameLower.includes(word)) score += 5;
        if (descLower.includes(word)) score += 1;
      }
    }

    return score;
  }

  private toResults(tools: ToolEntry[]): ToolSearchResult[] {
    return tools.map((t) => ({
      name: t.name,
      category: t.category,
      description: t.description,
      schema: t.schema,
    }));
  }
}
