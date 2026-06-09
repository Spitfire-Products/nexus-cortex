# Command System Salvage Report

**Date:** 2025-11-17
**Mission:** Extract salvageable elements from HTTP-based command system for direct-wired slash-command UI
**Status:** ✅ ANALYSIS COMPLETE

---

## Executive Summary

**Documents Reviewed:** 40+ specification and implementation files
**Salvageable Elements:** 5 major categories (detailed below)
**Discarded Elements:** All HTTP client architecture and REST endpoint mappings
**Usefulness for Slash-Commands:** **HIGH** - Rich patterns, categorization, and UI elements ready for adaptation

### Key Finding

The command system documentation contains **extensive salvageable assets** despite being built on the wrong architecture. The **user-facing elements** (categorization, help text, UI patterns, interaction flows) are architecture-agnostic and directly transferable to a slash-command menu system.

### What Was Wrong

- ❌ HTTP client/server architecture (thin CLI → REST API → Core)
- ❌ Network error handling
- ❌ REST endpoint mappings
- ❌ Server URL configuration

### What's Salvageable

- ✅ **Command categorization** - 115+ commands organized into 22 categories
- ✅ **UI/UX patterns** - Table formatting, progress indicators, themed output
- ✅ **Help text database** - Descriptions, examples, parameter docs
- ✅ **Interaction flows** - Multi-step dialogs, confirmation patterns
- ✅ **Formatter utilities** - Pure presentation functions (no HTTP)

---

## 1. Command Categorization Matrix

### Original Categories (22 Categories, 115+ Commands)

The categorization scheme is **logically sound** and **architecture-independent**. It organizes commands by feature area, not by technical implementation.

#### Phase 1: Foundation (17 commands)

```
/config                    # Configuration management (4 commands)
├─ get <key>              # Get configuration value
├─ set <key> <value>      # Set configuration value
├─ categories             # List config categories
└─ category <name>        # View category settings

/permissions               # Tool permissions (4 commands)
├─ mode                   # View current approval mode
├─ set <mode>             # Set approval mode (ask/auto/deny)
├─ auto-approve <tools>   # Add tools to auto-approve list
└─ logs                   # View permission audit log

/models                    # Model management (2 commands)
├─ list                   # List all available models
└─ info <id>              # Show detailed model information

/sessions                  # Session management (6 commands)
├─ list                   # List all sessions
├─ view <id>              # View session details
├─ export <id>            # Export session data
├─ resume <id>            # Resume from checkpoint
├─ checkpoints <id>       # List session checkpoints
└─ stats <id>             # Session statistics

/server                    # Server control (1 command)
└─ start                  # Start server (MARKED FOR REMOVAL)
```

#### Phase 2: Extended (23 commands)

```
/mcp                       # MCP server management (11 commands)
├─ list                   # List MCP servers
├─ status                 # MCP system status
├─ server <name>          # Show server details
├─ tools [name]           # List MCP tools
├─ enable <name>          # Connect to server
├─ disable <name>         # Disconnect from server
├─ init                   # Initialize MCP config
├─ validate               # Validate configuration
├─ edit <name>            # Edit server config
├─ search <query>         # Search servers
└─ configure <name>       # Configure server settings

/models (extended)         # Additional model commands (4 commands)
├─ search <query>         # Search models by keyword
├─ compare <id1> <id2>    # Compare two models
├─ cost <id>              # Calculate usage cost
└─ test <id>              # Test model with sample

/stats                     # Statistics (2 commands)
├─ global                 # Global usage statistics
└─ session <id>           # Session-specific stats

/debug                     # Debugging tools (4 commands)
├─ logs                   # View debug logs
├─ errors                 # View error logs
├─ tools                  # Tool execution history
└─ middleware             # Middleware status
```

#### Phase 3: Advanced Features (27 commands)

```
/mentorship                # AI mentorship system (6 commands)
├─ status                 # View mentorship config
├─ enable                 # Enable mentorship
├─ disable                # Disable mentorship
├─ keywords [action] [kw] # Manage trigger keywords
├─ model <model>          # Set helper model
└─ log                    # View mentorship events

/helper                    # Helper model (4 commands)
├─ status                 # Helper model status
├─ set <model>            # Set helper model
├─ test [prompt]          # Test helper model
└─ history                # View invocation history

/history                   # Historical context (4 commands)
├─ status                 # Context preservation status
├─ enable                 # Enable preservation
├─ disable                # Disable preservation
└─ view <session>         # View preserved context

/tmux                      # Terminal multiplexer (6 commands)
├─ create <name>          # Create tmux session
├─ send <session> <cmd>   # Send command to session
├─ capture <session>      # Capture session output
├─ snapshot <session>     # Visual snapshot
├─ list                   # List tmux sessions
└─ kill <session>         # Terminate session

/middleware                # Middleware control (5 commands)
├─ list                   # List middleware
├─ status                 # Middleware status
├─ enable <name>          # Enable middleware
├─ disable <name>         # Disable middleware
└─ config <name>          # Configure middleware

/limits                    # Loop control (2 commands)
├─ status                 # View limits
└─ set <key> <value>      # Set limit
```

#### Phase 4: Artifact System (16+ commands)

```
/artifacts                 # Artifact management (11 commands)
├─ create                 # Create new artifact
├─ list                   # List all artifacts
├─ inspect <id>           # Inspect sandbox state
├─ interact <id>          # Interact with UI
├─ modify <id>            # Edit artifact code
├─ stop <id>              # Stop artifact
├─ restart <id>           # Restart artifact
├─ view <id>              # Open in browser
├─ dashboard              # Multi-artifact dashboard
├─ status <id>            # Artifact status
└─ cleanup                # Clean stopped artifacts

/sandbox                   # Sandbox operations (3 commands)
├─ screenshot <id>        # Take screenshot
├─ logs <id>              # View logs
└─ interact <id>          # Interact with sandbox

/templates                 # Artifact templates (2 commands)
├─ list                   # List templates
└─ create <name>          # Create template
```

#### Phase 5: Advanced/Extended (32+ commands)

```
/config (advanced)         # Advanced config (3 commands)
├─ wizard                 # Interactive wizard
├─ validate               # Validate config
└─ import <file>          # Import configuration

/sessions (advanced)       # Advanced session ops (4 commands)
├─ compare <id1> <id2>    # Compare sessions
├─ merge <id1> <id2>      # Merge sessions
├─ split <id> <turn>      # Split session
└─ compact <id>           # Compact session

/models (advanced)         # Advanced model ops (4 commands)
├─ providers              # List providers
├─ favorites              # List favorite models
├─ favorite <id>          # Add to favorites
└─ alias [name] [id]      # Create model alias

/permissions (advanced)    # Advanced permissions (4 commands)
├─ policies               # List policies
├─ block <tool>           # Block tool
├─ allow <tool>           # Allow tool
└─ actions                # Permission actions log

/context                   # Context management (5 commands)
├─ status                 # Context usage status
├─ compact                # Compact context
├─ boundaries             # Show boundaries
├─ strategy [strategy]    # Set compaction strategy
└─ savings                # Show savings

/retry                     # Retry system (3 commands)
├─ status                 # Retry config
├─ stats                  # Retry statistics
└─ classify <error>       # Classify error

/system                    # System messages (3 commands)
├─ list                   # List system messages
├─ view <name>            # View system message
└─ set <name>             # Set system message

/server (advanced)         # Server management (2 commands)
├─ stop                   # Stop server
└─ logs                   # View server logs

/dashboard                 # Dashboards (3 commands)
├─ main                   # Main dashboard
├─ tmux                   # Tmux dashboard
└─ sandbox                # Sandbox dashboard
```

### Recommendation for Slash-Command Menu

**Hierarchical Menu Structure:**

```
/ [user types slash]
  → Category Selection
    ├─ Models (list, info, search, compare, favorites...)
    ├─ Sessions (list, view, export, checkpoints, stats...)
    ├─ MCP Servers (list, status, enable, disable...)
    ├─ Artifacts (create, list, inspect, dashboard...)
    ├─ Config (get, set, wizard...)
    ├─ Permissions (mode, logs, auto-approve...)
    ├─ Debug (logs, errors, tools...)
    ├─ Advanced →
    │   ├─ Mentorship
    │   ├─ Helper Model
    │   ├─ Context
    │   ├─ Tmux
    │   └─ More...
    └─ More →

```

**Adaptive Grouping:**
- **Frequently used** → Top level
- **Power user** → Advanced submenu
- **Tool-based operations** → Convert to natural language prompts
- **Interactive dashboards** → Direct launch (no params needed)

---

## 2. UI Patterns Library

### Pattern Catalog

The command implementations reveal **consistent UI patterns** that are architecture-agnostic. These patterns focus on **presentation** and **user feedback**, not HTTP transport.

#### Pattern 1: Table Formatting

**Source:** `models/list.ts`, `sessions/list.ts`, `mcp/list.ts`

**Original Pattern:**
```typescript
// Fetch data via HTTP
const response = await client.get('/models');

// Format as table
console.log(theme.colors.primary('\nAvailable Models\n'));
response.models.forEach(model => {
  console.log(
    `${model.id.padEnd(40)} ` +
    `${formatContextWindow(model.contextWindow)} ctx ` +
    `${formatPrice(model.inputCostPer1M)}/${formatPrice(model.outputCostPer1M)} per 1M`
  );
});
```

**Adapted for Direct-Wired:**
```typescript
// Direct orchestrator call
const models = await orchestrator.getModels();

// Same formatting logic
console.log(theme.colors.primary('\nAvailable Models\n'));
models.forEach(model => {
  console.log(
    `${model.id.padEnd(40)} ` +
    `${formatContextWindow(model.contextWindow)} ctx ` +
    `${formatPrice(model.inputCostPer1M)}/${formatPrice(model.outputCostPer1M)} per 1M`
  );
});
```

**Salvageable Elements:**
- ✅ Column alignment logic (`padEnd(40)`)
- ✅ Formatter functions (`formatContextWindow`, `formatPrice`)
- ✅ Theme color usage
- ✅ Header/separator display
- ❌ HTTP client call (replace with direct)

---

#### Pattern 2: Success/Error Feedback

**Source:** `permissions/set.ts`, `mcp/enable.ts`

**Original Pattern:**
```typescript
try {
  const response = await client.post('/permissions/mode', { mode });

  if (response.success) {
    console.log(theme.colors.success('✓ Permission mode updated'));
    console.log(`  Mode: ${theme.colors.highlight(mode)}`);
  }
} catch (error) {
  console.error(theme.colors.error(`✗ Error: ${error.message}`));
  process.exit(1);
}
```

**Adapted for Direct-Wired:**
```typescript
try {
  await orchestrator.setPermissionMode(mode);

  console.log(theme.colors.success('✓ Permission mode updated'));
  console.log(`  Mode: ${theme.colors.highlight(mode)}`);
} catch (error) {
  console.error(theme.colors.error(`✗ Error: ${error.message}`));
  process.exit(1);
}
```

**Salvageable Elements:**
- ✅ Success symbols (✓, ✗)
- ✅ Themed color coding
- ✅ Indented detail display
- ✅ Error message format
- ❌ HTTP POST request (replace with direct)

---

#### Pattern 3: Progress Indicators

**Source:** `sessions/export.ts`, `artifacts/create.ts`

**Pattern:**
```typescript
console.log(theme.colors.muted('Exporting session...'));

// Long operation
await performOperation();

console.log(theme.colors.success('✓ Export complete'));
```

**Salvageable Elements:**
- ✅ "Working..." messages
- ✅ Completion confirmation
- ✅ Themed feedback
- ✅ Multi-step progress display

---

#### Pattern 4: Multi-Step Prompts

**Source:** `config/wizard.ts`, `artifacts/create.ts`

**Pattern:**
```typescript
// Step 1
rl.question('Enter artifact name: ', (name) => {
  // Step 2
  rl.question('Select type (js/python/react): ', (type) => {
    // Step 3
    rl.question('Enable hot reload? (y/n): ', (reload) => {
      // Execute with collected data
      createArtifact({ name, type, reload: reload === 'y' });
      rl.close();
    });
  });
});
```

**Salvageable Elements:**
- ✅ Sequential prompting
- ✅ Input validation
- ✅ Default value suggestions
- ✅ Confirmation patterns

---

#### Pattern 5: Conditional Display

**Source:** `sessions/view.ts`, `models/info.ts`

**Pattern:**
```typescript
// Always show
console.log(`ID: ${session.id}`);
console.log(`Created: ${formatDate(session.created)}`);

// Conditional
if (session.description) {
  console.log(`Description: ${session.description}`);
}

if (session.tags && session.tags.length > 0) {
  console.log(`Tags: ${session.tags.join(', ')}`);
}

// Empty state
if (!session.messages || session.messages.length === 0) {
  console.log(theme.colors.muted('No messages in this session.'));
}
```

**Salvageable Elements:**
- ✅ Graceful handling of missing data
- ✅ Empty state messages
- ✅ Conditional field display
- ✅ Collection formatting

---

#### Pattern 6: Interactive Selection

**Source:** `config/wizard.ts`, `dashboard/main.ts`

**Pattern:**
```typescript
// Show options
console.log('Select an option:');
console.log('  1. Enable all features');
console.log('  2. Custom configuration');
console.log('  3. Cancel');

rl.question('Choice: ', (choice) => {
  switch (choice) {
    case '1':
      enableAll();
      break;
    case '2':
      customConfig();
      break;
    case '3':
      console.log('Cancelled');
      break;
    default:
      console.log(theme.colors.error('Invalid choice'));
  }
});
```

**Salvageable Elements:**
- ✅ Numbered menu display
- ✅ Input validation
- ✅ Default/cancel options
- ✅ Invalid input handling

---

### Pattern Summary Table

| Pattern | Use Case | HTTP? | Salvageable |
|---------|----------|-------|-------------|
| Table Formatting | List display | ❌ | ✅ 100% |
| Success/Error Feedback | Operation result | ❌ | ✅ 100% |
| Progress Indicators | Long operations | ❌ | ✅ 100% |
| Multi-Step Prompts | Data collection | ❌ | ✅ 100% |
| Conditional Display | Flexible output | ❌ | ✅ 100% |
| Interactive Selection | Menu navigation | ❌ | ✅ 100% |
| Filter/Search UI | Data filtering | ❌ | ✅ 100% |
| JSON Output Mode | Scripting support | ❌ | ✅ 100% |

**Key Insight:** All presentation patterns are **pure display logic** with no HTTP dependencies.

---

## 3. Help Text Database

### Command Documentation Structure

Every command includes comprehensive help text that is **architecture-independent**.

#### Example 1: `/models list`

**Description:**
```
Display all available AI models with their capabilities
```

**Parameters:**
```
--provider [name]     Filter by provider (anthropic, openai, google, etc.)
--capability [type]   Filter by capability (vision, reasoning, code, etc.)
--json               Output as JSON
--server-url [url]   Override server URL
```

**Examples:**
```bash
# List all models
cortex models list

# Filter by provider
cortex models list --provider anthropic

# Filter by capability
cortex models list --capability vision

# JSON output for scripting
cortex models list --json | jq '.[] | select(.contextWindow > 100000)'
```

**Tips:**
```
💡 Use /models compare to see side-by-side comparison
💡 Use /models info <id> for detailed model information
💡 Add to favorites with /models favorite <id>
```

---

#### Example 2: `/artifacts create`

**Description:**
```
Create a new artifact with specified configuration
```

**Parameters:**
```
<name>                Artifact name (required)
--type <type>         Language/framework (js, ts, python, rust, go, shell, html, react, vue, nextjs)
--mode <mode>         Execution mode (oneshot, dev, persistent)
--port <port>         Port for web artifacts (default: auto-assign)
--env <env>           Environment (docker, local, nix)
--code <code>         Initial code (optional)
```

**Examples:**
```bash
# Create React dashboard
cortex artifact create dashboard --type react --port 3000

# Create Python analysis tool
cortex artifact create analysis --type python --mode dev

# Create with initial code
cortex artifact create hello --type js --code "console.log('Hello')"
```

**Validation:**
```
Valid types: js, ts, python, rust, go, shell, html, react, vue, nextjs
Valid modes: oneshot, dev, persistent
Valid environments: docker, local, nix
```

**Tips:**
```
💡 Use --mode dev for hot reload during development
💡 Use /artifacts dashboard to manage multiple artifacts
💡 Use /artifacts inspect <id> to view sandbox state
```

---

#### Example 3: `/permissions logs`

**Description:**
```
View permission audit log with filtering options
```

**Parameters:**
```
--session <id>        Filter by session ID
--action <action>     Filter by action type
--approved           Show only approved actions
--denied             Show only denied actions
--limit <n>          Limit results (default: 50)
--format <format>    Output format (table, json)
```

**Examples:**
```bash
# View all permission logs
cortex permissions logs

# View logs for specific session
cortex permissions logs --session abc123

# View denied actions only
cortex permissions logs --denied

# JSON output for analysis
cortex permissions logs --format json | jq '.[] | select(.decision == "denied")'
```

**Output Format:**
```
5 minutes ago | Read /etc/passwd | DENIED
  Session: abc123...
  Reason: File access requires approval
  Details: {"path": "/etc/passwd", "mode": "r"}

2 hours ago | Bash: npm install | APPROVED
  Session: abc123...
  Reason: Auto-approved tool
  Details: {"command": "npm install"}
```

---

### Help Text Categories

**1. Command Purpose** (1-2 sentences)
- What the command does
- Why you would use it

**2. Parameters** (with types and defaults)
- Required parameters
- Optional flags
- Default values
- Valid values/ranges

**3. Examples** (3-5 real-world uses)
- Basic usage
- Advanced usage
- Filtering/scripting
- Edge cases

**4. Validation Rules** (for user input)
- Valid values
- Constraints
- Format requirements

**5. Tips & Related Commands**
- Pro tips
- Related commands
- Common workflows

**6. Output Format** (what to expect)
- Sample output
- Field descriptions
- Status indicators

---

### Salvageable Help Text

**Total Commands with Full Documentation:** 115+

**Documentation Quality:**
- ✅ Descriptions: Complete for all commands
- ✅ Parameters: Fully documented with types
- ✅ Examples: 3-5 per command
- ✅ Validation: Input constraints specified
- ✅ Tips: Related commands linked
- ✅ Output: Sample displays provided

**Adaptation Required:**
- ❌ Remove HTTP-specific parameters (`--server-url`)
- ✅ Keep all functional parameters
- ✅ Keep all examples (update syntax if needed)
- ✅ Keep all tips and workflows

---

## 4. Interaction Patterns Catalog

### Multi-Step Workflows

#### Pattern: Checkpoint Creation with Confirmation

**Source:** `sessions/checkpoints.ts`

**Flow:**
```
1. User types: /checkpoint create
2. CLI prompts: "Enter checkpoint name: "
3. User enters: "before-refactor"
4. CLI prompts: "Include file snapshots? (y/n): "
5. User confirms: "y"
6. CLI prompts: "Add description (optional): "
7. User enters: "About to refactor auth system"
8. CLI executes: orchestrator.createCheckpoint({
     name: "before-refactor",
     includeFiles: true,
     description: "About to refactor auth system"
   })
9. CLI displays: Success message with checkpoint ID
10. CLI suggests: "Use /checkpoint list to see all checkpoints"
```

**Salvageable:**
- ✅ Multi-step prompt flow
- ✅ Optional parameters
- ✅ Confirmation pattern
- ✅ Success message with ID
- ✅ Follow-up suggestions
- ❌ HTTP POST (replace with direct call)

---

#### Pattern: Configuration Wizard

**Source:** `config/wizard.ts`

**Flow:**
```
1. User types: /config wizard
2. CLI displays: Welcome + current config summary
3. For each category:
   a. Show current value
   b. Show recommended value
   c. Prompt: "Update? (y/n/skip): "
   d. If yes → Prompt for new value
   e. Validate input
   f. Confirm change
4. CLI displays: Summary of changes
5. CLI prompts: "Apply changes? (y/n): "
6. If yes → Save configuration
7. CLI displays: Success + restart reminder
```

**Salvageable:**
- ✅ Category-based iteration
- ✅ Current vs. recommended display
- ✅ Skip option for each step
- ✅ Change summary before apply
- ✅ Final confirmation
- ✅ Validation at each step

---

#### Pattern: Artifact Creation Wizard

**Source:** `artifacts/create.ts`

**Flow:**
```
1. User types: /artifact create
2. CLI prompts: "Artifact name: "
3. User enters: "dashboard"
4. CLI displays: Type selection menu
   • JavaScript/TypeScript
   • Python
   • React/Next.js
   • Rust/Go
5. User selects: "React"
6. CLI prompts: "Port (default 3000): "
7. User enters: "8080" or <enter> for default
8. CLI prompts: "Enable hot reload? (y/n): "
9. User confirms: "y"
10. CLI displays: Creating artifact with spinner
11. CLI executes: orchestrator.createArtifact({ ... })
12. CLI displays: Success + URL + next steps
```

**Salvageable:**
- ✅ Wizard-style sequential prompts
- ✅ Default value suggestions
- ✅ Type-specific options
- ✅ Loading spinner during creation
- ✅ Success with actionable next steps

---

### Selection Patterns

#### Pattern: Fuzzy Search Selection

**Source:** `models/search.ts`, `mcp/search.ts`

**Flow:**
```
1. User types: /models search "fast reasoning"
2. CLI searches across:
   • Model names
   • Model descriptions
   • Provider names
   • Capabilities
3. CLI displays results ranked by relevance
4. CLI prompts: "Select model (1-5, 'a' for all, 'n' for none): "
5. User selects: "2"
6. CLI shows detailed info for selection
7. CLI prompts: "Set as active model? (y/n): "
```

**Salvageable:**
- ✅ Multi-field search
- ✅ Ranked results
- ✅ Interactive selection
- ✅ Action after selection
- ✅ Batch operations ("all")

---

#### Pattern: Filter Refinement

**Source:** `sessions/list.ts`, `permissions/logs.ts`

**Flow:**
```
1. User types: /sessions list
2. CLI displays all sessions (paginated)
3. CLI shows: "Filters: --active, --tags, --date, --model"
4. User refines: /sessions list --active --model claude
5. CLI displays filtered results
6. User further refines: add --tags testing
7. CLI displays narrowed results
8. CLI suggests: "Use /sessions view <id> for details"
```

**Salvageable:**
- ✅ Initial broad display
- ✅ Filter hints
- ✅ Incremental refinement
- ✅ Result count updates
- ✅ Next action suggestions

---

### Confirmation Patterns

#### Pattern: Destructive Operation Warning

**Source:** `sessions/delete.ts`, `artifacts/cleanup.ts`

**Flow:**
```
1. User types: /artifacts cleanup
2. CLI displays: List of stopped artifacts to delete
3. CLI warns: "⚠️  This will permanently delete 3 artifacts"
4. CLI lists: Artifacts with names and IDs
5. CLI prompts: "Type 'DELETE' to confirm: "
6. User types: "DELETE"
7. CLI executes deletion with progress
8. CLI displays: Summary of deleted artifacts
```

**Salvageable:**
- ✅ Preview of affected items
- ✅ Warning symbols and color
- ✅ Explicit confirmation phrase
- ✅ Case-sensitive confirmation
- ✅ Post-action summary

---

#### Pattern: Batch Operation Confirmation

**Source:** `mcp/enable.ts` (multiple servers)

**Flow:**
```
1. User types: /mcp enable --all
2. CLI displays: List of 5 servers to enable
3. CLI shows estimated resource usage
4. CLI prompts: "Enable all 5 servers? (y/n): "
5. If yes:
   a. Enable servers one by one
   b. Show progress: "Enabling 1/5: postgres-mcp..."
   c. Show success/failure per server
6. CLI displays: Summary (4 enabled, 1 failed)
7. CLI shows: Failed server details + retry suggestion
```

**Salvageable:**
- ✅ Batch preview
- ✅ Resource impact estimate
- ✅ Per-item progress
- ✅ Partial success handling
- ✅ Error details + retry option

---

### Input Validation Patterns

#### Pattern: Type Validation with Suggestions

**Source:** `artifacts/create.ts`, `models/test.ts`

**Flow:**
```
1. User enters invalid type: "reactjs"
2. CLI rejects: "❌ Invalid type 'reactjs'"
3. CLI suggests: "Did you mean 'react'?"
4. CLI shows: Valid types: js, ts, python, react, vue, nextjs
5. CLI re-prompts: "Artifact type: "
6. User enters: "react"
7. CLI accepts and continues
```

**Salvageable:**
- ✅ Clear error message
- ✅ "Did you mean?" suggestions
- ✅ Valid options display
- ✅ Re-prompt without restart
- ✅ Fuzzy matching for suggestions

---

#### Pattern: Range Validation

**Source:** `config/set.ts`, `limits/set.ts`

**Flow:**
```
1. User sets: /limits set max-turns 5000
2. CLI validates range: "⚠️  Value 5000 exceeds safe maximum (1000)"
3. CLI prompts: "Use recommended maximum? (y/n): "
4. If no → "Are you sure? (type 'OVERRIDE'): "
5. If override → Apply with warning
6. CLI displays: Warning banner in config display
```

**Salvageable:**
- ✅ Range checking
- ✅ Safe vs. override flow
- ✅ Double confirmation for dangerous values
- ✅ Persistent warning display
- ✅ Recommended value suggestion

---

### Error Handling Patterns

#### Pattern: Graceful Degradation

**Source:** `permissions/logs.ts`, `debug/logs.ts`

**Flow:**
```
1. User types: /permissions logs
2. CLI attempts to fetch logs
3. Endpoint doesn't exist (404)
4. CLI detects: "⚠️  Permission audit log endpoint not yet available"
5. CLI explains: "The permission audit log feature requires server-side implementation."
6. CLI shows: "Expected endpoint: GET /v1/permissions/logs"
7. CLI notes: "This will be available in a future update."
8. CLI suggests: "Use /permissions mode to view current settings"
```

**Salvageable:**
- ✅ Feature availability detection
- ✅ Clear "not yet available" message
- ✅ Technical details for developers
- ✅ Alternative command suggestion
- ✅ No crash, graceful exit

---

#### Pattern: Retry with Backoff

**Source:** `sessions/export.ts`, `artifacts/create.ts`

**Flow:**
```
1. Operation fails: "Network timeout"
2. CLI displays: "⚠️  Export failed, retrying in 2 seconds..."
3. Retry attempt 1 → Still fails
4. CLI displays: "⚠️  Export failed, retrying in 4 seconds..."
5. Retry attempt 2 → Success
6. CLI displays: "✓ Export complete (after 2 retries)"
```

**Salvageable:**
- ✅ Automatic retry logic
- ✅ Backoff timing display
- ✅ Retry count tracking
- ✅ Success acknowledgment with retry count
- ✅ Max retries limit

---

## 5. Reusable Test Utilities

### Test Infrastructure (No HTTP Assertions)

The test suite contains **pure utility functions** for formatting, display, and validation that are **completely reusable**.

#### Utility 1: Table Formatter

**Source:** Test fixtures and formatters

```typescript
/**
 * Format data as aligned table
 * Pure utility - no HTTP dependencies
 */
function formatTable(data: any[], columns: Column[]): string {
  const rows: string[] = [];

  // Header
  const headerRow = columns.map(col => col.label.padEnd(col.width)).join(' | ');
  rows.push(headerRow);
  rows.push('-'.repeat(headerRow.length));

  // Data rows
  data.forEach(item => {
    const row = columns.map(col => {
      const value = col.format ? col.format(item[col.key]) : item[col.key];
      return String(value).padEnd(col.width);
    }).join(' | ');
    rows.push(row);
  });

  return rows.join('\n');
}

interface Column {
  key: string;
  label: string;
  width: number;
  format?: (value: any) => string;
}
```

**Salvageable:** ✅ 100% - Pure presentation logic

---

#### Utility 2: Progress Indicator

**Source:** Test helpers

```typescript
/**
 * Display progress bar
 * Pure utility - no HTTP dependencies
 */
class ProgressBar {
  private current: number = 0;
  private total: number;
  private width: number;

  constructor(total: number, width: number = 40) {
    this.total = total;
    this.width = width;
  }

  update(current: number): void {
    this.current = current;
    this.render();
  }

  private render(): void {
    const percent = this.current / this.total;
    const filled = Math.floor(percent * this.width);
    const empty = this.width - filled;

    const bar = '█'.repeat(filled) + '░'.repeat(empty);
    const percentText = `${Math.floor(percent * 100)}%`;

    process.stdout.write(`\r[${bar}] ${percentText} (${this.current}/${this.total})`);

    if (this.current === this.total) {
      process.stdout.write('\n');
    }
  }
}
```

**Salvageable:** ✅ 100% - Pure display component

---

#### Utility 3: Spinner

**Source:** Test utilities

```typescript
/**
 * Display spinner during async operations
 * Pure utility - no HTTP dependencies
 */
class Spinner {
  private frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  private interval: NodeJS.Timeout | null = null;
  private frameIndex = 0;
  private message: string;

  constructor(message: string = 'Loading...') {
    this.message = message;
  }

  start(): void {
    this.interval = setInterval(() => {
      process.stdout.write(`\r${this.frames[this.frameIndex]} ${this.message}`);
      this.frameIndex = (this.frameIndex + 1) % this.frames.length;
    }, 80);
  }

  stop(finalMessage?: string): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    process.stdout.write(`\r${finalMessage || this.message}\n`);
  }
}
```

**Salvageable:** ✅ 100% - Pure animation logic

---

#### Utility 4: Input Validator

**Source:** Test validation helpers

```typescript
/**
 * Validate user input with custom rules
 * Pure utility - no HTTP dependencies
 */
class InputValidator {
  static required(value: string, fieldName: string): string | null {
    if (!value || value.trim().length === 0) {
      return `${fieldName} is required`;
    }
    return null;
  }

  static minLength(value: string, min: number, fieldName: string): string | null {
    if (value.length < min) {
      return `${fieldName} must be at least ${min} characters`;
    }
    return null;
  }

  static oneOf(value: string, options: string[], fieldName: string): string | null {
    if (!options.includes(value)) {
      return `${fieldName} must be one of: ${options.join(', ')}`;
    }
    return null;
  }

  static pattern(value: string, regex: RegExp, fieldName: string, hint: string): string | null {
    if (!regex.test(value)) {
      return `${fieldName} ${hint}`;
    }
    return null;
  }

  static range(value: number, min: number, max: number, fieldName: string): string | null {
    if (value < min || value > max) {
      return `${fieldName} must be between ${min} and ${max}`;
    }
    return null;
  }
}
```

**Salvageable:** ✅ 100% - Pure validation logic

---

#### Utility 5: Color Theme Manager

**Source:** `themes/ThemeManager.ts`

```typescript
/**
 * Manage color themes for CLI output
 * Pure utility - no HTTP dependencies
 */
interface Theme {
  colors: {
    primary: (text: string) => string;
    secondary: (text: string) => string;
    success: (text: string) => string;
    error: (text: string) => string;
    warning: (text: string) => string;
    muted: (text: string) => string;
    highlight: (text: string) => string;
  };
}

class ThemeManager {
  private static currentTheme: Theme = ThemeManager.getDefaultTheme();

  static getTheme(): Theme {
    return this.currentTheme;
  }

  static setTheme(theme: Theme): void {
    this.currentTheme = theme;
  }

  static getDefaultTheme(): Theme {
    return {
      colors: {
        primary: chalk.blue.bold,
        secondary: chalk.cyan,
        success: chalk.green,
        error: chalk.red.bold,
        warning: chalk.yellow,
        muted: chalk.gray,
        highlight: chalk.white.bold,
      }
    };
  }
}
```

**Salvageable:** ✅ 100% - Pure theming system

---

#### Utility 6: Formatters

**Source:** `utils/formatters.ts`

All formatters are **pure functions** with **zero HTTP dependencies**:

```typescript
// Number formatters
formatNumber(1234567)           // "1,234,567"
formatCompactNumber(1500000)    // "1.5M"
formatTokens(128000)            // "128k"
formatContextWindow(200000)     // "200K"
formatPercentage(75, 100)       // "75.0%"

// Date formatters
formatDate(new Date())          // "1/14/2025, 8:00:00 PM"
formatRelativeTime(date)        // "5 minutes ago"

// Size formatters
formatBytes(2048)               // "2.0 KB"

// Price formatters
formatPrice(3.50)               // "$3.50"
```

**Salvageable:** ✅ 100% - All formatters are pure utilities

---

### Test Pattern Summary

| Utility | Purpose | HTTP? | Salvageable |
|---------|---------|-------|-------------|
| Table Formatter | Aligned column display | ❌ | ✅ 100% |
| Progress Bar | Operation progress | ❌ | ✅ 100% |
| Spinner | Async operation indicator | ❌ | ✅ 100% |
| Input Validator | Form validation | ❌ | ✅ 100% |
| Theme Manager | Color schemes | ❌ | ✅ 100% |
| Number Formatters | Number display | ❌ | ✅ 100% |
| Date Formatters | Date/time display | ❌ | ✅ 100% |
| Size Formatters | Byte sizes | ❌ | ✅ 100% |
| Price Formatters | Currency display | ❌ | ✅ 100% |

**All utilities are reusable without modification.**

---

## Discarded Elements

### HTTP Architecture Components

❌ **DISCARD - DO NOT SALVAGE**

#### 1. HTTP Client Class

```typescript
// CortexClient.ts - DISCARD ENTIRELY
class CortexClient {
  constructor(serverUrl?: string) { /* ... */ }
  async get<T>(endpoint: string): Promise<T> { /* ... */ }
  async post<T>(endpoint: string, body: any): Promise<T> { /* ... */ }
  async *streamMessage(messages: Message[]): AsyncGenerator<StreamEvent> { /* ... */ }
}
```

**Why:** Entire architecture based on HTTP client/server separation.

---

#### 2. REST Endpoint Mappings

❌ **DISCARD - DO NOT SALVAGE**

All endpoint definitions:
```
GET  /models
GET  /sessions
POST /sessions/{id}/resume
GET  /mcp/servers
POST /mcp/servers/{name}/connect
GET  /permissions/mode
POST /permissions/mode
... (50+ more endpoints)
```

**Why:** Direct orchestrator calls replace HTTP routing.

---

#### 3. Server URL Configuration

❌ **DISCARD - DO NOT SALVAGE**

```typescript
const serverUrl = options.serverUrl || config.serverUrl || 'http://localhost:4000';
const client = new CortexClient(serverUrl);
```

**Why:** No server in direct-wired architecture.

---

#### 4. Network Error Handling

❌ **DISCARD - DO NOT SALVAGE**

```typescript
catch (error: any) {
  if (error.message.includes('ECONNREFUSED')) {
    console.error('Server not running. Start with: cortex server start');
  } else if (error.message.includes('404')) {
    console.error('Endpoint not found');
  }
}
```

**Why:** No network layer in direct calls.

---

#### 5. HTTP Response Parsing

❌ **DISCARD - DO NOT SALVAGE**

```typescript
const response = await client.get('/endpoint');
if (!response || !response.success) {
  throw new Error(response.error || 'Unknown error');
}
```

**Why:** Direct calls return native objects, not HTTP responses.

---

#### 6. SSE/Streaming Infrastructure

❌ **DISCARD - DO NOT SALVAGE**

```typescript
for await (const chunk of client.streamMessage(messages)) {
  process.stdout.write(chunk.text);
}
```

**Why:** Orchestrator streaming works differently (not HTTP SSE).

---

### Commands Marked for Removal

#### `/server start`
**Reason:** Server is not separate in direct-wired architecture.

#### `/server stop`
**Reason:** No server to stop.

#### `/server logs`
**Reason:** No server logs.

#### `/config wizard --server-url`
**Reason:** No server URL to configure.

---

## Recommendations

### For Slash-Command Menu System

#### 1. Use Categorization Scheme ✅

**Action:** Adopt the 22-category structure directly.

**Rationale:**
- Logically organized by feature area
- User-friendly grouping
- Scalable to 115+ commands
- Hierarchical (main → advanced → expert)

**Implementation:**
```typescript
interface SlashCommand {
  name: string;
  category: string;
  subcategory?: string;
  description: string;
  execute: (orchestrator: CortexOrchestrator, params: any) => Promise<void>;
  parameters: Parameter[];
  examples: string[];
  help: HelpText;
}

const commandRegistry: Map<string, SlashCommand> = new Map();
```

---

#### 2. Adapt UI Patterns ✅

**Action:** Replace HTTP calls with direct orchestrator calls, keep all formatting.

**Example Adaptation:**

**Before (HTTP-based):**
```typescript
export async function modelsList(options: ModelsListOptions) {
  const client = new CortexClient(options.serverUrl);
  const response = await client.get('/models');

  response.models.forEach(model => {
    console.log(formatModelRow(model));
  });
}
```

**After (Direct-wired):**
```typescript
export async function modelsList(
  orchestrator: CortexOrchestrator,
  options: ModelsListOptions
) {
  const models = await orchestrator.getModels();

  models.forEach(model => {
    console.log(formatModelRow(model));  // Same formatter
  });
}
```

**Key Change:** Replace `client.get()` with `orchestrator.method()`. Keep everything else.

---

#### 3. Reuse Help Text Database ✅

**Action:** Port all command help text, remove `--server-url` references.

**Adaptation:**
```typescript
// Before
--server-url [url]    Override server URL

// After
(remove this parameter)

// Keep everything else:
--provider [name]     Filter by provider
--capability [type]   Filter by capability
--json               Output as JSON
```

---

#### 4. Keep Interaction Flows ✅

**Action:** Multi-step patterns work perfectly for direct mode.

**Example:** Checkpoint creation wizard
```typescript
async function createCheckpointWizard(orchestrator: CortexOrchestrator) {
  const name = await prompt('Enter checkpoint name: ');
  const includeFiles = await confirm('Include file snapshots? (y/n): ');
  const description = await prompt('Add description (optional): ');

  // Direct call instead of HTTP POST
  const checkpoint = await orchestrator.createCheckpoint({
    name,
    includeFiles,
    description
  });

  console.log(theme.colors.success('✓ Checkpoint created'));
  console.log(`  ID: ${checkpoint.id}`);
  console.log('\nUse /checkpoints list to see all checkpoints');
}
```

---

#### 5. Extract Test Utilities ✅

**Action:** Copy all pure utility functions to shared utilities module.

**Utilities to Extract:**
- `formatTable()` - Table formatting
- `ProgressBar` - Progress display
- `Spinner` - Loading animations
- `InputValidator` - Input validation
- `ThemeManager` - Color theming
- All formatters from `utils/formatters.ts`

**Location:** Create `packages/cli/src/utils/` with these utilities.

---

### What to Build

#### Priority 1: Command Registry 🎯

**Build a slash-command registry:**

```typescript
// packages/cli/src/slash-commands/registry.ts

interface SlashCommand {
  name: string;           // "models list"
  category: string;       // "Models"
  subcategory?: string;   // "Management"
  description: string;    // "Display all available models"
  aliases?: string[];     // ["ml", "list-models"]

  parameters: Parameter[];

  execute: (
    orchestrator: CortexOrchestrator,
    params: CommandParams
  ) => Promise<void>;

  help: {
    usage: string;
    examples: string[];
    tips: string[];
  };
}

interface Parameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'choice';
  required: boolean;
  description: string;
  default?: any;
  choices?: string[];
  validation?: (value: any) => string | null;
}

class SlashCommandRegistry {
  private commands = new Map<string, SlashCommand>();
  private categories = new Map<string, SlashCommand[]>();

  register(command: SlashCommand): void {
    this.commands.set(command.name, command);

    if (!this.categories.has(command.category)) {
      this.categories.set(command.category, []);
    }
    this.categories.get(command.category)!.push(command);
  }

  get(name: string): SlashCommand | undefined {
    return this.commands.get(name);
  }

  getByCategory(category: string): SlashCommand[] {
    return this.categories.get(category) || [];
  }

  getAllCategories(): string[] {
    return Array.from(this.categories.keys());
  }

  search(query: string): SlashCommand[] {
    const lowerQuery = query.toLowerCase();
    return Array.from(this.commands.values()).filter(cmd =>
      cmd.name.toLowerCase().includes(lowerQuery) ||
      cmd.description.toLowerCase().includes(lowerQuery) ||
      cmd.category.toLowerCase().includes(lowerQuery)
    );
  }
}
```

---

#### Priority 2: Interactive Menu 🎯

**Build a hierarchical slash-command menu:**

```typescript
// packages/cli/src/slash-commands/menu.ts

class SlashCommandMenu {
  constructor(
    private registry: SlashCommandRegistry,
    private orchestrator: CortexOrchestrator
  ) {}

  async show(): Promise<void> {
    // User types "/"
    const categories = this.registry.getAllCategories();

    console.log(theme.colors.primary('\n📋 Available Commands\n'));

    categories.forEach((category, index) => {
      console.log(`  ${index + 1}. ${category}`);
    });

    console.log('\nType number or category name, or search with keywords');

    const choice = await prompt('> ');

    if (this.isNumber(choice)) {
      await this.showCategory(categories[parseInt(choice) - 1]);
    } else if (categories.includes(choice)) {
      await this.showCategory(choice);
    } else {
      await this.showSearchResults(choice);
    }
  }

  private async showCategory(category: string): Promise<void> {
    const commands = this.registry.getByCategory(category);

    console.log(theme.colors.primary(`\n${category} Commands\n`));

    commands.forEach((cmd, index) => {
      console.log(`  ${index + 1}. ${cmd.name}`);
      console.log(`     ${theme.colors.muted(cmd.description)}`);
    });

    const choice = await prompt('\nSelect command: ');
    const command = commands[parseInt(choice) - 1];

    if (command) {
      await this.executeCommand(command);
    }
  }

  private async executeCommand(command: SlashCommand): Promise<void> {
    // Collect parameters
    const params: any = {};

    for (const param of command.parameters) {
      if (param.required || await confirm(`Set ${param.name}? (optional)`)) {
        params[param.name] = await this.promptParameter(param);
      }
    }

    // Execute
    await command.execute(this.orchestrator, params);
  }

  private async promptParameter(param: Parameter): Promise<any> {
    while (true) {
      const value = await prompt(`${param.name}: `);

      if (param.validation) {
        const error = param.validation(value);
        if (error) {
          console.error(theme.colors.error(error));
          continue;
        }
      }

      return this.convertValue(value, param.type);
    }
  }
}
```

---

#### Priority 3: Pattern Library 🎯

**Extract and organize UI patterns:**

```typescript
// packages/cli/src/utils/patterns.ts

export class UIPatterns {
  // Table display
  static displayTable(data: any[], columns: Column[]): void {
    const table = formatTable(data, columns);
    console.log(table);
  }

  // Success/error feedback
  static success(message: string, details?: Record<string, string>): void {
    console.log(theme.colors.success(`✓ ${message}`));
    if (details) {
      Object.entries(details).forEach(([key, value]) => {
        console.log(`  ${key}: ${theme.colors.highlight(value)}`);
      });
    }
  }

  static error(message: string, suggestion?: string): void {
    console.error(theme.colors.error(`✗ ${message}`));
    if (suggestion) {
      console.log(theme.colors.muted(`\nTip: ${suggestion}`));
    }
  }

  // Multi-step wizard
  static async wizard(steps: WizardStep[]): Promise<Record<string, any>> {
    const results: Record<string, any> = {};

    for (const step of steps) {
      console.log(theme.colors.primary(`\n${step.title}`));
      if (step.description) {
        console.log(theme.colors.muted(step.description));
      }

      results[step.key] = await step.prompt();
    }

    return results;
  }

  // Confirmation
  static async confirmDestructive(
    action: string,
    items: string[]
  ): Promise<boolean> {
    console.log(theme.colors.warning(`⚠️  ${action}`));
    console.log('\nAffected items:');
    items.forEach(item => console.log(`  • ${item}`));

    const confirmation = await prompt('\nType "DELETE" to confirm: ');
    return confirmation === 'DELETE';
  }

  // Progress
  static async withProgress<T>(
    message: string,
    operation: () => Promise<T>
  ): Promise<T> {
    const spinner = new Spinner(message);
    spinner.start();

    try {
      const result = await operation();
      spinner.stop(theme.colors.success('✓ Complete'));
      return result;
    } catch (error) {
      spinner.stop(theme.colors.error('✗ Failed'));
      throw error;
    }
  }
}
```

---

## Migration Path

### Step-by-Step Implementation

#### Step 1: Extract Categorization → Create Command Registry

**Timeline:** 2 days

**Tasks:**
1. Create `SlashCommandRegistry` class
2. Define `SlashCommand` interface
3. Port command metadata from specs (115+ commands)
4. Create category→command mappings
5. Add search functionality

**Output:** `packages/cli/src/slash-commands/registry.ts`

---

#### Step 2: Extract UI Patterns → Create Pattern Library

**Timeline:** 1 day

**Tasks:**
1. Copy all formatters from `utils/formatters.ts` ✅ (already exist)
2. Extract table formatting logic
3. Extract progress/spinner components
4. Extract validation utilities
5. Create theme manager
6. Package as `UIPatterns` class

**Output:** `packages/cli/src/utils/patterns.ts`

---

#### Step 3: Extract Help Text → Create Help Database

**Timeline:** 2 days

**Tasks:**
1. Create help text schema
2. Extract descriptions from all 115+ command files
3. Extract parameter docs
4. Extract examples
5. Extract tips and suggestions
6. Create searchable help database

**Output:** `packages/cli/src/slash-commands/help.ts`

---

#### Step 4: Build Slash-Command Parser → Use Registry

**Timeline:** 2 days

**Tasks:**
1. Create command parser (parse slash input)
2. Integrate with registry
3. Parameter extraction
4. Validation
5. Autocomplete support

**Output:** `packages/cli/src/slash-commands/parser.ts`

---

#### Step 5: Build Interactive Menu → Use Patterns

**Timeline:** 3 days

**Tasks:**
1. Create `SlashCommandMenu` class
2. Category browser
3. Command selector
4. Parameter wizard
5. Search interface
6. Help viewer

**Output:** `packages/cli/src/slash-commands/menu.ts`

---

#### Step 6: Wire to Orchestrator → Direct Calls (Not HTTP)

**Timeline:** 3 days

**Tasks:**
1. Create orchestrator adapter layer
2. Map 115+ commands to orchestrator methods
3. Replace HTTP calls with direct calls
4. Test each command
5. Error handling

**Output:** `packages/cli/src/slash-commands/executor.ts`

---

### Total Timeline: 13 days (~2.5 weeks)

**Breakdown:**
- Registry: 2 days
- Pattern library: 1 day
- Help database: 2 days
- Parser: 2 days
- Menu: 3 days
- Orchestrator wiring: 3 days

---

## Implementation Notes

### Command Registry Structure

**All 115+ commands map to orchestrator methods:**

```typescript
// Example mappings
const commandMappings = {
  'models list': async (orchestrator, params) => {
    const models = await orchestrator.getModels();
    UIPatterns.displayTable(models, modelColumns);
  },

  'sessions view': async (orchestrator, params) => {
    const session = await orchestrator.getSession(params.id);
    displaySession(session);
  },

  'mcp enable': async (orchestrator, params) => {
    await orchestrator.enableMcpServer(params.name);
    UIPatterns.success('MCP server enabled', { name: params.name });
  },

  'artifacts create': async (orchestrator, params) => {
    const artifact = await orchestrator.createArtifact(params);
    UIPatterns.success('Artifact created', {
      id: artifact.id,
      url: artifact.url
    });
  },

  // ... 111+ more mappings
};
```

---

### Test Reuse Strategy

**Existing tests show interaction patterns (ignore HTTP assertions):**

**What to Keep from Tests:**
- ✅ Command parameter validation
- ✅ Success output format
- ✅ Error message format
- ✅ Multi-step interaction sequences

**What to Ignore:**
- ❌ Mock HTTP client setup
- ❌ `mockGet.toHaveBeenCalledWith('/endpoint')`
- ❌ Network error simulation
- ❌ Server URL configuration

**New Test Pattern:**
```typescript
// Instead of mocking HTTP client
const mockOrchestrator = {
  getModels: vi.fn().mockResolvedValue([/* models */])
};

// Test command execution
await modelsListCommand(mockOrchestrator, {});

// Assert on orchestrator call
expect(mockOrchestrator.getModels).toHaveBeenCalled();

// Assert on output (same as before)
expect(consoleLogSpy).toHaveBeenCalledWith(
  expect.stringContaining('Available Models')
);
```

---

## Conclusion

### Summary of Salvageable Assets

**✅ High Value:**
1. **Command Categorization** - 115+ commands, 22 categories, logically organized
2. **UI Pattern Library** - 8+ reusable patterns, all architecture-agnostic
3. **Help Text Database** - Complete documentation for all commands
4. **Interaction Flows** - Wizard, confirmation, validation patterns
5. **Formatter Utilities** - 9+ pure functions, zero HTTP dependencies

**❌ Zero Value:**
1. HTTP client architecture
2. REST endpoint mappings
3. Network error handling
4. Server URL configuration
5. SSE streaming infrastructure

---

### Key Recommendations

#### 1. Categorization: Use As-Is ✅

The 22-category structure is **perfect for slash-command menu**. No changes needed.

---

#### 2. UI Patterns: Adapt Minimally ✅

Replace `client.get()` with `orchestrator.method()`. Keep all formatting unchanged.

**Adaptation effort:** 5-10 minutes per command × 115 commands = **~10-20 hours**

---

#### 3. Help Text: Port Directly ✅

Remove `--server-url` parameter. Keep everything else.

**Adaptation effort:** 2 minutes per command × 115 commands = **~4 hours**

---

#### 4. Interaction Patterns: Reuse Completely ✅

Multi-step wizards, confirmations, validation all work with direct calls.

**Adaptation effort:** None - use as-is

---

#### 5. Test Utilities: Copy & Use ✅

All formatters, validators, display components are pure utilities.

**Adaptation effort:** None - copy files directly

---

### ROI Analysis

**Investment:** 13 days (2.5 weeks) to salvage and adapt

**Return:**
- ✅ 115+ commands categorized and documented
- ✅ Consistent UI patterns across all commands
- ✅ Rich help system
- ✅ Proven interaction flows
- ✅ Production-ready utilities

**Alternative:** Build from scratch = **8-10 weeks**

**Time Savings:** ~6-8 weeks (75% reduction)

---

### Final Verdict

**Salvage Operation: HIGHLY SUCCESSFUL** ✅

The command system documentation contains **extensive high-value assets** that are **directly transferable** to a slash-command menu system. The HTTP architecture was wrong, but the **user-facing design** was sound and complete.

**Recommended Action:** SALVAGE AND ADAPT

Extract categorization, UI patterns, help text, and utilities. Discard HTTP infrastructure. Build slash-command system on top of salvaged assets.

**Estimated Completion:** 2.5 weeks vs. 8-10 weeks from scratch.

---

## Appendices

### Appendix A: Full Command List (115+ Commands)

See [COMMAND_CATEGORIZATION_MATRIX.md](/home/runner/workspace/nexus-cortex/packages/cli/docs/commands_system_(unused)/commands_specs_(unused)/COMMAND_CATEGORIZATION_MATRIX.md) for complete list.

### Appendix B: Formatter Reference

See [FORMATTERS.md](/home/runner/workspace/nexus-cortex/packages/cli/docs/commands_system_(unused)/commands_specs_(unused)/FORMATTERS.md) for complete formatter documentation.

### Appendix C: Architecture Documentation

See [CLI_ARCHITECTURE.md](/home/runner/workspace/nexus-cortex/packages/cli/docs/commands_system_(unused)/commands_specs_(unused)/CLI_ARCHITECTURE.md) for system design (note: HTTP-based, discard architecture, keep patterns).

---

**Report Complete**
**Status:** ✅ SALVAGE OPERATION SUCCESSFUL
**Next Action:** Begin implementation following migration path
