# Complete CLI Implementation Plan

**Based On**: CLI_FEATURE_MAPPING.md - every core library feature mapped to CLI access

---

## Overview

**Goal**: Provide deterministic CLI commands + interactive components + natural language access for ALL core library features

**Architecture**:
- **Chalk**: Deterministic commands with themed text output
- **Ink**: Interactive menus/browsers with keyboard navigation
- **Natural Language**: Chat interface for tool invocation

**Total Implementation**:
- 16 new server endpoints
- ~80 deterministic commands
- ~10 interactive Ink components
- Enhanced streaming chat

---

## Phase 1: Server Endpoints (2 weeks)

### Add Missing Critical Endpoints

**File**: `packages/server/src/routes/sessions.ts`

```typescript
// Model switching
router.post('/:sessionId/model', async (req, res) => {
  const { modelId, reason } = req.body;
  const orchestrator = getServerOrchestrator();
  const result = await orchestrator.switchModel(modelId, { reason });
  res.json(result);
});

// Context status
router.get('/:sessionId/context', async (req, res) => {
  const orchestrator = getServerOrchestrator();
  const contextManager = orchestrator.getContextBudgetManager();
  const status = contextManager.getStatus();
  res.json(status);
});

// Cache metrics
router.get('/:sessionId/cache/metrics', async (req, res) => {
  const orchestrator = getServerOrchestrator();
  const metrics = orchestrator.getCacheMetrics();
  res.json(metrics);
});

// Compaction
router.post('/:sessionId/compaction', async (req, res) => {
  const orchestrator = getServerOrchestrator();
  await orchestrator.performManualCompaction();
  res.json({ success: true });
});

router.get('/:sessionId/compaction/boundaries', async (req, res) => {
  const orchestrator = getServerOrchestrator();
  const boundaries = orchestrator.getCompactionBoundaries();
  res.json(boundaries);
});
```

**File**: `packages/server/src/routes/tools.ts` (new)

```typescript
import { Router } from 'express';
import { getServerOrchestrator } from './messages.js';

const router = Router();

// List all available tools
router.get('/', async (req, res) => {
  const orchestrator = getServerOrchestrator();
  const toolFactory = orchestrator.getToolFactory();
  const tools = toolFactory.getAllTools();
  res.json({
    tools: tools.map(t => ({
      name: t.name,
      description: t.description,
      inputSchema: t.input_schema,
    })),
  });
});

// Get specific tool details
router.get('/:name', async (req, res) => {
  const orchestrator = getServerOrchestrator();
  const toolFactory = orchestrator.getToolFactory();
  const tool = toolFactory.getTool(req.params.name);
  if (!tool) {
    return res.status(404).json({ error: 'Tool not found' });
  }
  res.json(tool);
});

export default router;
```

**File**: `packages/server/src/routes/permissions.ts` (new)

```typescript
import { Router } from 'express';
import { getServerOrchestrator } from './messages.js';

const router = Router();

// List tool permissions
router.get('/tools', async (req, res) => {
  const orchestrator = getServerOrchestrator();
  const permissions = orchestrator.getPermissions();
  res.json(permissions);
});

// Grant/revoke permission
router.post('/tool/:name', async (req, res) => {
  const { action } = req.body; // 'grant' or 'revoke'
  const orchestrator = getServerOrchestrator();
  const result = await orchestrator.setToolPermission(req.params.name, action);
  res.json(result);
});

export default router;
```

**File**: `packages/server/src/routes/middleware.ts` (new)

```typescript
import { Router } from 'express';
import { getServerOrchestrator } from './messages.js';

const router = Router();

// List middleware
router.get('/config', async (req, res) => {
  const orchestrator = getServerOrchestrator();
  const config = orchestrator.getMiddlewareConfig();
  res.json(config);
});

// Enable middleware
router.post('/:name/enable', async (req, res) => {
  const orchestrator = getServerOrchestrator();
  await orchestrator.enableMiddleware(req.params.name);
  res.json({ success: true });
});

// Disable middleware
router.post('/:name/disable', async (req, res) => {
  const orchestrator = getServerOrchestrator();
  await orchestrator.disableMiddleware(req.params.name);
  res.json({ success: true });
});

export default router;
```

**File**: `packages/server/src/routes/system-messages.ts` (new)

```typescript
import { Router } from 'express';
import { getServerOrchestrator } from './messages.js';

const router = Router();

// List system messages
router.get('/', async (req, res) => {
  const orchestrator = getServerOrchestrator();
  const loader = orchestrator.getSystemMessageLoader();
  const messages = loader.listMessages();
  res.json(messages);
});

// Reload system messages
router.post('/reload', async (req, res) => {
  const orchestrator = getServerOrchestrator();
  const loader = orchestrator.getSystemMessageLoader();
  await loader.reload();
  res.json({ success: true });
});

export default router;
```

**Update**: `packages/server/src/index.ts`

```typescript
import toolsRoutes from './routes/tools.js';
import permissionsRoutes from './routes/permissions.js';
import middlewareRoutes from './routes/middleware.js';
import systemMessagesRoutes from './routes/system-messages.js';

// ... in setupRoutes()
this.app.use('/tools', toolsRoutes);
this.app.use('/permissions', permissionsRoutes);
this.app.use('/middleware', middlewareRoutes);
this.app.use('/system-messages', systemMessagesRoutes);
```

**Timeline**: 2 weeks
- Week 1: Add 5 critical endpoints (model, context, cache, tools, permissions)
- Week 2: Add 6 important endpoints (compaction, middleware, system-messages)

---

## Phase 2: Command Cleanup & Implementation (2 weeks)

### Archive Strategy

**Why Archive Instead of Delete**:
1. **Preserve work** - 60 commands represent development effort
2. **Historical reference** - Show evolution of CLI design
3. **Learning resource** - Examples of what not to do
4. **Potential reuse** - Some patterns may be useful later
5. **Audit trail** - Track decisions and rationale

**Archive Structure**:
```
docs/commands_archive/
├── README.md                     # Documentation of archived commands
├── invalid/                      # Commands calling non-existent endpoints (40)
│   ├── models/                   # favorites, test, alias (4)
│   ├── sessions/                 # compare, merge, split (3)
│   ├── mcp/                      # search, configure (2)
│   ├── config/                   # validate, import (2)
│   ├── stats/                    # global stats (1)
│   ├── debug/                    # logs, errors, tools, middleware (4)
│   └── middleware/               # All middleware commands (24)
│       ├── mentorship/           # status, enable, disable, keywords, model, log (6)
│       ├── helper/               # status, set, test, history (4)
│       ├── middleware/           # list, status, enable, disable, config (5)
│       ├── retry/                # status, stats, classify (3)
│       └── limits/               # status, set (2)
└── tool-based/                   # Commands replaced by natural language (20)
    ├── artifacts/                # create, inspect, interact, modify (4)
    ├── tmux/                     # create, send, capture (3)
    └── history/                  # All history commands (4)
```

**Archive Commands Script**:
```bash
# Week 1 Day 1: Create archive and move commands
./scripts/archive-commands.sh
```

### Command Structure

**File**: `packages/cli/src/commands/registry.ts` (new)

Central command registry:

```typescript
export interface Command {
  name: string;
  description: string;
  usage: string;
  category: string;
  handler: (args: any, options: any) => Promise<void>;
}

export const commandRegistry: Command[] = [
  // Sessions
  { name: 'sessions list', category: 'session', ... },
  { name: 'sessions view', category: 'session', ... },

  // Models
  { name: 'models list', category: 'model', ... },
  { name: 'model', category: 'model', ... },

  // MCP
  { name: 'mcp list', category: 'mcp', ... },
  { name: 'mcp enable', category: 'mcp', ... },

  // ... all ~80 commands
];
```

### Command Categories

**File**: `packages/cli/src/commands/sessions.ts`

```typescript
export async function sessionsList(options) {
  const client = new CortexClient(options.serverUrl);
  const sessions = await client.get('/sessions');

  if (options.json) {
    console.log(JSON.stringify(sessions, null, 2));
    return;
  }

  const theme = ThemeManager.getTheme();
  console.log(theme.colors.primary(`\n📋 Sessions (${sessions.length})\n`));
  sessions.forEach(session => {
    console.log(theme.colors.highlight(session.id));
    console.log(theme.colors.muted(`  Model: ${session.model}`));
    console.log(theme.colors.muted(`  Messages: ${session.messageCount}\n`));
  });
}

export async function sessionsView(id, options) { /* ... */ }
export async function sessionsExport(id, options) { /* ... */ }
export async function sessionsStats(id, options) { /* ... */ }
export async function sessionsDelete(id, options) { /* ... */ }
```

**File**: `packages/cli/src/commands/models.ts`

```typescript
export async function modelsList(options) { /* GET /models */ }
export async function modelsInfo(id, options) { /* GET /models + filter */ }
export async function modelsProviders(options) { /* GET /models + group */ }
export async function modelSwitch(id, options) { /* POST /sessions/:id/model */ }
```

**File**: `packages/cli/src/commands/mcp.ts`

```typescript
export async function mcpList(options) { /* GET /mcp/servers */ }
export async function mcpStatus(options) { /* GET /mcp/status */ }
export async function mcpEnable(name, options) { /* POST /mcp/servers/:name/connect */ }
export async function mcpDisable(name, options) { /* POST /mcp/servers/:name/disconnect */ }
```

**File**: `packages/cli/src/commands/artifacts.ts`

```typescript
export async function artifactsList(options) { /* GET http://localhost:4001/api/sandboxes */ }
export async function artifactsStop(id, options) { /* POST http://localhost:4001/api/artifacts/:id/stop */ }
export async function artifactsRestart(id, options) { /* POST http://localhost:4001/api/artifacts/:id/restart */ }
export async function artifactsView(id, options) { /* Open URL in browser */ }
```

**Total Commands**: ~80 across 12 command files
**Timeline**: 2 weeks (10 commands per day)

---

## Phase 3: Interactive Components (2 weeks)

### Install Dependencies

```bash
cd packages/cli
npm install ink@4.4.1 react@18.2.0
npm install ink-select-input@5.0.0 ink-spinner@5.0.0 ink-text-input@5.0.0
npm install ink-box@3.0.0 ink-table@3.1.0
```

### Component Structure

**File**: `packages/cli/src/ui/components/SessionBrowser.tsx`

```typescript
import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import SelectInput from 'ink-select-input';
import Spinner from 'ink-spinner';
import { CortexClient } from '../../client/CortexClient.js';

export const SessionBrowser: React.FC<Props> = ({ serverUrl, onSelect, onExit }) => {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const client = new CortexClient(serverUrl);
    client.get('/sessions').then(setSessions).finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <Box><Spinner type="dots" /> Loading sessions...</Box>;
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="cyan">📋 Session Browser</Text>
      <SelectInput
        items={sessions.map(s => ({ label: s.id, value: s }))}
        onSelect={item => onSelect(item.value)}
      />
    </Box>
  );
};
```

### 10 Components to Implement

1. **SessionBrowser** - Browse/select sessions
2. **ModelPicker** - Select model with provider grouping
3. **McpBrowser** - Browse/enable MCP servers
4. **ArtifactDashboard** - View/manage artifacts
5. **TmuxBrowser** - Browse/view tmux sessions
6. **ConfigWizard** - Interactive configuration
7. **PermissionsBrowser** - Manage tool permissions
8. **MiddlewareDashboard** - View/configure middleware
9. **ContextViewer** - View context budget/compactions
10. **SystemMessageBrowser** - Browse/view system messages

**Timeline**: 2 weeks (2 components per day)

---

## Phase 4: Streaming Chat Enhancement (1 week)

### Enhanced Chat with Status Bar

**File**: `packages/cli/src/commands/chat/interactive.ts`

```typescript
import readline from 'readline';
import EventSource from 'eventsource';
import { StatusBar } from '../../ui/StatusBar.js';
import { ThemeManager } from '../../themes/ThemeManager.js';

export async function chatInteractive(options) {
  const client = new CortexClient(options.serverUrl);
  const theme = ThemeManager.getTheme();
  const statusBar = new StatusBar(client);

  // Render status bar
  await statusBar.render();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  rl.on('line', async (input) => {
    const trimmed = input.trim();

    // Handle quick actions
    if (trimmed.startsWith('/')) {
      await handleQuickAction(trimmed, client);
      rl.prompt();
      return;
    }

    // Stream AI response
    console.log(theme.colors.secondary('\nAssistant: '));

    const eventSource = createEventSource(client, messages);
    let assistantMessage = '';

    eventSource.on('message', (event) => {
      const data = JSON.parse(event.data);

      if (data.type === 'content_block_delta') {
        const text = data.delta?.text || '';
        process.stdout.write(theme.colors.primary(text));
        assistantMessage += text;
      }

      if (data.type === 'tool_use') {
        console.log(theme.colors.info(`\n🔧 Using tool: ${data.name}`));
      }

      if (data.type === 'tool_result') {
        console.log(theme.colors.success(`✓ Tool completed`));
      }

      if (data.type === 'message_stop') {
        messages.push({ role: 'assistant', content: assistantMessage });
        statusBar.update();
        console.log('\n');
        rl.prompt();
      }
    });
  });

  rl.prompt();
}
```

**File**: `packages/cli/src/ui/StatusBar.ts`

```typescript
export class StatusBar {
  constructor(private client: CortexClient) {}

  async render() {
    const health = await this.client.get('/health');
    const theme = ThemeManager.getTheme();

    console.log(theme.colors.muted('─'.repeat(80)));
    console.log(
      theme.colors.info('Model:'),
      theme.colors.highlight(health.currentModel)
    );
    console.log(
      theme.colors.info('Tokens:'),
      theme.colors.highlight(`${health.tokenCount} / ${health.tokenLimit}`)
    );
    console.log(
      theme.colors.info('MCP:'),
      theme.colors.highlight(`${health.mcpServersActive} active`)
    );
    console.log(theme.colors.muted('─'.repeat(80)));
  }

  async update() {
    // Re-render status bar
    await this.render();
  }
}
```

**Timeline**: 1 week

---

## Phase 5: Quick Actions (1 week)

### Pattern-Based Quick Actions

**File**: `packages/cli/src/commands/QuickActions.ts`

```typescript
const QUICK_ACTIONS = {
  '/model': async (args, client) => {
    const modelId = args[0];
    const result = await client.post('/sessions/current/model', { modelId });
    console.log(theme.colors.success(`Switched to ${modelId}`));
  },

  '/approve': async (args, client) => {
    const enable = args[0] === 'on';
    await client.post('/v1/approval-mode', { autoApproveActions: enable });
    console.log(theme.colors.success(`Auto-approve: ${enable ? 'ON' : 'OFF'}`));
  },

  '/export': async (args, client) => {
    const session = await client.get('/sessions/current/export');
    fs.writeFileSync('session-export.json', JSON.stringify(session, null, 2));
    console.log(theme.colors.success('Session exported to session-export.json'));
  },

  '/stats': async (args, client) => {
    const stats = await client.get('/sessions/current/stats');
    console.log(theme.colors.info('Token count:'), stats.tokenCount);
    console.log(theme.colors.info('Message count:'), stats.messageCount);
  },

  '/dashboard': async (args, client) => {
    await open('http://localhost:4001/');
    console.log(theme.colors.success('Dashboard opened'));
  },

  // ... 10-12 total quick actions
};

export async function handleQuickAction(input: string, client: CortexClient) {
  const [action, ...args] = input.split(' ');
  const handler = QUICK_ACTIONS[action];

  if (handler) {
    await handler(args, client);
  } else {
    console.log(theme.colors.error(`Unknown quick action: ${action}`));
    console.log(theme.colors.muted('Available: /model, /approve, /export, /stats, /dashboard'));
  }
}
```

**Timeline**: 1 week

---

## Phase 6: Testing & Documentation (1 week)

### Testing

**File**: `packages/cli/tests/integration/commands.test.ts`

```typescript
describe('CLI Commands', () => {
  test('sessions list', async () => {
    const output = await exec('cortex sessions list');
    expect(output).toContain('Sessions');
  });

  test('model switch', async () => {
    const output = await exec('cortex model claude-sonnet-4');
    expect(output).toContain('Switched');
  });

  // ... test all ~80 commands
});
```

### Documentation

**File**: `packages/cli/docs/COMMANDS.md`

Complete command reference with examples

**File**: `packages/cli/docs/QUICK_START.md`

5-minute getting started guide

**Timeline**: 1 week

---

## Timeline Summary

| Phase | Duration | Deliverable |
|-------|----------|-------------|
| 1. Server Endpoints | 2 weeks | 16 new endpoints |
| 2. Deterministic Commands | 2 weeks | ~80 commands |
| 3. Interactive Components | 2 weeks | 10 Ink UIs |
| 4. Streaming Chat | 1 week | Enhanced chat |
| 5. Quick Actions | 1 week | 10-12 shortcuts |
| 6. Testing & Docs | 1 week | Complete suite |
| **Total** | **9 weeks** | **Production-ready** |

---

## Success Criteria

✅ Every core library feature accessible via CLI
✅ Deterministic commands for explicit actions
✅ Interactive Ink components for browsing/selection
✅ Streaming chat with tool execution display
✅ Quick actions for common operations
✅ All tests passing
✅ Complete documentation

---

## Next Steps

1. **Review this plan** - confirm approach and timeline
2. **Begin Phase 1** - add 16 server endpoints
3. **Parallel work** - start command implementation while endpoints are being added
4. **Iterate weekly** - review progress and adjust
5. **Ship in 9 weeks** - production-ready CLI with complete core library coverage
