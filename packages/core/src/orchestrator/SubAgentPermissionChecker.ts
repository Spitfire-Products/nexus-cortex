/**
 * Sub-Agent Permission Checker
 *
 * Manages permission delegation and tool restriction enforcement
 * for sub-agents. Ensures sub-agents can only access tools
 * specified in their agent definition AND approved by the parent's
 * permission policies.
 *
 * Security Model:
 * - Sub-agents inherit parent's base permissions
 * - Tool restrictions in agent definition further limit access
 * - Sub-agents CANNOT gain permissions parent doesn't have
 *
 * @module orchestrator/SubAgentPermissionChecker
 * @version 1.0.0
 */

import type {
  PermissionPolicy,
  PermissionDecision,
  PermissionContext,
} from '../middleware/contracts/MiddlewareContracts.js';
import type { AgentDefinition } from './SubAgentTypes.js';

/**
 * Configuration for sub-agent permission checking
 */
export interface SubAgentPermissionConfig {
  /** The agent definition with tool restrictions */
  agentDefinition: AgentDefinition;

  /** Parent session ID for logging/auditing */
  parentSessionId: string;

  /** Sub-agent session ID */
  agentId: string;

  /** Enable debug logging */
  debug?: boolean;
}

/**
 * Result of a permission check
 */
export interface PermissionCheckResult {
  /** Whether the tool is allowed */
  allowed: boolean;

  /** Reason for the decision */
  reason: string;

  /** Whether manual approval can override */
  canApprove: boolean;

  /** Which restriction blocked the tool (if denied) */
  blockedBy?: 'agent_restriction' | 'parent_policy' | 'not_in_whitelist';
}

/**
 * Sub-Agent Permission Checker
 *
 * Provides layered permission checking for sub-agents:
 * 1. First checks if tool is in agent's allowed tool list
 * 2. Then checks parent's permission policies
 */
export class SubAgentPermissionChecker implements PermissionPolicy {
  readonly name: string;
  readonly priority: number = 100; // High priority
  readonly enabled: boolean = true;

  private config: SubAgentPermissionConfig;
  private allowedTools: Set<string> | 'all';
  private parentPolicies: PermissionPolicy[] = [];

  constructor(config: SubAgentPermissionConfig) {
    this.config = config;
    this.name = `SubAgentPermission:${config.agentId}`;

    // Build allowed tools set
    if (config.agentDefinition.tools === 'all') {
      this.allowedTools = 'all';
    } else {
      this.allowedTools = new Set(
        config.agentDefinition.tools.map((t) => t.toLowerCase())
      );
    }

    if (config.debug) {
      console.log(
        `[SubAgentPermissionChecker] Created for agent "${config.agentDefinition.name}"`,
        `Tools: ${this.allowedTools === 'all' ? 'all' : Array.from(this.allowedTools).join(', ')}`
      );
    }
  }

  /**
   * Add a parent permission policy
   * These policies are checked AFTER agent tool restriction
   */
  addParentPolicy(policy: PermissionPolicy): void {
    this.parentPolicies.push(policy);
    // Keep sorted by priority
    this.parentPolicies.sort((a, b) => b.priority - a.priority);
  }

  /**
   * Set all parent policies at once
   */
  setParentPolicies(policies: PermissionPolicy[]): void {
    this.parentPolicies = [...policies].sort((a, b) => b.priority - a.priority);
  }

  /**
   * Check if a tool is in the agent's allowed tools list
   */
  isToolAllowedByAgent(toolName: string): boolean {
    if (this.allowedTools === 'all') {
      return true;
    }
    return this.allowedTools.has(toolName.toLowerCase());
  }

  /**
   * Get the list of allowed tools for this agent
   */
  getAllowedTools(): string[] | 'all' {
    if (this.allowedTools === 'all') {
      return 'all';
    }
    return Array.from(this.allowedTools);
  }

  /**
   * Evaluate permission for a tool call
   *
   * @param context Permission context with tool info
   * @returns Permission decision
   */
  async evaluate(context: PermissionContext): Promise<PermissionDecision> {
    const result = await this.checkPermission(context.toolName, context.toolInput, context);

    return {
      allowed: result.allowed,
      reason: result.reason,
      canApprove: result.canApprove,
    };
  }

  /**
   * Full permission check with detailed result
   *
   * @param toolName Name of the tool being called
   * @param toolInput Tool input parameters
   * @param context Optional additional context
   */
  async checkPermission(
    toolName: string,
    toolInput: unknown,
    context?: Partial<PermissionContext>
  ): Promise<PermissionCheckResult> {
    // Step 1: Check agent tool restriction
    if (!this.isToolAllowedByAgent(toolName)) {
      const allowedList =
        this.allowedTools === 'all'
          ? 'all tools'
          : Array.from(this.allowedTools).join(', ');

      if (this.config.debug) {
        console.log(
          `[SubAgentPermissionChecker] Tool "${toolName}" blocked by agent restriction.`,
          `Allowed: ${allowedList}`
        );
      }

      return {
        allowed: false,
        reason: `Tool "${toolName}" is not in the agent's allowed tools list. ` +
          `Agent "${this.config.agentDefinition.name}" can only use: ${allowedList}`,
        canApprove: false, // Agent restrictions cannot be overridden
        blockedBy: 'agent_restriction',
      };
    }

    // Step 2: Check parent policies
    if (this.parentPolicies.length > 0) {
      const fullContext: PermissionContext = {
        toolName,
        toolInput,
        sessionId: context?.sessionId ?? this.config.agentId,
        userId: context?.userId,
        timestamp: context?.timestamp ?? new Date(),
      };

      for (const policy of this.parentPolicies) {
        if (!policy.enabled) {
          continue;
        }

        try {
          const decision = await policy.evaluate(fullContext);

          if (!decision.allowed) {
            if (this.config.debug) {
              console.log(
                `[SubAgentPermissionChecker] Tool "${toolName}" blocked by parent policy "${policy.name}":`,
                decision.reason
              );
            }

            return {
              allowed: false,
              reason: decision.reason ?? `Blocked by parent policy "${policy.name}"`,
              canApprove: decision.canApprove ?? false,
              blockedBy: 'parent_policy',
            };
          }
        } catch (error) {
          // Policy error - fail closed
          console.error(
            `[SubAgentPermissionChecker] Error in parent policy "${policy.name}":`,
            error
          );

          return {
            allowed: false,
            reason: `Policy evaluation error: ${error instanceof Error ? error.message : 'Unknown'}`,
            canApprove: false,
            blockedBy: 'parent_policy',
          };
        }
      }
    }

    // All checks passed
    if (this.config.debug) {
      console.log(`[SubAgentPermissionChecker] Tool "${toolName}" allowed`);
    }

    return {
      allowed: true,
      reason: 'Tool is in allowed list and passed all parent policies',
      canApprove: true,
    };
  }

  /**
   * Filter a list of tools to only those allowed for this agent
   */
  filterAllowedTools(tools: string[]): string[] {
    if (this.allowedTools === 'all') {
      return tools;
    }

    return tools.filter((tool) =>
      this.allowedTools !== 'all' && this.allowedTools.has(tool.toLowerCase())
    );
  }

  /**
   * Get tools that are in agent definition but might be blocked by parent
   */
  async getEffectiveTools(availableTools: string[]): Promise<{
    allowed: string[];
    blocked: Array<{ tool: string; reason: string }>;
  }> {
    const allowed: string[] = [];
    const blocked: Array<{ tool: string; reason: string }> = [];

    // First filter by agent definition
    const agentAllowedTools = this.filterAllowedTools(availableTools);

    // Then check each against parent policies
    for (const tool of agentAllowedTools) {
      const result = await this.checkPermission(tool, {});

      if (result.allowed) {
        allowed.push(tool);
      } else {
        blocked.push({ tool, reason: result.reason });
      }
    }

    return { allowed, blocked };
  }

  /**
   * Create a summary of permissions for logging/display
   */
  getSummary(): {
    agentName: string;
    agentId: string;
    allowedTools: string[] | 'all';
    parentPolicies: string[];
  } {
    return {
      agentName: this.config.agentDefinition.name,
      agentId: this.config.agentId,
      allowedTools: this.getAllowedTools(),
      parentPolicies: this.parentPolicies.map((p) => p.name),
    };
  }
}

/**
 * Create a permission checker for a sub-agent
 *
 * @param agentDefinition Agent definition from TaskToolExecutor
 * @param agentId Unique agent instance ID
 * @param parentSessionId Parent session ID
 * @param parentPolicies Optional parent permission policies to inherit
 */
export function createSubAgentPermissionChecker(
  agentDefinition: AgentDefinition,
  agentId: string,
  parentSessionId: string,
  parentPolicies?: PermissionPolicy[]
): SubAgentPermissionChecker {
  const checker = new SubAgentPermissionChecker({
    agentDefinition,
    agentId,
    parentSessionId,
  });

  if (parentPolicies) {
    checker.setParentPolicies(parentPolicies);
  }

  return checker;
}

/**
 * Validate that an agent definition has valid tool specifications
 */
export function validateAgentTools(
  agentDefinition: AgentDefinition,
  availableTools: string[]
): { valid: boolean; unknownTools: string[] } {
  if (agentDefinition.tools === 'all') {
    return { valid: true, unknownTools: [] };
  }

  const availableSet = new Set(availableTools.map((t) => t.toLowerCase()));
  const unknownTools = agentDefinition.tools.filter(
    (tool) => !availableSet.has(tool.toLowerCase())
  );

  return {
    valid: unknownTools.length === 0,
    unknownTools,
  };
}
