/**
 * RequestHistoricalContext Tool Executor
 *
 * Requests historical context using a cheap helper model (e.g., FREE Gemma).
 * Cost-effective way to access archived context outside the main model's window.
 */

import { BaseTool, type ToolResult } from '../../base/index.js';
import { SchemaValidator } from '../../utils/SchemaValidator.js';
import type { ExecutorConfig } from '../../base/ToolRegistry.js';
import type { RequestHistoricalContextInput, HistoricalContextResult } from '@nexus-cortex/types';
import {
  RequestHistoricalContextTool as CoreRequestContextTool,
  JSONLHistoryStore,
} from '@nexus-cortex/core';

/**
 * Parameters for the RequestHistoricalContext tool
 */
export interface RequestHistoricalContextToolParams {
  /** Query describing what historical context is needed */
  query: string;

  /** Detail level for the response */
  detailLevel?: 'brief' | 'standard' | 'detailed';

  /** Maximum tokens for the response */
  maxTokens?: number;

  /** Whether to use helper model (vs main model) */
  useHelperModel?: boolean;
}

/**
 * RequestHistoricalContext Tool Executor
 *
 * Features:
 * - Uses FREE Gemma models for cost-effective context retrieval
 * - Searches both recent and compacted history
 * - Configurable detail level
 * - Returns sources and cost information
 */
export class RequestHistoricalContextToolExecutor extends BaseTool<
  RequestHistoricalContextToolParams,
  ToolResult
> {
  constructor(private config: ExecutorConfig) {
    super(
      'RequestHistoricalContext',
      'RequestHistoricalContext',
      `Request historical context using cheap helper model. Cost-effective for accessing archived context.

Uses FREE Gemma models to generate context from historical conversation data.`,
      {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Query describing what historical context is needed',
          },
          detailLevel: {
            type: 'string',
            enum: ['brief', 'standard', 'detailed'],
            description: 'Detail level for the response',
            default: 'standard',
          },
          maxTokens: {
            type: 'number',
            description: 'Maximum tokens for the response',
            default: 1000,
          },
          useHelperModel: {
            type: 'boolean',
            description: 'Whether to use helper model (vs main model)',
            default: true,
          },
        },
        required: ['query'],
      },
    );
  }

  /**
   * Get workspace root from config (dynamically resolved)
   */
  private getWorkspaceRoot(): string {
    return (this.config as any).workspaceRoot || (this.config as any).storageDir || this.config.workingDirectory;
  }

  validateToolParams(params: RequestHistoricalContextToolParams): string | null {
    // Schema validation
    const schemaError = SchemaValidator.validate(this.parameterSchema, params);
    if (schemaError) {
      return schemaError;
    }

    // Validate query
    if (!params.query || params.query.trim().length === 0) {
      return 'Query cannot be empty.';
    }

    if (params.query.length > 1000) {
      return 'Query too long (max 1000 characters).';
    }

    // Validate detailLevel
    if (params.detailLevel && !['brief', 'standard', 'detailed'].includes(params.detailLevel)) {
      return `Invalid detailLevel: ${params.detailLevel}. Must be 'brief', 'standard', or 'detailed'.`;
    }

    // Validate maxTokens
    if (params.maxTokens !== undefined) {
      if (params.maxTokens < 100) {
        return 'maxTokens must be at least 100.';
      }
      if (params.maxTokens > 10000) {
        return 'maxTokens cannot exceed 10000.';
      }
    }

    return null;
  }

  getDescription(params: RequestHistoricalContextToolParams): string {
    const detailLevel = params.detailLevel || 'standard';
    return `Requesting historical context for "${params.query}" (${detailLevel})`;
  }

  async execute(
    params: RequestHistoricalContextToolParams,
    signal: AbortSignal,
    updateOutput?: (output: string) => void,
  ): Promise<ToolResult> {
    const startTime = Date.now();

    try {
      // Check for abort
      if (signal.aborted) {
        return {
          ...this.createErrorResult('Context request was cancelled'),
          metadata: {
            executionTime: Date.now() - startTime,
          },
        };
      }

      // Validate parameters
      const validationError = this.validateToolParams(params);
      if (validationError) {
        return {
          ...this.createErrorResult(validationError),
          metadata: {
            executionTime: Date.now() - startTime,
          },
        };
      }

      // Get session ID from config
      const sessionId = (this.config as any).sessionId;
      if (!sessionId) {
        return {
          ...this.createErrorResult(
            'Session ID not provided in executor config. Historical tools require active session context.',
          ),
          metadata: {
            executionTime: Date.now() - startTime,
          },
        };
      }

      // Get storage directory from config (updated after session creation)
      const storageDir = (this.config as any).storageDir || '.cortex/sessions';
      const workspaceRoot = this.getWorkspaceRoot();

      // Create history store with storage directory
      const historyStore = new JSONLHistoryStore({ baseDir: storageDir });

      // Load messages from session storage (without workspacePath to use baseDir directly)
      const messages = await historyStore.loadSession(sessionId);

      if (messages.length === 0) {
        return {
          ...this.createSuccessResult('No historical context available in this session.'),
          metadata: {
            executionTime: Date.now() - startTime,
            sessionId,
            messageCount: 0,
          },
        };
      }

      // Note: The core tool requires HelperMiddlewareAdapter which may not be available
      // in the executor context. For now, we'll create the tool without it and rely
      // on it using stored compaction summaries instead of generating new context.
      const coreTool = new CoreRequestContextTool(workspaceRoot);

      const input: RequestHistoricalContextInput = {
        query: params.query,
        detailLevel: params.detailLevel,
        maxTokens: params.maxTokens,
        useHelperModel: params.useHelperModel,
      };

      const result = await coreTool.execute(input, sessionId, messages);

      // Check for abort
      if (signal.aborted) {
        return {
          ...this.createErrorResult('Context request was cancelled'),
          metadata: {
            executionTime: Date.now() - startTime,
          },
        };
      }

      // Format output
      const formattedOutput = this.formatContext(result, params.query);

      return {
        ...this.createSuccessResult(formattedOutput),
        metadata: {
          executionTime: Date.now() - startTime,
          sessionId,
          tokensUsed: result.tokensUsed,
          modelUsed: result.modelUsed,
          cost: result.cost,
          processingTime: result.processingTime,
          sourceCount: result.sources.length,
        },
      };
    } catch (error: any) {
      // Check for abort
      if (signal.aborted) {
        return {
          ...this.createErrorResult('Context request was cancelled'),
          metadata: {
            executionTime: Date.now() - startTime,
          },
        };
      }

      const errorMessage = error.message || String(error);
      return {
        ...this.createErrorResult(`Error requesting historical context: ${errorMessage}`),
        metadata: {
          executionTime: Date.now() - startTime,
          error: errorMessage,
        },
      };
    }
  }

  /**
   * Format historical context result for display
   */
  private formatContext(result: HistoricalContextResult, query: string): string {
    const lines: string[] = [];

    lines.push(`=== Historical Context for "${query}" ===\n\n`);

    lines.push('## Context\n\n');
    lines.push(result.context);
    lines.push('\n\n');

    lines.push('## Sources\n\n');
    if (result.sources.length === 0) {
      lines.push('No specific sources referenced.\n');
    } else {
      result.sources.forEach((source: any, index: number) => {
        lines.push(`${index + 1}. Turn ${source.turnNumber} (${source.timestamp.toLocaleString()})\n`);
        if (source.isCompacted) {
          lines.push(` From compacted section: ${source.compactionId}\n`);
        }
      });
    }

    lines.push('\n');
    lines.push('## Metadata\n\n');
    lines.push(`Model used: ${result.modelUsed}\n`);
    lines.push(`Tokens used: ${result.tokensUsed}\n`);
    lines.push(`Processing time: ${result.processingTime}ms\n`);
    lines.push(`Cost: $${result.cost.toFixed(6)}\n`);

    return lines.join('');
  }
}
