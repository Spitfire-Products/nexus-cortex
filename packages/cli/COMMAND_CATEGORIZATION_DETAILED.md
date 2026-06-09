# Command Categorization: Detailed Analysis

**Date**: 2025-11-16
**Purpose**: Systematic categorization of all 115 CLI commands
**Based on**: Actual endpoint calls + Phase 1 server implementation

---

## Category 1: ✅ Working Commands (Keep - ~50 commands)

### Sessions (8 working)
- `session/list.ts` → GET /sessions ✅
- `session/view.ts` → GET /sessions/:id + GET /sessions/:id/messages ✅
- `session/export.ts` → GET /sessions/:id/export ✅
- `session/stats.ts` → GET /sessions/:id/stats ✅
- `session/checkpoints.ts` → GET /sessions/:id/checkpoints ✅
- `session/resume.ts` → POST /sessions/:id/resume ✅
- `session/search.ts` → GET /sessions (local filter) ✅

### MCP (6 working)
- `mcp/list.ts` → GET /mcp/servers ✅
- `mcp/server.ts` → GET /mcp/servers/:name ✅
- `mcp/status.ts` → GET /mcp/status ✅
- `mcp/tools.ts` → GET /mcp/tools OR /mcp/servers/:name/tools ✅
- `mcp/enable.ts` → POST /mcp/servers/:name/connect ✅
- `mcp/disable.ts` → POST /mcp/servers/:name/disconnect ✅

### Permissions (2 working after Phase 1)
- `permissions/mode.ts` → GET /v1/approval-mode ✅
- `permissions/set.ts` → POST /v1/approval-mode ✅
- `permissions/policies.ts` → GET /permissions/policies ✅ **NEW IN PHASE 1**

### Models (3 working)
- `models/list.ts` → GET /models ✅
- `models/info.ts` → GET /models (filter locally) ✅
- `models/search.ts` → GET /models (filter locally) ✅
- `models/cost.ts` → GET /models (calculate locally) ✅
- `models/providers.ts` → GET /models (group locally) ✅ (client-side grouping)

### Server (1 working)
- `server/status.ts` → GET /health ✅

### Config (4 working - local file operations)
- `config/get.ts` → Read .env file ✅
- `config/set.ts` → Write .env file ✅
- `config/list.ts` → Read .env file ✅
- `config/categories.ts` → Read .env file ✅

### Chat (2 working)
- `chat/interactive.ts` → POST /v1/messages ✅
- `chat/message.ts` → POST /v1/messages ✅

**Total Working: ~50 commands**

---

## Category 2: 🔧 Fixable Commands (Need Minor Updates - ~10 commands)

These call endpoints that exist but with wrong paths/params:

### Middleware (5 fixable)
- `middleware/list.ts` → Calls GET /middleware/list
  - **Fix**: Change to GET /middleware/config ✅
- `middleware/status.ts` → Calls GET /middleware/status/:name
  - **Fix**: Change to GET /middleware/:name/status ✅
- `middleware/config.ts` → Calls GET /middleware/config/:name
  - **Fix**: Read from GET /middleware/config and filter client-side
- `middleware/enable.ts` → Calls POST /middleware/enable/:name
  - **Fix**: Change to POST /middleware/:name/enable (returns 501)
- `middleware/disable.ts` → Calls POST /middleware/disable/:name
  - **Fix**: Change to POST /middleware/:name/disable (returns 501)

### Context (4 fixable)
- `context/status.ts` → Calls GET /context/status
  - **Fix**: Change to GET /sessions/:id/context ✅
- `context/compact.ts` → Calls POST /context/compact
  - **Fix**: Change to POST /sessions/:id/compaction ✅
- `context/boundaries.ts` → Calls GET /context/boundaries
  - **Fix**: Change to GET /sessions/:id/compaction/boundaries ✅
- `context/savings.ts` → Calls GET /context/savings
  - **Fix**: Calculate from GET /sessions/:id/cache/metrics ✅

### Session (1 fixable)
- `session/compact.ts` → Calls POST /sessions/compact
  - **Fix**: Change to POST /sessions/:id/compaction ✅

**Total Fixable: ~10 commands**

---

## Category 3: ❌ Invalid Commands (Archive - ~35 commands)

These call endpoints that DON'T exist and won't be added:

### Models (4 invalid - no favorites system)
- `models/favorites.ts` → GET /models/favorites ❌
- `models/favorite.ts` → POST /models/favorite ❌
- `models/alias.ts` → GET /models/aliases, POST /models/alias ❌
- `models/test.ts` → POST /models/test ❌

### Sessions (3 invalid - no merge/split/compare features)
- `session/compare.ts` → POST /sessions/compare ❌
- `session/merge.ts` → POST /sessions/merge ❌
- `session/split.ts` → POST /sessions/split ❌
- `session/history.ts` → GET /sessions/:id/history ❌ (use timeline instead)

### Server (2 invalid - no stop/logs endpoints)
- `server/stop.ts` → POST /server/stop ❌
- `server/logs.ts` → GET /server/logs ❌

### Config (3 invalid - file-based)
- `config/wizard.ts` → POST /config/wizard ❌
- `config/validate.ts` → POST /config/validate ❌
- `config/import.ts` → POST /config/import ❌

### Permissions (3 invalid - different API)
- `permissions/logs.ts` → GET /v1/permissions/logs ❌
- `permissions/block.ts` → POST /permissions/block ❌
- `permissions/allow.ts` → POST /permissions/allow ❌
- `permissions/actions.ts` → GET /permissions/actions ❌

### Stats (all invalid - 2 commands)
- `stats/global.ts` → GET /stats/global ❌
- `stats/session.ts` → Uses GET /sessions/:id but redundant with session/stats.ts

### Debug (all invalid - 4 commands)
- `debug/logs.ts` → GET /debug/logs ❌
- `debug/errors.ts` → GET /debug/errors ❌
- `debug/tools.ts` → GET /debug/tools ❌
- `debug/middleware.ts` → GET /debug/middleware ❌

### Mentorship (all invalid - 6 commands)
- `mentorship/status.ts` → GET /mentorship/status ❌
- `mentorship/enable.ts` → POST /mentorship/enable ❌
- `mentorship/disable.ts` → POST /mentorship/disable ❌
- `mentorship/keywords.ts` → GET/POST /mentorship/keywords/* ❌
- `mentorship/model.ts` → POST /mentorship/model ❌
- `mentorship/log.ts` → GET /mentorship/log ❌

### Helper (all invalid - 4 commands)
- `helper/status.ts` → GET /helper/status ❌
- `helper/test.ts` → POST /helper/test ❌
- `helper/history.ts` → GET /helper/history ❌
- `helper/set.ts` → POST /helper/set ❌

### History (all invalid - 4 commands)
- `history/status.ts` → GET /history/status ❌
- `history/enable.ts` → POST /history/enable ❌
- `history/disable.ts` → POST /history/disable ❌
- `history/view.ts` → GET /history/view/:sessionId ❌

### Limits (all invalid - 2 commands)
- `limits/status.ts` → GET /limits/status ❌
- `limits/set.ts` → POST /limits/set ❌

### Retry (all invalid - 3 commands)
- `retry/status.ts` → GET /retry/status ❌
- `retry/stats.ts` → GET /retry/stats ❌
- `retry/classify.ts` → POST /errors/classify ❌

### System (all invalid - 3 commands, wrong path)
- `system/list.ts` → GET /system/list ❌ (should be /system-messages)
- `system/view.ts` → GET /system/view/:name ❌ (should be /system-messages/:id)
- `system/set.ts` → POST /system/set ❌

### Dashboard (all invalid - 3 commands, wrong port)
- `dashboard/main.ts` → GET /dashboard ❌ (dashboard is on port 4001, not 4000)
- `dashboard/tmux.ts` → GET /dashboard/tmux ❌
- `dashboard/sandbox.ts` → GET /dashboard/sandbox ❌

**Total Invalid: ~45 commands**

---

## Category 4: 🧰 Tool-Based Commands (Archive - ~20 commands)

These should use natural language + tools instead of dedicated commands:

### Artifacts (11 tool-based)
- `artifact/create.ts` → Use CreateArtifactTool
- `artifact/inspect.ts` → Use InspectSandboxTool
- `artifact/interact.ts` → Use InteractWithSandboxTool
- `artifact/modify.ts` → Use ModifySandboxTool
- `artifact/stop.ts` → POST /artifact/stop (could keep for convenience)
- `artifact/restart.ts` → POST /artifact/restart (could keep for convenience)
- `artifact/view.ts` → GET /artifact/view/:id (dashboard on port 4001)
- `artifact/dashboard.ts` → GET /artifact/dashboard (dashboard on port 4001)
- `artifact/status.ts` → GET /artifact/status/:id (could keep for convenience)
- `artifact/list.ts` → GET /artifact/list (dashboard API on port 4001, could keep)
- `artifact/cleanup.ts` → POST /artifact/cleanup

### Tmux (6 tool-based)
- `tmux/create.ts` → Use TmuxSessionTool
- `tmux/send.ts` → Use TmuxSessionTool
- `tmux/capture.ts` → Use TmuxSessionTool
- `tmux/snapshot.ts` → Use TmuxSessionTool
- `tmux/list.ts` → GET /tmux/list (could keep for convenience)
- `tmux/kill.ts` → POST /tmux/kill

### Sandbox (2 tool-based)
- `sandbox/screenshot.ts` → POST /sandbox/screenshot
- `sandbox/logs.ts` → GET /sandbox/logs/:id
- `sandbox/interact.ts` → POST /sandbox/interact

### Templates (2 tool-based)
- `templates/list.ts` → GET /templates/list
- `templates/create.ts` → POST /templates/create

### MCP (2 tool-based, rest are valid)
- `mcp/search.ts` → Use SearchMcpServers tool
- `mcp/configure.ts` → Use ConfigureMcpServer tool

**Total Tool-Based: ~25 commands**

---

## Category 5: ⭐ Missing Commands (Add These - ~15 commands)

New endpoints from Phase 1 that need commands:

### Model Switching (1 new)
- `models/switch.ts` → POST /sessions/:id/model **MISSING**

### Tools (2 new)
- `tools/list.ts` → GET /tools **MISSING**
- `tools/info.ts` → GET /tools/:name **MISSING**

### Permissions (2 new)
- `permissions/tools.ts` → GET /permissions/tools **MISSING**
- `permissions/grant.ts` → POST /permissions/tool/:name (action: grant) **MISSING**
- `permissions/revoke.ts` → POST /permissions/tool/:name (action: revoke) **MISSING**

### Cache (1 new)
- `cache/metrics.ts` → GET /sessions/:id/cache/metrics **MISSING**

### System Messages (3 new)
- `system-messages/list.ts` → GET /system-messages **MISSING**
- `system-messages/view.ts` → GET /system-messages/:id **MISSING**
- `system-messages/reload.ts` → POST /system-messages/reload **MISSING**

### Context Strategy (1 new)
- `context/strategy.ts` → Already exists but wrong endpoint path (needs fix)

**Total Missing: ~12 new commands needed**

---

## Summary Table

| Category | Count | Action |
|----------|-------|--------|
| ✅ Working | ~50 | **Keep as-is** |
| 🔧 Fixable | ~10 | **Fix endpoint paths** |
| ❌ Invalid | ~45 | **Archive to docs/commands_archive/invalid/** |
| 🧰 Tool-Based | ~25 | **Archive to docs/commands_archive/tool-based/** |
| ⭐ Missing | ~12 | **Create new commands** |
| **Total Current** | **~142** | **(includes some duplicates in categorization)** |
| **Total After Cleanup** | **~72** | **(50 kept + 10 fixed + 12 new)** |

---

## Phase 2 Action Plan

### Week 1: Archive Broken Commands
1. Create archive directories
2. Move ~70 commands (45 invalid + 25 tool-based) to archive
3. Update CLI index.ts to remove archived commands
4. Document why each was archived

### Week 2: Fix & Add Commands
1. Fix 10 fixable commands (update endpoint paths)
2. Create 12 new commands for Phase 1 endpoints
3. Build and test CLI
4. Verify all ~72 commands work

---

Generated: 2025-11-16
