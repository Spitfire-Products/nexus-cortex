# CLI Feature Audit Supplement
**Critical Systems Missed in Initial Audit**

**Document Version**: 1.0
**Date**: 2025-11-14
**Purpose**: Document advanced systems (Artifacts, MCP On-Demand, Special Tools) that were not covered in the initial CLI Feature Audit but are essential for CLI PRD planning

---

## Table of Contents

1. [Dynamic Artifact System](#1-dynamic-artifact-system)
2. [MCP On-Demand Architecture](#2-mcp-on-demand-architecture)
3. [Special Tools Reference](#3-special-tools-reference)
4. [Updated Priority Matrix](#4-updated-priority-matrix)
5. [CLI Command Recommendations](#5-cli-command-recommendations)
6. [Integration Strategy](#6-integration-strategy)

---

## 1. Dynamic Artifact System

### 1.1 Overview

**Location**: `/packages/executors/src/implementations/addon/`
**Documentation**:
- `/packages/cli/artifacts/IMPLEMENTATION_GUIDE.md` (26KB)
- `/packages/cli/artifacts/INTEGRATION_EXAMPLES.md` (27KB)
- `/packages/cli/artifacts/MESSAGE_PROTOCOL.md` (14KB)
- `/packages/cli/artifacts/contracts/artifact.contracts.ts` (Complete type system)

**Status**: ✅ Fully Implemented
**Phase**: Advanced Feature Set (Post Phase 3)

The Dynamic Artifact System is Nexus Cortex's most powerful feature for **visual programming** and **interactive UI creation**. It enables AI models to create persistent, interactive applications (web apps, scripts, tools) with visual feedback, hot reloading, and multi-window coordination.

### 1.2 Core Concept

Models can create "artifacts" - persistent processes with visual UIs that run alongside the CLI. Think of it as Claude creating mini-applications on the fly:

- **Web dashboard** showing real-time metrics
- **Terminal application** with live command execution
- **Interactive form** for configuration
- **Data visualization** with charts/graphs
- **Code editor** with syntax highlighting

All rendered in **tmux panes** with **live updates** via WebSocket message bridge.

### 1.3 The 11 Artifact Tools

#### Core Creation Tool

**1. CreateArtifactTool** (`CreateArtifactTool.ts`)

**Purpose**: Create persistent artifacts with full lifecycle management

**Key Features**:
- **Multi-language support**: JavaScript, Python, Rust, Go, Shell, HTML
- **3 execution modes**:
  - `oneshot`: Run once and exit
  - `dev`: Hot reload on code changes (file watching)
  - `persistent`: Keep alive indefinitely (tmux sessions)
- **Package managers**: npm, pip, uv, nix
- **Environments**: Docker, local, nix
- **UI frameworks**: Express, FastAPI, Flask, Next.js
- **Visual feedback**: Playwright integration for screenshots
- **Test execution**: Run test cases and validate output

**Parameters**:
```typescript
{
  name: string;
  description: string;
  parameters: Record<string, any>;

  implementation: {
    language: 'javascript' | 'python' | 'rust' | 'go' | 'shell' | 'html';
    code: string;
    dependencies?: string[];
    packageManager?: 'npm' | 'pip' | 'uv' | 'nix';
    entryPoint?: string;
    command?: string;
    buildCommand?: string;
  };

  mode?: 'oneshot' | 'dev' | 'persistent';
  enableVisualFeedback?: boolean;

  devConfig?: {
    hotReload?: boolean;
    watchFiles?: string[];
    openBrowser?: boolean;
    liveBridge?: boolean;  // WebSocket for live updates
  };

  uiConfig?: {
    type?: 'web' | 'terminal' | 'both';
    framework?: 'express' | 'fastapi' | 'flask' | 'nextjs';
    autoStart?: boolean;
  };

  testCases?: Array<{
    input: Record<string, any>;
    expectedOutput?: Record<string, any>;
  }>;
}
```

**Use Cases**:
- "Create a real-time system monitor dashboard"
- "Build a proxy server to intercept API traffic"
- "Generate an interactive data visualization"
- "Create a file watcher that auto-formats code"

#### Inspection & Interaction Tools

**2. InspectSandboxTool** (`InspectSandboxTool.ts`)

Observe sandbox state:
- Screenshots (base64 PNG)
- DOM structure (HTML)
- Console logs (runtime output)
- Network requests (API calls)
- Performance metrics

**3. InteractWithSandboxTool** (`InteractWithSandboxTool.ts`)

UI interaction via Playwright:
- Click elements
- Fill forms
- Navigate pages
- Trigger JavaScript events
- Validate UI behavior

**4. ModifySandboxTool** (`ModifySandboxTool.ts`)

Edit code with automatic reload verification:
- Update source files
- Trigger hot reload
- Verify changes applied
- Capture new state

**5. StopSandboxTool** (`StopSandboxTool.ts`)

Clean up sandbox resources:
- Kill processes
- Close browser instances
- Release ports
- Archive session data

#### Visual Feedback Infrastructure

**6. VisualFeedbackBridge** (`VisualFeedbackBridge.ts`)

Playwright integration for visual programming:
- Browser automation
- Screenshot capture
- DOM inspection
- Event simulation
- Performance profiling

**Enables model to**:
- See what it created (base64 screenshots)
- Verify UI renders correctly
- Debug visual issues
- Iterate on designs

**7. SandboxEventBroadcaster** (`SandboxEventBroadcaster.ts`)

Real-time event broadcasting:
- WebSocket-based pub/sub
- Event streaming to clients
- Multi-listener support
- Event filtering/routing

**8. SandboxViewServer** (`SandboxViewServer.ts`)

Web-based dashboard for user viewing:
- HTTP server for artifact UIs
- Real-time updates via WebSocket
- Multi-artifact coordination
- Session persistence

#### Terminal & Multi-Window Support

**9. TerminalSandbox** (`TerminalSandbox.ts`)

Visual terminal emulation with xterm.js:
- Full terminal emulation
- ANSI color support
- Scrollback history
- Input handling
- Copy/paste support

**10. ScreenStream** (`ScreenStream.ts`)

Continuous screenshot streaming:
- H.264 video encoding
- Frame differencing
- Keyframe detection
- Bandwidth optimization
- Real-time delivery

**11. WindowManager** (`WindowManager.ts`)

Multi-window coordination:
- Browser + terminal layout
- Split pane management
- Focus handling
- Resize coordination
- Z-order management

### 1.4 Supporting Infrastructure

#### ArtifactRegistry

**File**: `/packages/executors/src/utils/ArtifactRegistry.ts`

Track all artifacts:
```typescript
interface ArtifactRuntime {
  id: string;
  name: string;
  type: string;
  process?: ChildProcess;
  url?: string;
  port?: number;
  tmuxSessionId?: string;
  startTime: Date;
  lastActivity: Date;
}
```

#### SandboxRegistry

**File**: `/packages/executors/src/utils/SandboxRegistry.ts`

Sandbox lifecycle management:
- Create/destroy sandboxes
- Track active sessions
- Resource allocation
- Cleanup on exit

#### TmuxManager

**File**: `/packages/executors/src/utils/TmuxManager.ts`

Tmux session management (see Section 3.1):
- Session creation
- Pane management
- Command execution
- Output capture

#### SessionPersistence

**File**: `/packages/executors/src/utils/SessionPersistence.ts`

Persistent sessions across restarts:
- Save session metadata
- Restore artifacts
- Handle crashes
- Checkpoint state

#### SessionLock

**File**: `/packages/executors/src/utils/SessionLock.ts`

Multi-process synchronization:
- File-based locking
- Prevent race conditions
- Handle deadlocks
- Process coordination

### 1.5 Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                   ARTIFACT SYSTEM ARCHITECTURE               │
├───────────────────┬─────────────────┬───────────────────────┤
│   CLI Process     │  Tmux Manager   │   Artifact Process    │
│   (Main Thread)   │  (Controller)   │   (React/Ink)         │
├───────────────────┼─────────────────┼───────────────────────┤
│                   │                 │                       │
│  CreateArtifact ──┼─> SpawnPane ────┼─> RenderComponent    │
│       ↓           │       ↓         │         ↓             │
│  MessageBridge ───┼─> RouteMessage ─┼─> HandleUpdate       │
│       ↓           │       ↓         │         ↓             │
│  VisualSnapshot ──┼─> Playwright ───┼─> CaptureScreen      │
│       ↓           │       ↓         │         ↓             │
│  InspectSandbox ──┼─> GetState ─────┼─> SerializeDOM       │
│       ↓           │       ↓         │         ↓             │
│  ModifySandbox ───┼─> UpdateCode ───┼─> HotReload          │
│       ↓           │       ↓         │         ↓             │
│  StopSandbox ─────┼─> KillPane ─────┼─> Cleanup            │
│                   │                 │                       │
└───────────────────┴─────────────────┴───────────────────────┘
```

### 1.6 Message Protocol

**File**: `/packages/cli/artifacts/MESSAGE_PROTOCOL.md`

Bidirectional communication via TCP sockets:

**Base Message Format**:
```json
{
  "id": "msg-uuid",
  "artifactId": "artifact-uuid",
  "type": "data_update",
  "source": "cli",
  "target": "artifact",
  "timestamp": 1700000000000,
  "payload": { ... },
  "metadata": {
    "priority": "normal",
    "requiresAck": false,
    "timeout": 5000
  }
}
```

**Message Types**:
- **Lifecycle**: CREATE, MOUNT, READY, DESTROY
- **Data**: DATA_UPDATE, DATA_REQUEST, DATA_RESPONSE
- **State**: STATE_CHANGE
- **Interaction**: USER_INPUT, COMMAND, ACTION
- **Control**: FOCUS, BLUR, RESIZE, REFRESH
- **System**: HEARTBEAT, ERROR, METRICS

**QoS Levels**:
- **Critical**: System errors (30s timeout, 5 retries)
- **High**: User interactions (10s timeout, 3 retries)
- **Normal**: Data updates (5s timeout, 2 retries)
- **Low**: Metrics, logs (2s timeout, 0 retries)

### 1.7 Use Case Examples

#### Example 1: Real-Time System Dashboard

```typescript
await CreateArtifactTool.execute({
  name: "system-monitor",
  description: "Real-time system metrics dashboard",
  implementation: {
    language: "javascript",
    code: `
      const express = require('express');
      const app = express();
      app.get('/metrics', (req, res) => {
        res.json({
          cpu: process.cpuUsage(),
          memory: process.memoryUsage(),
          uptime: process.uptime()
        });
      });
      app.listen(3000);
    `,
    dependencies: ["express"]
  },
  mode: "persistent",
  enableVisualFeedback: true,
  devConfig: {
    hotReload: true,
    openBrowser: true,
    liveBridge: true
  },
  uiConfig: {
    type: "web",
    framework: "express",
    autoStart: true
  }
});
```

**Result**:
- Express server starts in tmux pane
- Browser opens to localhost:3000
- Model receives screenshot of dashboard
- Hot reload on code changes
- WebSocket for live metric updates

#### Example 2: TradeStation Proxy

```typescript
await CreateArtifactTool.execute({
  name: "tradestation-proxy",
  description: "Proxy server to intercept TradeStation API traffic",
  implementation: {
    language: "javascript",
    code: `
      // Proxy server code
      // Intercept inbound/outbound traffic
      // Log requests/responses
      // Display in real-time dashboard
    `,
    dependencies: ["express", "http-proxy-middleware", "socket.io"]
  },
  mode: "dev",
  enableVisualFeedback: true,
  devConfig: {
    hotReload: true,
    watchFiles: ["proxy.js", "dashboard.html"],
    openBrowser: true
  }
});

// Model can then:
// 1. InspectSandbox to see traffic logs
// 2. ModifySandbox to adjust proxy rules
// 3. InteractWithSandbox to trigger test calls
// 4. See visual feedback of dashboard
```

### 1.8 CLI Exposure Requirements

**Priority**: HIGH (but post-Phase 3)

The artifact system is fully implemented but not yet exposed in CLI interface. Required work:

#### Commands Needed

```bash
# Artifact lifecycle
cortex artifact create <name> --type=<type> --mode=<mode>
cortex artifact list
cortex artifact inspect <id>
cortex artifact stop <id>
cortex artifact restart <id>

# Sandbox interaction
cortex sandbox interact <id> --action=<action>
cortex sandbox screenshot <id>
cortex sandbox logs <id>

# View server
cortex artifact view <id>  # Opens browser to artifact UI
cortex artifact dashboard  # Opens multi-artifact dashboard

# Templates
cortex artifact templates  # List available templates
cortex artifact create-from-template <template-name>
```

#### Configuration Needs

```yaml
artifacts:
  enabled: true
  defaultMode: "persistent"
  enableVisualFeedback: true
  tmux:
    sessionPrefix: "cortex-artifact-"
    defaultLayout: "tiled"
  viewServer:
    port: 8080
    autoStart: true
  sandbox:
    defaultEnv: "local"  # local | docker | nix
    resourceLimits:
      maxArtifacts: 10
      maxMemoryMB: 512
      maxCPUPercent: 50
```

### 1.9 Integration Points

**Tools to integrate**:
1. `CreateArtifactTool` → Model creates artifacts
2. `InspectSandboxTool` → Model observes state
3. `InteractWithSandboxTool` → Model tests UI
4. `ModifySandboxTool` → Model iterates
5. `StopSandboxTool` → Model cleans up

**Requirements**:
- Tmux installed
- Playwright installed (for visual feedback)
- Node.js runtime
- Port availability (3000-8999)

**User flows**:
1. Model creates artifact → User sees browser popup
2. Model inspects sandbox → Model receives screenshot
3. Model modifies code → Hot reload applies changes
4. User interacts with UI → Model receives events
5. Model stops artifact → Resources cleaned up

---

## 2. MCP On-Demand Architecture

### 2.1 Overview

**Location**: `/packages/core/src/tools/mcp-management/`
**Documentation**: `/packages/core/src/tools/mcp-management/README.md` (689 lines)
**Status**: ✅ Production Ready (7 tools)
**Phase**: 2.6 Complete

The MCP On-Demand system enables **autonomous model control** of Model Context Protocol servers. Instead of loading all MCP tools upfront (token waste), models start minimal and dynamically discover/enable tools as needed.

### 2.2 Core Concept: Progressive Tool Discovery

**Traditional Static Approach**:
```json
// claude_desktop_config.json
{
  "mcpServers": {
    "filesystem": { ... },
    "git": { ... },
    "postgres": { ... },
    "puppeteer": { ... },
    "sqlite": { ... }
    // ALL tools loaded upfront (100+ tools)
  }
}
```

**Problems**:
- Context pollution (too many tool definitions)
- Slower inference (model considers all tools)
- Higher costs (more tokens per request)
- No adaptation (same tools for every task)

**Nexus Cortex On-Demand Approach**:

**Turn 1** (Task starts):
```
Model has: 25 base tools + 7 MCP management tools
Total tools: 32
```

**Turn 5** (Model realizes it needs database tools):
```
Model calls: enable_mcp_server("postgres", { env: { DATABASE_URL: "..." } })
Result: MCP_CONFIG.md updated
```

**Turn 6** (Next session or reconnect):
```
Model has: 32 base tools + 12 postgres tools
Total tools: 44
```

**Benefits**:
- Start minimal (32 tools vs 127 tools)
- Progressive expansion (add only what's needed)
- Model autonomy (AI discovers capabilities)
- Task-specific (right tools for each job)
- Cost efficient (70% token reduction)

### 2.3 Two-Tier Architecture

#### Tier 1: Auto-Injection (Phase 2.5)

**File**: `MCP_CONFIG.md` (project root or `~/.cortex/`)

**Purpose**: Declarative configuration for enabled servers

**Example**:
```markdown
# MCP Server Configuration

## Enabled Servers

### filesystem
**Status**: ✅ Enabled
**Description**: File system operations
**Command**: `npx -y @modelcontextprotocol/server-filesystem`
**Args**: `/home/user/project`
**Auto-start**: true

### git
**Status**: ✅ Enabled
**Description**: Git version control
**Command**: `npx -y @modelcontextprotocol/server-git`
**Auto-start**: true
```

**Behavior**:
- On session start, read MCP_CONFIG.md
- Auto-connect to enabled servers
- Inject discovered tools into model's available tools
- If no MCP_CONFIG.md exists, no auto-injection (opt-in)

#### Tier 2: Management Tools (Phase 2.6)

**7 tools for autonomous MCP control**:

1. `list_available_mcp_servers` - Browse community registry
2. `search_mcp_servers` - Search by keyword
3. `get_mcp_config` - View current config
4. `enable_mcp_server` - Enable a server (writes MCP_CONFIG.md)
5. `disable_mcp_server` - Disable a server
6. `configure_mcp_server` - Modify server settings
7. `init_mcp_config` - Analyze project and create tailored config

### 2.4 The 7 Management Tools

#### 1. list_available_mcp_servers

**Purpose**: Browse community registry

**Parameters**:
```typescript
{
  category?: 'filesystem' | 'database' | 'browser' | 'api' | 'development' | 'productivity' | 'custom';
  verified_only?: boolean;  // default: true
}
```

**Returns**: List of servers with metadata

**Use Case**: "What MCP servers are available for database work?"

#### 2. search_mcp_servers

**Purpose**: Search registry by keyword

**Parameters**:
```typescript
{
  query: string;  // Search term
}
```

**Returns**: Matching servers ranked by relevance

**Use Case**: "Find MCP servers related to 'web scraping'"

#### 3. get_mcp_config

**Purpose**: View current configuration

**Parameters**:
```typescript
{
  scope?: 'project' | 'global' | 'merged';  // default: merged
}
```

**Returns**: Enabled/disabled servers, connection status, tool counts

**Use Case**: "What MCP servers are currently enabled?"

#### 4. enable_mcp_server

**Purpose**: Enable an MCP server

**Parameters**:
```typescript
{
  server_name: string;      // e.g., 'filesystem', 'puppeteer'
  description?: string;
  args?: string[];          // Command arguments
  env?: Record<string, string>;  // Environment variables
  auto_start?: boolean;     // default: true
  timeout?: number;         // Connection timeout (ms)
}
```

**Side Effects**: Writes to MCP_CONFIG.md

**Use Case**: "Enable PostgreSQL with DATABASE_URL=..."

#### 5. disable_mcp_server

**Purpose**: Disable an MCP server

**Parameters**:
```typescript
{
  server_name: string;
}
```

**Use Case**: "Disable puppeteer, we don't need browser automation"

#### 6. configure_mcp_server

**Purpose**: Modify existing server settings

**Parameters**:
```typescript
{
  server_name: string;
  args?: string[];
  env?: Record<string, string>;
  auto_start?: boolean;
  timeout?: number;
}
```

**Use Case**: "Update filesystem server to use different directory"

#### 7. init_mcp_config

**Purpose**: Analyze project and create tailored config

**Parameters**:
```typescript
{
  scope?: 'auto' | 'global' | string;  // default: 'auto'
  servers?: string[];        // Manual override
  include_optional?: boolean;
  dry_run?: boolean;         // Preview without creating
}
```

**Project Detection**:
- Node.js: package.json, node_modules
- Python: requirements.txt, pyproject.toml
- Rust: Cargo.toml
- Go: go.mod
- TypeScript: tsconfig.json
- Databases: .sql files
- Web: public/ directories
- Git: .git directory

**Returns**: Recommended servers with priorities (essential/recommended/optional)

**Use Case**: "Initialize MCP config for this project"

### 2.5 Token Efficiency Analysis

#### Example: Database Migration Task

**Static Approach**:
- Tools loaded: 127 (all tools from all servers)
- Tool definition tokens: ~25,000 tokens
- Used tools: 4 (postgres tools)
- Wasted tokens: ~24,000 (96% waste)

**Nexus Cortex Approach**:
- Initial tools: 25 (base + MCP management)
- Model calls `enable_mcp_server` for postgres
- Tools after enable: 37 (base + management + postgres)
- Tool definition tokens: ~7,400 tokens
- Used tools: 4 (postgres tools)
- Wasted tokens: ~6,600 (89% vs 96%)

**Savings**: ~17,600 tokens per request (70% reduction)

### 2.6 Common Workflows

#### Workflow 1: New Project Setup

1. Model starts conversation (32 tools)
2. User: "Help set up database migrations"
3. Model realizes it needs database tools
4. Model: `list_available_mcp_servers(category="database")`
5. Model sees postgres server
6. Model: `enable_mcp_server("postgres", env={DATABASE_URL: "..."})`
7. Model reconnects (or waits for next session)
8. Model now has postgres tools (44 tools total)

#### Workflow 2: Project Discovery

1. Model asked to work on unfamiliar project
2. Model: `init_mcp_config(dry_run=true)`
3. Reviews detected characteristics
4. Model: `init_mcp_config(dry_run=false)`
5. Model now has project-appropriate tools

#### Workflow 3: Tool Cleanup

1. Model finishes task requiring special tools
2. Model: `disable_mcp_server("puppeteer")`
3. Keeps config lean for better performance

### 2.7 CLI Exposure Requirements

**Priority**: MEDIUM (Phase 2 feature, but already integrated in core)

MCP management is fully implemented and working in orchestrator. CLI just needs surface commands:

#### Commands Needed

```bash
# MCP server management
cortex mcp list [--category=<category>]
cortex mcp search <query>
cortex mcp status
cortex mcp enable <server-name> [--env KEY=VALUE] [--args ARG1,ARG2]
cortex mcp disable <server-name>
cortex mcp config [--scope=project|global|merged]
cortex mcp init [--dry-run] [--include-optional]

# Direct config file operations
cortex mcp edit  # Opens MCP_CONFIG.md in editor
cortex mcp validate  # Validate MCP_CONFIG.md syntax
```

#### Configuration Display

```bash
$ cortex mcp status

📦 MCP Server Status

Enabled Servers (2):
  ✅ filesystem (5 tools) - Connected
     Args: /home/user/project
  ✅ git (7 tools) - Connected

Available Servers (12):
  ⏸️  postgres - Database operations
  ⏸️  puppeteer - Browser automation
  ⏸️  sqlite - SQLite database
  ... (9 more)

Token Usage:
  Current: 7,400 tokens/request
  If all enabled: 25,000 tokens/request
  Savings: 70%
```

### 2.8 Integration Points

**Files**:
- `McpServerRegistry.ts` - Community registry data
- `McpConfigManager.ts` - MCP_CONFIG.md operations
- `McpClientManager.ts` - Runtime server connections
- `CortexOrchestrator.ts` - Tool registration and execution

**Tools already integrated**: All 7 management tools registered in orchestrator

**CLI work needed**: Surface commands, configuration display, file editing

---

## 3. Special Tools Reference

### 3.1 Tmux/Session Tools

#### TmuxSessionTool

**File**: `/packages/executors/src/implementations/tmux/TmuxSessionTool.ts`

**Purpose**: Manage persistent terminal sessions

**Features**:
- Create/manage tmux sessions
- Send commands to sessions
- Capture output and history
- Visual terminal snapshots (xterm.js + Playwright)
- Session persistence across restarts

**Parameters**:
```typescript
{
  action: 'create' | 'send' | 'capture' | 'list' | 'kill' | 'snapshot';
  sessionId?: string;
  command?: string;
  cwd?: string;
  env?: Record<string, string>;
  captureHistory?: boolean;
  includeScreenshot?: boolean;  // Visual terminal emulation
}
```

**Special Behavior**:
- **Snapshot action**: Captures visual terminal state (base64 PNG)
- Enables model to see terminal output visually
- Essential for debugging visual terminal apps (progress bars, colors)
- Integrates with TmuxViewServer for web-based viewing

**Integration with Artifacts**:
- Artifacts run in tmux sessions
- TmuxManager coordinates pane layout
- Session persistence ensures artifacts survive crashes
- Multi-process synchronization via SessionLock

**CLI Exposure**:
```bash
cortex tmux create [--cwd=<dir>]
cortex tmux send <session-id> <command>
cortex tmux capture <session-id> [--history]
cortex tmux snapshot <session-id> [--screenshot]
cortex tmux list
cortex tmux kill <session-id>
```

#### TmuxViewServer

**File**: `/packages/executors/src/implementations/tmux/TmuxViewServer.ts`

**Purpose**: Web-based tmux session viewer

**Features**:
- HTTP server for viewing sessions
- xterm.js terminal emulation
- Real-time output streaming
- Session list/navigation
- Screenshot capture

**Auto-starts**: First time TmuxSessionTool is used

**URL**: `http://localhost:8081/sessions/<session-id>`

#### TmuxManager

**File**: `/packages/executors/src/utils/TmuxManager.ts`

**Purpose**: Low-level tmux operations

**Capabilities**:
```typescript
interface TmuxManager {
  // Session management
  createSession(name: string): Promise<string>;
  listSessions(): Promise<TmuxSession[]>;
  killSession(name: string): Promise<void>;

  // Pane management
  createPane(options: PaneOptions): Promise<string>;
  splitPane(paneId: string, options: SplitOptions): Promise<string>;
  resizePane(paneId: string, size: string): Promise<void>;
  killPane(paneId: string): Promise<void>;

  // Command execution
  sendKeys(target: string, keys: string): Promise<void>;
  runCommand(target: string, command: string): Promise<void>;
  captureOutput(target: string): Promise<string>;

  // Layout
  applyLayout(layout: string): Promise<void>;
  saveLayout(): Promise<string>;
}
```

**Used by**:
- CreateArtifactTool (spawn artifact processes)
- TmuxSessionTool (manage sessions)
- WindowManager (coordinate multi-window layout)

### 3.2 Historical Context Tools

**File**: `/packages/core/src/tools/historical/`

**Purpose**: Access conversation history across compaction boundaries

**The 4 Historical Tools**:

#### 1. SearchConversationHistory

**Purpose**: Keyword/semantic search in history

**Parameters**:
```typescript
{
  query: string;
  maxResults?: number;
  timeRange?: { start: Date; end: Date };
  includeCompacted?: boolean;
}
```

**Special Behavior**: Searches both in-memory and compacted segments

#### 2. GetConversationSegment

**Purpose**: Retrieve specific conversation segment

**Parameters**:
```typescript
{
  turnRange?: { start: number; end: number };
  checkpointId?: string;
  format?: 'full' | 'summary' | 'compressed';
}
```

**Special Behavior**: Can retrieve compacted segments in summary form

#### 3. ListCompactionBoundaries

**Purpose**: List all compaction checkpoints

**Returns**: List of checkpoints with turn ranges

**Use Case**: "When were conversations compacted?"

#### 4. RequestHistoricalContext

**Purpose**: Retrieve relevant context for current task

**Parameters**:
```typescript
{
  taskDescription: string;
  contextWindow?: number;  // How many tokens of context
}
```

**Special Behavior**: Uses helper model to extract relevant context

**Integration**:
- Coordinated by `HistoricalContextService`
- Works with `StoredCompactionManager`
- Integrates with helper model middleware
- Used when context budget exceeded

**CLI Exposure**:
```bash
cortex history search <query> [--max-results=N]
cortex history segment <turn-start>-<turn-end>
cortex history checkpoints
cortex history context "<task-description>"
```

### 3.3 Helper Model Tools

**Purpose**: Tools that trigger helper model fallback for cost savings

**Mechanism**: When model wants expensive operation, redirect to cheaper helper model

**Tools with Helper Model Support**:

1. **Search tools** → Helper model searches, main model uses results
2. **Code analysis** → Helper model analyzes, main model uses summary
3. **Data processing** → Helper model processes, main model uses output
4. **Context retrieval** → Helper model extracts, main model uses context

**Configuration**:
```typescript
helperModel: {
  provider: 'openai',
  modelId: 'gpt-4o-mini',
  enabled: true,
  fallbackThreshold: 0.3  // Use helper if task complexity < 0.3
}
```

**Cost Savings**: 50-80% reduction for eligible tasks

**CLI Exposure**:
```bash
cortex helper status  # Show helper model config
cortex helper enable [--model=<model-id>]
cortex helper disable
cortex helper stats  # Show usage statistics
```

### 3.4 Server-Side Tools

**File**: `/packages/core/src/tools/ServerSideTools.ts`

**Purpose**: Provider-managed agentic tool execution

**Concept**: Some providers (XAI) execute tools autonomously on their servers

**Example (XAI)**:
- `web_search` - Provider searches web, returns results
- `x_search` - Provider searches X/Twitter
- `code_interpreter` - Provider runs code in sandbox

**Architecture**:
```typescript
interface ServerSideToolDefinition {
  executionMode: 'client' | 'server' | 'both';
  name: string;
  description?: string;
  serverConfig?: {
    // Provider-specific configuration
  };
}
```

**Behavior**:
- Model calls tool
- Request sent to provider
- Provider executes autonomously
- Provider returns results + metadata

**Metadata**:
```typescript
interface ServerSideToolMetadata {
  toolUsage: Record<string, number>;  // Billing info
  citations?: string[];               // URLs consulted
  toolCalls: Array<{                  // Detailed call log
    id: string;
    name: string;
    arguments: string;
    status?: 'success' | 'failed';
  }>;
  autonomousExecution: boolean;
}
```

**CLI Impact**: Minimal - handled transparently by orchestrator

---

## 4. Updated Priority Matrix

### 4.1 Priority Tiers

#### Tier 1: Essential (Phase 1)
*Already complete in initial audit*

- Core orchestration
- Message routing
- Session management
- Basic tool execution

#### Tier 2: High-Value (Phase 2)
*Includes MCP On-Demand*

- **MCP Management Tools** (✅ Complete)
  - Priority: HIGH
  - Status: Implemented, needs CLI exposure
  - Impact: 70% token reduction
  - Commands: 8 commands (list, search, enable, disable, etc.)

#### Tier 3: Advanced (Phase 3)
*Deferred but valuable*

- **Dynamic Artifact System** (✅ Implemented)
  - Priority: HIGH (but post-Phase 3)
  - Status: Fully implemented, needs CLI exposure
  - Impact: Revolutionary feature for visual programming
  - Commands: 15+ commands (create, inspect, interact, etc.)
  - Complexity: High (tmux, Playwright, WebSocket)

- **Historical Context Tools** (✅ Implemented)
  - Priority: MEDIUM
  - Status: Implemented, needs CLI exposure
  - Impact: Better long conversations
  - Commands: 4 commands (search, segment, checkpoints, context)

#### Tier 4: Nice-to-Have
*Polish and convenience*

- **Helper Model Interface**
  - Priority: LOW
  - Status: Working, just needs status display
  - Commands: 4 commands (status, enable, disable, stats)

- **Server-Side Tool Visibility**
  - Priority: LOW
  - Status: Transparent, minimal CLI work
  - Commands: Optional debug commands

### 4.2 Phase Recommendations

#### Phase 1 (Weeks 1-4): Core CLI
*From initial audit*

✅ Basic session management
✅ Simple tool execution
✅ Configuration
✅ Provider switching

#### Phase 2 (Weeks 5-8): MCP & Enhanced Features
*Add MCP exposure*

- ✅ MCP management commands (8 commands)
- Enhanced session viewing
- Tool usage analytics
- Performance monitoring

#### Phase 3 (Weeks 9-12): Polish & Testing
*Stabilize core features*

- Historical context commands (4 commands)
- Helper model status display
- Comprehensive testing
- Documentation

#### Phase 4 (Post-Launch): Advanced Features
*After core CLI is stable*

- 🎯 **Artifact system exposure** (15+ commands)
  - Highest impact feature
  - Requires tmux setup
  - Needs comprehensive docs
  - User education required

### 4.3 Dependency Graph

```
Phase 1 (Core)
  ↓
Phase 2 (MCP Management) ← HIGH PRIORITY
  ↓
Phase 3 (Polish + Historical Context)
  ↓
Phase 4 (Artifacts) ← REVOLUTIONARY FEATURE
  ├─ Requires: Tmux, Playwright
  ├─ Builds on: Session management, tool execution
  └─ Enables: Visual programming, interactive UIs
```

---

## 5. CLI Command Recommendations

### 5.1 MCP Commands (Phase 2)

**High Priority** - 70% token savings

```bash
cortex mcp list [options]
  List available MCP servers
  Options:
    --category <category>   Filter by category
    --verified-only         Show only verified servers (default)
    --all                   Show all servers

cortex mcp search <query>
  Search MCP servers by keyword

cortex mcp status [options]
  Show MCP server status
  Options:
    --scope <scope>         project | global | merged (default: merged)
    --verbose               Show detailed connection info

cortex mcp enable <server-name> [options]
  Enable an MCP server
  Options:
    --env <KEY=VALUE>       Environment variables (repeatable)
    --args <arg1,arg2>      Command arguments
    --no-auto-start         Don't auto-start server
    --timeout <ms>          Connection timeout

cortex mcp disable <server-name>
  Disable an MCP server

cortex mcp configure <server-name> [options]
  Modify MCP server configuration
  Options:
    --env <KEY=VALUE>       Update environment variables
    --args <arg1,arg2>      Update command arguments
    --timeout <ms>          Update timeout

cortex mcp init [options]
  Initialize MCP configuration for project
  Options:
    --dry-run               Preview recommendations without creating
    --include-optional      Include optional servers
    --scope <scope>         auto | global | <path> (default: auto)
    --servers <list>        Manual server list (comma-separated)

cortex mcp edit
  Open MCP_CONFIG.md in editor

cortex mcp validate
  Validate MCP_CONFIG.md syntax
```

**Example Workflow**:
```bash
# Discover available servers
$ cortex mcp list --category=database

📦 Available MCP Servers (category: database)

  postgres - PostgreSQL database operations
    Capabilities: query, schema, migrations
    Requires: DATABASE_URL

  sqlite - SQLite database operations
    Capabilities: query, schema
    Requires: Database file path

# Enable postgres
$ cortex mcp enable postgres --env DATABASE_URL="postgresql://..."

✅ Enabled postgres server
   Added to: ./MCP_CONFIG.md
   Will connect on next session
   Tools available: 12

# Check status
$ cortex mcp status

📦 MCP Server Status

Enabled Servers (3):
  ✅ filesystem (5 tools) - Connected
  ✅ git (7 tools) - Connected
  ✅ postgres (12 tools) - Connecting...

Token Usage:
  Current: 9,800 tokens/request
  Savings: 61% vs all enabled
```

### 5.2 Artifact Commands (Phase 4)

**Revolutionary Feature** - Visual programming

```bash
cortex artifact create <name> [options]
  Create a new artifact
  Options:
    --type <type>           dashboard | web | terminal | script
    --mode <mode>           oneshot | dev | persistent (default: persistent)
    --language <lang>       javascript | python | rust | go | shell | html
    --code <path>           Path to code file
    --deps <packages>       Dependencies (comma-separated)
    --pkg-manager <pm>      npm | pip | uv | nix (default: auto-detect)
    --visual-feedback       Enable visual feedback (screenshots, DOM)
    --hot-reload            Enable hot reload (dev mode)
    --open-browser          Auto-open browser
    --port <port>           Port number
    --env <KEY=VALUE>       Environment variables (repeatable)

cortex artifact list [options]
  List all artifacts
  Options:
    --filter <filter>       active | stopped | all (default: active)
    --verbose               Show detailed info

cortex artifact inspect <id> [options]
  Inspect artifact state
  Options:
    --screenshot            Capture screenshot
    --dom                   Capture DOM structure
    --console               Show console logs
    --metrics               Show performance metrics
    --network               Show network requests

cortex artifact interact <id> <action> [args...]
  Interact with artifact UI
  Actions:
    click <selector>        Click element
    type <selector> <text>  Type text
    navigate <url>          Navigate to URL
    scroll <selector>       Scroll to element

cortex artifact modify <id> [options]
  Modify artifact code
  Options:
    --code <path>           New code file
    --edit                  Open in editor
    --hot-reload            Trigger hot reload

cortex artifact stop <id>
  Stop artifact

cortex artifact restart <id>
  Restart artifact

cortex artifact view <id>
  Open artifact in browser

cortex artifact dashboard
  Open multi-artifact dashboard

cortex artifact templates [options]
  List available templates
  Options:
    --category <category>   Filter by category

cortex artifact create-from-template <template-name> <name>
  Create artifact from template
```

**Example Workflow**:
```bash
# Create system monitor dashboard
$ cortex artifact create system-monitor \
  --type=web \
  --language=javascript \
  --mode=dev \
  --visual-feedback \
  --hot-reload \
  --open-browser

🎨 Creating artifact: system-monitor
   Type: web (Express.js)
   Mode: dev (hot reload enabled)
   Visual feedback: enabled

✅ Artifact created
   ID: artifact-abc123
   URL: http://localhost:3000
   Browser opened
   Tmux session: cortex-artifact-abc123
   Status: running

# Inspect artifact
$ cortex artifact inspect artifact-abc123 --screenshot --dom

📸 Artifact Snapshot: system-monitor

Screenshot: saved to /tmp/artifact-abc123-screenshot.png
DOM: saved to /tmp/artifact-abc123-dom.html

Console logs:
  [info] Server started on port 3000
  [info] Metrics endpoint: /metrics

Performance:
  Render time: 45ms
  Update time: 12ms
  Memory usage: 256MB

# Modify code
$ cortex artifact modify artifact-abc123 --edit

# Opens editor with current code
# Make changes, save
# Hot reload applies changes automatically

✅ Code updated
   Hot reload triggered
   Changes applied in 234ms

# View in browser
$ cortex artifact view artifact-abc123

🌐 Opening artifact in browser...
   URL: http://localhost:3000

# List all artifacts
$ cortex artifact list

📦 Active Artifacts (2)

  artifact-abc123 - system-monitor (web)
    Status: running
    URL: http://localhost:3000
    Uptime: 15m 32s
    Memory: 256MB

  artifact-def456 - proxy-server (terminal)
    Status: running
    Tmux: cortex-artifact-def456
    Uptime: 3h 12m 45s
```

### 5.3 Historical Context Commands (Phase 3)

**Medium Priority** - Better long conversations

```bash
cortex history search <query> [options]
  Search conversation history
  Options:
    --max-results <n>       Maximum results (default: 10)
    --time-range <range>    Time range (e.g., "last 7 days")
    --include-compacted     Include compacted segments

cortex history segment <turn-range>
  Retrieve conversation segment
  Format: <start>-<end> or <checkpoint-id>
  Options:
    --format <format>       full | summary | compressed (default: full)

cortex history checkpoints
  List compaction checkpoints

cortex history context <task-description>
  Retrieve relevant historical context for task
```

### 5.4 Helper Model Commands (Phase 3)

**Low Priority** - Status display

```bash
cortex helper status
  Show helper model configuration

cortex helper enable [options]
  Enable helper model
  Options:
    --model <model-id>      Model ID (e.g., gpt-4o-mini)
    --threshold <value>     Fallback threshold (0.0-1.0)

cortex helper disable
  Disable helper model

cortex helper stats
  Show usage statistics
```

### 5.5 Tmux Commands (Phase 3)

**Medium Priority** - Terminal session management

```bash
cortex tmux create [options]
  Create tmux session
  Options:
    --cwd <directory>       Working directory
    --env <KEY=VALUE>       Environment variables

cortex tmux send <session-id> <command>
  Send command to session

cortex tmux capture <session-id> [options]
  Capture session output
  Options:
    --history               Include scrollback history

cortex tmux snapshot <session-id> [options]
  Capture visual snapshot
  Options:
    --screenshot            Include screenshot (base64 PNG)

cortex tmux list
  List all sessions

cortex tmux kill <session-id>
  Kill session
```

---

## 6. Integration Strategy

### 6.1 Implementation Roadmap

#### Immediate (Phase 2)

**MCP Management Commands** - Weeks 5-6

1. Create CLI command handlers:
   - `commands/mcp/list.ts`
   - `commands/mcp/search.ts`
   - `commands/mcp/status.ts`
   - `commands/mcp/enable.ts`
   - `commands/mcp/disable.ts`
   - `commands/mcp/configure.ts`
   - `commands/mcp/init.ts`
   - `commands/mcp/edit.ts`

2. Wire up to existing core functionality:
   - `McpServerRegistry.listServers()`
   - `McpServerRegistry.search()`
   - `McpConfigManager.getConfig()`
   - `McpConfigManager.enableServer()`
   - `McpConfigManager.disableServer()`
   - `McpConfigManager.configureServer()`
   - `McpConfigManager.initConfig()`

3. Create UI formatters:
   - Server list table display
   - Status dashboard
   - Token usage calculator

**Estimated Effort**: 3-4 days

#### Near-Term (Phase 3)

**Historical Context & Helper Model** - Weeks 9-10

1. Create command handlers:
   - `commands/history/*`
   - `commands/helper/*`

2. Wire up to existing tools:
   - `HistoricalContextService`
   - `HelperModelMiddleware`

3. Status displays and formatters

**Estimated Effort**: 2-3 days

**Tmux Commands** - Week 11

1. Create command handlers:
   - `commands/tmux/*`

2. Wire up to `TmuxSessionTool`

3. Integrate with `TmuxViewServer`

**Estimated Effort**: 2 days

#### Long-Term (Phase 4)

**Artifact System** - Post-launch (2-3 weeks dedicated)

1. Create comprehensive command suite:
   - `commands/artifact/create.ts`
   - `commands/artifact/list.ts`
   - `commands/artifact/inspect.ts`
   - `commands/artifact/interact.ts`
   - `commands/artifact/modify.ts`
   - `commands/artifact/stop.ts`
   - `commands/artifact/view.ts`
   - `commands/artifact/dashboard.ts`
   - `commands/artifact/templates.ts`

2. Wire up to artifact system:
   - `CreateArtifactTool`
   - `InspectSandboxTool`
   - `InteractWithSandboxTool`
   - `ModifySandboxTool`
   - `StopSandboxTool`
   - `SandboxViewServer`

3. Create rich UI components:
   - Artifact creation wizard
   - Visual feedback display
   - Multi-artifact dashboard
   - Template browser

4. Documentation:
   - User guide
   - Tutorial videos
   - Example templates
   - Troubleshooting guide

**Estimated Effort**: 2-3 weeks full-time

### 6.2 CLI Architecture Integration

#### Command Structure

```
packages/cli/src/
├── commands/
│   ├── mcp/              # Phase 2 (MCP Management)
│   │   ├── list.ts
│   │   ├── search.ts
│   │   ├── status.ts
│   │   ├── enable.ts
│   │   ├── disable.ts
│   │   ├── configure.ts
│   │   ├── init.ts
│   │   └── edit.ts
│   │
│   ├── artifact/         # Phase 4 (Artifact System)
│   │   ├── create.ts
│   │   ├── list.ts
│   │   ├── inspect.ts
│   │   ├── interact.ts
│   │   ├── modify.ts
│   │   ├── stop.ts
│   │   ├── view.ts
│   │   ├── dashboard.ts
│   │   └── templates.ts
│   │
│   ├── history/          # Phase 3 (Historical Context)
│   │   ├── search.ts
│   │   ├── segment.ts
│   │   ├── checkpoints.ts
│   │   └── context.ts
│   │
│   ├── helper/           # Phase 3 (Helper Model)
│   │   ├── status.ts
│   │   ├── enable.ts
│   │   ├── disable.ts
│   │   └── stats.ts
│   │
│   └── tmux/             # Phase 3 (Tmux Sessions)
│       ├── create.ts
│       ├── send.ts
│       ├── capture.ts
│       ├── snapshot.ts
│       ├── list.ts
│       └── kill.ts
```

#### Core Interface

```typescript
// commands/mcp/list.ts
import { McpServerRegistry } from '@cortex/core';

export async function listMcpServers(options: {
  category?: string;
  verifiedOnly?: boolean;
}) {
  const registry = new McpServerRegistry();
  const servers = await registry.listServers(options);

  // Format and display
  displayServerTable(servers);
}

// commands/artifact/create.ts
import { CreateArtifactTool } from '@cortex/executors';

export async function createArtifact(name: string, options: {
  type?: string;
  mode?: string;
  // ... other options
}) {
  const tool = new CreateArtifactTool({ workingDirectory: process.cwd() });
  const result = await tool.execute({
    name,
    // ... map options to tool parameters
  });

  // Display result
  displayArtifactCreation(result);
}
```

### 6.3 User Experience Considerations

#### Progressive Disclosure

**Level 1: Basic Commands**
```bash
cortex mcp list
cortex artifact create my-app
cortex history search "database"
```

**Level 2: Options**
```bash
cortex mcp enable postgres --env DATABASE_URL="..."
cortex artifact create my-app --type=web --visual-feedback
cortex history search "database" --time-range="last 7 days"
```

**Level 3: Advanced**
```bash
cortex mcp init --dry-run --include-optional
cortex artifact create my-app --code=./app.js --hot-reload --port=3000
cortex artifact interact app-123 click "#submit-button"
```

#### Help System

```bash
# Top-level help
$ cortex --help
...
Commands:
  mcp         Manage MCP servers (dynamic tool loading)
  artifact    Create and manage interactive artifacts
  history     Access conversation history
  helper      Configure helper model
  tmux        Manage terminal sessions

# Command-level help
$ cortex mcp --help

cortex mcp - Manage MCP servers

Subcommands:
  list        List available servers
  search      Search servers by keyword
  status      Show current configuration
  enable      Enable an MCP server
  disable     Disable an MCP server
  configure   Modify server settings
  init        Initialize MCP config for project
  edit        Edit MCP_CONFIG.md
  validate    Validate configuration

Examples:
  cortex mcp list --category=database
  cortex mcp enable postgres --env DATABASE_URL="..."
  cortex mcp init --dry-run
```

#### Error Handling

```bash
# Missing required parameter
$ cortex mcp enable
❌ Error: Missing required argument: server-name
   Usage: cortex mcp enable <server-name> [options]

   Examples:
     cortex mcp enable postgres --env DATABASE_URL="..."
     cortex mcp enable filesystem --args /path/to/workspace

# Invalid server name
$ cortex mcp enable invalid-server
❌ Error: Server 'invalid-server' not found in registry

   Did you mean:
     - filesystem
     - git
     - postgres

   Use 'cortex mcp list' to see all available servers

# Artifact creation failed
$ cortex artifact create my-app --type=web --language=rust
❌ Error: Artifact creation failed

   Cause: Rust toolchain not found

   To fix:
     1. Install Rust: curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
     2. Verify installation: rustc --version
     3. Retry: cortex artifact create my-app --type=web --language=rust

   Or use JavaScript instead:
     cortex artifact create my-app --type=web --language=javascript
```

### 6.4 Testing Strategy

#### Unit Tests

```typescript
// Test MCP command handlers
describe('MCP Commands', () => {
  test('list servers', async () => {
    const result = await listMcpServers({ category: 'database' });
    expect(result).toContain('postgres');
    expect(result).toContain('sqlite');
  });

  test('enable server', async () => {
    const result = await enableMcpServer('postgres', {
      env: { DATABASE_URL: 'postgresql://...' }
    });
    expect(result.success).toBe(true);
    expect(result.toolCount).toBe(12);
  });
});

// Test artifact commands
describe('Artifact Commands', () => {
  test('create artifact', async () => {
    const result = await createArtifact('test-app', {
      type: 'web',
      language: 'javascript',
      mode: 'oneshot'
    });
    expect(result.artifactId).toBeDefined();
    expect(result.status).toBe('running');
  });
});
```

#### Integration Tests

```typescript
// Test MCP workflow
test('MCP workflow: list → enable → status', async () => {
  // List available servers
  const servers = await listMcpServers();
  expect(servers.length).toBeGreaterThan(0);

  // Enable postgres
  await enableMcpServer('postgres', {
    env: { DATABASE_URL: 'postgresql://localhost:5432/test' }
  });

  // Check status
  const status = await getMcpStatus();
  expect(status.enabledServers).toContain('postgres');
  expect(status.toolCount).toBeGreaterThan(0);
});

// Test artifact workflow
test('Artifact workflow: create → inspect → modify → stop', async () => {
  // Create artifact
  const artifact = await createArtifact('test-app', {
    type: 'web',
    language: 'javascript',
    code: 'console.log("Hello");'
  });

  // Inspect artifact
  const snapshot = await inspectArtifact(artifact.artifactId, {
    screenshot: true,
    console: true
  });
  expect(snapshot.console).toContain('Hello');

  // Modify artifact
  await modifyArtifact(artifact.artifactId, {
    code: 'console.log("World");'
  });

  // Verify modification
  const newSnapshot = await inspectArtifact(artifact.artifactId);
  expect(newSnapshot.console).toContain('World');

  // Stop artifact
  await stopArtifact(artifact.artifactId);
  expect(await getArtifactStatus(artifact.artifactId)).toBe('stopped');
});
```

#### E2E Tests

```bash
# Test MCP command flow
$ ./test/e2e/mcp-flow.sh
✓ List MCP servers
✓ Search for database servers
✓ Enable postgres server
✓ Verify MCP_CONFIG.md created
✓ Check server status (connected)
✓ Disable postgres server
✓ Verify MCP_CONFIG.md updated

# Test artifact creation
$ ./test/e2e/artifact-flow.sh
✓ Create web artifact
✓ Verify tmux session created
✓ Verify browser opened
✓ Capture screenshot
✓ Modify code
✓ Verify hot reload
✓ Stop artifact
✓ Verify cleanup
```

---

## Summary

This supplement documents **three critical systems** that were missed in the initial CLI Feature Audit:

### 1. Dynamic Artifact System (11 tools)
- **Revolutionary feature** for visual programming
- Create persistent interactive applications
- Multi-language support (JS, Python, Rust, Go, Shell, HTML)
- Visual feedback via Playwright
- Hot reload and dev mode
- **Priority**: HIGH (Phase 4, post-launch)
- **Effort**: 2-3 weeks dedicated work

### 2. MCP On-Demand Architecture (7 tools)
- **70% token savings** via progressive tool discovery
- Autonomous model control of MCP servers
- Project-aware configuration initialization
- Community server registry
- **Priority**: HIGH (Phase 2, immediate)
- **Effort**: 3-4 days

### 3. Special Tools
- **Tmux/Session Tools**: Persistent terminal sessions with visual snapshots
- **Historical Context Tools**: Access conversation history across compactions
- **Helper Model Tools**: Cost savings via cheaper model fallback
- **Server-Side Tools**: Provider-managed agentic execution
- **Priority**: MEDIUM (Phase 3)
- **Effort**: 1 week combined

### Updated Implementation Priority

1. **Phase 2** (Weeks 5-8): Add MCP commands (8 commands, 3-4 days)
2. **Phase 3** (Weeks 9-12): Add history + helper + tmux commands (10 commands, 1 week)
3. **Phase 4** (Post-launch): Add artifact system (15+ commands, 2-3 weeks)

The artifact system is the most powerful feature but requires significant CLI work. MCP on-demand has highest ROI (70% cost reduction) with minimal CLI work.

---

**Document Status**: ✅ Complete
**Next Steps**:
1. Review with CLI PRD team
2. Prioritize command implementation
3. Plan Phase 4 artifact system rollout
4. Create user education materials for artifacts
