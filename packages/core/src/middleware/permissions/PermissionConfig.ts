/**
 * Permission Configuration Types
 *
 * Type definitions for permission system configuration files.
 *
 * @module permissions/PermissionConfig
 */

/**
 * Policy configuration
 */
export interface PolicyConfig {
  /**
   * Policy type identifier
   */
  type: 'whitelist' | 'blacklist' | 'file-operation' | 'bash-command' | 'custom';

  /**
   * Policy priority (optional, uses default if not specified)
   */
  priority?: number;

  /**
   * Whether the policy is enabled
   * @default true
   */
  enabled?: boolean;

  /**
   * Policy-specific configuration
   */
  config: Record<string, any>;
}

/**
 * File operation policy configuration
 */
export interface FileOperationPolicyConfig {
  /**
   * Allowed path prefixes
   */
  allowedPaths: string[];

  /**
   * Blocked path patterns
   */
  blockedPaths: string[];

  /**
   * Require approval for delete operations
   * @default true
   */
  requireApprovalForDelete?: boolean;

  /**
   * Require approval for write operations
   * @default false
   */
  requireApprovalForWrite?: boolean;

  /**
   * Maximum file path length
   * @default 4096
   */
  maxPathLength?: number;
}

/**
 * Bash command policy configuration
 */
export interface BashCommandPolicyConfig {
  /**
   * Allowed command prefixes (whitelist mode)
   */
  allowedCommands: string[];

  /**
   * Blocked command prefixes (blacklist mode)
   */
  blockedCommands: string[];

  /**
   * Require approval for dangerous commands
   * @default true
   */
  requireApprovalForDangerous?: boolean;

  /**
   * Custom dangerous patterns
   */
  customDangerousPatterns?: string[];
}

/**
 * Whitelist policy configuration
 */
export interface WhitelistPolicyConfig {
  /**
   * Allowed tool names
   */
  allowedTools: string[];
}

/**
 * Blacklist policy configuration
 */
export interface BlacklistPolicyConfig {
  /**
   * Blocked tool names
   */
  blockedTools: string[];
}

/**
 * Audit log configuration
 */
export interface AuditLogConfig {
  /**
   * Whether audit logging is enabled
   * @default true
   */
  enabled: boolean;

  /**
   * Path to the audit log file
   * @default '.nexus-cortex/audit/permissions.log'
   */
  path?: string;

  /**
   * Maximum file size before rotation (bytes)
   * @default 10485760 (10MB)
   */
  maxFileSizeBytes?: number;

  /**
   * Enable file rotation
   * @default true
   */
  enableRotation?: boolean;

  /**
   * Number of rotated files to keep
   * @default 5
   */
  maxRotatedFiles?: number;
}

/**
 * Complete permission configuration
 */
export interface PermissionConfig {
  /**
   * Whether permission system is enabled
   * @default true
   */
  enabled: boolean;

  /**
   * Default policy when no policies match
   * @default 'deny'
   */
  defaultPolicy: 'allow' | 'deny';

  /**
   * Configured policies
   */
  policies: PolicyConfig[];

  /**
   * Approval handler type
   */
  approvalHandler?: 'cli' | 'auto-approve' | 'deny-all';

  /**
   * Audit log configuration
   */
  auditLog?: AuditLogConfig;

  /**
   * Enable debug logging
   * @default false
   */
  enableLogging?: boolean;
}

/**
 * Environment-specific configuration presets
 */
export const PermissionPresets = {
  /**
   * Development environment (permissive)
   */
  development: (): PermissionConfig => ({
    enabled: true,
    defaultPolicy: 'allow',
    policies: [
      {
        type: 'file-operation',
        config: {
          allowedPaths: [process.cwd()],
          blockedPaths: ['/.git', '/node_modules', '/.env'],
          requireApprovalForDelete: true,
        },
      },
      {
        type: 'bash-command',
        config: {
          allowedCommands: [],
          blockedCommands: ['rm -rf /', 'sudo rm'],
          requireApprovalForDangerous: true,
        },
      },
    ],
    approvalHandler: 'cli',
    auditLog: {
      enabled: true,
      path: '.nexus-cortex/audit/permissions.log',
    },
  }),

  /**
   * Production environment (strict)
   */
  production: (): PermissionConfig => ({
    enabled: true,
    defaultPolicy: 'deny',
    policies: [
      {
        type: 'whitelist',
        config: {
          allowedTools: ['read_file', 'list_files', 'grep', 'create_artifact'],
        },
      },
      {
        type: 'blacklist',
        priority: 100,
        config: {
          blockedTools: ['execute_bash', 'write_file', 'delete_file'],
        },
      },
      {
        type: 'file-operation',
        config: {
          allowedPaths: ['/workspace/public'],
          blockedPaths: ['*'],
          requireApprovalForDelete: false,
        },
      },
    ],
    approvalHandler: 'deny-all',
    auditLog: {
      enabled: true,
      path: '/var/log/cortex/permissions.log',
    },
  }),

  /**
   * Testing/CI environment (auto-approve)
   */
  testing: (): PermissionConfig => ({
    enabled: true,
    defaultPolicy: 'allow',
    policies: [
      {
        type: 'file-operation',
        config: {
          allowedPaths: ['/tmp/test-workspace'],
          blockedPaths: [],
          requireApprovalForDelete: false,
        },
      },
    ],
    approvalHandler: 'auto-approve',
    auditLog: {
      enabled: false,
    },
  }),

  /**
   * Disabled permissions (no checks)
   */
  disabled: (): PermissionConfig => ({
    enabled: false,
    defaultPolicy: 'allow',
    policies: [],
    auditLog: {
      enabled: false,
    },
  }),
} as const;
