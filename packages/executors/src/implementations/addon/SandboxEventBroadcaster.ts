import { EventEmitter } from 'events';

/**
 * Event types emitted by sandboxes
 */
export type SandboxEventType =
  | 'sandbox-created'
  | 'sandbox-started'
  | 'sandbox-stopped'
  | 'file-changed'
  | 'console-log'
  | 'console-error'
  | 'console-warn'
  | 'network-request'
  | 'network-response'
  | 'screenshot-captured'
  | 'interaction-executed'
  | 'hot-reload-triggered'
  | 'process-restarted'
  | 'error-occurred';

/**
 * Base event structure
 */
export interface SandboxEvent {
  type: SandboxEventType;
  sandboxId: string;
  timestamp: number;
  data: any;
}

/**
 * SandboxEventBroadcaster - Centralized event system for sandbox operations
 *
 * This singleton class provides real-time event broadcasting for all sandbox operations.
 * It enables:
 * - User real-time monitoring via WebSocket connections
 * - Model observability of sandbox state changes
 * - Debugging and audit trails
 * - Multi-sandbox coordination
 *
 * Event Flow:
 * 1. Tool (CreateAddon, Modify, Interact) emits event → broadcaster.emit()
 * 2. Broadcaster stores event in history
 * 3. Broadcaster notifies all listeners (WebSocket, logs, etc.)
 * 4. User sees update in dashboard
 *
 * Example Usage:
 * ```
 * // In CreateAddonToolEnhanced
 * broadcaster.emit({
 *   type: 'sandbox-created',
 *   sandboxId: session.id,
 *   timestamp: Date.now(),
 *   data: { name: session.name, url: session.url }
 * });
 *
 * // In SandboxViewServer
 * broadcaster.on('console-log', (event) => {
 *   io.to(event.sandboxId).emit('console-log', event.data);
 * });
 * ```
 */
export class SandboxEventBroadcaster extends EventEmitter {
  private static instance: SandboxEventBroadcaster;

  /**
   * Event history (last 1000 events per sandbox)
   */
  private eventHistory: Map<string, SandboxEvent[]> = new Map();

  /**
   * Maximum events to keep per sandbox
   */
  private readonly MAX_EVENTS_PER_SANDBOX = 1000;

  private constructor() {
    super();
    this.setMaxListeners(100); // Support many WebSocket connections
  }

  /**
   * Get singleton instance
   */
  static getInstance(): SandboxEventBroadcaster {
    if (!SandboxEventBroadcaster.instance) {
      SandboxEventBroadcaster.instance = new SandboxEventBroadcaster();
    }
    return SandboxEventBroadcaster.instance;
  }

  /**
   * Emit a sandbox event
   */
  emitSandboxEvent(event: SandboxEvent): void {
    // Store in history
    this.addToHistory(event);

    // Emit to all listeners
    this.emit(event.type, event);
    this.emit('*', event); // Wildcard listener

    // Also emit sandbox-specific event for filtering
    this.emit(`sandbox:${event.sandboxId}`, event);
  }

  /**
   * Add event to history
   */
  private addToHistory(event: SandboxEvent): void {
    if (!this.eventHistory.has(event.sandboxId)) {
      this.eventHistory.set(event.sandboxId, []);
    }

    const history = this.eventHistory.get(event.sandboxId)!;
    history.push(event);

    // Trim if exceeds max
    if (history.length > this.MAX_EVENTS_PER_SANDBOX) {
      history.shift();
    }
  }

  /**
   * Get event history for a sandbox
   */
  getHistory(sandboxId: string, limit?: number): SandboxEvent[] {
    const history = this.eventHistory.get(sandboxId) || [];

    if (limit) {
      return history.slice(-limit);
    }

    return [...history];
  }

  /**
   * Get all sandbox IDs with events
   */
  getActiveSandboxes(): string[] {
    return Array.from(this.eventHistory.keys());
  }

  /**
   * Clear history for a sandbox
   */
  clearHistory(sandboxId: string): void {
    this.eventHistory.delete(sandboxId);
  }

  /**
   * Clear all history
   */
  clearAllHistory(): void {
    this.eventHistory.clear();
  }

  /**
   * Helper: Emit console log
   */
  emitConsoleLog(sandboxId: string, level: 'log' | 'error' | 'warn', message: string): void {
    this.emitSandboxEvent({
      type: `console-${level}` as SandboxEventType,
      sandboxId,
      timestamp: Date.now(),
      data: { level, message }
    });
  }

  /**
   * Helper: Emit file change
   */
  emitFileChange(sandboxId: string, filePath: string, changeType: 'created' | 'modified' | 'deleted'): void {
    this.emitSandboxEvent({
      type: 'file-changed',
      sandboxId,
      timestamp: Date.now(),
      data: { filePath, changeType }
    });
  }

  /**
   * Helper: Emit screenshot
   */
  emitScreenshot(sandboxId: string, screenshot: string, url: string): void {
    this.emitSandboxEvent({
      type: 'screenshot-captured',
      sandboxId,
      timestamp: Date.now(),
      data: { screenshot, url }
    });
  }

  /**
   * Helper: Emit network request
   */
  emitNetworkRequest(sandboxId: string, method: string, url: string, status?: number): void {
    this.emitSandboxEvent({
      type: status ? 'network-response' : 'network-request',
      sandboxId,
      timestamp: Date.now(),
      data: { method, url, status }
    });
  }

  /**
   * Helper: Emit interaction
   */
  emitInteraction(sandboxId: string, actionType: string, selector?: string, success: boolean = true): void {
    this.emitSandboxEvent({
      type: 'interaction-executed',
      sandboxId,
      timestamp: Date.now(),
      data: { actionType, selector, success }
    });
  }

  /**
   * Helper: Emit hot reload
   */
  emitHotReload(sandboxId: string, fileName: string): void {
    this.emitSandboxEvent({
      type: 'hot-reload-triggered',
      sandboxId,
      timestamp: Date.now(),
      data: { fileName }
    });
  }

  /**
   * Helper: Emit process restart
   */
  emitProcessRestart(sandboxId: string, reason: string): void {
    this.emitSandboxEvent({
      type: 'process-restarted',
      sandboxId,
      timestamp: Date.now(),
      data: { reason }
    });
  }

  /**
   * Helper: Emit error
   */
  emitError(sandboxId: string, error: Error | string): void {
    this.emitSandboxEvent({
      type: 'error-occurred',
      sandboxId,
      timestamp: Date.now(),
      data: {
        message: typeof error === 'string' ? error : error.message,
        stack: typeof error === 'string' ? undefined : error.stack
      }
    });
  }

  /**
   * Subscribe to all events for a specific sandbox
   */
  subscribeToSandbox(sandboxId: string, callback: (event: SandboxEvent) => void): () => void {
    const listener = (event: SandboxEvent) => callback(event);
    this.on(`sandbox:${sandboxId}`, listener);

    // Return unsubscribe function
    return () => {
      this.off(`sandbox:${sandboxId}`, listener);
    };
  }

  /**
   * Subscribe to specific event type
   */
  subscribeToEventType(eventType: SandboxEventType, callback: (event: SandboxEvent) => void): () => void {
    const listener = (event: SandboxEvent) => callback(event);
    this.on(eventType, listener);

    // Return unsubscribe function
    return () => {
      this.off(eventType, listener);
    };
  }

  /**
   * Subscribe to all events
   */
  subscribeToAll(callback: (event: SandboxEvent) => void): () => void {
    const listener = (event: SandboxEvent) => callback(event);
    this.on('*', listener);

    // Return unsubscribe function
    return () => {
      this.off('*', listener);
    };
  }

  /**
   * Get event statistics
   */
  getStats(): {
    activeSandboxes: number;
    totalEvents: number;
    eventsByType: Record<string, number>;
  } {
    let totalEvents = 0;
    const eventsByType: Record<string, number> = {};

    for (const history of this.eventHistory.values()) {
      totalEvents += history.length;

      for (const event of history) {
        eventsByType[event.type] = (eventsByType[event.type] || 0) + 1;
      }
    }

    return {
      activeSandboxes: this.eventHistory.size,
      totalEvents,
      eventsByType
    };
  }
}

/**
 * Export singleton instance
 */
export const broadcaster = SandboxEventBroadcaster.getInstance();
