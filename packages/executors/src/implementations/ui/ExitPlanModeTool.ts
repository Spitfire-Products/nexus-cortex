/**
 * ExitPlanMode Tool Executor
 *
 * Signals transition from planning mode to execution mode.
 * Used when agent has finished planning and is ready to implement.
 */

import { BaseTool, type ToolResult } from '../../base/index.js';
import { SchemaValidator } from '../../utils/SchemaValidator.js';
import type { ExecutorConfig } from '../../base/ToolRegistry.js';
import { markAutoResearchPlanMode } from '../../utils/autoResearchPlanGate.js';

/**
 * Parameters for the ExitPlanMode tool
 */
export interface ExitPlanModeToolParams {
  /**
   * The plan to present to the user for approval
   * Supports markdown formatting
   */
  plan: string;
}

/**
 * ExitPlanMode Tool Executor
 *
 * Features:
 * - Present finalized plan to user
 * - Signal mode transition
 * - Wait for user approval before execution
 *
 * Usage:
 * - ONLY use when task requires planning implementation steps
 * - For research tasks (gathering info, searching files) - do NOT use
 * - Plan should be clear and unambiguous
 * - If multiple approaches exist, use AskUserQuestion first to clarify
 */
export class ExitPlanModeTool extends BaseTool<
  ExitPlanModeToolParams,
  ToolResult
> {
  constructor(private config: ExecutorConfig) {
    super(
      'ExitPlanMode',
      'ExitPlanMode',
      `Use this tool when you are in plan mode and have finished presenting your plan and are ready to code. This will prompt the user to exit plan mode.

IMPORTANT: Only use this tool when the task requires planning the implementation steps of a task that requires writing code. For research tasks where you're gathering information, searching files, reading files or in general trying to understand the codebase - do NOT use this tool.

## Handling Ambiguity in Plans
Before using this tool, ensure your plan is clear and unambiguous. If there are multiple valid approaches or unclear requirements:
1. Use the AskUserQuestion tool to clarify with the user
2. Ask about specific implementation choices (e.g., architectural patterns, which library to use)
3. Clarify any assumptions that could affect the implementation
4. Only proceed with ExitPlanMode after resolving ambiguities`,
      {
        type: 'object',
        properties: {
          plan: {
            type: 'string',
            description:
              'The plan you came up with, that you want to run by the user for approval. Supports markdown. The plan should be pretty concise.',
            minLength: 10,
          },
        },
        required: ['plan'],
      },
    );
  }

  validateToolParams(params: ExitPlanModeToolParams): string | null {
    // Schema validation
    const schemaError = SchemaValidator.validate(this.parameterSchema, params);
    if (schemaError) {
      return schemaError;
    }

    // Validate plan is not empty
    if (!params.plan || !params.plan.trim()) {
      return 'Plan cannot be empty.';
    }

    // Validate minimum length (should be a meaningful plan)
    if (params.plan.trim().length < 10) {
      return 'Plan is too short. Please provide a meaningful plan (at least 10 characters).';
    }

    // Warn if plan is very long (should be concise)
    if (params.plan.length > 5000) {
      // Don't error, just note in metadata
      // Plan can be long if needed, but typically should be concise
    }

    return null;
  }

  getDescription(params: ExitPlanModeToolParams): string {
    const wordCount = params.plan.split(/\s+/).length;
    return `Presenting plan for approval (~${wordCount} words)`;
  }

  async execute(
    params: ExitPlanModeToolParams,
    signal: AbortSignal,
    updateOutput?: (output: string) => void,
  ): Promise<ToolResult> {
    const startTime = Date.now();

    try {
      // Check for abort
      if (signal.aborted) {
        return {
          ...this.createErrorResult('Plan presentation was cancelled'),
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

      // A valid plan was presented — satisfies the interactive auto-research plan-gate.
      markAutoResearchPlanMode();

      // Format the plan for presentation
      const formattedOutput = this.formatPlan(params.plan);

      // Calculate plan metrics
      const wordCount = params.plan.split(/\s+/).length;
      const lineCount = params.plan.split('\n').length;
      const hasMarkdown =
        params.plan.includes('**') ||
        params.plan.includes('##') ||
        params.plan.includes('- ');

      return {
        ...this.createSuccessResult(formattedOutput),
        metadata: {
          executionTime: Date.now() - startTime,
          planLength: params.plan.length,
          wordCount,
          lineCount,
          hasMarkdown,
        },
      };
    } catch (error: any) {
      // Check for abort
      if (signal.aborted) {
        return {
          ...this.createErrorResult('Plan presentation was cancelled'),
          metadata: {
            executionTime: Date.now() - startTime,
          },
        };
      }

      const errorMessage = error.message || String(error);
      return {
        ...this.createErrorResult(
          `Error presenting plan: ${errorMessage}`,
        ),
        metadata: {
          executionTime: Date.now() - startTime,
          error: errorMessage,
        },
      };
    }
  }

  /**
   * Format plan for user presentation
   */
  private formatPlan(plan: string): string {
    const lines: string[] = [];

    lines.push('=== Plan Ready for Execution ===\n\n');
    lines.push(plan);
    lines.push('\n\n---\n');
    lines.push(
      'Ready to exit plan mode and begin implementation.\n',
    );
    lines.push('Waiting for user approval...\n');

    return lines.join('');
  }
}
