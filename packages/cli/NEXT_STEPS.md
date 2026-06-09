# CLI Redesign: Next Steps

**Created**: Based on package audits, server capability gaps, and CLI reality check
**Last Updated**: 2025-11-16

---

## Essential Context Documents (Read These First)

### 1. Package Audits (Grounded Truth from Code)
- **Types**: `/home/runner/workspace/nexus-cortex/packages/types/AUDIT.md`
- **Core**: `/home/runner/workspace/nexus-cortex/packages/core/AUDIT.md`
- **Executors**: `/home/runner/workspace/nexus-cortex/packages/executors/AUDIT.md`
- **Server**: `/home/runner/workspace/nexus-cortex/packages/server/AUDIT.md`

### 2. Implementation Plans (Current Direction)
- **Main Plan**: `IMPLEMENTATION_PLAN_COMPLETE.md` (9-week plan with code examples)
- **Feature Mapping**: `CLI_FEATURE_MAPPING.md` (All core features → CLI access paths)
- **Visual UI Plan**: `VISUAL_UI_PLAN.md` (13 themes + Ink components + mode switching)
- **Command Audit**: `COMMAND_AUDIT.md` (139 commands breakdown: keep 60, archive 60, add 20)
- **CLI README**: `README.md` (Complete overview of three-mode architecture)

### 3. Training & Methodology Documents
- **Research Methodology**: `/home/runner/workspace/nexus-cortex/training_docs/ACTIVE_DISCOVERY_GROUNDED_RESEARCH_METHODOLOGY.md`
  - How to research before implementing
  - Active discovery patterns
  - User directives (no mocks, real APIs, complete TODOs)
- **Component Map**: `/home/runner/workspace/nexus-cortex/training_docs/COMPONENT_RELATIONSHIP_MAP.md`
  - Complete architecture reference
  - 15-dependency orchestrator pattern
  - All component relationships
  - Data flow paths
- **Test Analysis Guide**: `/home/runner/workspace/nexus-cortex/training_docs/HOW_TO_ANALYZE_ALL_TESTS.md`
  - How to find ALL tests for a component
  - Test types: unit, integration, e2e, smoke
  - Analysis methodology

### 4. Archive Reference (Pre Audit Analysis and project realignment docs)
- **Specification Archive**: `docs/specification_docs_pre_audit/`
  - `COMPLETE_FEATURE_AUDIT.md` - Extensive features initially missed
  - `HYBRID_UI_IMPLEMENTATION_PLAN.md` - Working Chalk + Ink architecture
  - `SOURCE_OF_TRUTH_ANALYSIS.md` - Methodology for avoiding assumptions
- **Commands Archive**: `docs/commands_system_(unused)/`
  - 115 commands that were built on assumptions
  - Reference only - do NOT implement these

---

## Summary

**Current CLI**: 139 commands (not 115), most calling non-existent endpoints

**Target CLI**: Three-mode interface:
1. Deterministic commands (~80 slash commands)
2. Interactive Ink components (10 components)
3. Natural language (tool-based)

**Foundation Exists**:
- ✅ `src/commands/chat/interactive.ts` - Basic streaming chat working
- ✅ `src/client/CortexClient.ts` - HTTP client with streaming
- ✅ Theme system in `src/themes/`
- ✅ Readline input handling

**Missing**:
- ❌ 16 server endpoints (model switching, context, cache, timeline, etc.)
- ❌ Status bar (model, tokens, session, MCP)
- ❌ Quick actions (slash shortcuts)
- ❌ 10 Ink interactive components
- ❌ Theme Manager with runtime switching

---

## Quick Start for Fresh Session

**If you're a new agent picking up this work**:

1. **Read Training Docs First** (30 min):
   - `training_docs/ACTIVE_DISCOVERY_GROUNDED_RESEARCH_METHODOLOGY.md` - How to research
   - `training_docs/COMPONENT_RELATIONSHIP_MAP.md` - Architecture overview

2. **Read Package Audits** (grounded truth from actual code):
   - `packages/types/AUDIT.md`
   - `packages/core/AUDIT.md`
   - `packages/executors/AUDIT.md`
   - `packages/server/AUDIT.md`

3. **Read Implementation Plans**:
   - `IMPLEMENTATION_PLAN_COMPLETE.md` - 9-week plan with specific code examples
   - `VISUAL_UI_PLAN.md` - Complete visual UI architecture
   - `CLI_FEATURE_MAPPING.md` - What features need CLI access

4. **Understand What NOT to Do**:
   - `COMMAND_AUDIT.md` - Why 139 commands exist but 60 need archiving
   - `docs/specification_docs_pre_audit/` - Contains much of what the project is supposed to be but needed code first audit as ground truth first - good reference of what the project is supposed to look like and accomplish

5. **Start Implementation** at Phase 1 (below)

---

## Analysis Documents (Context)

- **Server Capability Gaps**: `packages/server/SERVER_CAPABILITY_GAPS.md`
  - What server exposes vs what core/executors provide
  - 16 missing endpoints identified
- **CLI Reality Check**: `CLI_REALITY_CHECK.md`
  - Why 115-command approach was flawed
  - Natural language solution comparison

---

## Immediate Actions

### 1. Add Server Endpoints (packages/server)
**File**: `packages/server/src/routes/sessions.ts`

Add 5 endpoints:
```typescript
POST /sessions/:id/model        // switchModel() already exists in orchestrator
GET  /sessions/:id/context      // ContextBudgetManager exists
GET  /sessions/:id/cache        // CacheMetricsAccumulator exists
GET  /sessions/:id/timeline     // SessionTimeline.toJSON() exists
```

**File**: `packages/server/src/routes/tools.ts` (new)
```typescript
GET /tools                       // toolDefinitions.ts exists
```

### 2. Update CLI Client
**File**: `packages/cli/src/client/CortexClient.ts`

Add methods:
```typescript
async listSessions(): Promise<Session[]>
async getSession(id: string): Promise<Session>
async getSessionStats(id: string): Promise<Stats>
async exportSession(id: string): Promise<any>
async getMcpStatus(): Promise<McpStatus>
async getTools(): Promise<Tool[]>
```

### 3. Create Status Bar
**File**: `packages/cli/src/ui/StatusBar.ts` (new)

Display inline:
- Current model
- Token count / context window
- Session ID
- MCP servers active
- Artifacts running

### 4. Add Quick Actions
**File**: `packages/cli/src/commands/QuickActions.ts` (new)

Pattern match slash commands:
```typescript
/model <name>     → Switch model
/approve on|off   → Toggle approval
/export           → Export session
/stats            → Show stats
/sessions         → List sessions
/dashboard        → Open port 4001
/mcp status       → MCP status
/help             → Show shortcuts
/exit             → Exit
```

### 5. Integrate into Interactive Chat
**File**: `packages/cli/src/commands/chat/interactive.ts`

- Add status bar rendering
- Intercept slash commands before sending to server
- Handle quick actions locally

---

## Implementation Order

### Week 1: Server Endpoints
1. Add 5 endpoints to packages/server
2. Test with curl/Postman
3. Update server AUDIT.md

### Week 2: CLI Client + Status Bar
1. Add methods to CortexClient
2. Create StatusBar component
3. Integrate status bar into interactive chat

### Week 3: Quick Actions
1. Create QuickActions handler
2. Add pattern matching to interactive chat
3. Test all 10-12 shortcuts

### Week 4: Archive Old Commands (NEEDS REEVALUATION!!!)
1. Move src/commands/ to docs/commands_system_(archived)/
2. Keep only chat/ and create commands/
3. Update package.json (remove commander, inquirer)

### Week 5: Documentation + Testing
1. Update CLI README
2. Test all features
3. Create user guide for slash shortcuts

---

## Files to Create/Modify

**Server (packages/server)**:
- Modify: `src/routes/sessions.ts` (+50 lines)
- Create: `src/routes/tools.ts` (+30 lines)
- Modify: `src/index.ts` (register tools route)

**CLI (packages/cli)**:
- Modify: `src/client/CortexClient.ts` (+100 lines)
- Create: `src/ui/StatusBar.ts` (+150 lines)
- Create: `src/commands/QuickActions.ts` (+200 lines)
- Modify: `src/commands/chat/interactive.ts` (+50 lines)

**Total New Code**: ~580 lines
**Code Deleted**: ~15,000+ lines (115 command files)

---

## Testing Checklist

**Server Endpoints**:
- [ ] POST /sessions/:id/model switches model successfully
- [ ] GET /sessions/:id/context returns budget info
- [ ] GET /sessions/:id/cache returns cache metrics
- [ ] GET /sessions/:id/timeline returns timeline events
- [ ] GET /tools returns all available tools

**CLI Chat**:
- [ ] Status bar displays current model
- [ ] Status bar updates token count after each message
- [ ] Status bar shows active MCP servers
- [ ] Streaming works with markdown rendering
- [ ] Error messages display correctly

**Quick Actions**:
- [ ] /model <name> switches model
- [ ] /approve on|off toggles approval
- [ ] /stats shows session statistics
- [ ] /sessions lists all sessions
- [ ] /dashboard opens browser to port 4001
- [ ] /help shows available shortcuts

**Natural Language Queries**:
- [ ] "show me my sessions" → calls GET /sessions
- [ ] "switch to claude opus" → calls POST /sessions/:id/model
- [ ] "what's my token usage" → calls GET /sessions/:id/stats
- [ ] "enable postgres MCP" → model uses EnableMcpServer tool
- [ ] "create a react app" → model uses CreateArtifactTool

---

## Success Criteria

1. **User can chat naturally** - No need to know commands
2. **Status visible inline** - Model, tokens, MCP, artifacts shown
3. **Quick shortcuts work** - 10-12 slash commands for common actions
4. **All features accessible** - Sessions, MCP, artifacts, stats via conversation
5. **Faster to ship** - 5 weeks vs 10-14 weeks (command-based)

---

## Current Project State

**Completed**:
- ✅ Package audits (types, core, executors, server)
- ✅ Server capability gaps analysis
- ✅ CLI reality check (139 commands vs actual capabilities)
- ✅ Complete implementation plan (9 weeks, 6 phases)
- ✅ Visual UI plan (13 themes + Ink components)
- ✅ Feature mapping (all core features → CLI access)
- ✅ Archive strategy (60 commands to archive)
- ✅ This document with all context links

**Ready to Start**:
1. Add 16 server endpoints (Phase 1)
2. Update CLI client with new methods
3. Implement Theme Manager + 13 themes
4. Create 10 Ink interactive components
5. Create status bar
6. Add quick actions (~80 slash commands)
7. Archive 60 old commands

---

## Key Principles (From Training Docs)

**Active Discovery Methodology**:
- ✅ Search for existing code patterns BEFORE implementing
- ✅ Use real API calls and data, NOT mocks
- ✅ Read COMPLETE files, not snippets
- ✅ Validate against architecture docs continuously
- ✅ Complete all TODOs, don't leave placeholders

**Architecture Patterns to Follow**:
- Adapter pattern for provider-specific code
- Dependency injection for configurability
- Registry pattern for dynamic lookup
- Real implementations in tests (no mocks)

**What We Learned**:
- 139 commands were built on assumptions, not actual server capabilities
- 40 commands call endpoints that don't exist
- 20 commands duplicate tool functionality (should use natural language)
- Natural language approach is 50% faster (5-6 weeks vs 10-14 weeks)
- Need THREE modes: deterministic commands + interactive components + natural language

---

## Document Cross-Reference Map

```
Training Docs (Methodology)
├── training_docs/ACTIVE_DISCOVERY_GROUNDED_RESEARCH_METHODOLOGY.md
├── training_docs/COMPONENT_RELATIONSHIP_MAP.md (architecture)
└── training_docs/HOW_TO_ANALYZE_ALL_TESTS.md

Package Audits (Grounded Truth)
├── packages/types/AUDIT.md
├── packages/core/AUDIT.md
├── packages/executors/AUDIT.md
└── packages/server/AUDIT.md

Implementation Plans (Current Direction)
├── IMPLEMENTATION_PLAN_COMPLETE.md (9-week plan)
├── CLI_FEATURE_MAPPING.md (all features → CLI)
├── VISUAL_UI_PLAN.md (themes + Ink)
├── COMMAND_AUDIT.md (139 commands breakdown)
├── README.md (CLI overview)
└── NEXT_STEPS.md (this file)

Analysis (Context)
├── docs/specification_docs_pre_audit/ (READ THESE AND DISCUSS)
├── packages/server/SERVER_CAPABILITY_GAPS.md
└── CLI_REALITY_CHECK.md

Archive (Reference Only - DON'T Implement)
└── docs/commands_system_(unused)/
```

---

## Final Success Criteria

**Phase 1 Complete When**:
- [ ] 16 server endpoints added and tested
- [ ] All endpoints return correct data from core library
- [ ] Tests pass with real API calls (no mocks)

**Full Project Complete When**:
- [ ] User can chat naturally with full core library access
- [ ] Status bar shows model, tokens, session, MCP status
- [ ] 10-12 slash shortcuts work for common actions
- [ ] 10 Ink components provide interactive UIs
- [ ] Theme switching works with 13 themes
- [ ] All 60 invalid/duplicate commands archived
- [ ] ~80 valid commands remain (60 kept + 20 new)
- [ ] Zero endpoints called that don't exist
- [ ] Complete test coverage with real APIs

---

**Last Updated**: 2025-11-16
**Next Agent**: Read "Quick Start for Fresh Session" at the top, then begin Phase 1
