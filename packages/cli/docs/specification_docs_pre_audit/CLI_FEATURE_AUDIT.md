# Nexus Cortex CLI - Comprehensive Feature Audit

**Version:** 1.0
**Date:** 2025-01-13
**Purpose:** Complete inventory of core library features vs. CLI PRD coverage

---

## Executive Summary

This audit identifies the complete feature set available in `@cortex/core` and evaluates what the CLI client must expose to provide full functionality. The analysis reveals **significant gaps** between the current CLI PRD and the actual capabilities of the core library, particularly around:

- **Wave 3 middleware features** (7 middleware systems)
- **MCP management** (7 dedicated tools + infrastructure)
- **Advanced session features** (checkpoints, compaction, historical retrieval)
- **Configuration management** (40+ environment variables across 6 categories)
- **Multi-provider orchestration** (66 models across 10 providers)

### Key Findings

| Category | Core Features | CLI PRD Coverage | Gap |
|----------|--------------|------------------|-----|
| **Tool System** | 34 tools (27 base + 7 MCP) | Basic tool visualization | MCP management UI missing |
| **Middleware** | 7 systems (Wave 3 complete) | Not mentioned | Complete middleware control needed |
| **Models** | 66 models, 10 providers | Basic list/info commands | Provider filtering, alias management missing |
| **Session Management** | Checkpoints, compaction, historical retrieval | Basic list/view/export | Missing checkpoint resume, compaction control |
| **Configuration** | 40+ settings, 6 categories | 5 basic settings | Missing 35+ advanced settings |
| **Permissions** | 3 modes, policy-based, audit logs | Not mentioned | Complete permissions management needed |

---

## 1. Core Library Feature Inventory

### 1.1 Multi-Provider Orchestration

**Location:** `packages/core/src/orchestrator/CortexOrchestrator.ts`

**Capabilities:**
- Unified message handling across all providers
- Automatic adapter selection based on model format
- Provider-agnostic tool execution
- Cross-provider session continuity
- Smart retry with provider fallback

**Providers Supported:**
1. **XAI** (6 models): Grok-4, Grok-4-Fast, Grok-3, Grok-3-Mini, Grok-Code-Fast-1
2. **DeepSeek** (6 models): Chat, Reasoner, Coder, R1-0528, V3.1, V3.1-Thinking
3. **Anthropic** (7 models): Claude Sonnet 4.5, Sonnet 4, Opus 4.1, Haiku 4.5, Haiku 3.5, Sonnet 3.5
4. **Google Gemini** (8 models): Gemini 2.5 Pro/Flash, Gemini 2.0 Flash, Gemini 1.5 Pro/Flash
5. **OpenAI** (15 models): GPT-4.1, GPT-5, O1, O3, O4-Mini, GPT-4o, etc.
6. **Gemma** (4 models): Gemma 3 27B/12B/4B/1B-IT
7. **GLM** (5 models): GLM-4.6, GLM-4.5, GLM-4.5-Air, GLM-4-Flash, GLM-4
8. **Qwen** (5 models): Qwen-3-Max-Preview, Qwen-Max, Qwen-Plus, Qwen-Turbo, Qwen-3-Coder
9. **Moonshot** (5 models): Kimi-K2-Instruct, Kimi-K2-Thinking, Kimi-Chat variants
10. **MiniMax** (2 models): MiniMax-M2, MiniMax-M2-Stable

**Total Models:** 66 models

**CLI Gap:** Current PRD only mentions basic model list/info. Missing:
- Model filtering by provider
- Model aliases/favorites
- Cost tracking per model
- Model performance metrics
- Provider-specific configuration

---

### 1.2 Wave 3 Middleware Systems

**Location:** `packages/core/src/middleware/`

#### 1.2.1 ErrorClassificationMiddleware
**Purpose:** Intelligent error detection and classification

**Features:**
- Syntax error detection (Python, JavaScript, TypeScript, Bash)
- Runtime error classification
- Permission denied detection
- File not found analysis
- Timeout detection
- Memory/resource exhaustion detection
- Network error classification
- Severity scoring (low/medium/high/critical)

**CLI Gap:** Not mentioned in PRD. Should expose:
- Error log viewer with filtering
- Error statistics per session
- Pattern detection results

#### 1.2.2 RetryMiddleware
**Purpose:** Smart retry with exponential backoff

**Features:**
- Automatic retry for transient failures
- Exponential backoff algorithm
- Configurable max attempts
- Rate limit handling
- Provider fallback on repeated failures
- Circuit breaker pattern

**CLI Gap:** Not mentioned in PRD. Should expose:
- Retry statistics
- Current retry state
- Manual retry triggers

#### 1.2.3 PermissionsMiddleware
**Purpose:** Policy-based tool execution authorization

**Features:**
- 3 permission modes:
  - `interactive`: Prompt user for approval (default)
  - `auto`: Auto-approve all (YOLO mode)
  - `disabled`: No permission checks
- Policy system:
  - `WhitelistPolicy`: Allow only specified tools
  - `BlacklistPolicy`: Block specific tools
  - `FileOperationPolicy`: Path-based file access control
  - `BashCommandPolicy`: Command pattern matching
- Auto-approve actions mode (toggle via API)
- Approval handlers:
  - CLI interactive prompts
  - Audit logging
- Comprehensive permission audit log

**CLI Gap:** Not mentioned in PRD. Critical missing features:
- Permission mode selection at startup
- Policy configuration UI
- Approval history viewer
- Auto-approve actions toggle command
- Blocked operation alerts

#### 1.2.4 SystemMessageMiddleware
**Purpose:** Dynamic system message injection

**Features:**
- Load system messages from `.claude/` directory
- Template variable expansion
- Message composition (multiple files)
- Role-specific messages (planner, implementation)
- Session-specific overrides

**CLI Gap:** Not mentioned in PRD. Should expose:
- List available system messages
- Preview system message content
- Custom system message at startup

#### 1.2.5 MentorshipMiddleware
**Purpose:** AI-to-AI reactive guidance using helper models

**Features:**
- **Error-triggered mentorship**: Automatic guidance on tool failures
- **Keyword triggers**: @ultrathink, @analyze, @rethink, custom keywords
- **Turn-based review**: Periodic mentorship every N turns
- **Interleaved thinking**: Inject thinking assistance for non-reasoning models
- **Pattern detection**: Alert on repeated failure patterns
- **Helper model selection**: Use cheap models (Grok-Beta, Haiku, GPT-3.5-Turbo)
- **Configurable thresholds**: Error severity, turn intervals, pattern counts

**Configuration:**
- `MENTORSHIP_ENABLED`: Enable/disable system
- `MENTORSHIP_TRIGGER_ON_ERROR`: Auto-trigger on errors
- `MENTORSHIP_ERROR_THRESHOLD`: low/medium/high
- `MENTORSHIP_KEYWORDS_ENABLED`: Enable keyword triggers
- `MENTORSHIP_CUSTOM_KEYWORDS`: Comma-separated list
- `MENTORSHIP_HELPER_MODEL`: Model to use
- `MENTORSHIP_TURN_BASED_ENABLED`: Periodic reviews
- `MENTORSHIP_TURN_INTERVAL`: Turns between reviews (1-50)
- `MENTORSHIP_INTERLEAVED_THINKING`: Thinking assistance
- `MENTORSHIP_PATTERN_DETECTION`: Repeated failure detection
- `MENTORSHIP_PATTERN_THRESHOLD`: Count to trigger (2-10)

**CLI Gap:** Completely missing from PRD. Essential features needed:
- Mentorship mode toggle
- Keyword trigger management
- Helper model selection
- Turn interval configuration
- Mentorship event log viewer

#### 1.2.6 LoopControlMiddleware
**Purpose:** Prevent infinite tool execution loops

**Features:**
- Maximum tool iterations per turn
- Consecutive error limit
- Tool execution timeouts
- Identical call repetition detection
- Loop pattern recognition
- Automatic circuit breaking

**Configuration:**
- `MAX_TOOL_ITERATIONS`: Maximum iterations per turn
- `MAX_CONSECUTIVE_ERRORS`: Error limit before stopping
- `TOOL_TIMEOUT_MS`: Timeout in milliseconds
- `MAX_LOOP_REPETITIONS`: Identical call limit

**CLI Gap:** Not mentioned in PRD. Should expose:
- Loop detection alerts
- Current iteration counts
- Circuit breaker status
- Configuration adjustment

#### 1.2.7 HelperModelMiddleware
**Purpose:** Cost-efficient context management using cheaper models

**Features:**
- Helper model for summarization
- Context compression
- Historical retrieval assistance
- Provider-specific adapters for all formats
- FREE model options (Gemma models)

**CLI Gap:** Not mentioned in PRD. Should expose:
- Helper model selection
- Cost savings statistics
- Context compression metrics

---

### 1.3 Tool System

**Location:** `packages/core/src/tools/toolDefinitions.ts`

#### Base Tools (27 tools)

**File Operations:**
1. `Read` - Read file contents with offset/limit
2. `Write` - Write file with overwrite
3. `Edit` - String replacement with exact matching
4. `Glob` - File pattern matching

**Code Execution:**
5. `Bash` - Shell command execution
6. `BashOutput` - Retrieve background shell output
7. `KillShell` - Terminate background shell

**Search:**
8. `Grep` - Pattern search with ripgrep
9. `WebSearch` - Web search with domain filtering
10. `WebFetch` - Fetch and analyze web content

**Jupyter:**
11. `NotebookEdit` - Edit notebook cells

**Task Management:**
12. `Task` - Launch sub-agents
13. `TodoWrite` - Track progress through plans
14. `ExitPlanMode` - Exit planning mode

**Historical Context Retrieval (4 tools - Week 3):**
15. `SearchConversationHistory` - Search compacted history
16. `GetConversationSegment` - Retrieve specific conversation ranges
17. `ListCompactionBoundaries` - Show compaction points
18. `RequestHistoricalContext` - Query archived context with helper model

#### MCP Management Tools (7 tools)

**Location:** `packages/core/src/tools/mcp-management/`

19. `ListAvailableMcpServers` - Browse MCP server registry
20. `SearchMcpServers` - Search for MCP servers by capability
21. `GetMcpConfig` - View current MCP configuration
22. `EnableMcpServer` - Enable MCP server
23. `DisableMcpServer` - Disable MCP server
24. `ConfigureMcpServer` - Configure MCP server parameters
25. `InitMcpConfig` - Initialize MCP configuration

**Additional MCP Capabilities:**
- Server discovery from GitHub registry
- Automatic tool injection from enabled servers
- Stdio transport for server communication
- Server health monitoring

**CLI Gap:**
- Current PRD shows basic tool execution visualization
- Missing MCP server management UI
- No MCP configuration commands
- No historical context tool documentation

---

### 1.4 Session Management

**Location:** `packages/core/src/session/`

**Components:**
1. **SessionTimeline** - Message ordering and turn tracking
2. **JSONLHistoryStore** - JSONL-based persistence
3. **CheckpointManager** - Session snapshots
4. **CacheMetricsAccumulator** - Token cache tracking

**Capabilities:**
- JSONL format (compatible with Claude CLI)
- Turn-based message grouping
- Checkpoint creation for resumption
- Message metadata (tokens, cost, timing)
- Cache hit tracking (input/output tokens)
- Session statistics accumulation

**CLI Gap:** Current PRD has basic session management:
- ✓ List sessions
- ✓ View session
- ✓ Export session
- ✓ Delete session

**Missing:**
- Resume from checkpoint ID (PRD shows in chat options but not implemented)
- Checkpoint listing per session
- Cache metrics display
- Session statistics (cost, tokens, tool usage)
- Session comparison
- Session search by content
- Session merge/split operations

---

### 1.5 Context Management

**Location:** `packages/core/src/conversation/`

**Components:**
1. **ContextBudgetManager** - Manage context window limits
2. **StoredCompactionManager** - Conversation summarization
3. **SummaryTemplates** - Compaction prompt templates

**Capabilities:**
- Automatic context compaction when approaching limits
- Sliding window strategy
- Priority-based message retention
- Reasoning pattern optimization (keep recent thinking blocks)
- Helper model summarization
- Compaction boundary markers
- Token savings tracking

**Configuration:**
- `CONTEXT_BUDGET_STRATEGY`: sliding-window | priority-based
- `REASONING_PATTERN_OPTIMIZATION`: true | false
- `REASONING_KEEP_RECENT_TURNS`: 0-10

**CLI Gap:** Not mentioned in PRD. Should expose:
- Context budget status
- Compaction trigger controls
- Historical context retrieval commands
- Compaction boundary viewer
- Token savings statistics

---

### 1.6 Configuration System

**Location:** `packages/core/src/config/SettingsSchema.ts`

**Categories (6):**

#### API Keys (5 settings)
1. `ANTHROPIC_API_KEY`
2. `OPENAI_API_KEY`
3. `GOOGLE_API_KEY`
4. `X_API_KEY`
5. `DEEPSEEK_API_KEY`

#### Models (2 settings)
6. `DEFAULT_MODEL_ID`
7. `HELPER_MODEL_ID`

#### System (2 settings)
8. `DEBUG`
9. `PROJECT_PATH`

#### Mentorship (10 settings)
10. `MENTORSHIP_ENABLED`
11. `MENTORSHIP_TRIGGER_ON_ERROR`
12. `MENTORSHIP_ERROR_THRESHOLD`
13. `MENTORSHIP_KEYWORDS_ENABLED`
14. `MENTORSHIP_CUSTOM_KEYWORDS`
15. `MENTORSHIP_HELPER_MODEL`
16. `MENTORSHIP_TURN_BASED_ENABLED`
17. `MENTORSHIP_TURN_INTERVAL`
18. `MENTORSHIP_INTERLEAVED_THINKING`
19. `MENTORSHIP_PATTERN_DETECTION`
20. `MENTORSHIP_PATTERN_THRESHOLD`

#### Context (3 settings)
21. `CONTEXT_BUDGET_STRATEGY`
22. `REASONING_PATTERN_OPTIMIZATION`
23. `REASONING_KEEP_RECENT_TURNS`

#### Session (2 settings)
24. `SESSION_STORAGE_DIR`
25. `MCP_AUTO_INJECT`

#### Loop Control (4 settings)
26. `MAX_TOOL_ITERATIONS`
27. `MAX_CONSECUTIVE_ERRORS`
28. `TOOL_TIMEOUT_MS`
29. `MAX_LOOP_REPETITIONS`

**Total Settings:** 29 environment variables

**CLI Gap:** Current PRD only covers 5 basic settings:
- ✓ defaultModel
- ✓ serverUrl
- ✓ temperature
- ✓ maxTokens
- ✓ theme

**Missing 24+ settings** across mentorship, context, session, and loop control categories.

---

## 2. Server HTTP API Capabilities

**Location:** `packages/server/src/index.ts` and `packages/server/src/routes/`

### 2.1 Core Endpoints

#### POST /v1/messages
**Purpose:** Main LLM inference endpoint

**Request Body:**
```typescript
{
  model?: string;              // Model ID (optional, uses default)
  messages: Message[];         // Conversation messages
  system?: string;             // System message override
  tools?: Tool[];              // Tool definitions (empty array = all tools)
  max_tokens?: number;         // Maximum tokens (default: 4096)
  temperature?: number;        // Temperature 0-2 (default: 1.0)
  top_p?: number;             // Top-p sampling (default: 1.0)
  stream?: boolean;           // Enable streaming (default: false)
}
```

**Response (Non-Streaming):**
```typescript
{
  id: string;
  type: "message";
  role: "assistant";
  content: ContentBlock[];
  model: string;
  stop_reason: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}
```

**Response (Streaming):** SSE events with incremental content

**Capabilities:**
- Streaming and non-streaming modes
- Automatic tool injection (empty tools array)
- MCP tool integration
- Session persistence (stateful mode)
- Ephemeral orchestrator (stateless mode)

#### GET /models
**Purpose:** List all available models

**Response:**
```typescript
{
  data: Array<{
    id: string;
    provider: string;
    displayName: string;
    apiFormat: string;
    contextWindow: number;
    maxOutputTokens: number;
    capabilities: {
      tools: boolean;
      streaming: boolean;
      vision: boolean;
      reasoningMode: boolean;
    };
    pricing: {
      inputPerMillion: number;
      outputPerMillion: number;
      cacheWritePerMillion?: number;
      cacheReadPerMillion?: number;
    };
  }>
}
```

#### GET /health
**Purpose:** Server health check

**Response:**
```typescript
{
  status: "healthy" | "degraded" | "unhealthy";
  version: string;
  uptime: number;
  orchestrator: {
    initialized: boolean;
    sessionId?: string;
    model?: string;
  };
}
```

#### GET /v1/approval-mode
**Purpose:** Get current approval mode

**Response:**
```typescript
{
  autoApproveActions: boolean;
  yoloMode: boolean;
  context: string;
}
```

#### POST /v1/approval-mode
**Purpose:** Toggle auto-approve actions mode

**Request:**
```typescript
{
  autoApproveActions: boolean;
}
```

**Response:**
```typescript
{
  success: boolean;
  autoApproveActions: boolean;
  message: string;
}
```

### 2.2 Dashboard Endpoints (Port 4001)

**Provided by:** `@cortex/executors` SandboxViewServer

**Endpoints:**
- `GET /` - Sandbox list
- `GET /tmux` - Tmux sessions list
- `GET /sandbox/:id` - View specific sandbox
- `GET /tmux/:id` - View specific tmux session

**CLI Gap:** Dashboard not mentioned in PRD. Should document:
- Dashboard URL for reference
- Dashboard integration (if any)

---

## 3. CLI PRD Coverage Analysis

### 3.1 What's Covered

✓ **Basic Commands:**
- Interactive chat mode
- Single message mode
- Model list/info
- Session list/view/export/delete
- Server start/stop/status/logs
- Basic configuration (5 settings)

✓ **Core Features:**
- Streaming support
- Model selection
- System message override
- Temperature/max_tokens parameters
- JSON output mode

✓ **UI Components:**
- Status bar with session info
- Message renderer
- Tool display
- Spinner for loading
- Color themes

### 3.2 What's Missing

#### Critical Gaps

❌ **Wave 3 Middleware** (0% coverage)
- No mention of any middleware systems
- No permission management
- No mentorship features
- No error classification
- No retry controls
- No loop detection

❌ **MCP Management** (0% coverage)
- No MCP server listing
- No MCP server enable/disable
- No MCP configuration
- No MCP tool discovery

❌ **Advanced Session Features** (20% coverage)
- Checkpoint resume mentioned but not detailed
- No checkpoint listing
- No compaction controls
- No historical context retrieval
- No cache metrics display

❌ **Configuration Management** (17% coverage)
- Only 5 of 29+ settings covered
- No category-based configuration
- No interactive configuration wizard for advanced settings
- No setting validation display

❌ **Permissions System** (0% coverage)
- No permission mode selection
- No policy management
- No approval history
- No auto-approve toggle command

#### Major Gaps

❌ **Model Management Enhancements:**
- No provider filtering
- No model favorites/aliases
- No cost tracking
- No model performance metrics

❌ **Debugging Features:**
- No middleware event viewer
- No error log viewer
- No tool execution history
- No permission audit log viewer

❌ **Mentorship Features:**
- No keyword trigger management
- No helper model selection UI
- No mentorship event log
- No turn-based review configuration

---

## 4. Recommended CLI Commands & Features

### 4.1 New Command Categories

#### Middleware Management
```bash
cortex middleware list              # List all middleware
cortex middleware status            # Show middleware status
cortex middleware enable <name>     # Enable middleware
cortex middleware disable <name>    # Disable middleware
cortex middleware config <name>     # Configure middleware
```

#### MCP Management
```bash
cortex mcp list                     # List available MCP servers
cortex mcp search <query>           # Search MCP servers
cortex mcp enable <server>          # Enable MCP server
cortex mcp disable <server>         # Disable MCP server
cortex mcp config <server>          # Configure MCP server
cortex mcp status                   # Show MCP status
```

#### Permissions Management
```bash
cortex permissions mode             # Show current mode
cortex permissions mode <mode>      # Set mode (interactive/auto/disabled)
cortex permissions auto-approve     # Toggle auto-approve actions
cortex permissions audit            # View audit log
cortex permissions policies         # List policies
cortex permissions block <tool>     # Block specific tool
cortex permissions allow <tool>     # Allow specific tool
```

#### Mentorship Management
```bash
cortex mentorship status            # Show mentorship status
cortex mentorship enable            # Enable mentorship
cortex mentorship disable           # Disable mentorship
cortex mentorship keywords          # List/manage keywords
cortex mentorship model <model>     # Set helper model
cortex mentorship log               # View mentorship events
```

#### Advanced Session Management
```bash
cortex session checkpoints <id>     # List checkpoints
cortex session resume <checkpoint>  # Resume from checkpoint
cortex session stats <id>           # Show statistics
cortex session search <query>       # Search sessions
cortex session compact <id>         # Trigger compaction
cortex session history <id>         # View compaction history
```

#### Enhanced Model Commands
```bash
cortex models list --provider <p>   # Filter by provider
cortex models list --capability <c> # Filter by capability
cortex models favorites             # List favorite models
cortex models favorite <id>         # Add to favorites
cortex models alias <name> <id>     # Create model alias
cortex models compare <id1> <id2>   # Compare models
cortex models cost <id>             # Show pricing
```

#### Configuration Enhancements
```bash
cortex config categories            # List categories
cortex config category <cat>        # Show category settings
cortex config wizard                # Interactive configuration
cortex config validate              # Validate configuration
cortex config export                # Export configuration
cortex config import <file>         # Import configuration
```

#### Debug & Monitoring
```bash
cortex debug logs                   # View debug logs
cortex debug errors                 # View error log
cortex debug tools                  # View tool execution history
cortex debug middleware             # View middleware events
cortex debug cache                  # View cache metrics
```

### 4.2 Enhanced Interactive Mode Features

#### Permission Prompts
- Real-time permission prompts for graylist tools
- Auto-approve toggle hotkey (e.g., Ctrl+A)
- Show why tool needs approval
- Display policy that blocked tool

#### Mentorship Indicators
- Show when mentorship is triggered
- Display helper model responses inline
- Keyword trigger highlighting
- Pattern detection alerts

#### Context Management
- Context budget meter in status bar
- Compaction notifications
- Historical context retrieval UI
- Token savings display

#### Error Handling
- Error classification display
- Retry status indicator
- Loop detection warnings
- Circuit breaker alerts

### 4.3 Enhanced Options

#### Chat Mode Options
```bash
cortex chat [options]
  -m, --model <id>                      # Model ID
  -r, --resume <checkpoint>             # Resume from checkpoint
  --system <message>                    # System message
  --max-tokens <number>                 # Max tokens
  --temperature <number>                # Temperature
  --no-stream                           # Disable streaming

  # NEW: Middleware options
  --permission-mode <mode>              # interactive/auto/disabled
  --auto-approve                        # Enable auto-approve actions
  --enable-mentorship                   # Enable mentorship
  --mentorship-model <id>               # Helper model

  # NEW: MCP options
  --mcp-servers <list>                  # Comma-separated servers
  --no-mcp                              # Disable MCP

  # NEW: Context options
  --context-strategy <strategy>         # sliding-window/priority-based
  --no-compaction                       # Disable auto-compaction

  # NEW: Loop control
  --max-iterations <number>             # Max tool iterations
  --tool-timeout <ms>                   # Tool timeout
```

---

## 5. Implementation Priority Matrix

### Priority 1: Critical (Must Have for MVP)

**Timeline:** Week 1-2

1. **Permission Management**
   - `cortex permissions mode [mode]` command
   - `cortex permissions auto-approve` toggle
   - Interactive permission prompts in chat mode
   - **Reason:** Core safety feature, required for production use

2. **MCP Server Management**
   - `cortex mcp list/enable/disable` commands
   - MCP status display in interactive mode
   - **Reason:** Key differentiator, enables extensibility

3. **Checkpoint Resume**
   - `cortex session checkpoints <id>` command
   - `--resume <checkpoint>` option for chat mode
   - **Reason:** Core session feature mentioned in PRD

4. **Configuration Categories**
   - `cortex config categories` command
   - `cortex config category <cat>` viewer
   - **Reason:** Required to expose 29+ configuration options

### Priority 2: High (Should Have for v1.0)

**Timeline:** Week 3-4

5. **Mentorship Management**
   - `cortex mentorship` commands (status/enable/disable)
   - Keyword trigger management
   - Mentorship event display in UI
   - **Reason:** Major Wave 3 feature, enhances AI capabilities

6. **Advanced Session Features**
   - `cortex session stats <id>` command
   - Cache metrics display
   - Token/cost tracking
   - **Reason:** Important for cost monitoring and optimization

7. **Model Management Enhancements**
   - Provider filtering: `--provider <name>`
   - Model favorites system
   - Cost comparison
   - **Reason:** Improves UX with 66 models

8. **Error & Debug Commands**
   - `cortex debug errors` command
   - Error classification display
   - Tool execution history
   - **Reason:** Essential for debugging and troubleshooting

### Priority 3: Medium (Nice to Have for v1.1)

**Timeline:** Week 5-6

9. **Middleware Management**
   - `cortex middleware` commands
   - Middleware configuration UI
   - **Reason:** Advanced feature for power users

10. **Context Management UI**
    - Context budget display in status bar
    - Compaction controls
    - Historical retrieval commands
    - **Reason:** Helps users understand context management

11. **Advanced Configuration**
    - `cortex config wizard` interactive setup
    - Configuration validation
    - Import/export functionality
    - **Reason:** Improves configuration experience

12. **Session Search & Compare**
    - `cortex session search <query>`
    - `cortex session compare <id1> <id2>`
    - **Reason:** Useful for power users with many sessions

### Priority 4: Low (Future Enhancements)

**Timeline:** Post v1.1

13. **Dashboard Integration**
    - Link to sandbox dashboard from CLI
    - Embedded terminal viewer
    - **Reason:** Nice-to-have, not essential

14. **Model Aliases**
    - Custom model naming
    - Alias management
    - **Reason:** Convenience feature

15. **Advanced Permissions**
    - Custom policy creation
    - Policy templates
    - **Reason:** Advanced feature, niche use case

---

## 6. Feature Gap Summary by Component

### @cortex/core Coverage

| Component | Features | CLI PRD Coverage | Priority Gaps |
|-----------|----------|------------------|---------------|
| **Orchestrator** | Multi-provider, 66 models | Basic model list ✓ | Provider filtering (P2) |
| **Middleware** | 7 systems (Wave 3) | Not mentioned ❌ | Permissions (P1), Mentorship (P2) |
| **Tools** | 34 tools (27+7 MCP) | Basic display ✓ | MCP management (P1) |
| **Session** | Timeline, checkpoints, JSONL | Basic list/view ✓ | Checkpoint resume (P1), stats (P2) |
| **Context** | Budget, compaction, retrieval | Not mentioned ❌ | Context UI (P3) |
| **Config** | 29+ settings, 6 categories | 5 settings ✓ | Categories (P1), wizard (P3) |
| **MCP** | Server registry, auto-inject | Not mentioned ❌ | Full MCP UI (P1) |

### Server API Coverage

| Endpoint | Purpose | CLI PRD Coverage | Priority Gaps |
|----------|---------|------------------|---------------|
| POST /v1/messages | Main inference | Fully covered ✓ | None |
| GET /models | List models | Covered ✓ | Enhanced filtering (P2) |
| GET /health | Health check | Covered ✓ | None |
| GET /v1/approval-mode | Get approval mode | Not mentioned ❌ | Approval commands (P1) |
| POST /v1/approval-mode | Set approval mode | Not mentioned ❌ | Toggle command (P1) |
| Dashboard (4001) | Sandbox/tmux viewer | Not mentioned ❌ | Link reference (P4) |

---

## 7. Recommended PRD Updates

### 7.1 New Sections to Add

1. **Section 4.9: Permissions Management**
   - Permission mode commands
   - Auto-approve toggle
   - Audit log viewer
   - Policy management

2. **Section 4.10: MCP Server Management**
   - MCP server listing
   - Enable/disable commands
   - Configuration management
   - Status monitoring

3. **Section 4.11: Mentorship Management**
   - Mentorship enable/disable
   - Keyword management
   - Helper model selection
   - Event log viewer

4. **Section 4.12: Middleware Control**
   - Middleware status
   - Middleware configuration
   - Event monitoring

5. **Section 4.13: Advanced Session Features**
   - Checkpoint management
   - Session statistics
   - Cache metrics
   - Compaction controls

6. **Section 4.14: Debug & Monitoring**
   - Error log viewer
   - Tool execution history
   - Middleware events
   - Performance metrics

### 7.2 Sections to Enhance

1. **Section 4.4: Model Management**
   - Add provider filtering
   - Add favorites system
   - Add cost tracking
   - Add model comparison

2. **Section 4.5: Session Management**
   - Add checkpoint commands
   - Add statistics display
   - Add search functionality
   - Add comparison features

3. **Section 4.7: Configuration Management**
   - Expand to 29+ settings
   - Add category organization
   - Add interactive wizard
   - Add validation

4. **Section 5: Interactive Mode UI**
   - Add permission prompt UI
   - Add mentorship indicators
   - Add context budget meter
   - Add error classification display

---

## 8. Testing Requirements

### 8.1 Integration Tests Needed

1. **Permission System**
   - Test all 3 permission modes
   - Test auto-approve toggle
   - Test policy enforcement
   - Test approval prompts

2. **MCP Integration**
   - Test server discovery
   - Test server enable/disable
   - Test tool injection
   - Test configuration

3. **Middleware**
   - Test error classification
   - Test retry behavior
   - Test mentorship triggers
   - Test loop detection

4. **Session Features**
   - Test checkpoint creation
   - Test checkpoint resume
   - Test compaction
   - Test historical retrieval

5. **Multi-Provider**
   - Test all 10 providers
   - Test model switching
   - Test provider fallback
   - Test cost tracking

### 8.2 E2E Scenarios

1. **Complete Session Lifecycle**
   - Start chat → execute tools → create checkpoint → resume → export

2. **Permission Management Flow**
   - Set interactive mode → receive prompt → approve → set auto-approve → verify no prompts

3. **MCP Workflow**
   - List servers → enable server → verify tools → execute MCP tool → disable server

4. **Mentorship Workflow**
   - Enable mentorship → trigger error → verify helper model response → check event log

5. **Context Management**
   - Long conversation → trigger compaction → retrieve historical context → verify summaries

---

## 9. Documentation Requirements

### 9.1 New Documentation Files

1. **PERMISSIONS_GUIDE.md**
   - Permission modes explained
   - Policy system documentation
   - Auto-approve actions guide
   - Security best practices

2. **MCP_INTEGRATION.md**
   - MCP server discovery
   - Server configuration
   - Tool registration
   - Custom server setup

3. **MENTORSHIP_GUIDE.md**
   - When to use mentorship
   - Keyword triggers
   - Helper model selection
   - Cost optimization

4. **MIDDLEWARE_REFERENCE.md**
   - All 7 middleware systems
   - Configuration options
   - Event monitoring
   - Troubleshooting

5. **ADVANCED_SESSIONS.md**
   - Checkpoint strategies
   - Context management
   - Historical retrieval
   - Cost tracking

### 9.2 Updated Documentation

1. **COMMANDS.md**
   - Add 50+ new commands
   - Add examples for each
   - Add troubleshooting tips

2. **EXAMPLES.md**
   - Add permission examples
   - Add MCP examples
   - Add mentorship examples
   - Add advanced session examples

3. **README.md**
   - Update feature list
   - Add middleware section
   - Add MCP section
   - Add Wave 3 features

---

## 10. Conclusion

The Nexus Cortex core library provides a **comprehensive feature set** that significantly exceeds the current CLI PRD scope. The audit reveals:

### Key Metrics
- **66 models** across 10 providers (vs. basic list in PRD)
- **34 tools** total (27 base + 7 MCP management)
- **7 middleware systems** (Wave 3 complete, not in PRD)
- **29+ configuration settings** (vs. 5 in PRD)
- **4 historical retrieval tools** (not in PRD)
- **6 configuration categories** (vs. 1 in PRD)

### Critical Gaps Identified
1. **Permissions management** - 0% covered, Priority 1
2. **MCP management** - 0% covered, Priority 1
3. **Mentorship features** - 0% covered, Priority 2
4. **Advanced session features** - 20% covered, Priority 1-2
5. **Middleware control** - 0% covered, Priority 3
6. **Context management** - 0% covered, Priority 3

### Recommendation
The CLI PRD should be **significantly expanded** to expose the full power of the core library. A phased rollout (P1→P2→P3→P4) will ensure MVP delivery while building toward a complete feature set.

**Estimated Expansion:** Current PRD is ~30% of required functionality. Full feature parity requires:
- 50+ additional commands
- 20+ new UI components
- 6 new documentation files
- 15+ new command categories

---

**End of Audit Report**
