/**
 * R179 HB-TERMINUS-FRAME — the runner: drives ONE tmux pane through the existing TmuxSession executor (programmatically, via the
 * executor registry — never through a model tool call), applies the menu step (frames/chooser.ts), and returns the observation
 * (screen + state card + templates) as the FrameAction tool_result. Holds the frame's durable state for the session (history, running
 * command, tmux session id). Everything decision-shaped is in the pure modules; this file is plumbing + waiting.
 */
import { buildStateCard, buildMenu, buildFrameSuffix, clipScreen, parsePromptRc, promptIsBack, waitPolicy, extractTaskTestCommand, parseFrameAction, stripAnsi, normalizeKeys, paneIsDead, paneWedged, applyNamedTemplates, applyKeyGuard, FRAME_DEFAULTS, type HistoryEntry } from './terminusFrame.js';
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
  const parts = text.split(/\n?={20,}\n?/); // the rule may touch the pane text on either side
  return parts.length >= 3 ? parts[1]! : text;
}

export class FrameRunner {
  private tmuxSession: string | null = null;
  private history: HistoryEntry[] = [];
  private turn = 0;
  private running = false;
  private lastScreen = '';
  private lastClipped = false;
  private lastTemplateKey = '';
  private paneDead = false;
  private paneResets = 0;
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
    let text: string;
    try { text = resultText(await this.deps.execute('TmuxSession', { action: 'capture', sessionId: this.tmuxSession!, lines }, signal)); }
    catch (e: any) { text = String(e?.message ?? e); }
    // R180: the session is gone (the writer sent C-d / `exit`, or the shell crashed) — remember it so the next step respawns instead of
    // handing a dead pane back turn after turn.
    if (paneIsDead(text)) { this.paneDead = true; return text; }
    return stripAnsi(unwrapCapture(text));
  }

  /** R180: kill whatever is left of the pane and start a fresh shell in the task directory. Returns the note the writer sees. */
  private async resetPane(cwd: string, sessionId: string, why: 'dead' | 'wedged', signal?: AbortSignal): Promise<string> {
    if (this.tmuxSession) { try { await this.deps.execute('TmuxSession', { action: 'kill', sessionId: this.tmuxSession }, signal); } catch { /* already gone */ } }
    this.tmuxSession = null; this.paneDead = false; this.running = false; this.lastScreen = ''; this.lastClipped = false; this.paneResets += 1;
    await this.ensureSession(cwd, sessionId, signal);
    return why === 'dead'
      ? `PANE RESET (${this.paneResets}): the shell exited (Ctrl-D, exit, or a crash killed it) and a fresh shell was started in ${cwd}. Exported variables, cd and background jobs of the old shell are gone. Never send C-d or exit to the shell.`
      : `PANE RESET (${this.paneResets}): the pane stopped answering, so the harness killed it and started a fresh shell in ${cwd}. Whatever was running is gone; re-run long commands with output redirected to a file.`;
  }

  private async sendKeys(keystrokes: string, signal?: AbortSignal): Promise<void> {
    const k = keystrokes;
    if (!k) return;
    if (RAW_KEY_RE.test(k.trim())) { await this.deps.execute('TmuxSession', { action: 'send', sessionId: this.tmuxSession!, command: k.trim(), raw: true }, signal); return; }
    const enter = /\n$/.test(k);
    await this.deps.execute('TmuxSession', { action: 'send', sessionId: this.tmuxSession!, command: enter ? k.replace(/\n+$/, '') : k, enter }, signal);
  }

  /** Wait exactly the candidate's duration (capped), then one short grace while the screen still changes; never longer. Returns the screen. */
  private async waitAndObserve(durationS: number, signal?: AbortSignal): Promise<{ screen: string; running: boolean; waitedS: number }> {
    const t0 = this.now();
    const dur = Math.min(Math.max(0, durationS), this.cfg.waitCapS); // the cell's cap on one action's requested wait
    let waited = 0; let screen = ''; let prev = '';
    // EARLY RETURN (4.124.5): the requested duration is an upper bound — poll the pane every ~2 s and return as soon as the prompt is back.
    // Field read (E1/E2 on 4.124.4): the writer often requests the 60-s cap for commands that finish in 2 s; median waits were 20–30 s.
    while (!signal?.aborted) {
      const slice = Math.min(2000, Math.max(200, (dur - waited) * 1000));
      if (waited >= dur) break;
      await this.sleep(slice); waited = (this.now() - t0) / 1000;
      if (waited >= Math.min(dur, 2)) { prev = screen; screen = await this.capture(this.cfg.screenLines, signal); if (this.paneDead) return { screen, running: false, waitedS: waited }; if (promptIsBack(screen)) return { screen, running: false, waitedS: waited }; }
    }
    if (!screen) screen = await this.capture(this.cfg.screenLines, signal); prev = prev || screen;
    if (this.paneDead) return { screen, running: false, waitedS: waited };
    for (let i = 0; i < 4; i++) {
      const d = waitPolicy({ promptBack: promptIsBack(screen), screenChanged: i === 0 ? true : screen !== prev, waitedS: waited, durationS: dur, graceS: FRAME_DEFAULTS.graceS });
      if (d === 'done') return { screen, running: false, waitedS: waited };
      if (d === 'cap' || signal?.aborted) return { screen, running: true, waitedS: waited };
      await this.sleep(1500); waited = (this.now() - t0) / 1000; prev = screen; screen = await this.capture(this.cfg.screenLines, signal);
    }
    return { screen, running: !promptIsBack(screen), waitedS: waited };
  }

  async step(input: FrameStepInput): Promise<FrameStepResult> {
    const t0 = this.now();
    const action = parseFrameAction(typeof input.action === 'string' ? input.action : JSON.stringify(input.action ?? {}), { maxCandidates: this.cfg.candidates });
    if (!action.parsed) {
      return { content: `FrameAction not understood (${action.error}). Send {analysis, plan, candidates:[{label, keystrokes, duration_s}]} — keystrokes end with \\n to run a command; an empty keystrokes string with a duration waits.`, isError: true, meta: { frame: 'terminus', parsed: false } };
    }
    await this.ensureSession(input.cwd, input.sessionId, input.signal);
    this.turn += 1;
    const preConsequences: string[] = [];
    // R180: a pane found dead on the previous step is respawned BEFORE this step's action runs, so the action lands in a live shell.
    if (this.paneDead) preConsequences.push(await this.resetPane(input.cwd, input.sessionId, 'dead', input.signal));
    const screenBefore = this.lastScreen || await this.capture(this.cfg.screenLines, input.signal);
    const stateBefore = buildStateCard({ cwd: input.cwd, turn: this.turn, budgetUsedFrac: input.deadlineMs > 0 ? Math.min(1, input.elapsedMs / input.deadlineMs) : null, budgetLeftS: input.deadlineMs > 0 ? Math.max(0, (input.deadlineMs - input.elapsedMs) / 1000) : null, history: this.history, commandStillRunning: this.running });
    const wedged = paneWedged(this.history);
    const menu0 = applyNamedTemplates(buildMenu({ candidates: action.candidates, taskTestCommand: extractTaskTestCommand(input.task), commandStillRunning: this.running, screenClipped: this.lastClipped, history: this.history, paneWedged: wedged }));
    // R182: the keystroke guard runs BEFORE the menu step — a pane-killing or destructive candidate never reaches the chooser or the pane.
    const guarded = this.cfg.keyGuard ? applyKeyGuard(menu0, { running: this.running }) : { menu: menu0, blocked: [] };
    const menu = guarded.menu;
    for (const b of guarded.blocked) preConsequences.push(`Candidate "${b.label}" (${b.keystrokes}) was BLOCKED by the keystroke guard: ${b.reason}. It was not sent.`);
    const allBlocked = guarded.blocked.length > 0 && !menu.some((m) => m.source === 'generator');
    // the menu step
    let decision: ChooserDecision;
    let answers: Record<string, number> | null = null; let chooserLatencyMs = 0;
    if (this.cfg.chooser === 'jev' && this.deps.jev) {
      const c0 = this.now();
      try { answers = await this.deps.jev(buildChooserState({ task: input.task, screen: screenBefore, stateCard: stateBefore, menu, writerAnalysis: action.analysis }), buildChooserQuestions(menu)); } catch { answers = null; }
      chooserLatencyMs = this.now() - c0;
    }
    decision = allBlocked
      ? { action: 'refuse', pick: null, pickProbability: null, consequences: ['Every candidate was blocked; nothing was sent. Propose safe candidates that stay inside the task directory.'], sendFullScreen: false, reasons: ['all generator candidates blocked by the keystroke guard'] }
      : decideChooser({ answers, menu });
    const pick = decision.pick;
    const consequences = [...preConsequences, ...decision.consequences];
    let executedKeys: string | null = null; let screen = screenBefore; let running = this.running; let waitedS = 0; let extra = '';
    if (pick) {
      const op = pick.source === 'template' ? pick.op : undefined;
      if (op === 'reset_pane') { consequences.push(await this.resetPane(input.cwd, input.sessionId, 'wedged', input.signal)); running = false; executedKeys = ''; }
      else if (op === 'reread_task') { extra = `TASK TEXT (re-read):\n${input.task.slice(0, 3000)}`; executedKeys = ''; }
      else if (op === 'finish') { consequences.push('The harness recommends finishing: if the task is complete, call EndTurn now with your attestation.'); executedKeys = ''; }
      else if (op === 'show_more') { const more = await this.capture(Math.min(400, this.cfg.screenLines * 4), input.signal); extra = `EARLIER OUTPUT:\n${clipScreen(more, FRAME_DEFAULTS.screenMaxChars * 2).text}`; executedKeys = ''; }
      else {
        await this.sendKeys(pick.keystrokes, input.signal); executedKeys = pick.keystrokes;
        const w = await this.waitAndObserve(pick.durationS, input.signal); screen = w.screen; running = w.running; waitedS = w.waitedS;
      }
    }
    if (executedKeys === '' && pick && (pick.op === 'reread_task' || pick.op === 'finish' || pick.op === 'show_more' || pick.op === 'reset_pane')) { screen = await this.capture(this.cfg.screenLines, input.signal); }
    // R180: a pane that died DURING this step's wait — respawn now so the writer sees a live prompt, not the executor's error text.
    if (this.paneDead) { consequences.push(await this.resetPane(input.cwd, input.sessionId, 'dead', input.signal)); running = false; screen = await this.capture(this.cfg.screenLines, input.signal); }
    const rc = running ? null : parsePromptRc(screen);
    const lastLine = screen.split('\n').map((l) => l.trim()).filter((l) => l && !/__RC=/.test(l)).slice(-1)[0] ?? '';
    if (executedKeys) this.history.push({ keystrokes: executedKeys, rc, outcome: lastLine.slice(0, 80), elapsedS: waitedS });
    this.running = running;
    const clipped = clipScreen(screen.replace(/__RC=\d+\n?/g, ''), FRAME_DEFAULTS.screenMaxChars);
    this.lastScreen = screen; this.lastClipped = clipped.clipped;
    const stateCard = buildStateCard({ cwd: input.cwd, turn: this.turn, budgetUsedFrac: input.deadlineMs > 0 ? Math.min(1, (input.elapsedMs + (this.now() - t0)) / input.deadlineMs) : null, budgetLeftS: input.deadlineMs > 0 ? Math.max(0, (input.deadlineMs - input.elapsedMs - (this.now() - t0)) / 1000) : null, history: this.history, lastElapsedS: waitedS, commandStillRunning: running });
    const nextMenu = buildMenu({ candidates: [], taskTestCommand: extractTaskTestCommand(input.task), commandStillRunning: running, screenClipped: clipped.clipped, paneWedged: paneWedged(this.history) });
    const tplKey = nextMenu.filter((m) => m.source === 'template').map((m) => m.id).join(',');
    const templatesChanged = tplKey !== this.lastTemplateKey; this.lastTemplateKey = tplKey;
    const content = buildFrameSuffix({ screen: clipped.text, stateCard, menu: nextMenu, consequences, templatesChanged: templatesChanged || this.turn === 1 }) + (extra ? `\n\n${extra}` : '');
    const row = buildChooserRow({ sessionId: input.sessionId, turn: this.turn, predictorModel: input.predictorModel + (this.cfg.chooser === 'jev' ? '+jev-chooser' : ''), menu, decision, executedKeys, nowMs: this.now() });
    this.deps.recordEvent('frame_turn', { ...row, analysis: action.analysis.slice(0, 600), plan: action.plan.slice(0, 600), rc, waitedS: Math.round(waitedS), running, screenChars: screen.length, chooser: this.cfg.chooser, chooserLatencyMs, paneResets: this.paneResets, guard: guarded.blocked.length ? guarded.blocked : null, answers: answers ? Object.fromEntries(Object.entries(answers).map(([k, v]) => [k, Number(v.toFixed(3))])) : null, stepMs: this.now() - t0 });
    return { content, isError: false, meta: { frame: 'terminus', turn: this.turn, pick: pick?.id ?? null, action: decision.action, rc, running, executedKeys: executedKeys ? normalizeKeys(executedKeys).slice(0, 120) : executedKeys } };
  }
}
