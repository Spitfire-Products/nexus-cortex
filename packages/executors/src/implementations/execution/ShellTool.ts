/**
 * Shell Tool Executor
 *
 * Executes shell commands via bash/cmd and captures output.
 * Supports background processes, timeouts, and abort handling.
 *
 * Adapted and simplified from Gemini CLI patterns
 * - Removed: Complex allow/block lists, summarization
 * - Kept: Core execution, background process detection, timeout enforcement
 * - Simplified: Security model (path-based only)
 */

import os from 'os';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { spawn } from 'child_process';
import { BaseTool, type ToolResult } from '../../base/index.js';
import { SchemaValidator } from '../../utils/SchemaValidator.js';
import { TmuxManager, SessionPersistence } from '../../utils/index.js';
import { BackgroundProcessRegistry } from './BackgroundProcessRegistry.js';
import type { ExecutorConfig } from '../../base/ToolRegistry.js';

/**
 * Parameters for the Shell tool
 */
export interface ShellToolParams {
  /**
   * The bash command to execute
   */
  command: string;

  /**
   * Optional directory to run the command in (relative to working directory)
   */
  directory?: string;

  /**
   * Optional timeout in milliseconds (default: 120000ms = 2 minutes)
   */
  timeout?: number;

  /**
   * Run command in background and return immediately with a bash_id.
   * Use BashOutput to poll output, KillShell to stop.
   */
  run_in_background?: boolean;

  /**
   * Run command in persistent tmux session (requires tmux)
   */
  persistentSession?: boolean;

  /**
   * ID of persistent session (auto-generated if not provided)
   */
  sessionId?: string;

  /**
   * Capture entire scrollback history (for persistent sessions)
   */
  captureHistory?: boolean;
}

/**
 * Shell Tool Executor
 *
 * Features:
 * - Executes commands via bash -c (or cmd.exe on Windows)
 * - Captures stdout, stderr, exit code
 * - Background process detection (Unix only)
 * - Timeout enforcement
 * - Abort signal support
 * - Streaming output updates
 *
 * Security:
 * - Commands run in specified working directory
 * - Path traversal prevention for directory parameter
 * - Blocks command substitution with $()
 */
export class ShellTool extends BaseTool<ShellToolParams, ToolResult> {
  private static readonly DEFAULT_TIMEOUT_MS = 120000; // 2 minutes
  private static readonly OUTPUT_UPDATE_INTERVAL_MS = 1000; // 1 second
  private static readonly MAX_OUTPUT_LENGTH = 30000; // ~30KB max to prevent context overflow

  private tmux: TmuxManager;
  private persistence: SessionPersistence;

  constructor(private config: ExecutorConfig) {
    super(
      'Bash',
      'Execute',
      `Executes a shell command via bash (or cmd.exe on Windows). Returns stdout, stderr, exit code, and background process IDs. Commands run in a subprocess that leads its own process group. CRITICAL: Always use literal characters in commands - never HTML-encode special characters (use && not &amp;&amp;, < not &lt;, > not &gt;).`,
      {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description:
              'The shell command to execute. Can use && to chain commands, & for background processes. IMPORTANT: Use literal characters (&& not &amp;&amp;, < not &lt;, > not &gt;). Never use HTML entities in commands.',
          },
          directory: {
            type: 'string',
            description:
              'Optional: Directory to run command in (relative to working directory).',
          },
          timeout: {
            type: 'number',
            description:
              'Optional: Timeout in milliseconds (default: 120000ms = 2 minutes).',
          },
        },
        required: ['command'],
      },
    );

    this.tmux = TmuxManager.getInstance();
    this.persistence = new SessionPersistence(config.workingDirectory || process.cwd());
  }

  validateToolParams(params: ShellToolParams): string | null {
    // Schema validation
    const schemaError = SchemaValidator.validate(this.parameterSchema, params);
    if (schemaError) {
      return schemaError;
    }

    // Validate command is not empty
    if (!params.command || !params.command.trim()) {
      return 'Command cannot be empty.';
    }

    // Security: block command substitution with $()
    if (params.command.includes('$(')) {
      return 'Command substitution using $() is not allowed for security reasons.';
    }

    // Validate directory if provided
    if (params.directory) {
      if (path.isAbsolute(params.directory)) {
        return 'Directory must be relative to working directory, not absolute.';
      }

      // Resolve and check directory exists
      const resolvedDir = path.resolve(
        this.config.workingDirectory,
        params.directory,
      );

      // Security: ensure directory is within working directory
      if (!resolvedDir.startsWith(this.config.workingDirectory)) {
        return `Directory must be within working directory.`;
      }

      // Check directory exists
      try {
        if (!fs.existsSync(resolvedDir)) {
          return `Directory does not exist: ${params.directory}`;
        }
        const stats = fs.statSync(resolvedDir);
        if (!stats.isDirectory()) {
          return `Path is not a directory: ${params.directory}`;
        }
      } catch (error: any) {
        return `Error accessing directory: ${error.message}`;
      }
    }

    // Validate timeout if provided
    if (params.timeout !== undefined) {
      if (typeof params.timeout !== 'number' || params.timeout <= 0) {
        return 'Timeout must be a positive number.';
      }
    }

    return null;
  }

  getDescription(params: ShellToolParams): string {
    if (!params || !params.command) {
      return 'Execute shell command';
    }

    let description = params.command;
    if (params.directory) {
      description += ` [in ${params.directory}]`;
    }
    return description;
  }

  async execute(
    params: ShellToolParams,
    signal: AbortSignal,
    updateOutput?: (output: string) => void,
  ): Promise<ToolResult> {
    const startTime = Date.now();

    // Validate parameters
    const validationError = this.validateToolParams(params);
    if (validationError) {
      return this.createErrorResult(validationError);
    }

    if (signal.aborted) {
      return this.createErrorResult('Command was cancelled before it could start.');
    }

    // Guard: redirect commands that should use dedicated tools
    const redirectMessage = this.checkToolRedirect(params.command);
    if (redirectMessage) {
      return this.createErrorResult(redirectMessage);
    }

    // Check if background execution requested
    if (params.run_in_background) {
      return this.executeInBackground(params, signal);
    }

    // Check if persistent session requested
    if (params.persistentSession) {
      return this.executeInPersistentSession(params, signal, updateOutput);
    }

    try {
      const result = await this.executeCommand(params, signal, updateOutput);

      // Check if command was aborted during execution
      if (signal.aborted) {
        return this.createErrorResult('Command was cancelled by user.');
      }

      return this.createSuccessResult(result.llmContent, {
        executionTime: Date.now() - startTime,
        exitCode: result.exitCode,
        signal: result.processSignal,
        backgroundPIDs: result.backgroundPIDs,
        processGroupPGID: result.pgid,
        truncated: result.truncated,
      });
    } catch (error: any) {
      if (error.name === 'AbortError' || signal.aborted) {
        return this.createErrorResult('Command was cancelled by user.');
      }
      return this.createErrorResult(`Failed to execute command: ${error.message}`);
    }
  }

  /**
   * Executes the shell command and captures output
   * @private
   */
  private async executeCommand(
    params: ShellToolParams,
    signal: AbortSignal,
    updateOutput?: (output: string) => void,
  ): Promise<{
    llmContent: string;
    exitCode: number | null;
    processSignal: NodeJS.Signals | null;
    backgroundPIDs: number[];
    pgid: number | null;
    truncated: boolean;
  }> {
    const isWindows = os.platform() === 'win32';
    const timeout = params.timeout || ShellTool.DEFAULT_TIMEOUT_MS;

    // Create temp file for background PID detection (Unix only)
    const tempFileName = `shell_pgrep_${crypto.randomBytes(6).toString('hex')}.tmp`;
    const tempFilePath = path.join(os.tmpdir(), tempFileName);

    // Wrap command to capture background PIDs (Unix only)
    const command = isWindows
      ? params.command
      : (() => {
          let cmd = params.command.trim();
          if (!cmd.endsWith('&')) cmd += ';';
          return `{ ${cmd} }; __code=$?; pgrep -g 0 >${tempFilePath} 2>&1; exit $__code;`;
        })();

    // Determine working directory
    const cwd = params.directory
      ? path.resolve(this.config.workingDirectory, params.directory)
      : this.config.workingDirectory;

    // Spawn process
    const shell = isWindows
      ? spawn('cmd.exe', ['/c', params.command], {
          stdio: ['ignore', 'pipe', 'pipe'],
          cwd,
        })
      : spawn('bash', ['-c', command], {
          stdio: ['ignore', 'pipe', 'pipe'],
          detached: true, // Create process group
          cwd,
        });

    // Output tracking
    let exited = false;
    let stdout = '';
    let stderr = '';
    let output = '';
    let lastUpdateTime = Date.now();

    const appendOutput = (str: string) => {
      output += str;
      if (
        updateOutput &&
        Date.now() - lastUpdateTime > ShellTool.OUTPUT_UPDATE_INTERVAL_MS
      ) {
        updateOutput(output);
        lastUpdateTime = Date.now();
      }
    };

    // Capture stdout
    shell.stdout?.on('data', (data: Buffer) => {
      if (!exited) {
        const str = this.stripAnsi(data.toString());
        stdout += str;
        appendOutput(str);
      }
    });

    // Capture stderr
    shell.stderr?.on('data', (data: Buffer) => {
      if (!exited) {
        const str = this.stripAnsi(data.toString());
        stderr += str;
        appendOutput(str);
      }
    });

    // Error handling
    let errorMessage: string | null = null;
    shell.on('error', (err: Error) => {
      // Remove wrapper from error message
      errorMessage = err.message.replace(command, params.command);
    });

    // Exit handling
    let exitCode: number | null = null;
    let processSignal: NodeJS.Signals | null = null;
    shell.on('exit', (code: number | null, sig: NodeJS.Signals | null) => {
      exited = true;
      exitCode = code;
      processSignal = sig;
    });

    // Abort handler
    const abortHandler = async () => {
      if (shell.pid && !exited) {
        await this.killProcess(shell.pid, isWindows);
      }
    };
    signal.addEventListener('abort', abortHandler);

    // Timeout handler
    const timeoutId = setTimeout(async () => {
      if (!exited && shell.pid) {
        await this.killProcess(shell.pid, isWindows);
      }
    }, timeout);

    try {
      // Wait for process to exit
      await new Promise<void>((resolve) => {
        shell.on('exit', () => resolve());
      });
    } finally {
      clearTimeout(timeoutId);
      signal.removeEventListener('abort', abortHandler);
    }

    // Parse background PIDs (Unix only)
    const backgroundPIDs: number[] = [];
    if (!isWindows && fs.existsSync(tempFilePath)) {
      try {
        const pgrepLines = fs
          .readFileSync(tempFilePath, 'utf8')
          .split('\n')
          .filter(Boolean);
        for (const line of pgrepLines) {
          if (/^\d+$/.test(line)) {
            const pid = Number(line);
            if (pid !== shell.pid) {
              backgroundPIDs.push(pid);
            }
          }
        }
        fs.unlinkSync(tempFilePath);
      } catch (err) {
        // Ignore errors reading pgrep output
      }
    }

    // Format output with truncation to prevent context overflow
    let llmContent = '';
    let truncated = false;

    const truncateIfNeeded = (content: string): string => {
      if (content.length > ShellTool.MAX_OUTPUT_LENGTH) {
        truncated = true;
        // Keep first part and last part for context
        const halfLimit = Math.floor(ShellTool.MAX_OUTPUT_LENGTH / 2) - 50;
        const firstPart = content.substring(0, halfLimit);
        const lastPart = content.substring(content.length - halfLimit);
        return `${firstPart}\n\n... [${content.length - ShellTool.MAX_OUTPUT_LENGTH} characters truncated for context efficiency] ...\n\n${lastPart}`;
      }
      return content;
    };

    if (signal.aborted) {
      llmContent = 'Command was cancelled by user before it could complete.';
      if (output.trim()) {
        llmContent += `\n\nOutput before cancellation:\n${truncateIfNeeded(output)}`;
      } else {
        llmContent += ' No output was produced before cancellation.';
      }
    } else {
      // Concise output format
      if (exitCode === 0) {
        // Success: Just show stdout if present, otherwise confirmation
        llmContent = truncateIfNeeded(stdout) || '(command completed successfully)';
      } else {
        // Failure: Show error and stderr
        const parts: string[] = [];
        if (errorMessage) {
          parts.push(`Error: ${errorMessage}`);
        }
        if (stderr) {
          parts.push(`Stderr: ${truncateIfNeeded(stderr)}`);
        }
        if (parts.length === 0) {
          parts.push(`Command failed with exit code ${exitCode}`);
        }
        llmContent = parts.join('\n');
      }
    }

    return {
      llmContent,
      exitCode,
      processSignal,
      backgroundPIDs,
      pgid: shell.pid ?? null,
      truncated,
    };
  }

  /**
   * Kills a process and its children
   * @private
   */
  private async killProcess(pid: number, isWindows: boolean): Promise<void> {
    if (isWindows) {
      // Windows: use taskkill to kill process tree
      spawn('taskkill', ['/pid', pid.toString(), '/f', '/t']);
    } else {
      // Unix: kill process group
      try {
        // Try SIGTERM first
        process.kill(-pid, 'SIGTERM');
        await new Promise((resolve) => setTimeout(resolve, 200));
        // Fall back to SIGKILL if still running
        try {
          process.kill(-pid, 'SIGKILL');
        } catch {
          // Process already exited
        }
      } catch {
        // If group kill fails, try killing just the process
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          // Process already exited
        }
      }
    }
  }

  /**
   * Execute command in persistent tmux session
   * @private
   */
  private async executeInPersistentSession(
    params: ShellToolParams,
    signal: AbortSignal,
    updateOutput?: (output: string) => void,
  ): Promise<ToolResult> {
    const startTime = Date.now();

    // Check tmux availability
    if (!(await this.tmux.isAvailable())) {
      return this.createErrorResult(
        'tmux is not available. Persistent sessions require tmux to be installed.\n\n' +
        'Installation:\n' +
        ' - Ubuntu/Debian: apt-get install tmux\n' +
        ' - macOS: brew install tmux\n' +
        ' - Replit: Add tmux in the Packages tab\n\n' +
        'Falling back to standard execution is not automatic. Please either:\n' +
        '1. Install tmux and retry\n' +
        '2. Remove persistentSession=true to use standard execution'
      );
    }

    try {
      // Generate or use provided session ID
      const sessionId = params.sessionId || `bash-${crypto.randomBytes(4).toString('hex')}`;

      updateOutput?.(`Using persistent session: ${sessionId}\n`);

      // Determine working directory
      const cwd = params.directory
        ? path.resolve(this.config.workingDirectory, params.directory)
        : this.config.workingDirectory;

      // Create session if doesn't exist
      if (!(await this.tmux.sessionExists(sessionId))) {
        updateOutput?.(`Creating new tmux session...\n`);
        await this.tmux.createSession(sessionId, cwd);

        // Save session metadata
        await this.persistence.saveSession({
          sessionId,
          created: new Date(),
          lastUsed: new Date(),
          cwd
        });
      } else {
        // Touch existing session
        await this.persistence.touchSession(sessionId);
      }

      // Send command to session
      updateOutput?.(`Sending command: ${params.command}\n`);
      await this.tmux.sendKeys(sessionId, params.command);

      // Wait for command to complete (simple delay-based approach)
      const timeout = params.timeout || ShellTool.DEFAULT_TIMEOUT_MS;
      await new Promise((resolve) => setTimeout(resolve, Math.min(timeout, 5000)));

      // Capture output
      updateOutput?.(`Capturing output...\n`);
      const startLine = params.captureHistory ? -3000 : undefined;
      const output = await this.tmux.capturePane(sessionId, startLine);

      const result = `Command executed in persistent tmux session '${sessionId}'.\n\n` +
        `Output:\n${'='.repeat(60)}\n${output}\n${'='.repeat(60)}\n\n` +
        `Session persists after this command completes. You can:\n` +
        `- Send more commands: persistentSession=true, sessionId='${sessionId}'\n` +
        `- Inspect session: TmuxSession tool with action='capture', sessionId='${sessionId}'\n` +
        `- Kill session: TmuxSession tool with action='kill', sessionId='${sessionId}'`;

      return this.createSuccessResult(result, {
        executionTime: Date.now() - startTime,
        sessionId,
        persistent: true,
        sessionCwd: cwd
      });
    } catch (error: any) {
      if (signal.aborted) {
        return this.createErrorResult('Command was cancelled by user.');
      }
      return this.createErrorResult(`Failed to execute in persistent session: ${error.message}`);
    }
  }

  /**
   * Checks if a command should be routed to a dedicated tool instead of Bash.
   * Returns an error message with guidance if redirected, or null if allowed.
   * @private
   */
  private checkToolRedirect(command: string): string | null {
    const trimmed = command.trim();

    // File reading: cat, head, tail → Read tool
    if (/^(cat|head|tail)\s+/.test(trimmed) && !trimmed.includes('|') && !trimmed.includes('>')) {
      return `Use the Read tool instead of \`${trimmed.split(/\s+/)[0]}\` for reading files. ` +
        `Example: Read({ file_path: "${trimmed.split(/\s+/).slice(1).join(' ').replace(/["']/g, '')}" })`;
    }

    // File editing: sed -i, awk -i → Edit tool
    if (/^sed\s+(-i|--in-place)\b/.test(trimmed) || /^perl\s+-[pn]?i\b/.test(trimmed)) {
      return `Use the Edit tool instead of \`${trimmed.split(/\s+/)[0]}\` for editing files. ` +
        `Read the file first, then use Edit({ file_path, old_string, new_string }).`;
    }

    // File writing: echo > file, cat > file, tee file → Write tool
    if (/^(echo|printf|cat)\s+.*\s+>\s+\S/.test(trimmed) || /^tee\s+\S/.test(trimmed)) {
      return `Use the Write tool instead of shell redirection for creating/writing files. ` +
        `Example: Write({ file_path: "path", content: "content" })`;
    }

    // File searching: grep, rg, ag → Grep tool
    if (/^(grep|rg|ag|ack)\s+/.test(trimmed) && !trimmed.includes('|')) {
      return `Use the Grep tool instead of \`${trimmed.split(/\s+/)[0]}\` for searching file contents. ` +
        `Example: Grep({ pattern: "search term", path: "directory" })`;
    }

    // File finding: find → Glob tool
    if (/^find\s+/.test(trimmed) && /-name\b/.test(trimmed)) {
      return `Use the Glob tool instead of \`find\` for finding files. ` +
        `Example: Glob({ pattern: "**/*.ts", path: "directory" })`;
    }

    return null;
  }

  /**
   * Execute command in background — returns immediately with bash_id.
   * The process is registered in BackgroundProcessRegistry for polling via BashOutput.
   * @private
   */
  private executeInBackground(
    params: ShellToolParams,
    signal: AbortSignal,
  ): ToolResult {
    const startTime = Date.now();
    const isWindows = os.platform() === 'win32';

    // Determine working directory
    const cwd = params.directory
      ? path.resolve(this.config.workingDirectory, params.directory)
      : this.config.workingDirectory;

    // Generate a unique shell ID
    const shellId = `bg-${crypto.randomBytes(4).toString('hex')}`;

    try {
      // Spawn process — do NOT wait for completion
      const shell = isWindows
        ? spawn('cmd.exe', ['/c', params.command], {
            stdio: ['ignore', 'pipe', 'pipe'],
            cwd,
          })
        : spawn('bash', ['-c', params.command], {
            stdio: ['ignore', 'pipe', 'pipe'],
            detached: true,
            cwd,
          });

      if (!shell.pid) {
        return this.createErrorResult('Failed to spawn background process.');
      }

      // Register in BackgroundProcessRegistry — this sets up output capture and exit monitoring
      const registry = BackgroundProcessRegistry.getInstance();
      registry.registerProcess(shellId, shell.pid, params.command, shell);

      // Unref the process so it doesn't prevent Node.js from exiting
      shell.unref();

      const result = `Background process started with ID: ${shellId}\n` +
        `PID: ${shell.pid}\n` +
        `Command: ${params.command}\n\n` +
        `Use BashOutput({ bash_id: "${shellId}" }) to check output.\n` +
        `Use KillShell({ shell_id: "${shellId}" }) to stop.`;

      return {
        ...this.createSuccessResult(result),
        metadata: {
          executionTime: Date.now() - startTime,
          bash_id: shellId,
          pid: shell.pid,
          backgroundProcess: true,
        },
      };
    } catch (error: any) {
      return this.createErrorResult(`Failed to start background process: ${error.message}`);
    }
  }

  /**
   * Removes ANSI escape codes from string
   * @private
   */
  private stripAnsi(str: string): string {
    // eslint-disable-next-line no-control-regex
    return str.replace(
      /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g,
      '',
    );
  }
}
