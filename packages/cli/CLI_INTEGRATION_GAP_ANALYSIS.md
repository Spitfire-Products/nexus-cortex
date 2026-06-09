# CLI Integration Gap Analysis

**Date:** 2025-11-16
**Status:** Critical integration issues identified
**Core Library:** ✅ Working perfectly (393 tests passing)
**CLI Implementation:** ❌ Not utilizing core features

---

## Executive Summary

The nexus-cortex core library is **exhaustively tested and fully functional**, including:
- Multi-turn tool calling
- Streaming with tool use
- Mentorship middleware
- Interleaved thinking
- 30+ tool executors
- 5 provider adapters
- Session management with checkpoints

However, the CLI implementation in `/packages/cli` is **fundamentally broken** and doesn't utilize any of these features. The chat command passes `tools: []` (disabling all tools), doesn't handle tool events, can't do multi-turn conversations, and has no visual feedback.

---

## Critical Issues

### 1. Tools Are Completely Disabled

**File:** `packages/cli/src/commands/chat/interactive.ts`
**Lines:** 72, 99

```typescript
// Current (WRONG):
tools: [], // Enable all tools ← Passing empty array = NO tools!

// Should be:
// Option A: Omit the tools field entirely (server provides all)
// Option B: Pass full tool schemas from server
// Option C: Pass specific tool names to enable
```

**Impact:** The model cannot use ANY tools. No file operations, no search, no web fetch, no historical context, nothing.

### 2. No Tool Event Handling

**File:** `packages/cli/src/commands/chat/interactive.ts`
**Lines:** 94-111

```typescript
// Current streaming handler only processes text:
for await (const event of client.streamMessage(...)) {
  if (event.type === 'content_block_start') {
    contentBlocks.push(event.content_block);
  } else if (event.type === 'content_block_delta') {
    if (event.delta?.type === 'text_delta') {  // ← ONLY handles text!
      process.stdout.write(event.delta.text);
    }
    // Missing: tool_use, tool_result, thinking, etc.
  }
}
```

**Missing Event Types:**
- `tool_use` - When model decides to use a tool
- `tool_result` - Tool execution result
- `thinking` - Extended thinking blocks (Claude 3.5 Opus)
- `input_json_delta` - Tool parameter streaming
- Multi-turn continuation

**Impact:** No visual feedback when tools are used, no thinking display, streaming appears broken.

### 3. No Multi-Turn Tool Calling Loop

**Problem:** When the model uses a tool, the result needs to be sent back as a new message. The current implementation doesn't do this.

**Current Flow:**
```
User: "Read the file README.md"
  ↓
Model: [tool_use: Read]
  ↓
CLI: Adds to contentBlocks, then... nothing ← BROKEN
```

**Required Flow:**
```
User: "Read the file README.md"
  ↓
Model: [tool_use: Read, id: tool_1]
  ↓
Server: Executes Read tool
  ↓
Server: Returns [tool_result, tool_use_id: tool_1, content: "..."]
  ↓
Model: Receives result, continues conversation
  ↓
Model: [text: "I've read the file. It contains..."]
```

**Impact:** Tool calling completely non-functional. Single-shot only.

### 4. No Session Management in Chat

**Current:** Messages are stored in local array only
```typescript
const messages: Message[] = []; // ← Lost when CLI exits
```

**Missing:**
- Session creation (orchestrator.createSession())
- Session ID tracking
- Message persistence to disk
- Resume capability
- Checkpoint creation

**Impact:** Can't resume conversations, no history persistence, can't use historical context tools.

### 5. No Visual Feedback System

**Current:** Basic `process.stdout.write()` with minimal formatting

**Missing:**
- Ink-based UI components (despite Ink being in dependencies!)
- Tool execution spinners ("🔧 Using tool: Read...")
- Thinking block visualization
- Streaming indicators
- Syntax highlighting
- Progress bars
- Multi-line content formatting

**Impact:** Chat feels unpolished, no indication of what's happening.

### 6. No Server Auto-Start

**Current:** Assumes server is running at localhost:4000

**Missing:**
- Server health check
- Auto-start if not running
- Port detection
- Server lifecycle management

**Impact:** User must manually start server, confusing UX.

### 7. No Approval Flow Integration

The core has `PermissionsMiddleware` with auto/interactive/disabled modes, but CLI doesn't handle approval requests.

**Missing:**
- Approval request event handling
- Interactive Y/N prompts for tool use
- Permission policy display

**Impact:** Can't use interactive approval mode, security features unused.

---

## What the Core Library Provides (And CLI Ignores)

### From CortexOrchestrator

**Public API:**
```typescript
// Session Management
createSession(projectPath, modelId?)
getSessionId()
getMessageHistory()
createCheckpoint(options?)
resumeFromCheckpoint(checkpointId)
listCheckpoints()

// Messaging
sendMessage(messages, options)
streamMessage(messages, options)  // ← Returns full event stream

// Model Management
switchModel(modelId, options?)
getCurrentModel()
listAvailableModels()

// Tools & MCP
getMcpTools()
getMcpServerInfo()
getHistoricalService()

// Permissions
getApprovalMode()
setApprovalMode(mode)
```

**CLI Usage:** Basically none of this is used beyond `streamMessage()` (and that incorrectly).

### From Server Routes

**Available Endpoints:**
```
POST /v1/messages           ← Used, but incorrectly
GET  /sessions              ← CLI has command, but chat doesn't create sessions
GET  /sessions/:id
POST /sessions/:id/resume
GET  /sessions/:id/checkpoints
GET  /models                ← Used
GET  /mcp/servers
POST /mcp/servers/:name/connect
GET  /v1/approval-mode
POST /v1/approval-mode
GET  /health                ← Used
```

**CLI Integration:** Commands exist for most endpoints, but **chat mode doesn't use them**.

### From Tool System

**30+ Tool Executors Ready:**
- File: Read, Write, Edit
- Search: Glob, Grep
- Execution: Shell, BashOutput, KillShell
- Web: WebFetch, WebSearch
- UI: TodoWrite, AskUserQuestion
- Historical: 4 context retrieval tools
- MCP: 7 MCP management tools
- Artifacts: 5 sandbox tools

**CLI Usage:** ❌ All disabled due to `tools: []`

### From Middleware Pipeline

**7 Middleware Systems:**
- ErrorClassificationMiddleware
- RetryMiddleware
- PermissionsMiddleware
- SystemMessageMiddleware
- MentorshipMiddleware
- LoopControlMiddleware
- HelperModelMiddleware

**CLI Awareness:** Zero. These all run server-side, CLI has no visibility.

---

## Root Cause Analysis

### Why Did This Happen?

1. **Misdirected Command System:** Previous agent built 115 commands based on assumptions instead of auditing actual server endpoints

2. **Documentation Overload:** Outdated docs led to building the wrong features

3. **Lost Coherence:** Agent confusion between:
   - REST endpoints (what should be commands)
   - Tool-based operations (should be via natural language)
   - Server-side middleware (not exposed to CLI)

4. **Ink UI Abandoned:** Dependencies installed but never used, fell back to basic readline

5. **No Integration Testing:** CLI commands weren't tested against running server with real tool calls

---

## Recommended Solution

### Phase 1: Fix Core Chat UI (Highest Priority)

**File to Rewrite:** `packages/cli/src/commands/chat/interactive.ts`

**Requirements:**
1. ✅ Enable tools properly (don't pass `tools: []`)
2. ✅ Handle all streaming event types
3. ✅ Multi-turn tool calling loop
4. ✅ Session creation and persistence
5. ✅ Visual feedback (Ink or advanced chalk)
6. ✅ Server auto-start
7. ✅ Approval flow integration

**Estimated Effort:** 2-3 days (with solid core to build on)

### Phase 2: Enhanced Chat Features

1. **Thinking Visualization** - Render extended thinking blocks
2. **Tool Execution Display** - Show what tools are running
3. **Streaming Improvements** - Better formatting, syntax highlighting
4. **Session Management UI** - Resume/checkpoint commands in chat
5. **Model Switching** - Switch models mid-conversation

**Estimated Effort:** 1-2 days

### Phase 3: Ink-Based Interactive UI

Build the Ink components that are referenced but not implemented:
- SessionBrowser
- ModelBrowser
- ArtifactDashboard
- ConfigWizard

**Estimated Effort:** 3-5 days

---

## Correct Architecture

### What Should Be Built

```
CLI Package Structure:

/commands/
  /chat/
    interactive.ts         ← FIX THIS FIRST
    components/           ← Ink UI components
      ChatRenderer.tsx
      ToolUseIndicator.tsx
      ThinkingBlock.tsx
      StreamingText.tsx

  /ui/                    ← Ink interactive dashboards
    sessions.ts           ← Already exists, not wired
    models.ts
    artifacts.ts

  /models/                ← Simple REST wrappers
    list.ts
    info.ts

  /sessions/              ← Simple REST wrappers
    list.ts
    view.ts
    resume.ts

  /server/
    start.ts              ← Auto-start logic

/client/
  CortexClient.ts     ← Already good, minor improvements

/renderer/                ← NEW: Event rendering system
  EventRenderer.ts        ← Handles all SSE events
  ToolRenderer.ts         ← Tool use/result display
  ThinkingRenderer.ts     ← Thinking block rendering
```

### Event Flow (Correct)

```
1. User inputs message
2. CLI checks server health, auto-starts if needed
3. CLI creates/resumes session
4. CLI sends message with tools enabled
5. Server/Core processes with full middleware pipeline
6. Server streams events back:
   - message_start
   - content_block_start (type: text or tool_use)
   - content_block_delta (text_delta or input_json_delta)
   - content_block_stop
   - [if tool_use] Server executes tool
   - [if tool_use] Server sends tool_result back to model
   - [model continues] New content blocks with tool analysis
   - message_stop
7. CLI renders each event type appropriately
8. CLI persists session
9. Ready for next input
```

---

## Files to Fix (Priority Order)

### 1. Critical (Do First)

- `packages/cli/src/commands/chat/interactive.ts` - Main chat (REWRITE)
- `packages/cli/src/client/CortexClient.ts` - Minor fixes for tool schemas

### 2. High Priority

- `packages/cli/src/renderer/` - NEW directory for event rendering
- `packages/cli/src/commands/server/start.ts` - Auto-start logic

### 3. Medium Priority

- `packages/cli/src/commands/ui/*.ts` - Ink components (already scaffolded, need implementation)
- `packages/cli/src/themes/` - Theme system refinement

### 4. Low Priority

- Command cleanup (remove commands that should be tool-based)
- Documentation updates

---

## Testing Strategy

### Integration Tests Needed

1. **Chat + Tool Calling**
   ```bash
   # Start server
   # Run chat
   # User: "read the file README.md"
   # Verify: Tool use event, tool result, model response with content
   ```

2. **Multi-Turn Tool Loop**
   ```bash
   # User: "find all typescript files and count them"
   # Verify: Glob tool, then Shell tool, then model analysis
   ```

3. **Session Persistence**
   ```bash
   # Start chat, send message, exit
   # Resume chat
   # Verify: History maintained
   ```

4. **Streaming with Thinking**
   ```bash
   # Use Claude 3.5 Opus
   # User: Complex reasoning task
   # Verify: Thinking blocks render
   ```

---

## Next Steps

### Immediate Actions

1. **Read Reference Implementation**
   - Check if there's a working Gemini CLI or Claude Code CLI to reference
   - Look at how they handle streaming + tool calling

2. **Create Test Harness**
   - Start server in test mode
   - Send messages with tool use
   - Capture full event stream
   - Document expected events

3. **Rewrite interactive.ts**
   - Use Ink for UI
   - Proper event handling
   - Multi-turn loop
   - Session management

4. **Test Against Core**
   - Verify all 393 core tests still pass
   - Run integration tests
   - Verify tool calling works end-to-end

---

## Questions to Answer

1. **Should CLI use Ink or stick with chalk?**
   - Ink is in dependencies but unused
   - Would enable richer UI
   - Decision needed

2. **How to get full tool schemas?**
   - Should CLI fetch from `/tools` endpoint?
   - Or use tool definitions from core?
   - Need to clarify pattern

3. **Session lifecycle:**
   - One session per CLI invocation?
   - Or persistent session across runs?
   - Need to define UX

4. **Approval mode:**
   - How should interactive mode work?
   - Y/N prompts during tool use?
   - Or separate approval command?

---

## Conclusion

**The core library is excellent.** The architecture is sound, tests are comprehensive, features are implemented.

**The CLI is essentially a stub.** It calls the server but doesn't use 90% of the features.

**The fix is clear:** Rewrite `interactive.ts` to properly consume the rich event stream from the server, enable tools, handle multi-turn conversations, and add visual polish.

**Estimated total effort:** 5-10 days to get CLI to feature parity with core.

---

## References

- Core AUDIT: `/packages/core/AUDIT.md`
- Executors AUDIT: `/packages/executors/AUDIT.md`
- Server AUDIT: `/packages/server/AUDIT.md`
- Source of Truth: `/packages/cli/docs/specification_docs_pre_audit/SOURCE_OF_TRUTH_ANALYSIS.md`
- Server Routes: `/packages/server/src/routes/messages.ts`
- Orchestrator API: `/packages/core/src/orchestrator/CortexOrchestrator.ts`
