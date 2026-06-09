/**
 * AskUserQuestion Tool Executor
 *
 * Present multiple-choice questions to users during execution.
 * Allows agent to gather user preferences, clarify ambiguous instructions,
 * and get decisions on implementation choices.
 */

import { BaseTool, type ToolResult } from '../../base/index.js';
import { SchemaValidator } from '../../utils/SchemaValidator.js';
import type { ExecutorConfig } from '../../base/ToolRegistry.js';

/**
 * Answer option for a question
 */
export interface QuestionOption {
  /**
   * Display text for this option (1-5 words)
   */
  label: string;

  /**
   * Explanation of what this option means
   */
  description: string;
}

/**
 * Single question with multiple choice options
 */
export interface Question {
  /**
   * The complete question to ask
   */
  question: string;

  /**
   * Short label displayed as chip/tag (max 12 chars)
   */
  header: string;

  /**
   * Available choices (2-4 options)
   */
  options: QuestionOption[];

  /**
   * Allow multiple selections
   */
  multiSelect: boolean;
}

/**
 * Parameters for the AskUserQuestion tool
 */
export interface AskUserQuestionToolParams {
  /**
   * Questions to ask (1-4 questions)
   */
  questions: Question[];

  /**
   * User's answers (filled by client)
   */
  answers?: Record<string, string>;
}

/**
 * AskUserQuestion Tool Executor
 *
 * Features:
 * - Present 1-4 multiple choice questions
 * - Each question has 2-4 options
 * - Support for single or multi-select
 * - Clear formatting for user interaction
 */
export class AskUserQuestionTool extends BaseTool<
  AskUserQuestionToolParams,
  ToolResult
> {
  constructor(private config: ExecutorConfig) {
    super(
      'AskUserQuestion',
      'AskUserQuestion',
      `Use this tool when you need to ask the user questions during execution. This allows you to:
1. Gather user preferences or requirements
2. Clarify ambiguous instructions
3. Get decisions on implementation choices as you work
4. Offer choices to the user about what direction to take.

Usage notes:
- Users will always be able to select "Other" to provide custom text input
- Use multiSelect: true to allow multiple answers to be selected for a question`,
      {
        type: 'object',
        properties: {
          questions: {
            type: 'array',
            minItems: 1,
            maxItems: 4,
            items: {
              type: 'object',
              properties: {
                question: {
                  type: 'string',
                  description:
                    'The complete question to ask the user. Should be clear, specific, and end with a question mark.',
                  minLength: 5,
                },
                header: {
                  type: 'string',
                  maxLength: 12,
                  description:
                    'Very short label displayed as a chip/tag (max 12 chars). Examples: "Auth method", "Library", "Approach".',
                  minLength: 1,
                },
                options: {
                  type: 'array',
                  minItems: 2,
                  maxItems: 4,
                  items: {
                    type: 'object',
                    properties: {
                      label: {
                        type: 'string',
                        description:
                          'The display text for this option (1-5 words)',
                        minLength: 1,
                      },
                      description: {
                        type: 'string',
                        description:
                          'Explanation of what this option means or what will happen if chosen',
                        minLength: 1,
                      },
                    },
                    required: ['label', 'description'],
                  },
                  description: 'Available choices (2-4 options)',
                },
                multiSelect: {
                  type: 'boolean',
                  description:
                    'Set to true to allow multiple selections. Default: false',
                  default: false,
                },
              },
              required: ['question', 'header', 'options', 'multiSelect'],
            },
            description: 'Questions to ask the user (1-4 questions)',
          },
          answers: {
            type: 'object',
            description:
              'User answers collected by the permission component (filled by client)',
          },
        },
        required: ['questions'],
      },
    );
  }

  validateToolParams(params: AskUserQuestionToolParams): string | null {
    // Schema validation
    const schemaError = SchemaValidator.validate(this.parameterSchema, params);
    if (schemaError) {
      return schemaError;
    }

    // Validate questions array
    if (!params.questions || params.questions.length === 0) {
      return 'Questions array cannot be empty.';
    }

    if (params.questions.length > 4) {
      return `Too many questions. Maximum: 4, provided: ${params.questions.length}`;
    }

    // Validate each question
    for (let i = 0; i < params.questions.length; i++) {
      const q = params.questions[i];
      if (!q) {
        return `Question ${i + 1} is undefined.`;
      }

      // Validate question text
      if (!q.question || q.question.trim().length < 5) {
        return `Question ${i + 1}: Question text must be at least 5 characters.`;
      }

      // Validate header
      if (!q.header || q.header.trim().length === 0) {
        return `Question ${i + 1}: Header cannot be empty.`;
      }

      if (q.header.length > 12) {
        return `Question ${i + 1}: Header too long (${q.header.length} chars, max 12).`;
      }

      // Validate options
      if (!q.options || q.options.length < 2) {
        return `Question ${i + 1}: Must have at least 2 options.`;
      }

      if (q.options.length > 4) {
        return `Question ${i + 1}: Too many options (${q.options.length}, max 4).`;
      }

      // Validate each option
      for (let j = 0; j < q.options.length; j++) {
        const opt = q.options[j];
        if (!opt) {
          return `Question ${i + 1}, Option ${j + 1} is undefined.`;
        }

        if (!opt.label || opt.label.trim().length === 0) {
          return `Question ${i + 1}, Option ${j + 1}: Label cannot be empty.`;
        }

        if (!opt.description || opt.description.trim().length === 0) {
          return `Question ${i + 1}, Option ${j + 1}: Description cannot be empty.`;
        }
      }

      // Validate multiSelect is boolean
      if (typeof q.multiSelect !== 'boolean') {
        return `Question ${i + 1}: multiSelect must be a boolean.`;
      }
    }

    return null;
  }

  getDescription(params: AskUserQuestionToolParams): string {
    const count = params.questions.length;
    return `Asking ${count} question${count > 1 ? 's' : ''}`;
  }

  async execute(
    params: AskUserQuestionToolParams,
    signal: AbortSignal,
    updateOutput?: (output: string) => void,
  ): Promise<ToolResult> {
    const startTime = Date.now();

    try {
      // Check for abort
      if (signal.aborted) {
        return {
          ...this.createErrorResult('Question prompt was cancelled'),
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

      // Format questions for display
      const formattedOutput = this.formatQuestions(params.questions);

      return {
        ...this.createSuccessResult(formattedOutput),
        metadata: {
          executionTime: Date.now() - startTime,
          questionCount: params.questions.length,
          questions: params.questions.map((q) => ({
            header: q.header,
            question: q.question,
            optionCount: q.options.length,
            multiSelect: q.multiSelect,
          })),
        },
      };
    } catch (error: any) {
      // Check for abort
      if (signal.aborted) {
        return {
          ...this.createErrorResult('Question prompt was cancelled'),
          metadata: {
            executionTime: Date.now() - startTime,
          },
        };
      }

      const errorMessage = error.message || String(error);
      return {
        ...this.createErrorResult(`Error presenting questions: ${errorMessage}`),
        metadata: {
          executionTime: Date.now() - startTime,
          error: errorMessage,
        },
      };
    }
  }

  /**
   * Format questions for user display
   */
  private formatQuestions(questions: Question[]): string {
    const lines: string[] = [];

    lines.push('=== User Questions ===\n\n');

    questions.forEach((q, i) => {
      // Header
      lines.push(`[${q.header}]\n`);

      // Question
      lines.push(`${q.question}\n`);

      // Multi-select indicator
      if (q.multiSelect) {
        lines.push('(You can select multiple options)\n');
      }

      lines.push('\n');

      // Options
      q.options.forEach((opt, j) => {
        lines.push(`${j + 1}. ${opt.label}\n`);
        lines.push(` ${opt.description}\n\n`);
      });

      // Separator between questions
      if (i < questions.length - 1) {
        lines.push('---\n\n');
      }
    });

    lines.push(
      '\nNote: The client will present these as interactive choices.\n',
    );

    return lines.join('');
  }
}
