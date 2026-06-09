/**
 * Rich Agentic Chat Interface
 * Orchestrates streaming responses with tool visualization
 */

import { CortexClient, Message, ContentBlock, StreamEvent } from '../../client/CortexClient.js';
import { ThemeManager } from '../../themes/ThemeManager.js';
import { ToolRenderer, ToolCall } from './renderers/ToolRenderer.js';
import * as readline from 'readline';
import type { ExtendedTheme } from '../../themes/createTheme.js';

export interface AgenticChatOptions {
  serverUrl?: string;
  model?: string;
  system?: string;
  maxTokens?: number;
  temperature?: number;
}

export class AgenticChat {
  private client: CortexClient;
  private messages: Message[] = [];
  private currentToolCalls: Map<string, ToolCall> = new Map();
  private theme = ThemeManager.getTheme();
  private extendedTheme: ExtendedTheme = ThemeManager.getExtendedTheme();
  private toolRenderer: ToolRenderer;
  private rl: readline.Interface;
  private options: AgenticChatOptions;

  constructor(options: AgenticChatOptions = {}) {
    this.options = options;
    this.client = new CortexClient(options.serverUrl);
    this.toolRenderer = new ToolRenderer(this.theme);

    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
  }

  /**
   * Start the interactive chat
   */
  async start(): Promise<void> {
    // Enhanced header with rounded box
    console.log();
    console.log(this.extendedTheme.doubleBox(
      `Nexus Cortex - Agentic Chat\n` +
      `Advanced streaming with tool visualization\n` +
      `Commands: "exit" to quit, "clear" to reset`,
      ' Agentic Mode'
    ));
    console.log();

    if (this.options.model) {
      console.log(this.extendedTheme.infoMessage(
        `Model: ${this.theme.colors.highlight(this.options.model)}`
      ));
    }
    console.log(this.extendedTheme.dimmed('Real-time streaming • Tool execution • Enhanced feedback'));
    console.log();

    this.prompt();
  }

  /**
   * Show prompt and handle user input
   */
  private prompt(): void {
    this.rl.question(this.theme.colors.info('\n❯ You: '), async (input) => {
      const userInput = input.trim();

      // Handle commands
      if (userInput.toLowerCase() === 'exit') {
        console.log();
        console.log(this.extendedTheme.roundedBox(
          'Thank you for using Agentic Chat!\n' +
          'Session saved automatically.',
          ' Goodbye'
        ));
        console.log();
        this.rl.close();
        return;
      }

      if (userInput.toLowerCase() === 'clear') {
        this.messages.length = 0;
        this.currentToolCalls.clear();
        console.log();
        console.log(this.extendedTheme.successMessage('Conversation history cleared'));
        console.log();
        this.prompt();
        return;
      }

      if (!userInput) {
        this.prompt();
        return;
      }

      await this.handleUserMessage(userInput);
      this.prompt();
    });
  }

  /**
   * Handle a user message
   */
  private async handleUserMessage(input: string): Promise<void> {
    // Add user message
    this.messages.push({
      role: 'user',
      content: input,
    });

    try {
      console.log();
      console.log(this.theme.colors.secondary(' Assistant:'));
      console.log(this.extendedTheme.dimmed('─'.repeat(50)));
      console.log();

      let currentText = '';
      const contentBlocks: ContentBlock[] = [];

      // Stream the response
      for await (const event of this.client.streamMessage(this.messages, {
        model: this.options.model,
        system: this.options.system,
        max_tokens: this.options.maxTokens,
        temperature: this.options.temperature,
        tools: [], // Enable all tools
      })) {
        await this.handleStreamEvent(event, contentBlocks);

        // Track text for final message
        if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
          currentText += event.delta.text;
        }
      }

      // Add assistant message to history
      if (contentBlocks.length > 0 || currentText) {
        this.messages.push({
          role: 'assistant',
          content: contentBlocks.length > 0 ? contentBlocks : currentText,
        });
      }

      // Clear current tool calls for next message
      this.currentToolCalls.clear();

      // Show stats
      console.log();
      console.log(this.extendedTheme.dimmed('─'.repeat(50)));
      console.log(this.extendedTheme.dimmed(`Messages: ${this.messages.length} | Tools used: ${contentBlocks.filter(b => b.type === 'tool_use').length}`));

    } catch (error: any) {
      console.log();
      console.log(this.extendedTheme.errorMessage(error.message));
      console.log();

      // Show helpful hints
      if (error.message.includes('ECONNREFUSED')) {
        console.log(this.extendedTheme.infoMessage('Hint: Server not responding'));
        console.log(this.extendedTheme.dimmed(' Try: npm run dev:full'));
      }
    }
  }

  /**
   * Handle a stream event
   */
  private async handleStreamEvent(event: StreamEvent, contentBlocks: ContentBlock[]): Promise<void> {
    switch (event.type) {
      case 'message_start':
        // Message starting, no action needed
        break;

      case 'content_block_start':
        if (event.content_block) {
          contentBlocks.push(event.content_block);

          // If it's a tool use, initialize tracking
          if (event.content_block.type === 'tool_use') {
            const toolCall: ToolCall = {
              id: event.content_block.id || 'unknown',
              name: event.content_block.name || 'unknown',
              input: event.content_block.input || {},
              status: 'running',
            };
            this.currentToolCalls.set(toolCall.id, toolCall);

            // Render tool start
            console.log('\n' + this.toolRenderer.renderToolStart(toolCall) + '\n');
          }
        }
        break;

      case 'content_block_delta':
        if (event.delta?.type === 'text_delta') {
          // Stream text character by character
          process.stdout.write(event.delta.text);
        } else if (event.delta?.type === 'input_json_delta') {
          // Tool input accumulation (if needed)
        }
        break;

      case 'content_block_stop':
        // Block completed
        break;

      case 'tool_result':
        // Tool execution completed
        const toolId = event.tool_use_id;
        const toolCall = this.currentToolCalls.get(toolId);

        if (toolCall) {
          toolCall.status = event.is_error ? 'error' : 'success';
          toolCall.result = event.content;
          toolCall.error = event.is_error ? event.content : undefined;

          // Render tool result
          console.log(this.toolRenderer.renderToolResult(toolCall) + '\n');

          // Add tool result to content blocks
          contentBlocks.push({
            type: 'tool_result',
            tool_use_id: toolId,
            content: event.content,
            is_error: event.is_error,
          });
        }
        break;

      case 'message_delta':
        // Usage stats, ignore for now
        break;

      case 'message_stop':
        // Message complete
        break;

      default:
        // Unknown event type
        if (process.env.DEBUG) {
          console.log(this.theme.colors.muted(`[Unknown event: ${event.type}]`));
        }
    }
  }
}
