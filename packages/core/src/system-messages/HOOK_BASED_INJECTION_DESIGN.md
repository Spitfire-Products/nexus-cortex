# Hook-Based System Message Injection Design

Based on Claude CLI research: `.claude/claude_research_analysis/02-claude-cli-analysis/CLAUDE_CLI_INJECTION_PATTERNS.md`

## Key Insight from Research

Claude Code injects system messages **into user message content arrays**, NOT as separate system role messages. This is done via hooks at specific trigger points.

### Pattern from Claude CLI

```json
{
  "role": "user",
  "content": [
    {
      "type": "text",
      "text": "<system-reminder>Tool usage guide here...</system-reminder>"
    },
    {
      "type": "text",
      "text": "<system-reminder>Environment info here...</system-reminder>"
    },
    {
      "type": "text",
      "text": "Actual user input here"
    }
  ]
}
```

### Content Array Structure

**Ordering (from research)**:
1. System-reminders (1-3 items) ← Our system messages go here
2. Caveat text (if commands present)
3. Command metadata (if commands executed)
4. Command output (if commands executed)
5. Actual user input (last item)

## Hook Points in Orchestrator

### Hook 1: Before API Request

**Trigger**: `Orchestrator.sendMessage()` before gateway call
**Purpose**: Inject system messages into user message content array

```typescript
async sendMessage(prompt: string, options?: SendMessageOptions) {
  // 1. Create canonical user message
  const userMessage: CanonicalMessage = this.createUserMessage(prompt);

  // 2. HOOK: Get system messages to inject
  const systemMessages = await this.getSystemMessagesForInjection({
    turnNumber: this.currentTurnNumber,
    hasTools: !!options?.tools,
    // ...
  });

  // 3. Inject into user message content array (PREPEND)
  const injectedUserMessage = this.injectSystemMessages(
    userMessage,
    systemMessages,
    'prepend'
  );

  // 4. Add to canonical history (stores injected version)
  this.canonicalHistory.push(injectedUserMessage);

  // 5. Send to gateway
  const response = await this.gateway.sendRequest({
    messages: this.canonicalHistory,
    tools: options?.tools
  });
}
```

### Hook 2: After Tool Result

**Trigger**: After receiving tool result from executor
**Purpose**: Inject tool-specific reminders

```typescript
async handleToolResult(toolUseId: string, result: any) {
  // 1. Create tool_result message
  const toolResultMessage = this.createToolResultMessage(toolUseId, result);

  // 2. HOOK: Get tool-specific system messages
  const toolMessages = await this.getToolResultSystemMessages({
    toolName: result.toolName,
    isError: result.is_error
  });

  // 3. Inject into tool result content
  if (toolMessages.length > 0) {
    toolResultMessage.content = [
      ...toolMessages.map(msg => ({
        type: 'text',
        text: `<system-reminder>${msg.content}</system-reminder>`
      })),
      ...toolResultMessage.content
    ];
  }

  // 4. Add to history
  this.canonicalHistory.push(toolResultMessage);
}
```

### Hook 3: Periodic Injection

**Trigger**: Every N turns (configurable, default 10)
**Purpose**: Inject periodic reminders

```typescript
async sendMessage(prompt: string, options?: SendMessageOptions) {
  // Check if periodic injection needed
  if (this.currentTurnNumber % 10 === 0 && this.currentTurnNumber > 0) {
    const periodicMessages = await this.systemMessageLoader.getMessagesForContext({
      turnNumberModulo: { divisor: 10, remainder: 0 },
      hasTools: !!options?.tools,
      // ...
    });

    // Inject into current user message
  }
}
```

## SystemMessageLoader Updates

### Current Interface

```typescript
interface LoadedSystemMessage {
  definition: SystemMessageDefinition;
  content: string;
  contentHash: string;
  cached: boolean;
}
```

### New Interface (for injection)

```typescript
interface SystemMessageForInjection {
  /** Content to inject */
  content: string;

  /** Where to inject (prepend, append, interleave) */
  position: InjectionPosition;

  /** Priority (for ordering within position) */
  priority: number;

  /** Wrap in <system-reminder> tags? */
  wrapInSystemReminder: boolean;

  /** Content hash (for deduplication) */
  contentHash: string;
}
```

### Injection Method

```typescript
class SystemMessageLoader {
  /**
   * Get messages formatted for injection into content array
   */
  async getMessagesForInjection(
    context: InjectionContext,
    templateVars: TemplateVariables = {}
  ): Promise<SystemMessageForInjection[]> {
    // 1. Get loaded messages (existing method)
    const loaded = await this.getMessagesForContext(context, templateVars);

    // 2. Format for injection
    return loaded.map(msg => ({
      content: msg.content,
      position: msg.definition.injection.position,
      priority: msg.definition.injection.priority,
      wrapInSystemReminder: true, // Always wrap for compatibility
      contentHash: msg.contentHash
    }));
  }
}
```

## Orchestrator Injection Logic

### Inject System Messages

```typescript
class CortexOrchestrator {
  /**
   * Inject system messages into user message content array
   */
  private injectSystemMessages(
    userMessage: CanonicalMessage,
    systemMessages: SystemMessageForInjection[],
    defaultPosition: InjectionPosition = 'prepend'
  ): CanonicalMessage {
    // Ensure content is array
    const content = Array.isArray(userMessage.content)
      ? [...userMessage.content]
      : [{ type: 'text', text: userMessage.content }];

    // Group by position
    const prependMessages = systemMessages.filter(m => m.position === 'prepend');
    const appendMessages = systemMessages.filter(m => m.position === 'append');

    // Sort by priority (lower = earlier)
    prependMessages.sort((a, b) => a.priority - b.priority);
    appendMessages.sort((a, b) => a.priority - b.priority);

    // Format as content items
    const prependItems = prependMessages.map(msg => ({
      type: 'text' as const,
      text: msg.wrapInSystemReminder
        ? `<system-reminder>\n${msg.content}\n</system-reminder>`
        : msg.content
    }));

    const appendItems = appendMessages.map(msg => ({
      type: 'text' as const,
      text: msg.wrapInSystemReminder
        ? `<system-reminder>\n${msg.content}\n</system-reminder>`
        : msg.content
    }));

    // Inject
    return {
      ...userMessage,
      content: [
        ...prependItems,  // System messages first
        ...content,       // Original user content
        ...appendItems    // System messages last (if any)
      ]
    };
  }
}
```

## Registry Configuration Update

The registry needs to specify wrapping behavior:

```json
{
  "id": "tool_usage_guide",
  "file": "messages/TOOL_USAGE_GUIDE.md",
  "conditions": {
    "hasTools": true
  },
  "injection": {
    "position": "prepend",
    "priority": 2,
    "wrapInSystemReminder": true  // ← New field
  }
}
```

## Deduplication Strategy

Based on Claude CLI research, use **content hash** for deduplication:

```typescript
class CortexOrchestrator {
  private lastInjectedHashes = new Set<string>();

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

  // Clear hash set periodically or when context changes significantly
  private clearInjectionHashes(): void {
    this.lastInjectedHashes.clear();
  }
}
```

## Example: Complete Flow

### Turn 0 (Session Start, With Tools)

**Context**:
```typescript
{
  turnNumber: 0,
  sessionPhase: 'start',
  hasTools: true,
  toolCount: 3,
  modelCapabilities: ['tools'],
  apiPattern: 'messages'
}
```

**Messages Injected** (in order):
1. SYSTEM_PROMPT.md (priority 1)
2. TOOL_USAGE_GUIDE.md (priority 2)
3. EXAMPLES.md (priority 3)
4. ENVIRONMENT_INFO.md (priority 5)
5. POLICY_CHECK.md (priority 6)

**Result Message Content Array**:
```json
{
  "role": "user",
  "content": [
    {
      "type": "text",
      "text": "<system-reminder>\n# System Instructions\nYou are an AI assistant...\n</system-reminder>"
    },
    {
      "type": "text",
      "text": "<system-reminder>\n# Tool Usage Guide\nYou have been provided with 3 tools...\n</system-reminder>"
    },
    {
      "type": "text",
      "text": "<system-reminder>\n# Tool Usage Examples\nExample 1: Reading a File...\n</system-reminder>"
    },
    {
      "type": "text",
      "text": "<system-reminder>\n# Environment Information\nWorkspace: /workspace...\n</system-reminder>"
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

### Turn 10 (Periodic Reminder)

**Additional Injection**:
- PERIODIC_REMINDER.md (priority 10)

**Result**: Prepended before user input

## Integration Checklist

- [ ] Update SystemMessageLoader with `getMessagesForInjection()` method
- [ ] Add `injectSystemMessages()` to Orchestrator
- [ ] Add `getSystemMessagesForInjection()` to Orchestrator
- [ ] Wire hooks into `sendMessage()`
- [ ] Wire hooks into `handleToolResult()`
- [ ] Implement deduplication with content hash
- [ ] Add template variable building
- [ ] Test with grok-code-fast-1
- [ ] Verify messages appear in canonical storage

## Benefits of This Approach

✅ **Compatible with Claude CLI pattern**: Matches native behavior
✅ **Stored in canonical history**: Messages are part of user content
✅ **Deduplication**: Content hash prevents redundant injections
✅ **Flexible positioning**: Prepend, append, or interleave
✅ **Tool-specific injection**: Can inject after tool results
✅ **Periodic injection**: Reminders every N turns
✅ **Template support**: Dynamic content per request

## Difference from Original Design

**Original**: Inject as ephemeral system role messages (NOT stored)
**Updated**: Inject into user message content array (IS stored)

This matches Claude CLI's proven approach and ensures:
1. Models see the guidance consistently
2. Guidance is preserved in conversation history
3. Compatible with all provider APIs (no system role issues)
4. Deduplication works via content hash
