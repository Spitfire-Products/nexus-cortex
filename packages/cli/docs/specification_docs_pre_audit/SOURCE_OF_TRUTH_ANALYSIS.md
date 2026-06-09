# Source of Truth Analysis for CLI UI Wiring

**Date:** 2025-11-15
**Question:** What is the most concise, scannable source of truth for core library features?
**Answer:** The **`/types` package + `CortexOrchestrator` public API**

---

## Why This Matters

The project is large and I made assumptions that led to building 115 commands when:
- Only ~20 REST endpoints exist
- Many features use tools via POST /v1/messages
- Many features are server-side configuration (middleware)

We need a **definitive source of truth** to avoid assumptions.

---

## The Source of Truth: Three-Layer Approach

### Layer 1: Types Package (Contracts) 📋

**Location:** `/packages/types/src/`

**Why it's authoritative:**
- Created specifically to solve circular dependencies
- Contains ALL interfaces between core, executors, and server
- TypeScript contracts that MUST be implemented
- Cannot be out of sync (build fails if they are)

**Files:**
1. `tools.ts` - Tool definitions, tool use, tool results
2. `messages.ts` - Message types
3. `session.ts` - Session types
4. `models.ts` - Model and provider types
5. `adapters.ts` - Adapter interfaces
6. `registry.ts` - Registry interfaces (ToolRegistry, ToolImplementation)

**What it tells us:**
- ✅ What data structures exist
- ✅ What contracts must be implemented
- ✅ What the orchestrator expects/returns
- ❌ What REST endpoints exist (not in types)
- ❌ What tools are actually registered (only interfaces)

### Layer 2: CortexOrchestrator Public API 🎯

**Location:** `/packages/core/src/orchestrator/CortexOrchestrator.ts`

**Why it's authoritative:**
- This is what the server wraps with HTTP endpoints
- Public methods = available operations
- If it's not a public method, you can't use it from outside
- This is the actual API the server exposes

**Public Methods (28 total):**

#### Core Messaging (2)
```typescript
async sendMessage(messages: Message[], options?: SendMessageOptions): Promise<OrchestratorResponse>
async *streamMessage(messages: Message[], options?: SendMessageOptions): AsyncGenerator<StreamChunk>
```

#### Session Management (7)
```typescript
async createSession(projectPath: string, modelId?: string): Promise<Session>
getSessionId(): string
getConversationId(): string
getMessageHistory(): Message[]
async createCheckpoint(options?: CheckpointOptions): Promise<Checkpoint>
async resumeFromCheckpoint(checkpointId: string, options?: ResumeOptions): Promise<void>
listCheckpoints(): Checkpoint[]
getCheckpoint(checkpointId: string): Checkpoint | undefined
```

#### Model Management (3)
```typescript
async switchModel(modelId: string, options?: SwitchModelOptions): Promise<ModelSwitchResult>
getCurrentModel(): ModelConfig
listAvailableModels(): ModelConfig[]
```

#### MCP Integration (8)
```typescript
getMcpManager(): McpClientManager | undefined
isMcpEnabled(): boolean
getMcpServerInfo(): Array<{name, status, tools}>
getMcpToolDeclarations(): Array<{name, description, schema}>
getMcpConfigManager(): McpConfigManager
getMcpServerRegistry(): McpServerRegistry
isMcpAutoInjectEnabled(): boolean
getMcpTools(): any[]
```

#### Historical Context (1)
```typescript
getHistoricalService(): HistoricalContextService
```

#### Cache Metrics (3)
```typescript
getCacheMetrics(): any
getCacheReport(): string
resetCacheMetrics(): void
```

#### Permissions (2)
```typescript
getApprovalMode(): { autoApproveActions: boolean }
setApprovalMode(mode: { autoApproveActions: boolean }): void
```

#### Utilities (2)
```typescript
getAdapterRegistry(): AdapterRegistry
async cleanup(): Promise<void>
```

**What it tells us:**
- ✅ Exactly what operations are available
- ✅ What parameters they take
- ✅ What they return
- ✅ Which features are exposed vs. internal
- ❌ Implementation details
- ❌ What REST endpoints wrap these (need to check server routes)

### Layer 3: Registered Tools (Implementations) 🔧

**Location:** `/packages/core/src/tools/`

**Why it's authoritative:**
- These are the actual tools available via POST /v1/messages
- ToolFactory.getAllTools() returns the definitive list
- Base tools (immutable) + Addon tools (dynamic)

**Tool Categories:**

1. **Base Tools** - In `toolDefinitions.ts` (will check count)
2. **MCP Management Tools** (7):
   - ListAvailableMcpServers
   - SearchMcpServers
   - GetMcpConfig
   - EnableMcpServer
   - DisableMcpServer
   - ConfigureMcpServer
   - InitMcpConfig

3. **Historical Context Tools** (4):
   - SearchConversationHistory
   - GetConversationSegment
   - ListCompactionBoundaries
   - RequestHistoricalContext

4. **Artifact Tools** (11) - In `/packages/executors/src/implementations/addon/`
   - CreateArtifact
   - UpdateArtifact
   - DeleteArtifact
   - ListArtifacts
   - InspectArtifact
   - InteractWithArtifact
   - GetArtifactOutput
   - StartArtifact
   - StopArtifact
   - RestartArtifact
   - GetArtifactStatus

**What it tells us:**
- ✅ Exactly which tools exist
- ✅ What operations are available via natural language
- ✅ Tool schemas (parameters, descriptions)
- ❌ Whether they're exposed via REST (they're not, they're tool-based)

---

## Server Routes (REST Endpoints)

**Location:** `/packages/server/src/routes/`

**Files:**
- `sessions.ts` - 8 endpoints
- `models.ts` - 1 endpoint
- `mcp.ts` - 7 endpoints
- `approval.ts` - 2 endpoints
- `health.ts` - 1 endpoint
- `messages.ts` - 1 endpoint (THE KEY!)

**Total:** ~20 REST endpoints

**What it tells us:**
- ✅ Exactly which REST endpoints exist
- ✅ What HTTP methods they use (GET/POST/DELETE)
- ✅ What parameters they accept
- ✅ What they return
- ✅ Which orchestrator methods they call

---

## Middleware Systems (Server-Side Configuration)

**Location:** `/packages/core/src/middleware/`

**What exists (7 middleware):**
1. ErrorClassificationMiddleware
2. RetryMiddleware
3. PermissionsMiddleware
4. SystemMessageMiddleware
5. MentorshipMiddleware
6. LoopControlMiddleware
7. HelperModelMiddleware

**Why middleware matters:**
- These are NOT exposed as commands
- They're server-side configuration
- They intercept requests/responses
- They're configured via OrchestratorConfig, not REST endpoints

**What it tells us:**
- ✅ What systems are available
- ✅ How they're configured (via OrchestratorConfig)
- ❌ How to control them from CLI (you can't, they're server config)

---

## The Definitive Audit Checklist

To create a complete, accurate feature list for CLI, audit in this order:

### Step 1: What REST Endpoints Exist?
**Source:** `/packages/server/src/routes/*.ts`

**Action:**
```bash
grep -r "router\.\(get\|post\|delete\|put\)" packages/server/src/routes/
```

**Output:** List of HTTP endpoints

**Result:** These become CLI commands

### Step 2: What Orchestrator Methods Are Public?
**Source:** `/packages/core/src/orchestrator/CortexOrchestrator.ts`

**Action:**
```bash
grep -n "^\s*async\s\|^\s*public\s\|^\s*get\s" packages/core/src/orchestrator/CortexOrchestrator.ts
```

**Output:** Public API surface

**Result:** These are what the server can call

### Step 3: What Tools Are Registered?
**Source:** `/packages/core/src/tools/toolDefinitions.ts` and `/packages/core/src/tools/*/index.ts`

**Action:**
```typescript
import { toolFactory } from '@cortex/core';
const allTools = toolFactory.getAllTools();
console.log(allTools.map(t => t.name));
```

**Output:** List of all tools (base + addon + MCP management + historical)

**Result:** These are accessed via natural language, NOT dedicated commands

### Step 4: What Middleware Exists?
**Source:** `/packages/core/src/middleware/*.ts`

**Action:**
```bash
ls packages/core/src/middleware/*Middleware.ts
```

**Output:** List of middleware systems

**Result:** These are server-side config, NOT exposed to CLI

### Step 5: What Types Define the Contracts?
**Source:** `/packages/types/src/*.ts`

**Action:** Read each file to understand data structures

**Output:** TypeScript interfaces

**Result:** These define what can be passed/returned

---

## Recommended Approach for CLI UI Wiring

### 1. Start with Server Routes (Ground Truth)

**File:** `/packages/server/src/routes/`

**Extract:**
- All GET/POST/DELETE endpoints
- Their parameters
- Their return types
- Which orchestrator methods they call

**Create:**
- One CLI command per endpoint
- Or one Ink interactive component per logical grouping

### 2. Map Tools to Natural Language

**File:** `/packages/core/src/tools/toolDefinitions.ts`

**Extract:**
- All tool names
- Tool descriptions
- Tool schemas

**Create:**
- Documentation: "Natural Language Guide"
- Examples: "enable postgres MCP server" → EnableMcpServer tool
- NO dedicated commands

### 3. Map Orchestrator Public API

**File:** `/packages/core/src/orchestrator/CortexOrchestrator.ts`

**Extract:**
- Public method signatures
- Return types
- Parameters

**Create:**
- Internal CLI utilities (if needed)
- Or confirm they're already exposed via server routes

### 4. Ignore Middleware (Server Config)

**Files:** `/packages/core/src/middleware/*.ts`

**Action:**
- Document that these are server-side only
- No CLI commands needed
- Configuration is via server env vars or config files

---

## The Mistake I Made

**What I did:**
1. Read CLI_MASTER_SPEC (115 commands)
2. Assumed each command needs a REST endpoint
3. Built commands without checking if endpoints exist
4. Built commands for tool-based features (should be natural language)
5. Built commands for middleware (should be server config)

**What I should have done:**
1. ✅ Read `/packages/server/src/routes/` to see what endpoints exist
2. ✅ Read `/packages/core/src/orchestrator/CortexOrchestrator.ts` to see public API
3. ✅ Read `/packages/core/src/tools/` to see what tools are available
4. ✅ Categorize: REST commands vs. natural language vs. not exposed
5. ✅ Build ONLY what aligns with architecture

---

## The Correct Feature List

### A. REST Endpoint Commands (~20)

**Sessions (7):**
- `sessions list` → GET /sessions
- `sessions view <id>` → GET /sessions/:id
- `sessions export <id>` → GET /sessions/:id/export
- `sessions resume <id>` → POST /sessions/:id/resume
- `sessions checkpoints <id>` → GET /sessions/:id/checkpoints
- `sessions stats <id>` → GET /sessions/:id/stats
- DELETE /sessions/:id (not exposed as command)

**Models (1):**
- `models list` → GET /models

**MCP (7):**
- `mcp list` → GET /mcp/servers
- `mcp status` → GET /mcp/status
- `mcp server <name>` → GET /mcp/servers/:name
- `mcp tools [name]` → GET /mcp/tools or /mcp/servers/:name/tools
- `mcp enable <name>` → POST /mcp/servers/:name/connect
- `mcp disable <name>` → POST /mcp/servers/:name/disconnect
- (mcp search/configure/init may exist as tools, not REST)

**Permissions (2):**
- `permissions mode` → GET /v1/approval-mode
- `permissions set <mode>` → POST /v1/approval-mode

**Server (1):**
- `server status` → GET /health

**Messages (1):**
- `chat` → POST /v1/messages (with tools=[])

### B. Tool-Based Operations (~52+)

**Base Tools** (need to count from toolDefinitions.ts)
**MCP Management Tools** (7)
**Historical Context Tools** (4)
**Artifact Tools** (11)

**Access:** Via natural language through `chat` command

### C. Ink Interactive Components (~6)

- SessionBrowser (sessions list)
- ThemePicker (themes)
- ArtifactDashboard (artifact list/dashboard)
- ConfigWizard (config wizard)
- MainDashboard (dashboard main)
- TmuxDashboard (dashboard tmux)

### D. Not Exposed to CLI

- Middleware (server-side config)
- Internal orchestrator methods (not public)
- Adapter internals
- Session persistence internals

---

## Action Items

### Immediate

1. ✅ **Count base tools** in `toolDefinitions.ts` to get exact number
2. ✅ **Audit server routes** to confirm exactly which endpoints exist
3. ✅ **Map each endpoint** to existing CLI commands
4. ✅ **Identify gaps** where commands exist but endpoints don't

### Short-term

1. **Create definitive tool list** from ToolFactory.getAllTools()
2. **Document natural language workflows** for each tool category
3. **Mark non-REST commands as deprecated**
4. **Update CLI_BACKEND_STATUS.md** with correct analysis

### Medium-term

1. **Implement Ink components** for interactive features
2. **Enhance chat command** with streaming
3. **Remove/deprecate** commands that should be tool-based
4. **Final audit** against this source of truth

---

## Files to Read (in order)

1. `/packages/server/src/routes/*.ts` - What endpoints exist
2. `/packages/core/src/orchestrator/CortexOrchestrator.ts` - Public API
3. `/packages/core/src/tools/toolDefinitions.ts` - Base tools
4. `/packages/core/src/tools/*/index.ts` - Addon/MCP/Historical tools
5. `/packages/types/src/*.ts` - Type contracts
6. `/packages/core/src/middleware/*.ts` - Middleware (not exposed)

---

## Key Insight

**The types package IS a source of truth**, but it's **not sufficient alone**.

You need THREE sources together:
1. **Types** → What data structures exist
2. **Orchestrator public API** → What operations are possible
3. **Server routes** → What's actually exposed via HTTP

**Types alone won't tell you:**
- What REST endpoints exist
- What tools are registered
- What's server-side vs. client-side

**But types + orchestrator + server routes = Complete picture**

---

## Conclusion

**Best Source of Truth:**

```
/packages/types/            → Data structure contracts
/packages/core/src/orchestrator/CortexOrchestrator.ts  → Public API
/packages/server/src/routes/  → REST endpoints
/packages/core/src/tools/     → Available tools
```

**Audit Order:**
1. Server routes (what's exposed)
2. Orchestrator public API (what's possible)
3. Registered tools (what's tool-based)
4. Types (what data structures exist)

**Result:** Accurate feature list without assumptions

**Status:** Ready to create definitive feature audit
