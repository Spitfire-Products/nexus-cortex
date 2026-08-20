/**
 * TUI keymap-as-data (L-08, TUI_UX_BACKLOG_2026-08-16).
 *
 * THE canonical source for keybinding hints/help across every TUI surface.
 * Before this table, hints were hardcoded in four places with contradictory
 * contracts — the ink help screen advertised Shift+Enter where the handler
 * implements Ctrl+J, and the chalk splash advertised "Ctrl+J new line" on a
 * stack whose RawInput treats '\n' (what Ctrl+J sends in raw mode) as SUBMIT.
 *
 * RULES:
 *  - Entries document what the HANDLERS actually do, per surface. Changing a
 *    handler means changing its entry in the same commit (and vice versa).
 *  - TUIs render hints/help FROM this table — never hardcode key strings.
 *  - This file changes bindings' WORDS only; it never changes behavior.
 *
 * Surfaces:
 *  - 'ink-app'  : the full Ink application (neoncortex — ink-ui/CortexApp.tsx)
 *  - 'ink-chat' : the lightweight Ink chat UI (cortex.tsx → ChatInput/MultiLineInput)
 *  - 'chalk'    : the chalk/raw-tty stack (fuzzycortex — ui/RawInput.ts)
 */

export type TuiSurface = 'ink-app' | 'ink-chat' | 'chalk';

export interface KeyBinding {
  /** Stable action id. */
  action: string;
  /** Human key label, universal notation (no mac-only glyphs). */
  key: string;
  /** Short hint text (footer style). */
  hint: string;
  /** Caveat surfaced in full help, when honesty needs a footnote. */
  caveat?: string;
}

const COMMON: KeyBinding[] = [
  { action: 'commands', key: '/', hint: '/ commands' },
  { action: 'history', key: '↑↓', hint: '↑↓ history' },
  { action: 'cursor', key: '←→', hint: '←→ cursor' },
];

export const TUI_KEYMAP: Record<TuiSurface, KeyBinding[]> = {
  'ink-app': [
    ...COMMON,
    { action: 'newline', key: 'Ctrl+J', hint: 'Ctrl+J new line' },
    { action: 'submit', key: 'Enter', hint: 'Enter send' },
  ],
  'ink-chat': [
    ...COMMON,
    {
      action: 'newline', key: 'Shift+Enter', hint: 'Shift+Enter new line',
      caveat: 'requires a terminal that distinguishes Shift+Enter (e.g. kitty keyboard protocol); plain terminals send Enter',
    },
    { action: 'submit', key: 'Enter', hint: 'Enter send' },
  ],
  // The chalk RawInput stack has NO newline-insert: '\n' (Ctrl+J) submits,
  // same as Enter. Do not advertise multiline here until a handler exists.
  'chalk': [
    ...COMMON,
    { action: 'submit', key: 'Enter', hint: 'Enter send' },
  ],
};

/** Footer-style one-line hint: "/ commands • ↑↓ history • ..." */
export function keymapFooterHint(surface: TuiSurface): string {
  return TUI_KEYMAP[surface].map((b) => b.hint).join(' • ');
}

/** Help-screen rows: [key label, description(+caveat)]. */
export function keymapHelpRows(surface: TuiSurface): Array<[string, string]> {
  return TUI_KEYMAP[surface].map((b) => [
    b.key,
    b.action === 'newline'
      ? `Multi-line input (new line)${b.caveat ? ` — ${b.caveat}` : ''}`
      : b.action === 'submit' ? 'Send message'
      : b.action === 'commands' ? 'Slash commands'
      : b.action === 'history' ? 'Input history'
      : 'Move cursor',
  ]);
}

/** Lookup one binding's key label (e.g. for inline placeholders). */
export function keymapKey(surface: TuiSurface, action: string): string | undefined {
  return TUI_KEYMAP[surface].find((b) => b.action === action)?.key;
}
