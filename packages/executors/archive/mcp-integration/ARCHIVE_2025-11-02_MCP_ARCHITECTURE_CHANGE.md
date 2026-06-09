# MCP Architecture Change - Dynamic Tool Registration

**Date**: 2025-11-03
**Breaking Change**: Yes
**Status**: Complete

---

## What Changed?

The MCP integration was refactored from a **wrapper pattern** to **dynamic tool registration** to match Claude Code's architecture.

### OLD Architecture (Removed)

**3 Wrapper Tools**:
- `ListMcpResources` - List resources from MCP servers
- `Mcp` - Execute MCP tool calls (takes server, tool, arguments)
- `ReadMcpResource` - Read MCP resources

**Problem**: LLM had to know about MCP servers and route through wrapper tools.

**Example Call**:
```json
{
  "tool": "Mcp",
  "parameters": {
    "server": "filesystem",
    "tool": "read_file",
    "arguments": {
      "path": "/file.txt"
    }
  }
}
```

### NEW Architecture (Current)

**Dynamic Registration**:
- Each MCP tool becomes a separate tool in the registry
- filesystem server's "read_file" → Tool named "read_file"
- github server's "create_issue" → Tool named "create_issue"

**Benefit**: LLM sees each MCP tool as a first-class tool with its own schema.

**Example Call**:
```json
{
  "tool": "read_file",
  "parameters": {
    "path": "/file.txt"
  }
}
```

---

## Files Changed

### Added
- `packages/executors/src/implementations/mcp/DiscoveredMcpTool.ts`
- `packages/executors/DYNAMIC_MCP_INTEGRATION.md`
- `packages/executors/MCP_ARCHITECTURE_CHANGE.md` (this file)

### Removed
- `packages/executors/src/implementations/mcp/ListMcpResourcesTool.ts`
- `packages/executors/src/implementations/mcp/McpTool.ts`
- `packages/executors/src/implementations/mcp/ReadMcpResourceTool.ts`

### Modified
- `packages/core/src/orchestrator/OmniClaudeOrchestrator.ts` - Added `getMcpToolDeclarations()`
- `packages/core/src/tools/toolDefinitions.ts` - Removed 3 wrapper tool definitions
- `packages/core/src/tools/registries/BaseToolRegistry.ts` - Removed 3 wrapper tool definitions
- `packages/executors/src/implementations/mcp/index.ts` - Updated exports
- Integration test files (to be updated)

---

## Migration Guide

### Before (OLD)
```typescript
import { ListMcpResourcesToolExecutor, McpToolExecutor, ReadMcpResourceToolExecutor } from '@omniclaude/executors';

// Register wrapper tools
toolRegistry.registerTool(new ListMcpResourcesToolExecutor(config));
toolRegistry.registerTool(new McpToolExecutor(config));
toolRegistry.registerTool(new ReadMcpResourceToolExecutor(config));

// LLM calls wrapper
{
  "tool": "Mcp",
  "parameters": {
    "server": "filesystem",
    "tool": "read_file",
    "arguments": {...}
  }
}
```

### After (NEW)
```typescript
import { DiscoveredMcpToolExecutor } from '@omniclaude/executors';

// Get tool declarations from orchestrator
const toolDeclarations = orchestrator.getMcpToolDeclarations();

// Register each MCP tool individually
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
}

// LLM calls tool directly
{
  "tool": "read_file",
  "parameters": {...}
}
```

---

## Why This Change?

### 1. Matches Claude Code Architecture
The wrapper pattern was our initial implementation, but Claude Code (Gemini CLI) uses dynamic registration. This makes our implementation compatible and easier to understand for those familiar with Gemini CLI.

### 2. Better LLM Experience
The LLM sees each tool with its actual name, description, and parameter schema from the MCP server. No need to understand the wrapper layer.

### 3. Cleaner Tool Registry
Each tool is a first-class citizen. The tool list naturally extends with MCP tools.

### 4. Simpler Execution
No routing logic needed - each tool executor knows exactly what to do.

### 5. Name Collision Control
Can easily namespace tools: `filesystem__read_file` vs `github__read_file` if both servers expose a "read_file" tool.

---

## Implementation Details

### DiscoveredMcpToolExecutor

Each instance wraps one MCP tool from one server:

```typescript
class DiscoveredMcpToolExecutor extends BaseTool {
  constructor(
    serverName: string,       // e.g., "filesystem"
    serverToolName: string,   // e.g., "read_file"
    toolDeclaration: Tool,    // MCP tool metadata
    mcpManagerGetter: () => McpClientManager | undefined
  ) {
    // Creates a tool executor with the MCP tool's schema
  }

  async execute(params, signal) {
    // Calls mcpManager.callTool(serverName, toolName, params)
  }
}
```

### Dynamic Registration Flow

1. Orchestrator connects to MCP servers during session creation
2. MCP servers discover their tools (e.g., filesystem server has 14 tools)
3. Consumer calls `orchestrator.getMcpToolDeclarations()` to get list
4. For each declaration, create a `DiscoveredMcpToolExecutor`
5. Register executor with ToolRegistry
6. LLM now sees the tool in its tool list

---

## Testing

The integration tests need to be rewritten to test dynamic registration instead of wrapper tools.

### Old Test Pattern (INVALID)
```typescript
it('should execute Mcp tool', async () => {
  const result = await executor.execute({
    server: 'filesystem',
    tool: 'list_directory',
    arguments: { path: testDir }
  }, signal);
  // ...
});
```

### New Test Pattern (VALID)
```typescript
it('should execute dynamically registered MCP tool', async () => {
  // Register tool
  const toolDecl = orchestrator.getMcpToolDeclarations()
    .find(t => t.toolName === 'list_directory');

  const tool = new DiscoveredMcpToolExecutor(
    toolDecl.serverName,
    toolDecl.toolName,
    toolDecl,
    () => mcpManager
  );

  toolRegistry.registerTool(tool);

  // Execute directly
  const result = await toolRegistry.executeTool(
    'list_directory',
    { path: testDir },
    signal
  );
  // ...
});
```

---

## Documentation

### Primary Documentation
- **`DYNAMIC_MCP_INTEGRATION.md`** - Complete integration guide
- **`MCP_ORCHESTRATOR_INTEGRATION.md`** - Orchestrator-level details
- **`MCP_ARCHITECTURE_CHANGE.md`** (this file) - Migration guide

### Deprecated Documentation
- `MCP_INTEGRATION_GUIDE.md` - References old wrapper pattern (kept for reference)
- `MCP_INTEGRATION_TEST_RESULTS.md` - Old test results (to be updated)
- `PHASE_2.9_SUMMARY.md` - Old completion summary (to be updated)

---

## Benefits Summary

✅ **Better LLM Integration**: Tools appear naturally in tool list
✅ **Claude Code Compatible**: Same architecture as reference implementation
✅ **Cleaner Code**: No wrapper indirection
✅ **Flexible Naming**: Can namespace tools to avoid collisions
✅ **Easier Debugging**: Each tool is isolated and testable
✅ **Scalability**: Adding new MCP servers automatically adds their tools

---

## Status

**Implementation**: ✅ Complete
**Documentation**: ✅ Complete
**Testing**: ⏳ Needs Update
**Production Ready**: ⏳ After testing

**Next Steps**:
1. Update integration tests
2. Test with real MCP servers
3. Verify tool execution end-to-end
4. Update MASTER_PLAN.md to reflect architecture change

---

**Questions?** See `DYNAMIC_MCP_INTEGRATION.md` for complete integration examples.
