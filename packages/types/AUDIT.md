# Types Package Audit

**Date**: 2025-12-05
**Package**: @nexus-cortex/types
**Location**: `packages/types/src/`
**Total Files**: 8
**Purpose**: Shared TypeScript types (breaks circular dependency between core and executors)

---

## Files

### index.ts
**Type**: Module re-exports
- Exports all types from: `tools`, `messages`, `session`, `models`, `adapters`, `registry`, `historical`
- Purpose: Barrel export for canonical type definitions

---

### tools.ts
**Type**: Tool-related type definitions

**Interfaces**:
- **CanonicalTool** - Provider-agnostic tool/function representation
  - Fields: name, description, schema, metadata
  - Supports original naming convention tracking and source provider metadata

- **ToolSchema** - JSON Schema representation for tool parameters
  - Fields: type (always 'object'), properties, required

- **PropertySchema** - JSON Schema definition for individual property
  - Fields: type, description, enum, default, items, properties
  - Supports recursive schema definitions for arrays and objects

- **CanonicalToolUse** - Tool invocation request from AI model
  - Fields: id, name, input, metadata
  - Tracks model ID and source provider

- **CanonicalToolResult** - Result of executing a tool
  - Fields: tool_use_id, content, is_error, metadata
  - Tracks execution time and summarization status

- **CanonicalContentBlock** - Different types of content in messages
  - Fields: type (text|tool_use|tool_result|thinking), text, toolUse, toolResult, thinking, signature
  - Supports Claude extended thinking signatures

- **TokenUsage** - Token consumption information
  - Fields: inputTokens, outputTokens, totalTokens

---

### messages.ts
**Type**: Message-related type definitions

**Interfaces**:
- **CanonicalMessage** - Provider-agnostic internal storage format
  - Identity: uuid, parentUuid, timestamp
  - Timeline tracking: sessionId, conversationId, turnNumber, checkpointId, branchPoint, resumePoint
  - Content: role (user|assistant|system), type (text|tool_request|tool_response|thinking|compact_boundary|model_switch|checkpoint|resume)
  - Model context: id, provider, apiPattern
  - Metadata: originalProvider, originalFormat, usage, stopReason, fileSnapshots, compactionId, toolResultSummarized

---

### models.ts
**Type**: Model configuration and registry type definitions

**Interfaces**:
- **ModelConfig** - Complete model configuration
  - Identity: id, modelId, provider, displayName, family
  - API Configuration: pattern, endpoint, apiKeyEnvVar, authHeader, authPrefix
  - Tool System: supported, adapter, namingConvention, maxTools, parallelToolCalls
  - Server-Side Tools: supported, supportedEndpoints, availableTools, toolConfig
  - Parameters: temperature, maxTokens, topP, topK, frequencyPenalty, presencePenalty
  - Streaming: supported, format, eventTypes, toolCallsInStream, reasoningInStream
  - Structured Output: supported, format, schemaType
  - Reasoning: supported, format, extractionMethod, pattern
  - Context Limits: contextWindow, outputTokens, requestsPerMinute, tokensPerMinute
  - Compaction Configuration: strategy, thresholdCalculation, behavior
  - Cost: inputPerMillion, outputPerMillion

- **ParameterConfig<T>** - Generic parameter configuration

- **HelperModelMapping** - Maps providers to cost-optimized helper models

- **ModelRegistry** - Interface for accessing model configurations
  - Methods: registerModel, getModel, hasModel, getModelsByProvider, getModelsByFamily, getHelperModel, getCompactionThreshold, listModels

- **ModelCapabilities** - High-level model capabilities summary

- **ModelProvider** - Provider metadata and capabilities

---

### adapters.ts
**Type**: Format adapter and adapter registry type definitions

**Interfaces**:
- **FormatAdapter** - Bidirectional conversion between canonical and provider formats
  - Identity: name, apiPatterns
  - Methods: toProviderMessages, fromProviderMessages, toProviderTools, fromProviderTools, toProviderToolUse, fromProviderToolUse, toProviderToolResult, fromProviderToolResult, validateTool, getMaxTools, supportsParallelToolCalls

- **AdapterRegistry** - Registry for managing format adapters
  - Methods: registerAdapter, getAdapter, getAdapterForModel, hasAdapter, listAdapters

---

### registry.ts
**Type**: Tool registry and executor configuration type definitions

**Interfaces**:
- **ToolImplementation** - Actual implementation of a tool
  - Fields: name, description, schema, execute method, isAvailable, metadata

- **ToolFactoryInterface** - Factory for creating tool instances
  - Methods: createTool, canCreate, listTools

- **ToolRegistry** - Read-only interface for accessing tools
  - Methods: getTool, getToolDefinition, listTools, listToolsByCategory, hasTool, getAllDefinitions, getAvailableTools

- **MutableToolRegistry** - Extends ToolRegistry with mutation methods
  - Methods: registerTool, registerTools, registerFactory, unregisterTool, clear, setToolEnabled, setToolMetadata

- **ToolDiscovery** - Interface for dynamic tool discovery
  - Methods: discoverTools, onToolsChanged

- **ToolChangeEvent** - Event emitted when tools change
  - Fields: type (added|removed|updated), tools, timestamp, source

- **ToolExecutionContext** - Context provided during tool execution
  - Fields: sessionId, conversationId, modelId, userId, projectPath

- **ExecutorConfig** - Configuration for tool execution
  - Fields: workingDirectory, maxExecutionTime, allowNetwork, allowFileSystem, allowShellExecution

- **ExecutorRegistry** - Minimal interface to break circular dependency
  - Methods: getExecutorCount, hasExecutor, getExecutorNames, execute, updateConfig, getConfig

---

### session.ts
**Type**: Session, timeline, and conversation-related type definitions

**Interfaces**:
- **SessionMetadata** - Core session metadata with cache performance
  - Fields: sessionId, projectPath, startTime, lastModified, messageCount, compactionCount, currentModel
  - Cache Metrics: requestCount, totalInputTokens, totalOutputTokens, cacheCreationTokens, cacheReadTokens, uncachedInputTokens, cacheHitRate, costSavingsRatio

- **TimelineEvent** - Base event for timeline tracking
  - Fields: id, type, timestamp, conversationId, turnNumber, metadata

- **MessageEvent** - Message timeline event (type: 'message')
- **CheckpointEvent** - Checkpoint timeline event (type: 'checkpoint')
- **CompactionEvent** - Compaction timeline event (type: 'compaction')
- **ModelSwitchEvent** - Model change timeline event (type: 'model_switch')
- **ResumeEvent** - Resume from checkpoint event (type: 'resume')
- **BranchEvent** - Branch creation event (type: 'branch_create')
- **ConversationStartEvent** - Conversation start event (type: 'conversation_start')

- **Conversation** - Linear sequence of messages
  - Fields: id, startTime, lastActiveTime, turnCount, messageIds, parentConversationId, branchPoint, modelId, tokenCount, isActive

- **Checkpoint** - Saved state in timeline
  - Fields: id, conversationId, turnNumber, timestamp, description, messageIds, tokenCount, modelId, contextMetadata, resumable, resumeCount

- **CheckpointOptions** - Options for creating checkpoints
- **CheckpointWithFiles** - Checkpoint with associated files
- **CompactionPoint** - Conversation compaction in timeline
- **ModelSwitch** - Model change in timeline
- **CompactionMetadata** - Compaction boundary metadata

**Type Aliases**:
- **TimelineEventType** - Union of all timeline event types
- **AnyTimelineEvent** - Union of all timeline event interfaces

---

### historical.ts
**Type**: Historical context and conversation retrieval type definitions

**Interfaces**:
- **GetConversationSegmentInput** - Input for retrieving conversation segments
- **ConversationSegment** - Retrieved conversation segment
- **ListCompactionBoundariesInput** - Input for listing compactions
- **CompactionBoundary** - Compaction boundary information
- **RequestHistoricalContextInput** - Input for requesting historical context
- **HistoricalContextResult** - Historical context generation result
- **SearchConversationHistoryInput** - Input for searching conversation history
- **SearchResult** - Search result from conversation history
- **ListSessionsInput** - Input for listing sessions
- **SessionSummary** - Session summary information
- **LoadSessionInput** - Input for loading session
- **SessionLoadResult** - Session load result

---

## Summary Statistics

| Category | Count |
|----------|-------|
| **Total Files** | 8 |
| **Total Interfaces** | 48 |
| **Total Type Aliases** | 2 |

## Exports by File

| File | Exports |
|------|---------|
| index.ts | Re-exports all |
| tools.ts | 7 interfaces |
| messages.ts | 1 interface |
| models.ts | 6 interfaces |
| adapters.ts | 2 interfaces |
| registry.ts | 9 interfaces |
| session.ts | 14 interfaces + 2 type aliases |
| historical.ts | 12 interfaces |

## Key Characteristics

1. **Provider-Agnostic Design**: All types represent canonical formats independent of specific AI providers
2. **Timeline/Session Support**: Comprehensive tracking of conversation flow, checkpoints, and compaction
3. **Multi-Adapter Architecture**: Support for different API patterns (messages, chat-completions, generate-content, responses)
4. **Tool System**: Complete tool definition, usage, and execution context types
5. **Cache Metrics**: Phase 2.7 additions for prompt caching performance tracking
6. **Historical Context**: Rich types for conversation retrieval, search, and compaction boundaries
7. **Circular Dependency Breaking**: Types package designed to eliminate circular dependencies between core and executors
