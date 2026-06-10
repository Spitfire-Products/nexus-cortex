/**
 * @nexus-cortex/core - Core orchestration library implementing Claude CLI architecture
 *
 * This package provides:
 * - Conversation compaction with 9-section summaries
 * - Content-addressable file checkpoints
 * - Deterministic system-reminder injection
 * - JSONL-based session storage
 * - Multi-provider LLM orchestration
 * - Helper model middleware with automatic fallback
 * - Timeline-based conversation tracking
 * - Historical context retrieval tools
 */

// Phase 1.5 Week 1: Multi-Provider Architecture
// Adapter exports
export * from './adapters/index.js';

// Model registry exports
export * from './models/index.js';

// Phase 1.5 Week 2: Context Management & Helper Models
// Conversation compaction exports
// Note: CompactionResult conflict with middleware - use explicit import from needed module
export { ContextBudgetManager, StoredCompactionManager } from './conversation/index.js';

// Middleware exports (selective to avoid conflicts)
export {
  HelperModelMiddleware,
  ErrorClassificationMiddleware,
  RetryMiddleware,
  PermissionsMiddleware,
  SystemMessageMiddleware,
  MentorshipMiddleware,
  // Permissions system
  WhitelistPolicy,
  BlacklistPolicy,
  FileOperationPolicy,
  BashCommandPolicy,
  CLIApprovalHandler,
  AutoApproveHandler,
  DenyAllHandler,
  IPCApprovalHandler, // For sub-agent permission forwarding
  PermissionAuditLogger,
  PermissionEvaluator,
  PermissionConfigLoader,
  PermissionPresets,
  // File-backed permission profile editing (headless CLI persistence)
  resolvePermissionProfilePath,
  grantToolInProfile,
  revokeToolInProfile,
  listProfilePolicies,
  getApprovalHandlerFromProfile,
  setApprovalHandlerInProfile,
  readPermissionProfile,
  resolvePermissionWriteTarget
} from './middleware/index.js';
export type {
  CostTracking,
  PermissionPolicy,
  PermissionDecision,
  PermissionContext,
  PermissionAuditEntry,
  ApprovalHandler,
  FileOperationPolicyConfig,
  BashCommandPolicyConfig,
  PermissionsMiddlewareOptions
} from './middleware/index.js';

// Phase 1.5 Week 3: Timeline & Historical Retrieval
// Session management exports
// Note: CheckpointOptions, ResumeOptions conflict with orchestrator
// Note: CanonicalMessage conflict with adapters - both define it
export { SessionTimeline, CheckpointManager, JSONLHistoryStore } from './session/index.js';
export type { Message, UserMessage, AssistantMessage, SystemMessage } from './session/index.js';

// Tool definitions exports
export * from './tools/index.js';

// MCP infrastructure exports
export * from './mcp/index.js';

// Configuration system exports
export * from './config/index.js';

// Phase 2: Orchestrator
// Orchestrator exports
export * from './orchestrator/index.js';

// Phase 1: Core Components (if integrated)
// File checkpoint exports
export * from './file-tracking/index.js';

// System-reminder exports
export * from './system-messages/index.js';

// Agent management exports
export * from './agents/index.js';

// Slash command system exports
export * from './commands/index.js';

// Utility exports
export * from './utils/index.js';

// Shared UI types (for model pickers, session pickers, etc.)
export * from './ui/index.js';

// Training / routing
export { ModelRouterMatrix, estimateCost as estimateModelCost, resolveMaxMatrixBytes } from './training/ModelRouterMatrix.js';
export type { BenchmarkRecord, ModelScore, CostEfficiencyProfile, ScoringMatrix } from './training/ModelRouterMatrix.js';
export { classifyTask } from './training/TaskClassifier.js';
export type { TaskType } from './training/TaskClassifier.js';
export { ResearchBacklog, computePriority as computeDeficiencyPriority } from './training/ResearchBacklog.js';
export type { DeficiencyRecord, DeficiencyStatus, Severity, NewDeficiency } from './training/ResearchBacklog.js';
export { ExperimentLedger } from './training/ExperimentLedger.js';
export type { ExperimentRecord, ExperimentTaskResult, ExperimentDecision, NewExperiment, DecisionUpdate } from './training/ExperimentLedger.js';
export { compareVersions, regressionScan, toTaskResult } from './training/VersionComparison.js';
export type { TaskComparison, CompareOptions, RegressionReport } from './training/VersionComparison.js';
export {
  decideExperiment, bootstrapCI, permutationPValue, sidakThreshold, mcFwerThreshold,
  aggregateEffect, mulberry32,
} from './training/AutoResearchStats.js';
export type { RNG, TaskArms, GateOptions, ExperimentVerdict } from './training/AutoResearchStats.js';
export { evaluateExperiment as evaluateAutoResearchExperiment, verifyOnHoldout } from './training/AutoResearchGate.js';
export type { EvaluateInput, EvaluateResult } from './training/AutoResearchGate.js';
export { thompsonSelect } from './training/ThompsonRouter.js';
export type { ThompsonOptions } from './training/ThompsonRouter.js';
export { gradeRun, runBench, parseTaskSet } from './training/BenchRunner.js';
export type {
  Verifier, TaskSpec, JudgeFn, GradeResult, HarnessRunner, HarnessRunResult,
  RunBenchOptions, BenchSummary, BenchTaskSummary,
} from './training/BenchRunner.js';
export { runExperiment } from './training/ExperimentRunner.js';
export type {
  ExperimentArms, RunExperimentOptions, ExperimentResult, ExperimentBenchSummaries,
} from './training/ExperimentRunner.js';

// Runtime-agnostic interfaces (Phase 0 — I/O boundary abstraction)
// Namespaced to avoid conflicts with existing middleware PermissionDecision/PermissionPolicy exports
export * as RuntimeInterfaces from './interfaces/index.js';

// Node.js runtime adapters (wraps existing services behind runtime-agnostic interfaces)
export { NodeConfigProvider, NodeHistoryStoreAdapter, NodeToolExecutorAdapter, NodePermissionAdapter } from './adapters/node/index.js';
