/**
 * Pause Controller
 *
 * Provides pause/resume functionality for sub-agent execution.
 * Allows users to temporarily suspend agent execution without
 * aborting, enabling review of intermediate results or guidance.
 *
 * Thread-safe design using promise-based waiting.
 *
 * @module orchestrator/PauseController
 * @version 1.0.0
 */

import type { IPauseController } from './SubAgentTypes.js';

/**
 * Pause event callback
 */
export type PauseEventCallback = () => void;

/**
 * Pause Controller Implementation
 *
 * Implements the IPauseController interface for sub-agent suspension.
 * Uses a promise-based approach for clean async waiting.
 *
 * @example
 * ```typescript
 * const controller = new PauseController();
 *
 * // In agent execution loop:
 * await controller.waitIfPaused();
 * // ... continue with execution
 *
 * // From UI/parent:
 * controller.pause();
 * // ... user reviews output
 * controller.resume();
 * ```
 */
export class PauseController implements IPauseController {
  private paused: boolean = false;
  private resumePromise: Promise<void> | null = null;
  private resolveResume: (() => void) | null = null;

  // Event callbacks
  private onPauseCallbacks: PauseEventCallback[] = [];
  private onResumeCallbacks: PauseEventCallback[] = [];

  // Tracking
  private pauseCount: number = 0;
  private lastPauseTime: Date | null = null;
  private totalPausedMs: number = 0;

  /**
   * Pause execution
   *
   * Subsequent calls to waitIfPaused() will block until resume() is called.
   */
  pause(): void {
    if (this.paused) {
      return; // Already paused
    }

    this.paused = true;
    this.pauseCount++;
    this.lastPauseTime = new Date();

    // Create a new promise that will be resolved on resume
    this.resumePromise = new Promise<void>((resolve) => {
      this.resolveResume = resolve;
    });

    // Notify listeners
    for (const callback of this.onPauseCallbacks) {
      try {
        callback();
      } catch (error) {
        console.error('[PauseController] Error in pause callback:', error);
      }
    }
  }

  /**
   * Resume execution
   *
   * Releases any waiters blocked on waitIfPaused().
   */
  resume(): void {
    if (!this.paused) {
      return; // Not paused
    }

    // Track pause duration
    if (this.lastPauseTime) {
      this.totalPausedMs += Date.now() - this.lastPauseTime.getTime();
      this.lastPauseTime = null;
    }

    this.paused = false;

    // Resolve the resume promise
    if (this.resolveResume) {
      this.resolveResume();
      this.resolveResume = null;
      this.resumePromise = null;
    }

    // Notify listeners
    for (const callback of this.onResumeCallbacks) {
      try {
        callback();
      } catch (error) {
        console.error('[PauseController] Error in resume callback:', error);
      }
    }
  }

  /**
   * Check if currently paused
   */
  isPaused(): boolean {
    return this.paused;
  }

  /**
   * Wait if paused
   *
   * Returns immediately if not paused.
   * Blocks until resume() is called if paused.
   */
  async waitIfPaused(): Promise<void> {
    if (!this.paused || !this.resumePromise) {
      return;
    }

    await this.resumePromise;
  }

  /**
   * Wait with timeout
   *
   * Like waitIfPaused() but with a maximum wait time.
   *
   * @param timeoutMs Maximum time to wait
   * @returns true if resumed, false if timeout
   */
  async waitIfPausedWithTimeout(timeoutMs: number): Promise<boolean> {
    if (!this.paused || !this.resumePromise) {
      return true;
    }

    const timeoutPromise = new Promise<boolean>((resolve) => {
      setTimeout(() => resolve(false), timeoutMs);
    });

    const resumePromise = this.resumePromise.then(() => true);

    return Promise.race([resumePromise, timeoutPromise]);
  }

  /**
   * Register callback for pause events
   */
  onPause(callback: PauseEventCallback): () => void {
    this.onPauseCallbacks.push(callback);

    // Return unsubscribe function
    return () => {
      const index = this.onPauseCallbacks.indexOf(callback);
      if (index !== -1) {
        this.onPauseCallbacks.splice(index, 1);
      }
    };
  }

  /**
   * Register callback for resume events
   */
  onResume(callback: PauseEventCallback): () => void {
    this.onResumeCallbacks.push(callback);

    // Return unsubscribe function
    return () => {
      const index = this.onResumeCallbacks.indexOf(callback);
      if (index !== -1) {
        this.onResumeCallbacks.splice(index, 1);
      }
    };
  }

  /**
   * Get pause statistics
   */
  getStats(): {
    pauseCount: number;
    totalPausedMs: number;
    currentlyPaused: boolean;
    currentPauseDurationMs: number;
  } {
    let currentPauseDurationMs = 0;
    if (this.paused && this.lastPauseTime) {
      currentPauseDurationMs = Date.now() - this.lastPauseTime.getTime();
    }

    return {
      pauseCount: this.pauseCount,
      totalPausedMs: this.totalPausedMs + currentPauseDurationMs,
      currentlyPaused: this.paused,
      currentPauseDurationMs,
    };
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.pauseCount = 0;
    this.totalPausedMs = 0;
    if (!this.paused) {
      this.lastPauseTime = null;
    }
  }

  /**
   * Toggle pause state
   *
   * @returns New pause state
   */
  toggle(): boolean {
    if (this.paused) {
      this.resume();
    } else {
      this.pause();
    }
    return this.paused;
  }

  /**
   * Create a new controller linked to this one
   *
   * Child controller is paused when parent is paused.
   */
  createLinkedController(): PauseController {
    const child = new PauseController();

    // Sync child with current state
    if (this.paused) {
      child.pause();
    }

    // Link future events
    this.onPause(() => child.pause());
    this.onResume(() => child.resume());

    return child;
  }
}

/**
 * Create a pause controller with abort signal integration
 *
 * The pause controller will auto-resume if the abort signal fires,
 * preventing deadlocks where a paused agent can't receive abort.
 */
export function createPauseControllerWithAbort(
  abortSignal: AbortSignal
): PauseController {
  const controller = new PauseController();

  // Auto-resume on abort to prevent deadlock
  abortSignal.addEventListener('abort', () => {
    if (controller.isPaused()) {
      controller.resume();
    }
  });

  return controller;
}

/**
 * Create a no-op pause controller
 *
 * Useful for sub-agents that shouldn't be pausable.
 */
export function createNonPausableController(): IPauseController {
  return {
    pause: () => {},
    resume: () => {},
    isPaused: () => false,
    waitIfPaused: async () => {},
  };
}
