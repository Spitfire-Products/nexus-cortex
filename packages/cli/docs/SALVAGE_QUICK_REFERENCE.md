# Command System Salvage - Quick Reference

**TL;DR:** The command system has **TONS of reusable gold** buried under wrong HTTP architecture.

---

## What's Salvageable (The Gold) ✅

### 1. Command Categorization (100% Reusable)

```
115+ commands organized into 22 categories:

/models        → Model management (6 commands)
/sessions      → Session operations (10 commands)
/mcp           → MCP server management (11 commands)
/artifacts     → Artifact system (11 commands)
/config        → Configuration (7 commands)
/permissions   → Tool permissions (8 commands)
/mentorship    → AI mentorship (6 commands)
/helper        → Helper model (4 commands)
/history       → Context preservation (4 commands)
/tmux          → Terminal multiplexer (6 commands)
/debug         → Debugging tools (4 commands)
/stats         → Statistics (2 commands)
... and 10+ more categories
```

**Use:** Copy this structure directly for slash-command menu.

---

### 2. UI Patterns (100% Reusable)

**Table Formatting:**
```typescript
// Works with orchestrator instead of HTTP:
const models = await orchestrator.getModels();  // ← Only change
models.forEach(model => {
  console.log(formatModelRow(model));  // ← Same formatter
});
```

**Success/Error Feedback:**
```typescript
console.log(theme.colors.success('✓ Operation complete'));
console.log(theme.colors.error('✗ Operation failed'));
```

**Progress Indicators:**
```typescript
const spinner = new Spinner('Creating artifact...');
spinner.start();
await orchestrator.createArtifact();
spinner.stop('✓ Complete');
```

**Multi-Step Wizards:**
```typescript
const name = await prompt('Artifact name: ');
const type = await prompt('Type (react/python): ');
const port = await prompt('Port (default 3000): ');
await orchestrator.createArtifact({ name, type, port });
```

---

### 3. Help Text Database (95% Reusable)

**Every command has:**
- Description
- Parameters with types
- 3-5 usage examples
- Tips and related commands
- Validation rules

**Example:**
```
/models list

Description: Display all available AI models with capabilities

Parameters:
  --provider [name]     Filter by provider
  --capability [type]   Filter by capability
  --json               Output as JSON

Examples:
  /models list
  /models list --provider anthropic
  /models list --capability vision

Tips:
  💡 Use /models compare for side-by-side comparison
  💡 Add to favorites with /models favorite <id>
```

**Adaptation:** Remove `--server-url`, keep everything else.

---

### 4. Formatter Utilities (100% Reusable)

**All pure functions, zero HTTP:**

```typescript
formatNumber(1234567)           → "1,234,567"
formatCompactNumber(1500000)    → "1.5M"
formatTokens(128000)            → "128k"
formatContextWindow(200000)     → "200K"
formatPercentage(75, 100)       → "75.0%"
formatDate(new Date())          → "1/14/2025, 8:00:00 PM"
formatRelativeTime(date)        → "5 minutes ago"
formatBytes(2048)               → "2.0 KB"
formatPrice(3.50)               → "$3.50"
```

**Use:** Copy entire `utils/formatters.ts` file unchanged.

---

### 5. Interaction Patterns (100% Reusable)

**Confirmation Dialogs:**
```typescript
const confirmed = await confirm('Delete 3 artifacts? (y/n): ');
if (confirmed) {
  await orchestrator.deleteArtifacts(ids);
}
```

**Destructive Operation Warnings:**
```typescript
console.log('⚠️  This will permanently delete 3 artifacts');
const confirmation = await prompt('Type "DELETE" to confirm: ');
if (confirmation === 'DELETE') {
  await performDelete();
}
```

**Input Validation:**
```typescript
const type = await promptWithValidation(
  'Artifact type: ',
  (value) => ['js', 'python', 'react'].includes(value),
  'Valid types: js, python, react'
);
```

---

## What's Garbage (Discard Completely) ❌

### 1. HTTP Client Architecture

```typescript
// DISCARD THIS ENTIRE PATTERN:
const client = new CortexClient(serverUrl);
const response = await client.get('/endpoint');
const result = await client.post('/endpoint', data);
```

**Replace with:**
```typescript
// Direct orchestrator calls:
const result = await orchestrator.method(params);
```

---

### 2. REST Endpoint Mappings

```
DISCARD ALL OF THESE:
GET  /models
GET  /sessions
POST /sessions/{id}/resume
GET  /mcp/servers
POST /mcp/servers/{name}/connect
... (50+ endpoints)
```

**Why:** No HTTP layer in direct-wired architecture.

---

### 3. Server Configuration

```typescript
// DISCARD:
const serverUrl = options.serverUrl || 'http://localhost:4000';
--server-url [url]
```

**Why:** No separate server.

---

### 4. Network Error Handling

```typescript
// DISCARD:
if (error.message.includes('ECONNREFUSED')) {
  console.error('Server not running');
}
```

**Why:** No network layer.

---

## Quick Adaptation Guide

### Pattern: From HTTP to Direct

**Before (HTTP-based):**
```typescript
export async function modelsList(options: Options) {
  const client = new CortexClient(options.serverUrl);  // ❌ HTTP
  const response = await client.get('/models');            // ❌ HTTP

  response.models.forEach(model => {
    console.log(formatModelRow(model));                    // ✅ Keep
  });
}
```

**After (Direct-wired):**
```typescript
export async function modelsList(
  orchestrator: CortexOrchestrator,                   // ✅ Direct
  options: Options
) {
  const models = await orchestrator.getModels();           // ✅ Direct

  models.forEach(model => {
    console.log(formatModelRow(model));                    // ✅ Same
  });
}
```

**Changes:**
1. Remove HTTP client
2. Add orchestrator parameter
3. Replace HTTP call with direct method
4. Keep all formatting unchanged

**Time:** 5 minutes per command

---

## Implementation Checklist

### Phase 1: Extract Assets (2 days)

- [ ] Copy command categorization matrix
- [ ] Copy all help text (115+ commands)
- [ ] Copy formatters (`utils/formatters.ts`)
- [ ] Extract UI pattern examples
- [ ] Extract interaction flow examples

### Phase 2: Build Registry (2 days)

- [ ] Create `SlashCommandRegistry` class
- [ ] Define `SlashCommand` interface
- [ ] Register all 115+ commands
- [ ] Add category mappings
- [ ] Add search functionality

### Phase 3: Build Menu (3 days)

- [ ] Create `SlashCommandMenu` class
- [ ] Category browser
- [ ] Command selector
- [ ] Parameter wizard
- [ ] Search interface
- [ ] Help viewer

### Phase 4: Wire to Orchestrator (3 days)

- [ ] Map all commands to orchestrator methods
- [ ] Replace HTTP calls with direct calls
- [ ] Test each command
- [ ] Error handling

### Phase 5: Polish (3 days)

- [ ] Autocomplete
- [ ] Command aliases
- [ ] History
- [ ] Favorites
- [ ] Keyboard shortcuts

**Total:** ~13 days (~2.5 weeks)

---

## Files to Reference

### High-Value Documentation

**Command Specs:**
- `COMMAND_CATEGORIZATION_MATRIX.md` - Full command list with categories
- `FORMATTERS.md` - Complete formatter reference
- `CLI_ARCHITECTURE.md` - Architecture patterns (ignore HTTP, keep UI patterns)

**Command Examples:**
- `commands_archive/invalid/*.ts` - 60+ command implementations (keep patterns, discard HTTP)
- `commands_archive/tool-based/*.ts` - 20+ tool-based commands (same)

**Test Files:**
- `tests/unit/commands/**/*.test.ts` - 117 test files showing interaction patterns

---

## ROI Summary

**Investment:** 13 days to salvage and adapt

**Assets Gained:**
- ✅ 115+ commands categorized
- ✅ Complete help system
- ✅ Proven UI patterns
- ✅ Production-ready formatters
- ✅ Validated interaction flows

**Alternative:** Build from scratch = 8-10 weeks

**Time Savings:** 75% (6-8 weeks saved)

---

## Key Insight

> **The command system has the right DESIGN but wrong ARCHITECTURE.**
>
> User-facing elements (categorization, help, UI) are gold.
> Technical implementation (HTTP client/server) is garbage.
>
> **Salvage the design, discard the architecture.**

---

## Quick Decision Matrix

| Element | HTTP Dependent? | Salvageable? | Action |
|---------|----------------|--------------|--------|
| Command categories | ❌ | ✅ | Copy as-is |
| Help text | ❌ | ✅ | Remove --server-url |
| UI formatters | ❌ | ✅ | Copy unchanged |
| Table display | ❌ | ✅ | Copy unchanged |
| Interaction flows | ❌ | ✅ | Copy unchanged |
| HTTP client | ✅ | ❌ | Discard |
| REST endpoints | ✅ | ❌ | Discard |
| Server config | ✅ | ❌ | Discard |
| Network errors | ✅ | ❌ | Discard |

**Summary:** ~90% of user-facing code is salvageable, ~10% (HTTP layer) is garbage.

---

**Next Action:** Start Phase 1 (extract assets) → See full report for details
