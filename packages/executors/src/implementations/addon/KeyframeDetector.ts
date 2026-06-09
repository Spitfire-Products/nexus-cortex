/**
 * Keyframe Detector
 *
 * Intelligently detects when screenshots should be sent to vision API
 * Uses DOM analysis, perceptual hashing, and event monitoring
 * to minimize unnecessary API calls while maintaining accuracy.
 *
 * Features:
 * - Navigation change detection
 * - DOM mutation monitoring
 * - Modal/alert detection
 * - Visual error detection
 * - Perceptual hash-based change detection
 * - Event-driven keyframe triggers
 */

import { EventEmitter } from 'events';
import { Page } from 'playwright';
import crypto from 'crypto';

export interface KeyframeConfig {
  // Thresholds for detection
  domMutationThreshold?: number;    // Number of mutations to trigger (default: 50)
  visualHashThreshold?: number;     // Perceptual hash difference (0-1, default: 0.15)
  modalCheckInterval?: number;      // How often to check for modals (ms, default: 500)

  // Enable/disable specific detectors
  detectNavigation?: boolean;       // Default: true
  detectDOMMutations?: boolean;     // Default: true
  detectModals?: boolean;           // Default: true
  detectErrors?: boolean;           // Default: true
}

export interface KeyframeTrigger {
  type: 'navigation' | 'dom_mutation' | 'modal' | 'error' | 'user_request' | 'visual_change';
  reason: string;
  confidence: number;               // 0-1, how confident we are this needs API call
  metadata?: Record<string, any>;
  timestamp: number;
}

export interface PageSnapshot {
  url: string;
  title: string;
  domHash: string;
  visualHash: string;
  elementCount: number;
  hasModal: boolean;
  hasError: boolean;
}

/**
 * KeyframeDetector - Smart detection of when to send screenshots to vision API
 *
 * Monitors page state and triggers keyframe captures only when significant
 * changes occur, dramatically reducing API costs while maintaining accuracy.
 *
 * @example
 * const detector = new KeyframeDetector(page, {
 *   domMutationThreshold: 50,
 *   visualHashThreshold: 0.15
 * });
 *
 * detector.on('keyframe', (trigger: KeyframeTrigger) => {
 *   console.log(`Keyframe needed: ${trigger.reason}`);
 *   // Send screenshot to vision API
 * });
 *
 * await detector.start();
 */
export class KeyframeDetector extends EventEmitter {
  private page: Page;
  private config: Required<KeyframeConfig>;
  private isRunning: boolean = false;

  private lastSnapshot: PageSnapshot | null = null;
  private mutationCount: number = 0;
  private modalCheckInterval: ReturnType<typeof setInterval> | null = null;

  constructor(page: Page, config: KeyframeConfig = {}) {
    super();
    this.page = page;

    this.config = {
      domMutationThreshold: config.domMutationThreshold ?? 50,
      visualHashThreshold: config.visualHashThreshold ?? 0.15,
      modalCheckInterval: config.modalCheckInterval ?? 500,
      detectNavigation: config.detectNavigation ?? true,
      detectDOMMutations: config.detectDOMMutations ?? true,
      detectModals: config.detectModals ?? true,
      detectErrors: config.detectErrors ?? true
    };
  }

  /**
   * Start monitoring for keyframe triggers
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      console.warn('KeyframeDetector already running');
      return;
    }

    this.isRunning = true;

    // Take initial snapshot
    this.lastSnapshot = await this.captureSnapshot();

    // Set up detectors
    if (this.config.detectNavigation) {
      await this.setupNavigationDetector();
    }

    if (this.config.detectDOMMutations) {
      await this.setupDOMMutationDetector();
    }

    if (this.config.detectModals) {
      this.setupModalDetector();
    }

    if (this.config.detectErrors) {
      await this.setupErrorDetector();
    }

    this.emit('start', { config: this.config });
  }

  /**
   * Stop monitoring
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;

    if (this.modalCheckInterval) {
      clearInterval(this.modalCheckInterval);
      this.modalCheckInterval = null;
    }

    this.emit('stop');
  }

  /**
   * Manually trigger keyframe (for user requests)
   */
  triggerKeyframe(reason: string, metadata?: Record<string, any>): void {
    const trigger: KeyframeTrigger = {
      type: 'user_request',
      reason,
      confidence: 1.0,
      metadata,
      timestamp: Date.now()
    };

    this.emit('keyframe', trigger);
  }

  /**
   * Capture current page snapshot
   */
  private async captureSnapshot(): Promise<PageSnapshot> {
    const url = this.page.url();
    const title = await this.page.title();

    // Compute DOM hash
    const domContent = await this.page.evaluate(() => {
      return document.body.innerHTML;
    });
    const domHash = this.computeHash(domContent);

    // Get element count
    const elementCount = await this.page.evaluate(() => {
      return document.querySelectorAll('*').length;
    });

    // Check for modals
    const hasModal = await this.detectModal();

    // Check for errors
    const hasError = await this.detectError();

    // Compute visual hash (placeholder - would need actual perceptual hashing)
    const visualHash = this.computeHash(url + title + elementCount);

    return {
      url,
      title,
      domHash,
      visualHash,
      elementCount,
      hasModal,
      hasError
    };
  }

  /**
   * Set up navigation change detector
   */
  private async setupNavigationDetector(): Promise<void> {
    this.page.on('framenavigated', async (frame) => {
      if (frame === this.page.mainFrame()) {
        const newSnapshot = await this.captureSnapshot();

        if (this.lastSnapshot && newSnapshot.url !== this.lastSnapshot.url) {
          const trigger: KeyframeTrigger = {
            type: 'navigation',
            reason: `Navigation from ${this.lastSnapshot.url} to ${newSnapshot.url}`,
            confidence: 1.0,
            metadata: {
              fromUrl: this.lastSnapshot.url,
              toUrl: newSnapshot.url
            },
            timestamp: Date.now()
          };

          this.emit('keyframe', trigger);
        }

        this.lastSnapshot = newSnapshot;
      }
    });
  }

  /**
   * Set up DOM mutation detector
   */
  private async setupDOMMutationDetector(): Promise<void> {
    await this.page.evaluate((threshold) => {
      let mutationCount = 0;

      const observer = new MutationObserver((mutations) => {
        mutationCount += mutations.length;

        if (mutationCount >= threshold) {
          // Emit custom event that we'll listen for
          window.dispatchEvent(new CustomEvent('significant-mutation', {
            detail: { count: mutationCount }
          }));
          mutationCount = 0;
        }
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true
      });

      // Store observer so we can disconnect later
      (window as any).__keyframeDetectorObserver = observer;
    }, this.config.domMutationThreshold);

    // Listen for custom event
    await this.page.exposeFunction('__triggerDOMMutation', (count: number) => {
      const trigger: KeyframeTrigger = {
        type: 'dom_mutation',
        reason: `Significant DOM changes detected (${count} mutations)`,
        confidence: 0.8,
        metadata: { mutationCount: count },
        timestamp: Date.now()
      };

      this.emit('keyframe', trigger);
    });

    await this.page.evaluate(() => {
      window.addEventListener('significant-mutation', (e: any) => {
        (window as any).__triggerDOMMutation(e.detail.count);
      });
    });
  }

  /**
   * Set up modal detector (periodic check)
   */
  private setupModalDetector(): void {
    this.modalCheckInterval = setInterval(async () => {
      if (!this.isRunning) return;

      try {
        const hasModal = await this.detectModal();

        if (hasModal && (!this.lastSnapshot || !this.lastSnapshot.hasModal)) {
          const trigger: KeyframeTrigger = {
            type: 'modal',
            reason: 'Modal or dialog detected on page',
            confidence: 0.9,
            timestamp: Date.now()
          };

          this.emit('keyframe', trigger);

          if (this.lastSnapshot) {
            this.lastSnapshot.hasModal = true;
          }
        }
      } catch (error: any) {
        // Ignore navigation errors - page context was destroyed during navigation
        if (!error.message?.includes('Execution context was destroyed')) {
          // Re-throw other errors
          throw error;
        }
      }
    }, this.config.modalCheckInterval);
  }

  /**
   * Set up error detector
   */
  private async setupErrorDetector(): Promise<void> {
    // Listen for console errors
    this.page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const trigger: KeyframeTrigger = {
          type: 'error',
          reason: `Console error: ${msg.text()}`,
          confidence: 0.7,
          metadata: { errorText: msg.text() },
          timestamp: Date.now()
        };

        this.emit('keyframe', trigger);
      }
    });

    // Listen for page errors
    this.page.on('pageerror', (error) => {
      const trigger: KeyframeTrigger = {
        type: 'error',
        reason: `Page error: ${error.message}`,
        confidence: 0.9,
        metadata: { error: error.message },
        timestamp: Date.now()
      };

      this.emit('keyframe', trigger);
    });
  }

  /**
   * Detect if modal/dialog is present
   */
  private async detectModal(): Promise<boolean> {
    return await this.page.evaluate(() => {
      // Common modal selectors
      const modalSelectors = [
        '[role="dialog"]',
        '[role="alertdialog"]',
        '.modal',
        '.dialog',
        '[aria-modal="true"]'
      ];

      for (const selector of modalSelectors) {
        const element = document.querySelector(selector);
        if (element && (element as HTMLElement).offsetParent !== null) {
          return true;
        }
      }

      return false;
    });
  }

  /**
   * Detect if error is visible on page
   */
  private async detectError(): Promise<boolean> {
    return await this.page.evaluate(() => {
      const errorSelectors = [
        '.error',
        '.error-message',
        '[role="alert"]',
        '.alert-danger',
        '.notification-error'
      ];

      for (const selector of errorSelectors) {
        const element = document.querySelector(selector);
        if (element && (element as HTMLElement).offsetParent !== null) {
          const text = element.textContent?.toLowerCase() || '';
          if (text.includes('error') || text.includes('failed') || text.includes('wrong')) {
            return true;
          }
        }
      }

      return false;
    });
  }

  /**
   * Compute simple hash of content
   */
  private computeHash(content: string): string {
    return crypto.createHash('md5').update(content).digest('hex');
  }

  /**
   * Compute perceptual hash difference between two snapshots
   * Returns 0-1, where 0 is identical and 1 is completely different
   */
  async computeVisualDifference(): Promise<number> {
    if (!this.lastSnapshot) {
      return 1.0; // No baseline, assume different
    }

    const newSnapshot = await this.captureSnapshot();

    // Simple comparison based on DOM hash and element count
    if (newSnapshot.domHash === this.lastSnapshot.domHash) {
      return 0.0; // Identical
    }

    // Calculate difference based on element count change
    const elementDiff = Math.abs(
      newSnapshot.elementCount - this.lastSnapshot.elementCount
    ) / Math.max(newSnapshot.elementCount, this.lastSnapshot.elementCount);

    return Math.min(elementDiff, 1.0);
  }

  /**
   * Check if visual change threshold is exceeded
   */
  async shouldSendToAPI(): Promise<{ should: boolean; reason: string; confidence: number }> {
    const visualDiff = await this.computeVisualDifference();

    if (visualDiff >= this.config.visualHashThreshold) {
      return {
        should: true,
        reason: `Visual difference ${(visualDiff * 100).toFixed(1)}% exceeds threshold`,
        confidence: Math.min(visualDiff * 2, 1.0)
      };
    }

    const newSnapshot = await this.captureSnapshot();

    // Check for modals
    if (newSnapshot.hasModal && (!this.lastSnapshot || !this.lastSnapshot.hasModal)) {
      return {
        should: true,
        reason: 'Modal detected',
        confidence: 0.9
      };
    }

    // Check for errors
    if (newSnapshot.hasError && (!this.lastSnapshot || !this.lastSnapshot.hasError)) {
      return {
        should: true,
        reason: 'Error detected',
        confidence: 0.9
      };
    }

    return {
      should: false,
      reason: 'No significant changes detected',
      confidence: 0.0
    };
  }

  /**
   * Get current detector state
   */
  getState(): {
    isRunning: boolean;
    lastSnapshot: PageSnapshot | null;
    config: Required<KeyframeConfig>;
  } {
    return {
      isRunning: this.isRunning,
      lastSnapshot: this.lastSnapshot,
      config: this.config
    };
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    this.stop();
    this.removeAllListeners();
    this.lastSnapshot = null;
  }
}
