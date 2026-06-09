/**
 * Bash Command Permission Policy
 *
 * Validates bash commands to prevent dangerous operations.
 * Supports:
 * - Dangerous pattern detection (rm -rf, sudo, etc.)
 * - Command prefix whitelisting
 * - Command prefix blacklisting
 * - Approval requirements for dangerous operations
 *
 * Priority: HIGH (80) - Security-critical validation
 *
 * @module permissions/BashCommandPolicy
 */

import type {
  PermissionPolicy,
  PermissionDecision,
  PermissionContext,
} from '../contracts/MiddlewareContracts.js';
import { BasePermissionPolicy, PolicyPriority } from './PermissionPolicy.js';

/**
 * Configuration options for bash command policy
 */
export interface BashCommandPolicyConfig {
  /**
   * Allowed command prefixes (whitelist mode)
   * Empty array = all commands allowed (unless blocked or dangerous)
   */
  allowedCommands: string[];

  /**
   * Blocked command prefixes (blacklist mode)
   * Commands starting with these are always denied
   */
  blockedCommands: string[];

  /**
   * Whether dangerous commands require approval
   * @default true
   */
  requireApprovalForDangerous?: boolean;

  /**
   * Custom dangerous patterns to detect
   * Added to the default dangerous patterns
   */
  customDangerousPatterns?: string[];
}

/**
 * Bash tools that this policy applies to
 * (uses canonical PascalCase name as defined in toolDefinitions.ts)
 */
const BASH_TOOLS = new Set(['Bash']);

/**
 * Default dangerous command patterns
 */
const DEFAULT_DANGEROUS_PATTERNS = [
  'rm -rf',
  'rm -fr',
  'sudo',
  'chmod 777',
  'chmod -R 777',
  'mkfs',
  '> /dev/',
  'dd if=',
  'dd of=',
  'format',
  'fdisk',
  'parted',
  ':(){:|:&};:', // Fork bomb
  'curl | sh',
  'wget | sh',
  'curl | bash',
  'wget | bash',
  '> /etc/',
  '> /sys/',
  'shutdown',
  'reboot',
  'halt',
  'poweroff',
  'init 0',
  'init 6',
  'systemctl stop',
  'systemctl disable',
  'service stop',
  'kill -9 1',
  'killall -9',
  'pkill -9',
];

/**
 * Bash command permission policy
 *
 * @example
 * ```typescript
 * const policy = new BashCommandPolicy({
 *   allowedCommands: [],
 *   blockedCommands: ['sudo', 'rm -rf /'],
 *   requireApprovalForDangerous: true
 * });
 *
 * await policy.evaluate({
 *   toolName: 'execute_bash',
 *   toolInput: { command: 'ls -la' },
 *   sessionId: '123',
 *   timestamp: new Date()
 * }); // Returns { allowed: true }
 *
 * await policy.evaluate({
 *   toolName: 'execute_bash',
 *   toolInput: { command: 'rm -rf /' },
 *   sessionId: '123',
 *   timestamp: new Date()
 * }); // Returns { allowed: false, reason: '...', canApprove: true/false }
 * ```
 */
export class BashCommandPolicy
  extends BasePermissionPolicy
  implements PermissionPolicy
{
  private config: Required<BashCommandPolicyConfig>;
  private dangerousPatterns: string[];
  /**
   * Round 9 (parallel-bench output): pre-lowercased copy of
   * `dangerousPatterns` so `findDangerousPattern` doesn't lowercase the
   * full pattern list on every Bash check. The original-cased array is
   * preserved for the deny-reason text and for `getDangerousPatterns()`;
   * this is parallel-indexed so we can map a lowercase hit back to the
   * original casing.
   *
   * Bash policy fires on every Bash tool call — often 10-20× per multi-iter
   * turn. With ~32 default patterns + customs, that's 320-640 string
   * allocations per turn saved.
   */
  private dangerousPatternsLowercase: string[];

  /**
   * Create a new bash command policy
   *
   * @param config Policy configuration
   * @param priority Policy priority (default: PolicyPriority.HIGH)
   * @param enabled Whether the policy is enabled (default: true)
   */
  constructor(
    config: BashCommandPolicyConfig,
    priority: number = PolicyPriority.HIGH,
    enabled: boolean = true
  ) {
    super('bash-command', priority, enabled);

    this.config = {
      allowedCommands: config.allowedCommands,
      blockedCommands: config.blockedCommands,
      requireApprovalForDangerous: config.requireApprovalForDangerous ?? true,
      customDangerousPatterns: config.customDangerousPatterns ?? [],
    };

    // Combine default and custom dangerous patterns
    this.dangerousPatterns = [
      ...DEFAULT_DANGEROUS_PATTERNS,
      ...this.config.customDangerousPatterns,
    ];
    // Round 9: pre-lowercase once (see field-level doc above)
    this.dangerousPatternsLowercase = this.dangerousPatterns.map((p) =>
      p.toLowerCase(),
    );
  }

  /**
   * Evaluate bash command permission
   */
  async evaluate(context: PermissionContext): Promise<PermissionDecision> {
    // Only apply to bash commands
    if (!BASH_TOOLS.has(context.toolName)) {
      return this.allow();
    }

    // Extract command from tool input
    const command = this.extractCommand(context.toolInput);

    if (!command) {
      return this.deny('No command provided in tool input', false);
    }

    // Normalize command (trim and lowercase for pattern matching)
    const normalizedCommand = command.trim();
    const lowercaseCommand = normalizedCommand.toLowerCase();

    // Check if command is empty
    if (normalizedCommand.length === 0) {
      return this.deny('Empty command provided', false);
    }

    // Check blocked commands first (highest priority)
    if (this.isCommandBlocked(normalizedCommand)) {
      return this.deny(
        `Command "${normalizedCommand}" is blocked by policy`,
        false // Hard block - no approval
      );
    }

    // Check for dangerous patterns
    const dangerousPattern = this.findDangerousPattern(lowercaseCommand);
    if (dangerousPattern) {
      return this.deny(
        `Command contains dangerous pattern: "${dangerousPattern}"`,
        this.config.requireApprovalForDangerous // Can approve if configured
      );
    }

    // Check whitelist (if configured)
    if (
      this.config.allowedCommands.length > 0 &&
      !this.isCommandAllowed(normalizedCommand)
    ) {
      return this.deny(
        `Command "${normalizedCommand}" is not in the allowed commands list`,
        true // Can approve
      );
    }

    return this.allow();
  }

  /**
   * Extract command from various tool input formats
   */
  private extractCommand(toolInput: any): string | null {
    if (typeof toolInput === 'string') {
      return toolInput;
    }

    if (typeof toolInput === 'object' && toolInput !== null) {
      // Try common field names
      return toolInput.command || toolInput.cmd || toolInput.script || null;
    }

    return null;
  }

  /**
   * Check if command starts with a blocked prefix
   */
  private isCommandBlocked(command: string): boolean {
    return this.config.blockedCommands.some((blocked) =>
      command.startsWith(blocked)
    );
  }

  /**
   * Check if command starts with an allowed prefix
   */
  private isCommandAllowed(command: string): boolean {
    return this.config.allowedCommands.some((allowed) =>
      command.startsWith(allowed)
    );
  }

  /**
   * Find dangerous pattern in command
   * Returns the pattern if found, null otherwise
   */
  private findDangerousPattern(command: string): string | null {
    // Round 9: iterate the pre-lowercased parallel array; return the
    // original-cased pattern for the deny reason text.
    for (let i = 0; i < this.dangerousPatternsLowercase.length; i++) {
      if (command.includes(this.dangerousPatternsLowercase[i]!)) {
        return this.dangerousPatterns[i]!;
      }
    }
    return null;
  }

  /**
   * Add a dangerous pattern
   */
  addDangerousPattern(pattern: string): void {
    if (!this.dangerousPatterns.includes(pattern)) {
      this.dangerousPatterns.push(pattern);
      // Round 9: keep the parallel pre-lowercased array in sync.
      this.dangerousPatternsLowercase.push(pattern.toLowerCase());
    }
  }

  /**
   * Add an allowed command prefix
   */
  addAllowedCommand(commandPrefix: string): void {
    if (!this.config.allowedCommands.includes(commandPrefix)) {
      this.config.allowedCommands.push(commandPrefix);
    }
  }

  /**
   * Add a blocked command prefix
   */
  addBlockedCommand(commandPrefix: string): void {
    if (!this.config.blockedCommands.includes(commandPrefix)) {
      this.config.blockedCommands.push(commandPrefix);
    }
  }

  /**
   * Get all dangerous patterns (default + custom)
   */
  getDangerousPatterns(): string[] {
    return [...this.dangerousPatterns];
  }

  /**
   * Get configuration
   */
  getConfig(): Readonly<Required<BashCommandPolicyConfig>> {
    return { ...this.config };
  }
}
