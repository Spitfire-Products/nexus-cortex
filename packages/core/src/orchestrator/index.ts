/**
 * Orchestrator module
 * Coordinates all Claude CLI systems together
 */

export * from './CortexOrchestrator.js';
export * from './OrchestratorFactory.js';
export * from './APIClient.js';

// Sub-Agent System (Phase 2 - Task Agent Implementation)
export * from './SubAgentTypes.js';
export * from './SubAgentEventEmitter.js';
export * from './SubAgentPermissionChecker.js';
export * from './SubAgentOrchestrator.js';
export * from './SubAgentManager.js';
export * from './PauseController.js';

// Sub-Agent Process System (true parallelism via child processes)
export * from './SubAgentProcessManager.js';
export * from './SubAgentIPC.js';

// Re-export types for convenience
export type {
  OrchestratorConfig,
  SendMessageOptions,
  OrchestratorResponse,
  Session,
  SubAgentEvent,
  SubAgentEventType,
  SubAgentEventCallback,
} from './CortexOrchestrator.js';

export type {
  StreamChunk,
  StreamingResponse
} from './APIClient.js';

// Sub-Agent Types re-export
export type {
  AgentDefinition,
  SubAgentConfig,
  SubAgentContext,
  SubAgentResult,
  SubAgentEvents,
  ISubAgentManager,
  ISubAgentEventEmitter,
  IPauseController,
  SpawnAgentOptions,
  ToolUsageSummary,
  SubAgentCostMetrics,
  SubAgentErrorDetails,
  SubAgentArtifact,
} from './SubAgentTypes.js';

// Sub-Agent IPC Types re-export
export type {
  ParentToChildMessage,
  ChildToParentMessage,
  IPCStartMessage,
  IPCAbortMessage,
  IPCCompletedMessage,
  IPCProgressMessage,
  IPCToolCallMessage,
  IPCTextMessage,
  IPCErrorMessage,
  IPCPermissionRequestMessage,
  IPCPermissionResponseMessage,
} from './SubAgentIPC.js';
