/**
 * Utility Functions
 */

export * from './SchemaValidator.js';
export * from './FileUtils.js';
export { TmuxManager, TMUX_SEND_KEYS_MAX_CHARS, needsPasteBuffer } from './TmuxManager.js';
export type { TmuxSessionMetadata, TmuxExecFn, TmuxExecResult, TmuxSendOptions } from './TmuxManager.js';
export {
  HerdrTerminalBackend,
  TmuxTerminalBackend,
  DetachedTerminalBackend,
  resolveTerminalBackend,
  resetTerminalBackendCache,
  readTerminalBackendLever,
  registerPaneOutputHandle,
  truncateMiddle,
  stripSentinel,
  waitForRegexSource,
  outputAfterCommandEcho,
} from './TerminalBackend.js';
export type {
  TerminalBackend,
  TerminalBackendKind,
  TerminalBackendLever,
  TerminalSessionOptions,
  TerminalRunOptions,
  TerminalRunResult,
  TerminalReadOptions,
  TerminalWaitOptions,
  BackendExecFn,
  BackendExecResult,
} from './TerminalBackend.js';
export { SessionPersistence } from './SessionPersistence.js';
export { SessionLock } from './SessionLock.js';
export type { LockInfo, LockOptions } from './SessionLock.js';
export { TmuxCapture } from './TmuxCapture.js';
export type { CaptureOptions, CaptureResult } from './TmuxCapture.js';
export { SandboxRegistry } from './SandboxRegistry.js';
export type { SandboxRegistryEntry, SandboxRegistryData } from './SandboxRegistry.js';
export { ArtifactRegistry } from './ArtifactRegistry.js';
export type { ArtifactMetadata, ArtifactRegistrySchema, ArtifactType, ArtifactRuntime, ArtifactMode } from './ArtifactRegistry.js';
export { GitPolicy, ALL_GIT_ACTIONS } from './GitPolicy.js';
export type { GitAction, GitPolicyConfig } from './GitPolicy.js';
