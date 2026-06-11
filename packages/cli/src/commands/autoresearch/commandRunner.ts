/**
 * CommandRunner — a `HarnessRunner` that grades a SHELL COMMAND instead of an LLM
 * endpoint. This is the non-cortex experiment path: run `template` (with `{prompt}` /
 * `{case}` substituted) per task in `cwd`, capture stdout, and hand it to the task's
 * verifier (typically a `numeric` verifier that extracts a metric). It lets the
 * auto-research loop measure a library / CLI / test suite / backtest — anything with a
 * build + run + metric — through the same statistical gate as the cortex harness.
 *
 * Exit-code contract: stdout is graded only when the exit code is in `acceptExitCodes`
 * (default `[0]`); otherwise `text=''`, so every verifier fails — a crashed run is not a
 * valid measurement, so it fails the bench and seeds the backlog. stderr (and the exit
 * code) are surfaced via `log`, never graded.
 *
 * The substituted `{prompt}` value is single-quote-escaped before it reaches the shell,
 * so a task prompt cannot inject shell syntax. The `template` itself is operator-supplied
 * (the experiment spec) and trusted.
 */
import { spawn, spawnSync } from 'node:child_process';
import type { HarnessRunner, HarnessRunResult } from '@nexus-cortex/core';
import type { ExperimentTarget, PreparedArm, PrepareArmOptions } from './harnessProcess.js';

export interface CommandRunnerOptions {
  /** Working directory the command runs in (e.g. the candidate worktree). */
  cwd: string;
  /** Command template, e.g. `./eval.sh {prompt}` or `python eval.py --case {prompt}`.
   *  If it contains no `{prompt}`/`{case}` placeholder, the prompt is appended as a
   *  single quoted argument. */
  template: string;
  /** Exit codes whose stdout is accepted for grading. Default `[0]`. */
  acceptExitCodes?: number[];
  /** Per-run hard timeout in ms. Default 120000. */
  timeoutMs?: number;
  /** Progress/diagnostic sink (stderr + nonzero-exit notices). */
  log?: (message: string) => void;
}

/** POSIX single-quote escape: wrap in '…', and close/escape/reopen any embedded quote. */
function shQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

export function commandRunner(opts: CommandRunnerOptions): HarnessRunner {
  const accept = opts.acceptExitCodes ?? [0];
  const timeoutMs = opts.timeoutMs ?? 120_000;
  return {
    run(prompt: string): Promise<HarnessRunResult> {
      const cmd = /\{prompt\}|\{case\}/.test(opts.template)
        ? opts.template.replace(/\{prompt\}|\{case\}/g, shQuote(prompt))
        : `${opts.template} ${shQuote(prompt)}`;
      const start = Date.now();
      return new Promise<HarnessRunResult>((resolve) => {
        const proc = spawn('sh', ['-c', cmd], { cwd: opts.cwd, stdio: ['ignore', 'pipe', 'pipe'] });
        let out = '';
        let err = '';
        let timedOut = false;
        const timer = setTimeout(() => { timedOut = true; try { proc.kill('SIGKILL'); } catch { /* already gone */ } }, timeoutMs);
        proc.stdout.on('data', (d) => { out += d.toString(); });
        proc.stderr.on('data', (d) => { err += d.toString(); });
        const done = (text: string, latencyMs: number): HarnessRunResult =>
          ({ text, modelId: 'command', inputTokens: 0, outputTokens: 0, toolCallCount: 0, latencyMs });
        proc.on('close', (code) => {
          clearTimeout(timer);
          const ok = !timedOut && code != null && accept.includes(code);
          if (!ok) {
            const reason = timedOut ? `timeout after ${timeoutMs}ms` : `exit ${code}`;
            opts.log?.(`[command ${reason}] ${err.trim().slice(-300)}`);
          }
          resolve(done(ok ? out : '', Date.now() - start));
        });
        proc.on('error', (e) => {
          clearTimeout(timer);
          opts.log?.(`[command error] ${e.message}`);
          resolve(done('', Date.now() - start));
        });
      });
    },
  };
}

/**
 * CommandTarget — the non-cortex `ExperimentTarget`. An optional one-shot build command,
 * then grade a shell command per task via `commandRunner`. Nothing to serve, nothing to
 * tear down — so `cortex autoresearch experiment` can run base-vs-candidate on any project
 * (a library, CLI, test suite, backtest) through the same statistical gate as the harness.
 */
export class CommandTarget implements ExperimentTarget {
  readonly kind = 'command';
  constructor(
    private readonly cfg: { template: string; buildCmd?: string; acceptExitCodes?: number[]; timeoutMs?: number },
  ) {}

  async prepare(dir: string, opts: PrepareArmOptions): Promise<PreparedArm> {
    if (opts.build && this.cfg.buildCmd) {
      opts.log(`build: ${this.cfg.buildCmd}  (cwd ${dir})`);
      const b = spawnSync('sh', ['-c', this.cfg.buildCmd], { cwd: dir, stdio: ['ignore', 'ignore', 'inherit'] });
      if (b.status !== 0) throw new Error(`build command failed (exit ${b.status}) in ${dir}`);
    }
    const runner = commandRunner({
      cwd: dir,
      template: this.cfg.template,
      acceptExitCodes: this.cfg.acceptExitCodes,
      timeoutMs: this.cfg.timeoutMs,
      log: opts.log,
    });
    return { runner, stop: () => { /* nothing to tear down */ } };
  }
}
