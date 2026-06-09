# Server Package Audit

**Date**: 2025-12-05
**Location**: `packages/server/src/`
**Total Files**: 11 TypeScript source files
**Total Endpoints**: 54 documented API endpoints
**Architecture**: Thin Express wrapper around @nexus-cortex/core library

---

## Source Code Structure

```
packages/server/src/
├── index.ts                      # Main server class and startup logic
├── middleware/
│   ├── cors.ts                   # CORS configuration
│   └── errorHandler.ts           # Express error handling
└── routes/
    ├── health.ts                 # Server status and health checks
    ├── messages.ts               # Main LLM message endpoint
    ├── sessions.ts               # Session management (14 endpoints)
    ├── models.ts                 # Model listing
    ├── tools.ts                  # Tool definitions
    ├── approval.ts               # Approval mode management
    ├── mcp.ts                    # MCP server management
    ├── permissions.ts            # Permission policies
    ├── system-messages.ts        # System message management
    └── middleware.ts             # Middleware configuration
```

---

## Main Server Class

### CortexV4Server (`src/index.ts`)

**Configuration Options**:
- `port`: Server port (default: 4000)
- `debug`: Enable debug logging
- `stateless`: Create new orchestrator per request
- `yolo`: Auto-approve all permissions

**Key Methods**:
- `constructor(config)` - Initialize server
- `setupMiddleware()` - Configure body parsing, CORS, logging
- `setupRoutes()` - Register all route handlers
- `setupErrorHandling()` - Install error handler
- `start()` - Initialize orchestrator, start dashboard, listen
- `stop()` - Graceful shutdown
- `getPort()` - Return current port

**Features**:
- Persistent orchestrator mode (default) or stateless mode
- Auto-approve mode (`--yolo` or `YOLO=true`)
- SandboxViewServer + TmuxViewServer on port 4001
- Port auto-increment if in use
- Graceful SIGINT/SIGTERM handling

---

## Routes and Endpoints

### Health Check (`/health`) - 1 endpoint
- **GET /health** - Server status, model list, API key status (JSON or HTML dashboard)

### Messages (`/v1/messages`) - 1 endpoint
- **POST /v1/messages** - Main LLM conversation endpoint (OpenAI-compatible, SSE streaming)

### Models (`/models`) - 1 endpoint
- **GET /models** - List all available models (OpenAI-compatible format)

### Sessions (`/sessions`) - 14 endpoints
- **POST /sessions/new** - Create new session
- **GET /sessions** - List all sessions
- **GET /sessions/:id** - Get session metadata
- **GET /sessions/:id/messages** - Load all messages
- **GET /sessions/:id/export** - Export as JSON
- **DELETE /sessions/:id** - Delete session
- **GET /sessions/:id/checkpoints** - List checkpoints
- **POST /sessions/:id/resume** - Resume from checkpoint
- **GET /sessions/:id/stats** - Get statistics
- **POST /sessions/:id/model** - Switch model
- **GET /sessions/:id/context** - Get context budget status
- **GET /sessions/:id/cache/metrics** - Get cache metrics
- **POST /sessions/:id/compaction** - Trigger manual compaction
- **GET /sessions/:id/compaction/boundaries** - Get compaction boundaries

### Tools (`/tools`) - 2 endpoints
- **GET /tools** - List all available tools (optional grouping)
- **GET /tools/:name** - Get specific tool details

### Approval (`/v1/approval-mode`) - 2 endpoints
- **GET /v1/approval-mode** - Get current approval settings
- **POST /v1/approval-mode** - Toggle approval mode

### MCP (`/mcp`) - 7 endpoints
- **GET /mcp/servers** - List MCP servers
- **GET /mcp/servers/:name** - Get server details
- **GET /mcp/servers/:name/tools** - Get server tools
- **GET /mcp/tools** - Get all MCP tools
- **POST /mcp/servers/:name/connect** - Connect server
- **POST /mcp/servers/:name/disconnect** - Disconnect server
- **GET /mcp/status** - Get MCP status

### Permissions (`/permissions`) - 8 endpoints
- **GET /permissions/policies** - List policies
- **POST /permissions/tool/:name** - Grant/revoke tool permission
- **DELETE /permissions/tool/:name** - Revoke tool permission
- **GET /permissions/audit/statistics** - Get audit statistics
- **GET /permissions/audit/:sessionId?** - Get audit log
- **GET /permissions/denied** - Get denied operations
- **POST /permissions/policies** - Register custom policy
- **DELETE /permissions/policies/:policyName** - Unregister policy

### System Messages (`/system-messages`) - 6 endpoints
- **GET /system-messages** - List all
- **GET /system-messages/:id** - Get specific
- **POST /system-messages/reload** - Hot-reload from disk
- **POST /system-messages** - (501 Not Implemented - file-based)
- **PUT /system-messages/:id** - (501 Not Implemented - file-based)
- **DELETE /system-messages/:id** - (501 Not Implemented - file-based)

### Middleware (`/middleware`) - 4 endpoints
- **GET /middleware/config** - Get middleware configuration
- **POST /middleware/:name/enable** - (501 - requires restart)
- **POST /middleware/:name/disable** - (501 - requires restart)
- **GET /middleware/:name/status** - Get middleware status

### Root - 2 endpoints
- **GET /** - Redirect to /health
- **GET (unmapped)** - 404 handler

---

## Middleware

### CORS (`src/middleware/cors.ts`)
- Allow all origins
- Supported headers: Content-Type, Authorization, x-api-key, anthropic-version, anthropic-beta

### Error Handler (`src/middleware/errorHandler.ts`)
- Express 4-arg error handler
- JSON response with statusCode + errorType
- Full stack traces in DEBUG mode

---

## Summary by Category

| Category | Endpoints |
|----------|-----------|
| Health | 1 |
| Messages (LLM) | 1 |
| Models | 1 |
| Sessions | 14 |
| Tools | 2 |
| Approval | 2 |
| MCP | 7 |
| Permissions | 8 |
| System Messages | 6 |
| Middleware | 4 |
| Root | 2 |
| **Total** | **54** |

---

## Architecture Features

- **Stateful/Stateless Modes**: Toggle with OMNICLAUDE_MODE
- **Permission Modes**: interactive, auto-approve (YOLO), disabled
- **View Servers**: Dashboard on port 4001 (sandbox + tmux viewer)
- **Streaming**: Full SSE support for /v1/messages
- **OpenAI Compatibility**: /models and /v1/messages follow OpenAI format

---

## Environment Variables

- `PORT`: Server port (default 4000)
- `DEBUG`: Enable debug logging
- `YOLO`: Auto-approve all permissions
- `OMNICLAUDE_MODE`: "stateless" for per-request orchestrators
- `DEFAULT_MODEL_ID`: Fallback model
- `PROJECT_ROOT`: Monorepo root

---

## Key Design Patterns

1. **Thin Wrapper Architecture**: All logic delegated to @nexus-cortex/core
2. **Orchestrator Injection**: Routes access persistent orchestrator via getServerOrchestrator()
3. **OpenAI API Compatibility**: /v1/messages and /models match OpenAI format
4. **Graceful Degradation**: 503 errors when orchestrator not initialized
5. **Error Normalization**: Standard { error: { message, type } } format
6. **Hot-Reload Support**: System messages queryable at runtime
