# Nexus Cortex CLI - Design Specification
## Single Source of Truth for Implementation

**Version:** 1.0.0
**Date:** 2025-01-13
**Status:** Draft → Review → Approved → Implementation
**Stakeholders:** Engineering, Product, UX

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [User Personas & Use Cases](#2-user-personas--use-cases)
3. [Design Principles](#3-design-principles)
4. [Architecture Overview](#4-architecture-overview)
5. [Command Structure](#5-command-structure)
6. [Interactive Mode](#6-interactive-mode)
7. [Non-Interactive Mode](#7-non-interactive-mode)
8. [UI/UX Specifications](#8-uiux-specifications)
9. [Feature Mapping](#9-feature-mapping)
10. [Error Handling](#10-error-handling)
11. [Configuration System](#11-configuration-system)
12. [Session Management](#12-session-management)
13. [Help & Discoverability](#13-help--discoverability)
14. [Monetization Hooks](#14-monetization-hooks)
15. [Technical Specifications](#15-technical-specifications)
16. [Implementation Phases](#16-implementation-phases)
17. [Testing Strategy](#17-testing-strategy)
18. [Open Questions](#18-open-questions)

---

## 1. Executive Summary

### 1.1 Purpose
The Nexus Cortex CLI is a **shell-based terminal interface** that serves as the primary client for the Nexus Cortex HTTP API. It is designed to:
- **Validate** the HTTP API through real-world usage
- **Serve as a reference implementation** for future clients (web UI, mobile)
- **Provide a professional developer experience** that showcases the core library capabilities
- **Act as a marketing tool** for the open-core business model

### 1.2 Strategic Importance
This CLI is NOT just a utility tool - it's a strategic asset:
- **Free tier**: Open source CLI drives adoption and community engagement
- **API validator**: Proves the server API works for web/mobile clients
- **Conversion funnel**: Professional CLI experience → paid tiers/enterprise licenses
- **Developer credibility**: High-quality CLI signals serious engineering

### 1.3 Core Value Proposition
"A lightning-fast, multi-provider LLM terminal interface that feels like having Claude, GPT, and Gemini working together in your shell."

### 1.4 Success Metrics
- **Time to first message**: < 5 seconds from `cortex chat` to AI response
- **Session reliability**: 99%+ message delivery, zero data loss
- **User satisfaction**: "Just works" - minimal configuration required
- **API validation**: All core library features accessible via CLI commands

---

## 2. User Personas & Use Cases

### 2.1 Primary Personas

#### Persona 1: "Dev" - The Command-Line Warrior
- **Profile**: Backend engineer, lives in terminal, Docker/k8s expert
- **Goals**: Fast code assistance, debugging, one-liner solutions
- **Pain points**: Hates leaving terminal, needs instant answers
- **Usage pattern**: Quick questions, pipe output to AI, automation scripts
- **Quote**: "If it doesn't run in my terminal, it doesn't exist."

#### Persona 2: "Architect" - The Problem Solver
- **Profile**: Senior engineer, system designer, long-form thinker
- **Goals**: Design discussions, architecture review, multi-turn refinement
- **Pain points**: Needs context preservation, checkpoint/resume for long sessions
- **Usage pattern**: 30+ minute sessions, branching explorations, saves checkpoints
- **Quote**: "I need an AI that remembers what we discussed yesterday."

#### Persona 3: "Scripter" - The Automation Engineer
- **Profile**: DevOps, CI/CD builder, scripting everything
- **Goals**: Batch processing, automated code review, scripted workflows
- **Pain points**: Needs non-interactive mode, exit codes, JSON output
- **Usage pattern**: Shell scripts, CI pipelines, cron jobs
- **Quote**: "Can I pipe this through jq and feed it to my monitoring system?"

#### Persona 4: "Evaluator" - The Decision Maker
- **Profile**: CTO, tech lead, evaluating tools for team
- **Goals**: Assess quality, understand pricing, test enterprise features
- **Pain points**: Needs to see value quickly, concerned about lock-in
- **Usage pattern**: Quick trial, stress testing, comparing to competitors
- **Quote**: "Show me why this is better than Cursor or GitHub Copilot CLI."

### 2.2 Primary Use Cases

#### UC-001: Quick Code Assistance
```bash
$ cortex "How do I reverse a string in Rust?"
# AI responds with code example, explanation
# Exit immediately after response
```
**Priority**: P0 (MVP)
**Persona**: Dev, Scripter

#### UC-002: Interactive Debugging Session
```bash
$ cortex chat
You: I'm getting a segfault in my C++ code [pastes code]
Assistant: [analyzes, asks questions]
You: [provides more context]
Assistant: [suggests fix]
You: /checkpoint "before applying fix"
# Applies fix, tests, continues conversation
```
**Priority**: P0 (MVP)
**Persona**: Dev, Architect

#### UC-003: Long-Running Project Discussion
```bash
$ cortex chat
# Day 1: Architectural discussion, create checkpoint
You: /checkpoint "day 1 - architecture decisions"

# Day 2: Resume from checkpoint
$ cortex chat --resume <checkpoint-id>
# Conversation continues with full context
```
**Priority**: P1 (Post-MVP)
**Persona**: Architect

#### UC-004: Model Comparison
```bash
$ cortex chat --model claude-3-5-sonnet-20241022
You: Explain dependency injection
Assistant: [Claude's explanation]
You: /switch gpt-4-turbo
You: Same question
Assistant: [GPT-4's explanation]
# Compare responses from different models
```
**Priority**: P1 (Post-MVP)
**Persona**: Evaluator

#### UC-005: CI/CD Integration
```bash
#!/bin/bash
# In CI pipeline
result=$(cortex "Review this code for security issues: $(cat src/auth.ts)" --json)
issues=$(echo "$result" | jq '.security_issues | length')
if [ "$issues" -gt 0 ]; then
  echo "Security issues found!"
  exit 1
fi
```
**Priority**: P2 (Future)
**Persona**: Scripter

#### UC-006: Team Collaboration (Future - Paid Feature)
```bash
$ cortex chat --team engineering
# Shared session with team members
# All team members see same conversation
# Requires authentication and team account
```
**Priority**: P3 (Monetization)
**Persona**: Architect, Evaluator

---

## 3. Design Principles

### 3.1 Core Principles

#### Principle 1: Speed & Responsiveness
- **Target**: < 500ms to first token
- **Rationale**: Terminal users expect instant feedback
- **Implementation**: HTTP/2, connection pooling, streaming by default

#### Principle 2: Zero Configuration by Default
- **Target**: Works immediately after `npm install -g`
- **Rationale**: Reduce friction to first value
- **Implementation**: Sensible defaults, auto-detect server, fallback to public API (future)

#### Principle 3: Progressive Disclosure
- **Target**: Simple commands work out of the box, advanced features discoverable
- **Rationale**: Don't overwhelm new users, don't limit power users
- **Implementation**: `cortex chat` (simple) → `/help` (intermediate) → `--advanced-options` (expert)

#### Principle 4: Fail Gracefully
- **Target**: Clear error messages, recovery suggestions, never lose data
- **Rationale**: Build trust, reduce support burden
- **Implementation**: Descriptive errors, auto-retry, local message cache

#### Principle 5: Terminal-Native UX
- **Target**: Feels like a native terminal app (vim, tmux, etc.)
- **Rationale**: Respect CLI conventions, integrate with shell workflows
- **Implementation**: POSIX-compliant, pipe-friendly, proper exit codes

#### Principle 6: Observable & Debuggable
- **Target**: Users can see what's happening, debug issues independently
- **Rationale**: Enterprise users need transparency, support efficiency
- **Implementation**: `--debug` flag, request IDs, trace logging

### 3.2 Anti-Patterns to Avoid

❌ **No GUI dialogs** - Stay in terminal
❌ **No blocking prompts without --interactive** - Respect automation
❌ **No silent failures** - Always explain what went wrong
❌ **No vendor lock-in** - CLI works with any Nexus Cortex server
❌ **No data loss** - Auto-save conversations, checkpoint on crash

---

## 4. Architecture Overview

### 4.1 High-Level Architecture

```
┌─────────────────────────────────────────────────┐
│             CLI Application Layer               │
│  ┌───────────────────────────────────────────┐  │
│  │  Command Router (Commander.js/Yargs)      │  │
│  └───────────────────┬───────────────────────┘  │
│                      │                           │
│  ┌───────────────────▼───────────────────────┐  │
│  │     Command Handlers                      │  │
│  │  - chat.ts    - session.ts    - models.ts│  │
│  │  - message.ts - checkpoint.ts - config.ts│  │
│  └───────────────────┬───────────────────────┘  │
│                      │                           │
│  ┌───────────────────▼───────────────────────┐  │
│  │     CortexClient (HTTP Client)        │  │
│  │  - sendMessage()  - streamMessage()       │  │
│  │  - listModels()   - createCheckpoint()    │  │
│  └───────────────────┬───────────────────────┘  │
│                      │                           │
│  ┌───────────────────▼───────────────────────┐  │
│  │     UI Rendering Layer                    │  │
│  │  - Prompt   - Spinner   - ProgressBar    │  │
│  │  - Markdown - Syntax    - Diff renderer  │  │
│  └───────────────────────────────────────────┘  │
└─────────────────────┬───────────────────────────┘
                      │ HTTP/SSE
┌─────────────────────▼───────────────────────────┐
│         Nexus Cortex HTTP Server               │
│               (localhost:4000)                  │
└─────────────────────┬───────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────┐
│            @cortex/core Library             │
│         (Orchestrator, Adapters, etc.)          │
└─────────────────────────────────────────────────┘
```

### 4.2 Package Structure

```
packages/cli/
├── src/
│   ├── index.ts                    # Entry point, CLI bootstrap
│   ├── cli.ts                      # Command router setup
│   │
│   ├── commands/                   # Command handlers
│   │   ├── chat.ts                 # Interactive chat mode
│   │   ├── message.ts              # Single message mode
│   │   ├── session.ts              # Session management
│   │   ├── checkpoint.ts           # Checkpoint operations
│   │   ├── models.ts               # Model listing/switching
│   │   ├── config.ts               # Configuration management
│   │   └── server.ts               # Server management (start/stop)
│   │
│   ├── client/                     # HTTP API client
│   │   ├── CortexClient.ts     # Main API client class
│   │   ├── SSEParser.ts            # Server-Sent Events parser
│   │   ├── types.ts                # Client TypeScript types
│   │   └── errors.ts               # Client error classes
│   │
│   ├── ui/                         # Terminal UI components
│   │   ├── components/             # Reusable UI components
│   │   │   ├── Prompt.ts           # User input prompt
│   │   │   ├── Spinner.ts          # Loading spinner
│   │   │   ├── ProgressBar.ts      # Progress indicator
│   │   │   ├── MessageRenderer.ts  # AI message display
│   │   │   ├── ToolDisplay.ts      # Tool execution display
│   │   │   ├── DiffRenderer.ts     # Code diff display
│   │   │   └── StatusBar.ts        # Session status bar
│   │   ├── themes/                 # Color themes
│   │   │   ├── default.ts          # Default theme
│   │   │   ├── dark.ts             # Dark theme
│   │   │   └── light.ts            # Light theme
│   │   ├── markdown.ts             # Markdown rendering
│   │   └── syntax.ts               # Syntax highlighting
│   │
│   ├── utils/                      # Utilities
│   │   ├── config-manager.ts       # Config file handling
│   │   ├── server-manager.ts       # Server lifecycle management
│   │   ├── session-cache.ts        # Local session caching
│   │   ├── logger.ts               # Logging utility
│   │   └── validation.ts           # Input validation
│   │
│   └── types/                      # Shared types
│       ├── commands.ts             # Command types
│       ├── config.ts               # Configuration types
│       └── ui.ts                   # UI types
│
├── bin/
│   └── cortex.js               # Binary entry point (#!/usr/bin/env node)
│
├── test/                           # Tests
│   ├── unit/                       # Unit tests
│   ├── integration/                # Integration tests
│   └── e2e/                        # End-to-end tests
│
├── docs/                           # CLI-specific documentation
│   ├── COMMANDS.md                 # Command reference
│   ├── CONFIGURATION.md            # Config file documentation
│   └── EXAMPLES.md                 # Usage examples
│
├── package.json
├── tsconfig.json
└── README.md
```

### 4.3 Technology Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| **CLI Framework** | Commander.js | Industry standard, excellent docs, TypeScript support |
| **HTTP Client** | node-fetch / axios | Simple, well-tested, streaming support |
| **Terminal UI** | chalk + cli-spinners + inquirer | Composable, lightweight, no heavy frameworks |
| **Markdown** | marked-terminal | Fast, terminal-optimized rendering |
| **Syntax Highlight** | highlight.js | Wide language support |
| **Config** | cosmiconfig | Standard config file discovery |
| **Testing** | Vitest + @commander-js/extra-typings | Fast, TypeScript-first |

**Why NOT Ink (React for terminals)?**
- Overkill for CLI (not building complex UI)
- Adds 10MB+ to bundle
- Slower startup time
- Simple readline + chalk is sufficient

---

## 5. Command Structure

### 5.1 Command Hierarchy

```
cortex [global-options] <command> [command-options] [arguments]
```

### 5.2 Global Options

```bash
--server <url>      # Server URL (default: http://localhost:4000)
--config <path>     # Config file path (default: ~/.cortex/config.json)
--debug             # Enable debug logging
--no-color          # Disable colored output
--json              # Output in JSON format (for scripting)
--version           # Show version
--help              # Show help
```

### 5.3 Commands

#### Primary Commands

```bash
# Start interactive chat (default command)
cortex [message]
cortex chat [options]

# Send single message (non-interactive)
cortex message <prompt> [options]
cortex ask <prompt>        # Alias for 'message'

# Model management
cortex models list         # List available models
cortex models info <id>    # Show model details

# Session management
cortex session list        # List sessions
cortex session view <id>   # View session details
cortex session delete <id> # Delete session
cortex session export <id> # Export session to JSON

# Checkpoint management
cortex checkpoint create [label]     # Create checkpoint
cortex checkpoint list               # List checkpoints
cortex checkpoint resume <id>        # Resume from checkpoint
cortex checkpoint delete <id>        # Delete checkpoint

# Configuration
cortex config get <key>              # Get config value
cortex config set <key> <value>      # Set config value
cortex config list                   # List all config

# Server management
cortex server start [options]        # Start server
cortex server stop                   # Stop server
cortex server status                 # Check server status
cortex server logs                   # View server logs

# Utility commands
cortex init                          # Initialize config (first-run wizard)
cortex doctor                        # Diagnose issues
cortex version                       # Show version info
```

#### Command Aliases

```bash
cortex                    → cortex chat
cortex "prompt"           → cortex message "prompt"
cortex chat --resume <id> → cortex checkpoint resume <id>
```

### 5.4 Command Options

#### `chat` Command Options

```bash
cortex chat [options]

Options:
  -m, --model <id>           Model to use (default: from config)
  -r, --resume <id>          Resume from checkpoint
  -s, --system <message>     System message
  --max-tokens <number>      Maximum tokens (default: 4096)
  --temperature <number>     Temperature 0-2 (default: 1.0)
  --no-stream               Disable streaming (wait for full response)
  --tools <list>            Comma-separated tool names to enable
  --no-tools                Disable all tools
  --save-checkpoint <label> Auto-save checkpoint on exit
```

#### `message` Command Options

```bash
cortex message <prompt> [options]

Options:
  -m, --model <id>           Model to use
  --system <message>         System message
  --max-tokens <number>      Maximum tokens
  --temperature <number>     Temperature 0-2
  --json                     Output as JSON
  --raw                      Output raw text (no formatting)
  --tools <list>            Enable specific tools
  --no-tools                Disable all tools
```

### 5.5 Exit Codes

```bash
0   - Success
1   - General error
2   - Invalid arguments
3   - Server connection failed
4   - Authentication failed (future)
5   - Model not found
6   - API rate limit exceeded (future)
7   - Session not found
8   - Checkpoint not found
9   - Configuration error
130 - Interrupted by user (Ctrl+C)
```

---

## 6. Interactive Mode

### 6.1 Interface Layout

```
┌─────────────────────────────────────────────────────────────┐
│ Nexus Cortex                                    [Ctrl+C to exit] │
│ Model: gemini-2.5-flash          Session: abc-123         │
│ Messages: 12  |  Tokens: 45.2K  |  Cost: $0.03           │
└─────────────────────────────────────────────────────────────┘

You: How do I implement a binary search tree in Rust?
⠋ Thinking...

⠋ Thinking...

Assistant: Here's a complete implementation of a binary search tree in Rust:

```rust
struct Node {
    value: i32,
    left: Option<Box<Node>>,
    right: Option<Box<Node>>,
}
```

This is a basic node structure. Each node contains...

[Full response continues with explanation]
```


### 6.2 Streaming Behavior

When the assistant responds, tokens stream in real-time:

```
Assistant: ▊
```

Then continues character by character:

```
Assistant: Here is a complete▊
```

**Implementation Details**:
- Use SSE (Server-Sent Events) from the HTTP API
- Update terminal line-by-line (no flickering)
- Show cursor at end of current line (`▊` or `█`)
- Support ANSI escape codes for smooth updates
- Buffer partial ANSI sequences (don't break mid-escape)
- Graceful fallback if terminal doesn't support cursor positioning

**Performance Targets**:
- Latency: Display tokens within 50ms of receiving from server
- Smoothness: 60fps rendering (16ms per frame max)
- No tearing: Use double-buffering for complex updates


### 6.3 In-Chat Commands

Commands available during interactive chat (all start with `/`):

| Command | Description | Example |
|---------|-------------|---------|
| `/checkpoint [label]` | Save current conversation state | `/checkpoint "before refactor"` |
| `/switch <model>` | Switch to different model | `/switch gpt-4-turbo` |
| `/models` | List available models | `/models` |
| `/system <message>` | Set/update system message | `/system "You are a Rust expert"` |
| `/context` | Show conversation context size | `/context` |
| `/tokens` | Show token usage and cost | `/tokens` |
| `/export [format]` | Export conversation (md/json/txt) | `/export markdown` |
| `/clear` | Clear screen (keep session) | `/clear` |
| `/reset` | Start new session | `/reset` |
| `/history` | Show message history | `/history` |
| `/undo` | Remove last message pair | `/undo` |
| `/help` | Show available commands | `/help` |
| `/exit` or `/quit` | Exit chat (save session) | `/exit` |

**Command Behavior**:
- Commands are NOT sent to the AI
- Invalid commands show error + suggestion
- Tab completion for commands and model names
- Commands are case-insensitive
- `/` at start of line triggers command mode

**Example Session**:
```
You: Explain async/await in JavaScript
Assistant: [explanation...]

You: /checkpoint "async explanation"
✓ Checkpoint saved: chk_abc123

You: /switch claude-3-5-sonnet-20241022
✓ Switched to claude-3-5-sonnet-20241022

You: Now explain it in TypeScript
Assistant: [TypeScript explanation...]
```

### 6.4 Keyboard Shortcuts

| Shortcut | Action | Description |
|----------|--------|-------------|
| **Ctrl+C** | Interrupt | Stop current AI response, return to prompt |
| **Ctrl+D** | Exit | Exit chat (same as `/exit`) |
| **Ctrl+L** | Clear screen | Clear terminal (keep session) |
| **Ctrl+R** | Search history | Search previous messages |
| **↑ / ↓** | History navigation | Navigate through previous prompts |
| **Tab** | Auto-complete | Complete commands, model names, file paths |
| **Shift+Enter** | New line | Add line break in multi-line input |
| **Ctrl+W** | Delete word | Delete previous word |
| **Ctrl+U** | Clear line | Clear current input line |

**Implementation**:
- Use `readline` library for input handling
- Custom key bindings for special shortcuts
- Vim/Emacs mode support via config option
- Graceful degradation on unsupported terminals

### 6.5 Multi-Line Input Handling

Users can enter multi-line prompts using **Shift+Enter** or by starting with triple backticks:

**Method 1: Shift+Enter**
```
You: I have a bug in this code:▊
[Shift+Enter]
     const result = data.map(x => x * 2)▊
[Shift+Enter]
     return result▊
[Enter to send]
```

**Method 2: Triple Backticks (Auto-detects)**
```
You: ```▊
[Automatically enters multi-line mode]
[Type code...]
```▊
[Press Enter to send]
```

**Visual Indicators**:
- Multi-line mode shows `...` prompt for continuation lines
- Line counter shows current line number
- Syntax highlighting for code blocks (if language detected)

**Example**:
```
You: ```python
...  def fibonacci(n):
...      if n <= 1:
...          return n
...      return fibonacci(n-1) + fibonacci(n-2)
...  ```
...  Optimize this function
[Enter to send]
```

### 6.6 Tool Execution Display

When the AI uses tools, display them clearly:

**Tool Call (Before Execution)**:
```
Assistant: I'll read that file for you.

🔧 Tool: read_file
   Path: /home/user/config.json
   [Approve? Y/n/always/never]:
```

**Tool Call (During Execution)**:
```
🔧 Tool: read_file
   Path: /home/user/config.json
   ⠋ Executing...
```

**Tool Call (After Success)**:
```
🔧 Tool: read_file
   Path: /home/user/config.json
   ✓ Success (1.2KB, 45 lines)
```

**Tool Call (After Error)**:
```
🔧 Tool: write_file
   Path: /etc/system/config
   ✗ Error: Permission denied
   
   Suggestion: Try using sudo or check file permissions
```

**Multiple Tools**:
```
Assistant: I'll analyze those three files.

🔧 Tools (3):
   1. read_file: package.json        ⠋ Executing...
   2. read_file: tsconfig.json       ⏳ Queued
   3. read_file: README.md           ⏳ Queued

[Tools execute sequentially, status updates in real-time]
```

**Tool Approval Settings**:
- `--tools-auto-approve`: Auto-approve all tools (dangerous!)
- `--tools-prompt`: Prompt for each tool (default)
- `--tools-deny`: Deny all tools (safe mode)
- Per-tool approval: `/tools allow read_file` or `/tools deny write_file`

---
