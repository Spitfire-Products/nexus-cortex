# MCP Management Tools

**Location**: `packages/core/src/tools/mcp-management/`
**Phase**: 2.6 - MCP Model Management
**Status**: ✅ Complete (7 tools)

## Overview

The MCP Management Tools enable **autonomous model control** of Model Context Protocol (MCP) servers. Instead of requiring users to manually configure MCP servers, AI models can discover, enable, configure, and manage their own tool ecosystem during conversations.

This implements a **progressive tool discovery** pattern where models start with minimal tools and dynamically expand their capabilities based on task requirements.

---

## Architecture Philosophy

### Two-Tier System

**Tier 1: Auto-Injection (Phase 2.5)**
- Reads `MCP_CONFIG.md` (project or global)
- Auto-connects to enabled servers on session start
- Injects discovered tools into model's available tools

**Tier 2: Management Tools (Phase 2.6)**
- 7 tools for autonomous MCP server control
- Models discover and enable servers on-demand
- Models configure server parameters during conversation
- Models initialize tailored configurations for projects

### Design Principles

1. **Opt-in by Default**: No MCP_CONFIG.md = no auto-injection
2. **Model Autonomy**: Models can manage their own tools
3. **Progressive Disclosure**: Start minimal, expand as needed
4. **User Transparency**: All changes visible in MCP_CONFIG.md
5. **Human-Readable Config**: Markdown format, not JSON
6. **Discoverable Ecosystem**: Community registry of available servers

---

## The 7 MCP Management Tools

### 1. `list_available_mcp_servers`

**Purpose**: Browse the community registry of available MCP servers

**Input**:
```typescript
{
  category?: 'filesystem' | 'database' | 'browser' | 'api' | 'development' | 'productivity' | 'custom',
  verified_only?: boolean  // default: true
}
```

**Output**:
- List of available servers with:
  - Name, display name, description
  - Category and capabilities
  - Required environment variables
  - Installation command
  - Verification status
  - Connection status (if already enabled)

**Use Case**: "What MCP servers are available for database work?"

---

### 2. `search_mcp_servers`

**Purpose**: Search registry by keyword

**Input**:
```typescript
{
  query: string  // Search term
}
```

**Output**:
- Matching servers ranked by relevance
- Same details as `list_available_mcp_servers`

**Use Case**: "Find MCP servers related to 'web scraping'"

---

### 3. `get_mcp_config`

**Purpose**: View current MCP configuration

**Input**:
```typescript
{
  scope?: 'project' | 'global' | 'merged'  // default: merged
}
```

**Output**:
- Enabled servers with their configuration
- Disabled/available servers
- Connected server status
- Tool counts per server
- Config file location

**Use Case**: "What MCP servers are currently enabled?"

---

### 4. `enable_mcp_server`

**Purpose**: Enable an MCP server by adding it to MCP_CONFIG.md

**Input**:
```typescript
{
  server_name: string,      // e.g., 'filesystem', 'puppeteer'
  description?: string,     // Override default description
  args?: string[],          // Command arguments (e.g., workspace path)
  env?: Record<string, string>,  // Environment variables
  auto_start?: boolean,     // default: true
  timeout?: number          // Connection timeout (ms)
}
```

**Output**:
- Success/failure status
- Config update confirmation
- Required environment variables
- Next steps

**Use Case**: "Enable the PostgreSQL MCP server with DATABASE_URL=..."

**Important**:
- Writes to `MCP_CONFIG.md`
- Server connects on next session (or manual reconnect)
- Creates config file if it doesn't exist

---

### 5. `disable_mcp_server`

**Purpose**: Disable an MCP server

**Input**:
```typescript
{
  server_name: string
}
```

**Output**:
- Success/failure status
- Config update confirmation
- Tools removed count

**Use Case**: "Disable the puppeteer server, we don't need browser automation"

---

### 6. `configure_mcp_server`

**Purpose**: Modify settings for an existing enabled server

**Input**:
```typescript
{
  server_name: string,
  args?: string[],          // Update command arguments
  env?: Record<string, string>,  // Update environment
  auto_start?: boolean,     // Change auto-start behavior
  timeout?: number          // Change timeout
}
```

**Output**:
- Updated configuration
- Requires reconnection notice

**Use Case**: "Update the filesystem server to use a different workspace directory"

---

### 7. `init_mcp_config`

**Purpose**: Analyze project and create tailored MCP_CONFIG.md

**Input**:
```typescript
{
  scope?: 'auto' | 'global' | string,  // default: 'auto' (current dir)
  servers?: string[],        // Manual override (skip detection)
  include_optional?: boolean,  // Include optional servers
  dry_run?: boolean          // Preview without creating
}
```

**Output**:
- Project analysis (type, features, detected files)
- Recommended servers with priorities (essential/recommended/optional)
- Reasoning for each recommendation
- Created config path
- Server count

**Project Detection**:
- **Node.js**: package.json, node_modules
- **Python**: requirements.txt, pyproject.toml, setup.py
- **Rust**: Cargo.toml
- **Go**: go.mod
- **TypeScript**: tsconfig.json
- **Databases**: .sql files, docker-compose with db
- **Web**: public/, static/ directories
- **Git**: .git directory
- **Testing**: test/, tests/, __tests__

**Server Recommendations**:

| Priority | Servers | Conditions |
|----------|---------|------------|
| Essential | filesystem | Always recommended for code execution |
| Recommended | git | If .git directory exists |
| Recommended | puppeteer | If web project or Node.js |
| Optional | postgres | If database features detected |
| Optional | sqlite | If database features detected |
| Optional | brave-search | If `include_optional: true` |

**Use Cases**:
- "Initialize MCP configuration for this project"
- "Create a global MCP config with filesystem and git servers"
- "Preview what MCP servers would be recommended for this project"

---

## File Structure

```
packages/core/src/tools/mcp-management/
├── README.md                        # This file
├── index.ts                         # Exports all management tools
├── ListAvailableMcpServers.ts      # Tool #1: List servers
├── SearchMcpServers.ts             # Tool #2: Search servers
├── GetMcpConfig.ts                 # Tool #3: View config
├── EnableMcpServer.ts              # Tool #4: Enable server
├── DisableMcpServer.ts             # Tool #5: Disable server
├── ConfigureMcpServer.ts           # Tool #6: Configure server
└── InitMcpConfig.ts                # Tool #7: Initialize config
```

---

## Integration Points

### 1. CortexOrchestrator

**File**: `packages/core/src/orchestrator/CortexOrchestrator.ts`

**Import** (lines 55-63):
```typescript
import {
  ListAvailableMcpServers,
  SearchMcpServers,
  GetMcpConfig,
  EnableMcpServer,
  DisableMcpServer,
  ConfigureMcpServer,
  InitMcpConfig
} from '../tools/mcp-management/index.js';
```

**Registration** (lines 1968-1976):
```typescript
private getMcpManagementTools(): any[] {
  if (!this.mcpConfigManager || !this.getMcpServerRegistry()) {
    return [];
  }

  return [
    ListAvailableMcpServers.toCanonicalTool(),
    SearchMcpServers.toCanonicalTool(),
    GetMcpConfig.toCanonicalTool(),
    EnableMcpServer.toCanonicalTool(),
    DisableMcpServer.toCanonicalTool(),
    ConfigureMcpServer.toCanonicalTool(),
    InitMcpConfig.getToolDefinition()
  ] as any[];
}
```

**Detection** (lines 1608-1617):
```typescript
const mcpManagementToolNames = [
  'list_available_mcp_servers',
  'search_mcp_servers',
  'get_mcp_config',
  'enable_mcp_server',
  'disable_mcp_server',
  'configure_mcp_server',
  'init_mcp_config'
];
const isMcpManagementTool = mcpManagementToolNames.includes(toolUse.name);
```

**Execution** (lines 1687-1748):
```typescript
switch (toolUse.name) {
  case 'list_available_mcp_servers':
    mcpManagementResult = await ListAvailableMcpServers.execute(...);
    break;
  // ... other tools
  case 'init_mcp_config':
    mcpManagementResult = await InitMcpConfig.execute(...);
    break;
}
```

### 2. McpServerRegistry

**File**: `packages/core/src/mcp/McpServerRegistry.ts`

Provides the community registry data that management tools query. Contains:
- Verified MCP servers from @modelcontextprotocol
- Community-contributed servers
- Server metadata (capabilities, requirements, commands)

### 3. McpConfigManager

**File**: `packages/core/src/mcp/McpConfigManager.ts`

Handles MCP_CONFIG.md file operations:
- Reading/writing config files
- Parsing markdown format
- Merging project + global configs
- Validating server configurations

### 4. McpClientManager

**File**: `packages/core/src/mcp/McpClientManager.ts`

Runtime MCP server connection manager:
- Connects to enabled servers
- Discovers available tools
- Routes tool calls to appropriate servers
- Manages server lifecycle

---

## Usage Examples

### Example 1: Model Discovers and Enables Git Server

**Turn 1** - Model wants version control:
```json
{
  "name": "list_available_mcp_servers",
  "input": {
    "category": "development"
  }
}
```

**Result**: Model sees git server is available

**Turn 2** - Model enables it:
```json
{
  "name": "enable_mcp_server",
  "input": {
    "server_name": "git",
    "auto_start": true
  }
}
```

**Result**: MCP_CONFIG.md updated, git server will connect next session

---

### Example 2: Project Initialization

**Turn 1** - Model analyzes project:
```json
{
  "name": "init_mcp_config",
  "input": {
    "scope": "auto",
    "dry_run": true
  }
}
```

**Result**:
```
# MCP Config Analysis (Dry Run)

## Project Analysis
Type: nodejs, typescript
Features: source-code, testing, git, filesystem

## Recommended Servers
🔴 filesystem (essential) - Essential for file operations and code execution
🟡 git (recommended) - Git repository detected
⚪ puppeteer (optional) - Web project detected
```

**Turn 2** - Model confirms and creates:
```json
{
  "name": "init_mcp_config",
  "input": {
    "scope": "auto",
    "dry_run": false
  }
}
```

**Result**: MCP_CONFIG.md created with filesystem and git servers enabled

---

### Example 3: Database Work

**Turn 1** - Search for database servers:
```json
{
  "name": "search_mcp_servers",
  "input": {
    "query": "database"
  }
}
```

**Turn 2** - Enable PostgreSQL:
```json
{
  "name": "enable_mcp_server",
  "input": {
    "server_name": "postgres",
    "env": {
      "DATABASE_URL": "postgresql://user:pass@localhost:5432/mydb"
    },
    "auto_start": true
  }
}
```

---

## Configuration File Format

**File**: `MCP_CONFIG.md` (project root or `~/.cortex/`)

**Example**:
```markdown
# MCP Server Configuration

## Enabled Servers

### filesystem
**Status**: ✅ Enabled
**Description**: File system operations (read, write, search files)
**Command**: `npx -y @modelcontextprotocol/server-filesystem`
**Args**: `/home/user/project`
**Auto-start**: true

### git
**Status**: ✅ Enabled
**Description**: Git version control operations
**Command**: `npx -y @modelcontextprotocol/server-git`
**Auto-start**: true

## Available Servers

### puppeteer
**Status**: ⏸️ Available
**Description**: Browser automation and web scraping
**Command**: `npx -y @modelcontextprotocol/server-puppeteer`
**Auto-start**: false

---

**Notes**:
- Enabled servers auto-start when session begins
- Use enable_mcp_server tool to add more servers
- Edit this file directly to customize configuration
```

---

## Common Workflows

### Workflow 1: New Project Setup

1. Model starts conversation with minimal tools
2. User asks: "Can you help set up database migrations?"
3. Model realizes it needs database tools
4. Model calls `list_available_mcp_servers` with category="database"
5. Model enables `postgres` server with user's DATABASE_URL
6. Model reconnects (or waits for next session)
7. Model now has postgres tools available

### Workflow 2: Project Discovery

1. Model asked to work on unfamiliar project
2. Model calls `init_mcp_config` with `dry_run: true`
3. Reviews detected project characteristics
4. Calls `init_mcp_config` with `dry_run: false` to enable recommended tools
5. Model now has project-appropriate tools

### Workflow 3: Tool Cleanup

1. Model finishes task requiring special tools
2. Model calls `disable_mcp_server` to remove temporary tools
3. Keeps config lean for better performance

---

## Benefits Over Static Configuration

### Traditional Approach (Static)
```json
// claude_desktop_config.json
{
  "mcpServers": {
    "filesystem": { ... },
    "git": { ... },
    "postgres": { ... },
    "puppeteer": { ... },
    "sqlite": { ... }
    // ALL tools loaded upfront (100+ tools)
  }
}
```

**Problems**:
- Context pollution: Too many tool definitions
- Slower inference: Model must consider all tools
- Higher costs: More tokens per request
- No adaptation: Same tools for every task

### Nexus Cortex Approach (Dynamic)
```markdown
# MCP_CONFIG.md (initially)
No enabled servers
```

**Benefits**:
- Start minimal: Only essential tools
- Progressive expansion: Add tools as needed
- Model autonomy: AI discovers capabilities
- Task-specific: Right tools for each job
- Cost efficient: Fewer tokens wasted on unused tool definitions

---

## Token Efficiency

### Example: Database Migration Task

**Static Approach**:
- Tools loaded: 127 (all tools from all servers)
- Tool definition tokens: ~25,000 tokens
- Used tools: 4 (postgres tools)
- Wasted tokens: ~24,000 (96% waste)

**Nexus Cortex Approach**:
- Initial tools: 25 (base + MCP management)
- Model calls `enable_mcp_server` for postgres
- Tools after enable: 37 (base + MCP management + postgres)
- Tool definition tokens: ~7,400 tokens
- Used tools: 4 (postgres tools)
- Wasted tokens: ~6,600 (89% vs 96%)

**Savings**: ~17,600 tokens per request (70% reduction)

---

## Testing & Validation

### Manual Testing

1. **Dry Run Test**:
```bash
# Call init_mcp_config with dry_run: true
# Verify recommendations make sense
```

2. **Enable/Disable Cycle**:
```bash
# Enable a server
# Verify MCP_CONFIG.md created
# Disable server
# Verify MCP_CONFIG.md updated
```

3. **Search/Discovery**:
```bash
# Search for "browser"
# Verify puppeteer appears
# List by category="browser"
# Verify same result
```

### Integration Testing

See: `packages/core/src/orchestrator/__tests__/mcp-config-integration.test.ts`

---

## Future Enhancements

### Planned Features

1. **Auto-reconnect**: When model enables server, reconnect immediately
2. **Server Marketplace**: Community-contributed server registry
3. **Usage Analytics**: Track which servers/tools are most useful
4. **Smart Recommendations**: ML-based server suggestions
5. **Dependency Resolution**: Auto-enable required servers
6. **Server Versions**: Support multiple versions of same server

### Possible Extensions

- `reload_mcp_servers` - Reconnect without restarting session
- `test_mcp_server` - Validate server works before enabling
- `export_mcp_config` - Share config with team
- `import_mcp_config` - Load config from URL/file

---

## Troubleshooting

### Issue: Server enabled but no tools appearing

**Cause**: Server not connected yet
**Solution**: Restart session or implement auto-reconnect

### Issue: `enable_mcp_server` fails with "not found"

**Cause**: Server not in registry
**Solution**: Use `list_available_mcp_servers` to see available servers

### Issue: MCP_CONFIG.md exists but tools not loading

**Cause**: MCP auto-injection disabled
**Solution**: Check OrchestratorConfig.mcpAutoInject setting

### Issue: init_mcp_config recommends wrong servers

**Cause**: Project detection heuristics need tuning
**Solution**: Use manual mode with `servers: [...]` parameter

---

## Related Documentation

- **MCP Protocol**: Model Context Protocol specification
- **Phase 2.5 Docs**: Auto-injection system (MCP_CONFIG.md parsing)
- **Phase 2.6 Docs**: This document (management tools)
- **McpServerRegistry**: Community server registry
- **McpConfigManager**: Config file operations
- **McpClientManager**: Runtime server connections

---

## Contributing

### Adding New Management Tools

1. Create new file in `packages/core/src/tools/mcp-management/`
2. Export class with static `execute()` and `toCanonicalTool()` methods
3. Add to `index.ts` exports
4. Import in `CortexOrchestrator.ts`
5. Add to `mcpManagementToolNames` array
6. Add switch case for execution
7. Add to `getMcpManagementTools()` return array

### Enhancing Existing Tools

- InitMcpConfig: Add more project detection patterns
- SearchMcpServers: Improve ranking algorithm
- EnableMcpServer: Add validation checks
- All tools: Enhance error messages

---

**Last Updated**: 2025-11-07
**Phase**: 2.6 Complete
**Status**: ✅ Production Ready
**Tools**: 7 management tools
**Integration**: Complete
