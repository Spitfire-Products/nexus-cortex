/**
 * Permissions System
 *
 * Comprehensive authorization layer for tool execution.
 *
 * @module permissions
 */

// Core middleware
export { PermissionsMiddleware } from '../PermissionsMiddleware.js';
export type { PermissionsMiddlewareOptions } from '../PermissionsMiddleware.js';

// Policy types and base classes
export type {
  PermissionPolicy,
  PermissionDecision,
  PermissionContext,
  PermissionAuditEntry,
} from '../contracts/MiddlewareContracts.js';

export { BasePermissionPolicy, PolicyPriority, PolicyEvaluationMode } from './PermissionPolicy.js';

// Policy evaluator
export { PermissionEvaluator } from './PermissionEvaluator.js';
export type {
  PermissionEvaluatorOptions,
  EvaluationResult,
} from './PermissionEvaluator.js';

// Policy implementations
export { WhitelistPolicy } from './WhitelistPolicy.js';
export { BlacklistPolicy } from './BlacklistPolicy.js';
export { FileOperationPolicy } from './FileOperationPolicy.js';
export type { FileOperationPolicyConfig } from './FileOperationPolicy.js';
export { BashCommandPolicy } from './BashCommandPolicy.js';
export type { BashCommandPolicyConfig } from './BashCommandPolicy.js';

// Approval handlers
export type { ApprovalHandler, ApprovalRequest } from '../contracts/MiddlewareContracts.js';
export { ApprovalTimeoutError, ApprovalRejectedError } from './ApprovalHandler.js';
export { CLIApprovalHandler } from './CLIApprovalHandler.js';
export type { CLIApprovalHandlerOptions } from './CLIApprovalHandler.js';
export { AutoApproveHandler } from './AutoApproveHandler.js';
export type { AutoApproveHandlerOptions } from './AutoApproveHandler.js';
export { DenyAllHandler } from './DenyAllHandler.js';
export type { DenyAllHandlerOptions } from './DenyAllHandler.js';
export { IPCApprovalHandler } from './IPCApprovalHandler.js';
export type { IPCApprovalHandlerOptions } from './IPCApprovalHandler.js';

// Audit logging
export { PermissionAuditLogger } from './PermissionAuditLogger.js';
export type {
  PermissionAuditLoggerOptions,
  AuditQueryOptions,
} from './PermissionAuditLogger.js';

// Configuration
export type {
  PermissionConfig,
  PolicyConfig,
  FileOperationPolicyConfig as ConfigFileOperationPolicy,
  BashCommandPolicyConfig as ConfigBashCommandPolicy,
  WhitelistPolicyConfig,
  BlacklistPolicyConfig,
  AuditLogConfig,
} from './PermissionConfig.js';
export { PermissionPresets } from './PermissionConfig.js';

export { PermissionConfigLoader } from './PermissionConfigLoader.js';
export type { ConfigLoaderOptions } from './PermissionConfigLoader.js';

// Profile path resolution + file-backed profile editing (headless CLI persistence)
export { resolvePermissionProfilePath } from './profilePath.js';
export type { PermissionProfileName } from './profilePath.js';
export {
  grantToolInProfile,
  revokeToolInProfile,
  listProfilePolicies,
  getApprovalHandlerFromProfile,
  setApprovalHandlerInProfile,
  readProfile as readPermissionProfile,
  resolveWriteTarget as resolvePermissionWriteTarget,
  GRANT_PRIORITY,
  REVOKE_PRIORITY,
} from './PermissionProfileStore.js';
export type {
  PermissionProfile,
  ProfilePolicyEntry,
  ProfilePolicySummary,
} from './PermissionProfileStore.js';
