# System Message Middleware

## Overview

The `SystemMessageMiddleware` component implements deterministic system message injection into user message content arrays. It was extracted from the CortexOrchestrator as part of the Phase 3 middleware extraction effort.

## Purpose

Handles injection of system messages (prompts, guides, reminders) into user messages based on:
- Session phase (start, ongoing, end)
- Model capabilities (reasoning, tools, streaming)
- Tool presence and count
- API pattern (messages, chat/completions, generateContent)

## Architecture

### Dependencies

- `SystemMessageLoader`: Loads system messages from registry files
- `SystemReminderInjector`: Creates dynamic system reminders
- `toolFactory`: Provides tool count and names

### Interface Implementation

Implements `ISystemMessageInjector` from `MiddlewareContracts.ts`:

```typescript
interface ISystemMessageInjector {
  injectSystemMessages(userContent, model, hasTools, context): Promise<any[]>;
  buildInjectionContext(model, hasTools, context): InjectionContext;
  buildTemplateVariables(toolCount, context): TemplateVariables;
}
```

## Key Features

### 1. Injection Context Building

Determines the current state of the session to filter applicable system messages:

- **Session Phase**: `start` (turn 0), `ongoing` (turn > 0), `end` (explicit termination)
- **Model Capabilities**: Extracted from ModelConfig (reasoning, tools, streaming)
- **Tool Information**: Count and presence of available tools
- **API Pattern**: Provider-specific API format

### 2. Template Variable System

Supports dynamic content substitution in system messages using `{{variable}}` syntax:

| Variable | Description | Example |
|----------|-------------|---------|
| `projectPath` | Current workspace path | `/home/runner/workspace` |
| `workspacePath` | Alias for projectPath | `/home/runner/workspace` |
| `currentDate` | ISO date (YYYY-MM-DD) | `2025-11-12` |
| `currentTime` | Full ISO timestamp | `2025-11-12T06:24:36.000Z` |
| `toolCount` | Number of available tools | `15` |
| `toolNames` | Array of tool names | `["Read", "Write", "Edit"]` |
| `sandboxEnabled` | Sandbox execution status | `true` |

### 3. Message Injection

Follows the Claude CLI injection pattern:

1. Load applicable messages from registry
2. Separate by position (`prepend` vs `append`)
3. Sort by priority within each position
4. Wrap in `<system-reminder>` tags if configured
5. Build final array: `[prepend messages] + [user content] + [append messages]`

#### Position System

- **prepend**: Messages injected before user content
- **append**: Messages injected after user content

#### Priority Sorting

Lower priority values are injected earlier:
- Priority 1: First message
- Priority 10: Second message
- Priority 20: Third message

### 4. System Reminder Wrapping

Messages can be wrapped in `<system-reminder>` tags for Claude CLI compatibility:

```
<system-reminder>
System message content here
</system-reminder>
```

This provides clear delineation between system instructions and user content.

## Usage Examples

### Basic Usage

```typescript
import { SystemMessageMiddleware } from './middleware/SystemMessageMiddleware.js';
import { SystemMessageLoader } from './system-messages/SystemMessageLoader.js';
import { SystemReminderInjector } from './system-messages/SystemReminderInjector.js';

// Create dependencies
const loader = new SystemMessageLoader();
const reminderInjector = new SystemReminderInjector();

// Create middleware
const middleware = new SystemMessageMiddleware(loader, reminderInjector);

// Setup context
const context = {
  sessionId: 'session-123',
  conversationId: 'conv-456',
  turnNumber: 0,
  modelId: 'claude-3-5-sonnet-20241022',
  config: {
    projectPath: '/workspace',
    enableSandbox: true
  }
};

// Inject system messages
const injectedContent = await middleware.injectSystemMessages(
  "Hello, Claude!",
  modelConfig,
  true, // has tools
  context
);
```

### Building Injection Context

```typescript
const model = {
  id: 'claude-3-5-sonnet-20241022',
  api: { pattern: 'messages' },
  tools: { supported: true },
  reasoning: { supported: true },
  streaming: { supported: true }
};

const context = middleware.buildInjectionContext(
  model,
  true, // has tools
  sessionContext
);

console.log(context);
// {
//   turnNumber: 0,
//   sessionPhase: 'start',
//   hasTools: true,
//   toolCount: 15,
//   modelCapabilities: ['reasoning', 'tools', 'streaming'],
//   apiPattern: 'messages',
//   sessionId: 'session-123'
// }
```

### Building Template Variables

```typescript
const vars = middleware.buildTemplateVariables(15, context);

console.log(vars);
// {
//   projectPath: '/workspace',
//   workspacePath: '/workspace',
//   currentDate: '2025-11-12',
//   currentTime: '2025-11-12T06:24:36.000Z',
//   toolCount: 15,
//   toolNames: ['Read', 'Write', 'Edit', 'Bash', 'Grep', ...],
//   sandboxEnabled: true
// }
```

### Message Injection Result

Input:
```typescript
await middleware.injectSystemMessages(
  "What is the weather?",
  model,
  true,
  context
);
```

Output:
```typescript
[
  {
    type: 'text',
    text: '<system-reminder>\nYou are Claude, an AI assistant...\n</system-reminder>'
  },
  {
    type: 'text',
    text: '<system-reminder>\nTool usage guide...\n</system-reminder>'
  },
  {
    type: 'text',
    text: 'What is the weather?'
  },
  {
    type: 'text',
    text: '<system-reminder>\nRemember to check your work...\n</system-reminder>'
  }
]
```

## Integration with Orchestrator

The middleware is designed to replace the injection logic in `CortexOrchestrator`:

### Before (in Orchestrator)

```typescript
// Lines 1670-1793 in CortexOrchestrator.ts
private buildInjectionContext(...) { ... }
private buildTemplateVariables(...) { ... }
private async injectSystemMessages(...) { ... }
```

### After (with Middleware)

```typescript
// In Orchestrator constructor
this.systemMessageMiddleware = new SystemMessageMiddleware(
  this.systemMessageLoader,
  this.systemReminderInjector
);

// In sendMessage method
const injectedContent = await this.systemMessageMiddleware.injectSystemMessages(
  userMessage.content,
  model,
  hasTools,
  middlewareContext
);
```

## Testing

The middleware has comprehensive test coverage:

- **29 tests** covering all functionality
- **99.65% statement coverage**
- **96.55% branch coverage**
- **100% function coverage**

Test categories:
- Injection context building (8 tests)
- Template variable generation (6 tests)
- Message injection mechanics (15 tests)

## Performance Considerations

1. **Caching**: System message content is cached by `SystemMessageLoader`
2. **Lazy Loading**: Messages only loaded when needed
3. **Efficient Filtering**: Messages filtered by conditions before loading
4. **Priority Sorting**: O(n log n) sorting only on applicable messages

## Best Practices

### DO

- Use the middleware through the orchestrator
- Rely on the registry for message configuration
- Test with different model capabilities
- Verify template variable expansion

### DON'T

- Modify injected content after generation
- Bypass the middleware for system messages
- Hardcode system messages in code
- Skip injection context building

## Troubleshooting

### Messages Not Injecting

1. Check registry conditions match session state
2. Verify model capabilities are correct
3. Ensure `hasTools` parameter is accurate
4. Check turn number (some messages only on turn 0)

### Template Variables Not Expanding

1. Verify `SystemMessageLoader` is configured correctly
2. Check message has `dynamic: true` in registry
3. Ensure variables use `{{variableName}}` syntax
4. Verify context has required configuration

### Wrong Message Order

1. Check priority values in registry
2. Verify position is set correctly (prepend/append)
3. Ensure sorting logic hasn't been modified

## Future Enhancements

Potential improvements for future versions:

1. **Vision Capability Detection**: Add when ModelConfig supports vision
2. **Interleave Position**: Support injecting between content blocks
3. **Conditional Wrapping**: More granular control over system-reminder tags
4. **Custom Conditions**: Runtime evaluation of custom conditions
5. **Message Versioning**: Track which messages were injected per turn

## Related Documentation

- `MiddlewareContracts.ts`: Interface definitions
- `SystemMessageLoader.ts`: Message loading implementation
- `SystemReminderInjector.ts`: Dynamic reminder creation
- `system-message-registry.json`: Message configuration
- `CLAUDE_CLI_INJECTION_PATTERNS.md`: Claude CLI injection research

## Version History

- **1.0.0** (2025-11-12): Initial extraction from CortexOrchestrator
  - Implemented all three interface methods
  - Achieved 99.65% test coverage
  - Full JSDoc documentation
