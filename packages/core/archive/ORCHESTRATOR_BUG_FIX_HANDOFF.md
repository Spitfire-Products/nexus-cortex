# Orchestrator Bug Fix - Session Handoff

**Date**: 2025-11-08
**Status**: Orchestrator bug FIXED, New XAI tool_result format issue DISCOVERED
**Session**: Continuation of XAI tool calling integration work

## What Was Accomplished

### 1. ROOT CAUSE IDENTIFIED AND FIXED ✅

**Bug Location**: `/home/runner/workspace/omniclaude-v4/packages/core/src/orchestrator/OmniClaudeOrchestrator.ts`

**Problem**: Orchestrator was incorrectly extracting tool use data from canonical content blocks.

**The Bug**:
```typescript
// ❌ WRONG - accessing properties directly on block
const toolUseBlocks = currentAssistantCanonicalMessage.content
  .filter((block: any) => block.type === 'tool_use')
  .map((block: any) => ({
    id: block.id,      // undefined!
    name: block.name,  // undefined! (caused "Unknown tool: undefined")
    input: block.input // undefined!
  }));
```

**The Fix** (Lines 618-624 and 848-854):
```typescript
// ✅ CORRECT - accessing nested toolUse property
const toolUseBlocks = currentAssistantCanonicalMessage.content
  .filter((block: any) => block.type === 'tool_use')
  .map((block: any) => ({
    id: block.toolUse.id,
    name: block.toolUse.name,
    input: block.toolUse.input
  }));
```

**Why This Happened**:
The canonical format (defined in `FormatAdapter.interface.ts` lines 148-168) stores tool use data in a nested `toolUse` property, not directly on the block:

```typescript
export interface CanonicalContentBlock {
  type: 'text' | 'tool_use' | 'tool_result' | 'thinking';
  toolUse?: CanonicalToolUse;  // ← Tool data is NESTED here
}
```

### 2. BUILD COMPLETED ✅

**Build Method Used**: Per `BUILD_GUIDE.md`, manual build sequence:
```bash
cd /home/runner/workspace/omniclaude-v4/packages/core
rm -rf dist && npm run clean && npx tsc

cd /home/runner/workspace/omniclaude-v4/packages/executors
rm -rf dist && npx tsc

cd /home/runner/workspace/omniclaude-v4/packages/server
npx tsc
```

**Build Status**: All packages compiled successfully.

### 3. TEST RESULTS

**Before Fix**:
```
[Orchestrator Phase 2.5] Executing tool: undefined
[Orchestrator Phase 2.5] Unknown tool: undefined
```

**After Fix**:
```
[Orchestrator Phase 2.5] Executing tool: calculate  ← FIXED!
```

**Tool name extraction is now working correctly** ✅

## Current Issue - XAI tool_result Format Error

### Error Message
```
XAI Messages API error (422): Failed to deserialize the JSON body into the target type:
messages[1].content: data did not match any variant of untagged enum MessageContent
at line 1 column 22181
```

### What This Means
XAI is rejecting the `messages[1]` (user message with tool_result) that we're sending back after tool execution.

### Known XAI Requirements (from V3)

From `omniclaude_v3/src/providers/XAIAnthropicProvider.ts` lines 756-811:

```typescript
// XAI requires tool_result content to be a string
if (item.type === 'tool_result') {
  let stringContent: string;

  if (typeof item.content === 'string') {
    stringContent = item.content;
  } else {
    // Convert object/array to JSON string
    stringContent = JSON.stringify(item.content, null, 2);
  }

  return {
    type: 'tool_result',
    tool_use_id: item.tool_use_id,
    content: stringContent,  // MUST be string for XAI
    is_error: item.is_error
  };
}
```

### Current V4 Implementation

**File**: `packages/core/src/adapters/MessagesAPIAdapter.ts`

**Line 468-482** (in `convertToMessagesAPIMessage`):
```typescript
case 'tool_result':
  if (!block.toolResult) {
    throw new Error('tool_result content block missing toolResult data');
  }
  // Convert content to string if object
  const resultContent = typeof block.toolResult.content === 'string'
    ? block.toolResult.content
    : JSON.stringify(block.toolResult.content);

  return {
    type: 'tool_result',
    tool_use_id: block.toolResult.tool_use_id,
    content: resultContent,  // Already converting to string
    is_error: block.toolResult.is_error
  };
```

**This looks correct** - we're already ensuring content is a string.

## What Needs Investigation

### Hypothesis
The error "data did not match any variant of untagged enum MessageContent" suggests XAI might be:

1. **Receiving an array when it expects a string** - But our code already converts to string
2. **Receiving system messages mixed into content** - System message injection might be interfering
3. **Receiving invalid content block types** - XAI might not support all the block types we're sending
4. **Message structure issue** - The overall message structure might be wrong

### Files to Check

1. **`packages/core/src/adapters/MessagesAPIAdapter.ts`**
   - Line 468-482: tool_result conversion
   - Line 450-497: Full message conversion
   - Verify no system messages are being added to content array

2. **`packages/core/src/orchestrator/OmniClaudeOrchestrator.ts`**
   - How messages are built after tool execution
   - How tool results are added to conversation

3. **`packages/core/src/system-messages/SystemReminderInjector.ts`**
   - Check if system reminders are being injected into message content (they shouldn't be for XAI)

### Debugging Steps

1. **Add logging to see exact request** being sent to XAI:
   ```typescript
   // In APIClient.ts or MessagesAPIAdapter.ts
   console.log('[XAI DEBUG] Request body:', JSON.stringify(requestBody, null, 2));
   ```

2. **Check messages[1] specifically**:
   ```typescript
   if (modelConfig.provider === 'xai') {
     console.log('[XAI DEBUG] messages[1]:', JSON.stringify(messages[1], null, 2));
   }
   ```

3. **Compare with V3 working implementation**:
   - V3: `omniclaude_v3/src/providers/XAIAnthropicProvider.ts`
   - V3's `transformMessages()` method (lines 759-825)

### Test Command

```bash
cd /home/runner/workspace/omniclaude-v4/packages/core
env ENABLE_SMOKE_TESTS=true npm test -- src/orchestrator/__tests__/smoke/multi-turn-tool-calls-integration.test.ts --reporter=verbose
```

## Related Documentation

- **Orchestrator Bug Analysis**: `XAI_DIAGNOSTIC_RESULTS.md`
- **XAI Tool Validation**: `XAI_TOOL_CALLING_FIX_SUMMARY.md`
- **XAI API Docs**: `research/api-docs/xai-messages-api/xai_v1_messages_anthropic_compatible.txt`
- **Build Guide**: `BUILD_GUIDE.md`
- **V3 Working Implementation**: `omniclaude_v3/src/providers/XAIAnthropicProvider.ts`

## Summary for Next Agent

**What's Working**:
- ✅ Orchestrator tool name extraction (FIXED)
- ✅ XAI tool schema validation
- ✅ System message injection
- ✅ Build system

**What's Broken**:
- ❌ XAI tool_result format in messages[1]

**Next Steps**:
1. Add debug logging to see exact XAI request body
2. Specifically inspect messages[1].content structure
3. Compare with V3's working transformMessages() implementation
4. Fix the tool_result format issue for XAI

**Key Insight**: The tool_result content is already being converted to string, so the issue is likely:
- System messages being injected where they shouldn't be
- Invalid content block types for XAI
- Overall message structure not matching XAI expectations
