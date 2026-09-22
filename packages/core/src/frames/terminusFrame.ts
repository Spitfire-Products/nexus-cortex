/**
 * R179 HB-TERMINUS-FRAME — pure helpers for the Terminus-style action mode (design: docs/R179_TERMINUS_FRAME_PORT_DESIGN.md).
 *
 * The frame: one tmux pane is the only "tool". Each turn the writer (the generator) gets a FIXED prefix (system + task + lift plan + the
 * frame contract) and a REBUILT suffix (the screen + a parsed STATE CARD + the MENU), and emits one JSON action: analysis, plan, up to k
 * candidate keystroke actions (the ghost text), task_complete. Code templates (wait / interrupt / show more / run the task's test /
 * re-read the task / finish) join the menu every turn. A chooser (frames/chooser.ts) picks; candidate[0] is the escape.
 *
 * Nothing here touches the orchestrator, tmux, or the network: every function is pure and unit-tested. We are not bound to the Terminus 2
 * formula — the shapes below are the seams where later authors (helper model, apprentice, speculative drafts) and choosers (Jev, own readout,
 * j-space acceptor) plug in without changing the frame.
 */

export interface FrameCandidate {
  /** short label the chooser sees ("run the test suite", "inspect config.json") */
  label: string;
  /** keystrokes sent verbatim to the pane; '' = no keys (a pure wait); tmux key names allowed (C-c, Enter) */
  keystrokes: string;
  /** seconds to wait before the next observation (bounded by the frame cap) */
  durationS: number;
  why?: string;
}

export interface FrameAction {
  analysis: string;
  plan: string;
  candidates: FrameCandidate[];
  taskComplete: boolean;
  parsed: boolean;
  error?: string;
}

export type MenuSource = 'generator' | 'template';
export type TemplateOp = 'wait' | 'interrupt' | 'show_more' | 'run_test' | 'reread_task' | 'finish' | 'reset_pane';
export interface MenuItem extends FrameCandidate {
  id: string;
  source: MenuSource;
  /** a harness operation for templates that are not keystrokes (show_more / reread_task / finish) */
  op?: TemplateOp;
}

export const FRAME_DEFAULTS = { maxCandidates: 3, defaultDurationS: 3, maxDurationS: 60, graceS: 5, waitExtendS: 30, stateCardMaxChars: 1500, screenMaxChars: 6000, digestLen: 12, wedgeTurns: 4 } as const;

/* ---------- screen ---------- */

/** Strip ANSI escape sequences and bracketed-paste markers; normalize CRLF. Pure. */
export function stripAnsi(s: string): string {
  return String(s ?? '')
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')   // CSI sequences (colors, cursor, ?2004h/l)
    .replace(/\x1b\][^\x07]*(\x07|\x1b\\)/g, '')  // OSC sequences (titles)
    .replace(/\x1b[()][A-Za-z0-9]/g, '')          // charset selection
    .replace(/\r\n?/g, '\n');
}

/** The prompt hook prints `__RC=<n>` right before each prompt (PROMPT_COMMAND='echo __RC=$?'). Last one wins. Pure. */
export function parsePromptRc(screen: string): number | null {
  const m = [...String(screen ?? '').matchAll(/__RC=(\d+)/g)];
  return m.length ? Number(m[m.length - 1]![1]) : null;
}

/** Is the shell prompt back on the LAST non-empty line (a command finished)? Matches `user@host:path$ ` / `# ` / `$ ` / `> `. Pure. */
export function promptIsBack(screen: string): boolean {
  const lines = stripAnsi(screen).split('\n').map((l) => l.replace(/__RC=\d+/g, '').trimEnd()).filter((l) => l.trim().length > 0);
  const last = lines[lines.length - 1] ?? '';
  return /(^|\s)(\S+@\S+:[^\n$#]*)?[$#>]\s*$/.test(last);
}

/** Keep the tail of the screen (the pane is 40 rows; a capture with history can be longer). Pure. */
export function clipScreen(screen: string, maxChars: number = FRAME_DEFAULTS.screenMaxChars): { text: string; clipped: boolean } {
  const t = stripAnsi(screen).replace(/[ \t]+\n/g, '\n');
  if (t.length <= maxChars) return { text: t, clipped: false };
  return { text: '…[earlier output hidden — the SHOW MORE OUTPUT template reveals it]\n' + t.slice(-maxChars), clipped: true };
}

/* ---------- state card ---------- */

export interface HistoryEntry { keystrokes: string; rc: number | null; outcome: string; elapsedS?: number }
export interface StateCardInput {
  cwd: string;
  turn: number;
  budgetUsedFrac: number | null;
  budgetLeftS: number | null;
  history: HistoryEntry[];
  lastElapsedS?: number | null;
  openItems?: string;
  planStep?: string;
  commandStillRunning?: boolean;
}

export function normalizeKeys(k: string): string {
  return String(k ?? '').replace(/\s+/g, ' ').trim();
}

/** How many times the candidate's keystrokes were already sent (exact, whitespace-normalized). Pure. */
export function repeatCount(history: HistoryEntry[], keystrokes: string): number {
  const n = normalizeKeys(keystrokes);
  if (!n) return 0;
  return history.filter((h) => normalizeKeys(h.keystrokes) === n).length;
}

/** The parsed truth both the writer and the reader receive. Numbers are computed here, never inferred by a model. Pure. */
export function buildStateCard(input: StateCardInput, maxChars: number = FRAME_DEFAULTS.stateCardMaxChars): string {
  const last = input.history[input.history.length - 1];
  const repeats = input.history.filter((h, i) => input.history.slice(0, i).some((p) => normalizeKeys(p.keystrokes) === normalizeKeys(h.keystrokes))).length;
  const lines = [
    `turn ${input.turn} · commands run ${input.history.length} · repeated commands ${repeats}`,
    `cwd ${input.cwd}`,
    last ? `last command: ${normalizeKeys(last.keystrokes).slice(0, 120)} → rc ${last.rc === null ? '?' : last.rc}${input.lastElapsedS != null ? ` in ${Math.round(input.lastElapsedS)} s` : ''}${input.commandStillRunning ? ' (STILL RUNNING)' : ''}` : 'last command: (none yet)',
    input.budgetUsedFrac !== null ? `budget used ${Math.round(input.budgetUsedFrac * 100)}%${input.budgetLeftS != null ? `, ${Math.round(input.budgetLeftS / 60)} min left` : ''}` : 'budget: unknown',
  ];
  if (input.planStep) lines.push(`plan step: ${input.planStep.slice(0, 200)}`);
  if (input.openItems) lines.push(`open items from the last hold: ${input.openItems.slice(0, 400)}`);
  const digest = input.history.slice(-FRAME_DEFAULTS.digestLen).map((h, i) => `  ${i + 1}. ${normalizeKeys(h.keystrokes).slice(0, 80) || '(wait)'} → rc ${h.rc === null ? '?' : h.rc}${h.outcome ? ` · ${h.outcome.slice(0, 60)}` : ''}`);
  if (digest.length) lines.push('recent commands:', ...digest);
  let out = lines.join('\n');
  if (out.length > maxChars) out = out.slice(0, maxChars - 1) + '…';
  return out;
}

/* ---------- action parsing ---------- */

function extractJson(text: string): unknown {
  const t = String(text ?? '').trim();
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = (fenced?.[1] ?? t).trim();
  try { return JSON.parse(body); } catch { /* fall through */ }
  const a = body.indexOf('{'); const b = body.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(body.slice(a, b + 1)); } catch { /* fall through */ } }
  return null;
}

function toCandidate(x: unknown, i: number, maxDurationS: number): FrameCandidate | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  const keys = typeof o.keystrokes === 'string' ? o.keystrokes : typeof o.command === 'string' ? `${o.command}\n` : null;
  if (keys === null) return null;
  const durRaw = Number(o.durationS ?? o.duration_s ?? o.duration ?? FRAME_DEFAULTS.defaultDurationS);
  const durationS = Number.isFinite(durRaw) && durRaw >= 0 ? Math.min(maxDurationS, durRaw) : FRAME_DEFAULTS.defaultDurationS;
  const label = typeof o.label === 'string' && o.label.trim() ? o.label.trim().slice(0, 120) : normalizeKeys(keys).slice(0, 80) || (keys === '' ? 'wait' : `action ${i + 1}`);
  return { label, keystrokes: keys, durationS, ...(typeof o.why === 'string' ? { why: o.why.slice(0, 300) } : {}) };
}

/** Parse the writer's action. Accepts our shape ({analysis, plan, candidates, task_complete}) and Terminus 2's ({analysis, plan,
 *  commands:[{keystrokes, duration}], task_complete}); fenced or bare JSON. Strict on the essentials: no candidates and no finish → not
 *  parsed (the caller re-asks once, then falls back). Pure. */
export function parseFrameAction(text: string, opts: { maxCandidates?: number; maxDurationS?: number } = {}): FrameAction {
  const maxC = opts.maxCandidates ?? FRAME_DEFAULTS.maxCandidates; const maxD = opts.maxDurationS ?? FRAME_DEFAULTS.maxDurationS;
  const j = extractJson(text) as Record<string, unknown> | null;
  if (!j) return { analysis: '', plan: '', candidates: [], taskComplete: false, parsed: false, error: 'no JSON object found' };
  const rawList = Array.isArray(j.candidates) ? j.candidates : Array.isArray(j.commands) ? j.commands : [];
  const candidates = rawList.map((c, i) => toCandidate(c, i, maxD)).filter((c): c is FrameCandidate => c !== null).slice(0, maxC);
  const taskComplete = j.task_complete === true || j.taskComplete === true;
  const analysis = typeof j.analysis === 'string' ? j.analysis.slice(0, 2000) : '';
  const plan = typeof j.plan === 'string' ? j.plan.slice(0, 2000) : '';
  if (!candidates.length && !taskComplete) return { analysis, plan, candidates, taskComplete, parsed: false, error: 'no candidates and no task_complete' };
  return { analysis, plan, candidates, taskComplete, parsed: true };
}

/* ---------- menu ---------- */

export interface MenuInput {
  candidates: FrameCandidate[];
  /** the task's own test/verification command when the task text names one (the harness extracts it; '' = none) */
  taskTestCommand?: string;
  commandStillRunning?: boolean;
  screenClipped?: boolean;
  history?: HistoryEntry[];
  /** R180: the pane is wedged (no prompt for several turns despite interrupts) — offer RESET THE PANE. */
  paneWedged?: boolean;
}

/* ---------- R180 pane liveness (E2 field read 2026-09-22: a writer sent C-d, the tmux session died, 70 turns went to a dead pane) ---------- */

/** Does a capture say the tmux session is gone (the executor's error text, or tmux's own)? Pure. */
export function paneIsDead(screen: string): boolean {
  return /session '[^']*' does not exist|no server running|can't find session|no such session|no sessions?\b/i.test(String(screen ?? ''));
}

/** How many trailing history entries ended without a prompt (rc null)? Pure. */
export function trailingNoPrompt(history: HistoryEntry[]): number {
  let n = 0;
  for (let i = history.length - 1; i >= 0; i--) { if (history[i]!.rc === null) n++; else break; }
  return n;
}

/** A wedged pane: ≥ `minTurns` trailing turns with no prompt back AND at least one interrupt among them (the writer already tried C-c). Pure. */
export function paneWedged(history: HistoryEntry[], minTurns: number = FRAME_DEFAULTS.wedgeTurns): boolean {
  const n = trailingNoPrompt(history);
  if (n < minTurns) return false;
  return history.slice(-n).some((h) => /^(C-c|C-d|C-z|C-\\)$/.test(h.keystrokes.trim()));
}

/** The Oregon Trail menu: the generator's candidates first (candidate[0] is the escape), then the code templates that apply. Pure. */
export function buildMenu(input: MenuInput): MenuItem[] {
  const items: MenuItem[] = input.candidates.map((c, i) => ({ ...c, id: `c${i + 1}`, source: 'generator' as const }));
  const t = (id: string, label: string, keystrokes: string, durationS: number, op: TemplateOp): MenuItem => ({ id, label, keystrokes, durationS, source: 'template', op });
  if (input.commandStillRunning) {
    items.push(t('t_wait', `WAIT ${FRAME_DEFAULTS.waitExtendS}s more for the running command`, '', FRAME_DEFAULTS.waitExtendS, 'wait'));
    items.push(t('t_interrupt', 'INTERRUPT the running command (C-c)', 'C-c', 2, 'interrupt'));
  }
  if (input.paneWedged) items.push(t('t_reset', 'RESET THE PANE (kill the wedged shell, start a fresh one in the task directory)', '', 0, 'reset_pane'));
  if (input.screenClipped) items.push(t('t_more', 'SHOW MORE OUTPUT (earlier screen lines)', '', 0, 'show_more'));
  if (input.taskTestCommand) items.push(t('t_test', `RUN THE TASK'S OWN TEST: ${input.taskTestCommand.slice(0, 60)}`, `${input.taskTestCommand}\n`, 30, 'run_test'));
  items.push(t('t_reread', 'RE-READ THE TASK TEXT', '', 0, 'reread_task'));
  items.push(t('t_finish', 'FINISH (declare the task complete)', '', 0, 'finish'));
  // annotate repeats so the chooser and the writer both see them as data
  if (input.history) for (const it of items) { const n = repeatCount(input.history, it.keystrokes); if (n > 0 && it.source === 'generator') it.why = `${it.why ? it.why + ' · ' : ''}already run ${n}×`; }
  return items;
}

/** R181: the contract says "name a template in a candidate's label to use it" — make that true. A generator candidate whose label names a
 *  template (WAIT / INTERRUPT / SHOW MORE / RUN THE TASK'S OWN TEST / RE-READ / FINISH / RESET THE PANE) and carries no keystrokes of its own
 *  becomes that template (same id/position, so the chooser-off arm executes it as c1). Field read 2026-09-22: E1 writers named SHOW MORE and
 *  RE-READ in labels and got an empty wait instead. Pure. */
const TEMPLATE_NAMES: Array<[RegExp, TemplateOp]> = [
  [/RESET THE PANE|RESET PANE/i, 'reset_pane'], [/SHOW MORE/i, 'show_more'], [/RE-?READ/i, 'reread_task'], [/RUN THE TASK'?S? (OWN )?TEST/i, 'run_test'],
  [/\bINTERRUPT\b/i, 'interrupt'], [/^\s*WAIT\b|\bWAIT (\d+ ?S|MORE|LONGER)/i, 'wait'], [/^\s*FINISH\b|\(declare the task complete\)/i, 'finish'],
];
export function applyNamedTemplates(menu: MenuItem[]): MenuItem[] {
  const templates = menu.filter((m) => m.source === 'template');
  return menu.map((m) => {
    if (m.source !== 'generator') return m;
    const named = TEMPLATE_NAMES.find(([re]) => re.test(m.label))?.[1];
    if (!named) return m;
    const t = templates.find((x) => x.op === named);
    if (!t) return m;
    const ownKeys = m.keystrokes.trim();
    if (ownKeys && ownKeys !== t.keystrokes.trim()) return m; // the writer typed real keystrokes — those win over the name
    return { ...t, id: m.id, label: m.label, why: m.why, durationS: named === 'wait' && m.durationS > 0 ? m.durationS : t.durationS };
  });
}

/** The per-turn suffix text the writer sees (the prefix is fixed; only this changes). Pure. */
export function buildFrameSuffix(input: { screen: string; stateCard: string; menu: MenuItem[]; consequences?: string[]; showTemplates?: boolean; templatesChanged?: boolean }): string {
  const parts = [`STATE:\n${input.stateCard}`, `SCREEN (tmux pane, most recent at the bottom):\n${input.screen}`];
  if (input.consequences?.length) parts.push(`FROM THE HARNESS:\n${input.consequences.map((c) => `- ${c}`).join('\n')}`);
  const templates = input.menu.filter((m) => m.source === 'template');
  // TOKEN DIET (2026-09-21): the standing templates are in the frame contract (turn 0); the per-turn list is sent only when it changes
  // (a running command adds WAIT/INTERRUPT; a clipped screen adds SHOW MORE) or when the caller asks for it.
  if (input.showTemplates !== false && (input.templatesChanged ?? true)) parts.push(`MENU (name one in a candidate's label to use it):\n${templates.map((m) => `- ${m.label}`).join('\n')}`);
  else if (templates.some((m) => m.op === 'wait' || m.op === 'interrupt' || m.op === 'show_more' || m.op === 'reset_pane')) parts.push(`MENU: ${templates.filter((m) => ['wait', 'interrupt', 'show_more', 'reset_pane'].includes(m.op ?? '')).map((m) => m.label.split(' (')[0]).join(' · ')}`);
  return parts.join('\n\n');
}

/* ---------- waiting ---------- */

export type WaitDecision = 'done' | 'extend' | 'cap';
/** TIME-EFFICIENT WAIT (rewritten 2026-09-21 after cell E1/E2: the first version extended while the screen kept changing, up to 300 s, and
 *  polled 60 s on a missed prompt — 25–44 turns per session sat in that loop; the model itself takes 4–10 s a turn). Now: wait exactly the
 *  model's duration (capped at maxDurationS); if the prompt is back → done; otherwise allow ONE short grace (graceS) only while the screen is
 *  still changing; then hand the screen back marked STILL RUNNING — the WAIT / INTERRUPT templates are the model's way to wait longer. Pure. */
export function waitPolicy(input: { promptBack: boolean; screenChanged: boolean; waitedS: number; durationS: number; graceS?: number }): WaitDecision {
  if (input.promptBack) return 'done';
  if (input.waitedS < input.durationS) return 'extend';
  const grace = input.graceS ?? FRAME_DEFAULTS.graceS;
  if (input.screenChanged && input.waitedS < input.durationS + grace) return 'extend';
  return 'cap';
}

/** The task's own test command, when the task text states one (a fenced or backticked `make test` / `pytest …` / `npm test` / `./run_tests.sh`). Pure. */
export function extractTaskTestCommand(task: string): string {
  const t = String(task ?? '');
  const m = t.match(/`((?:python3? -m pytest|pytest|make (?:test|check)|npm (?:run )?test|cargo test|go test|\.\/[\w./-]*test[\w./-]*\.sh|bash [\w./-]*test[\w./-]*\.sh)[^`\n]{0,80})`/i);
  return m ? m[1]!.trim() : '';
}
