/**
 * `cortex autoresearch loop` — the autonomous recursive loop: pick a goal, fix it in an
 * isolated worktree, measure base-vs-candidate through the gate, KEEP only what verifies,
 * advance the base, and repeat until a stop condition. The single-process, local analogue
 * of the NPC swarm — useful for "improve project X until the metric clears a bar" without
 * the container infrastructure.
 *
 * Each round:
 *   1. Goal = --prompt, else the highest-priority workable backlog deficiency.
 *   2. Create a candidate worktree detached at the current base ref.
 *   3. Mutate it: --fixer-cmd (any transformer), else the LLM `cortex autoresearch fix`.
 *   4. Commit the candidate (no change → skip the round).
 *   5. Run `cortex autoresearch experiment` (base vs candidate) and read the verdict.
 *   6. ACCEPT = mergeEligible when a holdout is given (keep + FWER + holdout-verified); with
 *      no holdout, accept = keep-on-train (logged as UNVERIFIED — provide --holdout-set for
 *      the overfitting guard). On accept: advance base to the candidate + anchor the loop
 *      branch to it. On reject: drop the worktree.
 *   7. Stop on: success metric met, max rounds, max consecutive stale rounds, or a dry backlog.
 *
 * GIT SAFETY: all work happens in throwaway worktrees off a dedicated loop branch
 * (`autoresearch/loop-*`). The user's branch and working tree are never touched. Accepted
 * candidate commits are anchored to the loop branch so detached-HEAD commits survive
 * worktree removal; the operator merges the loop branch when satisfied.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ResearchBacklog } from '@nexus-cortex/core';
import { ThemeManager } from '../../themes/ThemeManager.js';
import { resolveRepoDir, resolveTaskSet } from './repoResolve.js';

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

  if (!json) console.log(`\n ${theme.colors.highlight('Auto-research loop')}  repo=${repo}  branch=${branch}  base=${baseRef.slice(0, 8)}  max=${maxRounds}\n`);

  try {
    for (let r = 1; r <= maxRounds; r++) {
      emit({ event: 'round_start', round: r });
      // 1. Goal
      let goal = options.prompt;
      let defId: string | undefined;
      if (!goal) {
        const d = backlog.next();
        if (!d) { stop = 'backlog-dry'; break; }
        goal = d.description; defId = d.id;
        backlog.markInProgress(d.id, `loop-r${r}`);
      }

      // 2. Candidate worktree at the current base.
      const candDir = addWorktree(baseRef);

      // 3. Mutate (fixer).
      log(`r${r}: fixing → ${goal!.slice(0, 80)}`);
      emit({ event: 'fix', round: r, fixer: options.fixerCmd ? 'command' : 'llm' });
      if (options.fixerCmd) {
        const cmd = options.fixerCmd.replace(/\{prompt\}/g, shQuote(goal!));
        const f = sh(cmd, candDir);
        if (f.status !== 0) { log(`r${r}: fixer-cmd failed (exit ${f.status}) → skip`); emit({ event: 'round_done', round: r, merged: false, skipped: 'fixer-failed' }); removeWorktree(candDir); stale++; if (stale >= maxStale) { stop = 'max-stale'; break; } continue; }
      } else {
        const f = spawnSync('node', [self, 'autoresearch', 'fix', '--cwd', candDir, '--prompt', goal!, '--json'],
          { stdio: json ? 'ignore' : 'inherit' });
        if (f.status !== 0) { log(`r${r}: fixer failed → skip`); emit({ event: 'round_done', round: r, merged: false, skipped: 'fixer-failed' }); removeWorktree(candDir); stale++; if (stale >= maxStale) { stop = 'max-stale'; break; } continue; }
      }

      // 4. Commit candidate (no change → skip the round).
      git(['add', '-A'], candDir);
      const dirty = spawnSync('git', ['-C', candDir, 'diff', '--cached', '--quiet']).status !== 0;
      if (!dirty) { log(`r${r}: no change → skip`); emit({ event: 'round_done', round: r, merged: false, skipped: 'no-change' }); removeWorktree(candDir); stale++; if (stale >= maxStale) { stop = 'max-stale'; break; } continue; }
      git(['commit', '-q', '-m', `autoresearch loop r${r}: ${goal!.slice(0, 60)}`], candDir);
      const candRef = git(['rev-parse', '--short', 'HEAD'], candDir);

      // 5. Experiment base vs candidate (subprocess → JSON verdict).
      const expArgs = ['autoresearch', 'experiment',
        '--experiment-tag', `loop-r${r}`,
        '--base-dir', baseDir, '--candidate-dir', candDir,
        '--base-ref', git(['rev-parse', '--short', 'HEAD'], baseDir), '--candidate-ref', candRef,
        '--task-set', resolveTaskSet(options.taskSet!, repo), '--no-build',
        '--cortex-dir', store, '--runs', options.runs ?? '3', '--json'];
      if (options.holdoutSet) expArgs.push('--holdout-set', resolveTaskSet(options.holdoutSet, repo));
      if (options.model) expArgs.push('--model', options.model);
      if (options.temperature) expArgs.push('--temperature', options.temperature);
      if (options.strategy) expArgs.push('--strategy', options.strategy);
      if (options.runCmd) {
        expArgs.push('--run-cmd', options.runCmd, '--accept-exit', options.acceptExit ?? '0');
        if (options.buildCmd) expArgs.push('--build-cmd', options.buildCmd);
      }
      emit({ event: 'experiment', round: r, candidateRef: candRef });
      const exp = spawnSync('node', [self, ...expArgs], { encoding: 'utf8' });
      let res: any;
      try { res = JSON.parse(exp.stdout); } catch {
        // Capture WHY this arm produced no verdict (missing/invalid provider key,
        // inference error, crash) so the driving model / fixer / PM is NOTIFIED —
        // not just told "skipped". Surfaced in the round history + emitted event +
        // the final result, so the driver can react (retry / reassign / report).
        const reason = ((exp.stderr || '').trim().split('\n').filter(Boolean).slice(-3).join(' ')
          || (exp.status != null ? `exit ${exp.status}` : 'no parseable verdict')).slice(0, 500);
        log(`r${r}: experiment produced no verdict → skip (${reason})`);
        rounds.push({ round: r, candRef, failed: true, accepted: false, reason, exitCode: exp.status ?? null });
        emit({ event: 'round_done', round: r, merged: false, skipped: 'no-verdict', reason, exitCode: exp.status ?? null });
        removeWorktree(candDir); stale++; if (stale >= maxStale) { stop = 'max-stale'; break; } continue;
      }

      const keep = res.verdict?.decision === 'keep';
      const gateAccept = options.holdoutSet ? !!res.mergeEligible : keep;
      emit({ event: 'gate', round: r, decision: res.verdict?.decision, effect: res.verdict?.effect, mergeEligible: !!res.mergeEligible, accepted: gateAccept });

      // 5b. Optional qualitative judge gate (opt-in, default off). Runs ONLY on a
      // candidate the STATISTICAL gate already accepted — the judge can SUBTRACT
      // acceptance, never resurrect a rejected candidate. Final accept =
      // gate-accept ∧ judge-approve. Fail-closed: a judge that errors or returns
      // no parseable verdict blocks the merge (approve defaults to false).
      let accept = gateAccept;
      if (options.requireJudge && accept) {
        const baseShort = git(['rev-parse', '--short', 'HEAD'], baseDir);
        const jArgs = ['autoresearch', 'judge',
          '--cwd', candDir, '--base-ref', baseShort, '--candidate-ref', candRef, '--json'];
        if (options.judgeRubricFile) jArgs.push('--rubric-file', options.judgeRubricFile);
        else jArgs.push('--rubric', options.judgeRubric ?? DEFAULT_JUDGE_RUBRIC);
        const jModel = options.judgeModel ?? options.model;
        if (jModel) jArgs.push('--model', jModel);
        if (goal) jArgs.push('--mission', goal.slice(0, 500));
        emit({ event: 'judge_start', round: r, candidateRef: candRef });
        const j = spawnSync('node', [self, ...jArgs], { encoding: 'utf8' });
        let jv: any = null;
        try { jv = JSON.parse(j.stdout); } catch { jv = null; }
        const approve = !!jv?.approve;
        if (!approve) accept = false;
        emit({ event: 'judge', round: r, approve, score: jv?.score, confidence: jv?.confidence });
        log(`r${r}: judge ${approve ? theme.colors.success('APPROVE') : theme.colors.error('reject')}${jv?.score != null ? ` (score ${jv.score})` : ''}`);
      }
      const candScore = (() => {
        const s = res.benchSummaries?.candidate?.holdout ?? res.benchSummaries?.candidate?.train;
        const t = s?.tasks?.find((x: any) => x.taskId === successMetric?.taskId);
        return t?.meanScore;
      })();
      rounds.push({ round: r, candRef, decision: res.verdict?.decision, effect: res.verdict?.effect, mergeEligible: res.mergeEligible, accepted: accept, candScore });
      log(`r${r}: ${res.verdict?.decision?.toUpperCase()} effect ${res.verdict?.effect}  ${accept ? theme.colors.success('ACCEPT') : theme.colors.error('reject')}${options.holdoutSet ? '' : ' (train-only, UNVERIFIED — pass --holdout-set)'}`);

      // 6. Advance or discard.
      if (accept) {
        git(['branch', '-f', branch, candRef]);       // anchor the accepted commit
        removeWorktree(baseDir);                       // old base
        baseDir = candDir; baseRef = candRef; stale = 0;
        if (defId) { if (options.holdoutSet) backlog.markVerified(defId, `loop-r${r}`); else backlog.markFixed(defId, candRef); }
        emit({ event: 'round_done', round: r, merged: true, ref: candRef });
        if (successMetric && candScore != null && candScore >= successMetric.threshold) { stop = 'success'; break; }
      } else {
        if (!options.keepWorktrees) removeWorktree(candDir);
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
  const out = { repo, branch, finalRef: baseRef, rounds: rounds.length, merges: rounds.filter(r => r.accepted).length, failures: failedArms.length, failedArms, stop, history: rounds };
  if (json) { console.log(JSON.stringify(out, null, 2)); return; }
  console.log();
  console.log(` ${theme.colors.highlight('Loop done')}  stop=${stop}  rounds=${rounds.length}  merges=${out.merges}`);
  console.log(theme.colors.muted(` Result on branch ${branch} → ${baseRef.slice(0, 8)}. Merge it when satisfied:  git -C ${repo} merge ${branch}`));
  console.log();
}
