# TUI UX Backlog — fuzzycortex & neoncortex (2026-08-16, v4.63.6)

Second empirical pass; supersedes-and-extends `TUI_UX_FINDINGS.md` (4.60.3 — its P0
blank-startup and discovery findings recur below with root-cause attribution). Method:
static read of `packages/tui` + 17 live tmux drives in the hosted container at
100x30 / 60x20 / 40x14. Findings only — nothing fixed in this pass.

**Headline:** the two TUIs are not two skins over one core — they are TWO independent
input/render stacks (`src/ui/RawInput.ts`, 851 lines, hand-rolled ANSI, fuzzycortex vs
`src/ink-ui/CortexApp.tsx`, 3262 lines, Ink, neoncortex). Every HIGH below is a place
where fuzzycortex re-implements something neoncortex already does correctly, and gets
it wrong. neoncortex's streaming/loading UX is the bar.

## A. Confirmed live (captured frames)

### HIGH
- **L-01 fuzzycortex — /help is a trapdoor: closing it kills the session.** ESC/Enter
  (the keys the overlay advertises) exit the process ("[OK] Session ended"). Root:
  `ui/InkHelp.tsx:127` mounts a SECOND Ink render() root over the readline app;
  unmount tears down stdin raw mode + parent rl. Call site `commands/chat/interactive.ts:597`.
  Fix: thin wrapper — render help in the existing frame, never a second Ink root.
- **L-02 fuzzycortex — resize below ~72 cols destroys the UI permanently.** Frame
  collapses to orphan rules; stale fragments persist after re-widening. Root:
  `ui/RawInput.ts:248` `Math.min(70, termWidth)` per-draw but NO resize listener
  anywhere in the chalk stack (only `ink-ui/hooks/useTerminalSize.ts:25` exists,
  neoncortex-only). Fix: thin wrapper — shared resize subscription + clean repaint.
- **L-03 fuzzycortex — arrow keys type literal `[B` into the input** (and close the
  palette). Root: `ui/RawInput.ts` whole-chunk escape matching (`str === '\x1b[B'`,
  :718) with no escape buffer/ESC timeout; split reads hit the ESC branch (:501) then
  the printable branch (~:795). neoncortex handles the same sequence correctly.
  Fix: thin wrapper — real key decoder (or retire RawInput, S-04).

### MEDIUM
- **L-04 neoncortex — resize duplicates the header** (Static region re-flush,
  `ink-ui/CortexApp.tsx:2978`) + orphan fragments at 40 cols.
- **L-05 both — zero onboarding.** First paint = bare prompt; no statement of what the
  tool is, no example, no hint that @file/!shell/97 slash commands exist. Splash exists
  but only via `/about` (`interactive.ts:685-687`). Fix: core-owned first-run block,
  rendered by each wrapper.
- **L-06 both — /help is an unpaginated dump** that overflows off-screen top; "Press
  ESC to close" is the only affordance. Fix: paged/scrollable help over the core
  command model.
- **L-07 fuzzycortex — raw tty echo while help overlay open** (same root as L-01).
- **L-08 both — keybinding hints contradict each other and the help text.** Hardcoded
  in FOUR places with different contracts (`ui/RawInput.ts:250`,
  `ink-ui/CortexApp.tsx:1077`, `ui/SplashScreen.ts:193,279`, `cortex.tsx:50`); help
  advertises Shift+Enter multiline vs footer Ctrl+J; `⌥` mac-only glyphs presented as
  universal. Fix: CORE keymap-as-data; TUIs render hints/help from it (canonical-in-
  the-library violation, cheapest structural win).
- **L-09 fuzzycortex — frame hardcoded 70 cols** (30% of a wide terminal wasted);
  sibling pickers pick 76/75 (`ChalkModelPicker.ts:61`, `ChalkThemePicker.ts:238`).
  Fix: shared layout width token in core.
- **L-10 both — core log leaks into the transcript** as the user's first content:
  `[INIT] Created new artifact registry...` from `packages/executors/src/utils/
  ArtifactRegistry.ts:134` raw console.error. Fix: core — no direct stdio; emit to a
  logger the TUI routes.
- **L-11 both — 2-3s blank screen at startup** (neoncortex ~2.0s, fuzzycortex ~3.0s;
  fuzzycortex spawns a SECOND node process, `bin/launcher.js:411`). Fix: paint chrome
  <150ms then fill; the double-spawn is a launcher-architecture item.
- **L-12 neoncortex — `/` palette dumps 97 flattened commands**, 8 visible, no
  position/count/grouping/filter affordance; hint line printed twice. Categories exist
  in `slashCommandRegistry.getCategories()`. Fix: grouped + filter-as-you-type wrapper.

### LOW
- **L-13 both — status bar carries only the model name** (already in the header). Good
  home for context %, token count, cost, session id (core session-stats model).
- **L-14 neoncortex — ESC closes the palette but leaves the orphan `/`** in the input.
- **L-15 neoncortex — reasoning tokens flash as the answer** before reclassification
  (buffer until channel known).

## B. Static-only findings
- **S-01 HIGH fuzzycortex — pickers freeze at launch width** (`ChalkModelPicker.ts:289`,
  `ChalkThemePicker.ts:321` read columns once). Same class as L-02.
- **S-02 MED fuzzycortex — /clear is advertised but not implemented**
  (`interactive.ts:602-606` tells the user to restart the CLI). Core session-truncation
  + wrapper.
- **S-03 MED both — onboarding asset exists but unreachable at first run** (splash only
  via /about).
- **S-04 HIGH architecture — two full input stacks is the meta-cause.** RawInput.ts
  (851 lines) vs SimpleInputBuffer+KeypressContext (623 lines); plus duplicated dialog
  pairs (`src/ui/components/*` vs `src/ui/Chalk*.ts`). The PLAN: do the surgical fixes
  below, then retire RawInput in favor of the Ink stack rather than maintaining both.
- **S-05 LOW fuzzycortex — developer-facing exit chrome** ("[OK] Session ended",
  "Server not built. Run: cd packages/server && npm run build" to npm end users;
  `bin/launcher.js:429,:202,:381`).

## Do these first (ranked)
1. **L-01** — the discovery path must not be a trapdoor (small, contained InkHelp fix).
2. **L-02 + S-01** — resize is constant in tmux panes; the chalk stack has NO SIGWINCH
   handling and fails permanently.
3. **L-03** — keys typing garbage after the UI promised navigation; neoncortex proves
   the correct decoder exists.
4. **L-08 (+L-10)** — one core-owned keymap table + core stops logging into the frame;
   the structural canonical-in-the-library fix.
5. **L-05 + L-11** — the first 3 seconds: paint chrome immediately + one-time
   orientation block.

Deferred deliberately: S-04 (collapse the two stacks) is the real fix behind 1-3 —
converge on it after the surgical fixes, don't maintain both stacks.
