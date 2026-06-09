# Artifact System Integration Examples

Complete examples showing how to integrate the artifact system into Nexus Cortex CLI.

## 1. Basic CLI Integration

```javascript
// cli.js - Main CLI with artifact support
const { program } = require('commander');
const ChalkThemes = require('./themes/chalk/chalk-themes.cjs');
const ArtifactManager = require('./artifacts/core/ArtifactManager');
const TmuxManager = require('./artifacts/tmux/TmuxManager');
const MessageBridge = require('./artifacts/bridge/MessageBridge');

class CortexV4CLI {
  constructor() {
    this.theme = new ChalkThemes('tokyoNight');
    this.artifactManager = null;
    this.tmuxManager = null;
    this.bridge = null;
    this.session = {
      id: this.generateSessionId(),
      artifacts: []
    };
  }

  async initialize() {
    console.log(this.theme.rainbowText('OMNICLAUDE V4 CLI'));
    console.log(this.theme.text('Initializing artifact system...\n'));

    // Initialize tmux
    this.tmuxManager = new TmuxManager();
    await this.tmuxManager.initialize();

    // Initialize message bridge
    this.bridge = new MessageBridge();
    const port = await this.bridge.initialize();
    process.env.ARTIFACT_BRIDGE_PORT = port;

    // Initialize artifact manager
    this.artifactManager = new ArtifactManager({
      tmuxManager: this.tmuxManager,
      messageBridge: this.bridge
    });
    await this.artifactManager.initialize();

    // Setup event handlers
    this.setupEventHandlers();

    console.log(this.theme.successMessage('Artifact system ready'));
    console.log(this.theme.dimmed(`Bridge port: ${port}\n`));
  }

  setupEventHandlers() {
    // Artifact lifecycle events
    this.artifactManager.on('artifact:created', (artifact) => {
      console.log(this.theme.successMessage(`Created artifact: ${artifact.id}`));
      this.session.artifacts.push(artifact.id);
    });

    this.artifactManager.on('artifact:destroyed', (artifact) => {
      console.log(this.theme.infoMessage(`Destroyed artifact: ${artifact.id}`));
      this.session.artifacts = this.session.artifacts.filter(id => id !== artifact.id);
    });

    this.artifactManager.on('artifact:error', (artifact, error) => {
      console.log(this.theme.errorMessage(`Artifact error: ${error.message}`));
    });

    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      console.log(this.theme.warningMessage('\nShutting down...'));
      await this.cleanup();
      process.exit(0);
    });
  }

  async cleanup() {
    // Destroy all artifacts
    for (const artifactId of this.session.artifacts) {
      await this.artifactManager.destroyArtifact(artifactId);
    }

    // Cleanup tmux session
    await this.tmuxManager.killSession('cortex');

    // Close bridge
    await this.bridge.disconnect();
  }

  generateSessionId() {
    return 'session-' + Math.random().toString(36).substr(2, 9);
  }
}

// CLI Commands
program
  .name('cortex')
  .version('4.0.0')
  .description('Nexus Cortex CLI with Dynamic Artifacts');

program
  .command('chat')
  .description('Start interactive chat with artifacts')
  .action(async () => {
    const cli = new CortexV4CLI();
    await cli.initialize();

    // Start chat interface
    const chat = new ChatInterface(cli);
    await chat.start();
  });

program
  .command('artifact <action> [id]')
  .description('Manage artifacts')
  .option('-t, --type <type>', 'Artifact type', 'dashboard')
  .option('-d, --data <json>', 'Initial data as JSON')
  .action(async (action, id, options) => {
    const cli = new CortexV4CLI();
    await cli.initialize();

    switch (action) {
      case 'create':
        await cli.createArtifact(options);
        break;
      case 'list':
        await cli.listArtifacts();
        break;
      case 'destroy':
        await cli.destroyArtifact(id);
        break;
    }
  });

program.parse(process.argv);
```

## 2. LLM Tool Integration

```javascript
// tools/ArtifactTools.js - LLM tools for artifact creation

class ArtifactTools {
  constructor(artifactManager) {
    this.artifactManager = artifactManager;
  }

  getToolDefinitions() {
    return [
      {
        name: 'create_artifact',
        description: 'Create an interactive UI artifact',
        parameters: {
          type: 'object',
          properties: {
            type: {
              type: 'string',
              enum: ['dashboard', 'chart', 'table', 'form', 'terminal', 'custom'],
              description: 'Type of artifact to create'
            },
            title: {
              type: 'string',
              description: 'Display title for the artifact'
            },
            data: {
              type: 'object',
              description: 'Initial data for the artifact'
            },
            layout: {
              type: 'object',
              properties: {
                position: {
                  type: 'string',
                  enum: ['top', 'bottom', 'left', 'right'],
                  default: 'right'
                },
                size: {
                  type: 'string',
                  default: '40%',
                  description: 'Size like "50%" or "300px"'
                }
              }
            },
            interactive: {
              type: 'boolean',
              default: true,
              description: 'Enable user interaction'
            }
          },
          required: ['type', 'title']
        }
      },
      {
        name: 'update_artifact',
        description: 'Update artifact data',
        parameters: {
          type: 'object',
          properties: {
            artifactId: {
              type: 'string',
              description: 'ID of the artifact to update'
            },
            data: {
              type: 'object',
              description: 'New data to merge'
            },
            operation: {
              type: 'string',
              enum: ['merge', 'replace', 'append'],
              default: 'merge'
            }
          },
          required: ['artifactId', 'data']
        }
      },
      {
        name: 'destroy_artifact',
        description: 'Remove an artifact',
        parameters: {
          type: 'object',
          properties: {
            artifactId: {
              type: 'string',
              description: 'ID of the artifact to destroy'
            }
          },
          required: ['artifactId']
        }
      },
      {
        name: 'list_artifacts',
        description: 'List all active artifacts',
        parameters: {
          type: 'object',
          properties: {}
        }
      }
    ];
  }

  async execute(toolName, params) {
    switch (toolName) {
      case 'create_artifact':
        return this.createArtifact(params);
      case 'update_artifact':
        return this.updateArtifact(params);
      case 'destroy_artifact':
        return this.destroyArtifact(params);
      case 'list_artifacts':
        return this.listArtifacts();
      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }
  }

  async createArtifact(params) {
    try {
      const artifact = await this.artifactManager.createArtifact({
        type: params.type,
        title: params.title,
        data: params.data || this.getDefaultData(params.type),
        layout: params.layout,
        interactive: params.interactive !== false
      });

      return {
        success: true,
        artifactId: artifact.id,
        message: `Created ${params.type} artifact: ${params.title}`,
        paneId: artifact.paneId
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  async updateArtifact(params) {
    try {
      await this.artifactManager.updateArtifact(params.artifactId, params.data);
      return {
        success: true,
        message: `Updated artifact: ${params.artifactId}`
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  async destroyArtifact(params) {
    try {
      await this.artifactManager.destroyArtifact(params.artifactId);
      return {
        success: true,
        message: `Destroyed artifact: ${params.artifactId}`
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  async listArtifacts() {
    const artifacts = await this.artifactManager.listArtifacts();
    return {
      success: true,
      artifacts: artifacts,
      count: artifacts.length
    };
  }

  getDefaultData(type) {
    const defaults = {
      dashboard: {
        title: 'Dashboard',
        widgets: [
          {
            id: 'widget-1',
            type: 'metric',
            title: 'Sample Metric',
            value: 0,
            unit: 'units'
          }
        ]
      },
      chart: {
        title: 'Chart',
        type: 'bar',
        series: [
          { name: 'Series 1', value: 10 },
          { name: 'Series 2', value: 20 }
        ]
      },
      table: {
        title: 'Table',
        columns: [
          { key: 'id', label: 'ID' },
          { key: 'name', label: 'Name' }
        ],
        rows: [
          { id: 1, name: 'Row 1' }
        ]
      },
      form: {
        title: 'Form',
        schema: {
          field1: {
            label: 'Field 1',
            type: 'text',
            required: true
          }
        }
      },
      terminal: {
        title: 'Terminal',
        prompt: '$ ',
        initialOutput: [
          { text: 'Terminal ready', type: 'info' }
        ]
      }
    };

    return defaults[type] || {};
  }
}

module.exports = ArtifactTools;
```

## 3. Real-time Dashboard Example

```javascript
// examples/dashboard-example.js
const ArtifactManager = require('../artifacts/core/ArtifactManager');

async function createRealtimeDashboard() {
  const manager = new ArtifactManager();
  await manager.initialize();

  // Create dashboard artifact
  const dashboard = await manager.createArtifact({
    type: 'dashboard',
    title: 'System Metrics',
    data: {
      title: 'Real-time System Dashboard',
      autoRefresh: 2000,
      widgets: [
        {
          id: 'cpu',
          type: 'metric',
          title: 'CPU Usage',
          value: 0,
          unit: '%',
          trend: 0,
          badgeColor: 'green'
        },
        {
          id: 'memory',
          type: 'metric',
          title: 'Memory',
          value: 0,
          unit: 'GB',
          trend: 0
        },
        {
          id: 'network',
          type: 'chart',
          title: 'Network I/O',
          data: {
            type: 'sparkline',
            values: []
          }
        },
        {
          id: 'processes',
          type: 'list',
          title: 'Top Processes',
          items: []
        }
      ]
    },
    layout: {
      position: 'right',
      size: '60%'
    },
    interactive: true
  });

  // Simulate real-time updates
  setInterval(async () => {
    const cpuUsage = Math.random() * 100;
    const memoryUsage = Math.random() * 16;
    const networkIO = Math.random() * 1000;

    await manager.updateArtifact(dashboard.id, {
      widgets: [
        {
          id: 'cpu',
          type: 'metric',
          title: 'CPU Usage',
          value: cpuUsage.toFixed(1),
          unit: '%',
          trend: (Math.random() - 0.5) * 10,
          badgeColor: cpuUsage > 80 ? 'red' : cpuUsage > 60 ? 'yellow' : 'green'
        },
        {
          id: 'memory',
          type: 'metric',
          title: 'Memory',
          value: memoryUsage.toFixed(1),
          unit: 'GB',
          trend: (Math.random() - 0.5) * 5
        },
        {
          id: 'network',
          type: 'chart',
          title: 'Network I/O',
          data: {
            type: 'sparkline',
            values: [...(dashboard.data.widgets[2].data.values || []), networkIO].slice(-20)
          }
        },
        {
          id: 'processes',
          type: 'list',
          title: 'Top Processes',
          items: [
            { label: 'node', value: `${(Math.random() * 30).toFixed(1)}%` },
            { label: 'chrome', value: `${(Math.random() * 20).toFixed(1)}%` },
            { label: 'code', value: `${(Math.random() * 15).toFixed(1)}%` }
          ]
        }
      ]
    });
  }, 2000);

  return dashboard;
}

// Run example
createRealtimeDashboard().then(dashboard => {
  console.log('Dashboard created:', dashboard.id);
  console.log('Press Ctrl+C to exit');
});
```

## 4. Interactive Form Example

```javascript
// examples/form-example.js
const ArtifactManager = require('../artifacts/core/ArtifactManager');

async function createConfigForm() {
  const manager = new ArtifactManager();
  await manager.initialize();

  // Create form artifact
  const form = await manager.createArtifact({
    type: 'form',
    title: 'API Configuration',
    data: {
      title: 'Configure API Settings',
      description: 'Set up your API connection parameters',
      schema: {
        endpoint: {
          label: 'API Endpoint',
          type: 'text',
          required: true,
          pattern: '^https?://',
          patternMessage: 'Must be a valid URL',
          placeholder: 'https://api.example.com'
        },
        apiKey: {
          label: 'API Key',
          type: 'text',
          required: true,
          min: 32,
          placeholder: 'Your API key'
        },
        model: {
          label: 'Model',
          type: 'select',
          required: true,
          options: [
            { label: 'GPT-4', value: 'gpt-4' },
            { label: 'GPT-3.5 Turbo', value: 'gpt-3.5-turbo' },
            { label: 'Claude 3', value: 'claude-3' },
            { label: 'Gemini Pro', value: 'gemini-pro' }
          ]
        },
        temperature: {
          label: 'Temperature',
          type: 'number',
          min: 0,
          max: 2,
          default: 0.7
        },
        maxTokens: {
          label: 'Max Tokens',
          type: 'number',
          min: 1,
          max: 32000,
          default: 2048
        },
        stream: {
          label: 'Enable Streaming',
          type: 'boolean',
          default: true
        }
      },
      fields: {
        endpoint: 'http://localhost:4000',
        model: 'gpt-3.5-turbo',
        temperature: '0.7',
        maxTokens: '2048',
        stream: true
      }
    },
    layout: {
      position: 'right',
      size: '50%'
    },
    interactive: true
  });

  // Handle form submission
  manager.bridge.on('message', (msg) => {
    if (msg.artifactId === form.id && msg.type === 'action') {
      if (msg.payload.action === 'form_submit') {
        console.log('Form submitted:', msg.payload.data);

        // Validate and save configuration
        saveConfiguration(msg.payload.data);

        // Show success message
        manager.updateArtifact(form.id, {
          status: 'Configuration saved successfully!',
          statusColor: 'green'
        });
      }
    }
  });

  return form;
}

function saveConfiguration(config) {
  // Save to file or database
  const fs = require('fs');
  fs.writeFileSync('config.json', JSON.stringify(config, null, 2));
  console.log('Configuration saved to config.json');
}

// Run example
createConfigForm().then(form => {
  console.log('Form created:', form.id);
  console.log('Fill out the form and press S to submit');
});
```

## 5. Multi-Artifact Layout Example

```javascript
// examples/multi-artifact-example.js
const ArtifactManager = require('../artifacts/core/ArtifactManager');

async function createMultiArtifactLayout() {
  const manager = new ArtifactManager();
  await manager.initialize();

  // Create main dashboard (top)
  const dashboard = await manager.createArtifact({
    type: 'dashboard',
    title: 'Overview',
    data: {
      title: 'System Overview',
      widgets: [
        { id: 'status', type: 'metric', title: 'Status', value: 'Online', badgeColor: 'green' }
      ]
    },
    layout: {
      position: 'top',
      size: '30%'
    }
  });

  // Create chart (left)
  const chart = await manager.createArtifact({
    type: 'chart',
    title: 'Metrics',
    data: {
      title: 'Performance Metrics',
      type: 'bar',
      series: [
        { name: 'API Calls', value: 1250, color: 'cyan' },
        { name: 'Errors', value: 23, color: 'red' },
        { name: 'Warnings', value: 145, color: 'yellow' }
      ]
    },
    layout: {
      position: 'left',
      size: '40%'
    }
  });

  // Create terminal (bottom-right)
  const terminal = await manager.createArtifact({
    type: 'terminal',
    title: 'Console',
    data: {
      title: 'Debug Console',
      prompt: '> ',
      initialOutput: [
        { text: 'Nexus Cortex Debug Console', type: 'info' },
        { text: 'Type "help" for commands', type: 'info' }
      ]
    },
    layout: {
      position: 'bottom',
      size: '40%'
    },
    interactive: true
  });

  // Apply tiled layout
  await manager.tmuxManager.applyLayout('tiled');

  return { dashboard, chart, terminal };
}

// Run example
createMultiArtifactLayout().then(artifacts => {
  console.log('Multi-artifact layout created');
  console.log('Artifacts:', Object.keys(artifacts));
});
```

## 6. SSE Integration Example

```javascript
// examples/sse-integration.js
const EventSource = require('eventsource');
const ArtifactManager = require('../artifacts/core/ArtifactManager');

class SSEArtifactClient {
  constructor(serverUrl = 'http://localhost:4000') {
    this.serverUrl = serverUrl;
    this.artifactManager = new ArtifactManager();
    this.eventSource = null;
    this.artifacts = new Map();
  }

  async connect() {
    await this.artifactManager.initialize();

    // Connect to SSE endpoint
    this.eventSource = new EventSource(`${this.serverUrl}/events`);

    this.eventSource.onmessage = (event) => {
      this.handleServerEvent(JSON.parse(event.data));
    };

    this.eventSource.onerror = (error) => {
      console.error('SSE error:', error);
    };

    console.log('Connected to SSE server');
  }

  async handleServerEvent(event) {
    switch (event.type) {
      case 'create_artifact':
        await this.createArtifactFromServer(event.data);
        break;

      case 'update_artifact':
        await this.updateArtifactFromServer(event.data);
        break;

      case 'destroy_artifact':
        await this.destroyArtifactFromServer(event.data);
        break;

      case 'message':
        this.handleMessage(event.data);
        break;
    }
  }

  async createArtifactFromServer(data) {
    const artifact = await this.artifactManager.createArtifact(data);
    this.artifacts.set(artifact.id, artifact);

    // Send acknowledgment
    fetch(`${this.serverUrl}/artifacts/${artifact.id}/ack`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'created', paneId: artifact.paneId })
    });
  }

  async updateArtifactFromServer(data) {
    if (this.artifacts.has(data.artifactId)) {
      await this.artifactManager.updateArtifact(data.artifactId, data.update);
    }
  }

  async destroyArtifactFromServer(data) {
    if (this.artifacts.has(data.artifactId)) {
      await this.artifactManager.destroyArtifact(data.artifactId);
      this.artifacts.delete(data.artifactId);
    }
  }

  handleMessage(message) {
    // Handle chat messages with artifact commands
    if (message.content.includes('@artifact')) {
      const command = this.parseArtifactCommand(message.content);
      this.executeCommand(command);
    }
  }

  parseArtifactCommand(content) {
    // Parse commands like "@artifact create dashboard"
    const match = content.match(/@artifact (\w+) (\w+)(.*)/);
    if (match) {
      return {
        action: match[1],
        type: match[2],
        params: match[3] ? JSON.parse(match[3].trim()) : {}
      };
    }
    return null;
  }

  async executeCommand(command) {
    if (!command) return;

    switch (command.action) {
      case 'create':
        await this.artifactManager.createArtifact({
          type: command.type,
          ...command.params
        });
        break;

      case 'update':
        await this.artifactManager.updateArtifact(
          command.params.id,
          command.params.data
        );
        break;

      case 'destroy':
        await this.artifactManager.destroyArtifact(command.params.id);
        break;
    }
  }

  disconnect() {
    if (this.eventSource) {
      this.eventSource.close();
    }
  }
}

// Usage
const client = new SSEArtifactClient();
client.connect().then(() => {
  console.log('SSE artifact client ready');
});
```

## 7. Complete CLI Chat Integration

```javascript
// examples/chat-integration.js
const readline = require('readline');
const ChalkThemes = require('../themes/chalk/chalk-themes.cjs');
const ArtifactManager = require('../artifacts/core/ArtifactManager');
const ArtifactTools = require('../tools/ArtifactTools');

class ChatWithArtifacts {
  constructor() {
    this.theme = new ChalkThemes('tokyoNight');
    this.artifactManager = new ArtifactManager();
    this.artifactTools = null;
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
  }

  async start() {
    // Initialize
    await this.artifactManager.initialize();
    this.artifactTools = new ArtifactTools(this.artifactManager);

    console.log(this.theme.rainbowText('OMNICLAUDE V4 - CHAT WITH ARTIFACTS'));
    console.log(this.theme.dimmed('Type "help" for commands or "@artifact" to create artifacts\n'));

    this.prompt();
  }

  prompt() {
    this.rl.question(this.theme.primary('You: '), async (input) => {
      await this.handleInput(input);
      this.prompt();
    });
  }

  async handleInput(input) {
    // Handle special commands
    if (input === 'help') {
      this.showHelp();
      return;
    }

    if (input === 'exit' || input === 'quit') {
      await this.cleanup();
      process.exit(0);
    }

    if (input.startsWith('@artifact')) {
      await this.handleArtifactCommand(input);
      return;
    }

    if (input === 'list') {
      await this.listArtifacts();
      return;
    }

    // Send to LLM (simulated)
    console.log(this.theme.primary('\n🤖 Assistant:'));
    console.log(this.theme.text('I understand your request. Let me help you with that.\n'));

    // Simulate LLM deciding to create an artifact
    if (input.toLowerCase().includes('dashboard') ||
        input.toLowerCase().includes('chart') ||
        input.toLowerCase().includes('show')) {
      await this.createRelevantArtifact(input);
    }
  }

  async handleArtifactCommand(input) {
    const parts = input.split(' ');
    const command = parts[1];

    try {
      switch (command) {
        case 'create':
          const type = parts[2] || 'dashboard';
          const result = await this.artifactTools.createArtifact({
            type,
            title: `New ${type}`,
            data: this.artifactTools.getDefaultData(type)
          });
          console.log(this.theme.successMessage(result.message));
          break;

        case 'list':
          await this.listArtifacts();
          break;

        case 'destroy':
          const id = parts[2];
          if (id) {
            await this.artifactTools.destroyArtifact({ artifactId: id });
            console.log(this.theme.infoMessage(`Destroyed artifact: ${id}`));
          }
          break;

        default:
          console.log(this.theme.errorMessage('Unknown artifact command'));
      }
    } catch (error) {
      console.log(this.theme.errorMessage(`Error: ${error.message}`));
    }
  }

  async createRelevantArtifact(input) {
    console.log(this.theme.infoMessage('Creating relevant artifact...'));

    let artifactType = 'dashboard';
    if (input.includes('chart') || input.includes('graph')) {
      artifactType = 'chart';
    } else if (input.includes('table') || input.includes('list')) {
      artifactType = 'table';
    } else if (input.includes('form') || input.includes('config')) {
      artifactType = 'form';
    }

    const result = await this.artifactTools.createArtifact({
      type: artifactType,
      title: `${artifactType.charAt(0).toUpperCase() + artifactType.slice(1)} View`,
      data: this.getContextualData(artifactType, input)
    });

    console.log(this.theme.successMessage(`Created ${artifactType} artifact`));
  }

  getContextualData(type, input) {
    // Generate contextual data based on user input
    const baseData = this.artifactTools.getDefaultData(type);

    // Customize based on input keywords
    if (input.includes('metrics') || input.includes('performance')) {
      if (type === 'dashboard') {
        baseData.widgets = [
          {
            id: 'cpu',
            type: 'metric',
            title: 'CPU Usage',
            value: 45.2,
            unit: '%'
          },
          {
            id: 'memory',
            type: 'metric',
            title: 'Memory',
            value: 8.3,
            unit: 'GB'
          }
        ];
      }
    }

    return baseData;
  }

  async listArtifacts() {
    const result = await this.artifactTools.listArtifacts();
    if (result.artifacts.length === 0) {
      console.log(this.theme.dimmed('No active artifacts'));
    } else {
      console.log(this.theme.text.bold('\nActive Artifacts:'));
      result.artifacts.forEach(a => {
        console.log(this.theme.text(`  ${a.id} (${a.type}) - ${a.title} [${a.state}]`));
      });
    }
  }

  showHelp() {
    console.log(this.theme.text.bold('\nAvailable Commands:'));
    console.log(this.theme.success('  @artifact create [type]') + ' - Create an artifact');
    console.log(this.theme.success('  @artifact list') + ' - List all artifacts');
    console.log(this.theme.success('  @artifact destroy [id]') + ' - Destroy an artifact');
    console.log(this.theme.success('  list') + ' - List active artifacts');
    console.log(this.theme.success('  help') + ' - Show this help');
    console.log(this.theme.success('  exit') + ' - Exit the application\n');
  }

  async cleanup() {
    console.log(this.theme.warningMessage('\nCleaning up...'));
    const artifacts = await this.artifactManager.listArtifacts();
    for (const artifact of artifacts) {
      await this.artifactManager.destroyArtifact(artifact.id);
    }
    this.rl.close();
  }
}

// Start the chat
const chat = new ChatWithArtifacts();
chat.start().catch(console.error);
```

## Running the Examples

```bash
# Basic CLI
node cli.js chat

# Create artifacts via CLI
node cli.js artifact create --type dashboard --data '{"title":"My Dashboard"}'

# Run specific examples
node examples/dashboard-example.js
node examples/form-example.js
node examples/multi-artifact-example.js
node examples/sse-integration.js
node examples/chat-integration.js
```

## Testing

```bash
# Test message protocol
node test/protocol-test.js

# Test artifact creation
node test/artifact-test.js

# Test tmux integration
node test/tmux-test.js
```

## Deployment Considerations

1. **Tmux Requirement**: Ensure tmux is installed on the target system
2. **Port Configuration**: Configure message bridge port via environment variable
3. **Session Persistence**: Store artifact definitions for session recovery
4. **Error Handling**: Implement comprehensive error recovery
5. **Resource Limits**: Set maximum artifact count and memory limits
6. **Security**: Validate all component code and sandbox execution

## Next Steps

1. Implement component sandboxing for security
2. Add artifact persistence and session recovery
3. Create more component templates
4. Implement artifact sharing and export
5. Add performance monitoring and optimization
6. Create comprehensive test suite
7. Document API and create developer guide