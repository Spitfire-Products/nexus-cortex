# Extended Mentorship Triggers

## Overview

Additional mentorship triggers beyond error detection and keywords:
1. **Model-Triggered** - Main model can request mentor help
2. **Turn-Based** - Automatic review every N turns
3. **Tool-Based** - Review after N tool calls
4. **Active Mentor Mode** - Continuous guidance mode

All implemented with simple hooks and configuration.

## Feature 1: Model-Triggered Mentorship

**Concept**: Main model can explicitly request mentor guidance when stuck or uncertain.

### Implementation A: Special Response Pattern

Model can include special marker in its response:

```typescript
// Model response includes marker
{
  role: 'assistant',
  content: [
    {
      type: 'text',
      text: 'I need guidance on this approach. [REQUEST_MENTOR_REVIEW]'
    }
  ]
}

// Orchestrator detects marker and triggers mentorship
```

### Implementation B: Special Tool Call

Provide model with a "request_mentor_help" tool:

```typescript
// Add to tool definitions
const requestMentorTool: CanonicalTool = {
  name: 'request_mentor_help',
  description: `Request guidance from AI mentor when stuck, uncertain, or need strategic advice.

Use this when:
- Attempted multiple approaches without success
- Unsure which strategy to pursue
- Need validation of current approach
- Want alternative perspective

The mentor will analyze recent conversation and provide strategic guidance.`,
  schema: {
    type: 'object',
    properties: {
      reason: {
        type: 'string',
        description: 'Why you need mentor guidance (e.g., "Stuck after 3 failed attempts")'
      },
      question: {
        type: 'string',
        description: 'Specific question or area where you need help (optional)'
      }
    },
    required: ['reason']
  }
};

// Model can call: request_mentor_help({ reason: "Tried 3 approaches, all failed" })
```

### Implementation Code

**Add to CortexOrchestrator.ts**:

```typescript
/**
 * Detect if model requested mentor help
 */
private detectModelMentorRequest(
  message: CanonicalMessage
): { reason: string; question?: string } | null {
  // Check for special tool call
  const mentorToolUse = message.content.find(
    c => c.type === 'tool_use' && c.toolUse?.name === 'request_mentor_help'
  );

  if (mentorToolUse) {
    return mentorToolUse.toolUse!.input as { reason: string; question?: string };
  }

  // Check for text marker
  const textContent = message.content
    .filter(c => c.type === 'text')
    .map(c => c.text)
    .join(' ');

  if (textContent.includes('[REQUEST_MENTOR_REVIEW]')) {
    return { reason: 'Model requested review' };
  }

  return null;
}

/**
 * Process model's response and check for mentor requests
 */
async processModelResponse(response: OrchestratorResponse): Promise<void> {
  // Existing: Store response to history

  // NEW: Check if model requested mentor help
  const mentorRequest = this.detectModelMentorRequest(response.message);

  if (mentorRequest) {
    await this.handleModelMentorRequest(mentorRequest);
  }
}

/**
 * Handle model's mentor request
 */
private async handleModelMentorRequest(request: {
  reason: string;
  question?: string;
}): Promise<void> {
  if (this.config.debug) {
    console.log(`[Mentorship] Model requested help: ${request.reason}`);
  }

  // Generate targeted guidance
  const guidance = await this.helperModelMiddleware.generateModelRequestGuidance({
    reason: request.reason,
    question: request.question,
    recentHistory: this.canonicalHistory.slice(-10)
  });

  // Inject as thinking block
  await this.injectThinkingBlock(guidance);

  // Also create tool result if it was a tool call
  if (request.reason.startsWith('Tool:')) {
    await this.createMentorToolResult(guidance);
  }
}
```

**Add to HelperModelMiddleware.ts**:

```typescript
/**
 * Generate guidance for model's mentor request
 */
async generateModelRequestGuidance(context: {
  reason: string;
  question?: string;
  recentHistory: CanonicalMessage[];
}): Promise<string> {
  const prompt = `You are an AI mentor. Another AI model requested your help.

**Reason**: ${context.reason}
${context.question ? `**Specific Question**: ${context.question}` : ''}

**Recent Conversation** (last 10 turns):
${this.formatRecentHistory(context.recentHistory)}

Provide targeted guidance:

<thinking>
🤝 **Mentor Response to Request**

**Understanding the Issue**: [Summarize what model is struggling with]

**Strategic Guidance**: [Specific advice for the situation]

**Recommended Next Steps**: [Clear, actionable steps]

${context.question ? '**Answer to Question**: [Direct answer]' : ''}
</thinking>

Be direct, actionable, and encouraging.`;

  const response = await this.chat(prompt);
  return this.extractThinkingContent(response);
}
```

## Feature 2: Turn-Based Periodic Review

**Concept**: Every N turns, trigger mentor review automatically.

### Configuration

```typescript
interface OrchestratorConfig {
  reactiveMentorship?: {
    enabled: boolean;

    // Turn-based review
    periodicReview?: {
      enabled: boolean;
      turnInterval: number;  // Review every N turns (default: 20)
      includeStrategicAdvice: boolean;  // Full analysis or just summary?
    };
  };
}
```

### Implementation

**Add to CortexOrchestrator.ts**:

```typescript
/**
 * Check if periodic review should trigger
 */
private shouldTriggerPeriodicReview(): boolean {
  if (!this.config.reactiveMentorship?.periodicReview?.enabled) {
    return false;
  }

  const interval = this.config.reactiveMentorship.periodicReview.turnInterval || 20;

  // Trigger every N turns (but not at turn 0)
  return this.turnNumber > 0 && this.turnNumber % interval === 0;
}

/**
 * Process message with periodic review check
 */
async sendMessage(
  content: string,
  options: SendMessageOptions = {}
): Promise<OrchestratorResponse> {
  // Existing: Keyword detection...

  // NEW: Check for periodic review BEFORE processing message
  if (this.shouldTriggerPeriodicReview()) {
    await this.handlePeriodicReview();
  }

  // Continue with standard message processing
  return this.standardSendMessage(content, options);
}

/**
 * Handle periodic review
 */
private async handlePeriodicReview(): Promise<void> {
  if (this.config.debug) {
    console.log(`[Mentorship] Periodic review triggered (turn ${this.turnNumber})`);
  }

  const includeAdvice = this.config.reactiveMentorship?.periodicReview?.includeStrategicAdvice ?? true;

  const guidance = await this.helperModelMiddleware.generatePeriodicReview({
    turnNumber: this.turnNumber,
    recentHistory: this.canonicalHistory.slice(-20),
    includeStrategicAdvice: includeAdvice
  });

  await this.injectThinkingBlock(guidance);
}
```

**Add to HelperModelMiddleware.ts**:

```typescript
/**
 * Generate periodic review guidance
 */
async generatePeriodicReview(context: {
  turnNumber: number;
  recentHistory: CanonicalMessage[];
  includeStrategicAdvice: boolean;
}): Promise<string> {
  const prompt = context.includeStrategicAdvice
    ? this.buildStrategicReviewPrompt(context)
    : this.buildSummaryReviewPrompt(context);

  const response = await this.chat(prompt);
  return this.extractThinkingContent(response);
}

/**
 * Build strategic review prompt (comprehensive)
 */
private buildStrategicReviewPrompt(context: {
  turnNumber: number;
  recentHistory: CanonicalMessage[];
}): string {
  return `You are an AI mentor conducting a periodic review.

**Current Turn**: ${context.turnNumber}
**Conversation Snapshot** (last 20 turns):
${this.formatRecentHistory(context.recentHistory)}

Provide strategic review:

<thinking>
📋 **Periodic Review (Turn ${context.turnNumber})**

**Progress Summary**: [What's been accomplished in last 20 turns - 2-3 sentences]

**Current Trajectory**: [Is the approach effective? Any concerns?]

**Strategic Recommendations**:
- [Recommendation 1]
- [Recommendation 2]

**Watch Out For**: [Potential issues to monitor]
</thinking>

Be concise but insightful. Focus on maintaining momentum.`;
}

/**
 * Build summary review prompt (lightweight)
 */
private buildSummaryReviewPrompt(context: {
  turnNumber: number;
  recentHistory: CanonicalMessage[];
}): string {
  return `Provide brief progress summary.

**Turn**: ${context.turnNumber}
**Recent**: ${this.formatRecentHistory(context.recentHistory.slice(-10))}

<thinking>
📋 **Progress Check (Turn ${context.turnNumber})**

**Summary**: [What's been done - 1-2 sentences]
**Status**: [On track / Needs adjustment / Going well]
</thinking>

Very brief - just a quick check-in.`;
}
```

## Feature 3: Tool-Based Periodic Review

**Concept**: After N tool calls, trigger mentor review (activity-based, not time-based).

### Configuration

```typescript
interface OrchestratorConfig {
  reactiveMentorship?: {
    enabled: boolean;

    // Tool-based review
    toolBasedReview?: {
      enabled: boolean;
      toolCallInterval: number;  // Review every N tool calls (default: 10)
      analyzeToolEfficiency: boolean;  // Include tool usage analysis?
    };
  };
}
```

### Implementation

**Add to CortexOrchestrator.ts**:

```typescript
/**
 * Track tool call count
 */
private toolCallCount = 0;

/**
 * Process tool use with counter
 */
async handleToolUse(toolUse: CanonicalToolUse): Promise<void> {
  // Existing: Execute tool...

  // NEW: Increment counter
  this.toolCallCount++;

  if (this.shouldTriggerToolBasedReview()) {
    await this.handleToolBasedReview();
  }
}

/**
 * Check if tool-based review should trigger
 */
private shouldTriggerToolBasedReview(): boolean {
  if (!this.config.reactiveMentorship?.toolBasedReview?.enabled) {
    return false;
  }

  const interval = this.config.reactiveMentorship.toolBasedReview.toolCallInterval || 10;

  return this.toolCallCount % interval === 0;
}

/**
 * Handle tool-based review
 */
private async handleToolBasedReview(): Promise<void> {
  if (this.config.debug) {
    console.log(`[Mentorship] Tool-based review triggered (${this.toolCallCount} tool calls)`);
  }

  const analyzeEfficiency = this.config.reactiveMentorship?.toolBasedReview?.analyzeToolEfficiency ?? true;

  // Get recent tool usage
  const recentToolCalls = this.extractRecentToolCalls(10);

  const guidance = await this.helperModelMiddleware.generateToolReview({
    toolCallCount: this.toolCallCount,
    recentToolCalls,
    analyzeEfficiency
  });

  await this.injectThinkingBlock(guidance);
}

/**
 * Extract recent tool calls from history
 */
private extractRecentToolCalls(count: number): Array<{
  tool: string;
  input: any;
  result: string;
  success: boolean;
}> {
  const toolCalls: Array<any> = [];

  // Walk backwards through history
  for (let i = this.canonicalHistory.length - 1; i >= 0 && toolCalls.length < count; i--) {
    const msg = this.canonicalHistory[i];

    // Find tool_use
    const toolUse = msg.content.find(c => c.type === 'tool_use');
    if (!toolUse) continue;

    // Find corresponding tool_result
    const resultMsg = this.canonicalHistory.slice(i + 1).find(m =>
      m.content.some(c =>
        c.type === 'tool_result' &&
        c.toolResult?.tool_use_id === toolUse.toolUse?.id
      )
    );

    if (resultMsg) {
      const result = resultMsg.content.find(c => c.type === 'tool_result')!;
      toolCalls.push({
        tool: toolUse.toolUse!.name,
        input: toolUse.toolUse!.input,
        result: String(result.toolResult!.content).substring(0, 100),
        success: !result.toolResult!.is_error
      });
    }
  }

  return toolCalls.reverse();
}
```

**Add to HelperModelMiddleware.ts**:

```typescript
/**
 * Generate tool usage review
 */
async generateToolReview(context: {
  toolCallCount: number;
  recentToolCalls: Array<{
    tool: string;
    input: any;
    result: string;
    success: boolean;
  }>;
  analyzeEfficiency: boolean;
}): Promise<string> {
  const prompt = context.analyzeEfficiency
    ? this.buildToolEfficiencyPrompt(context)
    : this.buildToolSummaryPrompt(context);

  const response = await this.chat(prompt);
  return this.extractThinkingContent(response);
}

/**
 * Build tool efficiency analysis prompt
 */
private buildToolEfficiencyPrompt(context: any): string {
  const toolSummary = this.summarizeToolCalls(context.recentToolCalls);

  return `You are an AI mentor reviewing tool usage.

**Total Tool Calls**: ${context.toolCallCount}
**Recent Tool Activity** (last 10 calls):
${toolSummary}

Analyze tool usage efficiency:

<thinking>
🛠️ **Tool Usage Review (${context.toolCallCount} calls)**

**Activity Summary**: [What tools were used and for what]

**Efficiency Assessment**:
- Success Rate: [X/10 successful]
- Pattern: [Any inefficiencies or repeated errors?]

**Recommendations**:
- [Suggestion 1 for better tool usage]
- [Suggestion 2 if applicable]
</thinking>

Focus on actionable insights, not just description.`;
}

/**
 * Summarize tool calls for prompt
 */
private summarizeToolCalls(calls: Array<any>): string {
  return calls.map((call, i) => {
    const status = call.success ? '✓' : '✗';
    return `${i + 1}. ${status} ${call.tool} - ${call.result}`;
  }).join('\n');
}
```

## Feature 4: Active Mentor Mode

**Concept**: Toggle on/off continuous mentorship with configurable frequency.

### Slash Command Integration

```typescript
// Register slash command
slashCommands.register({
  command: '/active-mentor-mode',
  description: 'Toggle active mentor mode for continuous guidance',
  handler: async (args: string[]) => {
    const mode = args[0]?.toLowerCase();

    switch (mode) {
      case 'on':
      case 'enable':
        await orchestrator.enableActiveMentorMode({
          turnInterval: parseInt(args[1]) || 10,
          toolInterval: parseInt(args[2]) || 10
        });
        return 'Active Mentor Mode: ENABLED';

      case 'off':
      case 'disable':
        await orchestrator.disableActiveMentorMode();
        return 'Active Mentor Mode: DISABLED';

      case 'status':
        return orchestrator.getActiveMentorStatus();

      default:
        return `Usage: /active-mentor-mode [on|off|status] [turnInterval] [toolInterval]

Examples:
  /active-mentor-mode on           # Enable with defaults (every 10 turns/tools)
  /active-mentor-mode on 20 15     # Custom: every 20 turns, 15 tool calls
  /active-mentor-mode off          # Disable
  /active-mentor-mode status       # Check current status`;
    }
  }
});
```

### Implementation

**Add to CortexOrchestrator.ts**:

```typescript
/**
 * Active mentor mode state
 */
private activeMentorMode = {
  enabled: false,
  turnInterval: 10,
  toolInterval: 10,
  lastReviewTurn: 0,
  lastReviewToolCount: 0
};

/**
 * Enable active mentor mode
 */
async enableActiveMentorMode(config?: {
  turnInterval?: number;
  toolInterval?: number;
}): Promise<void> {
  this.activeMentorMode.enabled = true;
  this.activeMentorMode.turnInterval = config?.turnInterval || 10;
  this.activeMentorMode.toolInterval = config?.toolInterval || 10;
  this.activeMentorMode.lastReviewTurn = this.turnNumber;
  this.activeMentorMode.lastReviewToolCount = this.toolCallCount;

  if (this.config.debug) {
    console.log('[Mentorship] Active Mentor Mode ENABLED', this.activeMentorMode);
  }

  // Immediate welcome message
  await this.injectThinkingBlock(
    `🤖 **Active Mentor Mode Enabled**\n\n` +
    `I'll provide periodic guidance every ${this.activeMentorMode.turnInterval} turns ` +
    `and every ${this.activeMentorMode.toolInterval} tool calls.\n\n` +
    `You can disable this anytime with /active-mentor-mode off`
  );
}

/**
 * Disable active mentor mode
 */
async disableActiveMentorMode(): Promise<void> {
  this.activeMentorMode.enabled = false;

  if (this.config.debug) {
    console.log('[Mentorship] Active Mentor Mode DISABLED');
  }

  await this.injectThinkingBlock(
    `🤖 **Active Mentor Mode Disabled**\n\n` +
    `Periodic guidance has been turned off. ` +
    `Error-triggered mentorship and keywords still active.`
  );
}

/**
 * Get active mentor status
 */
getActiveMentorStatus(): string {
  if (!this.activeMentorMode.enabled) {
    return 'Active Mentor Mode: DISABLED';
  }

  const turnsSinceReview = this.turnNumber - this.activeMentorMode.lastReviewTurn;
  const toolsSinceReview = this.toolCallCount - this.activeMentorMode.lastReviewToolCount;

  return `Active Mentor Mode: ENABLED

Configuration:
  Turn Interval: ${this.activeMentorMode.turnInterval}
  Tool Interval: ${this.activeMentorMode.toolInterval}

Status:
  Turns since last review: ${turnsSinceReview}/${this.activeMentorMode.turnInterval}
  Tools since last review: ${toolsSinceReview}/${this.activeMentorMode.toolInterval}
  Next review in: ${Math.min(
    this.activeMentorMode.turnInterval - turnsSinceReview,
    this.activeMentorMode.toolInterval - toolsSinceReview
  )} turns or tool calls`;
}

/**
 * Check if active mentor should trigger
 */
private shouldTriggerActiveMentor(): {
  trigger: boolean;
  reason?: 'turn' | 'tool';
} {
  if (!this.activeMentorMode.enabled) {
    return { trigger: false };
  }

  // Check turn-based trigger
  const turnsSinceReview = this.turnNumber - this.activeMentorMode.lastReviewTurn;
  if (turnsSinceReview >= this.activeMentorMode.turnInterval) {
    return { trigger: true, reason: 'turn' };
  }

  // Check tool-based trigger
  const toolsSinceReview = this.toolCallCount - this.activeMentorMode.lastReviewToolCount;
  if (toolsSinceReview >= this.activeMentorMode.toolInterval) {
    return { trigger: true, reason: 'tool' };
  }

  return { trigger: false };
}

/**
 * Handle active mentor trigger
 */
private async handleActiveMentorTrigger(reason: 'turn' | 'tool'): Promise<void> {
  if (this.config.debug) {
    console.log(`[Mentorship] Active Mentor triggered by ${reason}`);
  }

  // Generate review based on trigger reason
  const guidance = reason === 'turn'
    ? await this.helperModelMiddleware.generatePeriodicReview({
        turnNumber: this.turnNumber,
        recentHistory: this.canonicalHistory.slice(-20),
        includeStrategicAdvice: true
      })
    : await this.helperModelMiddleware.generateToolReview({
        toolCallCount: this.toolCallCount,
        recentToolCalls: this.extractRecentToolCalls(10),
        analyzeEfficiency: true
      });

  await this.injectThinkingBlock(guidance);

  // Update last review markers
  if (reason === 'turn') {
    this.activeMentorMode.lastReviewTurn = this.turnNumber;
  } else {
    this.activeMentorMode.lastReviewToolCount = this.toolCallCount;
  }
}

/**
 * Unified mentorship check (called at key points)
 */
private async checkMentorshipTriggers(): Promise<void> {
  // Check active mentor mode
  const activeMentor = this.shouldTriggerActiveMentor();
  if (activeMentor.trigger) {
    await this.handleActiveMentorTrigger(activeMentor.reason!);
    return; // Only one trigger per check
  }

  // Check periodic review (if not in active mode)
  if (this.shouldTriggerPeriodicReview()) {
    await this.handlePeriodicReview();
    return;
  }

  // Check tool-based review (if not in active mode)
  if (this.shouldTriggerToolBasedReview()) {
    await this.handleToolBasedReview();
  }
}
```

## Integration Points

### Hook 1: After User Message Processing

```typescript
async sendMessage(content: string, options?: SendMessageOptions): Promise<OrchestratorResponse> {
  // Existing: Keyword detection

  // NEW: Check all mentorship triggers
  await this.checkMentorshipTriggers();

  // Continue with message processing
}
```

### Hook 2: After Model Response

```typescript
async processModelResponse(response: OrchestratorResponse): Promise<void> {
  // Existing: Store response

  // NEW: Check if model requested mentor
  const mentorRequest = this.detectModelMentorRequest(response.message);
  if (mentorRequest) {
    await this.handleModelMentorRequest(mentorRequest);
  }
}
```

### Hook 3: After Tool Execution

```typescript
async handleToolUse(toolUse: CanonicalToolUse): Promise<void> {
  // Existing: Execute tool

  // NEW: Increment counter and check triggers
  this.toolCallCount++;
  await this.checkMentorshipTriggers();
}
```

## Configuration Summary

```typescript
const orchestrator = new CortexOrchestrator({
  defaultModelId: 'grok-code-fast-1',
  helperModelId: 'grok-beta',

  reactiveMentorship: {
    enabled: true,

    // Error-triggered (from base implementation)
    triggerOnError: true,
    errorSeverityThreshold: 'medium',

    // Keyword-triggered (from base implementation)
    enableKeywords: true,
    customKeywords: ['@ultrathink', '@analyze', '@rethink'],

    // NEW: Turn-based periodic review
    periodicReview: {
      enabled: true,
      turnInterval: 20,  // Every 20 turns
      includeStrategicAdvice: true
    },

    // NEW: Tool-based periodic review
    toolBasedReview: {
      enabled: true,
      toolCallInterval: 10,  // Every 10 tool calls
      analyzeToolEfficiency: true
    },

    // NEW: Model-triggered mentorship
    enableModelTriggering: true,
    provideRequestMentorTool: true  // Add request_mentor_help tool
  }
});
```

## Example Usage Scenarios

### Scenario 1: Model Gets Stuck

```
Turn 15: Model: [Attempts approach A] - Fails
Turn 16: Model: [Attempts approach A again] - Fails
Turn 17: Model: [Attempts approach A third time] - Fails
Turn 18: Model calls: request_mentor_help({
           reason: "Tried same approach 3 times without success",
           question: "Should I try a fundamentally different strategy?"
         })

→ Mentor analyzes situation
→ Identifies repeated failure pattern
→ Injects guidance:

<thinking>
🤝 **Mentor Response to Request**

**Understanding the Issue**: You're stuck in a loop trying the same approach

**Strategic Guidance**:
- Current approach (searching logs) isn't finding TypeScript errors
- TypeScript errors come from compiler, not runtime logs
- Pivot to running `npx tsc --noEmit` directly

**Answer**: Yes, fundamentally different strategy recommended
</thinking>

Turn 19: Model: "Thank you. Let me run the TypeScript compiler instead..."
```

### Scenario 2: Active Mentor Mode

```
User: "/active-mentor-mode on 10 10"

→ Active Mentor Mode enabled
→ Every 10 turns OR 10 tool calls, mentor reviews and provides guidance

Turn 10: [Periodic review]
<thinking>
📋 **Periodic Review (Turn 10)**
Progress: Successfully read 3 files, analyzed code structure
Status: On track, making good progress
</thinking>

[10 tool calls later]
<thinking>
🛠️ **Tool Usage Review (10 calls)**
Tools used: Read (5x), Bash (3x), Grep (2x)
Success Rate: 9/10 successful
Recommendation: Good tool selection, consider using Glob for file discovery
</thinking>
```

### Scenario 3: Turn-Based Review Discovers Issue

```
Turn 20: [Automatic periodic review]

<thinking>
📋 **Periodic Review (Turn 20)**

**Progress**: Read 15 files individually over last 20 turns

**Current Trajectory**: Inefficient - reading files one by one

**Strategic Recommendation**:
- Use Glob to find all relevant files first
- Then batch read the important ones
- This would be 3-4 tool calls instead of 15+

**Watch Out For**: Continuing to read files individually without pattern
</thinking>

Turn 21: Model adjusts approach based on guidance
```

## Cost Analysis

### Additional Triggers Cost

| Trigger Type | Frequency | Tokens/Event | Cost/Event | Per 50 Turns |
|-------------|-----------|--------------|------------|--------------|
| Model-triggered | 0-2x | ~1000 | $0.002 | $0.004 |
| Turn-based (every 20) | 2-3x | ~1500 | $0.003 | $0.009 |
| Tool-based (every 10) | 3-5x | ~1500 | $0.003 | $0.015 |
| Active mode (10/10) | 5-10x | ~1500 | $0.003 | $0.030 |

**Total with all features**: ~$0.06 per 50-turn conversation (still <5% overhead)

## Implementation Checklist

### Phase 1: Model-Triggered (Week 1)
- [ ] Add `request_mentor_help` tool to base tools
- [ ] Implement `detectModelMentorRequest()` in Orchestrator
- [ ] Add `generateModelRequestGuidance()` to HelperModelMiddleware
- [ ] Test model requesting help during stuck situations

### Phase 2: Turn-Based Review (Week 2)
- [ ] Add `shouldTriggerPeriodicReview()` logic
- [ ] Implement `generatePeriodicReview()` with strategic/summary modes
- [ ] Add configuration for turn interval
- [ ] Test review quality and frequency

### Phase 3: Tool-Based Review (Week 2)
- [ ] Add tool call counter
- [ ] Implement `extractRecentToolCalls()` helper
- [ ] Add `generateToolReview()` with efficiency analysis
- [ ] Test with tool-heavy workflows

### Phase 4: Active Mentor Mode (Week 3)
- [ ] Implement `/active-mentor-mode` slash command
- [ ] Add active mentor state management
- [ ] Integrate with turn-based and tool-based checks
- [ ] Test enable/disable functionality

### Phase 5: Unified Integration (Week 3)
- [ ] Create `checkMentorshipTriggers()` unified method
- [ ] Wire into sendMessage(), handleToolUse(), processResponse()
- [ ] Ensure triggers don't conflict (priority system)
- [ ] Test all trigger types together

### Phase 6: Polish (Week 4)
- [ ] Optimize prompts based on usage
- [ ] Add debug logging for all trigger types
- [ ] Document configuration options
- [ ] Create user guide

## Configuration Best Practices

### Conservative (Low Cost)
```typescript
reactiveMentorship: {
  enabled: true,
  triggerOnError: true,
  errorSeverityThreshold: 'high',
  enableKeywords: true,
  periodicReview: { enabled: false },  // Disable automatic
  toolBasedReview: { enabled: false }  // Disable automatic
}
```

### Balanced (Recommended)
```typescript
reactiveMentorship: {
  enabled: true,
  triggerOnError: true,
  errorSeverityThreshold: 'medium',
  enableKeywords: true,
  periodicReview: {
    enabled: true,
    turnInterval: 20,
    includeStrategicAdvice: true
  },
  toolBasedReview: {
    enabled: true,
    toolCallInterval: 15,
    analyzeToolEfficiency: false  // Lightweight
  }
}
```

### Aggressive (Maximum Guidance)
```typescript
reactiveMentorship: {
  enabled: true,
  triggerOnError: true,
  errorSeverityThreshold: 'low',
  enableKeywords: true,
  periodicReview: {
    enabled: true,
    turnInterval: 10,
    includeStrategicAdvice: true
  },
  toolBasedReview: {
    enabled: true,
    toolCallInterval: 10,
    analyzeToolEfficiency: true
  }
}

// Or use Active Mentor Mode:
// /active-mentor-mode on 10 10
```

## Summary

**New Triggers Added**:
1. ✅ **Model-Triggered** - Model can request help (tool or marker)
2. ✅ **Turn-Based** - Automatic review every N turns
3. ✅ **Tool-Based** - Review after N tool calls
4. ✅ **Active Mentor Mode** - Continuous guidance toggle

**Implementation Complexity**: Still simple hooks + prompts
**Total New Code**: ~800 lines (including all 4 features)
**Timeline**: 3-4 weeks (can be done in parallel with base implementation)
**Cost Impact**: <5% even with all features enabled
**User Control**: Full configuration + slash command toggle

These extensions transform the mentorship system from reactive-only to a flexible, multi-trigger intelligent guidance system while maintaining simplicity and low cost.
