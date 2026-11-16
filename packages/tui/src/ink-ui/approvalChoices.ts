/**
 * approvalChoices — the PURE choice/key logic behind the Ink approval dialog (vault task T3).
 *
 * No react, no ink, no side effects: the dialog component and the handler hook are thin wrappers over these functions, so the
 * decision logic can be executed and unit-tested in a checkout where the TUI's runtime dependencies are not installed.
 *
 * A plain tool request keeps the three legacy choices (yes / yes + auto-approve all / no). A `load_session` request asks the
 * four-way question the session-vault floor needs: once / this session / always for this site / no.
 */

/** How long an answer applies. 'always' is the only one that reaches the disk (via the release path). */
export type ApprovalScope = 'once' | 'session' | 'always';

/** One selectable choice. 'no' is a refusal, not a scope. */
export interface ApprovalChoice {
  value: ApprovalScope | 'no';
  label: string;
}

/** What a dialog resolves with. `false` is the legacy refusal shape. */
export type ApprovalAnswer = boolean | { approved: boolean; scope?: ApprovalScope };

/** The subset of an approval request this module needs (structurally satisfied by core's ApprovalRequest). */
export interface ChoiceRequest {
  toolName?: string;
  kind?: 'load_session';
  site?: string;
  choices?: ReadonlyArray<ApprovalChoice>;
}

export const LOAD_SESSION_TOOL_NAMES: readonly string[] = ['nexus-browser__load_session', 'load_session'];

/** The four labels for a load_session prompt; the site is named so the user knows what they are granting. */
export function LOAD_SESSION_CHOICES(site?: string): ApprovalChoice[] {
  const where = site && site.trim() ? site.trim() : 'this site';
  return [
    { value: 'once', label: 'Yes, just this once' },
    { value: 'session', label: 'Yes, for this session' },
    { value: 'always', label: `Yes, always for ${where}` },
    { value: 'no', label: 'No, do not load it (esc)' },
  ];
}

/** The three legacy choices, kept byte-identical to the CLI prompt so the two surfaces agree. */
export const GENERIC_CHOICES: readonly ApprovalChoice[] = Object.freeze([
  { value: 'once', label: '1. Yes' },
  { value: 'once', label: '2. Yes, auto-approve all actions this session (shift+tab to toggle)' },
  { value: 'no', label: '3. No, skip this operation (esc)' },
] as ApprovalChoice[]);

/** True when the request is the session-vault load question (by kind, or by tool name when kind is absent). */
export function isLoadSessionRequest(request: ChoiceRequest | null | undefined): boolean {
  if (!request) return false;
  if (request.kind === 'load_session') return true;
  return LOAD_SESSION_TOOL_NAMES.includes(String(request.toolName ?? ''));
}

/** The choices to render: the request's own list when it carries one, else the four-way / legacy default. */
export function choicesForRequest(request: ChoiceRequest | null | undefined): ApprovalChoice[] {
  if (request && Array.isArray(request.choices) && request.choices.length > 0) return [...request.choices];
  if (isLoadSessionRequest(request)) return LOAD_SESSION_CHOICES(request?.site);
  return [...GENERIC_CHOICES];
}

/** Map one chosen option to the handler's answer. Anything but a positive scope is a refusal. */
export function answerFor(choice: ApprovalChoice): ApprovalAnswer {
  if (!choice || choice.value === 'no') return false;
  if (choice.value === 'once' || choice.value === 'session' || choice.value === 'always') {
    return { approved: true, scope: choice.value };
  }
  return false;
}

/** Dialog state: which choice the cursor is on, and the answer once one is committed. */
export interface ChoiceState {
  index: number;
  answer?: ApprovalAnswer;
}

/** Normalised keys the reducer understands (the component maps raw ink input to these). */
export type ChoiceKey = 'up' | 'down' | 'enter' | 'escape' | 'y' | 'n' | (string & {});

export function initialChoiceState(_count: number): ChoiceState {
  return { index: 0 };
}

/**
 * One key step. Pure: returns the next state, with `answer` set when the key committed a choice.
 * Numbers pick directly, y picks the first choice, n the last (the legacy prompt's shortcuts), esc answers no.
 */
export function reduceApprovalKey(state: ChoiceState, key: ChoiceKey, count: number): ChoiceState {
  if (state.answer !== undefined) return state;
  const last = Math.max(0, count - 1);

  if (key === 'up') return { index: Math.max(0, state.index - 1) };
  if (key === 'down') return { index: Math.min(last, state.index + 1) };
  if (key === 'escape') return { index: state.index, answer: false };
  if (key === 'enter') return { index: state.index, answer: answerForIndex(state.index, count) };
  if (key === 'y') return { index: state.index, answer: answerForIndex(0, count) };
  if (key === 'n') return { index: state.index, answer: answerForIndex(last, count) };

  if (/^[1-9]$/.test(key)) {
    const i = Number(key) - 1;
    if (i <= last) return { index: i, answer: answerForIndex(i, count) };
  }
  return state;
}

/** The answer for a position, using the load_session ordering (once / session / always / no) for four choices and the
 *  legacy ordering (yes / yes+yolo / no) for three. A position outside the list refuses. */
export function answerForIndex(index: number, count: number): ApprovalAnswer {
  const four: ApprovalChoice[] = LOAD_SESSION_CHOICES();
  const ordered = count === 4 ? four : [...GENERIC_CHOICES];
  const choice = ordered[index];
  return choice ? answerFor(choice) : false;
}
