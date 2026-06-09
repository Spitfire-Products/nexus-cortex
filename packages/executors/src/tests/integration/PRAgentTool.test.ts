/**
 * PRAgent Tool — Unit & Integration Tests
 *
 * Tests PR management operations: parameter validation, mode dispatch,
 * gh CLI dependency checking, and structured output format.
 * Most tests mock execSync since gh CLI requires GitHub auth.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PRAgentToolExecutor } from '../../implementations/agent/PRAgentTool.js';

// Mock child_process to avoid requiring gh CLI
vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

import { execSync } from 'child_process';
const mockExecSync = vi.mocked(execSync);

describe('PRAgentTool', () => {
  let tool: PRAgentToolExecutor;
  const signal = new AbortController().signal;

  beforeEach(() => {
    vi.clearAllMocks();
    tool = new PRAgentToolExecutor({ workingDirectory: '/tmp' });
    // Default: gh is available
    mockExecSync.mockImplementation((cmd: any) => {
      if (typeof cmd === 'string' && cmd === 'gh --version') return Buffer.from('gh version 2.44.0');
      return Buffer.from('');
    });
  });

  // ==============================
  // VALIDATION
  // ==============================

  describe('validateToolParams', () => {
    it('should accept valid review params', () => {
      expect(
        tool.validateToolParams({ repo: 'owner/repo', mode: 'review', prNumber: 42 }),
      ).toBeNull();
    });

    it('should accept valid list params', () => {
      expect(
        tool.validateToolParams({ repo: 'owner/repo', mode: 'list' }),
      ).toBeNull();
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
      expect(
        tool.validateToolParams({ repo: '', mode: 'list' } as any),
      ).toContain('repo must be in "owner/repo" format');
    });

    it('should reject repo without slash', () => {
      expect(
        tool.validateToolParams({ repo: 'no-slash', mode: 'list' }),
      ).toContain('repo must be in "owner/repo" format');
    });

    it('should reject invalid mode', () => {
      expect(
        tool.validateToolParams({ repo: 'o/r', mode: 'invalid' as any }),
      ).toContain('mode must be one of');
    });

    it('should require prNumber for review mode', () => {
      expect(
        tool.validateToolParams({ repo: 'o/r', mode: 'review' }),
      ).toContain('prNumber is required');
    });

    it('should require prNumber for post-review mode', () => {
      expect(
        tool.validateToolParams({ repo: 'o/r', mode: 'post-review', action: 'approve' }),
      ).toContain('prNumber and action are required');
    });

    it('should require action for post-review mode', () => {
      expect(
        tool.validateToolParams({ repo: 'o/r', mode: 'post-review', prNumber: 1 }),
      ).toContain('prNumber and action are required');
    });
  });

  // ==============================
  // GH CLI CHECK
  // ==============================

  describe('gh CLI availability', () => {
    it('should return error when gh is not installed', async () => {
      mockExecSync.mockImplementation((cmd: any) => {
        if (typeof cmd === 'string' && cmd === 'gh --version') throw new Error('command not found');
        return Buffer.from('');
      });

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
      const result = await tool.execute(
        { repo: 'owner/repo', mode: 'create' },
        signal,
      );

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

      mockExecSync.mockImplementation((cmd: any, opts: any) => {
        const cmdStr = typeof cmd === 'string' ? cmd : '';
        const asString = opts?.encoding === 'utf-8';
        if (cmdStr === 'gh --version') return Buffer.from('gh version 2.44.0');
        if (cmdStr.includes('gh pr list')) return asString ? JSON.stringify(mockPRs) : Buffer.from(JSON.stringify(mockPRs));
        return asString ? '' : Buffer.from('');
      });

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
      mockExecSync.mockImplementation((cmd: any, opts: any) => {
        const cmdStr = typeof cmd === 'string' ? cmd : '';
        const asString = opts?.encoding === 'utf-8';
        if (cmdStr === 'gh --version') return Buffer.from('gh version 2.44.0');
        if (cmdStr.includes('gh pr list')) return asString ? '[]' : Buffer.from('[]');
        return asString ? '' : Buffer.from('');
      });

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
    it('should parse PR metadata and diff', async () => {
      const mockMetadata = {
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
      };

      const mockDiff =
        'diff --git a/src/auth.ts b/src/auth.ts\n--- a/src/auth.ts\n+++ b/src/auth.ts\n@@ -1,3 +1,5 @@\n+import { hash } from "crypto";\n export function login() {}';

      mockExecSync.mockImplementation((cmd: any, opts: any) => {
        const cmdStr = typeof cmd === 'string' ? cmd : '';
        // Return string when encoding specified (matches real execSync behavior)
        const asString = opts?.encoding === 'utf-8';
        if (cmdStr === 'gh --version') return Buffer.from('gh version 2.44.0');
        if (cmdStr.includes('gh pr view')) return asString ? JSON.stringify(mockMetadata) : Buffer.from(JSON.stringify(mockMetadata));
        if (cmdStr.includes('gh pr diff')) return asString ? mockDiff : Buffer.from(mockDiff);
        return asString ? '' : Buffer.from('');
      });

      const result = await tool.execute(
        { repo: 'owner/repo', mode: 'review', prNumber: 42 },
        signal,
      );

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
      const mockMetadata = {
        number: 1,
        title: 'Large',
        author: { login: 'dev' },
        body: '',
        baseRefName: 'main',
        headRefName: 'big',
        labels: [],
        reviewDecision: '',
        additions: 10000,
        deletions: 0,
        changedFiles: 1,
        commits: [],
        files: [],
      };

      // Create a diff with 6000 lines
      const largeDiff = Array.from({ length: 6000 }, (_, i) => `+line ${i}`).join('\n');

      mockExecSync.mockImplementation((cmd: any, opts: any) => {
        const cmdStr = typeof cmd === 'string' ? cmd : '';
        const asString = opts?.encoding === 'utf-8';
        if (cmdStr === 'gh --version') return Buffer.from('gh version 2.44.0');
        if (cmdStr.includes('gh pr view')) return asString ? JSON.stringify(mockMetadata) : Buffer.from(JSON.stringify(mockMetadata));
        if (cmdStr.includes('gh pr diff')) return asString ? largeDiff : Buffer.from(largeDiff);
        return asString ? '' : Buffer.from('');
      });

      const result = await tool.execute(
        { repo: 'o/r', mode: 'review', prNumber: 1 },
        signal,
      );

      expect(result.success).toBe(true);
      const parsed = JSON.parse(result.llmContent as string);
      expect(parsed.diffTruncated).toBe(true);
      expect(parsed.diff).toContain('truncated');
    });

    it('should apply path filter to diff', async () => {
      const mockMetadata = {
        number: 1,
        title: 'Multi-file',
        author: { login: 'dev' },
        body: '',
        baseRefName: 'main',
        headRefName: 'multi',
        labels: [],
        reviewDecision: '',
        additions: 10,
        deletions: 0,
        changedFiles: 2,
        commits: [],
        files: [],
      };

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

      mockExecSync.mockImplementation((cmd: any, opts: any) => {
        const cmdStr = typeof cmd === 'string' ? cmd : '';
        const asString = opts?.encoding === 'utf-8';
        if (cmdStr === 'gh --version') return Buffer.from('gh version 2.44.0');
        if (cmdStr.includes('gh pr view')) return asString ? JSON.stringify(mockMetadata) : Buffer.from(JSON.stringify(mockMetadata));
        if (cmdStr.includes('gh pr diff')) return asString ? mockDiff : Buffer.from(mockDiff);
        return asString ? '' : Buffer.from('');
      });

      const result = await tool.execute(
        {
          repo: 'o/r',
          mode: 'review',
          prNumber: 1,
          diffOptions: { pathFilter: 'auth' },
        },
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
    it('should post approval review', async () => {
      mockExecSync.mockImplementation((cmd: any) => {
        const cmdStr = typeof cmd === 'string' ? cmd : '';
        if (cmdStr === 'gh --version') return Buffer.from('gh version 2.44.0');
        if (cmdStr.includes('gh pr review')) {
          expect(cmdStr).toContain('--approve');
          return Buffer.from('');
        }
        return Buffer.from('');
      });

      const result = await tool.execute(
        {
          repo: 'owner/repo',
          mode: 'post-review',
          prNumber: 42,
          action: 'approve',
          body: 'LGTM',
        },
        signal,
      );

      expect(result.success).toBe(true);
      const parsed = JSON.parse(result.llmContent as string);
      expect(parsed.mode).toBe('post-review');
      expect(parsed.posted).toBe(true);
      expect(parsed.action).toBe('approve');
    });

    it('should post request-changes review', async () => {
      mockExecSync.mockImplementation((cmd: any) => {
        const cmdStr = typeof cmd === 'string' ? cmd : '';
        if (cmdStr === 'gh --version') return Buffer.from('gh version 2.44.0');
        if (cmdStr.includes('gh pr review')) {
          expect(cmdStr).toContain('--request-changes');
          return Buffer.from('');
        }
        return Buffer.from('');
      });

      const result = await tool.execute(
        {
          repo: 'o/r',
          mode: 'post-review',
          prNumber: 1,
          action: 'request-changes',
          body: 'Needs fixes',
        },
        signal,
      );

      expect(result.success).toBe(true);
      const parsed = JSON.parse(result.llmContent as string);
      expect(parsed.action).toBe('request-changes');
    });

    it('should handle gh pr review failure', async () => {
      mockExecSync.mockImplementation((cmd: any) => {
        const cmdStr = typeof cmd === 'string' ? cmd : '';
        if (cmdStr === 'gh --version') return Buffer.from('gh version 2.44.0');
        if (cmdStr.includes('gh pr review')) throw new Error('Not authorized');
        return Buffer.from('');
      });

      const result = await tool.execute(
        {
          repo: 'o/r',
          mode: 'post-review',
          prNumber: 1,
          action: 'approve',
        },
        signal,
      );

      expect(result.success).toBe(false);
      expect(result.llmContent).toContain('Failed to post review');
    });
  });

  // ==============================
  // ERROR HANDLING
  // ==============================

  describe('error handling', () => {
    it('should catch and return gh command failures', async () => {
      mockExecSync.mockImplementation((cmd: any) => {
        const cmdStr = typeof cmd === 'string' ? cmd : '';
        if (cmdStr === 'gh --version') return Buffer.from('gh version 2.44.0');
        throw new Error('API rate limited');
      });

      const result = await tool.execute({ repo: 'o/r', mode: 'list' }, signal);

      expect(result.success).toBe(false);
      expect(result.llmContent).toContain('PRAgent error');
    });
  });
});
