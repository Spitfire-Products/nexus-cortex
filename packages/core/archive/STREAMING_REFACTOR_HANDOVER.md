# Streaming Refactor Handover Report

**Date**: 2025-11-05
**Status**: Partial completion - Core refactoring done, test failures remain
**Priority**: HIGH - Need systematic debugging using grounded research methodology

---

## What Was Accomplished

### ✅ Core Streaming Refactoring (COMPLETED)

**Problem Identified**: Streaming was implemented as a parallel architecture that bypassed `GatewayTranslationLayer`, creating duplicate conversion logic and violating the established architectural pattern.

**Solution Implemented**: Removed parallel streaming system and integrated streaming directly into the existing request flow.

**Files Modified**:
1. **`src/orchestrator/APIClient.ts`** - Added streaming methods:
   - `streamRequest()` - Routes to appropriate streaming method based on API pattern
   - `streamAnthropicRequest()` - Anthropic Messages API streaming
   - `streamOpenAIRequest()` - OpenAI Chat Completions streaming
   - `streamGoogleRequest()` - Google GenerateContent streaming

2. **`src/orchestrator/OmniClaudeOrchestrator.ts`** - Updated `streamMessage()`:
   - Now uses `APIClient.streamRequest()` instead of StreamingAdapterRegistry
   - Added chunk parsing methods: `parseAnthropicChunk()`, `parseOpenAIChunk()`, `parseGeminiChunk()`
   - Fixed tools handling: When `tools: []` is passed, now respects it instead of adding defaults

3. **`src/streaming/index.ts`** - Cleaned up to export only types

**Files Deleted**:
- `src/streaming/adapters/` (entire directory)
- `src/streaming/StreamingAdapterRegistry.ts`
- `src/streaming/StreamingAdapter.interface.ts`
- `src/streaming/StreamingEventEmitter.ts`

**Architecture Now Correct**:
```
User Input → Canonical Messages → GatewayTranslationLayer → PreparedRequest → APIClient → Provider SDK
                                                                                    ↓
                                                                            (streaming or non-streaming)
```

### ✅ Additional Fixes

1. **Updated deprecated models** in tests and helper middleware:
   - `claude-3-haiku-20240307` → `claude-3-5-haiku-20241022`
   - `gemini-1.5-flash` → `gemini-2.5-flash`
   - `grok-beta` → `grok-3`
   - `grok-4-0709` → `grok-3`
   - `grok-code-fast-1` → `grok-3`

2. **Fixed tools handling in `streamMessage()`** (line 995-1004):
   - When `options.tools` is explicitly provided (even if empty array), use ONLY those tools
   - Don't add factory/MCP/management tools when user explicitly passed tools

---

## Current Problems

### 🔴 Test Failures (3 out of 6 tests failing)

**Passing Tests**:
- ✅ Claude (Anthropic) individual streaming test
- ✅ GPT-4 (OpenAI) individual streaming test
- ✅ Gemini (Google) individual streaming test

**Failing Tests**:
1. **Multi-provider streaming test** - Error: `"messages: text content blocks must be non-empty"`
2. **Performance test** - Same error
3. **Gemma fallback test** - Error: `"No response message returned from provider"` (separate issue)

**Key Observation**: Individual provider tests PASS, but tests that run AFTER other tests (with accumulated message history) FAIL.

**Error Location**: The error occurs when calling Anthropic's API in the 4th, 5th, or 6th test after message history has accumulated from previous tests.

### Root Cause Hypothesis

The error "text content blocks must be non-empty" suggests malformed message content being sent to Anthropic. Since:
- Individual tests pass (fresh orchestrator state)
- Later tests fail (accumulated history)
- Hundreds of other smoke tests with conversation context work fine

**The bug is likely in how `streamMessage()` saves assistant responses to history**, causing subsequent calls to have malformed messages.

---

## Critical Context: Working Reference Code

### 📚 **MANDATORY READING BEFORE DEBUGGING**

The core library has **hundreds of working smoke tests** that successfully:
- Maintain conversation context across multiple turns
- Handle tool calling and function calls
- Work with all providers (Anthropic, OpenAI, Google, XAI, DeepSeek)
- Process complex multi-turn conversations

**These tests ALL use `sendMessage()` which works perfectly.**

### Working Test Examples

1. **`src/orchestrator/__tests__/smoke/orchestrator-real-api-smoke.test.ts`**
   - Lines 53-64: Multi-turn conversation with context
   - Uses same orchestrator instance across multiple calls
   - Message history accumulates correctly
   - No formatting errors

2. **`src/adapters/__tests__/smoke/adapter-integration-smoke.test.ts`**
   - Extensive real API testing with all providers
   - Tool calling tests
   - Multi-turn conversations

3. **`src/middleware/__tests__/HelperModelMiddleware.test.ts`**
   - Helper model interactions
   - Complex conversation flows

### How `sendMessage()` Works (THE REFERENCE IMPLEMENTATION)

**Key Pattern** (lines 590-615 in `OmniClaudeOrchestrator.ts`):

1. **User message creation** - Check how the user message content is structured
2. **Response conversion** (line 591-599):
   ```typescript
   const convertedResponse = this.gatewayTranslation.convertResponse(
     apiResponse.data,
     effectiveModel,
     { sessionId, conversationId, turnNumber }
   );
   ```
3. **Extract canonical message** (line 605):
   ```typescript
   const assistantCanonicalMessage = convertedResponse.messages[0]!;
   ```
4. **Save to history** (line 609-616):
   ```typescript
   const assistantMessage: Message = {
     uuid: assistantMessageId,
     timestamp: assistantCanonicalMessage.timestamp,
     type: 'assistant',
     message: {
       role: 'assistant',
       content: assistantCanonicalMessage.content as any // Content blocks array from adapter
     },
     // ... timeline, model
   };
   ```

**Critical Detail**: The `content` field comes from `assistantCanonicalMessage.content`, which was properly converted by `GatewayTranslationLayer.convertResponse()` using the adapter's `fromProviderMessages()` method.

### What's Different in `streamMessage()`

**Lines 1050-1060 in `OmniClaudeOrchestrator.ts`**:
```typescript
const assistantMessage: AssistantMessage = {
  type: 'assistant',
  uuid: uuidv4(),
  timestamp: new Date().toISOString(),
  message: {
    role: 'assistant',
    content: [{
      type: 'text',
      text: accumulatedText  // Manually constructed - is this correct?
    }]
  },
  // ... timeline, model
};
```

**The streamMessage() implementation manually constructs the content blocks instead of using the adapter's conversion.**

---

## Debugging Methodology (MANDATORY APPROACH)

### 🎯 Phase 1: Understand the Working Code (DO THIS FIRST)

**STOP making blind guesses. START with grounded research.**

1. **Read `sendMessage()` implementation completely** (lines 400-700):
   - How is the user message created?
   - What format is `message.content`?
   - How is message history converted?
   - How are responses processed?

2. **Read `convertToCanonicalMessages()`** (find this method):
   - How does it handle different content formats?
   - What does it expect for `message.content`?
   - How does it create content blocks?

3. **Read a working adapter** (e.g., `MessagesAPIAdapter.ts`):
   - Look at `fromProviderMessages()` method
   - See how it structures content blocks
   - Understand the canonical format

4. **Read working tests**:
   - `orchestrator-real-api-smoke.test.ts` - See how multi-turn conversations work
   - Look at test patterns that maintain context
   - Note how messages are created

### 🎯 Phase 2: Compare Working vs Broken

1. **Add debug logging** to see actual message format:
   ```typescript
   // In convertToCanonicalMessages()
   console.log('[DEBUG] Converting message:', JSON.stringify(msg, null, 2));

   // In GatewayTranslationLayer.prepareRequest()
   console.log('[DEBUG] Canonical history:', JSON.stringify(canonicalHistory, null, 2));
   console.log('[DEBUG] Provider messages:', JSON.stringify(providerMessages, null, 2));
   ```

2. **Run one passing test** and capture the format of messages in history

3. **Run one failing test** and compare the message format

4. **Identify the exact difference** in message structure

### 🎯 Phase 3: Fix Based on Evidence

1. **Match the format** used by `sendMessage()` exactly
2. **Don't guess** - copy the working pattern
3. **Test incrementally** - one fix at a time
4. **Verify** with both individual and multi-turn tests

---

## Specific Investigation Points

### Question 1: What format should `message.content` be?

**Action**:
- Read how `sendMessage()` creates user messages (around line 400-450)
- Check if it's a string or content blocks array
- Look at `convertToCanonicalMessages()` to see what it expects

### Question 2: How should streaming responses be saved?

**Action**:
- Compare lines 1050-1068 in `streamMessage()` with lines 609-627 in `sendMessage()`
- Check if the content block structure matches
- Verify the content blocks have all required fields

### Question 3: Is there a helper method we should use?

**Action**:
- Search for methods that create content blocks
- Look for utility functions that format messages
- Check if there's a method to convert text to content blocks

---

## Files to Review

**Priority 1 (MUST READ)**:
1. `src/orchestrator/OmniClaudeOrchestrator.ts` - `sendMessage()` method (lines 400-700)
2. `src/orchestrator/OmniClaudeOrchestrator.ts` - `convertToCanonicalMessages()` method
3. `src/adapters/MessagesAPIAdapter.ts` - `fromProviderMessages()` method
4. `src/adapters/FormatAdapter.interface.ts` - Canonical message format definitions

**Priority 2 (Supporting Context)**:
5. `src/orchestrator/__tests__/smoke/orchestrator-real-api-smoke.test.ts` - Working multi-turn tests
6. `src/adapters/GatewayTranslationLayer.ts` - `convertResponse()` method
7. `src/session/MessageTypes.ts` - Message type definitions

---

## Test Commands

```bash
# Run only streaming tests
ENABLE_SMOKE_TESTS=true npm test -- streaming-basic-smoke.test.ts --run

# Run working orchestrator tests for comparison
ENABLE_SMOKE_TESTS=true npm test -- orchestrator-real-api-smoke.test.ts --run

# Build after changes
npm run build
```

---

## Key Learnings

1. **Don't bypass existing architecture** - The parallel streaming system failed because it didn't use `GatewayTranslationLayer`

2. **Look at working code first** - Hundreds of tests work perfectly; they show the correct pattern

3. **Message format is critical** - The canonical format must be exact or adapters fail

4. **Test isolation matters** - Individual tests pass, accumulated history fails = history storage bug

5. **Grounded research > guessing** - Reading working code is faster than trial and error

---

## Next Session Directive

**DO NOT MAKE CODE CHANGES UNTIL YOU:**

1. ✅ Read `sendMessage()` completely and understand how it creates/saves messages
2. ✅ Read `convertToCanonicalMessages()` and understand the expected format
3. ✅ Compare the exact format of messages in working vs broken tests
4. ✅ Identify the precise difference causing "text content blocks must be non-empty"

**THEN AND ONLY THEN:**
- Make targeted fixes based on evidence
- Match the working pattern exactly
- Test incrementally

**Remember**: The system works perfectly in hundreds of tests. If streaming fails, it's because streaming does something different from the working code. Find what's different, match the working pattern.

---

## Status Summary

| Component | Status | Notes |
|-----------|--------|-------|
| Streaming architecture | ✅ Refactored | Now uses APIClient + GatewayTranslationLayer |
| Parallel adapters | ✅ Removed | Deleted all streaming adapter files |
| Tools handling | ✅ Fixed | Respects explicit tools parameter |
| Model deprecation | ✅ Updated | Using current supported models |
| Individual streaming | ✅ Working | Claude, GPT-4, Gemini pass |
| Multi-turn streaming | 🔴 Broken | History accumulation causes format errors |
| Root cause | ⚠️ Not confirmed | Hypothesis: message format in history |

**Overall**: 80% complete. Core refactoring successful. Need systematic debugging of message format issue.
