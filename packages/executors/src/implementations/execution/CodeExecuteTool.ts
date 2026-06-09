/**
 * Code Execute Tool
 *
 * Executes JavaScript code in a Node.js child process with injected
 * tool-calling globals. Enables non-PTC models to chain multiple tool
 * calls in a single turn — only console.log() output enters context.
 *
 * Similar to Anthropic PTC but runs locally in Node.js instead of
 * Anthropic's Python sandbox.
 */

import { spawn } from 'child_process';
import { BaseTool, type ToolResult } from '../../base/index.js';
import { SchemaValidator } from '../../utils/SchemaValidator.js';

/** Maximum output length (30KB) */
const MAX_OUTPUT_LENGTH = 30_000;

/** Default execution timeout in ms */
const DEFAULT_TIMEOUT_MS = 5_000;

/** Maximum allowed timeout */
const MAX_TIMEOUT_MS = 30_000;

export interface CodeExecuteParams {
  /** JavaScript code to execute (top-level await supported via async wrapper) */
  code: string;
  /** Execution timeout in ms (default 5000, max 30000) */
  timeout?: number;
}

/**
 * Code execution tool for token-efficient tool chaining.
 *
 * The agent writes JavaScript that can call tools via injected globals.
 * Only console.log() output is captured and returned as the tool result.
 */
export class CodeExecuteTool extends BaseTool<CodeExecuteParams> {
  constructor() {
    super(
      'CodeExecute',
      'Code Execute',
      'Execute JavaScript code for token-efficient tool chaining. Only console.log() output enters context.',
      {
        type: 'object',
        properties: {
          code: {
            type: 'string',
            description: 'JavaScript code to execute. Top-level await supported. Use console.log() to output results.',
          },
          timeout: {
            type: 'number',
            description: 'Execution timeout in ms (default 5000, max 30000)',
          },
        },
        required: ['code'],
      },
    );
  }

  validateToolParams(params: CodeExecuteParams): string | null {
    const error = SchemaValidator.validate(this.parameterSchema, params);
    if (error) return error;
    if (!params.code || typeof params.code !== 'string') {
      return '"code" parameter is required and must be a string';
    }
    return null;
  }

  async execute(
    params: CodeExecuteParams,
    signal: AbortSignal,
  ): Promise<ToolResult> {
    if (signal.aborted) {
      return { llmContent: 'Aborted', success: false, error: 'Aborted' };
    }

    const timeout = Math.min(
      Math.max(params.timeout ?? DEFAULT_TIMEOUT_MS, 100),
      MAX_TIMEOUT_MS,
    );

    // Wrap user code in async IIFE for top-level await
    const wrappedCode = `
(async () => {
  try {
    ${params.code}
  } catch (e) {
    console.error('Error:', e.message || e);
    process.exit(1);
  }
})();
`;

    try {
      const result = await this.runNodeProcess(wrappedCode, timeout, signal);
      return { llmContent: result, success: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { llmContent: `Error: ${msg}`, success: false, error: msg };
    }
  }

  private runNodeProcess(
    code: string,
    timeout: number,
    signal: AbortSignal,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn('node', ['-e', code], {
        timeout,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, NODE_NO_WARNINGS: '1' },
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
        if (stdout.length > MAX_OUTPUT_LENGTH) {
          proc.kill();
        }
      });

      proc.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      const onAbort = () => {
        proc.kill();
        reject(new Error('Aborted'));
      };
      signal.addEventListener('abort', onAbort, { once: true });

      proc.on('close', (exitCode) => {
        signal.removeEventListener('abort', onAbort);

        let output = stdout;
        if (output.length > MAX_OUTPUT_LENGTH) {
          output = output.slice(0, MAX_OUTPUT_LENGTH) + '\n[output truncated]';
        }

        if (exitCode !== 0 && stderr) {
          output += (output ? '\n' : '') + stderr;
        }

        resolve(output || '(no output)');
      });

      proc.on('error', (err) => {
        signal.removeEventListener('abort', onAbort);
        reject(err);
      });
    });
  }

  async shouldConfirmExecute(
    params: CodeExecuteParams,
  ): Promise<false | import('../../base/ToolResult.js').ToolCallConfirmationDetails> {
    // Always require user approval (graylist)
    return {
      description: `Execute code: ${params.code.slice(0, 100)}${params.code.length > 100 ? '...' : ''}`,
      requiresConfirmation: true,
      severity: 'warning',
      context: 'Code execution requires user approval',
    };
  }
}
