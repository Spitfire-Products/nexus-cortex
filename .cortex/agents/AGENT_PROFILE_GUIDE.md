# Agent Profile Guide

This guide covers how to create, configure, and use Task Agent profiles in Nexus Cortex.

## Overview

Task Agents are specialized sub-agents that can be spawned via the `Task` tool to handle complex, multi-step operations. Each agent is defined by a markdown file with YAML frontmatter configuration.

## Directory Structure

Agents are loaded from two locations:

```
.cortex/
└── agents/             # Project-specific agents
    ├── explore.md
    ├── code-reviewer.md
    └── test-writer.md

~/.cortex/agents/       # Personal agents (shared across projects)
    └── my-custom-agent.md
```

Project agents take precedence over personal agents with the same name.

## Creating an Agent Profile

### Basic Structure

```markdown
---
name: agent-name
description: Brief description of when to use this agent.
tools:
  - Read
  - Write
  - Grep
model: sonnet
---

# Agent Title

Your system prompt goes here. This defines the agent's personality,
capabilities, and behavior guidelines.
```

### Frontmatter Schema

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Unique identifier (alphanumeric + hyphens, max 64 chars) |
| `description` | string | Yes | When to use this agent (shown in tool description) |
| `tools` | string[] or "all" | Yes | Allowed tools or "all" for unrestricted access |
| `model` | string | Yes | Model alias or full ID, or "inherit" for parent's model |

### Name Requirements

- Alphanumeric characters and hyphens only
- 1-64 characters
- Must be unique within the same location (project/personal)
- Case-sensitive

Valid: `code-reviewer`, `test123`, `my-agent`
Invalid: `Code Reviewer`, `test_writer`, `a-really-long-name-that-exceeds-the-maximum-allowed-length-of-64-characters`

## Tool Configuration

### Restricted Tool Access

Specify which tools the agent can use:

```yaml
tools:
  - Read     # Read files
  - Glob     # Find files by pattern
  - Grep     # Search file contents
```

The agent will only have access to these tools. Any attempt to use other tools will be blocked.

### Full Tool Access

For agents that need all capabilities:

```yaml
tools: all
```

**Warning**: Use `all` sparingly. Restricted tools improve safety and focus.

### Available Tools

Core file operations:
- `Read` - Read file contents
- `Write` - Create/overwrite files
- `Edit` - Edit existing files
- `Glob` - Find files by pattern
- `Grep` - Search file contents

Shell operations:
- `Bash` - Execute shell commands
- `BashOutput` - Get output from background shells
- `KillShell` - Terminate shells

Web operations:
- `WebSearch` - Search the web
- `WebFetch` - Fetch web pages

Planning and UI:
- `TodoWrite` - Manage task lists
- `AskUserQuestion` - Ask user questions
- `ExitPlanMode` - Exit plan mode

Special:
- `Task` - Spawn sub-agents (use carefully to avoid infinite loops)
- `SlashCommand` - Execute slash commands
- `Skill` - Use skills

## Model Configuration

### Model Aliases

Use convenient aliases for common models:

```yaml
model: sonnet      # Claude Sonnet 4.5
model: opus        # Claude Opus 4.1
model: haiku       # Claude 3.5 Haiku
model: gemini      # Gemini 2.5 Pro
model: grok        # Grok 4.1 Fast
model: deepseek    # DeepSeek Chat
```

### Full Model IDs

Specify exact models:

```yaml
model: claude-sonnet-4-5-20250929
model: gemini-2.5-flash
model: gpt-4o
```

### Inherit Parent Model

Use the same model as the parent session:

```yaml
model: inherit
```

### Available Aliases

| Alias | Model |
|-------|-------|
| `sonnet`, `claude-sonnet`, `sonnet-4.5` | claude-sonnet-4-5-20250929 |
| `opus`, `claude-opus`, `opus-4` | claude-opus-4-1-20250805 |
| `haiku`, `claude-haiku`, `haiku-3.5` | claude-3-5-haiku-20241022 |
| `gemini`, `gemini-pro`, `gemini-2.5` | gemini-2.5-pro |
| `gemini-flash`, `flash` | gemini-2.5-flash |
| `grok`, `grok-4`, `grok-fast` | grok-4.1-fast-reasoning |
| `deepseek` | deepseek-v4-pro |
| `reasoner` | deepseek-v4-pro |
| `gpt4`, `gpt-4` | gpt-4.1 |
| `o1`, `o3`, `o4-mini` | (OpenAI reasoning models) |

## System Prompt Best Practices

### Structure

1. **Role definition** - What the agent is and does
2. **Approach/methodology** - How the agent works
3. **Guidelines** - Rules and constraints
4. **Output format** - Expected response structure

### Example

```markdown
---
name: security-auditor
description: Performs security audits on code, identifying vulnerabilities and suggesting fixes.
tools:
  - Read
  - Glob
  - Grep
model: opus
---

# Security Auditor Agent

You are a security expert specializing in application security.

## Your Role

Analyze code for security vulnerabilities including:
- Injection attacks (SQL, Command, XSS)
- Authentication/authorization flaws
- Data exposure risks
- Cryptographic weaknesses

## Approach

1. Read relevant files systematically
2. Check for known vulnerability patterns
3. Assess severity (Critical/High/Medium/Low)
4. Provide remediation guidance

## Output Format

Report each finding as:

### [Severity] [Vulnerability Type]
**Location**: file:line
**Description**: What the issue is
**Impact**: What could happen
**Remediation**: How to fix it
```

### Tips

- **Be specific** - Clear instructions produce better results
- **Include examples** - Show expected output format
- **Define scope** - What should and shouldn't be done
- **Set constraints** - Quality standards, safety rules

## Using Agents

### Via Task Tool

The Task tool spawns agents:

```
Use the Task tool to spawn the code-reviewer agent with:
- task: "Review the authentication module for security issues"
- agent: "code-reviewer"
```

### Agent Selection

The parent LLM selects agents based on the task and agent descriptions. Write clear descriptions to improve selection accuracy.

### Monitoring

Sub-agent events are streamed to the parent:
- `agent:started` - Agent begins execution
- `agent:progress` - Progress updates (tokens, turns)
- `agent:tool_call` - Tool usage
- `agent:text` - Output text
- `agent:completed` - Execution complete
- `agent:error` - Errors encountered

## Advanced Configuration

### Timeout Settings

Configure via Task tool options (not in agent definition):

```
timeout: 300000  # 5 minutes (default)
maxTurns: 10     # Maximum conversation turns
```

### Permission Inheritance

Agents inherit permission policies from the parent session:
- Parent's whitelist/blacklist policies apply
- File operation restrictions are enforced
- Bash command policies carry over

Agents cannot exceed parent permissions, only further restrict them.

## Troubleshooting

### Agent Not Found

Check:
1. File is in `.cortex/agents/` or `~/.cortex/agents/`
2. File has `.md` extension
3. YAML frontmatter is valid
4. Name matches file name (recommended)

### Invalid Configuration

Common issues:
- Missing required field (`name`, `description`, `tools`, `model`)
- Invalid tool name (check spelling, case-sensitive)
- Invalid model alias (check available aliases)
- Invalid name format (special characters)

### Agent Errors

Check the agent:error event for details. Common causes:
- Tool restrictions blocking required operations
- Model API errors
- Timeout exceeded
- Invalid system prompt

## Example Agents

See the other files in this directory for complete examples:

- `explore.md` - Fast codebase exploration
- `code-reviewer.md` - Code review
- `test-writer.md` - Test generation
- `doc-writer.md` - Documentation
- `refactor.md` - Code refactoring
- `plan.md` - Implementation planning
