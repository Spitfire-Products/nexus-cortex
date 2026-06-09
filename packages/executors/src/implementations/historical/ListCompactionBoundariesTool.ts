/**
 * ListCompactionBoundaries Tool Executor
 *
 * Lists all compaction boundaries (conversation summaries) with metadata.
 * Provides an overview of the compaction history for the session.
 */

import { BaseTool, type ToolResult } from '../../base/index.js';
import { SchemaValidator } from '../../utils/SchemaValidator.js';
import type { ExecutorConfig } from '../../base/ToolRegistry.js';
import type { ListCompactionBoundariesInput, CompactionBoundary } from '@nexus-cortex/types';
import {
  ListCompactionBoundariesTool as CoreListBoundariesTool,
} from '@nexus-cortex/core';

/**
 * Parameters for the ListCompactionBoundaries tool
 */
export interface ListCompactionBoundariesToolParams {
  /** Include detailed metadata in response */
  includeMetadata?: boolean;
}

/**
 * ListCompactionBoundaries Tool Executor
 *
 * Features:
 * - Lists all compaction boundaries chronologically
 * - Shows token savings and compression ratios
 * - Optional detailed metadata (topics, decisions, tools used)
 */
export class ListCompactionBoundariesToolExecutor extends BaseTool<
  ListCompactionBoundariesToolParams,
  ToolResult
> {
  private workspaceRoot: string;

  constructor(private config: ExecutorConfig) {
    super(
      'ListCompactionBoundaries',
      'ListCompactionBoundaries',
      `List compaction boundaries within the CURRENT session only.

Shows where the current conversation has been compressed/summarized to save tokens.
This is NOT for finding previous sessions - use SearchConversationHistory for that.`,
      {
        type: 'object',
        properties: {
          includeMetadata: {
            type: 'boolean',
            description: 'Include detailed metadata in response',
            default: true,
          },
        },
      },
    );

    this.workspaceRoot = (config as any).workspaceRoot || config.workingDirectory;
  }

  validateToolParams(params: ListCompactionBoundariesToolParams): string | null {
    // Schema validation
    const schemaError = SchemaValidator.validate(this.parameterSchema, params);
    if (schemaError) {
      return schemaError;
    }

    return null;
  }

  getDescription(params: ListCompactionBoundariesToolParams): string {
    return `Listing compaction boundaries${params.includeMetadata !== false ? ' with metadata' : ''}`;
  }

  async execute(
    params: ListCompactionBoundariesToolParams,
    signal: AbortSignal,
    updateOutput?: (output: string) => void,
  ): Promise<ToolResult> {
    const startTime = Date.now();

    try {
      // Check for abort
      if (signal.aborted) {
        return {
          ...this.createErrorResult('Listing was cancelled'),
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

      // Create core tool and execute
      const coreTool = new CoreListBoundariesTool(this.workspaceRoot);
      const input: ListCompactionBoundariesInput = {
        includeMetadata: params.includeMetadata,
      };

      const boundaries = await coreTool.execute(input, sessionId);

      // Check for abort
      if (signal.aborted) {
        return {
          ...this.createErrorResult('Listing was cancelled'),
          metadata: {
            executionTime: Date.now() - startTime,
          },
        };
      }

      // Format output
      const formattedOutput = this.formatBoundaries(boundaries, params.includeMetadata !== false);

      return {
        ...this.createSuccessResult(formattedOutput),
        metadata: {
          executionTime: Date.now() - startTime,
          sessionId,
          boundaryCount: boundaries.length,
        },
      };
    } catch (error: any) {
      // Check for abort
      if (signal.aborted) {
        return {
          ...this.createErrorResult('Listing was cancelled'),
          metadata: {
            executionTime: Date.now() - startTime,
          },
        };
      }

      const errorMessage = error.message || String(error);
      return {
        ...this.createErrorResult(`Error listing compaction boundaries: ${errorMessage}`),
        metadata: {
          executionTime: Date.now() - startTime,
          error: errorMessage,
        },
      };
    }
  }

  /**
   * Format compaction boundaries for display
   */
  private formatBoundaries(boundaries: CompactionBoundary[], includeMetadata: boolean): string {
    if (boundaries.length === 0) {
      return 'No compaction boundaries found in this session.';
    }

    const lines: string[] = [];
    lines.push('=== Compaction Boundaries ===\n\n');
    lines.push(`Total: ${boundaries.length} compaction${boundaries.length > 1 ? 's' : ''}\n\n`);

    // Calculate totals
    const totalSaved = boundaries.reduce((sum, b) => sum + b.tokens.saved, 0);
    const totalOriginal = boundaries.reduce((sum, b) => sum + b.tokens.original, 0);
    const totalCompressed = boundaries.reduce((sum, b) => sum + b.tokens.compressed, 0);
    const avgCompressionRatio = totalOriginal > 0
      ? ((totalCompressed / totalOriginal) * 100).toFixed(1)
      : '0.0';

    lines.push(`Total tokens saved: ${totalSaved}\n`);
    lines.push(`Total original tokens: ${totalOriginal}\n`);
    lines.push(`Total compressed tokens: ${totalCompressed}\n`);
    lines.push(`Average compression ratio: ${avgCompressionRatio}%\n\n`);

    lines.push('---\n\n');

    // List each boundary
    boundaries.forEach((boundary, index) => {
      lines.push(`${index + 1}. Compaction ID: ${boundary.id}\n`);
      lines.push(` Type: ${boundary.type}\n`);
      lines.push(` Turns: ${boundary.turnRange.start} - ${boundary.turnRange.end}\n`);
      lines.push(` Timestamp: ${boundary.timestamp.toLocaleString()}\n`);
      lines.push(` Tokens: ${boundary.tokens.original} → ${boundary.tokens.compressed} (saved ${boundary.tokens.saved})\n`);

      if (includeMetadata && boundary.metadata) {
        lines.push(` Helper model: ${boundary.metadata.helperModel}\n`);
        lines.push(` Cost: $${boundary.metadata.cost.toFixed(6)}\n`);

        if (boundary.metadata.topics.length > 0) {
          lines.push(` Topics: ${boundary.metadata.topics.slice(0, 3).join(', ')}\n`);
        }

        if (boundary.metadata.toolsUsed.length > 0) {
          lines.push(` Tools used: ${boundary.metadata.toolsUsed.join(', ')}\n`);
        }

        if (boundary.metadata.summary) {
          lines.push(` Summary: ${boundary.metadata.summary.substring(0, 100)}...\n`);
        }
      }

      lines.push('\n');
    });

    return lines.join('');
  }
}
