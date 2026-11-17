# Lifecycle hooks

Hooks run your own commands (or add fixed text) at points in an agent session: when it starts, before each prompt, around each tool call,
around a compaction, at the end of each turn and when the session ends. Use them to give the agent context it should always have, to
enforce a policy on tool calls, or to log what happened.

Hooks work the same way in every surface: the TUIs (fuzzycortex, neoncortex), the headless one-shot (`cortex "…"`, `cortex agent "…"`), the
server (`cortex-server`, `POST /v1/messages`) and scheduled jobs (`cortex schedule`). The file format is the same as Claude Code's `hooks`
settings block, so existing hook scripts carry over.

With no hooks file nothing changes: no command runs and the requests sent to the model are byte-for-byte the same as before.

## Where hooks live

| File | Scope |
|------|-------|
| `~/.cortex/hooks.json` | you, in every project (`CORTEX_HOME` moves `~/.cortex`) |
| `<project>/.cortex/hooks.json` | one project (the directory the session works in) |

Both files are read and merged: your hooks first, then the project's. Changes apply from the next event; there is nothing to restart.
A file that is not valid JSON or does not match the format below is ignored, with one warning on the console. A Claude Code settings file
(`{ "hooks": { … } }`) is accepted as it is; events cortex does not have (for example `Notification`) are ignored with a warning.

```json
{
  "SessionStart": [
    { "matcher": "new|resume", "hooks": [ { "type": "prompt", "text": "Read NOTES.md before you start." } ] }
  ],
  "PreToolUse": [
    { "matcher": "Bash", "hooks": [ { "type": "command", "command": "~/.cortex/hooks/check-bash.sh", "timeout": 10 } ] }
  ]
}
```

- `matcher` (optional) is a regular expression matched against the whole tool name (`PreToolUse`, `PostToolUse`) or the session source
  (`SessionStart`). `Edit|Write` matches `Edit` and `Write` but not `MultiEdit`. Omitted, `""` or `"*"` matches everything. Other events
  ignore it.
- A `command` hook runs through the shell in the project directory. `timeout` is in seconds (default 60).
- A `prompt` hook adds its `text` as context for the model. Nothing runs.
- Hooks for one event run one after another, in file order (your file first).

### Project hooks need your trust

A hooks file runs shell commands, and a repository you clone can contain a `.cortex/hooks.json`. So a project's file is ignored until you trust it. Read the file first, then run this inside the project:

```
cortex hooks trust      # allow this project's .cortex/hooks.json as it is now
cortex hooks status     # list the hook files cortex would read here, and whether each one is trusted
cortex hooks untrust    # stop trusting it
```

Trust covers the file's exact contents. It is stored as a SHA-256 hash in `~/.cortex/hooks-trust.json`. If the file changes, cortex skips it again and prints a warning until you run `cortex hooks trust` again.

Your own `~/.cortex/hooks.json` always loads. To trust every project file at once, set `CORTEX_HOOKS_TRUST_PROJECTS=1`. This is meant for CI or containers that only run their own code.

## Events

Each command gets the event as one JSON object on stdin. Every payload has `session_id`, `cwd` (the project directory),
`hook_event_name` and, once the session has a file, `transcript_path`. The environment also carries `CORTEX_HOOK_EVENT`,
`CORTEX_SESSION_ID` and `CORTEX_PROJECT_DIR` (plus `CLAUDE_PROJECT_DIR` with the same value, so Claude Code scripts keep working).

| Event | When it fires | Extra payload fields |
|-------|---------------|----------------------|
| `SessionStart` | just before the first model request of a session; again with `source: "compact"` right after a compaction | `source`: `new`, `resume`, `compact`, `update` or `schedule` |
| `UserPromptSubmit` | before each prompt is sent (typed, one-shot or scheduled) | `prompt` |
| `PreToolUse` | before each tool call the model makes | `tool_name`, `tool_input`, `tool_use_id` |
| `PostToolUse` | after each tool call | `tool_name`, `tool_input`, `tool_use_id`, `tool_response` (first 10,000 characters), `is_error` |
| `Stop` | when the agent finishes its turn | `stop_hook_active` (always `false`) |
| `PreCompact` | before the harness compacts the conversation | `trigger` (`auto`), `tokens`, `threshold` |
| `PostCompact` | after the compaction | `trigger`, `tokens_before` |
| `SessionEnd` | once when a session ends: another session replaces it, the program exits, or a headless one-shot finishes | `reason`: `clear`, `resume`, `exit`, `oneshot` or `other` |

About `source`:
- `new`: a fresh session. `resume`: a session loaded again (`--resume`, the session picker, `/continue`), or a later turn on a session
  whose `SessionEnd` already ran (each headless one-shot ends its session; the next one-shot that continues it starts it again as `resume`).
- `schedule`: a fresh session started by `cortex schedule` for a job without `--session`. Jobs that run inside an open TUI window run in
  that window's session, so they fire `UserPromptSubmit`, not `SessionStart`.
- `compact`: right after a compaction, so a hook can point the agent back at its notes.
- `update`: accepted for surfaces that restart a session after an update. Nothing in the package sends it yet.

A TUI that opens and then resumes a session fires one `SessionStart` with `source: "resume"`, at the first turn. A session that never runs
a turn (for example `cortex models list`) fires no hooks at all.

## What a hook can do

**Add context.** On exit code 0, the command's stdout is added to the next model request as context. Plain text works, and so does JSON:

```json
{ "additionalContext": "3 unread messages in the team inbox" }
{ "hookSpecificOutput": { "hookEventName": "UserPromptSubmit", "additionalContext": "…" } }
```

JSON without `additionalContext` adds nothing. Where the context goes:
- `SessionStart`, `UserPromptSubmit`, `Stop` and compaction hooks: into the next prompt the model sees (for `Stop`, the next turn).
- `PreToolUse` and `PostToolUse`: appended to the tool results of that step, so the model sees it in the very next request.
Each piece arrives as a `<system-reminder>` block naming the event. Context added to a prompt stays attached to that prompt for the rest
of the session, so the model still sees it on later turns. The history saved on disk keeps only the user's original prompt, and a resumed
session gets its `SessionStart` (source `resume`) context again. Context added to a tool result is saved with that result. All hook context for one request
is capped at 20,000 characters (`CORTEX_HOOKS_MAX_CONTEXT_CHARS`).

**Block.** Exit code 2 blocks on two events, with stderr as the reason:
- `PreToolUse`: the tool does not run. The model gets `Blocked by a PreToolUse hook: <reason>` as that call's result and can change course.
- `UserPromptSubmit`: the prompt is not sent and is not saved. The reply is `Prompt blocked by a UserPromptSubmit hook: <reason>`
  (`metadata.hookBlocked` in the API response).
JSON `{"decision": "block", "reason": "…"}` or `{"hookSpecificOutput": {"permissionDecision": "deny", "permissionDecisionReason": "…"}}`
blocks the same way. A block stops the remaining hooks for that event. On other events exit code 2 is only logged.

**Fail safely.** Any other exit code, a command that cannot start, or a timeout is written to `~/.cortex/hooks.log` and the session carries
on. A hook never breaks a session.

## Turning hooks off

- `CORTEX_HOOKS=off` turns all hooks off even when a file exists (useful on a benchmark machine that carries a shared hooks file).
- Sub-agents never run hooks; their parent session does.
- Internal single-purpose runs (the autoresearch judge and fixer) never run hooks.

## Examples

### One-shot user: project notes in every headless run

`<project>/.cortex/hooks.json`:

```json
{
  "SessionStart": [
    { "hooks": [ { "type": "command", "command": "cat NOTES.md 2>/dev/null; git log --oneline -5" } ] }
  ],
  "PreToolUse": [
    { "matcher": "Bash", "hooks": [ { "type": "command", "command": "jq -r .tool_input.command | grep -q 'git push' && { echo 'no pushes from the agent' >&2; exit 2; } || true" } ] }
  ]
}
```

`cortex "fix the failing test"` now starts with the notes and the last five commits in context, and the agent cannot run `git push`.

### A scheduled routine

A daily report job, with a hook that only applies to scheduled sessions:

```bash
cortex schedule add "[daily-report]" --every 1440 --prompt "Summarize what changed in this repo today and write it to REPORT.md"
```

```json
{
  "SessionStart": [
    { "matcher": "schedule", "hooks": [ { "type": "prompt", "text": "This is an unattended scheduled run: do not ask questions; write what you could not finish to REPORT.md." } ] }
  ],
  "SessionEnd": [
    { "hooks": [ { "type": "command", "command": "echo \"$(date) $CORTEX_SESSION_ID ended\" >> ~/.cortex/routine.log" } ] }
  ]
}
```

`--run-at-start` makes a job also run once each time a runner starts (a TUI window opens, or the machine boots for the ticker); without
`--every` it runs only then. See [schedule.md](schedule.md).

### A long-running agent with a resume memory

An agent that keeps a resume note and must read it whenever it comes back (new session, resume, after a compaction):

```json
{
  "SessionStart": [
    { "matcher": "new|resume", "hooks": [ { "type": "command", "command": "cat ~/notes/resume.md 2>/dev/null || echo 'No resume note yet: create ~/notes/resume.md now.'" } ] },
    { "matcher": "compact", "hooks": [ { "type": "prompt", "text": "The conversation was just compacted. Re-read ~/notes/resume.md before you continue." } ] }
  ],
  "PreCompact": [
    { "hooks": [ { "type": "command", "command": "cp ~/notes/resume.md ~/notes/resume.$(date +%s).md 2>/dev/null; true" } ] }
  ],
  "UserPromptSubmit": [
    { "hooks": [ { "type": "command", "command": "~/bin/inbox-peek --json", "timeout": 15 } ] }
  ]
}
```

Note: the context from a `PreCompact` hook reaches the model after the compaction (the next request). To make the agent write a
checkpoint before context is lost, use a command hook that saves files, as above, or rely on the harness's own resume memory, which it
writes as the context fills up, before it compacts (on by default; `CORTEX_COMPACTION_RESUME`).
