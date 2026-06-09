/**
 * SandboxTransfer Tool Executor
 *
 * Runs a command in a remote sandbox (via MCP run_command), captures its
 * stdout, and writes the output to the local filesystem.  Closes the loop
 * between sandbox-generated artifacts (PDFs, images, data) and local files.
 *
 * Uses late-bound mcpManagerGetter injected into ExecutorConfig by
 * OrchestratorFactory after MCP initialisation.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { BaseTool, type ToolResult } from '../../base/index.js';
import { SchemaValidator } from '../../utils/SchemaValidator.js';
import {
  makeRelative,
  shortenPath,
  resolveFilePath,
} from '../../utils/FileUtils.js';
import type { ExecutorConfig } from '../../base/ToolRegistry.js';

const MIME_FROM_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
  '.wasm': 'application/wasm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.json': 'application/json',
  '.csv': 'text/csv',
  '.txt': 'text/plain',
  '.html': 'text/html',
};

export interface SandboxTransferParams {
  command: string;
  local_path: string;
  encoding?: 'base64' | 'utf8';
  mime_type?: string;
  timeout?: number;
  server?: string;
}

export class SandboxTransferTool extends BaseTool<SandboxTransferParams, ToolResult> {
  constructor(private config: ExecutorConfig) {
    super(
      'SandboxTransfer',
      'SandboxTransfer',
      'Run a command in the sandbox and save its stdout to a local file.',
      {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description:
              'Shell command to execute in the sandbox. Stdout is captured and written to local_path.',
          },
          local_path: {
            type: 'string',
            description:
              'Local file path to write the captured output to. Parent directories are created automatically.',
          },
          encoding: {
            type: 'string',
            enum: ['base64', 'utf8'],
            description:
              'How to interpret stdout. "base64" (default) decodes to binary. "utf8" writes raw text.',
          },
          mime_type: {
            type: 'string',
            description:
              'MIME type for the output file. Auto-detected from extension if omitted.',
          },
          timeout: {
            type: 'number',
            description:
              'Command timeout in milliseconds (default: 60000). Use higher values for PDF generation.',
          },
          server: {
            type: 'string',
            description:
              'MCP server name to use (default: "nexus-browser"). Must expose a run_command tool.',
          },
        },
        required: ['command', 'local_path'],
      },
    );
  }

  validateToolParams(params: SandboxTransferParams): string | null {
    const schemaError = SchemaValidator.validate(this.parameterSchema, params);
    if (schemaError) return schemaError;

    if (!params.command.trim()) {
      return 'command must not be empty';
    }

    const filePath = resolveFilePath(params.local_path, this.config.workingDirectory);
    if (!path.isAbsolute(filePath)) {
      return `local_path must resolve to an absolute path: ${filePath}`;
    }
    params.local_path = filePath;

    if (params.encoding && !['base64', 'utf8'].includes(params.encoding)) {
      return `encoding must be "base64" or "utf8", got "${params.encoding}"`;
    }

    return null;
  }

  getDescription(params: SandboxTransferParams): string {
    if (!params?.local_path) return 'Transfer file from sandbox';
    const shortened = shortenPath(
      makeRelative(params.local_path, this.config.workingDirectory),
    );
    return `SandboxTransfer → ${shortened}`;
  }

  async execute(
    params: SandboxTransferParams,
    signal: AbortSignal,
    updateOutput?: (output: string) => void,
  ): Promise<ToolResult> {
    const startTime = Date.now();
    const serverName = params.server || 'nexus-browser';
    const encoding = params.encoding || 'base64';
    const timeout = params.timeout || 60000;

    const validationError = this.validateToolParams(params);
    if (validationError) {
      return this.createErrorResult(validationError);
    }

    // Late-bound MCP manager access
    const mcpManagerGetter = (this.config as any).mcpManagerGetter;
    if (!mcpManagerGetter || typeof mcpManagerGetter !== 'function') {
      return this.createErrorResult(
        'MCP manager not available. SandboxTransfer requires an active MCP connection. ' +
        'Ensure MCP is enabled and a sandbox server (e.g., nexus-browser) is configured.',
      );
    }

    const mcpManager = mcpManagerGetter();
    if (!mcpManager) {
      return this.createErrorResult(
        'MCP manager not initialised. SandboxTransfer requires MCP to be enabled.',
      );
    }

    if (!mcpManager.isServerConnected(serverName)) {
      return this.createErrorResult(
        `MCP server "${serverName}" is not connected. ` +
        `Available servers can be checked with /mcp list. ` +
        `If using a different server, pass server: "your-server-name".`,
      );
    }

    if (signal.aborted) {
      return this.createErrorResult('Cancelled before execution');
    }

    // Run command in sandbox
    let sandboxResult: any;
    try {
      if (updateOutput) {
        updateOutput(`Running in ${serverName} sandbox: ${params.command.slice(0, 80)}...`);
      }

      sandboxResult = await Promise.race([
        mcpManager.callTool(serverName, 'run_command', {
          command: params.command,
          timeout,
        }),
        new Promise((_, reject) => {
          const onAbort = () => reject(new Error('Cancelled'));
          signal.addEventListener('abort', onAbort, { once: true });
        }),
      ]);
    } catch (error: any) {
      if (signal.aborted || error.message === 'Cancelled') {
        return this.createErrorResult('Cancelled during sandbox execution');
      }
      return this.createErrorResult(
        `Sandbox command failed: ${error.message}`,
      );
    }

    // Extract stdout from MCP result
    const stdout = this.extractStdout(sandboxResult);
    if (stdout === null || stdout.length === 0) {
      const stderr = this.extractField(sandboxResult, 'stderr');
      const exitCode = this.extractField(sandboxResult, 'exitCode');
      let msg = 'Sandbox command produced no stdout.';
      if (stderr) msg += ` stderr: ${stderr.slice(0, 200)}`;
      if (exitCode !== null) msg += ` (exit code ${exitCode})`;
      return this.createErrorResult(msg);
    }

    // Write to local filesystem
    try {
      const dirPath = path.dirname(params.local_path);
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
      }

      let buffer: Buffer;
      if (encoding === 'base64') {
        const raw = stdout.replace(/\s/g, '');
        buffer = Buffer.from(raw, 'base64');
      } else {
        buffer = Buffer.from(stdout, 'utf8');
      }

      await fs.promises.writeFile(params.local_path, buffer);

      const fileSize = buffer.length;
      const ext = path.extname(params.local_path).toLowerCase();
      const mimeType =
        params.mime_type || MIME_FROM_EXT[ext] || 'application/octet-stream';
      const sha256 = crypto
        .createHash('sha256')
        .update(buffer)
        .digest('hex')
        .slice(0, 16);

      const relativePath = makeRelative(
        params.local_path,
        this.config.workingDirectory,
      );
      const sizeLabel =
        fileSize < 1024
          ? `${fileSize} B`
          : fileSize < 1024 * 1024
            ? `${(fileSize / 1024).toFixed(1)} KB`
            : `${(fileSize / (1024 * 1024)).toFixed(1)} MB`;

      const displayContent = `Transferred ${relativePath} (${sizeLabel}, ${mimeType}, sha256:${sha256})`;

      if (updateOutput) {
        updateOutput(displayContent);
      }

      return this.createSuccessResult(displayContent, {
        executionTime: Date.now() - startTime,
        resourcesUsed: { files: [params.local_path] },
        sandboxServer: serverName,
        encoding,
        fileStats: {
          path: relativePath,
          size: fileSize,
          mimeType,
          sha256,
          operation: 'create',
        },
      });
    } catch (error: any) {
      if (error.code === 'EACCES') {
        return this.createErrorResult(`Permission denied: ${params.local_path}`);
      }
      if (error.code === 'ENOSPC') {
        return this.createErrorResult('No space left on device');
      }
      return this.createErrorResult(
        `Failed to write local file: ${error.message}`,
      );
    }
  }

  private extractStdout(result: any): string | null {
    if (!result) return null;

    // MCP content blocks format
    if (Array.isArray(result.content)) {
      for (const block of result.content) {
        if (block?.type === 'text' && block.text) {
          try {
            const parsed = JSON.parse(block.text);
            if (typeof parsed.stdout === 'string') return parsed.stdout;
          } catch {
            // Not JSON — might be raw stdout
          }
          return block.text;
        }
      }
    }

    // Direct object with stdout
    if (typeof result.stdout === 'string') return result.stdout;

    // Direct string
    if (typeof result === 'string') return result;

    return null;
  }

  private extractField(result: any, field: string): string | null {
    if (!result) return null;

    if (Array.isArray(result.content)) {
      for (const block of result.content) {
        if (block?.type === 'text' && block.text) {
          try {
            const parsed = JSON.parse(block.text);
            if (parsed[field] !== undefined) return String(parsed[field]);
          } catch {}
        }
      }
    }

    if (result[field] !== undefined) return String(result[field]);
    return null;
  }
}
