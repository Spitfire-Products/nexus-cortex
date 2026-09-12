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
    group: 'Mentor role (MENTORSHIP_HELPER_MODEL — the bounded single-shot judges/planners; distinct from the HELPER role)',
    levers: [
      { key: 'CORTEX_MENTOR_REASONING', what: 'Planner surfaces (lift / EndTurn resolver / deadline exit / loop-exit) send their *_EFFORT on the wire (thinking ON) — on | none (= the pre-4.103.0 thinking-off behaviour every mentor result to date was measured under)', codeDefault: 'on', kind: 'value' },
      { key: 'CORTEX_MENTOR_EFFORT', what: 'ONE effort for every planner surface (low|medium|high|max) — the mentor-effort A/B lever; a surface\'s own *_EFFORT, when set, wins over it', codeDefault: '(unset → per-surface, max)', kind: 'value' },
      { key: 'CORTEX_ASK_FOR_ADVICE', what: 'Include the model-initiated AskForAdvice consult tool while mentorship is on; =false drops it (measured thinking-off, voluntary heed v1 0/6 — keep it out of mentor A/Bs)', codeDefault: 'true', kind: 'flag-not-false' },
      { key: 'CORTEX_MENTOR_CONSULT_REASONING', what: 'AskForAdvice consult hint reasons (on) or stays thinking-off (none; 08-30: thinking-on hints came back blank under the 400-token consult budget)', codeDefault: 'none', kind: 'value' },
      { key: 'CORTEX_MENTOR_TEMPERATURE', what: 'Optional sampling temperature for mentor calls; empty = adapter default 0.7', codeDefault: '(unset)', kind: 'value' },
      { key: 'CORTEX_LIFT_PLAN_DOCTRINE', what: 'Lift planner doctrine: v1 = 4.107.0 prompt (default) | v2 = + the census bullets (one install layer, no long sleeps, byte-level exact output, literals verbatim). 4.107.2 lever for the cell-n-r6 2×2', codeDefault: 'v1', kind: 'value' },
      { key: 'CORTEX_ENDTURN_TIER', what: 'EndTurn discovery tier: essential = in the turn-1 tool set (default since 4.107.3; cell-n-r6 + tb21-k5-n1) | standard = deferred behind SearchTools (the 4.107.0 baseline)', codeDefault: 'essential', kind: 'value' },
      { key: 'CORTEX_COMPACTION_RESUME', what: 'Proactive-compaction resume memory: true (default) = helper-model summary of the dropped messages + the original task verbatim are prepended as a system reminder, a compaction event is recorded and .cortex/memory/resume-<session>.md is written | false = silent drop (the pre-4.108.0 behavior)', codeDefault: 'true', kind: 'value' },
      { key: 'CORTEX_LIFT_PLAN_REASONING', what: 'Lift planner: this surface\'s own thinking switch (on | none), wins over CORTEX_MENTOR_REASONING (4.107.0; cell-m-r1 §6: planner ON + resolver OFF is the candidate config)', codeDefault: '(follows CORTEX_MENTOR_REASONING)', kind: 'value' },
      { key: 'CORTEX_ENDTURN_RESOLVER_REASONING', what: 'EndTurn resolver: this surface\'s own thinking switch (on | none), wins over CORTEX_MENTOR_REASONING (4.107.0; cell-m-r1 §6: planner ON + resolver OFF is the candidate config)', codeDefault: '(follows CORTEX_MENTOR_REASONING)', kind: 'value' },
      { key: 'CORTEX_DEADLINE_EXIT_MENTOR_REASONING', what: 'Deadline exit mentor: this surface\'s own thinking switch (on | none), wins over CORTEX_MENTOR_REASONING (4.107.0; cell-m-r1 §6: planner ON + resolver OFF is the candidate config)', codeDefault: '(follows CORTEX_MENTOR_REASONING)', kind: 'value' },
      { key: 'CORTEX_LOOP_TOOL_BLOCK_REASONING', what: 'Loop-exit planner: this surface\'s own thinking switch (on | none), wins over CORTEX_MENTOR_REASONING (4.107.0; cell-m-r1 §6: planner ON + resolver OFF is the candidate config)', codeDefault: '(follows CORTEX_MENTOR_REASONING)', kind: 'value' },
      { key: 'CORTEX_MENTOR_THINKING_TIMEOUT_MS', what: 'Thinking-aware surface timeout for a thinking-on mentor call = max(surface timeout, this); the first request is aborted at 60% so the thinking-off retry fits (cell-m-r1 2026-09-10: pro@high/flash@max ran past the 90 s surface timeout and banked none). Empty = per-effort table low 120000 / medium 180000 / high 240000 / max 300000', codeDefault: '(per-effort table)', kind: 'value' },
      { key: 'CORTEX_MENTOR_REASONING_ALLOWANCE', what: 'HB-MENTOR-BUDGET: extra max_tokens a thinking-on mentor call gets for reasoning (DeepSeek counts reasoning inside max_tokens; cell-m 2026-09-10: capped at the 4000 content budget, pro returned 0/10 plans). Empty = per-effort table low 4000 / medium 8000 / high 12000 / max 24000; a blank result retries once thinking-off', codeDefault: '(per-effort table)', kind: 'value' },
      { key: 'CORTEX_LIFT_PLAN_EFFORT', what: 'Lift planner reasoning effort (sent only when CORTEX_MENTOR_REASONING=on)', codeDefault: 'max', kind: 'value' },
      { key: 'CORTEX_LIFT_PLAN_BUDGET_TOKENS', what: 'Lift planner output budget', codeDefault: '4000', kind: 'value' },
      { key: 'CORTEX_ENDTURN_RESOLVER_EFFORT', what: 'EndTurn resolver reasoning effort', codeDefault: 'max', kind: 'value' },
      { key: 'CORTEX_ENDTURN_RESOLVER_BUDGET_TOKENS', what: 'EndTurn resolver output budget', codeDefault: '4000', kind: 'value' },
      { key: 'CORTEX_DEADLINE_EXIT_MENTOR_EFFORT', what: 'Deadline exit planner reasoning effort', codeDefault: 'max', kind: 'value' },
      { key: 'CORTEX_DEADLINE_EXIT_MENTOR_BUDGET_TOKENS', what: 'Deadline exit planner output budget cap', codeDefault: '2000', kind: 'value' },
    ],
  },
  {
    group: 'Guards (the protection stack — see CONFIG_AUDIT_2026-08-31)',
    levers: [
      { key: 'CORTEX_NEARDUP_BREAKER', what: 'Detects "same approach retried with small tweaks" and forces a strategy change (targets the retry-loop class)', codeDefault: 'false', kind: 'flag-true' },
      { key: 'CORTEX_GIT_CONTEXT', what: 'Per-turn "Repository State" harness-note (git branch / uncommitted changes / recent commits / cross-agent staleness). Built for a SHARED working tree; its "another agent may be editing" framing is false in a solo headless/bench container. Default on; set false to drop it', codeDefault: 'true', kind: 'flag-not-false' },
      { key: 'CORTEX_SLASH_COMMAND_HINT', what: 'Turn-0 "Available Slash Commands" harness-note so the model can suggest /commands to a USER. Pointless in headless/bench (no user). Default on; set false to drop it', codeDefault: 'true', kind: 'flag-not-false' },
      { key: 'CORTEX_LOOP_TOOL_BLOCK', what: 'On a detected loop, disables the looping tool\'s EXECUTOR for one turn (cache-safe; tools list unchanged) and returns a redirect error steering to the complementary tools; escalates after 2 blocks to a bounded pro-max exit-planner mentor (REPLAN|RETIRE)', codeDefault: 'false', kind: 'flag-true' },
      { key: 'CORTEX_EMPTY_TURN_CONTINUE', what: 'HB-ENDTURN-TERMINAL: a reasoning-only empty turn WITH budget remaining (<60% turn-deadline + <60% max-iterations) is classified reasoning_only_active → the empty-turn retry nudges "continue" with tools available (bounded to 3) instead of the terminal "write your answer, no tools" surrender that killed mid-recon builds. Exhausted/near-budget still force-synthesizes', codeDefault: 'false', kind: 'flag-true' },
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
      { key: 'HELPER_MODEL_ID', what: 'HELPER role model (compaction, summaries, error guidance, vision hand-off; thinking OFF) — distinct from the MENTOR role (MENTORSHIP_HELPER_MODEL). Bench gates assert this key (cell-m-p2 2026-09-10 halted because it was unreported)', codeDefault: 'deepseek-flash', kind: 'value' },
      { key: 'VISION_HELPER_MODEL', what: 'vision hand-off: text-only primaries keep ReadImage; the image + question go to this helper card via the helper middleware and text comes back (false = vision primaries only)', codeDefault: 'deepseek-flash', kind: 'value' },
      { key: 'VISION_HANDOFF_MAX', what: 'per-turn cap on ReadImage→vision-helper hand-offs; past it ReadImage returns a consolidate reminder (0 = unlimited)', codeDefault: '8', kind: 'value' },
      { key: 'CORTEX_SLICE_NUDGE', what: 'after 3 bash slice-reads of one file, remind to Read it once', codeDefault: 'true', kind: 'flag-not-false' },
      { key: 'CORTEX_SLICE_BLOCK', what: 'HB-SLICE-BLOCK: coercive escalation of the slice-nudge — after CORTEX_SLICE_BLOCK_AT slices of a STATIC/source file, BLOCK further slice-reads of it (force Read), bounded to CORTEX_SLICE_BLOCK_MAX/file; append-mostly logs exempt. Evidence: soft nudge ignored ~80% of re-tested cases', codeDefault: 'true', kind: 'flag-not-false' },
      { key: 'CORTEX_SLICE_BLOCK_AT', what: 'slice count at which CORTEX_SLICE_BLOCK starts blocking a file (leaves the soft nudge at 3 + shallow-stoppers alone)', codeDefault: '5', kind: 'value' },
      { key: 'CORTEX_SLICE_BLOCK_MAX', what: 'max coercive slice-blocks per file before letting it through (bounded, no infinite loop)', codeDefault: '2', kind: 'value' },
      { key: 'CORTEX_ORIENT_BOOTSTRAP', what: 'orient prints a bare-box bootstrap directive when a needed toolchain is absent (DARK, A/B-able; factual tooling line is always on)', codeDefault: '0 (off)', kind: 'flag-true' },
      { key: 'ENABLE_WEBTOOLS', what: 'web surface mode: auto = WebFetch on, search/browse/hosted-search on iff a search key is present; true = all on; false = all off (benches pin explicitly)', codeDefault: 'auto', kind: 'value' },
      { key: 'ENABLE_DEFERRED_TOOL_LOADING', what: '16 curated tools offered; the rest discoverable via SearchTools', codeDefault: 'true (settings default)', kind: 'flag-not-false' },
      { key: 'CORTEX_LIFT_NUDGE', what: 'One-line signpost after the turn-1 lift pointing at SearchTools/AskForAdvice', codeDefault: 'false (cards set true)', kind: 'flag-true' },
      { key: 'CORTEX_LIFT_PLAN', what: 'DARK: at the turn-1 lift, a bounded max-reasoning mentor plans the task (adversarial analysis + confirm real grader criteria + step plan or RETIRE) and injects it as a system-reminder for the narrow-door model to follow (LIFT_MENTOR_PLANNER spec)', codeDefault: 'false', kind: 'flag-true' },
      { key: 'CORTEX_ENDTURN_RESOLVER', what: 'DARK: at EndTurn, a bounded max-reasoning mentor adjudicates does-the-work-meet-the-task-requirements? — MEETS = finish, GAP = reject + a fix plan injected as a system-reminder (the finish-side twin of CORTEX_LIFT_PLAN; reroutes the rejection-loop reasoning from the narrow-door model to the mentor). Bounded by CORTEX_ENDTURN_RESOLVER_MAX_REJECTS then fallback-accept', codeDefault: 'false', kind: 'flag-true' },
      { key: 'CORTEX_ENDTURN_CITATION_LINEWISE', what: 'EndTurn Stage-2 citation grounding matches multi-line quotes line-wise (every non-trivial line verbatim; contiguity relaxed) and the corpus includes Bash-authored text + the task statement', codeDefault: 'true', kind: 'flag-not-false' },
      { key: 'CORTEX_JUDGE_DELTA', what: 'HB-JUDGE-GROUNDING: the EndTurn resolver + deadline exit planner see the workspace delta (files changed this task + heads), a fresh recon and the latest outputs', codeDefault: 'true', kind: 'flag-not-false' },
      { key: 'CORTEX_JUDGE_RUN_CHECK', what: 'HB-JUDGE-GROUNDING: at the EndTurn resolver, run an evident check entry point (Makefile test / test.sh / pytest) and hand the judge its result', codeDefault: 'true', kind: 'flag-not-false' },
      { key: 'CORTEX_JUDGE_CHECK_TIMEOUT_MS', what: 'Cap on the judge check run', codeDefault: '45000', kind: 'value' },
      { key: 'CORTEX_JUDGE_DELTA_MAX_FILES', what: 'Files whose head is included in the judge delta', codeDefault: '8', kind: 'value' },
      { key: 'CORTEX_JUDGE_DELTA_HEAD_LINES', what: 'Lines of each changed file shown in the judge delta', codeDefault: '60', kind: 'value' },
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
