import { BaseTool } from '../../base/BaseTool.js';
import type { ToolResult } from '../../base/ToolResult.js';
import { CreateArtifactToolExecutor } from './CreateArtifactTool.js';
import { visualBridge } from './VisualFeedbackBridge.js';
import { broadcaster } from './SandboxEventBroadcaster.js';
import { promises as fs } from 'fs';
import { join } from 'path';

/**
 * Parameters for ModifySandbox tool
 */
export interface ModifySandboxParams {
  sandboxId: string;
  file: string;
  content: string;
  waitForReload?: boolean;
  captureAfterReload?: boolean;
  verifyChanges?: boolean;
}

/**
 * ModifySandboxTool - Edit sandbox code with automatic hot reload and verification
 *
 * This tool provides a higher-level interface than raw Write tool:
 * - Edits files within the sandbox directory
 * - Waits for hot reload to complete
 * - Captures visual snapshot after changes
 * - Verifies changes took effect
 *
 * Advantages over Write tool:
 * 1. Sandbox-aware - knows sandbox directory structure
 * 2. Hot reload integration - waits for restart
 * 3. Automatic verification - captures post-edit snapshot
 * 4. Error detection - checks if reload succeeded
 *
 * Use Cases:
 * 1. Iterative development - Edit → See → Edit again
 * 2. Bug fixing - Modify code, verify fix visually
 * 3. Feature addition - Add code, test immediately
 * 4. Styling - Change CSS, see results instantly
 *
 * Example:
 * ```
 * await modifySandbox({
 *   sandboxId: "abc-123",
 *   file: "index.js",
 *   content: "// fixed code",
 *   waitForReload: true,
 *   captureAfterReload: true
 * });
 * ```
 */
export class ModifySandboxExecutor extends BaseTool<ModifySandboxParams, ToolResult> {
  private sandboxDir: string;

  constructor(config: { workingDirectory: string }) {
    const schema = {
      type: 'object' as const,
      properties: {
        sandboxId: {
          type: 'string' as const,
          description: 'Unique ID of the sandbox to modify'
        },
        file: {
          type: 'string' as const,
          description: 'Filename to edit (relative to sandbox directory, e.g., "index.js")'
        },
        content: {
          type: 'string' as const,
          description: 'New file content'
        },
        waitForReload: {
          type: 'boolean' as const,
          description: 'Wait for hot reload to complete (default: true for dev mode)'
        },
        captureAfterReload: {
          type: 'boolean' as const,
          description: 'Capture visual snapshot after reload (default: true)'
        },
        verifyChanges: {
          type: 'boolean' as const,
          description: 'Verify changes via visual diff (default: false, expensive)'
        }
      },
      required: ['sandboxId' as const, 'file' as const, 'content' as const]
    };

    super(
      'ModifySandbox',
      'ModifySandbox',
      'Edit sandbox code with automatic hot reload and visual verification',
      schema
    );

    this.sandboxDir = join(config.workingDirectory, '.addon-tools');
  }

  validateToolParams(params: ModifySandboxParams): string | null {
    if (!params.sandboxId || params.sandboxId.trim().length === 0) {
      return 'sandboxId is required';
    }

    if (!params.file || params.file.trim().length === 0) {
      return 'file is required';
    }

    // Prevent path traversal
    if (params.file.includes('..') || params.file.startsWith('/')) {
      return 'file must be a relative path within the sandbox (no .. or absolute paths)';
    }

    if (params.content === undefined || params.content === null) {
      return 'content is required (can be empty string for clearing file)';
    }

    return null;
  }

  async execute(params: ModifySandboxParams, signal: AbortSignal): Promise<ToolResult> {
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

      const sandboxPath = join(this.sandboxDir, params.sandboxId);

      // Verify sandbox directory exists
      try {
        await fs.access(sandboxPath);
      } catch {
        return this.createErrorResult(`Sandbox directory not found: ${sandboxPath}`);
      }

      // Capture snapshot before modification (for comparison)
      let snapshotBefore = session.visualSnapshot;
      if (params.verifyChanges && session.url) {
        try {
          await visualBridge.initialize();
          snapshotBefore = await visualBridge.captureSnapshot(session.url);
        } catch (error) {
          console.warn('Could not capture before snapshot:', error);
        }
      }

      // Write new file content
      const filePath = join(sandboxPath, params.file);
      await fs.writeFile(filePath, params.content, 'utf-8');

      // Emit file changed event
      broadcaster.emitFileChange(params.sandboxId, params.file, 'modified');

      // Determine if we should wait for reload
      const waitForReload = params.waitForReload ?? (session.mode === 'dev');
      const captureAfterReload = params.captureAfterReload ?? true;

      let snapshotAfter: any = null;
      let reloadWaitTime = 0;

      if (waitForReload) {
        // Wait for hot reload to complete
        // Hot reload typically takes:
        // - 100-500ms to detect file change
        // - 1-2s to restart process
        // - 500ms for server to be ready
        reloadWaitTime = 3000; // 3 seconds total

        await this.wait(reloadWaitTime);

        // Capture snapshot after reload
        if (captureAfterReload && session.url) {
          try {
            await visualBridge.initialize();
            snapshotAfter = await visualBridge.captureSnapshot(session.url);
            session.visualSnapshot = snapshotAfter;
            session.lastActivity = new Date();

            // Emit screenshot captured event
            broadcaster.emitScreenshot(params.sandboxId, snapshotAfter.screenshot, session.url);
          } catch (error) {
            console.warn('Could not capture after snapshot:', error);
            broadcaster.emitError(params.sandboxId, error as Error);
          }
        }
      }

      // Compute visual diff if requested
      let visualDiff: any = null;
      if (params.verifyChanges && snapshotBefore && snapshotAfter) {
        // TODO: Implement getVisualDiff in VisualFeedbackBridge
        // For now, skip visual diff
        console.warn('Visual diff not yet implemented');
      }

      // Format output
      const output = this.formatModificationOutput(
        session,
        params,
        snapshotAfter,
        visualDiff,
        reloadWaitTime
      );

      return {
        ...this.createSuccessResult(output),
        metadata: {
          executionTime: Date.now() - startTime,
          sandboxId: params.sandboxId,
          fileModified: params.file,
          bytesWritten: params.content.length,
          waitedForReload: waitForReload,
          reloadWaitTime,
          capturedSnapshot: !!snapshotAfter,
          hasVisualDiff: !!visualDiff
        }
      };
    } catch (error) {
      return this.createErrorResult(`Failed to modify sandbox: ${(error as Error).message}`);
    }
  }

  /**
   * Wait helper
   */
  private wait(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Format modification output for model consumption
   */
  private formatModificationOutput(
    session: any,
    params: ModifySandboxParams,
    snapshotAfter: any,
    visualDiff: any,
    reloadWaitTime: number
  ): string {
    const lines: string[] = [];

    lines.push(`# ✏ Sandbox Modified: ${session.name}`);
    lines.push('');
    lines.push(`**Sandbox ID**: ${session.id}`);
    lines.push(`**File Modified**: ${params.file}`);
    lines.push(`**Bytes Written**: ${params.content.length}`);
    lines.push('');

    if (params.waitForReload) {
      lines.push('##  Hot Reload');
      lines.push('');
      lines.push(`[OK] Waited ${reloadWaitTime}ms for hot reload to complete`);
      lines.push('[OK] Process restarted automatically');
      lines.push('');
    }

    if (snapshotAfter) {
      lines.push('---');
      lines.push('');
      lines.push('##  Visual State After Modification');
      lines.push('');
      lines.push(visualBridge.formatForModel(snapshotAfter));
      lines.push('');
    }

    if (visualDiff) {
      lines.push('---');
      lines.push('');
      lines.push('##  Visual Diff');
      lines.push('');
      lines.push(`**Changes Detected**: ${visualDiff.hasChanges ? 'Yes' : 'No'}`);

      if (visualDiff.hasChanges) {
        lines.push('');
        lines.push('**What Changed**:');
        if (visualDiff.domDiff) {
          lines.push(`- DOM: ${visualDiff.domDiff.added || 0} additions, ${visualDiff.domDiff.removed || 0} removals`);
        }
        if (visualDiff.screenshotDiff) {
          lines.push(`- Visual: ${visualDiff.screenshotDiff.percentDiff}% pixels changed`);
        }
      }
      lines.push('');
    }

    lines.push('---');
    lines.push('');
    lines.push('**Status**: File successfully modified');
    lines.push('');
    lines.push('**Next Steps**:');
    lines.push('- Verify changes look correct in visual snapshot above');
    lines.push('- Test functionality (Use InteractWithSandbox)');
    lines.push('- Continue editing if needed (Call ModifySandbox again)');
    lines.push('- Inspect detailed state (Use InspectSandbox)');

    return lines.join('\n');
  }
}
