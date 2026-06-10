/**
 * PRAgent Tool Executor
 *
 * Manages GitHub pull request operations — review, create, list, and post reviews.
 * Uses the gh CLI for all GitHub interactions.
 * Returns structured context for the LLM to dispatch Task calls to specialized agents.
 *
 * Security: all gh invocations use execFile with an argument array (no shell), and every
 * repo/prNumber/action is validated through GitPolicy before use. See GitPolicy.ts.
 */

import { BaseTool, type ToolResult } from '../../base/index.js';
import type { ExecutorConfig } from '../../base/ToolRegistry.js';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { GitPolicy } from '../../utils/GitPolicy.js';

const execFileAsync = promisify(execFile);

/** Pull the real failure reason out of an execFile rejection (stderr, then message). */
function subprocessError(error: any): string {
  const stderr = (error?.stderr || '').toString().trim();
  return stderr || error?.message || 'unknown subprocess error';
}

export interface PRAgentParams {
  repo: string;
  mode: 'review' | 'create' | 'list' | 'post-review';
  prNumber?: number;
  branch?: string;
  action?: 'approve' | 'request-changes' | 'comment';
  body?: string;
  diffOptions?: {
    pathFilter?: string;
    maxLines?: number;
  };
}

export class PRAgentToolExecutor extends BaseTool<PRAgentParams, ToolResult> {
  private readonly policy: GitPolicy;

  constructor(_config: ExecutorConfig) {
    super(
      'PRAgent',
      'PRAgent',
      'Manage GitHub pull requests — review, create, list, and post reviews',
      {
        type: 'object',
        properties: {
          repo: { type: 'string', description: 'Repository in "owner/repo" format' },
          mode: {
            type: 'string',
            enum: ['review', 'create', 'list', 'post-review'],
            description: 'Operation mode',
          },
          prNumber: { type: 'number', description: 'PR number' },
          branch: { type: 'string', description: 'Branch name for create mode' },
          action: {
            type: 'string',
            enum: ['approve', 'request-changes', 'comment'],
            description: 'Review action',
          },
          body: { type: 'string', description: 'Comment body' },
          diffOptions: {
            type: 'object',
            properties: {
              pathFilter: { type: 'string' },
              maxLines: { type: 'number' },
            },
          },
        },
        required: ['repo', 'mode'],
      },
    );
    this.policy = GitPolicy.fromEnv();
  }

  validateToolParams(params: PRAgentParams): string | null {
    const repoErr = this.policy.validateRepo(params.repo);
    if (repoErr) return repoErr;

    if (!['review', 'create', 'list', 'post-review'].includes(params.mode)) {
      return 'mode must be one of: review, create, list, post-review';
    }

    // Map mode → policy action for the allow-list.
    const actionForMode = params.mode === 'create' ? 'create' : params.mode;
    const actionErr = this.policy.assertAction(actionForMode as any);
    if (actionErr) return actionErr;

    if (params.mode === 'review' || params.mode === 'post-review') {
      const prErr = this.policy.validatePrNumber(params.prNumber);
      if (prErr) return prErr;
    }
    if (params.mode === 'post-review') {
      if (!params.action) return 'action is required for post-review mode';
      if (
        (params.action === 'request-changes' || params.action === 'comment') &&
        (!params.body || params.body.trim() === '')
      ) {
        return `body is required for the "${params.action}" action`;
      }
    }
    if (params.branch !== undefined) {
      const branchErr = this.policy.validateBranch(params.branch);
      if (branchErr) return branchErr;
    }
    return null;
  }

  async execute(params: PRAgentParams, signal: AbortSignal): Promise<ToolResult> {
    // Verify gh is available
    try {
      await execFileAsync('gh', ['--version'], { signal });
    } catch {
      return this.createErrorResult(
        'GitHub CLI (gh) is not installed or not in PATH. Install it: https://cli.github.com/',
      );
    }

    try {
      switch (params.mode) {
        case 'review':
          return await this.reviewPR(params, signal);
        case 'create':
          return this.createPR(params);
        case 'list':
          return await this.listPRs(params, signal);
        case 'post-review':
          return await this.postReview(params, signal);
        default:
          return this.createErrorResult(`Unknown mode: ${params.mode}`);
      }
    } catch (error: any) {
      return this.createErrorResult(`PRAgent error: ${subprocessError(error)}`);
    }
  }

  /** Shared gh invocation: execFile (no shell), policy token/host env, large buffer. */
  private gh(args: string[], signal: AbortSignal) {
    return execFileAsync('gh', args, {
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
      signal,
      env: this.policy.subprocessEnv(),
    });
  }

  private async reviewPR(params: PRAgentParams, signal: AbortSignal): Promise<ToolResult> {
    const { repo } = params;
    const prNumber = this.policy.prNumber(params.prNumber);
    const maxLines = params.diffOptions?.maxLines || 5000;

    // Get PR metadata
    const { stdout: metadataRaw } = await this.gh(
      [
        'pr',
        'view',
        String(prNumber),
        '--repo',
        repo,
        '--json',
        'number,title,author,body,baseRefName,headRefName,labels,reviewDecision,additions,deletions,changedFiles,commits,files',
      ],
      signal,
    );
    const metadata = JSON.parse(metadataRaw);

    // Get PR diff
    const { stdout: rawDiff } = await this.gh(['pr', 'diff', String(prNumber), '--repo', repo], signal);
    let diff = rawDiff;

    // Apply path filter if specified
    if (params.diffOptions?.pathFilter) {
      const filter = params.diffOptions.pathFilter;
      const sections = diff.split(/^diff --git /m);
      const filtered = sections.filter((s) => s.includes(filter));
      diff = filtered.map((s) => 'diff --git ' + s).join('');
    }

    // Truncate if needed
    const lines = diff.split('\n');
    const truncated = lines.length > maxLines;
    if (truncated) {
      diff = lines.slice(0, maxLines).join('\n') + '\n... (truncated)';
    }

    const result = {
      mode: 'review',
      repo,
      prNumber,
      title: metadata.title,
      author: metadata.author?.login || 'unknown',
      baseBranch: metadata.baseRefName,
      headBranch: metadata.headRefName,
      labels: (metadata.labels || []).map((l: any) => l.name),
      reviewDecision: metadata.reviewDecision,
      stats: {
        additions: metadata.additions,
        deletions: metadata.deletions,
        changedFiles: metadata.changedFiles,
        commits: metadata.commits?.length || 0,
      },
      files: (metadata.files || []).map((f: any) => ({
        path: f.path,
        additions: f.additions,
        deletions: f.deletions,
      })),
      body: metadata.body || '',
      diff,
      diffTruncated: truncated,
    };

    return this.createSuccessResult(JSON.stringify(result, null, 2), {
      prNumber,
      repo,
      title: metadata.title,
    });
  }

  private createPR(params: PRAgentParams): ToolResult {
    const { repo, branch } = params;

    // Return context for orchestrator to set up workspace and assign agents
    const result = {
      mode: 'create',
      repo,
      branch: branch || null,
      instructions:
        'Use WorkspaceManager to create a worktree, then dispatch implementer and test-writer agents.',
    };

    return this.createSuccessResult(JSON.stringify(result, null, 2));
  }

  private async listPRs(params: PRAgentParams, signal: AbortSignal): Promise<ToolResult> {
    const { repo } = params;

    const { stdout } = await this.gh(
      [
        'pr',
        'list',
        '--repo',
        repo,
        '--json',
        'number,title,author,labels,reviewDecision,headRefName,createdAt,isDraft',
        '--limit',
        '50',
      ],
      signal,
    );

    const prs = JSON.parse(stdout);
    const result = {
      mode: 'list',
      repo,
      count: prs.length,
      pullRequests: prs.map((pr: any) => ({
        number: pr.number,
        title: pr.title,
        author: pr.author?.login || 'unknown',
        labels: (pr.labels || []).map((l: any) => l.name),
        reviewDecision: pr.reviewDecision,
        branch: pr.headRefName,
        createdAt: pr.createdAt,
        isDraft: pr.isDraft,
      })),
    };

    return this.createSuccessResult(JSON.stringify(result, null, 2));
  }

  private async postReview(params: PRAgentParams, signal: AbortSignal): Promise<ToolResult> {
    const { repo, action, body } = params;
    const prNumber = this.policy.prNumber(params.prNumber);

    // Map action to gh flag
    const actionFlags: Record<string, string> = {
      approve: '--approve',
      'request-changes': '--request-changes',
      comment: '--comment',
    };

    const flag = actionFlags[action!];
    if (!flag) {
      return this.createErrorResult(`Invalid action: ${action}`);
    }

    // No shell escaping needed — body is a discrete argv element via execFile.
    const args = ['pr', 'review', String(prNumber), '--repo', repo, flag];
    if (body) {
      args.push('--body', body);
    }

    try {
      await this.gh(args, signal);

      const result = {
        mode: 'post-review',
        repo,
        prNumber,
        action,
        posted: true,
      };

      return this.createSuccessResult(JSON.stringify(result, null, 2));
    } catch (error: any) {
      return this.createErrorResult(`Failed to post review: ${subprocessError(error)}`);
    }
  }
}
