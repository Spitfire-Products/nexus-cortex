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
 *   4. Commit each candidate (no change → that arm is skipped).
 *   5. Run `cortex autoresearch experiment` per arm (base vs candidate, FWER-adjusted with
 *      --n-family = the number of arms launched) and read the verdicts.
 *   6. ACCEPT = mergeEligible when a holdout is given (keep + FWER + holdout-verified); with
 *      no holdout, accept = keep-on-train (logged as UNVERIFIED — provide --holdout-set for
 *      the overfitting guard). The WINNER is the gate-accepted arm with the highest effect;
 *      with --require-judge the judge reviews accepted arms in effect order until one is
 *      approved. On accept: advance base to the winner + anchor the loop branch to it.
 *      Losing/rejected arms are dropped.
 *   7. Stop on: success metric met, max rounds, max consecutive stale rounds, or a dry backlog.
 *
 * GIT SAFETY: all work happens in throwaway worktrees off a dedicated loop branch
 * (`autoresearch/loop-*`). The user's branch and working tree are never touched. Accepted
 * candidate commits are anchored to the loop branch so detached-HEAD commits survive
 * worktree removal; the operator merges the loop branch when satisfied.
 */
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ResearchBacklog } from '@nexus-cortex/core';
import { ThemeManager } from '../../themes/ThemeManager.js';
import { resolveRepoDir, resolveTaskSet } from './repoResolve.js';
import { planArms, parseMissingKeyPolicy, type ArmAssignment } from './armPlan.js';

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
  'or bundles unrelated rewrites. A measurable, holdout-verified gain is NECESSARY but NOT ' +
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

/** One arm's outcome within a round. */
interface ArmResult {
  arm: number;
  model?: string;
  strategy?: string;
  candDir?: string;
  candRef?: string;
  /** 'fixer-failed' | 'no-change' | 'no-verdict' when the arm produced no verdict. */
  skipped?: string;
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

  // ---- Multi-provider arm plan (width 1 = classic single-arm loop) ------------
  let policy;
  try { policy = parseMissingKeyPolicy(options.missingProviderKeyPolicy); }
  catch (e) { console.error(theme.colors.error(`Error: ${(e as Error).message}`)); process.exit(1); return; }
  const splitList = (s?: string) => s?.split(',').map((x) => x.trim()).filter(Boolean);
  const plan = planArms({
    width: Number(options.width ?? '1'),
    baseModel: options.model,
    armModels: splitList(options.armModels),
    providers: splitList(options.providers),
    strategy: options.strategy,
    policy,
  });
  const width = plan.arms.length;
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

  /** Run one arm: worktree → fixer → commit → experiment. Never throws. */
  const runArm = async (assign: ArmAssignment, r: number, goal: string): Promise<ArmResult> => {
    const out: ArmResult = { arm: assign.arm, model: assign.model, strategy: assign.strategy };
    const candDir = addWorktree(baseRef);
    out.candDir = candDir;

    // 3. Mutate (fixer). Single-arm keeps today's interactive stdio; parallel arms are quiet.
    const fixerStdio: 'inherit' | 'ignore' = json || width > 1 ? 'ignore' : 'inherit';
    emit({ event: 'fix', round: r, arm: assign.arm, model: assign.model, fixer: options.fixerCmd ? 'command' : 'llm' });
    if (options.fixerCmd) {
      const cmd = options.fixerCmd.replace(/\{prompt\}/g, shQuote(goal));
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        CORTEX_ARM_INDEX: String(assign.arm),
        ...(assign.model ? { CORTEX_ARM_MODEL: assign.model } : {}),
        ...(assign.strategy ? { CORTEX_ARM_STRATEGY: assign.strategy } : {}),
      };
      const f = width > 1
        ? await spawnAsync('sh', ['-c', cmd], { cwd: candDir, env, stdio: fixerStdio })
        : { status: sh(cmd, candDir).status, stdout: '', stderr: '' };
      if (f.status !== 0) { out.skipped = 'fixer-failed'; out.exitCode = f.status; return out; }
    } else {
      const fixArgs = [self, 'autoresearch', 'fix', '--cwd', candDir, '--prompt', goal, '--json'];
      if (assign.model) fixArgs.push('--model', assign.model);
      const f = await spawnAsync('node', fixArgs, { stdio: fixerStdio });
      if (f.status !== 0) { out.skipped = 'fixer-failed'; out.exitCode = f.status; return out; }
    }

    // 4. Commit candidate (no change → skip this arm).
    git(['add', '-A'], candDir);
    const dirty = spawnSync('git', ['-C', candDir, 'diff', '--cached', '--quiet']).status !== 0;
    if (!dirty) { out.skipped = 'no-change'; return out; }
    git(['commit', '-q', '-m', `autoresearch loop r${r}${width > 1 ? `a${assign.arm}` : ''}: ${goal.slice(0, 60)}`], candDir);
    out.candRef = git(['rev-parse', '--short', 'HEAD'], candDir);

    // 5. Experiment base vs candidate (subprocess → JSON verdict). FWER-adjusted with the
    // real family width so N parallel arms don't inflate the false-keep rate.
    const tag = width > 1 ? `loop-r${r}a${assign.arm}` : `loop-r${r}`;
    const expArgs = ['autoresearch', 'experiment',
      '--experiment-tag', tag,
      '--base-dir', baseDir, '--candidate-dir', candDir,
      '--base-ref', git(['rev-parse', '--short', 'HEAD'], baseDir), '--candidate-ref', out.candRef,
      '--task-set', resolveTaskSet(options.taskSet!, repo), '--no-build',
      '--n-family', String(width),
      '--cortex-dir', store, '--runs', options.runs ?? '3', '--json'];
    if (options.holdoutSet) expArgs.push('--holdout-set', resolveTaskSet(options.holdoutSet, repo));
    if (options.model) expArgs.push('--model', options.model);
    if (options.temperature) expArgs.push('--temperature', options.temperature);
    if (assign.strategy) expArgs.push('--strategy', assign.strategy);
    if (options.runCmd) {
      expArgs.push('--run-cmd', options.runCmd, '--accept-exit', options.acceptExit ?? '0');
      if (options.buildCmd) expArgs.push('--build-cmd', options.buildCmd);
    }
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
      const results = await Promise.all(plan.arms.map((a) => runArm(a, r, goal!)));

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
        }
      } else {
        winner = acceptedArms[0];
      }
      const accept = !!winner;

      const candScore = (() => {
        const src = winner ?? acceptedArms[0] ?? verdictArms[0];
        const s = src?.res?.benchSummaries?.candidate?.holdout ?? src?.res?.benchSummaries?.candidate?.train;
        const t = s?.tasks?.find((x: any) => x.taskId === successMetric?.taskId);
        return t?.meanScore;
      })();
      const lead = winner ?? acceptedArms[0] ?? verdictArms[0]!;
      rounds.push({
        round: r, candRef: lead.candRef, decision: lead.res?.verdict?.decision, effect: lead.res?.verdict?.effect,
        mergeEligible: lead.res?.mergeEligible, accepted: accept, candScore,
        ...(width > 1 ? { winnerArm: winner?.arm, arms: results.map(armHistory) } : {}),
      });
      log(`r${r}: ${lead.res?.verdict?.decision?.toUpperCase()} effect ${lead.res?.verdict?.effect}  ${accept ? theme.colors.success('ACCEPT') : theme.colors.error('reject')}${options.holdoutSet ? '' : ' (train-only, UNVERIFIED — pass --holdout-set)'}${width > 1 && winner ? ` (arm ${winner.arm}${winner.model ? ` · ${winner.model}` : ''})` : ''}`);

      // 6. Advance or discard.
      if (accept && winner) {
        git(['branch', '-f', branch, winner.candRef!]);   // anchor the accepted commit
        removeWorktree(baseDir);                           // old base
        for (const a of results) { if (a !== winner && a.candDir && !options.keepWorktrees) removeWorktree(a.candDir); }
        baseDir = winner.candDir!; baseRef = winner.candRef!; stale = 0;
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
  }

  emit({ event: 'stop', reason: stop });
  const failedArms = rounds.filter(r => r.failed).map(r => ({ round: r.round, reason: r.reason, exitCode: r.exitCode }));
  const out = { repo, branch, finalRef: baseRef, rounds: rounds.length, merges: rounds.filter(r => r.accepted).length, failures: failedArms.length, failedArms, stop, ...(width > 1 ? { width } : {}), history: rounds };
  if (json) { console.log(JSON.stringify(out, null, 2)); return; }
  console.log();
  console.log(` ${theme.colors.highlight('Loop done')}  stop=${stop}  rounds=${rounds.length}  merges=${out.merges}`);
  console.log(theme.colors.muted(` Result on branch ${branch} → ${baseRef.slice(0, 8)}. Merge it when satisfied:  git -C ${repo} merge ${branch}`));
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
    ...(a.res ? { decision: a.res.verdict?.decision, effect: a.res.verdict?.effect, mergeEligible: a.res.mergeEligible } : {}),
    ...(a.gateAccepted != null ? { gateAccepted: a.gateAccepted } : {}),
  };
}
