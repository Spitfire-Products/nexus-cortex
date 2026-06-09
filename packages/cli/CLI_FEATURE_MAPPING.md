# CLI Feature Mapping: Core Library → CLI Commands

**Based On**: Package audits (types, core, executors, server), complete feature audit, source of truth analysis

**Principle**: Every core library feature must be accessible via CLI - either through:
1. Deterministic `/` commands (for explicit actions)
2. Interactive Ink components (for menus, browsers, dashboards)
3. Natural language (for tool invocation)

---

## Architecture: Three Access Patterns

### Pattern A: Deterministic Commands (Chalk output)
**Use For**: Explicit actions, status queries, configuration
**Format**: `/command subcommand [args] [--flags]`
**UI**: Chalk-themed text output, streaming for chat

### Pattern B: Interactive Components (Ink UI)
**Use For**: Browsing, selection, configuration wizards
**Format**: `/command` (launches Ink UI)
**UI**: React-based terminal UI with keyboard navigation

### Pattern C: Natural Language (via Chat)
**Use For**: Tool invocation, complex workflows
**Format**: Chat prompt triggers model to use tools
**UI**: Streaming chat with tool execution display

---

## Complete Feature Inventory from Audits

### 1. Session Management (SessionTimeline + CheckpointManager)

**Core Features** (from packages/core/src/session/):
- SessionTimeline with 7 event types
- Checkpoint creation/resume with branching
- FileCheckpointManager (workspace snapshots)
- JSONLHistoryStore (message persistence)
- Conversation tree structure

**Server Endpoints** (packages/server/src/routes/sessions.ts):
- ✅ GET /sessions - List all sessions
- ✅ GET /sessions/:id - Session details
- ✅ GET /sessions/:id/messages - Messages
- ✅ GET /sessions/:id/export - Export to JSON
- ✅ GET /sessions/:id/checkpoints - List checkpoints
- ✅ POST /sessions/:id/checkpoint - Create checkpoint
- ✅ POST /sessions/:id/resume/:checkpointId - Resume from checkpoint
- ✅ GET /sessions/:id/timeline - Timeline events
- ✅ GET /sessions/:id/stats - Session statistics
- ✅ DELETE /sessions/:id - Delete session

**CLI Commands**:
```bash
# Deterministic commands
/sessions list [--limit N]                    # GET /sessions
/sessions view <id>                           # GET /sessions/:id
/sessions export <id> [--output file.json]    # GET /sessions/:id/export
/sessions stats <id>                          # GET /sessions/:id/stats
/sessions delete <id> [--confirm]             # DELETE /sessions/:id

# Checkpoint commands
/checkpoint [description]                     # POST /sessions/:id/checkpoint
/checkpoints list                             # GET /sessions/:id/checkpoints
/resume <checkpoint-id> [--model model-id]    # POST /sessions/:id/resume/:id

# Timeline commands
/timeline [--type event-type]                 # GET /sessions/:id/timeline
/timeline events                              # All events
/timeline branches                            # Show conversation tree
/timeline compactions                         # Compaction history
/timeline switches                            # Model switch history

# Interactive component
/sessions                                     # Launches Ink SessionBrowser
```

### 2. Model Management (ModularModelRegistry + Orchestrator)

**Core Features** (from packages/core/):
- 86 model cards across 14 providers
- Model switching with timeline tracking
- Provider configuration

**Server Endpoints**:
- ✅ GET /models - List all models
- ❌ POST /sessions/:id/model - Model switching (MISSING)

**CLI Commands**:
```bash
# Deterministic commands
/models list [--provider name]                # GET /models
/models info <model-id>                       # GET /models + filter
/models providers                             # GET /models + group by provider
/model <model-id>                             # Switch model (needs endpoint)

# Search/filter (local)
/models search <query>                        # Filter GET /models locally
/models cost <model-id>                       # Show pricing from model card

# Interactive component
/models                                       # Launches Ink ModelPicker
```

### 3. MCP Integration (McpClientManager + 7 MCP Tools)

**Core Features** (from packages/core/src/tools/mcp-management/):
- 7 MCP management tools (ListAvailableMcpServers, EnableMcpServer, etc.)
- McpClientManager for server lifecycle
- McpServerRegistry for server tracking
- McpConfigManager for MCP_CONFIG.md

**Server Endpoints**:
- ✅ GET /mcp/servers - List servers
- ✅ GET /mcp/servers/:name - Server details
- ✅ GET /mcp/servers/:name/tools - Server tools
- ✅ GET /mcp/tools - All MCP tools
- ✅ POST /mcp/servers/:name/connect - Connect
- ✅ POST /mcp/servers/:name/disconnect - Disconnect
- ✅ GET /mcp/status - MCP status

**MCP Tools** (accessible via natural language):
- ListAvailableMcpServers
- SearchMcpServers
- GetMcpConfig
- EnableMcpServer
- DisableMcpServer
- ConfigureMcpServer
- InitMcpConfig

**CLI Commands**:
```bash
# Deterministic commands
/mcp list                                     # GET /mcp/servers
/mcp status                                   # GET /mcp/status
/mcp server <name>                            # GET /mcp/servers/:name
/mcp tools [server-name]                      # GET /mcp/tools or /mcp/servers/:name/tools
/mcp enable <name>                            # POST /mcp/servers/:name/connect
/mcp disable <name>                           # POST /mcp/servers/:name/disconnect

# Configuration (via tools)
/mcp init                                     # Uses InitMcpConfig tool
/mcp configure <server> [options]             # Uses ConfigureMcpServer tool
/mcp search <query>                           # Uses SearchMcpServers tool

# Interactive component
/mcp                                          # Launches Ink McpBrowser
```

### 4. Artifact & Sandbox System (5 Tools + SandboxViewServer)

**Core Features** (from packages/executors/src/implementations/addon/):
- 5 artifact tools (CreateArtifactTool, InspectSandboxTool, etc.)
- SandboxViewServer on port 4001 (dashboard)
- TmuxViewServer (terminal viewer)
- ArtifactRegistry v2.0.0 (unified persistence)
- Visual feedback infrastructure (9 components)

**Dashboard Routes** (port 4001):
- GET / - Multi-sandbox dashboard
- GET /sandbox/:sandboxId - Sandbox viewer
- GET /tmux - Tmux dashboard
- GET /tmux/:sessionId - Tmux terminal viewer
- GET /api/sandboxes - Sandbox list API
- POST /api/artifacts/:id/stop - Stop artifact
- POST /api/artifacts/:id/restart - Restart artifact
- GET /api/tmux/sessions - Tmux session list

**Artifact Tools** (accessible via natural language):
- CreateArtifactTool
- InspectSandboxTool
- InteractWithSandboxTool
- ModifySandboxTool
- StopSandboxTool

**CLI Commands**:
```bash
# Deterministic commands (HTTP to port 4001)
/artifacts list                               # GET http://localhost:4001/api/sandboxes
/artifacts status <id>                        # Uses InspectSandboxTool
/artifacts stop <id>                          # POST http://localhost:4001/api/artifacts/:id/stop
/artifacts restart <id>                       # POST http://localhost:4001/api/artifacts/:id/restart
/artifacts view <id>                          # Open http://localhost:4001/sandbox/:id

# Tmux commands
/tmux list                                    # GET http://localhost:4001/api/tmux/sessions
/tmux view <session-id>                       # Open http://localhost:4001/tmux/:sessionId
/tmux create <name> [--layout type]           # Uses TmuxSessionTool (via natural language)
/tmux kill <session-id>                       # Uses TmuxSessionTool

# Dashboard commands
/dashboard                                    # Open http://localhost:4001/
/dashboard sandbox                            # Open http://localhost:4001/
/dashboard tmux                               # Open http://localhost:4001/tmux

# Interactive components
/artifacts                                    # Launches Ink ArtifactDashboard
/tmux                                         # Launches Ink TmuxBrowser
```

### 5. System Messages (SystemMessageLoader + 7 Messages)

**Core Features** (from packages/core/src/system-messages/):
- SystemMessageLoader (registry-based loading)
- 7 registered system messages with conditions
- SystemReminderInjector (8 reminder patterns)
- Template variable support
- Conditional injection framework

**Server Endpoints**:
- ❌ None - system messages are server config

**System Messages** (7 files):
1. SYSTEM_PROMPT.md (priority 1)
2. TOOL_USAGE_GUIDE.md (priority 2)
3. EXAMPLES.md (priority 3)
4. REASONING_GUIDE.md (priority 4)
5. ENVIRONMENT_INFO.md (priority 5, dynamic)
6. POLICY_CHECK.md (priority 6)
7. PERIODIC_REMINDER.md (priority 10, every 10 turns)

**CLI Commands**:
```bash
# Read-only access (these are server config)
/system-messages list                         # List from registry
/system-messages view <id>                    # Read markdown file
/system-messages reload                       # Trigger server reload

# If CRUD is desired (would need server endpoints):
/system-messages create <id> <name>           # Create new message (needs endpoint)
/system-messages edit <id>                    # Edit content (needs endpoint)
/system-messages delete <id>                  # Delete message (needs endpoint)
/system-messages enable <id>                  # Enable injection (needs endpoint)
/system-messages disable <id>                 # Disable injection (needs endpoint)

# Interactive component
/system-messages                              # Launches Ink SystemMessageBrowser
```

### 6. Permissions & Approval (PermissionsMiddleware)

**Core Features** (from packages/core/src/middleware/permissions/):
- PermissionsMiddleware with 14 permission files
- ApprovalHandler variants (CLI, HTTP, Programmatic, Auto)
- Permission policies and evaluators
- Tool permission tracking

**Server Endpoints**:
- ✅ GET /v1/approval-mode - Get approval mode
- ✅ POST /v1/approval-mode - Set approval mode
- ❌ GET /permissions/tools - List tool permissions (MISSING)
- ❌ POST /permissions/tool/:name - Grant/revoke permission (MISSING)

**CLI Commands**:
```bash
# Deterministic commands
/permissions mode                             # GET /v1/approval-mode
/permissions set <mode>                       # POST /v1/approval-mode
/permissions auto-approve [on|off]            # POST /v1/approval-mode {autoApproveActions}

# Tool permissions (needs endpoints)
/permissions tools                            # GET /permissions/tools (MISSING)
/permissions grant <tool>                     # POST /permissions/tool/:tool (MISSING)
/permissions revoke <tool>                    # POST /permissions/tool/:tool (MISSING)
/permissions policies                         # GET /permissions/policies (MISSING)
/permissions logs                             # GET /permissions/logs (MISSING)

# Interactive component
/permissions                                  # Launches Ink PermissionsBrowser
```

### 7. Context & Compaction (ContextBudgetManager + StoredCompactionManager)

**Core Features** (from packages/core/src/conversation/):
- ContextBudgetManager (token tracking)
- StoredCompactionManager (compaction storage)
- CompactionSemanticMetadata
- Timeline integration

**Server Endpoints**:
- ❌ GET /sessions/:id/context - Context status (MISSING)
- ❌ POST /sessions/:id/compaction - Manual compaction (MISSING)
- ❌ GET /sessions/:id/compaction/boundaries - Boundaries (MISSING)

**CLI Commands**:
```bash
# Context status (needs endpoint)
/context status                               # GET /sessions/:id/context (MISSING)
/context budget                               # Show token budget
/context utilization                          # Show % used

# Compaction (needs endpoints)
/context compact                              # POST /sessions/:id/compaction (MISSING)
/context boundaries                           # GET /sessions/:id/compaction/boundaries (MISSING)
/context savings                              # Show token savings from compaction
/context strategy [strategy]                  # Get/set compaction strategy

# Interactive component
/context                                      # Launches Ink ContextViewer
```

### 8. Cache Metrics (CacheMetricsAccumulator)

**Core Features** (from packages/core/src/session/):
- CacheMetricsAccumulator (cache statistics)
- Cache metrics tracking (writes, reads, token savings)

**Server Endpoints**:
- ❌ GET /sessions/:id/cache/metrics - Cache metrics (MISSING)

**CLI Commands**:
```bash
# Cache metrics (needs endpoint)
/cache metrics                                # GET /sessions/:id/cache/metrics (MISSING)
/cache report                                 # Formatted cache report
/cache reset                                  # Reset cache metrics
```

### 9. Middleware (7 Systems - Server Config)

**Core Features** (from packages/core/src/middleware/):
1. ErrorClassificationMiddleware
2. RetryMiddleware
3. PermissionsMiddleware (covered above)
4. SystemMessageMiddleware (covered above)
5. MentorshipMiddleware
6. LoopControlMiddleware
7. HelperModelMiddleware

**Server Endpoints**:
- ❌ GET /middleware/config - Middleware configuration (MISSING)
- ❌ POST /middleware/config - Update middleware (MISSING)

**CLI Commands**:
```bash
# Middleware status/config (needs endpoints)
/middleware list                              # GET /middleware/config (MISSING)
/middleware status <name>                     # GET /middleware/:name/status (MISSING)
/middleware enable <name>                     # POST /middleware/:name/enable (MISSING)
/middleware disable <name>                    # POST /middleware/:name/disable (MISSING)
/middleware config <name>                     # GET /middleware/:name/config (MISSING)

# Retry middleware
/retry status                                 # Retry config
/retry stats                                  # Retry statistics

# Mentorship middleware
/mentorship status                            # Mentorship config
/mentorship enable                            # Enable mentorship
/mentorship disable                           # Disable mentorship

# Loop control middleware
/limits status                                # Loop limits
/limits set <type> <value>                    # Set limit

# Helper model middleware
/helper status                                # Helper model config
/helper set <model-id>                        # Set helper model

# Interactive component
/middleware                                   # Launches Ink MiddlewareDashboard
```

### 10. Historical Context (4 Tools + HistoricalContextService)

**Core Features** (from packages/core/src/tools/historical/):
- 4 historical context tools
- HistoricalContextService
- SearchConversationHistory
- GetConversationSegment
- ListCompactionBoundaries
- RequestHistoricalContext

**Server Endpoints**:
- ❌ None - accessed via tools through POST /v1/messages

**Historical Tools** (accessible via natural language):
- SearchConversationHistory
- GetConversationSegment
- ListCompactionBoundaries
- RequestHistoricalContext

**CLI Commands**:
```bash
# Historical context (via natural language)
# User says: "search my conversation for postgres"
#   → Model uses SearchConversationHistory tool
# User says: "show me messages from turn 10 to 20"
#   → Model uses GetConversationSegment tool
# User says: "list compaction boundaries"
#   → Model uses ListCompactionBoundaries tool

# Deterministic shortcuts
/history search <query>                       # Shortcut to SearchConversationHistory
/history segment <start> <end>                # Shortcut to GetConversationSegment
/history boundaries                           # Shortcut to ListCompactionBoundaries
/history context                              # Shortcut to RequestHistoricalContext
```

### 11. Configuration (SettingsLoader + SettingsWriter)

**Core Features** (from packages/core/src/config/):
- SettingsLoader (read .env)
- SettingsWriter (write .env)
- SettingsSchema (validation)
- InteractiveConfigurator

**Server Endpoints**:
- ❌ None - configuration is local .env file

**CLI Commands**:
```bash
# Deterministic commands (read/write .env)
/config get [key]                             # Read .env value(s)
/config set <key> <value>                     # Write .env value
/config categories                            # List setting categories
/config category <name>                       # Show category settings
/config validate                              # Validate .env against schema
/config reset [key]                           # Reset to defaults
/config import <file>                         # Import config from file

# Interactive component
/config wizard                                # Launches Ink ConfigWizard
/config                                       # Launches Ink ConfigBrowser
```

### 12. Extension Tools (SlashCommandTool + SkillTool)

**Core Features** (from packages/executors/src/implementations/extensions/):
- SlashCommandTool (custom commands from `.cortex/commands/`)
- SkillTool (skills from `.cortex/skills/`)

**Server Endpoints**:
- ❌ None - accessed via tools through POST /v1/messages

**CLI Commands**:
```bash
# Slash commands (via SlashCommandTool)
/<command-name> [args]                        # Executes .cortex/commands/<command>.md

# Skills (via SkillTool)
# User says: "use pdf-analyzer skill"
#   → Model uses SkillTool with command: "pdf-analyzer"

# Management commands
/commands list                                # List .cortex/commands/*.md
/commands view <name>                         # View command content
/commands create <name>                       # Create new command

/skills list                                  # List .cortex/skills/*/SKILL.md
/skills view <name>                           # View skill content
/skills create <name>                         # Create new skill directory
```

### 13. Health & Server Management

**Server Endpoints**:
- ✅ GET /health - Health check with HTML dashboard

**CLI Commands**:
```bash
# Deterministic commands
/health                                       # GET /health
/server status                                # GET /health (alias)
/server start [--port N]                      # Start server (if not running)
/server stop [--force]                        # Stop server
/server logs [--level error]                  # View server logs
/server restart                               # Restart server
```

---

## Missing Server Endpoints (Critical for CLI)

Based on core features that exist but aren't exposed:

### Tier 1 - Critical (5 endpoints)
```typescript
POST /sessions/:id/model                      // Switch model
GET  /sessions/:id/context                    // Context budget status
GET  /sessions/:id/cache/metrics              // Cache metrics
GET  /tools                                   // List available tools
GET  /permissions/tools                       // List tool permissions
```

### Tier 2 - Important (6 endpoints)
```typescript
POST /permissions/tool/:name                  // Grant/revoke permission
POST /sessions/:id/compaction                 // Manual compaction
GET  /sessions/:id/compaction/boundaries      // Compaction boundaries
GET  /middleware/config                       // Middleware configuration
POST /middleware/:name/enable                 // Enable middleware
POST /middleware/:name/disable                // Disable middleware
```

### Tier 3 - Optional (5 endpoints)
```typescript
GET  /system-messages                         // List system messages
POST /system-messages                         // Create message
PUT  /system-messages/:id                     // Update message
DELETE /system-messages/:id                   // Delete message
POST /system-messages/reload                  // Reload from disk
```

---

## Implementation Priority

### Phase 1: Add Missing Endpoints (Week 1-2)
Add 16 missing server endpoints to packages/server/src/routes/

### Phase 2: Deterministic Commands (Week 3-4)
Implement all `/command` deterministic commands with Chalk output

### Phase 3: Interactive Components (Week 5-6)
Implement Ink UI components:
- SessionBrowser
- ModelPicker
- McpBrowser
- ArtifactDashboard
- TmuxBrowser
- ConfigWizard
- PermissionsBrowser
- MiddlewareDashboard
- ContextViewer
- SystemMessageBrowser

### Phase 4: Streaming Chat (Week 7)
Enhance chat command with:
- Character-by-character streaming
- Tool execution display
- Progress indicators
- Inline status bar

### Phase 5: Integration & Testing (Week 8)
- Test all commands
- Polish UX
- Write documentation

---

## Total Command Count

**Deterministic Commands**: ~80 commands
**Interactive Components**: ~10 Ink UIs
**Natural Language**: Unlimited (model uses tools)
**Total Surface Area**: Complete core library coverage

---

## Next Steps

1. Review this mapping with team
2. Approve endpoint additions (16 endpoints)
3. Begin Phase 1 (add missing endpoints)
4. Implement commands systematically
5. Test against core library features
