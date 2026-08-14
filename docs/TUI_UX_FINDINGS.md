# TUI UX Findings — Empirical Polish Backlog

**Method:** Real observed behavior on the hosted harness container (nexus-cortex MCP,
session `cortex-admin-claudecode`), driven via tmux capture-pane / send-keys and piped
invocations. No code review — every finding below has a captured frame as evidence.

**Harness version:** `cortex 4.60.3` · tmux 3.6b · bins: `fuzzycortex`, `neoncortex`,
`fuzzycortex-cli`, `cortex-cli` (all at `/usr/local/bin`).

**Startup latency to first frame (observed):**

| TUI | First frame | Notes |
|---|---|---|
| neoncortex | < 3s | landing frame fully rendered at t+3s |
| fuzzycortex | ~5–7s | **completely blank screen** at t+3s, no spinner |
| cortex-cli | < 6s | renders fine in a real tty |

---

## P0 — Broken

### P0-1 · fuzzycortex · Unrecoverable "Thinking" spinner after a stream error; ESC does not abort
With no API key, sending a message shows the error but the busy state never clears —
and a *second*, frozen spinner line is left behind. The header advertises "ESC: abort",
but ESC does nothing; only Ctrl+C (full exit) escapes.

```
> hello
✗ Stream error: API key not found in environment variable: DEEPSEEK_API_KEY
⠸ Thinking 0.0s          ← frozen duplicate spinner
──────────────────────────
⠹ Thinking 42s           ← still counting at 42s, AFTER pressing ESC
```
**Fix:** on stream error, transition the turn state machine to idle (clear all spinner
rows) and make ESC unconditionally cancel the active turn.

### P0-2 · fuzzycortex · Slash-command system is essentially dead: palette has 1 command, /help renders nothing, /exit doesn't exit
Typing `/` opens a palette containing **only** `help` ("Commands (1)") — vs
**97 commands** in neoncortex's palette. Executing `/help` produces no output at all,
leaves the typed text in the input, and strands an orphaned box border on screen.
`/exit` + Enter does not exit (session stayed alive; killed via Ctrl+C).

```
│ Commands (1)                                           │
│ ❯ ⚡ help         - Show help information              │
...after Enter:
╭──────────────────────────────────────────────────────────╮   ← orphaned border, no help ever renders
 > /help                                                        ← input not cleared
```
**Fix:** wire fuzzycortex to the same command registry neoncortex loads (97 cmds);
clear input on submit; render command output into the transcript.

### P0-3 · cortex-cli · No argument parsing at all — `--help` (and any flag) boots the TUI; piped stdin crash-dumps a React stack trace and exits 0
`cortex-cli --help` and `cortex-cli --badflag` both ignore the flag and start the app.
When stdin is not a tty it spews the Ink raw-mode error plus reconciler frames, after a
React "two children with the same key" warning — then exits 0.

```
 ● Initializing...
Encountered two children with the same key, `    at recursivelyTraversePassiveMountEffects (...react-reconciler.development.js:12934:11)`.
  ERROR Raw mode is not supported on the current process.stdin, which Ink uses ...
 - (file:///usr/local/lib/node_modules/@nexus-cortex/tui/node_modules/ink/build/components/App.js:117:23)
```
**Fix:** add a minimal arg parser (`--help`/`--version`/reject unknown flags, exit
non-zero) and gate startup on `isRawModeSupported` with a one-line human error.

---

## P1 — Embarrassing

### P1-1 · fuzzycortex · Raw chain-of-thought rendered inline, glued to the answer with zero separation
Default view dumps the model's thinking as plain transcript text, run together with the
real reply mid-line — a fresh user cannot tell reasoning from answer:

```
> hello
The user just said "hello". This is a simple greeting. I should respond in a friendly, helpful way.
No tools needed. Keep it brief and ask what they'd like help with. Hello! 👋 How can I help you toda
y?
```
**Fix:** style/collapse thinking behind the existing Tab toggle (dim + labeled block),
never concatenated into the answer paragraph.

### P1-2 · fuzzycortex · `--help` output polluted by a full session boot: ANSI screen-wipe + "[OK] Session ended"
`fuzzycortex --help` and `fuzzycortex ui --help` print correct help, then emit
`\e[2J\e[H` (wiping the user's terminal) and `[OK] Session ended` — the help path spins
up and tears down a real session. `fuzzycortex-cli --help` is clean, proving it's fixable.
**Fix:** short-circuit `--help`/`-V` before session/UI bootstrap.

### P1-3 · fuzzycortex · `ui models` (and the ui suite) dies with unactionable "fetch failed", exit 0
The `ui` subcommands need cortex-server on :4000, but chat works serverless — and the
failure doesn't say any of that:

```
 ✗ Error loading models: fetch failed
 Press any key to exit        (exit code: 0)
```
**Fix:** error should name the server URL and remedy ("cortex-server not reachable at
http://localhost:4000 — start it with `cortex-server`"), and exit non-zero.

### P1-4 · fuzzycortex · 5–7s of fully blank screen before the first frame
At t+3s a 120x35 pane is 100% empty — a fresh user assumes a hang. neoncortex paints in
under 3s. **Fix:** print an immediate one-line banner/spinner before heavy init.

### P1-5 · cortex-cli · Ships React development build; duplicate-key warning fires at startup
`react-reconciler.development.js` is in the installed production tree, and the
"Encountered two children with the same key" warning is a real keying bug in the
startup render (it also names the dev-build frame as the key!).
**Fix:** bundle production React; fix the list key in the boot screen component.

---

## P2 — Polish

### P2-1 · fuzzycortex + neoncortex · Stray unstyled model-name line below the footer, which duplicates over time
Both TUIs render a bare `deepseek-v4-pro` line under the hints footer; in fuzzycortex it
**accumulates** (two copies after a couple of interactions):

```
 / commands • ←→↑↓ nav • ⌥←→ word • ⌥↑↓ 5 lines • ⌥⌫ del word
deepseek-v4-pro
deepseek-v4-pro
```
**Fix:** looks like a status line rendered outside the Ink root / missing key — dedupe
and style it, or drop it (model is already in the header).

### P2-2 · fuzzycortex · Mac-only ⌥ glyphs in the footer hints on Linux
`⌥←→ word • ⌥↑↓ 5 lines • ⌥⌫ del word` — meaningless to Linux users (Alt).
**Fix:** platform-conditional hint strings (`Alt+←/→`).

### P2-3 · all four bins · Usage/self-identification says "cortex", never the actual bin name
`fuzzycortex --help` → `Usage: cortex [options]`; same for neoncortex, fuzzycortex-cli,
cortex-cli's header. Confusing when four differently-named bins all claim to be `cortex`.
**Fix:** use `argv[0]`/basename in the usage string and header.

### P2-4 · fuzzycortex · Slash palette box borders misaligned + hard mid-word wrapping in responses
Palette right border is ragged (inner rows shorter than the frame); response text wraps
mid-word (`toda\ny?`, `about\na\n project`). **Fix:** width-aware truncation/padding in
the palette rows; word-boundary wrapping in the transcript renderer.

### P2-5 · both TUIs · No exit hint anywhere on screen
Neither landing frame mentions how to quit (fuzzycortex's `/exit` is broken per P0-2;
Ctrl+C works but is only documented inside neoncortex's `--help`/`/help`).
**Fix:** add `Ctrl+C exit` to the footer hints.

### P2-6 · neoncortex · Enter bundled with fast (paste-like) input does not submit
Text sent rapidly followed immediately by Enter sat in the input for 12s; a second Enter
submitted it. Likely Ink bracketed-paste/batching. Low confidence (could be a tmux
send-keys artifact) — reproduce with a real paste. **Fix (if real):** treat trailing
newline in a paste as submit, or show a "press Enter to send" affordance.

### P2-7 · neoncortex · Header/status bar scrolls away after the first response
The `CORTEX · model · cwd` header and shortcut bar are transcript content, not a fixed
chrome — after one exchange the top of the pane is bare transcript. **Fix:** keep
header + hints as sticky chrome (Ink `<Static>` split).

### P2-8 · neoncortex · No-key error is clean but dead-ends
`✗ Error: Stream error: API key not found in environment variable: DEEPSEEK_API_KEY` —
correctly one line, not a stack trace (good) — but offers no next step.
**Fix:** append "set DEEPSEEK_API_KEY or switch models with /model".

---

## What's already good (keep)

- **neoncortex** is the clear quality bar: <3s first frame, 97-command palette with
  grouped, scrollable `/help` overlay ("Press ESC to close"), clean `❯` / `◆`
  transcript glyphs, per-turn latency display, actionable one-line key errors.
- **neoncortex `--help`** is accurate and documents keyboard shortcuts — the model for
  the other three.
- **fuzzycortex-cli `--help`** exits cleanly with correct flags (no session pollution).

---

## Do these first

1. **P0-1** — fuzzycortex: clear busy state on stream error + make ESC actually abort.
2. **P0-2** — fuzzycortex: load the full (97-command) registry; make `/help` and `/exit` work.
3. **P0-3** — cortex-cli: real arg parsing (`--help`) + raw-mode guard instead of a stack dump.
4. **P1-1** — fuzzycortex: separate/collapse chain-of-thought from the answer.
5. **P1-2** — fuzzycortex: stop booting (and screen-wiping via) a session on `--help`.
