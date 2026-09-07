---
name: cortex-subagent
description: >
  Drive Nexus Cortex headlessly as a full autonomous SUB-AGENT from your own
  agent harness — configure it, prompt it, budget it, and verify its output. Use
  when another agent/harness (not a human at a TUI) should delegate a real task
  to cortex: "run cortex as a subagent", "delegate this to cortex headlessly",
  "use the cortex CLI/server to do X", "offload work to nexus-cortex". Covers the
  three headless entry points, the operational config levers worth setting, how
  to write a self-contained autonomous brief, isolation, and orchestrator-side
  verification. NOT for interactive TUI use.
metadata:
  short-description: "Drive nexus-cortex headlessly as an autonomous subagent from your own harness"
  author: "nexus-cortex"
---

# cortex-subagent — driving Nexus Cortex as an autonomous sub-agent

Nexus Cortex is a **headless harness**: the engine underneath an agent, not an app for a
human to sit in front of. Its highest-leverage use is as a **full-featured autonomous
sub-agent that your own agent/harness drives** — you (an LLM orchestrator) can configure and
prompt it far more precisely than a human clicking a UI. This skill is the operational
formula for doing that well.

> The authoritative config reference is **`docs/configuration.md`** + the annotated
> **`.env.example`** (every lever, with its ledgered status). This skill curates the
> *operationally important* levers and the *driving patterns*; it points at the ledger for
> values rather than duplicating it.

## 1. Three headless entry points — pick by shape

| Need | Entry point |
|---|---|
| One-shot autonomous task, get the final answer | **CLI:** `cortex --new --quiet -m <model> "<task>"` |
| Programmatic / streaming / many calls | **HTTP:** `POST http://localhost:4000/v1/messages` (Anthropic-shaped body) — the server **auto-starts on first use**, or run `cortex serve` |
| In-process, same runtime | **Library:** `import { CortexOrchestrator } from '@nexus-cortex/core'` |

Headless behavior that makes autonomy work: **tools auto-approve** (no permission prompts to
babysit) and the **server auto-starts** — a driver never has to interact. `--new` starts a
fresh session (no context bleed from a prior run); `--quiet` suppresses the CLI chrome so
stdout is the answer.

## 2. Always PIN the model

Pass `-m <exact-id>` (CLI), `"model": "<id>"` (HTTP), or set `DEFAULT_MODEL_ID`. Do **not**
rely on `auto`/the router when you need a *specific* model's behavior or cost — the router may
route per-task-type and silently swap the variable you care about. `cortex models list` prints
the live set (many providers; switch mid-flight, mix models across sub-agents).

## 3. The operational config surface (set what the task needs; leave the rest)

Set via `export VAR=…` before launch (inherited by the auto-spawned server), `cortex config
set VAR value` (writes `~/.cortex/.env`), or a project `.env`. **Echo a `config:` line at
launch to prove your vars are live** — a stale server reuses old config.

- **Autonomy** — headless already auto-approves tools; the permission engine still gates truly
  destructive ops. For a fully hands-off run in a sandbox, that default is what you want.
- **Judgment quality (the mentor/gate family — opt-in):** these make a weaker/cheaper model
  finish *correctly* more often. `MENTORSHIP_ENABLED` + `MENTORSHIP_HELPER_MODEL` (a stronger
  model consulted on thrash); `CORTEX_LIFT_PLAN` (a bounded planner reads the task at turn-1 and
  injects a plan + the real success criteria); `CORTEX_ENDTURN_GATE` + `CORTEX_ENDTURN_REQUIREMENTS`
  (a finish is rejected unless each stated requirement is attested with proof); `CORTEX_ENDTURN_RESOLVER`
  (a stronger model adjudicates the finish). Turn these on when correctness matters more than a
  few extra cents/seconds; see `.env.example` for the tuning knobs (`*_EFFORT`, `*_BUDGET_TOKENS`, `*_TIMEOUT_MS`).
- **Tool surface:** `CORTEX_TOOL_ANCHOR` frames the model toward a tool style at turn-1 (e.g.
  `bash-edit` for a shell/edit-native task). Tool profiles trade schema scaffolding (helps small
  models) vs a lean surface (helps frontier models).
- **Budgets & failsafes** (see §5): `MAX_TOOL_ITERATIONS`, `TOOL_BUDGET_SOFT`, `CORTEX_TURN_DEADLINE_MS`.

## 4. Write a SELF-CONTAINED autonomous brief

A headless subagent gets one prompt and no chance to ask you a follow-up. So the brief must carry
everything:
- **The task + all context it needs** — don't assume it can see your conversation. Paste the
  grounding (file paths, the mechanism, line pointers) into the brief.
- **An explicit deliverable + where to put it** — "edit `./src/x.ts` in place AND write
  `./NOTES.md` describing the change + how you verified it." A concrete artifact is checkable.
- **Verification instructions** — tell it to run the build/tests/typecheck itself and report what
  it did (it may not always succeed — see §6 — but asking makes it try).
- **Guardrails** — "do NOT touch other files / deploy / call live services." Headless = no human
  veto, so state the boundaries.
- **Isolation** — run it in its own directory or a git worktree so parallel subagents (or a bad
  run) can't corrupt shared state.

## 5. Bound the run — budgets are failsafes, not work limits

- `CORTEX_TURN_DEADLINE_MS` — a **wall-clock deadline**; at the limit the harness **force-
  synthesizes** a best-effort finish instead of running forever. For a one-shot task (a single
  turn), this effectively bounds the WHOLE task — set it to ~90% of your own timeout so cortex
  converges before you'd kill it. (The clock starts at the tool-loop, i.e. after server boot and
  any turn-1 planning — measure the loop, not total process wall, when checking if it fired.)
- `MAX_TOOL_ITERATIONS` — a hard cap on tool round-trips (a runaway-loop failsafe, set high).
- `TOOL_BUDGET_SOFT` — a soft pressure signal (nudges the model to converge as tool calls
  accumulate); `<= 0` disables the budget-pressure system.

## 6. Verify the subagent's work — orchestrator-verifies-worker

Never ship a subagent's output on its self-report alone.
- **Do the authoritative check yourself** (the driver): run the build, `tsc`, the tests, or grep
  the artifact. A subagent nested in a large repo copy sometimes *cannot* run its own
  build/typecheck (install/git timeouts) and will fall back to inspection — so the driver owns the
  real verification.
- **Discard-and-rerun confounded runs.** A `fetch failed` / transport error means the model call
  died, not that the task is impossible — throw that run away and re-run (optionally a different
  model). One transport wobble is not a result.
- For high-value tasks, run **N candidates** and keep the best (see the `best-of-n` skill), or
  gate the result with the `verify-work` skill.

## 7. Sessions & memory

`--new` per task for isolation; omit it to continue a session. Sessions persist to disk; enable
**canon** (`docs/CANON.md`) for provider-neutral, cross-harness memory so a task's context can be
handed to another model or harness later.

## Pointers
- **`docs/configuration.md`** + **`.env.example`** — the canonical lever ledger (values + status).
- **`docs/user-guide.md`** — the full CLI, the HTTP server, the REST API, sessions, deployment.
- **`docs/authentication.md`** — API keys and the Claude OAuth-subscription path.
- **`docs/CANON.md`** — portable agent memory / cross-harness handoff.
- Related skills: **`best-of-n`** (parallel tournament), **`verify-work`** (adversarial verification), **`cortex-bench`** (measuring the harness).
