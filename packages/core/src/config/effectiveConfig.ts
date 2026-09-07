/**
 * effectiveConfig — the LIVE "what is actually on?" dump (operator request,
 * 2026-08-31, after the CONFIG AUDIT found the guard stack silently dropped
 * for 5+ bench runs with nothing surfacing it).
 *
 * One curated registry of the levers that matter, each with its plain-language
 * meaning and its CODE default (what runs when the env var is absent). The
 * collector reports, per lever, the EFFECTIVE value the running process
 * resolved and where it came from (env vs code default) — so "read
 * .env.defaults and guess" is replaced by "look at the live dump".
 *
 * Surfaced at GET /health/config (JSON, main server) and the :4001 dashboard
 * /config view. Secrets are never shown — only set/unset.
 */

export interface EffectiveLever {
  key: string;
  /** Plain-language: what this switch does. */
  what: string;
  /** The value the code uses when the env var is absent. */
  codeDefault: string;
  /** The value the running process actually resolved. */
  effective: string;
  /** Where the effective value came from. */
  source: 'env' | 'code-default';
  /** For flags: is the feature ON right now? */
  active?: boolean;
  /** Secrets report presence only. */
  redacted?: boolean;
}

export interface EffectiveConfigGroup {
  group: string;
  levers: EffectiveLever[];
}

type LeverSpec = {
  key: string;
  what: string;
  codeDefault: string;
  /** 'flag-true' = active when value === 'true'; 'flag-not-false' = active unless 'false'. */
  kind?: 'flag-true' | 'flag-not-false' | 'value' | 'secret';
};

const GROUPS: Array<{ group: string; levers: LeverSpec[] }> = [
  {
    group: 'Guards (the protection stack — see CONFIG_AUDIT_2026-08-31)',
    levers: [
      { key: 'CORTEX_NEARDUP_BREAKER', what: 'Detects "same approach retried with small tweaks" and forces a strategy change (targets the retry-loop class)', codeDefault: 'false', kind: 'flag-true' },
      { key: 'CORTEX_LOOP_TOOL_BLOCK', what: 'On a detected loop, disables the looping tool\'s EXECUTOR for one turn (cache-safe; tools list unchanged) and returns a redirect error steering to the complementary tools; escalates after 2 blocks to a bounded pro-max exit-planner mentor (REPLAN|RETIRE)', codeDefault: 'false', kind: 'flag-true' },
      { key: 'CORTEX_LOOP_TOOL_BLOCK_EFFORT', what: 'Reasoning effort for the loop-block escalation exit-planner mentor (bounded single-shot; max by design — a bounded planner cannot grind)', codeDefault: 'max', kind: 'value' },
      { key: 'CORTEX_LOOP_TOOL_BLOCK_BUDGET_TOKENS', what: 'Output-token budget for the exit-planner mentor (big enough that reasoning does not eat the plan on DeepSeek)', codeDefault: '4000', kind: 'value' },
      { key: 'CORTEX_LOOP_TOOL_BLOCK_TIMEOUT_MS', what: 'withTimeout cap on the exit-planner mentor call (fail-open to the generic redirect on timeout)', codeDefault: '90000', kind: 'value' },
      { key: 'CORTEX_POLL_GUARD', what: 'After 4 identical status checks: "stop polling, background it"', codeDefault: 'false', kind: 'flag-true' },
      { key: 'CORTEX_SURRENDER_NUDGE', what: 'Catches "here is what remains to do" endings: "execute your plan, do not describe it"', codeDefault: 'false', kind: 'flag-true' },
      { key: 'CORTEX_TASK_INTEGRITY', what: 'Anti-reward-hack framing line in the system prompt', codeDefault: 'false', kind: 'flag-true' },
      { key: 'CORTEX_ENDTURN_INTEGRITY', what: 'Web-source attestation on finishes (justify web use, never block)', codeDefault: 'false', kind: 'flag-true' },
      { key: 'CORTEX_BASH_PIPEFAIL', what: 'Pipelines report the failing command instead of masking it (cmd | head)', codeDefault: 'false', kind: 'flag-true' },
      { key: 'MAX_CONSECUTIVE_ERRORS', what: 'Failing tool calls in a row before the turn is cut (3 = blunt; 6 = tolerant of normal debugging)', codeDefault: '3', kind: 'value' },
    ],
  },
  {
    group: 'Loop control',
    levers: [
      { key: 'MAX_TOOL_ITERATIONS', what: 'Hard cap on tool calls per turn (failsafe, not a work limit)', codeDefault: '1000', kind: 'value' },
      { key: 'TOOL_BUDGET_SOFT', what: 'Soft budget signal to the model', codeDefault: '400', kind: 'value' },
      { key: 'CORTEX_TURN_DEADLINE_MS', what: 'Per-turn wall-clock deadline (ms); at the limit the loop force-synthesizes a best-effort finish. 0 = disabled. A bench task is ONE turn, so the adapter sets ~90% of the task budget → effectively a whole-task bound', codeDefault: '0 (off)', kind: 'value' },
      { key: 'CORTEX_EFFORT_TAIL', what: 'On an EndTurn bounce, arm N more elevated-reasoning continuations (N = CORTEX_EFFORT_TAIL_TURNS, default 2)', codeDefault: 'false', kind: 'flag-true' },
      { key: 'CORTEX_ACTION_EFFORT', what: 'Static reasoning effort for the PRIMARY (action) model (low|medium|high|max). Fills the request param when unset → overrides the model card default but NOT an explicit request param or the effort-pulse. Mentor levers (LIFT/RESOLVER/DEADLINE _EFFORT) are separate and stay max. Enables the pro-track wide-effort-delta A/B', codeDefault: '(unset — card decides)', kind: 'value' },
      { key: 'MAX_LOOP_REPETITIONS', what: 'Byte-identical repeated call limit (consecutive)', codeDefault: '5', kind: 'value' },
      { key: 'LOOP_REMIND_AT', what: 'Exact-repeat ladder: remind after N identical calls', codeDefault: '2', kind: 'value' },
      { key: 'LOOP_DIVERSIFY_AT', what: 'Exact-repeat ladder: diversify nudge at N', codeDefault: '4', kind: 'value' },
      { key: 'LOOP_BREAK_AT', what: 'Exact-repeat ladder: hard break at N', codeDefault: '6', kind: 'value' },
      { key: 'CORTEX_THRASH_CUM_FAILS', what: 'Cumulative session failures that trip the thrash detector (dilution-immune)', codeDefault: '12', kind: 'value' },
    ],
  },
  {
    group: 'Mentorship & dark features (shipped OFF until benched)',
    levers: [
      { key: 'MENTORSHIP_ENABLED', what: 'Master switch: a stronger helper model mentors the primary', codeDefault: 'false', kind: 'flag-true' },
      { key: 'MENTORSHIP_HELPER_MODEL', what: 'Which model gives the mentor hints', codeDefault: '(HELPER_MODEL_ID)', kind: 'value' },
      { key: 'CORTEX_MENTOR_FORCE', what: 'DARK: force an AskForAdvice consult on thrash (provider-unreliable on DeepSeek)', codeDefault: 'false', kind: 'flag-true' },
      { key: 'CORTEX_MENTOR_AUTO', what: 'DARK: orchestrator consults the mentor itself on thrash and injects the hint', codeDefault: 'false', kind: 'flag-true' },
      { key: 'CORTEX_ENDTURN_GATE', what: 'DARK: mandatory verify-before-finish attestation (EndTurn tool)', codeDefault: 'false', kind: 'flag-true' },
      { key: 'CORTEX_ENDTURN_REQUIREMENTS', what: 'DARK: Stage-4 requirements verification on EndTurn (true | strict = verbatim requirements + run-grounded verified_how)', codeDefault: 'false', kind: 'value' },
    ],
  },
  {
    group: 'Prompt, tools & frame (mostly card-driven — cards win over env)',
    levers: [
      { key: 'CORTEX_PROMPT_MASS', what: 'UNSET = the model card decides the prompt (boot-minimal narrow door for deepseek). Setting it overrides the card', codeDefault: '(unset — card wins)', kind: 'value' },
      { key: 'CORTEX_TOOL_ANCHOR', what: 'Turn-1 tool narrowing (bash-edit = Bash+Edit only on turn 1)', codeDefault: '(card decides)', kind: 'value' },
      { key: 'TOOL_TIMEOUT_MODE', what: 'Bash deadline policy: auto = promote to background in headless sessions (kill in interactive); background/kill force', codeDefault: 'auto', kind: 'value' },
      { key: 'VISION_HELPER_MODEL', what: 'vision hand-off: text-only primaries keep ReadImage; the image + question go to this helper card via the helper middleware and text comes back (false = vision primaries only)', codeDefault: 'deepseek-v4-flash-vision-exp', kind: 'value' },
      { key: 'VISION_HANDOFF_MAX', what: 'per-turn cap on ReadImage→vision-helper hand-offs; past it ReadImage returns a consolidate reminder (0 = unlimited)', codeDefault: '8', kind: 'value' },
      { key: 'CORTEX_SLICE_NUDGE', what: 'after 3 bash slice-reads of one file, remind to Read it once', codeDefault: 'true', kind: 'flag-not-false' },
      { key: 'CORTEX_ORIENT_BOOTSTRAP', what: 'orient prints a bare-box bootstrap directive when a needed toolchain is absent (DARK, A/B-able; factual tooling line is always on)', codeDefault: '0 (off)', kind: 'flag-true' },
      { key: 'ENABLE_WEBTOOLS', what: 'web surface mode: auto = WebFetch on, search/browse/hosted-search on iff a search key is present; true = all on; false = all off (benches pin explicitly)', codeDefault: 'auto', kind: 'value' },
      { key: 'ENABLE_DEFERRED_TOOL_LOADING', what: '16 curated tools offered; the rest discoverable via SearchTools', codeDefault: 'true (settings default)', kind: 'flag-not-false' },
      { key: 'CORTEX_LIFT_NUDGE', what: 'One-line signpost after the turn-1 lift pointing at SearchTools/AskForAdvice', codeDefault: 'false (cards set true)', kind: 'flag-true' },
      { key: 'CORTEX_LIFT_PLAN', what: 'DARK: at the turn-1 lift, a bounded max-reasoning mentor plans the task (adversarial analysis + confirm real grader criteria + step plan or RETIRE) and injects it as a system-reminder for the narrow-door model to follow (LIFT_MENTOR_PLANNER spec)', codeDefault: 'false', kind: 'flag-true' },
      { key: 'CORTEX_ENDTURN_RESOLVER', what: 'DARK: at EndTurn, a bounded max-reasoning mentor adjudicates does-the-work-meet-the-task-requirements? — MEETS = finish, GAP = reject + a fix plan injected as a system-reminder (the finish-side twin of CORTEX_LIFT_PLAN; reroutes the rejection-loop reasoning from the narrow-door model to the mentor). Bounded by CORTEX_ENDTURN_RESOLVER_MAX_REJECTS then fallback-accept', codeDefault: 'false', kind: 'flag-true' },
      { key: 'CORTEX_ENDTURN_RESOLVER_ABSTAIN', what: 'DARK: gives the EndTurn resolver a third verdict, RETIRE, for a structurally UNCLOSABLE finish (missing capability / wrong-approach loop / impossible constraint) and HONORS it — accept the finish + stop the reject cycles instead of burning pro@max re-rejecting a task the junior cannot fix. Confidence gate in the prompt (when in doubt → GAP)', codeDefault: 'false', kind: 'flag-true' },
      { key: 'CORTEX_DEADLINE_EXIT_MENTOR', what: 'DARK: the "smart deadline". At the WARN rung (~0.9 of the per-turn deadline, residual left) a bounded, residual-scaled mentor decides CONTINUE (on-track — do not truncate a late win) / FINISH (meets criteria → end) / ACTION (one minimal step then finish) / RETIRE (stuck → end cleanly) instead of the dumb wrap-up nudge. Hard-floor break at the deadline stays as failsafe', codeDefault: 'false', kind: 'flag-true' },
      { key: 'CORTEX_TOOL_REDIRECTS', what: 'cat→Read style steering (OFF for bash-anchored cards — measured +26% calls at zero accuracy)', codeDefault: '(card decides; off for bash-edit)', kind: 'value' },
      { key: 'CORTEX_HEADLESS_DROP_ASKUSER', what: 'Drop AskUserQuestion in non-interactive sessions (no human to answer)', codeDefault: 'false (card overrides)', kind: 'flag-true' },
    ],
  },
  {
    group: 'Web tools',
    levers: [
      { key: 'WEB_TOOLS_MODEL', what: 'Which provider backs WebSearch/WebFetch. Unset = auto-pick by available keys, else DuckDuckGo fallback', codeDefault: '(auto by keys)', kind: 'value' },
      { key: 'GEMINI_API_KEY', what: 'Google key: enables Gemini search grounding + WebFetch summarization primary path', codeDefault: '(unset)', kind: 'secret' },
      { key: 'GOOGLE_API_KEY', what: 'Google key (legacy name)', codeDefault: '(unset)', kind: 'secret' },
    ],
  },
  {
    group: 'Session & approvals',
    levers: [
      { key: 'YOLO', what: 'Auto-approve all tool permissions', codeDefault: 'false', kind: 'flag-true' },
      { key: 'CORTEX_HEADLESS_APPROVE', what: 'Headless (no-terminal) servers auto-approve tools. Only "false" disables', codeDefault: 'true when headless', kind: 'flag-not-false' },
      { key: 'CORTEX_MODE', what: 'stateless = fresh session per request; persistent = one continuing session', codeDefault: 'persistent', kind: 'value' },
      { key: 'DEFAULT_MODEL_ID', what: 'The model new sessions use', codeDefault: '(registry default)', kind: 'value' },
    ],
  },
];

export function collectEffectiveConfig(env: NodeJS.ProcessEnv = process.env): EffectiveConfigGroup[] {
  return GROUPS.map(({ group, levers }) => ({
    group,
    levers: levers.map((s): EffectiveLever => {
      const raw = env[s.key];
      const present = raw !== undefined && raw !== '';
      const source: EffectiveLever['source'] = present ? 'env' : 'code-default';
      if (s.kind === 'secret') {
        return {
          key: s.key, what: s.what, codeDefault: s.codeDefault,
          effective: present ? 'SET (redacted)' : 'unset',
          source, active: present, redacted: true,
        };
      }
      const effective = present ? String(raw) : s.codeDefault;
      const lever: EffectiveLever = { key: s.key, what: s.what, codeDefault: s.codeDefault, effective, source };
      if (s.kind === 'flag-true') lever.active = (raw ?? '').trim().toLowerCase() === 'true';
      if (s.kind === 'flag-not-false') lever.active = (raw ?? '').trim().toLowerCase() !== 'false';
      return lever;
    }),
  }));
}
