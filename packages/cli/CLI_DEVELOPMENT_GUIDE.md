# CLI Development Guide

**Quick reference for building CLI features on top of Cortex Core**

## Core Principle

The CLI is a **thin wrapper** around `CortexOrchestrator`. All intelligence, tool execution, multi-turn logic, and provider handling is in the core library.

**Your job:** Wire up core features to CLI UI components.

## The Golden Rules

### Rule 1: Use `sendMessage()` for Tools

```typescript
// ✅ CORRECT - Multi-turn tool execution works
const response = await client.sendMessage(messages, {
  model: 'grok-code-fast-1',
  tools: [] // Enable all tools
});

// ❌ WRONG - Tools don't execute (streaming has no multi-turn loop)
for await (const event of client.streamMessage(messages, { tools: [] })) {
  // Tools appear in events but don't execute!
}
```

**Why?** See `CortexOrchestrator.ts:1386-1388`:
> "Streaming version doesn't handle multi-turn tool calling (yet)"

### Rule 2: Empty Array = All Tools

```typescript
// ✅ Enable all default tools (37+ tools)
{ tools: [] }

// ✅ Disable tools
{ tools: undefined } // or omit the field

// ❌ Don't pass specific tools unless you know what you're doing
{ tools: [specificTool] }
```

### Rule 3: Server Does the Work

```typescript
// The server (via orchestrator) handles:
// - Tool execution
// - Multi-turn loops (up to 10,000 iterations)
// - Loop detection
// - Error handling
// - Session persistence

// The CLI just:
// - Sends messages
// - Displays responses
// - Shows tool usage feedback
```

## Quick Start Template

```typescript
import { CortexClient } from '../client/CortexClient.js';

export async function myFeature() {
  const client = new CortexClient('http://localhost:4000');
  const messages: Message[] = [];

  // Add user message
  messages.push({
    role: 'user',
    content: userInput
  });

  // Send with tools enabled
  const response = await client.sendMessage(messages, {
    model: 'grok-code-fast-1',
    tools: []  // Enable all tools
  });

  // Show tool usage
  if (response.toolUses && response.toolUses.length > 0) {
    console.log(`[Used ${response.toolUses.length} tools: ${
      response.toolUses.map(t => t.name).join(', ')
    }]`);
  }

  // Extract text
  const text = response.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('\n');

  console.log(text);

  // Add to history
  messages.push({
    role: 'assistant',
    content: response.content
  });
}
```

## Response Structure

```typescript
interface Response {
  messageId: string;
  content: ContentBlock[];  // Array of text, tool_use, tool_result blocks
  toolUses: Array<{         // Summary of tools that executed
    id: string;
    name: string;
    input: any;
  }>;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  metadata: {
    toolCallIterations: number;     // How many tool loops
    multiTurnToolExecution: boolean; // Was multi-turn used?
  };
}
```

## Common Patterns

### Pattern: Interactive Chat

```typescript
// See: /packages/cli/src/commands/chat/interactive.ts
const messages: Message[] = [];

while (true) {
  const userInput = await getUserInput();

  messages.push({ role: 'user', content: userInput });

  const response = await client.sendMessage(messages, { tools: [] });

  // Display
  displayResponse(response);

  // Add to history
  messages.push({ role: 'assistant', content: response.content });
}
```

### Pattern: Single Shot

```typescript
// For commands that send one message and exit
const response = await client.sendMessage(
  [{ role: 'user', content: prompt }],
  { tools: [], model: 'grok-code-fast-1' }
);

console.log(extractText(response));
process.exit(0);
```

### Pattern: Session List/View

```typescript
// Just make REST calls - these are simple GET endpoints
const sessions = await fetch(`${serverUrl}/sessions`).then(r => r.json());
sessions.forEach(session => {
  console.log(`${session.sessionId}: ${session.timestamp}`);
});
```

## What NOT to Build

### ❌ Don't Implement Tool Execution

```typescript
// ❌ WRONG - Don't execute tools client-side
if (response.content.some(b => b.type === 'tool_use')) {
  const result = await executeToolLocally(toolUse);
  // NO! The server already did this!
}

// ✅ CORRECT - Just display what happened
if (response.toolUses.length > 0) {
  console.log(`Tools used: ${response.toolUses.map(t => t.name).join(', ')}`);
}
```

### ❌ Don't Implement Multi-Turn Loop

```typescript
// ❌ WRONG - Don't manage tool loops client-side
while (hasToolUse(response)) {
  const toolResults = await executeTools(response);
  response = await sendToolResults(toolResults);
  // NO! Use sendMessage() which does this server-side!
}

// ✅ CORRECT - Server handles the loop
const response = await client.sendMessage(messages, { tools: [] });
// Done! Tools already executed and loop completed.
```

### ❌ Don't Parse Provider-Specific Formats

```typescript
// ❌ WRONG - Don't handle provider differences
if (provider === 'anthropic') {
  // Parse Anthropic format
} else if (provider === 'openai') {
  // Parse OpenAI format
}

// ✅ CORRECT - Core library handles this
const response = await client.sendMessage(messages);
// Response is always in canonical format regardless of provider
```

## Where to Look for Examples

When building a new CLI feature:

1. **Check the server** - See how it calls the orchestrator
   - `/packages/server/src/routes/messages.ts`

2. **Check the tests** - See how features actually work
   - `/tests/test-multiturn-direct.ts`
   - `/packages/core/src/orchestrator/__tests__/smoke/`

3. **Check existing commands** - See patterns already used
   - `/packages/cli/src/commands/chat/interactive.ts` (fixed version)
   - `/packages/cli/src/commands/models/list.ts`

4. **Read the integration guide**
   - `/packages/core/INTEGRATION_GUIDE.md`

## Feature Checklist

When adding a new CLI feature:

- [ ] Does it need to send messages? Use `client.sendMessage()`
- [ ] Does it need tools? Pass `{ tools: [] }`
- [ ] Does it need to stream text? Consider if tools are needed first
- [ ] Does it call a REST endpoint? Use `fetch()` directly
- [ ] Does it need session state? Use server's session endpoints
- [ ] Is there a test showing how this works? Find and read it
- [ ] Does the feature already exist in core? Check orchestrator API

## Streaming (When to Use)

**Use streaming ONLY for:**
- Text-only responses (no tools needed)
- Real-time UI feedback (showing text as it arrives)
- Long responses where user wants to see progress

**Example:**

```typescript
// Streaming for text-only creative writing
for await (const chunk of client.streamMessage(
  [{ role: 'user', content: 'Write a story about...' }]
)) {
  if (chunk.type === 'text_delta') {
    process.stdout.write(chunk.delta);
  }
}
```

**Don't use streaming for:**
- Anything involving tools
- Short responses
- Cases where you need the full response before displaying

## Available REST Endpoints

See what the server actually exposes:

```bash
# Message endpoint
POST /v1/messages
  Body: { messages, model?, stream?, tools?, max_tokens?, temperature? }

# Sessions
GET  /sessions
GET  /sessions/:id
POST /sessions/:id/resume
GET  /sessions/:id/checkpoints

# Models
GET  /models

# MCP
GET  /mcp/servers
POST /mcp/servers/:name/connect
POST /mcp/servers/:name/disconnect

# Permissions
GET  /v1/approval-mode
POST /v1/approval-mode

# Health
GET  /health
```

All endpoints are in `/packages/server/src/routes/`

## Common Mistakes

### Mistake 1: Thinking CLI Needs Complex Logic

```typescript
// ❌ Complex CLI logic
class ToolExecutor {
  async execute(tool) { /* hundreds of lines */ }
}

// ✅ Simple CLI display
console.log(`Used ${response.toolUses.length} tools`);
```

**Remember:** Core library has 2400+ lines for orchestration. CLI should be thin wrappers.

### Mistake 2: Reimplementing What Server Does

```typescript
// ❌ Reimplementing session management
class CLISessionManager {
  sessions = new Map();
  save() { /* save to disk */ }
}

// ✅ Using server's session management
const sessions = await fetch(`${serverUrl}/sessions`).then(r => r.json());
```

### Mistake 3: Provider-Specific Code

```typescript
// ❌ Provider-specific CLI code
if (model.startsWith('grok')) {
  // Special handling for XAI
} else if (model.startsWith('claude')) {
  // Special handling for Anthropic
}

// ✅ Provider-agnostic
const response = await client.sendMessage(messages, { model });
// Works for all providers
```

## Testing Your CLI Feature

```typescript
// 1. Start the server
// cd packages/server && npm start

// 2. Build your CLI
// cd packages/cli && npm run build

// 3. Test it
// cortex your-command

// 4. Check the session file to see what happened
// tail packages/server/.cortex/sessions/*.jsonl
```

## Key Insight

**The CLI's job is NOT to:**
- Execute tools
- Manage multi-turn loops
- Handle provider differences
- Implement complex logic

**The CLI's job IS to:**
- Call `client.sendMessage()` with the right options
- Display responses nicely
- Provide good UX around core features
- Wire up Ink components for interactive features

**Everything else is in the core library.**

## Resources

- **Core Integration Guide**: `/packages/core/INTEGRATION_GUIDE.md`
- **Core API**: `/packages/core/src/orchestrator/CortexOrchestrator.ts`
- **Server Routes**: `/packages/server/src/routes/`
- **Test Examples**: `/tests/` and `/packages/core/src/orchestrator/__tests__/`
- **Working CLI Example**: `/packages/cli/src/commands/chat/interactive.ts`

## Questions to Ask

Before building a feature:

1. **Does this feature exist in core?** Check orchestrator API
2. **How does the server use it?** Check route files
3. **What do the tests show?** Check test files
4. **Is this a REST endpoint or messaging?** Different patterns
5. **Do I need tools?** Use `sendMessage()` with `tools: []`

---

**Remember:** When in doubt, look at how the server does it. The server is the reference implementation for using the core library correctly.
