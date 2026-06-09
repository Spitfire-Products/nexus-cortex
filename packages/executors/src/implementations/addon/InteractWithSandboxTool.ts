import { BaseTool } from '../../base/BaseTool.js';
import type { ToolResult } from '../../base/ToolResult.js';
import { CreateArtifactToolExecutor } from './CreateArtifactTool.js';
import { visualBridge, InteractionCommand } from './VisualFeedbackBridge.js';
import { broadcaster } from './SandboxEventBroadcaster.js';

/**
 * Parameters for InteractWithSandbox tool
 */
export interface InteractWithSandboxParams {
  sandboxId: string;
  actions: Array<{
    type: 'click' | 'type' | 'navigate' | 'scroll' | 'hover' | 'select' | 'wait' | 'keypress' | 'zoom';
    selector?: string;
    value?: string;
    coordinates?: { x: number; y: number };
    duration?: number;
    key?: string;           // For keypress: 'Enter', 'Escape', 'Ctrl+V', etc.
    modifiers?: string[];   // For keypress: ['Control', 'Shift']
    zoomLevel?: number;     // For zoom: 1.0 = 100%, 1.5 = 150%
    deltaX?: number;        // For scroll: horizontal delta
    deltaY?: number;        // For scroll: vertical delta
  }>;
  captureAfterEachAction?: boolean;
  returnFinalSnapshot?: boolean;
}

/**
 * InteractWithSandboxTool - Interact with sandbox UI via Playwright
 *
 * This tool allows the model to interact with the sandbox UI programmatically:
 * - Click buttons, links, elements
 * - Type into inputs, textareas
 * - Navigate to different URLs
 * - Scroll, hover, select
 * - Wait for animations/updates
 * - Press keyboard shortcuts (Ctrl+V, Ctrl+S, etc.)
 * - Zoom in/out
 *
 * Use Cases:
 * 1. Testing - Click buttons to verify functionality
 * 2. Form filling - Type into inputs to test forms
 * 3. Navigation - Test multi-page flows
 * 4. Data entry - Populate UI with test data
 * 5. Visual regression - Capture UI states during interactions
 * 6. Code pasting - Paste code snippets with Ctrl+V
 * 7. Visual inspection - Zoom to see details
 *
 * Example:
 * ```typescript
 * // Model tests a form
 * await interactWithSandbox({
 *   sandboxId: "abc-123",
 *   actions: [
 *     { type: "type", selector: "#username", value: "testuser" },
 *     { type: "type", selector: "#password", value: "pass123" },
 *     { type: "click", selector: "#submit-btn" },
 *     { type: "wait", duration: 1000 }
 *   ],
 *   returnFinalSnapshot: true
 * });
 *
 * // Model pastes code into editor
 * await interactWithSandbox({
 *   sandboxId: "abc-123",
 *   actions: [
 *     { type: "click", selector: "#code-editor" },
 *     { type: "keypress", key: "Ctrl+V" },  // Paste from clipboard
 *     { type: "keypress", key: "Ctrl+S" },  // Save
 *     { type: "zoom", zoomLevel: 1.5 }       // Zoom 150%
 *   ]
 * });
 * ```
 */
export class InteractWithSandboxExecutor extends BaseTool<InteractWithSandboxParams, ToolResult> {
  constructor() {
    const schema = {
      type: 'object' as const,
      properties: {
        sandboxId: {
          type: 'string' as const,
          description: 'Unique ID of the sandbox to interact with'
        },
        actions: {
          type: 'array' as const,
          items: {
            type: 'object' as const,
            properties: {
              type: {
                type: 'string' as const,
                enum: ['click', 'type', 'navigate', 'scroll', 'hover', 'select', 'wait', 'keypress', 'zoom'],
                description: 'Type of interaction'
              },
              selector: {
                type: 'string' as const,
                description: 'CSS selector for the element (required for most actions)'
              },
              value: {
                type: 'string' as const,
                description: 'Value to type or select (for type/select actions)'
              },
              coordinates: {
                type: 'object' as const,
                properties: {
                  x: { type: 'number' as const },
                  y: { type: 'number' as const }
                },
                description: 'Screen coordinates (for click without selector)'
              },
              duration: {
                type: 'number' as const,
                description: 'Duration in milliseconds (for wait action)'
              },
              key: {
                type: 'string' as const,
                description: 'Key to press (for keypress action): Enter, Escape, Ctrl+V, etc.'
              },
              modifiers: {
                type: 'array' as const,
                items: { type: 'string' as const },
                description: 'Modifier keys (for keypress action): Control, Shift, Alt, Meta'
              },
              zoomLevel: {
                type: 'number' as const,
                description: 'Zoom level (for zoom action): 1.0 = 100%, 1.5 = 150%, 0.5 = 50%'
              },
              deltaX: {
                type: 'number' as const,
                description: 'Horizontal scroll delta (for scroll action)'
              },
              deltaY: {
                type: 'number' as const,
                description: 'Vertical scroll delta (for scroll action)'
              }
            },
            required: ['type' as const]
          },
          description: 'Sequence of actions to perform'
        },
        captureAfterEachAction: {
          type: 'boolean' as const,
          description: 'Capture screenshot after each action (default: false, useful for debugging)'
        },
        returnFinalSnapshot: {
          type: 'boolean' as const,
          description: 'Return visual snapshot after all actions complete (default: true)'
        }
      },
      required: ['sandboxId' as const, 'actions' as const]
    };

    super(
      'InteractWithSandbox',
      'InteractWithSandbox',
      'Interact with sandbox UI (click, type, navigate, etc.) via browser automation',
      schema
    );
  }

  validateToolParams(params: InteractWithSandboxParams): string | null {
    if (!params.sandboxId || params.sandboxId.trim().length === 0) {
      return 'sandboxId is required';
    }

    if (!params.actions || params.actions.length === 0) {
      return 'actions array cannot be empty';
    }

    // Validate each action
    for (let i = 0; i < params.actions.length; i++) {
      const action = params.actions[i];

      if (!action) {
        return `Action ${i}: action is undefined`;
      }

      if (!action.type) {
        return `Action ${i}: type is required`;
      }

      // Validate action-specific requirements
      if (action.type === 'click' && !action.selector && !action.coordinates) {
        return `Action ${i}: click requires either selector or coordinates`;
      }

      if (action.type === 'type' && !action.selector) {
        return `Action ${i}: type requires selector`;
      }

      if (action.type === 'type' && !action.value) {
        return `Action ${i}: type requires value`;
      }

      if (action.type === 'navigate' && !action.value) {
        return `Action ${i}: navigate requires value (URL)`;
      }

      if (action.type === 'scroll' && !action.coordinates && !action.selector) {
        return `Action ${i}: scroll requires coordinates or selector`;
      }

      if (action.type === 'select' && (!action.selector || !action.value)) {
        return `Action ${i}: select requires selector and value`;
      }

      if (action.type === 'wait' && !action.duration) {
        return `Action ${i}: wait requires duration in milliseconds`;
      }
    }

    return null;
  }

  async execute(params: InteractWithSandboxParams, signal: AbortSignal): Promise<ToolResult> {
    const startTime = Date.now();

    const validationError = this.validateToolParams(params);
    if (validationError) {
      return this.createErrorResult(validationError);
    }

    try {
      // Get sandbox session
      const session = CreateArtifactToolExecutor.getActiveSandbox(params.sandboxId);

      if (!session) {
        return this.createErrorResult(
          `Sandbox not found: ${params.sandboxId}. It may have been stopped or never existed.`
        );
      }

      if (!session.url) {
        return this.createErrorResult('Sandbox has no URL (not a web server)');
      }

      // Initialize visual bridge
      await visualBridge.initialize();

      // Navigate to sandbox URL first
      const currentPage = (visualBridge as any).page;
      if (!currentPage || currentPage.url() !== session.url) {
        await visualBridge.captureSnapshot(session.url);
      }

      // Execute actions
      const actionResults: string[] = [];
      const snapshots: any[] = [];
      const captureAfterEach = params.captureAfterEachAction ?? false;

      for (let i = 0; i < params.actions.length; i++) {
        const action = params.actions[i];

        if (!action) continue;

        try {
          // Execute action
          await this.executeAction(action, session.url);

          actionResults.push(`[OK] Action ${i + 1}: ${action.type} ${action.selector || ''}`);

          // Emit interaction executed event
          broadcaster.emitInteraction(params.sandboxId, action.type, action.selector, true);

          // Capture snapshot if requested
          if (captureAfterEach) {
            const snapshot = await visualBridge.captureSnapshot(session.url);
            snapshots.push({
              actionIndex: i,
              actionType: action.type,
              snapshot
            });

            // Emit screenshot captured event
            broadcaster.emitScreenshot(params.sandboxId, snapshot.screenshot, session.url);
          }

          // Check for abort signal
          if (signal.aborted) {
            throw new Error('Interaction aborted by user');
          }
        } catch (error) {
          actionResults.push(`[ERROR] Action ${i + 1}: ${action.type} - ${(error as Error).message}`);

          // Emit failed interaction event
          broadcaster.emitInteraction(params.sandboxId, action.type, action.selector, false);
          broadcaster.emitError(params.sandboxId, error as Error);

          // Continue or stop on error?
          // For now, continue but report the error
          console.error(`Action ${i} failed:`, error);
        }
      }

      // Capture final snapshot if requested
      let finalSnapshot: any = null;
      const returnFinalSnapshot = params.returnFinalSnapshot ?? true;

      if (returnFinalSnapshot) {
        finalSnapshot = await visualBridge.captureSnapshot(session.url);
        session.visualSnapshot = finalSnapshot;
        session.lastActivity = new Date();

        // Emit screenshot captured event
        broadcaster.emitScreenshot(params.sandboxId, finalSnapshot.screenshot, session.url);
      }

      // Format output
      const output = this.formatInteractionOutput(
        session,
        params.actions,
        actionResults,
        snapshots,
        finalSnapshot
      );

      return {
        ...this.createSuccessResult(output),
        metadata: {
          executionTime: Date.now() - startTime,
          sandboxId: params.sandboxId,
          actionsExecuted: params.actions.length,
          actionsSucceeded: actionResults.filter(r => r.startsWith('[OK]')).length,
          actionsFailed: actionResults.filter(r => r.startsWith('[ERROR]')).length,
          snapshotsCaptured: snapshots.length + (finalSnapshot ? 1 : 0)
        }
      };
    } catch (error) {
      return this.createErrorResult(`Failed to interact with sandbox: ${(error as Error).message}`);
    }
  }

  /**
   * Execute a single interaction action
   */
  private async executeAction(action: any, baseUrl: string): Promise<void> {
    const interactionCommand: InteractionCommand = {
      type: action.type as any,
      selector: action.selector,
      value: action.value,
      coordinates: action.coordinates
    };

    switch (action.type) {
      case 'click':
        await visualBridge.interact(interactionCommand);
        // Wait a bit for click effects
        await this.wait(500);
        break;

      case 'type':
        await visualBridge.interact(interactionCommand);
        // Wait a bit for typing effects
        await this.wait(300);
        break;

      case 'navigate':
        // Navigate to URL (absolute or relative to baseUrl)
        const targetUrl = action.value.startsWith('http')
          ? action.value
          : new URL(action.value, baseUrl).toString();
        await visualBridge.interact({ type: 'navigate', value: targetUrl });
        await this.wait(1000);
        break;

      case 'scroll':
        await visualBridge.interact(interactionCommand);
        await this.wait(300);
        break;

      case 'hover':
        await visualBridge.interact({ type: 'click', selector: action.selector });
        await this.wait(200);
        break;

      case 'select':
        await visualBridge.interact(interactionCommand);
        await this.wait(300);
        break;

      case 'wait':
        await this.wait(action.duration);
        break;

      default:
        throw new Error(`Unknown action type: ${action.type}`);
    }
  }

  /**
   * Wait helper
   */
  private wait(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Format interaction output for model consumption
   */
  private formatInteractionOutput(
    session: any,
    actions: any[],
    actionResults: string[],
    snapshots: any[],
    finalSnapshot: any
  ): string {
    const lines: string[] = [];

    lines.push(`#  Sandbox Interaction: ${session.name}`);
    lines.push('');
    lines.push(`**Sandbox ID**: ${session.id}`);
    lines.push(`**URL**: ${session.url}`);
    lines.push(`**Actions Executed**: ${actions.length}`);
    lines.push('');

    lines.push('##  Action Results');
    lines.push('');
    actionResults.forEach(result => {
      lines.push(result);
    });
    lines.push('');

    // Show intermediate snapshots if captured
    if (snapshots.length > 0) {
      lines.push('---');
      lines.push('');
      lines.push('##  Intermediate Snapshots');
      lines.push('');
      snapshots.forEach((snap, idx) => {
        lines.push(`### After Action ${snap.actionIndex + 1} (${snap.actionType})`);
        lines.push('');
        lines.push(`**Screenshot**: [Base64 PNG ${snap.snapshot.screenshot.length} bytes]`);
        lines.push('');
      });
    }

    // Show final snapshot
    if (finalSnapshot) {
      lines.push('---');
      lines.push('');
      lines.push('##  Final Visual State');
      lines.push('');
      lines.push(visualBridge.formatForModel(finalSnapshot));
      lines.push('');
    }

    lines.push('---');
    lines.push('');
    lines.push('**Next Steps**:');
    lines.push('- Inspect current state (Use inspect_sandbox)');
    lines.push('- Continue interactions (Call interact_with_sandbox again)');
    lines.push('- Edit code based on observations (Use write tool)');

    return lines.join('\n');
  }
}
