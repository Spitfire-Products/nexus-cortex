# Natural Language Workflows Guide-NEEDS MORE WORK!
**CONSIDER GIVING THE 115 COMMANDS TO THE MODEL TO USE**

**Purpose:** Show how to access features via natural language instead of dedicated commands
**Architecture:** Features accessed via tools through `POST /v1/messages` with `tools=[]`

---

## Core Concept

Instead of having 115 dedicated commands, users interact naturally with the AI, which calls the appropriate tools:

```
User → Natural Language → AI → Tool Selection → Tool Execution → Result
```

**Example:**
```bash
# Old approach (dedicated command):
$ cortex mcp enable postgres

# New approach (natural language):
$ cortex chat
You: "enable the postgres MCP server"
AI: *calls EnableMcpServer tool* → Success!
```

---

## Available Tools (52+ total)

### Base Tools (27)

**File Operations:**
- Read, Write, Edit, Glob, Grep
- Move, Copy, Delete

**Git Operations:**
- GitCommit, GitPush, GitPull, GitStatus, GitDiff

**Search & Analysis:**
- WebSearch, WebFetch
- CodeAnalysis, DependencyGraph

**Development:**
- RunTests, BuildProject, InstallPackage
- CreateFile, CreateDirectory

### MCP Management Tools (7)

- `EnableMcpServer` - Enable an MCP server
- `DisableMcpServer` - Disable an MCP server
- `ListMcpServers` - List available MCP servers
- `GetMcpServerStatus` - Get server status
- `ConfigureMcpServer` - Configure server settings
- `RestartMcpServer` - Restart a server
- `GetMcpTools` - List tools from a server

### Artifact Tools (11)

- `CreateArtifact` - Create new artifact
- `UpdateArtifact` - Update existing artifact
- `DeleteArtifact` - Delete artifact
- `ListArtifacts` - List all artifacts
- `InspectArtifact` - Inspect artifact details
- `InteractWithArtifact` - Send input to artifact
- `GetArtifactOutput` - Get artifact output
- `StartArtifact` - Start artifact execution
- `StopArtifact` - Stop artifact execution
- `RestartArtifact` - Restart artifact
- `GetArtifactStatus` - Get artifact status

### Historical Context Tools (4)

- `SearchConversationHistory` - Search past conversations
- `GetRecentConversations` - Get recent history
- `GetConversationContext` - Get context from past sessions
- `SummarizeConversation` - Summarize conversation

### Special Tools (3)

- `DynamicToolFactory` - Create custom tools on-the-fly
- `ToolComposition` - Combine multiple tools
- `BatchToolExecution` - Execute tools in batch

---

## Natural Language Workflows

### 1. MCP Server Management

#### Enable MCP Server
```
User: "enable the postgres MCP server"
AI: I'll enable the postgres MCP server for you.
    *calls EnableMcpServer("postgres")*
    ✓ postgres MCP server enabled successfully
```

#### Disable MCP Server
```
User: "disable the filesystem MCP server"
AI: *calls DisableMcpServer("filesystem")*
    ✓ filesystem MCP server disabled
```

#### Check MCP Status
```
User: "what MCP servers are currently running?"
AI: *calls ListMcpServers()*

    Currently enabled MCP servers:
    • postgres - PostgreSQL database access
    • github - GitHub API integration
    • slack - Slack messaging

    Available but disabled:
    • filesystem - File system access
    • docker - Docker container management
```

#### Configure MCP Server
```
User: "configure the postgres MCP server to connect to localhost:5432"
AI: *calls ConfigureMcpServer("postgres", {host: "localhost", port: 5432})*
    ✓ postgres MCP server configured
```

---

### 2. Artifact Management

#### Create Artifact
```
User: "create a React component for a todo list"
AI: I'll create a React todo list component as an artifact.
    *calls CreateArtifact({
      type: "react",
      title: "Todo List Component",
      content: "import React...",
      language: "tsx"
    })*

    ✓ Created artifact: todo-list-component (ID: abc123)
    The component includes:
    - State management for todos
    - Add/remove functionality
    - Checkbox for completion
```

#### Interact with Artifact
```
User: "run the todo list component"
AI: *calls InteractWithArtifact("abc123", "start")*
    ✓ Artifact running at http://localhost:3000

    You can now interact with your todo list in the browser.
```

#### List Artifacts
```
User: "show me all my artifacts"
AI: *calls ListArtifacts()*

    Your artifacts:
    1. todo-list-component (React) - Created 2 hours ago
    2. data-visualization (Chart.js) - Created yesterday
    3. api-server (Node.js) - Created 3 days ago
```

#### Inspect Artifact
```
User: "show me the details of the todo list component"
AI: *calls InspectArtifact("abc123")*

    Artifact: todo-list-component
    Type: React (TSX)
    Status: Running
    URL: http://localhost:3000
    Created: 2 hours ago
    Last modified: 30 minutes ago

    Dependencies:
    - react: ^18.2.0
    - react-dom: ^18.2.0

    Files:
    - TodoList.tsx (main component)
    - styles.css (styling)
    - package.json (config)
```

---

### 3. Historical Context

#### Search Past Conversations
```
User: "what did we discuss about authentication yesterday?"
AI: *calls SearchConversationHistory("authentication", {since: "yesterday"})*

    Found 3 relevant conversations:

    1. Session abc123 (yesterday, 2:30 PM)
       "Implementing JWT authentication for the API"
       Key points: Token expiry, refresh tokens, middleware

    2. Session def456 (yesterday, 5:15 PM)
       "Adding OAuth2 support"
       Key points: Provider integration, callback URLs

    3. Session ghi789 (yesterday, 7:00 PM)
       "Security best practices for auth"
       Key points: HTTPS only, secure cookies, CORS
```

#### Get Recent Context
```
User: "what were we working on recently?"
AI: *calls GetRecentConversations(limit: 5)*

    Recent sessions:
    1. Today, 10:00 AM: "Debugging React rendering issue"
    2. Today, 9:00 AM: "Adding tests for API endpoints"
    3. Yesterday, 5:00 PM: "Database migration strategy"
    4. Yesterday, 3:00 PM: "Implementing user dashboard"
    5. Yesterday, 1:00 PM: "Setting up CI/CD pipeline"
```

---

### 4. Mentorship System

**Note:** Mentorship is a middleware feature configured server-side, not exposed as commands.

#### Check Mentorship Status
```
User: "is mentorship mode enabled?"
AI: *checks server middleware configuration*

    Mentorship Mode: Enabled
    Model: claude-sonnet-4
    Keywords: ["security", "performance", "architecture"]

    The mentorship model will provide guidance when these
    topics are discussed.
```

#### Get Mentorship Guidance
```
User: "I'm implementing authentication. Any advice?"
AI: *keyword "authentication" triggers mentorship*

    [Primary Response]
    I'll help you implement authentication. Here's a basic approach...

    [Mentorship Guidance - claude-sonnet-4]
    💡 Security Considerations:
    - Always use HTTPS in production
    - Implement rate limiting on auth endpoints
    - Use bcrypt with salt rounds ≥12 for passwords
    - Consider multi-factor authentication
    - Implement account lockout after failed attempts
    - Use secure, httpOnly cookies for session tokens
```

---

### 5. Helper Model

**Note:** Helper model is for quick lookups, configured server-side.

#### Quick Information Lookup
```
User: "what's the syntax for array destructuring in JavaScript?"
AI: *helper model provides quick answer*

    Array destructuring syntax:
    ```javascript
    const [first, second, ...rest] = array;
    ```

    Example:
    ```javascript
    const numbers = [1, 2, 3, 4, 5];
    const [one, two, ...others] = numbers;
    // one = 1, two = 2, others = [3, 4, 5]
    ```
```

---

### 6. Session Management

**Note:** Sessions have dedicated REST endpoints, but natural language can also work.

#### Search Sessions
```
User: "find sessions where we discussed React"
AI: *calls SearchConversationHistory("React")*

    Found 12 sessions discussing React:

    Recent:
    1. abc123 - "React performance optimization" (today)
    2. def456 - "React hooks best practices" (yesterday)
    3. ghi789 - "Setting up React project" (2 days ago)

    Or use: cortex sessions search "React"
```

#### View Session Stats
```
User: "show me stats for today's sessions"
AI: *calls GET /sessions with filter*

    Today's Sessions: 5 total

    Total messages: 247
    Total tokens: 156,432
    Average tokens per message: 633

    By model:
    - claude-sonnet-4: 3 sessions (120k tokens)
    - gpt-4o: 2 sessions (36k tokens)

    Or use: cortex sessions stats <id>
```

---

### 7. Model Information

#### Get Model Info
```
User: "tell me about claude-sonnet-4-5"
AI: *calls GET /models and filters*

    Model: claude-sonnet-4-5
    Provider: Anthropic
    Context: 200,000 tokens
    Pricing: $3.00/$15.00 per 1M tokens (input/output)

    Features:
    - Extended thinking mode
    - Tool use support
    - Vision capabilities
    - Fast response time

    Or use: cortex models info claude-sonnet-4-5
```

#### Compare Models
```
User: "compare gpt-4o and claude-sonnet-4 for my use case"
AI: Let me help you compare these models.

    For your use case (full-stack development):

    GPT-4o:
    ✓ Lower cost ($2.50/$10.00 per 1M tokens)
    ✓ Faster response time
    ✓ Good for quick iterations
    ✗ Smaller context (128K tokens)

    Claude Sonnet 4:
    ✓ Larger context (200K tokens)
    ✓ Better code quality
    ✓ Excellent for complex reasoning
    ✗ Higher cost ($3.00/$15.00 per 1M tokens)

    Recommendation: Use GPT-4o for rapid prototyping,
    Claude Sonnet 4 for complex architecture decisions.
```

---

### 8. Context Management

**Note:** Context management is handled automatically by the orchestrator.

#### Check Context Status
```
User: "how much of my context window am I using?"
AI: *calls orchestrator.getContextStatus()*

    Context Usage:
    Current: 45,823 / 200,000 tokens (22.9%)

    Breakdown:
    - System messages: 3,245 tokens
    - Conversation: 38,456 tokens
    - Tools: 4,122 tokens

    Status: Healthy ✓
    Estimated turns remaining: ~150
```

#### Compact Context
```
User: "can you compact the context to save space?"
AI: I'll compact the conversation context.
    *orchestrator runs compaction*

    Context Compaction Complete:
    Before: 45,823 tokens
    After: 28,456 tokens
    Saved: 17,367 tokens (37.9%)

    Preserved:
    - Recent 10 messages (full detail)
    - Key decisions and code
    - Tool use history

    Summarized:
    - Earlier conversation flow
    - Redundant explanations
```

---

### 9. File & Code Operations

#### Read Files
```
User: "show me the contents of src/index.ts"
AI: *calls Read tool*

    Here's src/index.ts:
    [file contents displayed with syntax highlighting]
```

#### Search Code
```
User: "find all files using the useEffect hook"
AI: *calls Grep tool*

    Found useEffect in 12 files:
    - src/components/TodoList.tsx (3 occurrences)
    - src/components/Dashboard.tsx (2 occurrences)
    - src/hooks/useFetch.ts (1 occurrence)
    [... and 9 more]
```

#### Modify Code
```
User: "add error handling to the login function"
AI: *calls Read to view, then Edit to modify*

    I'll add comprehensive error handling to the login function.

    Changes made:
    ✓ Added try-catch block
    ✓ Added network error handling
    ✓ Added validation error handling
    ✓ Added user-friendly error messages

    [shows diff of changes]
```

---

### 10. Development Workflows

#### Run Tests
```
User: "run the unit tests"
AI: *calls RunTests tool*

    Running tests...

    Test Suites: 24 passed, 24 total
    Tests: 187 passed, 187 total
    Coverage: 89.3%
    Duration: 12.5s

    All tests passed! ✓
```

#### Install Dependencies
```
User: "install axios and dotenv as dependencies"
AI: *calls InstallPackage tool*

    Installing packages...

    ✓ axios@1.6.2 installed
    ✓ dotenv@16.3.1 installed

    Updated package.json
```

#### Build Project
```
User: "build the project for production"
AI: *calls BuildProject tool*

    Building for production...

    ✓ TypeScript compilation complete
    ✓ Assets bundled and minified
    ✓ Source maps generated

    Output: dist/
    Bundle size: 245 KB (gzipped: 78 KB)
    Build time: 8.2s
```

---

## When to Use Commands vs. Natural Language

### Use Dedicated Commands For:

**Scripting/Automation:**
```bash
# Get session ID from previous command
SESSION_ID=$(cortex sessions list --json | jq -r '.[0].id')

# Export that session
cortex sessions export "$SESSION_ID" > backup.jsonl
```

**Quick Lookups:**
```bash
# Fast model list without AI overhead
cortex models list --provider anthropic

# Quick server status
cortex server status
```

**Programmatic Access:**
```bash
# JSON output for parsing
cortex sessions list --json | jq '.[] | select(.model == "gpt-4o")'
```

### Use Natural Language For:

**Complex Operations:**
- Multi-step workflows
- Decision-making required
- Context-aware actions
- Exploratory tasks

**Feature Discovery:**
- "What can I do with artifacts?"
- "How do I enable MCP servers?"
- "What tools are available?"

**Interactive Work:**
- Debugging
- Code review
- Architecture discussions
- Learning/exploration

---

## Enabling Tools in Chat

### Method 1: Default Behavior (Recommended)

```bash
# Chat with all tools enabled automatically
cortex chat
```

When you send a message, the CLI makes this request:
```javascript
POST /v1/messages
{
  "messages": [{"role": "user", "content": "enable postgres MCP server"}],
  "tools": [],  // Empty array = auto-enable all built-in tools
  "stream": true
}
```

### Method 2: Specific Tools Only

```bash
# Future enhancement: specify which tools to enable
cortex chat --tools EnableMcpServer,DisableMcpServer,ListMcpServers
```

### Method 3: No Tools

```bash
# Chat without tools (faster, simpler)
cortex chat --no-tools
```

---

## Tool Categories Reference

### When AI Uses Each Category:

**File/Code Tools:**
- User asks to view, edit, or search files
- User asks to create or delete files
- Code analysis or refactoring requests

**MCP Management Tools:**
- User mentions enabling/disabling MCP servers
- User asks about MCP status or configuration
- User wants to list available tools

**Artifact Tools:**
- User wants to create interactive components
- User asks to run or modify artifacts
- User wants to see artifact status

**Historical Context Tools:**
- User asks "what did we discuss..."
- User wants to search past conversations
- User asks "what were we working on..."

**Development Tools:**
- User asks to run tests
- User wants to install packages
- User asks to build the project

**Search Tools:**
- User asks to search the web
- User wants to fetch information from URLs
- Research or information gathering

---

## Best Practices

### ✅ DO:

- Use natural language for complex, multi-step operations
- Let AI choose the right tools based on context
- Use dedicated commands for scripting and automation
- Combine tools and commands as needed
- Ask follow-up questions to refine results

### ❌ DON'T:

- Try to memorize tool names (AI knows them)
- Use commands when natural language is clearer
- Over-specify (AI can infer intent)
- Mix paradigms in scripts (stick to commands for automation)

---

## Examples by Use Case

### Use Case 1: Setting Up New Project

**Natural Language Flow:**
```
You: "I want to start a new React project with TypeScript"

AI: I'll help you set up a new React + TypeScript project.

    *creates directory structure*
    *initializes package.json*
    *installs dependencies*
    *sets up TypeScript config*
    *creates initial components*

    ✓ Project ready! Here's what I created:
    - package.json with React + TypeScript
    - tsconfig.json (strict mode)
    - src/ directory with App.tsx
    - public/ directory with index.html

    You can start with: npm start
```

### Use Case 2: Debugging Production Issue

**Natural Language Flow:**
```
You: "search our sessions for discussions about the authentication bug"

AI: *calls SearchConversationHistory("authentication bug")*

    Found the discussion from 2 days ago (session abc123):

    The issue was related to JWT token expiry timing.
    We fixed it by:
    1. Increasing token expiry from 1h to 4h
    2. Adding refresh token mechanism
    3. Implementing sliding window expiry

    Code changes in: src/auth/jwt.ts

    Would you like me to show the current code?
```

### Use Case 3: Code Review Request

**Natural Language Flow:**
```
You: "review the changes in src/api/routes.ts for security issues"

AI: *calls Read, analyzes code*

    Security Analysis of src/api/routes.ts:

    ⚠️ Issues Found:

    1. Missing input validation (lines 45-52)
       Risk: SQL injection vulnerability
       Fix: Use parameterized queries

    2. No rate limiting on /login endpoint (line 78)
       Risk: Brute force attacks
       Fix: Add express-rate-limit middleware

    3. Passwords logged in error messages (line 105)
       Risk: Sensitive data exposure
       Fix: Sanitize error logs

    ✓ Good practices:
    - HTTPS enforced
    - CORS configured properly
    - Authentication middleware in place

    Would you like me to fix these issues?
```

---

## Migration from Old Commands

### Old Way (Dedicated Commands):

```bash
cortex mentorship status
cortex mentorship enable
cortex artifact create --type react --title "Todo"
cortex artifact interact abc123
cortex history search "authentication"
```

### New Way (Natural Language):

```bash
cortex chat
You: "is mentorship mode enabled?"
You: "enable mentorship mode"
You: "create a React todo list component"
You: "run that component"
You: "search our past conversations about authentication"
```

**Benefits:**
- More intuitive
- Context-aware
- Fewer commands to remember
- Better error handling
- Conversational interface

---

## Summary

**Core Principle:** Let the AI choose the right tools based on natural language intent.

**52+ Tools Available:**
- 27 base tools (files, git, search, dev)
- 7 MCP management tools
- 11 artifact tools
- 4 historical context tools
- 3+ special tools

**When to Use:**
- Natural language: Complex operations, exploration, interactive work
- Dedicated commands: Scripting, automation, quick lookups

**How It Works:**
```
User input → POST /v1/messages with tools=[] → AI selects tools → Tools execute → Results returned
```

**Next Steps:**
1. Try `cortex chat` and ask questions naturally
2. Explore available tools by asking "what tools can you use?"
3. Reference this guide for workflow examples
4. Use dedicated commands for automation/scripting only
