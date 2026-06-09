# Phase 4: Rich Agentic Chat Interface - Design Document

**Date**: 2025-11-16
**Priority**: HIGH - Core user expectation
**Inspiration**: OmniCode3 Gemini CLI, Claude Code

---

## Problem Statement

Current chat is basic readline - no tool visualization, code highlighting, or rich formatting.
User expects: **Rich agentic interface for code-based work**.

## Required Features

1. **Tool Execution Visualization** - Bordered boxes, status colors, formatted results
2. **Code Block Highlighting** - Syntax highlighting using highlight.js
3. **Streaming Experience** - Smooth text, real-time updates, spinners
4. **Professional Formatting** - Chalk styling, visual hierarchy

## Architecture

```
src/commands/chat/
├── AgenticChat.ts          # Main orchestrator (NEW)
├── renderers/
│   ├── ToolRenderer.ts     # Tool visualization (NEW)
│   ├── CodeRenderer.ts     # Syntax highlighting (NEW)
│   └── MessageRenderer.ts  # Message formatting (NEW)
```

## Implementation Steps

1. **ToolRenderer** (1-2h) - Bordered boxes for tool calls/results
2. **CodeRenderer** (30m) - highlight.js integration
3. **AgenticChat** (2-3h) - Main orchestrator with stream handling
4. **Integration** (15m) - Update interactive.ts entry point
5. **Testing** (1h) - Real coding workflows

## Time Estimate: 4-6 hours total

## Dependencies: All already available! (chalk, highlight.js, readline)

---

**References**:
- OmniCode3 messages: `/workspace/omnicode3/omnicode-cli3/packages/cli/src/ui/components/messages/`
- Current chat: `packages/cli/src/commands/chat/interactive.ts`
