# Tool System + System Message Integration Design

## Overview

This document proposes integration between the **Tool System** (ToolFactory, base/addon tools, MCP) and the **System Message Injection System** to provide tool-specific guidance that adapts dynamically based on available tools.

## Current Tool System Architecture

### 1. Tool Factory (Unified Interface)

**Location**: `src/tools/ToolFactory.ts`

The ToolFactory provides a unified interface for accessing all tools:

```typescript
class ToolFactory {
  /**
   * Get all tools (base + addon)
   * Base tools take precedence on name conflicts
   */
  getAllTools(): CanonicalToolDefinition[] {
    const baseTools = baseToolRegistry.getAllTools();
    const addonTools = addonToolRegistry.getAllTools();

    // Deduplicate by name (base tools win)
    const toolMap = new Map<string, CanonicalToolDefinition>();
    baseTools.forEach(tool => toolMap.set(tool.name, tool));
    addonTools.forEach(tool => {
      if (!toolMap.has(tool.name)) {
        toolMap.set(tool.name, tool);
      }
    });

    return Array.from(toolMap.values());
  }

  registerAddonTool(tool: AddonToolDefinition): void {
    // Dynamic tool registration
  }
}
```

### 2. Base Tool Registry (25 Immutable Tools)

**Location**: `src/tools/registries/BaseToolRegistry.ts`

Hardcoded registry with best practices embedded in descriptions:

```typescript
{
  name: 'Read',
  description: `Read the contents of a file...

BEST PRACTICES:
- Accept user's relative paths (e.g., "./file.txt", "src/code.js")
- First verify current working directory with 'pwd' if uncertain
- Convert relative paths to absolute internally when needed
- Always Read before Edit to get exact content for string matching
- Verify file exists with 'ls' or 'test -f' if unsure`,
  schema: { /* ... */ },
  category: 'base',
  metadata: {
    immutable: true,
    executionEnvironment: 'client',
    version: '1.0.0'
  }
}
```

**Key Insight**: Base tools already have extensive best practices in their descriptions. This content could be extracted and used for system messages.

### 3. MCP Integration

**Location**: `src/mcp/`

Model Context Protocol provides extended tool capabilities:
- MCP servers expose tools dynamically
- `McpClientManager.getAllTools()` returns MCP-provided tools
- Tools can be auto-injected based on `MCP_CONFIG.md`

### 4. Tool Usage in Orchestrator

**Location**: `src/orchestrator/CortexOrchestrator.ts:367-388`

```typescript
async sendMessage(content: string, options: SendMessageOptions = {}) {
  // Get tools from factory (base + addon)
  const factoryTools = toolFactory.getAllTools();

  // Get MCP tools if auto-inject enabled
  const mcpTools = this.mcpAutoInject ? this.getMcpToolsAsCanonical() : [];

  // Get MCP management tools (if MCP enabled)
  const mcpManagementTools = this.getMcpManagementTools();

  // Merge all tools
  const allTools = options.tools !== undefined
    ? [...factoryTools, ...mcpTools, ...mcpManagementTools, ...options.tools]
    : undefined;

  // Send to gateway with tools
  const response = await this.gateway.sendRequest({
    messages: canonicalHistory,
    tools: allTools,
    // ...
  });
}
```

## Proposed Integration: Tool-Aware System Messages

### Concept

**Idea**: Dynamically inject tool-specific system messages based on:
1. **Which tools are available** in the current request
2. **Tool categories** (file operations, bash, search, etc.)
3. **Tool best practices** embedded in tool definitions
4. **Tool usage context** (first use, periodic reminders, error recovery)

### Benefits

✅ **Contextual Guidance**: Model receives instructions only for tools it has access to
✅ **Reduced Token Usage**: Don't inject guidance for unavailable tools
✅ **Dynamic Adaptation**: Instructions change based on tool availability
✅ **Best Practice Extraction**: Leverage existing tool descriptions
✅ **Skills-Based Augmentation**: Inject skill-specific guidance when tools suggest specific workflows

## Design: Tool-Specific Message System

### 1. Tool Category Messages

Create message files per tool category:

```
src/system-messages/messages/tools/
├── FILE_OPERATIONS_GUIDE.md      # Read, Write, Edit, Glob
├── BASH_EXECUTION_GUIDE.md       # Bash tool
├── SEARCH_GUIDE.md               # Grep tool
├── MCP_TOOLS_GUIDE.md            # MCP integration
└── HISTORICAL_CONTEXT_GUIDE.md   # Historical retrieval tools
```

### 2. Registry Configuration for Tool Messages

**Update**: `src/system-messages/system-message-registry.json`

```json
{
  "messages": [
    {
      "id": "file_operations_guide",
      "name": "File Operations Tool Guide",
      "file": "messages/tools/FILE_OPERATIONS_GUIDE.md",
      "conditions": {
        "hasTools": true,
        "toolCategories": ["file"]  // ← NEW CONDITION
      },
      "injection": {
        "position": "prepend",
        "role": "system",
        "priority": 3
      },
      "cache": true,
      "dynamic": true,
      "description": "Injected when Read, Write, Edit, or Glob tools are available"
    },
    {
      "id": "bash_execution_guide",
      "name": "Bash Execution Guide",
      "file": "messages/tools/BASH_EXECUTION_GUIDE.md",
      "conditions": {
        "hasTools": true,
        "toolNames": ["Bash"]  // ← NEW CONDITION
      },
      "injection": {
        "position": "prepend",
        "role": "system",
        "priority": 3
      },
      "cache": true,
      "description": "Injected when Bash tool is available"
    }
  ]
}
```

### 3. Extended InjectionContext

**Update**: `SystemMessageRegistry.interface.ts`

```typescript
export interface InjectionContext {
  turnNumber: number;
  sessionPhase: SessionPhase;
  hasTools: boolean;
  toolCount?: number;

  // ← NEW FIELDS FOR TOOL-SPECIFIC INJECTION
  toolNames?: string[];           // Tool names available
  toolCategories?: string[];      // Categories of available tools
  mcpServersEnabled?: string[];   // MCP servers currently active

  modelCapabilities: ModelCapability[];
  apiPattern: string;
  sessionId: string;
  lastInjectedIds?: string[];
}
```

### 4. Extended InjectionConditions

**Update**: `SystemMessageRegistry.interface.ts`

```typescript
export interface InjectionConditions {
  hasTools?: boolean;
  turnNumber?: number;
  turnNumberModulo?: { divisor: number; remainder: number };
  sessionPhase?: SessionPhase | SessionPhase[];
  modelCapabilities?: ModelCapability[];
  apiPattern?: string | string[];

  // ← NEW CONDITIONS FOR TOOL-SPECIFIC INJECTION
  /** Inject when specific tools are available */
  toolNames?: string[];

  /** Inject when tools from specific categories are available */
  toolCategories?: string[];

  /** Inject when specific MCP servers are active */
  mcpServers?: string[];

  /** Custom condition function (evaluated at runtime) */
  customCondition?: string;
}
```

### 5. Tool Category Detection in Orchestrator

**Add to**: `CortexOrchestrator.ts`

```typescript
class CortexOrchestrator {
  /**
   * Extract tool metadata for system message injection
   */
  private getToolMetadataForInjection(tools: CanonicalTool[]): {
    toolNames: string[];
    toolCategories: string[];
    mcpServersEnabled: string[];
  } {
    const toolNames = tools.map(t => t.name);

    // Extract categories from tool metadata
    const toolCategories = new Set<string>();
    tools.forEach(tool => {
      // Categorize based on tool name patterns
      if (['Read', 'Write', 'Edit', 'Glob'].includes(tool.name)) {
        toolCategories.add('file');
      } else if (tool.name === 'Bash') {
        toolCategories.add('bash');
      } else if (tool.name === 'Grep') {
        toolCategories.add('search');
      } else if (tool.name.startsWith('mcp_')) {
        toolCategories.add('mcp');
      }
    });

    // Get active MCP servers
    const mcpServersEnabled = this.mcpManager
      ? this.mcpManager.getActiveServers().map(s => s.name)
      : [];

    return {
      toolNames,
      toolCategories: Array.from(toolCategories),
      mcpServersEnabled
    };
  }

  /**
   * Build injection context with tool metadata
   */
  private buildInjectionContext(options?: SendMessageOptions): InjectionContext {
    const tools = options?.tools || [];
    const toolMetadata = this.getToolMetadataForInjection(tools);

    return {
      turnNumber: this.turnNumber,
      sessionPhase: this.getSessionPhase(),
      hasTools: tools.length > 0,
      toolCount: tools.length,
      toolNames: toolMetadata.toolNames,
      toolCategories: toolMetadata.toolCategories,
      mcpServersEnabled: toolMetadata.mcpServersEnabled,
      modelCapabilities: this.getModelCapabilities(),
      apiPattern: this.currentModel.api.pattern,
      sessionId: this.currentSessionId || ''
    };
  }
}
```

### 6. Condition Checking in SystemMessageLoader

**Update**: `SystemMessageLoader.ts`

```typescript
class SystemMessageLoader {
  private checkConditions(
    definition: SystemMessageDefinition,
    context: InjectionContext
  ): boolean {
    const { conditions } = definition;

    // Existing conditions...

    // Check toolNames
    if (conditions.toolNames) {
      const hasRequiredTools = conditions.toolNames.every(toolName =>
        context.toolNames?.includes(toolName)
      );
      if (!hasRequiredTools) {
        return false;
      }
    }

    // Check toolCategories
    if (conditions.toolCategories) {
      const hasRequiredCategories = conditions.toolCategories.every(category =>
        context.toolCategories?.includes(category)
      );
      if (!hasRequiredCategories) {
        return false;
      }
    }

    // Check mcpServers
    if (conditions.mcpServers) {
      const hasRequiredServers = conditions.mcpServers.every(server =>
        context.mcpServersEnabled?.includes(server)
      );
      if (!hasRequiredServers) {
        return false;
      }
    }

    return true;
  }
}
```

## Example Tool-Specific Messages

### FILE_OPERATIONS_GUIDE.md

```markdown
# File Operations Guide

You have access to file operation tools: {{toolNames}}

## Tool Overview

### Read Tool
- **Purpose**: Read file contents
- **Best Practice**: Always Read before Edit to ensure exact string matching
- **Example**:
  ```json
  {"name": "Read", "input": {"file_path": "./README.md"}}
  ```

### Write Tool
- **Purpose**: Create or overwrite files
- **Warning**: Write will overwrite existing files without warning
- **Best Practice**: Use Read first to check if file exists
- **Example**:
  ```json
  {"name": "Write", "input": {"file_path": "./new-file.txt", "content": "..."}}
  ```

### Edit Tool
- **Purpose**: Make precise string replacements
- **Critical Rule**: old_string must match EXACTLY (including whitespace)
- **Best Practice**: Copy exact text from Read output for old_string
- **Example**:
  ```json
  {
    "name": "Edit",
    "input": {
      "file_path": "./file.txt",
      "old_string": "exact text from file",
      "new_string": "replacement text"
    }
  }
  ```

### Glob Tool
- **Purpose**: Find files matching patterns
- **Example**: `{"name": "Glob", "input": {"pattern": "**/*.ts"}}`

## Common Workflows

### Workflow 1: Edit a File
1. Read the file to get current contents
2. Identify exact string to replace
3. Use Edit with exact old_string
4. Verify change with Read (optional)

### Workflow 2: Create New File
1. (Optional) Use Glob to check if file exists
2. Use Write to create file
3. Confirm with Read (optional)
```

### BASH_EXECUTION_GUIDE.md

```markdown
# Bash Execution Guide

You have access to the Bash tool for executing shell commands.

## Critical Rules

### 1. Tool Result Visibility
When you execute a Bash command, you WILL receive the output in the next message.
You MUST wait for and process this result.

### 2. Safety Considerations
- The Bash tool runs in a {{sandboxEnabled}} sandbox environment
- Commands have access to the workspace at: {{projectPath}}
- Be cautious with destructive commands (rm, mv, etc.)

### 3. Command Chaining
You can chain commands using:
- `&&` - Run next command if previous succeeds
- `||` - Run next command if previous fails
- `;` - Run commands sequentially regardless of success

### 4. Environment Variables
Current environment:
- Workspace: {{projectPath}}
- Sandbox: {{sandboxEnabled}}

## Examples

### Example 1: Check Files
```json
{
  "name": "Bash",
  "input": {
    "command": "ls -la {{projectPath}}"
  }
}
```

### Example 2: Install Dependencies
```json
{
  "name": "Bash",
  "input": {
    "command": "cd {{projectPath}} && npm install"
  }
}
```

### Example 3: Run Tests
```json
{
  "name": "Bash",
  "input": {
    "command": "cd {{projectPath}} && npm test"
  }
}
```
```

## Skills-Based Augmentation

### Concept: Skill Detection → Message Injection

When the model or system detects that a specific **skill** applies to the conversation, inject skill-specific guidance.

### Example: Code Review Skill

**Trigger**: Model detects code review task OR user mentions "review" in prompt

**Injected Message**: `CODE_REVIEW_SKILL.md`

```markdown
# Code Review Skill Activated

You have been provided with file operation tools for code review.

## Code Review Workflow

1. **Read the file** to be reviewed
2. **Analyze** for:
   - Code quality issues
   - Potential bugs
   - Performance concerns
   - Security vulnerabilities
3. **Provide feedback** with specific line references
4. **Suggest improvements** with exact Edit operations if requested

## Tools for Code Review

- **Read**: Get file contents
- **Glob**: Find files matching patterns (e.g., all `.ts` files)
- **Grep**: Search for patterns across files
- **Edit**: Apply suggested changes

## Example Review Flow

1. User: "Review the authentication code"
2. You: Use Glob to find auth files
3. You: Use Read to examine each file
4. You: Provide analysis
5. User: "Apply your suggestions"
6. You: Use Edit for each change
```

### Implementation Strategy

**Option 1: Explicit Skill Invocation**
- User explicitly invokes skill: "Use code review skill"
- System injects corresponding message

**Option 2: Automatic Skill Detection**
- Model detects task type from user prompt
- SystemMessageLoader includes skill-based conditions
- Skill messages injected automatically

**Option 3: Hybrid Approach**
- System provides skill detection hints in TOOL_USAGE_GUIDE
- Model can request skill activation via special tool call
- System responds by injecting skill-specific guidance

## Integration Checklist

### Phase 1: Basic Tool Categories
- [ ] Create tool category message files (5 files)
- [ ] Update `InjectionContext` with tool metadata
- [ ] Update `InjectionConditions` with tool-specific conditions
- [ ] Add `getToolMetadataForInjection()` to Orchestrator
- [ ] Update `checkConditions()` in SystemMessageLoader
- [ ] Test with file operations tools

### Phase 2: MCP Tool Messages
- [ ] Create MCP-specific message files
- [ ] Add MCP server detection to injection context
- [ ] Test with enabled MCP servers

### Phase 3: Skills-Based Augmentation
- [ ] Design skill detection mechanism
- [ ] Create skill-specific message files
- [ ] Implement skill activation flow
- [ ] Test with common skills (code review, refactoring, etc.)

## Example End-to-End Flow

### Scenario: User Requests File Edit

**Turn 0: Initial Request**
```
User: "Edit the README.md file to add a new section"
```

**Orchestrator Processing**:
1. Tools available: Read, Write, Edit, Glob, Bash, Grep
2. Tool metadata extracted:
   - toolNames: ['Read', 'Write', 'Edit', 'Glob', 'Bash', 'Grep']
   - toolCategories: ['file', 'bash', 'search']
3. Injection context built:
   - turnNumber: 0
   - hasTools: true
   - toolCategories: ['file', 'bash', 'search']
4. System messages retrieved:
   - SYSTEM_PROMPT.md (priority 1)
   - TOOL_USAGE_GUIDE.md (priority 2)
   - FILE_OPERATIONS_GUIDE.md (priority 3) ← Tool-specific!
   - EXAMPLES.md (priority 4)
   - ENVIRONMENT_INFO.md (priority 5)

**Injected Message Array**:
```json
{
  "role": "user",
  "content": [
    {
      "type": "text",
      "text": "<system-reminder>\n# System Instructions\n...\n</system-reminder>"
    },
    {
      "type": "text",
      "text": "<system-reminder>\n# Tool Usage Guide\n...\n</system-reminder>"
    },
    {
      "type": "text",
      "text": "<system-reminder>\n# File Operations Guide\nYou have access to file operation tools: Read, Write, Edit, Glob\n...\n</system-reminder>"
    },
    {
      "type": "text",
      "text": "Edit the README.md file to add a new section"
    }
  ]
}
```

**Result**: Model receives FILE_OPERATIONS_GUIDE with best practices for Read → Edit workflow.

## Benefits Summary

✅ **Contextual**: Only inject guidance for available tools
✅ **Efficient**: Reduced token usage (no guidance for unavailable tools)
✅ **Dynamic**: Adapts to tool availability changes
✅ **Extensible**: Easy to add new tool categories and skills
✅ **User-Editable**: Markdown files can be customized
✅ **Best Practices**: Leverages existing tool descriptions
✅ **Skills-Aware**: Can augment with skill-specific guidance

## Next Steps

1. **Create tool category message files** (5 files)
2. **Update TypeScript interfaces** for tool-specific conditions
3. **Wire tool metadata extraction** into Orchestrator
4. **Test with file operations** (Read, Write, Edit)
5. **Expand to other categories** (Bash, Grep, MCP)
6. **Explore skills-based augmentation** patterns
