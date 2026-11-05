/**
 * `cortex autoresearch loop` — the autonomous recursive loop: pick a goal, fix it in an
 * isolated worktree, measure base-vs-candidate through the gate, KEEP only what verifies,
 * advance the base, and repeat until a stop condition. The single-process, local analogue
 * of the NPC swarm — useful for "improve project X until the metric clears a bar" without
 * the container infrastructure.
 *
 * Each round:
 *   1. Goal = --prompt, else the highest-priority workable backlog deficiency.
 *   2. Fan out into `--width` parallel candidate ARMS (default 1). Each arm gets its own
 *      worktree detached at the current base ref and its own Fixer model — provider/model
 *      diversity competing on the SAME goal (see armPlan.ts for model assignment and the
 *      --missing-provider-key-policy semantics).
 *   3. Mutate each arm: --fixer-cmd (any transformer; sees CORTEX_ARM_INDEX/MODEL/STRATEGY
 *      in its environment), else the LLM `cortex autoresearch fix --model <arm model>`.
 *   4. Commit each candidate (no change → that arm is skipped). EVAL GUARD (core EvalGuard.ts):
 *      the task-sets were sealed into a private copy at loop start and every experiment
 *      grades against it; in-repo task-sets are hidden from the Fixer's worktree; a
 *      candidate that touches a protected path (the task-sets, --protect) or strays outside
 *      --editable is refused unbenched (skipped: 'eval-guard').
 *   5. Run `cortex autoresearch experiment` per arm (base vs candidate, FWER-adjusted with
 *      --n-family = the number of arms launched) and read the verdicts.
 *   6. ACCEPT = mergeEligible when a holdout is given (keep + FWER + holdout-verified); with
 *      no holdout, accept = keep-on-train (logged as UNVERIFIED — provide --holdout-set for
 *      the overfitting guard). The WINNER is the gate-accepted arm with the highest effect;
 *      with --require-judge the judge reviews accepted arms in effect order until one is
 *      approved. CONFIRM (default on, --no-confirm to skip): the selected winner is
 *      re-benched base vs candidate on FRESH train runs in a separate store (no pooling with
 *      the screening records) with a new gate seed — choosing the best of N noisy arms
 *      inflates its effect (winner's curse) and FWER does not remove that bias. The fresh
 *      run is judged by core decideConfirmation (--confirm-mode, default 'pooled': the
 *      screening and confirmation p-values Stouffer-combined at the gate's own bar, plus a
 *      fresh effect > 0 — protects against lucky winners without demanding significance
 *      twice). One confirmation per round. A winner that passes screening but fails
 *      confirmation is a NEAR-MISS: its commit is kept under
 *      refs/autoresearch/near-miss/<branch>/r<round>-a<arm> and a row goes to
 *      <store>/.cortex/autoresearch-near-misses.jsonl, so it can be re-tested with more
 *      runs. On accept: advance base to the winner + anchor the loop branch to it.
 *      Losing/rejected arms are dropped.
 *   GUARDS (B4, core AutoResearchGuards, --guards block|warn|off, default block): a gain on
 *      the aggregate must not hide a loss in one task family. A candidate is blocked when a
 *      family's loss is material AND evident (estimate < -margin and its one-sided upper
 *      bound < 0, alpha split across families) — per STEP (vs its base, --guard-margin 2)
 *      and as a running TOTAL from the round-0 base (Σ of merged steps' family effects,
 *      --guard-total-margin 5). The confirmation run's own family effects are checked too
 *      and are what the running total records.
 *   APPROACHES + ATTEMPTS (B6, approachPlan.ts): with --width > 1 each arm's prompt names a
 *      different approach from a rotating queue; the Fixer may declare known flaws in
 *      .autoresearch-flaws (read + removed before commit; such an arm is benched, never
 *      merged); every arm that does not merge is kept under refs/autoresearch/attempts/…
 *      with a row in <store>/.cortex/autoresearch-attempts.jsonl saying why.
 *   RUNS: every experiment reports a run plan (core planRuns: the smallest effect its runs
 *      can detect, and the runs per arm needed for --target-effect). The loop warns when
 *      underpowered; --auto-runs raises the runs for later rounds (capped by --max-runs).
 *   7. Stop on: success metric met, max rounds, max consecutive stale rounds, or a dry backlog.
 *      The success metric reads TRAIN scores (the confirmation's when it ran), never the
 *      holdout: holdout results only gate the merge, so repeated rounds cannot steer the
 *      loop toward the holdout (adaptive overfitting).
 *
 * GIT SAFETY: all work happens in throwaway worktrees off a dedicated loop branch
 * (`autoresearch/loop-*`). The user's branch and working tree are never touched. Accepted
 * candidate commits are anchored to the loop branch so detached-HEAD commits survive
 * worktree removal; the operator merges the loop branch when satisfied.
 */
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  ResearchBacklog, checkCandidateChanges, decideConfirmation, describeViolations, protectGlobFor, sealTaskSet, taskIdsIn,
  stepGuards, totalGuards, recordDrift, describeGuardBlocks,
  type ConfirmMode, type DriftLedger, type ExperimentVerdict, type FamilyEffect, type GuardVerdict, type GuardViolation,
  type RunPlan, type SealedSet,
} from '@nexus-cortex/core';
import { ThemeManager } from '../../themes/ThemeManager.js';
import { resolveRepoDir, resolveTaskSet } from './repoResolve.js';
import { planArms, parseMissingKeyPolicy, type ArmAssignment } from './armPlan.js';
import { DEFAULT_APPROACHES, FLAWS_FILE, approachesForRound, fixerPrompt, parseApproaches, type Approach } from './approachPlan.js';


export interface AutoResearchLoopOptions {
  repo?: string;
  taskSet?: string;
  holdoutSet?: string;
  runCmd?: string;
  buildCmd?: string;
  acceptExit?: string;
  runs?: string;
  model?: string;
  prompt?: string;
  fixerCmd?: string;
  maxRounds?: string;
  maxStale?: string;
  successMetric?: string;   // "<taskId>:<threshold>"
  baseRef?: string;
  branch?: string;
  cortexDir?: string;
  keepWorktrees?: boolean;
  json?: boolean;
  /** Effectiveness-arm labels passed through to each round's experiment, recorded with
   *  every scored run so the matrix can rank (model × temperature × strategy). */
  temperature?: string;
  strategy?: string;
  /** Parallel candidate arms per round (FWER family width). Default 1 = classic loop. */
  width?: string;
  /** Explicit comma-separated model ids rotated across arms (arm 1 keeps --model). */
  armModels?: string;
  /** Comma-separated providers to draw arm models from (flagship tool-supporting model each). */
  providers?: string;
  /** What to do with an arm whose provider key is missing:
   *  platform_fallback (run anyway) | omit (drop the arm) | redistribute (reassign). */
  missingProviderKeyPolicy?: string;
  /** Opt-in qualitative gate: run `cortex autoresearch judge` on each candidate the
   *  STATISTICAL gate accepted, and require it to APPROVE before merging
   *  (accept = gate-accept ∧ judge-approve). Default off → unchanged behavior. */
  requireJudge?: boolean;
  judgeRubric?: string;
  judgeRubricFile?: string;
  /** judge model (default: the loop --model, else DEFAULT_MODEL_ID). */
  judgeModel?: string;
  /** Comma-separated globs (repo-relative) no candidate may touch — verifier scripts,
   *  graders, bench harnesses. The task-sets' in-repo paths are always protected. */
  protect?: string;
  /** Comma-separated globs; when set, every changed path must match one. */
  editable?: string;
  /** Re-bench the selected winner on fresh train runs before merging (default true;
   *  commander's --no-confirm sets false). */
  confirm?: boolean;
  /** pooled (default) | direction | strict — see core decideConfirmation. */
  confirmMode?: string;
  /** 'direction' mode: the fresh CI low must exceed -margin (score points, default 2.5). */
  confirmLossMargin?: string;
  /** run planning: the aggregate effect worth detecting (score points, default 5). */
  targetEffect?: string;
  /** run planning: the power wanted (default 0.8). */
  power?: string;
  /** raise runs per arm for later rounds to the planned requirement (capped by maxRuns). */
  autoRuns?: boolean;
  /** cap for --auto-runs (default 12). */
  maxRuns?: string;
  /** family regression guards: block (default) | warn | off */
  guards?: string;
  /** per-step family loss margin, score points (default 2) */
  guardMargin?: string;
  /** running-total family loss margin from the round-0 base (default 5) */
  guardTotalMargin?: string;
  /** Approaches rotated across arms, `|`-separated (`slug: text` entries allowed).
   *  Default: the built-in list when --width > 1, none at width 1. commander's
   *  --no-approaches sets false. */
  approaches?: string | boolean;
}

/** Default judge rubric used when --require-judge is set without an explicit
 *  --judge-rubric / --judge-rubric-file. Tuned for the autoresearch loop: the
 *  statistical gate already proved a measurable, holdout-verified gain, so the
 *  judge's job is the orthogonal check — is the gain REAL, or does it game the
 *  eval / smuggle in damage? Override for domain-specific judging. */
const DEFAULT_JUDGE_RUBRIC =
  'You are judging a candidate code change produced by an autonomous self-improvement loop. The ' +
  'statistical gate has ALREADY confirmed this candidate measurably improves the benchmark and ' +
  'generalized to a held-out set; your job is the orthogonal quality check the statistics cannot ' +
  'make: confirm the improvement is a REAL fix of the underlying cause, not an artifact that games ' +
  'the evaluation or smuggles in damage. Score 0-100. APPROVE only if the change fixes the ' +
  'deficiency on its merits and would generalize to unseen inputs, is minimal and focused (no ' +
  'unrelated churn, dead code, or scope creep), is sound (no hallucinated/nonexistent APIs, nothing ' +
  'that would fail to run), and is safe (no shelling out, network calls, filesystem destruction, or ' +
  'eval/exec the deficiency did not require). REJECT (low score) if the change games the metric ' +
  '(hardcodes or special-cases expected outputs, branches on test inputs, or edits the ' +
  'evaluator/verifier/test files), only changes output text to match the grader, includes ' +
  'hallucinated APIs, contains unsafe operations or anything resembling a backdoor or exfiltration, ' +
  'or bundles unrelated rewrites. Do NOT read "minimal and focused" as a preference for the ' +
  'NARROWER fix: generality is the goal, not brevity — a change whose every part serves the ' +
  'deficiency and that holds across MANY distinct task families beats an equal-scoring change ' +
  'whose evidence sits in one family, even when the broader fix is the larger diff. A measurable, ' +
  'holdout-verified gain is NECESSARY but NOT ' +
  'SUFFICIENT — be skeptical and refute-first; when in doubt, do not approve.';

function shQuote(s: string): string { return `'${s.replace(/'/g, `'\\''`)}'`; }

/** Async spawn that resolves with status + captured stdio (never rejects on non-zero exit). */
function spawnAsync(
  cmd: string,
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv; stdio?: 'inherit' | 'ignore' | 'capture' },
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolvePromise) => {
    const capture = opts.stdio === 'capture' || opts.stdio === undefined;
    const stdio: import('node:child_process').StdioOptions = capture
      ? ['ignore', 'pipe', 'pipe']
      : opts.stdio === 'inherit' ? 'inherit' : 'ignore';
    const child = spawn(cmd, args, { cwd: opts.cwd, env: opts.env, stdio });
    let stdout = '';
    let stderr = '';
    if (capture) {
      child.stdout?.on('data', (d) => { stdout += d; });
      child.stderr?.on('data', (d) => { stderr += d; });
    }
    child.on('error', (err) => resolvePromise({ status: null, stdout, stderr: stderr || String(err) }));
    child.on('close', (status) => resolvePromise({ status, stdout, stderr }));
  });
}

/** The confirmation re-bench of a round's selected winner. */
interface ConfirmResult {
  /** true = the winner survived its confirmation (core decideConfirmation) */
  confirmed: boolean;
  mode: ConfirmMode;
  /** the fresh run's own gate decision: 'keep' | 'discard' | 'pending' | 'no-verdict' */
  decision: string;
  effect?: number;
  pValue?: number;
  ciLow?: number;
  combinedP?: number;
  reason: string;
  runs: number;
  trainSummary?: any;      // candidate train BenchSummary of the confirmation run
  /** per-family effects of the confirmation run (what the drift ledger records) */
  families?: FamilyEffect[];
}

/** One arm's outcome within a round. */
interface ArmResult {
  arm: number;
  model?: string;
  strategy?: string;
  candDir?: string;
  candRef?: string;
  /** 'fixer-failed' | 'no-change' | 'eval-guard' | 'no-verdict' when the arm produced no verdict. */
  skipped?: string;
  /** eval-guard violations (paths the candidate may not touch). */
  violations?: GuardViolation[];
  /** experiment tag of the screening run. */
  tag?: string;
  /** family guard verdicts (step + total) that blocked or warned on this arm */
  guardBlocks?: GuardVerdict[];
  /** the approach this arm was given (B6) */
  approach?: string;
  /** flaws the Fixer declared for its change (B6) — benched, never merged */
  flaws?: string[];
  reason?: string;
  exitCode?: number | null;
  res?: any;               // parsed experiment verdict JSON
  gateAccepted?: boolean;
}

export async function autoResearchLoop(options: AutoResearchLoopOptions): Promise<void> {
  const theme = ThemeManager.getTheme();
  const json = !!options.json;
  const log = (m: string) => { if (!json) console.log(theme.colors.muted(` ${m}`)); };
  // In --json mode, emit machine-readable progress as one compact JSON object per line
  // (JSONL) so a host watching the process sees the loop advance; the final summary
  // object is still printed last (unchanged) for existing consumers.
  const emit = (event: Record<string, unknown>) => { if (json) console.log(JSON.stringify(event)); };
  const self = process.argv[1]!; // re-invoke this same CLI for fix/experiment

  const miss: string[] = [];
  if (!options.repo) miss.push('--repo');
  if (!options.taskSet) miss.push('--task-set');
  if (miss.length) { console.error(theme.colors.error(`Error: missing ${miss.join(', ')}`)); process.exit(1); }

  // --repo may be a PUBLIC http(s) git URL → shallow-clone (credential-free) and use the
  // checkout; a local path is used as-is. Relative task-sets resolve against the repo.
  const repo = resolveRepoDir(options.repo!, log);
  const git = (args: string[], cwd = repo) =>
    execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const sh = (cmd: string, cwd: string) => spawnSync('sh', ['-c', cmd], { cwd, stdio: json ? 'ignore' : 'inherit' });

  let baseRef: string;
  try { baseRef = options.baseRef ?? git(['rev-parse', 'HEAD']); }
  catch { console.error(theme.colors.error(`Error: ${repo} is not a git repository`)); process.exit(1); return; }

  const maxRounds = Number(options.maxRounds ?? '10');
  const maxStale = Number(options.maxStale ?? String(maxRounds));
  const branch = options.branch ?? `autoresearch/loop-${baseRef.slice(0, 8)}`;
  const store = options.cortexDir ? resolve(options.cortexDir) : repo;
  const backlog = new ResearchBacklog(repo);
  const successMetric = options.successMetric
    ? { taskId: options.successMetric.split(':')[0]!, threshold: Number(options.successMetric.split(':')[1]) }
    : undefined;
  const splitList = (s?: string) => s?.split(',').map((x) => x.trim()).filter(Boolean);

  // ---- Eval guard: seal the task-sets, hide in-repo copies, protect paths ------
  const sealDir = mkdtempSync(join(tmpdir(), 'arseal-'));
  let trainSet: SealedSet;
  let holdoutSet: SealedSet | undefined;
  try {
    trainSet = sealTaskSet(resolveTaskSet(options.taskSet!, repo), sealDir, 'train', repo);
    holdoutSet = options.holdoutSet ? sealTaskSet(resolveTaskSet(options.holdoutSet, repo), sealDir, 'holdout', repo) : undefined;
  } catch (e) {
    console.error(theme.colors.error(`Error: cannot read task-set: ${(e as Error).message}`));
    process.exit(1); return;
  }
  const sealedSets = [trainSet, holdoutSet].filter((x): x is SealedSet => !!x);
  const hiddenPaths = sealedSets.map((x) => x.inRepo).filter((x): x is string => !!x);
  const guard = {
    protect: [...sealedSets.filter((x) => x.inRepo).map((x) => protectGlobFor(x.inRepo!, x.isDir)), ...(splitList(options.protect) ?? [])],
    editable: splitList(options.editable) ?? [],
  };
  emit({
    event: 'eval_seal',
    train: { source: trainSet.source, sha256: trainSet.sha256, inRepo: trainSet.inRepo ?? null },
    ...(holdoutSet ? { holdout: { source: holdoutSet.source, sha256: holdoutSet.sha256, inRepo: holdoutSet.inRepo ?? null } } : {}),
    protect: guard.protect, editable: guard.editable,
  });
  if (holdoutSet?.inRepo) {
    const msg = `eval-guard: the holdout set is inside the repo (${holdoutSet.inRepo}) — it is hidden from the Fixer's worktree and protected, but still readable from git history; keep it outside the repo for real secrecy`;
    log(msg); emit({ event: 'warning', message: msg });
  }
  if (successMetric && !taskIdsIn(trainSet.sealed).has(successMetric.taskId)) {
    const msg = `--success-metric task '${successMetric.taskId}' is not in the train set — the success stop reads train scores only (never the holdout), so it will never fire`;
    log(msg); emit({ event: 'warning', message: msg });
  }

  // ---- Confirmation + run planning ------------------------------------------
  const confirmMode = (options.confirmMode ?? 'pooled') as ConfirmMode;
  if (!['pooled', 'direction', 'strict'].includes(confirmMode)) {
    console.error(theme.colors.error(`Error: --confirm-mode must be pooled | direction | strict (got '${options.confirmMode}')`));
    process.exit(1); return;
  }
  const confirmLossMargin = options.confirmLossMargin != null ? Number(options.confirmLossMargin) : undefined;
  const maxRuns = Number(options.maxRuns ?? '12');
  let runsPerArm = Number(options.runs ?? '3');
  const nearMissLog = join(store, '.cortex', 'autoresearch-near-misses.jsonl');
  const guardMode = options.guards ?? 'block';
  if (!['block', 'warn', 'off'].includes(guardMode)) {
    console.error(theme.colors.error(`Error: --guards must be block | warn | off (got '${options.guards}')`));
    process.exit(1); return;
  }
  const guardOpts = {
    margin: options.guardMargin != null ? Number(options.guardMargin) : undefined,
    totalMargin: options.guardTotalMargin != null ? Number(options.guardTotalMargin) : undefined,
  };
  // B6: distinct approaches per arm (rotating queue); losing attempts are kept.
  const approaches: Approach[] = options.approaches === false ? []
    : typeof options.approaches === 'string' && options.approaches.trim() ? parseApproaches(options.approaches)
    : [];  // filled below once the width is known
  const attemptsLog = join(store, '.cortex', 'autoresearch-attempts.jsonl');
  const attempts: Record<string, unknown>[] = [];
  /** Per-family drift from the round-0 base: Σ of merged steps' family effects. */
  const drift: DriftLedger = new Map();
  /** Step + total guard verdicts for one measurement; [] when guards are off. */
  const guardCheck = (families: FamilyEffect[] | undefined): GuardVerdict[] =>
    guardMode === 'off' || !families?.length ? [] : [...stepGuards(families, guardOpts), ...totalGuards(drift, families, guardOpts)];
  const nearMisses: Record<string, unknown>[] = [];

  // ---- Multi-provider arm plan (width 1 = classic single-arm loop) ------------
  let policy;
  try { policy = parseMissingKeyPolicy(options.missingProviderKeyPolicy); }
  catch (e) { console.error(theme.colors.error(`Error: ${(e as Error).message}`)); process.exit(1); return; }
  const plan = planArms({
    width: Number(options.width ?? '1'),
    baseModel: options.model,
    armModels: splitList(options.armModels),
    providers: splitList(options.providers),
    strategy: options.strategy,
    policy,
  });
  const width = plan.arms.length;
  if (options.approaches !== false && !approaches.length && width > 1) approaches.push(...DEFAULT_APPROACHES);
  if (approaches.length && width > approaches.length) {
    log(`approaches: width ${width} > ${approaches.length} approaches — some arms in a round share one`);
  }
  if (width > 1 || plan.notes.length) {
    emit({ event: 'arm_plan', width, arms: plan.arms, notes: plan.notes });
    for (const n of plan.notes) log(`arm-plan: ${n}`);
    if (width > 1) log(`arm-plan: ${plan.arms.map(a => `a${a.arm}=${a.model ?? 'default'}${a.funded ? '' : ' (unfunded)'}`).join('  ')}`);
  }

  // The loop branch anchors accepted candidate commits (so detached worktree commits survive).
  try { git(['branch', '-f', branch, baseRef]); } catch { /* branch may already exist at ref */ }

  const worktrees: string[] = [];
  const addWorktree = (ref: string): string => {
    const dir = mkdtempSync(join(tmpdir(), 'arloop-'));
    git(['worktree', 'add', '--detach', dir, ref]);
    worktrees.push(dir);
    return dir;
  };
  const removeWorktree = (dir: string) => { try { git(['worktree', 'remove', '--force', dir]); } catch { /* */ } };

  let baseDir = addWorktree(baseRef);
  const rounds: any[] = [];
  let stale = 0;
  let stop = 'max-rounds';

  if (!json) console.log(`\n ${theme.colors.highlight('Auto-research loop')}  repo=${repo}  branch=${branch}  base=${baseRef.slice(0, 8)}  width=${width}  max=${maxRounds}\n`);

  /** `cortex autoresearch experiment` args for base vs one candidate, graded against the
   *  SEALED task-sets. `holdout:false` = train only (the confirmation run). */
  const experimentArgs = (a: { tag: string; candDir: string; candRef: string; store: string; nFamily: number; holdout: boolean; strategy?: string; seed?: number }): string[] => {
    const args = ['autoresearch', 'experiment',
      '--experiment-tag', a.tag,
      '--base-dir', baseDir, '--candidate-dir', a.candDir,
      '--base-ref', git(['rev-parse', '--short', 'HEAD'], baseDir), '--candidate-ref', a.candRef,
      '--task-set', trainSet.sealed, '--no-build',
      '--n-family', String(a.nFamily),
      '--cortex-dir', a.store, '--runs', String(runsPerArm), '--json'];
    if (options.targetEffect) args.push('--target-effect', options.targetEffect);
    if (options.power) args.push('--power', options.power);
    if (a.holdout && holdoutSet) args.push('--holdout-set', holdoutSet.sealed);
    if (a.seed != null) args.push('--seed', String(a.seed));
    if (options.model) args.push('--model', options.model);
    if (options.temperature) args.push('--temperature', options.temperature);
    if (a.strategy) args.push('--strategy', a.strategy);
    if (options.runCmd) {
      args.push('--run-cmd', options.runCmd, '--accept-exit', options.acceptExit ?? '0');
      if (options.buildCmd) args.push('--build-cmd', options.buildCmd);
    }
    return args;
  };

  /** Re-bench the selected winner on FRESH train runs in a private store (so the gate sees
   *  only the new records) with a new seed; it must KEEP again. Never throws. */
  const confirmWinner = async (w: ArmResult, r: number): Promise<ConfirmResult> => {
    const confirmStore = mkdtempSync(join(tmpdir(), 'arconfirm-'));
    try {
      const args = experimentArgs({ tag: `${w.tag}-confirm`, candDir: w.candDir!, candRef: w.candRef!, store: confirmStore, nFamily: 1, holdout: false, strategy: w.strategy, seed: 7919 * r + w.arm });
      emit({ event: 'confirm_start', round: r, arm: w.arm, candidateRef: w.candRef });
      const exp = await spawnAsync('node', [self, ...args], { stdio: 'capture' });
      let res: any;
      try { res = JSON.parse(exp.stdout); } catch { res = undefined; }
      if (!res?.verdict) {
        const reason = String(res?.error ?? ((exp.stderr || '').trim().split('\n').filter(Boolean).slice(-3).join(' ') || `exit ${exp.status}`)).slice(0, 500);
        return { confirmed: false, mode: confirmMode, decision: 'no-verdict', reason, runs: runsPerArm };
      }
      const fresh = res.verdict as ExperimentVerdict;
      const d = decideConfirmation(w.res.verdict as ExperimentVerdict, fresh, { mode: confirmMode, lossMargin: confirmLossMargin });
      // The fresh run's own family effects must not show an evident family loss either.
      const families: FamilyEffect[] | undefined = res.families;
      const blocks = guardCheck(families).filter((g) => g.blocked);
      const guardFail = guardMode === 'block' && blocks.length > 0;
      return {
        confirmed: d.confirmed && !guardFail, mode: d.mode, decision: fresh.decision, effect: fresh.effect, pValue: fresh.pValue,
        ciLow: fresh.ciLow, combinedP: d.combinedP,
        reason: guardFail ? `${d.reason}; GUARD on fresh run: ${describeGuardBlocks(blocks)}` : d.reason,
        runs: runsPerArm, trainSummary: res.benchSummaries?.candidate?.train, families,
      };
    } finally {
      rmSync(confirmStore, { recursive: true, force: true });
    }
  };

  /** A winner that passed screening (and the judge) but not its confirmation: keep its
   *  commit under a ref and log a row, so it can be re-tested with more runs. */
  const recordNearMiss = (w: ArmResult, r: number, c: ConfirmResult): void => {
    const ref = `refs/autoresearch/near-miss/${branch}/r${r}-a${w.arm}`;
    try { git(['update-ref', ref, w.candRef!]); } catch { /* best effort; the row still records the sha */ }
    const sha = (() => { try { return git(['rev-parse', w.candRef!]); } catch { return w.candRef; } })();
    const recommended = Math.max(runsPerArm * 2, w.res?.runPlan?.requiredRunsPerArm ?? 0);
    const row = {
      ts: new Date().toISOString(), branch, round: r, arm: w.arm, model: w.model ?? null,
      ref, candidateSha: sha, baseRef,
      screening: { decision: w.res?.verdict?.decision, effect: w.res?.verdict?.effect, pValue: w.res?.verdict?.pValue, ciLow: w.res?.verdict?.ciLow, ciHigh: w.res?.verdict?.ciHigh, alphaAdjusted: w.res?.verdict?.alphaAdjusted, mergeEligible: !!w.res?.mergeEligible },
      confirmation: { mode: c.mode, decision: c.decision, effect: c.effect, pValue: c.pValue, ciLow: c.ciLow, combinedP: c.combinedP, reason: c.reason, runs: c.runs },
      runPlan: w.res?.runPlan ?? null,
      retest: `cortex autoresearch experiment --base-ref ${baseRef} --candidate-ref ${ref} --runs ${recommended} …  (check out both refs as worktrees; graded against the same task-set)`,
    };
    try {
      mkdirSync(join(store, '.cortex'), { recursive: true });
      appendFileSync(nearMissLog, JSON.stringify(row) + '\n');
    } catch (e) { log(`near-miss log write failed: ${(e as Error).message}`); }
    nearMisses.push({ round: r, arm: w.arm, ref, candidateSha: sha, effect: w.res?.verdict?.effect, confirmEffect: c.effect });
    emit({ event: 'near_miss', round: r, arm: w.arm, ref, candidateSha: sha, log: nearMissLog });
    log(`r${r}: near-miss kept → ${ref} (row in ${nearMissLog})`);
  };

  /** Keep a non-merged arm's commit under refs/autoresearch/attempts/… and log why. */
  const recordAttempt = (a: ArmResult, r: number, status: string): void => {
    const ref = `refs/autoresearch/attempts/${branch}/r${r}-a${a.arm}`;
    try { git(['update-ref', ref, a.candRef!]); } catch { /* best effort */ }
    let shortstat = '';
    try { shortstat = git(['diff', '--shortstat', `${a.candRef}~1`, a.candRef!]); } catch { /* */ }
    const row = {
      ts: new Date().toISOString(), branch, round: r, arm: a.arm, model: a.model ?? null, approach: a.approach ?? null,
      status, ref, candidateRef: a.candRef, baseRef, diff: shortstat,
      ...(a.res?.verdict ? { verdict: { decision: a.res.verdict.decision, effect: a.res.verdict.effect, pValue: a.res.verdict.pValue, mergeEligible: !!a.res.mergeEligible } } : {}),
      ...(a.flaws ? { flaws: a.flaws } : {}),
      ...(a.violations ? { violations: a.violations } : {}),
      ...(a.guardBlocks ? { guardBlocks: a.guardBlocks } : {}),
      ...(a.reason ? { reason: a.reason } : {}),
    };
    try {
      mkdirSync(join(store, '.cortex'), { recursive: true });
      appendFileSync(attemptsLog, JSON.stringify(row) + '\n');
    } catch (e) { log(`attempts log write failed: ${(e as Error).message}`); }
    attempts.push({ round: r, arm: a.arm, status, ref });
    emit({ event: 'attempt_kept', round: r, arm: a.arm, status, ref });
  };

  /** Run one arm: worktree → fixer → commit → experiment. Never throws. */
  const runArm = async (assign: ArmAssignment, r: number, goal: string, approach?: Approach): Promise<ArmResult> => {
    const strategy = [assign.strategy, approach && `approach:${approach.slug}`].filter(Boolean).join('+') || undefined;
    const out: ArmResult = { arm: assign.arm, model: assign.model, strategy, ...(approach ? { approach: approach.slug } : {}) };
    const prompt = fixerPrompt(goal, approach, width);
    const candDir = addWorktree(baseRef);
    out.candDir = candDir;

    // Hide in-repo task-sets from the Fixer (restored to the base version before commit).
    const hidden = hiddenPaths.filter((p) => existsSync(join(candDir, p)));
    for (const p of hidden) rmSync(join(candDir, p), { recursive: true, force: true });

    // 3. Mutate (fixer). Single-arm keeps today's interactive stdio; parallel arms are quiet.
    const fixerStdio: 'inherit' | 'ignore' = json || width > 1 ? 'ignore' : 'inherit';
    emit({ event: 'fix', round: r, arm: assign.arm, model: assign.model, fixer: options.fixerCmd ? 'command' : 'llm' });
    if (options.fixerCmd) {
      const cmd = options.fixerCmd.replace(/\{prompt\}/g, shQuote(prompt));
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        CORTEX_ARM_INDEX: String(assign.arm),
        CORTEX_FLAWS_FILE: join(candDir, FLAWS_FILE),
        ...(assign.model ? { CORTEX_ARM_MODEL: assign.model } : {}),
        ...(strategy ? { CORTEX_ARM_STRATEGY: strategy } : {}),
        ...(approach ? { CORTEX_ARM_APPROACH: approach.slug } : {}),
      };
      const f = width > 1
        ? await spawnAsync('sh', ['-c', cmd], { cwd: candDir, env, stdio: fixerStdio })
        : { status: sh(cmd, candDir).status, stdout: '', stderr: '' };
      if (f.status !== 0) { out.skipped = 'fixer-failed'; out.exitCode = f.status; return out; }
    } else {
      const fixArgs = [self, 'autoresearch', 'fix', '--cwd', candDir, '--prompt', prompt, '--json'];
      if (assign.model) fixArgs.push('--model', assign.model);
      const f = await spawnAsync('node', fixArgs, { stdio: fixerStdio });
      if (f.status !== 0) { out.skipped = 'fixer-failed'; out.exitCode = f.status; return out; }
    }

    // 4. Restore the hidden task-sets, then commit the candidate (no change → skip this arm)
    // unless the eval guard refuses it.
    // A hidden task-set that exists again after the Fixer ran was WRITTEN by it (it could not
    // see the original) — tampering, refused below like any protected-path change.
    const recreated: GuardViolation[] = hiddenPaths
      .filter((p) => existsSync(join(candDir, p)))
      .map((path) => ({ path, rule: 'protected' as const }));
    for (const p of hiddenPaths) rmSync(join(candDir, p), { recursive: true, force: true });
    if (hidden.length) git(['checkout', 'HEAD', '--', ...hidden], candDir);
    // Declared flaws (B6): read and remove the Fixer's flaws file before commit.
    const flawsPath = join(candDir, FLAWS_FILE);
    if (existsSync(flawsPath)) {
      try {
        const lines = readFileSync(flawsPath, 'utf8').split('\n').map((l) => l.replace(/^[-*\s]+/, '').trim()).filter(Boolean);
        if (lines.length) out.flaws = lines.slice(0, 20).map((l) => l.slice(0, 300));
      } catch { /* unreadable → treated as no declaration */ }
      rmSync(flawsPath, { force: true });
    }
    git(['add', '-A'], candDir);
    const dirty = spawnSync('git', ['-C', candDir, 'diff', '--cached', '--quiet']).status !== 0;
    if (!dirty && !recreated.length) { out.skipped = 'no-change'; return out; }
    const changed = git(['diff', '--cached', '--name-only', '--no-renames'], candDir).split('\n').filter(Boolean);
    // Commit before the guard so a refused candidate is kept as evidence (attempts ref).
    git(['commit', '-q', '--allow-empty', '-m', `autoresearch loop r${r}${width > 1 ? `a${assign.arm}` : ''}: ${goal.slice(0, 60)}`], candDir);
    out.candRef = git(['rev-parse', '--short', 'HEAD'], candDir);
    const checked = checkCandidateChanges(changed, guard);
    const verdict = { ok: checked.ok && !recreated.length, violations: [...recreated, ...checked.violations] };
    if (!verdict.ok) {
      out.skipped = 'eval-guard';
      out.violations = verdict.violations;
      out.reason = `refused unbenched: ${describeViolations(verdict.violations)}`;
      emit({ event: 'eval_guard', round: r, arm: assign.arm, model: assign.model, violations: verdict.violations });
      return out;
    }

    // 5. Experiment base vs candidate (subprocess → JSON verdict). FWER-adjusted with the
    // real family width so N parallel arms don't inflate the false-keep rate.
    const tag = width > 1 ? `loop-r${r}a${assign.arm}` : `loop-r${r}`;
    out.tag = tag;
    const expArgs = experimentArgs({ tag, candDir, candRef: out.candRef, store, nFamily: width, holdout: true, strategy });
    emit({ event: 'experiment', round: r, arm: assign.arm, model: assign.model, candidateRef: out.candRef });
    const exp = await spawnAsync('node', [self, ...expArgs], { stdio: 'capture' });
    try { out.res = JSON.parse(exp.stdout); } catch {
      // Capture WHY this arm produced no verdict (missing/invalid provider key,
      // inference error, crash) so the driving model / fixer / PM is NOTIFIED —
      // not just told "skipped". Surfaced in the round history + emitted event +
      // the final result, so the driver can react (retry / reassign / report).
      out.skipped = 'no-verdict';
      out.reason = ((exp.stderr || '').trim().split('\n').filter(Boolean).slice(-3).join(' ')
        || (exp.status != null ? `exit ${exp.status}` : 'no parseable verdict')).slice(0, 500);
      out.exitCode = exp.status ?? null;
      return out;
    }
    if (!out.res?.verdict) {
      // Parseable JSON but no verdict (e.g. {"error": ...} from a bad task-set or a
      // missing provider key) — surface the reason instead of silently rejecting.
      out.skipped = 'no-verdict';
      out.reason = String(out.res?.error ?? 'experiment output had no verdict').slice(0, 500);
      out.exitCode = exp.status ?? null;
      out.res = undefined;
      return out;
    }
    const keep = out.res.verdict?.decision === 'keep';
    out.gateAccepted = options.holdoutSet ? !!out.res.mergeEligible : keep;
    // B4 family guards (step + running total from the round-0 base).
    const blocks = guardCheck(out.res.families).filter((g) => g.blocked);
    if (blocks.length) {
      out.guardBlocks = blocks;
      emit({ event: 'guard', round: r, arm: assign.arm, mode: guardMode, blocks });
      log(`r${r}${width > 1 ? ` a${assign.arm}` : ''}: family guard ${guardMode === 'block' ? 'BLOCKS' : 'warns'}: ${describeGuardBlocks(blocks)}`);
      if (guardMode === 'block') out.gateAccepted = false;
    }
    if (out.flaws?.length) {
      emit({ event: 'flaws', round: r, arm: assign.arm, flaws: out.flaws, gateWouldAccept: out.gateAccepted });
      log(`r${r}${width > 1 ? ` a${assign.arm}` : ''}: Fixer declared ${out.flaws.length} flaw(s) — held for review, not merged`);
      out.gateAccepted = false;
    }
    emit({ event: 'gate', round: r, arm: assign.arm, model: assign.model, decision: out.res.verdict?.decision, effect: out.res.verdict?.effect, mergeEligible: !!out.res.mergeEligible, accepted: out.gateAccepted });
    return out;
  };

  try {
    for (let r = 1; r <= maxRounds; r++) {
      emit({ event: 'round_start', round: r, width });
      // 1. Goal
      let goal = options.prompt;
      let defId: string | undefined;
      if (!goal) {
        const d = backlog.next();
        if (!d) { stop = 'backlog-dry'; break; }
        goal = d.description; defId = d.id;
        backlog.markInProgress(d.id, `loop-r${r}`);
      }

      // 2-5. Fan out the arms (width 1 = the classic single-candidate round).
      log(`r${r}: fixing${width > 1 ? ` ×${width} arms` : ''} → ${goal!.slice(0, 80)}`);
      const roundApproaches = approachesForRound(approaches, r, plan.arms.length);
      const results = await Promise.all(plan.arms.map((a, i) => runArm(a, r, goal!, roundApproaches[i])));

      for (const a of results.filter((x) => x.skipped)) {
        log(`r${r}${width > 1 ? ` a${a.arm}` : ''}: ${a.skipped}${a.reason ? ` (${a.reason})` : ''} → skip`);
      }

      // 5a. Choose the winner among gate-accepted arms (highest effect; ties → lowest arm).
      const verdictArms = results.filter((a) => a.res);
      const acceptedArms = verdictArms
        .filter((a) => a.gateAccepted)
        .sort((x, y) => (y.res.verdict?.effect ?? -Infinity) - (x.res.verdict?.effect ?? -Infinity) || x.arm - y.arm);

      // Round-level skip handling (compat: width 1 keeps today's per-reason round_done events).
      if (!verdictArms.length) {
        const first = results[0]!;
        const failedNoVerdict = results.filter((a) => a.skipped === 'no-verdict');
        if (failedNoVerdict.length) {
          rounds.push({
            round: r, candRef: failedNoVerdict[0]!.candRef, failed: true, accepted: false,
            reason: failedNoVerdict[0]!.reason, exitCode: failedNoVerdict[0]!.exitCode ?? null,
            ...(width > 1 ? { arms: results.map(armHistory) } : {}),
          });
          emit({ event: 'round_done', round: r, merged: false, skipped: 'no-verdict', reason: failedNoVerdict[0]!.reason, exitCode: failedNoVerdict[0]!.exitCode ?? null });
        } else {
          const guarded = results.filter((a) => a.skipped === 'eval-guard');
          if (guarded.length) {
            rounds.push({
              round: r, accepted: false, skipped: 'eval-guard', reason: guarded[0]!.reason,
              ...(width > 1 ? { arms: results.map(armHistory) } : { violations: guarded[0]!.violations }),
            });
          }
          emit({ event: 'round_done', round: r, merged: false, skipped: first.skipped });
        }
        for (const a of results) { if (a.candDir) removeWorktree(a.candDir); }
        stale++; if (stale >= maxStale) { stop = 'max-stale'; break; }
        continue;
      }

      // 5b. Optional qualitative judge gate (opt-in, default off). Runs ONLY on
      // candidates the STATISTICAL gate already accepted — the judge can SUBTRACT
      // acceptance, never resurrect a rejected candidate. With multiple accepted
      // arms the judge reviews them in effect order until one is APPROVED.
      // Fail-closed: a judge that errors or returns no parseable verdict blocks
      // that candidate (approve defaults to false).
      let winner: ArmResult | undefined;
      const judgeRejected = new Set<number>();
      if (options.requireJudge) {
        for (const cand of acceptedArms) {
          const baseShort = git(['rev-parse', '--short', 'HEAD'], baseDir);
          const jArgs = ['autoresearch', 'judge',
            '--cwd', cand.candDir!, '--base-ref', baseShort, '--candidate-ref', cand.candRef!, '--json'];
          if (options.judgeRubricFile) jArgs.push('--rubric-file', options.judgeRubricFile);
          else jArgs.push('--rubric', options.judgeRubric ?? DEFAULT_JUDGE_RUBRIC);
          const jModel = options.judgeModel ?? options.model;
          if (jModel) jArgs.push('--model', jModel);
          if (goal) jArgs.push('--mission', goal.slice(0, 500));
          emit({ event: 'judge_start', round: r, arm: cand.arm, candidateRef: cand.candRef });
          const j = await spawnAsync('node', [self, ...jArgs], { stdio: 'capture' });
          let jv: any = null;
          try { jv = JSON.parse(j.stdout); } catch { jv = null; }
          const approve = !!jv?.approve;
          emit({ event: 'judge', round: r, arm: cand.arm, approve, score: jv?.score, confidence: jv?.confidence });
          log(`r${r}${width > 1 ? ` a${cand.arm}` : ''}: judge ${approve ? theme.colors.success('APPROVE') : theme.colors.error('reject')}${jv?.score != null ? ` (score ${jv.score})` : ''}`);
          if (approve) { winner = cand; break; }
          judgeRejected.add(cand.arm);
        }
      } else {
        winner = acceptedArms[0];
      }

      // 5c. Confirmation on fresh data (default on). ONE confirmation per round: the
      // selected winner only, so the confirmation is a single pre-registered test.
      let confirm: ConfirmResult | undefined;
      let notConfirmedArm: number | undefined;
      if (winner && options.confirm !== false) {
        log(`r${r}${width > 1 ? ` a${winner.arm}` : ''}: confirming on fresh train runs`);
        confirm = await confirmWinner(winner, r);
        const ok = confirm.confirmed;
        emit({ event: 'confirm', round: r, arm: winner.arm, mode: confirm.mode, decision: confirm.decision, effect: confirm.effect, pValue: confirm.pValue, ...(confirm.combinedP != null ? { combinedP: confirm.combinedP } : {}), reason: confirm.reason, confirmed: ok });
        log(`r${r}: confirm ${ok ? theme.colors.success('CONFIRMED') : theme.colors.error('NOT CONFIRMED')} (${confirm.reason})`);
        if (!ok) {
          recordNearMiss(winner, r, confirm);
          notConfirmedArm = winner.arm;
          winner = undefined;
        }
      }
      const accept = !!winner;

      // Success metric = TRAIN score (the confirmation's when it ran), never the holdout.
      const candScore = (() => {
        if (!winner) return undefined;
        const s = confirm?.trainSummary ?? winner.res?.benchSummaries?.candidate?.train;
        const t = s?.tasks?.find((x: any) => x.taskId === successMetric?.taskId);
        return t?.meanScore;
      })();
      const lead = winner ?? acceptedArms[0] ?? verdictArms[0]!;
      rounds.push({
        round: r, candRef: lead.candRef, decision: lead.res?.verdict?.decision, effect: lead.res?.verdict?.effect,
        mergeEligible: lead.res?.mergeEligible, accepted: accept, candScore,
        ...(confirm ? { confirm: { confirmed: confirm.confirmed, mode: confirm.mode, decision: confirm.decision, effect: confirm.effect, pValue: confirm.pValue, ...(confirm.combinedP != null ? { combinedP: confirm.combinedP } : {}), reason: confirm.reason, runs: confirm.runs } } : {}),
        ...(lead.res?.runPlan ? { runPlan: lead.res.runPlan } : {}),
        ...(lead.guardBlocks ? { guardBlocks: lead.guardBlocks } : {}),
        ...(width > 1 ? { winnerArm: winner?.arm, arms: results.map(armHistory) } : {}),
      });
      log(`r${r}: ${lead.res?.verdict?.decision?.toUpperCase()} effect ${lead.res?.verdict?.effect}  ${accept ? theme.colors.success('ACCEPT') : theme.colors.error('reject')}${options.holdoutSet ? '' : ' (train-only, UNVERIFIED — pass --holdout-set)'}${width > 1 && winner ? ` (arm ${winner.arm}${winner.model ? ` · ${winner.model}` : ''})` : ''}`);

      // Run planning: warn when the screening runs cannot see --target-effect; with
      // --auto-runs, raise the runs for LATER rounds (never mid-round) up to --max-runs.
      const roundPlan: RunPlan | undefined = lead.res?.runPlan;
      if (roundPlan && !roundPlan.adequate) {
        const msg = `r${r}: underpowered — ${roundPlan.runsPerArm} runs/arm detect ≥ ${roundPlan.detectableEffect} pts at power ${roundPlan.power}; +${roundPlan.targetEffect} needs ${roundPlan.requiredRunsPerArm}/arm`;
        log(msg); emit({ event: 'power_warning', round: r, runPlan: roundPlan });
        if (options.autoRuns && runsPerArm < maxRuns) {
          const next = Math.min(maxRuns, roundPlan.requiredRunsPerArm);
          if (next > runsPerArm) {
            log(`r${r}: --auto-runs → ${next} runs/arm from round ${r + 1}${next === maxRuns && roundPlan.requiredRunsPerArm > maxRuns ? ` (capped by --max-runs; ${roundPlan.requiredRunsPerArm} needed)` : ''}`);
            emit({ event: 'runs_changed', round: r, from: runsPerArm, to: next, required: roundPlan.requiredRunsPerArm });
            runsPerArm = next;
          }
        }
      }

      // B6: keep every arm that did not merge (its commit under a ref + a row with why).
      for (const a of results) {
        if (!a.candRef || a === winner) continue;
        const status = a.skipped === 'eval-guard' ? 'eval-guard'
          : a.skipped === 'no-verdict' ? 'no-verdict'
          : a.flaws?.length ? 'declared-flaws'
          : a.guardBlocks?.length && guardMode === 'block' ? 'guard-blocked'
          : a.arm === notConfirmedArm ? 'not-confirmed'
          : judgeRejected.has(a.arm) ? 'judge-rejected'
          : !a.gateAccepted ? `gate-${a.res?.verdict?.decision ?? 'none'}`
          : 'outranked';
        recordAttempt(a, r, status);
      }

      // 6. Advance or discard.
      if (accept && winner) {
        git(['branch', '-f', branch, winner.candRef!]);   // anchor the accepted commit
        removeWorktree(baseDir);                           // old base
        for (const a of results) { if (a !== winner && a.candDir && !options.keepWorktrees) removeWorktree(a.candDir); }
        baseDir = winner.candDir!; baseRef = winner.candRef!; stale = 0;
        // The drift ledger records the unbiased measurement: the confirmation's when it ran.
        recordDrift(drift, confirm?.families ?? winner.res?.families ?? []);
        if (defId) { if (options.holdoutSet) backlog.markVerified(defId, `loop-r${r}`); else backlog.markFixed(defId, winner.candRef!); }
        emit({ event: 'round_done', round: r, merged: true, ref: winner.candRef, ...(width > 1 ? { arm: winner.arm, model: winner.model } : {}) });
        if (successMetric && candScore != null && candScore >= successMetric.threshold) { stop = 'success'; break; }
      } else {
        if (!options.keepWorktrees) { for (const a of results) { if (a.candDir) removeWorktree(a.candDir); } }
        emit({ event: 'round_done', round: r, merged: false });
        stale++;
        if (stale >= maxStale) { stop = 'max-stale'; break; }
      }
    }
  } finally {
    // Anchor the final result on the loop branch, then clean every loop worktree.
    try { git(['branch', '-f', branch, baseRef]); } catch { /* */ }
    for (const w of worktrees) removeWorktree(w);
    rmSync(sealDir, { recursive: true, force: true });
  }

  emit({ event: 'stop', reason: stop });
  const failedArms = rounds.filter(r => r.failed).map(r => ({ round: r.round, reason: r.reason, exitCode: r.exitCode }));
  const out = { repo, branch, finalRef: baseRef, rounds: rounds.length, merges: rounds.filter(r => r.accepted).length, failures: failedArms.length, failedArms, nearMisses, attempts, runsPerArm,
    drift: Object.fromEntries([...drift].map(([f, d]) => [f, { effect: d.effect, se: Math.round(Math.sqrt(d.variance) * 100) / 100, steps: d.steps }])), stop, ...(width > 1 ? { width } : {}), history: rounds };
  if (json) { console.log(JSON.stringify(out, null, 2)); return; }
  console.log();
  console.log(` ${theme.colors.highlight('Loop done')}  stop=${stop}  rounds=${rounds.length}  merges=${out.merges}`);
  console.log(theme.colors.muted(` Result on branch ${branch} → ${baseRef.slice(0, 8)}. Merge it when satisfied:  git -C ${repo} merge ${branch}`));
  if (nearMisses.length) console.log(theme.colors.muted(` ${nearMisses.length} near-miss(es) kept for re-testing: refs/autoresearch/near-miss/${branch}/*  (rows: ${nearMissLog})`));
  console.log();
}

/** Compact per-arm history entry for the round record / final JSON. */
function armHistory(a: ArmResult): Record<string, unknown> {
  return {
    arm: a.arm,
    ...(a.model ? { model: a.model } : {}),
    ...(a.candRef ? { candRef: a.candRef } : {}),
    ...(a.skipped ? { skipped: a.skipped } : {}),
    ...(a.reason ? { reason: a.reason } : {}),
    ...(a.violations ? { violations: a.violations } : {}),
    ...(a.guardBlocks ? { guardBlocks: a.guardBlocks } : {}),
    ...(a.approach ? { approach: a.approach } : {}),
    ...(a.flaws ? { flaws: a.flaws } : {}),
    ...(a.res ? { decision: a.res.verdict?.decision, effect: a.res.verdict?.effect, mergeEligible: a.res.mergeEligible } : {}),
    ...(a.gateAccepted != null ? { gateAccepted: a.gateAccepted } : {}),
  };
}
