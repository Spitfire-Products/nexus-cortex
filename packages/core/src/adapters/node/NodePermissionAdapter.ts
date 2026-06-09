/**
 * Node.js PermissionHandler Adapter
 *
 * Wraps PermissionsMiddleware behind the PermissionHandler interface.
 * Maps checkPermission() → evaluate() and builds MiddlewareContext.
 *
 * @module adapters/node/NodePermissionAdapter
 */

import type {
  PermissionHandler,
  PermissionDecision as InterfacePermissionDecision,
  PermissionPolicy as InterfacePermissionPolicy
} from '../../interfaces/PermissionHandler.js';
import type { PermissionsMiddleware } from '../../middleware/PermissionsMiddleware.js';

export class NodePermissionAdapter implements PermissionHandler {
  constructor(private middleware: PermissionsMiddleware) {}

  async evaluate(context: {
    toolName: string;
    toolInput: any;
    sessionId: string;
  }): Promise<InterfacePermissionDecision> {
    // Build a minimal MiddlewareContext from the interface context
    const middlewareContext = {
      sessionId: context.sessionId,
      conversationId: '',
      turnNumber: 0,
      modelId: '',
      config: {} as any,
    };

    const decision = await this.middleware.checkPermission(
      context.toolName,
      context.toolInput,
      middlewareContext
    );

    // Map the discriminated union to the interface shape
    if (decision.allowed) {
      return { allowed: true };
    }

    return {
      allowed: false,
      canApprove: 'canApprove' in decision ? decision.canApprove : false,
      reason: 'reason' in decision ? decision.reason : 'Permission denied',
      tier: 'tier' in decision ? decision.tier : undefined,
    };
  }

  registerPolicy(policy: InterfacePermissionPolicy): void {
    this.middleware.registerPolicy(policy as any);
  }
}
