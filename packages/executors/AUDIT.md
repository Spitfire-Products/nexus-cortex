# Executors Package Audit

**Date**: 2025-12-05
**Location**: `packages/executors/src/`
**Total TypeScript Files**: 82 (excluding tests)
**Total Tools Implemented**: 29
**Pattern**: All tools extend `BaseTool<TParams, TResult>`

---

## Overview

The executors package provides the runtime execution layer for all tools in Nexus Cortex. It bridges tool definitions (in @nexus-cortex/core) with their implementations, following the pattern: Definition ≠ Execution.

---

## /base/ Directory

### BaseTool.ts
- **Class**: `BaseTool<TParams, TResult>` - Abstract base class
- **Key Methods**:
  - `abstract validateToolParams(params): string | null`
  - `abstract execute(params, signal, updateOutput): Promise<TResult>`
  - `getDescription(params): string`
  - `shouldConfirmExecute(params, signal): Promise<ToolCallConfirmationDetails | false>`
  - `createSuccessResult(content, metadata): ToolResult`
  - `createErrorResult(error, metadata): ToolResult`

### ToolResult.ts
- **Interface**: `ToolResult`
  - `llmContent: string | CanonicalContentBlock[]`
  - `returnDisplay?: string`
  - `success: boolean`
  - `error?: string`
  - `metadata?: {...}`
- **Interface**: `ToolCallConfirmationDetails`

### ToolRegistry.ts
- **Class**: `ToolRegistry`
- **Key Methods**: registerTool, unregisterTool, getTool, executeTool, getToolStats, getAllStats, resetToolStats

---

## Tool Implementations

### /file/ - File Operations (3 tools)

#### ReadFileTool.ts
- **Tool Name**: `Read`
- **Parameters**: file_path (required), offset, limit
- **Features**: Path security, line ranges, 2000 line limit, FileReadTracker integration

#### WriteFileTool.ts
- **Tool Name**: `Write`
- **Parameters**: file_path (required), content (required)
- **Features**: Directory creation, language detection (27+ languages)

#### EditTool.ts
- **Tool Name**: `Edit`
- **Parameters**: file_path, old_string, new_string, replace_all, expected_replacements
- **Features**: **MANDATORY READ-BEFORE-EDIT PROTOCOL**, FileReadTracker integration, stale file detection, diff generation

**FileReadTracker Class** (static):
- `markAsRead()`, `markAsEdited()`, `hasBeenRead()`, `isStale()`, `getSuggestedReadParams()`, `clearSession()`

---

### /search/ - File Search (2 tools)

#### GlobTool.ts
- **Tool Name**: `Glob`
- **Parameters**: pattern (required), path, case_sensitive, limit, offset
- **Features**: mtime sorting, pagination, excludes node_modules/.git

#### GrepTool.ts
- **Tool Name**: `Grep`
- **Parameters**: pattern (required), path, glob, output_mode, -A/-B/-C, -n, -i, type, head_limit, offset, multiline
- **4-Tier Fallback**: ripgrep → git grep → system grep → JS fallback

---

### /execution/ - Shell Execution (3 tools)

#### ShellTool.ts
- **Tool Name**: `Bash`
- **Parameters**: command (required), directory, timeout, persistentSession, sessionId, captureHistory
- **Features**: Background process detection, ANSI stripping, 2-minute default timeout, tmux support

#### BashOutputTool.ts
- **Tool Name**: `BashOutput`
- **Parameters**: bash_id (required), filter
- **Features**: Retrieves background process output, regex filtering

#### KillShellTool.ts
- **Tool Name**: `KillShell`
- **Parameters**: shell_id (required)

---

### /web/ - Web Operations (2 tools)

#### WebFetchTool.ts
- **Tool Name**: `WebFetch`
- **Parameters**: prompt (required)
- **Features**: Gemini urlContext (FREE), grounding metadata, private IP fallback

#### WebSearchTool.ts
- **Tool Name**: `WebSearch`
- **Parameters**: query (required)
- **Features**: Gemini googleSearch (FREE), citation insertion

---

### /ui/ - User Interface (3 tools)

#### TodoWriteTool.ts
- **Tool Name**: `TodoWrite`
- **Parameters**: todos (array with content, status, activeForm)
- **Validation**: Exactly ONE task must be `in_progress`

#### AskUserQuestionTool.ts
- **Tool Name**: `AskUserQuestion`
- **Parameters**: questions (1-4), each with 2-4 options, multiSelect flag
- **Features**: Built-in "Other" option for custom input

#### ExitPlanModeTool.ts
- **Tool Name**: `ExitPlanMode`
- **Parameters**: plan (required, 10-5000 chars)

---

### /notebook/ - Jupyter Notebook (1 tool)

#### NotebookEditTool.ts
- **Tool Name**: `NotebookEdit`
- **Parameters**: notebook_path (required), cell_id, cell_type, edit_mode, new_source
- **Modes**: replace, insert, delete

---

### /historical/ - Conversation History (6 tools)

#### RequestHistoricalContextTool.ts
- **Tool Name**: `RequestHistoricalContext`
- **Parameters**: query (required), detailLevel, maxTokens, useHelperModel
- **Features**: Uses FREE Gemma models

**Additional Historical Tools**:
- `SearchConversationHistoryToolExecutor` - Search all sessions
- `GetConversationSegmentToolExecutor` - Get specific ranges
- `ListCompactionBoundariesToolExecutor` - View compaction points
- `ListSessionsToolExecutor` - Browse past conversations
- `LoadSessionToolExecutor` - Load full session history

---

### /tmux/ - Terminal Sessions (1 tool)

#### TmuxSessionTool.ts
- **Tool Name**: `TmuxSession`
- **Actions**: create, send, capture, list, kill, snapshot
- **Parameters**: action (required), sessionId, command, cwd, env, captureHistory, includeScreenshot
- **Features**: Web viewer integration, Playwright screenshots

---

### /extensions/ - Extensions (2 tools)

- **SlashCommandToolExecutor** - Execute slash commands from CLI
- **SkillToolExecutor** - Execute external skills/plugins

---

### /agent/ - Agent Operations (1 tool)

- **TaskToolExecutor** - Launch sub-agents and task delegation

---

### /addon/ - Artifact/Sandbox System (5 tools)

- **CreateArtifactToolExecutor** - Create executable artifacts (JS, Python, Rust, Go, HTML, Shell)
  - Modes: oneshot, dev (hot reload), persistent (tmux)
- **InteractWithSandboxExecutor** - Programmatic UI testing (click, type, navigate)
- **ModifySandboxExecutor** - Hot-reload code changes
- **InspectSandboxExecutor** - Query runtime state (DOM, console, network)
- **StopSandboxExecutor** - Cleanup and terminate sandbox

---

### /mcp/ - MCP Tools

- **DiscoveredMcpTool** - Dynamically-created tools from MCP servers (runtime injection)

---

## Utility Classes (/utils/)

| Class | Purpose |
|-------|---------|
| FileUtils | Path security, file operations |
| GitUtils | Git repository detection |
| TextUtils | Safe string replacement, normalization |
| SchemaValidator | JSON schema validation |
| TmuxManager | tmux session management |
| SessionPersistence | Session metadata storage |
| SessionLock | Concurrency control |
| BackgroundProcessRegistry | Background process tracking |
| ArtifactRegistry | Artifact/sandbox management |
| SandboxRegistry | Sandbox session management |
| ChromiumBrowserManager | Browser automation (Playwright) |
| TmuxCapture | Screenshot capture from tmux |
| TmuxViewServer | Web viewer for terminal sessions |

---

## Summary Statistics

| Category | Tools | Count |
|----------|-------|-------|
| File Operations | Read, Write, Edit | 3 |
| Search | Glob, Grep | 2 |
| Execution | Bash, BashOutput, KillShell | 3 |
| Web | WebFetch, WebSearch | 2 |
| UI/Planning | TodoWrite, AskUserQuestion, ExitPlanMode | 3 |
| Notebook | NotebookEdit | 1 |
| Historical | RequestHistoricalContext + 5 subtypes | 6 |
| Tmux | TmuxSession | 1 |
| Extensions | SlashCommand, Skill | 2 |
| Agent | Task | 1 |
| Artifacts/Sandbox | CreateArtifact, Interact, Modify, Inspect, Stop | 5 |
| **TOTAL** | | **29** |

---

## Key Design Patterns

1. **Tool Executor Pattern**: All tools extend `BaseTool` with validation + execution
2. **Result Standardization**: All tools return `ToolResult` with llmContent, returnDisplay, success/error, metadata
3. **Read-Before-Edit Protocol**: EditTool enforces FileReadTracker validation
4. **Security Patterns**: Path traversal prevention, command sanitization
5. **Streaming Output**: Many tools support `updateOutput(string)` callback
6. **Pagination Pattern**: Search/list tools support offset + limit
7. **Graceful Degradation**: Grep fallback chain, tmux optional

---

## Integration Points

- **Core Library**: Imports from @nexus-cortex/core (JSONLHistoryStore, etc.)
- **Types Package**: Uses shared interfaces from @nexus-cortex/types
- **External APIs**: Gemini (Web tools), git, ripgrep, system tools
- **System Tools**: tmux, bash/cmd, npm, Python, git
