/**
 * Screen Stream
 *
 * Continuous screenshot capture and streaming
 * Enables real-time monitoring of browser/terminal state
 *
 * Features:
 * - Configurable FPS (default: 2)
 * - Event-based streaming
 * - Automatic cleanup
 * - Pause/resume support
 */

import { EventEmitter } from 'events';
import { Page } from 'playwright';
import { HybridScreenshotManager, HybridManagerConfig } from './HybridScreenshotManager.js';

export interface ScreenStreamConfig {
  fps?: number;              // Frames per second (default: 2)
  quality?: number;          // JPEG quality 0-100 (default: 80)
  format?: 'png' | 'jpeg';   // Image format (default: 'png')
  fullPage?: boolean;        // Capture full page or viewport (default: false)

  // Hybrid mode (H.264 + smart keyframes)
  enableHybridMode?: boolean;        // Use HybridScreenshotManager (default: false)
  hybridConfig?: HybridManagerConfig; // Hybrid manager configuration
}

export interface ScreenFrame {
  screenshot: Buffer;        // Image data
  timestamp: number;         // Capture timestamp
  frameNumber: number;       // Sequential frame number
}

/**
 * ScreenStream - Continuous screenshot streaming
 *
 * Captures screenshots at regular intervals and emits them as events.
 * Can be used to create live video feeds of browser/terminal sessions.
 *
 * @example
 * const stream = new ScreenStream(page, { fps: 2 });
 * stream.on('frame', (frame) => {
 *   console.log(`Frame ${frame.frameNumber} captured`);
 *   // Send to WebSocket clients, save to disk, etc.
 * });
 * stream.start();
 */
export class ScreenStream extends EventEmitter {
  private page: Page;
  private config: Required<ScreenStreamConfig>;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private frameNumber: number = 0;
  private isRunning: boolean = false;
  private hybridManager: HybridScreenshotManager | null = null;

  constructor(page: Page, config: ScreenStreamConfig = {}) {
    super();

    this.page = page;
    this.config = {
      fps: config.fps ?? 2,
      quality: config.quality ?? 80,
      format: config.format ?? 'png',
      fullPage: config.fullPage ?? false,
      enableHybridMode: config.enableHybridMode ?? false,
      hybridConfig: config.hybridConfig ?? {}
    };
  }

  /**
   * Start capturing and streaming screenshots
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      console.warn('ScreenStream already running');
      return;
    }

    this.isRunning = true;
    this.frameNumber = 0;

    // Use hybrid mode if enabled
    if (this.config.enableHybridMode) {
      await this.startHybridMode();
    } else {
      this.startSimpleMode();
    }

    this.emit('start', { fps: this.config.fps, mode: this.config.enableHybridMode ? 'hybrid' : 'simple' });
  }

  /**
   * Start simple mode (original behavior)
   */
  private startSimpleMode(): void {
    const interval = 1000 / this.config.fps; // Convert FPS to milliseconds

    this.intervalId = setInterval(async () => {
      try {
        await this.captureFrame();
      } catch (error) {
        this.emit('error', error);
      }
    }, interval);
  }

  /**
   * Start hybrid mode (H.264 + smart keyframes)
   */
  private async startHybridMode(): Promise<void> {
    const hybridConfig = {
      ...this.config.hybridConfig,
      h264: {
        fps: this.config.fps,
        ...this.config.hybridConfig?.h264
      },
      screenshotFormat: this.config.format,
      screenshotQuality: this.config.quality
    };

    this.hybridManager = new HybridScreenshotManager(this.page, hybridConfig);

    // Forward H.264 segments as frames
    this.hybridManager.on('h264-segment', (segment) => {
      this.frameNumber++;
      const frame: ScreenFrame = {
        screenshot: segment.data,
        timestamp: segment.timestamp,
        frameNumber: this.frameNumber
      };
      this.emit('frame', frame);
    });

    // Forward API frames as high-priority frames
    this.hybridManager.on('api-frame', (request) => {
      this.emit('api-frame', request);
    });

    // Forward cached frames
    this.hybridManager.on('cached-frame', (data) => {
      this.emit('cached-frame', data);
    });

    // Forward errors
    this.hybridManager.on('error', (error) => {
      this.emit('error', error);
    });

    await this.hybridManager.start();
  }

  /**
   * Stop capturing screenshots
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    if (this.hybridManager) {
      this.hybridManager.stop();
    }

    this.isRunning = false;
    this.emit('stop', { totalFrames: this.frameNumber });
  }

  /**
   * Pause screenshot capture (can be resumed)
   */
  pause(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    this.isRunning = false;
    this.emit('pause');
  }

  /**
   * Resume screenshot capture after pause
   */
  resume(): void {
    this.start();
    this.emit('resume');
  }

  /**
   * Capture a single frame
   */
  private async captureFrame(): Promise<void> {
    const screenshot = await this.page.screenshot({
      type: this.config.format,
      quality: this.config.format === 'jpeg' ? this.config.quality : undefined,
      fullPage: this.config.fullPage
    });

    this.frameNumber++;

    const frame: ScreenFrame = {
      screenshot,
      timestamp: Date.now(),
      frameNumber: this.frameNumber
    };

    this.emit('frame', frame);
  }

  /**
   * Get current configuration
   */
  getConfig(): Required<ScreenStreamConfig> {
    return { ...this.config };
  }

  /**
   * Update configuration (requires restart to take effect)
   */
  setConfig(config: Partial<ScreenStreamConfig>): void {
    this.config = {
      ...this.config,
      ...config
    };

    // If running, restart with new config
    if (this.isRunning) {
      this.stop();
      this.start();
    }
  }

  /**
   * Get current state
   */
  getState(): {
    isRunning: boolean;
    frameNumber: number;
    fps: number;
  } {
    return {
      isRunning: this.isRunning,
      frameNumber: this.frameNumber,
      fps: this.config.fps
    };
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    this.stop();

    if (this.hybridManager) {
      this.hybridManager.destroy();
      this.hybridManager = null;
    }

    this.removeAllListeners();
  }

  /**
   * Get hybrid manager (if enabled)
   */
  getHybridManager(): HybridScreenshotManager | null {
    return this.hybridManager;
  }

  /**
   * Get hybrid statistics (if hybrid mode enabled)
   */
  getHybridStats() {
    return this.hybridManager?.getStats() ?? null;
  }

  /**
   * Trigger manual keyframe (if hybrid mode enabled)
   */
  async triggerKeyframe(reason: string, metadata?: Record<string, any>): Promise<void> {
    if (this.hybridManager) {
      await this.hybridManager.triggerKeyframe(reason, metadata);
    }
  }
}

/**
 * ScreenStreamManager - Manage multiple streams
 *
 * Useful for multi-window scenarios where you want to
 * stream multiple browser/terminal sessions simultaneously
 */
export class ScreenStreamManager extends EventEmitter {
  private streams: Map<string, ScreenStream> = new Map();

  /**
   * Create and start a new stream
   */
  createStream(id: string, page: Page, config?: ScreenStreamConfig): ScreenStream {
    if (this.streams.has(id)) {
      throw new Error(`Stream with id "${id}" already exists`);
    }

    const stream = new ScreenStream(page, config);

    // Forward frame events with stream ID
    stream.on('frame', (frame) => {
      this.emit('frame', { streamId: id, frame });
    });

    stream.on('error', (error) => {
      this.emit('error', { streamId: id, error });
    });

    this.streams.set(id, stream);

    return stream;
  }

  /**
   * Get stream by ID
   */
  getStream(id: string): ScreenStream | undefined {
    return this.streams.get(id);
  }

  /**
   * Remove and destroy stream
   */
  removeStream(id: string): void {
    const stream = this.streams.get(id);
    if (stream) {
      stream.destroy();
      this.streams.delete(id);
    }
  }

  /**
   * Start all streams
   */
  startAll(): void {
    this.streams.forEach((stream) => stream.start());
  }

  /**
   * Stop all streams
   */
  stopAll(): void {
    this.streams.forEach((stream) => stream.stop());
  }

  /**
   * Get all stream states
   */
  getStates(): Record<string, ReturnType<ScreenStream['getState']>> {
    const states: Record<string, ReturnType<ScreenStream['getState']>> = {};

    this.streams.forEach((stream, id) => {
      states[id] = stream.getState();
    });

    return states;
  }

  /**
   * Cleanup all streams
   */
  destroy(): void {
    this.streams.forEach((stream) => stream.destroy());
    this.streams.clear();
    this.removeAllListeners();
  }
}
