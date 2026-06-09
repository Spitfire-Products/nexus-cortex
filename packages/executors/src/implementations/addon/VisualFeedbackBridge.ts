/**
 * Visual Feedback Bridge
 *
 * Enables the MODEL to see and interact with tools it creates.
 *
 * Flow:
 * 1. Model creates tool → UI spins up
 * 2. Bridge captures screenshot/DOM
 * 3. Returns visual data to model
 * 4. Model analyzes output
 * 5. Model edits code or spawns interaction agent
 * 6. Hot reload applies changes
 * 7. Repeat until satisfied
 */

import { chromium, Browser, Page } from 'playwright';
import { promises as fs } from 'fs';
import { join } from 'path';
import { getChromiumBinary } from '../../utils/ChromiumBrowserManager.js';

export interface VisualBridgeConfig {
  headless?: boolean;        // Browser visibility (default: true)
  slowMo?: number;          // Slow down operations (ms, default: 0)
  userDataDir?: string;     // Persistent browser profile directory
  executablePath?: string;  // Path to browser executable (use system Chromium)
}

export interface VisualSnapshot {
  screenshot: string;        // Base64 PNG
  dom: string;              // HTML structure
  console: string[];        // Console logs
  network: NetworkRequest[]; // Network activity
  performance: PerformanceMetrics;
  accessibility: AccessibilityTree;
}

export interface NetworkRequest {
  url: string;
  method: string;
  status: number;
  timing: number;
}

export interface PerformanceMetrics {
  loadTime: number;
  renderTime: number;
  memoryUsage: number;
}

export interface AccessibilityTree {
  roles: string[];
  labels: string[];
  structure: any;
}

export interface PageState {
  buttons: Array<{
    text: string | null;
    id: string;
    className: string;
    disabled: boolean;
    visible: boolean;
    position: DOMRect;
  }>;
  inputs: Array<{
    type: string;
    name: string;
    id: string;
    value: string;
    placeholder: string;
    required: boolean;
    disabled: boolean;
  }>;
  forms: Array<{
    id: string;
    name: string;
    action: string;
    method: string;
    elements: number;
  }>;
  links: Array<{
    text: string | null;
    href: string;
    target: string;
  }>;
  meta: {
    title: string;
    url: string;
    referrer: string;
    readyState: string;
  };
  storage: {
    localStorage: Record<string, any>;
    sessionStorage: Record<string, any>;
    cookies: string;
  };
  resources: {
    scripts: Array<{
      src: string;
      type: string;
      async: boolean;
      defer: boolean;
    }>;
    stylesheets: Array<{
      href: string;
      disabled: boolean;
    }>;
  };
  viewport: {
    width: number;
    height: number;
    scrollX: number;
    scrollY: number;
    scrollHeight: number;
    scrollWidth: number;
  };
}

export interface JavaScriptError {
  message: string;
  stack: string;
  timestamp: number;
}

export interface DetailedPerformanceMetrics {
  scriptDuration: number;
  layoutDuration: number;
  recalcStyleDuration: number;
  taskDuration: number;
  jsHeapUsedSize: number;
  jsHeapTotalSize: number;
  domNodes: number;
  layoutCount: number;
  recalcStyleCount: number;
}

export interface ComprehensiveSnapshot {
  url: string;
  timestamp: number;
  visual: {
    screenshot: string;  // Base64
    viewport: PageState['viewport'];
  };
  structural: {
    dom: string;
    pageState: PageState;
    accessibility: AccessibilityTree;
  };
  runtime: {
    console: string[];
    network: NetworkRequest[];
    performance: DetailedPerformanceMetrics;
  };
}

export interface InteractionCommand {
  type: 'click' | 'type' | 'navigate' | 'scroll' | 'select' | 'hover' | 'keypress' | 'zoom';
  selector?: string;
  value?: string;
  coordinates?: { x: number; y: number };
  key?: string;           // For keypress: 'Enter', 'Escape', 'Ctrl+V', etc.
  modifiers?: string[];   // For keypress: ['Control', 'Shift']
  zoomLevel?: number;     // For zoom: 1.0 = 100%, 1.5 = 150%, etc.
  deltaX?: number;        // For scroll: horizontal delta
  deltaY?: number;        // For scroll: vertical delta
}

/**
 * Visual Feedback Bridge
 *
 * Allows model to:
 * - See its creations (screenshot + DOM)
 * - Interact with UI (Playwright automation)
 * - Iterate rapidly (hot reload + visual diff)
 * - Delegate to sub-agents (complex interactions)
 */
export class VisualFeedbackBridge {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private consoleLogs: string[] = [];
  private networkRequests: NetworkRequest[] = [];

  /**
   * Initialize browser for visual feedback
   * @param config Optional configuration for browser launch
   */
  async initialize(config: VisualBridgeConfig = {}): Promise<void> {
    if (this.browser) return;

    const launchOptions: any = {
      headless: config.headless ?? true,
      slowMo: config.slowMo ?? 0,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',  // Prevent shared memory issues
        '--disable-gpu' // Disable GPU for headless
      ]
    };

    // Use system chromium if specified, otherwise auto-detect
    if (config.executablePath) {
      launchOptions.executablePath = config.executablePath;
      console.log(`[VisualFeedbackBridge] Using provided chromium: ${config.executablePath}`);
    } else {
      // Auto-detect chromium binary
      const chromiumBin = getChromiumBinary();
      if (chromiumBin) {
        launchOptions.executablePath = chromiumBin;
        console.log(`[VisualFeedbackBridge] Using auto-detected chromium: ${chromiumBin}`);
      } else {
        console.warn(`[VisualFeedbackBridge] No chromium binary found, using Playwright's bundled browser (may require dependencies)`);
      }
    }

    // Add user data directory if specified (for persistent profiles)
    if (config.userDataDir) {
      launchOptions.args.push(`--user-data-dir=${config.userDataDir}`);
    }

    this.browser = await chromium.launch(launchOptions);

    this.page = await this.browser.newPage();

    // Capture console logs
    this.page.on('console', (msg: any) => {
      this.consoleLogs.push(`[${msg.type()}] ${msg.text()}`);
    });

    // Capture network requests
    this.page.on('request', (request: any) => {
      // Track requests
    });

    this.page.on('response', async (response: any) => {
      try {
        const request = response.request();
        this.networkRequests.push({
          url: request.url(),
          method: request.method(),
          status: response.status(),
          timing: 0 // TODO: Calculate from timing API
        });
      } catch (error) {
        // Ignore errors
      }
    });
  }

  /**
   * Get the Playwright page instance
   */
  getPage(): Page | null {
    return this.page;
  }

  /**
   * Navigate to a URL
   */
  async navigate(url: string): Promise<void> {
    if (!this.page) {
      throw new Error('Browser not initialized');
    }
    await this.page.goto(url, { waitUntil: 'networkidle' });
  }

  /**
   * Capture screenshot of current page
   */
  async captureScreenshot(): Promise<Buffer> {
    if (!this.page) {
      throw new Error('Browser not initialized');
    }
    return await this.page.screenshot({ type: 'png', fullPage: true });
  }

  /**
   * Navigate to tool URL and capture snapshot
   */
  async captureSnapshot(url: string): Promise<VisualSnapshot> {
    if (!this.page) {
      throw new Error('Browser not initialized');
    }

    // Reset tracking
    this.consoleLogs = [];
    this.networkRequests = [];

    // Navigate to page
    const startTime = Date.now();
    await this.page.goto(url, { waitUntil: 'networkidle' });
    const loadTime = Date.now() - startTime;

    // Wait for render
    await this.page.waitForTimeout(1000);

    // Capture screenshot
    const screenshot = await this.page.screenshot({
      type: 'png',
      fullPage: true
    });

    // Get DOM structure
    const dom = await this.page.content();

    // Get performance metrics
    const performanceMetrics = await this.page.evaluate(() => {
      const perf: any = (performance as any).getEntriesByType?.('navigation')?.[0];
      return {
        loadTime: perf?.loadEventEnd - perf?.fetchStart || 0,
        renderTime: perf?.domContentLoadedEventEnd - perf?.fetchStart || 0,
        memoryUsage: (performance as any).memory?.usedJSHeapSize || 0
      };
    });

    // Get accessibility tree
    const accessibilityTree = await this.captureAccessibilityTree();

    return {
      screenshot: screenshot.toString('base64'),
      dom,
      console: this.consoleLogs,
      network: this.networkRequests,
      performance: {
        loadTime,
        renderTime: performanceMetrics.renderTime,
        memoryUsage: performanceMetrics.memoryUsage
      },
      accessibility: accessibilityTree
    };
  }

  /**
   * Capture accessibility tree for semantic understanding
   */
  private async captureAccessibilityTree(): Promise<AccessibilityTree> {
    if (!this.page) {
      throw new Error('Browser not initialized');
    }

    const snapshot = await this.page.accessibility.snapshot();

    const roles: string[] = [];
    const labels: string[] = [];

    const traverse = (node: any) => {
      if (!node) return;
      if (node.role) roles.push(node.role);
      if (node.name) labels.push(node.name);
      if (node.children) {
        node.children.forEach(traverse);
      }
    };

    traverse(snapshot);

    return {
      roles: Array.from(new Set(roles)),
      labels: Array.from(new Set(labels)),
      structure: snapshot
    };
  }

  /**
   * Execute interaction command
   */
  async interact(command: InteractionCommand): Promise<void> {
    if (!this.page) {
      throw new Error('Browser not initialized');
    }

    switch (command.type) {
      case 'click':
        if (command.selector) {
          await this.page.click(command.selector);
        } else if (command.coordinates) {
          await this.page.mouse.click(command.coordinates.x, command.coordinates.y);
        }
        break;

      case 'type':
        if (command.selector && command.value) {
          await this.page.fill(command.selector, command.value);
        }
        break;

      case 'navigate':
        if (command.value) {
          await this.page.goto(command.value);
        }
        break;

      case 'scroll':
        if (command.selector) {
          await this.page.locator(command.selector).scrollIntoViewIfNeeded();
        } else if (command.deltaX !== undefined || command.deltaY !== undefined) {
          await this.scroll({ deltaX: command.deltaX, deltaY: command.deltaY });
        } else if (command.coordinates) {
          // Legacy support
          await this.page.mouse.wheel(0, command.coordinates.y);
        }
        break;

      case 'select':
        if (command.selector && command.value) {
          await this.page.selectOption(command.selector, command.value);
        }
        break;

      case 'hover':
        if (command.selector) {
          await this.page.hover(command.selector);
        }
        break;

      case 'keypress':
        if (command.key) {
          await this.keyPress(command.key, command.modifiers);
        }
        break;

      case 'zoom':
        if (command.zoomLevel) {
          await this.zoom(command.zoomLevel);
        }
        break;
    }

    // Wait for any animations/updates
    await this.page.waitForTimeout(500);
  }

  /**
   * Press keyboard key or key combination
   * @param key Key to press ('Enter', 'Escape', 'a', 'Ctrl+V', etc.)
   * @param modifiers Optional modifier keys (['Control', 'Shift', 'Alt', 'Meta'])
   */
  async keyPress(key: string, modifiers?: string[]): Promise<void> {
    if (!this.page) {
      throw new Error('Browser not initialized');
    }

    // Handle shorthand notation like 'Ctrl+V'
    if (key.includes('+')) {
      const parts = key.split('+');
      if (parts.length >= 2 && parts[0] && parts[1]) {
        const modifier = parts[0].toLowerCase();
        const actualKey = parts[1];

        // Convert shorthand to Playwright format
        const modifierMap: Record<string, string> = {
          'ctrl': 'Control',
          'control': 'Control',
          'shift': 'Shift',
          'alt': 'Alt',
          'meta': 'Meta',
          'cmd': 'Meta',
          'command': 'Meta'
        };

        const playwrightModifier = modifierMap[modifier] || modifier;
        await this.page.keyboard.press(`${playwrightModifier}+${actualKey}`);
      }
    } else if (modifiers && modifiers.length > 0) {
      // Use explicit modifiers
      const modifierString = modifiers.join('+');
      await this.page.keyboard.press(`${modifierString}+${key}`);
    } else {
      // Simple key press
      await this.page.keyboard.press(key);
    }
  }

  /**
   * Scroll the page
   * @param delta Scroll delta { deltaX, deltaY }
   */
  async scroll(delta: { deltaX?: number; deltaY?: number }): Promise<void> {
    if (!this.page) {
      throw new Error('Browser not initialized');
    }

    await this.page.mouse.wheel(delta.deltaX || 0, delta.deltaY || 0);
  }

  /**
   * Zoom the page
   * @param level Zoom level (1.0 = 100%, 1.5 = 150%, 0.5 = 50%)
   */
  async zoom(level: number): Promise<void> {
    if (!this.page) {
      throw new Error('Browser not initialized');
    }

    await this.page.evaluate((zoomLevel: number) => {
      document.body.style.zoom = `${zoomLevel * 100}%`;
    }, level);
  }

  /**
   * Copy text to clipboard
   * @param text Text to copy to clipboard
   */
  async copyToClipboard(text: string): Promise<void> {
    if (!this.page) {
      throw new Error('Browser not initialized');
    }

    await this.page.evaluate((textToCopy: string) => {
      return navigator.clipboard.writeText(textToCopy);
    }, text);
  }

  /**
   * Get text from clipboard
   * @returns Text from clipboard
   */
  async getClipboard(): Promise<string> {
    if (!this.page) {
      throw new Error('Browser not initialized');
    }

    return await this.page.evaluate(() => {
      return navigator.clipboard.readText();
    });
  }

  /**
   * Paste text from clipboard at current focus
   * Combines clipboard.writeText() with Ctrl+V keypress
   * @param text Text to paste
   */
  async paste(text: string): Promise<void> {
    if (!this.page) {
      throw new Error('Browser not initialized');
    }

    // Write to clipboard
    await this.copyToClipboard(text);

    // Wait a moment for clipboard to be ready
    await this.page.waitForTimeout(100);

    // Press Ctrl+V to paste
    await this.keyPress('Ctrl+V');
  }

  /**
   * Execute JavaScript code in page context
   * Much faster than visual parsing for data extraction
   *
   * @param code JavaScript code to execute (string or function)
   * @returns Result of the execution
   *
   * @example
   * // Get all button texts
   * const buttons = await executeJS(() => {
   *   return Array.from(document.querySelectorAll('button'))
   *     .map(b => b.textContent);
   * });
   */
  async executeJS<T = any>(code: string | (() => T | Promise<T>)): Promise<T> {
    if (!this.page) {
      throw new Error('Browser not initialized');
    }

    if (typeof code === 'function') {
      return await this.page.evaluate(code);
    } else {
      return await this.page.evaluate(code);
    }
  }

  /**
   * Execute JavaScript with arguments
   * @param fn Function to execute in page context
   * @param args Arguments to pass to the function
   */
  async executeJSWithArgs<T = any>(
    fn: any,
    ...args: any[]
  ): Promise<T> {
    if (!this.page) {
      throw new Error('Browser not initialized');
    }

    // Playwright evaluate accepts (fn, arg) format, not spread args
    return await this.page.evaluate(fn, args.length === 1 ? args[0] : args);
  }

  /**
   * Get complete page state including JavaScript runtime data
   * Much faster and more comprehensive than visual parsing
   */
  async getPageState(): Promise<PageState> {
    if (!this.page) {
      throw new Error('Browser not initialized');
    }

    return await this.page.evaluate(() => {
      // @ts-ignore - Runs in browser context
      return {
        // Interactive elements
        buttons: Array.from(document.querySelectorAll('button')).map((b: any) => ({
          text: b.textContent?.trim(),
          id: b.id,
          className: b.className,
          disabled: b.disabled,
          visible: b.offsetParent !== null,
          position: b.getBoundingClientRect()
        })),

        inputs: Array.from(document.querySelectorAll('input, textarea')).map((i: any) => ({
          type: i.type,
          name: i.name,
          id: i.id,
          value: i.value,
          placeholder: i.placeholder,
          required: i.required,
          disabled: i.disabled
        })),

        forms: Array.from(document.querySelectorAll('form')).map((f: any) => ({
          id: f.id,
          name: f.name,
          action: f.action,
          method: f.method,
          elements: f.elements.length
        })),

        links: Array.from(document.querySelectorAll('a')).map((a: any) => ({
          text: a.textContent?.trim(),
          href: a.href,
          target: a.target
        })),

        // Page metadata
        meta: {
          title: document.title,
          url: window.location.href,
          referrer: document.referrer,
          readyState: document.readyState
        },

        // Storage
        storage: {
          localStorage: {...localStorage},
          sessionStorage: {...sessionStorage},
          cookies: document.cookie
        },

        // Scripts and styles
        resources: {
          scripts: Array.from(document.scripts).map((s: any) => ({
            src: s.src,
            type: s.type,
            async: s.async,
            defer: s.defer
          })),
          stylesheets: Array.from(document.styleSheets).map((s: any) => ({
            href: s.href,
            disabled: s.disabled
          }))
        },

        // Viewport and dimensions
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight,
          scrollX: window.scrollX,
          scrollY: window.scrollY,
          scrollHeight: document.documentElement.scrollHeight,
          scrollWidth: document.documentElement.scrollWidth
        }
      };
    });
  }

  /**
   * Get JavaScript errors from the page
   * Uses Chrome DevTools Protocol for deep inspection
   */
  async getJavaScriptErrors(): Promise<JavaScriptError[]> {
    if (!this.page) {
      throw new Error('Browser not initialized');
    }

    const errors: JavaScriptError[] = [];

    // Listen for runtime exceptions
    this.page.on('pageerror', (error) => {
      errors.push({
        message: error.message,
        stack: error.stack || '',
        timestamp: Date.now()
      });
    });

    return errors;
  }

  /**
   * Enable Chrome DevTools Protocol for advanced debugging
   * Returns CDP session for direct protocol access
   */
  async enableDevTools(): Promise<any> {
    if (!this.page) {
      throw new Error('Browser not initialized');
    }

    const client = await this.page.context().newCDPSession(this.page);

    // Enable various DevTools domains
    await client.send('Runtime.enable');
    await client.send('Debugger.enable');
    await client.send('Network.enable');
    await client.send('Performance.enable');

    // Listen to JavaScript exceptions
    client.on('Runtime.exceptionThrown', (exception: any) => {
      console.log('[CDP] JS Exception:', exception);
    });

    // Listen to console API calls
    client.on('Runtime.consoleAPICalled', (call: any) => {
      console.log('[CDP] Console call:', call);
    });

    return client;
  }

  /**
   * Get detailed performance metrics from browser
   * Uses Chrome DevTools Protocol Performance domain
   */
  async getDetailedPerformanceMetrics(): Promise<DetailedPerformanceMetrics> {
    if (!this.page) {
      throw new Error('Browser not initialized');
    }

    const client = await this.page.context().newCDPSession(this.page);

    await client.send('Performance.enable');
    const metrics = await client.send('Performance.getMetrics');

    const getMetric = (name: string) =>
      metrics.metrics.find((m: any) => m.name === name)?.value || 0;

    return {
      scriptDuration: getMetric('ScriptDuration'),
      layoutDuration: getMetric('LayoutDuration'),
      recalcStyleDuration: getMetric('RecalcStyleDuration'),
      taskDuration: getMetric('TaskDuration'),
      jsHeapUsedSize: getMetric('JSHeapUsedSize'),
      jsHeapTotalSize: getMetric('JSHeapTotalSize'),
      domNodes: getMetric('Nodes'),
      layoutCount: getMetric('LayoutCount'),
      recalcStyleCount: getMetric('RecalcStyleCount')
    };
  }

  /**
   * Comprehensive parallel analysis - visual + structural + performance
   * Runs all analysis types simultaneously for maximum speed
   */
  async comprehensiveAnalysis(): Promise<ComprehensiveSnapshot> {
    if (!this.page) {
      throw new Error('Browser not initialized');
    }

    const url = this.page.url();

    // Run ALL analyses in parallel for speed!
    const [
      screenshot,
      dom,
      pageState,
      accessibilityTree,
      performanceMetrics
    ] = await Promise.all([
      this.page.screenshot({ type: 'png', fullPage: true }),
      this.page.content(),
      this.getPageState(),
      this.captureAccessibilityTree(),
      this.getDetailedPerformanceMetrics()
    ]);

    return {
      url,
      timestamp: Date.now(),
      visual: {
        screenshot: screenshot.toString('base64'),
        viewport: pageState.viewport
      },
      structural: {
        dom,
        pageState,
        accessibility: accessibilityTree
      },
      runtime: {
        console: [...this.consoleLogs],
        network: [...this.networkRequests],
        performance: performanceMetrics
      }
    };
  }

  /**
   * Execute batch of interactions
   */
  async interactBatch(commands: InteractionCommand[]): Promise<VisualSnapshot> {
    for (const command of commands) {
      await this.interact(command);
    }

    // Capture state after interactions
    return await this.captureSnapshot(this.page!.url());
  }

  /**
   * Extract structured data from page
   */
  async extractData(selector?: string): Promise<any> {
    if (!this.page) {
      throw new Error('Browser not initialized');
    }

    if (selector) {
      // @ts-ignore - This code runs in browser context where document exists
      return await this.page.evaluate((sel: string) => {
        const element = document.querySelector(sel);
        return element ? element.textContent : null;
      }, selector);
    }

    // Extract all structured data
    // @ts-ignore - This code runs in browser context where document exists
    return await this.page.evaluate(() => {
      const data: any = {
        title: document.title,
        headings: Array.from(document.querySelectorAll('h1, h2, h3')).map((h: any) => h.textContent),
        buttons: Array.from(document.querySelectorAll('button')).map((b: any) => ({
          text: b.textContent,
          disabled: b.disabled
        })),
        inputs: Array.from(document.querySelectorAll('input')).map((i: any) => ({
          type: i.type,
          placeholder: i.placeholder,
          value: i.value
        })),
        links: Array.from(document.querySelectorAll('a')).map((a: any) => ({
          text: a.textContent,
          href: a.href
        }))
      };

      return data;
    });
  }

  /**
   * Get visual diff between snapshots
   */
  async compareSnapshots(
    before: VisualSnapshot,
    after: VisualSnapshot
  ): Promise<{
    imageDiff: string;      // Base64 diff image
    domDiff: string[];      // Changed elements
    behaviorDiff: string[]; // Different behaviors
  }> {
    // TODO: Implement visual diff using pixelmatch or similar
    // For now, return DOM differences

    const domDiff: string[] = [];

    // Simple text diff (in production, use proper diff algorithm)
    if (before.dom !== after.dom) {
      domDiff.push('DOM structure changed');
    }

    const behaviorDiff: string[] = [];

    // Check console logs
    const newLogs = after.console.filter(log => !before.console.includes(log));
    if (newLogs.length > 0) {
      behaviorDiff.push(`New console logs: ${newLogs.length}`);
    }

    // Check network requests
    if (after.network.length !== before.network.length) {
      behaviorDiff.push(`Network requests changed: ${before.network.length} → ${after.network.length}`);
    }

    return {
      imageDiff: '', // TODO: Implement pixel diff
      domDiff,
      behaviorDiff
    };
  }

  /**
   * Cleanup
   */
  async close(): Promise<void> {
    if (this.page) {
      await this.page.close();
      this.page = null;
    }

    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  /**
   * Format snapshot for model consumption
   */
  formatForModel(snapshot: VisualSnapshot): string {
    const lines: string[] = [];

    lines.push('# Visual Snapshot');
    lines.push('');

    // Screenshot (model can see this with vision models)
    lines.push('## Screenshot');
    lines.push('');
    lines.push(`![Screenshot](data:image/png;base64,${snapshot.screenshot.substring(0, 100)}...)`);
    lines.push('');
    lines.push('*Note: Full screenshot available as base64 in metadata*');
    lines.push('');

    // Structured data the model can easily parse
    lines.push('## Page Structure');
    lines.push('');
    lines.push('```html');
    lines.push(this.simplifyDOM(snapshot.dom));
    lines.push('```');
    lines.push('');

    // Accessibility tree (semantic structure)
    lines.push('## Semantic Structure');
    lines.push('');
    lines.push(`**Roles**: ${snapshot.accessibility.roles.join(', ')}`);
    lines.push(`**Labels**: ${snapshot.accessibility.labels.slice(0, 10).join(', ')}`);
    lines.push('');

    // Console output
    if (snapshot.console.length > 0) {
      lines.push('## Console Output');
      lines.push('');
      lines.push('```');
      snapshot.console.forEach(log => lines.push(log));
      lines.push('```');
      lines.push('');
    }

    // Network activity
    if (snapshot.network.length > 0) {
      lines.push('## Network Activity');
      lines.push('');
      snapshot.network.slice(0, 10).forEach(req => {
        lines.push(`- ${req.method} ${req.url} → ${req.status}`);
      });
      lines.push('');
    }

    // Performance
    lines.push('## Performance');
    lines.push('');
    lines.push(`- Load Time: ${snapshot.performance.loadTime}ms`);
    lines.push(`- Render Time: ${snapshot.performance.renderTime}ms`);
    lines.push(`- Memory: ${(snapshot.performance.memoryUsage / 1024 / 1024).toFixed(2)} MB`);
    lines.push('');

    return lines.join('\n');
  }

  /**
   * Simplify DOM for model understanding
   */
  private simplifyDOM(html: string): string {
    // Remove scripts, styles, comments
    let simplified = html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '');

    // Extract key structure
    const lines = simplified.split('\n')
      .filter(line => line.trim())
      .map(line => line.trim())
      .slice(0, 50); // Limit to first 50 lines

    return lines.join('\n');
  }
}

/**
 * Singleton instance
 */
export const visualBridge = new VisualFeedbackBridge();
