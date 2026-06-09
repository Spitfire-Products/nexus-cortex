# System Messages Implementation - Handoff Document

**Date**: 2025-11-07
**Status**: Infrastructure Complete, Integration Pending
**Location**: `packages/core/src/system-messages/`

## Executive Summary

We've successfully implemented a **hook-based system message injection system** based on Claude CLI research. The infrastructure is complete and ready for integration into the Orchestrator.

### What Was Built

✅ **15 files created** (~2,200 lines)
✅ **Message registry configuration** (JSON-based)
✅ **7 markdown message files** (user-editable)
✅ **TypeScript loader and interfaces** (type-safe)
✅ **Hook-based injection design** (Claude CLI pattern)
✅ **Comprehensive documentation** (architecture, usage, examples)

### Current Status

- **Infrastructure**: ✅ Complete
- **Documentation**: ✅ Complete
- **Orchestrator Integration**: ⏳ Pending
- **Testing**: ⏳ Pending

## Architecture Overview

### Hook-Based Injection Pattern

Based on research from `.claude/claude_research_analysis/02-claude-cli-analysis/CLAUDE_CLI_INJECTION_PATTERNS.md`, we discovered that Claude Code injects system messages **into user message content arrays**, NOT as separate system role messages.

#### Pattern

```json
{
  "role": "user",
  "content": [
    {
      "type": "text",
      "text": "<system-reminder>\n# Tool Usage Guide\nYou have 3 tools...\n</system-reminder>"
    },
    {
      "type": "text",
      "text": "<system-reminder>\n# Environment Info\nWorkspace: /workspace\n</system-reminder>"
    },
    {
      "type": "text",
      "text": "User's actual input"
    }
  ]
}
```

#### Content Array Ordering

1. **System-reminders (1-3+ items)** ← Our injections
2. Caveat text (if commands)
3. Command metadata (if commands)
4. Command output (if commands)
5. **Actual user input (last item)**

### Three Hook Points

**Hook 1: Before API Request**
- **Location**: `Orchestrator.sendMessage()` before gateway call
- **Purpose**: Inject system messages based on context
- **Conditions**: Turn number, tools present, model capabilities

**Hook 2: After Tool Result**
- **Location**: After tool execution
- **Purpose**: Inject tool-specific reminders
- **Example**: File security warning after Read tool

**Hook 3: Periodic Injection**
- **Location**: Every N turns (default: 10)
- **Purpose**: Remind about tool usage best practices

## Files Created

### Core Infrastructure (5 files)

1. **`system-message-registry.json`** (91 lines)
   - Declarative configuration
   - 7 message definitions
   - Injection conditions and priorities

2. **`SystemMessageRegistry.interface.ts`** (208 lines)
   - TypeScript type definitions
   - `InjectionContext`, `SystemMessageForInjection`, etc.
   - Full type safety

3. **`SystemMessageLoader.ts`** (343 lines)
   - Loads registry and .md files
   - Template variable replacement
   - Content caching
   - Deduplication via content hash
   - **New**: `getMessagesForInjection()` method

4. **`index.ts`** (11 lines)
   - Public exports

5. **`SystemReminderInjector.ts`** (272 lines)
   - Pre-existing runtime reminder injection
   - Complements our static message system

### Message Files (7 markdown files)

1. **`messages/SYSTEM_PROMPT.md`** (75 lines)
   - Core AI instructions
   - Capabilities overview
   - Tool result visibility rules
   - **Injected**: Turn 0 (session start)

2. **`messages/TOOL_USAGE_GUIDE.md`** (120 lines)
   - Detailed tool calling protocol
   - Parameter validation
   - Error handling
   - **Injected**: When tools provided

3. **`messages/EXAMPLES.md`** (180 lines)
   - 8 concrete tool usage examples
   - Correct patterns
   - Error handling examples
   - **Injected**: Turn 0 with tools

4. **`messages/REASONING_GUIDE.md`** (150 lines)
   - Instructions for reasoning models
   - `<thinking>` block usage
   - Interleaved reasoning
   - **Injected**: Models with reasoning capability

5. **`messages/ENVIRONMENT_INFO.md`** (30 lines)
   - Dynamic workspace information
   - Template variables
   - **Injected**: Turn 0 (with template values)

6. **`messages/POLICY_CHECK.md`** (60 lines)
   - Safety policies
   - Behavioral constraints
   - **Injected**: Session start

7. **`messages/PERIODIC_REMINDER.md`** (25 lines)
   - Tool usage reminders
   - Multi-turn best practices
   - **Injected**: Every 10 turns

### Documentation (4 files)

1. **`ARCHITECTURE.md`** (290 lines)
   - Design document
   - Original ephemeral injection plan

2. **`README.md`** (460 lines)
   - Comprehensive usage guide
   - Examples
   - Benefits

3. **`HOOK_BASED_INJECTION_DESIGN.md`** (New, 280 lines)
   - Hook-based injection architecture
   - Claude CLI pattern analysis
   - Integration code examples
   - Complete flow diagrams

4. **`SYSTEM_MESSAGES_IMPLEMENTATION_COMPLETE.md`** (370 lines)
   - Implementation summary
   - Files created
   - Next steps

5. **`SYSTEM_MESSAGES_HANDOFF.md`** (This file)
   - Handoff documentation
   - Integration guide

## Key Interfaces

### InjectionContext

```typescript
interface InjectionContext {
  turnNumber: number;
  sessionPhase: SessionPhase;
  hasTools: boolean;
  toolCount?: number;
  modelCapabilities: ModelCapability[];
  apiPattern: string;
  sessionId: string;
  lastInjectedIds?: string[];
}
```

### SystemMessageForInjection

```typescript
interface SystemMessageForInjection {
  content: string;
  position: InjectionPosition;
  priority: number;
  wrapInSystemReminder: boolean;
  contentHash: string;
  definition: SystemMessageDefinition;
}
```

### TemplateVariables

```typescript
interface TemplateVariables {
  projectPath?: string;
  workspacePath?: string;
  currentDate?: string;
  currentTime?: string;
  toolCount?: number;
  toolNames?: string[];
  sandboxEnabled?: boolean;
  [key: string]: any;
}
```

## Integration Guide

### Step 1: Initialize SystemMessageLoader

```typescript
// In OrchestratorFactory.ts
import { SystemMessageLoader } from '../system-messages/SystemMessageLoader.js';

export function createOrchestrator(config: OrchestratorConfig): OmniClaudeOrchestrator {
  // ... existing initialization ...

  const systemMessageLoader = new SystemMessageLoader({
    debug: config.debug
  });

  return new OmniClaudeOrchestrator(
    // ... existing params ...
    systemMessageLoader,  // Add as new parameter
    config
  );
}
```

### Step 2: Add Injection Helpers to Orchestrator

```typescript
class OmniClaudeOrchestrator {
  private systemMessageLoader: SystemMessageLoader;
  private lastInjectedHashes = new Set<string>();

  /**
   * Build template variables for dynamic messages
   */
  private buildTemplateVariables(options?: SendMessageOptions): TemplateVariables {
    return {
      projectPath: this.config.projectPath,
      workspacePath: this.config.workingDirectory || this.config.projectPath,
      currentDate: new Date().toISOString().split('T')[0],
      currentTime: new Date().toLocaleTimeString(),
      toolCount: options?.tools?.length || 0,
      toolNames: options?.tools?.map(t => `- ${t.name}`).join('\n') || '',
      sandboxEnabled: String(!!this.config.enableSandbox),
      sessionId: this.currentSessionId || ''
    };
  }

  /**
   * Inject system messages into user message content array
   */
  private injectSystemMessages(
    userMessage: CanonicalMessage,
    systemMessages: SystemMessageForInjection[]
  ): CanonicalMessage {
    // Ensure content is array
    const content = Array.isArray(userMessage.content)
      ? [...userMessage.content]
      : [{ type: 'text', text: userMessage.content }];

    // Group by position
    const prependMessages = systemMessages.filter(m => m.position === 'prepend');

    // Sort by priority (lower = earlier)
    prependMessages.sort((a, b) => a.priority - b.priority);

    // Format as content items with <system-reminder> tags
    const prependItems = prependMessages.map(msg => ({
      type: 'text' as const,
      text: msg.wrapInSystemReminder
        ? `<system-reminder>\n${msg.content}\n</system-reminder>`
        : msg.content
    }));

    // Return message with injected content
    return {
      ...userMessage,
      content: [
        ...prependItems,  // System messages first
        ...content        // Original user content
      ]
    };
  }

  /**
   * Get system messages for injection with deduplication
   */
  private async getSystemMessagesForInjection(
    context: InjectionContext
  ): Promise<SystemMessageForInjection[]> {
    const messages = await this.systemMessageLoader.getMessagesForInjection(
      context,
      this.buildTemplateVariables()
    );

    // Deduplicate by content hash
    return messages.filter(msg => {
      if (this.lastInjectedHashes.has(msg.contentHash)) {
        return false; // Already injected
      }
      this.lastInjectedHashes.add(msg.contentHash);
      return true;
    });
  }
}
```

### Step 3: Wire Hook into sendMessage()

```typescript
async sendMessage(prompt: string, options?: SendMessageOptions): Promise<OrchestratorResponse> {
  // ... existing code ...

  // 1. Create canonical user message
  const userMessage: CanonicalMessage = {
    uuid: this.generateMessageId(),
    timestamp: new Date().toISOString(),
    role: 'user',
    type: 'text',
    content: [{ type: 'text', text: prompt }],
    timeline: {
      sessionId: this.currentSessionId!,
      conversationId: this.currentConversationId!,
      turnNumber: this.currentTurnNumber
    },
    model: this.getModelInfo()
  };

  // 2. HOOK: Get system messages to inject
  const systemMessages = await this.getSystemMessagesForInjection({
    turnNumber: this.currentTurnNumber,
    sessionPhase: this.currentTurnNumber === 0 ? 'start' : 'ongoing',
    hasTools: !!options?.tools,
    toolCount: options?.tools?.length || 0,
    modelCapabilities: this.getModelCapabilities(),
    apiPattern: this.currentModel!.apiPattern,
    sessionId: this.currentSessionId!
  });

  // 3. Inject system messages into user message
  const injectedUserMessage = this.injectSystemMessages(userMessage, systemMessages);

  // 4. Add to canonical history
  this.canonicalHistory.push(injectedUserMessage);

  // 5. Send to gateway (system messages are now IN the user message)
  const response = await this.gateway.sendRequest({
    messages: this.canonicalHistory,
    tools: options?.tools,
    // ...
  });

  // ... rest of existing code ...
}
```

### Step 4: Add Model Capabilities Helper

```typescript
private getModelCapabilities(): ModelCapability[] {
  const capabilities: ModelCapability[] = ['tools']; // All models get tools

  // Check for reasoning capability
  const reasoningModels = [
    'deepseek-reasoner',
    'deepseek-r1-0528',
    'deepseek-v3.1-thinking',
    'claude-opus-4-1'  // If extended thinking
  ];

  if (reasoningModels.includes(this.currentModel!.id)) {
    capabilities.push('reasoning');
  }

  return capabilities;
}
```

## Testing Plan

### Phase 1: Standalone Loader Test

```typescript
// Test file: src/system-messages/__tests__/SystemMessageLoader.test.ts
describe('SystemMessageLoader', () => {
  it('should load and inject messages for turn 0 with tools', async () => {
    const loader = new SystemMessageLoader();
    await loader.loadRegistry();

    const messages = await loader.getMessagesForInjection({
      turnNumber: 0,
      sessionPhase: 'start',
      hasTools: true,
      toolCount: 3,
      modelCapabilities: ['tools'],
      apiPattern: 'messages',
      sessionId: 'test-session'
    }, {
      projectPath: '/test',
      toolCount: 3,
      toolNames: '- Read\n- Write\n- Grep',
      currentDate: '2025-11-07',
      sandboxEnabled: 'true'
    });

    // Should inject 5 messages for turn 0 with tools
    expect(messages.length).toBe(5);
    expect(messages[0].definition.id).toBe('system_prompt');
    expect(messages[1].definition.id).toBe('tool_usage_guide');
    expect(messages[2].definition.id).toBe('tool_examples');
  });
});
```

### Phase 2: Integration Test with Orchestrator

```typescript
// Update tool-format-validation.test.ts to verify injection
it('should inject system messages before API call', async () => {
  const session = await orchestrator.createSession('/test', 'grok-code-fast-1');

  const tools: CanonicalTool[] = [
    {
      name: 'test_tool',
      description: 'A test tool',
      schema: {
        type: 'object',
        properties: { value: { type: 'string' } },
        required: ['value']
      }
    }
  ];

  const response = await orchestrator.sendMessage(
    'List all tools you have access to',
    { tools }
  );

  // Get message history
  const history = orchestrator.getMessageHistory();

  // Find user message
  const userMsg = history.find(m => m.role === 'user');

  // Should have content array with system reminders
  expect(Array.isArray(userMsg.content)).toBe(true);
  expect(userMsg.content.length).toBeGreaterThan(1);

  // First items should be system reminders
  const firstContent = userMsg.content[0];
  expect(firstContent.type).toBe('text');
  expect(firstContent.text).toContain('<system-reminder>');
  expect(firstContent.text).toContain('Tool Usage Guide');
});
```

### Phase 3: Validate Model Response

```typescript
it('should see improved tool awareness with system messages', async () => {
  // ... setup ...

  const response = await orchestrator.sendMessage(
    'What tools do you have?',
    { tools }
  );

  // Model should now acknowledge tools correctly
  const responseText = response.content.toLowerCase();
  expect(responseText).toContain('tool');

  // Or model might list them
  expect(
    responseText.includes('test_tool') ||
    responseText.includes('tools')
  ).toBe(true);
});
```

## Example Injection Result

### Turn 0, With 3 Tools

**User Message After Injection**:
```json
{
  "role": "user",
  "content": [
    {
      "type": "text",
      "text": "<system-reminder>\n# System Instructions\nYou are an AI assistant with access to tools...\n</system-reminder>"
    },
    {
      "type": "text",
      "text": "<system-reminder>\n# Tool Usage Guide\nYou have been provided with 3 tools:\n- Read\n- Write\n- Grep\n...\n</system-reminder>"
    },
    {
      "type": "text",
      "text": "<system-reminder>\n# Tool Usage Examples\nExample 1: Reading a File...\n</system-reminder>"
    },
    {
      "type": "text",
      "text": "<system-reminder>\n# Environment Information\nWorkspace: /workspace\nDate: 2025-11-07\n...\n</system-reminder>"
    },
    {
      "type": "text",
      "text": "<system-reminder>\n# Behavioral Policies\nSafety and Security...\n</system-reminder>"
    },
    {
      "type": "text",
      "text": "List all the tools you have"
    }
  ]
}
```

**Token Impact**: ~2,000-3,000 tokens for initial system messages

## Benefits

✅ **Clear Model Instructions**: Explicit guidance on tool usage
✅ **Claude CLI Compatible**: Matches proven injection pattern
✅ **Stored in History**: Messages preserved for context
✅ **User-Editable**: Change behavior by editing markdown files
✅ **Deterministic**: Rule-based injection, not heuristic
✅ **Template Support**: Dynamic content per request
✅ **Deduplication**: Content hash prevents redundancy
✅ **Type-Safe**: Full TypeScript interfaces
✅ **Well-Documented**: Architecture, usage, examples

## Next Steps

### Immediate (Required for Testing)

1. **Wire SystemMessageLoader into Orchestrator**
   - Add to constructor
   - Initialize in factory
   - Add private fields

2. **Add Injection Helpers**
   - `buildTemplateVariables()`
   - `injectSystemMessages()`
   - `getSystemMessagesForInjection()`
   - `getModelCapabilities()`

3. **Wire Hook into sendMessage()**
   - Get system messages
   - Inject into user message
   - Add to canonical history

4. **Test with grok-code-fast-1**
   - Run tool-format-validation.test.ts
   - Verify injection in message content
   - Check model response quality

### Future Enhancements

1. **Hook 2: After Tool Result**
   - Inject tool-specific reminders
   - File security warnings
   - Error guidance

2. **Hook 3: Periodic Injection**
   - Every 10 turns reminder
   - Tool usage best practices

3. **Custom Messages**
   - User-defined system messages
   - Project-specific instructions
   - Team guidelines

4. **Analytics**
   - Track injection effectiveness
   - Measure tool usage quality
   - A/B test different messages

## File Locations

```
packages/core/src/system-messages/
├── system-message-registry.json          # Configuration
├── SystemMessageRegistry.interface.ts    # Types
├── SystemMessageLoader.ts                # Loader (NEW: getMessagesForInjection)
├── SystemReminderInjector.ts            # Runtime reminders
├── index.ts                              # Exports
│
├── messages/                             # Message files
│   ├── SYSTEM_PROMPT.md
│   ├── TOOL_USAGE_GUIDE.md
│   ├── EXAMPLES.md
│   ├── REASONING_GUIDE.md
│   ├── ENVIRONMENT_INFO.md
│   ├── POLICY_CHECK.md
│   └── PERIODIC_REMINDER.md
│
├── templates/                            # (Empty, for future)
│
├── ARCHITECTURE.md                       # Original design
├── README.md                             # Usage guide
├── HOOK_BASED_INJECTION_DESIGN.md       # Claude CLI pattern
├── SYSTEM_MESSAGES_IMPLEMENTATION_COMPLETE.md  # Summary
└── SYSTEM_MESSAGES_HANDOFF.md           # This file
```

## Summary

The system message infrastructure is **complete and ready for integration**. The architecture is based on proven Claude CLI patterns and provides a robust, user-editable way to instruct AI models on tool usage.

**Key Achievement**: We've created a deterministic, hook-based injection system that injects markdown-based instructions into user message content arrays, matching the pattern used by native Claude Code CLI.

**Next Task**: Wire the `SystemMessageLoader` into `OmniClaudeOrchestrator.sendMessage()` following the integration guide above.

The system is ready. Let's integrate and test.
