# System Messages Documentation Index

## Overview

This directory contains the **System Message Registry** system - a comprehensive framework for instructing AI models on tool usage, reasoning, and behavior through markdown-based message injection.

## Core Implementation Files

### System Message Engine
- **SystemMessageRegistry.interface.ts** - TypeScript type definitions for the registry system
- **SystemMessageLoader.ts** - Loads and injects system messages based on conditions
- **SystemReminderInjector.ts** - Handles injection of system reminders into message stream
- **system-message-registry.json** - Registry configuration defining all system messages
- **index.ts** - Public exports

### Message Library (messages/)
- **SYSTEM_PROMPT.md** (75 lines) - Core AI instructions about capabilities and environment
- **TOOL_USAGE_GUIDE.md** (120 lines) - Detailed protocol for using tools correctly
- **EXAMPLES.md** (180 lines) - 8 concrete examples of proper tool usage
- **REASONING_GUIDE.md** (150 lines) - Instructions for models with reasoning capabilities
- **ENVIRONMENT_INFO.md** (30 lines) - Dynamic workspace/sandbox information (with templates)
- **POLICY_CHECK.md** (60 lines) - Safety policies and behavioral constraints
- **PERIODIC_REMINDER.md** (25 lines) - Tool usage reminders for long conversations

## Architectural Documentation

### Core Design Documents

#### 1. ARCHITECTURE.md (290 lines)
**Purpose**: Original architectural design of the system message registry

**Key Sections**:
- Registry-based configuration
- Deterministic injection conditions
- Template variable system
- Deduplication strategy
- Integration with Orchestrator

**When to Read**: Understanding the foundational architecture

---

#### 2. HOOK_BASED_INJECTION_DESIGN.md (280 lines)
**Purpose**: Hook-based injection pattern based on Claude CLI research

**Key Insights**:
- Inject INTO user message content arrays (not separate system messages)
- Three hook points: before API request, after tool result, periodic
- `<system-reminder>` tag wrapping for compatibility
- Content hash deduplication

**When to Read**: Understanding how injection works at runtime

---

#### 3. SYSTEM_MESSAGES_HANDOFF.md (520 lines)
**Purpose**: Complete integration guide for wiring into Orchestrator

**Contains**:
- Step-by-step integration instructions
- Code examples for each integration point
- Helper method implementations
- Testing strategies

**When to Read**: When implementing the system message injection

---

#### 4. SYSTEM_MESSAGES_IMPLEMENTATION_COMPLETE.md (354 lines)
**Purpose**: Summary of completed implementation

**Contains**:
- What was built (15 files, ~2,200 lines)
- How it works (loading flow, injection example)
- Next steps (integration checklist)
- Benefits delivered

**When to Read**: Getting a high-level overview of what's complete

---

### Extended Capabilities Documentation

#### 5. TOOL_SYSTEM_MESSAGE_INTEGRATION.md (450 lines)
**Purpose**: Design for tool-specific system message injection

**Key Features**:
- Tool-category messages (FILE_OPERATIONS_GUIDE, BASH_EXECUTION_GUIDE, etc.)
- Extended injection conditions (toolNames, toolCategories, mcpServers)
- Tool metadata extraction from Orchestrator
- Dynamic injection based on available tools

**Key Concepts**:
```typescript
// Messages inject only when relevant tools available
{
  "id": "file_operations_guide",
  "conditions": {
    "toolCategories": ["file"]  // Only when Read, Write, Edit, Glob present
  }
}
```

**When to Read**: After basic system messages working, want tool-specific guidance

---

#### 6. REASONING_ARCHITECTURE_ANALYSIS.md (600 lines)
**Purpose**: Comprehensive analysis of reasoning/thinking block handling

**Key Questions Answered**:
- Is reasoning stored in canonical storage? (YES)
- Is reasoning re-added to conversation stream? (YES)
- What's the difference between interleaved thinking? (Explained)
- Are thinking blocks associated with UUIDs? (YES)
- Could reasoning be summarized by helper model? (NOT YET, BUT POSSIBLE)

**Current Implementation Status**:
- ✅ Thinking blocks in canonical format
- ✅ Adapter conversion (bidirectional)
- ✅ JSONL storage
- ✅ REASONING_GUIDE.md exists
- ⚠️ Model capability not exposed (reasoning never triggers)
- ❌ No reasoning-aware compaction
- ❌ No context window optimization

**Proposed Integration**:
- Phase 1: Expose reasoning capability in model cards
- Phase 2: Reasoning-aware compaction (summarize verbose thinking)
- Phase 3: Context budget optimization (selective thinking inclusion)

**When to Read**: Understanding how reasoning/thinking blocks work and integrating them

---

#### 7. SYSTEM_MESSAGES_AND_TOOLS_STATUS.md (400 lines)
**Purpose**: Comprehensive status document with examples and next steps

**Contains**:
- Current implementation status
- How tool system works
- Complete example flows
- Architecture diagrams
- Next immediate steps with code
- Success metrics

**Key Example**: File edit request showing which system messages inject

**When to Read**: Want complete picture of current state and next steps

---

## Implementation Roadmap

### Phase 1: Basic System Message Injection (Foundation) ⏳
**Status**: Infrastructure complete, integration pending

**Tasks**:
1. Wire SystemMessageLoader into Orchestrator constructor
2. Add injection helper methods to Orchestrator
3. Wire hooks into sendMessage()
4. Test with grok-code-fast-1

**Expected Outcome**: Model receives SYSTEM_PROMPT, TOOL_USAGE_GUIDE on turn 0

**Documentation**: SYSTEM_MESSAGES_HANDOFF.md

---

### Phase 2: Tool-Specific Messages (Enhancement) 🔮
**Status**: Designed, not implemented

**Tasks**:
1. Update InjectionContext with toolNames, toolCategories
2. Update InjectionConditions in interface
3. Implement tool metadata extraction in Orchestrator
4. Create tool-category message files (5 files)
5. Update registry configuration

**Expected Outcome**: FILE_OPERATIONS_GUIDE injects when file tools present

**Documentation**: TOOL_SYSTEM_MESSAGE_INTEGRATION.md

---

### Phase 3: Reasoning Support (Enhancement) 🔮
**Status**: Analyzed, not implemented

**Tasks**:
1. Add reasoning config to model cards (o1, deepseek-reasoner, claude-sonnet-4-5)
2. Update getModelCapabilities() to check reasoning support
3. Test REASONING_GUIDE.md injection
4. Implement reasoning-aware compaction

**Expected Outcome**: REASONING_GUIDE.md injects for reasoning models

**Documentation**: REASONING_ARCHITECTURE_ANALYSIS.md

---

## Key Design Patterns

### 1. Deterministic Injection
Messages inject based on:
- Turn number (`turnNumber: 0`)
- Tool presence (`hasTools: true`)
- Model capabilities (`modelCapabilities: ['reasoning']`)
- Tool categories (`toolCategories: ['file']`)
- Periodic triggers (`turnNumberModulo: { divisor: 10, remainder: 0 }`)

### 2. Template Variables
Dynamic content via `{{variable}}` syntax:
```markdown
Workspace: {{projectPath}}
Tools Available: {{toolCount}}
Current Date: {{currentDate}}
```

### 3. Content Array Injection (Claude CLI Pattern)
Messages injected INTO user message content array:
```json
{
  "role": "user",
  "content": [
    {"type": "text", "text": "<system-reminder>\n...\n</system-reminder>"},
    {"type": "text", "text": "User input"}
  ]
}
```

### 4. Content Hash Deduplication
Prevents redundant injections via SHA-256 hash of content

## Integration Points

### With Orchestrator
- Hook: Before API request (inject messages)
- Hook: After tool result (inject tool-specific guidance)
- Hook: Periodic (every N turns)

### With HelperModelMiddleware
- Future: Helper model can summarize reasoning
- Future: Helper model can generate mentorship guidance

### With ModelRegistry
- Future: Model capabilities determine injection
- Future: Reasoning support triggers REASONING_GUIDE

## Directory Structure

```
src/system-messages/
├── DOCUMENTATION_INDEX.md              # This file
│
├── Core Implementation
├── SystemMessageRegistry.interface.ts  # Types
├── SystemMessageLoader.ts              # Loader
├── SystemReminderInjector.ts           # Injector
├── system-message-registry.json        # Config
├── index.ts                            # Exports
│
├── Architecture Docs
├── ARCHITECTURE.md                     # Original design
├── HOOK_BASED_INJECTION_DESIGN.md      # Injection pattern
├── SYSTEM_MESSAGES_HANDOFF.md          # Integration guide
├── SYSTEM_MESSAGES_IMPLEMENTATION_COMPLETE.md  # Summary
│
├── Extended Capabilities
├── TOOL_SYSTEM_MESSAGE_INTEGRATION.md  # Tool-specific messages
├── REASONING_ARCHITECTURE_ANALYSIS.md  # Reasoning/thinking blocks
├── SYSTEM_MESSAGES_AND_TOOLS_STATUS.md # Comprehensive status
│
└── Message Library
    └── messages/
        ├── SYSTEM_PROMPT.md
        ├── TOOL_USAGE_GUIDE.md
        ├── EXAMPLES.md
        ├── REASONING_GUIDE.md
        ├── ENVIRONMENT_INFO.md
        ├── POLICY_CHECK.md
        └── PERIODIC_REMINDER.md
```

## Quick Start Guide

### For Implementation
1. Read: SYSTEM_MESSAGES_HANDOFF.md (integration steps)
2. Read: HOOK_BASED_INJECTION_DESIGN.md (injection pattern)
3. Follow: Step-by-step integration checklist
4. Test: With grok-code-fast-1

### For Understanding Architecture
1. Read: SYSTEM_MESSAGES_IMPLEMENTATION_COMPLETE.md (overview)
2. Read: ARCHITECTURE.md (foundational design)
3. Read: SYSTEM_MESSAGES_AND_TOOLS_STATUS.md (current state)

### For Advanced Features
1. Tool integration: TOOL_SYSTEM_MESSAGE_INTEGRATION.md
2. Reasoning support: REASONING_ARCHITECTURE_ANALYSIS.md

## Related Documentation

- **Middleware Documentation**: `src/middleware/helpers/docs/` - Helper model mentorship system
- **Model Registry**: `src/models/README.md` - Model configuration and capabilities
- **Orchestrator**: `src/orchestrator/` - Central coordination layer

## Summary

The System Message Registry provides:
✅ **Deterministic Injection** - Rule-based, not heuristic
✅ **User-Editable** - Markdown files can be modified
✅ **Template Support** - Dynamic content injection
✅ **Tool-Aware** - Messages specific to available tools
✅ **Reasoning Support** - Instructions for reasoning models
✅ **Deduplication** - No redundant injections
✅ **Extensible** - Easy to add new message types
✅ **Well-Documented** - Comprehensive architecture and integration guides

**Status**: Infrastructure complete (15 files, ~2,200 lines), integration pending

**Next Step**: Wire SystemMessageLoader into Orchestrator (see SYSTEM_MESSAGES_HANDOFF.md)
