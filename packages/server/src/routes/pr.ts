/**
 * PR Management Routes
 * Exposes pull request review, creation, listing, and webhook endpoints.
 * These routes use the orchestrator to send prompts that trigger PRAgent tool calls.
 */
import { Router, Request, Response } from 'express';
import { getServerOrchestrator } from './messages.js';

export const prRouter = Router();

/**
 * POST /v1/pr/review
 * Trigger a PR review pipeline
 *
 * Body: { repo: "owner/repo", prNumber: number, options?: { pathFilter, maxLines } }
 */
prRouter.post('/v1/pr/review', async (req: Request, res: Response) => {
  try {
    const orchestrator = getServerOrchestrator();
    if (!orchestrator) {
      return res.status(503).json({
        error: { message: 'Server not initialized', type: 'server_error' },
      });
    }

    const { repo, prNumber, options } = req.body;
    if (!repo || !prNumber) {
      return res.status(400).json({
        error: { message: 'repo and prNumber are required', type: 'invalid_request' },
      });
    }

    // Build a prompt that instructs the model to use PRAgent and dispatch review agents
    const diffOptionsStr = options
      ? `, diffOptions: ${JSON.stringify(options)}`
      : '';

    const prompt = `Review pull request #${prNumber} in ${repo}.

Use PRAgent(mode=review, repo="${repo}", prNumber=${prNumber}${diffOptionsStr}) to get the PR diff and metadata.

Then dispatch these review agents IN PARALLEL using the Task tool:
1. pr-security-auditor: Scan for security vulnerabilities
2. pr-code-quality: Review code quality and patterns
3. pr-architecture-reviewer: Assess architectural impact

After all agents complete, synthesize their findings into a final review recommendation.`;

    const response = await orchestrator.sendMessage(prompt);

    res.json({
      review: {
        repo,
        prNumber,
        response: response.content,
        toolUses: response.toolUses,
        usage: response.usage,
        metadata: response.metadata,
      },
    });
  } catch (error: any) {
    res.status(500).json({
      error: { message: error.message, type: 'server_error' },
    });
  }
});

/**
 * POST /v1/pr/create
 * Trigger a PR creation pipeline
 *
 * Body: { repo: "owner/repo", branch: string, description?: string }
 */
prRouter.post('/v1/pr/create', async (req: Request, res: Response) => {
  try {
    const orchestrator = getServerOrchestrator();
    if (!orchestrator) {
      return res.status(503).json({
        error: { message: 'Server not initialized', type: 'server_error' },
      });
    }

    const { repo, branch, description } = req.body;
    if (!repo) {
      return res.status(400).json({
        error: { message: 'repo is required', type: 'invalid_request' },
      });
    }

    const prompt = `Create a pull request for ${repo}${branch ? ` on branch "${branch}"` : ''}.
${description ? `\nDescription: ${description}` : ''}

Use WorkspaceManager to set up an isolated worktree, then use PRAgent(mode=create) to prepare the PR context.
Dispatch a pr-implementer agent to make the changes in the worktree.`;

    const response = await orchestrator.sendMessage(prompt);

    res.json({
      create: {
        repo,
        branch,
        response: response.content,
        toolUses: response.toolUses,
        metadata: response.metadata,
      },
    });
  } catch (error: any) {
    res.status(500).json({
      error: { message: error.message, type: 'server_error' },
    });
  }
});

/**
 * GET /v1/pr/list
 * List open PRs for a repository
 *
 * Query: ?repo=owner/repo
 */
prRouter.get('/v1/pr/list', async (req: Request, res: Response) => {
  try {
    const orchestrator = getServerOrchestrator();
    if (!orchestrator) {
      return res.status(503).json({
        error: { message: 'Server not initialized', type: 'server_error' },
      });
    }

    const repo = req.query.repo as string;
    if (!repo) {
      return res.status(400).json({
        error: { message: 'repo query parameter is required', type: 'invalid_request' },
      });
    }

    const prompt = `List open pull requests for ${repo}. Use PRAgent(mode=list, repo="${repo}") and return the results.`;
    const response = await orchestrator.sendMessage(prompt);

    res.json({
      list: {
        repo,
        response: response.content,
        toolUses: response.toolUses,
      },
    });
  } catch (error: any) {
    res.status(500).json({
      error: { message: error.message, type: 'server_error' },
    });
  }
});

/**
 * POST /v1/pr/webhook
 * GitHub webhook endpoint for auto-review on PR open (future)
 *
 * Body: GitHub webhook payload
 */
prRouter.post('/v1/pr/webhook', async (req: Request, res: Response) => {
  // Future: auto-review when PR is opened
  const event = req.headers['x-github-event'];
  const payload = req.body;

  if (event === 'pull_request' && payload.action === 'opened') {
    const repo = payload.repository?.full_name;
    const prNumber = payload.number;

    if (repo && prNumber) {
      // Acknowledge immediately, process async
      res.status(202).json({ status: 'accepted', message: 'Review will be processed asynchronously' });

      // TODO: Trigger review pipeline in background
      // const orchestrator = getServerOrchestrator();
      // if (orchestrator) { ... }
      return;
    }
  }

  res.status(200).json({ status: 'ok', message: 'Event received but no action taken' });
});
