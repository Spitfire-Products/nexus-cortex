/**
 * R179 HB-TERMINUS-FRAME — the runner: drives ONE tmux pane through the existing TmuxSession executor (programmatically, via the
 * executor registry — never through a model tool call), applies the menu step (frames/chooser.ts), and returns the observation
 * (screen + state card + templates) as the FrameAction tool_result. Holds the frame's durable state for the session (history, running
 * command, tmux session id). Everything decision-shaped is in the pure modules; this file is plumbing + waiting.
 */
import { buildStateCard, buildMenu, buildFrameSuffix, clipScreen, parsePromptRc, promptIsBack, waitPolicy, extractTaskTestCommand, parseFrameAction, stripAnsi, normalizeKeys, FRAME_DEFAULTS, type HistoryEntry } from './terminusFrame.js';
import { buildChooserState, buildChooserQuestions, decideChooser, buildChooserRow, type ChooserDecision } from './chooser.js';
import type { FrameConfig } from './frameConfig.js';

export interface FrameDeps {
  execute: (name: string, input: Record<string, unknown>, signal?: AbortSignal) => Promise<unknown>;
  recordEvent: (kind: string, detail: Record<string, unknown>) => void;
  jev?: (state: Record<string, unknown>, questions: Record<string, { type: 'noul'; instructions: string }>) => Promise<Record<string, number> | null>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}
export interface FrameStepInput { action: unknown; task: string; elapsedMs: number; deadlineMs: number; cwd: string; sessionId: string; signal?: AbortSignal; predictorModel: string }
export interface FrameStepResult { content: string; isError: boolean; meta: Record<string, unknown> }

const RAW_KEY_RE = /^(C-[a-z\[\]\\^_]|M-[a-z]|Enter|Escape|Tab|Up|Down|Left|Right|Space|BSpace|DC|Home|End|PPage|NPage|F\d{1,2})$/;

function resultText(r: unknown): string {
  if (!r || typeof r !== 'object') return String(r ?? '');
  const o = r as Record<string, unknown>;
  const c = o.llmContent ?? o.content ?? o.output ?? '';
  return typeof c === 'string' ? c : JSON.stringify(c);
}
/** The capture handler wraps the pane between two `=====` rules. */
function unwrapCapture(text: string): string {
  const parts = text.split(/\n={20,}\n?/);
  return parts.length >= 3 ? parts[1]! : text;
}

export class FrameRunner {
  private tmuxSession: string | null = null;
  private history: HistoryEntry[] = [];
  private turn = 0;
  private running = false;
  private lastScreen = '';
  private lastClipped = false;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  constructor(private readonly cfg: FrameConfig, private readonly deps: FrameDeps) {
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.now = deps.now ?? (() => Date.now());
  }

  private async ensureSession(cwd: string, sessionId: string, signal?: AbortSignal): Promise<void> {
    if (this.tmuxSession) return;
    const id = `frame-${sessionId.replace(/[^a-zA-Z0-9-]/g, '').slice(0, 12) || 'x'}-${this.now().toString(36).slice(-4)}`;
    await this.deps.execute('TmuxSession', { action: 'create', sessionId: id, cwd }, signal);
    this.tmuxSession = id;
    // exit-code hook: every prompt is preceded by __RC=<n>; then a clean screen
    await this.deps.execute('TmuxSession', { action: 'send', sessionId: id, command: "export PROMPT_COMMAND='echo __RC=$?'; export PS1='\\u@\\h:\\w\\$ '; clear" }, signal);
    await this.sleep(800);
  }

  private async capture(lines: number, signal?: AbortSignal): Promise<string> {
    const r = await this.deps.execute('TmuxSession', { action: 'capture', sessionId: this.tmuxSession!, lines }, signal);
    return stripAnsi(unwrapCapture(resultText(r)));
  }

  private async sendKeys(keystrokes: string, signal?: AbortSignal): Promise<void> {
    const k = keystrokes;
    if (!k) return;
    if (RAW_KEY_RE.test(k.trim())) { await this.deps.execute('TmuxSession', { action: 'send', sessionId: this.tmuxSession!, command: k.trim(), raw: true }, signal); return; }
    const enter = /\n$/.test(k);
    await this.deps.execute('TmuxSession', { action: 'send', sessionId: this.tmuxSession!, command: enter ? k.replace(/\n+$/, '') : k, enter }, signal);
  }

  /** Wait the candidate's duration, then extend while the screen still changes (bounded by the cap). Returns the screen. */
  private async waitAndObserve(durationS: number, signal?: AbortSignal): Promise<{ screen: string; running: boolean; waitedS: number }> {
    const cap = this.cfg.waitCapS; const t0 = this.now();
    let waited = 0; const first = Math.min(Math.max(0, durationS), cap);
    while (waited < first) { const step = Math.min(2000, (first - waited) * 1000); await this.sleep(step); waited = (this.now() - t0) / 1000; if (signal?.aborted) break; }
    let screen = await this.capture(this.cfg.screenLines, signal);
    let prev = screen;
    for (;;) {
      const back = promptIsBack(screen);
      const d = waitPolicy({ promptBack: back, screenChanged: screen !== prev || waited < 1, waitedS: waited, capS: cap });
      if (d === 'done') return { screen, running: false, waitedS: waited };
      if (d === 'cap' || signal?.aborted) return { screen, running: true, waitedS: waited };
      await this.sleep(Math.min(5000, Math.max(1000, (cap - waited) * 1000)));
      waited = (this.now() - t0) / 1000; prev = screen; screen = await this.capture(this.cfg.screenLines, signal);
    }
  }

  async step(input: FrameStepInput): Promise<FrameStepResult> {
    const t0 = this.now();
    const action = parseFrameAction(typeof input.action === 'string' ? input.action : JSON.stringify(input.action ?? {}), { maxCandidates: this.cfg.candidates });
    if (!action.parsed) {
      return { content: `FrameAction not understood (${action.error}). Send {analysis, plan, candidates:[{label, keystrokes, duration_s}]} — keystrokes end with \\n to run a command; an empty keystrokes string with a duration waits.`, isError: true, meta: { frame: 'terminus', parsed: false } };
    }
    await this.ensureSession(input.cwd, input.sessionId, input.signal);
    this.turn += 1;
    const screenBefore = this.lastScreen || await this.capture(this.cfg.screenLines, input.signal);
    const stateBefore = buildStateCard({ cwd: input.cwd, turn: this.turn, budgetUsedFrac: input.deadlineMs > 0 ? Math.min(1, input.elapsedMs / input.deadlineMs) : null, budgetLeftS: input.deadlineMs > 0 ? Math.max(0, (input.deadlineMs - input.elapsedMs) / 1000) : null, history: this.history, commandStillRunning: this.running });
    const menu = buildMenu({ candidates: action.candidates, taskTestCommand: extractTaskTestCommand(input.task), commandStillRunning: this.running, screenClipped: this.lastClipped, history: this.history });
    // the menu step
    let decision: ChooserDecision;
    let answers: Record<string, number> | null = null; let chooserLatencyMs = 0;
    if (this.cfg.chooser === 'jev' && this.deps.jev) {
      const c0 = this.now();
      try { answers = await this.deps.jev(buildChooserState({ task: input.task, screen: screenBefore, stateCard: stateBefore, menu, writerAnalysis: action.analysis }), buildChooserQuestions(menu)); } catch { answers = null; }
      chooserLatencyMs = this.now() - c0;
    }
    decision = decideChooser({ answers, menu });
    const pick = decision.pick;
    const consequences = [...decision.consequences];
    let executedKeys: string | null = null; let screen = screenBefore; let running = this.running; let waitedS = 0; let extra = '';
    if (pick) {
      const op = pick.source === 'template' ? pick.op : undefined;
      if (op === 'reread_task') { extra = `TASK TEXT (re-read):\n${input.task.slice(0, 3000)}`; executedKeys = ''; }
      else if (op === 'finish') { consequences.push('The harness recommends finishing: if the task is complete, call EndTurn now with your attestation.'); executedKeys = ''; }
      else if (op === 'show_more') { const more = await this.capture(Math.min(400, this.cfg.screenLines * 4), input.signal); extra = `EARLIER OUTPUT:\n${clipScreen(more, FRAME_DEFAULTS.screenMaxChars * 2).text}`; executedKeys = ''; }
      else {
        await this.sendKeys(pick.keystrokes, input.signal); executedKeys = pick.keystrokes;
        const w = await this.waitAndObserve(pick.durationS, input.signal); screen = w.screen; running = w.running; waitedS = w.waitedS;
      }
    }
    if (executedKeys === '' && pick && (pick.op === 'reread_task' || pick.op === 'finish' || pick.op === 'show_more')) { screen = await this.capture(this.cfg.screenLines, input.signal); }
    const rc = running ? null : parsePromptRc(screen);
    const lastLine = screen.split('\n').map((l) => l.trim()).filter((l) => l && !/__RC=/.test(l)).slice(-1)[0] ?? '';
    if (executedKeys) this.history.push({ keystrokes: executedKeys, rc, outcome: lastLine.slice(0, 80), elapsedS: waitedS });
    this.running = running;
    const clipped = clipScreen(screen.replace(/__RC=\d+\n?/g, ''), FRAME_DEFAULTS.screenMaxChars);
    this.lastScreen = screen; this.lastClipped = clipped.clipped;
    const stateCard = buildStateCard({ cwd: input.cwd, turn: this.turn, budgetUsedFrac: input.deadlineMs > 0 ? Math.min(1, (input.elapsedMs + (this.now() - t0)) / input.deadlineMs) : null, budgetLeftS: input.deadlineMs > 0 ? Math.max(0, (input.deadlineMs - input.elapsedMs - (this.now() - t0)) / 1000) : null, history: this.history, lastElapsedS: waitedS, commandStillRunning: running });
    const nextMenu = buildMenu({ candidates: [], taskTestCommand: extractTaskTestCommand(input.task), commandStillRunning: running, screenClipped: clipped.clipped });
    const content = buildFrameSuffix({ screen: clipped.text, stateCard, menu: nextMenu, consequences }) + (extra ? `\n\n${extra}` : '');
    const row = buildChooserRow({ sessionId: input.sessionId, turn: this.turn, predictorModel: input.predictorModel + (this.cfg.chooser === 'jev' ? '+jev-chooser' : ''), menu, decision, executedKeys, nowMs: this.now() });
    this.deps.recordEvent('frame_turn', { ...row, analysis: action.analysis.slice(0, 600), plan: action.plan.slice(0, 600), rc, waitedS: Math.round(waitedS), running, screenChars: screen.length, chooser: this.cfg.chooser, chooserLatencyMs, answers: answers ? Object.fromEntries(Object.entries(answers).map(([k, v]) => [k, Number(v.toFixed(3))])) : null, stepMs: this.now() - t0 });
    return { content, isError: false, meta: { frame: 'terminus', turn: this.turn, pick: pick?.id ?? null, action: decision.action, rc, running, executedKeys: executedKeys ? normalizeKeys(executedKeys).slice(0, 120) : executedKeys } };
  }
}
