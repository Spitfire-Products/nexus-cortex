# Nexus Cortex

**Multi-provider AI agent harness — a direct library, an optional HTTP server, and terminal UIs.**

Version: 4.8.0 · License: Apache-2.0

---

## Overview

Nexus Cortex is a production-ready AI development CLI that provides direct access to multiple LLM providers (Anthropic, OpenAI, Google, XAI, DeepSeek, and more) through an elegant command-line interface. Built as a TypeScript monorepo, it features a unique direct-wired architecture that eliminates HTTP overhead while maintaining optional server mode for web/mobile clients.

### Key Features

- **Direct-Wired Architecture** - Core library runs in-process for zero-latency tool execution
- **Multi-Provider Support** - 10+ AI providers with 65+ model configurations
- **Interactive CLI** - Rich terminal UI with slash commands, themes, and real-time feedback
- **MCP Integration** - Full Model Context Protocol support for extended tool capabilities
- **System Message Management** - Auto-loading project context via CORTEX.md and custom system messages
- **Session Persistence** - JSONL-based conversation history with UUID tracking
- **Tool Suite** - 17+ standard tools with context-aware execution
- **Optional HTTP Server** - Run as REST API for remote/web clients

---

## Quick Start

### Install from npm

```bash
# Headless harness — the `cortex` command (chat, autoresearch, scripting) + the HTTP server
npm install -g @nexus-cortex/cli @nexus-cortex/server

# Interactive terminal UIs — neoncortex (React/Ink), fuzzycortex-cli (chalk), launchers
npm install -g @nexus-cortex/tui

# Or embed the library directly
npm install @nexus-cortex/core @nexus-cortex/executors
```

### Run

```bash
neoncortex                                  # interactive React/Ink terminal UI
cortex "What is this project?"              # headless natural-language query (auto-starts a server)
cortex-server &                             # or run the HTTP server directly (port 4000)

# Headless server + curl
curl -s http://localhost:4000/v1/messages \
  -H "Content-Type: application/json" \
  -d '{"model":"grok-4-1-fast-reasoning","messages":[{"role":"user","content":"Hello"}]}'
```

### From source

```bash
npm install && npm run build               # 7-pass build of all 6 packages
```

See [Headless Mode](#headless-mode) for the full server workflow, or [CLI Interface](#cli-interface) for the interactive terminal UI.

---

## Headless Mode

The server is a **stateful agent** — sequential requests share one persistent session with full conversation history, tool execution, and context management. No terminal UI required.

### Start the Server

```bash
# Production (uses DEFAULT_MODEL_ID from .env)
node packages/server/dist/index.js &

# Override model at launch
DEFAULT_MODEL_ID=grok-4-1-fast-reasoning node packages/server/dist/index.js &

# Dev mode (auto-restart on code changes, auto-resumes session)
cd packages/server && npm run dev
```

Port 4000 = API server. Port 4001 = HTML dashboard (sandbox/tmux viewer, same process).

### Cortex CLI

Natural language interface to the running server. No curl required.

```bash
# Simple query
cortex "What is this project?"

# Use a specific model
cortex --model deepseek-chat "Explain TypeScript generics"

# Multi-turn conversation (session persists automatically)
cortex "Remember the launch code is FALCON-42"
cortex "What was the launch code?"

# JSON output for scripting and agent workflows
cortex --json "List the npm scripts" | jq '.content[0].text'

# Session management
cortex --sessions                          # List all sessions
cortex --stats                             # Current session stats
cortex --new "Start a fresh conversation"  # New session
cortex --resume SESSION_ID "Continue here" # Resume specific session
cortex --quiet "Just the answer"           # Response only, no metadata
```

Install globally: `npm install -g @nexus-cortex/cli` (or `npm run link` from source) — makes `cortex` available everywhere.

### Agent Team Usage

The session ID enables multi-turn agent workflows:

```bash
SESSION=$(cortex --quiet --json "Analyze test gaps" | jq -r '.sessionId')
cortex --resume $SESSION "Now fix the top priority gap"
cortex --resume $SESSION "Run the tests to verify"
```

### curl (Direct HTTP)

```bash
# Send a message
curl -s http://localhost:4000/v1/messages \
  -H "Content-Type: application/json" \
  -d '{"model":"grok-4-1-fast-reasoning","messages":[{"role":"user","content":"Read package.json and tell me the version"}]}'

# Multi-turn: next request continues the same conversation
curl -s http://localhost:4000/v1/messages \
  -H "Content-Type: application/json" \
  -d '{"model":"grok-4-1-fast-reasoning","messages":[{"role":"user","content":"What dependencies does it have?"}]}'
```

### Response Fields

| Field | Description |
|-------|-------------|
| `content[]` | Model text response |
| `toolUses[]` | Tools called (name, input, result) |
| `usage.inputTokens` | Total input tokens (reveals system message overhead) |
| `usage.outputTokens` | Response size |
| `usage.cache` | Cache hit rate and cost savings |
| `metadata.toolCallIterations` | Tool round-trips |

### Session Management API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/sessions` | GET | List all sessions |
| `/sessions/new` | POST | Start fresh session (old one saved) |
| `/sessions/:id/stats` | GET | Token usage, turns, tool calls |
| `/sessions/:id/messages` | GET | Full message history |
| `/sessions/:id/model` | POST | Switch model mid-session |
| `/sessions/:id/compaction` | POST | Trigger context compaction |
| `/sessions/:id/cache/metrics` | GET | Cache hit rate and savings |
| `/health` | GET | Server status and available models |

### Server Lifecycle

The server does **not** auto-shutdown after responses. It runs until explicitly stopped:

```bash
# Stop the server
pkill -f "packages/server/dist/index.js"   # or Ctrl+C if foreground
```

**Auto-resume**: On startup, the server automatically resumes the most recent session from disk. Control this with environment variables:

| Variable | Default | Behavior |
|----------|---------|----------|
| `AUTO_RESUME` | `true` | Resume most recent session on startup |
| `RESUME_SESSION_ID` | — | Resume a specific session by UUID |
| `AUTO_RESUME=false` | — | Always start a fresh session |

This means `tsx watch` restarts (dev mode) seamlessly continue your conversation — code changes take effect without losing session state.

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DEFAULT_MODEL_ID` | `gemini-2.5-flash` | Model to use (must be a registry ID) |
| `PORT` | `4000` | Server port |
| `DEBUG` | `false` | Verbose logging (system messages, routes) |
| `YOLO` | `false` | Auto-approve all tool executions |
| `CORTEX_MODE` | — | `stateless` for per-request sessions |

Run `node packages/server/dist/index.js --help` for full documentation.

---

## Architecture

### Monorepo Structure

```
nexus-cortex/
├── packages/
│   ├── types/              # Shared TypeScript types
│   ├── core/               # Core orchestration library
│   │   ├── orchestrator/   # CortexOrchestrator (main engine)
│   │   ├── providers/      # 10+ AI provider adapters
│   │   ├── models/         # Model registry (65+ models)
│   │   ├── tools/          # Tool definitions & executors
│   │   ├── mcp/            # MCP client & server integration
│   │   ├── system-messages/# System message auto-loading
│   │   └── session/        # JSONL session storage
│   ├── server/             # Express HTTP server (optional)
│   │   └── routes/         # REST API endpoints
│   └── cli/                # Interactive CLI interface
│       ├── commands/       # CLI command handlers
│       ├── themes/         # 15 professional themes
│       └── ui/             # Terminal UI components
├── .cortex/                # Auto-generated project context
│   ├── CORTEX.md           # Project context (auto-loaded)
│   └── system-messages/    # Custom system messages
└── scripts/                # Build and maintenance scripts
```

### Direct-Wired vs Server Mode

**Direct Mode (Default)**:
- Core library imported directly into CLI process
- Zero network overhead (~1ms vs ~15ms per operation)
- Immediate access to all orchestrator features
- Single-process debugging
- Recommended for development

**Server Mode (Optional)**:
- HTTP server for web/mobile clients
- REST API endpoints for remote access
- Multi-client support
- Enable with `--server` flag

```bash
# Direct mode (default)
cortex

# Server mode (local)
cortex --server

# Server mode (remote)
cortex --server http://remote:4000
```

---

## Core Systems

### 1. Cortex Orchestrator

The orchestrator coordinates all AI interactions, tool execution, and session management:

```typescript
import { CortexOrchestrator } from '@nexus-cortex/core';

const orchestrator = new CortexOrchestrator({
  modelId: 'claude-sonnet-4-5',
  projectPath: process.cwd(),
  mcpAutoInject: true,
  debug: false
});

const response = await orchestrator.processMessage({
  role: 'user',
  content: 'Analyze this codebase'
});
```

### 2. Multi-Provider System

10 AI providers with 65+ model configurations:

- **Anthropic** - Claude 3.5 Sonnet, Claude 3 Opus, Haiku
- **OpenAI** - GPT-4, GPT-4 Turbo, GPT-3.5 Turbo
- **Google** - Gemini 2.0 Flash, Gemini 1.5 Pro
- **XAI** - Grok 2, Grok Vision
- **DeepSeek** - DeepSeek V3, DeepSeek Chat
- **GLM** - GLM-4, GLM-4 Vision
- **Qwen** - Qwen 2.5, Qwen Turbo
- **Moonshot** - Moonshot V1
- **MiniMax** - MiniMax models
- **Gemma** - Google Gemma models

### 3. Tool System

A rich tool suite with read-before-edit safety and context-aware execution:

**File Operations**: Read, Write, Edit, Glob, Grep
**System**: Bash, TodoWrite, AskUserQuestion
**MCP**: ListMcpResources, Mcp, ReadMcpResource, InitMcpConfig, ListMcpServers
**Context**: InitCortexContext
**Session**: Skill, SlashCommand

### 4. System Message Management

Auto-loading system messages from multiple sources:

```
.cortex/
├── CORTEX.md                    # Auto-generated project context
└── system-messages/
    ├── 01-custom-instructions.md
    ├── 02-coding-standards.md
    └── 03-project-guidelines.md
```

**CORTEX.md Auto-Generation**:
```bash
# Generate project context in CLI
/init

# Or programmatically
import { InitCortexContext } from '@nexus-cortex/core';

await InitCortexContext.execute({
  scope: 'auto',      // or 'global' for ~/.cortex/
  max_depth: 5        // auto-detects monorepos
}, process.cwd());
```

CORTEX.md includes:
- Project description (from README.md)
- File tree structure (depth 5 for monorepos, 4 for regular projects)
- Dependency analysis (npm, Python, Rust, Go)
- Available scripts (package.json, Makefile)
- Monorepo package structure with descriptions

### 5. MCP Integration

Full Model Context Protocol support:

```bash
# CLI slash commands
/mcp list              # List configured MCP servers
/mcp enable <name>     # Enable an MCP server
/mcp disable <name>    # Disable an MCP server
```

Configuration in `.cortex/mcp_config.json`:
```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/allowed/directory"]
    }
  }
}
```

### 6. Session Management

JSONL-based conversation persistence with full state recovery:

- **Format**: Append-only JSONL (one JSON object per line) in `.cortex/sessions/`
- **IDs**: UUID-based message tracking (zero collision risk)
- **Checkpoints**: Content-addressable file history in `.cortex/file-history/`
- **Compaction**: Helper model auto-compacts at configurable token threshold
- **Auto-resume**: Server resumes most recent session on startup (see [Headless Mode](#server-lifecycle))
- **REST API**: 7 session endpoints for listing, stats, model switching, and compaction (see [Session Management API](#session-management-api))

---

## CLI Interface

### Interactive Mode

```bash
$ cortex

╔══════════════════════════════════════════════════════════╗
║             Nexus Cortex - AI Development CLI           ║
╚══════════════════════════════════════════════════════════╝

Model: claude-sonnet-4-5 | Session: abc-123 | Theme: monokai

> You: /help

Available Commands:
  /models list          - Show all available models
  /models switch        - Switch to different model
  /session checkpoint   - Save conversation checkpoint
  /cache metrics        - View cache statistics
  /system-message       - Manage system messages
  /init                 - Generate CORTEX.md context
  /debug                - Toggle debug logs
  /yolo                 - Enable auto-approve mode
  /clear                - Clear conversation
  /exit                 - Exit CLI

> You: Analyze the file structure```

### Slash Commands

| Command | Description |
|---------|-------------|
| `/models list` | List all available models |
| `/models switch <id>` | Switch to a different model |
| `/models info <id>` | Show model details |
| `/session checkpoint [name]` | Create session checkpoint |
| `/session list` | List all sessions |
| `/continue` | Load and continue previous session |
| `/cache metrics` | View cache statistics |
| `/mcp list` | List MCP servers |
| `/mcp enable <name>` | Enable MCP server |
| `/tools list` | List available tools |
| `/system-message` | Interactive system message manager |
| `/init` | Generate CORTEX.md context |
| `/debug` | Toggle debug log visibility |
| `/yolo` | Enable auto-approve all tools |
| `/clear` | Clear conversation history |
| `/exit` | Exit CLI |

### Theme System

15 professional themes available:

```bash
# Configure theme in .cortex/settings.json
{
  "theme": "monokai"  // or tokyo-night, dracula, solarized-dark, etc.
}
```

Available themes:
- `default`, `dracula`, `monokai`, `nord`, `solarized-dark`, `solarized-light`
- `tokyo-night`, `gruvbox`, `one-dark`, `material`, `palenight`
- `ayu-dark`, `catppuccin`, `synthwave`, `cyberpunk`

---

## Development

### Build Commands

```bash
# Clean build artifacts
npm run clean

# Build all packages (types → executors → core → server → cli)
npm run build

# Type checking
npm run typecheck

# Run tests
npm test

# Run tests with coverage
npm run test:ci

# Lint code
npm run lint

# Format code
npm run format
```

### Dev Workflow (Stateful Iteration)

The recommended development loop uses the server in dev mode with auto-resume:

```bash
# Terminal 1: Start server with hot reload
cd packages/server && npm run dev

# Terminal 2: Send messages (each builds on the last)
cortex "Read the orchestrator and explain the tool loop"
cortex "Now add logging before each tool call"
cortex "Run the tests to verify"
```

**What survives restarts:**
- **System message edits** (CORTEX.md, MEMORY.md, custom system messages) — read fresh each turn, no restart needed
- **Code changes** — tsx watch restarts the server, auto-resumes session from JSONL
- **Session state** — full message history, cache metrics, turn count restored from disk

```bash
# Fresh start (skip auto-resume)
AUTO_RESUME=false npm run dev

# Resume specific session
RESUME_SESSION_ID=409808cb-6083-4be3-b537-856a0d755032 npm run dev

# Kill server
pkill -f "packages/server/dist/index.js"
```

### Package Build Order

The monorepo uses a strict build order due to dependencies:

1. **@nexus-cortex/types** - Shared TypeScript types
2. **@nexus-cortex/executors** - Tool executors (depends on core, partial build first)
3. **@nexus-cortex/core** - Core library (depends on types)
4. **@nexus-cortex/executors** - Complete build (depends on core)
5. **@nexus-cortex/server** - HTTP server (depends on core)
6. **@nexus-cortex/cli** - Headless CLI: `cortex` (chat, autoresearch, scripting; depends on core)
7. **@nexus-cortex/tui** - Interactive React/Ink + chalk terminal UIs (depends on cli + core)

### Adding New Features

**New Tool**:
```typescript
// packages/core/src/tools/MyTool.ts
export class MyTool {
  static async execute(input: MyToolInput): Promise<MyToolOutput> {
    // Implementation
  }

  static getToolDefinition(): CanonicalTool {
    return {
      name: 'MyTool',
      description: 'Description',
      schema: { /* JSON schema */ }
    };
  }
}
```

**New Provider**:
```typescript
// packages/core/src/providers/MyProvider.ts
export class MyProvider extends BaseProvider {
  async sendMessage(config: ProviderConfig): Promise<ProviderResponse> {
    // Implementation
  }
}
```

**New Slash Command**:
```typescript
// packages/cli/src/commands/slash/SlashCommandRegistry.ts
this.register({
  name: 'mycommand',
  category: 'system',
  description: 'My command description',
  usage: '/mycommand [args]'
});

// packages/cli/src/commands/chat/interactive.ts
case 'mycommand':
  // Handle command
  break;
```

---

## Configuration

### Environment Variables

```bash
# AI Provider API Keys
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
GOOGLE_API_KEY=AIza...
X_API_KEY=xai-...
DEEPSEEK_API_KEY=sk-...

# Optional Configuration
DEBUG=false                    # Enable debug logging
DEFAULT_MODEL=claude-sonnet-4-5
```

### Settings File

`.cortex/settings.json`:
```json
{
  "theme": "monokai",
  "defaultModel": "claude-sonnet-4-5",
  "autoApproveTools": false,
  "showDebugLogs": false,
  "mcpAutoInject": true
}
```

### MCP Configuration

`.cortex/mcp_config.json`:
```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/allowed/path"]
    },
    "brave-search": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-brave-search"],
      "env": {
        "BRAVE_API_KEY": "your-api-key"
      }
    }
  }
}
```

---

## Production Deployment

### Server Mode

```bash
# Production server
NODE_ENV=production PORT=4000 node packages/server/dist/index.js

# With PM2
pm2 start packages/server/dist/index.js --name nexus-cortex

# Docker (future)
docker build -t nexus-cortex .
docker run -p 4000:4000 -e ANTHROPIC_API_KEY=... nexus-cortex
```

### Global CLI Installation

From npm:

```bash
npm install -g @nexus-cortex/cli @nexus-cortex/tui
```

From source — `npm run build` auto-links all global commands (both `cli` and `tui`):

```bash
npm install && npm run build     # builds + links
npm run link                     # re-link any time (self-healing)

# Then use from anywhere:
cortex "your prompt"             # headless (chat, autoresearch, scripting)
neoncortex                       # interactive React/Ink UI
fuzzycortex-cli                  # interactive chalk REPL
```

---

## Migration from V3

Key differences:

| Aspect | V3 | V4 |
|--------|----|----|
| Architecture | HTTP-first | Direct-wired with optional server |
| Session Storage | SQLite | JSONL |
| Performance | ~15ms per operation | ~1ms per operation (direct mode) |
| Context System | None | CORTEX.md auto-generation |
| System Messages | Basic | Auto-loading with hot-reload |
| Themes | 2 themes | 15 professional themes |
| MCP Support | Limited | Full integration |
| Tool Execution | HTTP requests | Direct library calls |

---

## Troubleshooting

### Build Errors

```bash
# Clean and rebuild
npm run clean
npm run build
```

### TypeScript Errors

```bash
# Check types
npm run typecheck

# Strict null checks issue
# Ensure all array accesses check for undefined
```

### MCP Server Issues

```bash
# Test MCP server manually
npx -y @modelcontextprotocol/server-filesystem /path/to/dir

# Check MCP config
cat .cortex/mcp_config.json

# Enable debug logs
/debug
```

### Missing API Keys

Ensure all required API keys are set:
```bash
echo $ANTHROPIC_API_KEY
echo $OPENAI_API_KEY
```

---

## Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing-feature`)
3. Make changes with tests
4. Run preflight checks (`npm run typecheck && npm test`)
5. Commit changes (`git commit -m 'Add amazing feature'`)
6. Push to branch (`git push origin feature/amazing-feature`)
7. Open Pull Request

---

## License

Apache-2.0 — see [LICENSE](LICENSE). Copyright 2026 Spitfire-Products.

---

## Credits

Built as a clean-room TypeScript multi-provider harness.

**Cortex Development Team**

---

## Links

- [CORTEX.md](./.cortex/CORTEX.md) - Auto-generated project context
- [Research Docs](./.claude/claude_research_analysis/) - Architecture research

