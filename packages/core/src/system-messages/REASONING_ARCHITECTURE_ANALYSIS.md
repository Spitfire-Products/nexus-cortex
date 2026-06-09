# Reasoning & Thinking Blocks - Architecture Analysis

## Executive Summary

Model reasoning (thinking blocks) is **partially implemented** but not fully integrated with the system message injection system or helper model workflows. This document analyzes current implementation, identifies gaps, and proposes integration strategies.

## Current Implementation Status

### 1. Canonical Format Support ✅ IMPLEMENTED

**Location**: `src/adapters/FormatAdapter.interface.ts:148-168`

Thinking blocks are fully supported in canonical format:

```typescript
export interface CanonicalContentBlock {
  /** Content type */
  type: 'text' | 'tool_use' | 'tool_result' | 'thinking';

  /** Text content (for type: text) */
  text?: string;

  /** Tool use details (for type: tool_use) */
  toolUse?: CanonicalToolUse;

  /** Tool result details (for type: tool_result) */
  toolResult?: CanonicalToolResult;

  /** Thinking/reasoning content (for type: thinking) */
  thinking?: string;
}

export interface CanonicalMessage {
  // ...
  /** Message type */
  type: 'text' | 'tool_request' | 'tool_response' | 'thinking' |
        'compact_boundary' | 'model_switch' | 'checkpoint' | 'resume';

  /** Message content blocks */
  content: CanonicalContentBlock[];
  // ...
}
```

**Key Points**:
- Thinking blocks are first-class content blocks
- Messages can be typed as 'thinking'
- Thinking content stored as string

### 2. Adapter Conversion ✅ IMPLEMENTED

**Location**: `src/adapters/MessagesAPIAdapter.ts:463-465, 519-533`

Adapters handle thinking blocks bidirectionally:

**Canonical → Provider (MessagesAPI)**:
```typescript
case 'thinking':
  return { type: 'thinking', thinking: block.thinking || '' };
```

**Provider → Canonical**:
```typescript
} else if (block.type === 'thinking' && 'thinking' in block) {
  contentBlocks.push({ type: 'thinking', thinking: block.thinking });
}

// Determine message type
let messageType: CanonicalMessage['type'] = 'text';
if (contentBlocks.some(b => b.type === 'tool_use')) {
  messageType = 'tool_request';
} else if (contentBlocks.some(b => b.type === 'tool_result')) {
  messageType = 'tool_response';
} else if (contentBlocks.some(b => b.type === 'thinking')) {
  messageType = 'thinking';
}
```

**Key Points**:
- Thinking blocks converted to/from provider formats
- Message type set to 'thinking' when thinking blocks present
- Bidirectional conversion preserves thinking content

### 3. Storage to JSONL ✅ ASSUMED WORKING

Since:
1. Thinking blocks are canonical content blocks
2. Adapters convert thinking to canonical format
3. Canonical messages are stored in JSONL via JSONLHistoryStore
4. No special filtering removes thinking blocks

**Conclusion**: Thinking blocks ARE stored in JSONL session files.

**UUID Association**: Yes, thinking blocks are part of CanonicalMessage which has a UUID.

### 4. Model Config Support ⚙️ DEFINED BUT UNUSED

**Location**: `src/models/ModelConfig.interface.ts:235-244`

ModelConfig interface HAS reasoning configuration:

```typescript
reasoning?: {
  /** Whether extended reasoning is supported */
  supported: boolean;

  /** How reasoning output is formatted */
  format?: 'reasoning_content' | 'thinking_block';

  /** How to extract reasoning from response */
  extractionMethod?: 'content_block' | 'separate_field';
};
```

**But**: Model cards don't currently use this field.

**Status**: Defined in interface but not leveraged in model cards or system logic.

### 5. System Message for Reasoning ✅ IMPLEMENTED BUT NOT INJECTED

**Location**: `src/system-messages/messages/REASONING_GUIDE.md` (185 lines)

Comprehensive guide for reasoning models:

```markdown
# Reasoning Model Guide

You are a reasoning-capable model with **interleaved reasoning**.

## Thinking Blocks

When you need to reason through a problem, you can include `<thinking>` blocks:

<thinking>
Let me work through this step by step:
1. The user asked for X
2. To accomplish X, I need to do Y and Z
3. Let me start with Y by calling tool_A
</thinking>

## Interleaved Pattern

Reasoning can be interleaved with tool calls and responses:

<thinking>I need to find all TypeScript files first</thinking>
[tool_use: Glob with pattern **/*.ts]
[tool_result: Found 3 files]
<thinking>Now I should read the main file to understand the structure</thinking>
[tool_use: Read main.ts]
```

**Registry Entry**: `src/system-messages/system-message-registry.json`

```json
{
  "id": "reasoning_guide",
  "name": "Reasoning Model Guide",
  "file": "messages/REASONING_GUIDE.md",
  "conditions": {
    "modelCapabilities": ["reasoning"]  // ← CONDITION EXISTS
  },
  "injection": {
    "position": "prepend",
    "role": "system",
    "priority": 4
  },
  "cache": true,
  "description": "Injected for models with reasoning capabilities (o1, DeepSeek Reasoner, etc.)"
}
```

**Problem**: Model cards don't expose 'reasoning' capability, so condition never triggers.

### 6. Orchestrator Handling ❌ NOT IMPLEMENTED

**Observation**: No special handling for thinking blocks in Orchestrator:
- No filtering of thinking blocks
- No summarization logic
- No reinjection strategy
- Thinking blocks treated like any other content

## Key Questions & Answers

### Q1: Is reasoning stored in canonical storage?

**Answer**: **YES**

Thinking blocks are:
1. Converted to canonical format by adapters (MessagesAPIAdapter.ts:519-521)
2. Included in CanonicalMessage content array
3. Stored in JSONL via JSONLHistoryStore
4. Associated with message UUID

**Example JSONL Entry** (conceptual):
```json
{
  "uuid": "msg_abc123",
  "timestamp": "2025-11-07T10:00:00Z",
  "role": "assistant",
  "type": "thinking",
  "content": [
    {
      "type": "thinking",
      "thinking": "Let me work through this step by step...\n1. User wants X\n2. I should use tool Y"
    }
  ],
  "timeline": {...},
  "model": {...}
}
```

### Q2: Is reasoning re-added to conversation stream?

**Answer**: **YES (implicitly)**

When Orchestrator converts stored messages to canonical format for API requests:

```typescript
// Orchestrator.ts:365
const canonicalHistory = this.convertToCanonicalMessages([...this.messageHistory]);
```

All stored messages (including thinking blocks) are converted and sent to provider.

**However**: No special treatment—thinking blocks are just content blocks in the stream.

### Q3: What is the difference between interleaved thinking blocks?

**Answer**: **Interleaved vs Non-Interleaved**

**Non-Interleaved (o1-style)**:
- Model does ALL reasoning upfront
- Then provides final answer
- Thinking happens in one block before response

```
Turn N: User asks question
Turn N: [Thinking block: All reasoning here...]
Turn N: [Final answer with no more thinking]
```

**Interleaved (Claude 4.5, DeepSeek)**:
- Model intersperses thinking throughout response
- Thinking appears between tool calls
- Reasoning evolves as new information arrives

```
Turn N: User asks question
Turn N: [Thinking: Initial plan...]
Turn N: [Tool call: Glob]
Turn N+1: [Tool result received]
Turn N+1: [Thinking: Based on results, next I'll...]
Turn N+1: [Tool call: Read]
Turn N+2: [Tool result received]
Turn N+2: [Thinking: Now I understand, so...]
Turn N+2: [Final answer]
```

**Current Implementation**: Both patterns stored identically—thinking blocks in content array.

### Q4: Are interleaved thinking blocks stored with UUID?

**Answer**: **YES**

Each message (including those with thinking blocks) has a UUID:

```typescript
// FormatAdapter.interface.ts:195-198
export interface CanonicalMessage {
  /** Unique message identifier */
  uuid: string;
  // ...
  content: CanonicalContentBlock[];  // ← Can include thinking blocks
}
```

**Important**: Multiple thinking blocks in one message share the same message UUID.

### Q5: Could reasoning be reinjected as summarization by helper model?

**Answer**: **NOT CURRENTLY, BUT POSSIBLE**

**Current State**:
- No summarization of thinking blocks
- Helper models (compaction/summarization) don't have special reasoning logic
- Thinking blocks treated like regular text during compaction

**Potential Implementation**:

```typescript
// In HelperModelMiddleware or CompactionManager
async summarizeReasoning(messages: CanonicalMessage[]): Promise<string> {
  // Extract thinking blocks
  const thinkingBlocks = messages
    .flatMap(m => m.content)
    .filter(c => c.type === 'thinking')
    .map(c => c.thinking);

  if (thinkingBlocks.length === 0) {
    return '';
  }

  // Use helper model to summarize
  const summaryPrompt = `Summarize the following reasoning process concisely:

${thinkingBlocks.join('\n\n---\n\n')}

Provide a brief summary of the key insights and decisions made.`;

  const summary = await this.helperModel.generateSummary(summaryPrompt);

  return summary;
}
```

**Reinjection Strategy**:

Option A: **Inject as system reminder**
```xml
<system-reminder>
Previous reasoning summary:
- Key insight 1: ...
- Key insight 2: ...
</system-reminder>
```

Option B: **Replace thinking blocks with summary**
- During compaction, replace verbose thinking with concise summary
- Preserve conclusions but reduce token usage

Option C: **Context window optimization**
- Keep recent thinking (last N turns)
- Summarize older thinking
- Inject summary as context

### Q6: Should reasoning be tied to system message injection?

**Answer**: **YES, but as a MODEL CAPABILITY trigger**

**Current Design**:
- REASONING_GUIDE.md exists
- Registry condition: `modelCapabilities: ['reasoning']`
- But models don't expose 'reasoning' capability

**Proposed Integration**:

#### Step 1: Add Reasoning Capability to Model Cards

**Update**: Model cards for reasoning models

```typescript
// o1.ts, deepseek-reasoner.ts, claude-sonnet-4-5.ts, etc.
export const o1: ModelConfig = {
  // ...
  reasoning: {
    supported: true,
    format: 'thinking_block',
    extractionMethod: 'content_block'
  }
};
```

#### Step 2: Expose Reasoning Capability in Orchestrator

```typescript
// CortexOrchestrator.ts
private getModelCapabilities(): ModelCapability[] {
  const capabilities: ModelCapability[] = [];

  // Check tools support
  if (this.currentModel.tools?.supported) {
    capabilities.push('tools');
  }

  // Check streaming support
  if (this.currentModel.streaming?.supported) {
    capabilities.push('streaming');
  }

  // Check reasoning support ← NEW
  if (this.currentModel.reasoning?.supported) {
    capabilities.push('reasoning');
  }

  // Check vision support (if added later)
  // ...

  return capabilities;
}
```

#### Step 3: System Message Injection Works Automatically

With capability exposed, REASONING_GUIDE.md injects when:
- Model has reasoning capability
- Turn 0 or periodic reminder

**Benefits**:
✅ Models receive instructions on how to use thinking blocks
✅ Explains interleaved pattern
✅ Reinforces tool usage rules with reasoning
✅ Automatic injection based on model capability

### Q7: Should reasoning integration be elsewhere (not system messages)?

**Answer**: **Multiple Integration Points**

Reasoning should be integrated at multiple architectural layers:

#### Layer 1: System Message Injection (Instructions)
**Purpose**: Tell reasoning models HOW to use thinking blocks
**Implementation**: REASONING_GUIDE.md injected via model capability
**Status**: ⚙️ Ready (needs capability exposure)

#### Layer 2: Adapter Handling (Conversion)
**Purpose**: Convert thinking blocks to/from provider formats
**Implementation**: Already working in MessagesAPIAdapter
**Status**: ✅ Complete

#### Layer 3: Storage (Persistence)
**Purpose**: Store thinking blocks in JSONL
**Implementation**: Canonical format + JSONLHistoryStore
**Status**: ✅ Complete

#### Layer 4: Compaction (Summarization)
**Purpose**: Summarize verbose thinking during history compaction
**Implementation**: Helper model summarizes thinking blocks
**Status**: ❌ Not implemented

#### Layer 5: Context Management (Optimization)
**Purpose**: Intelligently include/exclude thinking based on relevance
**Implementation**: ContextBudgetManager considers thinking blocks
**Status**: ❌ Not implemented

## Architecture Gaps

### Gap 1: Model Capability Exposure ⚠️

**Problem**: Model cards don't populate `reasoning` field or expose it as capability

**Impact**: REASONING_GUIDE.md never injected

**Fix**:
1. Add `reasoning` config to model cards for reasoning models
2. Update `getModelCapabilities()` to check reasoning support
3. Test injection with o1, DeepSeek Reasoner, Claude Sonnet 4.5

### Gap 2: Reasoning Summarization ⚠️

**Problem**: No special handling during compaction

**Current Behavior**: Thinking blocks treated like regular text
- May be truncated mid-reasoning
- Verbose thinking wastes context window
- Key insights might be lost

**Proposed Solution**: Reasoning-aware compaction

```typescript
// In StoredCompactionManager or HelperModelMiddleware
async compactWithReasoningSummary(
  messages: CanonicalMessage[],
  targetSize: number
): Promise<CanonicalMessage[]> {
  // 1. Identify messages with thinking blocks
  const thinkingMessages = messages.filter(m =>
    m.content.some(c => c.type === 'thinking')
  );

  if (thinkingMessages.length === 0) {
    // No thinking, use standard compaction
    return this.standardCompaction(messages, targetSize);
  }

  // 2. Summarize thinking blocks using helper model
  const reasoningSummary = await this.summarizeReasoning(thinkingMessages);

  // 3. Create compacted history with reasoning summary
  const compacted = this.removeThinkingBlocks(messages);

  // 4. Inject summary as context
  const summaryMessage: CanonicalMessage = {
    uuid: generateUUID(),
    timestamp: new Date().toISOString(),
    role: 'system',
    type: 'compact_boundary',
    content: [{
      type: 'text',
      text: `<reasoning-summary>\n${reasoningSummary}\n</reasoning-summary>`
    }],
    // ...
  };

  return [summaryMessage, ...compacted];
}
```

### Gap 3: Interleaved Pattern Support ⚠️

**Problem**: No distinction between interleaved vs non-interleaved reasoning

**Current Behavior**: All thinking stored identically

**Impact**: Can't optimize based on reasoning pattern

**Proposed Enhancement**:

```typescript
// ModelConfig.interface.ts
reasoning?: {
  supported: boolean;
  format?: 'reasoning_content' | 'thinking_block';
  extractionMethod?: 'content_block' | 'separate_field';

  // NEW FIELD
  pattern?: 'interleaved' | 'upfront';  // ← Add this
};
```

**Usage**:
- `upfront`: o1-style (all reasoning before answer)
- `interleaved`: Claude/DeepSeek style (thinking between actions)

**Benefit**: Compaction can handle patterns differently
- Upfront: Summarize reasoning block once
- Interleaved: Preserve thinking at key decision points

### Gap 4: Context Window Optimization ⚠️

**Problem**: No intelligent inclusion/exclusion of thinking blocks

**Current Behavior**: All thinking sent in every request

**Impact**: Wastes context window with redundant reasoning

**Proposed Solution**: Reasoning context budget

```typescript
// ContextBudgetManager enhancement
class ReasoningAwareBudgetManager extends ContextBudgetManager {
  async selectMessagesWithReasoning(
    messages: CanonicalMessage[],
    maxTokens: number,
    strategy: 'all' | 'recent' | 'key_only' | 'summarized'
  ): Promise<CanonicalMessage[]> {
    switch (strategy) {
      case 'all':
        // Include all thinking (current behavior)
        return messages;

      case 'recent':
        // Keep thinking from last N turns only
        return this.keepRecentThinking(messages, 3);

      case 'key_only':
        // Keep thinking only at decision points (tool calls)
        return this.keepDecisionThinking(messages);

      case 'summarized':
        // Replace old thinking with summary
        return this.summarizeOldThinking(messages);
    }
  }
}
```

## Proposed Integration Strategy

### Phase 1: Enable Model Capability Detection ⚙️

**Goal**: Get REASONING_GUIDE.md injecting for reasoning models

**Tasks**:
1. Add `reasoning` config to model cards:
   - o1, o1-mini, o1-pro
   - deepseek-reasoner, deepseek-v3.1-thinking
   - claude-sonnet-4-5 (supports extended thinking)
2. Update `getModelCapabilities()` in Orchestrator to check reasoning support
3. Test REASONING_GUIDE.md injection with reasoning-capable model

**Expected Outcome**: Models receive instructions on using thinking blocks

### Phase 2: Reasoning-Aware Compaction ⚙️

**Goal**: Summarize thinking blocks during history compaction

**Tasks**:
1. Implement `summarizeReasoning()` in HelperModelMiddleware
2. Update StoredCompactionManager to detect thinking blocks
3. Create reasoning summary and inject as context
4. Test with long conversation containing thinking blocks

**Expected Outcome**: Context window usage optimized, key insights preserved

### Phase 3: Context Budget Optimization ⚙️

**Goal**: Intelligently include/exclude thinking based on relevance

**Tasks**:
1. Extend ContextBudgetManager with reasoning strategies
2. Implement selection logic (recent, key_only, summarized)
3. Configure strategy per model or user preference
4. Test token usage reduction

**Expected Outcome**: Further context window optimization

### Phase 4: Interleaved Pattern Support ⚙️

**Goal**: Handle interleaved vs upfront reasoning differently

**Tasks**:
1. Add `pattern` field to reasoning config
2. Update model cards with pattern information
3. Implement pattern-specific compaction logic
4. Test with both o1 (upfront) and Claude 4.5 (interleaved)

**Expected Outcome**: Optimal handling for each reasoning pattern

## System Message Integration

### Current: REASONING_GUIDE.md

**Registry Entry**:
```json
{
  "id": "reasoning_guide",
  "conditions": {
    "modelCapabilities": ["reasoning"]
  },
  "injection": {
    "priority": 4
  }
}
```

**Content** (key points):
- Explains `<thinking>` blocks
- Shows interleaved pattern
- Emphasizes tool result waiting
- Provides reasoning examples

**Status**: Ready but not injecting (capability not exposed)

### Proposed: Reasoning Strategy Messages

Create additional reasoning-specific messages:

**REASONING_COMPACTION_NOTICE.md** (injected after compaction):
```markdown
<system-reminder>
Previous conversation contained extended reasoning that has been summarized:

**Key Insights**:
- Insight 1...
- Insight 2...

Full reasoning details are available in conversation history if needed.
</system-reminder>
```

**REASONING_OPTIMIZATION_GUIDE.md** (periodic reminder):
```markdown
<system-reminder>
**Reasoning Efficiency Tips**:
- Focus thinking on novel insights
- Summarize repetitive analysis
- Reference previous reasoning conclusions
- Keep thinking blocks concise when appropriate
</system-reminder>
```

## Recommendations

### 1. Enable Capability Detection (High Priority)

**Action**: Update model cards with reasoning config
**Effort**: Low (1-2 hours)
**Impact**: High (unlocks REASONING_GUIDE.md injection)

### 2. Implement Reasoning Summarization (Medium Priority)

**Action**: Add helper model summarization of thinking blocks
**Effort**: Medium (4-6 hours)
**Impact**: High (context window optimization)

### 3. Thinking Block Context Strategy (Low Priority)

**Action**: Implement selective thinking inclusion strategies
**Effort**: Medium (4-6 hours)
**Impact**: Medium (further optimization)

### 4. Pattern-Specific Handling (Low Priority)

**Action**: Distinguish interleaved vs upfront reasoning
**Effort**: Low (2-3 hours)
**Impact**: Low (incremental improvement)

## Summary

### Current State

✅ **Working**:
- Thinking blocks stored in canonical format
- Adapters convert thinking bidirectionally
- JSONL storage includes thinking blocks
- REASONING_GUIDE.md message exists

⚠️ **Gaps**:
- Model capability not exposed (reasoning never triggers injection)
- No reasoning-aware compaction
- No context window optimization for thinking
- No pattern-specific handling

### Recommended Path Forward

1. **Immediate**: Expose reasoning capability in model cards → Enable REASONING_GUIDE.md injection
2. **Near-term**: Implement reasoning summarization in compaction
3. **Future**: Add context budget optimization for thinking blocks

### Integration with System Messages

**Answer to User's Question**: Reasoning should be integrated with system messages AS A MODEL CAPABILITY:

- REASONING_GUIDE.md injected when model has reasoning capability
- Reasoning summarization can leverage system message injection (inject summaries)
- But core reasoning handling (storage, compaction) belongs in Orchestrator/Middleware, not system messages

**Reasoning is BOTH**:
- An **instruction concern** (system messages teach how to use thinking blocks)
- An **architectural concern** (Orchestrator/Middleware optimize thinking blocks)

Both integration points are necessary for complete reasoning support.
