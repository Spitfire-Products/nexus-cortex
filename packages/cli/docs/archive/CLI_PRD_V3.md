# OmniClaude V4 CLI - Product Requirements Document (V3)

**Version:** 4.0
**Date:** 2025-12-13
**Status:** Comprehensive - Ready for Implementation
**Based on:** Complete Feature Audit + Supplement Analysis + Godel Terminal Agent Research

---

## Document Evolution

**V1.0** (Initial): Basic CLI features (~30% coverage)
**V2.0** (Expanded): Added permissions, MCP, sessions (incomplete document)
**V3.0** (Complete): 100% feature coverage across all 4 phases, fully documented
**V4.0** (AI Overwatch): Godel Terminal integration, AI-enabled workspace mode

**V4.0 Updates:**
- **NEW: Phase 5 - AI Overwatch & Terminal Workspace Mode**
- Godel Terminal-style command patterns with AI interpretation
- Natural language command extension (e.g., "AAPL EQ G 1min bollinger band")
- AI Overwatch agent for autonomous workspace management
- Visual Developer Model (Eyes=Screenshots, Hands=Clicks, Brain=Decisions)
- Financial data artifact templates (charts, metrics, analyst ratings)
- Screen streaming for continuous visual feedback
- Coordinate-based UI interaction
- Multi-window workspace management inspired by professional terminals
- Command interpreter middleware for structured query parsing

**V3.0 Updates:**
- Complete artifact system documentation (11 tools, Phase 4)
- MCP on-demand architecture (70% token savings, Phase 2)
- Historical context tools (4 tools, Phase 3)
- Mentorship/helper model controls (Phase 3)
- Tmux session management (Phase 3)
- Permissions system (3 modes, Phase 1)
- Wave 3 middleware visibility (Phase 2-3)
- 45+ configuration settings (all phases)
- 80+ CLI commands total

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Architecture](#2-architecture)
3. [Phase 1: Core CLI + Permissions](#3-phase-1-core-cli--permissions)
4. [Phase 2: MCP + Enhanced Features](#4-phase-2-mcp--enhanced-features)
5. [Phase 3: Advanced Features](#5-phase-3-advanced-features)
6. [Phase 4: Artifact System](#6-phase-4-artifact-system)
7. [Phase 5: AI Overwatch & Terminal Workspace Mode](#7-phase-5-ai-overwatch--terminal-workspace-mode)
8. [Configuration Management](#8-configuration-management)
9. [Implementation Strategy](#9-implementation-strategy)
10. [Testing & Quality Assurance](#10-testing--quality-assurance)
11. [Appendices](#11-appendices)

---

## 1. Executive Summary

### 1.1 Purpose

The OmniClaude V4 CLI is a shell-based terminal interface that serves as the first client application for the OmniClaude V4 core library. It validates the HTTP API and acts as the reference implementation for future clients.

**Strategic Goals:**
- Validate HTTP API through real-world usage
- Open source to drive developer adoption
- Reference implementation for web/mobile clients
- Marketing tool demonstrating core library capabilities
- Gateway to monetization (SaaS, enterprise licensing)

**Key Architectural Decision:** CLI communicates via HTTP with the server (not direct library imports) to validate the API that all future clients will use.

### 1.2 Feature Coverage Summary

Based on comprehensive audit of `@omniclaude/core`, `@omniclaude/executors`, and `@omniclaude/types`:

| Category | Core Features | V1 PRD | V4 PRD | Priority |
|----------|--------------|--------|--------|----------|
| **Basic Chat** | Interactive/Single message | ✅ 100% | ✅ 100% | Phase 1 |
| **Models** | 66 models, 10 providers | ⚠️ 20% | ✅ 100% | Phase 1-2 |
| **Permissions** | 3 modes, policies, audit | ❌ 0% | ✅ 100% | Phase 1 |
| **Sessions** | List/view/export/resume | ⚠️ 60% | ✅ 100% | Phase 1 |
| **MCP Management** | 7 tools + auto-discovery | ❌ 0% | ✅ 100% | Phase 2 |
| **Tools** | 34 base + 11 artifact | ⚠️ 30% | ✅ 100% | Phase 1-4 |
| **Historical Context** | 4 retrieval tools | ❌ 0% | ✅ 100% | Phase 3 |
| **Mentorship** | Helper model integration | ❌ 0% | ✅ 100% | Phase 3 |
| **Tmux** | Session management | ❌ 0% | ✅ 100% | Phase 3 |
| **Artifacts** | 11 tools, visual feedback | ❌ 0% | ✅ 100% | Phase 4 |
| **AI Overwatch** | Terminal workspace mode | ❌ 0% | ✅ 100% | Phase 5 |
| **Command Interpreter** | NL→structured parsing | ❌ 0% | ✅ 100% | Phase 5 |
| **Visual Developer** | Screen stream + coords | ❌ 0% | ✅ 100% | Phase 5 |
| **Middleware** | 7 Wave 3 systems | ❌ 0% | ✅ 90% | Phase 2-3 |
| **Configuration** | 50+ settings, 7 categories | ⚠️ 12% | ✅ 100% | Phase 1-2 |

**Overall Coverage:**
- V1 PRD: ~30% of core features
- V4 PRD: 100% of core features + AI Overwatch (phased rollout)

### 1.3 Command Count Summary

| Phase | Commands | Effort | Impact |
|-------|----------|--------|--------|
| **Phase 1** | 25 commands | 8-10 days | Foundation (Critical) |
| **Phase 2** | 15 commands | 6-8 days | High ROI (70% token savings) |
| **Phase 3** | 20 commands | 8-10 days | Enhanced UX |
| **Phase 4** | 20+ commands | 14-20 days | Visual Programming |
| **Phase 5** | 25+ commands | 14-21 days | AI Overwatch & Workspace |
| **Total** | 105+ commands | 9-12 weeks | Complete Platform + AI Workspace |

### 1.4 Success Metrics

**Phase 1 Launch Criteria:**
- All 25 core commands functional
- Permissions system operational (3 modes)
- Session resume working
- HTTP API fully validated
- 80%+ test coverage
- Documentation complete

**Phase 2 Success Metrics:**
- MCP management operational
- 70% token reduction demonstrated
- Model cost tracking accurate
- Session statistics working

**Phase 3 Success Metrics:**
- Historical context retrieval working
- Mentorship showing cost savings
- Tmux integration stable
- Advanced UI features polished

**Phase 4 Success Metrics:**
- Artifact creation working (5+ languages)
- Visual feedback operational
- Hot reload functioning
- Web dashboard accessible
- Template library available

**Phase 5 Success Metrics:**
- AI Overwatch interpreting natural language commands
- Terminal workspace mode operational with multi-window layout
- Godel Terminal-style commands working (TICKER EQ COMMAND)
- Screen streaming at 2+ FPS for visual feedback
- Coordinate-based clicking operational
- Financial data artifact templates (charts, metrics, ratings)
- Command interpreter parsing structured queries from natural language
- Visual developer loop completing autonomous tasks
- Research Beta modal handling and error recovery

---

## 2. Architecture

### 2.1 System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     CLI PACKAGE                              │
│                   (Commander.js)                             │
│                                                              │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │  Command    │  │  OmniClaude  │  │  UI Layer    │       │
│  │  Handlers   │─▶│  Client      │  │  (Chalk)     │       │
│  │             │  │  (HTTP)      │  │              │       │
│  └─────────────┘  └──────┬───────┘  └──────────────┘       │
│                          │                                  │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  AI OVERWATCH LAYER (Phase 5)                       │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐ │   │
│  │  │ Command     │  │ Visual      │  │ Workspace   │ │   │
│  │  │ Interpreter │  │ Developer   │  │ Manager     │ │   │
│  │  │ (NL→Struct) │  │ (Eyes/Hands)│  │ (Windows)   │ │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘ │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                              │
└──────────────────────────┼──────────────────────────────────┘
                           │ HTTP/SSE
┌──────────────────────────▼──────────────────────────────────┐
│               OMNICLAUDE V4 SERVER                          │
│                 (localhost:4000)                            │
│                                                              │
│  Routes:                                                    │
│  • POST /v1/messages       - Main chat (streaming/sync)    │
│  • GET  /models            - List all 66 models            │
│  • GET  /v1/approval-mode  - Get permission mode           │
│  • POST /v1/approval-mode  - Set permission mode           │
│  • POST /v1/workspace      - Workspace commands (Phase 5)  │
│  • GET  /v1/screen-stream  - Visual feedback stream        │
│                                                              │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│                  @OMNICLAUDE/CORE                           │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  OmniClaudeOrchestrator                             │   │
│  │  • Multi-provider routing (66 models, 10 providers) │   │
│  │  • Tool execution (34 base + 11 artifact tools)     │   │
│  │  • Session management (JSONL, checkpoints)          │   │
│  │  • 7 Wave 3 Middleware systems                      │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │  Adapter     │  │  Model       │  │  MCP Client  │     │
│  │  Registry    │  │  Registry    │  │  Manager     │     │
│  │  (Formats)   │  │  (66 models) │  │  (Servers)   │     │
│  └──────────────┘  └──────────────┘  └──────────────┘     │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Wave 3 Middleware Layer                             │  │
│  │  • ErrorClassification  • Retry   • Permissions      │  │
│  │  • SystemMessage        • Mentorship • LoopControl   │  │
│  │  • HelperModel          • CommandInterpreter (P5)    │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Visual Developer Layer (Phase 5)                    │  │
│  │  • ScreenStreamService  • CoordinateClickHandler     │  │
│  │  • WorkspaceController  • ArtifactWindowManager      │  │
│  │  • GodelCommandParser   • FinancialDataProvider      │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### 2.2 Technology Stack

| Component | Technology | Version | Rationale |
|-----------|-----------|---------|-----------|
| **CLI Framework** | Commander.js | 11.x | Industry standard, TypeScript support |
| **HTTP Client** | node-fetch | 3.x | Streaming support, widely used |
| **Terminal UI** | chalk | 5.x | Lightweight (40KB), fast |
| **Spinners** | cli-spinners | 3.x | Standard loading indicators |
| **Prompts** | inquirer | 9.x | Interactive prompts, mature |
| **Markdown** | marked-terminal | 7.x | Terminal-optimized rendering |
| **Syntax** | highlight.js | 11.x | Wide language support |
| **Config** | cosmiconfig | 9.x | Standard config discovery |
| **Testing** | Vitest | 1.x | Fast, TypeScript-first |
| **Runtime** | Node.js | 20+ | LTS support |

### 2.3 Package Structure

```
packages/cli/
├── src/
│   ├── index.ts                    # Entry point
│   ├── cli.ts                      # Commander.js setup
│   │
│   ├── commands/                   # All command implementations
│   │   ├── chat.ts                 # Interactive chat
│   │   ├── message.ts              # Single message
│   │   │
│   │   ├── models/                 # Model management
│   │   │   ├── list.ts
│   │   │   ├── info.ts
│   │   │   ├── search.ts
│   │   │   ├── providers.ts
│   │   │   └── cost.ts
│   │   │
│   │   ├── session/                # Session management
│   │   │   ├── list.ts
│   │   │   ├── view.ts
│   │   │   ├── export.ts
│   │   │   ├── delete.ts
│   │   │   ├── resume.ts
│   │   │   ├── stats.ts
│   │   │   └── checkpoints.ts
│   │   │
│   │   ├── permissions/            # Permissions (Phase 1)
│   │   │   ├── status.ts
│   │   │   ├── mode.ts
│   │   │   ├── logs.ts
│   │   │   ├── policies.ts
│   │   │   └── actions.ts
│   │   │
│   │   ├── mcp/                    # MCP Management (Phase 2)
│   │   │   ├── list.ts
│   │   │   ├── search.ts
│   │   │   ├── status.ts
│   │   │   ├── enable.ts
│   │   │   ├── disable.ts
│   │   │   ├── configure.ts
│   │   │   ├── init.ts
│   │   │   └── edit.ts
│   │   │
│   │   ├── history/                # Historical Context (Phase 3)
│   │   │   ├── search.ts
│   │   │   ├── segment.ts
│   │   │   ├── checkpoints.ts
│   │   │   └── context.ts
│   │   │
│   │   ├── mentorship/             # Helper Model (Phase 3)
│   │   │   ├── status.ts
│   │   │   ├── enable.ts
│   │   │   ├── disable.ts
│   │   │   └── stats.ts
│   │   │
│   │   ├── tmux/                   # Tmux Sessions (Phase 3)
│   │   │   ├── create.ts
│   │   │   ├── send.ts
│   │   │   ├── capture.ts
│   │   │   ├── snapshot.ts
│   │   │   ├── list.ts
│   │   │   └── kill.ts
│   │   │
│   │   ├── artifact/               # Artifact System (Phase 4)
│   │   │   ├── create.ts
│   │   │   ├── list.ts
│   │   │   ├── inspect.ts
│   │   │   ├── interact.ts
│   │   │   ├── modify.ts
│   │   │   ├── stop.ts
│   │   │   ├── restart.ts
│   │   │   ├── view.ts
│   │   │   ├── dashboard.ts
│   │   │   └── templates.ts
│   │   │
│   │   ├── workspace/              # Workspace Mode (Phase 5)
│   │   │   ├── start.ts            # Start workspace mode
│   │   │   ├── window.ts           # Window management
│   │   │   ├── layout.ts           # Layout presets
│   │   │   ├── command.ts          # Command interpreter
│   │   │   ├── stream.ts           # Screen streaming
│   │   │   └── overwatch.ts        # AI Overwatch control
│   │   │
│   │   ├── godel/                  # Godel Terminal Commands (Phase 5)
│   │   │   ├── equity.ts           # TICKER EQ commands
│   │   │   ├── chart.ts            # Chart generation (G)
│   │   │   ├── fundamentals.ts     # Fundamentals (FA, DES)
│   │   │   ├── analysts.ts         # Analyst ratings (ANR)
│   │   │   ├── estimates.ts        # Estimates (EST)
│   │   │   ├── insiders.ts         # Insider trading (INSD)
│   │   │   └── research.ts         # Research reports (RES)
│   │   │
│   │   ├── server.ts               # Server control
│   │   ├── config.ts               # Configuration
│   │   └── init.ts                 # First-run wizard
│   │
│   ├── client/                     # HTTP client layer
│   │   ├── OmniClaudeClient.ts     # Main API wrapper
│   │   ├── SSEParser.ts            # Server-Sent Events
│   │   ├── types.ts                # TypeScript types
│   │   └── errors.ts               # Error classes
│   │
│   ├── ui/                         # Terminal UI
│   │   ├── Prompt.ts               # User input
│   │   ├── MessageRenderer.ts      # AI response display
│   │   ├── ToolDisplay.ts          # Tool execution viz
│   │   ├── StatusBar.ts            # Session status
│   │   ├── Spinner.ts              # Loading indicators
│   │   ├── themes.ts               # Color schemes
│   │   │
│   │   ├── permissions/            # Permission UI
│   │   │   ├── ApprovalPrompt.ts
│   │   │   └── PolicyViewer.ts
│   │   │
│   │   └── artifacts/              # Artifact UI (Phase 4)
│   │       ├── SandboxViewer.ts
│   │       └── InteractionPrompt.ts
│   │
│   ├── utils/                      # Utilities
│   │   ├── config-manager.ts
│   │   ├── server-manager.ts
│   │   ├── logger.ts
│   │   ├── validation.ts
│   │   └── format.ts
│   │
│   └── types/                      # Shared types
│       └── index.ts
│
├── bin/
│   └── omniclaude.js               # Binary entry point
│
├── test/
│   ├── unit/                       # Unit tests
│   ├── integration/                # Integration tests
│   └── e2e/                        # End-to-end tests
│
├── docs/
│   ├── COMMANDS.md                 # Command reference
│   ├── EXAMPLES.md                 # Usage examples
│   ├── PERMISSIONS.md              # Permissions guide
│   ├── MCP_GUIDE.md                # MCP integration
│   ├── ARTIFACTS.md                # Artifact system
│   └── CONFIGURATION.md            # Config reference
│
├── artifacts/                      # Artifact docs (67KB existing)
│   ├── IMPLEMENTATION_GUIDE.md     # 26KB
│   ├── INTEGRATION_EXAMPLES.md     # 27KB
│   ├── MESSAGE_PROTOCOL.md         # 14KB
│   └── contracts/
│       └── artifact.contracts.ts
│
├── package.json
├── tsconfig.json
└── README.md
```

### 2.4 Global Options

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

### 2.5 Exit Codes

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
12  - Tmux session error
130 - User interrupt (Ctrl+C)
```

---

## 3. Phase 1: Core CLI + Permissions

**Timeline:** Weeks 1-2 (8-10 days)
**Priority:** CRITICAL - Foundation for all features
**Commands:** 25 total

### 3.1 Interactive Chat Mode

**Primary Command:**
```bash
omniclaude chat [options]
omniclaude                        # Shorthand (default)
```

**Options:**
```bash
-m, --model <id>                  # Model to use
-r, --resume <id>                 # Resume from checkpoint
--system <message>                # Custom system message
--max-tokens <number>             # Maximum tokens (default: 4096)
--temperature <number>            # Temperature 0-2 (default: 1.0)
--no-stream                       # Disable streaming
--permission-mode <mode>          # interactive/auto/strict
```

**Examples:**
```bash
# Start default chat
omniclaude

# Specific model
omniclaude chat -m claude-sonnet-4-5

# Resume session
omniclaude chat --resume checkpoint-abc-123

# Auto-approve mode (YOLO)
omniclaude chat --permission-mode auto

# Custom system message
omniclaude chat --system "You are a Rust expert"
```

**UI Layout:**
```
┌─────────────────────────────────────────────────────────────┐
│ OmniClaude V4                            [Ctrl+C to exit]   │
│ Model: gemini-2-5-flash      Session: abc-123               │
│ Messages: 12  |  Tokens: 45.2K  |  Cost: $0.03             │
│ Permission: interactive  |  MCP: 2 servers  |  Mentorship: ✓│
└─────────────────────────────────────────────────────────────┘

You: How do I implement a binary search tree in Rust?

⏳ Thinking...

Claude: Here's a binary search tree implementation in Rust...

[Code block with syntax highlighting]

🔧 Used Tools:
  • grep_code (search_rust_patterns.rs)
  • read_file (examples/data_structures/tree.rs)

You: ▌
```

### 3.2 Single Message Mode

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
--json                            # Output JSON
--raw                             # Raw text only
```

**Examples:**
```bash
# Quick question
omniclaude "How do I reverse a string in Python?"

# With model
omniclaude message "Explain recursion" -m gpt-4o

# JSON output
omniclaude "Summarize this code" --json < file.py

# Pipe input
cat README.md | omniclaude "Summarize this"
```

### 3.3 Model Management

**Commands:**
```bash
omniclaude models list [options]        # List all models
omniclaude models info <model-id>       # Model details
omniclaude models search <query>        # Search models
omniclaude models providers             # List providers
omniclaude models cost [session-id]     # Cost breakdown
```

**Options for `list`:**
```bash
--provider <name>                 # Filter: xai, anthropic, google, etc.
--format <format>                 # Filter: messages, chat-completions, etc.
--min-context <tokens>            # Minimum context window
--max-context <tokens>            # Maximum context window
--supports-tools                  # Only tool-capable models
--supports-vision                 # Only vision-capable models
--sort-by <field>                 # Sort: cost, context, name, provider
```

**Examples:**
```bash
# List all models
omniclaude models list

# XAI models only
omniclaude models list --provider xai

# Tool-capable models
omniclaude models list --supports-tools --sort-by cost

# Model details
omniclaude models info grok-code-fast-1

# Search
omniclaude models search "grok"

# Cost analysis
omniclaude models cost session-abc-123
```

**Output Example:**
```
📋 Available Models (66 total)

XAI (6 models):
  ✓ grok-4                  200K ctx    $2.00/M    tools ✓  vision ✓
  ✓ grok-4-fast             200K ctx    $0.50/M    tools ✓  vision ✓
  ✓ grok-code-fast-1        128K ctx    $0.25/M    tools ✓  vision ✗

Anthropic (7 models):
  ✓ claude-sonnet-4-5       200K ctx    $3.00/M    tools ✓  vision ✓
  ✓ claude-opus-4-1         200K ctx    $15.00/M   tools ✓  vision ✓
  ✓ claude-3-5-haiku        200K ctx    $0.80/M    tools ✓  vision ✓

Google (8 models):
  ✓ gemini-2-5-pro          2M ctx      $1.25/M    tools ✓  vision ✓
  ✓ gemini-2-5-flash        1M ctx      $0.075/M   tools ✓  vision ✓

... (51 more models)

Token Usage Summary:
  Total context available: 10.2M tokens
  Most cost-effective: gemini-2-5-flash ($0.075/M)
  Best for long context: gemini-2-5-pro (2M ctx)
```

### 3.4 Session Management

**Commands:**
```bash
omniclaude session list [options]       # List sessions
omniclaude session view <id>            # View details
omniclaude session export <id>          # Export to JSON
omniclaude session delete <id>          # Delete session
omniclaude session resume <id>          # Resume from checkpoint
omniclaude session stats [id]           # Statistics
omniclaude session checkpoints <id>     # List checkpoints
```

**Options for `list`:**
```bash
--model <id>                      # Filter by model
--limit <number>                  # Limit results (default: 20)
--sort-by <field>                 # Sort: date, messages, tokens, cost
--format <format>                 # Output: table, list, json
```

**Examples:**
```bash
# List all sessions
omniclaude session list

# Recent sessions
omniclaude session list --limit 10 --sort-by date

# View session
omniclaude session view session-abc-123

# Export
omniclaude session export session-abc-123 > backup.json

# Resume
omniclaude session resume session-abc-123

# Stats
omniclaude session stats session-abc-123

# Checkpoints
omniclaude session checkpoints session-abc-123
```

**Output Example:**
```
📊 Session: session-abc-123

Created: 2025-01-14 10:30:45
Model: gemini-2-5-flash
Status: active

Messages: 24 (12 user, 12 assistant)
Turns: 12
Duration: 1h 23m

Tokens:
  Input: 42,150
  Output: 38,920
  Cache Read: 125,000 (70% savings)
  Total: 206,070

Cost:
  Input: $0.0032
  Output: $0.0029
  Total: $0.0061

Checkpoints: 3
  • checkpoint-1: Turn 5 (512 tokens)
  • checkpoint-2: Turn 10 (1,024 tokens)
  • checkpoint-3: Turn 15 (2,048 tokens)

Tools Used: 18 calls
  • read_file: 8
  • write_file: 4
  • grep: 3
  • bash: 3

MCP Servers: 2 active
  • filesystem (5 tools)
  • git (7 tools)
```

### 3.5 Permissions Management

**Overview:**

OmniClaude V4 has a comprehensive 3-mode permissions system:

1. **Interactive Mode** (default): Prompt for sensitive operations
2. **Auto Mode** (YOLO): Auto-approve all operations
3. **Strict Mode**: Block writes, allow reads only

**Architecture:**
- 3-tier policy system: Whitelist → Graylist → Blacklist
- Auto-approve actions: Specific patterns bypass prompts
- Audit logging: All decisions logged to file

**Commands:**
```bash
omniclaude permissions status           # Show current mode
omniclaude permissions mode <mode>      # Set: interactive/auto/strict
omniclaude permissions logs [options]   # View approval logs
omniclaude permissions policies         # List active policies
omniclaude permissions actions          # Manage auto-approve
```

**Options for `logs`:**
```bash
--session <id>                    # Filter by session
--action <name>                   # Filter by action type
--approved                        # Show only approved
--denied                          # Show only denied
--limit <number>                  # Limit results
--format <format>                 # Output: table, json
```

**Examples:**
```bash
# Check mode
omniclaude permissions status

# Enable auto-approve (YOLO)
omniclaude permissions mode auto

# Enable strict (read-only)
omniclaude permissions mode strict

# Back to interactive
omniclaude permissions mode interactive

# View logs
omniclaude permissions logs

# Denied operations
omniclaude permissions logs --denied --limit 20

# Export logs
omniclaude permissions logs --json > audit.json
```

**Auto-Approve Actions:**
```bash
# List actions
omniclaude permissions actions list

# Add pattern
omniclaude permissions actions add "bash:npm install*"
omniclaude permissions actions add "read_file:**"
omniclaude permissions actions add "write_file:src/**/*.ts"

# Remove pattern
omniclaude permissions actions remove "bash:npm install*"

# Clear all
omniclaude permissions actions clear
```

**Approval Prompt UI:**
```
┌─────────────────────────────────────────────────────────────┐
│ 🔒 Permission Required                                       │
├─────────────────────────────────────────────────────────────┤
│ Tool: bash                                                   │
│ Action: rm -rf dist/                                         │
│ Risk: HIGH - Destructive file operation                     │
│                                                              │
│ Working Directory: /home/user/project                       │
│ Files Affected: ~150 files in dist/                         │
│                                                              │
│ Policy: Graylist (requires approval)                        │
│ Audit: This action will be logged                           │
├─────────────────────────────────────────────────────────────┤
│ [A] Approve once                                            │
│ [Y] Approve and remember pattern (bash:rm -rf dist/*)      │
│ [D] Deny                                                     │
│ [Q] Quit session                                             │
│                                                              │
│ Choice: ▌                                                    │
└─────────────────────────────────────────────────────────────┘
```

**Output Example:**
```
🔒 Permissions Status

Mode: interactive
Default Policy: deny
Audit Logging: enabled
Audit Log: ~/.omniclaude/audit.log

Active Policies:
  1. Whitelist (5 patterns)
     • read_file:**
     • list_files:**
     • grep:**
     • search_conversation_history:**
     • list_compaction_boundaries:**

  2. Graylist (requires approval)
     • write_file:**
     • bash:npm *
     • bash:git *

  3. Blacklist (blocked)
     • bash:rm -rf /
     • bash:sudo rm *
     • write_file:/etc/**
     • write_file:/root/**

Auto-Approve Actions: 3 patterns
  • bash:npm install
  • bash:npm test
  • write_file:src/**/*.test.ts

Recent Activity (last 24h):
  Approved: 45
  Denied: 3
  Auto-approved: 12
```

### 3.6 Server Management

**Commands:**
```bash
omniclaude server start [options]       # Start server
omniclaude server stop                  # Stop server
omniclaude server status                # Check status
omniclaude server logs                  # View logs
```

**Options for `start`:**
```bash
--port <number>                   # Port (default: 4000)
--daemon                          # Background mode
--log-file <path>                 # Log location
```

**Examples:**
```bash
# Start server
omniclaude server start

# Custom port
omniclaude server start --port 5000

# Daemon mode
omniclaude server start --daemon

# Status
omniclaude server status

# Logs
omniclaude server logs
```

### 3.7 Configuration Management (Basic)

**Commands:**
```bash
omniclaude config get <key>             # Get value
omniclaude config set <key> <value>     # Set value
omniclaude config list [category]       # List config
omniclaude config reset [key]           # Reset to default
omniclaude init                         # First-run wizard
```

**Phase 1 Settings:**
```yaml
# Core Settings (5)
defaultModel: string              # Default model ID
serverUrl: string                 # Server URL
temperature: number               # Default temperature
maxTokens: number                 # Default max tokens
theme: string                     # Color theme

# Permissions (3 basic)
permissions.mode: string          # interactive/auto/strict
permissions.auditLogging: boolean # Enable logging
permissions.logDirectory: string  # Log directory
```

**Examples:**
```bash
# Set default model
omniclaude config set defaultModel gemini-2-5-flash

# Get value
omniclaude config get defaultModel

# List all
omniclaude config list

# Reset
omniclaude config reset temperature

# First-run wizard
omniclaude init
```

---

## 4. Phase 2: MCP + Enhanced Features

**Timeline:** Weeks 3-4 (6-8 days)
**Priority:** HIGH - 70% token savings, minimal effort
**Commands:** 15 total

### 4.1 MCP On-Demand Architecture

**Overview:**

The MCP On-Demand system provides **70% token reduction** through progressive tool discovery. Instead of loading all MCP tools upfront, models start minimal and dynamically enable servers as needed.

**Key Benefits:**
- Start with 32 base tools vs 127 tools (traditional approach)
- Progressive expansion (add only what's needed)
- Model autonomy (AI discovers capabilities)
- Task-specific tooling (right tools for each job)

**Two-Tier System:**

**Tier 1: Auto-Injection**
- `MCP_CONFIG.md` file stores enabled servers
- On session start, auto-connect to enabled servers
- Tools automatically injected into model's context

**Tier 2: Management Tools (7 tools)**
- `list_available_mcp_servers` - Browse registry
- `search_mcp_servers` - Keyword search
- `get_mcp_config` - View current config
- `enable_mcp_server` - Enable server (writes MCP_CONFIG.md)
- `disable_mcp_server` - Disable server
- `configure_mcp_server` - Modify settings
- `init_mcp_config` - Project-aware initialization

**Token Efficiency Example:**

Static approach (all servers):
- 127 tools loaded
- ~25,000 tokens per request
- 4 tools actually used
- 96% waste

OmniClaude V4 approach:
- 32 base tools + on-demand loading
- ~7,400 tokens per request
- 70% reduction

### 4.2 MCP Commands

**Commands:**
```bash
omniclaude mcp list [options]           # List servers
omniclaude mcp search <query>           # Search registry
omniclaude mcp status [options]         # Show status
omniclaude mcp enable <server> [opts]   # Enable server
omniclaude mcp disable <server>         # Disable server
omniclaude mcp configure <server> [opts]# Configure server
omniclaude mcp init [options]           # Initialize config
omniclaude mcp edit                     # Edit MCP_CONFIG.md
omniclaude mcp validate                 # Validate config
```

**Options for `list`:**
```bash
--category <category>             # Filter: filesystem, database, etc.
--verified-only                   # Show only verified (default)
--all                             # Show all servers
```

**Options for `status`:**
```bash
--scope <scope>                   # project, global, merged (default)
--verbose                         # Detailed connection info
```

**Options for `enable`:**
```bash
--env <KEY=VALUE>                 # Environment variables (repeatable)
--args <arg1,arg2>                # Command arguments
--no-auto-start                   # Don't auto-start
--timeout <ms>                    # Connection timeout
```

**Options for `init`:**
```bash
--dry-run                         # Preview without creating
--include-optional                # Include optional servers
--scope <scope>                   # auto, global, <path>
--servers <list>                  # Manual server list
```

**Examples:**
```bash
# List all servers
omniclaude mcp list

# Database servers
omniclaude mcp list --category database

# Search
omniclaude mcp search "filesystem"

# Enable postgres
omniclaude mcp enable postgres \
  --env DATABASE_URL="postgresql://localhost:5432/mydb"

# Enable filesystem
omniclaude mcp enable filesystem --args /home/user/project

# Check status
omniclaude mcp status --verbose

# Initialize for project
omniclaude mcp init

# Dry run to preview
omniclaude mcp init --dry-run --include-optional

# Edit config
omniclaude mcp edit

# Validate
omniclaude mcp validate
```

**Output Examples:**

**List:**
```
📦 Available MCP Servers (Official Registry)

Filesystem (verified):
  @modelcontextprotocol/server-filesystem
  Description: File system operations (read, write, list, search)
  Capabilities: read_file, write_file, list_directory, search_files
  Requires: Directory path argument

Git (verified):
  @modelcontextprotocol/server-git
  Description: Git version control operations
  Capabilities: status, diff, log, commit, push, pull
  Requires: Git repository path

PostgreSQL (verified):
  @modelcontextprotocol/server-postgres
  Description: PostgreSQL database operations
  Capabilities: query, schema, migrations, backup
  Requires: DATABASE_URL environment variable

Puppeteer (verified):
  @modelcontextprotocol/server-puppeteer
  Description: Browser automation and web scraping
  Capabilities: navigate, screenshot, pdf, interact
  Requires: None (auto-installs Chromium)

... (25 more servers)

Use 'omniclaude mcp enable <server-name>' to enable a server
Use 'omniclaude mcp search <query>' to search servers
```

**Status:**
```
📦 MCP Server Status

Enabled Servers (3):
  ✅ filesystem (5 tools) - Connected
     Path: /home/user/project
     Uptime: 2h 15m
     Calls: 45

  ✅ git (7 tools) - Connected
     Repository: /home/user/project
     Uptime: 2h 15m
     Calls: 12

  ✅ postgres (12 tools) - Connected
     Database: mydb
     Uptime: 1h 30m
     Calls: 8

Available Servers (22):
  ⏸️  puppeteer - Browser automation
  ⏸️  sqlite - SQLite database
  ⏸️  python - Python code execution
  ... (19 more)

Token Efficiency:
  Current: 7,400 tokens/request
  If all enabled: 25,000 tokens/request
  Savings: 70%

Configuration:
  Config file: ./MCP_CONFIG.md
  Scope: project
  Auto-start: enabled
```

**Init (Dry Run):**
```
🔍 Analyzing project...

Detected:
  • Node.js project (package.json found)
  • TypeScript (tsconfig.json found)
  • Git repository (.git found)
  • Database files (.sql files found)

Recommended Servers:

Essential:
  ✓ filesystem - File operations (REQUIRED)
  ✓ git - Version control (RECOMMENDED)

Recommended:
  • postgres - Database operations (detected .sql files)
  • typescript - TypeScript language support

Optional:
  • puppeteer - Browser testing (package.json has "playwright")
  • sqlite - Local database (alternative to postgres)

Run without --dry-run to create MCP_CONFIG.md
```

### 4.3 Enhanced Model Commands

**New Commands:**
```bash
omniclaude models search <query>        # Search models
omniclaude models providers             # List providers
omniclaude models cost [session-id]     # Cost analysis
```

**Examples:**
```bash
# Search models
omniclaude models search "grok" --supports-tools

# Provider details
omniclaude models providers

# Cost analysis
omniclaude models cost session-abc-123
omniclaude models cost --all --last-30-days
```

**Provider Output:**
```
🏢 Model Providers (10 total)

XAI:
  Models: 6 (grok-4, grok-4-fast, grok-3, grok-3-mini, etc.)
  Features: tools ✓, vision ✓, streaming ✓, server-side tools ✓
  Cost Range: $0.25 - $2.00 per million tokens
  Context: Up to 200K tokens
  Status: ✅ Active (6/6 models available)

Anthropic:
  Models: 7 (claude-sonnet-4-5, claude-opus-4-1, etc.)
  Features: tools ✓, vision ✓, streaming ✓, computer use ✓
  Cost Range: $0.80 - $15.00 per million tokens
  Context: Up to 200K tokens
  Status: ✅ Active (7/7 models available)

Google:
  Models: 8 (gemini-2-5-pro, gemini-2-5-flash, etc.)
  Features: tools ✓, vision ✓, streaming ✓, long context ✓✓
  Cost Range: $0.075 - $3.00 per million tokens
  Context: Up to 2M tokens
  Status: ✅ Active (8/8 models available)

... (7 more providers)

Total: 66 models across 10 providers
```

### 4.4 Enhanced Session Commands

**New Commands:**
```bash
omniclaude session stats [id]           # Statistics
omniclaude session checkpoints <id>     # List checkpoints
```

**Stats Output:**
```
📊 Session Statistics

Session: session-abc-123
Duration: 3h 42m 18s
Created: 2025-01-14 10:30:45
Last Activity: 2025-01-14 14:13:03

Conversation:
  Messages: 48 (24 user, 24 assistant)
  Turns: 24
  Avg Turn Time: 9.3s
  Tool Calls: 67
  Errors: 2 (both retried successfully)

Tokens:
  Input: 125,430
  Output: 98,120
  Cache Read: 425,000 (77% cache hit)
  Cache Write: 125,430
  Total: 773,980

Cost Breakdown:
  Input: $0.0094
  Output: $0.0074
  Cache Write: $0.0031
  Total: $0.0199
  Saved via Cache: $0.0275 (58% savings)
  Saved via Helper: $0.0142 (42% savings)

Models Used:
  Primary: gemini-2-5-flash (20 turns)
  Helper: gpt-4o-mini (4 turns for simple tasks)

Tools:
  read_file: 18 calls
  write_file: 12 calls
  bash: 15 calls
  grep: 10 calls
  MCP filesystem: 8 calls
  MCP git: 4 calls

MCP Servers:
  filesystem: 8 tool calls, $0.0003
  git: 4 tool calls, $0.0001

Checkpoints: 3 saved
  Last: checkpoint-3 at turn 20 (2,048 tokens)
```

### 4.5 Enhanced Configuration

**New Categories:**
```yaml
# MCP Settings (7 new)
mcp.enabled: boolean
mcp.configFile: string
mcp.autoDiscovery: boolean
mcp.progressiveLoading: boolean
mcp.marketplaceUrl: string
mcp.cacheToolsLocal: boolean
mcp.maxServers: number

# Model Settings (expanded)
model.preferredProvider: string
model.fallbackModel: string
model.costTracking: boolean
model.streamingEnabled: boolean
model.retryAttempts: number
model.retryDelay: number
model.timeout: number
model.cacheEnabled: boolean

# Session Settings (expanded)
session.autoSave: boolean
session.checkpointFrequency: number
session.maxSessions: number
session.retentionDays: number
session.compactionEnabled: boolean
```

---

## 5. Phase 3: Advanced Features

**Timeline:** Weeks 5-6 (8-10 days)
**Priority:** MEDIUM - Enhanced UX
**Commands:** 20 total

### 5.1 Historical Context Tools

**Overview:**

Access conversation history across compaction boundaries for long-running sessions.

**The 4 Tools:**
1. **SearchConversationHistory** - Keyword/semantic search
2. **GetConversationSegment** - Retrieve specific segment
3. **ListCompactionBoundaries** - List checkpoints
4. **RequestHistoricalContext** - AI-assisted context retrieval

**Commands:**
```bash
omniclaude history search <query> [options]     # Search history
omniclaude history segment <range>              # Get segment
omniclaude history checkpoints                  # List boundaries
omniclaude history context <description>        # Request context
```

**Options for `search`:**
```bash
--max-results <n>                 # Maximum results (default: 10)
--time-range <range>              # Time range (e.g., "last 7 days")
--include-compacted               # Include compacted segments
```

**Options for `segment`:**
```bash
--format <format>                 # full, summary, compressed
```

**Examples:**
```bash
# Search history
omniclaude history search "database migration" --max-results 5

# Time-based search
omniclaude history search "error" --time-range "last 24 hours"

# Get segment
omniclaude history segment 10-20
omniclaude history segment checkpoint-abc-123

# List checkpoints
omniclaude history checkpoints

# Request context
omniclaude history context "implementing authentication system"
```

**Output Examples:**

**Search:**
```
🔍 Search Results: "database migration" (5 matches)

1. Turn 45 (2h ago) - User message
   "Let's create a database migration for user authentication"
   Relevance: 95%

2. Turn 52 (1h 30m ago) - Assistant message
   "Here's the migration script for the users table..."
   Relevance: 92%

3. Turn 67 (45m ago) - Tool use
   Tool: write_file
   File: migrations/001_create_users.sql
   Relevance: 88%

4. Turn 103 (10m ago) - User message
   "The migration failed with constraint error"
   Relevance: 85%

5. Turn 105 (8m ago) - Assistant message
   "Let's fix the foreign key constraint..."
   Relevance: 82%

Use 'omniclaude history segment <turn-range>' to view full context
```

**Checkpoints:**
```
📊 Compaction Boundaries

Session: session-abc-123
Total Turns: 124
Compactions: 4

Checkpoint 1: checkpoint-001
  Turns: 1-25
  Created: 2025-01-14 11:00:00
  Status: compacted
  Summary: Initial project setup and authentication planning

Checkpoint 2: checkpoint-002
  Turns: 26-50
  Created: 2025-01-14 12:15:00
  Status: compacted
  Summary: Database schema design and migration implementation

Checkpoint 3: checkpoint-003
  Turns: 51-75
  Created: 2025-01-14 13:30:00
  Status: compacted
  Summary: API endpoint creation and middleware setup

Checkpoint 4: checkpoint-004
  Turns: 76-100
  Created: 2025-01-14 14:45:00
  Status: compacted
  Summary: Testing, debugging, and deployment preparation

Current Window: Turns 101-124 (in-memory, not compacted)

Use 'omniclaude history segment checkpoint-<id>' to retrieve
```

### 5.2 Mentorship/Helper Model

**Overview:**

Helper model integration reduces costs by using smaller models for simple tasks.

**Strategy:**
- Primary model for complex reasoning
- Helper model for simple operations (grep, list, etc.)
- Automatic selection based on task complexity
- Typical savings: 40-60% on multi-turn sessions

**Commands:**
```bash
omniclaude mentorship status                    # Get status
omniclaude mentorship enable [model]            # Enable helper
omniclaude mentorship disable                   # Disable helper
omniclaude mentorship logs                      # View usage logs
omniclaude mentorship stats [session]           # Cost savings
```

**Examples:**
```bash
# Status
omniclaude mentorship status

# Enable (auto-select helper)
omniclaude mentorship enable

# Enable with specific helper
omniclaude mentorship enable claude-3-5-haiku

# View logs
omniclaude mentorship logs --last 50

# Cost savings
omniclaude mentorship stats session-abc-123
```

**Output:**
```
🎓 Mentorship Status

Enabled: ✅ Yes
Primary Model: gemini-2-5-flash ($0.075/M input, $0.30/M output)
Helper Model: gpt-4o-mini ($0.15/M input, $0.60/M output)
Fallback Threshold: 0.3 (tasks with complexity < 0.3 use helper)

Session Statistics (current):
  Total Turns: 24
  Primary Model: 20 turns (83%)
  Helper Model: 4 turns (17%)

Tasks Delegated to Helper:
  • File listing (list_files)
  • Code search (grep)
  • Simple file reads
  • Configuration queries

Cost Analysis (current session):
  Without Helper: $0.0245
  With Helper: $0.0103
  Savings: $0.0142 (58% reduction)

Cumulative (last 30 days):
  Sessions: 45
  Total Cost Without Helper: $1.85
  Total Cost With Helper: $0.92
  Total Savings: $0.93 (50% reduction)
```

### 5.3 Tmux Session Management

**Overview:**

Manage persistent terminal sessions with visual snapshots.

**Commands:**
```bash
omniclaude tmux create [options]                # Create session
omniclaude tmux send <id> <command>             # Send command
omniclaude tmux capture <id> [options]          # Capture output
omniclaude tmux snapshot <id> [options]         # Visual snapshot
omniclaude tmux list                            # List sessions
omniclaude tmux kill <id>                       # Kill session
```

**Options for `create`:**
```bash
--cwd <directory>                 # Working directory
--env <KEY=VALUE>                 # Environment variables
```

**Options for `capture`:**
```bash
--history                         # Include scrollback
```

**Options for `snapshot`:**
```bash
--screenshot                      # Include visual screenshot
```

**Examples:**
```bash
# Create session
omniclaude tmux create --cwd /home/user/project

# Send command
omniclaude tmux send tmux-abc-123 "npm test"

# Capture output
omniclaude tmux capture tmux-abc-123 --history

# Visual snapshot (base64 PNG)
omniclaude tmux snapshot tmux-abc-123 --screenshot

# List sessions
omniclaude tmux list

# Kill session
omniclaude tmux kill tmux-abc-123
```

**Output:**
```
📺 Tmux Sessions (3 active)

tmux-abc-123:
  Created: 1h 30m ago
  CWD: /home/user/project
  Command: npm run dev
  Status: running
  Uptime: 1h 29m 45s

tmux-def-456:
  Created: 45m ago
  CWD: /home/user/api
  Command: node server.js
  Status: running
  Uptime: 44m 12s

tmux-ghi-789:
  Created: 15m ago
  CWD: /home/user/scripts
  Command: python data_processor.py
  Status: running
  Uptime: 14m 33s
```

### 5.4 Enhanced UI Features

**New Components:**
- Multi-line status bar with detailed metrics
- Tool execution visualization with timing
- Permission approval prompts with context
- Progress bars for long operations
- Syntax highlighting for code blocks
- Table formatting for data display

**Theme Support:**
```bash
omniclaude config set theme dark
omniclaude config set theme light
omniclaude config set theme solarized
omniclaude config set theme dracula
```

---

## 6. Phase 4: Artifact System

**Timeline:** Post-launch (14-20 days dedicated)
**Priority:** HIGH for differentiation, LOW for MVP
**Commands:** 20+ total

### 6.1 Overview

The Dynamic Artifact System is OmniClaude V4's most powerful feature for **visual programming** and **interactive UI creation**.

**Capabilities:**
- Multi-language support (JavaScript, Python, Rust, Go, Shell, HTML)
- 3 execution modes: oneshot, dev (hot reload), persistent
- Visual feedback via Playwright integration
- Package managers: npm, pip, uv, nix
- UI frameworks: Express, FastAPI, Flask, Next.js
- Real-time screenshot streaming
- DOM inspection and interaction

**The 11 Artifact Tools:**
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

### 6.2 Artifact Commands

**Commands:**
```bash
omniclaude artifact create <name> [options]     # Create artifact
omniclaude artifact list [options]              # List artifacts
omniclaude artifact inspect <id> [options]      # Inspect state
omniclaude artifact interact <id> <action>      # UI interaction
omniclaude artifact modify <id> [options]       # Modify code
omniclaude artifact stop <id>                   # Stop artifact
omniclaude artifact restart <id>                # Restart artifact
omniclaude artifact view <id>                   # Open in browser
omniclaude artifact dashboard                   # Multi-artifact dashboard
omniclaude artifact templates [options]         # List templates
omniclaude artifact create-from-template <name> # From template
```

**Options for `create`:**
```bash
--type <type>                     # dashboard, web, terminal, script
--mode <mode>                     # oneshot, dev, persistent
--language <lang>                 # javascript, python, rust, go, shell, html
--code <path>                     # Path to code file
--deps <packages>                 # Dependencies (comma-separated)
--pkg-manager <pm>                # npm, pip, uv, nix
--visual-feedback                 # Enable visual feedback
--hot-reload                      # Enable hot reload
--open-browser                    # Auto-open browser
--port <port>                     # Port number
--env <KEY=VALUE>                 # Environment variables
```

**Options for `list`:**
```bash
--filter <filter>                 # active, stopped, all
--verbose                         # Detailed info
```

**Options for `inspect`:**
```bash
--screenshot                      # Capture screenshot
--dom                             # Capture DOM structure
--console                         # Show console logs
--metrics                         # Show performance metrics
--network                         # Show network requests
```

**Examples:**

**Create System Monitor:**
```bash
omniclaude artifact create system-monitor \
  --type=web \
  --language=javascript \
  --mode=dev \
  --visual-feedback \
  --hot-reload \
  --open-browser \
  --deps="express,systeminformation" \
  --port=3000
```

**Create Data Visualization:**
```bash
omniclaude artifact create chart-viewer \
  --type=web \
  --language=python \
  --framework=fastapi \
  --visual-feedback \
  --deps="fastapi,matplotlib,pandas"
```

**List Artifacts:**
```bash
omniclaude artifact list
omniclaude artifact list --filter=active --verbose
```

**Inspect Artifact:**
```bash
omniclaude artifact inspect artifact-abc-123 \
  --screenshot \
  --dom \
  --console \
  --metrics
```

**Interact with UI:**
```bash
omniclaude artifact interact artifact-abc-123 click "#submit-button"
omniclaude artifact interact artifact-abc-123 type "#search" "hello world"
omniclaude artifact interact artifact-abc-123 navigate "/dashboard"
```

**Modify Artifact:**
```bash
omniclaude artifact modify artifact-abc-123 --edit
omniclaude artifact modify artifact-abc-123 --code updated-app.js
```

**View/Dashboard:**
```bash
omniclaude artifact view artifact-abc-123
omniclaude artifact dashboard
```

**Templates:**
```bash
omniclaude artifact templates
omniclaude artifact templates --category=web
omniclaude artifact create-from-template express-api my-api
```

### 6.3 Artifact Output Examples

**Create:**
```
🎨 Creating Artifact: system-monitor

Configuration:
  Name: system-monitor
  Type: web (Express.js)
  Language: JavaScript
  Mode: dev (hot reload enabled)
  Visual Feedback: ✅ enabled
  Dependencies: express, systeminformation

🔧 Setting up environment...
  ✓ Created tmux session: omniclaude-artifact-abc123
  ✓ Installed dependencies (12 packages)
  ✓ Generated boilerplate code
  ✓ Started Express server

🌐 Server running:
  URL: http://localhost:3000
  PID: 12345
  Memory: 45MB
  CPU: 2%

📸 Visual feedback active:
  Playwright: ✓ connected
  Screenshots: ✓ available
  DOM inspection: ✓ available

✅ Artifact created successfully!
  ID: artifact-abc-123
  Tmux: omniclaude-artifact-abc123
  Status: running
  Browser: opening...

Next steps:
  • View in browser: omniclaude artifact view artifact-abc-123
  • Inspect state: omniclaude artifact inspect artifact-abc-123
  • Modify code: omniclaude artifact modify artifact-abc-123 --edit
```

**List:**
```
📦 Active Artifacts (3)

artifact-abc-123 - system-monitor (web, dev mode)
  Status: ✅ running
  URL: http://localhost:3000
  Language: JavaScript (Express.js)
  Uptime: 2h 15m 33s
  Memory: 48MB
  Hot Reload: ✅ active
  Visual Feedback: ✅ active

artifact-def-456 - proxy-server (terminal, persistent)
  Status: ✅ running
  Tmux: omniclaude-artifact-def456
  Language: JavaScript (Node.js)
  Uptime: 5h 42m 18s
  Memory: 112MB
  Visual Feedback: ✗ disabled

artifact-ghi-789 - data-viz (web, dev mode)
  Status: ✅ running
  URL: http://localhost:8000
  Language: Python (FastAPI)
  Uptime: 45m 22s
  Memory: 85MB
  Hot Reload: ✅ active
  Visual Feedback: ✅ active

Total: 3 active, 0 stopped
Memory: 245MB total
```

**Inspect:**
```
📸 Artifact Inspection: system-monitor (artifact-abc-123)

Status: ✅ Running
URL: http://localhost:3000
PID: 12345
Uptime: 2h 15m 33s

Screenshot: saved to /tmp/artifact-abc-123-screenshot.png
  Size: 1920x1080
  Format: PNG
  Base64: available

DOM Structure: saved to /tmp/artifact-abc-123-dom.html
  Elements: 247
  Interactive: 18 buttons, 5 forms
  Scripts: 3 loaded
  Styles: 2 stylesheets

Console Logs (last 20):
  [15:30:45] [INFO] Server started on port 3000
  [15:30:45] [INFO] Metrics endpoint: /api/metrics
  [15:30:50] [INFO] Dashboard accessed from 127.0.0.1
  [15:31:00] [INFO] Metrics updated: CPU 2%, Memory 48MB
  [15:31:10] [INFO] Metrics updated: CPU 1%, Memory 48MB

Performance Metrics:
  Page Load: 234ms
  First Paint: 145ms
  DOM Ready: 198ms
  Memory Usage: 48MB
  CPU Usage: 2%

Network Requests (last 10):
  GET /api/metrics - 200 OK (12ms)
  GET /api/metrics - 200 OK (8ms)
  GET /static/app.js - 200 OK (3ms)
  GET /static/styles.css - 200 OK (2ms)
```

**Dashboard:**
```
🌐 Opening Artifact Dashboard...

URL: http://localhost:8080
Dashboard started

Features:
  • Real-time artifact status
  • Live screenshot streaming
  • Console log viewing
  • Performance metrics
  • Interactive controls (stop, restart, modify)

Browser opened to: http://localhost:8080
```

### 6.4 Artifact Architecture

**Message Protocol:**

Bidirectional communication via TCP sockets:

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

**Message Types:**
- Lifecycle: CREATE, MOUNT, READY, DESTROY
- Data: DATA_UPDATE, DATA_REQUEST, DATA_RESPONSE
- State: STATE_CHANGE
- Interaction: USER_INPUT, COMMAND, ACTION
- Control: FOCUS, BLUR, RESIZE, REFRESH
- System: HEARTBEAT, ERROR, METRICS

**Infrastructure:**
- **ArtifactRegistry** - Track all artifacts
- **SandboxRegistry** - Lifecycle management
- **TmuxManager** - Session management
- **SessionPersistence** - Persist across restarts
- **SessionLock** - Multi-process sync

### 6.5 Artifact Templates

**Built-in Templates:**

```bash
omniclaude artifact templates

📋 Available Templates (15 total)

Web Applications:
  express-api          Express.js REST API with authentication
  fastapi-app          FastAPI Python web application
  nextjs-dashboard     Next.js dashboard with real-time data
  flask-web            Flask web application

Dashboards:
  system-monitor       Real-time system metrics dashboard
  log-viewer           Log file viewer with filtering
  data-viz             Data visualization with charts

Tools:
  proxy-server         HTTP/HTTPS proxy with logging
  file-watcher         File system watcher with actions
  task-runner          Task automation and scheduling

Utilities:
  terminal-ui          Terminal UI with xterm.js
  code-formatter       Code formatting service
  test-runner          Test execution and reporting

Data Processing:
  csv-processor        CSV data processing pipeline
  api-client           API client with rate limiting
```

### 6.6 Artifact Use Cases

**1. Real-Time System Dashboard**
```bash
omniclaude artifact create-from-template system-monitor my-monitor \
  --port=3000 \
  --hot-reload
```

**2. API Proxy Server**
```bash
omniclaude artifact create proxy \
  --type=web \
  --language=javascript \
  --code proxy-server.js \
  --mode=persistent
```

**3. Data Visualization**
```bash
omniclaude artifact create viz \
  --type=web \
  --language=python \
  --framework=fastapi \
  --deps="matplotlib,pandas" \
  --visual-feedback
```

**4. File Watcher**
```bash
omniclaude artifact create watcher \
  --type=terminal \
  --language=shell \
  --mode=persistent
```

---

## 7. Phase 5: AI Overwatch & Terminal Workspace Mode

**Timeline:** Post-Phase 4 (14-21 days dedicated)
**Priority:** HIGH for differentiation
**Commands:** 25+ total
**Based on:** Godel Terminal Agent Research + AI Developer Workspace Architecture

### 7.1 Overview

The AI Overwatch & Terminal Workspace Mode transforms OmniClaude from a CLI into a **visual developer workspace** inspired by professional trading terminals like Godel Terminal.

**Core Vision:** The AI works like a **human developer** with:
- **Eyes** → Screenshots/screen streaming for visual feedback
- **Hands** → Coordinate-based clicks, keyboard typing
- **Brain** → Decides what artifacts to create, interprets natural language

**Key Innovation:** Instead of static terminal commands, users can issue natural language commands that the AI interprets and executes:

```
Traditional (Godel Terminal):
  NVDA EQ G                    → Opens pre-defined chart

OmniClaude AI Overwatch:
  NVDA EQ G 1min bollinger band → AI generates custom chart with indicator
  compare NVDA AAPL revenue 5yr → AI creates comparative visualization
  show me analyst sentiment     → AI dynamically creates ratings artifact
```

### 7.2 Command Interpreter Middleware

**Overview:**

The Command Interpreter parses natural language into structured artifact specifications.

**Architecture:**
```typescript
interface GodelCommand {
  ticker: string;           // "NVDA", "AAPL"
  assetClass: string;       // "EQ" (equity), "FX", "CRYPTO"
  baseCommand: string;      // "G" (chart), "FA", "DES", "ANR", etc.
  modifiers?: {
    timeframe?: string;     // "1min", "1D", "1W"
    indicators?: string[];  // ["bollinger_band", "rsi", "macd"]
    compareWith?: string[]; // ["AAPL", "MSFT"]
    dateRange?: string;     // "last 5 years"
  };
  naturalLanguageExtension?: string; // Additional context
}
```

**Command Flow:**
```
User Input: "NVDA EQ G 1min bollinger band with 20 period"
              ↓
Command Interpreter Middleware
              ↓
Structured GodelCommand:
{
  ticker: "NVDA",
  assetClass: "EQ",
  baseCommand: "G",
  modifiers: {
    timeframe: "1min",
    indicators: [{
      name: "bollinger_band",
      period: 20
    }]
  }
}
              ↓
AI Overwatch generates artifact specification
              ↓
CreateArtifactTool executes
              ↓
Visual feedback confirms creation
```

### 7.3 Godel Terminal Command Reference

**Supported Commands (from Agent Research):**

| Command | Description | AI Extension |
|---------|-------------|--------------|
| **G** | Price chart | Timeframe, indicators, overlays |
| **DES** | Company description | Enhanced with AI summary |
| **FA** | Fundamental analysis | Custom metrics, comparisons |
| **ANR** | Analyst ratings | Sentiment analysis, trends |
| **EST** | Estimates (EPS/Revenue) | Surprise analysis, forecasts |
| **INSD** | Insider trading | Pattern detection, alerts |
| **RES** | Research reports | AI-powered summaries |
| **SI** | Short interest | Historical trends |
| **TOP** | Top movers | Custom filters |

**CLI Commands:**
```bash
omniclaude godel <command> [options]

# Chart commands
omniclaude godel "NVDA EQ G"                      # Basic chart
omniclaude godel "NVDA EQ G 1min bollinger"       # With indicator
omniclaude godel "NVDA EQ G 1D macd rsi compare AAPL" # Multiple features

# Fundamentals
omniclaude godel "NVDA EQ FA"                     # Basic fundamentals
omniclaude godel "NVDA EQ FA vs AAPL 5yr"         # Comparison

# Analyst ratings
omniclaude godel "NVDA EQ ANR"                    # Ratings overview
omniclaude godel "NVDA EQ ANR sentiment trend"   # AI sentiment analysis

# Research
omniclaude godel "NVDA EQ RES latest"             # Latest reports
omniclaude godel "NVDA EQ RES summarize"          # AI-powered summaries
```

### 7.4 Visual Developer Model

**The Complete Vision:**

```
┌───────────────────────────────────────────────────────────────┐
│                    USER'S EXPERIENCE                          │
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  OmniClaude Workspace (Headed Browser/Terminal)         │ │
│  │  ┌────────────┬────────────┬────────────┐              │ │
│  │  │ Chart      │ Metrics    │ News       │              │ │
│  │  │ (NVDA)     │ (FA Data)  │ (Headlines)│              │ │
│  │  │            │            │            │              │ │
│  │  │ [Artifact] │ [Artifact] │ [Artifact] │              │ │
│  │  └────────────┴────────────┴────────────┘              │ │
│  │                                                         │ │
│  │  ┌─────────────────────────────────────────────────┐   │ │
│  │  │ CLI: NVDA EQ G 1min bollinger band              │   │ │
│  │  └─────────────────────────────────────────────────┘   │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                               │
│  User sees AI creating artifacts in real-time!               │
└───────────────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────────────┐
│                    AI OVERWATCH'S EXPERIENCE                  │
│                                                               │
│  1. Get screenshot → See current workspace state             │
│  2. Parse command → "NVDA EQ G 1min bollinger band"         │
│  3. Analyze intent → Chart with Bollinger Bands indicator   │
│  4. Generate artifact spec → CreateArtifactTool input       │
│  5. Execute → Create chart artifact in workspace            │
│  6. Verify via screenshot → Confirm chart rendered          │
│  7. Position window → Arrange in workspace layout           │
│                                                               │
│  AI Overwatch works autonomously with visual confirmation!   │
└───────────────────────────────────────────────────────────────┘
```

### 7.5 Workspace Commands

**Commands:**
```bash
omniclaude workspace start [options]              # Enter workspace mode
omniclaude workspace window create <type>         # Create window
omniclaude workspace window arrange <layout>      # Arrange windows
omniclaude workspace window focus <id>            # Focus window
omniclaude workspace window close <id>            # Close window
omniclaude workspace layout list                  # List layouts
omniclaude workspace layout save <name>           # Save current layout
omniclaude workspace layout load <name>           # Load saved layout
omniclaude workspace stream start                 # Start screen streaming
omniclaude workspace stream stop                  # Stop streaming
omniclaude workspace overwatch enable             # Enable AI Overwatch
omniclaude workspace overwatch disable            # Disable AI Overwatch
omniclaude workspace overwatch status             # Overwatch status
```

**Options for `start`:**
```bash
--layout <name>                   # Initial layout preset
--theme <theme>                   # Visual theme (tokyo-night, dracula, etc.)
--headed                          # Show browser window (vs headless)
--fps <number>                    # Screen stream FPS (default: 2)
--overwatch                       # Enable AI Overwatch on start
```

**Examples:**
```bash
# Start workspace with financial layout
omniclaude workspace start --layout=financial --headed --overwatch

# Create a chart window
omniclaude workspace window create chart --ticker=NVDA --timeframe=1D

# Arrange windows in grid
omniclaude workspace window arrange grid-3x2

# Save current layout
omniclaude workspace layout save "my-trading-setup"

# Enable AI Overwatch
omniclaude workspace overwatch enable

# Stream screen at 2 FPS
omniclaude workspace stream start --fps=2
```

### 7.6 Screen Streaming & Visual Feedback

**Overview:**

Continuous visual feedback allows the AI to "see" the workspace and verify its actions.

**Architecture:**
```typescript
// Screen streaming configuration
const screenStream = await workspace.startScreenStream({
  fps: 2,                    // 2 frames per second
  region: "full",            // or specific window
  format: "png",             // png or jpeg
  quality: 80                // compression quality
});

screenStream.on('frame', (screenshot) => {
  // AI Overwatch analyzes each frame
  // Decides next action based on visual state
});
```

**Coordinate-Based Interaction:**
```typescript
// Click at visual coordinates
await workspace.click({ x: 450, y: 230 });

// Type in focused area
await workspace.type("NVDA EQ G 1min\n");

// Keyboard shortcuts
await workspace.keyPress("Ctrl+S");

// Scroll and zoom
await workspace.scroll({ deltaY: -100 });
await workspace.zoom(1.5);

// Drag windows
await workspace.drag({ from: [100, 100], to: [300, 200] });
```

**Visual Recognition (Optional):**
```typescript
// AI analyzes screenshot to find UI elements
const screenshot = await workspace.getScreenshot();

const analysis = await visionModel.analyze(screenshot, {
  task: "Find the 'Submit' button",
  returnCoordinates: true
});

// Get button coordinates
const buttonCoords = analysis.coordinates; // { x: 450, y: 230 }

// Click it
await workspace.click(buttonCoords);
```

### 7.7 Financial Data Artifact Templates

**New Templates for Phase 5:**

```bash
omniclaude artifact templates --category=financial

📋 Financial Artifact Templates (12 total)

Charts:
  stock-chart            Interactive stock chart with TradingView
  candlestick            Candlestick chart with volume
  multi-ticker           Compare multiple tickers
  indicator-panel        Technical indicators panel

Data Displays:
  fundamentals-card      Company fundamentals card
  earnings-table         Quarterly earnings comparison
  analyst-ratings        Analyst ratings visualization
  insider-trades         Insider trading activity

Dashboards:
  ticker-dashboard       Complete ticker overview
  watchlist              Multi-ticker watchlist
  portfolio-tracker      Portfolio performance tracker
  market-overview        Market indices and movers
```

**Template Usage:**
```bash
# Create stock chart artifact
omniclaude artifact create-from-template stock-chart nvda-chart \
  --ticker=NVDA \
  --timeframe=1D \
  --indicators=bollinger,macd,rsi

# Create fundamentals card
omniclaude artifact create-from-template fundamentals-card nvda-fa \
  --ticker=NVDA \
  --metrics=pe,pb,revenue_growth

# Create watchlist
omniclaude artifact create-from-template watchlist my-watchlist \
  --tickers=NVDA,AAPL,MSFT,GOOGL,META
```

### 7.8 Output Examples

**Workspace Start:**
```
🖥️  Starting OmniClaude Workspace

Configuration:
  Mode: Headed (browser visible)
  Layout: financial
  Theme: tokyo-night
  AI Overwatch: ✅ enabled
  Screen Stream: 2 FPS

🌐 Workspace running:
  URL: http://localhost:8080
  Artifacts: 0 active
  Windows: 4 (terminal, chart, metrics, news)

📸 Visual feedback active:
  Playwright: ✓ connected
  Screenshots: ✓ streaming at 2 FPS
  Coordinate clicks: ✓ enabled

✅ Workspace started successfully!

AI Overwatch listening for commands...
Type Godel-style commands (e.g., "NVDA EQ G 1min bollinger")

> ▌
```

**Godel Command Execution:**
```
> NVDA EQ G 1min bollinger band

🔍 Parsing command...
  Ticker: NVDA
  Asset Class: EQ (Equity)
  Command: G (Chart)
  Modifiers:
    • Timeframe: 1 minute
    • Indicators: Bollinger Bands (20, 2)

🎨 AI Overwatch generating artifact...
  Template: stock-chart
  Configuration:
    - Symbol: NVDA
    - Interval: 1m
    - Indicators: BB(20,2)

📦 Creating artifact: nvda-chart-001
  ✓ Fetched historical data (1,440 candles)
  ✓ Calculated Bollinger Bands
  ✓ Rendered chart
  ✓ Positioned in workspace grid (row 1, col 1)

📸 Visual verification:
  Screenshot captured
  Chart visible: ✓
  Bollinger Bands rendered: ✓

✅ Artifact created: nvda-chart-001
   Window: 600x400 at (50, 100)
   Status: running

> ▌
```

**Overwatch Status:**
```
🤖 AI Overwatch Status

State: ✅ Active
Mode: autonomous
Visual Feedback: streaming at 2 FPS

Current Session:
  Commands Processed: 15
  Artifacts Created: 8
  Errors: 0
  Avg Response Time: 1.2s

Active Artifacts:
  1. nvda-chart-001 (chart) - 600x400
  2. nvda-fa-002 (fundamentals) - 400x300
  3. aapl-chart-003 (chart) - 600x400
  4. watchlist-004 (watchlist) - 300x600

Visual Developer Loop:
  Screenshots: 1,245 captured
  Clicks: 23 executed
  Keystrokes: 156 typed
  Verification Success: 98.5%

Workspace Layout:
  ┌────────────┬────────────┐
  │ nvda-chart │ aapl-chart │
  ├────────────┼────────────┤
  │ nvda-fa    │ watchlist  │
  └────────────┴────────────┘

Memory: 245MB
CPU: 8%
Uptime: 1h 23m 45s
```

### 7.9 Research Beta Modal Handling

**From Godel Agent Research:**

The agent learned to handle unexpected UI states like Research Beta modal overlays:

```typescript
// Detect and dismiss Research Beta modal
async function handleResearchBetaModal(workspace: Workspace): Promise<void> {
  const screenshot = await workspace.getScreenshot();

  // Check if modal is present
  if (await detectResearchModal(screenshot)) {
    // Press Escape to attempt dismiss
    await workspace.keyPress("Escape");
    await sleep(500);

    // If still present, click outside
    const newScreenshot = await workspace.getScreenshot();
    if (await detectResearchModal(newScreenshot)) {
      await workspace.click({ x: 50, y: 50 }); // Click outside modal
    }
  }
}
```

**Terminal Shortcut Detection:**
```typescript
// Auto-detect terminal shortcut based on UI
async function focusTerminal(workspace: Workspace): Promise<void> {
  const pageText = await workspace.getPageText();

  if (pageText.includes('press / to open')) {
    await workspace.type('/');      // User's custom setting
  } else if (pageText.includes('type a command')) {
    await workspace.type('`');      // Default backtick
  }
}
```

### 7.10 Phase 5 Architecture Components

**New Components:**

```typescript
// Command Interpreter
class GodelCommandInterpreter {
  parse(input: string): GodelCommand;
  validate(command: GodelCommand): ValidationResult;
  toArtifactSpec(command: GodelCommand): ArtifactSpec;
}

// Visual Developer
class VisualDeveloper {
  eyes: ScreenStreamService;
  hands: CoordinateInteractionService;
  brain: AIOverwatchAgent;

  async see(): Promise<Screenshot>;
  async click(coords: Coordinates): Promise<void>;
  async type(text: string): Promise<void>;
  async decide(goal: string): Promise<Action>;
}

// Workspace Controller
class WorkspaceController {
  windows: Map<string, ArtifactWindow>;
  layout: LayoutManager;
  stream: ScreenStream;

  async createWindow(config: WindowConfig): Promise<Window>;
  async arrangeWindows(layout: LayoutPreset): Promise<void>;
  async focusWindow(id: string): Promise<void>;
}

// AI Overwatch Agent
class AIOverwatchAgent {
  interpreter: GodelCommandInterpreter;
  developer: VisualDeveloper;
  workspace: WorkspaceController;

  async processCommand(input: string): Promise<void>;
  async verifyAction(expected: ActionResult): Promise<boolean>;
  async recover(error: OverwatchError): Promise<void>;
}
```

**New Tools (6 tools):**

1. **StartWorkspaceTool** - Initialize workspace mode
2. **CreateWindowTool** - Create workspace windows
3. **ArrangeLayoutTool** - Manage window layouts
4. **ParseGodelCommandTool** - Parse terminal commands
5. **ScreenStreamTool** - Manage visual feedback
6. **CoordinateInteractTool** - Coordinate-based UI interaction

---

## 8. Configuration Management

### 8.1 Configuration Categories

**All 50+ Settings Across 7 Categories:**

#### Core Settings (5)
```yaml
defaultModel: string              # Default model ID
serverUrl: string                 # Server URL (default: http://localhost:4000)
temperature: number               # Default temperature 0-2 (default: 1.0)
maxTokens: number                 # Default max tokens (default: 4096)
theme: string                     # Color theme: default/dark/light/custom
```

#### Model Settings (8)
```yaml
model.preferredProvider: string   # Preferred provider
model.fallbackModel: string       # Fallback on failure
model.costTracking: boolean       # Enable cost tracking
model.streamingEnabled: boolean   # Enable streaming
model.retryAttempts: number       # Retry attempts (default: 3)
model.retryDelay: number          # Retry delay ms (default: 1000)
model.timeout: number             # Request timeout ms (default: 120000)
model.cacheEnabled: boolean       # Response caching
```

#### Permissions Settings (12)
```yaml
permissions.mode: string          # interactive/auto/strict
permissions.defaultPolicy: string # allow/deny
permissions.auditLogging: boolean # Enable logging
permissions.logDirectory: string  # Log directory
permissions.promptTimeout: number # Approval timeout ms
permissions.showToolInput: boolean # Show tool input
permissions.autoApproveRead: boolean # Auto-approve reads
permissions.autoApproveWrite: boolean # Auto-approve writes
permissions.autoApproveBash: boolean # Auto-approve bash
permissions.blockedPaths: string[] # Blocked paths
permissions.allowedPaths: string[] # Allowed paths
permissions.dangerousCommands: string[] # Blocked commands
```

#### MCP Settings (7)
```yaml
mcp.enabled: boolean              # Enable MCP
mcp.configFile: string            # MCP_CONFIG.md location
mcp.autoDiscovery: boolean        # Auto-discover tools
mcp.progressiveLoading: boolean   # Progressive loading
mcp.marketplaceUrl: string        # Registry URL
mcp.cacheToolsLocal: boolean      # Cache tools
mcp.maxServers: number            # Max concurrent servers
```

#### Session Settings (6)
```yaml
session.storageDir: string        # Storage directory
session.autoSave: boolean         # Auto-save sessions
session.checkpointFrequency: number # Checkpoint every N turns
session.maxSessions: number       # Max stored sessions
session.retentionDays: number     # Retention in days
session.compactionEnabled: boolean # Enable compaction
```

#### UI/Display Settings (7)
```yaml
ui.colorEnabled: boolean          # Enable colors
ui.spinnerStyle: string           # Spinner style
ui.markdownEnabled: boolean       # Render markdown
ui.syntaxHighlight: boolean       # Syntax highlighting
ui.showTimestamps: boolean        # Show timestamps
ui.showTokenCounts: boolean       # Show token usage
ui.maxMessageWidth: number        # Max width in chars
```

#### Workspace Settings (10) - Phase 5
```yaml
workspace.enabled: boolean        # Enable workspace mode
workspace.defaultLayout: string   # Default layout preset (financial, dev, etc.)
workspace.theme: string           # Visual theme (tokyo-night, dracula, etc.)
workspace.headed: boolean         # Show browser window (vs headless)
workspace.screenStreamFps: number # Screen stream FPS (default: 2)
workspace.overwatchEnabled: boolean # Enable AI Overwatch by default
workspace.overwatchModel: string  # Model for AI Overwatch decisions
workspace.coordinateClickEnabled: boolean # Enable coordinate-based clicking
workspace.maxArtifacts: number    # Max concurrent artifacts
workspace.autoVerify: boolean     # Auto-verify artifact creation via screenshot
```

#### Godel Command Settings (5) - Phase 5
```yaml
godel.enabled: boolean            # Enable Godel Terminal commands
godel.defaultAssetClass: string   # Default asset class (EQ, FX, CRYPTO)
godel.defaultTimeframe: string    # Default chart timeframe (1D, 1H, etc.)
godel.dataProvider: string        # Financial data provider API
godel.chartLibrary: string        # Chart library (tradingview, chartjs, d3)
```

### 8.2 Configuration Commands

```bash
omniclaude config get <key>             # Get value
omniclaude config set <key> <value>     # Set value
omniclaude config list [category]       # List config
omniclaude config reset [key]           # Reset to default
omniclaude config export                # Export to JSON
omniclaude config import <file>         # Import from JSON
omniclaude init                         # First-run wizard
```

**Examples:**
```bash
# Set default model
omniclaude config set defaultModel gemini-2-5-flash

# Get value
omniclaude config get defaultModel

# List all
omniclaude config list

# List category
omniclaude config list permissions

# Reset
omniclaude config reset temperature

# Export
omniclaude config export > my-config.json

# Import
omniclaude config import my-config.json

# Wizard
omniclaude init
```

### 8.3 Configuration File

**Location:** `~/.omniclaude/config.json`

**Example:**
```json
{
  "defaultModel": "gemini-2-5-flash",
  "serverUrl": "http://localhost:4000",
  "temperature": 1.0,
  "maxTokens": 4096,
  "theme": "dark",

  "model": {
    "preferredProvider": "google",
    "fallbackModel": "gpt-4o-mini",
    "costTracking": true,
    "streamingEnabled": true,
    "retryAttempts": 3,
    "retryDelay": 1000,
    "timeout": 120000,
    "cacheEnabled": false
  },

  "permissions": {
    "mode": "interactive",
    "defaultPolicy": "deny",
    "auditLogging": true,
    "logDirectory": "~/.omniclaude/logs",
    "promptTimeout": 60000,
    "showToolInput": true,
    "autoApproveRead": false,
    "autoApproveWrite": false,
    "autoApproveBash": false,
    "blockedPaths": ["/etc", "/root", "/sys"],
    "allowedPaths": ["~/project"],
    "dangerousCommands": ["rm -rf /", "sudo rm"]
  },

  "mcp": {
    "enabled": true,
    "configFile": "./MCP_CONFIG.md",
    "autoDiscovery": true,
    "progressiveLoading": true,
    "marketplaceUrl": "https://registry.mcp.io",
    "cacheToolsLocal": true,
    "maxServers": 10
  },

  "session": {
    "storageDir": "~/.omniclaude/sessions",
    "autoSave": true,
    "checkpointFrequency": 10,
    "maxSessions": 100,
    "retentionDays": 30,
    "compactionEnabled": true
  },

  "ui": {
    "colorEnabled": true,
    "spinnerStyle": "dots",
    "markdownEnabled": true,
    "syntaxHighlight": true,
    "showTimestamps": false,
    "showTokenCounts": true,
    "maxMessageWidth": 80
  }
}
```

---

## 9. Implementation Strategy

### 9.1 Phase Timeline

```
Phase 1: Core CLI + Permissions
├─ Week 1: Commands & HTTP Client
│  ├─ chat, message commands
│  ├─ OmniClaudeClient (HTTP wrapper)
│  ├─ SSEParser (streaming)
│  └─ Basic UI components
│
├─ Week 2: Permissions & Polish
│  ├─ Permissions middleware integration
│  ├─ Approval prompts (inquirer)
│  ├─ Audit logging
│  ├─ Session resume
│  └─ Configuration management
│
└─ Deliverable: Functional CLI (25 commands)

Phase 2: MCP + Enhanced Features
├─ Week 3: MCP Integration
│  ├─ MCP command handlers
│  ├─ MCP_CONFIG.md operations
│  ├─ Server registry integration
│  └─ Token usage calculator
│
├─ Week 4: Model & Session Enhancements
│  ├─ Enhanced model commands
│  ├─ Cost tracking
│  ├─ Session statistics
│  └─ Configuration categories
│
└─ Deliverable: MCP-enabled CLI (40 commands)

Phase 3: Advanced Features
├─ Week 5: Historical & Mentorship
│  ├─ Historical context commands
│  ├─ Mentorship controls
│  ├─ Tmux integration
│  └─ Enhanced UI
│
├─ Week 6: Polish & Testing
│  ├─ Theme support
│  ├─ Middleware visibility
│  ├─ Comprehensive testing
│  └─ Documentation
│
└─ Deliverable: Feature-complete CLI (60 commands)

Phase 4: Artifacts (Post-Launch)
├─ Weeks 7-8: Core Artifact System
│  ├─ CreateArtifactTool integration
│  ├─ Tmux coordination
│  ├─ Playwright setup
│  └─ Basic commands (create, list, stop)
│
├─ Week 9: Visual Feedback
│  ├─ InspectSandboxTool integration
│  ├─ Screenshot capture
│  ├─ DOM inspection
│  └─ Console logging
│
├─ Week 10: Interaction & Modification
│  ├─ InteractWithSandboxTool
│  ├─ ModifySandboxTool
│  ├─ Hot reload
│  └─ Code editing
│
└─ Week 11: Templates & Dashboard
   ├─ Template library
   ├─ Web dashboard (SandboxViewServer)
   ├─ Multi-artifact coordination
   └─ Comprehensive docs

Phase 5: AI Overwatch & Terminal Workspace (Post-Artifacts)
├─ Weeks 12-13: Workspace Foundation
│  ├─ WorkspaceController implementation
│  ├─ Window management system
│  ├─ Layout presets (financial, dev, etc.)
│  ├─ Screen streaming service
│  └─ Coordinate-based interaction
│
├─ Week 14: Command Interpreter
│  ├─ GodelCommandInterpreter middleware
│  ├─ Natural language → structured parsing
│  ├─ Godel Terminal command vocabulary
│  └─ AI-extended modifiers (indicators, comparisons)
│
├─ Week 15: AI Overwatch Agent
│  ├─ VisualDeveloper class (eyes/hands/brain)
│  ├─ AIOverwatchAgent orchestration
│  ├─ Visual verification loop
│  ├─ Error recovery (Research Beta modal handling)
│  └─ Terminal shortcut detection
│
└─ Weeks 16-17: Financial Templates & Polish
   ├─ Financial artifact templates (12 templates)
   ├─ TradingView/D3 chart integration
   ├─ Data provider connections
   ├─ Comprehensive testing
   └─ Documentation

Total: 17 weeks (6 weeks MVP + 5 weeks artifacts + 6 weeks AI Overwatch)
```

### 9.2 Development Approach

**Agile Sprints:**
- 2-week sprints
- Weekly demos to stakeholders
- Continuous integration
- Daily standups

**Technical Practices:**
- Test-Driven Development (TDD)
- Code reviews (all PRs)
- Pair programming for complex features
- Documentation-first approach

**Quality Gates:**
- 80%+ test coverage
- 0 critical bugs
- All smoke tests passing
- Documentation complete
- Performance benchmarks met

### 9.3 Resource Requirements

**Team:**
- 1 Senior Engineer (lead)
- 1 Mid-level Engineer (implementation)
- 1 QA Engineer (testing)
- 1 Technical Writer (docs)

**Infrastructure:**
- Development environment (Node.js 20+)
- CI/CD pipeline (GitHub Actions)
- Testing infrastructure (Vitest)
- Documentation hosting (GitHub Pages)

**Dependencies:**
- @omniclaude/core (v4.0.0)
- @omniclaude/executors (v4.0.0)
- @omniclaude/types (v4.0.0)
- Commander.js, Inquirer, Chalk, etc.

---

## 10. Testing & Quality Assurance

### 10.1 Testing Strategy

**Unit Tests (80%+ coverage):**
- All command handlers
- HTTP client (OmniClaudeClient)
- SSE parser
- UI components
- Utilities

**Integration Tests:**
- Command → HTTP → Server flows
- Permissions enforcement
- MCP integration
- Session management
- Configuration loading

**End-to-End Tests:**
- Complete user workflows
- Multi-turn conversations
- Permission approval flows
- MCP server enablement
- Artifact creation (Phase 4)

**Smoke Tests:**
- Quick validation of core features
- Run on every commit
- 5-minute execution time

### 10.2 Test Examples

**Unit Test:**
```typescript
describe('MCP Commands', () => {
  test('list servers by category', async () => {
    const result = await listMcpServers({ category: 'database' });
    expect(result).toContain('postgres');
    expect(result).toContain('sqlite');
    expect(result).not.toContain('filesystem');
  });

  test('enable server with env vars', async () => {
    const result = await enableMcpServer('postgres', {
      env: { DATABASE_URL: 'postgresql://localhost:5432/test' }
    });
    expect(result.success).toBe(true);
    expect(result.toolCount).toBe(12);
  });
});
```

**Integration Test:**
```typescript
test('MCP workflow: list → enable → status', async () => {
  // List servers
  const servers = await listMcpServers();
  expect(servers.length).toBeGreaterThan(0);

  // Enable postgres
  await enableMcpServer('postgres', {
    env: { DATABASE_URL: 'postgresql://localhost:5432/test' }
  });

  // Verify status
  const status = await getMcpStatus();
  expect(status.enabledServers).toContain('postgres');
  expect(status.toolCount).toBeGreaterThan(0);
});
```

**E2E Test:**
```bash
#!/bin/bash
# test/e2e/mcp-flow.sh

# Start server
omniclaude server start --daemon

# List MCP servers
omniclaude mcp list --category=database

# Enable postgres
omniclaude mcp enable postgres \
  --env DATABASE_URL="postgresql://localhost:5432/test"

# Verify config created
test -f ./MCP_CONFIG.md

# Check status
omniclaude mcp status | grep "postgres"

# Cleanup
omniclaude mcp disable postgres
omniclaude server stop
```

### 10.3 Quality Metrics

**Code Quality:**
- ESLint: 0 errors, 0 warnings
- Prettier: 100% formatted
- TypeScript: Strict mode, 0 errors
- Complexity: Max cyclomatic complexity 10

**Test Coverage:**
- Unit: 85%+
- Integration: 70%+
- E2E: 50%+
- Overall: 80%+

**Performance:**
- Command startup: < 500ms
- HTTP request: < 100ms (local server)
- Streaming latency: < 50ms
- Memory usage: < 150MB

---

## 11. Appendices

### 11.1 Complete Command Reference

**Phase 1 Commands (25):**
```
omniclaude [chat]                       # Interactive chat
omniclaude message <prompt>             # Single message
omniclaude models list                  # List models
omniclaude models info <id>             # Model details
omniclaude models search <query>        # Search models
omniclaude models providers             # List providers
omniclaude models cost [session]        # Cost analysis
omniclaude session list                 # List sessions
omniclaude session view <id>            # View session
omniclaude session export <id>          # Export session
omniclaude session delete <id>          # Delete session
omniclaude session resume <id>          # Resume session
omniclaude session stats [id]           # Statistics
omniclaude session checkpoints <id>     # Checkpoints
omniclaude permissions status           # Permission status
omniclaude permissions mode <mode>      # Set mode
omniclaude permissions logs             # Approval logs
omniclaude permissions policies         # List policies
omniclaude permissions actions          # Manage actions
omniclaude server start                 # Start server
omniclaude server stop                  # Stop server
omniclaude server status                # Server status
omniclaude server logs                  # Server logs
omniclaude config <operation>           # Configuration
omniclaude init                         # Setup wizard
```

**Phase 2 Commands (15):**
```
omniclaude mcp list                     # List MCP servers
omniclaude mcp search <query>           # Search servers
omniclaude mcp status                   # MCP status
omniclaude mcp enable <server>          # Enable server
omniclaude mcp disable <server>         # Disable server
omniclaude mcp configure <server>       # Configure server
omniclaude mcp init                     # Initialize config
omniclaude mcp edit                     # Edit config
omniclaude mcp validate                 # Validate config
omniclaude models search <query>        # Search models (enhanced)
omniclaude models providers             # Providers (enhanced)
omniclaude models cost [session]        # Cost tracking (enhanced)
omniclaude session stats [id]           # Statistics (enhanced)
omniclaude session checkpoints <id>     # Checkpoints (enhanced)
omniclaude config list [category]       # Config by category
```

**Phase 3 Commands (20):**
```
omniclaude history search <query>       # Search history
omniclaude history segment <range>      # Get segment
omniclaude history checkpoints          # List boundaries
omniclaude history context <desc>       # Request context
omniclaude mentorship status            # Mentorship status
omniclaude mentorship enable [model]    # Enable helper
omniclaude mentorship disable           # Disable helper
omniclaude mentorship logs              # Usage logs
omniclaude mentorship stats [session]   # Cost savings
omniclaude tmux create                  # Create session
omniclaude tmux send <id> <cmd>         # Send command
omniclaude tmux capture <id>            # Capture output
omniclaude tmux snapshot <id>           # Visual snapshot
omniclaude tmux list                    # List sessions
omniclaude tmux kill <id>               # Kill session
(+ Enhanced UI, themes, middleware visibility)
```

**Phase 4 Commands (20+):**
```
omniclaude artifact create <name>       # Create artifact
omniclaude artifact list                # List artifacts
omniclaude artifact inspect <id>        # Inspect state
omniclaude artifact interact <id>       # UI interaction
omniclaude artifact modify <id>         # Modify code
omniclaude artifact stop <id>           # Stop artifact
omniclaude artifact restart <id>        # Restart artifact
omniclaude artifact view <id>           # View in browser
omniclaude artifact dashboard           # Dashboard
omniclaude artifact templates           # List templates
omniclaude artifact create-from-template # From template
(+ Sandbox management, visual feedback, hot reload)
```

**Phase 5 Commands (25+):**
```
# Workspace Mode
omniclaude workspace start              # Enter workspace mode
omniclaude workspace window create      # Create window
omniclaude workspace window arrange     # Arrange windows
omniclaude workspace window focus <id>  # Focus window
omniclaude workspace window close <id>  # Close window
omniclaude workspace layout list        # List layouts
omniclaude workspace layout save        # Save layout
omniclaude workspace layout load        # Load layout
omniclaude workspace stream start       # Start screen streaming
omniclaude workspace stream stop        # Stop streaming
omniclaude workspace overwatch enable   # Enable AI Overwatch
omniclaude workspace overwatch disable  # Disable AI Overwatch
omniclaude workspace overwatch status   # Overwatch status

# Godel Terminal Commands
omniclaude godel <command>              # Execute Godel command
omniclaude godel "TICKER EQ G"          # Chart command
omniclaude godel "TICKER EQ FA"         # Fundamentals
omniclaude godel "TICKER EQ ANR"        # Analyst ratings
omniclaude godel "TICKER EQ EST"        # Estimates
omniclaude godel "TICKER EQ INSD"       # Insider trading
omniclaude godel "TICKER EQ RES"        # Research reports

# Financial Artifact Templates
omniclaude artifact templates --category=financial
omniclaude artifact create-from-template stock-chart
omniclaude artifact create-from-template watchlist
omniclaude artifact create-from-template ticker-dashboard
(+ Screen streaming, coordinate clicking, visual verification)
```

**Total: 105+ commands**

### 11.2 HTTP API Reference

**Endpoints Used by CLI:**

```
POST /v1/messages
  Description: Main chat endpoint (streaming + non-streaming)
  Request:
    {
      "model": "gemini-2-5-flash",
      "messages": [...],
      "tools": [...],
      "stream": true,
      "max_tokens": 4096,
      "temperature": 1.0
    }
  Response (streaming): Server-Sent Events
  Response (sync): { content: string, usage: {...} }

GET /models
  Description: List all available models
  Response: { models: [...66 models...] }

GET /v1/approval-mode
  Description: Get current permission mode
  Response: { mode: "interactive" | "auto" | "strict" }

POST /v1/approval-mode
  Description: Set permission mode
  Request: { mode: "interactive" | "auto" | "strict" }
  Response: { success: true, mode: "interactive" }
```

### 11.3 File Locations

**CLI Package:**
```
~/.omniclaude/
├── config.json                 # Main configuration
├── sessions/                   # Session storage
│   └── session-*.jsonl
├── logs/                       # Audit logs
│   ├── audit.log
│   └── permissions.log
└── cache/                      # Cache directory
    └── mcp-tools/

./MCP_CONFIG.md                 # Project MCP config
./.omniclauderc                 # Project config (optional)
```

**Server Data:**
```
.claude/
├── sessions/                   # Server sessions
├── system-messages/            # System messages
└── mcp/                        # MCP server data
```

### 11.4 Dependencies

**Production:**
```json
{
  "commander": "^11.0.0",
  "inquirer": "^9.0.0",
  "chalk": "^5.0.0",
  "cli-spinners": "^3.0.0",
  "marked-terminal": "^7.0.0",
  "highlight.js": "^11.0.0",
  "cosmiconfig": "^9.0.0",
  "node-fetch": "^3.0.0",
  "@omniclaude/core": "^4.0.0",
  "@omniclaude/types": "^4.0.0"
}
```

**Development:**
```json
{
  "vitest": "^1.0.0",
  "@types/node": "^20.0.0",
  "typescript": "^5.3.0",
  "eslint": "^8.56.0",
  "prettier": "^3.2.0"
}
```

### 11.5 Key Metrics & ROI

**Token Efficiency (MCP On-Demand):**
- Traditional: 127 tools = ~25,000 tokens/request
- OmniClaude V4: 32 base + on-demand = ~7,400 tokens/request
- Savings: 70% token reduction

**Cost Savings (Mentorship):**
- Without helper: $0.0245/session average
- With helper: $0.0103/session average
- Savings: 58% cost reduction

**Development Velocity:**
- Phase 1: 8-10 days (foundation)
- Phase 2: 6-8 days (MCP integration)
- Phase 3: 8-10 days (advanced features)
- Phase 4: 14-20 days (artifacts)
- Total: 6-8 weeks to full feature parity

**Market Differentiation:**
- Only CLI with 66 models across 10 providers
- Only CLI with MCP on-demand (70% savings)
- Only CLI with visual programming (artifacts)
- Only CLI with comprehensive permissions
- Open source reference implementation

---

## Document Status

**Version:** 3.0
**Status:** ✅ Complete
**Coverage:** 100% of core library features
**Ready for:** Implementation

**Next Steps:**
1. Review with engineering team
2. Create implementation tickets (Jira/GitHub Issues)
3. Set up project board (Kanban)
4. Begin Phase 1 sprint planning
5. Establish CI/CD pipeline
6. Create initial package structure

**Approval Required From:**
- [ ] Engineering Lead
- [ ] Product Manager
- [ ] QA Lead
- [ ] Documentation Lead

**Estimated Launch:**
- Phase 1 (MVP): 2 weeks
- Phase 2 (MCP): 4 weeks
- Phase 3 (Advanced): 6 weeks
- Phase 4 (Artifacts): 11 weeks (optional, post-launch)

---

**Document Prepared By:** AI Development Team
**Date:** 2025-01-14
**Based On:** CLI_FEATURE_AUDIT.md + CLI_FEATURE_AUDIT_SUPPLEMENT.md