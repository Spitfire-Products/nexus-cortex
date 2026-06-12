# Agent Dispatch Modes — Nexus Cortex

This directory contains Task Agent profiles. The orchestrator spawns agents via `child_process.fork()` when the LLM calls the `Task` tool. Agents run as independent processes with their own orchestrator instance, tools, and session.

## Quick Reference

| Mode | Agents | Communication | Workspace | Trigger |
|------|--------|--------------|-----------|---------|
| **Solo** | 1 | None | Shared | 1 Task tool call |
| **Parallel** | N | None | Shared | N Task tool calls in same turn |
| **Team** | N | Briefing + Broadcasting | Shared | N Task calls (auto-detected) |
| **Git Worktree** | N | Briefing + Broadcasting | Isolated per agent | WorkspaceManager + N Task calls |

---

## Mode 1: Solo Agent

A single Task tool call spawns one agent. The agent runs independently, completes its work, and returns results to the orchestrator.

### When to Use
- Focused single-domain tasks (code review, exploration, test writing)
- Tasks that don't benefit from parallelization

### Usage

```bash
# Via cortex CLI — model dispatches a solo agent internally
cortex --quiet "Review packages/core/src/orchestrator/APIClient.ts for security issues"

# Via API
curl -s http://localhost:4000/v1/messages \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Use the code-reviewer agent to review APIClient.ts"}]}'
```

### How It Works
1. LLM calls Task tool with agent name and prompt
2. Orchestrator spawns child process via `SubAgentProcessManager.spawnAgent()`
3. Agent runs with its own tools, model, and system prompt (from `.cortex/agents/{name}.md`)
4. IPC events stream back: tool calls, text, progress, completion
5. Agent result returned as tool_result to parent LLM

---

## Mode 2: Parallel Agents

Multiple Task tool calls in the same LLM response are dispatched simultaneously via `Promise.all`. Agents run independently with no communication between them.

### When to Use
- Independent tasks that can run concurrently
- Multiple searches or analyses that don't need to share findings
- Speed-critical workflows where wall-clock time matters

### Usage

```bash
# The model decides to parallelize based on the prompt
cortex --quiet "Search for all usages of deprecated API patterns AND check test coverage for the auth module"

# Explicit multi-agent dispatch
cortex --quiet "Use 3 parallel explore agents to search for: (1) all WebSocket code, (2) all authentication middleware, (3) all rate limiting logic"
```

### How It Works
1. LLM emits N Task tool calls in a single response
2. `handleToolCalls()` in orchestrator separates Task tools from regular tools
3. All N agents spawned simultaneously via `Promise.all`
4. Each agent runs independently — no shared state or communication
5. All results collected and returned to parent LLM

---

## Mode 3: Team Agents

When the orchestrator detects >1 Task tools in the same response, it automatically activates team mode. Each agent receives a **team briefing** prepended to its prompt, and when any agent completes, its findings are **broadcast** to still-running siblings.

### When to Use
- Tasks where agents benefit from knowing about each other's work
- PR review (security + quality + architecture agents share findings)
- Any parallel dispatch where cross-pollination of results adds value

### Usage

```bash
# PR review — dispatches 3 audit agents as a team
cortex --pr review owner/repo 42

# Custom team dispatch
cortex --quiet "Dispatch a team of 3 agents: one to review security, one to review performance, one to check test coverage for the auth refactor"

# Via API
curl -s http://localhost:4000/v1/messages \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Use parallel agents to review the auth module. Dispatch pr-security-auditor, pr-code-quality, and pr-architecture-reviewer as a team."}]}'
```

### How It Works
1. LLM emits N Task tool calls in a single response
2. `handleToolCalls()` detects N > 1, calls `injectTeamBriefing()`
3. Each agent's prompt gets prepended with:
   ```
   📋 **Team Briefing**
   You are part of a {N}-agent team working in parallel.

   Teammates:
   - {agent-1}: {assignment}
   - {agent-2}: {assignment}

   The orchestrator will forward relevant findings from teammates.
   Focus on YOUR assignment. Do not duplicate others' work.
   ```
4. Agents run in parallel
5. When Agent A completes, `broadcastGuidance()` sends summary to Agents B, C
6. Running agents receive guidance via IPC → `injectGuidance()` → ephemeral `<system-reminder>` or thinking block
7. All results collected and returned to parent LLM

### Cross-Agent Communication Path
```
Agent A completes
  → SubAgentProcessManager.broadcastGuidance(summary, excludeAgentA)
    → IPC message type 'guidance' sent to Agent B, C
      → agent-mode.ts handler pushes to pendingGuidance[]
        → orchestrator.injectGuidance(message, 'team_update')
          → injectThinkingBlock() dual-path:
              Google: thinking block
              Others: <system-reminder> tag
```

---

## Mode 4: Git Worktree (Isolated Workspace)

Combines team mode with per-agent git worktree isolation. Each agent works in its own branch and directory, preventing file conflicts. The `WorkspaceManager` tool manages the worktree lifecycle.

### When to Use
- Multiple agents editing the same codebase simultaneously
- PR implementation with parallel feature branches
- Multi-repo operations (clone external repos for each agent)
- Any scenario where agents might create conflicting file changes

### Usage

```bash
# Internal development — multiple agents on different features
cortex --quiet "Use WorkspaceManager to create 2 worktrees (branch auth-refactor and branch api-cleanup), then dispatch pr-implementer agents to each worktree with specific tasks"

# External PR — clone and review
cortex --pr review external-org/repo 42

# Multi-repo workflow
cortex --quiet "Clone owner/upstream-lib into a worktree AND create a local worktree for this repo's changes. Dispatch agents to update shared types in both."
```

### How It Works
1. LLM calls `WorkspaceManager` tool to create worktrees:
   - `create` mode: `git worktree add /tmp/workspace-{id} -b {branch}`
   - `clone` mode: `git clone {repo} /tmp/repo-{id}` then worktree
2. WorkspaceManager returns structured JSON with worktree paths
3. LLM includes worktree paths in Task prompts for each agent
4. Team briefing includes workspace paths for each teammate
5. Each agent operates in its isolated worktree
6. After agents complete, LLM can:
   - `diff` mode: See what each agent changed
   - `cleanup` mode: Remove worktrees

### WorkspaceManager Modes

| Mode | Command | Returns |
|------|---------|---------|
| `create` | `git worktree add /tmp/workspace-{id} -b {branch}` | worktree path |
| `clone` | `git clone {repo}` + `git worktree add` | worktree path |
| `status` | `git worktree list` | all active worktrees |
| `diff` | `git -C {path} diff {base}` | diff content |
| `cleanup` | `git worktree remove {path}` | confirmation |

---

## Visual Monitoring (Optional)

Set `AGENT_TMUX_MONITOR=true` to enable tmux pane monitoring for parallel agents.

```bash
# Enable monitoring
AGENT_TMUX_MONITOR=true cortex --quiet "Dispatch 3 parallel agents..."

# View in browser
open http://localhost:4001/tmux/team-{dispatchId}

# Attach in terminal
tmux attach -t team-{dispatchId}
```

Each agent gets its own tmux pane showing live IPC events:
- `🔧 Read /path/to/file` — tool calls
- Agent text output
- `Turn 3 | 5.2K tokens | 12.3s` — progress
- `✅ Done: {summary}` — completion
- `❌ Error: {message}` — errors

---

## Agent Profiles in This Directory

### General Purpose
| Agent | Model | Tools | Use Case |
|-------|-------|-------|----------|
| `explore` | inherit | Read, Glob, Grep | Fast codebase exploration |
| `code-reviewer` | inherit | Read, Grep, Glob | Code review with findings |
| `test-writer` | inherit | Read, Write, Edit, Bash, Grep, Glob | Test generation |
| `doc-writer` | inherit | Read, Write, Edit, Glob, Grep | Documentation |
| `refactor` | inherit | Read, Write, Edit, Bash, Grep, Glob | Code refactoring |
| `plan` | inherit | Read, Glob, Grep | Implementation planning |
| `context-research` | inherit | Read, Grep, Glob, WebSearch, WebFetch | Research with web access |

### PR Review Team
| Agent | Model | Tools | Role in Team |
|-------|-------|-------|-------------|
| `pr-security-auditor` | inherit | Grep, Read, Bash | Scan for vulnerabilities, malicious code, supply chain risks |
| `pr-code-quality` | inherit | Read, Grep, Glob | Review style, complexity, anti-patterns, test gaps |
| `pr-architecture-reviewer` | inherit | Read, Grep, Glob, Bash | Breaking changes, API surface, dependency impact |
| `pr-implementer` | inherit | Read, Edit, Write, Bash, Grep, Glob | Implement code changes in git worktree |
| `pr-test-writer` | inherit | Read, Write, Edit, Bash, Grep, Glob | Write tests for PR changes |

### Specialized
| Agent | Model | Tools | Use Case |
|-------|-------|-------|----------|
| `new-model-api-integrator-analyst` | inherit | all | Analyze new AI provider APIs for integration |
| `a-frontend-landing-page-designer` | inherit | all | Design frontend interfaces |

---

## Creating a New Agent

See `AGENT_PROFILE_GUIDE.md` for the full guide. Quick version:

```markdown
---
name: my-agent
description: Brief description of when to use this agent.
tools:
  - Read
  - Write
  - Grep
model: inherit
---

# My Agent

System prompt defining the agent's role, approach, and output format.
```

**Required fields**: `name`, `description`, `tools`, `model`
**Model options**: `inherit` (parent's model), aliases (`sonnet`, `opus`, `haiku`, `grok`), or full IDs
**Tools**: Array of tool names or `all` for unrestricted access

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Agent not found | Check `.cortex/agents/{name}.md` exists with valid YAML frontmatter |
| Team briefing not appearing | Ensure >1 Task tools in same LLM response |
| WorkspaceManager branch conflict | `git branch -D {branch}` to clean stale branches |
| Guidance not received | Check agent-mode.ts guidance handler, verify IPC is connected |
| Tmux monitoring not working | Verify `tmux` binary available, `AGENT_TMUX_MONITOR=true` |
| PR commands failing | Verify `gh auth status` — gh CLI must be authenticated |
| Model not found errors | Use registered model IDs (check `cortex --list-models`) |
