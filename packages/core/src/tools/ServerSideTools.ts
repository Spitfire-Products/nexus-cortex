/**
 * Server-Side Tool Support
 *
 * Handles provider-managed agentic tool execution where the provider's
 * server autonomously loops through tool calls rather than requiring
 * client-side execution.
 *
 * Examples:
 * - XAI: web_search(), x_search(), code_interpreter()
 * - Future: Other providers adding similar capabilities
 *
 * Architecture:
 * - Tool definitions flagged as 'server' vs 'client'
 * - Orchestrator passes tools to provider
 * - Provider executes autonomously
 * - Response includes citations, tool usage metadata
 */

/**
 * Tool Execution Mode
 */
export type ToolExecutionMode = 'client' | 'server' | 'both';

/**
 * Server-Side Tool Metadata
 *
 * Returned by providers that support autonomous tool execution
 */
export interface ServerSideToolMetadata {
  /** Map of tool categories to invocation counts (for billing) */
  toolUsage: Record<string, number>;

  /** List of all URLs/sources consulted during autonomous search */
  citations?: string[];

  /** Detailed list of tool calls made (including failed attempts) */
  toolCalls: Array<{
    id: string;
    name: string;
    arguments: string;
    status?: 'success' | 'failed';
  }>;

  /** Whether this was an autonomous multi-step loop */
  autonomousExecution: boolean;

  /** Provider-specific metadata */
  providerMetadata?: Record<string, any>;
}

/**
 * Extended Tool Definition
 *
 * Adds server-side capability flags to standard tool definitions
 */
export interface ServerSideToolDefinition {
  /** Tool execution mode */
  executionMode: ToolExecutionMode;

  /** Tool name (matches server-side tool type) */
  name: string;

  /** Tool description */
  description?: string;

  /** Server-side tool configuration (provider-specific) */
  serverConfig?: {
    /** For XAI web_search */
    allowed_domains?: string[];
    excluded_domains?: string[];
    enable_image_understanding?: boolean;

    /** For XAI x_search */
    allowed_x_handles?: string[];
    excluded_x_handles?: string[];
    from_date?: string;
    to_date?: string;
    enable_video_understanding?: boolean;
  };
}

/**
 * Server-Side Tool Registry
 *
 * Maps provider tool names to their execution modes
 */
export const SERVER_SIDE_TOOL_REGISTRY: Record<string, Record<string, ToolExecutionMode>> = {
  // XAI (grok models)
  xai: {
    'web_search': 'server',
    'web_search_with_snippets': 'server',
    'browse_page': 'server',
    'x_search': 'server',
    'x_user_search': 'server',
    'x_keyword_search': 'server',
    'x_semantic_search': 'server',
    'x_thread_fetch': 'server',
    'code_execution': 'server',
    'view_image': 'server',
    'view_x_video': 'server',
    'file_search': 'server',
    'mcp': 'server',
  },

  // OpenAI (Responses API hosted tools)
  // R20: OpenAI exposes hosted tools on /v1/responses. They are the direct
  // equivalent of XAI's server-side tools — declared as `{ type: 'web_search' }`
  // etc. in the tools array, autonomously looped by OpenAI's infrastructure.
  openai: {
    'web_search': 'server',
    'web_search_preview': 'server',
    'code_interpreter': 'server',
    'file_search': 'server',
    'image_generation': 'server',
    'computer_use_preview': 'server',
    'mcp': 'server',
  },

  // Anthropic PTC (Programmatic Tool Calling) system tools
  anthropic: {
    'code_execution_20260120': 'server',
    'tool_search_tool_bm25_20251119': 'server',
  },

  // Google (future - if they add server-side tools)
  google: {
    // Currently all client-side
  },
};

/**
 * Check if a tool is server-side for a given provider
 */
export function isServerSideTool(provider: string, toolName: string): boolean {
  const providerTools = SERVER_SIDE_TOOL_REGISTRY[provider];
  if (!providerTools) return false;

  const mode = providerTools[toolName];
  return mode === 'server' || mode === 'both';
}

/**
 * Check if a tool is client-side for a given provider
 */
export function isClientSideTool(provider: string, toolName: string): boolean {
  const providerTools = SERVER_SIDE_TOOL_REGISTRY[provider];
  if (!providerTools) return true; // Default to client-side

  const mode = providerTools[toolName];
  return mode === 'client' || mode === 'both' || mode === undefined;
}

/**
 * Get all server-side tools for a provider
 */
export function getServerSideTools(provider: string): string[] {
  const providerTools = SERVER_SIDE_TOOL_REGISTRY[provider];
  if (!providerTools) return [];

  return Object.entries(providerTools)
    .filter(([_, mode]) => mode === 'server' || mode === 'both')
    .map(([name, _]) => name);
}

/**
 * XAI Server-Side Tool Builders
 *
 * Helper functions to create XAI-specific server-side tools
 */
export const XAIServerSideTools = {
  /**
   * Web Search Tool
   *
   * Allows autonomous web search and page browsing
   */
  webSearch(config?: {
    allowed_domains?: string[];
    excluded_domains?: string[];
    enable_image_understanding?: boolean;
  }): ServerSideToolDefinition {
    return {
      executionMode: 'server',
      name: 'web_search',
      description: 'Search the web and browse pages autonomously',
      serverConfig: config,
    };
  },

  /**
   * X Search Tool
   *
   * Allows autonomous X (Twitter) search
   */
  xSearch(config?: {
    allowed_x_handles?: string[];
    excluded_x_handles?: string[];
    from_date?: string;
    to_date?: string;
    enable_image_understanding?: boolean;
    enable_video_understanding?: boolean;
  }): ServerSideToolDefinition {
    return {
      executionMode: 'server',
      name: 'x_search',
      description: 'Search X (Twitter) posts autonomously',
      serverConfig: config,
    };
  },

  /**
   * Code Execution Tool
   *
   * Allows autonomous Python code execution
   */
  codeExecution(): ServerSideToolDefinition {
    return {
      executionMode: 'server',
      name: 'code_execution',
      description: 'Execute Python code for calculations and analysis',
    };
  },

  // Alias for backward compatibility
  codeInterpreter(): ServerSideToolDefinition {
    return this.codeExecution();
  },
};

/**
 * OpenAI Server-Side Tool Builders
 *
 * R20: OpenAI hosted tools on the Responses API. Direct parity with XAI's
 * server-side tools — same wire-format pattern `{ type: 'tool_name' }` in the
 * tools array; OpenAI's infrastructure autonomously loops through tool calls
 * and returns citations/sources in the response metadata.
 */
export const OpenAIServerSideTools = {
  /**
   * Web Search Tool (Responses API native)
   *
   * Autonomous web search with citations.
   */
  webSearch(): ServerSideToolDefinition {
    return {
      executionMode: 'server',
      name: 'web_search',
      description: 'Search the web autonomously with citations',
    };
  },

  /**
   * Code Interpreter Tool (Responses API native)
   *
   * Sandboxed Python execution. Container automatically managed by OpenAI.
   */
  codeInterpreter(): ServerSideToolDefinition {
    return {
      executionMode: 'server',
      name: 'code_interpreter',
      description: 'Execute Python code in a sandboxed container',
    };
  },

  /**
   * File Search Tool (Responses API native)
   *
   * Vector-store-backed retrieval. Requires pre-uploaded vector store ids
   * (configured at request time via additional API parameters).
   */
  fileSearch(): ServerSideToolDefinition {
    return {
      executionMode: 'server',
      name: 'file_search',
      description: 'Retrieve relevant chunks from pre-uploaded vector stores',
    };
  },

  /**
   * Image Generation Tool (Responses API native)
   *
   * Generates images via gpt-image-1 / DALL-E.
   */
  imageGeneration(): ServerSideToolDefinition {
    return {
      executionMode: 'server',
      name: 'image_generation',
      description: 'Generate images from a text prompt',
    };
  },
};

/**
 * Convert ServerSideToolDefinition to CanonicalTool format
 *
 * This allows server-side tools to flow through the standard tool pipeline
 */
export function toCanonicalTool(toolDef: ServerSideToolDefinition): any {
  return {
    name: toolDef.name,
    description: toolDef.description || `${toolDef.name} tool`,
    schema: {
      type: 'object' as const,
      properties: {} as Record<string, any>,
      required: [] as string[]
    },
    metadata: {
      executionMode: toolDef.executionMode,
      serverConfig: toolDef.serverConfig,
      isServerSideTool: true
    }
  };
}

/**
 * Separate client and server tools for a request
 *
 * Some providers don't allow mixing client and server tools
 */
export function separateTools(
  provider: string,
  tools: any[]
): { clientTools: any[]; serverTools: any[] } {
  const clientTools: any[] = [];
  const serverTools: any[] = [];

  for (const tool of tools) {
    const toolName = tool.name || tool.type || tool.function?.name;
    if (!toolName) {
      clientTools.push(tool);
      continue;
    }

    if (isServerSideTool(provider, toolName)) {
      serverTools.push(tool);
    } else {
      clientTools.push(tool);
    }
  }

  return { clientTools, serverTools };
}

/**
 * Extract server-side tool metadata from provider response
 *
 * Handles different provider response formats
 */
export function extractServerSideMetadata(
  provider: string,
  response: any
): ServerSideToolMetadata | null {
  // XAI format
  if (provider === 'xai') {
    // Check for Responses API format (has 'output' array)
    if (response.output && Array.isArray(response.output)) {
      // XAI Responses API format
      const serverSideToolCalls = response.output.filter((item: any) =>
        item.type && item.type.endsWith('_call')  // code_interpreter_call, web_search_call, etc.
      );

      if (serverSideToolCalls.length > 0 || response.usage?.num_server_side_tools_used > 0) {
        const toolCalls = serverSideToolCalls.map((tc: any) => {
          const status: 'success' | 'failed' = tc.status === 'completed' ? 'success' : 'failed';
          return {
            id: tc.id || '',
            name: tc.name || tc.type.replace('_call', ''),
            arguments: tc.arguments || '{}',
            status,
          };
        });

        return {
          toolUsage: {
            server_side_tools: response.usage?.num_server_side_tools_used || toolCalls.length
          },
          citations: response.usage?.num_sources_used > 0 ? [] : undefined,  // Only include if sources were used
          toolCalls,
          autonomousExecution: true,
          providerMetadata: {
            reasoning_tokens: response.usage?.output_tokens_details?.reasoning_tokens,
            num_sources_used: response.usage?.num_sources_used,
          },
        };
      }
    } else {
      // XAI Messages API format (legacy)
      const citations = response.citations || [];
      const toolCalls = (response.tool_calls || []).map((tc: any) => ({
        id: tc.id,
        name: tc.function?.name || tc.name,
        arguments: tc.function?.arguments || tc.arguments,
        status: 'success' as const,
      }));

      const toolUsage = response.server_side_tool_usage || {};

      if (Object.keys(toolUsage).length > 0 || citations.length > 0) {
        return {
          toolUsage,
          citations,
          toolCalls,
          autonomousExecution: true,
          providerMetadata: {
            reasoning_tokens: response.usage?.reasoning_tokens,
          },
        };
      }
    }
  }

  // Add other providers as they add server-side tool support

  return null;
}
