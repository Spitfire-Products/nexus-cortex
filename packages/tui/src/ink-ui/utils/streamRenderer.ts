/**
 * Stream Renderer - Direct stdout writing for Ink UI
 *
 * Uses the SAME ToolFormatter and rendering logic as the chalk CLI (interactive.ts).
 * This ensures consistent output between chalk and ink modes.
 *
 * thinking → text → tool call → tool result → text → tool call → ...
 */

import { ToolFormatter } from '@nexus-cortex/cli/dist/utils/ToolFormatter.js';
import { ThemeManager } from '@nexus-cortex/cli/dist/themes/ThemeManager.js';

export interface StreamRendererOptions {
  showThinking: boolean;
  showDebug: boolean;
}

/**
 * Stream Renderer - processes chunks and writes directly to stdout
 *
 * Uses the SAME ToolFormatter as the chalk CLI for consistent output.
 */
export class StreamRenderer {
  private options: StreamRendererOptions;
  private toolFormatter: ToolFormatter;
  private theme: ReturnType<typeof ThemeManager.getExtendedTheme>;
  private isInToolExecution = false;
  private hasStartedThinking = false;
  private fullTextContent = '';

  constructor(options: StreamRendererOptions) {
    this.options = options;
    this.toolFormatter = new ToolFormatter();
    this.theme = ThemeManager.getExtendedTheme();
  }

  /**
   * Reset state for new stream
   */
  reset(): void {
    this.isInToolExecution = false;
    this.hasStartedThinking = false;
    this.fullTextContent = '';
  }

  /**
   * Process a single stream chunk - writes directly to stdout
   *
   * This mirrors the chunk processing in interactive.ts (chalk CLI)
   */
  processChunk(chunk: any): void {
    const { showThinking, showDebug } = this.options;

    // Native extended thinking (Claude, Grok) - content_block_delta with reasoning flag
    if (chunk.type === 'content_block_delta') {
      const data = chunk.data as any;
      if (data?.reasoning === true) {
        // Show thinking if toggle is ON or we're in tool execution (interleaved)
        const shouldShow = showThinking || this.isInToolExecution;
        if (shouldShow && chunk.delta) {
          process.stdout.write(this.theme.dimmed(chunk.delta));
        }
        return;
      }
    }

    // Gemini thinking blocks
    if (chunk.type === 'thinking_delta') {
      const shouldShow = showThinking || this.isInToolExecution;
      if (shouldShow && chunk.delta) {
        if (!this.hasStartedThinking) {
          console.log();
          console.log(this.theme.colors.info('▸ ') + this.theme.colors.info('Thinking:'));
          this.hasStartedThinking = true;
        }
        process.stdout.write(' ' + this.theme.dimmed(chunk.delta));
      }
      return;
    }

    // Regular text content
    if (chunk.type === 'text_delta') {
      // Reset thinking header when text starts
      if (this.hasStartedThinking && chunk.delta) {
        console.log();
        this.hasStartedThinking = false;
      }

      // Mark end of tool execution when we get substantive text
      if (this.isInToolExecution && chunk.delta?.trim()) {
        this.isInToolExecution = false;
      }

      let text = chunk.delta || '';

      // Filter debug logs unless debug mode is on
      const isDebugLog = text.startsWith('[') ||
        text.includes('[Gateway]') ||
        text.includes('[Orchestrator') ||
        text.includes('[Phase ');

      if (isDebugLog && !showDebug) {
        return;
      }

      if (isDebugLog && showDebug) {
        text = this.theme.dimmed(text);
      }

      // Handle <thinking> tags (mentorship thinking)
      if (text.includes('<thinking>') || text.includes('</thinking>')) {
        if (showThinking) {
          text = text.replace(
            /<thinking>([\s\S]*?)<\/thinking>/g,
            (_match: string, content: string) => this.theme.colors.info(`\n[Thinking] ${content.trim()}\n`)
          );
          process.stdout.write(text);
        } else {
          text = text.replace(/<thinking>[\s\S]*?<\/thinking>/g, '');
          if (text) {
            process.stdout.write(text);
          }
        }
      } else {
        // Regular text - write directly (no truncation!)
        process.stdout.write(text);
      }

      this.fullTextContent += chunk.delta || '';
    }

    // Tool call - use ToolFormatter for consistent display
    if (chunk.type === 'tool_use_complete' && chunk.toolUse) {
      this.isInToolExecution = true;
      console.log();
      const toolCallStr = this.toolFormatter.formatToolCall({
        name: chunk.toolUse.name,
        params: chunk.toolUse.input
      });
      process.stdout.write(toolCallStr);
    }

    // Tool result - use ToolFormatter for consistent display
    if (chunk.type === 'tool_result' && chunk.toolResult) {
      const { content, is_error } = chunk.toolResult;

      // Format result using ToolFormatter (same as chalk CLI)
      const resultStr = this.toolFormatter.formatToolResult({
        summary: content || 'Done',
        error: is_error ? content : undefined
      });
      process.stdout.write(resultStr);
    }
  }

  /**
   * Get accumulated text content (for history)
   */
  getFullText(): string {
    return this.fullTextContent;
  }
}

/**
 * Create a stream renderer instance
 */
export function createStreamRenderer(options: StreamRendererOptions): StreamRenderer {
  return new StreamRenderer(options);
}
