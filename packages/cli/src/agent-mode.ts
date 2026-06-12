#!/usr/bin/env node
/**
 * Agent Mode Entry Point
 *
 * This module is executed when the CLI is spawned as a sub-agent child process.
 * It receives configuration via IPC, runs the agent task autonomously, and
 * streams progress/results back to the parent process.
 *
 * Usage: This file is NOT called directly. It's spawned by SubAgentProcessManager
 * via child_process.fork().
 *
 * Communication:
 * - Parent sends IPCStartMessage to begin execution
 * - Child streams IPCProgressMessage, IPCToolCallMessage, etc.
 * - Child sends IPCCompletedMessage when done
 *
 * @module cli/agent-mode
 * @version 1.0.0
 */

import {
  sendToParent,
  createErrorResult,
  IPCApprovalHandler,
  createOrchestrator,
} from '@nexus-cortex/core';
import type {
  OrchestratorConfig,
  CortexOrchestrator,
  ParentToChildMessage,
  IPCStartMessage,
  IPCPermissionResponseMessage,
  AgentDefinition,
  SubAgentResult,
  ToolUsageSummary,
} from '@nexus-cortex/core';

// ============================================
// STATE
// ============================================

let orchestrator: CortexOrchestrator | null = null;
let ipcApprovalHandler: IPCApprovalHandler | null = null;
let agentId: string = '';
let agentName: string = '';
let modelId: string = '';
let startTime: Date = new Date();
let abortRequested: boolean = false;
let pauseRequested: boolean = false;

// Guidance queue for cross-agent communication
let pendingGuidance: string[] = [];

// Tracking
let turnCount: number = 0;
let inputTokens: number = 0;
let outputTokens: number = 0;
let cacheHits: number = 0;
const toolUsage: Map<string, ToolUsageSummary> = new Map();
const filesRead: Set<string> = new Set();
const filesModified: Set<string> = new Set();
const responseParts: string[] = [];

// ============================================
// IPC MESSAGE HANDLING
// ============================================

/**
 * Handle messages from parent process
 */
process.on('message', async (message: ParentToChildMessage) => {
  try {
    switch (message.type) {
      case 'start':
        await handleStart(message);
        break;

      case 'abort':
        handleAbort(message.payload.reason);
        break;

      case 'pause':
        pauseRequested = true;
        log('info', 'Pause requested');
        break;

      case 'resume':
        pauseRequested = false;
        log('info', 'Resume requested');
        break;

      case 'guidance':
        log('info', `Guidance received: ${message.payload.message}`);
        pendingGuidance.push(message.payload.message);
        // Inject guidance into orchestrator using the same dual-path as mentorship thinking injection.
        // For thinking-capable APIs → thinking block; for others → <system-reminder> text.
        // The message is ephemeral (cleaned up after current turn).
        if (orchestrator) {
          orchestrator.injectGuidance(message.payload.message, 'team_update');
        }
        break;

      case 'permission_response':
        // Forward permission response to the IPC approval handler
        if (ipcApprovalHandler) {
          ipcApprovalHandler.handleResponse(message as IPCPermissionResponseMessage);
        }
        break;

      default:
        log('warn', `Unknown message type: ${(message as { type: string }).type}`);
    }
  } catch (error) {
    log('error', `Error handling message: ${error}`);
  }
});

/**
 * Handle start message - begin agent execution
 */
async function handleStart(message: IPCStartMessage): Promise<void> {
  const { payload } = message;

  agentId = payload.agentId;
  agentName = payload.agentDefinition.name;
  modelId = payload.modelId;
  startTime = new Date();

  log('info', `Starting agent: ${agentName} (${agentId})`);

  try {
    // Create IPC approval handler - forwards permission requests to parent process
    // This ensures sub-agents have the same permission harness as the main model
    ipcApprovalHandler = new IPCApprovalHandler({
      agentId,
      timeoutMs: 300000, // 5 minute timeout for user approval
      debug: payload.debug ?? false,
    });
    log('info', 'IPC approval handler created - permissions will be forwarded to parent');

    // Create orchestrator for this agent.
    // MCP is off by default but Browse subagents override MCP_AUTO_INJECT=true
    // via envOverrides — honour that so they get nexus-browser tools.
    const enableMcp = process.env.MCP_AUTO_INJECT === 'true';
    // Enforce the agent definition's tool whitelist on the model-facing BASE
    // tools. A declared `tools` array (e.g. browse-agent's [Read,Grep,Glob,
    // Todo*]) restricts the base set so the sub-agent can't fall back to
    // WebFetch/WebSearch/Browse — it must use its injected MCP tools. `'all'`
    // or an omitted list leaves all base tools available (no restriction).
    const agentTools = payload.agentDefinition.tools;
    const allowedBaseTools = Array.isArray(agentTools) ? agentTools : undefined;
    const config: OrchestratorConfig = {
      defaultModelId: payload.modelId,
      projectPath: payload.projectPath,
      autoCompact: true,
      useHelperModels: true,
      enableTimeline: false,
      debug: payload.debug ?? false,
      enableMcp,
      allowedBaseTools,
    };

    // Create orchestrator with permissions enabled
    // We'll replace the approval handler after creation
    orchestrator = await createOrchestrator(config, {
      enablePermissions: true,
      permissionMode: 'interactive', // Use interactive mode with our IPC handler
    });

    // Create session
    await orchestrator.createSession(payload.projectPath, payload.modelId);

    // Replace the approval handler with our IPC-based one
    // This forwards all permission requests to the parent process
    orchestrator.setApprovalHandler(ipcApprovalHandler);
    log('info', 'Sub-agent permissions configured - requests will be forwarded to parent for user approval');

    // Notify parent we've started
    sendToParent({
      type: 'started',
      payload: {
        agentId,
        agentName,
        model: modelId,
      },
    });

    // Build the full prompt with agent's system context
    const fullPrompt = buildAgentPrompt(payload.agentDefinition, payload.taskPrompt);

    // Execute with timeout
    const result = await executeWithTimeout(
      fullPrompt,
      payload.timeoutMs,
      payload.maxTurns
    );

    // Send completion
    sendToParent({
      type: 'completed',
      payload: {
        agentId,
        result,
      },
    });

  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    log('error', `Agent execution failed: ${err.message}`);

    sendToParent({
      type: 'error',
      payload: {
        agentId,
        message: err.message,
        type: err.name,
        stack: err.stack,
      },
    });

    // Send error result
    sendToParent({
      type: 'completed',
      payload: {
        agentId,
        result: createErrorResult(agentId, agentName, modelId, err, startTime),
      },
    });
  } finally {
    // Exit cleanly
    setTimeout(() => process.exit(0), 100);
  }
}

/**
 * Handle abort request
 */
function handleAbort(reason: string): void {
  log('info', `Abort requested: ${reason}`);
  abortRequested = true;

  sendToParent({
    type: 'interrupted',
    payload: {
      agentId,
      reason,
    },
  });
}

// ============================================
// EXECUTION
// ============================================

/**
 * Build the full prompt including agent's system context
 */
function buildAgentPrompt(_agentDef: AgentDefinition, taskPrompt: string): string {
  // The agent's system prompt is injected via orchestrator config
  // Here we just return the task
  return taskPrompt;
}

/**
 * Execute the agent task with timeout
 */
async function executeWithTimeout(
  prompt: string,
  timeoutMs: number,
  _maxTurns: number
): Promise<SubAgentResult> {
  const timeoutPromise = new Promise<'timeout'>((resolve) => {
    setTimeout(() => resolve('timeout'), timeoutMs);
  });

  const executionPromise = executeTask(prompt);

  const result = await Promise.race([executionPromise, timeoutPromise]);

  if (result === 'timeout') {
    const elapsed = Date.now() - startTime.getTime();
    sendToParent({
      type: 'timeout',
      payload: {
        agentId,
        timeoutMs,
        elapsedMs: elapsed,
      },
    });

    return buildResult('timeout');
  }

  return result;
}

/**
 * Execute the task using orchestrator with streaming for real-time updates
 */
async function executeTask(prompt: string): Promise<SubAgentResult> {
  if (!orchestrator) {
    throw new Error('Orchestrator not initialized');
  }

  // Check for abort before starting
  if (abortRequested) {
    return buildResult('interrupted');
  }

  // Wait if paused
  while (pauseRequested && !abortRequested) {
    await sleep(100);
  }

  if (abortRequested) {
    return buildResult('interrupted');
  }

  // Start progress heartbeat - sends updates every second during execution
  const heartbeatInterval = setInterval(() => {
    sendToParent({
      type: 'progress',
      payload: {
        agentId,
        turnNumber: turnCount,
        totalTokens: inputTokens + outputTokens,
        elapsedMs: Date.now() - startTime.getTime(),
      },
    });
  }, 1000);

  // Send initial "working" indicator
  sendToParent({
    type: 'tool_call',
    payload: {
      agentId,
      toolName: 'thinking',
      toolId: 'init',
      toolInput: { status: 'Processing request...' },
    },
  });

  let accumulatedText = '';

  try {
    // Per-subagent sampling temperature: set by the PM's Task dispatch via envOverrides →
    // CORTEX_SUBAGENT_TEMPERATURE (a parallel-arm diversity lever). The APIClient clamps it to
    // the chosen model's valid range; here we just forward it as a request parameter.
    const subTemp = process.env.CORTEX_SUBAGENT_TEMPERATURE !== undefined
      ? Number(process.env.CORTEX_SUBAGENT_TEMPERATURE) : NaN;
    const streamOpts = Number.isFinite(subTemp) ? { parameters: { temperature: subTemp } } : undefined;

    // Use streaming to get real-time tool call updates
    const stream = orchestrator.streamMessage(prompt, streamOpts);

    for await (const chunk of stream) {
      // Check for abort during streaming
      if (abortRequested) {
        return buildResult('interrupted');
      }

      switch (chunk.type) {
        case 'content_block_start':
          // Tool use blocks are handled at tool_use_complete (with full input)
          break;

        case 'tool_use_complete':
          // Tool use block is complete with full input
          // Structure: chunk.toolUse contains the canonical tool use info
          const toolUse = (chunk as any).toolUse;
          if (toolUse) {
            // trackToolUsage sends the tool_call IPC message
            trackToolUsage({
              id: toolUse.id,
              name: toolUse.name,
              input: toolUse.input,
            });
          }
          break;

        case 'tool_result':
          // Tool execution completed
          turnCount++;
          break;

        case 'text_delta':
        case 'content_block_delta':
          // Accumulate text
          if (chunk.delta) {
            accumulatedText += chunk.delta;
          }
          break;

        case 'thinking_delta':
          // Thinking content - could show as progress
          break;

        case 'message_start': {
          // Anthropic: event.message.usage.input_tokens
          const startUsage = (chunk.data as any)?.message?.usage;
          if (startUsage) {
            inputTokens += startUsage.input_tokens || 0;
          }
          break;
        }

        case 'message_delta': {
          // Anthropic: event.usage.output_tokens
          const deltaUsage = (chunk.data as any)?.usage;
          if (deltaUsage) {
            outputTokens += deltaUsage.output_tokens || 0;
            if (deltaUsage.cache_read_input_tokens) {
              cacheHits++;
            }
          }
          break;
        }

        case 'message_stop': {
          // OpenAI/XAI: usage on final chunk data
          const stopUsage = (chunk.data as any)?.usage;
          if (stopUsage) {
            inputTokens += stopUsage.prompt_tokens || stopUsage.input_tokens || 0;
            outputTokens += stopUsage.completion_tokens || stopUsage.output_tokens || 0;
          }
          break;
        }
      }
    }

    // Store accumulated text
    if (accumulatedText) {
      responseParts.push(accumulatedText);
      sendToParent({
        type: 'text',
        payload: {
          agentId,
          text: accumulatedText,
          isFinal: true,
        },
      });
    }

    // Send final progress
    sendToParent({
      type: 'progress',
      payload: {
        agentId,
        turnNumber: turnCount,
        totalTokens: inputTokens + outputTokens,
        elapsedMs: Date.now() - startTime.getTime(),
      },
    });

    return buildResult('completed');
  } finally {
    // Always stop the heartbeat
    clearInterval(heartbeatInterval);
  }
}

/**
 * Track tool usage from response
 */
function trackToolUsage(toolUse: unknown): void {
  if (typeof toolUse !== 'object' || toolUse === null) return;

  const tu = toolUse as { name?: string; input?: Record<string, unknown>; id?: string };
  const toolName = tu.name ?? 'unknown';

  // Update usage stats
  const existing = toolUsage.get(toolName) ?? {
    name: toolName,
    callCount: 0,
    totalDuration: 0,
    errors: 0,
  };

  existing.callCount++;
  toolUsage.set(toolName, existing);

  // Track file operations
  if (tu.input) {
    const filePath = tu.input.file_path as string | undefined;
    if (filePath) {
      const lowerName = toolName.toLowerCase();
      if (lowerName === 'read' || lowerName === 'glob' || lowerName === 'grep') {
        filesRead.add(filePath);
      } else if (lowerName === 'write' || lowerName === 'edit') {
        filesModified.add(filePath);
      }
    }
  }

  // Emit tool call event
  sendToParent({
    type: 'tool_call',
    payload: {
      agentId,
      toolName,
      toolId: tu.id ?? 'unknown',
      toolInput: tu.input ?? {},
    },
  });
}

/**
 * Build the final result
 */
function buildResult(status: SubAgentResult['status']): SubAgentResult {
  const endTime = new Date();
  const durationMs = endTime.getTime() - startTime.getTime();

  // Estimate cost (Claude Sonnet rates)
  const inputRate = 3.0 / 1_000_000;
  const outputRate = 15.0 / 1_000_000;
  const estimatedCost = inputTokens * inputRate + outputTokens * outputRate;

  // Build summary
  const summaryParts: string[] = [];
  summaryParts.push(`Agent "${agentName}" ${status}`);
  if (turnCount > 0) summaryParts.push(`${turnCount} turn(s)`);
  if (toolUsage.size > 0) summaryParts.push(`Tools: ${Array.from(toolUsage.keys()).join(', ')}`);
  if (filesModified.size > 0) summaryParts.push(`Modified ${filesModified.size} file(s)`);

  const lastResponse = responseParts[responseParts.length - 1] ?? '';
  if (lastResponse) {
    const snippet = lastResponse.length > 500 ? lastResponse.slice(0, 500) + '...' : lastResponse;
    summaryParts.push(`\nFinal: ${snippet}`);
  }

  return {
    agentId,
    agentName,
    model: modelId,
    startTime,
    endTime,
    durationMs,
    turnCount,
    status,
    summary: summaryParts.join('. '),
    fullResponse: responseParts.join('\n\n'),
    toolsUsed: Array.from(toolUsage.values()),
    filesRead: Array.from(filesRead),
    filesModified: Array.from(filesModified),
    cost: {
      inputTokens,
      outputTokens,
      estimatedCost,
      cacheHits,
    },
  };
}

// ============================================
// UTILITIES
// ============================================

function log(level: 'debug' | 'info' | 'warn' | 'error', message: string, data?: unknown): void {
  sendToParent({
    type: 'log',
    payload: { level, message, data },
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================
// INITIALIZATION
// ============================================

// Signal to parent that we're ready
sendToParent({
  type: 'ready',
  payload: {
    pid: process.pid,
  },
});

log('info', `Agent process started (PID: ${process.pid})`);

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  log('error', `Uncaught exception: ${error.message}`, { stack: error.stack });
  sendToParent({
    type: 'error',
    payload: {
      agentId: agentId || 'unknown',
      message: error.message,
      type: error.name,
      stack: error.stack,
    },
  });
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  log('error', `Unhandled rejection: ${message}`);
});
