# Dynamic Artifact System - Implementation Guide

## Table of Contents
1. [Architecture Overview](#architecture-overview)
2. [Core Contracts](#core-contracts)
3. [Implementation Steps](#implementation-steps)
4. [Message Protocol](#message-protocol)
5. [Component Templates](#component-templates)
6. [Integration Guide](#integration-guide)
7. [Security Considerations](#security-considerations)

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     ARTIFACT SYSTEM                          │
├───────────────────┬─────────────────┬───────────────────────┤
│   CLI Process     │  Tmux Manager   │   Artifact Process   │
│   (Main Thread)   │  (Controller)    │   (React/Ink)        │
├───────────────────┼─────────────────┼───────────────────────┤
│                   │                 │                       │
│  CreateArtifact ──┼─> SpawnPane ────┼─> RenderComponent    │
│       ↓           │       ↓         │         ↓             │
│  UpdateStream ────┼─> RouteMessage ─┼─> HandleUpdate       │
│       ↓           │       ↓         │         ↓             │
│  CloseArtifact ───┼─> KillPane ─────┼─> Cleanup            │
│                   │                 │                       │
└───────────────────┴─────────────────┴───────────────────────┘
```

## Core Contracts

### 1. Artifact Definition Contract

```typescript
// contracts/artifact.types.ts

export interface ArtifactDefinition {
  // Required fields
  id: string;                    // Unique identifier
  type: ArtifactType;            // Type of artifact

  // Display
  title: string;                 // Display title
  description?: string;          // Optional description

  // Component
  component?: string | ComponentTemplate;  // React component
  data: Record<string, any>;               // Initial data

  // Layout
  layout?: ArtifactLayout;       // Tmux layout configuration

  // Behavior
  interactive?: boolean;         // Enable user interaction
  realtime?: boolean;           // Enable real-time updates
  persistent?: boolean;         // Persist across sessions

  // Metadata
  createdAt?: Date;
  createdBy?: string;           // User or LLM
  tags?: string[];
}

export enum ArtifactType {
  DASHBOARD = 'dashboard',
  CHART = 'chart',
  TABLE = 'table',
  FORM = 'form',
  TERMINAL = 'terminal',
  MARKDOWN = 'markdown',
  CODE = 'code',
  CUSTOM = 'custom'
}

export interface ArtifactLayout {
  position: 'top' | 'bottom' | 'left' | 'right' | 'floating';
  size?: string;                // '50%' | '300px' | 'auto'
  minSize?: string;
  maxSize?: string;
  split?: 'horizontal' | 'vertical';
  focus?: boolean;              // Auto-focus on creation
}

export interface ComponentTemplate {
  source: 'builtin' | 'file' | 'inline';
  name?: string;                // For builtin templates
  path?: string;                // For file templates
  code?: string;                // For inline templates
  props?: Record<string, any>;  // Default props
}
```

### 2. Artifact Lifecycle Contract

```typescript
// contracts/lifecycle.types.ts

export interface ArtifactLifecycle {
  // Creation
  onCreate?: (artifact: Artifact) => Promise<void>;
  onMount?: (artifact: Artifact) => Promise<void>;

  // Updates
  onDataUpdate?: (artifact: Artifact, data: any) => Promise<void>;
  onStateChange?: (artifact: Artifact, state: ArtifactState) => Promise<void>;

  // Interaction
  onUserInput?: (artifact: Artifact, input: UserInput) => Promise<void>;
  onCommand?: (artifact: Artifact, command: string, args: any[]) => Promise<void>;

  // Destruction
  onUnmount?: (artifact: Artifact) => Promise<void>;
  onDestroy?: (artifact: Artifact) => Promise<void>;
}

export enum ArtifactState {
  INITIALIZING = 'initializing',
  READY = 'ready',
  UPDATING = 'updating',
  ERROR = 'error',
  SUSPENDED = 'suspended',
  DESTROYED = 'destroyed'
}

export interface UserInput {
  type: 'keyboard' | 'mouse' | 'command';
  key?: string;
  value?: any;
  timestamp: number;
}
```

### 3. Message Protocol Contract

```typescript
// contracts/protocol.types.ts

export interface ArtifactMessage {
  // Message metadata
  id: string;                    // Message ID
  artifactId: string;            // Target artifact
  timestamp: number;             // Unix timestamp

  // Message content
  type: MessageType;             // Message type
  payload: any;                  // Message payload

  // Routing
  source: 'cli' | 'artifact' | 'server' | 'user';
  target?: 'cli' | 'artifact' | 'server' | 'all';

  // Response handling
  requiresAck?: boolean;         // Requires acknowledgment
  timeout?: number;              // Response timeout (ms)
  correlationId?: string;        // For request-response
}

export enum MessageType {
  // Lifecycle
  CREATE = 'create',
  MOUNT = 'mount',
  UNMOUNT = 'unmount',
  DESTROY = 'destroy',

  // Data
  DATA_UPDATE = 'data_update',
  STATE_CHANGE = 'state_change',

  // Interaction
  USER_INPUT = 'user_input',
  COMMAND = 'command',

  // Control
  FOCUS = 'focus',
  RESIZE = 'resize',
  REFRESH = 'refresh',

  // System
  ERROR = 'error',
  LOG = 'log',
  HEARTBEAT = 'heartbeat'
}
```

### 4. Tmux Manager Contract

```typescript
// contracts/tmux.types.ts

export interface TmuxManager {
  // Session management
  createSession(name: string): Promise<string>;
  attachSession(name: string): Promise<void>;
  listSessions(): Promise<TmuxSession[]>;
  killSession(name: string): Promise<void>;

  // Pane management
  createPane(options: PaneOptions): Promise<string>;
  splitPane(paneId: string, options: SplitOptions): Promise<string>;
  resizePane(paneId: string, size: string): Promise<void>;
  killPane(paneId: string): Promise<void>;

  // Command execution
  sendKeys(paneId: string, keys: string): Promise<void>;
  runCommand(paneId: string, command: string): Promise<void>;
  captureOutput(paneId: string): Promise<string>;

  // Layout
  applyLayout(layout: string): Promise<void>;
  saveLayout(): Promise<string>;
  restoreLayout(layout: string): Promise<void>;
}

export interface PaneOptions {
  title: string;
  command?: string;
  workingDir?: string;
  environment?: Record<string, string>;
  size?: string;
  position?: 'top' | 'bottom' | 'left' | 'right';
}

export interface SplitOptions {
  direction: 'horizontal' | 'vertical';
  size?: string;
  before?: boolean;              // Insert before current pane
}

export interface TmuxSession {
  name: string;
  created: Date;
  attached: boolean;
  windows: number;
  panes: number;
}
```

## Implementation Steps

### Phase 1: Core Infrastructure (Week 1)

```javascript
// src/artifacts/core/ArtifactManager.js

const EventEmitter = require('events');
const { v4: uuidv4 } = require('uuid');

class ArtifactManager extends EventEmitter {
  constructor(options = {}) {
    super();
    this.artifacts = new Map();
    this.tmux = options.tmuxManager || new TmuxManager();
    this.bridge = options.messageBridge || new MessageBridge();
    this.templates = options.templates || new TemplateRegistry();
  }

  async initialize() {
    // Setup tmux session
    await this.tmux.initialize();

    // Setup message bridge
    await this.bridge.initialize();

    // Load templates
    await this.templates.load();

    // Setup event handlers
    this.setupEventHandlers();
  }

  async createArtifact(definition) {
    // Validate definition
    const validated = await this.validateDefinition(definition);

    // Generate ID if not provided
    if (!validated.id) {
      validated.id = `artifact-${uuidv4()}`;
    }

    // Create artifact instance
    const artifact = new Artifact(validated);

    // Register artifact
    this.artifacts.set(artifact.id, artifact);

    // Create tmux pane
    const paneId = await this.tmux.createPane({
      title: artifact.title,
      position: artifact.layout?.position || 'right',
      size: artifact.layout?.size || '40%'
    });

    artifact.paneId = paneId;

    // Render component
    await artifact.render(this.tmux);

    // Setup message routing
    this.bridge.registerArtifact(artifact);

    // Emit creation event
    this.emit('artifact:created', artifact);

    return artifact;
  }

  async validateDefinition(definition) {
    // Type validation
    if (!definition.type || !Object.values(ArtifactType).includes(definition.type)) {
      throw new Error(`Invalid artifact type: ${definition.type}`);
    }

    // Component validation
    if (definition.type === 'custom' && !definition.component) {
      throw new Error('Custom artifacts require a component definition');
    }

    // Data validation
    if (!definition.data) {
      definition.data = {};
    }

    return definition;
  }

  setupEventHandlers() {
    // Handle artifact messages
    this.bridge.on('message', async (message) => {
      const artifact = this.artifacts.get(message.artifactId);
      if (artifact) {
        await artifact.handleMessage(message);
      }
    });

    // Handle artifact lifecycle
    this.on('artifact:ready', (artifact) => {
      console.log(`Artifact ${artifact.id} is ready`);
    });

    this.on('artifact:error', (artifact, error) => {
      console.error(`Artifact ${artifact.id} error:`, error);
    });
  }

  async updateArtifact(id, data) {
    const artifact = this.artifacts.get(id);
    if (!artifact) {
      throw new Error(`Artifact not found: ${id}`);
    }

    await artifact.update(data);
  }

  async destroyArtifact(id) {
    const artifact = this.artifacts.get(id);
    if (!artifact) {
      return;
    }

    // Cleanup
    await artifact.destroy();

    // Kill tmux pane
    await this.tmux.killPane(artifact.paneId);

    // Unregister
    this.artifacts.delete(id);
    this.bridge.unregisterArtifact(artifact);

    // Emit event
    this.emit('artifact:destroyed', artifact);
  }

  async listArtifacts() {
    return Array.from(this.artifacts.values()).map(a => ({
      id: a.id,
      type: a.type,
      title: a.title,
      state: a.state,
      paneId: a.paneId
    }));
  }
}

module.exports = ArtifactManager;
```

### Phase 2: Artifact Class Implementation

```javascript
// src/artifacts/core/Artifact.js

class Artifact extends EventEmitter {
  constructor(definition) {
    super();
    Object.assign(this, definition);
    this.state = ArtifactState.INITIALIZING;
    this.process = null;
    this.messageQueue = [];
  }

  async render(tmux) {
    try {
      // Get component
      const Component = await this.resolveComponent();

      // Create render script
      const script = this.createRenderScript(Component);

      // Write to temp file
      const scriptPath = await this.writeScriptFile(script);

      // Run in tmux pane
      await tmux.runCommand(this.paneId, `node ${scriptPath}`);

      // Wait for ready signal
      await this.waitForReady();

      this.state = ArtifactState.READY;
      this.emit('ready');

    } catch (error) {
      this.state = ArtifactState.ERROR;
      this.emit('error', error);
      throw error;
    }
  }

  async resolveComponent() {
    if (this.type === 'custom') {
      return this.compileCustomComponent(this.component);
    }

    // Use template
    const template = await TemplateRegistry.get(this.type);
    if (!template) {
      throw new Error(`Template not found: ${this.type}`);
    }

    return template;
  }

  createRenderScript(Component) {
    return `
      const React = require('react');
      const { render } = require('ink');
      const { MessageBridge } = require('../bridge/MessageBridge');

      // Component definition
      ${Component.toString()}

      // Create bridge
      const bridge = new MessageBridge('${this.id}');

      // Initial data
      const initialData = ${JSON.stringify(this.data)};

      // Create app
      const App = () => {
        const [data, setData] = React.useState(initialData);
        const [state, setState] = React.useState('ready');

        React.useEffect(() => {
          // Setup message handler
          bridge.on('message', (msg) => {
            if (msg.type === 'data_update') {
              setData(msg.payload);
            }
            if (msg.type === 'state_change') {
              setState(msg.payload);
            }
          });

          // Send ready signal
          bridge.send({
            type: 'ready',
            artifactId: '${this.id}'
          });
        }, []);

        return React.createElement(Component, {
          data,
          state,
          bridge,
          interactive: ${this.interactive || false}
        });
      };

      // Render
      const { unmount } = render(React.createElement(App));

      // Cleanup on exit
      process.on('SIGTERM', () => {
        unmount();
        process.exit(0);
      });
    `;
  }

  async update(data) {
    if (this.state !== ArtifactState.READY) {
      this.messageQueue.push({ type: 'data_update', payload: data });
      return;
    }

    await this.sendMessage({
      type: MessageType.DATA_UPDATE,
      payload: data
    });
  }

  async handleMessage(message) {
    switch (message.type) {
      case MessageType.USER_INPUT:
        await this.handleUserInput(message.payload);
        break;

      case MessageType.COMMAND:
        await this.handleCommand(message.payload);
        break;

      case MessageType.STATE_CHANGE:
        this.state = message.payload;
        this.emit('state_change', this.state);
        break;

      default:
        this.emit('message', message);
    }
  }

  async destroy() {
    this.state = ArtifactState.DESTROYED;

    // Send destroy signal
    await this.sendMessage({ type: MessageType.DESTROY });

    // Kill process if exists
    if (this.process) {
      this.process.kill('SIGTERM');
    }

    this.emit('destroyed');
  }
}
```

### Phase 3: Message Bridge Implementation

```javascript
// src/artifacts/bridge/MessageBridge.js

const EventEmitter = require('events');
const net = require('net');

class MessageBridge extends EventEmitter {
  constructor(artifactId = null) {
    super();
    this.artifactId = artifactId;
    this.server = null;
    this.clients = new Map();
    this.port = null;
  }

  async initialize() {
    if (this.artifactId) {
      // Client mode - connect to main bridge
      await this.connectToMainBridge();
    } else {
      // Server mode - create bridge server
      await this.createBridgeServer();
    }
  }

  async createBridgeServer() {
    this.server = net.createServer((socket) => {
      const clientId = uuidv4();

      socket.on('data', (data) => {
        try {
          const messages = data.toString().split('\n')
            .filter(m => m.trim())
            .map(m => JSON.parse(m));

          messages.forEach(msg => {
            this.routeMessage(msg, clientId);
          });
        } catch (error) {
          console.error('Message parse error:', error);
        }
      });

      socket.on('close', () => {
        this.clients.delete(clientId);
      });

      this.clients.set(clientId, socket);
    });

    // Find available port
    this.port = await this.findAvailablePort();

    return new Promise((resolve) => {
      this.server.listen(this.port, () => {
        console.log(`Message bridge listening on port ${this.port}`);
        resolve(this.port);
      });
    });
  }

  async connectToMainBridge() {
    const port = process.env.ARTIFACT_BRIDGE_PORT || 9876;

    return new Promise((resolve, reject) => {
      this.socket = net.connect(port, 'localhost', () => {
        console.log(`Connected to bridge on port ${port}`);

        // Register artifact
        this.send({
          type: 'register',
          artifactId: this.artifactId
        });

        resolve();
      });

      this.socket.on('data', (data) => {
        try {
          const messages = data.toString().split('\n')
            .filter(m => m.trim())
            .map(m => JSON.parse(m));

          messages.forEach(msg => {
            this.emit('message', msg);
          });
        } catch (error) {
          console.error('Message parse error:', error);
        }
      });

      this.socket.on('error', reject);
    });
  }

  send(message) {
    const data = JSON.stringify({
      ...message,
      artifactId: this.artifactId,
      timestamp: Date.now()
    }) + '\n';

    if (this.socket) {
      // Client mode
      this.socket.write(data);
    } else if (this.server) {
      // Server mode - broadcast
      this.broadcast(data);
    }
  }

  broadcast(data, excludeClient = null) {
    this.clients.forEach((socket, clientId) => {
      if (clientId !== excludeClient) {
        socket.write(data);
      }
    });
  }

  routeMessage(message, clientId) {
    // Route to specific artifact or broadcast
    if (message.artifactId) {
      const targetClient = Array.from(this.clients.entries())
        .find(([id, socket]) => {
          // Find client for this artifact
          return socket.artifactId === message.artifactId;
        });

      if (targetClient) {
        targetClient[1].write(JSON.stringify(message) + '\n');
      }
    } else {
      // Broadcast to all
      this.broadcast(JSON.stringify(message) + '\n', clientId);
    }

    // Also emit locally
    this.emit('message', message);
  }

  async findAvailablePort() {
    return new Promise((resolve) => {
      const server = net.createServer();
      server.listen(0, () => {
        const port = server.address().port;
        server.close(() => resolve(port));
      });
    });
  }
}

module.exports = MessageBridge;
```

## Component Templates

### Dashboard Template

```javascript
// src/artifacts/templates/dashboard.template.js

module.exports = function DashboardTemplate({ data, state, bridge, interactive }) {
  const React = require('react');
  const { Box, Text, useInput } = require('ink');
  const { useState, useEffect } = React;

  const [selectedMetric, setSelectedMetric] = useState(0);
  const [refreshRate, setRefreshRate] = useState(5000);

  useEffect(() => {
    const interval = setInterval(() => {
      bridge.send({
        type: 'refresh_request',
        metric: data.metrics?.[selectedMetric]?.id
      });
    }, refreshRate);

    return () => clearInterval(interval);
  }, [refreshRate, selectedMetric]);

  useInput((input, key) => {
    if (!interactive) return;

    if (key.upArrow) {
      setSelectedMetric(Math.max(0, selectedMetric - 1));
    }
    if (key.downArrow) {
      setSelectedMetric(Math.min(data.metrics?.length - 1, selectedMetric + 1));
    }
    if (input === 'r') {
      bridge.send({ type: 'refresh_all' });
    }
    if (input === 'q') {
      bridge.send({ type: 'close' });
    }
  });

  const renderMetric = (metric, index) => {
    const isSelected = index === selectedMetric;
    const color = isSelected ? 'cyan' : 'white';
    const prefix = isSelected ? '▶ ' : '  ';

    return (
      <Box key={metric.id} marginBottom={1}>
        <Text color={color}>
          {prefix}{metric.label}:
        </Text>
        <Text color={metric.status === 'good' ? 'green' : 'yellow'}>
          {' '}{metric.value}
        </Text>
        <Text color="gray"> {metric.unit}</Text>
        {metric.trend && (
          <Text color={metric.trend > 0 ? 'green' : 'red'}>
            {' '}({metric.trend > 0 ? '↑' : '↓'}{Math.abs(metric.trend)}%)
          </Text>
        )}
      </Box>
    );
  };

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan">
      <Box padding={1} borderStyle="single" borderColor="gray">
        <Text color="cyan" bold>📊 {data.title || 'Dashboard'}</Text>
        {state === 'updating' && <Text color="yellow"> (Updating...)</Text>}
      </Box>

      <Box flexDirection="column" padding={1}>
        {data.metrics?.map(renderMetric)}
      </Box>

      {interactive && (
        <Box padding={1} borderStyle="single" borderColor="gray">
          <Text color="gray">
            ↑↓ Navigate | R: Refresh | Q: Close
          </Text>
        </Box>
      )}
    </Box>
  );
};
```

## Integration Guide

### CLI Integration

```javascript
// src/cli/commands/artifact.command.js

class ArtifactCommand {
  constructor(cli) {
    this.cli = cli;
    this.artifactManager = new ArtifactManager({
      tmuxManager: cli.tmuxManager,
      messageBridge: cli.messageBridge
    });
  }

  async execute(command, args) {
    switch (command) {
      case 'create':
        return this.createArtifact(args);
      case 'update':
        return this.updateArtifact(args);
      case 'destroy':
        return this.destroyArtifact(args);
      case 'list':
        return this.listArtifacts();
      default:
        throw new Error(`Unknown artifact command: ${command}`);
    }
  }

  async createArtifact(args) {
    const definition = {
      type: args.type || 'dashboard',
      title: args.title || 'New Artifact',
      data: args.data || {},
      layout: {
        position: args.position || 'right',
        size: args.size || '40%'
      },
      interactive: args.interactive !== false
    };

    const artifact = await this.artifactManager.createArtifact(definition);

    console.log(chalk.green(`✓ Created artifact: ${artifact.id}`));

    return artifact;
  }

  async updateArtifact(args) {
    if (!args.id) {
      throw new Error('Artifact ID required');
    }

    await this.artifactManager.updateArtifact(args.id, args.data);

    console.log(chalk.green(`✓ Updated artifact: ${args.id}`));
  }

  async destroyArtifact(args) {
    if (!args.id) {
      throw new Error('Artifact ID required');
    }

    await this.artifactManager.destroyArtifact(args.id);

    console.log(chalk.green(`✓ Destroyed artifact: ${args.id}`));
  }

  async listArtifacts() {
    const artifacts = await this.artifactManager.listArtifacts();

    console.log(chalk.cyan('\nActive Artifacts:'));
    artifacts.forEach(a => {
      console.log(`  ${a.id} (${a.type}) - ${a.title} [${a.state}]`);
    });

    return artifacts;
  }
}

module.exports = ArtifactCommand;
```

### LLM Tool Integration

```javascript
// src/tools/CreateArtifactTool.js

class CreateArtifactTool {
  constructor(artifactManager) {
    this.artifactManager = artifactManager;
  }

  get definition() {
    return {
      name: 'create_artifact',
      description: 'Create an interactive UI artifact',
      parameters: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['dashboard', 'chart', 'table', 'form', 'custom'],
            description: 'Type of artifact to create'
          },
          title: {
            type: 'string',
            description: 'Title for the artifact'
          },
          data: {
            type: 'object',
            description: 'Initial data for the artifact'
          },
          component: {
            type: 'string',
            description: 'Custom React component code (for custom type)'
          },
          layout: {
            type: 'object',
            properties: {
              position: {
                type: 'string',
                enum: ['top', 'bottom', 'left', 'right']
              },
              size: {
                type: 'string',
                description: 'Size like "50%" or "300px"'
              }
            }
          },
          interactive: {
            type: 'boolean',
            description: 'Enable user interaction'
          }
        },
        required: ['type', 'title', 'data']
      }
    };
  }

  async execute(params) {
    try {
      const artifact = await this.artifactManager.createArtifact(params);

      return {
        success: true,
        artifactId: artifact.id,
        message: `Created ${params.type} artifact: ${artifact.title}`
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }
}

module.exports = CreateArtifactTool;
```

## Security Considerations

### 1. Component Sandboxing

```javascript
// src/artifacts/security/ComponentSandbox.js

const vm = require('vm');

class ComponentSandbox {
  constructor() {
    this.context = this.createSecureContext();
  }

  createSecureContext() {
    return {
      React: require('react'),
      console: {
        log: (...args) => console.log('[Artifact]', ...args),
        error: (...args) => console.error('[Artifact]', ...args)
      },
      // Limited globals
      setTimeout,
      setInterval,
      clearTimeout,
      clearInterval,
      Date,
      Math,
      JSON
      // No: require, process, fs, child_process, etc.
    };
  }

  compile(code) {
    const script = new vm.Script(code);
    const sandbox = vm.createContext(this.context);

    return script.runInContext(sandbox);
  }
}
```

### 2. Message Validation

```javascript
// src/artifacts/security/MessageValidator.js

const Joi = require('joi');

class MessageValidator {
  constructor() {
    this.schema = Joi.object({
      id: Joi.string().uuid().required(),
      artifactId: Joi.string().uuid().required(),
      type: Joi.string().valid(...Object.values(MessageType)).required(),
      payload: Joi.any(),
      source: Joi.string().required(),
      timestamp: Joi.number().required()
    });
  }

  validate(message) {
    const { error, value } = this.schema.validate(message);

    if (error) {
      throw new Error(`Invalid message: ${error.message}`);
    }

    return value;
  }
}
```

## Next Steps

1. **Implement Phase 1** - Core infrastructure
2. **Test tmux integration** - Ensure pane management works
3. **Build template library** - Create reusable components
4. **Add LLM tools** - Enable AI-driven artifact creation
5. **Security hardening** - Sandbox and validate all inputs
6. **Performance optimization** - Message batching, lazy loading
7. **Documentation** - API docs and examples