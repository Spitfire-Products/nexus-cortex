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
import { stripAnsi } from '../../utils/TextUtils.js';
import { BackgroundProcessRegistry } from './BackgroundProcessRegistry.js';
import type { ExecutorConfig } from '../../base/ToolRegistry.js';
import { parseBashFileAccess } from './bashFileAccess.js';
import { FileReadTracker } from '../file/EditTool.js';

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
 * - Blocks command substitution with $() ($(( )) arithmetic exempt;
 *   liftable via CORTEX_ALLOW_CMD_SUBSTITUTION=true for sandboxed profiles)
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

    // Security: block command substitution with $(). $(( )) arithmetic
    // expansion is NOT command substitution and is never flagged. The guard
    // exists to stop a nested command bypassing the command-level permission
    // allowlist (smuggling `rm` inside an allowlisted `echo $(...)`). It is
    // AUTO-LIFTED when the permission model is already off — this.config
    // .allowCommandSubstitution, set by the orchestrator under autoApproveActions
    // (headless / piped / --yolo / sandboxed bench) where there is no gate to
    // bypass — and stays ON for interactive/permission-gated sessions. Env
    // CORTEX_ALLOW_CMD_SUBSTITUTION=true is an explicit override on top.
    if (process.env.CORTEX_ALLOW_CMD_SUBSTITUTION !== 'true' && !this.config.allowCommandSubstitution) {
      const withoutArithmetic = params.command.replace(/\$\(\(/g, '');
      if (withoutArithmetic.includes('$(')) {
        return 'Command substitution using $() is not allowed for security reasons. Run the inner command separately and pass its output via a file or pipeline. ($(( )) arithmetic is allowed.)';
      }
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
        return this.createErrorResult('Command was cancelled before completion (timed out or aborted).');
      }

      // Frame-coherence (backlog item 6a/6c): register bash file READS into
      // FileReadTracker (cat/head/tail/sed -n satisfy the read-first guard —
      // the only read channel under Read-less doors) and invalidate read
      // state on bash in-place WRITES (sed -i etc. give no content-knowledge
      // proof, so later Edits demand a fresh read). Best-effort, exit-0 only.
      if (result.exitCode === 0) {
        try {
          const access = parseBashFileAccess(params.command);
          if (access.reads.length > 0 || access.writes.length > 0) {
            const base = params.directory
              ? path.resolve(this.config.workingDirectory, params.directory)
              : this.config.workingDirectory;
            for (const r of access.reads) {
              const abs = path.resolve(base, r);
              if (fs.existsSync(abs)) FileReadTracker.markAsRead(abs);
            }
            for (const w of access.writes) {
              FileReadTracker.markBashWrite(path.resolve(base, w));
            }
          }
        } catch { /* registration must never break execution */ }
      }

      return this.createSuccessResult(result.llmContent, {
        promotedToBackground: result.promotedShellId ?? undefined,
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
        return this.createErrorResult('Command was cancelled before completion (timed out or aborted).');
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
    promotedShellId: string | null;
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
          // CORTEX_BASH_PIPEFAIL (backlog item 4, bench/server profiles):
          // `cmd | tail` returns the TAIL's exit code, so failing commands
          // classify `ok` and starve the outcome ladder + decision store
          // (micro-suite probe-3). pipefail propagates the failure. NEVER
          // default-on — it changes user command semantics. The `; echo $?`
          // masking class remains an accepted, documented residual.
          const pipefail =
            (process.env.CORTEX_BASH_PIPEFAIL ?? '').trim().toLowerCase() === 'true'
              ? 'set -o pipefail; '
              : '';
          return `{ ${pipefail}${cmd} }; __code=$?; pgrep -g 0 >${tempFilePath} 2>&1; exit $__code;`;
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

    // R66: cap ACCUMULATION, not just final rendering. truncateIfNeeded caps
    // what reaches the model, but a runaway command (e.g. cat of a huge
    // artifact) previously grew these strings unbounded until V8's max string
    // length threw `RangeError: Invalid string length` INSIDE the data
    // handler, crashing the whole server process (observed live: P6g D-r2,
    // ShellTool.js:244). Keep head + bounded tail per stream; the final
    // truncation marker still applies downstream.
    const ACC_CAP = ShellTool.MAX_OUTPUT_LENGTH * 4; // generous head room
    const capAppend = (base: string, str: string): string => {
      if (base.length >= ACC_CAP) {
        // keep a sliding tail so the end of output (exit summaries, errors)
        // survives; head is already preserved in `base`'s first half.
        const tailKeep = ShellTool.MAX_OUTPUT_LENGTH;
        return base.slice(0, ACC_CAP - tailKeep)
          + base.slice(-Math.floor(tailKeep / 2))
          + str.slice(-Math.floor(tailKeep / 2));
      }
      return base + str;
    };

    const appendOutput = (str: string) => {
      output = capAppend(output, str); // R66: bounded (same crash class)
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
        const str = stripAnsi(data.toString());
        stdout = capAppend(stdout, str);
        appendOutput(str);
      }
    });

    // Capture stderr
    shell.stderr?.on('data', (data: Buffer) => {
      if (!exited) {
        const str = stripAnsi(data.toString());
        stderr = capAppend(stderr, str);
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

    // Timeout handler — TOOL_TIMEOUT_MODE (2026-09-02): 'kill' (legacy) or 'background'
    // = PROMOTE-AT-DEADLINE: the still-running child is registered in the
    // BackgroundProcessRegistry (same handle the run_in_background path gives) and the
    // tool returns immediately with the output so far + a bash_id. Nothing is lost and
    // the model keeps working. 'auto' (default) = background in headless/auto-approve
    // sessions (bench, server, autoresearch), kill in interactive TTY sessions. Bench
    // evidence: the 120s kill fired 42x across 14 task-runs and rescued none of them.
    let timedOut = false;
    let promotedShellId: string | null = null;
    let resolveWait: () => void = () => {};
    const timeoutMode = ShellTool.resolveTimeoutMode(this.config.headless === true);
    const timeoutId = setTimeout(async () => {
      if (exited || !shell.pid) return;
      if (timeoutMode === 'background' && !isWindows) {
        const shellId = `bg-${crypto.randomBytes(4).toString('hex')}`;
        try {
          BackgroundProcessRegistry.getInstance().registerProcess(shellId, shell.pid, params.command, shell);
          shell.unref();
          promotedShellId = shellId;
          resolveWait();
          return;
        } catch { /* fall through to kill */ }
      }
      timedOut = true;
      await this.killProcess(shell.pid, isWindows);
    }, timeout);

    try {
      // Wait for process to exit (or for promotion to background)
      await new Promise<void>((resolve) => {
        resolveWait = resolve;
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
      llmContent = 'Command was cancelled before it could complete (timed out or aborted).';
      if (output.trim()) {
        llmContent += `\n\nOutput before cancellation:\n${truncateIfNeeded(output)}`;
      } else {
        llmContent += ' No output was produced before cancellation.';
      }
    } else if (promotedShellId) {
      llmContent =
        `STILL RUNNING — the command exceeded ${timeout}ms and was moved to the BACKGROUND as bash_id ${promotedShellId} (PID ${shell.pid}). It was NOT killed; it keeps running.`;
      llmContent += output.trim()
        ? `\n\nOutput so far:\n${truncateIfNeeded(output)}`
        : ' No output yet.';
      llmContent += `\n\nDo other useful work now. When you need the result, read it ONCE with BashOutput({ bash_id: "${promotedShellId}" }); stop it with KillShell({ shell_id: "${promotedShellId}" }). Do not busy-poll.`;
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
      promotedShellId,
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
        return this.createErrorResult('Command was cancelled before completion (timed out or aborted).');
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
  private resolveActiveToolProfile(): 'full' | 'lean' | 'bash-only' | 'bash-plus' | 'bash-edit' {
    const raw = (process.env.CORTEX_TOOL_PROFILE ?? 'full').trim().toLowerCase();
    if (raw === 'lean' || raw === 'bash-only' || raw === 'bash-plus' || raw === 'bash-edit') return raw;
    return 'full';
  }

  /**
   * Are the redirect target tools (Read/Edit/Write/Grep/Glob) present on the
   * active tool surface? Under bash-only they do NOT exist — redirecting to
   * them wedges the model (canon defect 2026-08-13: bash-only graduates were
   * told to use tools their profile hides). Under lean/full all five targets
   * are essential-tier and therefore present. bash-plus is target-dependent —
   * see searchRedirectTargetsAvailable.
   * @private
   */
  private redirectTargetsAvailable(): boolean {
    return this.resolveActiveToolProfile() !== 'bash-only';
  }

  /**
   * bash-plus carries Read/Edit/Write but NOT Grep/Glob — the search/find
   * redirects must stay silent there or they suggest hidden tools (same
   * wedge class as the bash-only defect above).
   * @private
   */
  private searchRedirectTargetsAvailable(): boolean {
    const p = this.resolveActiveToolProfile();
    return p !== 'bash-plus' && p !== 'bash-edit' && this.redirectTargetsAvailable();
  }

  /**
   * bash-edit (dsh-Minimal shape) carries ONLY Bash+Edit: the Read and Write
   * redirects must also stay silent there (Edit redirect stays active).
   * @private
   */
  private fileRedirectTargetsAvailable(): boolean {
    return this.resolveActiveToolProfile() !== 'bash-edit' && this.redirectTargetsAvailable();
  }

  /**
   * Resolve the effective timeout: requested (or default), clamped to the max.
   * @private
   */
  /** TOOL_TIMEOUT_MODE=kill|background|auto (default auto = background when headless, else kill). */
  static resolveTimeoutMode(headless: boolean, env: NodeJS.ProcessEnv = process.env): 'kill' | 'background' {
    const v = (env.TOOL_TIMEOUT_MODE ?? 'auto').trim().toLowerCase();
    if (v === 'kill') return 'kill';
    if (v === 'background') return 'background';
    return headless ? 'background' : 'kill';
  }

  private resolveTimeoutMs(params: ShellToolParams): number {
    // 4.90.1: the default deadline follows the canonical TOOL_TIMEOUT_MS lever (the orchestrator's
    // outer cap already does) — a hardcoded 120s here fired first whenever the env raised the cap.
    const envDefault = Number(process.env.TOOL_TIMEOUT_MS);
    const dflt = Number.isFinite(envDefault) && envDefault > 0 ? envDefault : ShellTool.DEFAULT_TIMEOUT_MS;
    return Math.min(params.timeout || dflt, ShellTool.MAX_TIMEOUT_MS);
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
    // CORTEX_TOOL_REDIRECTS=off disables the dedicated-tool steering entirely
    // (2026-08-22, operator-commissioned): the redirects date from when models
    // were unreliable with shell idioms; the narrow-door program showed
    // bash-focused models (incl. our trained small executors) work best when
    // bash is not second-guessed.
    //
    // DEFAULT is bash-framing-aware (P4pro2/P4pro2on measured, 2026-08-22):
    // when the session is bash-framed — a bash-* session PROFILE or a bash-*
    // first-turn ANCHOR (the anchor lifts to the full profile after turn 1,
    // which is exactly how D61's tax leaked into every door bench) — the
    // steering defaults OFF: on the same build, redirects-ON cost the
    // bash-edit arm +26% tool calls / +30% latency (retry bounces) at zero
    // accuracy difference. Explicit CORTEX_TOOL_REDIRECTS=on|off always wins.
    const redirectsEnv = (process.env.CORTEX_TOOL_REDIRECTS ?? '').trim().toLowerCase();
    if (redirectsEnv === 'off') return null;
    if (redirectsEnv !== 'on') {
      // CARD/REGISTRY-scoped (per-orchestrator, threaded via
      // ExecutorRegistry.updateConfig at request assembly): the active model
      // card's anchorProfile — the PRODUCTION framing signal (deepseek cards
      // = bash-edit). Env anchor/profile are the bench/override levers.
      const cardAnchor = ((this.config as { activeAnchorProfile?: string | null }).activeAnchorProfile ?? '')
        .trim().toLowerCase();
      const envAnchor = (process.env.CORTEX_TOOL_ANCHOR ?? '').trim().toLowerCase();
      const isBashDoor = (v: string) => v === 'bash-only' || v === 'bash-plus' || v === 'bash-edit';
      // Env 'none'/'full'/'off' explicitly disables anchoring — it must also
      // cancel the card's framing signal here (mirrors resolveToolAnchor).
      const envAnchorOff = envAnchor === 'none' || envAnchor === 'full' || envAnchor === 'off';
      const anchorFramed = envAnchorOff ? false : (isBashDoor(envAnchor) || isBashDoor(cardAnchor));
      const bashFramed = this.resolveActiveToolProfile().startsWith('bash-') || anchorFramed;
      if (bashFramed) return null;
    }
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
      this.fileRedirectTargetsAvailable() &&
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
      this.fileRedirectTargetsAvailable() &&
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
      this.searchRedirectTargetsAvailable() &&
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
    if (this.searchRedirectTargetsAvailable() && cmd === 'find' && !hasOperators && args.includes('-name')) {
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
}
