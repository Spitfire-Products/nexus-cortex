# MCP Integration Guide

**How to integrate MCP tools into OmniClaude V4 system**

---

## 🚨 IMPORTANT: Orchestrator Integration Available

**For production use, MCP is now fully integrated into OmniClaudeOrchestrator!**

📖 **See [MCP_ORCHESTRATOR_INTEGRATION.md](./MCP_ORCHESTRATOR_INTEGRATION.md) for the recommended orchestrator-based approach.**

This document provides low-level integration details for custom implementations that don't use the orchestrator.

---

## Overview

The MCP tools are **fully functional** and **tested**, but require configuration to be usable by the LLM. This guide shows how to integrate them when building the server, CLI, or any consumer of the executor system.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│ LLM (Claude, GPT, etc.)                                      │
│ - Sees tool definitions from BaseToolRegistry               │
│ - Makes tool calls: "ListMcpResources", "Mcp", etc.        │
└────────────────────────┬────────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────────┐
│ Orchestrator / Tool Execution Layer                          │
│ - Routes tool calls to appropriate executors                │
│ - Passes ExecutorConfig with mcpManager                     │
└────────────────────────┬────────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────────┐
│ MCP Tool Executors                                           │
│ - ListMcpResourcesToolExecutor                              │
│ - McpToolExecutor                                           │
│ - ReadMcpResourceToolExecutor                               │
│ ├─ Receive mcpManager from config                          │
│ └─ Execute operations on MCP servers                        │
└────────────────────────┬────────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────────┐
│ McpClientManager                                             │
│ - Manages connections to multiple MCP servers               │
│ - Discovers tools/resources                                 │
│ - Executes tool calls                                       │
└────────────────────────┬────────────────────────────────────┘
                         │
         ┌───────────────┼───────────────┐
         ▼               ▼               ▼
    ┌────────┐     ┌────────┐     ┌────────┐
    │ MCP    │     │ MCP    │     │ MCP    │
    │ Server │     │ Server │     │ Server │
    │   1    │     │   2    │     │   3    │
    └────────┘     └────────┘     └────────┘
```

---

## Integration Steps

### Step 1: Create McpClientManager

When initializing your server/CLI, create an `McpClientManager` instance:

```typescript
import { McpClientManager } from '@omniclaude/core';

// Create MCP manager
const mcpManager = new McpClientManager(debug);

// Configure MCP servers from user config
const mcpServers = {
  filesystem: {
    name: 'filesystem',
    command: 'npx',
    args: ['@modelcontextprotocol/server-filesystem', '/allowed/directory'],
    timeout: 30000,
  },
  github: {
    name: 'github',
    command: 'npx',
    args: ['@modelcontextprotocol/server-github'],
    env: {
      GITHUB_TOKEN: process.env.GITHUB_TOKEN,
    },
    timeout: 30000,
  },
};

// Register servers
for (const [name, config] of Object.entries(mcpServers)) {
  mcpManager.addServerConfig(name, config);
}

// Connect to all servers
await mcpManager.connectToAllServers();

// Discover tools from all servers
await mcpManager.discoverAll();
```

### Step 2: Pass mcpManager to ExecutorConfig

When creating the tool registry, include `mcpManager` in the config:

```typescript
import { ToolRegistry } from '@omniclaude/executors';

const toolRegistry = new ToolRegistry({
  workingDirectory: process.cwd(),
  allowNetwork: true,
  allowFileSystem: true,
  allowShellExecution: true,

  // MCP-specific configuration
  mcpManager: mcpManager,  // ← This is the key integration point!
});
```

### Step 3: Register MCP Tool Executors

Register the MCP tool executors with the registry:

```typescript
import {
  ListMcpResourcesToolExecutor,
  McpToolExecutor,
  ReadMcpResourceToolExecutor,
} from '@omniclaude/executors';

// Register MCP tools
toolRegistry.registerTool(
  new ListMcpResourcesToolExecutor(toolRegistry.config)
);

toolRegistry.registerTool(
  new McpToolExecutor(toolRegistry.config)
);

toolRegistry.registerTool(
  new ReadMcpResourceToolExecutor(toolRegistry.config)
);
```

### Step 4: Tool Definitions Already Available

The tool definitions are already in `BaseToolRegistry`, so the LLM will automatically see these tools:

```typescript
import { toolFactory } from '@omniclaude/core';

// Get all tools (includes MCP tools)
const allTools = toolFactory.getAllTools();
// Returns: [... Read, Write, Edit, ..., ListMcpResources, Mcp, ReadMcpResource, ...]
```

### Step 5: Cleanup on Shutdown

Don't forget to cleanup MCP connections when shutting down:

```typescript
process.on('SIGINT', async () => {
  await mcpManager.cleanup();
  process.exit(0);
});
```

---

## Complete Integration Example

Here's a complete minimal example:

```typescript
import { McpClientManager } from '@omniclaude/core';
import {
  ToolRegistry,
  ListMcpResourcesToolExecutor,
  McpToolExecutor,
  ReadMcpResourceToolExecutor,
} from '@omniclaude/executors';

async function setupMcpTools() {
  // 1. Create MCP manager
  const mcpManager = new McpClientManager(false);

  // 2. Configure servers from user's MCP configuration
  const mcpConfig = loadMcpConfig(); // Your config loading logic

  for (const [name, config] of Object.entries(mcpConfig.servers)) {
    mcpManager.addServerConfig(name, config);
  }

  // 3. Connect and discover
  await mcpManager.connectToAllServers();
  await mcpManager.discoverAll();

  // 4. Create tool registry with mcpManager
  const toolRegistry = new ToolRegistry({
    workingDirectory: process.cwd(),
    allowNetwork: true,
    allowFileSystem: true,
    allowShellExecution: true,
    mcpManager, // ← Pass mcpManager here
  });

  // 5. Register MCP executors
  toolRegistry.registerTool(new ListMcpResourcesToolExecutor(toolRegistry.config));
  toolRegistry.registerTool(new McpToolExecutor(toolRegistry.config));
  toolRegistry.registerTool(new ReadMcpResourceToolExecutor(toolRegistry.config));

  // 6. Register other tool executors...
  // toolRegistry.registerTool(new ReadToolExecutor(toolRegistry.config));
  // etc.

  return { mcpManager, toolRegistry };
}

// Usage in your server/CLI
const { mcpManager, toolRegistry } = await setupMcpTools();

// When LLM requests a tool:
const result = await toolRegistry.executeTool(
  'Mcp',
  {
    server: 'filesystem',
    tool: 'read_text_file',
    arguments: { path: '/path/to/file.txt' },
  },
  signal
);
// Returns: Tool result with file contents

// Cleanup
process.on('SIGINT', async () => {
  await mcpManager.cleanup();
  process.exit(0);
});
```

---

## Configuration File Format

Users can configure MCP servers via `.mcp.json` or in your app's config:

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["@modelcontextprotocol/server-filesystem", "/home/user/workspace"],
      "timeout": 30000
    },
    "github": {
      "command": "npx",
      "args": ["@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_TOKEN": "${GITHUB_TOKEN}"
      },
      "timeout": 30000
    },
    "slack": {
      "command": "npx",
      "args": ["@modelcontextprotocol/server-slack"],
      "env": {
        "SLACK_BOT_TOKEN": "${SLACK_BOT_TOKEN}"
      },
      "timeout": 30000
    }
  }
}
```

---

## What the LLM Sees

When properly integrated, the LLM will see these tools in its tool list:

### 1. ListMcpResources
```
List available MCP resources from configured MCP servers

Parameters:
- server (optional): Filter by specific server name

Returns: List of resources with URI, name, description, MIME type
```

### 2. Mcp
```
Execute MCP tool from connected server

Parameters:
- server (required): MCP server name
- tool (required): Tool name to invoke
- arguments (optional): Tool-specific parameters

Returns: Tool execution result
```

### 3. ReadMcpResource
```
Read a specific MCP resource

Parameters:
- server (required): MCP server name
- uri (required): Resource URI to read

Returns: Resource content (text, binary, or structured)
```

---

## Example LLM Interaction

Once integrated, the LLM can use MCP tools like this:

**User**: "List the files in my workspace"

**LLM**: I'll use the MCP filesystem server to list your workspace files.
```json
{
  "tool": "Mcp",
  "parameters": {
    "server": "filesystem",
    "tool": "list_directory",
    "arguments": {
      "path": "/home/user/workspace"
    }
  }
}
```

**System**: *(Executes tool via McpToolExecutor → McpClientManager → Filesystem MCP Server)*

**Result**:
```
=== MCP Tool Result ===
Server: filesystem
Tool: list_directory

[DIR] src
[DIR] tests
[FILE] package.json
[FILE] README.md
[FILE] tsconfig.json
```

**LLM**: "I can see your workspace has a `src` directory, `tests` directory, and configuration files like package.json and tsconfig.json."

---

## Testing Your Integration

Use the integration tests as a reference:

```bash
cd packages/executors
npm test -- mcp-tools-integration
```

These tests show exactly how the MCP tools work end-to-end with a real MCP server.

---

## Troubleshooting

### "MCP manager not available" error
**Cause**: `mcpManager` not passed in ExecutorConfig
**Fix**: Add `mcpManager` to the config when creating ToolRegistry

### "MCP server not connected" error
**Cause**: Server not connected before tool execution
**Fix**: Call `await mcpManager.connectToAllServers()` during initialization

### "Method not found" error
**Cause**: MCP server doesn't support the requested method
**Fix**: Tools handle this gracefully (e.g., ListMcpResources returns empty list)

### "Tool not found" error
**Cause**: Requested tool doesn't exist on the MCP server
**Fix**: Use ListMcpResources to discover available tools first

---

## Summary

**Integration Requirements:**
1. ✅ Create `McpClientManager` instance
2. ✅ Configure and connect to MCP servers
3. ✅ Pass `mcpManager` in `ExecutorConfig`
4. ✅ Register MCP tool executors

**What's Already Done:**
- ✅ Tool definitions in BaseToolRegistry (LLM sees them)
- ✅ Tool executors implemented and tested
- ✅ MCP infrastructure fully functional

**Result:**
Once integrated, the LLM can seamlessly use MCP servers to access external tools and resources, expanding its capabilities far beyond the built-in 25 base tools!

---

**Need Help?** See `MCP_INTEGRATION_TEST_RESULTS.md` for working test examples.
