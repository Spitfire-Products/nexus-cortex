import { BaseTool } from '../../base/BaseTool.js';
import type { ToolResult } from '../../base/ToolResult.js';
import { CreateArtifactToolExecutor } from './CreateArtifactTool.js';
import { visualBridge } from './VisualFeedbackBridge.js';

/**
 * Parameters for InspectSandbox tool
 */
export interface InspectSandboxParams {
  sandboxId: string;
  captureScreenshot?: boolean;
  captureDOM?: boolean;
  captureConsole?: boolean;
  captureNetwork?: boolean;
  captureAccessibility?: boolean;
  extractData?: boolean;
  dataSelector?: string;
}

/**
 * InspectSandboxTool - Get current state of a running sandbox
 *
 * This tool allows the model to observe sandbox state at any time:
 * - Visual snapshot (screenshot, DOM, console, network)
 * - Process status (running, stopped, error)
 * - Performance metrics
 * - Extracted structured data
 *
 * Use Cases:
 * 1. After editing code - verify changes took effect
 * 2. During debugging - see console errors
 * 3. Performance analysis - check load times
 * 4. Data extraction - pull structured data from UI
 *
 * Example:
 * ```typescript
 * // After model edits code
 * await inspectSandbox({
 *   sandboxId: "abc-123",
 *   captureScreenshot: true
 * });
 * // Model sees updated UI
 * ```
 */
export class InspectSandboxExecutor extends BaseTool<InspectSandboxParams, ToolResult> {
  constructor() {
    const schema = {
      type: 'object' as const,
      properties: {
        sandboxId: {
          type: 'string' as const,
          description: 'Unique ID of the sandbox to inspect'
        },
        captureScreenshot: {
          type: 'boolean' as const,
          description: 'Capture fresh screenshot (default: true)'
        },
        captureDOM: {
          type: 'boolean' as const,
          description: 'Capture DOM structure (default: true)'
        },
        captureConsole: {
          type: 'boolean' as const,
          description: 'Capture console logs (default: true)'
        },
        captureNetwork: {
          type: 'boolean' as const,
          description: 'Capture network requests (default: true)'
        },
        captureAccessibility: {
          type: 'boolean' as const,
          description: 'Capture accessibility tree (default: true)'
        },
        extractData: {
          type: 'boolean' as const,
          description: 'Extract structured data from page (default: false)'
        },
        dataSelector: {
          type: 'string' as const,
          description: 'CSS selector to extract data from (if extractData is true)'
        }
      },
      required: ['sandboxId' as const]
    };

    super(
      'InspectSandbox',
      'InspectSandbox',
      'Get current visual and runtime state of a running sandbox',
      schema
    );
  }

  validateToolParams(params: InspectSandboxParams): string | null {
    if (!params.sandboxId || params.sandboxId.trim().length === 0) {
      return 'sandboxId is required';
    }

    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(params.sandboxId)) {
      return 'sandboxId must be a valid UUID';
    }

    return null;
  }

  async execute(params: InspectSandboxParams, signal: AbortSignal): Promise<ToolResult> {
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

      // Check if process is still running
      const isRunning = session.process && !session.process.killed;

      if (!isRunning) {
        return {
          ...this.createErrorResult('Sandbox process is not running'),
          metadata: {
            sandboxId: params.sandboxId,
            status: 'stopped',
            lastActivity: session.lastActivity
          }
        };
      }

      // Determine what to capture (defaults)
      const captureScreenshot = params.captureScreenshot ?? true;
      const captureDOM = params.captureDOM ?? true;
      const captureConsole = params.captureConsole ?? true;
      const captureNetwork = params.captureNetwork ?? true;
      const captureAccessibility = params.captureAccessibility ?? true;

      // Capture fresh snapshot if requested
      let snapshot = session.visualSnapshot;

      if (captureScreenshot || captureDOM || captureConsole || captureNetwork || captureAccessibility) {
        if (!session.url) {
          return this.createErrorResult('Sandbox has no URL (not a web server)');
        }

        try {
          // Initialize bridge if needed
          await visualBridge.initialize();

          // Capture full snapshot
          snapshot = await visualBridge.captureSnapshot(session.url);

          // Update session
          session.visualSnapshot = snapshot;
          session.lastActivity = new Date();
        } catch (error) {
          return this.createErrorResult(
            `Failed to capture visual snapshot: ${(error as Error).message}`
          );
        }
      }

      // Extract structured data if requested
      let extractedData: any = null;
      if (params.extractData) {
        try {
          await visualBridge.initialize();
          extractedData = await visualBridge.extractData(params.dataSelector);
        } catch (error) {
          console.warn(`Failed to extract data: ${error}`);
        }
      }

      // Format output
      const output = this.formatInspectionOutput(
        session,
        snapshot,
        extractedData,
        {
          captureScreenshot,
          captureDOM,
          captureConsole,
          captureNetwork,
          captureAccessibility,
          extractData: params.extractData || false
        }
      );

      return {
        ...this.createSuccessResult(output),
        metadata: {
          executionTime: Date.now() - startTime,
          sandboxId: params.sandboxId,
          sandboxName: session.name,
          url: session.url,
          status: 'running',
          uptime: Date.now() - session.startTime.getTime(),
          hasVisualSnapshot: !!snapshot,
          hasExtractedData: !!extractedData
        }
      };
    } catch (error) {
      return this.createErrorResult(`Failed to inspect sandbox: ${(error as Error).message}`);
    }
  }

  /**
   * Format inspection output for model consumption
   */
  private formatInspectionOutput(
    session: any,
    snapshot: any,
    extractedData: any,
    options: {
      captureScreenshot: boolean;
      captureDOM: boolean;
      captureConsole: boolean;
      captureNetwork: boolean;
      captureAccessibility: boolean;
      extractData: boolean;
    }
  ): string {
    const lines: string[] = [];

    lines.push(`#  Sandbox Inspection: ${session.name}`);
    lines.push('');
    lines.push(`**Sandbox ID**: ${session.id}`);
    lines.push(`**Status**: Running`);
    lines.push(`**URL**: ${session.url}`);
    lines.push(`**Mode**: ${session.mode}`);
    lines.push(`**Uptime**: ${this.formatUptime(Date.now() - session.startTime.getTime())}`);
    lines.push('');

    if (snapshot) {
      lines.push('---');
      lines.push('');
      lines.push('##  Visual Snapshot');
      lines.push('');

      // Use VisualFeedbackBridge's formatter
      lines.push(visualBridge.formatForModel(snapshot));
      lines.push('');
    }

    if (extractedData && options.extractData) {
      lines.push('---');
      lines.push('');
      lines.push('##  Extracted Data');
      lines.push('');
      lines.push('```json');
      lines.push(JSON.stringify(extractedData, null, 2));
      lines.push('```');
      lines.push('');
    }

    lines.push('---');
    lines.push('');
    lines.push('**Note**: This is the current state of the sandbox. You can:');
    lines.push('- Edit code (Use write tool) → Hot reload will trigger automatically');
    lines.push('- Interact with UI (Use interact_with_sandbox tool)');
    lines.push('- Re-inspect anytime (Call inspect_sandbox again)');
    lines.push('- Stop sandbox (Use stop_sandbox tool)');

    return lines.join('\n');
  }

  /**
   * Format uptime in human-readable format
   */
  private formatUptime(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }
}
