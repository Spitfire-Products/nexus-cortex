/**
 * Permission Policy Evaluator
 *
 * Evaluates multiple permission policies in priority order to make
 * authorization decisions for tool executions.
 *
 * Evaluation Rules:
 * 1. Policies evaluated in descending priority order (higher number first)
 * 2. First `{ allowed: false, canApprove: false }` immediately blocks
 * 3. First `{ allowed: false, canApprove: true }` triggers approval flow
 * 4. If all policies return `{ allowed: true }`, execution proceeds
 *
 * @module permissions/PermissionEvaluator
 */

import type {
  PermissionPolicy,
  PermissionDecision,
  PermissionContext,
} from '../contracts/MiddlewareContracts.js';

/**
 * Options for the permission evaluator
 */
export interface PermissionEvaluatorOptions {
  /**
   * Default policy when no policies match
   * @default 'deny'
   */
  defaultPolicy?: 'allow' | 'deny';

  /**
   * Whether to log evaluation decisions
   * @default false
   */
  enableLogging?: boolean;
}

/**
 * Result of policy evaluation with detailed information
 */
export interface EvaluationResult {
  /**
   * The final permission decision
   */
  decision: PermissionDecision;

  /**
   * The policy that made the decision (if any)
   */
  decidingPolicy?: string;

  /**
   * All policies that were evaluated
   */
  evaluatedPolicies: string[];

  /**
   * Evaluation duration in milliseconds
   */
  durationMs: number;
}

/**
 * Permission Policy Evaluator
 *
 * @example
 * ```typescript
 * const evaluator = new PermissionEvaluator();
 * evaluator.registerPolicy(new WhitelistPolicy(['read_file', 'write_file']));
 * evaluator.registerPolicy(new FileOperationPolicy(['/workspace'], ['/etc']));
 *
 * const result = await evaluator.evaluate({
 *   toolName: 'read_file',
 *   toolInput: { file_path: '/workspace/file.txt' },
 *   sessionId: '123',
 *   timestamp: new Date()
 * });
 * ```
 */
export class PermissionEvaluator {
  private policies: PermissionPolicy[] = [];
  private options: Required<PermissionEvaluatorOptions>;

  constructor(options: PermissionEvaluatorOptions = {}) {
    this.options = {
      defaultPolicy: options.defaultPolicy ?? 'deny',
      enableLogging: options.enableLogging ?? false,
    };
  }

  /**
   * Register a permission policy
   *
   * @param policy The policy to register
   * @throws Error if a policy with the same name already exists
   */
  registerPolicy(policy: PermissionPolicy): void {
    if (this.policies.some((p) => p.name === policy.name)) {
      throw new Error(`Policy with name "${policy.name}" already registered`);
    }

    this.policies.push(policy);
    // Re-sort by priority (descending)
    this.policies.sort((a, b) => b.priority - a.priority);

    if (this.options.enableLogging) {
      console.log(
        `[PermissionEvaluator] Registered policy "${policy.name}" with priority ${policy.priority}`
      );
    }
  }

  /**
   * Unregister a permission policy by name
   *
   * @param policyName The name of the policy to unregister
   * @returns True if the policy was found and removed
   */
  unregisterPolicy(policyName: string): boolean {
    const index = this.policies.findIndex((p) => p.name === policyName);
    if (index === -1) {
      return false;
    }

    this.policies.splice(index, 1);

    if (this.options.enableLogging) {
      console.log(`[PermissionEvaluator] Unregistered policy "${policyName}"`);
    }

    return true;
  }

  /**
   * Get all registered policies
   */
  getPolicies(): ReadonlyArray<PermissionPolicy> {
    return this.policies;
  }

  /**
   * Get a policy by name
   */
  getPolicy(name: string): PermissionPolicy | undefined {
    return this.policies.find((p) => p.name === name);
  }

  /**
   * Clear all registered policies
   */
  clearPolicies(): void {
    this.policies = [];

    if (this.options.enableLogging) {
      console.log('[PermissionEvaluator] Cleared all policies');
    }
  }

  /**
   * Evaluate all policies for a permission context
   *
   * @param context The permission context to evaluate
   * @returns Evaluation result with decision and metadata
   */
  async evaluate(context: PermissionContext): Promise<EvaluationResult> {
    const startTime = Date.now();
    const evaluatedPolicies: string[] = [];

    // If no policies registered, use default policy
    if (this.policies.length === 0) {
      return this.createDefaultResult(startTime, evaluatedPolicies);
    }

    // Evaluate policies in priority order
    for (const policy of this.policies) {
      // Skip disabled policies
      if (!policy.enabled) {
        continue;
      }

      evaluatedPolicies.push(policy.name);

      try {
        const decision = await policy.evaluate(context);

        if (this.options.enableLogging) {
          console.log(
            `[PermissionEvaluator] Policy "${policy.name}" returned:`,
            decision
          );
        }

        // If denied and cannot approve, block immediately
        if (!decision.allowed && !decision.canApprove) {
          return {
            decision,
            decidingPolicy: policy.name,
            evaluatedPolicies,
            durationMs: Date.now() - startTime,
          };
        }

        // If denied but can approve, trigger approval flow
        if (!decision.allowed && decision.canApprove) {
          return {
            decision,
            decidingPolicy: policy.name,
            evaluatedPolicies,
            durationMs: Date.now() - startTime,
          };
        }

        // If allowed with explicit tier, stop evaluating (whitelist/explicit approval)
        if (decision.allowed && decision.tier) {
          return {
            decision,
            decidingPolicy: policy.name,
            evaluatedPolicies,
            durationMs: Date.now() - startTime,
          };
        }

        // If allowed without tier, continue to next policy (pass-through)
      } catch (error) {
        // Policy evaluation error - fail closed (deny)
        console.error(
          `[PermissionEvaluator] Error evaluating policy "${policy.name}":`,
          error
        );

        return {
          decision: {
            allowed: false,
            reason: `Policy evaluation error: ${error instanceof Error ? error.message : 'Unknown error'}`,
            canApprove: false,
          },
          decidingPolicy: policy.name,
          evaluatedPolicies,
          durationMs: Date.now() - startTime,
        };
      }
    }

    // If no policies were evaluated (all disabled), use default policy
    if (evaluatedPolicies.length === 0) {
      return this.createDefaultResult(startTime, evaluatedPolicies);
    }

    // All evaluated policies allowed - proceed with execution
    return {
      decision: { allowed: true },
      decidingPolicy: undefined,
      evaluatedPolicies,
      durationMs: Date.now() - startTime,
    };
  }

  /**
   * Create default result based on default policy setting
   */
  private createDefaultResult(
    startTime: number,
    evaluatedPolicies: string[]
  ): EvaluationResult {
    const decision: PermissionDecision =
      this.options.defaultPolicy === 'allow'
        ? { allowed: true }
        : {
            allowed: false,
            reason: 'No policies registered and default policy is deny',
            canApprove: false,
          };

    return {
      decision,
      decidingPolicy: 'default',
      evaluatedPolicies,
      durationMs: Date.now() - startTime,
    };
  }
}
