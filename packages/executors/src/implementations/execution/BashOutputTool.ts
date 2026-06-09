/**
 * BashOutput Tool Executor
 *
 * Retrieves output from background shell processes started by ShellTool.
 * Uses BackgroundProcessRegistry to track and read process output.
 *
 * Ported from Gemini CLI bash-output functionality
 */

import { BaseTool, type ToolResult } from '../../base/index.js';
import { SchemaValidator } from '../../utils/SchemaValidator.js';
import type { ExecutorConfig } from '../../base/ToolRegistry.js';
import { BackgroundProcessRegistry } from './BackgroundProcessRegistry.js';

/**
 * Parameters for the BashOutput tool
 */
export interface BashOutputToolParams {
  /**
   * The shell ID of the background process
   */
  bash_id: string;

  /**
   * Optional regex filter to show only matching lines
   */
  filter?: string;
}

/**
 * BashOutput Tool Executor
 *
 * Features:
 * - Retrieves output from background shell processes
 * - Optional regex filtering of output lines
 * - Returns new output since last check
 * - Shows process status (running/exited)
 */
export class BashOutputTool extends BaseTool<BashOutputToolParams, ToolResult> {
  private registry: BackgroundProcessRegistry;
  private lastReadLine: Map<string, number> = new Map();

  constructor(private config: ExecutorConfig) {
    super(
      'BashOutput',
      'BashOutput',
      `Retrieves output from a running or completed background bash shell. Returns stdout and stderr output along with shell status. Always returns only new output since the last check.`,
      {
        type: 'object',
        properties: {
          bash_id: {
            type: 'string',
            description: 'The ID of the background shell to retrieve output from',
          },
          filter: {
            type: 'string',
            description:
              'Optional regular expression to filter the output lines. Only lines matching this regex will be included in the result.',
          },
        },
        required: ['bash_id'],
      },
    );

    this.registry = BackgroundProcessRegistry.getInstance();
  }

  validateToolParams(params: BashOutputToolParams): string | null {
    // Schema validation
    const schemaError = SchemaValidator.validate(this.parameterSchema, params);
    if (schemaError) {
      return schemaError;
    }

    // Validate bash_id is not empty
    if (!params.bash_id || !params.bash_id.trim()) {
      return "The 'bash_id' parameter cannot be empty.";
    }

    // Validate filter regex if provided
    if (params.filter) {
      try {
        new RegExp(params.filter);
      } catch (error: any) {
        return `Invalid filter regex: ${error.message}`;
      }
    }

    return null;
  }

  getDescription(params: BashOutputToolParams): string {
    return `Retrieving output from background shell: ${params.bash_id}`;
  }

  async execute(
    params: BashOutputToolParams,
    signal: AbortSignal,
    updateOutput?: (output: string) => void,
  ): Promise<ToolResult> {
    const startTime = Date.now();

    try {
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

      // Check if process exists
      const process = this.registry.getProcess(params.bash_id);
      if (!process) {
        return {
          ...this.createErrorResult(
            `Background shell '${params.bash_id}' not found. It may have already exited and been removed from the registry.`,
          ),
          metadata: {
            executionTime: Date.now() - startTime,
            bash_id: params.bash_id,
          },
        };
      }

      // Get last read line for this shell
      const lastLine = this.lastReadLine.get(params.bash_id) || 0;

      // Get new output since last check
      let newOutput = this.registry.getOutput(params.bash_id, lastLine);

      // Update last read line
      this.lastReadLine.set(params.bash_id, process.output.length);

      // Apply filter if provided
      if (params.filter && newOutput.length > 0) {
        try {
          const regex = new RegExp(params.filter);
          newOutput = newOutput.filter((line) => regex.test(line));
        } catch (error: any) {
          // Should not happen due to validation, but handle gracefully
          return {
            ...this.createErrorResult(`Filter regex error: ${error.message}`),
            metadata: {
              executionTime: Date.now() - startTime,
              bash_id: params.bash_id,
            },
          };
        }
      }

      // Format output
      const outputText = newOutput.length > 0 ? newOutput.join('\n') + '\n' : '(no new output)';

      // Build status info
      const statusLines: string[] = [];
      statusLines.push(`Shell ID: ${params.bash_id}`);
      statusLines.push(`PID: ${process.pid}`);
      statusLines.push(`Status: ${process.isRunning ? 'Running' : 'Exited'}`);
      if (process.exitCode !== null) {
        statusLines.push(`Exit Code: ${process.exitCode}`);
      }
      statusLines.push(`Command: ${process.command}`);
      statusLines.push(`Started: ${process.startTime.toISOString()}`);
      statusLines.push(
        `New Lines: ${newOutput.length} (Total: ${process.output.length}, Last Read: ${lastLine})`,
      );
      if (params.filter) {
        statusLines.push(`Filter: ${params.filter}`);
      }

      const fullOutput = `${statusLines.join('\n')}\n\n=== Output ===\n${outputText}`;

      return {
        ...this.createSuccessResult(fullOutput),
        metadata: {
          executionTime: Date.now() - startTime,
          bash_id: params.bash_id,
          pid: process.pid,
          isRunning: process.isRunning,
          exitCode: process.exitCode,
          newLinesCount: newOutput.length,
          totalLinesCount: process.output.length,
        },
      };
    } catch (error: any) {
      // Check for abort
      if (signal.aborted) {
        return {
          ...this.createErrorResult('Output retrieval was cancelled'),
          metadata: {
            executionTime: Date.now() - startTime,
            bash_id: params.bash_id,
          },
        };
      }

      // Handle errors
      const errorMessage = error.message || String(error);
      return {
        ...this.createErrorResult(`Error retrieving shell output: ${errorMessage}`),
        metadata: {
          executionTime: Date.now() - startTime,
          bash_id: params.bash_id,
          error: errorMessage,
        },
      };
    }
  }
}
