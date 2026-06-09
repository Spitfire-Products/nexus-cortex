/**
 * Simple Streaming Output Handler
 *
 * During streaming: Just outputs text normally, captures keystrokes for queuing
 * No scroll regions, no fancy input frame - just reliable output
 */

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

function formatElapsed(ms: number): string {
  if (ms < 10000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  const m = Math.floor(ms / 60000);
  const s = Math.round((ms % 60000) / 1000);
  return `${m}m ${s}s`;
}

export interface PersistentInputOptions {
  getStatusState: () => any;
  theme: any;
  onToggleThinking?: () => void;
  onToggleAutoApprove?: () => void;
  onToggleDocuments?: () => void;
  onEscape?: () => void;
}

export class PersistentInput {
  private options: PersistentInputOptions;
  private queuedMessages: string[] = [];
  private isStreaming: boolean = false;
  private inputHandler: ((data: Buffer) => void) | null = null;
  private currentInput: string = '';
  private spinnerTimer: ReturnType<typeof setInterval> | null = null;
  private spinnerFrame: number = 0;
  private spinnerStartTime: number = 0;
  private spinnerPhase: string = 'Thinking';
  private spinnerVisible: boolean = false;

  constructor(options: PersistentInputOptions) {
    this.options = options;
  }

  /**
   * Start streaming mode - captures keystrokes but doesn't show input box
   */
  startCapture(): void {
    this.isStreaming = true;
    this.currentInput = '';

    // Enable raw mode for keystroke capture
    // Use try-catch to prevent crashes if stdin is in an unexpected state
    if (process.stdin.isTTY) {
      try {
        process.stdin.setRawMode(true);
      } catch {
        // Ignore errors if stdin is already closed or in unexpected state
      }
    }
    process.stdin.resume();

    this.inputHandler = (data: Buffer) => this.handleInput(data);
    process.stdin.on('data', this.inputHandler);
  }

  /**
   * Stop streaming mode
   */
  stopCapture(): void {
    this.isStreaming = false;

    if (this.inputHandler) {
      try {
        process.stdin.removeListener('data', this.inputHandler);
      } catch {
        // Ignore errors during listener removal
      }
      this.inputHandler = null;
    }

    // Use try-catch to prevent crashes if stdin is in an unexpected state
    if (process.stdin.isTTY) {
      try {
        process.stdin.setRawMode(false);
      } catch {
        // Ignore errors if stdin is already closed or in unexpected state
      }
    }

    // Add newline after streaming content
    process.stdout.write('\n');
  }

  /**
   * Handle keystrokes during streaming
   */
  private handleInput(data: Buffer): void {
    const str = data.toString();

    // Ctrl+C - clean exit (let the signal handler in interactive.ts handle cleanup)
    if (str === '\x03') {
      this.stopCapture();
      // Emit SIGINT to trigger proper cleanup handlers
      process.kill(process.pid, 'SIGINT');
      return;
    }

    // Escape - signal abort
    if (str === '\x1b' && str.length === 1) {
      if (this.options.onEscape) {
        this.options.onEscape();
      }
      return;
    }

    // Tab - toggle thinking
    if (str === '\x09') {
      if (this.options.onToggleThinking) {
        this.options.onToggleThinking();
      }
      return;
    }

    // Shift+Tab - toggle auto-approve
    if (str === '\x1b[Z') {
      if (this.options.onToggleAutoApprove) {
        this.options.onToggleAutoApprove();
      }
      return;
    }

    // Ctrl+E - toggle document expand/collapse
    if (str === '\x05') {
      if (this.options.onToggleDocuments) {
        this.options.onToggleDocuments();
      }
      return;
    }

    // Enter - queue the current input if any
    if (str === '\r' || str === '\n') {
      if (this.currentInput.trim()) {
        this.queuedMessages.push(this.currentInput);
        this.currentInput = '';
      }
      return;
    }

    // Backspace
    if (str === '\x7f' || str === '\b') {
      this.currentInput = this.currentInput.slice(0, -1);
      return;
    }

    // Regular characters - accumulate for potential queue
    for (const char of str) {
      if (char >= ' ' && char < '\x7f') {
        this.currentInput += char;
      }
    }
  }

  /**
   * Get and clear queued messages
   */
  getQueuedMessages(): string[] {
    const messages = [...this.queuedMessages];
    this.queuedMessages = [];
    return messages;
  }

  /**
   * Check if there are queued messages
   */
  hasQueuedMessages(): boolean {
    return this.queuedMessages.length > 0;
  }

  /**
   * Pause input capture (for permission dialogs)
   */
  pause(): void {
    if (!this.isStreaming) return;

    if (this.inputHandler) {
      try {
        process.stdin.removeListener('data', this.inputHandler);
      } catch {
        // Ignore errors during listener removal
      }
    }

    // Use try-catch to prevent crashes if stdin is in an unexpected state
    if (process.stdin.isTTY) {
      try {
        process.stdin.setRawMode(false);
      } catch {
        // Ignore errors if stdin is already closed or in unexpected state
      }
    }
  }

  /**
   * Resume input capture after pause
   */
  resume(): void {
    if (!this.isStreaming) return;

    // Use try-catch to prevent crashes if stdin is in an unexpected state
    if (process.stdin.isTTY) {
      try {
        process.stdin.setRawMode(true);
      } catch {
        // Ignore errors if stdin is already closed or in unexpected state
      }
    }

    if (this.inputHandler) {
      try {
        process.stdin.on('data', this.inputHandler);
      } catch {
        // Ignore errors during listener attachment
      }
    }
  }

  /**
   * Check if currently capturing
   */
  isCapturing(): boolean {
    return this.isStreaming;
  }

  /**
   * Write output to stdout, respecting the spinner.
   * If the spinner is active, clears the spinner line before writing,
   * then re-renders it after — prevents garbled interleaving.
   */
  writeOutput(text: string): void {
    if (this.spinnerVisible) {
      process.stdout.write('\r\x1b[2K');
      process.stdout.write(text);
      this.renderSpinnerFrame();
    } else {
      process.stdout.write(text);
    }
  }

  /**
   * Print a line (with trailing newline), respecting the spinner.
   */
  printLine(text: string = ''): void {
    if (this.spinnerVisible) {
      process.stdout.write('\r\x1b[2K');
      process.stdout.write(text + '\n');
      this.renderSpinnerFrame();
    } else {
      process.stdout.write(text + '\n');
    }
  }

  /**
   * Show animated thinking indicator with spinner, phase, and elapsed time
   */
  showThinking(): void {
    this.spinnerFrame = 0;
    this.spinnerStartTime = Date.now();
    this.spinnerPhase = 'Thinking';
    this.spinnerVisible = true;
    this.renderSpinnerFrame();
    this.spinnerTimer = setInterval(() => this.renderSpinnerFrame(), 80);
  }

  /**
   * Update the spinner phase (e.g. "Running ReadFile", "Generating")
   */
  setPhase(phase: string): void {
    this.spinnerPhase = phase;
  }

  /**
   * Clear thinking indicator (replace with newline)
   */
  clearThinking(): void {
    if (this.spinnerTimer) {
      clearInterval(this.spinnerTimer);
      this.spinnerTimer = null;
    }
    if (this.spinnerVisible) {
      process.stdout.write('\r\x1b[2K');
      this.spinnerVisible = false;
    }
  }

  /**
   * Get elapsed time since spinner started
   */
  getElapsed(): number {
    return this.spinnerStartTime > 0 ? Date.now() - this.spinnerStartTime : 0;
  }

  private renderSpinnerFrame(): void {
    const frame = SPINNER_FRAMES[this.spinnerFrame % SPINNER_FRAMES.length];
    this.spinnerFrame++;
    const elapsed = formatElapsed(Date.now() - this.spinnerStartTime);
    const line = `\x1b[2m${frame} ${this.spinnerPhase} \x1b[0m\x1b[2m${elapsed}\x1b[0m`;
    process.stdout.write(`\r\x1b[2K${line}`);
  }
}

/**
 * Create a persistent input instance
 */
export function createPersistentInput(options: PersistentInputOptions): PersistentInput {
  return new PersistentInput(options);
}
