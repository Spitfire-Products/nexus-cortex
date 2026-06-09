# Practical Reactive Mentorship Implementation

## Overview

Implementation of reactive mentorship using **existing infrastructure** - no agent teams, no complex orchestration. Just hooks, prompts, and wiring.

## What We Already Have

### 1. Helper Model Infrastructure ✅

**Location**: `src/middleware/helpers/`

```typescript
// HelperModelMiddleware.ts - Already exists
class HelperModelMiddleware {
  private helperModel: APIClient;

  async chat(prompt: string): Promise<string> {
    // Already implemented - sends prompt to helper model
  }
}
```

**We have**: Middleware that can call helper models

**We need**: New methods for mentorship-specific prompts

### 2. Compaction Infrastructure ✅

**Location**: `src/conversation/StoredCompactionManager.ts`

Already triggers helper model for summarization

**We need**: Extend to include mentorship mode

### 3. Tool Result Processing ✅

**Location**: `src/orchestrator/CortexOrchestrator.ts`

Already processes tool results and detects errors

**We need**: Add hook after tool result processing

### 4. Message History ✅

**Location**: `src/session/JSONLHistoryStore.ts`

Already stores canonical messages

**We need**: Store mentorship guidance as thinking blocks

### 5. System Message Injection ✅

**Location**: `src/system-messages/SystemMessageLoader.ts`

Already injects system messages

**We need**: Use same mechanism for mentorship

## Implementation Plan

### Phase 1: Error-Triggered Mentorship (Core Feature)

**Goal**: When tool error occurs, analyze and inject guidance

#### Step 1.1: Add Error Detection Hook

**File**: `src/orchestrator/CortexOrchestrator.ts`

```typescript
/**
 * Process tool result with error detection
 */
async handleToolResult(
  toolUseId: string,
  result: CanonicalToolResult
): Promise<void> {
  // Existing: Create tool result message
  const toolResultMessage = this.createToolResultMessage(toolUseId, result);
  this.canonicalHistory.push(toolResultMessage);
  await this.historyStore.appendMessage(this.currentSessionId, toolResultMessage);

  // NEW: Check for errors and trigger mentorship
  if (result.is_error && this.shouldTriggerMentorship(result)) {
    await this.handleErrorWithMentorship(toolUseId, result);
  }
}

/**
 * Determine if error should trigger mentorship
 */
private shouldTriggerMentorship(result: CanonicalToolResult): boolean {
  // Check if mentorship enabled
  if (!this.config.reactiveMentorship?.enabled) {
    return false;
  }

  // Check error severity
  const errorText = String(result.content).toLowerCase();

  // High-severity errors always trigger
  if (
    errorText.includes('permission denied') ||
    errorText.includes('not found') ||
    errorText.includes('syntax error') ||
    errorText.includes('command not found')
  ) {
    return true;
  }

  // Medium-severity if threshold allows
  if (this.config.reactiveMentorship.errorSeverityThreshold === 'medium') {
    if (errorText.includes('error') || errorText.includes('failed')) {
      return true;
    }
  }

  return false;
}

/**
 * Handle error with mentorship guidance
 */
private async handleErrorWithMentorship(
  toolUseId: string,
  result: CanonicalToolResult
): Promise<void> {
  if (this.config.debug) {
    console.log('[Mentorship] Error detected, generating guidance...');
  }

  // Get recent context
  const recentHistory = this.canonicalHistory.slice(-5);

  // Generate mentorship guidance
  const guidance = await this.helperModelMiddleware.generateErrorGuidance({
    toolUseId,
    error: result.content,
    recentHistory
  });

  // Inject as thinking block
  await this.injectThinkingBlock(guidance);
}
```

#### Step 1.2: Add Error Analysis to HelperModelMiddleware

**File**: `src/middleware/helpers/HelperModelMiddleware.ts`

```typescript
/**
 * Generate guidance for tool error
 */
async generateErrorGuidance(context: {
  toolUseId: string;
  error: string | object;
  recentHistory: CanonicalMessage[];
}): Promise<string> {
  const errorText = typeof context.error === 'string'
    ? context.error
    : JSON.stringify(context.error);

  // Extract tool name from recent history
  const toolName = this.extractToolName(context.toolUseId, context.recentHistory);

  const prompt = `You are an AI mentor analyzing an error encountered by another AI model.

**Tool Used**: ${toolName}
**Error Message**: ${errorText}

**Recent Actions** (last 5 turns):
${this.formatRecentHistory(context.recentHistory)}

Provide concise guidance in a thinking block format:

<thinking>
**Error Analysis**: [What went wrong and why - 1-2 sentences]

**Immediate Fix**: [Specific steps to resolve - 2-3 bullet points]

**Why This Works**: [Brief explanation]
</thinking>

Keep it brief and actionable. Focus on the solution, not lengthy diagnosis.`;

  const response = await this.chat(prompt);

  return this.extractThinkingContent(response);
}

/**
 * Extract thinking content from response
 */
private extractThinkingContent(response: string): string {
  const match = response.match(/<thinking>([\s\S]*?)<\/thinking>/);
  if (match) {
    return match[1].trim();
  }
  // Fallback: return whole response if no tags
  return response.trim();
}

/**
 * Format recent history for prompt
 */
private formatRecentHistory(history: CanonicalMessage[]): string {
  return history.map((msg, i) => {
    const turnNum = history.length - history.length + i + 1;
    const role = msg.role === 'assistant' ? 'AI' : 'User';

    // Summarize content
    const summary = this.summarizeContent(msg.content);

    return `Turn ${turnNum} (${role}): ${summary}`;
  }).join('\n');
}

/**
 * Summarize message content
 */
private summarizeContent(content: CanonicalContentBlock[]): string {
  const summaries = content.map(block => {
    switch (block.type) {
      case 'text':
        return block.text?.substring(0, 100) + '...';
      case 'tool_use':
        return `Called ${block.toolUse?.name}`;
      case 'tool_result':
        return block.toolResult?.is_error ? 'Error result' : 'Success result';
      case 'thinking':
        return 'Thinking...';
      default:
        return '';
    }
  });

  return summaries.filter(s => s).join('; ');
}
```

#### Step 1.3: Inject Thinking Block

**File**: `src/orchestrator/CortexOrchestrator.ts`

```typescript
/**
 * Inject thinking block into message stream
 */
private async injectThinkingBlock(thinking: string): Promise<void> {
  const thinkingMessage: CanonicalMessage = {
    uuid: uuidv4(),
    timestamp: new Date().toISOString(),
    role: 'assistant',
    type: 'thinking',
    content: [{
      type: 'thinking',
      thinking: `💭 **AI Mentor Insight**\n\n${thinking}`
    }],
    timeline: {
      sessionId: this.currentSessionId,
      conversationId: this.currentConversationId,
      turnNumber: this.turnNumber
    },
    model: {
      id: this.config.helperModelId || 'grok-beta',
      provider: 'helper',
      apiPattern: 'mentorship'
    },
    metadata: {
      mentorshipGuidance: true,
      syntheticReasoning: true
    }
  };

  // Add to canonical history
  this.canonicalHistory.push(thinkingMessage);

  // Store to JSONL
  await this.historyStore.appendMessage(this.currentSessionId, thinkingMessage);

  if (this.config.debug) {
    console.log('[Mentorship] Thinking block injected');
  }
}
```

### Phase 2: Keyword Triggers (@ultrathink)

**Goal**: User can type @ultrathink to request deep analysis

#### Step 2.1: Detect Keywords in User Input

**File**: `src/orchestrator/CortexOrchestrator.ts`

```typescript
/**
 * Process user input with keyword detection
 */
async sendMessage(
  content: string,
  options: SendMessageOptions = {}
): Promise<OrchestratorResponse> {
  // NEW: Check for mentorship keywords
  const keyword = this.detectMentorshipKeyword(content);

  if (keyword) {
    // Remove keyword from content
    content = this.removeKeyword(content, keyword);

    // Trigger mentorship before processing message
    await this.handleKeywordMentorship(keyword);
  }

  // Continue with standard message processing
  return this.standardSendMessage(content, options);
}

/**
 * Detect mentorship keywords
 */
private detectMentorshipKeyword(content: string): string | null {
  const keywords = ['@ultrathink', '@analyze', '@rethink', '@mentor'];

  for (const keyword of keywords) {
    if (content.toLowerCase().includes(keyword)) {
      return keyword;
    }
  }

  return null;
}

/**
 * Remove keyword from content
 */
private removeKeyword(content: string, keyword: string): string {
  return content.replace(new RegExp(keyword, 'gi'), '').trim();
}

/**
 * Handle keyword-triggered mentorship
 */
private async handleKeywordMentorship(keyword: string): Promise<void> {
  if (this.config.debug) {
    console.log(`[Mentorship] Keyword detected: ${keyword}`);
  }

  // Get recent context (more for @ultrathink)
  const contextSize = keyword === '@ultrathink' ? 20 : 10;
  const recentHistory = this.canonicalHistory.slice(-contextSize);

  // Generate guidance
  const guidance = await this.helperModelMiddleware.generateKeywordGuidance({
    keyword,
    recentHistory
  });

  // Inject as thinking block
  await this.injectThinkingBlock(guidance);
}
```

#### Step 2.2: Add Keyword Handling to HelperModelMiddleware

**File**: `src/middleware/helpers/HelperModelMiddleware.ts`

```typescript
/**
 * Generate guidance for keyword trigger
 */
async generateKeywordGuidance(context: {
  keyword: string;
  recentHistory: CanonicalMessage[];
}): Promise<string> {
  const prompt = this.buildKeywordPrompt(context.keyword, context.recentHistory);
  const response = await this.chat(prompt);
  return this.extractThinkingContent(response);
}

/**
 * Build prompt based on keyword
 */
private buildKeywordPrompt(keyword: string, history: CanonicalMessage[]): string {
  switch (keyword) {
    case '@ultrathink':
      return `You are an expert AI mentor providing deep strategic analysis.

The user requested ULTRATHINK - comprehensive review and guidance.

**Conversation History** (last ${history.length} turns):
${this.formatRecentHistory(history)}

Provide comprehensive strategic analysis:

<thinking>
🧠 **UltraThink Strategic Analysis**

**Situation Assessment**: [What's been tried, what worked, what didn't - 2-3 sentences]

**Strategic Recommendations** (ranked by success likelihood):

1. **[Approach Name]** (X% confidence)
   - Why: [Rationale]
   - How: [Specific steps]
   - Watch for: [Potential pitfall]

2. **[Alternative Approach]** (X% confidence)
   - Why: [Rationale]
   - How: [Specific steps]

**Next Immediate Steps**: [Concrete actions to take]
</thinking>

Be strategic, concise, and actionable. Focus on high-value guidance.`;

    case '@analyze':
      return `Analyze the recent approach and suggest improvements.

**Recent Actions** (last ${history.length} turns):
${this.formatRecentHistory(history)}

<thinking>
📊 **Approach Analysis**

**What Worked**: [1-2 things that were effective]

**What Could Be Better**: [2-3 specific improvements]

**Quick Wins**: [1-2 easy improvements to try next]
</thinking>`;

    case '@rethink':
      return `Reconsider the current strategy from first principles.

**Current Approach**:
${this.formatRecentHistory(history)}

<thinking>
🔄 **Strategy Reconsideration**

**Current Assumption**: [What's being assumed]

**Alternative Perspective**: [Different way to think about it]

**Recommended Pivot**: [New approach to try]
</thinking>`;

    default:
      return `Provide helpful mentorship guidance.

**Context**:
${this.formatRecentHistory(history)}

<thinking>
👨‍🏫 **Mentor Guidance**

[Your advice here - be concise and helpful]
</thinking>`;
  }
}
```

### Phase 3: Configuration

**File**: `src/orchestrator/CortexOrchestrator.ts`

```typescript
export interface OrchestratorConfig {
  // ... existing fields ...

  /** Helper model for mentorship (default: grok-beta) */
  helperModelId?: string;

  /** Reactive mentorship configuration */
  reactiveMentorship?: {
    /** Enable reactive mentorship */
    enabled: boolean;

    /** Trigger on tool errors */
    triggerOnError: boolean;

    /** Error severity threshold */
    errorSeverityThreshold: 'low' | 'medium' | 'high';

    /** Enable keyword triggers */
    enableKeywords: boolean;

    /** Custom keywords (default: @ultrathink, @analyze, @rethink) */
    customKeywords?: string[];
  };
}
```

### Phase 4: Testing

**File**: `src/orchestrator/__tests__/reactive-mentorship.test.ts`

```typescript
describe('Reactive Mentorship', () => {
  let orchestrator: CortexOrchestrator;

  beforeEach(() => {
    orchestrator = new CortexOrchestrator({
      defaultModelId: 'grok-code-fast-1',
      helperModelId: 'grok-beta',
      reactiveMentorship: {
        enabled: true,
        triggerOnError: true,
        errorSeverityThreshold: 'medium',
        enableKeywords: true
      }
    });
  });

  describe('Error-Triggered Mentorship', () => {
    it('should inject guidance after bash error', async () => {
      // Create session
      await orchestrator.createSession({ projectId: 'test' });

      // Send message that will cause tool use
      await orchestrator.sendMessage('Run npm tset', {
        tools: [bashTool]
      });

      // Simulate tool error
      await orchestrator.handleToolResult('toolu_123', {
        tool_use_id: 'toolu_123',
        content: 'bash: npm: command not found',
        is_error: true
      });

      // Check that thinking block was injected
      const lastMessage = orchestrator.getLastMessage();
      expect(lastMessage.type).toBe('thinking');
      expect(lastMessage.content[0].thinking).toContain('Error Analysis');
    });
  });

  describe('Keyword Triggers', () => {
    it('should detect @ultrathink keyword', async () => {
      await orchestrator.createSession({ projectId: 'test' });

      const spy = jest.spyOn(orchestrator as any, 'handleKeywordMentorship');

      await orchestrator.sendMessage('I need help. @ultrathink');

      expect(spy).toHaveBeenCalledWith('@ultrathink');
    });

    it('should inject comprehensive guidance for @ultrathink', async () => {
      await orchestrator.createSession({ projectId: 'test' });

      // Send several messages to build history
      for (let i = 0; i < 5; i++) {
        await orchestrator.sendMessage(`Test message ${i}`);
      }

      await orchestrator.sendMessage('Stuck on this. @ultrathink');

      // Check for thinking block
      const messages = orchestrator.getRecentMessages(2);
      const thinkingMsg = messages.find(m => m.type === 'thinking');

      expect(thinkingMsg).toBeDefined();
      expect(thinkingMsg!.content[0].thinking).toContain('UltraThink');
    });
  });
});
```

## Wiring Checklist

### Step 1: Update Orchestrator Constructor ✅

```typescript
constructor(config: OrchestratorConfig) {
  // ... existing initialization ...

  // Initialize helper model middleware (already exists)
  this.helperModelMiddleware = new HelperModelMiddleware({
    helperModelId: config.helperModelId || 'grok-beta',
    debug: config.debug
  });
}
```

### Step 2: Wire Error Detection Hook ✅

**Location**: `handleToolResult()` method

Add after creating tool result message:
```typescript
if (result.is_error && this.shouldTriggerMentorship(result)) {
  await this.handleErrorWithMentorship(toolUseId, result);
}
```

### Step 3: Wire Keyword Detection Hook ✅

**Location**: `sendMessage()` method

Add at beginning of method:
```typescript
const keyword = this.detectMentorshipKeyword(content);
if (keyword) {
  content = this.removeKeyword(content, keyword);
  await this.handleKeywordMentorship(keyword);
}
```

### Step 4: Add Helper Methods ✅

Add to `HelperModelMiddleware.ts`:
- `generateErrorGuidance()`
- `generateKeywordGuidance()`
- `extractThinkingContent()`
- `formatRecentHistory()`

### Step 5: Add Injection Method ✅

Add to `CortexOrchestrator.ts`:
- `injectThinkingBlock()`
- `shouldTriggerMentorship()`
- `handleErrorWithMentorship()`
- `handleKeywordMentorship()`

## Prompt Engineering

### Error Guidance Prompt (Concise)

```
You are an AI mentor analyzing an error.

Tool: {toolName}
Error: {error}
Recent: {history}

<thinking>
**Error Analysis**: [1-2 sentences]
**Fix**: [2-3 bullet points]
**Why**: [Brief explanation]
</thinking>
```

**Key**: Keep it SHORT. Model needs quick actionable guidance, not essays.

### UltraThink Prompt (Comprehensive)

```
You are an expert AI mentor. User requested ULTRATHINK.

History: {last 20 turns}

<thinking>
🧠 **UltraThink Analysis**

**Situation**: [What's been tried - 2-3 sentences]

**Recommendations**:
1. [Approach] (90% confidence) - Why + How
2. [Alternative] (75% confidence) - Why + How

**Next Steps**: [Concrete actions]
</thinking>
```

**Key**: Strategic, ranked by confidence, actionable.

### Analyze Prompt (Quick Wins)

```
Analyze recent approach.

Recent: {last 10 turns}

<thinking>
📊 **Analysis**

**Worked**: [1-2 things]
**Improve**: [2-3 things]
**Quick Wins**: [1-2 easy fixes]
</thinking>
```

**Key**: Focus on quick improvements, not deep analysis.

## Cost Estimation

### Per-Event Costs

| Event Type | Context Size | Helper Model | Cost/Event |
|-----------|--------------|--------------|------------|
| Error (high severity) | 5 turns (~500 tokens) | grok-beta | $0.001 |
| @ultrathink | 20 turns (~2000 tokens) | grok-beta | $0.005 |
| @analyze | 10 turns (~1000 tokens) | grok-beta | $0.002 |

### 50-Turn Conversation

**Typical usage**:
- 2 error triggers
- 1 @ultrathink
- 1 @analyze

**Total added cost**: ~$0.01
**Percentage of conversation cost**: <1%

**Benefit**: Potentially saves 5-10 turns of trial-and-error

## Implementation Timeline

### Week 1: Core Error Triggering
- [ ] Add error detection hook to `handleToolResult()`
- [ ] Implement `generateErrorGuidance()` in HelperModelMiddleware
- [ ] Add `injectThinkingBlock()` to Orchestrator
- [ ] Test with bash errors
- [ ] Verify thinking blocks stored in JSONL

### Week 2: Keyword Triggers
- [ ] Add keyword detection to `sendMessage()`
- [ ] Implement `generateKeywordGuidance()` with prompts for each keyword
- [ ] Test @ultrathink, @analyze, @rethink
- [ ] Verify guidance quality

### Week 3: Configuration & Testing
- [ ] Add configuration interface
- [ ] Write integration tests
- [ ] Test with grok-code-fast-1
- [ ] Measure cost impact
- [ ] Document usage

### Week 4: Polish & Deploy
- [ ] Optimize prompts based on testing
- [ ] Add debug logging
- [ ] Create user documentation
- [ ] Deploy to staging
- [ ] Gather feedback

## Success Metrics

### Quantitative
- **Error Resolution Rate**: % of errors resolved in next 1-2 turns after guidance
- **Token Efficiency**: Reduction in total turns needed (target: 10-15% fewer turns)
- **Cost Impact**: Helper model cost as % of total (target: <2%)

### Qualitative
- **Guidance Relevance**: Is guidance actionable and specific?
- **User Satisfaction**: Does @ultrathink provide helpful insights?
- **Synthetic Reasoning Quality**: Do non-reasoning models benefit?

## Rollout Strategy

### Phase 1: Internal Testing (Week 1-2)
- Enable for development team only
- Gather feedback on guidance quality
- Iterate on prompts

### Phase 2: Beta Users (Week 3)
- Enable for select beta testers
- Monitor cost impact
- Collect usage data

### Phase 3: General Availability (Week 4)
- Roll out to all users
- Default: enabled with medium threshold
- Provide configuration options

## Key Advantages of This Approach

✅ **Uses Existing Infrastructure** - No new middleware, just new methods
✅ **Simple Hooks** - Two injection points: after tool result, before message send
✅ **Prompt-Based** - Easy to iterate and improve
✅ **No Agent Complexity** - Helper model doesn't use tools
✅ **Low Cost** - Minimal token usage per event
✅ **Fast Implementation** - Can be done in 2-3 weeks
✅ **Testable** - Clear integration test points
✅ **Configurable** - Users can enable/disable features

## What We're NOT Doing (Avoiding Complexity)

❌ **Agent Teams** - No parallel orchestration
❌ **Tool Access for Helper Model** - No mentor agent with tools
❌ **Complex State Management** - No multi-agent state tracking
❌ **Sophisticated Routing** - Simple: one helper model
❌ **RAG Integration** - No vector databases (for now)
❌ **Continuous Learning** - No feedback loops (for now)

We can add these later if needed, but start simple.

## Summary

**Implementation Strategy**:
1. Hook into existing tool result processing
2. Hook into existing user input processing
3. Use existing helper model middleware
4. Use existing thinking block storage
5. Add prompts for error analysis and keywords

**Total New Code**: ~500 lines
**Complexity**: Low
**Dependencies**: None (uses existing infrastructure)
**Implementation Time**: 3-4 weeks
**Value**: High (real-time AI mentorship with minimal overhead)

This is a pragmatic, implementable design that delivers significant value without architectural complexity.
