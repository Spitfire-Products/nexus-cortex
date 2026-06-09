/**
 * CLI Approval Handler
 *
 * Interactive command-line approval handler that prompts the user
 * for confirmation before executing potentially dangerous operations.
 *
 * @module permissions/CLIApprovalHandler
 */

import type { ApprovalHandler, ApprovalRequest } from '../contracts/MiddlewareContracts.js';

/**
 * Options for CLI approval handler
 */
export interface CLIApprovalHandlerOptions {
  /**
   * Timeout for approval requests (ms)
   * @default 60000 (60 seconds)
   */
  timeoutMs?: number;

  /**
   * Whether to show detailed tool input
   * @default true
   */
  showToolInput?: boolean;

  /**
   * Maximum length of tool input to display
   * @default 500
   */
  maxInputDisplay?: number;

  /**
   * Callback to toggle auto-approve mode (for shift+tab functionality)
   * When called, should toggle orchestrator.approvalMode.autoApproveActions
   */
  onToggleAutoApprove?: () => void;

  /**
   * Getter for current auto-approve status
   * Returns orchestrator.approvalMode.autoApproveActions
   */
  getAutoApproveStatus?: () => boolean;

  /**
   * Callback invoked before showing approval dialog
   * CLI can use this to pause any custom input handling (e.g., persistent input)
   */
  onBeforeApproval?: () => void;

  /**
   * Callback invoked after approval dialog is dismissed
   * CLI can use this to resume any custom input handling
   */
  onAfterApproval?: () => void;

  /**
   * Callback to render a preview before showing the approval prompt
   * Called with the approval request so CLI can render tool-specific previews
   * (e.g., diff preview for Edit tool)
   */
  onRenderPreview?: (request: ApprovalRequest) => void;
}

/**
 * CLI-based approval handler with interactive prompts
 *
 * @example
 * ```typescript
 * const handler = new CLIApprovalHandler({
 *   timeoutMs: 60000,
 *   showToolInput: true
 * });
 *
 * const approved = await handler.requestApproval({
 *   toolName: 'delete_file',
 *   toolInput: { file_path: '/workspace/file.txt' },
 *   reason: 'Delete operation requires approval',
 *   timestamp: new Date()
 * });
 * ```
 */
export class CLIApprovalHandler implements ApprovalHandler {
  private options: Required<Omit<CLIApprovalHandlerOptions, 'onToggleAutoApprove' | 'getAutoApproveStatus' | 'onBeforeApproval' | 'onAfterApproval' | 'onRenderPreview'>>;
  private onToggleAutoApprove?: () => void;
  private getAutoApproveStatus?: () => boolean;
  private onBeforeApproval?: () => void;
  private onAfterApproval?: () => void;
  private onRenderPreview?: (request: ApprovalRequest) => void;

  constructor(options: CLIApprovalHandlerOptions = {}) {
    this.options = {
      timeoutMs: options.timeoutMs ?? 0, // No timeout by default - wait indefinitely
      showToolInput: options.showToolInput ?? true,
      maxInputDisplay: options.maxInputDisplay ?? 500,
    };
    this.onToggleAutoApprove = options.onToggleAutoApprove;
    this.getAutoApproveStatus = options.getAutoApproveStatus;
    this.onBeforeApproval = options.onBeforeApproval;
    this.onAfterApproval = options.onAfterApproval;
    this.onRenderPreview = options.onRenderPreview;
  }

  /**
   * Set the approval mode toggle callback (called after orchestrator is created)
   */
  setApprovalModeCallbacks(callbacks: {
    onToggle: () => void;
    getStatus: () => boolean;
  }): void {
    this.onToggleAutoApprove = callbacks.onToggle;
    this.getAutoApproveStatus = callbacks.getStatus;
  }

  /**
   * Set pause/resume callbacks for custom input handling (e.g., persistent input)
   */
  setInputHandlerCallbacks(callbacks: {
    onBeforeApproval: () => void;
    onAfterApproval: () => void;
  }): void {
    this.onBeforeApproval = callbacks.onBeforeApproval;
    this.onAfterApproval = callbacks.onAfterApproval;
  }

  /**
   * Set preview renderer callback (called before approval prompt to show tool-specific previews)
   */
  setPreviewRenderer(renderer: (request: ApprovalRequest) => void): void {
    this.onRenderPreview = renderer;
  }

  /**
   * Request approval for a tool operation
   */
  async requestApproval(request: ApprovalRequest, signal?: AbortSignal): Promise<boolean> {
    // FAIL-FAST: Headless mode (no TTY) cannot prompt for interactive approval.
    // Without this check, promptMultiChoice() waits on stdin forever, which
    // causes tool-execution timeout to fire (at TOOL_TIMEOUT_MS) but the
    // abort signal isn't honored — the whole session hangs.
    // Users running headlessly should set YOLO=true / --yolo to use AutoApproveHandler instead.
    if (typeof process !== 'undefined' && process.stdin && !process.stdin.isTTY) {
      console.warn(
        `[CLIApprovalHandler] Headless mode detected (no TTY). Cannot prompt interactively for "${request.toolName}". ` +
        `Denying request. To run non-interactively, set YOLO=true env var or pass --yolo flag to enable auto-approval.`
      );
      return false;
    }

    // Short-circuit if already aborted (e.g., tool timeout fired before we got here)
    if (signal?.aborted) {
      console.warn(`[CLIApprovalHandler] Request already aborted for "${request.toolName}" — denying.`);
      return false;
    }

    // Pause any custom input handling (e.g., persistent input) before showing dialog
    if (this.onBeforeApproval) {
      this.onBeforeApproval();
    }

    try {
      // Render tool-specific preview (e.g., diff for Edit tool) before approval prompt
      if (this.onRenderPreview) {
        this.onRenderPreview(request);
      }

      // Format the file name/path for display
      const fileName = this.extractFileName(request.toolInput);
      const actionVerb = request.toolName === 'Write' ? 'create'
        : request.toolName === 'Edit' ? 'make this edit to'
        : request.toolName === 'Read' ? 'read'
        : request.toolName === 'Bash' ? 'run'
        : `execute ${request.toolName} on`;

      // Check current auto-approve status
      const currentAutoApprove = this.getAutoApproveStatus ? this.getAutoApproveStatus() : false;
      const statusHint = currentAutoApprove ? ' (auto-approve: ON)' : '';

      // Show prompt — initial render with cursor on option 1
      console.log(`\n Do you want to ${actionVerb} ${fileName}?${statusHint}`);
      console.log(` > 1. Yes`);
      console.log(` 2. Yes, auto-approve all actions this session (shift+tab to toggle)`);
      console.log(` 3. No, skip this operation (esc)`);

      try {
        if (process.env.DEBUG === 'true') {
          console.log(`[Approval] Awaiting promptMultiChoice (timeoutMs=${this.options.timeoutMs}, signal.aborted=${signal?.aborted})`);
          console.log(`[Approval] stdin: isTTY=${process.stdin.isTTY}, isRaw=${process.stdin.isRaw}, isPaused=${process.stdin.isPaused()}, listenerCount=${process.stdin.listenerCount('data')}`);
        }
        const response = await this.promptMultiChoice(this.options.timeoutMs, signal);

        if (process.env.DEBUG === 'true') {
          console.log(`[Approval] Got response: ${JSON.stringify(response)}`);
        }

        // Clear the prompt (5 lines: empty line + question + 3 options)
        this.clearPrompt(5);

        switch (response) {
          case '1':
            console.log('[OK] Operation approved');
            return true;

          case '2':
          case 'toggle':
            if (this.onToggleAutoApprove) {
              this.onToggleAutoApprove();
              const newStatus = this.getAutoApproveStatus ? this.getAutoApproveStatus() : false;
              console.log(`[OK] Operation approved (auto-approve: ${newStatus ? 'ON' : 'OFF'})`);
            } else {
              console.log('[OK] Operation approved');
            }
            return true;

          case '3':
          case 'esc':
            console.log('[--] Operation skipped');
            return false;

          default:
            console.log('[--] Invalid response, operation skipped');
            return false;
        }
      } catch (error: any) {
        this.clearPrompt(5);
        if (process.env.DEBUG === 'true') {
          console.log(`[Approval] CATCH: ${error.message}`);
        }
        console.log(`[WARN] Approval failed: ${error.message}`);
        return false;
      }
    } finally {
      // Resume custom input handling after dialog is dismissed
      if (this.onAfterApproval) {
        this.onAfterApproval();
      }
    }
  }

  /**
   * Clear the approval prompt from the terminal
   */
  private clearPrompt(lines: number): void {
    // Clear current line first
    process.stdout.write('\x1b[2K'); // Clear entire line
    process.stdout.write('\x1b[0G'); // Move cursor to beginning

    // Move cursor up and clear each previous line
    for (let i = 0; i < lines; i++) {
      process.stdout.write('\x1b[A'); // Move cursor up
      process.stdout.write('\x1b[2K'); // Clear entire line
      process.stdout.write('\x1b[0G'); // Move cursor to beginning
    }
  }

  /**
   * Extract file name from tool input
   */
  private extractFileName(toolInput: any): string {
    if (toolInput?.file_path) {
      const parts = toolInput.file_path.split('/');
      return parts[parts.length - 1] || toolInput.file_path;
    }
    return 'file';
  }

  private static readonly OPTION_LABELS = [
    '1. Yes',
    '2. Yes, auto-approve all actions this session (shift+tab to toggle)',
    '3. No, skip this operation (esc)',
  ];

  private static readonly OPTION_RESPONSES = ['1', '2', '3'];

  /**
   * Redraw the 3 option lines in-place (cursor stays on option area).
   * Moves up 3 lines, redraws each, then positions cursor at the end.
   */
  private redrawOptions(selectedIndex: number): void {
    // Move cursor up 3 lines (we're below the options)
    process.stdout.write('\x1b[3A');
    for (let i = 0; i < 3; i++) {
      process.stdout.write('\x1b[2K\x1b[0G'); // clear line, cursor to col 0
      const prefix = i === selectedIndex ? ' > ' : ' ';
      process.stdout.write(`${prefix}${CLIApprovalHandler.OPTION_LABELS[i]}`);
      if (i < 2) process.stdout.write('\n');
    }
    process.stdout.write('\n'); // move below options
  }

  /**
   * Prompt user for multi-choice selection with arrow key navigation.
   */
  private promptMultiChoice(timeoutMs: number, signal?: AbortSignal): Promise<string> {
    return new Promise((resolve, reject) => {
      const wasRaw = process.stdin.isRaw;
      const wasPaused = process.stdin.isPaused();

      const existingListeners = process.stdin.listeners('data') as Array<(...args: any[]) => void>;
      existingListeners.forEach(listener => {
        process.stdin.removeListener('data', listener);
      });

      let selectedIndex = 0;

      let timeout: NodeJS.Timeout | null = null;
      if (timeoutMs > 0) {
        timeout = setTimeout(() => {
          cleanup();
          reject(new Error('Timeout'));
        }, timeoutMs);
      }

      const onAbort = () => {
        cleanup();
        reject(new Error('Aborted'));
      };
      if (signal) {
        if (signal.aborted) {
          queueMicrotask(() => { cleanup(); reject(new Error('Aborted')); });
          return;
        }
        signal.addEventListener('abort', onAbort, { once: true });
      }

      const cleanup = () => {
        if (timeout) clearTimeout(timeout);
        if (escTimer) { clearTimeout(escTimer); escTimer = null; }
        if (signal) signal.removeEventListener('abort', onAbort);

        process.stdin.removeListener('data', onData);

        if (process.stdin.setRawMode) {
          process.stdin.setRawMode(wasRaw || false);
        }

        existingListeners.forEach(listener => {
          process.stdin.on('data', listener);
        });

        if (wasPaused) {
          process.stdin.pause();
        } else {
          process.stdin.resume();
        }
      };

      let escTimer: ReturnType<typeof setTimeout> | null = null;

      const onData = (data: Buffer) => {
        const char = data.toString();

        if (process.env.DEBUG === 'true') {
          const hex = data.toString('hex');
          console.log(`[Approval:onData] hex=${hex} len=${data.length} char=${JSON.stringify(char)}`);
        }

        // Shift+Tab — toggle auto-approve
        if (char === '\x1b[Z') {
          if (escTimer) { clearTimeout(escTimer); escTimer = null; }
          cleanup();
          resolve('toggle');
          return;
        }

        // Arrow keys arrive as \x1b[A (up) / \x1b[B (down) — 3-byte sequence
        if (char === '\x1b[A') {
          if (escTimer) { clearTimeout(escTimer); escTimer = null; }
          if (selectedIndex > 0) {
            selectedIndex--;
            this.redrawOptions(selectedIndex);
          }
          return;
        }
        if (char === '\x1b[B') {
          if (escTimer) { clearTimeout(escTimer); escTimer = null; }
          if (selectedIndex < 2) {
            selectedIndex++;
            this.redrawOptions(selectedIndex);
          }
          return;
        }

        // Bare ESC — defer to distinguish from multi-byte sequences
        if (char === '\x1b' && data.length === 1) {
          if (escTimer) clearTimeout(escTimer);
          escTimer = setTimeout(() => {
            escTimer = null;
            cleanup();
            resolve('esc');
          }, 80);
          return;
        }

        // Tail of a split escape sequence (e.g. "[A" after bare \x1b)
        if (escTimer) {
          clearTimeout(escTimer);
          escTimer = null;
          const seq = '\x1b' + char;
          if (seq === '\x1b[A' && selectedIndex > 0) {
            selectedIndex--;
            this.redrawOptions(selectedIndex);
          } else if (seq === '\x1b[B' && selectedIndex < 2) {
            selectedIndex++;
            this.redrawOptions(selectedIndex);
          } else if (seq === '\x1b[Z') {
            cleanup();
            resolve('toggle');
          }
          return;
        }

        // Direct number keys (no Enter required)
        if (char === '1' || char === '2' || char === '3') {
          cleanup();
          resolve(char);
          return;
        }

        // Enter — confirm currently selected option
        if (char === '\r' || char === '\n') {
          cleanup();
          resolve(CLIApprovalHandler.OPTION_RESPONSES[selectedIndex] ?? '1');
          return;
        }

        // Ctrl+C
        if (char === '\x03') {
          cleanup();
          process.exit(0);
        }

        // y/n shortcuts
        if (char === 'y' || char === 'Y') {
          cleanup();
          resolve('1');
          return;
        }
        if (char === 'n' || char === 'N') {
          cleanup();
          resolve('3');
          return;
        }
      };

      if (process.stdin.setRawMode) {
        process.stdin.setRawMode(true);
      }

      process.stdin.resume();
      process.stdin.on('data', onData);
    });
  }

}
