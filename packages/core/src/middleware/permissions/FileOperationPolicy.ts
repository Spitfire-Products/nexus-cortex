/**
 * File Operation Permission Policy
 *
 * Validates file paths and operations to prevent unauthorized access.
 * Supports:
 * - Allowed path prefixes
 * - Blocked path patterns
 * - Path traversal detection
 * - Delete operation approval requirements
 * - Glob pattern matching
 *
 * Priority: HIGH (80) - Security-critical validation
 *
 * @module permissions/FileOperationPolicy
 */

import * as path from 'node:path';
import type {
  PermissionPolicy,
  PermissionDecision,
  PermissionContext,
} from '../contracts/MiddlewareContracts.js';
import { BasePermissionPolicy, PolicyPriority } from './PermissionPolicy.js';

/**
 * Configuration options for file operation policy
 */
export interface FileOperationPolicyConfig {
  /**
   * Allowed path prefixes (operations outside these are denied)
   * Empty array = all paths allowed (unless blocked)
   */
  allowedPaths: string[];

  /**
   * Blocked path patterns (absolute deny)
   * These paths are blocked even if in allowedPaths
   */
  blockedPaths: string[];

  /**
   * Whether delete operations require approval
   * @default true
   */
  requireApprovalForDelete?: boolean;

  /**
   * Whether write operations require approval
   * @default false
   */
  requireApprovalForWrite?: boolean;

  /**
   * Maximum file path length allowed
   * @default 4096
   */
  maxPathLength?: number;
}

/**
 * File tools that this policy applies to
 * (uses canonical PascalCase names as defined in toolDefinitions.ts)
 * Note: Glob and Grep use patterns, not file paths, so they're not included here
 */
const FILE_TOOLS = new Set([
  'Read',
  'Write',
  'Edit',
]);

/**
 * Sensitive directories that should be blocked by default
 */
const SENSITIVE_DIRECTORIES = [
  '/etc',
  '/root',
  '/sys',
  '/proc',
  '/dev',
  '/.git',
  '/node_modules',
  '/.env',
  '/.ssh',
  '/.aws',
  '/.config',
];

/**
 * File operation permission policy
 *
 * @example
 * ```typescript
 * const policy = new FileOperationPolicy({
 *   allowedPaths: ['/home/user/workspace'],
 *   blockedPaths: ['/etc', '/root'],
 *   requireApprovalForDelete: true
 * });
 *
 * await policy.evaluate({
 *   toolName: 'read_file',
 *   toolInput: { file_path: '/home/user/workspace/file.txt' },
 *   sessionId: '123',
 *   timestamp: new Date()
 * }); // Returns { allowed: true }
 *
 * await policy.evaluate({
 *   toolName: 'read_file',
 *   toolInput: { file_path: '/etc/passwd' },
 *   sessionId: '123',
 *   timestamp: new Date()
 * }); // Returns { allowed: false, reason: '...', canApprove: false }
 * ```
 */
export class FileOperationPolicy
  extends BasePermissionPolicy
  implements PermissionPolicy
{
  private config: Required<FileOperationPolicyConfig>;

  /**
   * Create a new file operation policy
   *
   * @param config Policy configuration
   * @param priority Policy priority (default: PolicyPriority.HIGH)
   * @param enabled Whether the policy is enabled (default: true)
   */
  constructor(
    config: FileOperationPolicyConfig,
    priority: number = PolicyPriority.HIGH,
    enabled: boolean = true
  ) {
    super('file-operation', priority, enabled);

    this.config = {
      allowedPaths: config.allowedPaths,
      blockedPaths: config.blockedPaths,
      requireApprovalForDelete: config.requireApprovalForDelete ?? true,
      requireApprovalForWrite: config.requireApprovalForWrite ?? false,
      maxPathLength: config.maxPathLength ?? 4096,
    };

    // Normalize all paths to absolute paths
    this.config.allowedPaths = this.config.allowedPaths.map((p) =>
      path.resolve(p)
    );
    this.config.blockedPaths = this.config.blockedPaths.map((p) => path.resolve(p));
  }

  /**
   * Evaluate file operation permission
   */
  async evaluate(context: PermissionContext): Promise<PermissionDecision> {
    // Only apply to file operations
    if (!FILE_TOOLS.has(context.toolName)) {
      return this.allow();
    }

    // Extract file path from tool input
    const filePath = this.extractFilePath(context.toolInput);

    if (!filePath) {
      return this.deny('No file path provided in tool input', false);
    }

    // Validate path length
    if (filePath.length > this.config.maxPathLength) {
      return this.deny(
        `File path exceeds maximum length (${this.config.maxPathLength})`,
        false
      );
    }

    // Resolve to absolute path and normalize
    let absolutePath: string;
    try {
      absolutePath = path.resolve(filePath);
    } catch (error) {
      return this.deny(
        `Invalid file path: ${error instanceof Error ? error.message : 'Unknown error'}`,
        false
      );
    }

    // Check for path traversal attempts
    if (this.hasPathTraversal(filePath)) {
      return this.deny('Path traversal detected in file path', false);
    }

    // Check blocked paths (highest priority - no approval)
    if (this.isPathBlocked(absolutePath)) {
      return this.deny(
        `Access to path "${absolutePath}" is restricted`,
        false // Hard block - no approval
      );
    }

    // Check allowed paths
    if (!this.isPathAllowed(absolutePath)) {
      return this.deny(
        `Path "${absolutePath}" is outside allowed directories`,
        true // Can approve
      );
    }

    // Check if write operation requires approval
    if (
      context.toolName === 'Write' &&
      this.config.requireApprovalForWrite
    ) {
      return this.deny('Write operation requires approval', true);
    }

    // Note: Delete operations are handled via Bash tool with rm commands,
    // so requireApprovalForDelete should be checked in BashCommandPolicy

    return this.allow();
  }

  /**
   * Extract file path from various tool input formats
   */
  private extractFilePath(toolInput: any): string | null {
    if (typeof toolInput === 'string') {
      return toolInput;
    }

    if (typeof toolInput === 'object' && toolInput !== null) {
      // Try common field names
      return (
        toolInput.file_path ||
        toolInput.path ||
        toolInput.filePath ||
        toolInput.filepath ||
        null
      );
    }

    return null;
  }

  /**
   * Check if path contains traversal patterns
   */
  private hasPathTraversal(filePath: string): boolean {
    const traversalPatterns = ['../', '..\\', '/../', '\\..\\'];
    return traversalPatterns.some((pattern) => filePath.includes(pattern));
  }

  /**
   * Check if path is blocked
   */
  private isPathBlocked(absolutePath: string): boolean {
    // Check against blocked paths
    for (const blockedPath of this.config.blockedPaths) {
      if (absolutePath.startsWith(blockedPath)) {
        return true;
      }

      // Also check if any part of the path matches
      if (absolutePath.includes(blockedPath)) {
        return true;
      }
    }

    // Check against sensitive directories
    for (const sensitiveDir of SENSITIVE_DIRECTORIES) {
      if (absolutePath.startsWith(sensitiveDir)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if path is in allowed paths
   */
  private isPathAllowed(absolutePath: string): boolean {
    // If no allowed paths configured, all paths are allowed (unless blocked)
    if (this.config.allowedPaths.length === 0) {
      return true;
    }

    // Check if path starts with any allowed path prefix
    return this.config.allowedPaths.some((allowedPath) =>
      absolutePath.startsWith(allowedPath)
    );
  }

  /**
   * Add an allowed path
   */
  addAllowedPath(pathPrefix: string): void {
    const absolutePath = path.resolve(pathPrefix);
    if (!this.config.allowedPaths.includes(absolutePath)) {
      this.config.allowedPaths.push(absolutePath);
    }
  }

  /**
   * Add a blocked path
   */
  addBlockedPath(pathPrefix: string): void {
    const absolutePath = path.resolve(pathPrefix);
    if (!this.config.blockedPaths.includes(absolutePath)) {
      this.config.blockedPaths.push(absolutePath);
    }
  }

  /**
   * Get configuration
   */
  getConfig(): Readonly<Required<FileOperationPolicyConfig>> {
    return { ...this.config };
  }
}
