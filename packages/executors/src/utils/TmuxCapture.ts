/**
 * TmuxCapture - Visual screenshot capture for tmux sessions
 *
 * Leverages existing WindowManager and TerminalSandbox infrastructure
 * to capture visual screenshots of tmux sessions.
 *
 * Features:
 * - Visual PNG screenshots of tmux sessions
 * - Uses Playwright via TerminalSandbox
 * - Minimal overhead (reuses existing browser instance)
 * - Automatic cleanup
 */

import { WindowManager, WindowConfig } from '../implementations/addon/WindowManager.js';
import { TmuxManager } from './TmuxManager.js';

export interface CaptureOptions {
  /**
   * Screenshot format
   */
  format?: 'png' | 'jpeg';

  /**
   * JPEG quality (0-100, only for JPEG format)
   */
  quality?: number;

  /**
   * Terminal dimensions (defaults to 80x24)
   */
  dimensions?: {
    cols: number;
    rows: number;
  };

  /**
   * Wait time in ms before capturing (allow rendering)
   */
  waitTime?: number;
}

export interface CaptureResult {
  /**
   * Screenshot buffer (PNG or JPEG)
   */
  screenshot: Buffer;

  /**
   * Screenshot as base64 string
   */
  base64: string;

  /**
   * Format of the screenshot
   */
  format: 'png' | 'jpeg';

  /**
   * Timestamp of capture
   */
  timestamp: number;

  /**
   * Session ID that was captured
   */
  sessionId: string;
}

/**
 * TmuxCapture - Visual screenshot capture for tmux sessions
 *
 * Strategy:
 * 1. Use WindowManager to create a terminal window
 * 2. Attach to the tmux session in that terminal
 * 3. Take a screenshot using Playwright
 * 4. Clean up the window
 */
export class TmuxCapture {
  private static windowManager: WindowManager | null = null;
  private static initPromise: Promise<void> | null = null;

  /**
   * Initialize WindowManager (singleton pattern)
   */
  private static async ensureWindowManager(): Promise<WindowManager> {
    if (TmuxCapture.windowManager) {
      return TmuxCapture.windowManager;
    }

    if (!TmuxCapture.initPromise) {
      TmuxCapture.initPromise = (async () => {
        TmuxCapture.windowManager = new WindowManager();
        await TmuxCapture.windowManager.initialize();
      })();
    }

    await TmuxCapture.initPromise;
    return TmuxCapture.windowManager!;
  }

  /**
   * Capture visual screenshot of a tmux session
   *
   * @param sessionId Tmux session ID
   * @param options Capture options
   * @returns Screenshot and metadata
   */
  public static async captureSession(
    sessionId: string,
    options: CaptureOptions = {}
  ): Promise<CaptureResult> {
    const tmux = TmuxManager.getInstance();

    // Verify tmux is available
    if (!(await tmux.isAvailable())) {
      throw new Error('tmux is not installed');
    }

    // Verify session exists
    if (!(await tmux.sessionExists(sessionId))) {
      throw new Error(`Tmux session '${sessionId}' does not exist`);
    }

    // Get or create WindowManager
    const windowManager = await TmuxCapture.ensureWindowManager();

    // Create temporary window ID
    const windowId = `tmux-capture-${sessionId}-${Date.now()}`;

    try {
      // Create terminal window that attaches to tmux session
      const windowConfig: WindowConfig = {
        type: 'terminal',
        id: windowId,
        shell: `tmux attach-session -t ${sessionId}`,
        position: {
          x: 0,
          y: 0,
          width: (options.dimensions?.cols || 80) * 10, // Approximate pixels
          height: (options.dimensions?.rows || 24) * 20
        }
      };

      await windowManager.createWindow(windowConfig);

      // Wait for rendering
      const waitTime = options.waitTime || 1000;
      await new Promise(resolve => setTimeout(resolve, waitTime));

      // Capture screenshot
      const screenshot = await windowManager.captureWindow(windowId);

      // Clean up window
      await windowManager.closeWindow(windowId);

      // Prepare result
      const format = options.format || 'png';
      const base64 = screenshot.toString('base64');

      return {
        screenshot,
        base64,
        format,
        timestamp: Date.now(),
        sessionId
      };
    } catch (error: any) {
      // Attempt cleanup on error
      try {
        await windowManager.closeWindow(windowId);
      } catch {
        // Ignore cleanup errors
      }

      throw new Error(`Failed to capture tmux session: ${error.message}`);
    }
  }

  /**
   * Capture screenshot and save to file
   *
   * @param sessionId Tmux session ID
   * @param filepath Path to save screenshot
   * @param options Capture options
   */
  public static async captureToFile(
    sessionId: string,
    filepath: string,
    options: CaptureOptions = {}
  ): Promise<void> {
    const fs = await import('fs/promises');
    const result = await TmuxCapture.captureSession(sessionId, options);
    await fs.writeFile(filepath, result.screenshot);
  }

  /**
   * Cleanup and shutdown WindowManager
   * Call this when done with all captures
   */
  public static async cleanup(): Promise<void> {
    if (TmuxCapture.windowManager) {
      await TmuxCapture.windowManager.close();
      TmuxCapture.windowManager = null;
      TmuxCapture.initPromise = null;
    }
  }
}
