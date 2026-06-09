# OmniClaude V4 CLI - Product Requirements Document

**Version:** 1.0
**Date:** 2025-01-13
**Status:** Ready for Implementation

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
└─────────────┬───────────────┘
              │
┌─────────────▼───────────────┐
│   @omniclaude/core          │
│   (Orchestrator, Adapters)  │
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
│   │   ├── session.ts                # Session management
│   │   ├── models.ts                 # Model management
│   │   ├── server.ts                 # Server control
│   │   ├── config.ts                 # Configuration management
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
│   │   └── themes.ts                 # Color schemes
│   │
│   ├── utils/                        # Shared utilities
│   │   ├── config-manager.ts         # Config file operations
│   │   ├── server-manager.ts         # Server lifecycle management
│   │   ├── logger.ts                 # Debug logging
│   │   └── validation.ts             # Input validation
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
│   ├── COMMANDS.md                   # Command reference
│   └── EXAMPLES.md                   # Usage examples
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

### 4.2 Interactive Chat Mode

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
```

**Examples:**
```bash
# Start interactive chat with default model
omniclaude chat

# Start with specific model
omniclaude chat -m claude-3-5-sonnet-20241022

# Resume from checkpoint
omniclaude chat --resume checkpoint-abc-123

# Custom system message
omniclaude chat --system "You are a Rust expert"
```

### 4.3 Single Message Mode (Non-Interactive)

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
omniclaude message "Explain recursion" -m gpt-4-turbo

# JSON output for scripting
omniclaude "Summarize this code" --json < file.py

# Raw output (no markdown formatting)
omniclaude "Generate hello world" --raw
```

### 4.4 Model Management

**Commands:**
```bash
omniclaude models list            # List all available models
omniclaude models info <model-id> # Show detailed model information
```

**Examples:**
```bash
# List all models
omniclaude models list

# Show model details
omniclaude models info gemini-2.5-flash

# JSON output for scripting
omniclaude models list --json
```

### 4.5 Session Management

**Commands:**
```bash
omniclaude session list           # List all sessions
omniclaude session view <id>      # View session details
omniclaude session export <id>    # Export session to JSON
omniclaude session delete <id>    # Delete session
```

**Examples:**
```bash
# List all sessions
omniclaude session list

# View specific session
omniclaude session view session-abc-123

# Export session
omniclaude session export session-abc-123 > session.json

# Delete session
omniclaude session delete session-abc-123
```

### 4.6 Server Management

**Commands:**
```bash
omniclaude server start [options] # Start server
omniclaude server stop            # Stop server
omniclaude server status          # Check server status
omniclaude server logs            # View server logs
```

**Examples:**
```bash
# Start server
omniclaude server start

# Start on different port
omniclaude server start --port 5000

# Check status
omniclaude server status

# View logs
omniclaude server logs
```

### 4.7 Configuration Management

**Commands:**
```bash
omniclaude config get <key>       # Get configuration value
omniclaude config set <key> <val> # Set configuration value
omniclaude config list            # List all configuration
omniclaude init                   # First-run wizard
```

**Configuration Keys:**
- `defaultModel` - Default model ID
- `serverUrl` - Server URL
- `temperature` - Default temperature
- `maxTokens` - Default max tokens
- `theme` - Color theme (default, dark, light)

**Examples:**
```bash
# Set default model
omniclaude config set defaultModel gemini-2.5-flash

# Get default model
omniclaude config get defaultModel

# List all config
omniclaude config list

# Interactive setup wizard
omniclaude init
```

### 4.8 Exit Codes

```
0   - Success
1   - General error
2   - Invalid arguments
3   - Server connection failed
4   - Authentication failed (future)
5   - Model not found
6   - API rate limit exceeded (future)
7   - Session not found
8   - Configuration error
130 - User interrupt (Ctrl+C)
```

---

## 5. Interactive Mode UI

### 5.1 Layout

```
┌─────────────────────────────────────────────────────────────┐
│ OmniClaude V4                            [Ctrl+C to exit]   │
│ Model: gemini-2.5-flash      Session: abc-123               │
│ Messages: 12  |  Tokens: 45.2K  |  Cost: $0.03             │
└─────────────────────────────────────────────────────────────┘

You: How do I implement a binary search tree in Rust?

⏳ Thinking...