/**
 * Runtime-Agnostic Interfaces
 *
 * These 6 interfaces define the I/O boundary of the Cortex orchestrator.
 * By abstracting these boundaries, the orchestrator can run in both
 * Node.js (current) and browser (future) environments.
 *
 * Node.js implementations wrap existing services (APIClient, JSONLHistoryStore, etc.).
 * Browser implementations use fetch(), IndexedDB, DOM APIs, etc.
 *
 * @module interfaces
 */

export type { APITransport, APIResponse, StreamChunk, StreamingResponse, PreparedRequest } from './APITransport.js';
export type { HistoryStore, SessionInfo } from './HistoryStore.js';
export type { CredentialResolver, CredentialResult, AuthMethod } from './CredentialResolver.js';
export type { ConfigProvider } from './ConfigProvider.js';
export type {
  ToolExecutorRegistry,
  ToolExecutor,
  ToolResult,
  ToolCallConfirmationDetails,
  ToolDefinition
} from './ToolExecutorRegistry.js';
export type {
  PermissionHandler,
  PermissionDecision,
  PermissionPolicy
} from './PermissionHandler.js';
