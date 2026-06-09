/**
 * Sub-Agent IPC Protocol
 *
 * Defines the message protocol for communication between parent
 * orchestrator and child sub-agent processes.
 *
 * Child processes are spawned via child_process.fork() and communicate
 * via Node.js IPC (process.send / process.on('message')).
 *
 * @module orchestrator/SubAgentIPC
 * @version 1.0.0
 */

import type { AgentDefinition, SubAgentResult } from './SubAgentTypes.js';
import type { ChildProcess, Serializable } from 'child_process';

// ============================================
// PARENT -> CHILD MESSAGES
// ============================================

/**
 * Message sent to child to start agent execution
 */
export interface IPCStartMessage {
  type: 'start';
  payload: {
    agentId: string;
    agentDefinition: AgentDefinition;
    taskPrompt: string;
    modelId: string;
    projectPath: string;
    timeoutMs: number;
    maxTurns: number;
    debug?: boolean;
  };
}

/**
 * Message sent to child to abort execution
 */
export interface IPCAbortMessage {
  type: 'abort';
  payload: {
    reason: string;
  };
}

/**
 * Message sent to child to pause execution
 */
export interface IPCPauseMessage {
  type: 'pause';
}

/**
 * Message sent to child to resume execution
 */
export interface IPCResumeMessage {
  type: 'resume';
}

/**
 * Message sent to child with guidance
 */
export interface IPCGuidanceMessage {
  type: 'guidance';
  payload: {
    message: string;
  };
}

/**
 * Message sent to child with permission decision from user
 */
export interface IPCPermissionResponseMessage {
  type: 'permission_response';
  payload: {
    requestId: string;
    approved: boolean;
    reason?: string;
  };
}

/**
 * All messages parent can send to child
 */
export type ParentToChildMessage =
  | IPCStartMessage
  | IPCAbortMessage
  | IPCPauseMessage
  | IPCResumeMessage
  | IPCGuidanceMessage
  | IPCPermissionResponseMessage;

// ============================================
// CHILD -> PARENT MESSAGES
// ============================================

/**
 * Child acknowledges it's ready to receive start message
 */
export interface IPCReadyMessage {
  type: 'ready';
  payload: {
    pid: number;
  };
}

/**
 * Child reports it has started execution
 */
export interface IPCStartedMessage {
  type: 'started';
  payload: {
    agentId: string;
    agentName: string;
    model: string;
  };
}

/**
 * Child reports progress
 */
export interface IPCProgressMessage {
  type: 'progress';
  payload: {
    agentId: string;
    turnNumber: number;
    totalTokens: number;
    elapsedMs: number;
  };
}

/**
 * Child reports a tool call
 */
export interface IPCToolCallMessage {
  type: 'tool_call';
  payload: {
    agentId: string;
    toolName: string;
    toolId: string;
    toolInput: Record<string, unknown>;
  };
}

/**
 * Child reports tool result
 */
export interface IPCToolResultMessage {
  type: 'tool_result';
  payload: {
    agentId: string;
    toolName: string;
    toolId: string;
    success: boolean;
    summary: string;
    durationMs: number;
  };
}

/**
 * Child reports thinking/reasoning
 */
export interface IPCThinkingMessage {
  type: 'thinking';
  payload: {
    agentId: string;
    text: string;
  };
}

/**
 * Child reports text output
 */
export interface IPCTextMessage {
  type: 'text';
  payload: {
    agentId: string;
    text: string;
    isFinal: boolean;
  };
}

/**
 * Child reports an error (non-fatal)
 */
export interface IPCErrorMessage {
  type: 'error';
  payload: {
    agentId: string;
    message: string;
    type: string;
    stack?: string;
  };
}

/**
 * Child reports completion with full result
 */
export interface IPCCompletedMessage {
  type: 'completed';
  payload: {
    agentId: string;
    result: SubAgentResult;
  };
}

/**
 * Child reports it was interrupted
 */
export interface IPCInterruptedMessage {
  type: 'interrupted';
  payload: {
    agentId: string;
    reason: string;
  };
}

/**
 * Child reports timeout
 */
export interface IPCTimeoutMessage {
  type: 'timeout';
  payload: {
    agentId: string;
    timeoutMs: number;
    elapsedMs: number;
  };
}

/**
 * Child reports a log message (for debugging)
 */
export interface IPCLogMessage {
  type: 'log';
  payload: {
    level: 'debug' | 'info' | 'warn' | 'error';
    message: string;
    data?: unknown;
  };
}

/**
 * Child requests permission approval from parent
 * Parent should display approval UI and send IPCPermissionResponseMessage back
 */
export interface IPCPermissionRequestMessage {
  type: 'permission_request';
  payload: {
    agentId: string;
    requestId: string;
    toolName: string;
    toolInput: Record<string, unknown>;
    reason: string;
    timestamp: string;
  };
}

/**
 * All messages child can send to parent
 */
export type ChildToParentMessage =
  | IPCReadyMessage
  | IPCStartedMessage
  | IPCProgressMessage
  | IPCToolCallMessage
  | IPCToolResultMessage
  | IPCThinkingMessage
  | IPCTextMessage
  | IPCErrorMessage
  | IPCCompletedMessage
  | IPCInterruptedMessage
  | IPCTimeoutMessage
  | IPCLogMessage
  | IPCPermissionRequestMessage;

// ============================================
// TYPE GUARDS
// ============================================

export function isParentToChildMessage(msg: unknown): msg is ParentToChildMessage {
  if (typeof msg !== 'object' || msg === null) return false;
  const m = msg as { type?: string };
  return ['start', 'abort', 'pause', 'resume', 'guidance', 'permission_response'].includes(m.type ?? '');
}

export function isChildToParentMessage(msg: unknown): msg is ChildToParentMessage {
  if (typeof msg !== 'object' || msg === null) return false;
  const m = msg as { type?: string };
  return [
    'ready', 'started', 'progress', 'tool_call', 'tool_result',
    'thinking', 'text', 'error', 'completed', 'interrupted', 'timeout', 'log',
    'permission_request'
  ].includes(m.type ?? '');
}

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Send message from parent to child
 */
export function sendToChild(
  childProcess: ChildProcess,
  message: ParentToChildMessage
): boolean {
  if (childProcess.send) {
    return childProcess.send(message as Serializable);
  }
  return false;
}

/**
 * Send message from child to parent (call from child process)
 */
export function sendToParent(message: ChildToParentMessage): boolean {
  if (process.send) {
    return process.send(message);
  }
  return false;
}

/**
 * Create a minimal SubAgentResult for error cases
 */
export function createErrorResult(
  agentId: string,
  agentName: string,
  model: string,
  error: Error,
  startTime: Date
): SubAgentResult {
  const endTime = new Date();
  return {
    agentId,
    agentName,
    model,
    startTime,
    endTime,
    durationMs: endTime.getTime() - startTime.getTime(),
    turnCount: 0,
    status: 'error',
    summary: `Agent failed: ${error.message}`,
    fullResponse: '',
    toolsUsed: [],
    filesRead: [],
    filesModified: [],
    cost: {
      inputTokens: 0,
      outputTokens: 0,
      estimatedCost: 0,
      cacheHits: 0,
    },
    error: {
      message: error.message,
      type: error.name,
      stack: error.stack,
    },
  };
}
