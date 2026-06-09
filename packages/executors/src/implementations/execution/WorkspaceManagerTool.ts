/**
 * WorkspaceManager Tool Executor
 *
 * Manages git worktrees for isolated multi-agent parallel development.
 * Supports creating worktrees from local repos, cloning external repos,
 * diffing changes, and cleanup.
 */

import { BaseTool, type ToolResult } from '../../base/index.js';
import type { ExecutorConfig } from '../../base/ToolRegistry.js';
import { execSync } from 'child_process';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';

export interface WorkspaceManagerParams {
  mode: 'create' | 'clone' | 'status' | 'diff' | 'cleanup';
  repo?: string;
  branch?: string;
  baseBranch?: string;
  worktreePath?: string;
  maxDiffLines?: number;
}

export class WorkspaceManagerTool extends BaseTool<WorkspaceManagerParams, ToolResult> {
  private workingDirectory: string;

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
          maxDiffLines: { type: 'number', description: 'Max diff lines (default: 5000)' },
        },
        required: ['mode'],
      },
    );
    this.workingDirectory = config.workingDirectory || process.cwd();
  }

  validateToolParams(params: WorkspaceManagerParams): string | null {
    if (!['create', 'clone', 'status', 'diff', 'cleanup'].includes(params.mode)) {
      return 'mode must be one of: create, clone, status, diff, cleanup';
    }
    if (params.mode === 'clone' && !params.repo) {
      return 'repo is required for clone mode';
    }
    if ((params.mode === 'diff' || params.mode === 'cleanup') && !params.worktreePath) {
      return 'worktreePath is required for diff/cleanup mode';
    }
    return null;
  }

  async execute(params: WorkspaceManagerParams, _signal: AbortSignal): Promise<ToolResult> {
    try {
      switch (params.mode) {
        case 'create':
          return this.createWorktree(params);
        case 'clone':
          return this.cloneAndWorktree(params);
        case 'status':
          return this.listWorktrees(params);
        case 'diff':
          return this.diffWorktree(params);
        case 'cleanup':
          return this.cleanupWorktree(params);
        default:
          return this.createErrorResult(`Unknown mode: ${params.mode}`);
      }
    } catch (error: any) {
      return this.createErrorResult(`WorkspaceManager error: ${error.message}`);
    }
  }

  private createWorktree(params: WorkspaceManagerParams): ToolResult {
    const repoPath = params.repo || this.workingDirectory;
    const shortId = randomUUID().split('-')[0];
    const branch = params.branch || `workspace-${shortId}`;
    const worktreePath = join('/tmp', `workspace-${shortId}`);

    // Ensure the repo path is a git repository
    try {
      execSync('git rev-parse --git-dir', { cwd: repoPath, stdio: 'pipe' });
    } catch {
      return this.createErrorResult(`Not a git repository: ${repoPath}`);
    }

    // Create the worktree with a new branch
    const baseBranch = params.baseBranch || 'main';
    try {
      execSync(`git worktree add "${worktreePath}" -b "${branch}" "${baseBranch}"`, {
        cwd: repoPath,
        stdio: 'pipe',
      });
    } catch (error: any) {
      // Try with HEAD if base branch doesn't exist
      try {
        execSync(`git worktree add "${worktreePath}" -b "${branch}" HEAD`, {
          cwd: repoPath,
          stdio: 'pipe',
        });
      } catch (fallbackError: any) {
        return this.createErrorResult(`Failed to create worktree: ${fallbackError.message}`);
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

  private cloneAndWorktree(params: WorkspaceManagerParams): ToolResult {
    const repo = params.repo!;
    const shortId = randomUUID().split('-')[0];
    const cloneDir = join('/tmp', `repo-${shortId}`);

    // Determine clone URL
    const cloneUrl = repo.includes('://') || repo.includes('@')
      ? repo
      : `https://github.com/${repo}.git`;

    // Clone the repository
    try {
      execSync(`git clone --depth 50 "${cloneUrl}" "${cloneDir}"`, {
        stdio: 'pipe',
        timeout: 120000,
      });
    } catch (error: any) {
      return this.createErrorResult(`Failed to clone ${repo}: ${error.message}`);
    }

    // Optionally create a worktree branch
    const branch = params.branch;
    let worktreePath = cloneDir;

    if (branch) {
      worktreePath = join('/tmp', `workspace-${shortId}`);
      const baseBranch = params.baseBranch || 'main';
      try {
        execSync(`git worktree add "${worktreePath}" -b "${branch}" "${baseBranch}"`, {
          cwd: cloneDir,
          stdio: 'pipe',
        });
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
    };

    return this.createSuccessResult(JSON.stringify(result, null, 2), {
      worktreePath,
      cloneDir,
    });
  }

  private listWorktrees(params: WorkspaceManagerParams): ToolResult {
    const repoPath = params.worktreePath || params.repo || this.workingDirectory;

    try {
      const output = execSync('git worktree list --porcelain', {
        cwd: repoPath,
        stdio: 'pipe',
        encoding: 'utf-8',
      });

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
      return this.createErrorResult(`Failed to list worktrees: ${error.message}`);
    }
  }

  private diffWorktree(params: WorkspaceManagerParams): ToolResult {
    const worktreePath = params.worktreePath!;
    const baseBranch = params.baseBranch || 'main';
    const maxLines = params.maxDiffLines || 5000;

    if (!existsSync(worktreePath)) {
      return this.createErrorResult(`Worktree path does not exist: ${worktreePath}`);
    }

    try {
      // Get diff against base branch
      const diff = execSync(`git diff "${baseBranch}" -- .`, {
        cwd: worktreePath,
        stdio: 'pipe',
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024,
      });

      // Get list of changed files
      const changedFiles = execSync(`git diff --name-status "${baseBranch}" -- .`, {
        cwd: worktreePath,
        stdio: 'pipe',
        encoding: 'utf-8',
      });

      // Truncate diff if needed
      const lines = diff.split('\n');
      const truncated = lines.length > maxLines;
      const truncatedDiff = truncated ? lines.slice(0, maxLines).join('\n') + '\n... (truncated)' : diff;

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
      return this.createErrorResult(`Failed to diff worktree: ${error.message}`);
    }
  }

  private cleanupWorktree(params: WorkspaceManagerParams): ToolResult {
    const worktreePath = params.worktreePath!;

    // Find parent repo for the worktree
    let repoPath: string | null = null;
    try {
      repoPath = execSync('git rev-parse --git-common-dir', {
        cwd: worktreePath,
        stdio: 'pipe',
        encoding: 'utf-8',
      }).trim();
      // git-common-dir returns the .git dir — go up one level for repo root
      if (repoPath.endsWith('/.git')) {
        repoPath = repoPath.replace(/\/.git$/, '');
      }
    } catch {
      // If worktree doesn't exist, just try to clean up the directory
    }

    // Remove the worktree via git
    if (repoPath) {
      try {
        execSync(`git worktree remove "${worktreePath}" --force`, {
          cwd: repoPath,
          stdio: 'pipe',
        });
      } catch {
        // Force remove the directory if git worktree remove fails
        if (existsSync(worktreePath)) {
          rmSync(worktreePath, { recursive: true, force: true });
        }
      }
    } else if (existsSync(worktreePath)) {
      rmSync(worktreePath, { recursive: true, force: true });
    }

    // Prune any dangling worktrees
    if (repoPath) {
      try {
        execSync('git worktree prune', { cwd: repoPath, stdio: 'pipe' });
      } catch {
        // Non-critical
      }
    }

    const result = {
      mode: 'cleanup',
      worktreePath,
      removed: true,
    };

    return this.createSuccessResult(JSON.stringify(result, null, 2));
  }
}
