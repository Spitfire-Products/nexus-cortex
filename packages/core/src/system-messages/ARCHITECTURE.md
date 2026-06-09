# System Message Registry Architecture

## Overview

The System Message Registry provides deterministic injection of system messages, instructions, and examples to guide AI models on how to interact with tools and the environment. This follows the same modular pattern as the Model Registry.

## Architecture Pattern

```
┌────────────────────────────────────────────────────────────────┐
│                  SystemMessageRegistry                         │
│  (Similar to ModularModelRegistry)                             │
└────────────────────────────────────────────────────────────────┘
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
        v                  v                  v
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│   SYSTEM     │  │    TOOL      │  │   EXAMPLES   │
│   PROMPT     │  │    USAGE     │  │              │
└──────────────┘  └──────────────┘  └──────────────┘
        │                  │                  │
        v                  v                  v
┌────────────────────────────────────────────────────────────────┐
│              Injected into Model Requests                       │
│  (Before tools are provided, with environment context)         │
└────────────────────────────────────────────────────────────────┘
```

## Directory Structure

```
src/system-messages/
├── ARCHITECTURE.md                    # This file
├── README.md                          # Quick start guide
│
├── messages/                          # Markdown message files
│   ├── SYSTEM_PROMPT.md              # Core system instructions
│   ├── TOOL_USAGE_GUIDE.md           # How to use tools properly
│   ├── EXAMPLES.md                   # Tool usage examples
│   ├── POLICY_CHECK.md               # Behavioral policies
│   ├── ENVIRONMENT_INFO.md           # Workspace/sandbox info
│   └── SYSTEM_REMINDER.md            # Periodic reminders
│
├── templates/                         # Message templates
│   ├── tool-call-example.md          # Template for tool examples
│   └── multi-turn-example.md         # Template for multi-turn examples
│
├── SystemMessage.interface.ts         # TypeScript interfaces
├── SystemMessageRegistry.ts           # Registry implementation
├── SystemMessageLoader.ts             # Markdown file loader
├── index.ts                           # Public exports
│
└── __tests__/
    ├── SystemMessageRegistry.test.ts
    └── SystemMessageLoader.test.ts
```

## Core Interfaces

```typescript
/**
 * System Message Type
 */
export type SystemMessageType =
  | 'system_prompt'      // Core instructions (injected once)
  | 'tool_usage'         // Tool usage guide (with tools)
  | 'examples'           // Usage examples (with tools)
  | 'policy'             // Behavioral policies
  | 'environment'        // Environment/workspace info
  | 'reminder';          // Periodic reminders

/**
 * System Message Definition
 */
export interface SystemMessage {
  type: SystemMessageType;
  content: string;
  priority: number;         // Injection order (lower = earlier)
  scope: 'global' | 'tool' | 'session';

  /**
   * Conditions for injection
   */
  conditions?: {
    hasTools?: boolean;      // Only inject if tools provided
    modelPattern?: string;   // Only for specific API patterns
    turnNumber?: number;     // Inject at specific turn
  };

  metadata?: {
    version: string;
    lastUpdated: string;
    author?: string;
  };
}

/**
 * System Message Registry Interface
 */
export interface SystemMessageRegistry {
  /**
   * Get messages for injection based on context
   */
  getMessagesForContext(context: SystemMessageContext): SystemMessage[];

  /**
   * Get specific message by type
   */
  getMessage(type: SystemMessageType): SystemMessage | undefined;

  /**
   * Refresh messages from files
   */
  refresh(): Promise<void>;
}

/**
 * Context for message injection
 */
export interface SystemMessageContext {
  hasTools: boolean;
  toolCount?: number;
  modelPattern: 'messages' | 'chat';
  turnNumber: number;
  sessionPhase: 'start' | 'ongoing' | 'end';
}
```

## System Message Files

### SYSTEM_PROMPT.md
- **Type**: `system_prompt`
- **Priority**: 1 (earliest)
- **Scope**: `global`
- **Content**: Core instructions about the AI's role and environment
- **Injected**: Once at session start

Example:
```markdown
# System Prompt

You are an AI assistant with access to tools for file operations, code execution, and web search.

## Your Capabilities
- Read and write files in the workspace
- Execute bash commands in a sandboxed environment
- Search for information using grep and glob patterns
- Access web resources

## Your Behavior
- Always use the appropriate tool for each task
- Verify tool results before proceeding
- Maintain context across multiple turns
- Follow tool usage guidelines
```

### TOOL_USAGE_GUIDE.md
- **Type**: `tool_usage`
- **Priority**: 2
- **Scope**: `tool`
- **Conditions**: `hasTools: true`
- **Content**: How to use tools correctly
- **Injected**: When tools are provided

Example:
```markdown
# Tool Usage Guide

## General Principles
1. **Select the right tool**: Match the tool to the task
2. **Validate parameters**: Ensure all required parameters are provided
3. **Check results**: Verify tool execution succeeded
4. **Handle errors**: Respond appropriately to tool failures

## Tool Calling Pattern
```typescript
// 1. Acknowledge the task
// 2. Call the appropriate tool
// 3. Wait for tool_result
// 4. Process and respond with findings
```

## Common Mistakes to Avoid
- Calling tools with invalid parameters
- Not waiting for tool_result before responding
- Ignoring tool errors
```

### EXAMPLES.md
- **Type**: `examples`
- **Priority**: 3
- **Scope**: `tool`
- **Conditions**: `hasTools: true`
- **Content**: Concrete examples of tool usage
- **Injected**: With tools

### POLICY_CHECK.md
- **Type**: `policy`
- **Priority**: 4
- **Scope**: `global`
- **Content**: Safety policies and constraints

### ENVIRONMENT_INFO.md
- **Type**: `environment`
- **Priority**: 5
- **Scope**: `session`
- **Content**: Workspace path, sandbox status, available tools

### SYSTEM_REMINDER.md
- **Type**: `reminder`
- **Priority**: 10
- **Scope**: `session`
- **Conditions**: `turnNumber % 5 === 0` (every 5 turns)
- **Content**: Periodic reminders about tool usage

## Implementation Strategy

### Phase 1: Core Infrastructure ✅ (Current)
1. Create directory structure
2. Define TypeScript interfaces
3. Implement SystemMessageLoader (reads .md files)
4. Implement SystemMessageRegistry
5. Write unit tests

### Phase 2: Message Content
1. Create SYSTEM_PROMPT.md
2. Create TOOL_USAGE_GUIDE.md
3. Create EXAMPLES.md
4. Create POLICY_CHECK.md
5. Create ENVIRONMENT_INFO.md
6. Create SYSTEM_REMINDER.md

### Phase 3: Orchestrator Integration
1. Wire SystemMessageRegistry into CortexOrchestrator
2. Inject system messages before API calls
3. Implement conditional injection logic
4. Test with grok-code-fast-1

### Phase 4: Validation
1. Run tool format validation tests with system messages
2. Run multi-turn tool call tests
3. Verify model follows instructions
4. Measure tool usage accuracy

## Injection Points in Orchestrator

```typescript
class CortexOrchestrator {
  private systemMessages: SystemMessageRegistry;

  async sendMessage(prompt: string, options?: SendMessageOptions) {
    // 1. Build system message context
    const context: SystemMessageContext = {
      hasTools: !!options?.tools,
      toolCount: options?.tools?.length || 0,
      modelPattern: this.currentModel.apiPattern,
      turnNumber: this.currentTurnNumber,
      sessionPhase: this.currentTurnNumber === 0 ? 'start' : 'ongoing'
    };

    // 2. Get applicable system messages
    const systemMessages = this.systemMessages.getMessagesForContext(context);

    // 3. Inject into canonical messages
    const messagesWithSystem = [
      ...systemMessages.map(msg => this.toCanonicalSystemMessage(msg)),
      ...this.messageHistory,
      newUserMessage
    ];

    // 4. Send to gateway with system messages
    const response = await this.gateway.sendRequest({
      messages: messagesWithSystem,
      tools: options?.tools,
      // ...
    });
  }
}
```

## Benefits

1. **Deterministic Guidance**: Models receive consistent instructions
2. **Modular Content**: Each message type in separate file
3. **Conditional Injection**: Messages only when relevant
4. **Version Control**: Track changes to instructions via git
5. **Easy Updates**: Modify .md files without code changes
6. **Testing**: Verify model follows instructions

## Success Metrics

- Tool calling accuracy improves (fewer invalid calls)
- Models acknowledge and list tools correctly
- Multi-turn coherence maintained
- Tool result visibility confirmed
- Error handling follows guidance

## Next Steps

1. ✅ Create architecture document (this file)
2. Define TypeScript interfaces
3. Implement SystemMessageLoader
4. Implement SystemMessageRegistry
5. Create initial message files
6. Wire into CortexOrchestrator
7. Test with grok-code-fast-1
