# Neocortex UI Integration PRD

## Status: Phase 3 COMPLETE - Full Chalk CLI Parity + Enhanced Features

**Last Updated**: 2025-11-26
**Phase 1 Checkpoint**: `0deb020a` - Foundation stable
**Phase 2 Checkpoint**: `a936eab3` - Chalk CLI parity achieved
**Phase 3 Status**: COMPLETE - Enhanced input + Theme picker
**Command**: `neocortex` (React/Ink UI) | `cortex` (Chalk CLI - unchanged)

> **STATUS UPDATE**: Neocortex now has full parity with the chalk CLI plus enhanced features like multi-line input and interactive theme picker. `CortexApp.tsx` is now 1600+ lines with comprehensive features.

---

## Executive Summary

Integrate the Gemini CLI's Ink-based React UI into Nexus Cortex as a separate `neocortex` command, preserving the existing chalk-based `cortex` CLI. The goal is to achieve feature parity with the chalk CLI first, then expand to leverage the full power of `@nexus-cortex/core`.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    packages/cli/src/                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────────┐         ┌─────────────────────────────┐    │
│  │  commands/      │         │  ink-ui/                     │    │
│  │  (chalk CLI)    │         │  (Neocortex - React/Ink)     │    │
│  │                 │         │                              │    │
│  │  cortex   │         │  neocortex                   │    │
│  └────────┬────────┘         └──────────────┬───────────────┘    │
│           │                                 │                    │
│           └────────────┬────────────────────┘                    │
│                        ▼                                         │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │              orchestrator/OrchestratorClient.ts            │  │
│  │                                                            │  │
│  │  - initialize()                                            │  │
│  │  - streamMessage() → AsyncGenerator<StreamChunk>           │  │
│  │  - setApprovalHandler()  ← NEW for React-compatible perms  │  │
│  │  - enableYoloMode() / disableYoloMode()                    │  │
│  └──────────────────────────┬────────────────────────────────┘  │
│                              │                                   │
└──────────────────────────────┼───────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                      @nexus-cortex/core                         │
│                                                                  │
│  - CortexOrchestrator (with ApprovalHandler support)        │
│  - Multi-provider adapters (Anthropic, OpenAI, Google, XAI)     │
│  - Tool execution (29 base tools + MCP)                         │
│  - Session persistence (JSONL)                                  │
│  - Middleware stack (permissions, context, retry, etc.)         │
└─────────────────────────────────────────────────────────────────┘
```

---

## Current State (Phase 3 COMPLETE - Full Parity + Enhancements)

### All Core Features Working

| Feature | Status | Notes |
|---------|--------|-------|
| Basic streaming | ✅ Working | Text chunks display |
| Orchestrator bridge | ✅ Working | `useCortexStream` hook |
| Terminal size tracking | ✅ Working | `useTerminalSize` hook |
| History management | ✅ Working | `useHistoryManager` hook |
| Approval dialog | ✅ Working | React-compatible permission flow |
| Build system | ✅ Working | Explicit tsconfig exclusions for Gemini files |
| Conversation formatting | ✅ Working | User ❯ / Assistant ◆ prefixes |
| Markdown rendering | ✅ Working | `MarkdownText` component |
| Interleaved thinking | ✅ Working | `ThinkingDisplay` with block tracking |
| Tool call formatting | ✅ Working | `ToolGroupDisplay` with results |
| DiffPreview for edits | ✅ Working | Wired to Edit tool display |
| Keyboard shortcuts | ✅ Working | Tab, Shift+Tab, ESC, Ctrl+C |
| Reasoning effort toggle | ✅ Working | Tab cycles through none/low/medium/high |

### All Slash Commands Implemented

| Command | Status | Description |
|---------|--------|-------------|
| `/help`, `/?` | ✅ | Full help with all commands |
| `/clear` | ✅ | Clear conversation |
| `/exit`, `/quit`, `/q` | ✅ | Exit application |
| `/yolo [off]` | ✅ | Toggle YOLO mode |
| `/thinking` | ✅ | Toggle thinking display |
| `/model` | ✅ | Show current model |
| `/models list` | ✅ | List available models |
| `/models switch <id>` | ✅ | Switch model |
| `/models info <id>` | ✅ | Show model details |
| `/reasoning [level]` | ✅ | Set reasoning effort |
| `/session list` | ✅ | List sessions |
| `/session checkpoint` | ✅ | Create checkpoint |
| `/continue [id]` | ✅ | Resume session |
| `/cache metrics` | ✅ | Show cache stats |
| `/mcp list` | ✅ | List MCP servers |
| `/mcp enable <name>` | ✅ | Enable MCP server |
| `/mcp disable <name>` | ✅ | Disable MCP server |
| `/tools list` | ✅ | List available tools |
| `/tools info <name>` | ✅ | Show tool details |
| `/init` | ✅ | Generate CORTEX.md |
| `/debug` | ✅ | Toggle debug mode |
| `/theme` | ✅ | Show current theme |
| `/theme list` | ✅ | List available themes |
| `/theme picker` | ✅ | Interactive theme picker |
| `/theme set <name>` | ✅ | Set theme by name |
| `/config` | ✅ | Show config summary |
| `/config list` | ✅ | List config keys |
| `/config get <key>` | ✅ | Get config value |
| `/config set <key> <value>` | ✅ | Set config value |
| `/system-message list` | ✅ | List system messages |
| `/system-message view <file>` | ✅ | View message content |

### Enhanced Features (Beyond Chalk CLI)

| Feature | Status | Notes |
|---------|--------|-------|
| Multi-line input | ✅ | Shift+Enter for new line, Enter to submit |
| Input history | ✅ | Up/Down arrows navigate previous messages |
| Theme picker dialog | ✅ | Interactive selection with live preview |
| Visual hints | ✅ | Shows history position, line count hints |

### Future Enhancements

| Feature | Status | Notes |
|---------|--------|-------|
| Vim mode | ❌ | Gemini has it, could integrate |
| Full CommandPalette | ❌ | /help shows list, not interactive palette |
| Session browser dialog | ❌ | /continue works, could add UI browser |

---

## Implementation Phases

### Phase 1: Foundation (COMPLETE)
**Status**: ✅ Done - Commit `0deb020a`

- [x] Directory structure (`ink-ui/`)
- [x] Copy Gemini CLI files (reference)
- [x] Create `CortexApp.tsx` main component
- [x] Create `useCortexStream.ts` bridge hook
- [x] Create `useHistoryManager.ts` for state
- [x] Create `useTerminalSize.ts` for dimensions
- [x] Create `useReactApprovalHandler.ts` for permissions
- [x] Create `ApprovalDialog.tsx` component
- [x] Create `cortex-types.ts` (no @google/gemini-cli-core deps)
- [x] Update `CortexOrchestrator.ts` with `setApprovalHandler()`
- [x] Update `OrchestratorClient.ts` with `setApprovalHandler()`
- [x] Configure tsconfig.json exclusions
- [x] Entry point `bin/ink-ui.js`
- [x] Global command `neocortex`

### Phase 2: Chalk CLI Parity (COMPLETE)
**Status**: ✅ Done - Commit `a936eab3`
**Goal**: Match feature set of existing `cortex` chalk CLI

#### 2.1 Interleaved Thinking Display ⚠️
**Status**: Component exists, NOT fully integrated

**What exists**:
- `ThinkingDisplay.tsx` - Full thinking display component
- `InlineThinkingDisplay.tsx` - Compact streaming display
- `useCortexStream.ts` - Has `thought` tracking

**What's missing**:
- [ ] Thinking not consistently displayed during streaming
- [ ] Tab toggle doesn't affect `reasoningEffort` for GPT-5 models
- [ ] Gemini `thinking_delta` chunks not handled
- [ ] Mentorship `<thinking>` tags not parsed from text

**Reference**: Chalk CLI handles all these at interactive.ts:1459-1575

#### 2.2 DiffPreview Integration ⚠️
**Status**: Component exists, NOT wired to streaming

**What exists**:
- `DiffPreview.tsx` - Standalone diff component
- `InlineDiffSummary` for tool call headers

**What's missing**:
- [ ] `generateDiffPreview()` function (chalk CLI lines 32-134)
- [ ] Wire to `tool_use_complete` chunk in streaming loop
- [ ] Display diff BEFORE tool execution for approval

**Reference**: Chalk CLI shows diff at line 1601-1619

#### 2.3 Tool Call Formatting ⚠️
**Status**: Basic display, missing result formatting

**What exists**:
- `ToolCallDisplay.tsx` - Shows tool calls
- `ToolGroupDisplay.tsx` - Groups multiple tools
- Tool-specific icons

**What's missing**:
- [ ] Tool RESULT formatting (Bash output, Read lines, etc.)
- [ ] Write tool file preview before execution
- [ ] Error display formatting
- [ ] Status transitions (pending → executing → success/error)

**Reference**: Chalk CLI handles results at lines 1639-1718

#### 2.4 Slash Commands ❌
**Status**: 6 of 20+ commands implemented

**Working**:
- [x] `/help` (basic, missing CommandPalette)
- [x] `/clear`
- [x] `/exit`, `/quit`, `/q`
- [x] `/yolo` (basic toggle)
- [x] `/thinking`
- [x] `/model` (show only)

**Missing** (all in chalk CLI):
- [ ] `/models list` - List all available models
- [ ] `/models switch <id>` - Switch model with reasoning effort
- [ ] `/models info <id>` - Show model details
- [ ] `/session checkpoint` - Create checkpoint
- [ ] `/session list` - List sessions
- [ ] `/cache metrics` - Show cache stats
- [ ] `/cache report` - Full cache report
- [ ] `/mcp list` - List MCP servers
- [ ] `/mcp enable/disable` - Toggle servers
- [ ] `/tools list` - List available tools
- [ ] `/tools info` - Show tool details
- [ ] `/config get/set` - Configuration management
- [ ] `/system-message` - Open system message manager
- [ ] `/init` - Generate CORTEX.md
- [ ] `/continue` - Session browser and resume
- [ ] `/debug` toggle (currently read-only)

#### 2.5 Streaming Display ❌
**Status**: Basic text only

**What's missing**:
- [ ] Markdown rendering (chalk uses `MarkdownRenderer`)
- [ ] Code syntax highlighting
- [ ] Proper line wrapping with terminal width

#### 2.6 Keyboard Shortcuts ⚠️
**Status**: Toggle state but don't affect model

**Working**:
- [x] Tab - toggles `showThinking` state
- [x] Shift+Tab - toggles `autoApprove` state
- [x] ESC - calls cancel (may not fully work)
- [x] Ctrl+C - exits

**Missing**:
- [ ] Tab should toggle `reasoningEffort` for GPT-5 models
- [ ] ESC should reliably abort streaming with feedback prompt

---

### Phase 2 Completion Checklist

**P1 - Must have for parity**:
- [ ] `/models list` and `/models switch`
- [ ] `/continue` (session browser)
- [ ] Markdown rendering in stream
- [ ] Edit diff preview in streaming loop
- [ ] Bash output formatting in results
- [ ] Reasoning effort toggle (Tab for GPT-5)

**P2 - Important for usability**:
- [ ] `/session` commands
- [ ] `/cache` commands
- [ ] `/mcp` commands
- [ ] `/init` command
- [ ] Theme system integration
- [ ] Write file preview
- [ ] Read line count display

**P3 - Nice to have**:
- [ ] `/tools` commands
- [ ] `/config` commands
- [ ] `/system-message` command
- [ ] Full CommandPalette in `/help`

### Phase 3: Enhanced Features (COMPLETE)
**Status**: ✅ Done
**Goal**: Leverage Gemini UI components for better UX

#### 3.1 Multi-line Input ✅
**Status**: Complete

Custom `EnhancedInput` component with:
- [x] Shift+Enter for new lines
- [x] Enter to submit
- [x] Multi-line display with line count
- [x] Visual hints for multi-line mode

#### 3.2 Input History ✅
**Status**: Complete

Integrated directly into `EnhancedInput`:
- [x] Up/Down arrows navigate previous messages
- [x] History position indicator
- [x] ESC to cancel history navigation
- [x] Original input restored when exiting history

#### 3.3 Theme System ✅
**Status**: Complete

Full theme integration:
- [x] 13 professional themes (Tokyo Night, Dracula, Monokai, etc.)
- [x] `/theme` command shows current theme
- [x] `/theme list` shows all themes
- [x] `/theme picker` interactive dialog with live preview
- [x] `/theme set <name>` set by name
- [x] `ThemePickerDialog` component with color preview

#### 3.4 Session Browser
**Priority**: Future enhancement

Display and navigate past sessions with visual browser:
- [ ] Interactive session browser dialog
- Currently `/session list` and `/continue` commands work

### Phase 4: Core Library Integration (COMPLETE)
**Status**: ✅ Done
**Goal**: Expose full `@nexus-cortex/core` capabilities

#### 4.1 Model Switching ✅
- [x] `/models list` command
- [x] `/models switch <id>` command
- [x] `/models info <id>` shows capabilities
- [x] Model displayed in header

#### 4.2 MCP Integration ✅
- [x] `/mcp list` command
- [x] `/mcp enable <server>` command
- [x] `/mcp disable <server>` command

#### 4.3 Session Management ✅
- [x] `/session list` command
- [x] `/continue [id]` resume command
- [x] `/session checkpoint` creation
- [x] JSONL session persistence

#### 4.4 Advanced Features ✅
- [x] `/cache metrics` display
- [x] `/init` CORTEX.md generation
- [x] `/config get/set` runtime config
- [x] `/system-message` management
- [x] `/tools list/info` introspection
- [x] `/debug` toggle

---

## File Structure

### Custom Cortex Files (Compiled)

```
ink-ui/
├── CortexApp.tsx           # Main application [DONE]
├── cortex-types.ts         # Custom types [DONE]
├── colors.ts                   # Color constants [DONE]
├── components/
│   ├── ApprovalDialog.tsx      # Permission UI [DONE]
│   ├── ThinkingDisplay.tsx     # Thinking blocks [DONE] ✅ Phase 2.1
│   ├── DiffPreview.tsx         # Diff integration [DONE] ✅ Phase 2.2
│   ├── ToolCallDisplay.tsx     # Tool call formatting [DONE] ✅ Phase 2.3
│   └── MessageDisplay.tsx      # Message formatting [INLINE] (in CortexApp)
└── hooks/
    ├── useCortexStream.ts  # Core bridge [DONE] - with thinking blocks
    ├── useHistoryManager.ts    # History state [DONE]
    ├── useTerminalSize.ts      # Terminal dims [DONE]
    └── useReactApprovalHandler.ts # Permissions [DONE]
```

### Gemini CLI Files (Reference, Not Compiled)

```
ink-ui/
├── App.tsx                     # Gemini app (reference)
├── AppContainer.tsx            # Gemini container (reference)
├── components/                 # Rich UI components
│   ├── messages/
│   │   ├── DiffRenderer.tsx    # Diff display [INTEGRATE]
│   │   ├── ToolMessage.tsx     # Tool formatting [ADAPT]
│   │   └── ...
│   ├── InputPrompt.tsx         # Multi-line input [ADAPT]
│   ├── SessionBrowser.tsx      # Session UI [ADAPT]
│   └── ...
├── hooks/                      # Utility hooks
│   ├── useGeminiStream.ts      # Skip - we have ours
│   ├── useBracketedPaste.ts    # Integrate
│   ├── useInputHistory.ts      # Integrate
│   └── ...
├── utils/
│   ├── MarkdownDisplay.tsx     # Markdown [INTEGRATE]
│   ├── CodeColorizer.tsx       # Syntax [INTEGRATE]
│   └── ...
└── themes/                     # Theme system [INTEGRATE]
```

---

## tsconfig.json Strategy

The CLI tsconfig explicitly excludes raw Gemini CLI files to prevent build errors. As files are adapted, they should be:

1. Copied to a new location or modified in place
2. Have `@google/gemini-cli-core` imports removed
3. Removed from the exclusion list
4. Type-checked and compiled

Current exclusion count: ~140 files

---

## Permission Model Clarification

Two distinct modes implemented:

### YOLO Mode (`/yolo` command)
- Auto-approves ALL tool calls
- Includes whitelist, graylist, AND blacklist
- For trusted environments only
- Toggle: `/yolo` command

### Auto-Approve Mode (Shift+Tab)
- Auto-approves whitelist and graylist
- Blacklist tools still prompt for confirmation
- Safer default for development
- Toggle: Shift+Tab key

---

## Testing Checklist

### Phase 2 Completion Criteria - ALL COMPLETE ✅

**Core Features**:
- [x] User messages have `❯` prefix
- [x] Assistant messages have `◆` prefix
- [x] Error messages show in red
- [x] Basic text streaming works
- [x] Approval dialog appears for tool calls
- [x] Thinking blocks display with InlineThinkingDisplay
- [x] Tab cycles reasoning effort for reasoning models
- [x] Tool calls show formatted display with ToolGroupDisplay
- [x] Bash tool shows output in result formatting
- [x] Markdown renders with MarkdownText component
- [x] Edit diff preview wired to Edit tool display

**P1 Commands - ALL COMPLETE**:
- [x] `/models list` - List available models
- [x] `/models switch <id>` - Change model mid-session
- [x] `/continue` - Session resume

**P2 Commands - ALL COMPLETE**:
- [x] `/session checkpoint` - Save checkpoint
- [x] `/session list` - Browse sessions
- [x] `/cache metrics` - View cache stats
- [x] `/mcp list/enable/disable` - MCP management
- [x] `/init` - Generate CORTEX.md
- [x] Theme system integration

**P3 Commands - ALL COMPLETE**:
- [x] `/tools list/info` - Tool introspection
- [x] `/config get/set` - Runtime config
- [x] `/system-message` - System message manager
- [x] `/debug` toggle (read-write)

### Phase 3 Completion Criteria (Gemini UI Features) - ALL COMPLETE ✅

- [x] Multi-line input with Shift+Enter
- [x] Input history with up/down arrows
- [x] Theme picker dialog with live preview
- [x] Visual hints for input state
- [x] `/theme` command with subcommands
- [x] `/config` command with get/set
- [x] `/system-message` command

---

## Risk Assessment

| Risk | Status | Mitigation |
|------|--------|------------|
| Import errors from @google/gemini-cli-core | ✅ Mitigated | Local types in cortex-types.ts |
| Build failures from Gemini files | ✅ Mitigated | Explicit tsconfig exclusions |
| Permission flow mismatch | ✅ Mitigated | React-compatible ApprovalHandler |
| Streaming format differences | ⚠️ Ongoing | Careful chunk type handling |
| Context loss during long sessions | ⚠️ Risk | Checkpoint at stable commits |
| Anthropic empty stream errors | ✅ Mitigated | Error handling in OrchestratorClient + UI display |

---

## Commands Reference

### Current Commands

```bash
# New React/Ink UI
neocortex                    # Interactive UI
neocortex --model <id>       # With specific model
neocortex --debug            # Debug logging
neocortex --yolo             # Start with YOLO mode
neocortex --help             # Show help

# Existing Chalk CLI (unchanged)
cortex                 # Interactive chat
cortex chat            # Same as above
cortex models list     # List models
```

### Slash Commands (neocortex)

| Command | Description | Status |
|---------|-------------|--------|
| `/help`, `/?` | Show help with all commands | ✅ |
| `/clear` | Clear conversation history | ✅ |
| `/exit`, `/quit`, `/q` | Exit application | ✅ |
| `/yolo [off]` | Toggle/disable YOLO mode | ✅ |
| `/thinking` | Toggle thinking display | ✅ |
| `/debug` | Toggle debug mode | ✅ |
| `/model` | Show current model | ✅ |
| `/models list` | List available models | ✅ |
| `/models switch <id>` | Switch to model | ✅ |
| `/models info <id>` | Show model details | ✅ |
| `/reasoning [level]` | Set reasoning effort | ✅ |
| `/session list` | List sessions | ✅ |
| `/session checkpoint` | Create checkpoint | ✅ |
| `/continue [id]` | Resume session | ✅ |
| `/cache metrics` | Show cache statistics | ✅ |
| `/mcp list` | List MCP servers | ✅ |
| `/mcp enable <name>` | Enable MCP server | ✅ |
| `/mcp disable <name>` | Disable MCP server | ✅ |
| `/tools list` | List available tools | ✅ |
| `/tools info <name>` | Show tool details | ✅ |
| `/init` | Generate CORTEX.md | ✅ |
| `/theme` | Show current theme | ✅ |
| `/theme list` | List available themes | ✅ |
| `/theme picker` | Interactive theme picker | ✅ |
| `/theme set <name>` | Set theme by name | ✅ |
| `/config` | Show config summary | ✅ |
| `/config list` | List config keys | ✅ |
| `/config get <key>` | Get config value | ✅ |
| `/config set <key> <val>` | Set config value | ✅ |
| `/system-message list` | List system messages | ✅ |
| `/system-message view` | View message content | ✅ |

### Keyboard Shortcuts

| Key | Action | Status |
|-----|--------|--------|
| Tab | Toggle thinking / cycle reasoning | ✅ |
| Shift+Tab | Toggle auto-approve | ✅ |
| ESC | Cancel streaming / Close dialogs / Clear input | ✅ |
| Ctrl+C | Exit | ✅ |
| Up/Down | Navigate input history | ✅ |
| Shift+Enter | Multi-line input (new line) | ✅ |
| Enter | Submit message | ✅ |
| 1-9 | Quick select in theme picker | ✅ |

---

## Next Actions

All planned phases are complete! Potential future enhancements:

1. **Interactive session browser dialog** - Visual browser for `/continue`
2. **Vim keybindings** - Optional vim mode for input
3. **Full CommandPalette** - Interactive command palette like VS Code
4. **Clipboard paste handling** - Better multi-line paste support
5. **Code syntax highlighting** - Enhanced code block display

---

## Rollback Instructions

If issues occur, rollback to stable checkpoints:

**Rollback to Phase 2 (Chalk CLI parity)**:
```bash
git reset --hard a936eab3
npm run build
npm link
```

**Rollback to Phase 1 (Foundation only)**:
```bash
git reset --hard 0deb020a
npm run build
npm link
```

This restores:
- Working `neocortex` command with basic streaming
- Working `cortex` command (unchanged)
- Permission dialog system
- All Phase 1 infrastructure

**Note**: Phase 2 is stable. No rollback should be needed for Phase 2 features.
