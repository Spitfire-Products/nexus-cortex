# Lifecycle hooks for nexus-cortex — plan (2026-11-17, for operator go)

Principle (operator 11-17): the LIBRARY provides general primitives — hooks, schedules, loops, event triggers — usable by every kind of
user (one-shot headless tasks, repeat structured routines, event-triggered jobs, long-running teammates). Our team habits (resume memory,
mail, checkpoints) are one COMPOSITION of those primitives, shipped as configuration through agent-home, never hard-coded in the package.
Library first: everything lives in core (OrchestratorClient / session lifecycle); TUIs, server and CLI only surface it.

## What exists (verified 11-17)
- `cortex schedule` (core/src/config/schedule.ts): interval jobs that survive restarts; `session` (resume a session) or a fresh one per run;
  `cwd`, `model`, `yolo`; triggers `mailOnly` (agent-home convenience) and the GENERIC `when` gate (a shell command; fires only on exit 0 +
  output); an open TUI runs due jobs inside its own session, else an OS ticker (launchd / crontab) runs them headless.
- No session lifecycle hooks: nothing runs on session start, resume, compaction or turn end; no tool-use hooks.

## Add: hooks (dark by default — a user with no hooks config sees no change)
Config: `~/.cortex/hooks.json` (user) + `<project>/.cortex/hooks.json` (project), merged; schema mirrors Claude Code's so skills port:
`{ "<Event>": [ { "matcher"?: "<tool name / source regex>", "hooks": [ { "type": "command", "command": "…", "timeout"?: s } | { "type": "prompt", "text": "…" } ] } ] }`
Events (each with a JSON payload on the command's stdin: session id, cwd, source, tool name/input where relevant):
| Event | Fires | Typical use |
|---|---|---|
| SessionStart | new session, `source` = new / resume / compact / update / schedule | inject a resume prompt, arm loops, print status |
| PreCompact / PostCompact | around harness compaction | write a checkpoint first / re-inject the entry point after |
| UserPromptSubmit | before a user (or schedule) prompt is sent | add context (mail waiting, guards) |
| PreToolUse / PostToolUse | around a tool call (matcher = tool name) | policy, logging, format checks |
| Stop | turn end | follow-up work, notifications |
| SessionEnd | session closes | flush, report |
Semantics (same as Claude Code, so habits port 1:1): a `command` hook's stdout (or JSON `{additionalContext}`) is injected into the next
model request as context; exit code 2 on PreToolUse / UserPromptSubmit blocks with stderr as the reason; a `prompt` hook injects fixed text.
Timeouts; failures never break the session (logged, exit 0). Headless one-shot (`cortex "…"`) runs SessionStart + Stop + SessionEnd too.

## Add to schedules
- `runAtStart: true` — a job is due once at TUI / ticker start (covers "on restart, do X" without the 30-min polling stand-in).
- Optional `onEvent`: a file-watch path or a webhook token (later; `when` already covers polling-style events).

## Team composition (agent-home, not the package)
`templates/cortex-hooks.json` installed by setup-client.py: SessionStart → prompt hook = the SESSION START block; PreCompact → checkpoint
prompt; UserPromptSubmit → mail-check command (same idea as the Claude Code mail-check hook). Then retire the `[resume-check]` schedule.

## Delivery
core: HookRunner + config loader + event emission at the session lifecycle points (TUI + server + headless share it); tests per event;
docs/hooks.md; changeset (minor); release through the deploy script. Then agent-home template + setup-client step.
