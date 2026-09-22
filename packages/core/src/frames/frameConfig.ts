/** R179 HB-TERMINUS-FRAME — config resolver + the frame contract (design: docs/R179_TERMINUS_FRAME_PORT_DESIGN.md). Pure. */
export const FRAME_TOOL_NAME = 'FrameAction';
export type FrameMode = 'tools' | 'terminus';
export type ChooserMode = 'off' | 'jev';
export interface FrameConfig { frame: FrameMode; chooser: ChooserMode; candidates: number; waitCapS: number; screenLines: number; keyGuard: boolean; /** R184: distinct writer candidates the menu step needs before it runs (1 = off; auto 2 when the chooser is on) */ minCandidates: number; /** R185: who fills the menu when the writer offers fewer than the cap — 'helper' (the helper model, thinking off) or 'off' */ author: 'off' | 'helper' }
export const FRAME_CONFIG_DEFAULTS: FrameConfig = { frame: 'tools', chooser: 'off', candidates: 1, waitCapS: 60, screenLines: 45, keyGuard: true, minCandidates: 1, author: 'off' };

/** R184 (E2 field: the writer gave ONE candidate on 89% of 3371 turns — the chooser had nothing to choose): `CORTEX_FRAME_MIN_CANDIDATES` 1..3;
 *  unset → 2 when the chooser is on and the cap allows it, else 1. Never above the candidate cap. */
/** R185: `CORTEX_FRAME_AUTHOR=off|helper`; unset → helper when the chooser is on (a chooser without a menu measures nothing — E2 field). */
function resolveAuthor(raw: string | undefined, chooser: ChooserMode): 'off' | 'helper' {
  const v = (raw || '').trim().toLowerCase();
  if (v === 'helper') return 'helper';
  if (v === 'off' || v === 'false' || v === '0' || v === 'no') return 'off';
  return chooser === 'jev' ? 'helper' : 'off';
}

function resolveMinCandidates(raw: string | undefined, chooser: ChooserMode, cap: number): number {
  const m = Number(raw);
  if (Number.isInteger(m) && m >= 1) return Math.min(m, cap);
  return chooser === 'jev' && cap >= 2 ? 2 : 1;
}

/** `CORTEX_FRAME=tools|terminus`, `CORTEX_FRAME_CHOOSER=off|jev`, `CORTEX_FRAME_CANDIDATES` 1..3, `CORTEX_FRAME_WAIT_CAP_S` 5..600 (the cap on ONE action's requested wait; default 60), `CORTEX_FRAME_KEY_GUARD=on|off` (R182 keystroke guard; default on). */
export function resolveFrameConfig(env: NodeJS.ProcessEnv = process.env): FrameConfig {
  const frame = (env.CORTEX_FRAME || '').trim().toLowerCase() === 'terminus' ? 'terminus' : 'tools';
  const chooser = (env.CORTEX_FRAME_CHOOSER || '').trim().toLowerCase() === 'jev' ? 'jev' : 'off';
  const c = Number(env.CORTEX_FRAME_CANDIDATES); const w = Number(env.CORTEX_FRAME_WAIT_CAP_S); const l = Number(env.CORTEX_FRAME_SCREEN_LINES);
  return {
    frame, chooser,
    candidates: Number.isInteger(c) && c >= 1 ? Math.min(3, c) : FRAME_CONFIG_DEFAULTS.candidates,
    waitCapS: Number.isFinite(w) && w >= 5 ? Math.min(600, w) : FRAME_CONFIG_DEFAULTS.waitCapS,
    screenLines: Number.isInteger(l) && l >= 10 ? Math.min(400, l) : FRAME_CONFIG_DEFAULTS.screenLines,
    keyGuard: !/^(off|false|0|no)$/i.test((env.CORTEX_FRAME_KEY_GUARD || '').trim()),
    minCandidates: resolveMinCandidates(env.CORTEX_FRAME_MIN_CANDIDATES, chooser, Number.isInteger(c) && c >= 1 ? Math.min(3, c) : FRAME_CONFIG_DEFAULTS.candidates),
    author: resolveAuthor(env.CORTEX_FRAME_AUTHOR, chooser),
  };
}

/** Appended to the system prompt on turn 0 (the static prefix is pinned per conversation — never changes after). */
const FRAME_CONTRACT_BASE = `TERMINAL FRAME. You work in ONE interactive terminal (a tmux pane). Your only action is the FrameAction tool: give your analysis of the current screen, your plan, and one to three candidate actions, each with the exact keystrokes to type (end a command with \\n to run it; tmux key names such as C-c are allowed) and how many seconds to wait before looking again (default 3; use larger waits only for commands you know run long; a command still running is handed back to you marked STILL RUNNING, and the WAIT / INTERRUPT / SHOW MORE OUTPUT / RUN THE TASK'S TEST / RE-READ THE TASK / FINISH templates are always available by naming one in a candidate label). The harness executes ONE candidate (your first unless a harness gate chooses otherwise), waits, and returns the screen, a STATE line (turn, commands run, last exit code, budget) and the templates it can run for you. THE PANE IS SMALL: you see only the LAST 45 lines after each action, and SHOW MORE OUTPUT reveals at most 180. Anything longer is lost and costs you turns. So make every command narrow and specific on purpose: grep -n with a tight pattern and -m/--max-count, head -n 20 / tail -n 20 / sed -n 'a,bp' on the exact range you need, wc -l before printing, ls of one directory, one file at a time. Prefer several small, precise commands over one broad one. When output must be long (a build, a test run, an install), redirect it (cmd > /tmp/out.txt 2>&1), then query the file with grep/tail — never re-run it to see what scrolled off. Read the screen before every action; do not repeat a command that already ran with nothing changed; when a command is still running you can wait or interrupt it. NEVER send C-d or exit to the shell: that kills the pane (a keystroke guard refuses pane-killing and system-destructive commands outright; a destructive step the task genuinely requires — cleaning an output tree, formatting a disk image, resetting a repository — runs only when your candidate's "why" cites the task requirement). If the pane stops answering, the harness offers RESET THE PANE (a fresh shell in the task directory) — name it. When the task is complete, call EndTurn with your attestation as usual.`;

/** The turn-0 contract; `CORTEX_FRAME_CONTRACT_EXTRA` (env) appends cell-specific guidance without a release. */
const FRAME_CONTRACT_MENU = (cfg: FrameConfig): string => cfg.author === 'helper'
  ? `\n\nTHE MENU (chooser on): give your best next action first; when you see more than one good route, give 2–3 genuinely different candidates. A second author adds alternatives to your list and a harness gate reads the screen and picks one — the executed action may not be your first; the STATE line and the screen always show what ran.`
  : cfg.minCandidates >= 2
  ? `\n\nTHE MENU (chooser on): every turn give ${cfg.minCandidates === cfg.candidates ? cfg.candidates : `${cfg.minCandidates} to ${cfg.candidates}`} GENUINELY DIFFERENT candidate actions, best first — a different command, a different approach, or a different diagnostic, never variants of one command. A harness gate reads the screen and picks one; a single candidate is sent back to you unexecuted with a request for alternatives, which costs a turn.`
  : '';
export const FRAME_CONTRACT = FRAME_CONTRACT_BASE + FRAME_CONTRACT_MENU(resolveFrameConfig(process.env)) + ((process.env.CORTEX_FRAME_CONTRACT_EXTRA || '').trim() ? `\n\n${process.env.CORTEX_FRAME_CONTRACT_EXTRA!.trim()}` : '');
