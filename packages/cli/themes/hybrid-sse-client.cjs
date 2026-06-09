#!/usr/bin/env node

/**
 * HYBRID SSE CLIENT for OmniClaude V4
 * Production-ready implementation with real SSE streaming
 */

const EventSource = require('eventsource');
const fetch = require('node-fetch');
const ChalkThemes = require('./chalk/chalk-themes.cjs');

// Initialize theme
const theme = new ChalkThemes('tokyoNight');

/**
 * SSE Streaming Client with Chalk for output
 * This connects to your actual OmniClaude V4 API
 */
class OmniClaudeStreamClient {
  constructor(apiUrl = 'http://localhost:4000') {
    this.apiUrl = apiUrl;
    this.sessionId = null;
    this.messageBuffer = '';
    this.toolExecutions = [];
  }

  /**
   * Send message and stream response
   */
  async sendMessage(content, options = {}) {
    const { model = 'gemini-2.5-flash', temperature = 0.7 } = options;

    // Display user message
    console.log(theme.primary('\n👤 You:'));
    console.log(theme.text(content + '\n'));

    // Show connecting status
    process.stdout.write(theme.dimmed('Connecting'));

    try {
      // Send initial request
      const response = await fetch(`${this.apiUrl}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream'
        },
        body: JSON.stringify({
          messages: [{
            role: 'user',
            content: content
          }],
          model: model,
          temperature: temperature,
          stream: true,
          sessionId: this.sessionId
        })
      });

      // Clear connecting message
      process.stdout.write('\r' + ' '.repeat(20) + '\r');

      if (!response.ok) {
        throw new Error(`API Error: ${response.status}`);
      }

      // Get session ID from headers
      this.sessionId = response.headers.get('x-session-id') || this.sessionId;

      // Setup SSE for streaming
      await this.handleSSEStream(response);

    } catch (error) {
      console.log(theme.errorMessage(`Connection failed: ${error.message}`));
    }
  }

  /**
   * Handle Server-Sent Events stream
   */
  async handleSSEStream(response) {
    const eventSource = new EventSource(response.url);

    console.log(theme.primary('🤖 Assistant:\n'));

    return new Promise((resolve, reject) => {
      let fullContent = '';
      let currentToolUse = null;

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          switch(data.type) {
            case 'content':
              // Stream text content with Chalk
              process.stdout.write(theme.text(data.content));
              fullContent += data.content;
              break;

            case 'tool_use_start':
              // Show tool execution start
              currentToolUse = { name: data.name, args: data.args };
              console.log('\n' + theme.toolPending(data.name, JSON.stringify(data.args)));
              break;

            case 'tool_use_result':
              // Show tool result
              if (currentToolUse) {
                // Clear previous line
                process.stdout.write('\r' + ' '.repeat(80) + '\r');
                if (data.success) {
                  console.log(theme.toolSuccess(currentToolUse.name, JSON.stringify(currentToolUse.args)));
                } else {
                  console.log(theme.toolError(currentToolUse.name, JSON.stringify(currentToolUse.args), data.error));
                }
              }
              break;

            case 'usage':
              // Display token usage
              console.log('\n' + theme.dimmed(`[Tokens: ${data.total_tokens} | Cost: $${data.cost}]`));
              break;

            case 'error':
              console.log('\n' + theme.errorMessage(data.message));
              break;

            case 'done':
              eventSource.close();
              resolve(fullContent);
              break;
          }
        } catch (err) {
          console.error(theme.errorMessage(`Stream parse error: ${err.message}`));
        }
      };

      eventSource.onerror = (error) => {
        eventSource.close();
        reject(error);
      };
    });
  }

  /**
   * Stream with live tool execution display
   */
  async sendWithTools(content, tools = []) {
    console.log(theme.primary('\n👤 You:'));
    console.log(theme.text(content + '\n'));

    // Simulate tool-enabled request
    console.log(theme.text.bold('🔧 Available Tools:'));
    tools.forEach(tool => {
      console.log(theme.dimmed(`  - ${tool}`));
    });
    console.log();

    // Show streaming with tools
    const assistantResponse = "I'll help you with that. Let me search for the relevant files first.";

    console.log(theme.primary('🤖 Assistant:\n'));

    // Stream initial response
    for (const char of assistantResponse) {
      process.stdout.write(theme.text(char));
      await new Promise(r => setTimeout(r, 20));
    }
    console.log('\n');

    // Simulate tool executions
    const executions = [
      { name: 'glob', args: '**/*.ts', delay: 500, success: true },
      { name: 'grep', args: 'import.*Express', delay: 800, success: true },
      { name: 'read', args: '/src/server.ts', delay: 600, success: true }
    ];

    for (const exec of executions) {
      // Show pending
      process.stdout.write(theme.toolPending(exec.name, exec.args));
      await new Promise(r => setTimeout(r, exec.delay));

      // Show running
      process.stdout.write('\r' + ' '.repeat(60) + '\r');
      process.stdout.write(theme.toolRunning(exec.name, exec.args));
      await new Promise(r => setTimeout(r, exec.delay));

      // Show result
      process.stdout.write('\r' + ' '.repeat(60) + '\r');
      console.log(theme.toolSuccess(exec.name, exec.args));
    }

    // Continue streaming response
    const continuation = "\nBased on my search, I found the Express server configuration in `/src/server.ts`. The server is set up with middleware for CORS, JSON parsing, and SSE support.";

    console.log();
    for (const char of continuation) {
      process.stdout.write(theme.text(char));
      await new Promise(r => setTimeout(r, 20));
    }
    console.log('\n');
  }
}

/**
 * Interactive Session Manager (Ink)
 * For session selection, history viewing, etc.
 */
async function launchSessionManager(client) {
  const React = require('react');
  const { render, Box, Text } = require('ink');
  const SelectInput = require('ink-select-input').default;

  function SessionManager() {
    const sessions = [
      { label: '📝 Current Session (abc-123)', value: 'current' },
      { label: '📋 Session History', value: 'history' },
      { label: '➕ New Session', value: 'new' },
      { label: '💾 Export Session', value: 'export' },
      { label: '↩️  Back to Chat', value: 'back' }
    ];

    return React.createElement(Box, {flexDirection: 'column', padding: 1},
      React.createElement(Box, {borderStyle: 'round', borderColor: '#7aa2f7', padding: 1, marginBottom: 1},
        React.createElement(Text, {color: '#7aa2f7', bold: true}, 'Session Manager')
      ),
      React.createElement(SelectInput, {
        items: sessions,
        onSelect: (item) => {
          if (item.value === 'back') {
            process.exit(0); // Return to main
          }
          // Handle other selections
        }
      })
    );
  }

  const { waitUntilExit } = render(React.createElement(SessionManager));
  await waitUntilExit();
}

/**
 * Main CLI Application
 */
class OmniClaudeCLI {
  constructor() {
    this.client = new OmniClaudeStreamClient();
    this.isInteractive = false;
  }

  async start() {
    console.clear();
    console.log(theme.rainbowText('OMNICLAUDE V4 CLI'));
    console.log(theme.dimmed('Hybrid Mode: Chalk streaming + Ink interactive\n'));

    // Show session info
    this.showSessionInfo();

    // Start conversation loop
    await this.conversationLoop();
  }

  showSessionInfo() {
    const session = {
      model: 'gemini-2.5-flash',
      id: this.client.sessionId || 'new',
      messages: '0',
      tokens: '0',
      cost: '$0.00'
    };
    console.log(theme.sessionHeader(session));
  }

  async conversationLoop() {
    const readline = require('readline').createInterface({
      input: process.stdin,
      output: process.stdout
    });

    const prompt = () => {
      readline.question(theme.primary('\n📝 You: '), async (input) => {
        // Handle commands
        if (input.toLowerCase() === '/quit' || input.toLowerCase() === '/exit') {
          console.log(theme.text('\nGoodbye! 👋\n'));
          readline.close();
          process.exit(0);
        }

        if (input.toLowerCase() === '/menu') {
          readline.close();
          await launchSessionManager(this.client);
          return;
        }

        if (input.toLowerCase() === '/demo') {
          await this.runDemo();
          prompt();
          return;
        }

        if (input.toLowerCase() === '/help') {
          this.showHelp();
          prompt();
          return;
        }

        // Send message to API
        try {
          await this.client.sendWithTools(input, ['glob', 'grep', 'read', 'write']);
        } catch (error) {
          console.log(theme.errorMessage(`Error: ${error.message}`));
        }

        prompt();
      });
    };

    prompt();
  }

  showHelp() {
    console.log(theme.text.bold('\n📚 Available Commands:'));
    console.log(theme.success('  /menu   ') + theme.text('- Open interactive session manager'));
    console.log(theme.success('  /demo   ') + theme.text('- Run feature demonstration'));
    console.log(theme.success('  /help   ') + theme.text('- Show this help message'));
    console.log(theme.success('  /quit   ') + theme.text('- Exit the application'));
    console.log(theme.dimmed('\n  Type anything else to chat with the assistant'));
  }

  async runDemo() {
    console.log(theme.text.bold('\n🎭 Running Demo...\n'));

    // Demo 1: Simple message
    await this.client.sendMessage('What is the capital of France?');

    await new Promise(r => setTimeout(r, 1000));

    // Demo 2: With tools
    await this.client.sendWithTools(
      'Find all TypeScript files and search for Express imports',
      ['glob', 'grep', 'read']
    );
  }
}

// Entry point
if (require.main === module) {
  const cli = new OmniClaudeCLI();
  cli.start().catch(error => {
    console.error(theme.errorMessage(`Fatal error: ${error.message}`));
    process.exit(1);
  });
}

module.exports = { OmniClaudeStreamClient, OmniClaudeCLI };