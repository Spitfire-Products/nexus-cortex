# CLI Reality Check: 115 Commands vs Actual Capabilities

**Comparison**: Command assumptions vs grounded truth from package audits

---

## The Problem

**115 Commands Built On**:
- Assumptions about server endpoints
- Assumptions about core features
- No verification against actual code

**Result**: Commands for features that don't exist or aren't exposed

---

## Commands vs Reality

### MCP Commands (9 commands) - Phase 2 Priority

**Commands Assumed**:
```
mcp list, mcp search, mcp status, mcp enable, mcp disable,
mcp configure, mcp init, mcp edit, mcp validate
```

**Reality**:
- ✅ Core: 7 MCP management tools exist
- ✅ Server: GET /mcp/servers, GET /mcp/tools, POST /mcp/servers/:name/connect
- ❌ Server: No mcp search, configure, validate endpoints
- **Access**: Via tools through POST /v1/messages (tool-based, not REST)

**For Natural Language CLI**:
- User says: "enable postgres MCP server"
- CLI calls: POST /v1/messages with EnableMcpServer tool
- No commands needed - model handles it

---

### Session Commands (13 commands across phases)

**Commands Assumed**:
```
sessions list, sessions view, sessions export, sessions resume,
sessions checkpoints, sessions stats, sessions search, sessions delete,
sessions create, sessions switch, sessions rename, sessions archive, sessions compare
```

**Reality**:
- ✅ Server: GET /sessions, GET /sessions/:id, GET /sessions/:id/messages, DELETE /sessions/:id, GET /sessions/:id/export, GET /sessions/:id/checkpoints, POST /sessions/:id/resume, GET /sessions/:id/stats
- ❌ Server: No search, rename, archive, compare, create endpoints
- ❌ Core: No session comparison feature exists

**For Natural Language CLI**:
- Sessions managed automatically (stateful orchestrator)
- User says: "show me my recent sessions"
- CLI calls: GET /sessions, displays formatted
- User says: "export this session"
- CLI calls: GET /sessions/:id/export
- No explicit commands - conversational

---

### Model Commands (7 commands)

**Commands Assumed**:
```
models list, models info, models search, models compare,
models cost, models test, models favorites
```

**Reality**:
- ✅ Server: GET /models (complete model registry)
- ❌ Server: No search, compare, test, favorites endpoints
- ❌ Core: No model favorites system exists

**For Natural Language CLI**:
- User says: "show me available models"
- CLI calls: GET /models, displays
- User says: "switch to Claude Opus"
- CLI sends POST /v1/messages with model parameter
- User says: "compare GPT-4 and Claude costs"
- CLI fetches GET /models, computes locally
- No commands - natural interaction

---

### Permissions Commands (4 commands)

**Commands Assumed**:
```
permissions mode, permissions set, permissions auto-approve, permissions logs
```

**Reality**:
- ✅ Server: GET /v1/approval-mode, POST /v1/approval-mode
- ❌ Server: No permission logs endpoint
- ❌ Core: PermissionAuditLogger exists but not exposed

**For Natural Language CLI**:
- Approval prompts show inline during conversation
- User says: "auto-approve all actions"
- CLI calls: POST /v1/approval-mode {autoApproveActions: true}
- No explicit permission commands needed

---

### Configuration Commands (6 commands)

**Commands Assumed**:
```
config get, config set, config categories, config category,
config reset, config validate
```

**Reality**:
- ✅ Core: SettingsLoader, SettingsWriter exist
- ❌ Server: No /config endpoints
- **Access**: Would need new server endpoints OR read .env directly

**For Natural Language CLI**:
- User says: "set my default model to Claude Sonnet"
- CLI updates .env file directly (SettingsWriter)
- User says: "show my current config"
- CLI reads .env (SettingsLoader)
- Conversational, not commands

---

### Middleware Commands (23 commands across 7 systems)

**Commands Assumed**:
```
ErrorClassification: debug errors (1)
Retry: retry status, retry configure, retry stats (3)
Permissions: covered above (4)
SystemMessage: system-messages list/view/reload (3)
Mentorship: mentorship status/enable/disable/config/logs/stats (6)
LoopControl: loop status/config/history/reset (4)
HelperModel: helper status/configure/stats/test (4)
```

**Reality**:
- ✅ Core: All 7 middleware systems fully implemented (854 tests)
- ❌ Server: Zero middleware endpoints
- ❌ Access: Only via core library internals, not exposed

**For Natural Language CLI**:
- Most middleware is transparent (retry, error classification, loop control)
- Mentorship triggers automatically on errors
- User doesn't need explicit commands
- **Needed**: Status visibility in chat UI, not commands

---

### Historical Context Commands (4 commands)

**Commands Assumed**:
```
history search, history segment, history checkpoints, history context
```

**Reality**:
- ✅ Core: 4 historical tools exist (SearchConversationHistory, GetConversationSegment, ListCompactionBoundaries, RequestHistoricalContext)
- ❌ Server: No dedicated history endpoints
- **Access**: Via tools through POST /v1/messages

**For Natural Language CLI**:
- User says: "search my conversation for postgres setup"
- Model uses SearchConversationHistory tool automatically
- User says: "show me the conversation from 10 turns ago"
- Model uses GetConversationSegment tool
- No explicit commands - model handles it

---

### Statistics/Debug Commands (6 commands)

**Commands Assumed**:
```
stats, stats session, debug logs, debug errors, debug tools, debug middleware
```

**Reality**:
- ✅ Server: GET /sessions/:id/stats (token/message counts)
- ❌ Server: No global stats endpoint
- ❌ Server: No debug/logs endpoints
- ✅ Core: Logging infrastructure exists but not exposed via API

**For Natural Language CLI**:
- Display stats inline in chat UI
- Show token usage after each response
- Debug info in verbose mode
- No separate commands needed

---

### Tmux Commands (6 commands)

**Commands Assumed**:
```
tmux sessions, tmux create, tmux attach, tmux view, tmux kill, tmux snapshot
```

**Reality**:
- ✅ Executors: TmuxSessionTool fully implemented
- ✅ Executors: TmuxViewServer on port 4001
- ❌ Server: No tmux endpoints on main server
- **Access**: Via TmuxSessionTool through POST /v1/messages

**For Natural Language CLI**:
- User says: "create a tmux session for development"
- Model uses TmuxSessionTool automatically
- User says: "show me my tmux sessions"
- Model queries TmuxSessionTool
- Dashboard link shown: http://localhost:4001/tmux
- No commands - tool-based

---

### Artifact Commands (15+ commands)

**Commands Assumed**:
```
artifacts list, artifacts create, artifacts view, artifacts edit,
artifacts delete, artifacts run, artifacts stop, artifacts restart,
artifacts logs, artifacts export, artifacts template, artifacts snapshot,
artifacts share, artifacts status, artifacts history
```

**Reality**:
- ✅ Executors: 5 artifact tools (CreateArtifactTool, InspectSandboxTool, InteractWithSandboxTool, ModifySandboxTool, StopSandboxTool)
- ✅ Executors: SandboxViewServer on port 4001
- ✅ Executors: ArtifactRegistry v2.0.0
- ❌ Server: No artifact endpoints on main server
- **Access**: Via artifact tools through POST /v1/messages

**For Natural Language CLI**:
- User says: "create a React todo app"
- Model uses CreateArtifactTool automatically
- Returns: Artifact URL + Dashboard URL
- User says: "show my artifacts"
- Model uses InspectSandboxTool or queries ArtifactRegistry
- Dashboard link: http://localhost:4001/
- No commands - tool-based

---

## The Pattern

**Commands Were Built For**:
- REST API paradigm (every feature = endpoint)
- Explicit user control (commands for everything)
- Server-first architecture

**Reality Is**:
- Tool-based paradigm (POST /v1/messages with tools)
- AI-assisted control (model invokes tools)
- Orchestrator-first architecture

**Natural Language CLI Needs**:
- Conversational interface (not commands)
- Model handles tool invocation
- UI shows results inline
- Minimal explicit commands

---

## What Natural Language CLI Actually Needs

### Core Interaction (Not Commands)

**Chat Interface**:
```
User: "create a postgres database explorer using React"
Assistant: [Uses CreateArtifactTool]
           "Created web-app 'db-explorer' at http://localhost:3001
            View dashboard: http://localhost:4001/sandbox/abc-123"

User: "switch to Claude Opus"
Assistant: [Model parameter changed]
           "Switched to claude-opus-4-20250514"

User: "show my recent sessions"
Assistant: [Calls GET /sessions]
           "You have 3 sessions:
            1. postgres-setup (2 hours ago, 45 messages)
            2. react-debug (1 day ago, 28 messages)
            3. api-design (3 days ago, 67 messages)"
```

### Status Display (Not Commands)

**Inline UI Elements**:
```
┌─────────────────────────────────────┐
│ Model: claude-sonnet-4-20250901     │
│ Tokens: 1,234 / 200,000 (0.6%)     │
│ Session: postgres-setup             │
│ MCP: 3 servers enabled              │
│ Sandbox: 2 active                   │
└─────────────────────────────────────┘

> User message here...
```

### Actions (Not Commands)

**Inline Buttons/Shortcuts**:
- `Ctrl+M` - Change model
- `Ctrl+S` - Export session
- `Ctrl+D` - Open dashboard
- `Ctrl+H` - Show history
- `/approve on` - Quick toggle approval
- `/model opus` - Quick model switch

### Information Access (Not Commands)

**Ask in Natural Language**:
```
User: "how much have I spent on API calls today?"
Assistant: [Queries session stats]
           "Today's API costs: $2.47
            Input tokens: 125K ($1.25)
            Output tokens: 48K ($1.22)
            Most expensive: session postgres-setup ($1.89)"

User: "what's my default model?"
Assistant: [Reads config]
           "Your default model is claude-3-5-sonnet-20241022"

User: "are any MCP servers running?"
Assistant: [Uses ListAvailableMcpServers tool]
           "3 MCP servers enabled:
            - postgres (active, 12 tools)
            - filesystem (active, 8 tools)
            - github (active, 15 tools)"
```

---

## Gap Summary

### Commands That Assumed Non-Existent Features

**Total**: ~40% of 115 commands

**Examples**:
- `models favorites` - No favorites system exists
- `models compare` - No comparison feature
- `sessions search` - No search endpoint
- `sessions rename` - No rename capability
- `config validate` - No validation endpoint
- `mentorship stats` - Middleware not exposed
- `loop history` - Loop control not exposed

### Commands That Duplicate Tool Functionality

**Total**: ~50% of 115 commands

**Examples**:
- All MCP commands → MCP tools handle it
- All tmux commands → TmuxSessionTool handles it
- All artifact commands → Artifact tools handle it
- All history commands → Historical tools handle it

### Commands That Are Actually Needed

**Total**: ~10% of 115 commands (10-12 commands)

**As Quick Actions** (not full commands):
1. `/model <name>` - Quick model switch
2. `/approve on|off` - Toggle approval
3. `/export` - Export current session
4. `/stats` - Show session stats
5. `/sessions` - List sessions
6. `/dashboard` - Open web dashboard
7. `/help` - Show help
8. `/clear` - Clear screen
9. `/exit` - Exit CLI
10. `/mcp status` - Quick MCP check
11. `/config` - Show current config
12. `/models` - List available models

---

## Recommendations

### 1. Abandon Command-Based Approach

**Don't build**: 115 commands with parsers, help text, validation

**Instead**: Natural language interface where user describes intent

### 2. Use Tools, Not Endpoints

**Don't add**: 40+ new REST endpoints to server

**Instead**: Let model invoke existing tools via POST /v1/messages

### 3. Add Missing Critical Endpoints (5 only)

**Actually needed for CLI**:
```
POST /sessions/:id/model        - Model switching (stateful mode)
GET  /sessions/:id/context      - Context budget status
GET  /sessions/:id/cache        - Cache metrics
GET  /tools                     - List available tools
GET  /dashboard/url             - Get dashboard URL
```

### 4. Build Rich Chat UI

**Focus on**:
- Streaming responses with markdown
- Inline status display (model, tokens, session, MCP, sandboxes)
- Approval prompts inline
- Tool execution progress
- Artifact links clickable
- Dashboard integration

### 5. Quick Actions (Not Commands)

**Slash shortcuts for common tasks**:
```
/model opus          → Switch model
/approve on          → Auto-approve
/export              → Export session
/sessions            → List sessions
/dashboard           → Open browser to port 4001
```

**That's it**. No complex command system needed.

---

## The Real Work

### Not Command Building (2-3 months wasted)

**Instead**:

**Week 1**: Ink UI with streaming chat (like Claude Code)
**Week 2**: Model switching, session management, inline status
**Week 3**: MCP status display, artifact link handling
**Week 4**: Approval flow integration, quick actions
**Week 5**: Polish, testing, docs

**Total**: 5-6 weeks to production-ready natural language CLI

---

## Conclusion

**115 Commands Problem**:
- 40% assume features that don't exist
- 50% duplicate tool functionality
- 10% actually useful (as quick actions, not full commands)

**Natural Language Solution**:
- Zero commands (except 10-12 slash shortcuts)
- Model invokes tools automatically
- User describes intent naturally
- UI shows results inline

**Server Gap**:
- Only 5 endpoints actually needed (not 40+)
- Most features accessible via tools
- Dashboard on port 4001 already works

**Timeline**:
- Commands approach: 10-14 weeks (spec says)
- Natural language approach: 5-6 weeks
- **Savings**: 50% faster, simpler, better UX
