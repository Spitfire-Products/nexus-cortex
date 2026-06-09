/**
 * KillShell Tool Executor
 *
 * Terminates background shell processes started by ShellTool.
 * Uses BackgroundProcessRegistry to track and kill processes.
 *
 * Ported from Gemini CLI kill-shell functionality
 */

import { BaseTool, type ToolResult } from '../../base/index.js';
import { SchemaValidator } from '../../utils/SchemaValidator.js';
import type { ExecutorConfig } from '../../base/ToolRegistry.js';
import { BackgroundProcessRegistry } from './BackgroundProcessRegistry.js';

/**
 * Parameters for the KillShell tool
 */
export interface KillShellToolParams {
  /**
   * The shell ID of the background process to kill
   */
  shell_id: string;
}

/**
 * KillShell Tool Executor
 *
 * Features:
 * - Terminates background shell processes by shell ID
 * - Sends SIGTERM signal to process
 * - Returns success/failure status
 * - Removes terminated process from registry
 */
export class KillShellTool extends BaseTool<KillShellToolParams, ToolResult> {
  private registry: BackgroundProcessRegistry;

  constructor(private config: ExecutorConfig) {
    super(
      'KillShell',
      'KillShell',
      `Kills a running background bash shell by its ID. Sends SIGTERM signal to the process. Returns a success or failure status.`,
      {
        type: 'object',
        properties: {
          shell_id: {
            type: 'string',
            description: 'The ID of the background shell to kill',
          },
        },
        required: ['shell_id'],
      },
    );

    this.registry = BackgroundProcessRegistry.getInstance();
  }

  validateToolParams(params: KillShellToolParams): string | null {
    // Schema validation
    const schemaError = SchemaValidator.validate(this.parameterSchema, params);
    if (schemaError) {
      return schemaError;
    }

    // Validate shell_id is not empty
    if (!params.shell_id || !params.shell_id.trim()) {
      return "The 'shell_id' parameter cannot be empty.";
    }

    return null;
  }

  getDescription(params: KillShellToolParams): string {
    return `Killing background shell: ${params.shell_id}`;
  }

  async execute(
    params: KillShellToolParams,
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
      const process = this.registry.getProcess(params.shell_id);
      if (!process) {
        return {
          ...this.createErrorResult(
            `Background shell '${params.shell_id}' not found. It may have already exited or been removed from the registry.`,
          ),
          metadata: {
            executionTime: Date.now() - startTime,
            shell_id: params.shell_id,
            found: false,
          },
        };
      }

      // Check if already not running
      if (!process.isRunning) {
        return {
          ...this.createSuccessResult(
            `Shell '${params.shell_id}' (PID: ${process.pid}) was already not running (exit code: ${process.exitCode}). Removed from registry.`,
          ),
          metadata: {
            executionTime: Date.now() - startTime,
            shell_id: params.shell_id,
            pid: process.pid,
            wasRunning: false,
            exitCode: process.exitCode,
          },
        };
      }

      // Attempt to kill the process
      const killed = this.registry.killProcess(params.shell_id);

      if (killed) {
        // Wait a moment to see if process exits
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Remove from registry
        this.registry.removeProcess(params.shell_id);

        return {
          ...this.createSuccessResult(
            `Successfully killed shell '${params.shell_id}' (PID: ${process.pid}) and removed from registry.`,
          ),
          metadata: {
            executionTime: Date.now() - startTime,
            shell_id: params.shell_id,
            pid: process.pid,
            killed: true,
          },
        };
      } else {
        return {
          ...this.createErrorResult(
            `Failed to kill shell '${params.shell_id}' (PID: ${process.pid}). Process may have already exited or permission denied.`,
          ),
          metadata: {
            executionTime: Date.now() - startTime,
            shell_id: params.shell_id,
            pid: process.pid,
            killed: false,
          },
        };
      }
    } catch (error: any) {
      // Check for abort
      if (signal.aborted) {
        return {
          ...this.createErrorResult('Kill operation was cancelled'),
          metadata: {
            executionTime: Date.now() - startTime,
            shell_id: params.shell_id,
          },
        };
      }

      // Handle errors
      const errorMessage = error.message || String(error);
      return {
        ...this.createErrorResult(`Error killing shell: ${errorMessage}`),
        metadata: {
          executionTime: Date.now() - startTime,
          shell_id: params.shell_id,
          error: errorMessage,
        },
      };
    }
  }
}
