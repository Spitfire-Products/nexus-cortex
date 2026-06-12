/**
 * TmuxSession Tool Executor
 *
 * Manages persistent terminal sessions using tmux.
 * Supports creating, managing, and capturing terminal sessions.
 */

import { BaseTool, type ToolResult } from '../../base/index.js';
import { SchemaValidator } from '../../utils/SchemaValidator.js';
import { TmuxManager, SessionPersistence, SessionLock, TmuxCapture } from '../../utils/index.js';
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
  action: 'create' | 'send' | 'capture' | 'list' | 'kill' | 'snapshot';

  /**
   * Session identifier (required for all actions except 'list')
   */
  sessionId?: string;

  /**
   * Command to send (required for 'send' action)
   */
  command?: string;

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

  /**
   * Include visual screenshot (optional for 'snapshot' action)
   */
  includeScreenshot?: boolean;
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
      `Manage persistent terminal sessions with tmux. Supports creating sessions, sending commands, capturing output, and managing session lifecycle. Use the 'snapshot' action with includeScreenshot=true to visually see what's displayed in the terminal - essential for iteratively debugging and improving commands you execute.`,
      {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['create', 'send', 'capture', 'list', 'kill', 'snapshot'],
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
          includeScreenshot: {
            type: 'boolean',
            description: 'Capture visual screenshot of terminal session using Playwright. Enables you (the model) to see exactly what is displayed in the terminal, including colors, formatting, and visual layout. Screenshot is returned as base64 PNG in response metadata. Essential for debugging visual terminal applications, progress bars, formatted output, and iteratively improving command execution.',
            default: false
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
      case 'kill':
      case 'snapshot':
        if (!params.sessionId) {
          return `sessionId is required for ${params.action} action`;
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
    // Check tmux availability
    if (!(await this.tmux.isAvailable())) {
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
        default:
          return this.createErrorResult(`Unknown action: ${params.action}`);
      }
    } catch (error: any) {
      return this.createErrorResult(`TmuxSession error: ${error.message}`);
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

    await this.tmux.sendKeys(sessionId, command);

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

    const startLine = params.captureHistory ? -3000 : undefined;
    const output = await this.tmux.capturePane(sessionId, startLine);

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

        // Also capture text for comparison
        const textOutput = await this.tmux.capturePane(sessionId);

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

        // Fall back to text capture
        const output = await this.tmux.capturePane(sessionId);
        await this.persistence.touchSession(sessionId);

        return this.createSuccessResult(
          `Snapshot of tmux session '${sessionId}' (text only, visual screenshot failed):\n\n` +
          `Error: ${error.message}\n\n` +
          `Text output:\n${'='.repeat(60)}\n${output}\n${'='.repeat(60)}`,
          { sessionId, lines: output.split('\n').length, visualFailed: true }
        );
      }
    } else {
      // Text-only snapshot
      const output = await this.tmux.capturePane(sessionId);
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
