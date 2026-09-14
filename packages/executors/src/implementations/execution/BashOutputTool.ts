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
import { BackgroundProcessRegistry, type BackgroundProcess } from './BackgroundProcessRegistry.js';

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

  /**
   * HB-WAIT-PRIMITIVE (R142): block up to this many seconds (0-600) for new output or
   * process exit, returning early when either happens. A side-effect-free wait.
   */
  wait_seconds?: number;

  /**
   * R142: regex; return as soon as NEW output matches it (else at the wait_seconds timeout).
   */
  wait_for?: string;
}

/** R142: result-text prefix shape `[wait] <elapsed>s, <outcome>`. */
export type BashOutputWaitOutcome = 'output' | 'matched' | 'exited' | 'timeout';

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
      `Retrieves output from a running or completed background bash shell. Returns stdout and stderr output along with shell status. Always returns only new output since the last check. To wait for a result, pass wait_seconds (block up to N s for new output or exit) and/or wait_for (regex; return as soon as new output matches) — prefer these over sleep polling; the result then starts with "[wait] <elapsed>s, <output|matched|exited|timeout>".`,
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
          wait_seconds: {
            type: 'number',
            description:
              'Optional: block up to this many seconds (0-600) for NEW output or process exit, returning early when either happens. Side-effect free; use instead of sleep polling.',
          },
          wait_for: {
            type: 'string',
            description:
              'Optional: regex; return as soon as NEW output matches it, else at the wait_seconds timeout (default 30 s when only wait_for is given).',
          },
        },
        required: ['bash_id'],
      },
    );

    this.registry = BackgroundProcessRegistry.getInstance();
  }

  /** R142 defaults: wait_for without wait_seconds waits this long; poll cadence for the wait loop. */
  private static readonly DEFAULT_WAIT_FOR_SECONDS = 30;
  private static readonly MAX_WAIT_SECONDS = 600;
  private static readonly WAIT_POLL_INTERVAL_MS = 200;

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

    // R142: wait parameters
    if (params.wait_seconds !== undefined) {
      if (typeof params.wait_seconds !== 'number' || !Number.isFinite(params.wait_seconds) ||
          params.wait_seconds < 0 || params.wait_seconds > BashOutputTool.MAX_WAIT_SECONDS) {
        return `wait_seconds must be a number between 0 and ${BashOutputTool.MAX_WAIT_SECONDS}.`;
      }
    }
    if (params.wait_for !== undefined) {
      if (typeof params.wait_for !== 'string' || !params.wait_for) {
        return 'wait_for must be a non-empty regex string.';
      }
      try {
        new RegExp(params.wait_for);
      } catch (error: any) {
        return `Invalid wait_for regex: ${error.message}`;
      }
    }

    return null;
  }

  /**
   * R142 HB-WAIT-PRIMITIVE: block until NEW output (past `lastLine`) arrives, `wait_for`
   * matches a new line, the process exits, or the deadline passes. Re-pulls external
   * handles (herdr/tmux panes) through their refresh hook on every poll.
   */
  private async waitForProgress(
    process: BackgroundProcess,
    lastLine: number,
    params: BashOutputToolParams,
    signal: AbortSignal,
  ): Promise<{ outcome: BashOutputWaitOutcome; elapsedMs: number }> {
    const started = Date.now();
    const seconds = params.wait_seconds ?? (params.wait_for ? BashOutputTool.DEFAULT_WAIT_FOR_SECONDS : 0);
    const deadline = started + seconds * 1000;
    const re = params.wait_for ? new RegExp(params.wait_for) : null;
    for (;;) {
      if (process.refresh) {
        await process.refresh();
      }
      const fresh = process.output.slice(lastLine);
      if (re) {
        if (fresh.some((line) => re.test(line))) return { outcome: 'matched', elapsedMs: Date.now() - started };
      } else if (fresh.length > 0) {
        return { outcome: 'output', elapsedMs: Date.now() - started };
      }
      if (!process.isRunning) return { outcome: 'exited', elapsedMs: Date.now() - started };
      if (Date.now() >= deadline || signal.aborted) return { outcome: 'timeout', elapsedMs: Date.now() - started };
      await new Promise((resolve) => setTimeout(resolve, Math.min(BashOutputTool.WAIT_POLL_INTERVAL_MS, Math.max(1, deadline - Date.now()))));
    }
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

      // R142: the side-effect-free wait (also refreshes external handles each poll).
      let wait: { outcome: BashOutputWaitOutcome; elapsedMs: number } | null = null;
      if (params.wait_seconds !== undefined || params.wait_for !== undefined) {
        wait = await this.waitForProgress(process, lastLine, params, signal);
      } else if (process.refresh) {
        // R146: external handles (herdr pane) re-pull their output from the backend first.
        await process.refresh();
      }

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

      const waitPrefix = wait ? `[wait] ${(wait.elapsedMs / 1000).toFixed(1)}s, ${wait.outcome}\n` : '';
      const fullOutput = `${waitPrefix}${statusLines.join('\n')}\n\n=== Output ===\n${outputText}`;

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
          ...(wait ? { wait: { outcome: wait.outcome, elapsedMs: wait.elapsedMs, ...(params.wait_for ? { wait_for: params.wait_for } : {}) } } : {}),
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
