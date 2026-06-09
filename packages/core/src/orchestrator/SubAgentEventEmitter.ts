/**
 * Sub-Agent Event Emitter
 *
 * Typed event emitter for sub-agent communication.
 * Provides real-time streaming of sub-agent activities to the parent
 * orchestrator and CLI components.
 *
 * @module orchestrator/SubAgentEventEmitter
 * @version 1.0.0
 */

import { EventEmitter } from 'events';
import type {
  SubAgentEvents,
  ISubAgentEventEmitter,
  SubAgentResult,
} from './SubAgentTypes.js';

/**
 * Typed event emitter for sub-agent events
 *
 * Extends Node's EventEmitter with type-safe event handling
 * for the sub-agent system.
 */
export class SubAgentEventEmitter extends EventEmitter implements ISubAgentEventEmitter {
  private activeAgentIds: Set<string> = new Set();
  private eventLog: Array<{ timestamp: Date; event: string; agentId: string }> = [];
  private maxLogSize: number = 1000;

  constructor() {
    super();
    // Set higher max listeners to support many concurrent agents
    this.setMaxListeners(50);
  }

  /**
   * Emit a typed event
   */
  emit<K extends keyof SubAgentEvents>(event: K, data: SubAgentEvents[K]): boolean {
    // Log event for debugging/monitoring
    const agentId = 'agentId' in data ? (data as { agentId: string }).agentId : 'unknown';
    this.logEvent(event, agentId);

    // Track agent lifecycle
    if (event === 'agent:started') {
      this.activeAgentIds.add(agentId);
    } else if (
      event === 'agent:completed' ||
      event === 'agent:error' ||
      event === 'agent:interrupted' ||
      event === 'agent:timeout'
    ) {
      this.activeAgentIds.delete(agentId);
    }

    return super.emit(event, data);
  }

  /**
   * Add a typed event listener
   */
  on<K extends keyof SubAgentEvents>(
    event: K,
    listener: (data: SubAgentEvents[K]) => void
  ): this {
    return super.on(event, listener);
  }

  /**
   * Add a one-time typed event listener
   */
  once<K extends keyof SubAgentEvents>(
    event: K,
    listener: (data: SubAgentEvents[K]) => void
  ): this {
    return super.once(event, listener);
  }

  /**
   * Remove a typed event listener
   */
  off<K extends keyof SubAgentEvents>(
    event: K,
    listener: (data: SubAgentEvents[K]) => void
  ): this {
    return super.off(event, listener);
  }

  // ─────────────────────────────────────────────────────────────────
  // Convenience Methods for Emitting Common Events
  // ─────────────────────────────────────────────────────────────────

  /**
   * Emit agent started event
   */
  emitStarted(
    agentId: string,
    agentName: string,
    model: string,
    task: string,
    parentSessionId: string
  ): void {
    this.emit('agent:started', {
      agentId,
      agentName,
      model,
      task,
      parentSessionId,
    });
  }

  /**
   * Emit progress update
   */
  emitProgress(
    agentId: string,
    turnNumber: number,
    totalTokens: number,
    elapsedMs: number
  ): void {
    this.emit('agent:progress', {
      agentId,
      turnNumber,
      totalTokens,
      elapsedMs,
    });
  }

  /**
   * Emit tool call event
   */
  emitToolCall(
    agentId: string,
    toolName: string,
    toolInput: Record<string, unknown>,
    toolId: string
  ): void {
    this.emit('agent:tool_call', {
      agentId,
      toolName,
      toolInput,
      toolId,
    });
  }

  /**
   * Emit tool result event
   */
  emitToolResult(
    agentId: string,
    toolName: string,
    toolId: string,
    success: boolean,
    summary: string,
    durationMs: number
  ): void {
    this.emit('agent:tool_result', {
      agentId,
      toolName,
      toolId,
      success,
      summary,
      durationMs,
    });
  }

  /**
   * Emit thinking text
   */
  emitThinking(agentId: string, thinkingText: string): void {
    this.emit('agent:thinking', {
      agentId,
      thinkingText,
    });
  }

  /**
   * Emit text output
   */
  emitText(agentId: string, text: string, isFinal: boolean = false): void {
    this.emit('agent:text', {
      agentId,
      text,
      isFinal,
    });
  }

  /**
   * Emit approval required event
   */
  emitApprovalRequired(
    agentId: string,
    agentName: string,
    toolName: string,
    toolInput: Record<string, unknown>,
    reason: string
  ): void {
    this.emit('agent:approval_required', {
      agentId,
      agentName,
      toolName,
      toolInput,
      reason,
    });
  }

  /**
   * Emit agent completed event
   */
  emitCompleted(agentId: string, result: SubAgentResult): void {
    this.emit('agent:completed', {
      agentId,
      result,
    });
  }

  /**
   * Emit error event
   */
  emitError(agentId: string, agentName: string, error: Error): void {
    this.emit('agent:error', {
      agentId,
      agentName,
      error,
    });
  }

  /**
   * Emit interrupted event
   */
  emitInterrupted(agentId: string, reason: string): void {
    this.emit('agent:interrupted', {
      agentId,
      reason,
    });
  }

  /**
   * Emit paused event
   */
  emitPaused(agentId: string): void {
    this.emit('agent:paused', { agentId });
  }

  /**
   * Emit resumed event
   */
  emitResumed(agentId: string): void {
    this.emit('agent:resumed', { agentId });
  }

  /**
   * Emit timeout event
   */
  emitTimeout(agentId: string, timeoutMs: number, elapsedMs: number): void {
    this.emit('agent:timeout', {
      agentId,
      timeoutMs,
      elapsedMs,
    });
  }

  // ─────────────────────────────────────────────────────────────────
  // State and Debugging
  // ─────────────────────────────────────────────────────────────────

  /**
   * Get currently active agent IDs
   */
  getActiveAgentIds(): string[] {
    return Array.from(this.activeAgentIds);
  }

  /**
   * Check if an agent is currently active
   */
  isAgentActive(agentId: string): boolean {
    return this.activeAgentIds.has(agentId);
  }

  /**
   * Get count of active agents
   */
  getActiveAgentCount(): number {
    return this.activeAgentIds.size;
  }

  /**
   * Get recent event log
   */
  getEventLog(limit: number = 100): Array<{ timestamp: Date; event: string; agentId: string }> {
    return this.eventLog.slice(-limit);
  }

  /**
   * Get event log filtered by agent
   */
  getAgentEventLog(
    agentId: string,
    limit: number = 100
  ): Array<{ timestamp: Date; event: string; agentId: string }> {
    return this.eventLog
      .filter((entry) => entry.agentId === agentId)
      .slice(-limit);
  }

  /**
   * Clear event log
   */
  clearEventLog(): void {
    this.eventLog = [];
  }

  /**
   * Log an event
   */
  private logEvent(event: string, agentId: string): void {
    this.eventLog.push({
      timestamp: new Date(),
      event,
      agentId,
    });

    // Trim log if it exceeds max size
    if (this.eventLog.length > this.maxLogSize) {
      this.eventLog = this.eventLog.slice(-Math.floor(this.maxLogSize / 2));
    }
  }

  /**
   * Subscribe to all events for a specific agent
   */
  subscribeToAgent(
    agentId: string,
    handlers: Partial<{
      [K in keyof SubAgentEvents]: (data: SubAgentEvents[K]) => void;
    }>
  ): () => void {
    const boundHandlers: Array<{ event: string; handler: (...args: unknown[]) => void }> = [];

    for (const [eventName, handler] of Object.entries(handlers)) {
      if (handler) {
        const filteredHandler = (data: { agentId: string }) => {
          if (data.agentId === agentId) {
            (handler as (data: unknown) => void)(data);
          }
        };
        this.on(eventName as keyof SubAgentEvents, filteredHandler as never);
        boundHandlers.push({ event: eventName, handler: filteredHandler as never });
      }
    }

    // Return unsubscribe function
    return () => {
      for (const { event, handler } of boundHandlers) {
        this.off(event as keyof SubAgentEvents, handler as never);
      }
    };
  }

  /**
   * Wait for an agent to complete
   */
  waitForCompletion(agentId: string, timeoutMs: number = 300000): Promise<SubAgentResult> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error(`Timeout waiting for agent ${agentId} to complete`));
      }, timeoutMs);

      const onCompleted = (data: SubAgentEvents['agent:completed']) => {
        if (data.agentId === agentId) {
          cleanup();
          resolve(data.result);
        }
      };

      const onError = (data: SubAgentEvents['agent:error']) => {
        if (data.agentId === agentId) {
          cleanup();
          reject(data.error);
        }
      };

      const onInterrupted = (data: SubAgentEvents['agent:interrupted']) => {
        if (data.agentId === agentId) {
          cleanup();
          reject(new Error(`Agent interrupted: ${data.reason}`));
        }
      };

      const onTimeout = (data: SubAgentEvents['agent:timeout']) => {
        if (data.agentId === agentId) {
          cleanup();
          reject(new Error(`Agent timed out after ${data.elapsedMs}ms`));
        }
      };

      const cleanup = () => {
        clearTimeout(timeout);
        this.off('agent:completed', onCompleted);
        this.off('agent:error', onError);
        this.off('agent:interrupted', onInterrupted);
        this.off('agent:timeout', onTimeout);
      };

      this.on('agent:completed', onCompleted);
      this.on('agent:error', onError);
      this.on('agent:interrupted', onInterrupted);
      this.on('agent:timeout', onTimeout);
    });
  }

  /**
   * Create a child emitter that prefixes events
   * Useful for nested sub-agents
   */
  createChildEmitter(_parentAgentId: string): SubAgentEventEmitter {
    const child = new SubAgentEventEmitter();

    // Forward all events to parent with context
    const events: (keyof SubAgentEvents)[] = [
      'agent:started',
      'agent:progress',
      'agent:tool_call',
      'agent:tool_result',
      'agent:thinking',
      'agent:text',
      'agent:approval_required',
      'agent:completed',
      'agent:error',
      'agent:interrupted',
      'agent:paused',
      'agent:resumed',
      'agent:timeout',
    ];

    for (const event of events) {
      child.on(event, (data: SubAgentEvents[typeof event]) => {
        // Emit to parent with nested agent context
        this.emit(event, data);
      });
    }

    return child;
  }
}

/**
 * Singleton instance for global event streaming
 */
let globalEmitter: SubAgentEventEmitter | null = null;

/**
 * Get the global sub-agent event emitter
 */
export function getGlobalSubAgentEmitter(): SubAgentEventEmitter {
  if (!globalEmitter) {
    globalEmitter = new SubAgentEventEmitter();
  }
  return globalEmitter;
}

/**
 * Reset the global emitter (mainly for testing)
 */
export function resetGlobalSubAgentEmitter(): void {
  if (globalEmitter) {
    globalEmitter.removeAllListeners();
  }
  globalEmitter = null;
}
