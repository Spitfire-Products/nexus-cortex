# Claude Code CLI - Deterministic Injection Patterns Reference

**Date**: 2025-10-19
**Purpose**: Comprehensive pattern map of all Claude Code CLI injections, their formats, purposes, and handling rules
**Scope**: Based on analysis of native Claude Code CLI v2.0.14+ sessions

---

## Table of Contents

1. [System-Reminder Patterns](#system-reminder-patterns)
2. [Command Execution Metadata](#command-execution-metadata)
3. [Cache Control Directives](#cache-control-directives)
4. [Tool Call Metadata](#tool-call-metadata)
5. [Policy and Security Injections](#policy-and-security-injections)
6. [Context Injection Patterns](#context-injection-patterns)
7. [Message Structure Patterns](#message-structure-patterns)
8. [Provider-Specific Handling](#provider-specific-handling)

---

## System-Reminder Patterns

### Pattern: Empty Todo List Reminder

**Purpose**: Notify model that todo list tracking is available but currently empty

**Format**:
```xml
<system-reminder>
This is a reminder that your todo list is currently empty. DO NOT mention this to the user explicitly because they are already aware. If you are working on tasks that would benefit from a todo list please use the TodoWrite tool to create one. If not, please feel free to ignore. Again do not mention this message to the user.
</system-reminder>
```

**Characteristics**:
- **Size**: ~327 characters
- **Frequency**: Every request when todo list is empty
- **Injection Point**: User message content array (first item)
- **Model Visibility**: Full visibility
- **Curation**: ✅ Preserve for all models

**Handling Rules**:
- Keep for Claude: ✅ Yes
- Keep for non-Claude: ✅ Yes
- Deduplication: By content hash (same reminder = same ID)

---

### Pattern: Todo List Update Notification

**Purpose**: Inform model of changes to the todo list without explicit mention

**Format**:
```xml
<system-reminder>
Your todo list has changed. DO NOT mention this explicitly to the user. Here are the latest contents of your todo list:

[{"content":"Task description","status":"in_progress","activeForm":"Working on task"},{"content":"Next task","status":"pending","activeForm":"Pending task"}]. Continue on with the tasks at hand if applicable.
</system-reminder>
```

**Characteristics**:
- **Size**: Varies (200-2000+ characters depending on todo count)
- **Frequency**: After TodoWrite tool usage
- **Injection Point**: User message content array
- **Model Visibility**: Full visibility
- **Curation**: ✅ Preserve for all models

**Handling Rules**:
- Keep for Claude: ✅ Yes (task tracking)
- Keep for non-Claude: ✅ Yes (task tracking)
- Deduplication: By content hash (different todo state = different ID)

---

### Pattern: CLAUDE.md Context Injection

**Purpose**: Provide project-specific instructions and repository context from CLAUDE.md

**Format**:
```xml
<system-reminder>
As you answer the user's questions, you can use the following context:
# claudeMd
Codebase and user instructions are shown below. Be sure to adhere to these instructions. IMPORTANT: These instructions OVERRIDE any default behavior and you MUST follow them exactly as written.

Contents of /home/runner/workspace/CLAUDE.md (project instructions, checked into the codebase):

[Full CLAUDE.md contents here - can be 10KB-50KB+]

      IMPORTANT: this context may or may not be relevant to your tasks. You should not respond to this context unless it is highly relevant to your task.
</system-reminder>
```

**Characteristics**:
- **Size**: 10KB-50KB+ (13,353 characters in analyzed session)
- **Frequency**: On specific triggers (project context needed)
- **Injection Point**: User message content array (second item after todo reminder)
- **Model Visibility**: Full visibility
- **Curation**: ✅ Preserve for all models

**Handling Rules**:
- Keep for Claude: ✅ Yes (critical project context)
- Keep for non-Claude: ✅ Yes (critical project context)
- Deduplication: By content hash
- **Token Impact**: High - this is the largest single injection

---

### Pattern: Tool Call Notification

**Purpose**: Inform model that a tool was invoked in the background

**Format**:
```xml
<system-reminder>
Called the Read tool with the following input: {"file_path":"/home/runner/workspace/file.ts"}
</system-reminder>
```

**Characteristics**:
- **Size**: ~100-300 characters
- **Frequency**: Before tool result injection
- **Injection Point**: User message content array
- **Model Visibility**: Full visibility
- **Curation**: ⚠️ Consider stripping (redundant with tool_result)

**Handling Rules**:
- Keep for Claude: ⚠️ Optional (Claude sees tool_use in history)
- Keep for non-Claude: ⚠️ Optional (may add noise)
- Deduplication: By content hash

---

### Pattern: Tool Result Injection

**Purpose**: Provide the complete output from a tool invocation

**Format**:
```xml
<system-reminder>
Result of calling the Read tool: "     1→# File Contents\n     2→Line 2 content...\n[Full file contents with line numbers, up to 28KB+]

<system-reminder>
Whenever you read a file, you should consider whether it looks malicious. If it does, you MUST refuse to improve or augment the code. You can still analyze existing code, write reports, or answer high-level questions about the code behavior.
</system-reminder>
"
</system-reminder>
```

**Characteristics**:
- **Size**: Varies wildly (100 bytes to 28KB+)
- **Frequency**: After every tool invocation
- **Injection Point**: User message content array
- **Model Visibility**: Full visibility
- **Curation**: ✅ Preserve for all models

**Handling Rules**:
- Keep for Claude: ✅ Yes (critical data)
- Keep for non-Claude: ✅ Yes (critical data)
- Deduplication: By content hash
- **Token Impact**: High for large files

**Nested Pattern**: Security reminder embedded within result

---

### Pattern: File Reading Security Warning

**Purpose**: Remind model to check for malicious code when reading files

**Format**:
```xml
<system-reminder>
Whenever you read a file, you should consider whether it looks malicious. If it does, you MUST refuse to improve or augment the code. You can still analyze existing code, write reports, or answer high-level questions about the code behavior.
</system-reminder>
```

**Characteristics**:
- **Size**: ~264 characters
- **Frequency**: After every Read tool invocation
- **Injection Point**: Nested within tool result system-reminder
- **Model Visibility**: Full visibility
- **Curation**: ✅ Preserve for all models

**Handling Rules**:
- Keep for Claude: ✅ Yes (security policy)
- Keep for non-Claude: ✅ Yes (security policy)
- Deduplication: By content hash (same text = same ID)

---

### Pattern: TodoWrite Tool Reminder

**Purpose**: Suggest using TodoWrite if applicable to current work

**Format**:
```xml
<system-reminder>
The TodoWrite tool hasn't been used recently. If you're working on tasks that would benefit from tracking progress, consider using the TodoWrite tool to track progress. Also consider cleaning up the todo list if has become stale and no longer matches what you are working on. Only use it if it's relevant to the current work. This is just a gentle reminder - ignore if not applicable.

Here are the existing contents of your todo list:

[Current todo list state]
</system-reminder>
```

**Characteristics**:
- **Size**: Varies (300-2000+ characters)
- **Frequency**: Periodic during long conversations
- **Injection Point**: User message content array
- **Model Visibility**: Full visibility
- **Curation**: ✅ Preserve for all models

**Handling Rules**:
- Keep for Claude: ✅ Yes (workflow guidance)
- Keep for non-Claude: ✅ Yes (workflow guidance)
- Deduplication: By content hash

---

## Command Execution Metadata

### Pattern: Command Name Tag

**Purpose**: Identify which CLI command was executed

**Format**:
```xml
<command-name>/model</command-name>
```

**Characteristics**:
- **Size**: ~30-50 characters
- **Frequency**: Every CLI command execution
- **Injection Point**: User message content array (after system-reminders, before actual input)
- **Model Visibility**: Full visibility (with caveat)
- **Curation**: ✅ Preserve for non-Claude models

**Common Commands**:
- `/model` - Model switching
- `/help` - Help command
- `/clear` - Clear conversation
- `/plugin` - Plugin commands
- Custom slash commands from `.claude/commands/`

**Handling Rules**:
- Keep for Claude: ❌ No (not present in native sessions)
- Keep for non-Claude: ✅ Yes (context about CLI operations)
- Deduplication: By content hash

---

### Pattern: Command Message Tag

**Purpose**: Human-readable description of the command

**Format**:
```xml
<command-message>model</command-message>
```

**Characteristics**:
- **Size**: ~20-40 characters
- **Frequency**: Paired with command-name
- **Injection Point**: Immediately after `<command-name>`
- **Model Visibility**: Full visibility (with caveat)
- **Curation**: ✅ Preserve for non-Claude models

**Handling Rules**:
- Keep for Claude: ❌ No
- Keep for non-Claude: ✅ Yes
- Deduplication: By content hash

---

### Pattern: Command Args Tag

**Purpose**: Arguments passed to the CLI command

**Format**:
```xml
<command-args>grok-4-fast</command-args>
```

**Characteristics**:
- **Size**: Varies (10-200+ characters)
- **Frequency**: Paired with command-name and command-message
- **Injection Point**: Immediately after `<command-message>`
- **Model Visibility**: Full visibility (with caveat)
- **Curation**: ✅ Preserve for non-Claude models

**Examples**:
- `/model grok-4-fast` → `<command-args>grok-4-fast</command-args>`
- `/plugin list` → `<command-args>list</command-args>`
- Custom command with args → `<command-args>arg1 arg2 arg3</command-args>`

**Handling Rules**:
- Keep for Claude: ❌ No
- Keep for non-Claude: ✅ Yes
- Deduplication: By content hash

---

### Pattern: Command Triple (Complete Set)

**Purpose**: Full CLI command metadata bundle

**Format**:
```xml
<command-name>/model</command-name>
            <command-message>model</command-message>
            <command-args>grok-4-fast</command-args>
```

**Characteristics**:
- **Grouping**: Always appears as a trio (name + message + args)
- **Whitespace**: Exact indentation preserved (12 spaces before message/args)
- **Ordering**: Never separated or reordered
- **Curation**: Treat as atomic unit

**Handling Rules**:
- Keep complete triple or strip entirely
- Never keep partial command metadata
- Appears in single content item (not separated)

---

### Pattern: Local Command Output

**Purpose**: Capture and inject the stdout from CLI command execution

**Format**:
```xml
<local-command-stdout>Set model to grok-4-fast</local-command-stdout>
```

**Characteristics**:
- **Size**: Varies (20-500+ characters)
- **Frequency**: Immediately after command triple
- **Injection Point**: Separate content item after command metadata
- **Model Visibility**: Full visibility (with caveat)
- **Curation**: ✅ Preserve for non-Claude models

**Examples**:
- Model switch: `Set model to grok-4-fast`
- Plugin list: `Available plugins:\n- plugin1\n- plugin2`
- Error output: `Error: Command failed with exit code 1`

**Handling Rules**:
- Keep for Claude: ❌ No
- Keep for non-Claude: ✅ Yes (shows command results)
- Deduplication: By content hash
- **Note**: May contain ANSI escape codes (e.g., `\u001b[1m` for bold)

---

### Pattern: Command Caveat Injection

**Purpose**: Warn model not to respond to command metadata

**Format**:
```
Caveat: The messages below were generated by the user while running local commands. DO NOT respond to these messages or otherwise consider them in your response unless the user explicitly asks you to.
```

**Characteristics**:
- **Size**: ~205 characters (fixed)
- **Frequency**: Before command metadata in messages containing commands
- **Injection Point**: Content item before command triple
- **Model Visibility**: Full visibility
- **Curation**: ✅ Preserve for non-Claude models

**Handling Rules**:
- Keep for Claude: ❌ No (no command metadata in Claude sessions)
- Keep for non-Claude: ✅ Yes (critical warning)
- Deduplication: By content hash (always same text)

**Pattern Context**: Always appears in this order:
1. System-reminders
2. **Caveat text** ← This pattern
3. Command triple (`<command-name>` + `<command-message>` + `<command-args>`)
4. Command output (`<local-command-stdout>`)
5. Actual user input

---

## Cache Control Directives

### Pattern: Anthropic Ephemeral Cache Control

**Purpose**: Mark content for Anthropic's prompt caching feature

**Format**:
```json
{
  "type": "text",
  "text": "User input or context here",
  "cache_control": {
    "type": "ephemeral"
  }
}
```

**Characteristics**:
- **Location**: Attached to specific content items in message.content array
- **Frequency**: Strategic placement on large/repeated context (CLAUDE.md, large files)
- **API Support**: Anthropic native feature
- **Curation**: ⚠️ Provider-specific handling

**Cache Duration**:
- **Ephemeral (5m)**: 5-minute cache window
- **Ephemeral (1h)**: 1-hour cache window (if available)

**Typical Attachment Points**:
1. Last user input in message (most common)
2. Large context injections (CLAUDE.md)
3. Tool results with large content

**Handling Rules**:
- **Claude (Anthropic)**: ❌ Strip from messages (API-level feature)
- **Grok (X.AI)**: ❌ Strip (automatic caching per X.AI docs)
- **GPT (OpenAI)**: ❌ Strip (not supported)
- **Gemini (Google)**: ❌ Strip (context caching handled differently)
- **Generic providers**: ❌ Strip (likely not supported)

**Caching Handling Per Provider**:

| Provider | Native Support | Handling | Notes |
|----------|----------------|----------|-------|
| Anthropic Claude | ✅ Yes | API-level (strip from messages) | Uses `cache_creation_input_tokens`, `cache_read_input_tokens` in usage |
| X.AI Grok | ✅ Yes | Automatic (strip from messages) | "Caching is automatically enabled for all requests" |
| OpenAI GPT | ❌ No | Strip | No prompt caching feature |
| Google Gemini | 🔄 Different | Strip | Uses `cachedContent` API (separate system) |
| DeepSeek | ❓ Unknown | Strip | Assume not supported |

**X.AI Caching Behavior** (from official docs):
```
"The caching is automatically enabled for all requests without user input.
You can view the cached prompt token consumption in the 'usage' object."
```

**Response Usage Pattern** (with caching):
```json
{
  "usage": {
    "input_tokens": 1234,
    "cache_creation_input_tokens": 5000,   // Cost to create cache
    "cache_read_input_tokens": 15000,      // Savings from cache hit
    "output_tokens": 567
  }
}
```

**Curation Rule**:
```typescript
// ALWAYS strip cache_control from content items before sending to ANY provider
// Providers that support caching handle it automatically at API level
function stripCacheControl(content: any[]): any[] {
  return content.map(item => {
    const { cache_control, ...rest } = item;
    return rest;
  });
}
```

---

## Tool Call Metadata

### Pattern: Tool Use Message (Anthropic Format)

**Purpose**: Record model's invocation of a tool

**Format**:
```json
{
  "role": "assistant",
  "content": [
    {
      "type": "tool_use",
      "id": "toolu_01A2B3C4D5E6F7G8H9I0J1K2",
      "name": "Read",
      "input": {
        "file_path": "/home/runner/workspace/file.ts"
      }
    }
  ]
}
```

**Characteristics**:
- **Role**: Always assistant
- **ID Format**: `toolu_` prefix + random alphanumeric (Anthropic)
- **Preservation**: ✅ Critical - must preserve with paired tool_result
- **Curation**: Tool chain preservation (tool_use + tool_result kept together)

**Handling Rules**:
- Keep for Claude: ✅ Yes (native format)
- Keep for non-Claude: ✅ Yes (converted to provider format)
- Deduplication: By tool_use ID, not content hash
- **Chain Rule**: If tool_use is kept, MUST keep matching tool_result

---

### Pattern: Tool Result Message (User Role)

**Purpose**: Provide the output from tool execution back to the model

**Format**:
```json
{
  "role": "user",
  "content": [
    {
      "type": "tool_result",
      "tool_use_id": "toolu_01A2B3C4D5E6F7G8H9I0J1K2",
      "content": "File contents here..."
    }
  ]
}
```

**Characteristics**:
- **Role**: Always user
- **ID Matching**: `tool_use_id` must match tool_use's `id`
- **Preservation**: ✅ Critical - orphaned tool_results break conversations
- **Curation**: Tool chain preservation

**Handling Rules**:
- Keep for Claude: ✅ Yes (native format)
- Keep for non-Claude: ✅ Yes (converted to provider format)
- Deduplication: By tool_use_id reference
- **Chain Rule**: Never keep tool_result without matching tool_use

**Tool Chain Preservation Pattern**:
```typescript
// Track tool_use IDs to ensure paired tool_results are kept
const seenToolUseIds = new Set<string>();

// When processing tool_use
if (content.type === 'tool_use' && content.id) {
  seenToolUseIds.add(content.id);
}

// When processing tool_result - check for matching tool_use
if (content.type === 'tool_result' && content.tool_use_id) {
  const hasMatchingToolUse = seenToolUseIds.has(content.tool_use_id);
  // Keep if matching tool_use exists
}
```

---

## Policy and Security Injections

### Pattern: Defensive Security Policy

**Purpose**: Restrict model from assisting with offensive security tasks

**Format**:
```
IMPORTANT: Assist with defensive security tasks only. Refuse to create, modify, or improve code that may be used maliciously. Do not assist with credential discovery or harvesting, including bulk crawling for SSH keys, browser cookies, or cryptocurrency wallets. Allow security analysis, detection rules, vulnerability explanations, defensive tools, and security documentation.
```

**Characteristics**:
- **Location**: System prompt (not in messages)
- **Size**: ~403 characters
- **Frequency**: Every request (part of base prompt)
- **Model Visibility**: Implicit (system-level)
- **Curation**: N/A (system prompt, not in messages)

**Scope**:
- ❌ Offensive security tools
- ❌ Credential harvesting
- ❌ Malicious code creation
- ✅ Defensive security analysis
- ✅ Vulnerability explanations
- ✅ Detection rules

---

### Pattern: URL Generation Restriction

**Purpose**: Prevent model from generating URLs except for programming help

**Format**:
```
IMPORTANT: You must NEVER generate or guess URLs for the user unless you are confident that the URLs are for helping the user with programming. You may use URLs provided by the user in their messages or local files.
```

**Characteristics**:
- **Location**: System prompt (not in messages)
- **Size**: ~228 characters
- **Frequency**: Every request (part of base prompt)
- **Model Visibility**: Implicit (system-level)
- **Curation**: N/A (system prompt, not in messages)

**Allowed**:
- ✅ URLs from user messages
- ✅ URLs from local files
- ✅ Programming-related URLs

**Prohibited**:
- ❌ Guessing/generating arbitrary URLs
- ❌ Fabricating documentation URLs
- ❌ Making up API endpoints

---

### Pattern: File Reading Security Check

**Purpose**: Detect and refuse malicious code manipulation

**Format**: (See System-Reminder pattern above)

**Trigger**: After every Read tool invocation

**Policy Actions**:
1. ✅ Analyze existing code
2. ✅ Write reports
3. ✅ Answer high-level questions
4. ❌ Improve malicious code
5. ❌ Augment attack tools
6. ❌ Create exploit variations

---

## Context Injection Patterns

### Pattern: Multi-Content User Message

**Purpose**: Bundle multiple context sources in single user message

**Format**:
```json
{
  "role": "user",
  "content": [
    {
      "type": "text",
      "text": "<system-reminder>Todo list reminder</system-reminder>"
    },
    {
      "type": "text",
      "text": "<system-reminder>CLAUDE.md context (13KB)</system-reminder>"
    },
    {
      "type": "text",
      "text": "Caveat: Command messages below..."
    },
    {
      "type": "text",
      "text": "<command-name>/model</command-name>..."
    },
    {
      "type": "text",
      "text": "<local-command-stdout>Command output</local-command-stdout>"
    },
    {
      "type": "text",
      "text": "Actual user input here",
      "cache_control": { "type": "ephemeral" }
    }
  ]
}
```

**Content Item Ordering**:
1. System-reminders (1-3 items)
2. Caveat text (if commands present)
3. Command metadata (if commands executed)
4. Command output (if commands executed)
5. Actual user input (last item, often with cache_control)

**Characteristics**:
- **Array Structure**: Always an array, even for single item
- **Type Field**: Always `"text"` for CLI injections
- **Ordering**: Deterministic and meaningful
- **Curation**: Preserve structure, deduplicate content

---

### Pattern: Session Continuation Summary

**Purpose**: Summarize previous conversation when context limit approached

**Format**:
```xml
<system-reminder>
This session is being continued from a previous conversation that ran out of context. The conversation is summarized below:

Analysis:
[Detailed chronological analysis of previous conversation]

Summary:
## 1. Primary Request and Intent
[Summary content...]

## 2. Key Technical Concepts
[Technical details...]

[... more sections ...]
</summary>.
Please continue the conversation from where we left it off without asking the user any further questions. Continue with the last task that you were asked to work on.
</system-reminder>
```

**Characteristics**:
- **Size**: Can be 10KB-50KB+ (analyzed session: massive)
- **Frequency**: At context window threshold (~80k-100k tokens)
- **Injection Point**: Beginning of new conversation
- **Structure**: `<analysis>` + `<summary>` sections
- **Trigger**: Deterministic threshold-based (not ML-based)

**Content Sections**:
1. Analysis (chronological breakdown)
2. Primary Request and Intent
3. Key Technical Concepts
4. Files and Code Sections
5. Errors and Fixes
6. Problem Solving
7. All User Messages (verbatim)
8. Pending Tasks
9. Current Work
10. Optional Next Step

**Handling Rules**:
- Keep for Claude: ✅ Yes (critical context preservation)
- Keep for non-Claude: ✅ Yes (critical context preservation)
- Deduplication: By content hash (summaries are unique)
- **Note**: This is a CLI-generated summary, not a user message

**Template Source**: Deterministic prompt template in CLI codebase
```typescript
const SUMMARIZATION_TEMPLATE = `Your task is to create a detailed summary...
Before providing your final summary, wrap your analysis in <analysis> tags...
Your summary should include the following sections:
1. Primary Request and Intent...
[etc.]`;
```

---

## Message Structure Patterns

### Pattern: Message with Content Array

**Standard Format**:
```json
{
  "role": "user",
  "content": [
    { "type": "text", "text": "content here" }
  ],
  "id": "f23d0838d0a21c1a96a2f883ef9f4de8"
}
```

**Characteristics**:
- **Content**: Always array (even for single text)
- **ID**: SHA-256 hash of role + content (32 chars)
- **Type**: Always "text" for CLI injections

---

### Pattern: Message with String Content

**Legacy/Simple Format**:
```json
{
  "role": "assistant",
  "content": "Simple text response",
  "id": "1b2f8a9249cc0dae987b7a106e37f6c1"
}
```

**Characteristics**:
- **Content**: String instead of array
- **ID**: SHA-256 hash of role + content
- **Usage**: Simple responses without tool calls

---

### Pattern: Message ID Generation

**Algorithm**:
```typescript
import { createHash } from 'crypto';

function generateMessageId(message: any): string {
  const contentStr = JSON.stringify({
    role: message.role,
    content: message.content
  });

  return createHash('sha256')
    .update(contentStr)
    .digest('hex')
    .substring(0, 32);
}
```

**Characteristics**:
- **Deterministic**: Same content = same ID (always)
- **Hash Function**: SHA-256
- **Length**: 32 characters (first 32 hex digits)
- **Collision Risk**: Negligible (2^128 space)

**Example**:
```javascript
Input:  { role: 'user', content: 'Hello' }
Output: "a591a6d40bf420404a011733cfb7b19d"  // Always same
```

---

## Provider-Specific Handling

### Anthropic Claude

**Native Format**:
- Uses `cache_control` at API level
- Supports `system` role in API
- Native tool use format (tool_use/tool_result)

**Curation Strategy**:
```typescript
{
  stripCacheControl: true,           // Handle at API level
  preserveSystemRole: true,          // Native support
  commandMetadata: false,            // CLI integrated
  systemReminders: true,             // Keep (minimal overhead)
  toolChains: true                   // Native format
}
```

**Injection Asymmetry**:
- ❌ No `<command-*>` tags (CLI natively integrated)
- ❌ No `<local-command-stdout>` (not needed)
- ❌ No command caveat text (no commands)
- ✅ System-reminders (but fewer than non-Claude)

---

### X.AI Grok

**Format Conversion**:
- No `cache_control` support (automatic caching)
- May not support `system` role (convert to user)
- Tool use format TBD (likely OpenAI-compatible)

**Curation Strategy**:
```typescript
{
  stripCacheControl: true,           // Automatic caching per docs
  preserveSystemRole: false,         // Convert to user messages
  commandMetadata: true,             // Need CLI context
  systemReminders: true,             // Full context needed
  toolChains: true                   // Preserve (convert format)
}
```

**Injection Asymmetry**:
- ✅ `<command-*>` tags (help understand CLI)
- ✅ `<local-command-stdout>` (show command results)
- ✅ Command caveat text (important warning)
- ✅ 2-3x more system-reminders (need more context)

---

### OpenAI GPT

**Format Conversion**:
- No `cache_control` support
- Supports `system` role
- Different tool format (function calling)

**Curation Strategy**:
```typescript
{
  stripCacheControl: true,           // Not supported
  preserveSystemRole: true,          // Native support
  commandMetadata: true,             // Need CLI context
  systemReminders: true,             // Full context needed
  toolChains: true                   // Convert to function format
}
```

---

### Google Gemini

**Format Conversion**:
- Different caching system (`cachedContent` API)
- Different role names (user/model instead of user/assistant)
- Different tool format (function declarations)

**Curation Strategy**:
```typescript
{
  stripCacheControl: true,           // Different caching system
  preserveSystemRole: false,         // Convert to user/model
  commandMetadata: true,             // Need CLI context
  systemReminders: true,             // Full context needed
  toolChains: true                   // Convert to Gemini format
}
```

---

## Deduplication Logic

### Content-Based ID Strategy

**Goal**: Same content across multiple requests = single ID = deduplicated

**Implementation**:
```typescript
interface CurationState {
  seenRequestIds: Set<string>;    // User message IDs
  seenResponseIds: Set<string>;   // Assistant message IDs
  seenToolUseIds: Set<string>;    // tool_use IDs (never hash-based)
}

function shouldIncludeMessage(message: any, state: CurationState): boolean {
  // Filter CLI internal commands
  if (message.role === 'user' && typeof message.content === 'string') {
    const content = message.content.trim().toLowerCase();

    if (content === 'quota' || content === 'count') {
      return false;
    }

    if (content.includes('please write a 5-10 word title')) {
      return false;
    }
  }

  // Deduplicate by ID based on role
  if (message.role === 'user') {
    const msgId = extractMessageId(message);
    if (msgId && state.seenRequestIds.has(msgId)) {
      return false; // Duplicate
    }
    if (msgId) state.seenRequestIds.add(msgId);
  }

  if (message.role === 'assistant') {
    const msgId = extractMessageId(message);
    if (msgId && state.seenResponseIds.has(msgId)) {
      return false; // Duplicate
    }
    if (msgId) state.seenResponseIds.add(msgId);
  }

  return true;
}
```

---

### Tool Chain Preservation

**Rule**: tool_use and tool_result are paired - keep together or remove together

**Implementation**:
```typescript
function getCuratedWithToolContext(): any[] {
  const curated: any[] = [];
  const state: CurationState = {
    seenRequestIds: new Set(),
    seenResponseIds: new Set(),
    seenToolUseIds: new Set()
  };

  for (const entry of comprehensive) {
    if (entry.type === 'request') {
      for (const message of entry.messages) {
        if (shouldIncludeMessage(message, state)) {
          curated.push(message);
        }
      }
    }

    if (entry.type === 'response') {
      const assistantMsg = {
        role: 'assistant',
        content: entry.content,
        id: entry.id
      };

      // Check for tool_use
      const hasToolUse = Array.isArray(assistantMsg.content) &&
                         assistantMsg.content.some(c => c.type === 'tool_use');

      if (hasToolUse) {
        // ALWAYS keep tool_use messages
        curated.push(assistantMsg);

        // Track tool IDs for pairing
        assistantMsg.content.forEach(c => {
          if (c.type === 'tool_use' && c.id) {
            state.seenToolUseIds.add(c.id);
          }
        });
      } else if (shouldIncludeMessage(assistantMsg, state)) {
        curated.push(assistantMsg);
      }
    }
  }

  return curated;
}
```

---

### CLI Internal Command Filtering

**Commands to ALWAYS filter out**:

1. **`quota`** - Token usage check (internal)
2. **`count`** - Message count (internal)
3. **Title generation prompts** - Contains "please write a 5-10 word title for the following conversation"

**Pattern**:
```typescript
const FILTERED_COMMANDS = ['quota', 'count'];

const FILTERED_CONTENT_PATTERNS = [
  'please write a 5-10 word title for the following conversation'
];

function isCliInternalCommand(content: string): boolean {
  const normalized = content.trim().toLowerCase();

  // Exact match
  if (FILTERED_COMMANDS.includes(normalized)) {
    return true;
  }

  // Substring match
  for (const pattern of FILTERED_CONTENT_PATTERNS) {
    if (normalized.includes(pattern)) {
      return true;
    }
  }

  return false;
}
```

---

## Injection Size Impact Analysis

**From analyzed sessions**:

| Injection Type | Typical Size | Token Impact | Frequency |
|----------------|--------------|--------------|-----------|
| Empty todo reminder | 327 chars | ~80 tokens | Every request |
| Todo update reminder | 200-2000 chars | ~50-500 tokens | After TodoWrite |
| CLAUDE.md context | 10KB-50KB | ~2500-12500 tokens | Periodic |
| File security warning | 264 chars | ~65 tokens | Per Read tool |
| Tool result | 100B-28KB | ~25-7000 tokens | Per tool use |
| Command metadata | ~100 chars | ~25 tokens | Per command |
| Command output | 20-500 chars | ~5-125 tokens | Per command |
| Caveat text | 205 chars | ~50 tokens | Per command |
| Session summary | 10KB-50KB+ | ~2500-12500+ tokens | At threshold |

**Largest Injections**:
1. Session continuation summary (10KB-50KB+)
2. CLAUDE.md context (10KB-50KB)
3. Large file tool results (up to 28KB observed)

**Cumulative Impact**:
- Baseline per request: ~200-500 tokens (reminders + warnings)
- With commands: +100-200 tokens
- With tool use: +50-7000+ tokens depending on file size
- With CLAUDE.md: +2500-12500 tokens

---

## Pattern Summary Table

| Pattern Category | Count | Claude Native | Non-Claude | Purpose |
|-----------------|-------|---------------|------------|---------|
| System-Reminders | 7 | ✅ Minimal | ✅ Full | Context injection |
| Command Metadata | 4 | ❌ No | ✅ Yes | CLI operation tracking |
| Cache Control | 1 | ❌ Strip | ❌ Strip | Automatic at API level |
| Tool Metadata | 2 | ✅ Yes | ✅ Yes (converted) | Tool invocation tracking |
| Security Policies | 3 | ✅ Yes | ✅ Yes | Safety constraints |
| Context Bundles | 2 | ✅ Yes | ✅ Yes | Multi-source context |

---

## References

- **Analysis Source**: Native Claude Code CLI v2.0.14 sessions
- **Sessions Analyzed**: 3 (1 native Claude, 2 Grok)
- **Total Patterns Identified**: 25+
- **Documentation Date**: 2025-10-19

**Related Documents**:
- `.claude/CLAUDE_CODE_CLI_ARCHITECTURE.md` - Deterministic architecture analysis
- `.claude/CURATED_HISTORY_AUDIT_REPORT.md` - Session comparison audit
- `cortex_v3/development_logs/HANDOVER_CURATED_HISTORY_PHASE1.md` - Original design spec

---

**Last Updated**: 2025-10-19
**Confidence Level**: High (evidence-based from production sessions)
