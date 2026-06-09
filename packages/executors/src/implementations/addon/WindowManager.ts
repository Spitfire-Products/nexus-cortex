/**
 * Window Manager
 *
 * Manages multiple browser and terminal windows
 * Enables hybrid workflows (terminal + browser side-by-side)
 *
 * Features:
 * - Create multiple windows
 * - Focus management
 * - Screenshot capture from all windows
 * - Coordinate windows (tile, cascade, etc.)
 */

import { chromium, Browser, Page, BrowserContext } from 'playwright';
import { VisualFeedbackBridge } from './VisualFeedbackBridge.js';
import { TerminalSandbox } from './TerminalSandbox.js';
import { ScreenStream } from './ScreenStream.js';

export type WindowType = 'browser' | 'terminal';

export interface WindowConfig {
  type: WindowType;
  id: string;
  url?: string;              // For browser windows
  shell?: string;            // For terminal windows
  position?: {               // Window position
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface ManagedWindow {
  id: string;
  type: WindowType;
  page?: Page;              // For browser windows
  terminal?: TerminalSandbox; // For terminal windows
  stream?: ScreenStream;     // Optional screen streaming
}

/**
 * WindowManager - Manage multiple windows
 *
 * Allows creating and coordinating multiple browser and terminal
 * windows for complex development workflows.
 *
 * @example
 * const manager = new WindowManager();
 * await manager.initialize();
 *
 * // Create browser window
 * await manager.createWindow({
 *   type: 'browser',
 *   id: 'main-browser',
 *   url: 'https://tradingview.com'
 * });
 *
 * // Create terminal window
 * await manager.createWindow({
 *   type: 'terminal',
 *   id: 'dev-terminal',
 *   shell: '/bin/bash'
 * });
 *
 * // Focus browser
 * await manager.focusWindow('main-browser');
 */
export class WindowManager {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private windows: Map<string, ManagedWindow> = new Map();

  /**
   * Initialize window manager
   * @param executablePath Optional path to browser executable
   * @param headless Run browser in headless mode (default: true for server environments)
   */
  async initialize(executablePath?: string, headless: boolean = true): Promise<void> {
    const launchOptions: any = {
      headless: headless,  // Headless mode for server environments
      slowMo: 50,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    };

    if (executablePath) {
      launchOptions.executablePath = executablePath;
    }

    this.browser = await chromium.launch(launchOptions);

    this.context = await this.browser.newContext();
  }

  /**
   * Create a new window
   */
  async createWindow(config: WindowConfig): Promise<ManagedWindow> {
    if (this.windows.has(config.id)) {
      throw new Error(`Window with id "${config.id}" already exists`);
    }

    let window: ManagedWindow;

    if (config.type === 'browser') {
      window = await this.createBrowserWindow(config);
    } else {
      window = await this.createTerminalWindow(config);
    }

    this.windows.set(config.id, window);

    return window;
  }

  /**
   * Create browser window
   */
  private async createBrowserWindow(config: WindowConfig): Promise<ManagedWindow> {
    if (!this.context) {
      throw new Error('Window manager not initialized');
    }

    const page = await this.context.newPage();

    // Set viewport if position specified
    if (config.position) {
      await page.setViewportSize({
        width: config.position.width,
        height: config.position.height
      });
    }

    // Navigate if URL provided
    if (config.url) {
      await page.goto(config.url);
    }

    return {
      id: config.id,
      type: 'browser',
      page
    };
  }

  /**
   * Create terminal window
   */
  private async createTerminalWindow(config: WindowConfig): Promise<ManagedWindow> {
    const terminal = new TerminalSandbox({
      shell: config.shell,
      headed: true
    });

    await terminal.initialize();

    return {
      id: config.id,
      type: 'terminal',
      terminal
    };
  }

  /**
   * Get window by ID
   */
  getWindow(id: string): ManagedWindow | undefined {
    return this.windows.get(id);
  }

  /**
   * Focus window (bring to front)
   */
  async focusWindow(id: string): Promise<void> {
    const window = this.windows.get(id);
    if (!window) {
      throw new Error(`Window "${id}" not found`);
    }

    if (window.page) {
      await window.page.bringToFront();
    }
  }

  /**
   * Get screenshot from window
   */
  async captureWindow(id: string): Promise<Buffer> {
    const window = this.windows.get(id);
    if (!window) {
      throw new Error(`Window "${id}" not found`);
    }

    if (window.page) {
      return await window.page.screenshot({ type: 'png' });
    } else if (window.terminal) {
      return await window.terminal.getScreenshot();
    }

    throw new Error('Unable to capture screenshot');
  }

  /**
   * Capture all windows
   */
  async captureAllWindows(): Promise<Map<string, Buffer>> {
    const screenshots = new Map<string, Buffer>();

    for (const [id, window] of this.windows) {
      try {
        const screenshot = await this.captureWindow(id);
        screenshots.set(id, screenshot);
      } catch (error) {
        console.error(`Failed to capture window "${id}":`, error);
      }
    }

    return screenshots;
  }

  /**
   * Start screen streaming for a window
   */
  startStreaming(id: string, fps: number = 2): ScreenStream | null {
    const window = this.windows.get(id);
    if (!window || !window.page) {
      return null;
    }

    const stream = new ScreenStream(window.page, { fps });
    window.stream = stream;
    stream.start();

    return stream;
  }

  /**
   * Stop screen streaming for a window
   */
  stopStreaming(id: string): void {
    const window = this.windows.get(id);
    if (window?.stream) {
      window.stream.stop();
      window.stream = undefined;
    }
  }

  /**
   * Tile windows (arrange side-by-side)
   */
  async tileWindows(ids: string[]): Promise<void> {
    const windowCount = ids.length;
    if (windowCount === 0) return;

    const screenWidth = 1920;  // Assume standard screen
    const screenHeight = 1080;

    const windowWidth = Math.floor(screenWidth / windowCount);

    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      if (!id) continue;

      const window = this.windows.get(id);
      if (window?.page) {
        await window.page.setViewportSize({
          width: windowWidth,
          height: screenHeight
        });
      }
    }
  }

  /**
   * Close window
   */
  async closeWindow(id: string): Promise<void> {
    const window = this.windows.get(id);
    if (!window) {
      return;
    }

    // Stop streaming if active
    this.stopStreaming(id);

    // Close the window
    if (window.page) {
      await window.page.close();
    } else if (window.terminal) {
      await window.terminal.close();
    }

    this.windows.delete(id);
  }

  /**
   * Close all windows
   */
  async closeAll(): Promise<void> {
    const ids = Array.from(this.windows.keys());
    for (const id of ids) {
      await this.closeWindow(id);
    }
  }

  /**
   * Get all window IDs
   */
  getWindowIds(): string[] {
    return Array.from(this.windows.keys());
  }

  /**
   * Get window count
   */
  getWindowCount(): number {
    return this.windows.size;
  }

  /**
   * Cleanup all resources
   */
  async close(): Promise<void> {
    await this.closeAll();

    if (this.context) {
      await this.context.close();
      this.context = null;
    }

    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}

/**
 * Singleton instance for convenience
 */
export const windowManager = new WindowManager();
