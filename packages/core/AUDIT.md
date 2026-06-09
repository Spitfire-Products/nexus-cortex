# Core Package Audit

**Date**: 2025-12-05
**Location**: `packages/core/src/`
**Total Files**: 247 TypeScript files (excluding tests)
**Model Cards**: 79 across 13 providers
**Architecture**: Multi-provider LLM orchestration with Claude CLI patterns

---

## Package Purpose

Core orchestration library implementing:
- Conversation compaction with 9-section summaries
- Content-addressable file checkpoints
- Deterministic system-reminder injection
- JSONL-based session storage
- Multi-provider LLM orchestration
- Helper model middleware with automatic fallback
- Timeline-based conversation tracking
- Historical context retrieval tools

---

## Directory Structure

```
packages/core/src/
├── index.ts              # Main exports
├── adapters/             # Provider format adapters (5 adapters)
├── agents/               # Agent management
├── commands/             # Slash command system
├── config/               # Configuration system
├── conversation/         # Context management, compaction
├── file-tracking/        # Content-addressable checkpoints
├── mcp/                  # MCP server integration
├── middleware/           # Request/response pipeline (7 middleware)
├── models/               # Model registry + 79 model cards
├── orchestrator/         # Central coordination
├── session/              # Timeline, JSONL storage, checkpoints
├── system-messages/      # System reminder injection
├── tools/                # Tool definitions + registries
├── ui/                   # Shared UI types
└── utils/                # Utility functions
```

---

## /adapters/ - Provider Format Translation

- **GatewayTranslationLayer.ts** - Bidirectional format normalization
- **AdapterRegistry.ts** - Adapter lookup and management
- **FormatAdapter.interface.ts** - Base adapter interface
- **MessagesAPIAdapter.ts** - Anthropic Messages API (~20KB)
- **ChatCompletionsAPIAdapter.ts** - OpenAI/XAI Chat Completions (~17KB)
- **GenerateContentAPIAdapter.ts** - Google GenerateContent (~15KB)
- **GoogleGenAPIAdapter.ts** - Google Gen adapter (~12KB)
- **ResponsesAPIAdapter.ts** - XAI Responses (server-side tools) (~23KB)
- **ToolNamingHandler.ts** - Tool naming conventions
- **ServerSideToolDetection.ts** - Server-side tool detection

---

## /models/ - Model Registry

### /cards/ - 79 Model Configurations (13 providers)

| Provider | Models |
|----------|--------|
| anthropic | claude-sonnet-4, claude-sonnet-4-5, claude-opus-4-1, claude-3-5-sonnet, claude-3-5-haiku, claude-3-haiku, claude-4-5-haiku |
| openai | gpt-4o, gpt-4o-mini, gpt-4-1, gpt-4-1-mini, gpt-4-1-nano, gpt-5-codex, o1, o1-mini, o1-pro, o3 |
| google | gemini-2-5-pro, gemini-2-5-flash-lite, gemini-2-0-flash, gemini-2-0-flash-lite, gemini-1-5-pro, gemini-1-5-flash, gemini-3, gemini-2-5-computer-use-preview |
| xai | grok-4, grok-4-fast, grok-4-1, grok-4-1-fast, grok-3, grok-3-mini, grok-code-fast-1 |
| deepseek | deepseek-chat, deepseek-coder, deepseek-reasoner, deepseek-v3-1, deepseek-v3-1-thinking, deepseek-r1-0528 |
| gemma | gemma-3-27b-it, gemma-3-12b-it, gemma-3-4b-it, gemma-3-1b-it |
| glm | (various) |
| moonshot | (various) |
| qwen | (various) |
| minimax | (various) |
| local | (various) |
| huggingface | (various) |
| openrouter | (various) |

### /configurators/ - 12 Provider Configurators

- AnthropicConfigurator, GoogleConfigurator, XAIConfigurator, DeepSeekConfigurator
- GemmaConfigurator, GLMConfigurator, MoonshotConfigurator, QwenConfigurator
- MiniMaxConfigurator, LocalModelConfigurator, HuggingFaceConfigurator, OpenRouterConfigurator

### /registry/

- **ModularModelRegistry.ts** - Central model catalog
- **ModelCardLoader.ts** - Dynamic model loading

---

## /middleware/ - Request/Response Pipeline (7 components)

- **HelperModelMiddleware.ts** (~44KB) - Context summarization with secondary model
- **ErrorClassificationMiddleware.ts** (~7KB) - Error detection and classification
- **RetryMiddleware.ts** (~10KB) - Exponential backoff on failures
- **PermissionsMiddleware.ts** (~11KB) - Tool execution permissions
- **SystemMessageMiddleware.ts** (~10KB) - Auto-load CORTEX.md and system messages
- **MentorshipMiddleware.ts** (~13KB) - AI-to-AI mentorship on errors
- **LoopControlMiddleware.ts** (~10KB) - Infinite loop prevention

### /permissions/ - Permission System

- **PermissionPolicy.ts** - Base policy interface
- **WhitelistPolicy.ts** - Allow specific tools
- **BlacklistPolicy.ts** - Block specific tools
- **FileOperationPolicy.ts** - File operation rules
- **BashCommandPolicy.ts** - Shell command rules
- **PermissionEvaluator.ts** - Policy evaluation engine
- **PermissionAuditLogger.ts** - Audit logging
- **PermissionConfigLoader.ts** - Config loading
- **PermissionPresets.ts** - development, production, testing presets
- **CLIApprovalHandler.ts** - Interactive approval UI
- **AutoApproveHandler.ts** - YOLO mode handler
- **DenyAllHandler.ts** - Deny all handler

---

## /orchestrator/ - Central Coordination

- **CortexOrchestrator.ts** - Main coordination class
  - Methods: sendMessage(), streamMessage(), switchModel(), createCheckpoint(), resumeFromCheckpoint(), getSessionInfo(), getMessageHistory(), cleanup()
- **APIClient.ts** - HTTP client for providers
- **OrchestratorFactory.ts** - Factory creation

---

## /session/ - Session Management

- **JSONLHistoryStore.ts** - One message per line storage
  - Methods: loadSession(), saveSession(), appendMessage(), listSessions(), deleteSession(), getStorageStats()
- **SessionTimeline.ts** - Timeline tracking with events
  - Events: message, checkpoint, compaction, model_switch, resume, branch_create, conversation_start
- **CheckpointManager.ts** - Content-addressable file snapshots
- **CacheMetricsAccumulator.ts** - Prompt caching statistics

---

## /conversation/ - Context Management

- **ContextBudgetManager.ts** - Token budget tracking
- **StoredCompactionManager.ts** - Compaction storage and retrieval
  - Methods: createCompaction(), getCompaction(), queryCompactions(), getCompactionBoundaries()
- **SummaryTemplates.ts** - 9-section summary templates

---

## /tools/ - Tool System

- **toolDefinitions.ts** (~32KB) - All tool schemas
- **ServerSideTools.ts** (~9KB) - Server-side tool definitions
- **ToolFactory.ts** (~4KB) - Tool instantiation

### /historical/ - Historical Context Tools (5)

- SearchConversationHistory
- GetConversationSegment
- ListCompactionBoundaries
- RequestHistoricalContext
- ListSessions / LoadSession

### /mcp-management/ - MCP Tools (7)

- InitMcpConfig, ListAvailableMcpServers, SearchMcpServers
- EnableMcpServer, DisableMcpServer, ConfigureMcpServer, GetMcpConfig

### /registries/

- AddonToolRegistry - Dynamic tool registration
- BaseToolRegistry - Core tool registry

---

## /mcp/ - Model Context Protocol

- **McpClient.ts** - MCP client implementation
- **McpClientManager.ts** - Server connection management
- **McpServerRegistry.ts** - Server lifecycle management
- **McpConfigManager.ts** - `.cortex/mcp_config.json` handling

---

## /file-tracking/ - File Checkpoints

- **ContentAddressableStore.ts** - SHA-based file storage
- **FileCheckpointManager.ts** - Checkpoint creation/restoration

---

## /system-messages/ - System Reminders

- **SystemMessageRegistry.ts** - Registry implementation
- **SystemReminderInjector.ts** - Deterministic injection
- **MessageValidator.ts** - Message validation
- **SystemMessageRegistry.interface.ts** - Interface definition

---

## /commands/ - Slash Command System

- **SlashCommandRegistry.ts** - Command definitions (58+ commands)
- **SlashCommandCompleter.ts** - Autocomplete logic
- **types.ts** - Command type definitions

---

## /config/ - Configuration

- **SettingsSchema.ts** - Environment variables, defaults, metadata
- **SettingsLoader.ts** - Configuration loading
- **SettingsWriter.ts** - Configuration persistence
- **InteractiveConfigurator.ts** - Setup wizard

---

## /utils/ - Utilities

- **logger.ts** - Structured logging (debug, info, warn, error, success)
- **ids.ts** - ID generation (generateId, generateToolId, generateSessionId, generateMessageId)
- **agentDiscovery.ts** - Agent type discovery
- **ErrorDetector.ts** - Error classification
- **TokenCounter.ts** - Token counting

---

## /agents/ - Agent Management

- Agent discovery and management for sub-agent delegation

---

## /ui/ - Shared UI Types

- Types for model pickers, session pickers, theme pickers
- Shared between CLI implementations

---

## Key Exports (from index.ts)

**Adapters**: All adapters via `./adapters/index.js`
**Models**: ModularModelRegistry, model cards via `./models/index.js`
**Conversation**: ContextBudgetManager, StoredCompactionManager
**Middleware**: HelperModelMiddleware, ErrorClassificationMiddleware, RetryMiddleware, PermissionsMiddleware, SystemMessageMiddleware, MentorshipMiddleware, LoopControlMiddleware
**Permissions**: WhitelistPolicy, BlacklistPolicy, FileOperationPolicy, BashCommandPolicy, CLIApprovalHandler, AutoApproveHandler, DenyAllHandler, PermissionAuditLogger, PermissionEvaluator, PermissionConfigLoader, PermissionPresets
**Session**: SessionTimeline, CheckpointManager, JSONLHistoryStore
**Tools**: All tool definitions via `./tools/index.js`
**MCP**: McpClient, McpClientManager via `./mcp/index.js`
**Config**: Settings system via `./config/index.js`
**Orchestrator**: CortexOrchestrator via `./orchestrator/index.js`
**File Tracking**: ContentAddressableStore, FileCheckpointManager
**System Messages**: All via `./system-messages/index.js`
**Agents**: Agent management via `./agents/index.js`
**Commands**: Slash command system via `./commands/index.js`
**Utils**: Utilities via `./utils/index.js`
**UI**: Shared UI types via `./ui/index.js`

---

## Architecture Patterns

1. **Adapter Pattern** - Provider-agnostic format translation
2. **Registry Pattern** - Models, tools, adapters
3. **Middleware Pipeline** - Request/response processing chain
4. **Factory Pattern** - Tool and orchestrator instantiation
5. **Repository Pattern** - JSONL session storage
6. **Timeline Pattern** - Event-based conversation tracking
7. **Content-Addressable Storage** - File checkpoints

---

## Summary Statistics

| Component | Count |
|-----------|-------|
| TypeScript Files | 247 |
| Model Cards | 79 |
| Providers | 13 |
| Adapters | 5 |
| Middleware | 7 |
| Permission Policies | 4 |
| Historical Tools | 5 |
| MCP Tools | 7 |
| Slash Commands | 58+ |
