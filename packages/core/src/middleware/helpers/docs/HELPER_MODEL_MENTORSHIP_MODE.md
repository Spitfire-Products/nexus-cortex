# Helper Model Mentorship Mode

## Overview

**Mentorship Mode** enhances the helper model system to not only summarize reasoning but actively provide guidance, alternative suggestions, and strategic hints—effectively doubling the contextual awareness of the main model through AI-to-AI mentorship.

## Concept

### Traditional Compaction (Pure Summary)
```
Helper Model: "The model attempted to find TypeScript errors by searching
for 'error' in logs, found 3 files, and decided to read package.json."
```

### Mentorship Mode (Summary + Guidance)
```
Helper Model: "The model attempted to find TypeScript errors by searching
for 'error' in logs, found 3 files, and decided to read package.json.

💡 **Mentorship Commentary**:
- The search approach was inefficient. Consider running `npx tsc --noEmit`
  directly to get compiler errors, which would be faster and more accurate.
- Before reading package.json, you should verify the TypeScript configuration
  in tsconfig.json as it controls compilation behavior.
- Documentation reference: TypeScript compiler options -
  https://www.typescriptlang.org/tsconfig

**Alternative Strategy**:
1. Run `npx tsc --noEmit` to get all errors
2. Read tsconfig.json to understand project structure
3. Then read specific files with errors
```

## User-Facing Features

### Mode Toggle

Users can configure mentorship level:

```typescript
enum MentorshipMode {
  OFF = 'off',                    // No helper model intervention
  SUMMARY_ONLY = 'summary',       // Pure reasoning summarization
  MENTORSHIP = 'mentorship',      // Summary + guidance + suggestions
  AGGRESSIVE = 'aggressive'       // Proactive intervention with detailed hints
}
```

**Configuration**:
```typescript
interface OrchestratorConfig {
  // Existing fields...

  mentorshipMode?: MentorshipMode;

  // Mentorship configuration
  mentorshipConfig?: {
    /** Enable alternative solution suggestions */
    suggestAlternatives?: boolean;

    /** Enable documentation references */
    includeDocumentation?: boolean;

    /** Enable failure analysis */
    analyzeFailed Approaches?: boolean;

    /** Enable proactive hints */
    provideProactiveHints?: boolean;

    /** Minimum confidence threshold (0-1) for suggestions */
    confidenceThreshold?: number;

    /** Max suggestions per compaction */
    maxSuggestionsPerCompaction?: number;
  };
}
```

## Architecture

### 1. Enhanced Helper Model Middleware

**Location**: `src/middleware/helpers/HelperModelMiddleware.ts`

```typescript
class MentorshipMiddleware extends HelperModelMiddleware {
  /**
   * Generate mentorship commentary on reasoning and execution
   */
  async generateMentorshipCommentary(
    context: MentorshipContext
  ): Promise<MentorshipCommentary> {
    const { messages, failedAttempts, toolUsage, mode } = context;

    // Extract reasoning blocks
    const reasoning = this.extractReasoning(messages);

    // Analyze execution patterns
    const analysis = await this.analyzeExecution({
      reasoning,
      toolUsage,
      failedAttempts
    });

    // Generate guidance based on mode
    switch (mode) {
      case MentorshipMode.SUMMARY_ONLY:
        return { summary: analysis.summary };

      case MentorshipMode.MENTORSHIP:
        return {
          summary: analysis.summary,
          suggestions: await this.generateSuggestions(analysis),
          alternatives: await this.proposeAlternatives(analysis),
          documentation: await this.findRelevantDocs(analysis)
        };

      case MentorshipMode.AGGRESSIVE:
        return {
          summary: analysis.summary,
          suggestions: await this.generateSuggestions(analysis),
          alternatives: await this.proposeAlternatives(analysis),
          documentation: await this.findRelevantDocs(analysis),
          proactiveHints: await this.generateProactiveHints(analysis),
          strategyRecommendations: await this.recommendStrategies(analysis)
        };

      default:
        return { summary: '' };
    }
  }

  /**
   * Analyze execution to identify patterns, failures, and opportunities
   */
  private async analyzeExecution(context: {
    reasoning: string[];
    toolUsage: ToolUsageRecord[];
    failedAttempts: FailedAttempt[];
  }): Promise<ExecutionAnalysis> {
    const prompt = `Analyze this AI model's execution:

**Reasoning Blocks**:
${context.reasoning.join('\n\n---\n\n')}

**Tool Usage**:
${this.formatToolUsage(context.toolUsage)}

**Failed Attempts**:
${this.formatFailedAttempts(context.failedAttempts)}

Provide:
1. **Summary**: Concise summary of approach taken
2. **Failure Analysis**: Why did failed attempts fail?
3. **Efficiency Assessment**: Was the approach efficient?
4. **Alternative Opportunities**: What other approaches could work?

Output as JSON:
{
  "summary": "...",
  "failures": [{ "attempt": "...", "reason": "...", "lesson": "..." }],
  "efficiency": { "rating": 1-10, "issues": [...] },
  "alternatives": [{ "strategy": "...", "rationale": "..." }]
}`;

    const response = await this.helperModel.chat(prompt);
    return JSON.parse(response);
  }

  /**
   * Generate specific suggestions based on analysis
   */
  private async generateSuggestions(
    analysis: ExecutionAnalysis
  ): Promise<Suggestion[]> {
    const prompt = `Based on this execution analysis:

${JSON.stringify(analysis, null, 2)}

Generate 2-4 specific, actionable suggestions for improvement.

Format:
{
  "suggestions": [
    {
      "type": "efficiency" | "alternative" | "technique" | "documentation",
      "content": "Clear, specific suggestion",
      "rationale": "Why this helps",
      "confidence": 0.0-1.0
    }
  ]
}`;

    const response = await this.helperModel.chat(prompt);
    const parsed = JSON.parse(response);

    // Filter by confidence threshold
    return parsed.suggestions.filter(
      s => s.confidence >= this.config.confidenceThreshold
    );
  }

  /**
   * Propose alternative approaches to failed strategies
   */
  private async proposeAlternatives(
    analysis: ExecutionAnalysis
  ): Promise<Alternative[]> {
    if (analysis.failures.length === 0) {
      return [];
    }

    const prompt = `The model encountered these failures:

${analysis.failures.map(f => `
**Failed Approach**: ${f.attempt}
**Why it failed**: ${f.reason}
`).join('\n')}

Suggest 1-3 alternative approaches that could succeed.

Format:
{
  "alternatives": [
    {
      "originalApproach": "...",
      "suggestedApproach": "...",
      "advantages": "Why this is better",
      "implementation": "Concrete steps to take"
    }
  ]
}`;

    const response = await this.helperModel.chat(prompt);
    return JSON.parse(response).alternatives;
  }

  /**
   * Find relevant documentation for current problem
   */
  private async findRelevantDocs(
    analysis: ExecutionAnalysis
  ): Promise<DocumentationReference[]> {
    // Extract key technologies/concepts from reasoning
    const concepts = this.extractConcepts(analysis);

    // Use RAG or web search to find docs
    const docs = await this.searchDocumentation(concepts);

    return docs.slice(0, 3); // Top 3 most relevant
  }

  /**
   * Generate proactive hints for next steps
   */
  private async generateProactiveHints(
    analysis: ExecutionAnalysis
  ): Promise<ProactiveHint[]> {
    const prompt = `Based on this execution:

${JSON.stringify(analysis, null, 2)}

What should the model consider for the NEXT turn?

Provide 2-3 proactive hints about:
- What to investigate next
- Potential pitfalls to avoid
- Tools or commands that would be helpful
- Context the model might be missing

Format:
{
  "hints": [
    {
      "category": "investigation" | "pitfall" | "tool" | "context",
      "hint": "Specific hint",
      "relevance": "Why this matters now"
    }
  ]
}`;

    const response = await this.helperModel.chat(prompt);
    return JSON.parse(response).hints;
  }

  /**
   * Recommend high-level strategies
   */
  private async recommendStrategies(
    analysis: ExecutionAnalysis
  ): Promise<StrategyRecommendation[]> {
    const prompt = `Given this execution analysis:

${JSON.stringify(analysis, null, 2)}

Recommend 1-2 high-level strategies the model should adopt.

Examples:
- "Adopt a test-driven approach: Write tests before implementation"
- "Use binary search strategy to narrow down the issue"
- "Leverage existing abstractions instead of reimplementing"

Format:
{
  "strategies": [
    {
      "strategy": "Strategy name",
      "description": "What this means",
      "application": "How to apply it here"
    }
  ]
}`;

    const response = await this.helperModel.chat(prompt);
    return JSON.parse(response).strategies;
  }
}
```

### 2. Mentorship Context Builder

```typescript
interface MentorshipContext {
  /** Messages to analyze */
  messages: CanonicalMessage[];

  /** Failed tool calls or approaches */
  failedAttempts: FailedAttempt[];

  /** Tool usage history */
  toolUsage: ToolUsageRecord[];

  /** Current mentorship mode */
  mode: MentorshipMode;

  /** User's current goal/task */
  currentTask?: string;

  /** Previous mentorship commentary (for continuity) */
  previousCommentary?: MentorshipCommentary[];
}

interface FailedAttempt {
  /** What was attempted */
  attempt: string;

  /** Tool used (if applicable) */
  tool?: string;

  /** Error message or failure reason */
  error: string;

  /** Turn number when failed */
  turnNumber: number;

  /** Reasoning before attempt */
  precedingReasoning?: string;
}

interface ToolUsageRecord {
  /** Tool name */
  tool: string;

  /** Input parameters */
  input: Record<string, unknown>;

  /** Result or error */
  result: string | object;

  /** Was this successful? */
  success: boolean;

  /** Turn number */
  turnNumber: number;
}
```

### 3. Mentorship Commentary Types

```typescript
interface MentorshipCommentary {
  /** Reasoning summary (always included) */
  summary: string;

  /** Specific suggestions for improvement */
  suggestions?: Suggestion[];

  /** Alternative approaches to failed strategies */
  alternatives?: Alternative[];

  /** Relevant documentation references */
  documentation?: DocumentationReference[];

  /** Proactive hints for next turn */
  proactiveHints?: ProactiveHint[];

  /** High-level strategy recommendations */
  strategyRecommendations?: StrategyRecommendation[];
}

interface Suggestion {
  type: 'efficiency' | 'alternative' | 'technique' | 'documentation';
  content: string;
  rationale: string;
  confidence: number; // 0.0-1.0
}

interface Alternative {
  originalApproach: string;
  suggestedApproach: string;
  advantages: string;
  implementation: string;
}

interface DocumentationReference {
  title: string;
  url: string;
  relevance: string;
  keyTakeaway: string;
}

interface ProactiveHint {
  category: 'investigation' | 'pitfall' | 'tool' | 'context';
  hint: string;
  relevance: string;
}

interface StrategyRecommendation {
  strategy: string;
  description: string;
  application: string;
}
```

### 4. Injection into Conversation

Mentorship commentary injected as system reminder:

```typescript
class CortexOrchestrator {
  private async injectMentorshipCommentary(
    commentary: MentorshipCommentary
  ): SystemMessageForInjection {
    const content = this.formatMentorshipCommentary(commentary);

    return {
      content,
      position: 'prepend',
      priority: 10, // High priority (after core system messages)
      wrapInSystemReminder: true,
      contentHash: this.generateHash(content),
      definition: {
        id: 'mentorship_commentary',
        name: 'AI Mentorship Commentary',
        // ...
      }
    };
  }

  private formatMentorshipCommentary(
    commentary: MentorshipCommentary
  ): string {
    let formatted = `# AI Mentorship Commentary\n\n`;

    // Summary
    formatted += `## Summary of Previous Approach\n${commentary.summary}\n\n`;

    // Suggestions
    if (commentary.suggestions && commentary.suggestions.length > 0) {
      formatted += `## 💡 Suggestions for Improvement\n\n`;
      commentary.suggestions.forEach((s, i) => {
        formatted += `${i + 1}. **${this.capitalizeType(s.type)}**: ${s.content}\n`;
        formatted += `   *Rationale*: ${s.rationale}\n`;
        formatted += `   *Confidence*: ${(s.confidence * 100).toFixed(0)}%\n\n`;
      });
    }

    // Alternatives (for failed approaches)
    if (commentary.alternatives && commentary.alternatives.length > 0) {
      formatted += `## 🔄 Alternative Approaches\n\n`;
      formatted += `I noticed some approaches didn't succeed. Consider these alternatives:\n\n`;
      commentary.alternatives.forEach((alt, i) => {
        formatted += `**Alternative ${i + 1}**:\n`;
        formatted += `- Original: ${alt.originalApproach}\n`;
        formatted += `- Try Instead: ${alt.suggestedApproach}\n`;
        formatted += `- Why: ${alt.advantages}\n`;
        formatted += `- How: ${alt.implementation}\n\n`;
      });
    }

    // Documentation
    if (commentary.documentation && commentary.documentation.length > 0) {
      formatted += `## 📚 Relevant Documentation\n\n`;
      commentary.documentation.forEach((doc, i) => {
        formatted += `${i + 1}. [${doc.title}](${doc.url})\n`;
        formatted += `   *Relevance*: ${doc.relevance}\n`;
        formatted += `   *Key Takeaway*: ${doc.keyTakeaway}\n\n`;
      });
    }

    // Proactive hints (aggressive mode)
    if (commentary.proactiveHints && commentary.proactiveHints.length > 0) {
      formatted += `## 🎯 Proactive Hints for Next Turn\n\n`;
      commentary.proactiveHints.forEach((hint, i) => {
        const icon = this.getHintIcon(hint.category);
        formatted += `${icon} **${hint.hint}**\n`;
        formatted += `   *Why this matters*: ${hint.relevance}\n\n`;
      });
    }

    // Strategy recommendations (aggressive mode)
    if (commentary.strategyRecommendations && commentary.strategyRecommendations.length > 0) {
      formatted += `## 🧭 Strategy Recommendations\n\n`;
      commentary.strategyRecommendations.forEach((rec, i) => {
        formatted += `**${rec.strategy}**\n`;
        formatted += `${rec.description}\n\n`;
        formatted += `*Application here*: ${rec.application}\n\n`;
      });
    }

    formatted += `---\n*This commentary is provided by an AI helper model to assist your problem-solving process.*`;

    return formatted;
  }

  private getHintIcon(category: string): string {
    switch (category) {
      case 'investigation': return '🔍';
      case 'pitfall': return '⚠️';
      case 'tool': return '🛠️';
      case 'context': return '📋';
      default: return '💡';
    }
  }
}
```

## Example End-to-End Flow

### Scenario: Debugging TypeScript Errors

**Turn 1-3**: Model attempts to find TypeScript errors by searching log files
- Uses `Bash: grep "error" *.log`
- Finds some errors but they're runtime errors, not compile errors
- Reads package.json trying to understand project structure

**Turn 4**: Compaction triggered with mentorship mode enabled

**Helper Model Analysis**:
```typescript
{
  summary: "The model searched log files for errors and read package.json, finding some runtime errors but not TypeScript compilation errors.",

  failures: [
    {
      attempt: "grep 'error' in log files",
      reason: "Log files contain runtime errors, not TypeScript compilation errors",
      lesson: "TypeScript errors are found by running the compiler, not searching logs"
    }
  ],

  efficiency: {
    rating: 3,
    issues: [
      "Inefficient search strategy",
      "Reading package.json before understanding error types",
      "Not using TypeScript compiler directly"
    ]
  },

  alternatives: [
    {
      strategy: "Run TypeScript compiler",
      rationale: "tsc --noEmit gives all compilation errors directly"
    }
  ]
}
```

**Generated Mentorship Commentary** (injected as system reminder):

```markdown
# AI Mentorship Commentary

## Summary of Previous Approach
The model searched log files for errors and read package.json, finding
some runtime errors but not TypeScript compilation errors.

## 💡 Suggestions for Improvement

1. **Efficiency**: Run `npx tsc --noEmit` directly to get TypeScript compilation errors
   *Rationale*: The TypeScript compiler provides accurate, structured error output
   instead of searching through logs which may contain unrelated errors.
   *Confidence*: 95%

2. **Technique**: Check tsconfig.json before investigating errors
   *Rationale*: Understanding the TypeScript configuration helps interpret compiler
   errors and locate relevant source files.
   *Confidence*: 85%

## 🔄 Alternative Approaches

I noticed some approaches didn't succeed. Consider these alternatives:

**Alternative 1**:
- Original: grep 'error' in log files to find TypeScript errors
- Try Instead: Run `npx tsc --noEmit` to get compilation errors directly
- Why: Compiler output is structured, accurate, and specific to TypeScript issues
- How:
  1. Run `npx tsc --noEmit` to check for errors
  2. Parse the output which shows: file path, line number, error code, and description
  3. Read the specific files with errors

## 📚 Relevant Documentation

1. [TypeScript Compiler Options](https://www.typescriptlang.org/tsconfig)
   *Relevance*: Understanding compiler flags helps diagnose configuration issues
   *Key Takeaway*: The --noEmit flag checks for errors without generating output files

2. [TypeScript Error Codes](https://typescript.tv/errors/)
   *Relevance*: Each TS error code has detailed explanations and solutions
   *Key Takeaway*: Error codes like TS2304, TS2345 have common patterns and fixes

## 🎯 Proactive Hints for Next Turn

🛠️ **Use the Bash tool to run `npx tsc --noEmit`**
   *Why this matters*: This will give you the complete list of TypeScript
   compilation errors with file locations and line numbers.

⚠️ **Watch for module resolution errors (TS2307)**
   *Why this matters*: If you see "Cannot find module" errors, you may need to
   check package.json dependencies or tsconfig.json paths configuration.

---
*This commentary is provided by an AI helper model to assist your problem-solving process.*
```

**Turn 5**: Main model receives mentorship commentary

Now the main model sees:
1. Summary of what it tried
2. Why the approach was inefficient
3. Specific alternative: Use `npx tsc --noEmit`
4. Documentation references
5. Proactive hints about what to watch for

**Expected Behavior**: Main model follows suggestion and runs TypeScript compiler

## Quality Control Mechanisms

### 1. Confidence Thresholds

Only include suggestions above confidence threshold:

```typescript
mentorshipConfig: {
  confidenceThreshold: 0.75  // Only suggestions with 75%+ confidence
}
```

### 2. Hallucination Detection

```typescript
class MentorshipMiddleware {
  /**
   * Verify suggestion validity before including
   */
  private async verifySuggestion(suggestion: Suggestion): Promise<boolean> {
    // Check 1: Does suggested tool/command exist?
    if (suggestion.type === 'tool') {
      const toolExists = this.verifyToolExists(suggestion.content);
      if (!toolExists) return false;
    }

    // Check 2: Is documentation reference valid?
    if (suggestion.type === 'documentation') {
      const urlValid = await this.verifyURL(suggestion.content);
      if (!urlValid) return false;
    }

    // Check 3: Is suggestion relevant to current context?
    const relevance = await this.assessRelevance(suggestion, this.context);
    if (relevance < 0.7) return false;

    return true;
  }

  /**
   * Verify tool existence
   */
  private verifyToolExists(content: string): boolean {
    // Extract tool name from suggestion
    const toolMatch = content.match(/`(\w+)`/);
    if (!toolMatch) return true; // No specific tool mentioned

    const toolName = toolMatch[1];

    // Check against available tools
    const availableTools = toolFactory.getAllTools();
    return availableTools.some(t => t.name === toolName);
  }

  /**
   * Verify URL validity (for documentation references)
   */
  private async verifyURL(url: string): Promise<boolean> {
    try {
      const response = await fetch(url, { method: 'HEAD', timeout: 5000 });
      return response.ok;
    } catch {
      return false;
    }
  }
}
```

### 3. Relevance Scoring

```typescript
/**
 * Assess suggestion relevance to current context
 */
private async assessRelevance(
  suggestion: Suggestion,
  context: MentorshipContext
): Promise<number> {
  const prompt = `Rate the relevance of this suggestion to the current context:

**Suggestion**: ${suggestion.content}
**Context**: ${context.currentTask}
**Recent Actions**: ${this.summarizeRecentActions(context)}

Rate relevance 0.0-1.0 (0 = not relevant, 1 = highly relevant)

Output JSON: { "relevance": 0.X, "reasoning": "why" }`;

  const response = await this.helperModel.chat(prompt);
  const parsed = JSON.parse(response);
  return parsed.relevance;
}
```

### 4. Suggestion Limits

Prevent information overload:

```typescript
mentorshipConfig: {
  maxSuggestionsPerCompaction: 4,  // Max 4 suggestions
  maxAlternatives: 2,               // Max 2 alternatives
  maxDocReferences: 3,              // Max 3 docs
  maxHints: 3                       // Max 3 proactive hints
}
```

## Performance Considerations

### 1. Cost Management

Mentorship mode increases helper model API calls:

| Mode | Helper Model Calls | Token Usage Multiplier |
|------|-------------------|----------------------|
| OFF | 0 | 1.0x |
| SUMMARY_ONLY | 1 per compaction | 1.2x |
| MENTORSHIP | 3-4 per compaction | 1.5x |
| AGGRESSIVE | 5-6 per compaction | 2.0x |

**Mitigation**:
- Use efficient helper model (e.g., grok-beta, claude-haiku)
- Cache analysis results
- Batch analysis across multiple turns

### 2. Latency

Mentorship analysis adds latency during compaction:

```typescript
class MentorshipMiddleware {
  /**
   * Run analysis steps in parallel where possible
   */
  async generateMentorshipCommentary(
    context: MentorshipContext
  ): Promise<MentorshipCommentary> {
    // Run analysis
    const analysis = await this.analyzeExecution(context);

    // Run suggestions, alternatives, docs in parallel
    const [suggestions, alternatives, documentation] = await Promise.all([
      this.generateSuggestions(analysis),
      this.proposeAlternatives(analysis),
      this.findRelevantDocs(analysis)
    ]);

    return {
      summary: analysis.summary,
      suggestions,
      alternatives,
      documentation
    };
  }
}
```

## User Configuration

### UI/Settings

```typescript
// User settings
interface UserSettings {
  mentorship: {
    mode: 'off' | 'summary' | 'mentorship' | 'aggressive';

    // Fine-grained control
    features: {
      suggestions: boolean;
      alternatives: boolean;
      documentation: boolean;
      proactiveHints: boolean;
      strategies: boolean;
    };

    // Quality control
    confidenceThreshold: number; // 0.0-1.0

    // Frequency
    triggerEvery: number; // Trigger every N turns (e.g., 10)
  };
}
```

### CLI Interface

```bash
# Enable mentorship mode
nexus-cortex --mentorship=on

# Set mode level
nexus-cortex --mentorship=aggressive

# Disable specific features
nexus-cortex --mentorship=on --no-proactive-hints
```

### API Configuration

```typescript
const orchestrator = new CortexOrchestrator({
  // ...
  mentorshipMode: MentorshipMode.MENTORSHIP,
  mentorshipConfig: {
    suggestAlternatives: true,
    includeDocumentation: true,
    analyzeFailedApproaches: true,
    provideProactiveHints: false,  // Disable for less aggressive mode
    confidenceThreshold: 0.75,
    maxSuggestionsPerCompaction: 3
  }
});
```

## Integration with System Messages

Mentorship commentary is injected as a system message:

```typescript
// In CortexOrchestrator.sendMessage()

// After compaction
if (compactionOccurred && this.config.mentorshipMode !== MentorshipMode.OFF) {
  // Generate mentorship commentary
  const commentary = await this.mentorshipMiddleware.generateMentorshipCommentary({
    messages: compactedMessages,
    failedAttempts: this.extractFailedAttempts(),
    toolUsage: this.extractToolUsage(),
    mode: this.config.mentorshipMode,
    currentTask: this.inferCurrentTask()
  });

  // Convert to system message for injection
  const mentorshipMessage = await this.injectMentorshipCommentary(commentary);

  // Inject alongside other system messages
  systemMessages.push(mentorshipMessage);
}
```

## Testing Strategy

### 1. Unit Tests

```typescript
describe('MentorshipMiddleware', () => {
  it('should generate suggestions above confidence threshold', async () => {
    const middleware = new MentorshipMiddleware({
      confidenceThreshold: 0.8
    });

    const suggestions = await middleware.generateSuggestions(mockAnalysis);

    expect(suggestions.every(s => s.confidence >= 0.8)).toBe(true);
  });

  it('should propose alternatives for failed attempts', async () => {
    const context = {
      failedAttempts: [{ attempt: 'grep error logs', error: 'Not found' }]
    };

    const alternatives = await middleware.proposeAlternatives(context);

    expect(alternatives.length).toBeGreaterThan(0);
    expect(alternatives[0].originalApproach).toContain('grep');
  });

  it('should verify tool existence before suggesting', async () => {
    const suggestion = {
      type: 'tool',
      content: 'Use the `NonExistentTool` to...'
    };

    const valid = await middleware.verifySuggestion(suggestion);

    expect(valid).toBe(false);
  });
});
```

### 2. Integration Tests

```typescript
describe('Mentorship Mode Integration', () => {
  it('should inject mentorship commentary after compaction', async () => {
    const orchestrator = new CortexOrchestrator({
      mentorshipMode: MentorshipMode.MENTORSHIP
    });

    // Simulate conversation with failures
    await orchestrator.sendMessage('Find TypeScript errors');
    // ... model attempts grep approach (fails)

    // Trigger compaction
    const response = await orchestrator.sendMessage('Continue');

    // Verify mentorship commentary was injected
    const lastMessage = orchestrator.getLastInjectedMessages();
    expect(lastMessage.some(m => m.definition.id === 'mentorship_commentary')).toBe(true);
  });
});
```

### 3. Quality Tests

```typescript
describe('Mentorship Quality Control', () => {
  it('should not include suggestions with low confidence', async () => {
    const commentary = await generateCommentary(context);

    expect(commentary.suggestions.every(s => s.confidence >= 0.75)).toBe(true);
  });

  it('should verify documentation URLs', async () => {
    const commentary = await generateCommentary(context);

    for (const doc of commentary.documentation) {
      const response = await fetch(doc.url, { method: 'HEAD' });
      expect(response.ok).toBe(true);
    }
  });

  it('should limit number of suggestions', async () => {
    const commentary = await generateCommentary(context, {
      maxSuggestionsPerCompaction: 3
    });

    expect(commentary.suggestions.length).toBeLessThanOrEqual(3);
  });
});
```

## Future Enhancements

### 1. Learning from User Acceptance

Track which suggestions users follow:

```typescript
interface SuggestionTracking {
  suggestionId: string;
  accepted: boolean;  // Did user follow suggestion?
  outcome: 'success' | 'failure' | 'unknown';
  userFeedback?: string;
}

class MentorshipMiddleware {
  /**
   * Learn from user acceptance to improve suggestions
   */
  async learnFromFeedback(tracking: SuggestionTracking[]): Promise<void> {
    // Analyze which suggestion types are most accepted
    // Adjust confidence scoring
    // Fine-tune helper model prompts
  }
}
```

### 2. RAG Integration for Documentation

```typescript
class DocumentationRAG {
  /**
   * Search documentation using vector embeddings
   */
  async searchRelevantDocs(
    query: string,
    technologies: string[]
  ): Promise<DocumentationReference[]> {
    // Use vector database (Pinecone, Chroma, etc.)
    // Search by semantic similarity
    // Return top K most relevant docs
  }
}
```

### 3. Model-Specific Mentorship

Different models may benefit from different mentorship styles:

```typescript
interface MentorshipProfile {
  modelPattern: RegExp;
  preferredCommentaryStyle: 'concise' | 'detailed' | 'strategic';
  focusAreas: ('efficiency' | 'alternatives' | 'documentation')[];
}

const mentorshipProfiles: MentorshipProfile[] = [
  {
    modelPattern: /^grok-/,
    preferredCommentaryStyle: 'concise',
    focusAreas: ['efficiency', 'alternatives']
  },
  {
    modelPattern: /^claude-/,
    preferredCommentaryStyle: 'detailed',
    focusAreas: ['documentation', 'strategies']
  }
];
```

## Summary

**Mentorship Mode** transforms the helper model from a passive summarizer into an active AI mentor that:

✅ **Analyzes reasoning** and execution patterns
✅ **Identifies failed approaches** and explains why they failed
✅ **Suggests alternatives** that are more likely to succeed
✅ **Provides documentation** references relevant to the problem
✅ **Offers proactive hints** for the next turn
✅ **Recommends strategies** for improved problem-solving

**Key Benefits**:
- "Doubles contextual awareness" through AI-to-AI mentorship
- Helps models learn from failures
- Proactively guides toward better solutions
- Reduces trial-and-error cycles
- Improves overall efficiency

**User Control**:
- Toggle between off/summary/mentorship/aggressive modes
- Fine-grained feature control
- Confidence threshold adjustment
- Cost/performance tradeoffs

**Quality Assurance**:
- Confidence thresholds filter low-quality suggestions
- Tool/URL verification prevents hallucinations
- Relevance scoring ensures context-appropriate guidance
- Suggestion limits prevent information overload

This feature represents a significant evolution in AI orchestration—moving from single-model execution to collaborative multi-model problem-solving with mentorship dynamics.
