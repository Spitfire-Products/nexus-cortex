# MCP Orchestrator Integration - Complete Guide

**Date**: 2025-11-03
**Status**: ✅ PRODUCTION READY
**Integration**: Phase 2.9 Complete with full orchestrator integration

---

## Overview

The MCP (Model Context Protocol) system is **fully integrated** into OmniClaude V4's orchestrator. This document describes how MCP works within the complete architecture, from configuration to LLM execution.

---

## Architecture: Orchestrator-Driven MCP

```
┌─────────────────────────────────────────────────────────────┐
│ LLM (Claude, GPT, Gemini, etc.)                             │
│ - Sees tool definitions from toolFactory                    │
│ - Makes tool calls: "ListMcpResources", "Mcp", etc.        │
└────────────────────────┬────────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────────┐
│ OmniClaudeOrchestrator                                       │
│ ├─ Creates McpClientManager during initialization           │
│ ├─ Connects to MCP servers on session creation             │
│ ├─ Provides getMcpManager() to ToolRegistry                │
│ ├─ Manages lifecycle (connect/disconnect)                  │
│ └─ Handles cleanup on session end                          │
└────────────────────────┬────────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────────┐
│ ToolRegistry                                                 │
│ ├─ Receives mcpManager from orchestrator                   │
│ ├─ Passes mcpManager to MCP tool executors                 │
│ └─ Routes tool calls to appropriate executors              │
└────────────────────────┬────────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────────┐
│ MCP Tool Executors                                           │
│ - ListMcpResourcesToolExecutor                              │
│ - McpToolExecutor                                           │
│ - ReadMcpResourceToolExecutor                               │
│ ├─ Receive mcpManager from ToolRegistry config             │
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

## Integration Steps (Production Usage)

### Step 1: Configure OmniClaudeOrchestrator

When creating the orchestrator, enable MCP and configure servers:

```typescript
import { OmniClaudeOrchestrator } from '@omniclaude/core';
import { AdapterRegistry } from '@omniclaude/core';

// Create adapter registry (required)
const adapterRegistry = new AdapterRegistry();

// Configure orchestrator with MCP enabled
const orchestrator = new OmniClaudeOrchestrator(adapterRegistry, {
  // Enable MCP integration
  enableMcp: true,

  // Configure MCP servers
  mcpServers: {
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
  },

  // Other orchestrator config
  debug: true,
});
```

### Step 2: Create Session

When creating a session, the orchestrator automatically:
1. Connects to all configured MCP servers
2. Discovers tools and resources from each server
3. Makes McpClientManager available to tool executors

```typescript
// Create session (MCP connects automatically)
const session = await orchestrator.createSession(
  '/path/to/project',
  'claude-sonnet-4-5'
);

// Session is ready - MCP tools are now available to the LLM
```

### Step 3: Access MCP Manager (if needed)

The orchestrator provides public methods to access MCP state:

```typescript
// Check if MCP is enabled
const mcpEnabled = orchestrator.isMcpEnabled();
// Returns: true

// Get MCP manager (for advanced usage)
const mcpManager = orchestrator.getMcpManager();
// Returns: McpClientManager instance

// Get server info
const serverInfo = orchestrator.getMcpServerInfo();
// Returns: [
//   { name: 'filesystem', status: 'connected', toolCount: 14, resourceCount: 0 },
//   { name: 'github', status: 'connected', toolCount: 8, resourceCount: 5 }
// ]
```

### Step 4: Tool Registry Configuration

The ToolRegistry receives the MCP manager from the orchestrator:

```typescript
import { ToolRegistry } from '@omniclaude/executors';

// Get MCP manager from orchestrator
const mcpManager = orchestrator.getMcpManager();

// Create tool registry with MCP manager
const toolRegistry = new ToolRegistry({
  workingDirectory: process.cwd(),
  allowNetwork: true,
  allowFileSystem: true,
  allowShellExecution: true,

  // Pass MCP manager from orchestrator
  mcpManager: mcpManager,
});

// Register MCP tool executors
toolRegistry.registerTool(new ListMcpResourcesToolExecutor(toolRegistry.config));
toolRegistry.registerTool(new McpToolExecutor(toolRegistry.config));
toolRegistry.registerTool(new ReadMcpResourceToolExecutor(toolRegistry.config));

// Register other tools...
```

### Step 5: Cleanup on Shutdown

The orchestrator handles MCP cleanup automatically:

```typescript
// When session ends or application shuts down
await orchestrator.cleanup();

// This will:
// 1. Disconnect from all MCP servers
// 2. Clean up resources
// 3. Close all connections
```

---

## Configuration Details

### OrchestratorConfig Interface

```typescript
export interface OrchestratorConfig {
  // ... existing fields

  /** Enable MCP integration (Phase 2.9) */
  enableMcp?: boolean;

  /** MCP server configurations (Phase 2.9) */
  mcpServers?: Record<string, McpServerConfig>;
}
```

### McpServerConfig Format

```typescript
export interface McpServerConfig {
  /** Unique server name */
  name: string;

  /** Command to execute (e.g., 'npx', 'node', 'python') */
  command?: string;

  /** Command arguments */
  args?: string[];

  /** Environment variables */
  env?: Record<string, string>;

  /** Working directory */
  cwd?: string;

  /** Connection timeout in milliseconds (default: 30000) */
  timeout?: number;
}
```

---

## Complete Integration Example

Here's a complete minimal example showing orchestrator-based MCP integration:

```typescript
import { OmniClaudeOrchestrator, AdapterRegistry } from '@omniclaude/core';
import {
  ToolRegistry,
  ListMcpResourcesToolExecutor,
  McpToolExecutor,
  ReadMcpResourceToolExecutor,
} from '@omniclaude/executors';

async function main() {
  // 1. Create adapter registry
  const adapterRegistry = new AdapterRegistry();

  // 2. Create orchestrator with MCP enabled
  const orchestrator = new OmniClaudeOrchestrator(adapterRegistry, {
    enableMcp: true,
    mcpServers: {
      filesystem: {
        name: 'filesystem',
        command: 'npx',
        args: ['@modelcontextprotocol/server-filesystem', process.cwd()],
        timeout: 30000,
      },
    },
    debug: true,
  });

  // 3. Create session (connects to MCP automatically)
  const session = await orchestrator.createSession(
    process.cwd(),
    'claude-sonnet-4-5'
  );

  console.log('Session created:', session.sessionId);

  // 4. Get MCP manager from orchestrator
  const mcpManager = orchestrator.getMcpManager();

  // 5. Create tool registry with MCP manager
  const toolRegistry = new ToolRegistry({
    workingDirectory: process.cwd(),
    allowNetwork: true,
    allowFileSystem: true,
    allowShellExecution: true,
    mcpManager,
  });

  // 6. Register MCP executors
  toolRegistry.registerTool(new ListMcpResourcesToolExecutor(toolRegistry.config));
  toolRegistry.registerTool(new McpToolExecutor(toolRegistry.config));
  toolRegistry.registerTool(new ReadMcpResourceToolExecutor(toolRegistry.config));

  // 7. Check MCP status
  const serverInfo = orchestrator.getMcpServerInfo();
  console.log('MCP Servers:', serverInfo);

  // 8. Execute MCP tool (simulating LLM call)
  const result = await toolRegistry.executeTool(
    'Mcp',
    {
      server: 'filesystem',
      tool: 'list_allowed_directories',
      arguments: {},
    },
    new AbortController().signal
  );

  console.log('Tool Result:', result.returnDisplay);

  // 9. Cleanup on shutdown
  await orchestrator.cleanup();
}

main().catch(console.error);
```

---

## Example LLM Workflow

Once integrated, the LLM can use MCP tools seamlessly:

**User**: "List the files in my project directory"

**LLM** (thinks): I'll use the MCP filesystem server to list the directory.

**LLM** (calls tool):
```json
{
  "tool": "Mcp",
  "parameters": {
    "server": "filesystem",
    "tool": "list_directory",
    "arguments": {
      "path": "/path/to/project"
    }
  }
}
```

**System** (executes):
1. ToolRegistry receives tool call
2. Routes to McpToolExecutor
3. McpToolExecutor gets mcpManager from config
4. Calls mcpManager.callTool('filesystem', 'list_directory', {...})
5. McpClientManager forwards to filesystem MCP server
6. Returns formatted result

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

**LLM** (responds): "Your project directory contains a `src` folder, `tests` folder, and configuration files."

---

## Lifecycle Management

### During Initialization
```typescript
constructor(adapterRegistry, config) {
  // ...
  if (config.enableMcp && config.mcpServers) {
    this.mcpManager = new McpClientManager(config.debug || false);

    for (const [name, serverConfig] of Object.entries(config.mcpServers)) {
      this.mcpManager.addServerConfig(name, serverConfig);
    }
  }
}
```

### During Session Creation
```typescript
async createSession(projectPath, initialModelId) {
  // ...
  if (this.mcpManager) {
    await this.mcpManager.connectToAllServers();
    await this.mcpManager.discoverAll();

    const serverInfo = this.mcpManager.getServerInfo();
    // Log connection status
  }
  // ...
}
```

### During Cleanup
```typescript
async cleanup() {
  if (this.mcpManager) {
    await this.mcpManager.cleanup();
  }
}
```

---

## Testing

### Integration Tests

All 10 MCP integration tests pass with a real filesystem MCP server:

```bash
cd packages/executors
npm test -- mcp-tools-integration --run
```

**Test Results**: 10/10 passing ✅

### Tests Include:
- ListMcpResourcesTool: resource listing and filtering
- McpTool: tool execution with various parameters
- ReadMcpResourceTool: resource reading and validation
- Full workflow: discover → execute → read
- Error handling: non-existent servers/tools
- Abort signal support

---

## Troubleshooting

### "MCP manager not available" error
**Cause**: MCP not enabled in orchestrator config
**Fix**: Set `enableMcp: true` in OrchestratorConfig

### "MCP server not connected" error
**Cause**: Server failed to connect during session creation
**Fix**: Check server configuration, command, and arguments

### "Method not found" error
**Cause**: MCP server doesn't support the requested method
**Fix**: Tools handle this gracefully (e.g., ListMcpResources returns empty list)

### "Tool not found" error
**Cause**: Requested tool doesn't exist on the MCP server
**Fix**: Use ListMcpResources or check getMcpServerInfo() to see available tools

---

## Performance Considerations

### Connection Timing
- MCP servers connect during session creation
- Connection is asynchronous and non-blocking
- Failed connections don't prevent session creation

### Discovery Timing
- Tools and resources are discovered once during connection
- Discovery results are cached in McpClientManager
- No re-discovery needed for subsequent tool calls

### Execution Timing
- Tool calls are executed via stdio transport
- Typical execution time: 50-500ms
- Supports abort signals for cancellation

---

## Security Considerations

### File System Access
- Filesystem MCP server only accesses allowed directories
- Configured via args: `['@modelcontextprotocol/server-filesystem', '/allowed/dir']`
- No access outside allowed directories

### Environment Variables
- Sensitive values (API keys, tokens) passed via env config
- Not logged in debug mode
- Stored only in memory

### Command Execution
- MCP servers run as child processes
- Isolated from main application
- Cleanup on disconnect

---

## Summary

**Integration Complete ✅**
1. ✅ McpClientManager integrated into OmniClaudeOrchestrator
2. ✅ Automatic connection during session creation
3. ✅ MCP manager provided to ToolRegistry
4. ✅ Tool executors access mcpManager from config
5. ✅ Automatic cleanup on shutdown
6. ✅ All 10 integration tests passing
7. ✅ Production-ready implementation

**What's Working:**
- Orchestrator creates and manages McpClientManager
- MCP servers connect automatically on session creation
- Tool executors receive mcpManager from registry config
- LLM can seamlessly use all MCP tools
- Lifecycle properly managed (connect → execute → cleanup)

**Result:**
The LLM can now access 21 base tools + unlimited MCP server tools, expanding capabilities far beyond the initial tool set!

---

**Need Help?** See `MCP_INTEGRATION_TEST_RESULTS.md` for test examples and `MCP_INTEGRATION_GUIDE.md` for low-level details.
