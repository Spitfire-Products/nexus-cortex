# Visual Integration Gap

## Current Architecture (Broken)

```
┌──────────────────────────────────────────────────────────────────────────┐
│                           User Application                                │
│                                                                           │
│  const orchestrator = new OmniClaudeOrchestrator();                      │
│  const response = await orchestrator.sendMessage("Read README.md");      │
│                                                                           │
└───────────────────────────────┬──────────────────────────────────────────┘
                                │
                                ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                    @omniclaude/core/orchestrator                          │
│                                                                           │
│  ┌─────────────────────────────────────────────────────────────┐         │
│  │ OmniClaudeOrchestrator.sendMessage()                        │         │
│  │                                                             │         │
│  │ 1. Get tool schemas from ToolFactory ✅                     │         │
│  │    const tools = toolFactory.getAllTools();                 │         │
│  │                                                             │         │
│  │ 2. Send message + tools to Claude API ✅                    │         │
│  │    const response = await claudeAPI.messages.create({       │         │
│  │      messages: [...],                                       │         │
│  │      tools: tools                                           │         │
│  │    });                                                      │         │
│  │                                                             │         │
│  │ 3. Receive response with tool_use ✅                        │         │
│  │    {                                                        │         │
│  │      content: [                                             │         │
│  │        {                                                    │         │
│  │          type: "tool_use",                                  │         │
│  │          id: "toolu_123",                                   │         │
│  │          name: "Read",                                      │         │
│  │          input: { file_path: "README.md" }                  │         │
│  │        }                                                    │         │
│  │      ]                                                      │         │
│  │    }                                                        │         │
│  │                                                             │         │
│  │ 4. Extract tool uses ✅                                     │         │
│  │    const toolUses = content.filter(b => b.type === '...')  │         │
│  │                                                             │         │
│  │ 5. Return to user ✅                                        │         │
│  │    return { toolUses: [...] }                              │         │
│  │                                                             │         │
│  │ ❌ NO CODE TO EXECUTE TOOLS                                │         │
│  │ ❌ NO CODE TO SEND RESULTS BACK                            │         │
│  └─────────────────────────────────────────────────────────────┘         │
│                                                                           │
│                                                                           │
│  ┌────────────────┐                                                      │
│  │  ToolFactory   │                                                      │
│  │                │                                                      │
│  │  getAllTools() │  ← Returns schemas only (no executors)              │
│  │                │                                                      │
│  │  [ { name: "Read", description: "...", parameters: {...} } ]         │
│  │                │                                                      │
│  └────────────────┘                                                      │
│                                                                           │
└──────────────────────────────────────────────────────────────────────────┘

                        ❌ NO IMPORTS ❌
                        ❌ NO CONNECTION ❌
                        ❌ NO WIRING ❌

┌──────────────────────────────────────────────────────────────────────────┐
│                   @omniclaude/executors (UNUSED)                          │
│                                                                           │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐    │
│  │ ReadFileTool│  │ WriteFile   │  │ EditFileTool│  │  GrepTool   │    │
│  │             │  │    Tool     │  │             │  │             │    │
│  │ execute()   │  │ execute()   │  │ execute()   │  │ execute()   │    │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘    │
│                                                                           │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐    │
│  │  GlobTool   │  │ WebSearch   │  │  WebFetch   │  │  BashTool   │    │
│  │             │  │    Tool     │  │    Tool     │  │             │    │
│  │ execute()   │  │ execute()   │  │ execute()   │  │ execute()   │    │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘    │
│                                                                           │
│  ... 16 more tools (24 total, 338 tests passing ✅)                      │
│                                                                           │
│  ⚠️  PROBLEM: Orchestrator doesn't import or use these implementations   │
│  ⚠️  RESULT: Tools defined but never executed                            │
│                                                                           │
└──────────────────────────────────────────────────────────────────────────┘

═══════════════════════════════════════════════════════════════════════════

## Desired Architecture (Working)

┌──────────────────────────────────────────────────────────────────────────┐
│                           User Application                                │
│                                                                           │
│  const orchestrator = new OmniClaudeOrchestrator();                      │
│  const response = await orchestrator.sendMessage("Read README.md");      │
│                                                                           │
└───────────────────────────────┬──────────────────────────────────────────┘
                                │
                                ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                    @omniclaude/core/orchestrator                          │
│                                                                           │
│  ┌─────────────────────────────────────────────────────────────┐         │
│  │ OmniClaudeOrchestrator.sendMessage()                        │         │
│  │                                                             │         │
│  │ 1. Get tool schemas ✅                                      │         │
│  │ 2. Send to Claude API ✅                                    │         │
│  │ 3. Receive tool_use ✅                                      │         │
│  │ 4. Extract tool uses ✅                                     │         │
│  │                                                             │         │
│  │ 5. ✨ NEW: Execute tools via ToolExecutorService           │         │
│  │    const results = await this.executorService.executeTool(  │         │
│  │      toolName: "Read",                                      │         │
│  │      params: { file_path: "README.md" },                    │         │
│  │      signal                                                 │         │
│  │    );                                                       │         │
│  │    // results = { success: true, llmContent: "# Project..." }│        │
│  │                                                             │         │
│  │ 6. ✨ NEW: Create tool_result message                       │         │
│  │    const toolResultMsg = {                                  │         │
│  │      type: "tool_result",                                   │         │
│  │      tool_use_id: "toolu_123",                              │         │
│  │      content: results.llmContent                            │         │
│  │    };                                                       │         │
│  │                                                             │         │
│  │ 7. ✨ NEW: Send tool_result back to Claude                  │         │
│  │    const finalResponse = await claudeAPI.messages.create({  │         │
│  │      messages: [...previousMsgs, toolResultMsg],            │         │
│  │      tools: tools                                           │         │
│  │    });                                                      │         │
│  │    // Claude uses file contents to answer question         │         │
│  │                                                             │         │
│  │ 8. Return final response to user ✅                         │         │
│  │    return { content: "The README shows..." }                │         │
│  │                                                             │         │
│  └─────────────────────────────────────────────────────────────┘         │
│                                │                                          │
│                                │ calls                                    │
│                                ▼                                          │
│  ┌──────────────────────────────────────────────────────────┐            │
│  │  ✨ NEW: ToolExecutorService                             │            │
│  │                                                           │            │
│  │  private executors: Map<string, BaseTool>                │            │
│  │                                                           │            │
│  │  executeTool(name, params, signal) {                     │            │
│  │    const executor = this.executors.get(name);            │            │
│  │    return await executor.execute(params, signal);        │            │
│  │  }                                                       │            │
│  └──────────────────────────────────────────────────────────┘            │
│                                │                                          │
│                                │ imports and uses                         │
│                                ▼                                          │
└────────────────────────────────┼──────────────────────────────────────────┘
                                 │
                ✅ IMPORTS @omniclaude/executors ✅
                                 │
                                 ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                   @omniclaude/executors (NOW USED!)                       │
│                                                                           │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐    │
│  │ ReadFileTool│  │ WriteFile   │  │ EditFileTool│  │  GrepTool   │    │
│  │    ▲        │  │   Tool ▲    │  │      ▲      │  │      ▲      │    │
│  │    │execute │  │      │execute│  │      │execute│  │      │execute│  │
│  │    │called  │  │      │called │  │      │called │  │      │called │  │
│  └────┼────────┘  └──────┼───────┘  └──────┼───────┘  └──────┼───────┘  │
│       │                  │                  │                  │          │
│       └──────────────────┴──────────────────┴──────────────────┘          │
│                                                                           │
│  24 tools actively used via ToolExecutorService ✅                        │
│  338 tests passing ✅                                                     │
│  Full integration working ✅                                              │
│                                                                           │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## Message Flow Comparison

### Current (Broken)

```
┌──────┐     ┌───────────────┐     ┌───────────┐
│ User │────▶│ Orchestrator  │────▶│ Claude API│
└──────┘     └───────┬───────┘     └─────┬─────┘
   ▲                 │                   │
   │                 │                   │
   │                 │ 1. Send message   │
   │                 │    + tool schemas │
   │                 │ ─────────────────▶│
   │                 │                   │
   │                 │ 2. tool_use       │
   │                 │ ◀─────────────────│
   │                 │                   │
   │                 │ ❌ No execution   │
   │                 │ ❌ No tool_result │
   │                 │ ❌ No final reply │
   │                 │                   │
   │ 3. Return       │                   │
   │    tool_use     │                   │
   │    (incomplete) │                   │
   │ ◀───────────────┘                   │
   │                                     │
   └─────────────────────────────────────┘
        ❌ User never gets file contents
        ❌ Conversation incomplete
```

### Desired (Working)

```
┌──────┐     ┌───────────────┐     ┌─────────────┐     ┌──────────┐
│ User │────▶│ Orchestrator  │────▶│ Executor    │     │Claude API│
└──────┘     └───────┬───────┘     │  Service    │     └────┬─────┘
   ▲                 │              └──────┬──────┘          │
   │                 │                     │                 │
   │                 │ 1. Send message     │                 │
   │                 │    + tool schemas   │                 │
   │                 │ ────────────────────────────────────▶ │
   │                 │                     │                 │
   │                 │ 2. tool_use         │                 │
   │                 │ ◀───────────────────────────────────  │
   │                 │                     │                 │
   │                 │ 3. Execute tool     │                 │
   │                 │ ───────────────────▶│                 │
   │                 │                     │                 │
   │                 │                     │ 4. Read file    │
   │                 │                     │    from disk    │
   │                 │                     │    ✅            │
   │                 │                     │                 │
   │                 │ 5. tool_result      │                 │
   │                 │ ◀──────────────────  │                 │
   │                 │                     │                 │
   │                 │ 6. Send tool_result │                 │
   │                 │    back to Claude   │                 │
   │                 │ ────────────────────────────────────▶ │
   │                 │                     │                 │
   │                 │ 7. Final response   │                 │
   │                 │    (uses file data) │                 │
   │                 │ ◀───────────────────────────────────  │
   │                 │                     │                 │
   │ 8. Complete     │                     │                 │
   │    answer       │                     │                 │
   │ ◀───────────────┘                     │                 │
   │                                       │                 │
   └───────────────────────────────────────┴─────────────────┘
        ✅ User gets complete answer with file contents
        ✅ Tools executed successfully
        ✅ Full conversation flow working
```

---

## File Structure Comparison

### Current

```
packages/
├── core/
│   ├── src/
│   │   ├── orchestrator/
│   │   │   └── OmniClaudeOrchestrator.ts  ← Uses tool schemas only
│   │   ├── tools/
│   │   │   ├── ToolFactory.ts              ← Returns schemas, not executors
│   │   │   └── BaseToolRegistry.ts         ← Schema definitions
│   │   └── index.ts
│   └── package.json
│       └── dependencies:
│           ├── @anthropic-ai/sdk ✅
│           ├── @google/generative-ai ✅
│           └── ❌ @omniclaude/executors MISSING
│
└── executors/
    ├── src/
    │   ├── implementations/
    │   │   ├── file/
    │   │   │   ├── ReadFileTool.ts         ← Never imported
    │   │   │   ├── WriteFileTool.ts        ← Never imported
    │   │   │   └── EditFileTool.ts         ← Never imported
    │   │   ├── search/
    │   │   │   ├── GrepTool.ts             ← Never imported
    │   │   │   └── GlobTool.ts             ← Never imported
    │   │   └── ... 19 more tools
    │   └── index.ts                         ← Exports but nothing imports
    └── package.json
```

### Desired

```
packages/
├── core/
│   ├── src/
│   │   ├── orchestrator/
│   │   │   └── OmniClaudeOrchestrator.ts  ← ✅ Uses ToolExecutorService
│   │   ├── tools/
│   │   │   ├── ToolFactory.ts              ← Returns schemas
│   │   │   ├── BaseToolRegistry.ts         ← Schema definitions
│   │   │   └── ✨ ToolExecutorService.ts   ← NEW: Manages executors
│   │   └── index.ts
│   └── package.json
│       └── dependencies:
│           ├── @anthropic-ai/sdk ✅
│           ├── @google/generative-ai ✅
│           └── ✅ @omniclaude/executors ← ADDED
│
└── executors/
    ├── src/
    │   ├── implementations/
    │   │   ├── file/
    │   │   │   ├── ReadFileTool.ts         ← ✅ Imported by ToolExecutorService
    │   │   │   ├── WriteFileTool.ts        ← ✅ Imported by ToolExecutorService
    │   │   │   └── EditFileTool.ts         ← ✅ Imported by ToolExecutorService
    │   │   ├── search/
    │   │   │   ├── GrepTool.ts             ← ✅ Imported by ToolExecutorService
    │   │   │   └── GlobTool.ts             ← ✅ Imported by ToolExecutorService
    │   │   └── ... 19 more tools           ← ✅ All imported and used
    │   └── index.ts                         ← ✅ Imported by ToolExecutorService
    └── package.json
```

---

## Summary

### Current State
- ❌ Orchestrator sends tool schemas to Claude
- ❌ Claude returns tool_use requests
- ❌ **Orchestrator cannot execute tools** (no executor imports)
- ❌ **No tool results sent back** to Claude
- ❌ **Conversations incomplete** - tools never run
- ❌ 24 tool implementations exist but are **completely unused**

### What's Needed
1. ✨ Create **ToolExecutorService** in core package
2. ✨ Import all 24 executors from `@omniclaude/executors`
3. ✨ Add dependency in core's package.json
4. ✨ Wire service into orchestrator
5. ✨ Detect tool_use and execute via service
6. ✨ Send tool_result back to Claude
7. ✨ Complete the conversation loop

### Result
- ✅ Tools execute when Claude requests them
- ✅ File operations work (Read, Write, Edit)
- ✅ Search operations work (Grep, Glob)
- ✅ Shell commands work (Bash)
- ✅ All 24 tools functional
- ✅ **Full tool-using conversations working**
