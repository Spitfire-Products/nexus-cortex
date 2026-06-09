# Phase 2 Progress Report

**Date**: 2025-11-16
**Phase**: CLI Command Cleanup & Implementation
**Status**: 🔄 **IN PROGRESS** (Week 1 Complete, Week 2 In Progress)

---

## Completed: Week 1 - Archive Broken Commands ✅

### Commands Archived: 67 total

#### Invalid Commands (48 files) → `docs/commands_archive/invalid/`
- **Models** (4): favorites, favorite, alias, test
- **Sessions** (4): compare, merge, split, history
- **Server** (2): stop, logs
- **Config** (3): wizard, validate, import
- **Permissions** (4): logs, block, allow, actions
- **Stats** (2): All files
- **Debug** (4): All files
- **Mentorship** (6): All files
- **Helper** (4): All files
- **History** (4): All files
- **Limits** (2): All files
- **Retry** (3): All files
- **System** (3): All files (wrong paths)
- **Dashboard** (3): All files (wrong port)

#### Tool-Based Commands (19 files) → `docs/commands_archive/tool-based/`
- **MCP** (2): search, configure
- **Artifacts** (7): create, inspect, interact, modify, cleanup, view, dashboard
- **Tmux** (5): create, send, capture, snapshot, kill
- **Sandbox** (3): All files
- **Templates** (2): All files

---

## In Progress: Week 2 - Fix & Add Commands 🔄

### Commands Fixed: 2/10

1. ✅ `middleware/list.ts` - Changed GET /middleware/list → GET /middleware/config
2. ✅ `middleware/status.ts` - Changed GET /middleware/status/:name → GET /middleware/:name/status

### Commands To Fix: 8 remaining

3. ⏳ `middleware/enable.ts` - Change POST /middleware/enable/:name → POST /middleware/:name/enable
4. ⏳ `middleware/disable.ts` - Change POST /middleware/disable/:name → POST /middleware/:name/disable
5. ⏳ `middleware/config.ts` - Change GET /middleware/config/:name → GET /middleware/config (filter)
6. ⏳ `context/status.ts` - Change GET /context/status → GET /sessions/:id/context
7. ⏳ `context/compact.ts` - Change POST /context/compact → POST /sessions/:id/compaction
8. ⏳ `context/boundaries.ts` - Change GET /context/boundaries → GET /sessions/:id/compaction/boundaries
9. ⏳ `context/savings.ts` - Calculate from GET /sessions/:id/cache/metrics
10. ⏳ `session/compact.ts` - Change POST /sessions/compact → POST /sessions/:id/compaction

### New Commands To Create: 12

Phase 1 endpoints that need CLI commands:

1. ⏳ `models/switch.ts` → POST /sessions/:id/model
2. ⏳ `tools/list.ts` → GET /tools
3. ⏳ `tools/info.ts` → GET /tools/:name
4. ⏳ `permissions/tools.ts` → GET /permissions/tools
5. ⏳ `permissions/grant.ts` → POST /permissions/tool/:name (action: grant)
6. ⏳ `permissions/revoke.ts` → POST /permissions/tool/:name (action: revoke)
7. ⏳ `cache/metrics.ts` → GET /sessions/:id/cache/metrics
8. ⏳ `system-messages/list.ts` → GET /system-messages
9. ⏳ `system-messages/view.ts` → GET /system-messages/:id
10. ⏳ `system-messages/reload.ts` → POST /system-messages/reload
11. ⏳ `context/budget.ts` → GET /sessions/:id/context (new command for budget info)
12. ⏳ `context/utilization.ts` → GET /sessions/:id/context (new command for utilization %)

---

## Expected Final State

### Commands After Phase 2 Cleanup

| Category | Count | Notes |
|----------|-------|-------|
| **Working (kept)** | ~50 | Existing commands that already work |
| **Fixed** | 10 | Commands with corrected endpoint paths |
| **New** | 12 | Commands for Phase 1 endpoints |
| **Total** | **~72** | Clean, working CLI |
| **Archived** | 67 | Broken/tool-based commands preserved for reference |

---

## Directory Structure After Cleanup

```
packages/cli/src/commands/
├── chat/              # 2 commands
├── models/            # 6 commands (5 kept + 1 new)
├── session/           # 8 commands (7 kept + 1 fixed)
├── server/            # 1 command
├── config/            # 4 commands
├── mcp/               # 6 commands (4 kept)
├── permissions/       # 6 commands (2 kept + 4 new)
├── middleware/        # 5 commands (5 fixed)
├── context/           # 6 commands (5 fixed/new)
├── cache/             # 1 command (new)
├── tools/             # 2 commands (new)
├── system-messages/   # 3 commands (new)
├── artifact/          # 3 commands (list, stop, restart kept)
├── tmux/              # 1 command (list kept)
└── sandbox/           # 0 commands (all tool-based)

docs/commands_archive/
├── invalid/           # 48 archived invalid commands
└── tool-based/        # 19 archived tool-based commands
```

---

## Next Steps

1. ✅ **Complete fixing remaining 8 commands** - Update endpoint paths
2. ✅ **Create 12 new commands** - Implement Phase 1 endpoint wrappers
3. ✅ **Update index.ts** - Remove archived command registrations
4. ✅ **Build and test** - Verify all commands work
5. ✅ **Document** - Create user-facing command reference

---

## Benefits of Phase 2 Cleanup

### Before
- 115 commands total
- 60 broken (calling non-existent endpoints)
- Confusing user experience
- Failed commands clutter CLI help

### After
- 72 working commands
- 100% success rate
- Clear, reliable UX
- Full Phase 1 feature coverage
- Archived commands preserved for future reference

---

**Status**: Week 1 complete (archiving), Week 2 in progress (fixing + adding)
**Remaining Work**: ~8 fixes + 12 new commands + index updates + testing
**Estimated Completion**: End of current session or next session

---

Generated: 2025-11-16
