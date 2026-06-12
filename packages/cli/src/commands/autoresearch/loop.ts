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
}

function shQuote(s: string): string { return `'${s.replace(/'/g, `'\\''`)}'`; }

export async function autoResearchLoop(options: AutoResearchLoopOptions): Promise<void> {
  const theme = ThemeManager.getTheme();
  const json = !!options.json;
  const log = (m: string) => { if (!json) console.log(theme.colors.muted(` ${m}`)); };
  const self = process.argv[1]!; // re-invoke this same CLI for fix/experiment

  const miss: string[] = [];
  if (!options.repo) miss.push('--repo');
  if (!options.taskSet) miss.push('--task-set');
  if (miss.length) { console.error(theme.colors.error(`Error: missing ${miss.join(', ')}`)); process.exit(1); }

  const repo = resolve(options.repo!);
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
      if (options.fixerCmd) {
        const cmd = options.fixerCmd.replace(/\{prompt\}/g, shQuote(goal!));
        const f = sh(cmd, candDir);
        if (f.status !== 0) { log(`r${r}: fixer-cmd failed (exit ${f.status}) → skip`); removeWorktree(candDir); stale++; if (stale >= maxStale) { stop = 'max-stale'; break; } continue; }
      } else {
        const f = spawnSync('node', [self, 'autoresearch', 'fix', '--cwd', candDir, '--prompt', goal!, '--json'],
          { stdio: json ? 'ignore' : 'inherit' });
        if (f.status !== 0) { log(`r${r}: fixer failed → skip`); removeWorktree(candDir); stale++; if (stale >= maxStale) { stop = 'max-stale'; break; } continue; }
      }

      // 4. Commit candidate (no change → skip the round).
      git(['add', '-A'], candDir);
      const dirty = spawnSync('git', ['-C', candDir, 'diff', '--cached', '--quiet']).status !== 0;
      if (!dirty) { log(`r${r}: no change → skip`); removeWorktree(candDir); stale++; if (stale >= maxStale) { stop = 'max-stale'; break; } continue; }
      git(['commit', '-q', '-m', `autoresearch loop r${r}: ${goal!.slice(0, 60)}`], candDir);
      const candRef = git(['rev-parse', '--short', 'HEAD'], candDir);

      // 5. Experiment base vs candidate (subprocess → JSON verdict).
      const expArgs = ['autoresearch', 'experiment',
        '--experiment-tag', `loop-r${r}`,
        '--base-dir', baseDir, '--candidate-dir', candDir,
        '--base-ref', git(['rev-parse', '--short', 'HEAD'], baseDir), '--candidate-ref', candRef,
        '--task-set', resolve(options.taskSet!), '--no-build',
        '--cortex-dir', store, '--runs', options.runs ?? '3', '--json'];
      if (options.holdoutSet) expArgs.push('--holdout-set', resolve(options.holdoutSet));
      if (options.model) expArgs.push('--model', options.model);
      if (options.temperature) expArgs.push('--temperature', options.temperature);
      if (options.strategy) expArgs.push('--strategy', options.strategy);
      if (options.runCmd) {
        expArgs.push('--run-cmd', options.runCmd, '--accept-exit', options.acceptExit ?? '0');
        if (options.buildCmd) expArgs.push('--build-cmd', options.buildCmd);
      }
      const exp = spawnSync('node', [self, ...expArgs], { encoding: 'utf8' });
      let res: any;
      try { res = JSON.parse(exp.stdout); } catch { log(`r${r}: experiment produced no verdict → skip`); removeWorktree(candDir); stale++; if (stale >= maxStale) { stop = 'max-stale'; break; } continue; }

      const keep = res.verdict?.decision === 'keep';
      const accept = options.holdoutSet ? !!res.mergeEligible : keep;
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
        if (successMetric && candScore != null && candScore >= successMetric.threshold) { stop = 'success'; break; }
      } else {
        if (!options.keepWorktrees) removeWorktree(candDir);
        stale++;
        if (stale >= maxStale) { stop = 'max-stale'; break; }
      }
    }
  } finally {
    // Anchor the final result on the loop branch, then clean every loop worktree.
    try { git(['branch', '-f', branch, baseRef]); } catch { /* */ }
    for (const w of worktrees) removeWorktree(w);
  }

  const out = { repo, branch, finalRef: baseRef, rounds: rounds.length, merges: rounds.filter(r => r.accepted).length, stop, history: rounds };
  if (json) { console.log(JSON.stringify(out, null, 2)); return; }
  console.log();
  console.log(` ${theme.colors.highlight('Loop done')}  stop=${stop}  rounds=${rounds.length}  merges=${out.merges}`);
  console.log(theme.colors.muted(` Result on branch ${branch} → ${baseRef.slice(0, 8)}. Merge it when satisfied:  git -C ${repo} merge ${branch}`));
  console.log();
}
