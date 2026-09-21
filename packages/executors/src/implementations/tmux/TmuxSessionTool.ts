/**
 * TmuxSession Tool Executor
 *
 * Manages persistent terminal sessions using tmux.
 * Supports creating, managing, and capturing terminal sessions.
 */

import { BaseTool, type ToolResult } from '../../base/index.js';
import { SchemaValidator } from '../../utils/SchemaValidator.js';
import { TmuxManager, SessionPersistence, SessionLock, TmuxCapture } from '../../utils/index.js';
import { resolveTerminalBackend, TmuxTerminalBackend, truncateMiddle, type TerminalBackend } from '../../utils/TerminalBackend.js';
import { TmuxViewServer } from './TmuxViewServer.js';
import { SandboxViewServer } from '../addon/SandboxViewServer.js';
import type { ExecutorConfig } from '../../base/ToolRegistry.js';

/**
 * Parameters for the TmuxSession tool
 */
export interface TmuxSessionParams {
  /**
   * Action to perform
   */
  action: 'create' | 'send' | 'capture' | 'list' | 'kill' | 'snapshot' | 'wait';

  /**
   * Session identifier (required for all actions except 'list')
   */
  sessionId?: string;

  /**
   * Command to send (required for 'send' action)
   */
  command?: string;

  /** R179: send `command` as tmux KEY NAMES (C-c, Escape) — no literal mode, no implicit Enter. */
  raw?: boolean;

  /** R179: append Enter after the literal text (default true); false types without running (REPL input, partial lines). */
  enter?: boolean;

  /**
   * Working directory (optional for 'create' action)
   */
  cwd?: string;

  /**
   * Environment variables (optional for 'create' action)
   */
  env?: Record<string, string>;

  /**
   * Capture entire scrollback history (optional for 'capture' action)
   */
  captureHistory?: boolean;

  /** R141: return only the last N lines of a capture (capture action). */
  lines?: number;

  /**
   * Include visual screenshot (optional for 'snapshot' action)
   */
  includeScreenshot?: boolean;

  /** R142 'wait' action: literal text to wait for (one of match|regex required). */
  match?: string;

  /** R142 'wait' action: regex to wait for. */
  regex?: string;

  /** R142 'wait' action: cap in ms (default 30000, max 600000). */
  timeoutMs?: number;
}

/**
 * TmuxSession Tool Executor
 *
 * Features:
 * - Create persistent terminal sessions
 * - Send commands to sessions
 * - Capture session output and history
 * - List all active sessions
 * - Terminate sessions
 * - Session metadata persistence
 *
 * Graceful degradation:
 * - Returns error if tmux is not installed
 * - Provides clear error messages
 */
export class TmuxSessionTool extends BaseTool<TmuxSessionParams, ToolResult> {
  private tmux: TmuxManager;
  private persistence: SessionPersistence;
  private lock: SessionLock;
  private viewServer: TmuxViewServer;
  private viewServerInitialized: boolean = false;

  constructor(private config: ExecutorConfig) {
    super(
      'TmuxSession',
      'TmuxSession',
      `Manage persistent terminal sessions with tmux. Supports creating sessions, sending commands, capturing output, and managing session lifecycle. Use the 'snapshot' action with includeScreenshot=true to visually see what's displayed in the terminal - essential for iteratively debugging and improving commands you execute. Use action='wait' with match or regex (+ timeoutMs) to block until the screen shows some text — prefer it over sleep polling (the echoed command line counts, so wait for text the command itself does not contain).`,
      {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['create', 'send', 'capture', 'list', 'kill', 'snapshot', 'wait'],
            description: 'Action to perform on tmux session'
          },
          sessionId: {
            type: 'string',
            description: 'Session identifier (required for send, capture, kill, snapshot actions)'
          },
          command: {
            type: 'string',
            description: 'Command to send to session (required for send action)'
          },
          raw: { type: 'boolean', description: 'Send command as tmux key names (C-c, Escape) with no implicit Enter (R179)' },
          enter: { type: 'boolean', description: 'Append Enter after the literal text (default true) (R179)' },
          cwd: {
            type: 'string',
            description: 'Working directory for new session (optional for create action)'
          },
          env: {
            type: 'object',
            description: 'Environment variables for new session (optional for create action)',
            additionalProperties: { type: 'string' }
          },
          captureHistory: {
            type: 'boolean',
            description: 'Capture entire scrollback history (optional for capture action)',
            default: false
          },
          lines: {
            type: 'number',
            description: 'Return only the last N lines of the capture (capture action). Every capture is capped at 10 KB with the middle omitted, so ask for the lines you need.'
          },
          includeScreenshot: {
            type: 'boolean',
            description: 'Capture visual screenshot of terminal session using Playwright. Enables you (the model) to see exactly what is displayed in the terminal, including colors, formatting, and visual layout. Screenshot is returned as base64 PNG in response metadata. Essential for debugging visual terminal applications, progress bars, formatted output, and iteratively improving command execution.',
            default: false
          },
          match: {
            type: 'string',
            description: 'Literal text to wait for (wait action; one of match|regex required)'
          },
          regex: {
            type: 'string',
            description: 'Regex to wait for (wait action; one of match|regex required)'
          },
          timeoutMs: {
            type: 'number',
            description: 'Wait cap in milliseconds (wait action; default 30000, max 600000)'
          }
        },
        required: ['action']
      }
    );

    this.tmux = TmuxManager.getInstance();
    this.persistence = new SessionPersistence(config.workingDirectory || process.cwd());
    this.lock = new SessionLock(config.workingDirectory || process.cwd());
    this.viewServer = TmuxViewServer.getInstance();
  }

  /**
   * Ensure TmuxViewServer is initialized (auto-start on first use).
   * ENABLE_DASHBOARD is the MASTER SWITCH: when it is not "true" the viewer is
   * never started (no port is bound) and tool results carry an instructive
   * notice instead of view URLs. Returns the notice to surface to the agent,
   * or null when the viewer is up.
   */
  private async ensureViewServer(): Promise<string | null> {
    if (!SandboxViewServer.isEnabled()) {
      return SandboxViewServer.DISABLED_NOTICE;
    }
    if (this.viewServerInitialized) {
      return null;
    }

    try {
      await this.viewServer.initialize();
      this.viewServerInitialized = true;
      return null;
    } catch (error: any) {
      // Viewer is optional — tmux functionality still works. Tell the agent
      // exactly what to check (the most common cause is a port conflict).
      const notice =
        `Tmux web dashboard failed to start: ${error.message}. ` +
        `Check for a port conflict on DASHBOARD_PORT (default 4001 — it retries up to ` +
        `10 consecutive ports), and confirm ENABLE_DASHBOARD=true is set.`;
      console.warn(`[WARN] ${notice}`);
      return notice;
    }
  }

  validateToolParams(params: TmuxSessionParams): string | null {
    // Schema validation
    const schemaError = SchemaValidator.validate(this.parameterSchema, params);
    if (schemaError) {
      return schemaError;
    }

    // Action-specific validation
    switch (params.action) {
      case 'send':
        if (!params.sessionId) {
          return 'sessionId is required for send action';
        }
        if (!params.command) {
          return 'command is required for send action';
        }
        break;

      case 'capture':
        if (params.lines !== undefined && (!Number.isInteger(params.lines) || params.lines <= 0)) {
          return 'lines must be a positive integer';
        }
        if (!params.sessionId) {
          return 'sessionId is required for capture action';
        }
        break;
      case 'kill':
      case 'snapshot':
        if (!params.sessionId) {
          return `sessionId is required for ${params.action} action`;
        }
        break;

      case 'wait':
        if (!params.sessionId) {
          return 'sessionId is required for wait action';
        }
        if (!params.match && !params.regex) {
          return 'wait action requires match or regex';
        }
        if (params.regex) {
          try {
            new RegExp(params.regex);
          } catch (error: any) {
            return `Invalid regex: ${error.message}`;
          }
        }
        if (params.timeoutMs !== undefined && (typeof params.timeoutMs !== 'number' || params.timeoutMs <= 0)) {
          return 'timeoutMs must be a positive number';
        }
        break;

      case 'list':
        // No additional validation needed
        break;

      case 'create':
        // sessionId is optional for create (will be auto-generated)
        // Validate cwd if provided
        if (params.cwd) {
          const workingDirectory = this.config.workingDirectory || process.cwd();
          const resolvedCwd = params.cwd.startsWith('/')
            ? params.cwd
            : require('path').join(workingDirectory, params.cwd);

          // Security check: cwd must be within working directory
          if (!resolvedCwd.startsWith(workingDirectory)) {
            return `Working directory must be within ${workingDirectory}`;
          }
        }
        break;

      default:
        return `Unknown action: ${params.action}`;
    }

    return null;
  }

  async execute(
    params: TmuxSessionParams,
    signal: AbortSignal,
    updateOutput?: (output: string) => void
  ): Promise<ToolResult> {
    // HB-HERDR-TERMINAL-BACKEND (R146): when the resolved backend is herdr, the
    // session verbs map to herdr panes (snapshot stays tmux-only).
    let backend: TerminalBackend | null = null;
    try {
      backend = await resolveTerminalBackend();
    } catch (error: any) {
      console.warn(`[WARN] terminal backend resolution failed (${error?.message ?? error}); using tmux`);
    }
    if (backend?.kind === 'herdr') {
      try {
        return await this.executeViaHerdr(params, backend, updateOutput);
      } catch (error: any) {
        return this.createErrorResult(`TmuxSession (herdr backend) error: ${error.message}`);
      }
    }

    // Check tmux availability (R138: the first request may install it; lever CORTEX_TMUX_AUTO_INSTALL)
    if (!(await this.tmux.ensureTmux()).available) {
      return this.createErrorResult(
        'tmux is not installed. Please install tmux to use persistent terminal sessions.\n\n' +
        'Installation:\n' +
        ' - Ubuntu/Debian: apt-get install tmux\n' +
        ' - macOS: brew install tmux\n' +
        ' - Replit: Add tmux in the Packages tab'
      );
    }

    // Dispatch based on action
    try {
      switch (params.action) {
        case 'create':
          return await this.handleCreate(params, updateOutput);
        case 'send':
          return await this.handleSend(params, updateOutput);
        case 'capture':
          return await this.handleCapture(params, updateOutput);
        case 'list':
          return await this.handleList(params, updateOutput);
        case 'kill':
          return await this.handleKill(params, updateOutput);
        case 'snapshot':
          return await this.handleSnapshot(params, updateOutput);
        case 'wait':
          if (!(await this.tmux.sessionExists(params.sessionId!))) {
            return this.createErrorResult(`Session '${params.sessionId}' does not exist`);
          }
          return await this.handleWait(params, new TmuxTerminalBackend(this.tmux), updateOutput);
        default:
          return this.createErrorResult(`Unknown action: ${params.action}`);
      }
    } catch (error: any) {
      return this.createErrorResult(`TmuxSession error: ${error.message}`);
    }
  }

  /** R142 wait cap (ms). */
  private static readonly DEFAULT_WAIT_MS = 30000;
  private static readonly MAX_WAIT_MS = 600000;

  /**
   * HB-WAIT-PRIMITIVE (R142): block until the session shows `match`/`regex` or timeoutMs
   * elapses — herdr: `pane wait-output`; tmux: capture-pane polling. Side-effect free.
   * @private
   */
  private async handleWait(
    params: TmuxSessionParams,
    backend: TerminalBackend,
    updateOutput?: (output: string) => void
  ): Promise<ToolResult> {
    const id = backend.resolveId ? backend.resolveId(params.sessionId!) : params.sessionId!;
    const timeoutMs = Math.min(params.timeoutMs ?? TmuxSessionTool.DEFAULT_WAIT_MS, TmuxSessionTool.MAX_WAIT_MS);
    const target = params.regex ? `/${params.regex}/` : `"${params.match}"`;
    updateOutput?.(`Waiting up to ${timeoutMs}ms for ${target} in session ${id}...\n`);
    const started = Date.now();
    const res = await backend.waitOutput(id, { match: params.match, regex: params.regex, timeoutMs });
    const elapsed = ((Date.now() - started) / 1000).toFixed(1);
    const outcome = res.matched ? 'matched' : 'timeout';
    return this.createSuccessResult(
      `[wait] ${elapsed}s, ${outcome}\n` +
      (res.matched
        ? `Session '${params.sessionId}' output matched ${target}.`
        : `Session '${params.sessionId}' did not show ${target} within ${timeoutMs}ms — whatever is running may still be running; do nothing or wait again.`) +
      `\n\n${'='.repeat(60)}\n${res.output}\n${'='.repeat(60)}\n`,
      { sessionId: params.sessionId, paneId: id, matched: res.matched, elapsedMs: Date.now() - started, backend: backend.kind }
    );
  }

  /**
   * HB-HERDR-TERMINAL-BACKEND (R146): create/send/capture/list/kill on herdr panes.
   * sessionId is the label given at create (or a pane id we created). `send` goes
   * through bracketed paste + Enter (no sentinel, so captures stay clean).
   * @private
   */
  private async executeViaHerdr(
    params: TmuxSessionParams,
    backend: TerminalBackend,
    updateOutput?: (output: string) => void
  ): Promise<ToolResult> {
    const info = `[INFO] terminal backend: ${backend.describe()}`;
    const resolve = (id: string) => (backend.resolveId ? backend.resolveId(id) : id);
    const exists = async (id: string) => (await backend.list()).includes(id);

    switch (params.action) {
      case 'create': {
        updateOutput?.('Creating herdr pane...\n');
        const workingDirectory = this.config.workingDirectory || process.cwd();
        const cwd = params.cwd
          ? (params.cwd.startsWith('/') ? params.cwd : require('path').join(workingDirectory, params.cwd))
          : workingDirectory;
        const label = params.sessionId;
        const { id } = await backend.createSession({ cwd, env: params.env, label });
        const sessionId = label ?? id;
        updateOutput?.(`Pane created: ${id}\n`);
        return this.createSuccessResult(
          `${info}\n` +
          `herdr pane created (visible next to the operator's pane; survives client detach).\n\n` +
          `Session ID: ${sessionId}\n` +
          `Pane: ${id}\n` +
          `Working directory: ${cwd}\n` +
          `Environment variables: ${params.env ? Object.keys(params.env).length : 0} set\n\n` +
          `You can now:\n` +
          `- Send commands: action='send', sessionId='${sessionId}', command='your command'\n` +
          `- Capture output: action='capture', sessionId='${sessionId}'\n` +
          `- Close the pane: action='kill', sessionId='${sessionId}'`,
          { sessionId, paneId: id, cwd, env: params.env, backend: 'herdr' }
        );
      }
      case 'send': {
        const id = resolve(params.sessionId!);
        if (!(await exists(id))) return this.createErrorResult(`Session '${params.sessionId}' does not exist`);
        updateOutput?.(`Sending command to herdr pane ${id}...\n`);
        await backend.sendText(id, params.command!);
        await backend.sendKeys(id, ['Enter']);
        return this.createSuccessResult(
          `${info}\n` +
          `Command sent to herdr pane '${id}'.\n\n` +
          `Command: ${params.command}\n\n` +
          `Use action='capture' to retrieve the output.`,
          { sessionId: params.sessionId, paneId: id, command: params.command, backend: 'herdr' }
        );
      }
      case 'capture': {
        const id = resolve(params.sessionId!);
        if (!(await exists(id))) return this.createErrorResult(`Session '${params.sessionId}' does not exist`);
        updateOutput?.(`Capturing output from herdr pane ${id}...\n`);
        const output = await backend.read(id, { history: params.captureHistory, lines: params.lines });
        return this.createSuccessResult(
          `${info}\n` +
          `Captured output from herdr pane '${id}':\n\n` +
          `${'='.repeat(60)}\n` +
          output +
          `\n${'='.repeat(60)}\n`,
          { sessionId: params.sessionId, paneId: id, lines: output.split('\n').length, capturedHistory: params.captureHistory, backend: 'herdr' }
        );
      }
      case 'list': {
        const panes = await backend.list();
        if (panes.length === 0) {
          return this.createSuccessResult(
            `${info}\nNo herdr panes created by this process.\n\nUse action="create" to create one.`,
            { sessions: [], backend: 'herdr' }
          );
        }
        return this.createSuccessResult(
          `${info}\nherdr panes created by this process (${panes.length}):\n\n` +
          panes.map((p) => `- ${p}`).join('\n'),
          { sessions: panes.map((paneId) => ({ sessionId: paneId, paneId })), count: panes.length, backend: 'herdr' }
        );
      }
      case 'wait': {
        const id = resolve(params.sessionId!);
        if (!(await exists(id))) return this.createErrorResult(`Session '${params.sessionId}' does not exist`);
        return this.handleWait(params, backend, updateOutput);
      }
      case 'kill': {
        const id = resolve(params.sessionId!);
        if (!(await exists(id))) return this.createErrorResult(`Session '${params.sessionId}' does not exist`);
        updateOutput?.(`Closing herdr pane ${id}...\n`);
        await backend.kill(id);
        return this.createSuccessResult(
          `${info}\nherdr pane '${id}' closed.`,
          { sessionId: params.sessionId, paneId: id, backend: 'herdr' }
        );
      }
      case 'snapshot':
        return this.createErrorResult(
          `${info}\n` +
          `action='snapshot' is tmux-only (Playwright screenshot of a tmux session); the active terminal backend is herdr. ` +
          `Use action='capture' (the pane text) — the pane is also visible live in the herdr UI. ` +
          `Set CORTEX_TERMINAL_BACKEND=tmux to force tmux sessions.`
        );
      default:
        return this.createErrorResult(`Unknown action: ${params.action}`);
    }
  }

  private async handleCreate(
    params: TmuxSessionParams,
    updateOutput?: (output: string) => void
  ): Promise<ToolResult> {
    updateOutput?.('Creating tmux session...\n');

    const workingDirectory = this.config.workingDirectory || process.cwd();
    const cwd = params.cwd
      ? (params.cwd.startsWith('/')
        ? params.cwd
        : require('path').join(workingDirectory, params.cwd))
      : workingDirectory;

    const sessionId = await this.tmux.createSession(params.sessionId, cwd, params.env);

    // Save session metadata
    await this.persistence.saveSession({
      sessionId,
      created: new Date(),
      lastUsed: new Date(),
      cwd,
      env: params.env
    });

    updateOutput?.(`Session created: ${sessionId}\n`);

    // Initialize web viewer (ENABLE_DASHBOARD is the master switch) and get URLs,
    // or carry the instructive notice when the dashboard is off/unavailable.
    const viewerNotice = await this.ensureViewServer();
    const viewUrl = viewerNotice ? null : this.viewServer.getTmuxViewUrl(sessionId);
    const dashboardUrl = viewerNotice ? null : this.viewServer.getTmuxDashboardUrl();

    if (viewUrl) updateOutput?.(`View URL: ${viewUrl}\n`);

    const viewerSection = viewerNotice
      ? ` WEB VIEWER UNAVAILABLE:\n ${viewerNotice}\n\n`
      : ` LIVE WEB VIEWER:\n` +
        ` View this session: ${viewUrl}\n` +
        ` All sessions: ${dashboardUrl}\n\n`;

    return this.createSuccessResult(
      `Tmux session created successfully.\n\n` +
      `Session ID: ${sessionId}\n` +
      `Working directory: ${cwd}\n` +
      `Environment variables: ${params.env ? Object.keys(params.env).length : 0} set\n\n` +
      viewerSection +
      `You can now:\n` +
      `- Send commands: action='send', sessionId='${sessionId}', command='your command'\n` +
      `- Capture output: action='capture', sessionId='${sessionId}'\n` +
      `- Kill session: action='kill', sessionId='${sessionId}'\n\n` +
      (viewerNotice
        ? `Tip: use action='capture' (optionally includeScreenshot=true) to read the terminal without the web viewer.`
        : `Tip: Open the view URL in your browser to see real-time terminal output!`),
      { sessionId, cwd, env: params.env, viewUrl, dashboardUrl, ...(viewerNotice ? { dashboardNotice: viewerNotice } : {}) }
    );
  }

  private async handleSend(
    params: TmuxSessionParams,
    updateOutput?: (output: string) => void
  ): Promise<ToolResult> {
    const sessionId = params.sessionId!;
    const command = params.command!;

    // Check if session exists
    if (!(await this.tmux.sessionExists(sessionId))) {
      return this.createErrorResult(`Session '${sessionId}' does not exist`);
    }

    updateOutput?.(`Sending command to session ${sessionId}...\n`);

    if (params.raw) await this.tmux.sendRawKeys(sessionId, [command]);
    else await this.tmux.sendKeys(sessionId, command, { enter: params.enter !== false });

    // Update lastUsed timestamp
    await this.persistence.touchSession(sessionId);

    updateOutput?.(`Command sent successfully\n`);

    return this.createSuccessResult(
      `Command sent to tmux session '${sessionId}'.\n\n` +
      `Command: ${command}\n\n` +
      `Use action='capture' to retrieve the output.`,
      { sessionId, command }
    );
  }

  private async handleCapture(
    params: TmuxSessionParams,
    updateOutput?: (output: string) => void
  ): Promise<ToolResult> {
    const sessionId = params.sessionId!;

    // Check if session exists
    if (!(await this.tmux.sessionExists(sessionId))) {
      return this.createErrorResult(`Session '${sessionId}' does not exist`);
    }

    updateOutput?.(`Capturing output from session ${sessionId}...\n`);

    // R141: `lines` = the last N lines; every capture is 10 KB middle-omitted.
    const startLine = params.captureHistory ? -3000 : params.lines ? -params.lines : undefined;
    let output = await this.tmux.capturePane(sessionId, startLine);
    if (params.lines) output = output.split('\n').slice(-params.lines).join('\n');
    output = truncateMiddle(output);

    // Update lastUsed timestamp
    await this.persistence.touchSession(sessionId);

    updateOutput?.(`Captured ${output.split('\n').length} lines\n`);

    return this.createSuccessResult(
      `Captured output from tmux session '${sessionId}':\n\n` +
      `${'='.repeat(60)}\n` +
      output +
      `${'='.repeat(60)}\n`,
      { sessionId, lines: output.split('\n').length, capturedHistory: params.captureHistory }
    );
  }

  private async handleList(
    params: TmuxSessionParams,
    updateOutput?: (output: string) => void
  ): Promise<ToolResult> {
    updateOutput?.('Listing tmux sessions...\n');

    const sessions = await this.tmux.listSessions();
    const metadata = await this.persistence.listSessions();

    // Initialize web viewer (ENABLE_DASHBOARD is the master switch).
    const viewerNotice = await this.ensureViewServer();
    const dashboardUrl = viewerNotice ? null : this.viewServer.getTmuxDashboardUrl();

    // Build session info list (view URLs only when the dashboard is up)
    const sessionInfos = sessions.map(sessionId => {
      const meta = metadata.find(m => m.sessionId === sessionId);
      return {
        sessionId,
        created: meta?.created?.toISOString() || 'unknown',
        lastUsed: meta?.lastUsed?.toISOString() || 'unknown',
        cwd: meta?.cwd || 'unknown',
        viewUrl: viewerNotice ? null : this.viewServer.getTmuxViewUrl(sessionId)
      };
    });

    if (sessions.length === 0) {
      return this.createSuccessResult(
        'No active tmux sessions.\n\n' +
        'Use action="create" to create a new session.',
        { sessions: [], dashboardUrl, ...(viewerNotice ? { dashboardNotice: viewerNotice } : {}) }
      );
    }

    const sessionList = sessionInfos
      .map(
        info =>
          `- ${info.sessionId}\n` +
          ` Created: ${info.created}\n` +
          ` Last used: ${info.lastUsed}\n` +
          ` Working directory: ${info.cwd}` +
          (info.viewUrl ? `\n View: ${info.viewUrl}` : '')
      )
      .join('\n\n');

    updateOutput?.(`Found ${sessions.length} session(s)\n`);

    const viewerSection = viewerNotice
      ? ` Web Viewer: UNAVAILABLE — ${viewerNotice}`
      : ` Web Viewer:\n` +
        ` Dashboard: ${dashboardUrl}\n` +
        ` JSON API: ${this.viewServer.getTmuxApiUrl()}`;

    return this.createSuccessResult(
      `Active tmux sessions (${sessions.length}):\n\n${sessionList}\n\n` + viewerSection,
      {
        sessions: sessionInfos,
        count: sessions.length,
        dashboardUrl,
        apiUrl: viewerNotice ? null : this.viewServer.getTmuxApiUrl(),
        ...(viewerNotice ? { dashboardNotice: viewerNotice } : {})
      }
    );
  }

  private async handleKill(
    params: TmuxSessionParams,
    updateOutput?: (output: string) => void
  ): Promise<ToolResult> {
    const sessionId = params.sessionId!;

    // Check if session exists
    if (!(await this.tmux.sessionExists(sessionId))) {
      return this.createErrorResult(`Session '${sessionId}' does not exist`);
    }

    updateOutput?.(`Terminating session ${sessionId}...\n`);

    await this.tmux.killSession(sessionId);
    await this.persistence.deleteSession(sessionId);

    updateOutput?.(`Session terminated\n`);

    return this.createSuccessResult(
      `Tmux session '${sessionId}' terminated successfully.\n\n` +
      `The session and its metadata have been removed.`,
      { sessionId }
    );
  }

  private async handleSnapshot(
    params: TmuxSessionParams,
    updateOutput?: (output: string) => void
  ): Promise<ToolResult> {
    const sessionId = params.sessionId!;

    // Check if session exists
    if (!(await this.tmux.sessionExists(sessionId))) {
      return this.createErrorResult(`Session '${sessionId}' does not exist`);
    }

    updateOutput?.('Capturing session snapshot...\n');

    if (params.includeScreenshot) {
      // Visual screenshot requested
      try {
        updateOutput?.('Creating visual screenshot using Playwright...\n');

        const result = await TmuxCapture.captureSession(sessionId, {
          format: 'png',
          waitTime: 1500
        });

        // Also capture text for comparison (R141: capped)
        const textOutput = truncateMiddle(await this.tmux.capturePane(sessionId));

        // Update lastUsed timestamp
        await this.persistence.touchSession(sessionId);

        return this.createSuccessResult(
          `Visual snapshot of tmux session '${sessionId}' captured.\n\n` +
          `Screenshot format: ${result.format}\n` +
          `Screenshot size: ${result.screenshot.length} bytes\n` +
          `Base64 preview: ${result.base64.substring(0, 100)}...\n\n` +
          `Text output:\n${'='.repeat(60)}\n${textOutput}\n${'='.repeat(60)}`,
          {
            sessionId,
            screenshot: result.base64,
            format: result.format,
            timestamp: result.timestamp,
            textLines: textOutput.split('\n').length
          }
        );
      } catch (error: any) {
        updateOutput?.(`Visual screenshot failed: ${error.message}\n`);
        updateOutput?.('Falling back to text capture...\n');

        // Fall back to text capture (R141: capped)
        const output = truncateMiddle(await this.tmux.capturePane(sessionId));
        await this.persistence.touchSession(sessionId);

        return this.createSuccessResult(
          `Snapshot of tmux session '${sessionId}' (text only, visual screenshot failed):\n\n` +
          `Error: ${error.message}\n\n` +
          `Text output:\n${'='.repeat(60)}\n${output}\n${'='.repeat(60)}`,
          { sessionId, lines: output.split('\n').length, visualFailed: true }
        );
      }
    } else {
      // Text-only snapshot (R141: capped)
      const output = truncateMiddle(await this.tmux.capturePane(sessionId));
      await this.persistence.touchSession(sessionId);

      return this.createSuccessResult(
        `Snapshot of tmux session '${sessionId}' (text only):\n\n` +
        `${'='.repeat(60)}\n` +
        output +
        `${'='.repeat(60)}\n\n` +
        `Tip: Use includeScreenshot=true for visual screenshots using Playwright.`,
        { sessionId, lines: output.split('\n').length }
      );
    }
  }
}
