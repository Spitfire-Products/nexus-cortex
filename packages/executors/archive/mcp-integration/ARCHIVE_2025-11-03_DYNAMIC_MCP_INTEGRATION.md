# Dynamic MCP Integration Guide

**Revised Architecture**: Each MCP tool is registered as a separate, individual tool in the tool registry.

**Date**: 2025-11-03
**Status**: ✅ PRODUCTION READY

---

## Overview

OmniClaude V4 implements MCP integration using **dynamic tool registration** - the same architecture as Claude Code (Gemini CLI). Each tool discovered from an MCP server becomes an individual tool that the LLM can call directly.

### Key Difference from Previous Architecture

**OLD (Wrapper Pattern - REMOVED)**:
```json
{"tool": "Mcp", "params": {"server": "filesystem", "tool": "read_file", "arguments": {...}}}
```

**NEW (Direct Registration - CURRENT)**:
```json
{"tool": "read_file", "params": {...}}
```

The LLM sees each MCP tool as a separate tool with its own name, description, and parameter schema.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ LLM (Claude, GPT, Gemini)                                   │
│ Sees: Read, Write, Edit, read_file, list_directory, etc.   │
│ Each MCP tool appears as individual tool                    │
└────────────────────────┬────────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────────┐
│ ToolRegistry                                                 │
│ - 18 base tools (Read, Write, Edit, etc.)                  │
│ - Dynamically registered MCP tools (read_file, etc.)       │
│ - Each tool routes to its executor                         │
└────────────────────────┬────────────────────────────────────┘
                         │
         ┌───────────────┼───────────────┐
         ▼               ▼               ▼
    ┌─────────┐    ┌─────────┐    ┌─────────┐
    │  Read   │    │read_file│    │list_dir │
    │ Executor│    │ (MCP)   │    │  (MCP)  │
    └─────────┘    └─────────┘    └─────────┘
                         │               │
                         └───────┬───────┘
                                 ▼
                      ┌──────────────────┐
                      │ McpClientManager │
                      │  (Multi-Server)  │
                      └──────────────────┘
                                 │
                 ┌───────────────┼───────────────┐
                 ▼               ▼               ▼
            ┌────────┐     ┌────────┐     ┌────────┐
            │  MCP   │     │  MCP   │     │  MCP   │
            │Server 1│     │Server 2│     │Server 3│
            └────────┘     └────────┘     └────────┘
```

---

## Complete Integration Example

### Step 1: Initialize Orchestrator with MCP

```typescript
import { OmniClaudeOrchestrator, AdapterRegistry } from '@omniclaude/core';

const orchestrator = new OmniClaudeOrchestrator(
  new AdapterRegistry(),
  {
    // Enable MCP integration
    enableMcp: true,

    // Configure MCP servers
    mcpServers: {
      filesystem: {
        name: 'filesystem',
        command: 'npx',
        args: ['@modelcontextprotocol/server-filesystem', '/workspace'],
        timeout: 30000,
      },
      github: {
        name: 'github',
        command: 'npx',
        args: ['@modelcontextprotocol/server-github'],
        env: { GITHUB_TOKEN: process.env.GITHUB_TOKEN },
        timeout: 30000,
      },
    },

    defaultModelId: 'claude-sonnet-4-5',
    debug: true,
  }
);
```

### Step 2: Create Session (Connects MCP Automatically)

```typescript
const session = await orchestrator.createSession(
  '/workspace/project',
  'claude-sonnet-4-5'
);

// MCP servers are now connected and tools discovered
console.log('Session created:', session.sessionId);
```

### Step 3: Register Base Tools + Dynamic MCP Tools

```typescript
import { ToolRegistry } from '@omniclaude/executors';
import { DiscoveredMcpToolExecutor } from '@omniclaude/executors';

// Create tool registry
const toolRegistry = new ToolRegistry({
  workingDirectory: process.cwd(),
  allowNetwork: true,
  allowFileSystem: true,
  allowShellExecution: true,
  mcpManager: orchestrator.getMcpManager(),
});

// Register base tools (Read, Write, Edit, etc.)
toolRegistry.registerTool(new ReadToolExecutor(toolRegistry.config));
toolRegistry.registerTool(new WriteToolExecutor(toolRegistry.config));
toolRegistry.registerTool(new EditToolExecutor(toolRegistry.config));
// ... register other base tools

// Register MCP tools dynamically
const mcpToolDeclarations = orchestrator.getMcpToolDeclarations();

for (const toolDecl of mcpToolDeclarations) {
  const mcpTool = new DiscoveredMcpToolExecutor(
    toolDecl.serverName,
    toolDecl.toolName,
    {
      name: toolDecl.toolName,
      description: toolDecl.description,
      inputSchema: toolDecl.inputSchema,
    },
    () => orchestrator.getMcpManager()
  );

  toolRegistry.registerTool(mcpTool);

  if (debug) {
    console.log(`Registered MCP tool: ${mcpTool.name} (from ${toolDecl.serverName})`);
  }
}
```

### Step 4: Tool Execution

```typescript
// Base tool execution (direct)
const readResult = await toolRegistry.executeTool(
  'Read',
  { file_path: '/workspace/file.txt' },
  signal
);

// MCP tool execution (also direct!)
const mcpResult = await toolRegistry.executeTool(
  'read_file',  // ← Direct tool name from MCP server
  { path: '/workspace/file.txt' },
  signal
);

// Both work the same way from the LLM's perspective
```

### Step 5: Cleanup

```typescript
// Cleanup MCP connections on shutdown
await orchestrator.cleanup();
```

---

## Helper Function for Registration

Here's a reusable helper function:

```typescript
import { DiscoveredMcpToolExecutor } from '@omniclaude/executors';

function registerMcpTools(
  orchestrator: OmniClaudeOrchestrator,
  toolRegistry: ToolRegistry,
  debug = false
): number {
  const toolDeclarations = orchestrator.getMcpToolDeclarations();

  for (const toolDecl of toolDeclarations) {
    const mcpTool = new DiscoveredMcpToolExecutor(
      toolDecl.serverName,
      toolDecl.toolName,
      {
        name: toolDecl.toolName,
        description: toolDecl.description,
        inputSchema: toolDecl.inputSchema,
      },
      () => orchestrator.getMcpManager()
    );

    toolRegistry.registerTool(mcpTool);

    if (debug) {
      console.log(`✓ Registered MCP tool: ${mcpTool.name} (${toolDecl.serverName})`);
    }
  }

  return toolDeclarations.length;
}

// Usage
const mcpToolCount = registerMcpTools(orchestrator, toolRegistry, true);
console.log(`Registered ${mcpToolCount} MCP tools`);
```

---

## Complete Minimal Example

```typescript
import { OmniClaudeOrchestrator, AdapterRegistry } from '@omniclaude/core';
import { ToolRegistry, DiscoveredMcpToolExecutor } from '@omniclaude/executors';

async function setupWithMcp() {
  // 1. Create orchestrator with MCP enabled
  const orchestrator = new OmniClaudeOrchestrator(
    new AdapterRegistry(),
    {
      enableMcp: true,
      mcpServers: {
        filesystem: {
          name: 'filesystem',
          command: 'npx',
          args: ['@modelcontextprotocol/server-filesystem', process.cwd()],
          timeout: 30000,
        },
      },
      defaultModelId: 'claude-sonnet-4-5',
      debug: true,
    }
  );

  // 2. Create session (connects MCP)
  const session = await orchestrator.createSession(process.cwd());

  // 3. Create tool registry
  const toolRegistry = new ToolRegistry({
    workingDirectory: process.cwd(),
    allowNetwork: true,
    allowFileSystem: true,
    allowShellExecution: true,
    mcpManager: orchestrator.getMcpManager(),
  });

  // 4. Register base tools
  // ... (register Read, Write, Edit, etc.)

  // 5. Register MCP tools dynamically
  const mcpToolDeclarations = orchestrator.getMcpToolDeclarations();

  for (const toolDecl of mcpToolDeclarations) {
    toolRegistry.registerTool(
      new DiscoveredMcpToolExecutor(
        toolDecl.serverName,
        toolDecl.toolName,
        {
          name: toolDecl.toolName,
          description: toolDecl.description,
          inputSchema: toolDecl.inputSchema,
        },
        () => orchestrator.getMcpManager()
      )
    );
  }

  // 6. Check what tools are available
  const serverInfo = orchestrator.getMcpServerInfo();
  console.log('MCP Servers:', serverInfo);
  console.log('Total tools registered:', toolRegistry.getToolCount());

  return { orchestrator, session, toolRegistry };
}

// Usage
const { orchestrator, session, toolRegistry } = await setupWithMcp();

// Execute MCP tool directly
const result = await toolRegistry.executeTool(
  'list_directory',  // Direct call to MCP tool!
  { path: process.cwd() },
  new AbortController().signal
);

console.log(result.returnDisplay);

// Cleanup
await orchestrator.cleanup();
```

---

## Tool Name Collision Handling

If multiple MCP servers expose tools with the same name, you can use namespaced names:

```typescript
// Option 1: Use server prefix (implemented by generateValidToolName)
const mcpTool = new DiscoveredMcpToolExecutor(
  toolDecl.serverName,
  toolDecl.toolName,
  {
    name: toolDecl.toolName,
    description: toolDecl.description,
    inputSchema: toolDecl.inputSchema,
  },
  () => orchestrator.getMcpManager(),
  `${toolDecl.serverName}__${toolDecl.toolName}` // ← Explicit namespacing
);
```

The tool will be registered as `filesystem__read_file` instead of just `read_file`.

---

## Example LLM Interaction

**User**: "Read the contents of package.json"

**LLM** (internally):
1. Sees `read_file` tool in tool list (from filesystem MCP server)
2. Calls tool directly:
```json
{
  "tool": "read_file",
  "parameters": {
    "path": "/workspace/package.json"
  }
}
```

**System**:
1. ToolRegistry routes to DiscoveredMcpToolExecutor instance
2. Executor calls `mcpManager.callTool('filesystem', 'read_file', {...})`
3. McpClientManager forwards to filesystem MCP server
4. Returns formatted result

**LLM**: "Here are the contents of your package.json: ..."

---

## Verification

After setup, verify MCP integration:

```typescript
// Check MCP status
console.log('MCP enabled:', orchestrator.isMcpEnabled());

// Check servers
const serverInfo = orchestrator.getMcpServerInfo();
console.log('Connected servers:', serverInfo.length);
serverInfo.forEach(info => {
  console.log(`  - ${info.name}: ${info.status}, ${info.toolCount} tools`);
});

// Check discovered tools
const toolDeclarations = orchestrator.getMcpToolDeclarations();
console.log('MCP tools discovered:', toolDeclarations.length);
toolDeclarations.forEach(tool => {
  console.log(`  - ${tool.toolName} (${tool.serverName})`);
});
```

---

## Migration from Old Architecture

If you were using the old wrapper tools (`Mcp`, `ListMcpResources`, `ReadMcpResource`), here's how to migrate:

### OLD Code:
```typescript
// Old wrapper approach
const result = await toolRegistry.executeTool(
  'Mcp',
  {
    server: 'filesystem',
    tool: 'read_file',
    arguments: { path: '/file.txt' }
  },
  signal
);
```

### NEW Code:
```typescript
// New direct approach
const result = await toolRegistry.executeTool(
  'read_file',  // ← Direct tool name
  { path: '/file.txt' },  // ← Direct parameters
  signal
);
```

The wrapper tools have been **removed** - all MCP tools are now registered individually.

---

## Benefits of Dynamic Registration

1. **LLM Transparency**: LLM sees exact tool names and schemas from MCP servers
2. **No Wrapper Overhead**: Direct tool calls, no indirection
3. **Better Tool Discovery**: Each tool has its own description and schema
4. **Natural Integration**: MCP tools work exactly like base tools
5. **Namespace Control**: Can prefix tool names to avoid collisions
6. **Claude Code Compatible**: Same architecture as official Gemini CLI

---

## Troubleshooting

### "Tool not found" when calling MCP tool
**Cause**: MCP tool wasn't registered
**Fix**: Ensure you're calling `registerMcpTools()` or manually registering each tool after MCP discovery

### "MCP manager not available"
**Cause**: MCP not enabled in orchestrator config
**Fix**: Set `enableMcp: true` in OrchestratorConfig

### "Server not connected"
**Cause**: Server failed to connect during session creation
**Fix**: Check server config, command, and arguments. Check logs for connection errors.

### No tools discovered
**Cause**: MCP server has no tools, or discovery failed
**Fix**: Use `orchestrator.getMcpServerInfo()` to check server status and tool count

---

## Summary

**Dynamic MCP Integration Checklist:**
- ✅ Enable MCP in orchestrator config
- ✅ Configure MCP servers with connection details
- ✅ Create session (auto-connects to MCP servers)
- ✅ Get tool declarations via `getMcpToolDeclarations()`
- ✅ Wrap each declaration in `DiscoveredMcpToolExecutor`
- ✅ Register each executor with ToolRegistry
- ✅ LLM can now call MCP tools directly by name
- ✅ Cleanup via `orchestrator.cleanup()` on shutdown

**Result**: The LLM sees ~18 base tools + all MCP server tools as individual, directly-callable tools!

---

**See Also**:
- `MCP_ORCHESTRATOR_INTEGRATION.md` - Orchestrator integration details
- `DiscoveredMcpTool.ts` - Tool executor implementation
- Gemini CLI source - Reference implementation
