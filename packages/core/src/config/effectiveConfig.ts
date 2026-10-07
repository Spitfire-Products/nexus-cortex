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

import { profileAppliedKeys } from './interactiveProfile.js';

export interface EffectiveLever {
  key: string;
  /** Plain-language: what this switch does. */
  what: string;
  /** The value the code uses when the env var is absent. */
  codeDefault: string;
  /** The value the running process actually resolved. */
  effective: string;
  /** Where the effective value came from. */
  source: 'env' | 'code-default' | 'profile'; // 'profile' = filled by CORTEX_INTERACTIVE_PROFILE (R219), not set by the user
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
      { key: 'CORTEX_LIFT_PLAN_TOOL_ROUNDS', what: 'Planner calls at the lift; >1 offers INVESTIGATE (harness runs read-only CHECK/READ lines between rounds) — R171 HB-LIFT-PLAN-TOOL-LOOP; 1 = single-shot', codeDefault: '1', kind: 'value' },
      { key: 'CORTEX_LIFT_PLAN_TOOL_ROUND_BUDGET_MS', what: 'Aggregate wall clock for the planner\'s investigation rounds (R171)', codeDefault: '240000', kind: 'value' },
      { key: 'CORTEX_ENDTURN_TIER', what: 'EndTurn discovery tier: essential = in the turn-1 tool set (default since 4.107.3; cell-n-r6 + tb21-k5-n1) | standard = deferred behind SearchTools (the 4.107.0 baseline)', codeDefault: 'essential', kind: 'value' },
      { key: 'CORTEX_COMPACTION_RESUME', what: 'Proactive-compaction resume memory: true (default) = helper-model summary of the dropped messages + the original task verbatim are prepended as a system reminder, a compaction event is recorded (rows carry estimateSource usage-anchored|heuristic + anchorTokens since R132) and .cortex/memory/resume-<session>.md is written | false = silent drop (the pre-4.108.0 behavior)', codeDefault: 'true', kind: 'value' },
      { key: 'CORTEX_COMPACTION_CHECKPOINT_PCT', what: 'Pre-compaction checkpoint rung (4.108.2): first resume memory written at this fraction of the compaction threshold, before any drop; refreshed every CORTEX_COMPACTION_CHECKPOINT_STEP', codeDefault: '0.75', kind: 'value' },
      { key: 'CORTEX_COMPACTION_THRESHOLD_TOKENS', what: 'Test/ops override of the compaction threshold in tokens (4.108.3); empty = card-derived', codeDefault: '(unset)', kind: 'value' },
      { key: 'CORTEX_COMPACTION_HANDOFF_QA', what: 'DARK (R143 HB-HANDOFF-QA-SUMMARY): true = after each resume memory (checkpoint rung and rolled compaction) a FRESH history-free helper call asks what the memory is missing, a second helper call answers from the covered history, and the memory gains a GAPS (Q/A) section (compaction rows bank handoffQA {questions, answered, notRecorded, cost}); false = the plain memory', codeDefault: 'false', kind: 'value' },
      { key: 'CORTEX_COMPACTION_HANDOFF_QA_MAX_QUESTIONS', what: 'Cap on the gap questions asked per handoff QA round (R143; 1-20)', codeDefault: '6', kind: 'value' },
      { key: 'CORTEX_STATE_DIR', what: 'Explicit runtime-state root (4.108.6); empty = <project>/.cortex with writable-probe fallback to ~/.cortex/projects/<hash> or tmpdir', codeDefault: '(unset)', kind: 'value' },
      { key: 'CORTEX_COMPACTION_CHECKPOINT_STEP', what: 'Checkpoint refresh band as a fraction of the threshold (4.108.2)', codeDefault: '0.10', kind: 'value' },
      { key: 'CORTEX_TURN_CONTRACT', what: "'' = shipped door (suppress deliberation); channel = think freely then ANALYSIS+PLAN+action every turn, length recovery re-issues at the same effort (HB-TURN-CONTRACT)", codeDefault: '', kind: 'value' },
      { key: 'CORTEX_DELEGATION_HINT', what: 'DARK (4.108.1): true = the boot-minimal prompt gains one clause naming the Task tool for large/independent/output-heavy sub-tasks (delegation doctrine); false = the measured narrow door. Task dispatches are banked as task_spawn events either way.', codeDefault: 'false', kind: 'value' },
      { key: 'CORTEX_LIFT_PLAN_REASONING', what: 'Lift planner: this surface\'s own thinking switch (on | none), wins over CORTEX_MENTOR_REASONING (4.107.0; cell-m-r1 §6: planner ON + resolver OFF is the candidate config)', codeDefault: '(follows CORTEX_MENTOR_REASONING)', kind: 'value' },
      { key: 'CORTEX_ENDTURN_RESOLVER_REASONING', what: 'EndTurn resolver: this surface\'s own thinking switch (on | none), wins over CORTEX_MENTOR_REASONING (4.107.0; cell-m-r1 §6: planner ON + resolver OFF is the candidate config)', codeDefault: '(follows CORTEX_MENTOR_REASONING)', kind: 'value' },
      { key: 'CORTEX_DEADLINE_EXIT_MENTOR_REASONING', what: 'Deadline exit mentor: this surface\'s own thinking switch (on | none), wins over CORTEX_MENTOR_REASONING (4.107.0; cell-m-r1 §6: planner ON + resolver OFF is the candidate config)', codeDefault: '(follows CORTEX_MENTOR_REASONING)', kind: 'value' },
      { key: 'CORTEX_LOOP_TOOL_BLOCK_REASONING', what: 'Loop-exit planner: this surface\'s own thinking switch (on | none), wins over CORTEX_MENTOR_REASONING (4.107.0; cell-m-r1 §6: planner ON + resolver OFF is the candidate config)', codeDefault: '(follows CORTEX_MENTOR_REASONING)', kind: 'value' },
      { key: 'CORTEX_MENTOR_THINKING_TIMEOUT_MS', what: 'Thinking-aware surface timeout for a thinking-on mentor call = max(surface timeout, this); the first request is aborted at 60% so the thinking-off retry fits (cell-m-r1 2026-09-10: pro@high/flash@max ran past the 90 s surface timeout and banked none). Empty = per-effort table low 120000 / medium 180000 / high 240000 / max 300000', codeDefault: '(per-effort table)', kind: 'value' },
      { key: 'CORTEX_MENTOR_REASONING_ALLOWANCE', what: 'HB-MENTOR-BUDGET: extra max_tokens a thinking-on mentor call gets for reasoning (DeepSeek counts reasoning inside max_tokens; cell-m 2026-09-10: capped at the 4000 content budget, pro returned 0/10 plans). Empty = per-effort table low 4000 / medium 8000 / high 12000 / max 24000; a blank result retries once thinking-off', codeDefault: '(per-effort table)', kind: 'value' },
      { key: 'CORTEX_LIFT_PLAN_EFFORT', what: 'Lift planner reasoning effort (sent only when CORTEX_MENTOR_REASONING=on)', codeDefault: 'max', kind: 'value' },
      { key: 'CORTEX_LIFT_PLAN_SCOPE', what: 'Lift planner EDIT SCOPE bullet: true = strict (repair tasks: only named files; never vendored code, runners, tests, fixtures, data; revert unrequired changes); adaptive = named files bind, otherwise smallest set, tests/runners/fixtures/data only when the task asks, revert only EXISTING files (DARK); task = task-conditioned (2026-10-03): named files bind, forbidden/vendored/tests/runners/fixtures/data off-limits unless the task points there, otherwise every file the fix needs; revert only incidental changes after a re-run-without-it check; the judge gets a SCOPE RULE that never counts files', codeDefault: 'off', kind: 'value' },
      { key: 'CORTEX_LIFT_PLAN_BUDGET_TOKENS', what: 'Lift planner output budget', codeDefault: '4000', kind: 'value' },
      { key: 'CORTEX_ENDTURN_RESOLVER_EFFORT', what: 'EndTurn resolver reasoning effort', codeDefault: 'max', kind: 'value' },
      { key: 'CORTEX_LIFT_PLAN_MODEL', what: 'R232 HB-MENTOR-SURFACE-MODEL: model for the lift planner (unset = MENTORSHIP_HELPER_MODEL / the caller)', codeDefault: '', kind: 'value' },
      { key: 'CORTEX_ENDTURN_RESOLVER_MODEL', what: 'R232 HB-MENTOR-SURFACE-MODEL: model for the EndTurn resolver (judge) + walled-thinking summary (unset = MENTORSHIP_HELPER_MODEL / the caller)', codeDefault: '', kind: 'value' },
      { key: 'CORTEX_DEADLINE_EXIT_MENTOR_MODEL', what: 'R232 HB-MENTOR-SURFACE-MODEL: model for the deadline-exit mentor (unset = MENTORSHIP_HELPER_MODEL / the caller)', codeDefault: '', kind: 'value' },
      { key: 'CORTEX_LOOP_TOOL_BLOCK_MODEL', what: 'R232 HB-MENTOR-SURFACE-MODEL: model for the loop-exit planner (unset = MENTORSHIP_HELPER_MODEL / the caller)', codeDefault: '', kind: 'value' },
      { key: 'CORTEX_MENTOR_CONSULT_MODEL', what: 'R232 HB-MENTOR-SURFACE-MODEL: model for the AskForAdvice consult (unset = MENTORSHIP_HELPER_MODEL / the caller)', codeDefault: '', kind: 'value' },
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
      { key: 'CORTEX_SUBAGENT_TIMEOUT_MS', what: 'Task sub-agent wall-clock limit (ms) when no parent turn deadline is set; default 300000 (R133: with a deadline the limit derives from the parent\'s remaining budget, 90% minus 30 s)', codeDefault: '300000', kind: 'value' },
      { key: 'CORTEX_SUBAGENT_TIMEOUT_MAX_MS', what: 'Upper cap (ms) on the deadline-derived Task sub-agent limit; unset = no cap (R133)', codeDefault: '(unset — no cap)', kind: 'value' },
      { key: 'CORTEX_OUTER_TOOL_TIMEOUT_MS', what: 'Floor (ms) for the outer per-batch tool abort; the deadline becomes max(computed, floor + 30 s grace). Unset = no floor (150 s for non-Bash tools without their own limit).', codeDefault: '(unset — no floor)', kind: 'value' },
      { key: 'CORTEX_API_NETWORK_RETRY_MS', what: 'Wall-clock budget (ms) for retrying network-class API faults (connection error / terminated / 5xx) on an exponential ladder capped at 60 s per wait; 0 = legacy 3-attempt cap (R150)', codeDefault: '600000', kind: 'value' },
      { key: 'CORTEX_BUDGET_VISIBILITY', what: 'With a turn deadline: one-line WALL BUDGET reminder per 10% band + the open-items continue nudge (R151 HB-BUDGET-VISIBILITY); false disables', codeDefault: 'true', kind: 'flag-true' },
      { key: 'CORTEX_EFFORT_RAMP', what: 'HB-EFFORT-RAMP: a window of MAIN action calls (counted from 1 per turn; 1 = the initial request, never ramped) runs at a lower reasoning effort, then the configured effort. off | <level>:<from>-<to> (low:2-8) | <level>:<n> (calls 2..n+1) | on (= low:2-8). Precedence: R153 backoff > effort pulse > ramp > request param > card. One effort_ramp event at start and at hand-back. Global low was harmful on TB4.0 — this covers only the opening calls', codeDefault: 'off', kind: 'value' },
      { key: 'CORTEX_COMPUTE_NUDGE', what: "HB-COMPUTE-NUDGE: after a round whose response reasoned past CORTEX_COMPUTE_NUDGE_TOKENS (default 16000), append one 'compute/test instead of deliberating' line to the tail of the newest tool_result (HB-TURN-STATUS carrier, prefix-safe). Cooldown CORTEX_COMPUTE_NUDGE_COOLDOWN (3 rounds), cap CORTEX_COMPUTE_NUDGE_MAX (6/turn); compute_nudge event per firing. off | on", codeDefault: 'off', kind: 'value' },
      { key: 'CORTEX_REASONING_EXHAUST_LADDER', what: 'R153c: the R153 exhaustion backoff steps down the PROVIDER ladder — DeepSeek low | high | max (medium runs as high), so high → low; other providers keep low | medium | high. provider (default) | legacy (pre-R153c: high → medium, a no-op on DeepSeek)', codeDefault: 'provider', kind: 'value' },
      { key: 'CORTEX_WALL_DROP', what: 'HB-WALL-DROP: on a reasoning-exhaustion wall, drop the walled turn (reasoning only, no text/tool) from the in-memory history before the retry and carry the nudge on the newest tool_result tail (exact pre-wall prefix + nudge, cache-preserving); never drops a turn with a tool call; wall_drop event. off | on', codeDefault: 'off', kind: 'value' },
      { key: 'CORTEX_WALL_RETRY_LADDER', what: 'HB-WALL-RETRY-LADDER: max_tokens rungs for the retry after the n-th reasoning-exhaustion wall of a turn, e.g. 65536,16384 (last rung repeats); empty = off', codeDefault: '', kind: 'value' },
      { key: 'CORTEX_WALL_FORCE_ACTION_AT', what: 'HB-WALL-RETRY-LADDER: wall index (1-based) from which the retry carries tool_choice required (thinking off on DeepSeek) to force an action; 0 = never', codeDefault: '2', kind: 'value' },
      { key: 'CORTEX_SECOND_ATTEMPT', what: 'R239 / P4 HB-SECOND-ATTEMPT (the R194 chain in the library, 2026-10-07): 1 = after a finish whose last resolver verdict is in CORTEX_SECOND_ATTEMPT_TRIGGER, with >= MIN_REMAINING of the ORIGINAL deadline left and >= FLOOR after the RESERVE, snapshot-restore the workspace and run a fresh INDEPENDENT attempt (own state dir, sessions dir, reduced deadline); select by shipped check > verdict > fewest turns > named checks > earliest; response = the pick with usage.session summed. Non-streaming /v1/messages only. Off = byte-identical', codeDefault: '(unset = off)', kind: 'value' },
      { key: 'CORTEX_SECOND_ATTEMPT_MAX', what: 'HB-SECOND-ATTEMPT: maximum number of EXTRA attempts (0 = none; non-integer = 1)', codeDefault: '1', kind: 'value' },
      { key: 'CORTEX_SECOND_ATTEMPT_MIN_REMAINING', what: 'HB-SECOND-ATTEMPT: fraction of the ORIGINAL deadline that must remain for another attempt (wall clock from task start)', codeDefault: '0.5', kind: 'value' },
      { key: 'CORTEX_SECOND_ATTEMPT_TRIGGER', what: "HB-SECOND-ATTEMPT: resolver actions that open another attempt (comma list); 'none' = a give-up (the turn ended with no verdict)", codeDefault: 'accept-with-gap,accept-low-confidence', kind: 'value' },
      { key: 'CORTEX_SECOND_ATTEMPT_RESERVE_MS', what: "HB-SECOND-ATTEMPT: wall-clock reserve (ms) subtracted from the next attempt's deadline", codeDefault: '300000', kind: 'value' },
      { key: 'CORTEX_SECOND_ATTEMPT_FLOOR_MS', what: 'HB-SECOND-ATTEMPT: the next attempt must keep at least this (ms) after the reserve', codeDefault: '900000', kind: 'value' },
      { key: 'CORTEX_SECOND_ATTEMPT_OUT_DIR', what: 'HB-SECOND-ATTEMPT: directory for the banked per-attempt artifacts (response/decisions/session.attempt<k>.*, second-attempt.json); empty = <state dir>/attempts', codeDefault: '(unset = <state dir>/attempts)', kind: 'value' },
      { key: 'CORTEX_OUTPUT_CAP_TOKENS', what: 'HB-OUTPUT-CAP: per-call output cap (max tokens) for the action model, applied only when the request sets none; integer >= 1024; recommended 48000 (c22 acting-call reasoning p99.9 = 40K)', codeDefault: '(unset — card limit)', kind: 'value' },
      { key: 'CORTEX_WALL_SUMMARY', what: 'HB-WALL-SUMMARY: on a reasoning-exhaustion wall, one helper call condenses the walled reasoning into CONCLUDED / STUCK ON / NEXT lines carried inside the wall nudge (attributed, user-role; never the thinking channel); fail-open; timeout CORTEX_WALL_SUMMARY_TIMEOUT_MS (30000); wall_summary event. off | on', codeDefault: 'off', kind: 'value' },
      { key: 'CORTEX_RESPONSES_INLINE_REMINDERS', what: 'R215 HB-RESPONSES-REMINDERS: on the Responses path keep <system-reminder> blocks in place as user input_text items (moved after the function_call_output items they follow) instead of extracting them into `instructions` (xAI dropped them; OpenAI lost their position); instructions keep only the R63 system prompt. off | on', codeDefault: 'off', kind: 'value' },
      { key: 'CORTEX_CHAT_REMINDERS_TO_SYSTEM', what: 'R231 HB-CHAT-REMINDERS-SYSTEM: chat/completions mirror of the Responses-OFF reminder delivery — every <system-reminder> block carried in a USER text block is lifted out of the conversation and appended to the system message on each request (tool-result reminders stay in place). off = unchanged: in place with the tags stripped.', codeDefault: 'off', kind: 'value' },
      { key: 'CORTEX_RESPONSES_STOP_REASON', what: "R216 HB-RESPONSES-STOPREASON: map the Responses truncation signal (status incomplete + incomplete_details.reason max_output_tokens, also from the streaming terminal event) and the hf-space finish_reason to stop reasons, so the wall levers + truncated-continue fire there. off | on", codeDefault: 'off', kind: 'value' },
      { key: 'CORTEX_ANTHROPIC_HISTORY_CACHE', what: 'R218 HB-ANTHROPIC-CACHE: rolling message-level cache_control breakpoints (previous + newest user message) on the Anthropic Messages path within the 4-breakpoint cap (system + tool counted); needs ANTHROPIC_PROMPT_CACHING; never the xAI Messages branch. off | on', codeDefault: 'off', kind: 'value' },
      { key: 'CORTEX_GEMINI_SYSTEM_FIX', what: 'R229 HB-GEMINI-SYSTEM (correctness): deliver the system prompt to Gemini — REST generateContent system_instruction, non-tool requests via the v1beta REST builders, google-sdk config.systemInstruction (the top-level field was dropped by @google/genai). off | on', codeDefault: 'off', kind: 'value' },
      { key: 'CORTEX_STABLE_TOOL_ORDER', what: 'R230 HB-STABLE-TOOL-ORDER: xAI hybrid server+client tools (ENABLE_SERVER_SIDE_TOOLS) keep the caller tool order on every request instead of server-tools-first on each user turn\'s first request (tools prefix reorder). off | on', codeDefault: 'off', kind: 'value' },
      { key: 'CORTEX_OPENAI_CACHE_KEY', what: 'R225: OpenAI chat/completions + Responses send prompt_cache_key = session id (cache routing). OpenAI provider only. off | on', codeDefault: 'off', kind: 'value' },
      { key: 'CORTEX_ANTHROPIC_AUTO_CACHE', what: 'R225: Anthropic Messages adds top-level automatic cache_control beside the system + last-tool markers when a breakpoint slot is free (cap 4, R218 counted); never the xAI Messages branch. off | on', codeDefault: 'off', kind: 'value' },
      { key: 'CORTEX_ANTHROPIC_CACHE_TTL', what: 'R225: TTL for every Anthropic cache_control the harness emits (system, last tool, R218 history, automatic). 1h (writes 2x) | unset/5m (default)', codeDefault: '5m', kind: 'value' },
      { key: 'CORTEX_FORCED_CHOICE_FULL_TOOLS', what: 'R225: a forced named tool_choice keeps the full tools array instead of narrowing to the forced tool (cache-stable tools prefix). DeepSeek has ignored named choices with the full catalog; hf-space loses the force. off | on', codeDefault: 'off', kind: 'value' },
      { key: 'CORTEX_STREAM_USAGE', what: 'R224a/R236: streaming chat/completions send stream_options.include_usage and the final message carries the provider usage (was zeros). unset = on for openai|deepseek|groq, off elsewhere; on forces any provider; off disables', codeDefault: 'on (openai|deepseek|groq)', kind: 'value' },
      { key: 'CORTEX_OPENAI_TOOLS_REASONING', what: 'HB-OPENAI-TOOLS-REASONING: OpenAI chat/completions keeps reasoning_effort with tools (R19b drop skipped) and the gateway forwards the request/action effort for OpenAI reasoning cards (chat reasoning_effort / Responses reasoning.effort). OpenAI only. off | on', codeDefault: 'off', kind: 'value' },
      { key: 'CORTEX_ANTHROPIC_EFFORT', what: 'HB-ANTHROPIC-EFFORT: adaptive Claude families (4.7/4.8/5/fable-5) send output_config.effort = the request/action effort; budget families map effort max to min(120000, max_tokens-1024) budget_tokens (was 10000). Anthropic only. off | on', codeDefault: 'off', kind: 'value' },
      { key: 'CORTEX_ACTION_EFFORT_FIRST', what: 'HB-ACTION-EFFORT-FIRST: request 0 of each user turn also gets CORTEX_ACTION_EFFORT (was the card default). off | on', codeDefault: 'off', kind: 'value' },
      { key: 'CORTEX_GEMINI_TOOLS_THINKING', what: 'HB-GEMINI-TOOLS-THINKING: Gemini REST + SDK send generationConfig.thinkingConfig mapped from the request/action effort, with or without tools (3.x thinkingLevel, 2.5 thinkingBudget). off | on', codeDefault: 'off', kind: 'value' },
      { key: 'CORTEX_GEMINI_EXPLICIT_CACHE', what: 'HB-GEMINI-EXPLICIT-CACHE: Gemini REST + SDK builders snapshot (model, system, tools) + history before the newest turn as a cachedContents and send cachedContent + only the later turns without system/tools/toolConfig; re-snapshot on tail threshold / history rewrite / expiry, new snapshot on a head change, full-request fallback on any cache error. off | on', codeDefault: 'off', kind: 'value' },
      { key: 'CORTEX_GEMINI_CACHE_TTL_S', what: 'HB-GEMINI-EXPLICIT-CACHE: snapshot TTL seconds (PATCH-extended when used in the second half of its life)', codeDefault: '300', kind: 'value' },
      { key: 'CORTEX_GEMINI_CACHE_RESNAPSHOT_TOKENS', what: 'HB-GEMINI-EXPLICIT-CACHE: re-snapshot once the uncached tail exceeds this many (chars/4) tokens', codeDefault: '16000', kind: 'value' },
      { key: 'CORTEX_GEMINI_CACHE_MIN_TOKENS', what: 'HB-GEMINI-EXPLICIT-CACHE: override the per-model minimum cacheable size (3.x 4096, 2.5 2048)', codeDefault: '(per model)', kind: 'value' },
      { key: 'CORTEX_GEMINI_CACHE_QUIET', what: 'HB-GEMINI-EXPLICIT-CACHE: true silences the [gemini-cache] stderr lines', codeDefault: 'false', kind: 'value' },
      { key: 'CORTEX_WALL_CACHE_FIX', what: 'R221 append-only history: every in-place mutation of a history message (HB-WALL-DROP nudge + wall summary on the newest tool_result, steering carriers, R26 empty-turn repair, R154 image stub) drops that message\'s cached canonical conversion, so later requests carry the mutated bytes — the wall nudge no longer vanishes one request after the retry (no second prefix break). The wall drop itself is unchanged. off | on', codeDefault: 'off', kind: 'value' },
      { key: 'CORTEX_PERSIST_INJECTED', what: 'R223 append-only history: the injected first-request user content (repo-state note, deferred-tool announcement, MCP / slash-command notes) is remembered per message and re-sent on every later request; session storage + display keep the raw text. off | on', codeDefault: 'off', kind: 'value' },
      { key: 'CORTEX_APPEND_ONLY_TOOLS', what: 'R222 append-only history: with deferred tool loading, the tools array only grows — newly enabled tools are appended in first-enable order, nothing is evicted or reordered (deferral kept; the anchor lift is untouched). off | on', codeDefault: 'off', kind: 'value' },
      { key: 'CORTEX_KEEP_MENTOR_MESSAGES', what: 'R227: keep mentor/guidance messages in history at turn end instead of removing them from mid-history (cache-stable; costs stale guidance in context). off | on', codeDefault: 'off', kind: 'value' },
      { key: 'CORTEX_RESPONSES_SLICE_ALL', what: 'R228 (bug fix): every Responses request that chains previous_response_id (EndTurn gate, wall/empty retries, inaction retry, tools-off synthesis) sends only the input items added since the held response and moves the slice checkpoint; if the held response is unavailable (store off / expired / error) the chain is dropped and the FULL history is resent once without previous_response_id (responses_chain_fallback event). off | on', codeDefault: 'off', kind: 'value' },
      { key: 'CORTEX_PID1_GUARD', what: 'R209 HB-CONTAINER-PID1: at the first tool_result boundary (the boot observation), when PID 1 is not the harness, one note names PID 1 and the services it supervises (from /proc/1/cmdline + /proc/*/stat ppid==1) — killing them stops the container and ends the session; restart via the supervisor instead. Linux-only, fail-safe; pid1_guard event. off | on', codeDefault: 'off', kind: 'value' },
      { key: 'CORTEX_PLATEAU_STOP', what: 'R210 HB-PLATEAU-STOP: one boot instruction asks the model to print `PLATEAU_METRIC <name>=<number> dir=<max|min>` after every evaluation; the harness keeps a per-session series per metric and, when the best of the last CORTEX_PLATEAU_WINDOW reports improves on the best before them by < CORTEX_PLATEAU_REL (relative; worse counts), steers one stop-and-verify reminder (max 2/session); plateau_metric_seen / plateau_stop events. status = instruction + tracking + STATUS segment only (no reminder; would-be firings banked as plateau_detected). off | on | status', codeDefault: 'off', kind: 'value' },
      { key: 'CORTEX_PLATEAU_REL', what: 'R210: relative-improvement target over the trailing window (fraction; 0.002 = 0.2%)', codeDefault: '0.002', kind: 'value' },
      { key: 'CORTEX_PLATEAU_WINDOW', what: 'R210: most recent PLATEAU_METRIC reports compared against the best before them', codeDefault: '6', kind: 'value' },
      { key: 'CORTEX_PLATEAU_MIN_POINTS', what: 'R210: reports of a metric needed before any plateau stop can fire', codeDefault: '8', kind: 'value' },
      { key: 'CORTEX_KILL_GUARD', what: 'HB-KILL-GUARD: pkill / killall / pgrep wrappers first on the Bash tool PATH that never signal (or list) the calling shell, the harness server or the harness parent processes (bench adapter, its request, the recorder); model-started processes stay killable; skips reported on stderr. on | off', codeDefault: 'on', kind: 'value' },
      { key: 'CORTEX_TURN_STATUS', what: 'HB-TURN-STATUS: one STATUS line (elapsed/remaining on the turn clock, usage-anchored context estimate vs the card window, up to 3 background shells with age + state) at the TAIL of the newest tool_result on EVERY tool-result round; persisted in-memory like the band line so request prefixes stay byte-identical. off | auto (when a turn deadline exists) | on (always; elapsed only without a deadline); one turn_status event per turn', codeDefault: 'off', kind: 'value' },
      { key: 'CORTEX_BUDGET_CONTINUE_MIN_REMAINING', what: 'Fraction of the wall budget that must remain for the open-items continue nudge (R151); 0 = off', codeDefault: '0.5', kind: 'value' },
      { key: 'CORTEX_REASONING_EXHAUST_BACKOFF', what: 'After a truncated reasoning-only turn (output cap hit, nothing delivered): step the reasoning effort down one level for the next N continuations + an exhaustion nudge (R153 HB-REASONING-EXHAUSTION); false disables', codeDefault: 'true', kind: 'flag-true' },
      { key: 'CORTEX_REASONING_EXHAUST_BACKOFF_TURNS', what: 'Continuations run one effort level lower after a reasoning-exhaustion turn (R153)', codeDefault: '2', kind: 'value' },
      { key: 'CORTEX_BUDGET_CONTINUE_MAX_NUDGES', what: 'Continue-with-budget nudges allowed per turn; the second is firmer (R157 R151-v2); 0 = off', codeDefault: '2', kind: 'value' },
      { key: 'CORTEX_BASH_OOM_PRIORITY', what: 'Bash children volunteer for the OOM killer ahead of the orchestrator (oom_score_adj 1000; R156 HB-OOM-CHILD-PRIORITY); false disables', codeDefault: 'true', kind: 'flag-true' },
      { key: 'CORTEX_MENTOR_CONSULT_BUDGET_TOKENS', what: 'Output cap for an AskForAdvice mentor hint (2026-09-16: 400 cut hints mid-sentence)', codeDefault: '800', kind: 'value' },
      { key: 'CORTEX_ENDTURN_RESOLVER_MAX_REJECTS_BUDGETED', what: 'Resolver GAP vetoes allowed while >= the budget-continue fraction of the wall budget remains; below it the liveness cap (2) applies (R160 HB-RESOLVER-BUDGET-CAP)', codeDefault: '6', kind: 'value' },
      { key: 'CORTEX_BUDGET_FLOOR_S', what: 'R233 HB-BUDGET-FLOOR: seconds of wall budget under which every budget-aware verdict rule behaves as below-budget (liveness reject cap, no gap hold, veto floor, evidence cap 1) regardless of the fraction left; 0 = off', codeDefault: '0', kind: 'value' },
      { key: 'CORTEX_BUDGET_FLOOR_MODE', what: 'R233 v2: what the budget floor clamps — evidence (default: only the evidence-veto cap collapses to 1) | all (v1: every fraction rule sees below-budget)', codeDefault: 'evidence', kind: 'value' },
      { key: 'CORTEX_JUDGE_SEMANTIC', what: 'Judge decides semantics (no regex task-shape gate; regex nudges deferred when the judge ran; judge-named checks run; confidence-graded GAP; progress-conditioned vetoes + one thinking-on escalation) — R165; false = 4.111 gating', codeDefault: 'true', kind: 'flag-true' },
      { key: 'CORTEX_FINISH_CONFIRM', what: 'Accept-with-gap finish with >= MIN_REMAINING budget left is held once with an informed confirmation (budget, reviewer gaps, own open items) — R167 HB-FINISH-CONFIRM; false = off', codeDefault: 'true', kind: 'flag-true' },
      { key: 'CORTEX_FINISH_CONFIRM_MIN_REMAINING', what: 'Wall-budget fraction that must remain to confirm (R167)', codeDefault: '0.3', kind: 'value' },
      { key: 'CORTEX_FINISH_CONFIRM_MAX', what: 'Informed confirmations per session (R167)', codeDefault: '1', kind: 'value' },
      { key: 'CORTEX_MEETS_CONFIRM', what: 'A MEETS verdict must name a proving CHECK that passes; an unverified MEETS with >= MIN_REMAINING budget left is held once (shares FINISH_CONFIRM_MAX) — R168 HB-MEETS-CONFIRM; false = 4.116.2', codeDefault: 'true', kind: 'flag-true' },
      { key: 'CORTEX_MEETS_CONFIRM_MIN_REMAINING', what: 'Wall-budget fraction that must remain to hold an unverified MEETS (R168)', codeDefault: '0.5', kind: 'value' },
      { key: 'CORTEX_JUDGE_TOOL_ROUNDS', what: 'Judge calls per finish adjudication; >1 offers VERDICT: INVESTIGATE (harness runs read-only CHECK/READ lines between rounds) — R170 HB-JUDGE-TOOL-LOOP; 1 = single-shot', codeDefault: '1', kind: 'value' },
      { key: 'CORTEX_JUDGE_TOOL_ROUND_BUDGET_MS', what: 'Aggregate wall clock for one adjudication\'s investigation rounds (R170)', codeDefault: '240000', kind: 'value' },
      { key: 'CORTEX_JUDGE_TOOL_AUTOLOOP', what: 'First-round MEETS/GAP naming CHECK lines is re-asked once with the harness-run results (R170b; needs ROUNDS >= 2)', codeDefault: 'false', kind: 'flag-true' },
      { key: 'CORTEX_JUDGE_GAP_HOLD', what: 'Evidence-mode GAP naming open items is returned to the junior while >= BUDGET_CONTINUE_MIN_REMAINING of the budget remains and the budgeted cap allows (R173 HB-GAP-HOLD)', codeDefault: 'false', kind: 'flag-true' },
      { key: 'CORTEX_JUDGE_GAP_HOLD_JEV', what: 'Jev fixable_with_more_turns gate over the gap hold: off | shadow (bank only) | gate (R173b; needs TYPESAFE_API_KEY)', codeDefault: 'off', kind: 'value' },
      { key: 'CORTEX_JUDGE_GAP_HOLD_JEV_MIN', what: 'Probability floor for the Jev gap-hold gate (R173b)', codeDefault: '0.3', kind: 'value' },
      { key: 'CORTEX_JUDGE_SPEC_TESTS', what: 'Blind spec-derived CHECK lines authored from the task text alone at the first finish, run at every adjudication; a FAILED one is veto evidence (R174 HB-SPEC-TESTS)', codeDefault: 'false', kind: 'flag-true' },
      { key: 'CORTEX_JUDGE_SPEC_TESTS_MAX', what: 'Max blind spec checks per turn (R174)', codeDefault: '4', kind: 'value' },
      { key: 'CORTEX_JUDGE_SPEC_TESTS_SAMPLES', what: 'Independent spec-check author samples per turn; the veto reads their averaged fail fraction (R174d)', codeDefault: '3', kind: 'value' },
      { key: 'CORTEX_JUDGE_SPEC_VETO_FRAC', what: 'Averaged spec-fail fraction at or above which spec evidence vetoes, and holds a MEETS once (R174d)', codeDefault: '0.5', kind: 'value' },
      { key: 'CORTEX_JUDGE_SPEC_TEXT', what: 'R174e: shown (default) = spec-check commands + output reach the judge prompt and the writer veto message; hidden = spec evidence acts only through the averaged fraction gate (judge never sees the checks, a judge CHECK echoing one is not a named check, a fraction hold on a MEETS gets a neutral re-verify lead)', codeDefault: 'shown', kind: 'value' },
      { key: 'CORTEX_ENDTURN_REQ_COVERAGE', what: 'EndTurn Stage 4f: the harness extracts the task\'s own requirement clauses (bullets + must/exactly/do-not sentences, no model) and, once per turn, rejects a finish whose requirements attestation leaves some uncovered, quoting them verbatim; needs CORTEX_ENDTURN_REQUIREMENTS (DARK)', codeDefault: 'false', kind: 'flag-true' },
      { key: 'CORTEX_TOOL_DOCTRINE', what: 'Tool-description doctrine variant: mimo-v1 = the 3 edits both MiMo doctrine mines proposed (Read over bash, no reference mining outside the workspace, manifests as graded inputs); unset = shipped text (DARK)', codeDefault: '(unset)', kind: 'value' },
      { key: 'CORTEX_STEER_INPUTS', what: 'Steering-prompt input sizing: full = larger caps for plan/delta/env/observations/work product and a "[… N more chars not shown — hint]" marker on every remaining cut (planner, judge, exit planner, deadline mentor, spec, ledger, derivation); unset = the old silent slices (DARK)', codeDefault: '(unset)', kind: 'value' },
      { key: 'CORTEX_JUDGE_VETO_MIN_REMAINING', what: 'Budget floor: below this fraction of the wall budget no veto or hold of any kind holds the finish (R173c; 0 = off)', codeDefault: '0', kind: 'value' },
      { key: 'CORTEX_JUDGE_GAP_HOLD_MIN_INTERVAL_MS', what: 'A re-hold needs this much elapsed time since the last hold OR a changed open-items list (R173c)', codeDefault: '180000', kind: 'value' },
      { key: 'CORTEX_JUDGE_GAP_HOLD_PLAN_MAX_SIMILARITY', what: 'Token-Jaccard threshold below which the judge plan counts as changed for a re-hold (R173c)', codeDefault: '0.6', kind: 'value' },
      { key: 'CORTEX_JUDGE_SPEC_REPEAT_MAX', what: 'Consecutive identical spec-check failures before the check is suspect, not veto evidence (R174b)', codeDefault: '2', kind: 'value' },
      { key: 'CORTEX_JUDGE_REQ_LEDGER', what: 'Requirement ledger (R187): at lift the mentor extracts each requirement the TASK STATES as a typed line with a read-only CHECK; the writer sees the ledger with its plan; every finish runs the checks; a FAILED line is evidence; a finish that would stand with a line still OPEN (never exercised) is held once', codeDefault: 'off', kind: 'flag-true' },
      { key: 'CORTEX_JUDGE_REQ_LEDGER_MAX', what: 'Max ledger lines (R187)', codeDefault: '8', kind: 'value' },
      { key: 'CORTEX_JUDGE_REQ_LEDGER_JEV', what: 'Jev closes ledger lines the shell could not decide, from the writer attestation + harness evidence, one typed question per line (R187b)', codeDefault: 'on', kind: 'flag-not-false' },
      { key: 'CORTEX_JUDGE_REQ_LEDGER_JEV_MIN', what: 'Jev threshold to close a ledger line (R187b)', codeDefault: '0.7', kind: 'value' },
      { key: 'CORTEX_JUDGE_REQ_LEDGER_FAIL_VETO', what: 'return a would-be accept-with-gap when a ledger line FAILED at this finish (R192)', codeDefault: 'off', kind: 'flag-true' },
      { key: 'CORTEX_JUDGE_REQ_LEDGER_FAIL_VETO_MAX', what: 'max ledger-failed vetoes per session (R192)', codeDefault: '2', kind: 'value' },
      { key: 'CORTEX_JUDGE_REQ_LEDGER_FAIL_VETO_MIN_REMAINING', what: 'budget fraction below which the ledger-failed veto never fires (R192)', codeDefault: '0.25', kind: 'value' },
      { key: 'CORTEX_JUDGE_REQ_LEDGER_FAIL_JEV', what: 'Jev arbitration of a failed line: off | shadow | on (R192)', codeDefault: 'shadow', kind: 'value' },
      { key: 'CORTEX_JUDGE_REQ_LEDGER_FAIL_JEV_MIN', what: 'Jev threshold to call a failed check defective (R192)', codeDefault: '0.7', kind: 'value' },
      { key: 'CORTEX_JUDGE_REQ_LEDGER_HOLD_MAX', what: 'Max ledger holds per turn on open lines (R187)', codeDefault: '1', kind: 'value' },
      { key: 'CORTEX_JUDGE_SPEC_TESTS_AT', what: 'When the blind spec checks are authored: finish (first adjudication) | lift (background at task lift) (R174b)', codeDefault: 'finish', kind: 'value' },
      { key: 'CORTEX_JUDGE_INDEPENDENT_DERIVATION', what: 'On a value-shaped task, recompute the result by a different method before a standing finish; disagreement holds once (R176 HB-INDEPENDENT-DERIVATION): off | on', codeDefault: 'off', kind: 'value' },
      { key: 'CORTEX_JUDGE_INDEPENDENT_DERIVATION_TOL', what: 'Relative tolerance for numeric agreement in the independent derivation (R176)', codeDefault: '0.001', kind: 'value' },
      { key: 'CORTEX_FRAME', what: 'Action frame: tools (default) | terminus — one tmux pane as the only action surface, FrameAction + EndTurn, screen + state card + menu per turn (R179 HB-TERMINUS-FRAME)', codeDefault: 'tools', kind: 'value' },
      { key: 'CORTEX_FRAME_CHOOSER', what: 'Frame menu chooser: off (default) | jev — a typed reader picks among candidates + templates, fail-open to the first candidate (R178)', codeDefault: 'off', kind: 'value' },
      { key: 'CORTEX_FRAME_CANDIDATES', what: 'Max candidate actions per FrameAction, 1..3 (R179)', codeDefault: '1', kind: 'value' },
      { key: 'CORTEX_FRAME_WAIT_CAP_S', what: 'Cap on waiting for one action, seconds (R179)', codeDefault: '300', kind: 'value' },
      { key: 'CORTEX_FRAME_SCREEN_LINES', what: 'Pane lines captured per observation (R179)', codeDefault: '45', kind: 'value' },
      { key: 'CORTEX_FRAME_MIN_CANDIDATES', what: 'Distinct writer candidates the terminal-frame menu step needs before it executes (1..3; unset = 2 when the chooser is on, else 1). One candidate with the chooser on is sent back unexecuted with a request for alternatives, once per turn, at most 5 per session (R184)', codeDefault: 'auto', kind: 'value' },
      { key: 'CORTEX_FRAME_AUTHOR', what: 'Terminal-frame candidate author: helper = the helper model (thinking off) proposes genuinely different alternatives whenever the writer offers fewer candidates than the cap, so the typed chooser always has a menu (unset = helper when the chooser is on); off = writer-only (R185)', codeDefault: 'auto', kind: 'value' },
      { key: 'CORTEX_FRAME_AUTHOR_MODEL', what: 'Model card for the terminal-frame candidate author (unset = HELPER_MODEL_ID; e.g. deepseek-v4-pro for pro alternatives, thinking off) (R186)', codeDefault: '(HELPER_MODEL_ID)', kind: 'value' },
      { key: 'CORTEX_FRAME_AUTHOR_WHEN', what: 'When the terminal-frame author is called: stuck (default — only when the code diagnosis shows repeats, a failing streak or no prompt; near-zero cost on healthy sessions) or always (every under-filled turn) (R188)', codeDefault: 'stuck', kind: 'value' },
      { key: 'CORTEX_FRAME_KEY_GUARD', what: 'Keystroke guard in the terminal frame: pane-killing (C-d at an idle prompt, exit, tmux kill) and destructive (rm -rf /, mkfs, dd to a device, fork bomb, shutdown) candidates are refused before the menu step, never sent (R182)', codeDefault: 'on', kind: 'flag-not-false' },
      { key: 'CORTEX_FRAME_CONTRACT_EXTRA', what: 'Text appended to the turn-0 frame contract (cell guidance without a release) (R179)', codeDefault: '', kind: 'value' },
      { key: 'CORTEX_TURN_CONTRACT_ENFORCE', what: 'Tool-calling responses lacking ANALYSIS + PLAN are rejected unexecuted with a re-prompt (bounded per turn); the structural half of CORTEX_TURN_CONTRACT=channel (HB-TURN-CONTRACT-ENFORCE)', codeDefault: 'false', kind: 'flag-true' },
      { key: 'CORTEX_TURN_CONTRACT_ENFORCE_MAX', what: 'Format rejections per turn before the batch executes as-is (HB-TURN-CONTRACT-ENFORCE; 4.119.0 clamp 0..10000)', codeDefault: '2', kind: 'value' },
      { key: 'CORTEX_ACTION_PLAN_FIELDS', what: 'Bash/Edit/Write calls must carry required analysis + plan fields; invalid calls returned unexecuted, no cap (R172 HB-ACTION-PLAN-FIELDS)', codeDefault: 'false', kind: 'flag-true' },
      { key: 'CORTEX_JUDGE_VETO', what: 'Finish-judge veto mode: evidence = only a failed harness-run judge-named check holds a finish (max CORTEX_JUDGE_EVIDENCE_MAX_VETOES); opinion = R165; never = record only (R166)', codeDefault: 'evidence', kind: 'value' },
      { key: 'CORTEX_VERIFY_SCALE', what: 'R208 HB-VERIFY-AT-SCALE: the EndTurn judge persona carries one rubric item — evidence that only covers a smaller scale/volume/concurrency/timing than the task\'s tests imply is a GAP; verify_scale_item event per adjudication. off | on', codeDefault: 'off', kind: 'value' },
      { key: 'CORTEX_RULE_INPUTS', what: 'R211 HB-TASK-RULES L1 input-coverage audit: the lift-plan persona gains one INPUT COVERAGE bullet and the EndTurn judge persona one INPUTS RULE clause (every field/column/parameter of the provided inputs accounted for; given constants never altered — else GAP + CHECK); task_rule_plan / task_rule_judge events. off | on', codeDefault: 'off', kind: 'value' },
      { key: 'CORTEX_RULE_INTERP', what: 'R212 HB-TASK-RULES L2 interpretation enumeration: planner INTERPRETATIONS bullet + judge INTERPRETATION RULE clause (named alternatives each computed; keep the one consistent with every explicit hint and all data — else GAP + CHECK). off | on', codeDefault: 'off', kind: 'value' },
      { key: 'CORTEX_RULE_HOLDOUT', what: 'R213 HB-TASK-RULES L3 held-out / variant validation: planner HELD-OUT VALIDATION bullet + judge HELD-OUT RULE clause (hidden inputs or generalisation implied → validate on a held-out split or constructed variants — else GAP + CHECK). off | on', codeDefault: 'off', kind: 'value' },
      { key: 'CORTEX_RULE_INDEP', what: 'R214 HB-TASK-RULES L4 independent verifier: planner INDEPENDENT CHECK bullet + judge INDEPENDENT-CHECK RULE clause (final check must not reuse the producing logic; unreconciled measured discrepancy is a GAP; task\'s own verification commands/limits). off | on', codeDefault: 'off', kind: 'value' },
      { key: 'CORTEX_JUDGE_EVIDENCE_MAX_VETOES', what: 'Max evidence-backed vetoes per session in evidence mode (R166)', codeDefault: '1', kind: 'value' },
      { key: 'CORTEX_JUDGE_PROGRESS_MIN_CALLS', what: 'Tool calls since the last veto that count as progress on the plan (R165)', codeDefault: '3', kind: 'value' },
      { key: 'CORTEX_JUDGE_ESCALATE_REASONING', what: 'One thinking-on re-judge before accept-with-gap on a no-progress re-attest (R165); false disables', codeDefault: 'true', kind: 'flag-true' },
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
      { key: 'CORTEX_FAMILY_PRESETS', what: "R217 DARK: on = a model card WITHOUT its own promptPreset (every non-DeepSeek family) gets the family preset — today 'boot-minimal-generic' (the boot-minimal narrow door minus the DeepSeek-tuned 'Prefer acting over deliberating.' clause, with the .cortex/orient pointer). DeepSeek cards unchanged; CORTEX_PROMPT_MASS / CORTEX_SYSTEM_PROMPT_FILE still win", codeDefault: 'off', kind: 'value' },
      { key: 'CORTEX_TOOL_ANCHOR', what: 'Turn-1 tool narrowing (bash-edit = Bash+Edit only on turn 1)', codeDefault: '(card decides)', kind: 'value' },
      { key: 'TOOL_TIMEOUT_MODE', what: 'Bash deadline policy: auto = promote to background in headless sessions (kill in interactive); background/kill force', codeDefault: 'auto', kind: 'value' },
      { key: 'HELPER_MODEL_ID', what: 'HELPER role model (compaction, summaries, error guidance, vision hand-off; thinking OFF) — distinct from the MENTOR role (MENTORSHIP_HELPER_MODEL). Bench gates assert this key (cell-m-p2 2026-09-10 halted because it was unreported)', codeDefault: 'deepseek-flash', kind: 'value' },
      { key: 'CORTEX_HELPER_MATCH_PROVIDER', what: 'R217 DARK: on = a HELPER_MODEL_ID / MENTORSHIP_HELPER_MODEL left at its default (deepseek-flash) resolves from the ACTION model provider (anthropic→claude-haiku-4-5, openai→gpt-4.1-mini, google→gemini-2.5-flash-lite, xai→grok-4.3, deepseek→deepseek-flash); any other explicit value wins. Covers the helper + mentor calls in HelperModelMiddleware; compaction, vision hand-off and sub-agents are not routed', codeDefault: 'off', kind: 'value' },
      { key: 'VISION_HELPER_MODEL', what: 'vision hand-off: text-only primaries keep ReadImage; the image + question go to this helper card via the helper middleware and text comes back (false = vision primaries only)', codeDefault: 'deepseek-flash', kind: 'value' },
      { key: 'VISION_HANDOFF_MAX', what: 'per-turn cap on ReadImage→vision-helper hand-offs; past it ReadImage returns a consolidate reminder (0 = unlimited)', codeDefault: '8', kind: 'value' },
      { key: 'CORTEX_SLICE_NUDGE', what: 'after 3 bash slice-reads of one file, remind to Read it once', codeDefault: 'true', kind: 'flag-not-false' },
      { key: 'CORTEX_SLICE_BLOCK', what: 'HB-SLICE-BLOCK: coercive escalation of the slice-nudge — after CORTEX_SLICE_BLOCK_AT slices of a STATIC/source file, BLOCK further slice-reads of it (force Read), bounded to CORTEX_SLICE_BLOCK_MAX/file; append-mostly logs exempt. Evidence: soft nudge ignored ~80% of re-tested cases', codeDefault: 'true', kind: 'flag-not-false' },
      { key: 'CORTEX_SLICE_BLOCK_AT', what: 'slice count at which CORTEX_SLICE_BLOCK starts blocking a file (leaves the soft nudge at 3 + shallow-stoppers alone)', codeDefault: '5', kind: 'value' },
      { key: 'CORTEX_SLICE_BLOCK_MAX', what: 'max coercive slice-blocks per file before letting it through (bounded, no infinite loop)', codeDefault: '2', kind: 'value' },
      { key: 'CORTEX_ORIENT_BOOTSTRAP', what: 'orient prints a bare-box bootstrap directive when a needed toolchain is absent (DARK, A/B-able; factual tooling line is always on)', codeDefault: '0 (off)', kind: 'flag-true' },
      { key: 'CORTEX_ORIENT_V2', what: 'orient v2: verification entry points, git baseline line, 2-level map, one-line capability guides, vendor-tree install guard (DARK; unset = v1 output)', codeDefault: '0 (off)', kind: 'flag-true' },
      { key: 'CORTEX_WORKSPACE_CLEAN', what: 'Nothing the harness writes lands in the task tree: orient CORTEX.md + baseline, memory, doctrine staging, sub-agent results, turn predictions, compactions, audit log and the .addon-tools sandbox registry go to the state dir; the project dir is never a state-dir candidate (DARK)', codeDefault: '0 (off)', kind: 'flag-true' },
      { key: 'CORTEX_INVENTORY', what: 'Canonical workspace inventory (checkers+contracts, every dir, role-labelled files with content peeks, import resolution, missing deps, task env, services, data outside the workdir): orient prints it and it leads the steering env report (DARK)', codeDefault: '0 (off)', kind: 'flag-true' },
      { key: 'CORTEX_ORIENT_BASELINE', what: 'orient workspace baseline: 1 = checksum list once in <workspace>/.cortex + .cortex/changed + pre-finish revert line (bench repair tasks); auto = only when NOT a git repo, stored outside the project (~/.cortex/baselines, else /tmp) (DARK)', codeDefault: '0 (off)', kind: 'value' },
      { key: 'ENABLE_WEBTOOLS', what: 'web surface mode: auto = WebFetch on, search/browse/hosted-search on iff a search key is present; true = all on; false = all off (benches pin explicitly)', codeDefault: 'auto', kind: 'value' },
      { key: 'ENABLE_DEFERRED_TOOL_LOADING', what: '16 curated tools offered; the rest discoverable via SearchTools', codeDefault: 'true (settings default)', kind: 'flag-not-false' },
      { key: 'CORTEX_LIFT_NUDGE', what: 'One-line signpost after the turn-1 lift pointing at SearchTools/AskForAdvice', codeDefault: 'false (cards set true)', kind: 'flag-true' },
      { key: 'CORTEX_INTERACTIVE_PROFILE', what: 'R219 HB-INTERACTIVE-PROFILE: named lever profile for INTERACTIVE (TTY) sessions only, applied at launch to levers the user did not set (source shows `profile`). bench-lite = CORTEX_LOOP_TOOL_BLOCK=true, CORTEX_EMPTY_TURN_CONTINUE=true, CORTEX_WALL_DROP=on, CORTEX_WALL_SUMMARY=on, CORTEX_REASONING_EXHAUST_BACKOFF=false, CORTEX_STEER_INPUTS=full, CORTEX_ORIENT_V2=1; the lift plan stays headless-only (CORTEX_LIFT_PLAN_INTERACTIVE). off | bench-lite', codeDefault: 'off', kind: 'value' },
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
      { key: 'CORTEX_HERDR_REPORTING', what: 'Inside a herdr pane (HERDR_ENV=1 + herdr on PATH) the orchestrator reports working/idle/blocked + a summary token to herdr so its status is authoritative (R145 HB-HERDR-LIFECYCLE); only "false" disables', codeDefault: 'true when HERDR_ENV=1', kind: 'flag-not-false' },
      { key: 'CORTEX_HERDR_AGENT_NAME', what: 'Agent label reported to herdr (report-agent --agent); sanitized to [a-z][a-z0-9_-]{0,31}', codeDefault: 'cortex', kind: 'value' },
      { key: 'CORTEX_HERDR_BIN', what: 'Explicit herdr binary override (legacy HERDR_BIN honored). Resolution order: this → HERDR_BIN_PATH → PATH probe', codeDefault: '(unset)', kind: 'value' },
      { key: 'HERDR_BIN_PATH', what: 'herdr 0.9.0 pane export of its own binary path — the bin the reporter uses when no override is set and it is executable (informational; set by herdr, not by us)', codeDefault: '(unset — PATH probe)', kind: 'value' },
      { key: 'CORTEX_TERMINAL_BACKEND', what: 'Persistent-session backend under Bash persistentSession / TmuxSession / CreateArtifact persistent: auto | herdr | tmux | detached. auto = herdr pane (HERDR_ENV=1 + socket reachable) > tmux > detached background process (R146 HB-HERDR-TERMINAL-BACKEND); resolved once per process', codeDefault: 'auto', kind: 'value' },
      { key: 'CORTEX_TMUX_AUTO_INSTALL', what: 'When tmux is missing, the first persistent request (Bash persistentSession / TmuxSession / CreateArtifact persistent / tmux terminal backend) tries to install it: package manager (apt-get with expired-Release tolerance, apk, dnf, yum, brew; each step capped at 120 s) then a static binary from CORTEX_TMUX_STATIC_URL, then the R134 detached degrade. One attempt per process (R138 HB-TMUX-SELF-INSTALL); only "false" disables', codeDefault: 'true', kind: 'flag-not-false' },
      { key: 'CORTEX_TMUX_STATIC_URL', what: 'URL of a prebuilt/static tmux binary for the R138 self-install fallback (downloaded with curl/wget into ~/.local/bin/tmux after the package managers fail). Unset = the static step is skipped; no default download', codeDefault: '(unset — static step skipped)', kind: 'value' },
      { key: 'CORTEX_TMUX_HISTORY_LIMIT', what: 'Scrollback lines kept per tmux pane created by the harness (applied around new-session so the first window gets it, plus the session option; R141 HB-TMUX-CAPTURE-CAP)', codeDefault: '50000', kind: 'value' },
      { key: 'CORTEX_TMUX_PANE_SIZE', what: 'Fixed pane geometry WxH for tmux sessions created by the harness (new-session -x W -y H; Terminus captures a fixed 160x40 pane; R141). Captures are always 10 KB middle-omitted', codeDefault: '160x40', kind: 'value' },
      { key: 'CORTEX_SUBAGENT_RUNTIME', what: 'Where Task sub-agents run: auto | process | herdr. process = forked IPC child; herdr = sibling herdr pane running the same agent-mode entry (visible, takeover-able, auto-approved). auto = herdr when HERDR_ENV=1 + the herdr terminal backend resolves + the parent auto-approves, else process; Task input `runtime` overrides per dispatch (R147 HB-HERDR-DELEGATES)', codeDefault: 'auto', kind: 'value' },
      { key: 'CORTEX_HERDR_KEEP_DELEGATE_PANES', what: 'Keep herdr delegate panes (and their task/result files) after the sub-agent finishes for operator inspection; 0/false closes them on completion (R147)', codeDefault: '1 (keep)', kind: 'value' },
    ],
  },
];

export function collectEffectiveConfig(env: NodeJS.ProcessEnv = process.env): EffectiveConfigGroup[] {
  const fromProfile = profileAppliedKeys(env);
  return GROUPS.map(({ group, levers }) => ({
    group,
    levers: levers.map((s): EffectiveLever => {
      const raw = env[s.key];
      const present = raw !== undefined && raw !== '';
      const source: EffectiveLever['source'] = present ? (fromProfile.has(s.key) ? 'profile' : 'env') : 'code-default';
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
