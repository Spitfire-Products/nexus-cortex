/**
 * ReadImage Tool Executor — the READ half of the binary bridge (backlog
 * item 7; WriteBinaryTool is the pre-existing write half).
 *
 * Loads a workspace image (PNG/JPEG/GIF/WebP, magic-byte-sniffed) and returns
 * a TEXT summary while carrying the encoded payload in result metadata
 * (`imagePayload`). The ORCHESTRATOR consumes that metadata: it strips it
 * from the persisted tool_result and injects the image as a canonical image
 * block on a synthetic USER message (providers reject image parts on tool
 * messages; DeepSeek accepts them on user messages only).
 *
 * Offered to vision-capable model cards (ModelConfig.vision) AND, since 2026-09-02, to
 * text-only primaries when a vision helper is configured (VISION_HELPER_MODEL): the
 * orchestrator hands the payload + `prompt` to the helper middleware and returns text.
 */

import fs from 'fs';
import { BaseTool, type ToolResult } from '../../base/index.js';
import { SchemaValidator } from '../../utils/SchemaValidator.js';
import { makeRelative, resolveFilePath, fileExists } from '../../utils/FileUtils.js';
import type { ExecutorConfig } from '../../base/ToolRegistry.js';
import { toImagePayload, resolveDownscaleThreshold, downscaleImageFile } from './imageFile.js';
import { FileReadTracker } from './EditTool.js';

export interface ReadImageToolParams {
  file_path: string;
  /** Vision hand-off: what the caller needs from the image (text-only primaries). */
  prompt?: string;
}

export class ReadImageTool extends BaseTool<ReadImageToolParams, ToolResult> {
  constructor(private config: ExecutorConfig) {
    super(
      'ReadImage',
      'ReadImage',
      'Load an image file (PNG/JPEG/GIF/WebP) so you can SEE it. The image is attached to the conversation as visual input on the next message.',
      {
        type: 'object',
        properties: {
          file_path: {
            type: 'string',
            description: 'Path to the image file (absolute, or relative to the working directory).',
          },
          prompt: {
            type: 'string',
            description: 'What you need from the image (used by the vision helper when the active model is text-only).',
          },
        },
        required: ['file_path'],
      },
    );
  }

  validateToolParams(params: ReadImageToolParams): string | null {
    const schemaError = SchemaValidator.validate(this.parameterSchema, params);
    if (schemaError) return `Parameter validation failed: ${schemaError}`;
    const filePath = resolveFilePath(params.file_path, this.config.workingDirectory);
    params.file_path = filePath;
    if (!fileExists(filePath)) return `File not found: ${filePath}`;
    return null;
  }

  async execute(params: ReadImageToolParams, signal: AbortSignal): Promise<ToolResult> {
    const startTime = Date.now();
    const validationError = this.validateToolParams(params);
    if (validationError) return this.createErrorResult(validationError);
    if (signal.aborted) return this.createErrorResult('Cancelled before start.');

    try {
      let buf: Buffer = await fs.promises.readFile(params.file_path);
      // Downscale-at-ingest (item 7 addendum): the provider resizes to
      // ~800×800 anyway, so shrinking large originals locally is lossless to
      // the model and cuts the per-turn base64 re-upload ~100×. Best-effort:
      // no converter available → original passes through (hard cap enforced
      // by toImagePayload).
      let downscaled = false;
      const threshold = resolveDownscaleThreshold();
      if (threshold !== null && buf.length > threshold) {
        const smaller = await downscaleImageFile(params.file_path);
        if (smaller && smaller.length < buf.length) {
          buf = smaller;
          downscaled = true;
        }
      }
      const payload = toImagePayload(buf); // throws model-actionable errors
      const relativePath = makeRelative(params.file_path, this.config.workingDirectory);
      // The bash channel proves nothing visual, but loading the image IS a
      // read of the file — register it (frame coherence, item 6 semantics).
      FileReadTracker.markAsRead(params.file_path);
      return this.createSuccessResult(
        `Loaded ${relativePath} (${payload.mediaType}, ${(payload.bytes / 1024).toFixed(0)} KB` +
        `${downscaled ? ', downscaled to ~800px for transport — provider parity, no fidelity loss' : ''}). ` +
        `The image is attached as visual input on the next user message — look at it there.`,
        {
          executionTime: Date.now() - startTime,
          // Consumed + STRIPPED by the orchestrator before session persist
          // (the image rides the injected user message, not this metadata —
          // no double-stored base64).
          imagePayload: payload,
          // Vision hand-off inputs (consumed + stripped by the orchestrator with the payload).
          imagePrompt: params.prompt,
          imageFilePath: relativePath,
        },
      );
    } catch (error: any) {
      return this.createErrorResult(`Cannot load image: ${error.message}`);
    }
  }

  getDescription(params: ReadImageToolParams): string {
    return params?.file_path ? `Load image ${params.file_path}` : 'Load image';
  }
}
