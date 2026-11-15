# Scheduled jobs (`cortex schedule`)

`cortex schedule` gives the agent durable loops: jobs that run on a period and survive restarts. Requires nexus-cortex ≥ 4.137.0.

```bash
cortex schedule add "[daily-report]" --every 1440 --prompt "Summarize what changed in this repo today and write it to REPORT.md"
cortex schedule add "[new-issues]" --every 15 --when "gh issue list --label agent --state open --json number --jq '.[].number'" \
  --prompt-file ~/prompts/triage.txt
cortex schedule list            # jobs, last run + exit code, who runs them, the ticker
cortex schedule install         # install the OS ticker (launchd on macOS, a crontab line on Linux)
cortex schedule remove "[new-issues]"
```

Jobs live in `~/.cortex/schedules.json`. Each run sends the job's prompt as one agent turn.

## Who runs a job: the window or the ticker
- **While a TUI window (fuzzycortex) is open, it is the runner.** It runs a due job as a turn in its own session once it has been idle for
  about a minute. `cortex schedule list` then shows `runner: fuzzycortex window (pid …)`.
- **With no window open, the ticker runs it.** The ticker is the OS scheduler calling `cortex schedule run-due` every 60 seconds: a launchd job
  at `~/Library/LaunchAgents/com.nexus-cortex.schedule.plist` on macOS, a crontab line on Linux. It stands down while a window owns the
  schedule. Its log is `~/.cortex/schedule.log`.

## Running only when there is work: `--when`
`--when "<shell command>"` makes a job fire only when that command exits 0 **and** prints something. A command that fails, is missing or prints
nothing means no turn and no spend. Use it for "new issues", "new files in an inbox folder", "a queue is non-empty", and so on.
(`--mail-only` / `--mail-name` are the same idea wired to a specific team mail setup; most users want `--when`.)

## Approvals in scheduled turns
A job run by a window uses that window's approval mode (see `autoApprove` in [the user guide](user-guide.md)). A job run by the ticker is
headless and auto-approves; `--yolo` makes that explicit per job. Safety floors (screen/app automation, keys written into files) still refuse
when nobody is there to ask.

## Checking the ticker after an update
`cortex update` re-installs an installed ticker (4.137.17+). After a manual `npm i -g nexus-cortex`, run `cortex schedule install`, then check:

```bash
plutil -p ~/Library/LaunchAgents/com.nexus-cortex.schedule.plist | grep -A4 ProgramArguments   # macOS
crontab -l | grep "nexus-cortex schedule ticker"                                                  # Linux
```

The command must be the global `…/bin/cortex` shim plus `schedule run-due`, never a path inside `node_modules` (before 4.137.17 an update
could move that path and the ticker failed every minute with `MODULE_NOT_FOUND` while an open window hid it). On macOS,
`launchctl list | grep nexus-cortex` should show exit status 0.
