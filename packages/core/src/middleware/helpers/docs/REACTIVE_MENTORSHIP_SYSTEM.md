# Reactive Mentorship System - Event-Driven AI Guidance

## Overview

**Reactive Mentorship** transforms the helper model from a periodic summarizer into a real-time mentor that:
1. **Detects critical events** (errors, failures, user triggers)
2. **Analyzes the situation** using a smarter mentor model
3. **Injects guidance** as interleaved reasoning blocks into the message stream
4. **Provides synthetic reasoning** for non-reasoning models

This creates an "UltraThink" capability where any model can receive reasoning-enhanced guidance through AI mentorship.

## Trigger Mechanisms

### 1. Error-Triggered Mentorship (Automatic)

**Concept**: When the main model encounters an error, automatically trigger mentor model analysis and inject advice.

**Error Sources**:
- Bash command failures (exit code ≠ 0)
- Tool execution errors (`is_error: true` in tool_result)
- API errors (rate limits, invalid requests)
- Validation errors (malformed tool calls)

**Flow**:
```
Turn N:   Model executes Bash command
Turn N+1: Tool result returns with error
          → ERROR DETECTED
          → Trigger mentor model analysis
          → Generate advice
          → Inject as thinking block
Turn N+1: Model receives thinking block with error analysis + suggestions
Turn N+2: Model can act on advice
```

### 2. Keyword-Triggered Mentorship (Explicit)

**Concept**: User types special keywords to request deep analysis and guidance.

**Keywords**:
- `@ultrathink` - Deep analysis with strategic recommendations
- `@analyze` - Analyze recent approach and suggest improvements
- `@rethink` - Reconsider current strategy
- `@mentor` - Request mentor model review
- `@help` - Get contextual assistance

**Flow**:
```
Turn N:   User: "I'm stuck. @ultrathink"
          → KEYWORD DETECTED
          → Trigger mentor model with full context
          → Generate comprehensive guidance
          → Inject as thinking block
Turn N+1: Model receives detailed analysis and recommendations
          Model responds with improved approach
```

### 3. Failure Pattern Detection (Intelligent)

**Concept**: Detect repeated failures and automatically trigger mentorship.

**Patterns**:
- Same tool called 3+ times with errors
- Same file read multiple times without progress
- Loop detection (similar actions repeated)
- Timeout patterns (long-running commands)

**Flow**:
```
Turn N:   Model attempts solution A (fails)
Turn N+1: Model attempts solution A again (fails)
Turn N+2: Model attempts solution A third time (fails)
          → PATTERN DETECTED: Repeated failure
          → Trigger mentor model
          → Suggest alternative approach
Turn N+3: Model receives guidance, tries alternative B
```

### 4. Manual Invocation (User Control)

**Concept**: User explicitly requests mentorship at any point.

**API**:
```typescript
// In conversation
await orchestrator.invokeMentorship({
  context: 'current',
  depth: 'comprehensive',
  focus: ['alternatives', 'documentation']
});
```

## Architecture

### 1. Event Detection Layer

```typescript
/**
 * Mentorship Event Detector
 * Monitors execution for events that should trigger mentorship
 */
class MentorshipEventDetector {
  private failureHistory: Map<string, FailureRecord[]> = new Map();
  private keywords = ['@ultrathink', '@analyze', '@rethink', '@mentor', '@help'];

  /**
   * Detect mentorship triggers in tool result
   */
  detectTrigger(
    toolResult: CanonicalToolResult,
    recentHistory: CanonicalMessage[]
  ): MentorshipTrigger | null {
    // 1. Error detection
    if (toolResult.is_error) {
      return {
        type: 'error',
        severity: this.assessErrorSeverity(toolResult),
        context: {
          tool: toolResult.tool_use_id,
          error: toolResult.content,
          recentHistory
        }
      };
    }

    // 2. Failure pattern detection
    const pattern = this.detectFailurePattern(toolResult, recentHistory);
    if (pattern) {
      return {
        type: 'pattern',
        severity: 'high',
        context: {
          pattern: pattern.type,
          occurrences: pattern.count,
          suggestion: pattern.breakout
        }
      };
    }

    return null;
  }

  /**
   * Detect keyword triggers in user input
   */
  detectKeyword(userInput: string): MentorshipTrigger | null {
    for (const keyword of this.keywords) {
      if (userInput.includes(keyword)) {
        return {
          type: 'keyword',
          severity: 'high',
          context: {
            keyword,
            requestType: this.parseKeywordIntent(keyword),
            userInput
          }
        };
      }
    }
    return null;
  }

  /**
   * Detect repeated failure patterns
   */
  private detectFailurePattern(
    toolResult: CanonicalToolResult,
    history: CanonicalMessage[]
  ): FailurePattern | null {
    const toolName = this.extractToolName(toolResult);

    // Track failures for this tool
    if (!this.failureHistory.has(toolName)) {
      this.failureHistory.set(toolName, []);
    }

    const failures = this.failureHistory.get(toolName)!;
    failures.push({
      timestamp: Date.now(),
      error: toolResult.content,
      input: this.extractToolInput(toolResult)
    });

    // Check for patterns
    if (failures.length >= 3) {
      // Same tool failed 3+ times
      return {
        type: 'repeated_failure',
        count: failures.length,
        breakout: 'Try alternative approach or different tool'
      };
    }

    // Check for loop patterns (same inputs)
    const uniqueInputs = new Set(failures.map(f => JSON.stringify(f.input)));
    if (uniqueInputs.size === 1 && failures.length >= 2) {
      return {
        type: 'infinite_loop',
        count: failures.length,
        breakout: 'Input unchanged - need different parameters'
      };
    }

    return null;
  }

  /**
   * Assess error severity to determine if mentorship needed
   */
  private assessErrorSeverity(toolResult: CanonicalToolResult): 'low' | 'medium' | 'high' {
    const errorText = String(toolResult.content).toLowerCase();

    // High severity: Blocking errors
    if (
      errorText.includes('permission denied') ||
      errorText.includes('not found') ||
      errorText.includes('syntax error') ||
      errorText.includes('command not found')
    ) {
      return 'high';
    }

    // Medium severity: Warnings, non-critical errors
    if (
      errorText.includes('warning') ||
      errorText.includes('deprecated')
    ) {
      return 'medium';
    }

    return 'low';
  }
}
```

### 2. Mentor Model Routing

```typescript
/**
 * Mentor Model Router
 * Routes mentorship requests to appropriate model based on complexity
 */
class MentorModelRouter {
  /**
   * Select mentor model based on trigger type and severity
   */
  selectMentorModel(trigger: MentorshipTrigger): ModelConfig {
    const { type, severity } = trigger;

    // High-complexity requests → Use smartest model
    if (
      type === 'keyword' ||
      severity === 'high' ||
      trigger.context.requestType === 'comprehensive'
    ) {
      // Use high-intelligence mentor model
      return this.registry.getModel('claude-sonnet-4-5');
      // or: deepseek-reasoner, gpt-4, etc.
    }

    // Medium-complexity requests → Use balanced model
    if (severity === 'medium' || type === 'pattern') {
      return this.registry.getModel('claude-sonnet-3-5');
    }

    // Low-complexity requests → Use efficient model
    return this.registry.getModel('grok-beta'); // Fast, cheap mentor
  }

  /**
   * Estimate mentorship cost
   */
  estimateCost(trigger: MentorshipTrigger, mentorModel: ModelConfig): number {
    const contextTokens = this.estimateContextSize(trigger);
    const responseTokens = this.estimateResponseSize(trigger);

    return (
      (contextTokens * mentorModel.inputCost / 1_000_000) +
      (responseTokens * mentorModel.outputCost / 1_000_000)
    );
  }
}
```

### 3. Mentor Analysis Engine

```typescript
/**
 * Mentor Analysis Engine
 * Generates guidance based on detected triggers
 */
class MentorAnalysisEngine {
  /**
   * Analyze error and generate guidance
   */
  async analyzeError(
    trigger: MentorshipTrigger,
    mentorModel: ModelConfig
  ): Promise<MentorGuidance> {
    const { error, tool, recentHistory } = trigger.context;

    const prompt = `You are an AI mentor analyzing another AI's execution.

**Situation**: The AI model encountered an error while using a tool.

**Tool**: ${tool}
**Error**: ${error}

**Recent Actions** (last 5 turns):
${this.formatRecentHistory(recentHistory)}

As a mentor, provide:
1. **Error Diagnosis**: What went wrong and why?
2. **Root Cause**: Underlying reason for the failure
3. **Immediate Fix**: Specific steps to resolve this error
4. **Alternative Approach**: Different strategy if fix doesn't work
5. **Preventive Advice**: How to avoid this error in future

Format as thinking block:
<thinking>
[Your analysis and advice here]
</thinking>`;

    const response = await this.sendToMentor(prompt, mentorModel);

    return {
      type: 'error_analysis',
      thinking: this.extractThinkingBlock(response),
      confidence: 0.9,
      actionable: true
    };
  }

  /**
   * Analyze failure pattern and suggest breakout
   */
  async analyzePattern(
    trigger: MentorshipTrigger,
    mentorModel: ModelConfig
  ): Promise<MentorGuidance> {
    const { pattern, occurrences } = trigger.context;

    const prompt = `You are an AI mentor analyzing another AI's execution pattern.

**Pattern Detected**: ${pattern}
**Occurrences**: ${occurrences} times
**Last Attempt**: ${this.getLastAttempt(trigger)}

The model appears stuck in a loop or repeated failure pattern.

As a mentor, provide:
1. **Pattern Analysis**: Why is the model stuck?
2. **Strategic Pivot**: Fundamentally different approach to try
3. **Concrete Steps**: Specific actions for new strategy
4. **Success Criteria**: How to know if new approach is working

Format as thinking block with urgency:
<thinking>
⚠️ **Pattern Detected**: I've tried this approach ${occurrences} times without success.

[Your strategic analysis and pivot recommendation]
</thinking>`;

    const response = await this.sendToMentor(prompt, mentorModel);

    return {
      type: 'pattern_analysis',
      thinking: this.extractThinkingBlock(response),
      confidence: 0.95,
      actionable: true,
      urgent: true
    };
  }

  /**
   * Handle keyword trigger (UltraThink, etc.)
   */
  async processKeyword(
    trigger: MentorshipTrigger,
    mentorModel: ModelConfig
  ): Promise<MentorGuidance> {
    const { keyword, userInput, recentHistory } = trigger.context;

    const prompt = this.buildKeywordPrompt(keyword, userInput, recentHistory);
    const response = await this.sendToMentor(prompt, mentorModel);

    return {
      type: 'keyword_response',
      thinking: this.extractThinkingBlock(response),
      confidence: 0.95,
      actionable: true,
      comprehensive: keyword === '@ultrathink'
    };
  }

  /**
   * Build prompt based on keyword type
   */
  private buildKeywordPrompt(
    keyword: string,
    userInput: string,
    history: CanonicalMessage[]
  ): string {
    switch (keyword) {
      case '@ultrathink':
        return `You are an expert AI mentor providing deep strategic analysis.

The user requested UltraThink - a comprehensive review and strategic guidance.

**User Request**: ${userInput}

**Conversation History** (last 10 turns):
${this.formatHistory(history, 10)}

Provide comprehensive analysis:
1. **Current Situation Assessment**: What has been tried, what worked, what didn't
2. **Strategic Analysis**: High-level evaluation of approach
3. **Multiple Strategies**: 3-4 different approaches ranked by likelihood of success
4. **Detailed Implementation**: Step-by-step for top 2 strategies
5. **Potential Pitfalls**: What to watch for
6. **Success Metrics**: How to measure progress

Format as extended thinking:
<thinking>
🧠 **UltraThink Analysis Requested**

[Comprehensive analysis here - be thorough, strategic, and actionable]
</thinking>`;

      case '@analyze':
        return `Analyze the recent approach and suggest improvements.

**Recent Actions**:
${this.formatHistory(history, 5)}

Provide:
1. Efficiency assessment
2. 2-3 specific improvements
3. Quick wins

<thinking>
📊 **Analysis of Recent Approach**
[Your analysis]
</thinking>`;

      case '@rethink':
        return `Reconsider the current strategy from first principles.

**Current Approach**:
${this.summarizeApproach(history)}

Challenge assumptions and suggest alternative:
<thinking>
🔄 **Rethinking Strategy**
[Your reconsidered approach]
</thinking>`;

      case '@mentor':
        return `Provide mentorship guidance for current situation.

**Context**:
${this.formatHistory(history, 5)}

Act as helpful mentor:
<thinking>
👨‍🏫 **Mentor Guidance**
[Your mentorship advice]
</thinking>`;

      default:
        return this.buildGenericPrompt(userInput, history);
    }
  }
}
```

### 4. Thinking Block Injection

```typescript
/**
 * Thinking Block Injector
 * Injects mentor guidance as thinking blocks into message stream
 */
class ThinkingBlockInjector {
  /**
   * Inject mentor guidance as thinking block
   * Works for BOTH reasoning and non-reasoning models
   */
  async injectMentorThinking(
    guidance: MentorGuidance,
    currentMessage: CanonicalMessage,
    model: ModelConfig
  ): Promise<CanonicalMessage> {
    // Create thinking content block
    const thinkingBlock: CanonicalContentBlock = {
      type: 'thinking',
      thinking: guidance.thinking
    };

    // For reasoning models: Add to their thinking
    if (model.reasoning?.supported) {
      return this.appendToModelThinking(currentMessage, thinkingBlock);
    }

    // For non-reasoning models: Inject synthetic thinking
    return this.injectSyntheticThinking(currentMessage, thinkingBlock);
  }

  /**
   * Append thinking to reasoning model's existing thinking
   */
  private appendToModelThinking(
    message: CanonicalMessage,
    mentorThinking: CanonicalContentBlock
  ): CanonicalMessage {
    // Find existing thinking blocks
    const thinkingBlocks = message.content.filter(c => c.type === 'thinking');

    if (thinkingBlocks.length > 0) {
      // Append to last thinking block
      const lastThinking = thinkingBlocks[thinkingBlocks.length - 1];
      lastThinking.thinking += '\n\n---\n💡 **Mentor Model Insight**:\n' + mentorThinking.thinking;
    } else {
      // Add new thinking block
      message.content.unshift(mentorThinking);
    }

    return message;
  }

  /**
   * Inject synthetic thinking for non-reasoning models
   * This gives them "thinking capability" through mentorship
   */
  private injectSyntheticThinking(
    message: CanonicalMessage,
    mentorThinking: CanonicalContentBlock
  ): CanonicalMessage {
    // Add mentor thinking as first content block
    // Model will see this as if it were its own reasoning
    message.content.unshift({
      ...mentorThinking,
      thinking: `💭 **Internal Analysis** (AI Mentor)\n\n${mentorThinking.thinking}`
    });

    // Mark message as having synthetic reasoning
    message.metadata = {
      ...message.metadata,
      syntheticReasoning: true,
      mentorModelUsed: true
    };

    return message;
  }

  /**
   * Inject as system reminder (alternative approach)
   * More explicit that guidance is from mentor
   */
  private injectAsSystemReminder(
    guidance: MentorGuidance
  ): SystemMessageForInjection {
    const content = `<system-reminder>
🤖 **AI Mentor Analysis**

${guidance.thinking}

*This guidance was generated by your AI mentor to help you navigate this situation more effectively.*
</system-reminder>`;

    return {
      content,
      position: 'prepend',
      priority: 15, // Very high priority (immediate attention)
      wrapInSystemReminder: false, // Already wrapped
      contentHash: this.generateHash(content),
      definition: {
        id: 'mentor_guidance',
        name: 'Real-time Mentor Guidance'
      }
    };
  }
}
```

## Integration with Orchestrator

```typescript
class CortexOrchestrator {
  private mentorshipDetector: MentorshipEventDetector;
  private mentorRouter: MentorModelRouter;
  private mentorEngine: MentorAnalysisEngine;
  private thinkingInjector: ThinkingBlockInjector;

  /**
   * Process tool result with mentorship detection
   */
  async processToolResult(
    toolUseId: string,
    result: CanonicalToolResult
  ): Promise<void> {
    // 1. Standard tool result processing
    const toolResultMessage = this.createToolResultMessage(toolUseId, result);
    this.canonicalHistory.push(toolResultMessage);

    // 2. Check for mentorship triggers
    const trigger = this.mentorshipDetector.detectTrigger(
      result,
      this.getRecentHistory(5)
    );

    if (trigger && this.shouldTriggerMentorship(trigger)) {
      // 3. Generate mentor guidance
      await this.triggerMentorship(trigger);
    }
  }

  /**
   * Process user input with keyword detection
   */
  async sendMessage(content: string, options?: SendMessageOptions): Promise<OrchestratorResponse> {
    // 1. Check for keyword triggers
    const keywordTrigger = this.mentorshipDetector.detectKeyword(content);

    if (keywordTrigger) {
      // Remove keyword from user message (clean it up)
      content = this.removeKeyword(content, keywordTrigger.context.keyword);

      // Trigger mentorship BEFORE sending to model
      await this.triggerMentorship(keywordTrigger);
    }

    // 2. Standard message processing
    return this.standardSendMessage(content, options);
  }

  /**
   * Trigger mentorship analysis and injection
   */
  private async triggerMentorship(trigger: MentorshipTrigger): Promise<void> {
    if (this.config.debug) {
      console.log(`[Mentorship] Trigger detected: ${trigger.type} (${trigger.severity})`);
    }

    // 1. Select appropriate mentor model
    const mentorModel = this.mentorRouter.selectMentorModel(trigger);

    if (this.config.debug) {
      console.log(`[Mentorship] Using mentor model: ${mentorModel.id}`);
    }

    // 2. Generate guidance
    let guidance: MentorGuidance;

    switch (trigger.type) {
      case 'error':
        guidance = await this.mentorEngine.analyzeError(trigger, mentorModel);
        break;

      case 'pattern':
        guidance = await this.mentorEngine.analyzePattern(trigger, mentorModel);
        break;

      case 'keyword':
        guidance = await this.mentorEngine.processKeyword(trigger, mentorModel);
        break;

      default:
        return; // Unknown trigger type
    }

    // 3. Inject guidance into message stream
    await this.injectGuidance(guidance, trigger);
  }

  /**
   * Inject guidance into conversation stream
   */
  private async injectGuidance(
    guidance: MentorGuidance,
    trigger: MentorshipTrigger
  ): Promise<void> {
    const injectionMethod = this.config.mentorshipInjectionMethod || 'thinking_block';

    switch (injectionMethod) {
      case 'thinking_block':
        // Inject as thinking block (appears as model's own reasoning)
        await this.injectAsThinkingBlock(guidance);
        break;

      case 'system_reminder':
        // Inject as system reminder (explicit mentor guidance)
        await this.injectAsSystemReminder(guidance);
        break;

      case 'hybrid':
        // Use thinking for reasoning models, system reminder for others
        if (this.currentModel.reasoning?.supported) {
          await this.injectAsThinkingBlock(guidance);
        } else {
          await this.injectAsSystemReminder(guidance);
        }
        break;
    }

    // Track mentorship event
    this.trackMentorshipEvent({
      trigger,
      guidance,
      mentorModel: guidance.mentorModelUsed,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Inject guidance as thinking block
   */
  private async injectAsThinkingBlock(guidance: MentorGuidance): Promise<void> {
    // Create synthetic assistant message with thinking block
    const mentorMessage: CanonicalMessage = {
      uuid: this.generateUuid(),
      timestamp: new Date().toISOString(),
      role: 'assistant',
      type: 'thinking',
      content: [{
        type: 'thinking',
        thinking: guidance.thinking
      }],
      timeline: {
        sessionId: this.currentSessionId,
        conversationId: this.currentConversationId,
        turnNumber: this.turnNumber
      },
      model: {
        id: guidance.mentorModelUsed,
        provider: 'mentor',
        apiPattern: 'mentorship'
      },
      metadata: {
        mentorshipGuidance: true,
        triggerType: guidance.type,
        synthetic: !this.currentModel.reasoning?.supported
      }
    };

    // Add to canonical history
    this.canonicalHistory.push(mentorMessage);

    // Store to JSONL
    await this.historyStore.appendMessage(this.currentSessionId, mentorMessage);

    if (this.config.debug) {
      console.log('[Mentorship] Guidance injected as thinking block');
    }
  }

  /**
   * Determine if mentorship should trigger based on configuration
   */
  private shouldTriggerMentorship(trigger: MentorshipTrigger): boolean {
    // Check if mentorship is enabled
    if (this.config.mentorshipMode === MentorshipMode.OFF) {
      return false;
    }

    // Check severity threshold
    const severityThreshold = this.config.mentorshipConfig?.severityThreshold || 'medium';

    const severityLevels = { low: 1, medium: 2, high: 3 };
    const triggerLevel = severityLevels[trigger.severity];
    const thresholdLevel = severityLevels[severityThreshold];

    return triggerLevel >= thresholdLevel;
  }
}
```

## Synthetic Reasoning for Non-Reasoning Models

### Concept

Give non-reasoning models (GPT-4-turbo, Claude 3 Opus, etc.) thinking capability through mentor injection:

```typescript
// Example: GPT-4-turbo encounters bash error

// Turn N: Model executes broken command
{
  role: 'assistant',
  content: [
    { type: 'tool_use', name: 'Bash', input: { command: 'npm tset' } }  // Typo!
  ]
}

// Turn N+1: Error result triggers mentorship
{
  role: 'user',
  content: [
    {
      type: 'tool_result',
      tool_use_id: 'toolu_123',
      content: 'bash: npm: command not found',
      is_error: true
    }
  ]
}

// MENTOR MODEL ACTIVATED
// Analyzes error, generates guidance

// Turn N+1 (continued): Synthetic thinking injected
{
  role: 'assistant',
  content: [
    {
      type: 'thinking',
      thinking: `💭 **Internal Analysis** (AI Mentor)

<thinking>
I notice the command failed with "command not found" for npm.

**Error Analysis**:
- The command 'npm tset' was attempted
- Typo detected: 'tset' should be 'test'
- npm is installed (it's in package.json), so this is a spelling error

**Corrective Action**:
1. Fix the typo: Use 'npm test' instead of 'npm tset'
2. Verify the test script exists in package.json
3. Run the corrected command

**Confidence**: 95% - This is clearly a typo
</thinking>
      `
    }
  ],
  metadata: {
    syntheticReasoning: true,
    mentorModelUsed: 'claude-sonnet-4-5'
  }
}

// Turn N+2: Model sees "its own" thinking and corrects the error
{
  role: 'assistant',
  content: [
    { type: 'text', text: 'I see the typo in my command. Let me fix that.' },
    { type: 'tool_use', name: 'Bash', input: { command: 'npm test' } }
  ]
}
```

### Key Insight

The non-reasoning model (GPT-4-turbo) never generated thinking blocks, but it receives them as if it did. This creates the illusion of reasoning capability, making the model more effective.

## UltraThink Implementation

### Keyword: `@ultrathink`

**Purpose**: Request comprehensive strategic analysis from mentor model

**User Experience**:
```
User: "I've been trying to fix this TypeScript error for 30 minutes. @ultrathink"

[MENTOR MODEL ACTIVATES]
[Deep analysis of last 10-20 turns]
[Generates comprehensive guidance]

Model receives thinking block:
<thinking>
🧠 **UltraThink Analysis**

**Situation Assessment**:
You've attempted 8 different approaches to fix the TypeScript error:
1. Reading error logs (turns 1-3)
2. Modifying tsconfig.json (turns 4-5)
3. Reinstalling dependencies (turns 6-7)
4. Reading source files (turn 8)

**Analysis**: None of these approaches addressed the root cause.

**Root Cause Hypothesis**:
The error "Cannot find module '@types/node'" suggests missing type definitions,
not a configuration issue.

**Strategic Recommendations** (ranked by likelihood):

1. **Install missing types** (90% confidence)
   ```
   npm install --save-dev @types/node
   ```
   Why: Error message explicitly mentions @types/node
   How: Single command installation
   Verification: Re-run tsc to check if error resolved

2. **Check package.json dependencies** (75% confidence)
   Verify @types/node is in devDependencies
   If not, this confirms our hypothesis

3. **Nuclear option: Rebuild node_modules** (60% confidence)
   ```
   rm -rf node_modules package-lock.json
   npm install
   ```
   Why: Might be corrupted dependencies
   When: If option 1 doesn't work

**Recommended Next Steps**:
1. Try option 1 first (install @types/node)
2. If that works, investigate why it was missing
3. If that fails, move to option 2

**Pitfalls to Avoid**:
- Don't modify tsconfig.json further (you've already tried that)
- Don't reinstall all dependencies yet (save time)
- Focus on the specific missing module

**Success Criteria**:
- `npx tsc --noEmit` runs without errors
- No "Cannot find module" messages
</thinking>

Model: "Thank you for the analysis. Let me install the missing @types/node package."
[Executes npm install --save-dev @types/node]
[Problem solved]
```

### Implementation

```typescript
class UltraThinkHandler {
  /**
   * Process UltraThink request
   */
  async processUltraThink(
    userInput: string,
    conversationHistory: CanonicalMessage[]
  ): Promise<MentorGuidance> {
    // Use the smartest available mentor model
    const mentorModel = this.selectPremiumMentor(); // claude-sonnet-4-5, o1, etc.

    // Analyze extensive context (last 20 turns)
    const context = this.buildExtensiveContext(conversationHistory, 20);

    const prompt = `You are an expert AI mentor providing **UltraThink** analysis.

The user is stuck and requested comprehensive strategic guidance.

**Full Context** (last 20 turns):
${context}

Provide deep, strategic analysis:

1. **Situation Assessment** (What's been tried, what worked/didn't)
2. **Root Cause Analysis** (What's the real problem?)
3. **Multiple Strategies** (3-4 approaches ranked by success likelihood)
4. **Detailed Implementation** (Step-by-step for top 2 strategies)
5. **Pitfalls to Avoid** (Common mistakes)
6. **Success Criteria** (How to measure progress)

Be thorough, strategic, and actionable. This is a critical intervention.

Format as extended thinking block:
<thinking>
🧠 **UltraThink Analysis**

[Your comprehensive analysis - be thorough and strategic]
</thinking>`;

    const response = await this.sendToMentor(prompt, mentorModel);

    return {
      type: 'ultrathink',
      thinking: this.extractThinkingBlock(response),
      confidence: 0.95,
      actionable: true,
      comprehensive: true,
      mentorModelUsed: mentorModel.id
    };
  }

  /**
   * Select premium mentor model for UltraThink
   */
  private selectPremiumMentor(): ModelConfig {
    // Priority: Best available reasoning model
    const candidates = [
      'o1',              // OpenAI o1 (best reasoning)
      'claude-sonnet-4-5', // Claude 4.5 Sonnet (excellent coding)
      'deepseek-reasoner', // DeepSeek Reasoner (good, cheap)
      'grok-4-0709'      // Grok 4 (fast, capable)
    ];

    for (const modelId of candidates) {
      if (this.registry.hasModel(modelId)) {
        return this.registry.getModel(modelId);
      }
    }

    // Fallback to current model
    return this.currentModel;
  }
}
```

## Configuration

```typescript
interface OrchestratorConfig {
  // ... existing fields ...

  // Reactive mentorship configuration
  reactiveMentorship?: {
    /** Enable reactive mentorship */
    enabled: boolean;

    /** Trigger on errors */
    triggerOnError: boolean;

    /** Error severity threshold (low, medium, high) */
    errorSeverityThreshold: 'low' | 'medium' | 'high';

    /** Trigger on failure patterns */
    triggerOnPattern: boolean;

    /** Pattern detection threshold (how many failures) */
    patternThreshold: number;

    /** Enable keyword triggers */
    enableKeywords: boolean;

    /** Custom keywords */
    customKeywords?: string[];

    /** Injection method */
    injectionMethod: 'thinking_block' | 'system_reminder' | 'hybrid';

    /** Mentor model selection */
    mentorModelStrategy: 'auto' | 'fixed' | 'best_available';

    /** Fixed mentor model (if strategy is 'fixed') */
    fixedMentorModel?: string;

    /** Enable synthetic reasoning for non-reasoning models */
    enableSyntheticReasoning: boolean;

    /** Debug logging */
    debug: boolean;
  };
}
```

### Example Configuration

```typescript
const orchestrator = new CortexOrchestrator({
  defaultModelId: 'gpt-4-turbo', // Non-reasoning model

  reactiveMentorship: {
    enabled: true,
    triggerOnError: true,
    errorSeverityThreshold: 'medium',
    triggerOnPattern: true,
    patternThreshold: 3,
    enableKeywords: true,
    customKeywords: ['@ultrathink', '@analyze', '@mentor'],
    injectionMethod: 'hybrid', // Thinking for reasoning models, reminder for others
    mentorModelStrategy: 'best_available',
    enableSyntheticReasoning: true, // Give GPT-4-turbo synthetic reasoning!
    debug: true
  }
});
```

## Benefits

### 1. Real-Time Adaptive Guidance

Traditional compaction runs every N turns. Reactive mentorship triggers **exactly when needed**:
- Errors → Immediate analysis
- Patterns → Breakout suggestions
- User request → On-demand guidance

### 2. Synthetic Reasoning for Any Model

Non-reasoning models (GPT-4-turbo, Claude 3 Opus, Gemini 1.5 Pro) get thinking capability:
- Mentor generates reasoning
- Injected as thinking blocks
- Model sees guidance as if it were its own thoughts
- Improves decision-making without native reasoning support

### 3. UltraThink On-Demand

User can invoke deep analysis whenever stuck:
```
@ultrathink → Full strategic review
@analyze   → Quick improvement suggestions
@rethink   → Alternative approach
@mentor    → General guidance
```

### 4. Intelligent Model Routing

Critical situations get smarter mentor models:
- Error → Use balanced model (claude-sonnet-3-5)
- Pattern → Use strategic model (deepseek-reasoner)
- UltraThink → Use best model (o1, claude-sonnet-4-5)

### 5. Context-Aware Injection

Guidance injected in the right format:
- **Thinking blocks** for seamless integration
- **System reminders** for explicit mentorship
- **Hybrid** adapts to model capabilities

## Cost Management

### Trigger Frequency

| Trigger Type | Frequency | Avg Cost/Trigger |
|-------------|-----------|------------------|
| Error (high severity) | 1-2 per conversation | $0.02 - $0.05 |
| Pattern detection | 0-1 per conversation | $0.03 - $0.06 |
| Keyword (@ultrathink) | User-controlled | $0.10 - $0.20 |

### Optimization Strategies

1. **Severity Thresholds**: Only trigger on medium+ severity errors
2. **Rate Limiting**: Max 1 mentorship per 3 turns
3. **Model Selection**: Use cheaper models for simple errors
4. **Context Sizing**: Limit history to last 5-10 turns for efficiency

### Example Cost Analysis

**Scenario**: 50-turn conversation with GPT-4-turbo

**Without Reactive Mentorship**:
- Token usage: 150K tokens
- Cost: ~$1.50

**With Reactive Mentorship**:
- 2 error triggers (medium severity)
- 1 pattern trigger
- 1 @ultrathink request
- Additional cost: ~$0.25
- Total: ~$1.75
- **Overhead**: 17%

**Value**: Potentially saves 5-10 turns of trial-and-error → Net savings in efficiency

## Testing

```typescript
describe('Reactive Mentorship System', () => {
  describe('Error Detection', () => {
    it('should trigger mentorship on bash error', async () => {
      const detector = new MentorshipEventDetector();

      const toolResult: CanonicalToolResult = {
        tool_use_id: 'toolu_123',
        content: 'bash: command not found: npm',
        is_error: true
      };

      const trigger = detector.detectTrigger(toolResult, []);

      expect(trigger).toBeDefined();
      expect(trigger!.type).toBe('error');
      expect(trigger!.severity).toBe('high');
    });
  });

  describe('Pattern Detection', () => {
    it('should detect repeated failures', async () => {
      const detector = new MentorshipEventDetector();

      // Simulate 3 failures with same tool
      for (let i = 0; i < 3; i++) {
        const trigger = detector.detectTrigger(failedToolResult, history);
        if (i < 2) {
          expect(trigger?.type).toBe('error');
        } else {
          expect(trigger?.type).toBe('pattern');
        }
      }
    });
  });

  describe('Keyword Detection', () => {
    it('should detect @ultrathink keyword', () => {
      const detector = new MentorshipEventDetector();

      const trigger = detector.detectKeyword('I need help. @ultrathink');

      expect(trigger).toBeDefined();
      expect(trigger!.type).toBe('keyword');
      expect(trigger!.context.keyword).toBe('@ultrathink');
    });
  });

  describe('Synthetic Reasoning', () => {
    it('should inject synthetic thinking for non-reasoning models', async () => {
      const injector = new ThinkingBlockInjector();
      const nonReasoningModel = registry.getModel('gpt-4-turbo');

      const guidance: MentorGuidance = {
        type: 'error_analysis',
        thinking: 'Analysis of the error...',
        confidence: 0.9
      };

      const message = await injector.injectMentorThinking(
        guidance,
        currentMessage,
        nonReasoningModel
      );

      expect(message.content[0].type).toBe('thinking');
      expect(message.metadata?.syntheticReasoning).toBe(true);
    });
  });
});
```

## Summary

**Reactive Mentorship System** creates intelligent, event-driven AI guidance:

✅ **Error-Triggered** - Immediate analysis when errors occur
✅ **Pattern-Aware** - Detects repeated failures, suggests breakout
✅ **Keyword-Activated** - User can invoke mentorship on-demand (@ultrathink)
✅ **Synthetic Reasoning** - Non-reasoning models get thinking capability
✅ **Intelligent Routing** - Right mentor model for each situation
✅ **Context-Aware Injection** - Guidance injected as thinking blocks or system reminders
✅ **Cost-Effective** - Triggers only when needed, not periodically

This transforms Nexus Cortex into a self-improving system where the helper model acts as a real-time mentor, providing strategic guidance exactly when the main model needs it most.
