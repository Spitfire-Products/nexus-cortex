import { BaseTool } from '../../base/BaseTool.js';
import type { ToolResult } from '../../base/ToolResult.js';
import { CreateArtifactToolExecutor } from './CreateArtifactTool.js';
import { visualBridge } from './VisualFeedbackBridge.js';
import { promises as fs } from 'fs';
import { join } from 'path';

/**
 * Parameters for StopSandbox tool
 */
export interface StopSandboxParams {
  sandboxId: string;
  cleanup?: boolean;
  captureFinalSnapshot?: boolean;
}

/**
 * StopSandboxTool - Stop a running sandbox and optionally cleanup
 *
 * This tool stops the sandbox process and cleans up resources:
 * - Kills the running Node.js/Python process
 * - Closes file watchers (hot reload)
 * - Optionally captures final snapshot
 * - Optionally deletes sandbox directory
 * - Closes Playwright browser if no other sandboxes need it
 *
 * Use Cases:
 * 1. Finished development - Stop sandbox when done
 * 2. Free resources - Stop unused sandboxes
 * 3. Clean slate - Stop and cleanup for fresh start
 * 4. Error recovery - Stop crashed sandbox
 *
 * Example:
 * ```typescript
 * // Model finishes work
 * await stopSandbox({
 *   sandboxId: "abc-123",
 *   cleanup: true,  // Delete sandbox directory
 *   captureFinalSnapshot: true  // Save final state
 * });
 * ```
 */
export class StopSandboxExecutor extends BaseTool<StopSandboxParams, ToolResult> {
  private sandboxDir: string;

  constructor(config: { workingDirectory: string }) {
    const schema = {
      type: 'object' as const,
      properties: {
        sandboxId: {
          type: 'string' as const,
          description: 'Unique ID of the sandbox to stop'
        },
        cleanup: {
          type: 'boolean' as const,
          description: 'Delete sandbox directory after stopping (default: false)'
        },
        captureFinalSnapshot: {
          type: 'boolean' as const,
          description: 'Capture final visual snapshot before stopping (default: false)'
        }
      },
      required: ['sandboxId' as const]
    };

    super(
      'StopSandbox',
      'StopSandbox',
      'Stop a running sandbox and optionally cleanup resources',
      schema
    );

    this.sandboxDir = join(config.workingDirectory, '.addon-tools');
  }

  validateToolParams(params: StopSandboxParams): string | null {
    if (!params.sandboxId || params.sandboxId.trim().length === 0) {
      return 'sandboxId is required';
    }

    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(params.sandboxId)) {
      return 'sandboxId must be a valid UUID';
    }

    return null;
  }

  async execute(params: StopSandboxParams, signal: AbortSignal): Promise<ToolResult> {
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
          `Sandbox not found: ${params.sandboxId}. It may already be stopped.`
        );
      }

      // Capture final snapshot if requested
      let finalSnapshot: any = null;
      if (params.captureFinalSnapshot && session.url) {
        try {
          await visualBridge.initialize();
          finalSnapshot = await visualBridge.captureSnapshot(session.url);
        } catch (error) {
          console.warn('Could not capture final snapshot:', error);
        }
      }

      // Collect session info before stopping
      const sessionInfo = {
        id: session.id,
        name: session.name,
        url: session.url,
        port: session.port,
        mode: session.mode,
        uptime: Date.now() - session.startTime.getTime(),
        startTime: session.startTime,
        lastActivity: session.lastActivity
      };

      // Stop the sandbox (kills process, closes watchers)
      const stopped = CreateArtifactToolExecutor.stopSandbox(params.sandboxId);

      if (!stopped) {
        return this.createErrorResult('Failed to stop sandbox (unknown reason)');
      }

      // Cleanup sandbox directory if requested
      let cleanedUp = false;
      let bytesFreed = 0;

      if (params.cleanup) {
        const sandboxPath = join(this.sandboxDir, params.sandboxId);

        try {
          // Calculate size before deletion
          const files = await this.getDirectorySize(sandboxPath);
          bytesFreed = files.totalSize;

          // Delete directory
          await fs.rm(sandboxPath, { recursive: true, force: true });
          cleanedUp = true;
        } catch (error) {
          console.warn(`Could not cleanup sandbox directory: ${error}`);
          // Don't fail the whole operation if cleanup fails
        }
      }

      // Check if we should close Playwright browser
      const activeSandboxes = CreateArtifactToolExecutor.listActiveSandboxes();
      if (activeSandboxes.length === 0) {
        // No more sandboxes, close browser to free memory
        try {
          await visualBridge.close();
        } catch (error) {
          console.warn('Could not close browser:', error);
        }
      }

      // Format output
      const output = this.formatStopOutput(
        sessionInfo,
        finalSnapshot,
        cleanedUp,
        bytesFreed
      );

      return {
        ...this.createSuccessResult(output),
        metadata: {
          executionTime: Date.now() - startTime,
          sandboxId: params.sandboxId,
          sandboxName: sessionInfo.name,
          uptime: sessionInfo.uptime,
          stopped: true,
          cleanedUp,
          bytesFreed,
          hasFinalSnapshot: !!finalSnapshot
        }
      };
    } catch (error) {
      return this.createErrorResult(`Failed to stop sandbox: ${(error as Error).message}`);
    }
  }

  /**
   * Calculate directory size recursively
   */
  private async getDirectorySize(dirPath: string): Promise<{ totalSize: number; fileCount: number }> {
    let totalSize = 0;
    let fileCount = 0;

    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = join(dirPath, entry.name);

        if (entry.isDirectory()) {
          const subDir = await this.getDirectorySize(fullPath);
          totalSize += subDir.totalSize;
          fileCount += subDir.fileCount;
        } else {
          const stats = await fs.stat(fullPath);
          totalSize += stats.size;
          fileCount++;
        }
      }
    } catch (error) {
      console.warn(`Error calculating directory size: ${error}`);
    }

    return { totalSize, fileCount };
  }

  /**
   * Format human-readable file size
   */
  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 Bytes';

    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  }

  /**
   * Format uptime in human-readable format
   */
  private formatUptime(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }

  /**
   * Format stop output for model consumption
   */
  private formatStopOutput(
    sessionInfo: any,
    finalSnapshot: any,
    cleanedUp: boolean,
    bytesFreed: number
  ): string {
    const lines: string[] = [];

    lines.push(`#  Sandbox Stopped: ${sessionInfo.name}`);
    lines.push('');
    lines.push(`**Sandbox ID**: ${sessionInfo.id}`);
    lines.push(`**Status**: Stopped`);
    lines.push(`**Total Uptime**: ${this.formatUptime(sessionInfo.uptime)}`);
    lines.push(`**Started**: ${sessionInfo.startTime.toISOString()}`);
    lines.push(`**Last Activity**: ${sessionInfo.lastActivity.toISOString()}`);
    lines.push('');

    if (finalSnapshot) {
      lines.push('---');
      lines.push('');
      lines.push('##  Final Snapshot');
      lines.push('');
      lines.push(visualBridge.formatForModel(finalSnapshot));
      lines.push('');
    }

    if (cleanedUp) {
      lines.push('---');
      lines.push('');
      lines.push('##  Cleanup');
      lines.push('');
      lines.push(`[OK] Sandbox directory deleted`);
      lines.push(`[OK] Disk space freed: ${this.formatBytes(bytesFreed)}`);
      lines.push('');
    }

    lines.push('---');
    lines.push('');
    lines.push('**Summary**:');
    lines.push('- [OK] Process terminated');
    lines.push('- [OK] File watchers closed');
    lines.push('- [OK] Resources freed');
    if (cleanedUp) {
      lines.push('- [OK] Files cleaned up');
    }
    lines.push('');

    lines.push('The sandbox is now fully stopped and removed from active sessions.');

    return lines.join('\n');
  }
}
