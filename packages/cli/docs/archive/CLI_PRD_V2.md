# OmniClaude V4 CLI - Product Requirements Document (V2)

**Version:** 2.0
**Date:** 2025-01-14
**Status:** Comprehensive Feature Coverage Based on Audit
**Previous Version:** V1.0 (30% feature coverage)
**Current Version:** V2.0 (100% feature coverage across all phases)

---

## Document Change Log

**V2.0 Updates:**
- Added complete Permissions Management system (3 modes, policy-based)
- Added MCP Management commands (7 tools + auto-discovery)
- Added Historical Context tools (4 retrieval tools)
- Added Mentorship/Helper Model controls
- Expanded configuration from 5 to 45+ settings
- Added Wave 3 Middleware visibility and controls
- Added Artifact System (Phase 4 - post-launch)
- Defined 4 implementation phases with priorities
- Updated package structure for new features
- Added 50+ new commands

---

## 1. Executive Summary

The OmniClaude V4 CLI is a shell-based terminal interface that serves as the first client application for the OmniClaude V4 core library. It validates the HTTP API and acts as the reference implementation for future clients (web UI, mobile apps).

**Strategic Purpose:**
- Validate HTTP API through real-world usage
- Open source to drive developer adoption
- Reference implementation for future clients
- Marketing tool demonstrating core library capabilities
- Gateway to monetization (SaaS, enterprise licensing)

**Key Architectural Decision:** CLI communicates via HTTP with the server (not direct library imports) to validate the API that web and mobile clients will use.

### Feature Coverage Summary

Based on comprehensive feature audit of @omniclaude/core:

| Category | Core Features | V1 PRD Coverage | V2 PRD Coverage |
|----------|--------------|-----------------|-----------------|
| **Basic Chat** | Interactive/Single message | ✅ 100% | ✅ 100% |
| **Models** | 66 models, 10 providers | ⚠️ 20% (list only) | ✅ 100% (Phase 1-2) |
| **Tools** | 34 tools (27 base + 7 MCP) | ❌ 0% | ✅ 100% (Phase 1-2) |
| **Permissions** | 3 modes, policy-based | ❌ 0% | ✅ 100% (Phase 1) |
| **MCP** | 7 management tools + auto-discovery | ❌ 0% | ✅ 100% (Phase 2) |
| **Sessions** | List/view/export | ✅ 80% | ✅ 100% (Phase 1) |
| **Middleware** | 7 Wave 3 systems | ❌ 0% | ✅ 90% (Phase 2-3) |
| **Historical Context** | 4 retrieval tools | ❌ 0% | ✅ 100% (Phase 3) |
| **Mentorship** | Helper model integration | ❌ 0% | ✅ 100% (Phase 3) |
| **Artifacts** | 11 tools, visual feedback | ❌ 0% | ✅ 100% (Phase 4) |
| **Configuration** | 45+ settings | ⚠️ 12% (5 settings) | ✅ 100% (Phase 1-2) |

**Overall Coverage:**
- V1 PRD: ~30% of core features
- V2 PRD: 100% of core features (phased rollout)

---

## 2. Architecture

### 2.1 System Architecture

```
┌─────────────────────────────┐
│     CLI Package             │
│   (Commander.js)            │
│                             │
│  ┌─────────────────────┐    │
│  │ Command Handlers    │    │
│  └──────────┬──────────┘    │
│             │               │
│  ┌──────────▼──────────┐    │
│  │ OmniClaudeClient    │    │
│  │ (HTTP Wrapper)      │    │
│  └──────────┬──────────┘    │
└─────────────┼───────────────┘
              │ HTTP/SSE
┌─────────────▼───────────────┐
│   OmniClaude V4 Server      │
│   (localhost:4000)          │
│                             │
│   Routes:                   │
│   • POST /v1/messages       │
│   • GET /models             │
│   • GET /v1/approval-mode   │
│   • POST /v1/approval-mode  │
└─────────────┬───────────────┘
              │
┌─────────────▼───────────────┐
│   @omniclaude/core          │
│                             │
│   Components:               │
│   • OmniClaudeOrchestrator  │
│   • 7 Wave 3 Middleware     │
│   • AdapterRegistry         │
│   • ModelRegistry (66)      │
│   • Tool System (34 tools)  │
│   • MCP Integration         │
│   • Session Management      │
└─────────────────────────────┘
```

### 2.2 Technology Stack

| Component | Technology | Rationale |
|-----------|-----------|-----------|
| CLI Framework | Commander.js | Industry standard, TypeScript support, excellent docs |
| HTTP Client | node-fetch | Simple, streaming support, widely used |
| Terminal UI | chalk | Lightweight color support |
| Spinners | cli-spinners | Standard loading indicators |
| Prompts | inquirer | Interactive prompts, mature library |
| Markdown | marked-terminal | Terminal-optimized markdown rendering |
| Syntax Highlighting | highlight.js | Wide language support |
| Config Management | cosmiconfig | Standard config file discovery |
| Testing | Vitest | Fast, TypeScript-first |

---

## 3. Package Structure

```
packages/cli/
├── src/
│   ├── index.ts                      # Entry point, bootstrap
│   ├── cli.ts                        # Commander.js setup and routing
│   │
│   ├── commands/                     # Command implementations
│   │   ├── chat.ts                   # Interactive chat mode
│   │   ├── message.ts                # Single message (non-interactive)
│   │   │
│   │   ├── session/                  # Session management (expanded)
│   │   │   ├── list.ts               # List sessions
│   │   │   ├── view.ts               # View session details
│   │   │   ├── export.ts             # Export to JSON
│   │   │   ├── delete.ts             # Delete session
│   │   │   ├── resume.ts             # Resume from checkpoint
│   │   │   ├── stats.ts              # Session statistics
│   │   │   └── checkpoints.ts        # Checkpoint management
│   │   │
│   │   ├── models/                   # Model management (expanded)
│   │   │   ├── list.ts               # List all models
│   │   │   ├── info.ts               # Model details
│   │   │   ├── search.ts             # Search/filter models
│   │   │   ├── providers.ts          # Provider management
│   │   │   └── cost.ts               # Cost tracking
│   │   │
│   │   ├── permissions/              # NEW: Permissions management (Phase 1)
│   │   │   ├── status.ts             # Get current mode
│   │   │   ├── mode.ts               # Switch modes (interactive/auto/strict)
│   │   │   ├── logs.ts               # View approval logs
│   │   │   ├── policies.ts           # Manage policies
│   │   │   └── actions.ts            # Auto-approve actions config
│   │   │
│   │   ├── mcp/                      # NEW: MCP management (Phase 2)
│   │   │   ├── list.ts               # List MCP servers
│   │   │   ├── search.ts             # Search MCP marketplace
│   │   │   ├── enable.ts             # Enable server
│   │   │   ├── disable.ts            # Disable server
│   │   │   ├── configure.ts          # Server configuration
│   │   │   ├── init.ts               # Initialize MCP_CONFIG.md
│   │   │   └── tools.ts              # List available MCP tools
│   │   │
│   │   ├── history/                  # NEW: Historical context (Phase 3)
│   │   │   ├── search.ts             # Search conversation history
│   │   │   ├── boundaries.ts         # List compaction boundaries
│   │   │   ├── segment.ts            # Get conversation segment
│   │   │   └── context.ts            # Request historical context
│   │   │
│   │   ├── mentorship/               # NEW: Mentorship controls (Phase 3)
│   │   │   ├── status.ts             # Get mentorship status
│   │   │   ├── toggle.ts             # Enable/disable mentorship
│   │   │   └── logs.ts               # View mentorship logs
│   │   │
│   │   ├── artifacts/                # NEW: Artifact system (Phase 4)
│   │   │   ├── create.ts             # Create artifact
│   │   │   ├── list.ts               # List artifacts
│   │   │   ├── inspect.ts            # Inspect sandbox
│   │   │   ├── interact.ts           # UI interaction
│   │   │   ├── modify.ts             # Modify code
│   │   │   ├── stop.ts               # Stop sandbox
│   │   │   └── dashboard.ts          # Open web dashboard
│   │   │
│   │   ├── server.ts                 # Server control
│   │   ├── config.ts                 # Configuration management (expanded)
│   │   └── init.ts                   # First-run wizard
│   │
│   ├── client/                       # HTTP client layer
│   │   ├── OmniClaudeClient.ts       # Main HTTP API wrapper
│   │   ├── SSEParser.ts              # Server-Sent Events parser
│   │   ├── types.ts                  # Client TypeScript types
│   │   └── errors.ts                 # Custom error classes
│   │
│   ├── ui/                           # Terminal UI components
│   │   ├── Prompt.ts                 # User input handling
│   │   ├── MessageRenderer.ts        # AI response display
│   │   ├── ToolDisplay.ts            # Tool execution visualization
│   │   ├── StatusBar.ts              # Session status header
│   │   ├── Spinner.ts                # Loading indicators
│   │   ├── themes.ts                 # Color schemes
│   │   │
│   │   ├── permissions/              # NEW: Permission UI (Phase 1)
│   │   │   ├── ApprovalPrompt.ts     # Interactive approval UI
│   │   │   └── PolicyViewer.ts       # Policy visualization
│   │   │
│   │   └── artifacts/                # NEW: Artifact UI (Phase 4)
│   │       ├── SandboxViewer.ts      # Sandbox status display
│   │       └── InteractionPrompt.ts  # UI interaction prompts
│   │
│   ├── utils/                        # Shared utilities
│   │   ├── config-manager.ts         # Config file operations (expanded)
│   │   ├── server-manager.ts         # Server lifecycle management
│   │   ├── logger.ts                 # Debug logging
│   │   ├── validation.ts             # Input validation
│   │   └── format.ts                 # Output formatting
│   │
│   └── types/                        # Shared TypeScript types
│       └── index.ts
│
├── bin/
│   └── omniclaude.js                 # Binary entry point (#!/usr/bin/env node)
│
├── test/
│   ├── unit/                         # Unit tests
│   ├── integration/                  # Integration tests
│   └── e2e/                          # End-to-end tests
│
├── docs/
│   ├── COMMANDS.md                   # Command reference (auto-generated)
│   ├── EXAMPLES.md                   # Usage examples
│   ├── PERMISSIONS.md                # Permissions guide
│   ├── MCP_GUIDE.md                  # MCP integration guide
│   ├── ARTIFACTS.md                  # Artifact system guide
│   └── CONFIGURATION.md              # Configuration reference
│
├── artifacts/                        # NEW: Artifact documentation (67KB existing)
│   ├── IMPLEMENTATION_GUIDE.md       # 26KB
│   ├── INTEGRATION_EXAMPLES.md       # 27KB
│   ├── MESSAGE_PROTOCOL.md           # 14KB
│   └── contracts/
│       └── artifact.contracts.ts
│
├── package.json
├── tsconfig.json
└── README.md
```

---

## 4. Command Reference

### 4.1 Global Options

Available on all commands:

```bash
--server <url>      # Server URL (default: http://localhost:4000)
--config <path>     # Config file path (default: ~/.omniclaude/config.json)
--debug             # Enable debug logging
--no-color          # Disable colored output
--json              # Output JSON format (for scripting)
--version           # Show version information
--help              # Show help message
```

---

## 5. Core Commands (Phase 1 - Week 1-2)

### 5.1 Interactive Chat Mode

**Command:**
```bash
omniclaude chat [options]
omniclaude                        # Shorthand (default command)
```

**Options:**
```bash
-m, --model <id>                  # Model to use (default: from config)
-r, --resume <id>                 # Resume from checkpoint ID
--system <message>                # Custom system message
--max-tokens <number>             # Maximum tokens (default: 4096)
--temperature <number>            # Temperature 0-2 (default: 1.0)
--no-stream                       # Disable streaming (wait for full response)
--permission-mode <mode>          # Set permission mode: interactive/auto/strict
```

**Examples:**
```bash
# Start interactive chat with default model
omniclaude chat

# Start with specific model
omniclaude chat -m claude-sonnet-4-5

# Resume from checkpoint
omniclaude chat --resume checkpoint-abc-123

# Custom system message
omniclaude chat --system "You are a Rust expert"

# Auto-approve all actions (YOLO mode)
omniclaude chat --permission-mode auto
```

### 5.2 Single Message Mode (Non-Interactive)

**Command:**
```bash
omniclaude message <prompt> [options]
omniclaude "prompt"               # Shorthand
```

**Options:**
```bash
-m, --model <id>                  # Model to use
--system <message>                # System message
--max-tokens <number>             # Maximum tokens
--temperature <number>            # Temperature 0-2
--json                            # Output as JSON
--raw                             # Output raw text only (no formatting)
```

**Examples:**
```bash
# Quick question
omniclaude "How do I reverse a string in Python?"

# With specific model
omniclaude message "Explain recursion" -m gpt-4o

# JSON output for scripting
omniclaude "Summarize this code" --json < file.py

# Raw output (no markdown formatting)
omniclaude "Generate hello world" --raw
```

### 5.3 Model Management

**Commands:**
```bash
omniclaude models list [options]        # List all available models
omniclaude models info <model-id>       # Show detailed model information
omniclaude models search <query>        # Search models by name/provider
omniclaude models providers             # List all providers
omniclaude models cost [session-id]     # Show cost breakdown
```

**Options for `list`:**
```bash
--provider <name>                 # Filter by provider (xai, anthropic, google, etc.)
--format <format>                 # Filter by format (messages, chat-completions, etc.)
--min-context <tokens>            # Minimum context window
--max-context <tokens>            # Maximum context window
--supports-tools                  # Only models with tool support
--supports-vision                 # Only models with vision support
--sort-by <field>                 # Sort by: cost, context, name, provider
```

**Examples:**
```bash
# List all models
omniclaude models list

# Filter by provider
omniclaude models list --provider xai

# Show models with tool support
omniclaude models list --supports-tools

# Show cost for session
omniclaude models cost session-abc-123

# Search for models
omniclaude models search "grok"

# JSON output
omniclaude models list --json
```

### 5.4 Session Management

**Commands:**
```bash
omniclaude session list [options]       # List all sessions
omniclaude session view <id>            # View session details
omniclaude session export <id>          # Export session to JSON
omniclaude session delete <id>          # Delete session
omniclaude session resume <id>          # Resume from checkpoint
omniclaude session stats [id]           # Show session statistics
omniclaude session checkpoints <id>     # List checkpoints for session
```

**Options for `list`:**
```bash
--model <id>                      # Filter by model
--limit <number>                  # Limit results (default: 20)
--sort-by <field>                 # Sort by: date, messages, tokens, cost
--format <format>                 # Output format: table, list, json
```

**Examples:**
```bash
# List all sessions
omniclaude session list

# List recent sessions
omniclaude session list --limit 10

# View specific session
omniclaude session view session-abc-123

# Export session
omniclaude session export session-abc-123 > session.json

# Resume from checkpoint
omniclaude session resume session-abc-123

# Session statistics
omniclaude session stats session-abc-123

# List checkpoints
omniclaude session checkpoints session-abc-123
```

---

## 6. Permissions Management (Phase 1 - Critical)

### 6.1 Overview

OmniClaude V4 has a comprehensive permissions system with 3 modes:

1. **Interactive Mode** (default): Prompt user for approval on sensitive operations
2. **Auto Mode** (YOLO): Auto-approve all operations (development/testing)
3. **Strict Mode**: Block all write operations, only allow read operations

**Policy System:**
- 3-tier architecture: Whitelist → Graylist → Blacklist
- Auto-approve actions: Specific operations that bypass approval prompts
- Audit logging: All permission decisions logged

### 6.2 Commands

**Commands:**
```bash
omniclaude permissions status           # Show current permission mode
omniclaude permissions mode <mode>      # Set mode: interactive/auto/strict
omniclaude permissions logs [options]   # View approval logs
omniclaude permissions policies         # List active policies
omniclaude permissions actions          # Manage auto-approve actions
```

**Options for `logs`:**
```bash
--session <id>                    # Filter by session
--action <name>                   # Filter by action type
--approved                        # Show only approved
--denied                          # Show only denied
--limit <number>                  # Limit results
--format <format>                 # Output format: table, json
```

**Examples:**
```bash
# Check current mode
omniclaude permissions status

# Enable auto-approve (YOLO mode)
omniclaude permissions mode auto

# Enable strict mode (read-only)
omniclaude permissions mode strict

# View approval logs
omniclaude permissions logs

# View denied operations
omniclaude permissions logs --denied

# List auto-approve actions
omniclaude permissions actions

# Export logs as JSON
omniclaude permissions logs --json > approval-logs.json
```

### 6.3 Auto-Approve Actions

**Concept:** Specific operations that bypass interactive approval prompts for smoother workflow.

**Management:**
```bash
omniclaude permissions actions list              # List configured actions
omniclaude permissions actions add <pattern>     # Add auto-approve pattern
omniclaude permissions actions remove <pattern>  # Remove pattern
omniclaude permissions actions clear             # Clear all patterns
```

**Examples:**
```bash
# List auto-approve actions
omniclaude permissions actions list

# Auto-approve npm install
omniclaude permissions actions add "bash:npm install*"

# Auto-approve file reads
omniclaude permissions actions add "read_file:**"

# Remove pattern
omniclaude permissions actions remove "bash:npm install*"

# Clear all auto-approve actions
omniclaude permissions actions clear
```

### 6.4 HTTP API Endpoints

These endpoints are used internally by CLI commands:

```bash
GET  /v1/approval-mode              # Get current mode
POST /v1/approval-mode              # Set mode: { mode: 'interactive'|'auto'|'strict' }
```

---

## 7. MCP Management (Phase 2 - High ROI)

### 7.1 Overview

Model Context Protocol (MCP) provides on-demand tool discovery for maximum token efficiency:

**Benefits:**
- 70% token reduction through progressive tool loading
- Dynamic server enablement based on task context
- Marketplace discovery of community servers

**Architecture:**
- Two-tier system: Auto-injection + 7 management tools
- MCP_CONFIG.md stores server configurations
- Servers can be enabled/disabled dynamically

### 7.2 Commands

**Commands:**
```bash
omniclaude mcp list                     # List configured MCP servers
omniclaude mcp search <query>           # Search MCP marketplace
omniclaude mcp enable <server>          # Enable MCP server
omniclaude mcp disable <server>         # Disable MCP server
omniclaude mcp configure <server>       # Configure server settings
omniclaude mcp init                     # Initialize MCP_CONFIG.md
omniclaude mcp tools [server]           # List available tools from server
```

**Examples:**
```bash
# Initialize MCP configuration
omniclaude mcp init

# List configured servers
omniclaude mcp list

# Search marketplace
omniclaude mcp search "filesystem"

# Enable filesystem server
omniclaude mcp enable @modelcontextprotocol/server-filesystem

# List tools from server
omniclaude mcp tools @modelcontextprotocol/server-filesystem

# Disable server
omniclaude mcp disable @modelcontextprotocol/server-filesystem

# Configure server
omniclaude mcp configure @modelcontextprotocol/server-filesystem
```

### 7.3 MCP_CONFIG.md Structure

**File Location:** `<project-root>/MCP_CONFIG.md`

**Example Configuration:**
```yaml
# MCP Server Configuration

## Filesystem Server
- **Status:** enabled
- **Package:** @modelcontextprotocol/server-filesystem
- **Arguments:** ["/path/to/project"]
- **Tools:** read_file, write_file, list_directory, search_files

## Python Execution Server
- **Status:** disabled
- **Package:** @modelcontextprotocol/server-python
- **Arguments:** []
- **Tools:** execute_python, install_package
```

### 7.4 On-Demand Architecture

**Progressive Tool Discovery:**

1. **Initial Request:** Only base tools loaded (27 tools)
2. **Task Detection:** Model identifies need for specialized tools
3. **Dynamic Loading:** MCP server enabled, tools discovered
4. **Tool Usage:** Model uses new tools
5. **Cleanup:** Optional server disable after task completion

**Token Savings:**
- Without MCP: 34 tools × 150 tokens/tool = 5,100 tokens per request
- With MCP: 27 base tools + 4 on-demand = 4,650 tokens saved (70% reduction)

---

## 8. Server Management

**Commands:**
```bash
omniclaude server start [options]       # Start server
omniclaude server stop                  # Stop server
omniclaude server status                # Check server status
omniclaude server logs                  # View server logs
```

**Options for `start`:**
```bash
--port <number>                   # Server port (default: 4000)
--daemon                          # Run as background daemon
--log-file <path>                 # Log file location
```

**Examples:**
```bash
# Start server
omniclaude server start

# Start on different port
omniclaude server start --port 5000

# Start as daemon
omniclaude server start --daemon

# Check status
omniclaude server status

# View logs
omniclaude server logs
```

---

## 9. Configuration Management (Expanded)

### 9.1 Configuration Categories

OmniClaude V4 supports 45+ configuration settings across 6 categories:

1. **Core Settings** (5 settings)
2. **Model Settings** (8 settings)
3. **Permissions** (12 settings)
4. **MCP Settings** (7 settings)
5. **Session Settings** (6 settings)
6. **UI/Display** (7 settings)

### 9.2 Commands

**Commands:**
```bash
omniclaude config get <key>             # Get configuration value
omniclaude config set <key> <value>     # Set configuration value
omniclaude config list [category]       # List all/category configuration
omniclaude config reset [key]           # Reset to defaults
omniclaude config export                # Export config to JSON
omniclaude config import <file>         # Import config from JSON
omniclaude init                         # First-run wizard
```

**Examples:**
```bash
# Set default model
omniclaude config set defaultModel gemini-2-5-flash

# Get default model
omniclaude config get defaultModel

# List all config
omniclaude config list

# List permissions config
omniclaude config list permissions

# Reset specific setting
omniclaude config reset defaultModel

# Export configuration
omniclaude config export > my-config.json

# Import configuration
omniclaude config import my-config.json

# Interactive setup wizard
omniclaude init
```

### 9.3 Configuration Keys

#### Core Settings
```yaml
defaultModel: string              # Default model ID (e.g., "gemini-2-5-flash")
serverUrl: string                 # Server URL (default: "http://localhost:4000")
temperature: number               # Default temperature 0-2 (default: 1.0)
maxTokens: number                 # Default max tokens (default: 4096)
theme: string                     # Color theme: default/dark/light/custom
```

#### Model Settings
```yaml
model.preferredProvider: string   # Preferred provider (xai, anthropic, google, etc.)
model.fallbackModel: string       # Fallback model on primary failure
model.costTracking: boolean       # Enable cost tracking (default: true)
model.streamingEnabled: boolean   # Enable streaming responses (default: true)
model.retryAttempts: number       # Retry attempts on failure (default: 3)
model.retryDelay: number          # Retry delay in ms (default: 1000)
model.timeout: number             # Request timeout in ms (default: 120000)
model.cacheEnabled: boolean       # Enable response caching (default: false)
```

#### Permissions Settings
```yaml
permissions.mode: string          # Permission mode: interactive/auto/strict
permissions.defaultPolicy: string # Default policy: allow/deny
permissions.auditLogging: boolean # Enable audit logging (default: true)
permissions.logDirectory: string  # Audit log directory
permissions.promptTimeout: number # Approval prompt timeout in ms
permissions.showToolInput: boolean # Show tool input in approval prompt
permissions.autoApproveRead: boolean # Auto-approve read operations
permissions.autoApproveWrite: boolean # Auto-approve write operations
permissions.autoApproveBash: boolean # Auto-approve bash commands
permissions.blockedPaths: string[] # Blocked file paths
permissions.allowedPaths: string[] # Allowed file paths
permissions.dangerousCommands: string[] # Blocked bash commands
```

#### MCP Settings
```yaml
mcp.enabled: boolean              # Enable MCP (default: true)
mcp.configFile: string            # MCP_CONFIG.md location
mcp.autoDiscovery: boolean        # Auto-discover MCP tools (default: true)
mcp.progressiveLoading: boolean   # Enable progressive loading (default: true)
mcp.marketplaceUrl: string        # MCP marketplace URL
mcp.cacheToolsLocal: boolean      # Cache discovered tools (default: true)
mcp.maxServers: number            # Max concurrent MCP servers (default: 10)
```

#### Session Settings
```yaml
session.storageDir: string        # Session storage directory
session.autoSave: boolean         # Auto-save sessions (default: true)
session.checkpointFrequency: number # Checkpoint every N turns (default: 10)
session.maxSessions: number       # Max stored sessions (default: 100)
session.retentionDays: number     # Session retention in days (default: 30)
session.compactionEnabled: boolean # Enable conversation compaction
```

#### UI/Display Settings
```yaml
ui.colorEnabled: boolean          # Enable colored output (default: true)
ui.spinnerStyle: string           # Loading spinner style
ui.markdownEnabled: boolean       # Render markdown (default: true)
ui.syntaxHighlight: boolean       # Enable syntax highlighting (default: true)
ui.showTimestamps: boolean        # Show message timestamps (default: false)
ui.showTokenCounts: boolean       # Show token usage (default: true)
ui.maxMessageWidth: number        # Max message width in chars (default: 80)
```

### 9.4 Configuration File Location

**Default Locations:**
- **Config File:** `~/.omniclaude/config.json`
- **Cosmiconfig Search Order:**
  1. `.omniclauderc` (JSON or YAML)
  2. `.omniclauderc.json`
  3. `.omniclauderc.yaml`
  4. `.omniclauderc.yml`
  5. `omniclaude.config.js`
  6. `package.json` (`omniclaude` field)

---

## 10. Historical Context Tools (Phase 3)

### 10.1 Overview

Historical context tools provide access to compacted conversation history for long-running sessions:

**Use Cases:**
- Retrieve information from early conversation turns
- Access summaries of compacted segments
- Navigate conversation boundaries
- Search full conversation history

**Architecture:**
- 9-section summaries for each compacted segment
- Deterministic system-reminder injection
- Timeline-based navigation

### 10.2 Commands

**Commands:**
```bash
omniclaude history search <query>       # Search conversation history
omniclaude history boundaries           # List compaction boundaries
omniclaude history segment <index>      # Get conversation segment
omniclaude history context [turns]      # Request historical context
```

**Examples:**
```bash
# Search conversation history
omniclaude history search "error handling"

# List compaction boundaries
omniclaude history boundaries

# Get specific segment
omniclaude history segment 2

# Request last 50 turns of context
omniclaude history context 50
```

### 10.3 Integration with Chat

Historical context tools are automatically available to the model during chat sessions:

```bash
# During chat, model can:
# - Search previous conversations: "search_conversation_history"
# - List boundaries: "list_compaction_boundaries"
# - Get segments: "get_conversation_segment"
# - Request context: "request_historical_context"
```

---

## 11. Mentorship/Helper Model (Phase 3)

### 11.1 Overview

Helper model integration reduces costs by using smaller models for simple tasks:

**Strategy:**
- Primary model for complex reasoning
- Helper model for simple operations (grep, list, etc.)
- Automatic model selection based on task complexity
- Cost tracking across both models

**Typical Savings:** 40-60% cost reduction on multi-turn sessions

### 11.2 Commands

**Commands:**
```bash
omniclaude mentorship status            # Get mentorship status
omniclaude mentorship enable [model]    # Enable helper model
omniclaude mentorship disable           # Disable helper model
omniclaude mentorship logs              # View helper model usage logs
omniclaude mentorship stats [session]   # Show cost savings statistics
```

**Examples:**
```bash
# Check mentorship status
omniclaude mentorship status

# Enable helper model (auto-select)
omniclaude mentorship enable

# Enable with specific helper model
omniclaude mentorship enable claude-3-5-haiku

# View usage logs
omniclaude mentorship logs

# Show cost savings
omniclaude mentorship stats session-abc-123

# Disable mentorship
omniclaude mentorship disable
```

### 11.3 Configuration

**Settings:**
```yaml
mentorship.enabled: boolean       # Enable helper model (default: false)
mentorship.helperModel: string    # Helper model ID (default: auto-select)
mentorship.taskThreshold: string  # Complexity threshold: low/medium/high
mentorship.costTracking: boolean  # Track cost savings (default: true)
```

---

## 12. Artifact System (Phase 4 - Post-Launch)

### 12.1 Overview

The artifact system is OmniClaude V4's most powerful feature, enabling dynamic code execution with visual feedback:

**Capabilities:**
- Multi-language support (JavaScript, Python, Rust, Go, Shell, HTML)
- 3 execution modes: oneshot, dev (hot reload), persistent
- Visual feedback via Playwright integration
- Package managers: npm, pip, uv, nix
- UI frameworks: Express, FastAPI, Flask, Next.js
- Real-time screenshot streaming
- DOM inspection and interaction

**Architecture:**
- 11 specialized tools
- TmuxManager for session isolation
- SandboxRegistry for resource tracking
- Express/FastAPI servers for visual artifacts

### 12.2 Commands

**Commands:**
```bash
omniclaude artifact create <options>    # Create new artifact
omniclaude artifact list                # List active artifacts
omniclaude artifact inspect <id>        # Inspect sandbox (screenshot, DOM, console)
omniclaude artifact interact <id>       # Interact with UI (click, type, etc.)
omniclaude artifact modify <id>         # Modify artifact code
omniclaude artifact stop <id>           # Stop sandbox
omniclaude artifact dashboard           # Open web dashboard
omniclaude artifact logs <id>           # View artifact logs
```

**Options for `create`:**
```bash
--language <lang>                 # Language: javascript/python/rust/go/shell/html
--mode <mode>                     # Mode: oneshot/dev/persistent
--visual                          # Enable visual feedback (Playwright)
--packages <list>                 # Comma-separated package list
--package-manager <pm>            # Package manager: npm/pip/uv/nix
--framework <name>                # UI framework: express/fastapi/flask/nextjs
--hot-reload                      # Enable hot reload (dev mode)
--open-browser                    # Open browser automatically
```

**Examples:**
```bash
# Create JavaScript artifact with Express
omniclaude artifact create \
  --language javascript \
  --framework express \
  --visual \
  --hot-reload

# Create Python data visualization
omniclaude artifact create \
  --language python \
  --packages "matplotlib,pandas" \
  --package-manager pip \
  --visual

# List active artifacts
omniclaude artifact list

# Inspect artifact (get screenshot)
omniclaude artifact inspect artifact-abc-123

# Interact with UI
omniclaude artifact interact artifact-abc-123

# Stop artifact
omniclaude artifact stop artifact-abc-123

# Open web dashboard
omniclaude artifact dashboard
```

### 12.3 Artifact Tools Available to Model

During chat sessions, the model has access to 11 artifact tools:

1. **CreateArtifactTool** - Create dynamic artifacts
2. **InspectSandboxTool** - Screenshot, DOM, console observation
3. **InteractWithSandboxTool** - Playwright UI interaction
4. **ModifySandboxTool** - Code editing with auto-reload
5. **StopSandboxTool** - Resource cleanup
6. **VisualFeedbackBridge** - Playwright integration
7. **SandboxEventBroadcaster** - Real-time events
8. **SandboxViewServer** - Web dashboard
9. **TerminalSandbox** - xterm.js terminal
10. **ScreenStream** - Screenshot streaming
11. **WindowManager** - Multi-window coordination

### 12.4 Documentation

**Existing Documentation (67KB):**
- `artifacts/IMPLEMENTATION_GUIDE.md` (26KB)
- `artifacts/INTEGRATION_EXAMPLES.md` (27KB)
- `artifacts/MESSAGE_PROTOCOL.md` (14KB)
- `artifacts/contracts/artifact.contracts.ts` (Complete type system)

**CLI-Specific Documentation:**
- `docs/ARTIFACTS.md` - CLI artifact guide
- Examples in `docs/EXAMPLES.md`

---

## 13. Exit Codes

```
0   - Success
1   - General error
2   - Invalid arguments
3   - Server connection failed
4   - Authentication failed (future)
5   - Model not found
6   - API rate limit exceeded
7   - Session not found
8   - Configuration error
9   - Permission denied
10  - MCP server error
11  - Artifact creation failed
130 - User interrupt (Ctrl+C)
```

---

## 14. Implementation Phases

### Phase 1: Core CLI + Permissions (Week 1-2) - IMMEDIATE

**Priority:** CRITICAL - Foundation for all other features

**Features:**
- ✅ Interactive chat mode
- ✅ Single message mode
- ✅ Basic model management (list, info)
- ✅ Basic session management (list, view, export, delete)
- ✅ Server management
- ✅ Basic configuration (5 core settings)
- 🆕 **Permissions system** (3 modes, approval prompts, audit logging)
- 🆕 **Session resume** (checkpoint restoration)
- 🆕 **Configuration expansion** (45+ settings)

**Deliverables:**
1. Fully functional CLI with HTTP client
2. Commander.js command structure
3. Chalk-based UI components
4. Permission approval prompts (inquirer)
5. Configuration management (cosmiconfig)
6. Basic test suite

**Estimated Effort:** 8-10 days

---

### Phase 2: MCP + Model Enhancements (Week 3-4) - HIGH ROI

**Priority:** HIGH - Maximum value with minimal effort (70% token savings)

**Features:**
- 🆕 **MCP management** (list, search, enable, disable, configure, init)
- 🆕 **MCP tools display** (show available tools per server)
- 🆕 **Model search/filtering** (by provider, features, cost)
- 🆕 **Model cost tracking** (per session, cumulative)
- 🆕 **Session statistics** (tokens, cost, turns, duration)
- 🆕 **Configuration categories** (permissions, MCP, model, session, UI)

**Deliverables:**
1. MCP command suite (7 commands)
2. Enhanced model commands (search, providers, cost)
3. Session stats and cost tracking
4. Configuration category support
5. MCP_CONFIG.md initialization

**Estimated Effort:** 6-8 days

---

### Phase 3: Advanced Features (Week 5-6) - ENHANCED UX

**Priority:** MEDIUM - Improves user experience significantly

**Features:**
- 🆕 **Historical context tools** (search, boundaries, segments)
- 🆕 **Mentorship controls** (enable, disable, logs, stats)
- 🆕 **Middleware visibility** (error logs, retry stats, loop control)
- 🆕 **Advanced session management** (checkpoint navigation, compaction control)
- 🆕 **Enhanced UI** (status bar, tool execution display, themes)

**Deliverables:**
1. Historical context command suite
2. Mentorship management commands
3. Middleware inspection tools
4. Enhanced terminal UI components
5. Multiple theme support

**Estimated Effort:** 8-10 days

---

### Phase 4: Artifacts (Post-Launch) - REVOLUTIONARY

**Priority:** LOW for MVP, HIGH for differentiation

**Rationale:** Artifacts are revolutionary but require significant development. Should be separate release after core CLI is stable.

**Features:**
- 🆕 **Artifact creation** (11 tools, multi-language)
- 🆕 **Visual feedback** (Playwright, screenshots, DOM inspection)
- 🆕 **Hot reload** (dev mode with automatic code refresh)
- 🆕 **Web dashboard** (artifact management UI)
- 🆕 **Tmux integration** (session isolation)

**Deliverables:**
1. Artifact command suite (8 commands)
2. Tmux manager integration
3. Web dashboard server
4. Playwright integration
5. Artifact UI components
6. Comprehensive artifact documentation

**Estimated Effort:** 14-20 days (2-3 weeks dedicated effort)

**Launch Strategy:**
- Phase 1-3: OmniClaude V4 CLI v1.0 (Core features)
- Phase 4: OmniClaude V4 CLI v1.5 or v2.0 (Artifacts update)

---

## 15. Interactive Mode UI

### 15.1 Layout

```
┌─────────────────────────────────────────────────────────────┐
│ OmniClaude V4                            [Ctrl+C to exit]   │
│ Model: gemini-2-5-flash      Session: abc-123               │
│ Messages: 12  |  Tokens: 45.2K  |  Cost: $0.03             │
│ Permission Mode: interactive  |  MCP: 2 servers enabled    │
└─────────────────────────────────────────────────────────────┘

You: How do I implement a binary search tree in Rust?

⏳ Thinking...