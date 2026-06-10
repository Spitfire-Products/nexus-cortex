/**
 * PRAgent Tool — Unit & Integration Tests
 *
 * Tests PR management operations: parameter validation, mode dispatch,
 * gh CLI dependency checking, and structured output format.
 * gh is invoked via execFile (no shell); the mock below drives execFile by argv array.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// A per-test handler that maps (cmd, args[]) → { stdout, stderr } or throws.
type GhHandler = (cmd: string, args: string[]) => { stdout: string; stderr?: string };
let ghHandler: GhHandler;

// Mock child_process.execFile so promisify(execFile) resolves to { stdout, stderr }.
vi.mock('child_process', () => {
  const execFile: any = (_cmd: string, _args: string[], _opts: any, cb?: any) => {
    const callback = typeof _opts === 'function' ? _opts : cb;
    try {
      const { stdout, stderr } = ghHandler(_cmd, _args);
      callback?.(null, stdout, stderr ?? '');
    } catch (e) {
      callback?.(e);
    }
  };
  // promisify uses this symbol → resolves with the { stdout, stderr } object.
  execFile[Symbol.for('nodejs.util.promisify.custom')] = (cmd: string, args: string[]) =>
    new Promise((resolve, reject) => {
      try {
        resolve(ghHandler(cmd, args));
      } catch (e) {
        reject(e);
      }
    });
  return { execFile, execSync: vi.fn() };
});

import { PRAgentToolExecutor } from '../../implementations/agent/PRAgentTool.js';

const ghAvailable: GhHandler = (_cmd, args) => {
  if (args[0] === '--version') return { stdout: 'gh version 2.44.0' };
  return { stdout: '' };
};

describe('PRAgentTool', () => {
  let tool: PRAgentToolExecutor;
  const signal = new AbortController().signal;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.GIT_ALLOWED_REPOS;
    delete process.env.GIT_ALLOWED_ACTIONS;
    tool = new PRAgentToolExecutor({ workingDirectory: '/tmp' });
    ghHandler = ghAvailable;
  });

  // ==============================
  // VALIDATION
  // ==============================

  describe('validateToolParams', () => {
    it('should accept valid review params', () => {
      expect(tool.validateToolParams({ repo: 'owner/repo', mode: 'review', prNumber: 42 })).toBeNull();
    });

    it('should accept valid list params', () => {
      expect(tool.validateToolParams({ repo: 'owner/repo', mode: 'list' })).toBeNull();
    });

    it('should accept valid create params', () => {
      expect(
        tool.validateToolParams({ repo: 'owner/repo', mode: 'create', branch: 'feat-x' }),
      ).toBeNull();
    });

    it('should accept valid post-review params', () => {
      expect(
        tool.validateToolParams({
          repo: 'owner/repo',
          mode: 'post-review',
          prNumber: 1,
          action: 'approve',
        }),
      ).toBeNull();
    });

    it('should reject missing repo', () => {
      expect(tool.validateToolParams({ repo: '', mode: 'list' } as any)).toContain('owner/repo');
    });

    it('should reject repo without slash', () => {
      expect(tool.validateToolParams({ repo: 'no-slash', mode: 'list' })).toContain('owner/repo');
    });

    it('should reject shell-injection in repo', () => {
      expect(tool.validateToolParams({ repo: 'a/b; rm -rf ~', mode: 'list' })).not.toBeNull();
    });

    it('should reject invalid mode', () => {
      expect(tool.validateToolParams({ repo: 'o/r', mode: 'invalid' as any })).toContain(
        'mode must be one of',
      );
    });

    it('should require prNumber for review mode', () => {
      expect(tool.validateToolParams({ repo: 'o/r', mode: 'review' })).toContain('positive integer');
    });

    it('should require prNumber for post-review mode', () => {
      expect(
        tool.validateToolParams({ repo: 'o/r', mode: 'post-review', action: 'approve' }),
      ).toContain('positive integer');
    });

    it('should require action for post-review mode', () => {
      expect(tool.validateToolParams({ repo: 'o/r', mode: 'post-review', prNumber: 1 })).toContain(
        'action is required',
      );
    });

    it('should require body for request-changes action', () => {
      expect(
        tool.validateToolParams({
          repo: 'o/r',
          mode: 'post-review',
          prNumber: 1,
          action: 'request-changes',
        }),
      ).toContain('body is required');
    });

    it('should reject an out-of-policy repo', () => {
      process.env.GIT_ALLOWED_REPOS = 'me/app';
      const restricted = new PRAgentToolExecutor({ workingDirectory: '/tmp' });
      expect(
        restricted.validateToolParams({ repo: 'someone/else', mode: 'list' }),
      ).toContain('allow-list');
    });

    it('should reject an out-of-policy action', () => {
      process.env.GIT_ALLOWED_ACTIONS = 'review';
      const restricted = new PRAgentToolExecutor({ workingDirectory: '/tmp' });
      expect(restricted.validateToolParams({ repo: 'o/r', mode: 'list' })).toContain(
        'GIT_ALLOWED_ACTIONS',
      );
    });
  });

  // ==============================
  // GH CLI CHECK
  // ==============================

  describe('gh CLI availability', () => {
    it('should return error when gh is not installed', async () => {
      ghHandler = (_cmd, args) => {
        if (args[0] === '--version') throw new Error('command not found');
        return { stdout: '' };
      };

      const result = await tool.execute({ repo: 'o/r', mode: 'list' }, signal);

      expect(result.success).toBe(false);
      expect(result.llmContent).toContain('GitHub CLI (gh) is not installed');
    });
  });

  // ==============================
  // CREATE MODE
  // ==============================

  describe('create mode', () => {
    it('should return structured context with branch', async () => {
      const result = await tool.execute(
        { repo: 'owner/repo', mode: 'create', branch: 'feat-new' },
        signal,
      );

      expect(result.success).toBe(true);
      const parsed = JSON.parse(result.llmContent as string);
      expect(parsed.mode).toBe('create');
      expect(parsed.repo).toBe('owner/repo');
      expect(parsed.branch).toBe('feat-new');
      expect(parsed.instructions).toContain('WorkspaceManager');
    });

    it('should handle create without branch', async () => {
      const result = await tool.execute({ repo: 'owner/repo', mode: 'create' }, signal);

      expect(result.success).toBe(true);
      const parsed = JSON.parse(result.llmContent as string);
      expect(parsed.branch).toBeNull();
    });
  });

  // ==============================
  // LIST MODE
  // ==============================

  describe('list mode', () => {
    it('should parse gh pr list JSON output', async () => {
      const mockPRs = [
        {
          number: 1,
          title: 'Fix auth bug',
          author: { login: 'dev1' },
          labels: [{ name: 'bugfix' }],
          reviewDecision: 'APPROVED',
          headRefName: 'fix-auth',
          createdAt: '2026-01-01T00:00:00Z',
          isDraft: false,
        },
        {
          number: 2,
          title: 'Add feature',
          author: { login: 'dev2' },
          labels: [],
          reviewDecision: '',
          headRefName: 'feat-new',
          createdAt: '2026-01-02T00:00:00Z',
          isDraft: true,
        },
      ];

      ghHandler = (_cmd, args) => {
        if (args[0] === '--version') return { stdout: 'gh version 2.44.0' };
        if (args[0] === 'pr' && args[1] === 'list') return { stdout: JSON.stringify(mockPRs) };
        return { stdout: '' };
      };

      const result = await tool.execute({ repo: 'owner/repo', mode: 'list' }, signal);

      expect(result.success).toBe(true);
      const parsed = JSON.parse(result.llmContent as string);
      expect(parsed.mode).toBe('list');
      expect(parsed.count).toBe(2);
      expect(parsed.pullRequests[0].number).toBe(1);
      expect(parsed.pullRequests[0].author).toBe('dev1');
      expect(parsed.pullRequests[0].labels).toEqual(['bugfix']);
      expect(parsed.pullRequests[1].isDraft).toBe(true);
    });

    it('should handle empty PR list', async () => {
      ghHandler = (_cmd, args) => {
        if (args[0] === '--version') return { stdout: 'gh version 2.44.0' };
        if (args[0] === 'pr' && args[1] === 'list') return { stdout: '[]' };
        return { stdout: '' };
      };

      const result = await tool.execute({ repo: 'owner/repo', mode: 'list' }, signal);

      expect(result.success).toBe(true);
      const parsed = JSON.parse(result.llmContent as string);
      expect(parsed.count).toBe(0);
      expect(parsed.pullRequests).toEqual([]);
    });
  });

  // ==============================
  // REVIEW MODE
  // ==============================

  describe('review mode', () => {
    const metadata = (over: Record<string, unknown> = {}) => ({
      number: 42,
      title: 'Big refactor',
      author: { login: 'contributor' },
      body: 'This PR refactors the auth system.',
      baseRefName: 'main',
      headRefName: 'refactor-auth',
      labels: [{ name: 'enhancement' }],
      reviewDecision: 'REVIEW_REQUIRED',
      additions: 150,
      deletions: 50,
      changedFiles: 8,
      commits: [{ oid: 'abc' }, { oid: 'def' }],
      files: [
        { path: 'src/auth.ts', additions: 100, deletions: 30 },
        { path: 'src/utils.ts', additions: 50, deletions: 20 },
      ],
      ...over,
    });

    const reviewHandler = (meta: object, diff: string): GhHandler => (_cmd, args) => {
      if (args[0] === '--version') return { stdout: 'gh version 2.44.0' };
      if (args[0] === 'pr' && args[1] === 'view') return { stdout: JSON.stringify(meta) };
      if (args[0] === 'pr' && args[1] === 'diff') return { stdout: diff };
      return { stdout: '' };
    };

    it('should parse PR metadata and diff', async () => {
      const mockDiff =
        'diff --git a/src/auth.ts b/src/auth.ts\n--- a/src/auth.ts\n+++ b/src/auth.ts\n@@ -1,3 +1,5 @@\n+import { hash } from "crypto";\n export function login() {}';
      ghHandler = reviewHandler(metadata(), mockDiff);

      const result = await tool.execute({ repo: 'owner/repo', mode: 'review', prNumber: 42 }, signal);

      expect(result.success).toBe(true);
      const parsed = JSON.parse(result.llmContent as string);
      expect(parsed.mode).toBe('review');
      expect(parsed.title).toBe('Big refactor');
      expect(parsed.author).toBe('contributor');
      expect(parsed.stats.additions).toBe(150);
      expect(parsed.stats.commits).toBe(2);
      expect(parsed.files).toHaveLength(2);
      expect(parsed.diff).toContain('import { hash }');
      expect(parsed.diffTruncated).toBe(false);
    });

    it('should truncate large diffs', async () => {
      const largeDiff = Array.from({ length: 6000 }, (_, i) => `+line ${i}`).join('\n');
      ghHandler = reviewHandler(
        metadata({ title: 'Large', commits: [], files: [], labels: [] }),
        largeDiff,
      );

      const result = await tool.execute({ repo: 'o/r', mode: 'review', prNumber: 1 }, signal);

      expect(result.success).toBe(true);
      const parsed = JSON.parse(result.llmContent as string);
      expect(parsed.diffTruncated).toBe(true);
      expect(parsed.diff).toContain('truncated');
    });

    it('should apply path filter to diff', async () => {
      const mockDiff = [
        'diff --git a/src/auth.ts b/src/auth.ts',
        '--- a/src/auth.ts',
        '+++ b/src/auth.ts',
        '+auth change',
        'diff --git a/src/utils.ts b/src/utils.ts',
        '--- a/src/utils.ts',
        '+++ b/src/utils.ts',
        '+utils change',
      ].join('\n');
      ghHandler = reviewHandler(metadata({ commits: [], files: [], labels: [] }), mockDiff);

      const result = await tool.execute(
        { repo: 'o/r', mode: 'review', prNumber: 1, diffOptions: { pathFilter: 'auth' } },
        signal,
      );

      expect(result.success).toBe(true);
      const parsed = JSON.parse(result.llmContent as string);
      expect(parsed.diff).toContain('auth change');
      expect(parsed.diff).not.toContain('utils change');
    });
  });

  // ==============================
  // POST-REVIEW MODE
  // ==============================

  describe('post-review mode', () => {
    it('should post approval review with --approve in argv', async () => {
      let sawApprove = false;
      ghHandler = (_cmd, args) => {
        if (args[0] === '--version') return { stdout: 'gh version 2.44.0' };
        if (args[0] === 'pr' && args[1] === 'review') {
          sawApprove = args.includes('--approve');
          return { stdout: '' };
        }
        return { stdout: '' };
      };

      const result = await tool.execute(
        { repo: 'owner/repo', mode: 'post-review', prNumber: 42, action: 'approve', body: 'LGTM' },
        signal,
      );

      expect(sawApprove).toBe(true);
      expect(result.success).toBe(true);
      const parsed = JSON.parse(result.llmContent as string);
      expect(parsed.mode).toBe('post-review');
      expect(parsed.posted).toBe(true);
      expect(parsed.action).toBe('approve');
    });

    it('should pass the body as a discrete --body argv element (no shell escaping)', async () => {
      let bodyArg: string | undefined;
      ghHandler = (_cmd, args) => {
        if (args[0] === '--version') return { stdout: 'gh version 2.44.0' };
        if (args[0] === 'pr' && args[1] === 'review') {
          const i = args.indexOf('--body');
          bodyArg = i >= 0 ? args[i + 1] : undefined;
          return { stdout: '' };
        }
        return { stdout: '' };
      };

      // A body with shell metacharacters must survive verbatim (no mangling, no execution).
      const tricky = 'Needs fixes; `id` $(whoami) "quotes"';
      const result = await tool.execute(
        { repo: 'o/r', mode: 'post-review', prNumber: 1, action: 'request-changes', body: tricky },
        signal,
      );

      expect(result.success).toBe(true);
      expect(bodyArg).toBe(tricky);
    });

    it('should surface stderr on a gh pr review failure', async () => {
      ghHandler = (_cmd, args) => {
        if (args[0] === '--version') return { stdout: 'gh version 2.44.0' };
        if (args[0] === 'pr' && args[1] === 'review') {
          const err: any = new Error('exit 1');
          err.stderr = 'HTTP 403: Not authorized (auth token expired)';
          throw err;
        }
        return { stdout: '' };
      };

      const result = await tool.execute(
        { repo: 'o/r', mode: 'post-review', prNumber: 1, action: 'approve' },
        signal,
      );

      expect(result.success).toBe(false);
      expect(result.llmContent).toContain('Failed to post review');
      expect(result.llmContent).toContain('Not authorized');
    });
  });

  // ==============================
  // ERROR HANDLING
  // ==============================

  describe('error handling', () => {
    it('should surface stderr on gh command failures', async () => {
      ghHandler = (_cmd, args) => {
        if (args[0] === '--version') return { stdout: 'gh version 2.44.0' };
        const err: any = new Error('exit 1');
        err.stderr = 'API rate limit exceeded';
        throw err;
      };

      const result = await tool.execute({ repo: 'o/r', mode: 'list' }, signal);

      expect(result.success).toBe(false);
      expect(result.llmContent).toContain('rate limit');
    });
  });
});
