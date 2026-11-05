# The browser

nexus-cortex agents browse the web through **nexus-browser**: ~50 tools (browse, scan, click, type, get_content, fill_form,
extract_table, computer_use, screenshots, a real-Chrome sandbox with live view, …). It runs in one of two places:

| | **hosted** (default) | **local** |
|---|---|---|
| Where | `browser.spitfire-products.com/mcp` | the `@nexus-cortex/browser` package, on your machine |
| Install | nothing | chosen at `cortex setup`, or `cortex browser install` — installs everything it needs |
| Keys | auto-provisioned on first connect | none |
| Your IP | a datacenter's (bot walls more likely) | yours (a home connection is rarely walled) |
| License | service | AGPL-3.0-only or commercial (`packages/browser/LICENSE*`) |

> **Availability:** the local browser is a separately licensed package that is not published yet. Until it is, `cortex browser status`
> reports it as not installed and everything below about the local browser applies only where the package is present.

`NEXUS_BROWSER_MODE` (`hosted` | `local`) picks one. The harness switches to local only when the local install reports ready, so a
half-finished install never leaves an agent without a browser.

## Installing the local browser

Choosing it **is** the approval: everything it needs is installed in that one step, and nothing is ever installed at runtime otherwise.

```bash
cortex setup                       # asks: run the browser on this machine? (only when the package is present)
cortex setup --browser local       # scripted
cortex browser install             # later: shows what is missing, asks, installs, switches to local
cortex browser install --yes       # no prompt — e.g. in a Dockerfile / image build
cortex browser status              # what is there, what is missing, which browser is in use
cortex browser use hosted|local    # switch without installing
```

What gets installed (each step only if missing): Chrome (found on the machine, else Chrome for Testing downloaded into
`~/.nexus-cortex/browser`); on Linux the system tools **Xvfb** (the sandbox's own display — required even on a desktop),
**xdotool**, **x11vnc** — through root, passwordless `sudo`, `sudo` at a terminal (may ask for your password), or Nix, else the exact
command is printed; a private Python environment with patchright, websockify and the PDF libraries; two extensions (uBlock Origin Lite,
Consent-O-Matic). With no person present and no `--yes`, nothing is installed and the hosted browser stays in use.
`nexus-browser-doctor` (the same installer) shows the full table.

## Two ways for an agent to browse

The built-in **Browse** tool has two modes:

- **delegate** (default): a browse sub-agent does the whole task with the full browser toolset and returns the result. Only the result
  enters your context (the ~43 tool definitions, ~12.5K tokens, stay out of it). Best for self-contained tasks.
- **direct** (`Browse({ task, mode: "direct" })`): the browser tools are connected into **your own** session, immediately and for the
  rest of it; you then call `nexus-browser__browse`, `scan`, `click`, `get_content`, … yourself. Best for back-and-forth work where you need
  to see each page.

Both use the hosted or local browser per `NEXUS_BROWSER_MODE`.

**When each mode is offered.** `direct` is for a person watching the browser step by step. With nobody watching (`cortex agent`, the
API, benches) it is not offered: the Browse schema has no `mode`, and a call that names `direct` anyway runs as a delegate
(`CORTEX_BROWSE_DIRECT=auto`; `always` / `never` override). In an interactive session, the first `direct` request for a multi-step task
is answered with the reason to delegate; asking again connects (`CORTEX_BROWSE_DIRECT_CONFIRM`). After 15 direct browser calls in one turn
the model is told once to hand the rest to a delegate (`CORTEX_BROWSE_DIRECT_NUDGE_CALLS`). Measured on CarMax with DeepSeek Flash:
direct mode took 78–140 steps and 3.6–9.4M input tokens, and twice reported CarMax's nationwide count as the local one.

**One call, the whole task.** Give Browse the goal, every constraint (place, filters, dates) and the result you need in one call. Each
call starts a fresh browser process (cookies persist), so splitting a task into probes ("does the site load?" … "now filter") repeats
the same walls and work. The browse agent checks its answer's scope and scale before reporting (a count for one store must come from
results filtered to that store) and says plainly when it could not confirm the scope.

**Time.** A request can carry its own deadline: `cortex agent` sends its `--timeout` (minus 2 minutes) as `turn_deadline_ms`, so the
turn sees its budget, sub-agent limits shrink to what remains, and the answer is written before the client gives up.

The browse sub-agent has 10 minutes per call (`CORTEX_BROWSE_TIMEOUT_MS`, or `timeout_ms` on the call; a turn deadline still caps it). If
it is stopped before its answer is accepted, the result still carries its last answer draft and any text in progress, marked unverified.
It runs with the minimal system prompt (`CORTEX_PROMPT_MASS=minimal`), pins 17 browser tools (the rest stay discoverable through
SearchTools), and drops old screenshots from its history, so a multi-page task costs well under a dollar on Claude Sonnet.

## Web tools with the local browser

`WebSearch` and `WebFetch` need no outside provider when the local browser is installed (measured: `.cortex/bench/
r-web-tools-local-browser-2026-11-03.md`):

- **WebFetch**: keyed providers first as before; on the fallback path plain HTTP first (fast), then the local browser when that fails or
  returns a thin or bot-walled page — a rendered page (JavaScript, walls). On 8 test pages: plain HTTP 1/8, local browser 5/8.
- **WebSearch** deliberately does **not** use the browser: search engines wall or mis-localize a headless browser, and the plain
  DuckDuckGo results page found the canonical source on 7/8 queries at 0.55 s (DeepSeek 6/8, Gemini 5/8, browser-on-Bing 2/8).
- `WEB_TOOLS_MODEL=local-browser` uses no provider at all: DuckDuckGo search + local-browser fetch.
- With `ENABLE_WEBTOOLS=auto` (the default), **Browse and the nexus-browser tools are on** whenever the local browser is installed and
  chosen, keys or not. Keyless `WebSearch` stays off (DuckDuckGo walls bursts of queries).

## Bot walls and proxies

A fetch that hits a wall climbs a ladder: the default (headless) browser → the sandbox's real Chrome (headful, stealthier; passed a
PerimeterX "press and hold" wall in testing) → **your own proxy**, if set → otherwise it fails cleanly (a wall is never returned as page
content). Walls that block the **IP** (Reddit's "blocked by network security", Google's "unusual traffic") need a residential IP: a home
machine has one; a VM or cloud host needs a proxy.

```bash
NEXUS_BROWSER_PROXY_URL=http://user:«secret:PROXY_PASS»@proxy.example.com:8000
cortex secrets set PROXY_PASS
cortex secrets bind PROXY_PASS PROXY_PASS --tool nexus-browser   # opt the secret in for the browser (see docs/secrets.md)
```

The proxy is used only for the site that was walled, and the session is closed afterwards. The browser tools' own `browse` escalates the
same way when a page is walled: your proxy first (`«secret:NAME»` references are resolved from the vault; an unavailable secret leaves the
step out), then the sandbox's real Chrome; the result's `_wall.tried` lists what was tried and, with no proxy set, how to add one.

Several sessions can use the local browser at once: each process gets its own virtual display, ports and Chrome profile. Agents can also set proxy rules themselves
(`set_proxy`), referring to opted-in secrets as `«secret:NAME»` so they never see the password. `NEXUS_BROWSER_PROXY=deny` turns external
proxies off.

## Sub-agents never chain

A sub-agent does not start another sub-agent (`CORTEX_MAX_AGENT_DEPTH`, default 1): it is not offered Task / Browse / WebSearch and any
spawn request it makes is refused. A sub-agent that needs a browser drives the nexus-browser MCP itself (an agent profile declares
`mcp: nexus-browser`, like the shipped `web-researcher`). The browse sub-agent never spawns, at any depth.

## Keys the local browser uses

Captcha decisions and vision helpers use `TYPESAFE_API_KEY` (Jev), `INCEPTION_API_KEY` (Mercury) and `GOOGLE_API_KEY` / `GEMINI_API_KEY`
(Gemma) — from the environment or the secrets vault. Nothing else from the vault is passed to it (`docs/secrets.md`).
