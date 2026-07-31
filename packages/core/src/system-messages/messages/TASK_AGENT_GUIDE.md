# Sub-Agents

You can launch specialized sub-agents via the `Task` tool. Use `Task({ subagent_type: "list" })` to discover available agents.

Sub-agents are stateless — include absolute paths, context, and success criteria in prompts. Multiple Task calls in one response run in parallel.
