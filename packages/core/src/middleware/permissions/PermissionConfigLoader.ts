/**
 * Permission Configuration Loader
 *
 * Loads permission configuration from JSON files and instantiates
 * policies and handlers.
 *
 * @module permissions/PermissionConfigLoader
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  PermissionConfig,
  PolicyConfig,
  AuditLogConfig,
} from './PermissionConfig.js';
import type { PermissionPolicy, ApprovalHandler } from '../contracts/MiddlewareContracts.js';

import { WhitelistPolicy } from './WhitelistPolicy.js';
import { BlacklistPolicy } from './BlacklistPolicy.js';
import { FileOperationPolicy } from './FileOperationPolicy.js';
import { BashCommandPolicy } from './BashCommandPolicy.js';
import { CLIApprovalHandler } from './CLIApprovalHandler.js';
import { AutoApproveHandler } from './AutoApproveHandler.js';
import { DenyAllHandler } from './DenyAllHandler.js';
import { PermissionAuditLogger } from './PermissionAuditLogger.js';
import { PermissionsMiddleware } from '../PermissionsMiddleware.js';

/**
 * Options for configuration loader
 */
export interface ConfigLoaderOptions {
  /**
   * Whether to throw errors on invalid configuration
   * @default true
   */
  throwOnError?: boolean;

  /**
   * Whether to log loading progress
   * @default false
   */
  enableLogging?: boolean;
}

/**
 * Configuration loader for permission system
 *
 * @example
 * ```typescript
 * const loader = new PermissionConfigLoader();
 *
 * const middleware = await loader.loadFromFile('/path/to/permissions.json');
 * ```
 */
export class PermissionConfigLoader {
  private options: Required<ConfigLoaderOptions>;

  constructor(options: ConfigLoaderOptions = {}) {
    this.options = {
      throwOnError: options.throwOnError ?? true,
      enableLogging: options.enableLogging ?? false,
    };
  }

  /**
   * Load configuration from a JSON file
   *
   * @param filePath Path to the configuration file
   * @returns Configured permissions middleware
   */
  async loadFromFile(filePath: string): Promise<PermissionsMiddleware> {
    const absolutePath = path.resolve(filePath);

    if (!fs.existsSync(absolutePath)) {
      const error = `Configuration file not found: ${absolutePath}`;

      if (this.options.throwOnError) {
        throw new Error(error);
      } else {
        console.error(`[PermissionConfigLoader] ${error}`);
        return this.createDefaultMiddleware();
      }
    }

    try {
      const content = await fs.promises.readFile(absolutePath, 'utf-8');
      const config: PermissionConfig = JSON.parse(content);

      return this.loadFromConfig(config);
    } catch (error) {
      const errorMsg = `Failed to load configuration: ${error instanceof Error ? error.message : 'Unknown error'}`;

      if (this.options.throwOnError) {
        throw new Error(errorMsg);
      } else {
        console.error(`[PermissionConfigLoader] ${errorMsg}`);
        return this.createDefaultMiddleware();
      }
    }
  }

  /**
   * Load policies from a JSON configuration file
   *
   * @param filePath Path to the configuration file
   * @returns Array of configured permission policies
   */
  async loadPoliciesFromFile(filePath: string): Promise<PermissionPolicy[]> {
    const absolutePath = path.resolve(filePath);

    if (!fs.existsSync(absolutePath)) {
      const error = `Configuration file not found: ${absolutePath}`;

      if (this.options.throwOnError) {
        throw new Error(error);
      } else {
        console.error(`[PermissionConfigLoader] ${error}`);
        return [];
      }
    }

    try {
      const content = await fs.promises.readFile(absolutePath, 'utf-8');
      const config: PermissionConfig = JSON.parse(content);

      if (!config.enabled) {
        if (this.options.enableLogging) {
          console.log('[PermissionConfigLoader] Permissions disabled by config');
        }
        return [];
      }

      return this.loadPolicies(config.policies);
    } catch (error) {
      const errorMsg = `Failed to load policies from configuration: ${error instanceof Error ? error.message : 'Unknown error'}`;

      if (this.options.throwOnError) {
        throw new Error(errorMsg);
      } else {
        console.error(`[PermissionConfigLoader] ${errorMsg}`);
        return [];
      }
    }
  }

  /**
   * Load configuration from an object
   *
   * @param config The permission configuration
   * @returns Configured permissions middleware
   */
  loadFromConfig(config: PermissionConfig): PermissionsMiddleware {
    if (!config.enabled) {
      if (this.options.enableLogging) {
        console.log('[PermissionConfigLoader] Permissions disabled by config');
      }

      // Return a permissive middleware with no policies
      return new PermissionsMiddleware({
        defaultPolicy: 'allow',
        policies: [],
      });
    }

    // Load policies
    const policies = this.loadPolicies(config.policies);

    // Load approval handler
    const approvalHandler = this.loadApprovalHandler(config.approvalHandler);

    // Load audit logger
    const auditLogger = this.loadAuditLogger(config.auditLog);

    return new PermissionsMiddleware({
      policies,
      approvalHandler,
      auditLogger,
      defaultPolicy: config.defaultPolicy,
      enableLogging: config.enableLogging,
    });
  }

  /**
   * Load policies from configuration
   */
  private loadPolicies(policyConfigs: PolicyConfig[]): PermissionPolicy[] {
    const policies: PermissionPolicy[] = [];

    for (const policyConfig of policyConfigs) {
      try {
        const policy = this.createPolicy(policyConfig);
        if (policy) {
          policies.push(policy);

          if (this.options.enableLogging) {
            console.log(
              `[PermissionConfigLoader] Loaded policy: ${policyConfig.type}`
            );
          }
        }
      } catch (error) {
        const errorMsg = `Failed to load policy ${policyConfig.type}: ${error instanceof Error ? error.message : 'Unknown error'}`;

        if (this.options.throwOnError) {
          throw new Error(errorMsg);
        } else {
          console.error(`[PermissionConfigLoader] ${errorMsg}`);
        }
      }
    }

    return policies;
  }

  /**
   * Create a policy from configuration
   */
  private createPolicy(config: PolicyConfig): PermissionPolicy | null {
    const enabled = config.enabled ?? true;

    switch (config.type) {
      case 'whitelist': {
        const allowedTools = config.config.allowedTools || [];
        if (allowedTools.length === 0) {
          // Hard whitelist with empty allowedTools denies every tool — refuse
          // to honor it. This is almost always a footgun in a shipped profile.
          console.warn(
            `[PermissionConfigLoader] Skipping whitelist policy with empty allowedTools (would deny every tool). To enforce a deny-all stance, use 'defaultPolicy: deny' instead.`,
          );
          return null;
        }
        return new WhitelistPolicy(allowedTools, config.priority, enabled);
      }

      case 'blacklist':
        return new BlacklistPolicy(
          config.config.blockedTools || [],
          config.priority,
          enabled
        );

      case 'file-operation':
        return new FileOperationPolicy(
          {
            allowedPaths: config.config.allowedPaths || [],
            blockedPaths: config.config.blockedPaths || [],
            requireApprovalForDelete:
              config.config.requireApprovalForDelete ?? true,
            requireApprovalForWrite: config.config.requireApprovalForWrite ?? false,
            maxPathLength: config.config.maxPathLength,
          },
          config.priority,
          enabled
        );

      case 'bash-command':
        return new BashCommandPolicy(
          {
            allowedCommands: config.config.allowedCommands || [],
            blockedCommands: config.config.blockedCommands || [],
            requireApprovalForDangerous:
              config.config.requireApprovalForDangerous ?? true,
            customDangerousPatterns: config.config.customDangerousPatterns,
          },
          config.priority,
          enabled
        );

      case 'custom':
        // Custom policies need to be registered separately
        console.warn(
          '[PermissionConfigLoader] Custom policy type not supported in loader'
        );
        return null;

      default:
        console.warn(
          `[PermissionConfigLoader] Unknown policy type: ${config.type}`
        );
        return null;
    }
  }

  /**
   * Load approval handler from configuration
   */
  private loadApprovalHandler(
    handlerType?: string
  ): ApprovalHandler | undefined {
    if (!handlerType) {
      return undefined;
    }

    switch (handlerType) {
      case 'cli':
        return new CLIApprovalHandler();

      case 'auto-approve':
        return new AutoApproveHandler();

      case 'deny-all':
        return new DenyAllHandler();

      default:
        console.warn(
          `[PermissionConfigLoader] Unknown approval handler type: ${handlerType}`
        );
        return undefined;
    }
  }

  /**
   * Load audit logger from configuration
   */
  private loadAuditLogger(
    auditConfig?: AuditLogConfig
  ): PermissionAuditLogger | undefined {
    if (!auditConfig || !auditConfig.enabled) {
      return undefined;
    }

    const logPath =
      auditConfig.path || '.cortex/audit/permissions.log';

    return new PermissionAuditLogger(logPath, {
      maxFileSizeBytes: auditConfig.maxFileSizeBytes,
      enableRotation: auditConfig.enableRotation,
      maxRotatedFiles: auditConfig.maxRotatedFiles,
    });
  }

  /**
   * Create a default middleware with minimal configuration
   */
  private createDefaultMiddleware(): PermissionsMiddleware {
    if (this.options.enableLogging) {
      console.log(
        '[PermissionConfigLoader] Creating default permissive middleware'
      );
    }

    return new PermissionsMiddleware({
      defaultPolicy: 'allow',
      policies: [],
    });
  }

  /**
   * Validate configuration without loading
   *
   * @param config The configuration to validate
   * @returns Array of validation errors (empty if valid)
   */
  validateConfig(config: PermissionConfig): string[] {
    const errors: string[] = [];

    if (typeof config.enabled !== 'boolean') {
      errors.push('enabled must be a boolean');
    }

    if (config.defaultPolicy !== 'allow' && config.defaultPolicy !== 'deny') {
      errors.push('defaultPolicy must be "allow" or "deny"');
    }

    if (!Array.isArray(config.policies)) {
      errors.push('policies must be an array');
    } else {
      for (let i = 0; i < config.policies.length; i++) {
        const policy = config.policies[i];

        if (!policy) {
          errors.push(`policies[${i}] is null or undefined`);
          continue;
        }

        if (!policy.type) {
          errors.push(`policies[${i}] missing required field: type`);
        }

        if (!policy.config || typeof policy.config !== 'object') {
          errors.push(`policies[${i}] missing required field: config`);
        }
      }
    }

    if (
      config.approvalHandler &&
      !['cli', 'auto-approve', 'deny-all'].includes(config.approvalHandler)
    ) {
      errors.push(
        'approvalHandler must be "cli", "auto-approve", or "deny-all"'
      );
    }

    return errors;
  }
}
