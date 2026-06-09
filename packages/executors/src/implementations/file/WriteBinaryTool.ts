/**
 * WriteBinary Tool Executor
 *
 * Writes base64-encoded binary data to a file. Handles images, PDFs,
 * and any binary format captured during browsing or generated in sandbox.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { BaseTool, type ToolResult } from '../../base/index.js';
import { SchemaValidator } from '../../utils/SchemaValidator.js';
import {
  makeRelative,
  shortenPath,
  fileExists,
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
  '.ico': 'image/x-icon',
  '.bmp': 'image/bmp',
  '.tiff': 'image/tiff',
  '.avif': 'image/avif',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
};

export interface WriteBinaryToolParams {
  file_path: string;
  data: string;
  mime_type?: string;
}

/**
 * Strip data URI prefix if present, returning raw base64.
 */
function extractBase64(data: string): string {
  const match = data.match(/^data:[^;]+;base64,(.+)$/);
  return match ? match[1]! : data;
}

export class WriteBinaryTool extends BaseTool<WriteBinaryToolParams, ToolResult> {
  constructor(private config: ExecutorConfig) {
    super(
      'WriteBinary',
      'WriteBinary',
      'Write base64-encoded binary data to a file. Use for images, PDFs, and other binary formats.',
      {
        type: 'object',
        properties: {
          file_path: {
            type: 'string',
            description:
              "Path to write (e.g., 'images/screenshot.png' or '/home/user/report.pdf'). Parent directories are created automatically.",
          },
          data: {
            type: 'string',
            description:
              'Base64-encoded binary content. Accepts raw base64 or a data URI (data:image/png;base64,...).',
          },
          mime_type: {
            type: 'string',
            description:
              'MIME type (e.g., "image/png", "application/pdf"). Auto-detected from file extension if omitted.',
          },
        },
        required: ['file_path', 'data'],
      },
    );
  }

  validateToolParams(params: WriteBinaryToolParams): string | null {
    const schemaError = SchemaValidator.validate(this.parameterSchema, params);
    if (schemaError) return schemaError;

    let filePath = resolveFilePath(params.file_path, this.config.workingDirectory);
    if (!path.isAbsolute(filePath)) {
      return `File path must resolve to an absolute path: ${filePath}`;
    }
    params.file_path = filePath;

    if (fileExists(filePath)) {
      try {
        const stats = fs.lstatSync(filePath);
        if (stats.isDirectory()) {
          return `Path is a directory, not a file: ${filePath}`;
        }
      } catch (error: any) {
        return `Error accessing path: ${error.message}`;
      }
    }

    const raw = extractBase64(params.data);
    if (!/^[A-Za-z0-9+/\n\r]+=*$/.test(raw.replace(/\s/g, ''))) {
      return 'data does not appear to be valid base64';
    }

    return null;
  }

  getDescription(params: WriteBinaryToolParams): string {
    if (!params?.file_path) return 'Write binary file';
    const relativePath = makeRelative(params.file_path, this.config.workingDirectory);
    const shortened = shortenPath(relativePath);
    return `WriteBinary ${shortened}`;
  }

  async execute(
    params: WriteBinaryToolParams,
    signal: AbortSignal,
    updateOutput?: (output: string) => void,
  ): Promise<ToolResult> {
    const startTime = Date.now();

    const validationError = this.validateToolParams(params);
    if (validationError) {
      return this.createErrorResult(validationError);
    }

    try {
      const dirPath = path.dirname(params.file_path);
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
      }

      const existed = fileExists(params.file_path);
      const action = existed ? 'Updated' : 'Created';

      const raw = extractBase64(params.data);
      const buffer = Buffer.from(raw, 'base64');

      await fs.promises.writeFile(params.file_path, buffer);

      const fileSize = buffer.length;
      const ext = path.extname(params.file_path).toLowerCase();
      const mimeType = params.mime_type || MIME_FROM_EXT[ext] || 'application/octet-stream';
      const sha256 = crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 16);

      const relativePath = makeRelative(params.file_path, this.config.workingDirectory);
      const sizeLabel =
        fileSize < 1024
          ? `${fileSize} B`
          : fileSize < 1024 * 1024
            ? `${(fileSize / 1024).toFixed(1)} KB`
            : `${(fileSize / (1024 * 1024)).toFixed(1)} MB`;

      const displayContent = `${action} ${relativePath} (${sizeLabel}, ${mimeType})`;

      if (updateOutput) {
        updateOutput(displayContent);
      }

      return this.createSuccessResult(displayContent, {
        executionTime: Date.now() - startTime,
        resourcesUsed: { files: [params.file_path] },
        fileStats: {
          path: relativePath,
          size: fileSize,
          action,
          existed,
          operation: 'create',
          mimeType,
          sha256,
        },
      });
    } catch (error: any) {
      if (error.code === 'EACCES') {
        return this.createErrorResult(`Permission denied: ${params.file_path}`);
      }
      if (error.code === 'ENOSPC') {
        return this.createErrorResult('No space left on device');
      }
      if (error.code === 'EROFS') {
        return this.createErrorResult('Read-only file system');
      }
      return this.createErrorResult(`Failed to write binary file: ${error.message}`);
    }
  }
}
