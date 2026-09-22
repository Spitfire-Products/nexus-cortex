/** R179 HB-TERMINUS-FRAME — config resolver + the frame contract (design: docs/R179_TERMINUS_FRAME_PORT_DESIGN.md). Pure. */
export const FRAME_TOOL_NAME = 'FrameAction';
export type FrameMode = 'tools' | 'terminus';
export type ChooserMode = 'off' | 'jev';
export interface FrameConfig { frame: FrameMode; chooser: ChooserMode; candidates: number; waitCapS: number; screenLines: number; keyGuard: boolean }
export const FRAME_CONFIG_DEFAULTS: FrameConfig = { frame: 'tools', chooser: 'off', candidates: 1, waitCapS: 60, screenLines: 45, keyGuard: true };

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
  };
}

/** Appended to the system prompt on turn 0 (the static prefix is pinned per conversation — never changes after). */
const FRAME_CONTRACT_BASE = `TERMINAL FRAME. You work in ONE interactive terminal (a tmux pane). Your only action is the FrameAction tool: give your analysis of the current screen, your plan, and one to three candidate actions, each with the exact keystrokes to type (end a command with \\n to run it; tmux key names such as C-c are allowed) and how many seconds to wait before looking again (default 3; use larger waits only for commands you know run long; a command still running is handed back to you marked STILL RUNNING, and the WAIT / INTERRUPT / SHOW MORE OUTPUT / RUN THE TASK'S TEST / RE-READ THE TASK / FINISH templates are always available by naming one in a candidate label). The harness executes ONE candidate (your first unless a harness gate chooses otherwise), waits, and returns the screen, a STATE line (turn, commands run, last exit code, budget) and the templates it can run for you. THE PANE IS SMALL: you see only the LAST 45 lines after each action, and SHOW MORE OUTPUT reveals at most 180. Anything longer is lost and costs you turns. So make every command narrow and specific on purpose: grep -n with a tight pattern and -m/--max-count, head -n 20 / tail -n 20 / sed -n 'a,bp' on the exact range you need, wc -l before printing, ls of one directory, one file at a time. Prefer several small, precise commands over one broad one. When output must be long (a build, a test run, an install), redirect it (cmd > /tmp/out.txt 2>&1), then query the file with grep/tail — never re-run it to see what scrolled off. Read the screen before every action; do not repeat a command that already ran with nothing changed; when a command is still running you can wait or interrupt it. NEVER send C-d or exit to the shell: that kills the pane (a keystroke guard refuses pane-killing and destructive commands and tells you why). If the pane stops answering, the harness offers RESET THE PANE (a fresh shell in the task directory) — name it. When the task is complete, call EndTurn with your attestation as usual.`;

/** The turn-0 contract; `CORTEX_FRAME_CONTRACT_EXTRA` (env) appends cell-specific guidance without a release. */
export const FRAME_CONTRACT = FRAME_CONTRACT_BASE + ((process.env.CORTEX_FRAME_CONTRACT_EXTRA || '').trim() ? `\n\n${process.env.CORTEX_FRAME_CONTRACT_EXTRA!.trim()}` : '');
