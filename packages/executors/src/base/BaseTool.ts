/**
 * Base Tool Abstract Class
 *
 * Foundation for all tool executors in Nexus Cortex
 * Ported and adapted from OmniCode3 (Gemini CLI)
 *
 * Key Principle: Definition ≠ Execution
 * - Tool definitions live in @nexus-cortex/core
 * - Tool executors live here in @nexus-cortex/executors
 */

import type { ToolSchema } from '@nexus-cortex/types';
import type { ToolResult, ToolCallConfirmationDetails } from './ToolResult.js';

/**
 * Abstract base class for tool execution
 *
 * All tool executors must extend this class and implement:
 * - validateToolParams(): Validate parameters before execution
 * - execute(): Perform the actual tool operation
 *
 * Optionally override:
 * - shouldConfirmExecute(): Determine if user confirmation is needed
 * - getDescription(): Provide human-readable description of action
 */
export abstract class BaseTool<TParams = unknown, TResult extends ToolResult = ToolResult> {
  /**
   * Creates a new tool executor
   *
   * @param name Internal name of the tool (matches definition in core)
   * @param displayName User-friendly display name
   * @param description What the tool does
   * @param parameterSchema JSON Schema for parameters
   * @param isOutputMarkdown Whether output should be rendered as markdown
   * @param canUpdateOutput Whether tool supports streaming output
   */
  constructor(
    public readonly name: string,
    public readonly displayName: string,
    public readonly description: string,
    public readonly parameterSchema: ToolSchema,
    public readonly isOutputMarkdown: boolean = true,
    public readonly canUpdateOutput: boolean = false,
  ) {}

  /**
   * Validate parameters before execution
   *
   * MUST be implemented by all tool executors.
   * Should check:
   * - Required parameters are present
   * - Parameter types are correct
   * - Parameter values are valid
   * - Any tool-specific constraints
   *
   * @param params Parameters to validate
   * @returns Error message if invalid, null if valid
   */
  abstract validateToolParams(params: TParams): string | null;

  /**
   * Execute the tool with given parameters
   *
   * MUST be implemented by all tool executors.
   * This is where the actual tool logic runs.
   *
   * @param params Tool parameters (already validated)
   * @param signal AbortSignal for cancellation support
   * @param updateOutput Optional callback for streaming output
   * @returns Result of tool execution
   */
  abstract execute(
    params: TParams,
    signal: AbortSignal,
    updateOutput?: (output: string) => void,
  ): Promise<TResult>;

  /**
   * Get human-readable description of what the tool will do
   *
   * Used for logging, debugging, and user confirmation prompts.
   * Default implementation returns JSON stringified params.
   * Override to provide better descriptions.
   *
   * @param params Tool parameters
   * @returns Human-readable description
   */
  getDescription(params: TParams): string {
    return `Executing ${this.displayName} with: ${JSON.stringify(params)}`;
  }

  /**
   * Determine if tool execution should prompt for user confirmation
   *
   * Override this for tools that:
   * - Modify files
   * - Execute commands
   * - Make network requests
   * - Perform destructive operations
   *
   * Default: No confirmation required
   *
   * @param params Tool parameters
   * @param signal AbortSignal
   * @returns Confirmation details or false if no confirmation needed
   */
  async shouldConfirmExecute(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    params: TParams,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    signal: AbortSignal,
  ): Promise<ToolCallConfirmationDetails | false> {
    return false; // Default: no confirmation
  }

  /**
   * Helper: Create success result
   *
   * Convenience method for creating successful tool results
   */
  protected createSuccessResult(
    content: string | any[],
    metadata?: ToolResult['metadata'],
  ): ToolResult {
    return {
      llmContent: content,
      returnDisplay: typeof content === 'string' ? content : JSON.stringify(content, null, 2),
      success: true,
      metadata,
    };
  }

  /**
   * Helper: Create error result
   *
   * Convenience method for creating error tool results
   */
  protected createErrorResult(error: string | Error, metadata?: ToolResult['metadata']): ToolResult {
    const errorMessage = error instanceof Error ? error.message : error;

    return {
      llmContent: `Error: ${errorMessage}`,
      returnDisplay: `Error: ${errorMessage}`,
      success: false,
      error: errorMessage,
      metadata,
    };
  }
}
