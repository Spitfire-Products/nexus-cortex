/**
 * Bash tool executor (file: ShellTool.ts — historical name; registers as 'Bash')
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
 * Parameters for the Bash tool
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
 * Bash tool executor (file: ShellTool.ts — historical name; registers as 'Bash')
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
  private static readonly MAX_TIMEOUT_MS = 600000; // 10 minutes — hard ceiling, requested timeouts are clamped
  private static readonly OUTPUT_UPDATE_INTERVAL_MS = 1000; // 1 second
  private static readonly MAX_OUTPUT_LENGTH = 30000; // ~30KB max to prevent context overflow
  private static readonly PERSISTENT_POLL_INTERVAL_MS = 400; // sentinel poll cadence for tmux sessions

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
              'Optional: Timeout in milliseconds (default: 120000ms = 2 minutes, max: 600000ms = 10 minutes).',
          },
          description: {
            type: 'string',
            description: 'Optional: Clear description of what this command does.',
          },
          run_in_background: {
            type: 'boolean',
            description:
              'Optional: Run command in background and return immediately with a bash_id. Use BashOutput to poll output, KillShell to stop.',
          },
          persistentSession: {
            type: 'boolean',
            description:
              'Optional: Run command in a persistent tmux session (state, cwd, and env persist across calls). Requires tmux.',
          },
          sessionId: {
            type: 'string',
            description:
              'Optional: ID of the persistent session to use or create (auto-generated if not provided). Only used when persistentSession=true.',
          },
          captureHistory: {
            type: 'boolean',
            description:
              'Optional: Capture entire scrollback history for persistent sessions (default: false).',
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

      // Project-boundary enforcement is handled upstream by WorkspaceBoundaryPolicy
      // (approval-gated): a `directory` outside the project root prompts the user
      // (or is auto-approved under --yolo / pre-granted via --add-dir) rather than
      // being silently rejected here.

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
        timedOut: result.timedOut,
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
    timedOut: boolean;
  }> {
    const isWindows = os.platform() === 'win32';
    const timeout = this.resolveTimeoutMs(params);

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
    let timedOut = false;
    const timeoutId = setTimeout(async () => {
      if (!exited && shell.pid) {
        timedOut = true;
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
    } else if (timedOut) {
      // Timeout: explicit, actionable message (was: opaque "exit code null")
      llmContent = `Command timed out after ${timeout}ms and was killed.`;
      if (output.trim()) {
        llmContent += `\n\nOutput before timeout:\n${truncateIfNeeded(output)}`;
      } else {
        llmContent += ' No output was produced before the timeout.';
      }
      llmContent += `\n\nFor long-running commands, set run_in_background: true and poll with BashOutput, or raise timeout (max ${ShellTool.MAX_TIMEOUT_MS}ms).`;
    } else {
      // Concise output format
      if (exitCode === 0) {
        // Success: stdout, plus labeled stderr when present (warnings matter —
        // deprecations, npm/compiler warnings surface on stderr with exit 0)
        llmContent = truncateIfNeeded(stdout) || '(command completed successfully)';
        if (stderr.trim()) {
          llmContent += `\nStderr: ${truncateIfNeeded(stderr)}`;
        }
      } else {
        // Failure: show stdout too (test runners and build tools print the
        // failure detail to stdout), then error/stderr, then the exit code
        const parts: string[] = [];
        if (stdout.trim()) {
          parts.push(truncateIfNeeded(stdout));
        }
        if (errorMessage) {
          parts.push(`Error: ${errorMessage}`);
        }
        if (stderr.trim()) {
          parts.push(`Stderr: ${truncateIfNeeded(stderr)}`);
        }
        parts.push(
          processSignal
            ? `Command failed with exit code ${exitCode} (signal: ${processSignal})`
            : `Command failed with exit code ${exitCode}`,
        );
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
      timedOut,
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

      // Send command to session with a completion sentinel appended so we can
      // detect ACTUAL completion + exit code instead of the old fixed 5s sleep
      // (which silently returned mid-run for any command longer than 5s).
      // The `\$?` keeps the host shell (execAsync in sendKeys wraps the keys in
      // double quotes) from expanding $? — the session shell must expand it.
      updateOutput?.(`Sending command: ${params.command}\n`);
      const sentinel = `__CORTEX_DONE_${crypto.randomBytes(4).toString('hex')}`;
      await this.tmux.sendKeys(sessionId, `${params.command}; printf '${sentinel}_%d\\n' \\$?`);

      // Poll pane until the sentinel appears or the timeout elapses
      const timeout = this.resolveTimeoutMs(params);
      const deadline = Date.now() + timeout;
      const startLine = params.captureHistory ? -3000 : undefined;
      let output = '';
      let completed = false;
      let sessionExitCode: number | null = null;
      while (Date.now() < deadline && !signal.aborted) {
        await new Promise((resolve) =>
          setTimeout(resolve, ShellTool.PERSISTENT_POLL_INTERVAL_MS),
        );
        output = await this.tmux.capturePane(sessionId, startLine);
        const parsed = ShellTool.parseSentinel(output, sentinel);
        if (parsed.done) {
          completed = true;
          sessionExitCode = parsed.exitCode;
          break;
        }
      }
      const cleanedOutput = ShellTool.stripSentinelLines(output, sentinel);

      const statusLine = completed
        ? `Command completed with exit code ${sessionExitCode}.`
        : `Command did NOT complete within ${timeout}ms — it may still be running in the session. ` +
          `Re-check with persistentSession=true, sessionId='${sessionId}' (e.g. run \`true\` to recapture the pane).`;

      const result = `Command executed in persistent tmux session '${sessionId}'. ${statusLine}\n\n` +
        `Output:\n${'='.repeat(60)}\n${cleanedOutput}\n${'='.repeat(60)}\n\n` +
        `Session persists after this command completes. You can:\n` +
        `- Send more commands: persistentSession=true, sessionId='${sessionId}'\n` +
        `- Inspect session: TmuxSession tool with action='capture', sessionId='${sessionId}'\n` +
        `- Kill session: TmuxSession tool with action='kill', sessionId='${sessionId}'`;

      return this.createSuccessResult(result, {
        executionTime: Date.now() - startTime,
        sessionId,
        persistent: true,
        sessionCwd: cwd,
        exitCode: sessionExitCode,
        completed
      });
    } catch (error: any) {
      if (signal.aborted) {
        return this.createErrorResult('Command was cancelled by user.');
      }
      return this.createErrorResult(`Failed to execute in persistent session: ${error.message}`);
    }
  }

  /**
   * Mirror of core ToolProfile.resolveToolProfile (env tier, resolved FRESH per
   * call so it stays hot-toggleable like the core resolver). Deliberately NOT
   * imported from @nexus-cortex/core: this file compiles in the executors
   * Pass-1 build stage before core's dist exists, and the profile contract is
   * tiny and stable (CORTEX_TOOL_PROFILE=full|lean|bash-only, unknown → full).
   * @private
   */
  private resolveActiveToolProfile(): 'full' | 'lean' | 'bash-only' {
    const raw = (process.env.CORTEX_TOOL_PROFILE ?? 'full').trim().toLowerCase();
    if (raw === 'lean' || raw === 'bash-only') return raw;
    return 'full';
  }

  /**
   * Are the redirect target tools (Read/Edit/Write/Grep/Glob) present on the
   * active tool surface? Under bash-only they do NOT exist — redirecting to
   * them wedges the model (canon defect 2026-08-13: bash-only graduates were
   * told to use tools their profile hides). Under lean/full all five targets
   * are essential-tier and therefore present.
   * @private
   */
  private redirectTargetsAvailable(): boolean {
    return this.resolveActiveToolProfile() !== 'bash-only';
  }

  /**
   * Resolve the effective timeout: requested (or default), clamped to the max.
   * @private
   */
  private resolveTimeoutMs(params: ShellToolParams): number {
    return Math.min(params.timeout || ShellTool.DEFAULT_TIMEOUT_MS, ShellTool.MAX_TIMEOUT_MS);
  }

  /**
   * Checks if a command should be routed to a dedicated tool instead of Bash.
   * Returns an error message with guidance if redirected, or null if allowed.
   *
   * Redirects fire ONLY where the dedicated tool is genuinely equivalent — the
   * bare, flag-free forms (`cat FILE`, `grep pattern file`, literal
   * `echo "text" > file`, plain `find -name`). Flagged, piped, redirected,
   * multi-file, or variable-expanding invocations have no dedicated-tool
   * equivalent (`cat -A`, `head -c 5`, `grep -c`, `echo $VAR > f`, `>>`
   * append) and pass through. Canon defect 2026-08-13: the old flag-blind
   * matcher blocked `cat -A probe.txt` and suggested the corrupt
   * `Read({ file_path: "-A probe.txt" })`.
   * @private
   */
  private checkToolRedirect(command: string): string | null {
    // Profile gate: never redirect to tools the active profile hides.
    if (!this.redirectTargetsAvailable()) {
      return null;
    }

    const trimmed = command.trim();
    // Any shell operator means composition Bash exists for — let it through.
    const hasOperators = /[|;&<>`]/.test(trimmed);
    const tokens = trimmed.split(/\s+/);
    const cmd = tokens[0] ?? '';
    const args = tokens.slice(1);
    const flags = args.filter((a) => a.startsWith('-'));
    const positional = args.filter((a) => !a.startsWith('-'));
    const stripQuotes = (s: string) => s.replace(/^["']|["']$/g, '');

    // File reading: bare single-file cat/head/tail → Read tool.
    if (
      (cmd === 'cat' || cmd === 'head' || cmd === 'tail') &&
      !hasOperators &&
      flags.length === 0 &&
      positional.length === 1
    ) {
      return (
        `Use the Read tool instead of \`${cmd}\` for reading files. ` +
        `Example: Read({ file_path: ${JSON.stringify(stripQuotes(positional[0] ?? ''))} })`
      );
    }

    // File editing: sed -i / perl -i in-place edits → Edit tool.
    if (/^sed\s+(-i|--in-place)\b/.test(trimmed) || /^perl\s+-[pn]?i\b/.test(trimmed)) {
      return (
        `Use the Edit tool instead of \`${cmd}\` for editing files. ` +
        `Read the file first, then use Edit({ file_path, old_string, new_string }).`
      );
    }

    // File writing: LITERAL echo/printf > file → Write tool. Variable
    // expansion ($VAR — shell-state capture), append (>>), and command
    // composition have no Write equivalent and pass through.
    const writeMatch = trimmed.match(/^(?:echo|printf)\s+([^>]*)>\s*(\S+)\s*$/);
    const writeContent = writeMatch?.[1] ?? '';
    const writeTarget = writeMatch?.[2] ?? '';
    if (
      writeMatch &&
      !trimmed.includes('>>') &&
      !writeContent.includes('$') &&
      !/[|;&`]/.test(writeContent)
    ) {
      return (
        `Use the Write tool instead of shell redirection for creating/writing files. ` +
        `Example: Write({ file_path: ${JSON.stringify(stripQuotes(writeTarget))}, content: "..." })`
      );
    }

    // File searching: bare flag-free grep/rg/ag/ack → Grep tool.
    if (
      (cmd === 'grep' || cmd === 'rg' || cmd === 'ag' || cmd === 'ack') &&
      !hasOperators &&
      flags.length === 0 &&
      positional.length >= 1 &&
      positional.length <= 2
    ) {
      const grepPath = positional[1];
      const pathArg = grepPath
        ? `, path: ${JSON.stringify(stripQuotes(grepPath))}`
        : '';
      return (
        `Use the Grep tool instead of \`${cmd}\` for searching file contents. ` +
        `Example: Grep({ pattern: ${JSON.stringify(stripQuotes(positional[0] ?? ''))}${pathArg} })`
      );
    }

    // File finding: PLAIN find -name (optional path + -type) → Glob tool.
    // Any other predicate/action (-exec, -delete, -mtime, …) passes through.
    if (cmd === 'find' && !hasOperators && args.includes('-name')) {
      const allowedPredicates = new Set(['-name', '-iname', '-type']);
      let simple = true;
      let pattern: string | undefined;
      for (let i = 0; i < args.length; i++) {
        const a = args[i] ?? '';
        if (a.startsWith('-')) {
          if (!allowedPredicates.has(a)) {
            simple = false;
            break;
          }
          const value = args[++i];
          if ((a === '-name' || a === '-iname') && value !== undefined) {
            pattern = stripQuotes(value);
          }
        } else if (i !== 0) {
          // Only a single leading path operand keeps it Glob-equivalent.
          simple = false;
          break;
        }
      }
      if (simple && pattern) {
        return (
          `Use the Glob tool instead of \`find\` for finding files. ` +
          `Example: Glob({ pattern: ${JSON.stringify(pattern)} })`
        );
      }
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
   * Parse a tmux pane capture for the completion sentinel.
   * The echoed command line contains `<sentinel>_%d` (literal printf format —
   * no digits), so only the actual printf OUTPUT (`<sentinel>_<code>`) matches.
   * Static + pure so it is unit-testable without tmux.
   */
  static parseSentinel(
    paneOutput: string,
    sentinel: string,
  ): { done: boolean; exitCode: number | null } {
    const match = paneOutput.match(new RegExp(`${sentinel}_(\\d+)`));
    if (!match) {
      return { done: false, exitCode: null };
    }
    return { done: true, exitCode: Number(match[1]) };
  }

  /**
   * Remove sentinel artifacts (both the echoed command line and the printed
   * completion marker) from captured pane output. Static + pure for tests.
   */
  static stripSentinelLines(paneOutput: string, sentinel: string): string {
    return paneOutput
      .split('\n')
      .filter((line) => !line.includes(sentinel))
      .join('\n');
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
