#!/usr/bin/env node

/**
 * HYBRID IMPLEMENTATION: Chalk + Ink
 * Main streaming interface with Chalk, interactive elements with Ink
 *
 * This demonstrates the architecture for OmniClaude V4 CLI
 */

const { program } = require('commander');
const ChalkThemes = require('./chalk/chalk-themes.cjs');
const EventEmitter = require('events');

// Create themed instance for main output
const theme = new ChalkThemes('tokyoNight');

// Event bus for mode switching
const modeEvents = new EventEmitter();

/**
 * MAIN STREAMING MODE (Chalk)
 * Used for: LLM responses, tool execution, status messages
 */
class StreamingInterface {
  constructor(apiUrl = 'http://localhost:4000') {
    this.apiUrl = apiUrl;
    this.isStreaming = false;
  }

  // Stream LLM response character by character
  async streamResponse(message) {
    console.log(theme.infoMessage('Connecting to OmniClaude V4 API...'));

    try {
      // Simulated streaming for demo
      const response = "I'm analyzing your request and will help you build the CLI. Let me break down the architecture:\n\n1. **Hybrid Approach Benefits:**\n   - Chalk handles streaming efficiently\n   - Ink provides rich interactive UIs\n   - Minimal overhead for basic operations\n   - Progressive enhancement for advanced features";

      console.log(theme.primary('\n🤖 Assistant:\n'));

      this.isStreaming = true;
      for (const char of response) {
        process.stdout.write(theme.text(char));
        await new Promise(resolve => setTimeout(resolve, 10)); // Simulate streaming delay
      }
      this.isStreaming = false;
      console.log('\n');

    } catch (error) {
      console.log(theme.errorMessage(`API Error: ${error.message}`));
    }
  }

  // Display tool execution
  async executeTools(tools) {
    console.log(theme.text.bold('\n📦 Tool Execution:\n'));

    for (const tool of tools) {
      // Show pending
      const pendingLine = theme.toolPending(tool.name, tool.args);
      process.stdout.write(pendingLine);

      // Simulate execution
      await new Promise(resolve => setTimeout(resolve, 500));

      // Clear line and show running
      process.stdout.write('\r' + ' '.repeat(pendingLine.length) + '\r');
      const runningLine = theme.toolRunning(tool.name, tool.args);
      process.stdout.write(runningLine);

      // Simulate completion
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Clear and show result
      process.stdout.write('\r' + ' '.repeat(runningLine.length) + '\r');
      if (tool.success) {
        console.log(theme.toolSuccess(tool.name, tool.args));
      } else {
        console.log(theme.toolError(tool.name, tool.args, tool.error));
      }
    }
  }

  // Display session info
  showSession(session) {
    console.log(theme.sessionHeader(session));
  }

  // Progress bar for long operations
  async showProgress(task, duration = 3000) {
    console.log(theme.text.bold(`\n${task}:\n`));

    const steps = 50;
    for (let i = 0; i <= steps; i++) {
      const progress = i / steps;
      process.stdout.write('\r' + theme.gradientProgressBar(progress, 40));
      await new Promise(resolve => setTimeout(resolve, duration / steps));
    }
    console.log('\n');
  }

  // Handle interrupt for interactive mode
  handleInterrupt() {
    if (this.isStreaming) {
      this.isStreaming = false;
      console.log(theme.warningMessage('\n\nStream interrupted. Press "i" for interactive mode.'));
      return true;
    }
    return false;
  }
}

/**
 * INTERACTIVE MODE (Ink)
 * Used for: Menus, session management, artifacts, configuration
 */
async function launchInteractiveMode(session) {
  // Dynamically import Ink components
  const React = require('react');
  const { render, Box, Text, useApp, useInput } = require('ink');
  const SelectInput = require('ink-select-input').default;
  const Spinner = require('ink-spinner').default;

  function InteractiveUI() {
    const [mode, setMode] = React.useState('menu');
    const [loading, setLoading] = React.useState(false);
    const { exit } = useApp();

    // Handle keyboard input
    useInput((input, key) => {
      if (key.escape || input === 'q') {
        modeEvents.emit('exitInteractive');
        exit();
      }
    });

    const menuItems = [
      { label: '💬 New Conversation', value: 'new' },
      { label: '📋 View Session History', value: 'history' },
      { label: '🎨 Change Theme', value: 'theme' },
      { label: '⚙️  Settings', value: 'settings' },
      { label: '📊 View Artifacts', value: 'artifacts' },
      { label: '💾 Export Session', value: 'export' },
      { label: '❌ Exit Interactive Mode', value: 'exit' }
    ];

    const handleSelect = (item) => {
      if (item.value === 'exit') {
        modeEvents.emit('exitInteractive');
        exit();
      } else if (item.value === 'new') {
        setLoading(true);
        setTimeout(() => {
          modeEvents.emit('newConversation');
          exit();
        }, 1000);
      } else {
        setMode(item.value);
      }
    };

    if (loading) {
      return React.createElement(Box, {flexDirection: 'column', padding: 1},
        React.createElement(Text, {color: '#7aa2f7', bold: true}, 'OmniClaude V4 - Interactive Mode'),
        React.createElement(Box, {marginTop: 1},
          React.createElement(Text, {color: '#7dcfff'},
            React.createElement(Spinner, {type: 'dots'}),
            ' Starting new conversation...'
          )
        )
      );
    }

    if (mode === 'menu') {
      return React.createElement(Box, {flexDirection: 'column', padding: 1},
        React.createElement(Box, {borderStyle: 'round', borderColor: '#7aa2f7', padding: 1},
          React.createElement(Box, {flexDirection: 'column'},
            React.createElement(Text, {color: '#7aa2f7', bold: true}, '🚀 OmniClaude V4 - Interactive Mode'),
            React.createElement(Text, {color: '#565f89', dimColor: true}, 'Session: ' + session.id)
          )
        ),
        React.createElement(Box, {marginTop: 1, marginBottom: 1},
          React.createElement(Text, null, 'Select an option:')
        ),
        React.createElement(SelectInput, {
          items: menuItems,
          onSelect: handleSelect,
          indicatorComponent: ({ isSelected }) =>
            React.createElement(Text, {color: isSelected ? '#9ece6a' : '#565f89'},
              isSelected ? '▶' : ' '
            ),
          itemComponent: ({ label, isSelected }) =>
            React.createElement(Text, {color: isSelected ? '#7aa2f7' : '#a9b1d6'},
              label
            )
        }),
        React.createElement(Box, {marginTop: 1},
          React.createElement(Text, {color: '#565f89'}, 'Press Q or ESC to exit')
        )
      );
    }

    if (mode === 'artifacts') {
      return React.createElement(Box, {flexDirection: 'column', padding: 1},
        React.createElement(Text, {color: '#7aa2f7', bold: true}, '📊 Session Artifacts'),
        React.createElement(Box, {marginTop: 1, flexDirection: 'column'},
          React.createElement(Box, {borderStyle: 'single', borderColor: '#565f89', padding: 1, marginBottom: 1},
            React.createElement(Text, {color: '#9ece6a'}, '✓ API Response Schema')
          ),
          React.createElement(Box, {borderStyle: 'single', borderColor: '#565f89', padding: 1, marginBottom: 1},
            React.createElement(Text, {color: '#9ece6a'}, '✓ Generated Code (3 files)')
          ),
          React.createElement(Box, {borderStyle: 'single', borderColor: '#565f89', padding: 1},
            React.createElement(Text, {color: '#e0af68'}, '⏳ Documentation (generating...)')
          )
        ),
        React.createElement(Box, {marginTop: 1},
          React.createElement(Text, {color: '#565f89'}, 'Press ESC to go back')
        )
      );
    }

    return React.createElement(Box, null,
      React.createElement(Text, null, 'Mode: ' + mode + ' (not implemented)')
    );
  }

  const { waitUntilExit } = render(React.createElement(InteractiveUI));
  await waitUntilExit();
}

/**
 * HYBRID CONTROLLER
 * Orchestrates between Chalk streaming and Ink interactive modes
 */
class HybridCLI {
  constructor() {
    this.streaming = new StreamingInterface();
    this.session = {
      id: 'abc-' + Math.random().toString(36).substr(2, 9),
      model: 'gemini-2.5-flash',
      messages: '0',
      tokens: '0',
      cost: '$0.00'
    };
    this.setupEventHandlers();
  }

  setupEventHandlers() {
    // Handle mode transitions
    modeEvents.on('exitInteractive', () => {
      console.log(theme.infoMessage('\nReturned to streaming mode'));
      this.promptUser();
    });

    modeEvents.on('newConversation', () => {
      console.log(theme.successMessage('\nNew conversation started'));
      this.session.messages = '0';
      this.session.tokens = '0';
      this.startConversation();
    });

    // Handle Ctrl+C gracefully
    process.on('SIGINT', () => {
      if (!this.streaming.handleInterrupt()) {
        console.log(theme.text('\n\nGoodbye! 👋\n'));
        process.exit(0);
      }
    });
  }

  async start() {
    // Show welcome
    console.clear();
    console.log(theme.rainbowText('OMNICLAUDE V4 CLI'));
    console.log(theme.text.bold('Hybrid Mode: Chalk + Ink\n'));

    // Show session
    this.streaming.showSession(this.session);

    // Show initial menu
    await this.showMainMenu();
  }

  async showMainMenu() {
    console.log(theme.text.bold('\nSelect mode:'));
    console.log(theme.primary('  [1] Start Conversation (streaming)'));
    console.log(theme.secondary('  [2] Interactive Mode (menus)'));
    console.log(theme.info('  [3] Demo All Features'));
    console.log(theme.dimmed('  [Q] Quit\n'));

    const readline = require('readline').createInterface({
      input: process.stdin,
      output: process.stdout
    });

    readline.question(theme.text('Choice: '), async (answer) => {
      readline.close();

      switch(answer.toLowerCase()) {
        case '1':
          await this.startConversation();
          break;
        case '2':
          await launchInteractiveMode(this.session);
          break;
        case '3':
          await this.demoFeatures();
          break;
        case 'q':
          console.log(theme.text('\nGoodbye! 👋\n'));
          process.exit(0);
        default:
          console.log(theme.warningMessage('Invalid choice'));
          await this.showMainMenu();
      }
    });
  }

  async startConversation() {
    console.log(theme.text.bold('\n📝 Enter your message (or "menu" for interactive mode):\n'));

    const readline = require('readline').createInterface({
      input: process.stdin,
      output: process.stdout
    });

    readline.question(theme.primary('You: '), async (message) => {
      readline.close();

      if (message.toLowerCase() === 'menu') {
        await launchInteractiveMode(this.session);
      } else {
        // Update session
        this.session.messages = String(parseInt(this.session.messages) + 1);
        this.session.tokens = '2.5K';
        this.session.cost = '$0.01';

        // Stream response
        await this.streaming.streamResponse(message);

        // Continue conversation
        await this.promptUser();
      }
    });
  }

  async promptUser() {
    const readline = require('readline').createInterface({
      input: process.stdin,
      output: process.stdout
    });

    readline.question(theme.primary('\nYou: '), async (message) => {
      readline.close();

      if (message.toLowerCase() === 'menu') {
        await launchInteractiveMode(this.session);
      } else if (message.toLowerCase() === 'quit' || message.toLowerCase() === 'exit') {
        console.log(theme.text('\nGoodbye! 👋\n'));
        process.exit(0);
      } else {
        await this.streaming.streamResponse(message);
        await this.promptUser();
      }
    });
  }

  async demoFeatures() {
    console.log(theme.text.bold('\n🎭 DEMO MODE - Showing All Features\n'));

    // Demo tools
    const demoTools = [
      { name: 'glob', args: '**/*.ts', success: true },
      { name: 'read', args: '/src/index.ts', success: true },
      { name: 'grep', args: 'TODO, {glob: "*.js"}', success: true },
      { name: 'write', args: '/protected/file', success: false, error: 'Permission denied' }
    ];

    await this.streaming.executeTools(demoTools);

    // Demo progress
    await this.streaming.showProgress('Building project', 2000);

    // Demo streaming
    await this.streaming.streamResponse('This demonstrates the streaming capability...');

    // Launch interactive mode
    console.log(theme.infoMessage('\nNow launching interactive mode...'));
    await new Promise(resolve => setTimeout(resolve, 1000));
    await launchInteractiveMode(this.session);
  }
}

// Main entry point
if (require.main === module) {
  const cli = new HybridCLI();
  cli.start();
}

module.exports = { HybridCLI, StreamingInterface };