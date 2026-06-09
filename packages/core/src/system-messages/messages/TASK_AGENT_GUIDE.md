# Sub-Agents

You can launch specialized sub-agents via the `task` tool. Use `task({ subagent_type: "list" })` to discover available agents.

Sub-agents are stateless — include absolute paths, context, and success criteria in prompts. Multiple task calls in one response run in parallel.
