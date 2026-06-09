# System Messages Module

This module provides deterministic injection of system messages to guide AI model behavior with tools.

## Overview

The System Messages module solves a critical problem: **How do we instruct AI models to use tools correctly?**

### The Problem

Models need clear instructions about:
- How to use tools properly
- When to wait for tool results
- How to handle errors
- Tool calling patterns and best practices

Without these instructions, models may:
- Call tools with invalid parameters
- Not wait for tool results
- Misuse or ignore tools
- Provide poor user experiences

### The Solution

A **markdown-based system message registry** that:
1. Stores instructions in user-editable `.md` files
2. Injects messages based on deterministic conditions
3. Does NOT clutter canonical message storage
4. Supports dynamic templating
5. Handles reasoning models with `<thinking>` blocks

## Architecture

```
┌────────────────────────────────────────────────────────┐
│              SystemMessageLoader                       │
│  Reads registry + .md files → Injects at runtime     │
└────────────────────────────────────────────────────────┘
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
        v                  v                  v
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│   Registry   │  │  .md Files   │  │   Injector   │
│   (JSON)     │  │  (Content)   │  │  (Runtime)   │
└──────────────┘  └──────────────┘  └──────────────┘
```

### Components

1. **system-message-registry.json**
   - Defines all system messages
   - Specifies injection conditions
   - Controls priority and positioning

2. **messages/*.md files**
   - User-editable markdown content
   - Support template variables
   - Version-controlled instructions

3. **SystemMessageLoader.ts**
   - Loads registry configuration
   - Reads markdown files
   - Evaluates injection conditions
   - Caches content
   - Provides messages for context

4. **SystemMessageRegistry.interface.ts**
   - TypeScript type definitions
   - Injection conditions interface
   - Context structure

## Message Files

### Core Messages

| File | Purpose | When Injected |
|------|---------|---------------|
| `SYSTEM_PROMPT.md` | Core AI instructions | Session start (turn 0) |
| `TOOL_USAGE_GUIDE.md` | Tool usage protocol | When tools provided |
| `EXAMPLES.md` | Concrete usage examples | Session start with tools |
| `REASONING_GUIDE.md` | Reasoning model instructions | Models with reasoning capability |
| `ENVIRONMENT_INFO.md` | Workspace/sandbox info | Session start (dynamic) |
| `POLICY_CHECK.md` | Safety policies | Session start |
| `PERIODIC_REMINDER.md` | Tool usage reminders | Every 10 turns with tools |

### Template Variables

Messages support dynamic content via `{{variable}}` syntax:

```markdown
Workspace: {{projectPath}}
Tools: {{toolCount}}
Date: {{currentDate}}
```

Variables:
- `projectPath` - Workspace directory
- `workspacePath` - Working directory
- `currentDate` - Current date
- `currentTime` - Current time
- `toolCount` - Number of tools
- `toolNames` - List of tool names
- `sandboxEnabled` - Sandbox status
- `sessionId` - Current session ID

## Injection Conditions

Messages are injected based on:

- **turnNumber**: Specific turn (e.g., 0 for session start)
- **turnNumberModulo**: Periodic (e.g., every 10 turns)
- **hasTools**: Only when tools are provided
- **sessionPhase**: `start`, `ongoing`, or `end`
- **modelCapabilities**: `reasoning`, `vision`, `tools`, `streaming`
- **apiPattern**: `messages` or `chat`

Example from registry:
```json
{
  "id": "tool_usage_guide",
  "file": "messages/TOOL_USAGE_GUIDE.md",
  "conditions": {
    "hasTools": true,
    "sessionPhase": ["start", "ongoing"]
  },
  "injection": {
    "position": "prepend",
    "role": "system",
    "priority": 2
  }
}
```

## Usage

### Basic Usage

```typescript
import { SystemMessageLoader } from './SystemMessageLoader.js';
import type { InjectionContext } from './SystemMessageRegistry.interface.js';

// Create loader
const loader = new SystemMessageLoader({ debug: true });

// Load registry
await loader.loadRegistry();

// Define context
const context: InjectionContext = {
  turnNumber: 0,
  sessionPhase: 'start',
  hasTools: true,
  toolCount: 5,
  modelCapabilities: ['tools'],
  apiPattern: 'messages',
  sessionId: 'session_123'
};

// Get messages to inject
const messages = await loader.getMessagesForContext(context, {
  projectPath: '/workspace',
  toolCount: 5,
  toolNames: '- Read\n- Write\n- Bash\n- Grep\n- Glob',
  currentDate: '2025-11-07',
  sandboxEnabled: 'true'
});

// Inject into request (NOT canonical storage)
const requestMessages = [
  ...messages.map(msg => ({
    role: msg.definition.injection.role,
    content: msg.content
  })),
  ...canonicalMessages  // Only these are stored
];
```

### Integration with Orchestrator

```typescript
// In CortexOrchestrator.sendMessage()
async sendMessage(prompt: string, options?: SendMessageOptions) {
  // 1. Build injection context
  const context: InjectionContext = {
    turnNumber: this.currentTurnNumber,
    sessionPhase: this.currentTurnNumber === 0 ? 'start' : 'ongoing',
    hasTools: !!options?.tools,
    toolCount: options?.tools?.length || 0,
    modelCapabilities: this.getModelCapabilities(),
    apiPattern: this.currentModel.apiPattern,
    sessionId: this.currentSessionId
  };

  // 2. Get system messages
  const systemMessages = await this.systemMessageLoader.getMessagesForContext(
    context,
    {
      projectPath: this.config.projectPath,
      toolCount: options?.tools?.length || 0,
      toolNames: this.formatToolNames(options?.tools),
      currentDate: new Date().toISOString().split('T')[0],
      // ...
    }
  );

  // 3. Inject ephemerally (NOT stored in canonical history)
  const requestMessages = [
    ...systemMessages.map(msg => this.toCanonicalMessage(msg)),
    ...this.canonicalMessages,  // Stored history
    newUserMessage
  ];

  // 4. Send to gateway
  const response = await this.gateway.sendRequest({
    messages: requestMessages,
    tools: options?.tools
  });

  // 5. Store ONLY user/assistant messages (not system prompts)
  await this.historyStore.appendMessage(newUserMessage);
  await this.historyStore.appendMessage(responseMessage);
}
```

## Key Principles

### 1. Ephemeral Injection
System messages are injected at request-time but **NOT stored** in canonical message history. This keeps storage clean and allows instruction updates without reprocessing history.

### 2. Deterministic Conditions
Injection is based on explicit conditions (turn number, tools present, etc.), ensuring consistent behavior across sessions.

### 3. User-Editable Content
All instructions are in markdown files that users can edit to change model behavior without code changes.

### 4. Template Support
Dynamic content (paths, dates, tool counts) is injected via templates, keeping files reusable.

### 5. Deduplication
Same content won't be injected twice in a row (content hash based).

### 6. Priority Ordering
Messages are injected in priority order (lower priority = earlier injection).

## Reasoning Models

For models with reasoning capabilities (e.g., DeepSeek Reasoner, Claude Opus Extended Thinking):

- `REASONING_GUIDE.md` provides instructions on using `<thinking>` blocks
- Interleaved thinking pattern supported
- Tool usage rules apply within reasoning context

## Editing Messages

To modify model behavior:

1. Edit the relevant `.md` file in `messages/`
2. Reload the registry: `loader.reload()`
3. Changes apply immediately to new requests

Example - Make tool usage more verbose:

Edit `messages/TOOL_USAGE_GUIDE.md`:
```markdown
### Before Every Tool Call
1. Explain to the user what tool you're using
2. Describe what you expect to find
3. Make the tool call
4. Report the result
```

## Benefits

✅ **Clear Instructions**: Models receive explicit guidance
✅ **Consistent Behavior**: Deterministic injection rules
✅ **Easy Updates**: Edit markdown files, not code
✅ **Clean Storage**: System prompts not in canonical history
✅ **Flexible**: Conditions, templates, priorities
✅ **Reasoning Support**: Handle `<thinking>` blocks
✅ **Deduplication**: No redundant injections
✅ **Version Control**: Track instruction changes via git

## Files Created

### Core Implementation
- `system-message-registry.json` - Injection configuration
- `SystemMessageRegistry.interface.ts` - TypeScript types
- `SystemMessageLoader.ts` - Loader implementation
- `index.ts` - Public exports

### Message Files
- `messages/SYSTEM_PROMPT.md`
- `messages/TOOL_USAGE_GUIDE.md`
- `messages/EXAMPLES.md`
- `messages/REASONING_GUIDE.md`
- `messages/ENVIRONMENT_INFO.md`
- `messages/POLICY_CHECK.md`
- `messages/PERIODIC_REMINDER.md`

### Documentation
- `ARCHITECTURE.md` - Detailed architecture design
- `README.md` - This file

## Next Steps

1. ✅ Registry configuration created
2. ✅ Loader implementation complete
3. ✅ Message files created
4. ⏳ Wire into CortexOrchestrator
5. ⏳ Test with grok-code-fast-1
6. ⏳ Validate tool usage improves
7. ⏳ Run cumulative tool validation tests

## Example: Impact on Tool Validation Tests

**Before System Messages**:
```
User: "List all the tools you have"
Model: "I don't have specific tools." ❌
```

**After System Messages** (with TOOL_USAGE_GUIDE.md):
```
User: "List all the tools you have"
Model: "I have access to 3 tools:
1. test_tool_one - First test tool for format validation
2. test_tool_two - Second test tool
3. calculate - Performs basic arithmetic" ✅
```

The system messages ensure models:
- Acknowledge tools
- Use them correctly
- Wait for results
- Handle errors properly

## Summary

This module provides the missing piece of the Nexus Cortex architecture: **explicit model instruction**. By combining a registry-based system with user-editable markdown files, we can guide models to use tools effectively while maintaining clean, focused canonical message storage.
