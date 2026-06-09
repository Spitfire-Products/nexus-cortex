# Tool Streaming Limitation - Current Status

**Date**: 2025-11-16
**Issue**: Simple tool requests break conversation display in streaming mode

---

## 🔍 ROOT CAUSE ANALYSIS

### What I Found in the V4 Codebase

**File**: `packages/core/src/orchestrator/CortexOrchestrator.ts:1386`

```typescript
// Note: Streaming version doesn't handle multi-turn tool calling (yet)
```

**Current Streaming Implementation** (`streamMessage` function, line 1237):
1. Streams text chunks from provider
2. Yields chunks to client in real-time
3. Waits for stream to complete
4. Saves final message to history
5. **Does NOT handle tool execution in the stream**

### Event Types Actually Streamed

From `packages/core/src/orchestrator/APIClient.ts`:

**Text Events** (work correctly):
```typescript
{
  type: 'text_delta',
  delta: "the actual text",
  data: {...}
}
```

**Thinking Events** (internal reasoning - now skipped):
```typescript
{
  type: 'content_block_delta',
  delta: "reasoning text",
  data: { ...event, reasoning: true }
}
```

**Tool Events** (NOT streamed):
- Tool use events: Not yielded in stream
- Tool results: Not yielded in stream
- Tool execution happens server-side AFTER streaming completes

### Why Tool Requests Break Display

When the model wants to use a tool:
1. ❌ Stream ends with no visible output (tool_use block not displayed)
2. ❌ Chat waits indefinitely for text that never comes
3. ❌ User sees "Assistant: " with nothing after it
4. ❌ Conversation appears frozen

---

## ✅ WHAT WAS FIXED

### Streaming Event Parsing
**Fixed**: Chat now correctly parses streaming events from V4 server
- ✅ `text_delta` events display properly
- ✅ `content_block_delta` (thinking) events are skipped
- ✅ Unknown events don't break the display

**File**: `packages/cli/src/commands/chat/interactive.ts`

```typescript
// Correct parsing:
if (event.type === 'text_delta') {
  const text = typeof event.delta === 'string' ? event.delta : event.delta?.text || '';
  process.stdout.write(text);
}
```

### What Works Now
- ✅ Simple questions (no tools needed)
- ✅ Streaming responses display character-by-character
- ✅ Thinking traces are skipped (not displayed)
- ✅ Conversation history maintained

---

## ❌ WHAT STILL DOESN'T WORK

### Tool Execution in Streaming Mode
**Status**: Not implemented in V4 orchestrator

**Example that breaks**:
```
User: List files in current directory
Assistant: [hangs - no output]
```

**Why**: Model returns tool_use block, but:
1. Orchestrator doesn't execute tools during streaming
2. No text is generated to display
3. Chat appears frozen

### Current Limitations
1. ❌ Tool requests don't work in streaming mode
2. ❌ No visual indicator when tools are being called
3. ❌ No display of tool results
4. ❌ Multi-turn tool conversations not supported

---

## 🔧 POTENTIAL FIXES

### Option 1: Implement Tool Streaming (Complex)
**Modify**: `packages/core/src/orchestrator/CortexOrchestrator.ts`

Add to `streamMessage` function:
```typescript
// After streaming text, check for tool_use blocks
if (assistantMessage.content has tool_use) {
  // Execute tools
  for (tool_use in tools) {
    yield { type: 'tool_start', name: tool.name };
    const result = await executeTool(tool);
    yield { type: 'tool_result', result };
  }

  // Continue with next model turn
  yield* this.streamMessage(history + tool_results, options);
}
```

**Complexity**: High - requires full tool execution loop in streaming mode

### Option 2: Fall Back to Non-Streaming for Tools (Simple)
**Modify**: `packages/cli/src/commands/chat/interactive.ts`

```typescript
// Detect if response needs tools
const needsTools = /* some heuristic */;

if (needsTools) {
  // Use non-streaming API
  const response = await client.sendMessage(messages, options);
  console.log(response.content);
} else {
  // Use streaming API
  for await (const event of client.streamMessage(messages, options)) {
    // ... existing code
  }
}
```

**Complexity**: Medium - need to detect tool requirements

### Option 3: Show Placeholder for Tool Execution
**Modify**: Chat interface to detect when stream ends with no text

```typescript
if (fullResponse === '' && streamEnded) {
  console.log('[Model is calling tools - waiting for results...]');
  // Then what? Still hangs...
}
```

**Complexity**: Low but doesn't fully solve the problem

### Option 4: Disable Streaming When Tools Present (Immediate)
**Modify**: `packages/server/src/routes/messages.ts`

```typescript
// Force non-streaming if tools are provided
const shouldStream = stream && (!tools || tools.length === 0);

if (shouldStream) {
  // ... streaming code
} else {
  // ... non-streaming code
}
```

**Complexity**: Very low - quick fix but loses streaming for tool-capable conversations

---

## 📊 CURRENT STATUS

### Works
- ✅ Streaming text responses (no tools)
- ✅ Simple Q&A
- ✅ Multi-turn text conversations
- ✅ Thinking traces hidden properly

### Doesn't Work
- ❌ Any request that triggers tool use
- ❌ File operations
- ❌ Code execution requests
- ❌ Search/web queries
- ❌ Multi-turn tool conversations

### Impact
**High** - Many coding tasks require tools, making the chat limited for real development work

---

## 💡 RECOMMENDATION

**Immediate** (1-2 hours):
1. Implement Option 4: Disable streaming when tools are present
2. This makes tool requests work, even if not streamed
3. User can at least get responses from tool-based requests

**Short-term** (1-2 days):
1. Add visual indicators for tool execution
2. Show "Calling tool: bash..." messages
3. Display tool results in formatted boxes
4. Better than silent waiting

**Long-term** (1-2 weeks):
1. Implement full tool streaming in orchestrator
2. Stream tool execution events
3. Support multi-turn tool conversations in streaming mode
4. Match the rich tool visualization originally envisioned

---

## 🎯 NEXT STEP FOR USER

**Test the current limitation**:
```bash
cortex
You: list files
Assistant: [hangs]
```

**Workaround until fixed**:
- Stick to questions that don't require tools
- Or implement Option 4 to disable streaming when tools might be needed

---

**Created**: 2025-11-16, after discovering tool streaming limitation
**Status**: Documented, not yet fixed
