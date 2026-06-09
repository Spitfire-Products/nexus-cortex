/**
 * PRAgent Tool Executor
 *
 * Manages GitHub pull request operations — review, create, list, and post reviews.
 * Uses the gh CLI for all GitHub interactions.
 * Returns structured context for the LLM to dispatch Task calls to specialized agents.
 */

import { BaseTool, type ToolResult } from '../../base/index.js';
import type { ExecutorConfig } from '../../base/ToolRegistry.js';
import { execSync } from 'child_process';

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
  }

  validateToolParams(params: PRAgentParams): string | null {
    if (!params.repo || !params.repo.includes('/')) {
      return 'repo must be in "owner/repo" format';
    }
    if (!['review', 'create', 'list', 'post-review'].includes(params.mode)) {
      return 'mode must be one of: review, create, list, post-review';
    }
    if (params.mode === 'review' && !params.prNumber) {
      return 'prNumber is required for review mode';
    }
    if (params.mode === 'post-review' && (!params.prNumber || !params.action)) {
      return 'prNumber and action are required for post-review mode';
    }
    return null;
  }

  async execute(params: PRAgentParams, _signal: AbortSignal): Promise<ToolResult> {
    // Verify gh is available
    try {
      execSync('gh --version', { stdio: 'pipe' });
    } catch {
      return this.createErrorResult(
        'GitHub CLI (gh) is not installed or not in PATH. Install it: https://cli.github.com/',
      );
    }

    try {
      switch (params.mode) {
        case 'review':
          return this.reviewPR(params);
        case 'create':
          return this.createPR(params);
        case 'list':
          return this.listPRs(params);
        case 'post-review':
          return this.postReview(params);
        default:
          return this.createErrorResult(`Unknown mode: ${params.mode}`);
      }
    } catch (error: any) {
      return this.createErrorResult(`PRAgent error: ${error.message}`);
    }
  }

  private reviewPR(params: PRAgentParams): ToolResult {
    const { repo, prNumber } = params;
    const maxLines = params.diffOptions?.maxLines || 5000;

    // Get PR metadata
    const metadataRaw = execSync(
      `gh pr view ${prNumber} --repo ${repo} --json number,title,author,body,baseRefName,headRefName,labels,reviewDecision,additions,deletions,changedFiles,commits,files`,
      { stdio: 'pipe', encoding: 'utf-8' },
    );
    const metadata = JSON.parse(metadataRaw);

    // Get PR diff
    let diff = execSync(`gh pr diff ${prNumber} --repo ${repo}`, {
      stdio: 'pipe',
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
    });

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

  private listPRs(params: PRAgentParams): ToolResult {
    const { repo } = params;

    const output = execSync(
      `gh pr list --repo ${repo} --json number,title,author,labels,reviewDecision,headRefName,createdAt,isDraft --limit 50`,
      { stdio: 'pipe', encoding: 'utf-8' },
    );

    const prs = JSON.parse(output);
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

  private postReview(params: PRAgentParams): ToolResult {
    const { repo, prNumber, action, body } = params;

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

    const bodyArg = body ? `-b "${body.replace(/"/g, '\\"')}"` : '';

    try {
      execSync(`gh pr review ${prNumber} --repo ${repo} ${flag} ${bodyArg}`, {
        stdio: 'pipe',
        encoding: 'utf-8',
      });

      const result = {
        mode: 'post-review',
        repo,
        prNumber,
        action,
        posted: true,
      };

      return this.createSuccessResult(JSON.stringify(result, null, 2));
    } catch (error: any) {
      return this.createErrorResult(`Failed to post review: ${error.message}`);
    }
  }
}
