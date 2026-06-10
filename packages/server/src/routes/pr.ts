/**
 * PR Management Routes
 * Exposes pull request review, creation, listing, and webhook endpoints.
 * These routes use the orchestrator to send prompts that trigger PRAgent tool calls.
 *
 * Security:
 *  - Every `repo` is validated through GitPolicy (format regex + allow-list) BEFORE it
 *    is interpolated into an orchestrator prompt, so unauthenticated callers can't smuggle
 *    shell metacharacters or out-of-policy repos into tool execution.
 *  - The webhook verifies GitHub's X-Hub-Signature-256 HMAC against GITHUB_WEBHOOK_SECRET.
 *    With no secret configured the webhook is disabled (401) rather than open.
 */
import { Router, Request, Response } from 'express';
import { createHmac, timingSafeEqual } from 'crypto';
import { GitPolicy } from '@nexus-cortex/executors';
import { getServerOrchestrator } from './messages.js';

export const prRouter = Router();

const policy = GitPolicy.fromEnv();

/** Validate a PR number from the request (positive integer). */
function validPrNumber(n: unknown): number | null {
  const num = typeof n === 'string' && /^\d+$/.test(n) ? Number(n) : n;
  return Number.isInteger(num) && (num as number) > 0 ? (num as number) : null;
}

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
    const repoErr = policy.validateRepo(repo);
    if (repoErr) {
      return res.status(400).json({ error: { message: repoErr, type: 'invalid_request' } });
    }
    const pr = validPrNumber(prNumber);
    if (pr === null) {
      return res.status(400).json({
        error: { message: 'prNumber must be a positive integer', type: 'invalid_request' },
      });
    }

    // Only forward a known-safe, structured subset of options into the prompt.
    const safeOptions: Record<string, unknown> = {};
    if (options && typeof options === 'object') {
      if (typeof options.pathFilter === 'string') safeOptions.pathFilter = options.pathFilter;
      if (Number.isInteger(options.maxLines)) safeOptions.maxLines = options.maxLines;
    }
    const diffOptionsStr = Object.keys(safeOptions).length
      ? `, diffOptions: ${JSON.stringify(safeOptions)}`
      : '';

    const prompt = `Review pull request #${pr} in ${repo}.

Use PRAgent(mode=review, repo="${repo}", prNumber=${pr}${diffOptionsStr}) to get the PR diff and metadata.

Then dispatch these review agents IN PARALLEL using the Task tool:
1. pr-security-auditor: Scan for security vulnerabilities
2. pr-code-quality: Review code quality and patterns
3. pr-architecture-reviewer: Assess architectural impact

After all agents complete, synthesize their findings into a final review recommendation.`;

    const response = await orchestrator.sendMessage(prompt);

    res.json({
      review: {
        repo,
        prNumber: pr,
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
    const repoErr = policy.validateRepo(repo);
    if (repoErr) {
      return res.status(400).json({ error: { message: repoErr, type: 'invalid_request' } });
    }
    if (branch !== undefined) {
      const branchErr = policy.validateBranch(branch);
      if (branchErr) {
        return res.status(400).json({ error: { message: branchErr, type: 'invalid_request' } });
      }
    }
    // description is free-text but is delivered as data, not a command. Cap its length.
    const desc =
      typeof description === 'string' ? description.slice(0, 4000) : undefined;

    const prompt = `Create a pull request for ${repo}${branch ? ` on branch "${branch}"` : ''}.
${desc ? `\nDescription: ${desc}` : ''}

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
    const repoErr = policy.validateRepo(repo);
    if (repoErr) {
      return res.status(400).json({ error: { message: repoErr, type: 'invalid_request' } });
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
 * Verify a GitHub webhook HMAC (X-Hub-Signature-256) against GITHUB_WEBHOOK_SECRET.
 * Returns true only on a constant-time match. Missing secret/signature/body → false.
 */
function verifyWebhookSignature(req: Request): boolean {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) return false;

  const signature = req.headers['x-hub-signature-256'];
  const rawBody: Buffer | undefined = (req as any).rawBody;
  if (typeof signature !== 'string' || !rawBody) return false;

  const expected = 'sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * POST /v1/pr/webhook
 * GitHub webhook endpoint for auto-review on PR open.
 *
 * Requires GITHUB_WEBHOOK_SECRET + a valid X-Hub-Signature-256. Disabled (401) otherwise.
 */
prRouter.post('/v1/pr/webhook', async (req: Request, res: Response) => {
  if (!process.env.GITHUB_WEBHOOK_SECRET) {
    return res.status(401).json({
      status: 'disabled',
      message: 'Webhook disabled: set GITHUB_WEBHOOK_SECRET to enable signature-verified delivery.',
    });
  }
  if (!verifyWebhookSignature(req)) {
    return res.status(401).json({ status: 'unauthorized', message: 'Invalid webhook signature' });
  }

  const event = req.headers['x-github-event'];
  const payload = req.body;

  if (event === 'pull_request' && payload.action === 'opened') {
    const repo = payload.repository?.full_name;
    const prNumber = payload.number;

    // Enforce the same repo allow-list the manual routes use.
    if (repo && validPrNumber(prNumber) !== null && policy.validateRepo(repo) === null) {
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
