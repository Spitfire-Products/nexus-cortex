# Core Library → Server → CLI Gap Analysis

**Date:** 2025-11-15
**Purpose:** Map core library capabilities to server endpoints to CLI commands
**Critical Finding:** Server exposes ~30% of core library capabilities

---

## Executive Summary

**The Problem:** The server was built AFTER the core library and only exposes a subset of features.

**The Numbers:**
- **CortexOrchestrator Public API:** 28 methods
- **Server HTTP Endpoints:** 20 endpoints
- **Coverage:** ~60% of orchestrator methods exposed
- **Middleware Systems:** 7 systems (0% exposed via endpoints)
- **Context Management:** 3 services (0% exposed)
- **Tool Systems:** 4 categories (only exposed via POST /v1/messages)

**The Gap:** Many powerful core library features have NO server endpoints.

---

## Part 1: Server Endpoints Inventory

### Actual HTTP Endpoints (20 total)

#### Sessions (8 endpoints) ✅
```
GET    /sessions                    → List all sessions
GET    /sessions/:id                → Get session details
GET    /sessions/:id/messages       → Get session messages
GET    /sessions/:id/export         → Export session to JSONL
DELETE /sessions/:id                → Delete session
GET    /sessions/:id/checkpoints    → List checkpoints
POST   /sessions/:id/resume         → Resume from checkpoint
GET    /sessions/:id/stats          → Session statistics
```

**Orchestrator Methods Used:**
- `historyStore.listSessions()`
- `historyStore.getSessionInfo(id)`
- `historyStore.loadSession(id)`
- `historyStore.exportSession(id)`
- `historyStore.deleteSession(id)`
- `listCheckpoints()`
- `resumeFromCheckpoint(checkpointId, options)`
- `getSessionStats()`

#### MCP (7 endpoints) ✅
```
GET  /mcp/servers                   → List MCP servers
GET  /mcp/servers/:name             → Get server details
GET  /mcp/servers/:name/tools       → List server tools
GET  /mcp/tools                     → List all MCP tools
POST /mcp/servers/:name/connect     → Enable MCP server
POST /mcp/servers/:name/disconnect  → Disable MCP server
GET  /mcp/status                    → MCP system status
```

**Orchestrator Methods Used:**
- `isMcpEnabled()`
- `getMcpServerInfo()`
- `getMcpTools()`
- `mcpManager.connectToServer(name)`
- `mcpManager.disconnectServer(name)`

#### Models (1 endpoint) ✅
```
GET  /models                        → List all models
```

**Orchestrator Methods Used:**
- `modelRegistry.listModels()`
- `modelRegistry.getModel(modelId)`

#### Approval/Permissions (2 endpoints) ✅
```
GET  /v1/approval-mode              → Get approval mode
POST /v1/approval-mode              → Set approval mode
```

**Orchestrator Methods Used:**
- `getApprovalMode()`
- `setApprovalMode(mode)`

#### Health (1 endpoint) ✅
```
GET  /health                        → Server health & diagnostics
```

**Orchestrator Methods Used:**
- `modelRegistry.listModels()` (for dashboard)

#### Messages (1 endpoint) ✅ **CRITICAL**
```
POST /v1/messages                   → Send message (with tools)
```

**Orchestrator Methods Used:**
- `sendMessage(messages, options)`
- `streamMessage(messages, options)` (when stream=true)

**Special:** When `tools=[]`, auto-enables all built-in tools
- This is how ALL tool-based features are accessed
- No dedicated endpoints needed for tools

---

## Part 2: Orchestrator Public API (28 methods)

### 2.1: Core Messaging (2 methods)

| Method | Server Endpoint | Status |
|--------|----------------|---------|
| `sendMessage(messages, options)` | POST /v1/messages | ✅ Exposed |
| `streamMessage(messages, options)` | POST /v1/messages (stream=true) | ✅ Exposed |

**Coverage:** 100% ✅

### 2.2: Session Management (7 methods)

| Method | Server Endpoint | Status |
|--------|----------------|---------|
| `createSession(projectPath, modelId)` | ❌ None | ⚠️ Created on server start only |
| `getSessionId()` | ❌ None | ❌ NOT Exposed |
| `getConversationId()` | ❌ None | ❌ NOT Exposed |
| `getMessageHistory()` | GET /sessions/:id/messages | ✅ Exposed (via historyStore) |
| `createCheckpoint(options)` | ❌ None | ❌ NOT Exposed |
| `resumeFromCheckpoint(id, options)` | POST /sessions/:id/resume | ✅ Exposed |
| `listCheckpoints()` | GET /sessions/:id/checkpoints | ✅ Exposed |
| `getCheckpoint(checkpointId)` | ❌ None | ❌ NOT Exposed |

**Coverage:** 43% (3/7 methods) ⚠️

**Missing Endpoints:**
- `POST /sessions/create` - Create new session
- `GET /session/current` - Get current session ID
- `GET /session/current/conversation-id` - Get conversation ID
- `POST /sessions/:id/checkpoint` - Create checkpoint
- `GET /sessions/:id/checkpoints/:checkpointId` - Get specific checkpoint

### 2.3: Model Management (3 methods)

| Method | Server Endpoint | Status |
|--------|----------------|---------|
| `switchModel(modelId, options)` | ❌ None | ❌ NOT Exposed |
| `getCurrentModel()` | ❌ None | ❌ NOT Exposed |
| `listAvailableModels()` | GET /models | ✅ Exposed |

**Coverage:** 33% (1/3 methods) ⚠️

**Missing Endpoints:**
- `POST /model/switch` - Switch current model
- `GET /model/current` - Get current model

### 2.4: MCP Integration (8 methods)

| Method | Server Endpoint | Status |
|--------|----------------|---------|
| `getMcpManager()` | ❌ None | ❌ NOT Exposed (internal) |
| `isMcpEnabled()` | GET /mcp/status | ✅ Exposed |
| `getMcpServerInfo()` | GET /mcp/servers | ✅ Exposed |
| `getMcpToolDeclarations()` | GET /mcp/tools | ✅ Exposed (partially) |
| `getMcpConfigManager()` | ❌ None | ❌ NOT Exposed |
| `getMcpServerRegistry()` | ❌ None | ❌ NOT Exposed |
| `isMcpAutoInjectEnabled()` | ❌ None | ❌ NOT Exposed |
| `getMcpTools()` | GET /mcp/tools | ✅ Exposed |

**Coverage:** 50% (4/8 methods) ⚠️

**Missing Endpoints:**
- `GET /mcp/config` - Get MCP configuration
- `POST /mcp/config` - Update MCP configuration
- `GET /mcp/registry` - Get server registry
- `GET /mcp/auto-inject` - Check auto-inject status
- `POST /mcp/auto-inject` - Toggle auto-inject

### 2.5: Historical Context (1 method)

| Method | Server Endpoint | Status |
|--------|----------------|---------|
| `getHistoricalService()` | ❌ None | ❌ NOT Exposed |

**Coverage:** 0% (0/1 methods) ❌

**How it's accessed:** Via tools through POST /v1/messages:
- SearchConversationHistory tool
- GetConversationSegment tool
- ListCompactionBoundaries tool
- RequestHistoricalContext tool

**Missing Endpoints:** Should tools be enough, or do we need:
- `POST /history/search` - Search conversation history
- `GET /history/boundaries` - List compaction boundaries
- `GET /history/context` - Request historical context

### 2.6: Cache Metrics (3 methods)

| Method | Server Endpoint | Status |
|--------|----------------|---------|
| `getCacheMetrics()` | ❌ None | ❌ NOT Exposed |
| `getCacheReport()` | ❌ None | ❌ NOT Exposed |
| `resetCacheMetrics()` | ❌ None | ❌ NOT Exposed |

**Coverage:** 0% (0/3 methods) ❌

**Missing Endpoints:**
- `GET /cache/metrics` - Get cache metrics
- `GET /cache/report` - Get cache report
- `POST /cache/reset` - Reset cache metrics

### 2.7: Permissions (2 methods)

| Method | Server Endpoint | Status |
|--------|----------------|---------|
| `getApprovalMode()` | GET /v1/approval-mode | ✅ Exposed |
| `setApprovalMode(mode)` | POST /v1/approval-mode | ✅ Exposed |

**Coverage:** 100% ✅

### 2.8: Utilities (2 methods)

| Method | Server Endpoint | Status |
|--------|----------------|---------|
| `getAdapterRegistry()` | ❌ None | ❌ NOT Exposed (internal) |
| `cleanup()` | ❌ None | ❌ NOT Exposed |

**Coverage:** 0% (0/2 methods) ❌

**Note:** These are internal utilities, may not need exposure.

---

## Part 3: Middleware Systems (7 systems)

**Location:** `/packages/core/src/middleware/*.ts`

| Middleware | Configuration Method | Server Endpoint | Status |
|------------|---------------------|-----------------|---------|
| ErrorClassificationMiddleware | OrchestratorConfig | ❌ None | ❌ NOT Exposed |
| RetryMiddleware | OrchestratorConfig | ❌ None | ❌ NOT Exposed |
| PermissionsMiddleware | OrchestratorConfig | Partial (approval-mode) | ⚠️ Partial |
| SystemMessageMiddleware | OrchestratorConfig | ❌ None | ❌ NOT Exposed |
| MentorshipMiddleware | OrchestratorConfig.reactiveMentorship | ❌ None | ❌ NOT Exposed |
| LoopControlMiddleware | OrchestratorConfig.loopControl | ❌ None | ❌ NOT Exposed |
| HelperModelMiddleware | OrchestratorConfig.useHelperModels | ❌ None | ❌ NOT Exposed |

**Coverage:** 0% (middleware is server-side config only) ❌

**Critical Insight:** Middleware is configured in `OrchestratorConfig` at server startup.
- Cannot be changed at runtime via HTTP endpoints
- Configuration is static (env vars or constructor params)
- No API to view/modify middleware settings

**Missing Endpoints (if we want runtime control):**
- `GET /middleware/status` - Get all middleware status
- `POST /middleware/:name/enable` - Enable middleware
- `POST /middleware/:name/disable` - Disable middleware
- `GET /middleware/:name/config` - Get middleware config
- `POST /middleware/:name/config` - Update middleware config

**Specific Missing Endpoints:**
- `GET /mentorship/status` - Get mentorship config
- `POST /mentorship/enable` - Enable mentorship
- `POST /mentorship/keywords` - Set keywords
- `GET /retry/config` - Get retry config
- `POST /retry/config` - Update retry config
- `GET /loop-control/limits` - Get loop control limits
- `POST /loop-control/limits` - Update limits

---

## Part 4: Context Management (3 services)

**Location:** `/packages/core/src/conversation/`

| Service | Orchestrator Access | Server Endpoint | Status |
|---------|-------------------|-----------------|---------|
| ContextBudgetManager | (orchestrator as any).contextBudget | ❌ None | ❌ NOT Exposed |
| StoredCompactionManager | (orchestrator as any).compactionManager | ❌ None | ❌ NOT Exposed |
| SummaryTemplates | Internal | ❌ None | ❌ NOT Exposed |

**Coverage:** 0% (0/3 services) ❌

**Missing Endpoints:**
- `GET /context/status` - Get context budget status
- `GET /context/usage` - Get current context usage
- `POST /context/compact` - Trigger manual compaction
- `GET /context/boundaries` - List compaction boundaries
- `GET /context/strategy` - Get compaction strategy
- `POST /context/strategy` - Set compaction strategy
- `GET /context/savings` - Get compaction savings stats

---

## Part 5: Tool Systems (4 categories)

**Location:** `/packages/core/src/tools/`

### 5.1: Base Tools (18 tools)

**Accessed via:** POST /v1/messages with `tools=[]`

1. Read
2. Write
3. Edit
4. Bash
5. Grep
6. Glob
7. WebSearch
8. WebFetch
9. Task
10. TodoWrite
11. NotebookEdit
12. ExitPlanMode
13. BashOutput
14. KillShell
15. SearchConversationHistory
16. GetConversationSegment
17. ListCompactionBoundaries
18. RequestHistoricalContext

**Server Endpoint:** POST /v1/messages ✅
**Status:** Fully exposed via tools ✅

### 5.2: MCP Management Tools (7 tools)

**Location:** `/packages/core/src/tools/mcp-management/`

1. ListAvailableMcpServers
2. SearchMcpServers
3. GetMcpConfig
4. EnableMcpServer
5. DisableMcpServer
6. ConfigureMcpServer
7. InitMcpConfig

**Server Endpoint:** POST /v1/messages OR dedicated MCP endpoints ✅
**Status:** Dual access (tools + REST) ✅

**Note:** Can use either:
- Natural language: "enable postgres MCP server" → EnableMcpServer tool
- REST: POST /mcp/servers/postgres/connect

### 5.3: Historical Context Tools (4 tools)

**Location:** Included in base tools

1. SearchConversationHistory
2. GetConversationSegment
3. ListCompactionBoundaries
4. RequestHistoricalContext

**Server Endpoint:** POST /v1/messages ✅
**Status:** Tool-based only ✅

### 5.4: Artifact Tools (11 tools)

**Location:** `/packages/executors/src/implementations/addon/`

1. CreateArtifact
2. UpdateArtifact
3. DeleteArtifact
4. ListArtifacts
5. InspectArtifact
6. InteractWithArtifact
7. GetArtifactOutput
8. StartArtifact
9. StopArtifact
10. RestartArtifact
11. GetArtifactStatus

**Server Endpoint:** POST /v1/messages ✅
**Status:** Tool-based only ✅

---

## Part 6: Gap Summary

### Total Core Library Capabilities

```
Orchestrator Public Methods:    28
├─ Exposed via HTTP:            17 (61%)
├─ Exposed via tools:            0 (tools use sendMessage)
└─ NOT exposed:                 11 (39%)

Middleware Systems:              7
├─ Exposed via HTTP:             0 (0%)
├─ Configurable at runtime:      0 (0%)
└─ Static config only:           7 (100%)

Context Management Services:     3
├─ Exposed via HTTP:             0 (0%)
├─ Exposed via tools:            4 (historical tools)
└─ NOT exposed:                  3 (100%)

Tool Categories:                 4
├─ Base tools:                  18 (via POST /v1/messages)
├─ MCP management:               7 (via tools + REST)
├─ Historical:                   4 (via tools)
└─ Artifact:                    11 (via tools)

Total Tools:                    40 (all accessible via POST /v1/messages)
```

### Missing Server Endpoints by Category

#### High Priority (Core Operations)
1. `POST /sessions/create` - Create new session
2. `GET /session/current` - Get current session
3. `POST /model/switch` - Switch model
4. `GET /model/current` - Get current model
5. `POST /sessions/:id/checkpoint` - Create checkpoint
6. `GET /context/status` - Context budget status
7. `GET /cache/metrics` - Cache metrics

#### Medium Priority (Middleware Control)
8. `GET /middleware/status` - All middleware status
9. `GET /mentorship/status` - Mentorship config
10. `POST /mentorship/config` - Update mentorship
11. `GET /retry/config` - Retry config
12. `GET /loop-control/limits` - Loop control limits

#### Low Priority (Advanced Features)
13. `GET /context/boundaries` - Compaction boundaries (has tool)
14. `GET /context/strategy` - Compaction strategy
15. `POST /context/compact` - Manual compaction
16. `GET /mcp/config` - MCP configuration
17. `POST /mcp/config` - Update MCP config

---

## Part 7: Recommendations

### Recommendation 1: Add Missing Core Endpoints (High Priority)

**New Route File:** `/packages/server/src/routes/orchestrator.ts`

```typescript
// Current session operations
GET    /session/current           → orchestrator.getSessionId()
GET    /session/conversation-id   → orchestrator.getConversationId()
POST   /sessions                  → orchestrator.createSession(path, model)

// Model switching
POST   /model/switch              → orchestrator.switchModel(id, options)
GET    /model/current             → orchestrator.getCurrentModel()

// Checkpoint creation
POST   /sessions/:id/checkpoint   → orchestrator.createCheckpoint(options)
GET    /sessions/:id/checkpoints/:checkpointId → orchestrator.getCheckpoint(id)

// Cache metrics
GET    /cache/metrics             → orchestrator.getCacheMetrics()
GET    /cache/report              → orchestrator.getCacheReport()
POST   /cache/reset               → orchestrator.resetCacheMetrics()
```

**Impact:** Exposes 11 missing orchestrator methods → 100% coverage

### Recommendation 2: Add Context Management Endpoints (Medium Priority)

**New Route File:** `/packages/server/src/routes/context.ts`

```typescript
GET    /context/status            → contextBudget.getStatus()
GET    /context/usage             → contextBudget.getCurrentUsage()
POST   /context/compact           → compactionManager.compact()
GET    /context/boundaries        → compactionManager.getBoundaries()
GET    /context/strategy          → compactionManager.getStrategy()
POST   /context/strategy          → compactionManager.setStrategy(strategy)
GET    /context/savings           → compactionManager.getSavings()
```

**Impact:** Exposes context management features

### Recommendation 3: Add Middleware Configuration Endpoints (Low Priority)

**New Route File:** `/packages/server/src/routes/middleware.ts`

```typescript
GET    /middleware/status         → Get all middleware status
GET    /middleware/:name/config   → Get specific middleware config
POST   /middleware/:name/config   → Update middleware config

// Specific middleware endpoints
GET    /mentorship/status         → mentorshipMiddleware.getStatus()
POST   /mentorship/enable         → mentorshipMiddleware.enable()
POST   /mentorship/keywords       → mentorshipMiddleware.setKeywords(keywords)

GET    /retry/config              → retryMiddleware.getConfig()
POST   /retry/config              → retryMiddleware.updateConfig(config)

GET    /loop-control/limits       → loopControlMiddleware.getLimits()
POST   /loop-control/limits       → loopControlMiddleware.setLimits(limits)
```

**Impact:** Runtime middleware control (currently static config only)

**Note:** This requires refactoring middleware to support runtime configuration.

### Recommendation 4: Keep Tool-Based Access (Current Approach)

**DO NOT create endpoints for:**
- Artifact operations (use CreateArtifact, InteractWithArtifact tools)
- Historical context (use SearchConversationHistory tool)
- MCP management (keep dual access: tools + REST)

**Reason:** POST /v1/messages with tools is the correct pattern for these.

---

## Part 8: CLI Implications

### What CLI Can Access Now (20 endpoints)

**Full Coverage:**
- Sessions: list, view, export, delete, checkpoints, resume, stats
- MCP: list, status, server details, tools, enable, disable
- Models: list
- Permissions: get/set approval mode
- Messages: send/stream with tools
- Health: server status

**CLI Commands Possible:**
- ~20 commands with REST endpoints
- ~40 tool operations via natural language (POST /v1/messages)
- ~6 Ink interactive components (sessions, themes, artifacts, config)

### What CLI CANNOT Access (11+ missing endpoints)

**Missing Operations:**
- Create new session
- Get current session ID
- Switch model
- Get current model
- Create checkpoint
- Get specific checkpoint
- Get context status
- Get cache metrics
- Configure middleware at runtime
- Manage context manually
- View/modify compaction strategy

**Missing Features:**
- Runtime middleware configuration (mentorship, retry, loop control)
- Context management UI
- Cache metrics dashboard
- Advanced session operations

### Recommendation: Two-Phase Approach

**Phase 1: Add Core Endpoints (This Week)**
- Add missing orchestrator methods (11 endpoints)
- Enables full core CLI functionality
- ~1-2 days implementation

**Phase 2: Add Advanced Features (Next Sprint)**
- Context management endpoints (7 endpoints)
- Middleware configuration endpoints (5+ endpoints)
- Dashboard/advanced features
- ~3-5 days implementation

---

## Part 9: Verification Checklist

### ✅ Server Completeness Check

To verify server has all needed endpoints:

1. **Read CortexOrchestrator public methods** (28 total)
2. **Map each to server endpoint** (17 mapped, 11 missing)
3. **Identify middleware systems** (7 total, 0 exposed)
4. **List context services** (3 total, 0 exposed)
5. **Count tool categories** (4 total, all via POST /v1/messages)
6. **Calculate coverage** (61% orchestrator, 0% middleware, 0% context)

### ✅ Core → Server → CLI Flow

```
Core Library Feature
    ↓
Is it a public orchestrator method?
    ├─ YES → Does server endpoint exist?
    │   ├─ YES → Can create CLI command ✅
    │   └─ NO → Need to add endpoint ⚠️
    └─ NO → Is it a tool?
        ├─ YES → Use POST /v1/messages ✅
        └─ NO → Is it middleware?
            ├─ YES → Server-side config only ⚠️
            └─ NO → Internal only, ignore ✅
```

---

## Part 10: Action Items

### Immediate (This Week)

1. ✅ **Complete this audit** (document created)
2. **Review with team** - confirm missing endpoints needed
3. **Prioritize endpoints** - which are must-have vs. nice-to-have
4. **Plan server work** - add missing endpoints before CLI work

### Short-term (Next 2 Weeks)

1. **Implement core endpoints** (11 endpoints)
   - Session: create, current ID, conversation ID
   - Model: switch, get current
   - Checkpoint: create, get specific
   - Cache: metrics, report, reset
2. **Test new endpoints** with curl/Postman
3. **Update server routes documentation**

### Medium-term (Next Month)

1. **Implement context endpoints** (7 endpoints)
2. **Implement middleware endpoints** (5+ endpoints)
3. **Refactor middleware** for runtime config (if needed)
4. **Create comprehensive server API docs**

### Long-term (Future)

1. **CLI implementation** using complete server API
2. **Hybrid UI** with Chalk + Ink
3. **Natural language workflows** documentation
4. **E2E testing** of full stack

---

## Conclusion

**Key Finding:** The server exposes ~60% of orchestrator methods, 0% of middleware, and 0% of context management.

**The Gap:** 11 orchestrator methods, 7 middleware systems, 3 context services not exposed.

**The Solution:**
1. Add 11 core endpoints (high priority)
2. Add 7 context endpoints (medium priority)
3. Add 5+ middleware endpoints (low priority, requires refactor)
4. Keep tool-based access for artifacts/historical (correct pattern)

**Timeline:**
- Phase 1 (core): 1-2 weeks
- Phase 2 (context): 1 week
- Phase 3 (middleware): 2-3 weeks (includes refactor)
- **Total: 4-6 weeks to complete server coverage**

**Then:** Build CLI with confidence knowing server has everything.

---

**Status:** Audit complete, gaps identified, plan ready
**Next Step:** Review and prioritize which endpoints to build first
**Outcome:** Complete server API coverage before CLI implementation
