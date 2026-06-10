/**
 * WorkspaceManager Tool Executor
 *
 * Manages git worktrees for isolated multi-agent parallel development.
 * Supports creating worktrees from local repos, cloning external repos,
 * diffing changes, and cleanup.
 *
 * Security: all git/gh invocations use execFile with an argument array (no shell).
 * Repo/branch inputs are validated through GitPolicy; the auth token rides only in the
 * subprocess environment, never in a clone URL or on argv. See GitPolicy.ts.
 */

import { BaseTool, type ToolResult } from '../../base/index.js';
import type { ExecutorConfig } from '../../base/ToolRegistry.js';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { existsSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { GitPolicy, type GitAction } from '../../utils/GitPolicy.js';

const execFileAsync = promisify(execFile);

function subprocessError(error: any): string {
  const stderr = (error?.stderr || '').toString().trim();
  return stderr || error?.message || 'unknown subprocess error';
}

export interface WorkspaceManagerParams {
  mode: 'create' | 'clone' | 'status' | 'diff' | 'cleanup';
  repo?: string;
  branch?: string;
  baseBranch?: string;
  worktreePath?: string;
  /** For cleanup: also remove this clone directory (returned by clone mode). */
  cloneDir?: string;
  maxDiffLines?: number;
}

export class WorkspaceManagerTool extends BaseTool<WorkspaceManagerParams, ToolResult> {
  private workingDirectory: string;
  private readonly policy: GitPolicy;

  constructor(config: ExecutorConfig) {
    super(
      'WorkspaceManager',
      'WorkspaceManager',
      'Manage isolated git worktrees for multi-agent parallel development',
      {
        type: 'object',
        properties: {
          mode: {
            type: 'string',
            enum: ['create', 'clone', 'status', 'diff', 'cleanup'],
            description: 'Operation mode',
          },
          repo: { type: 'string', description: 'Repository path or owner/repo' },
          branch: { type: 'string', description: 'Branch name for worktree' },
          baseBranch: { type: 'string', description: 'Base branch for diff (default: main)' },
          worktreePath: { type: 'string', description: 'Path to specific worktree' },
          cloneDir: {
            type: 'string',
            description: 'Clone directory to remove in cleanup (from a prior clone result)',
          },
          maxDiffLines: { type: 'number', description: 'Max diff lines (default: 5000)' },
        },
        required: ['mode'],
      },
    );
    this.workingDirectory = config.workingDirectory || process.cwd();
    this.policy = GitPolicy.fromEnv();
  }

  validateToolParams(params: WorkspaceManagerParams): string | null {
    if (!['create', 'clone', 'status', 'diff', 'cleanup'].includes(params.mode)) {
      return 'mode must be one of: create, clone, status, diff, cleanup';
    }

    // Policy action gate (worktree-family modes map to the 'worktree' action).
    const action: GitAction =
      params.mode === 'clone'
        ? 'clone'
        : params.mode === 'status'
          ? 'status'
          : params.mode === 'diff'
            ? 'diff'
            : params.mode === 'cleanup'
              ? 'cleanup'
              : 'worktree';
    const actionErr = this.policy.assertAction(action);
    if (actionErr) return actionErr;

    if (params.mode === 'clone' && !params.repo) {
      return 'repo is required for clone mode';
    }
    // For clone, an owner/repo form is validated against the allow-list; explicit
    // URLs / SSH remotes (containing :// or @) bypass the owner/repo regex but are
    // still passed as a discrete argv element to git (no shell).
    if (params.mode === 'clone' && params.repo && !/(:\/\/|@)/.test(params.repo)) {
      const repoErr = this.policy.validateRepo(params.repo);
      if (repoErr) return repoErr;
    }
    if (params.branch !== undefined) {
      const branchErr = this.policy.validateBranch(params.branch);
      if (branchErr) return branchErr;
    }
    if (params.baseBranch !== undefined) {
      const baseErr = this.policy.validateBranch(params.baseBranch);
      if (baseErr) return baseErr;
    }
    if ((params.mode === 'diff' || params.mode === 'cleanup') && !params.worktreePath) {
      return 'worktreePath is required for diff/cleanup mode';
    }
    return null;
  }

  async execute(params: WorkspaceManagerParams, signal: AbortSignal): Promise<ToolResult> {
    try {
      switch (params.mode) {
        case 'create':
          return await this.createWorktree(params, signal);
        case 'clone':
          return await this.cloneAndWorktree(params, signal);
        case 'status':
          return await this.listWorktrees(params, signal);
        case 'diff':
          return await this.diffWorktree(params, signal);
        case 'cleanup':
          return await this.cleanupWorktree(params, signal);
        default:
          return this.createErrorResult(`Unknown mode: ${params.mode}`);
      }
    } catch (error: any) {
      return this.createErrorResult(`WorkspaceManager error: ${subprocessError(error)}`);
    }
  }

  /** git invocation: execFile (no shell), policy token/host env, AbortSignal. */
  private git(args: string[], cwd: string | undefined, signal: AbortSignal, timeout?: number) {
    return execFileAsync('git', args, {
      cwd,
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
      signal,
      timeout,
      env: this.policy.subprocessEnv(),
    });
  }

  private async createWorktree(
    params: WorkspaceManagerParams,
    signal: AbortSignal,
  ): Promise<ToolResult> {
    const repoPath = params.repo || this.workingDirectory;
    const shortId = randomUUID().split('-')[0];
    const branch = params.branch || `workspace-${shortId}`;
    const worktreePath = join(tmpdir(), `workspace-${shortId}`);

    // Ensure the repo path is a git repository
    try {
      await this.git(['rev-parse', '--git-dir'], repoPath, signal);
    } catch {
      return this.createErrorResult(`Not a git repository: ${repoPath}`);
    }

    // Create the worktree with a new branch
    const baseBranch = params.baseBranch || 'main';
    try {
      await this.git(['worktree', 'add', worktreePath, '-b', branch, baseBranch], repoPath, signal);
    } catch (error: any) {
      // Try with HEAD if base branch doesn't exist
      try {
        await this.git(['worktree', 'add', worktreePath, '-b', branch, 'HEAD'], repoPath, signal);
      } catch (fallbackError: any) {
        return this.createErrorResult(
          `Failed to create worktree: ${subprocessError(fallbackError)}`,
        );
      }
    }

    const result = {
      mode: 'create',
      worktreePath,
      branch,
      baseBranch,
      repoPath,
    };

    return this.createSuccessResult(JSON.stringify(result, null, 2), {
      worktreePath,
      branch,
    });
  }

  private async cloneAndWorktree(
    params: WorkspaceManagerParams,
    signal: AbortSignal,
  ): Promise<ToolResult> {
    const repo = params.repo!;
    const shortId = randomUUID().split('-')[0];
    const cloneDir = join(tmpdir(), `repo-${shortId}`);
    const isOwnerRepo = !/(:\/\/|@)/.test(repo);

    // Clone the repository. owner/repo with a token → gh repo clone (native auth/host).
    // Explicit URL / SSH remote, or no gh/token → host-aware git clone.
    try {
      if (isOwnerRepo && (this.policy.token || (await this.ghAvailable(signal)))) {
        await execFileAsync('gh', ['repo', 'clone', repo, cloneDir, '--', '--depth', '50'], {
          encoding: 'utf-8',
          maxBuffer: 10 * 1024 * 1024,
          signal,
          timeout: 120000,
          env: this.policy.subprocessEnv(),
        });
      } else {
        const cloneUrl = isOwnerRepo ? this.policy.cloneUrl(repo) : repo;
        await this.git(['clone', '--depth', '50', cloneUrl, cloneDir], undefined, signal, 120000);
      }
    } catch (error: any) {
      return this.createErrorResult(`Failed to clone ${repo}: ${subprocessError(error)}`);
    }

    // Optionally create a worktree branch
    const branch = params.branch;
    let worktreePath = cloneDir;

    if (branch) {
      worktreePath = join(tmpdir(), `workspace-${shortId}`);
      const baseBranch = params.baseBranch || 'main';
      try {
        await this.git(['worktree', 'add', worktreePath, '-b', branch, baseBranch], cloneDir, signal);
      } catch {
        // Worktree creation optional — still return the clone dir
        worktreePath = cloneDir;
      }
    }

    const result = {
      mode: 'clone',
      cloneDir,
      worktreePath,
      branch: branch || null,
      repo,
      // Echo back so the model passes both to cleanup and nothing is orphaned.
      cleanupHint: { worktreePath, cloneDir },
    };

    return this.createSuccessResult(JSON.stringify(result, null, 2), {
      worktreePath,
      cloneDir,
    });
  }

  private async listWorktrees(
    params: WorkspaceManagerParams,
    signal: AbortSignal,
  ): Promise<ToolResult> {
    const repoPath = params.worktreePath || params.repo || this.workingDirectory;

    try {
      const { stdout: output } = await this.git(
        ['worktree', 'list', '--porcelain'],
        repoPath,
        signal,
      );

      // Parse porcelain output
      const worktrees: Array<{ path: string; head: string; branch: string }> = [];
      let current: any = {};

      for (const line of output.split('\n')) {
        if (line.startsWith('worktree ')) {
          if (current.path) worktrees.push(current);
          current = { path: line.replace('worktree ', '') };
        } else if (line.startsWith('HEAD ')) {
          current.head = line.replace('HEAD ', '').substring(0, 8);
        } else if (line.startsWith('branch ')) {
          current.branch = line.replace('branch refs/heads/', '');
        }
      }
      if (current.path) worktrees.push(current);

      const result = {
        mode: 'status',
        worktreeCount: worktrees.length,
        worktrees,
      };

      return this.createSuccessResult(JSON.stringify(result, null, 2));
    } catch (error: any) {
      return this.createErrorResult(`Failed to list worktrees: ${subprocessError(error)}`);
    }
  }

  private async diffWorktree(
    params: WorkspaceManagerParams,
    signal: AbortSignal,
  ): Promise<ToolResult> {
    const worktreePath = params.worktreePath!;
    const baseBranch = params.baseBranch || 'main';
    const maxLines = params.maxDiffLines || 5000;

    if (!existsSync(worktreePath)) {
      return this.createErrorResult(`Worktree path does not exist: ${worktreePath}`);
    }

    try {
      // Get diff against base branch
      const { stdout: diff } = await this.git(['diff', baseBranch, '--', '.'], worktreePath, signal);

      // Get list of changed files
      const { stdout: changedFiles } = await this.git(
        ['diff', '--name-status', baseBranch, '--', '.'],
        worktreePath,
        signal,
      );

      // Truncate diff if needed
      const lines = diff.split('\n');
      const truncated = lines.length > maxLines;
      const truncatedDiff = truncated
        ? lines.slice(0, maxLines).join('\n') + '\n... (truncated)'
        : diff;

      const result = {
        mode: 'diff',
        worktreePath,
        baseBranch,
        changedFiles: changedFiles.trim().split('\n').filter(Boolean),
        fileCount: changedFiles.trim().split('\n').filter(Boolean).length,
        diffLines: lines.length,
        truncated,
        diff: truncatedDiff,
      };

      return this.createSuccessResult(JSON.stringify(result, null, 2));
    } catch (error: any) {
      return this.createErrorResult(`Failed to diff worktree: ${subprocessError(error)}`);
    }
  }

  private async cleanupWorktree(
    params: WorkspaceManagerParams,
    signal: AbortSignal,
  ): Promise<ToolResult> {
    const worktreePath = params.worktreePath!;
    const removed: string[] = [];

    // Find parent repo for the worktree (so we can also delete the branch it created).
    let repoPath: string | null = null;
    let branchName: string | null = null;
    try {
      const { stdout } = await this.git(['rev-parse', '--git-common-dir'], worktreePath, signal);
      repoPath = stdout.trim();
      if (repoPath.endsWith('/.git')) {
        repoPath = repoPath.replace(/\/.git$/, '');
      }
      // Capture the branch checked out in this worktree, to delete it after removal.
      try {
        const { stdout: br } = await this.git(
          ['rev-parse', '--abbrev-ref', 'HEAD'],
          worktreePath,
          signal,
        );
        const candidate = br.trim();
        if (candidate && candidate !== 'HEAD') branchName = candidate;
      } catch {
        /* detached or gone — nothing to delete */
      }
    } catch {
      // If worktree doesn't exist, just try to clean up the directory
    }

    // Remove the worktree via git
    if (repoPath) {
      try {
        await this.git(['worktree', 'remove', worktreePath, '--force'], repoPath, signal);
        removed.push(worktreePath);
      } catch {
        // Force remove the directory if git worktree remove fails
        if (existsSync(worktreePath)) {
          rmSync(worktreePath, { recursive: true, force: true });
          removed.push(worktreePath);
        }
      }

      // Delete the worktree's branch so workspace-* refs don't accumulate.
      if (branchName) {
        try {
          await this.git(['branch', '-D', branchName], repoPath, signal);
        } catch {
          /* non-critical */
        }
      }

      // Prune any dangling worktrees
      try {
        await this.git(['worktree', 'prune'], repoPath, signal);
      } catch {
        /* Non-critical */
      }
    } else if (existsSync(worktreePath)) {
      rmSync(worktreePath, { recursive: true, force: true });
      removed.push(worktreePath);
    }

    // Remove the clone directory too, if this worktree came from a clone (no longer orphaned).
    if (params.cloneDir && params.cloneDir !== worktreePath && existsSync(params.cloneDir)) {
      rmSync(params.cloneDir, { recursive: true, force: true });
      removed.push(params.cloneDir);
    }

    const result = {
      mode: 'cleanup',
      worktreePath,
      branch: branchName,
      removed,
      cloneDirRemoved: Boolean(params.cloneDir && params.cloneDir !== worktreePath),
    };

    return this.createSuccessResult(JSON.stringify(result, null, 2));
  }

  /** Best-effort gh availability probe (used to pick the clone path). */
  private async ghAvailable(signal: AbortSignal): Promise<boolean> {
    try {
      await execFileAsync('gh', ['--version'], { signal });
      return true;
    } catch {
      return false;
    }
  }
}
