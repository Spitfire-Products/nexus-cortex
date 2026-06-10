/**
 * WorkspaceManager Tool — Unit & Integration Tests
 *
 * Tests git worktree lifecycle: create, status, diff, cleanup.
 * Uses real git operations in a temp directory.
 * Clone mode is skipped (requires network access).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { WorkspaceManagerTool } from '../../implementations/execution/WorkspaceManagerTool.js';

describe('WorkspaceManagerTool', () => {
  let tool: WorkspaceManagerTool;
  let testRepoDir: string;
  let createdWorktrees: string[] = [];
  const signal = new AbortController().signal;

  beforeEach(() => {
    // Create a temp git repo for testing
    testRepoDir = join(tmpdir(), `ws-test-${Date.now()}`);
    mkdirSync(testRepoDir, { recursive: true });

    // Initialize git repo with initial commit
    execSync('git init', { cwd: testRepoDir, stdio: 'pipe' });
    execSync('git config user.email "test@test.com"', { cwd: testRepoDir, stdio: 'pipe' });
    execSync('git config user.name "Test"', { cwd: testRepoDir, stdio: 'pipe' });
    writeFileSync(join(testRepoDir, 'README.md'), '# Test Repo');
    execSync('git add .', { cwd: testRepoDir, stdio: 'pipe' });
    execSync('git commit -m "initial"', { cwd: testRepoDir, stdio: 'pipe' });
    // Create a main branch explicitly
    try {
      execSync('git branch -M main', { cwd: testRepoDir, stdio: 'pipe' });
    } catch {
      // Already on main
    }

    tool = new WorkspaceManagerTool({ workingDirectory: testRepoDir });
    createdWorktrees = [];
  });

  afterEach(() => {
    // Clean up worktrees
    for (const wt of createdWorktrees) {
      try {
        execSync(`git worktree remove "${wt}" --force`, { cwd: testRepoDir, stdio: 'pipe' });
      } catch {
        if (existsSync(wt)) rmSync(wt, { recursive: true, force: true });
      }
    }
    try {
      execSync('git worktree prune', { cwd: testRepoDir, stdio: 'pipe' });
    } catch { /* noop */ }

    // Clean up test repo
    if (existsSync(testRepoDir)) {
      rmSync(testRepoDir, { recursive: true, force: true });
    }
  });

  // ==============================
  // VALIDATION
  // ==============================

  describe('validateToolParams', () => {
    it('should accept valid create mode', () => {
      expect(tool.validateToolParams({ mode: 'create' })).toBeNull();
    });

    it('should accept valid status mode', () => {
      expect(tool.validateToolParams({ mode: 'status' })).toBeNull();
    });

    it('should reject invalid mode', () => {
      expect(tool.validateToolParams({ mode: 'invalid' as any })).toContain('mode must be one of');
    });

    it('should require repo for clone mode', () => {
      expect(tool.validateToolParams({ mode: 'clone' })).toContain('repo is required');
    });

    it('should require worktreePath for diff mode', () => {
      expect(tool.validateToolParams({ mode: 'diff' })).toContain('worktreePath is required');
    });

    it('should require worktreePath for cleanup mode', () => {
      expect(tool.validateToolParams({ mode: 'cleanup' })).toContain('worktreePath is required');
    });

    it('should accept clone with repo', () => {
      expect(tool.validateToolParams({ mode: 'clone', repo: 'owner/repo' })).toBeNull();
    });

    it('should accept diff with worktreePath', () => {
      expect(tool.validateToolParams({ mode: 'diff', worktreePath: '/tmp/wt' })).toBeNull();
    });
  });

  // ==============================
  // STATUS MODE
  // ==============================

  describe('status mode', () => {
    it('should list worktrees for a git repo', async () => {
      const result = await tool.execute({ mode: 'status' }, signal);

      expect(result.success).toBe(true);
      const parsed = JSON.parse(result.llmContent as string);
      expect(parsed.mode).toBe('status');
      expect(parsed.worktreeCount).toBeGreaterThanOrEqual(1);
      expect(parsed.worktrees).toBeInstanceOf(Array);
      // Should at least have the main worktree
      expect(parsed.worktrees[0].path).toBe(testRepoDir);
    });
  });

  // ==============================
  // CREATE MODE
  // ==============================

  describe('create mode', () => {
    it('should create a worktree with new branch', async () => {
      const result = await tool.execute({
        mode: 'create',
        repo: testRepoDir,
        branch: `test-branch-${Date.now()}`,
      }, signal);

      expect(result.success).toBe(true);
      const parsed = JSON.parse(result.llmContent as string);
      expect(parsed.mode).toBe('create');
      expect(parsed.worktreePath).toMatch(/^\/tmp\/workspace-/);
      expect(parsed.branch).toContain('test-branch');
      expect(existsSync(parsed.worktreePath)).toBe(true);

      createdWorktrees.push(parsed.worktreePath);
    });

    it('should auto-generate branch name when not specified', async () => {
      const result = await tool.execute({
        mode: 'create',
        repo: testRepoDir,
      }, signal);

      expect(result.success).toBe(true);
      const parsed = JSON.parse(result.llmContent as string);
      expect(parsed.branch).toMatch(/^workspace-/);
      expect(existsSync(parsed.worktreePath)).toBe(true);

      createdWorktrees.push(parsed.worktreePath);
    });

    it('should return error for non-git directory', async () => {
      const nonGitDir = join(tmpdir(), `not-git-${Date.now()}`);
      mkdirSync(nonGitDir, { recursive: true });

      const nonGitTool = new WorkspaceManagerTool({ workingDirectory: nonGitDir });
      const result = await nonGitTool.execute({
        mode: 'create',
        repo: nonGitDir,
      }, signal);

      expect(result.success).toBe(false);
      expect(result.llmContent).toContain('Not a git repository');

      rmSync(nonGitDir, { recursive: true, force: true });
    });
  });

  // ==============================
  // DIFF MODE
  // ==============================

  describe('diff mode', () => {
    it('should show diff between worktree and base branch', async () => {
      // Create a worktree first
      const createResult = await tool.execute({
        mode: 'create',
        repo: testRepoDir,
        branch: `diff-test-${Date.now()}`,
      }, signal);
      const { worktreePath } = JSON.parse(createResult.llmContent as string);
      createdWorktrees.push(worktreePath);

      // Make a change in the worktree
      writeFileSync(join(worktreePath, 'new-file.txt'), 'test content');
      execSync('git add .', { cwd: worktreePath, stdio: 'pipe' });
      execSync('git commit -m "add file"', { cwd: worktreePath, stdio: 'pipe' });

      // Get diff
      const diffResult = await tool.execute({
        mode: 'diff',
        worktreePath,
        baseBranch: 'main',
      }, signal);

      expect(diffResult.success).toBe(true);
      const parsed = JSON.parse(diffResult.llmContent as string);
      expect(parsed.mode).toBe('diff');
      expect(parsed.fileCount).toBeGreaterThanOrEqual(1);
      expect(parsed.diff).toContain('new-file.txt');
    });

    it('should return error for non-existent worktree path', async () => {
      const result = await tool.execute({
        mode: 'diff',
        worktreePath: '/tmp/nonexistent-worktree-abc123',
        baseBranch: 'main',
      }, signal);

      expect(result.success).toBe(false);
      expect(result.llmContent).toContain('does not exist');
    });

    it('should respect maxDiffLines truncation', async () => {
      const createResult = await tool.execute({
        mode: 'create',
        repo: testRepoDir,
        branch: `truncate-test-${Date.now()}`,
      }, signal);
      const { worktreePath } = JSON.parse(createResult.llmContent as string);
      createdWorktrees.push(worktreePath);

      // Create a large file
      const largeContent = Array.from({ length: 200 }, (_, i) => `line ${i}`).join('\n');
      writeFileSync(join(worktreePath, 'large.txt'), largeContent);
      execSync('git add . && git commit -m "large file"', { cwd: worktreePath, stdio: 'pipe' });

      const diffResult = await tool.execute({
        mode: 'diff',
        worktreePath,
        baseBranch: 'main',
        maxDiffLines: 10,
      }, signal);

      expect(diffResult.success).toBe(true);
      const parsed = JSON.parse(diffResult.llmContent as string);
      expect(parsed.truncated).toBe(true);
      expect(parsed.diff).toContain('truncated');
    });
  });

  // ==============================
  // CLEANUP MODE
  // ==============================

  describe('cleanup mode', () => {
    it('should remove a worktree and prune', async () => {
      // Create first
      const createResult = await tool.execute({
        mode: 'create',
        repo: testRepoDir,
        branch: `cleanup-test-${Date.now()}`,
      }, signal);
      const { worktreePath } = JSON.parse(createResult.llmContent as string);
      expect(existsSync(worktreePath)).toBe(true);

      // Cleanup
      const cleanupResult = await tool.execute({
        mode: 'cleanup',
        worktreePath,
      }, signal);

      expect(cleanupResult.success).toBe(true);
      const parsed = JSON.parse(cleanupResult.llmContent as string);
      expect(parsed.mode).toBe('cleanup');
      // `removed` is now the list of paths actually removed.
      expect(Array.isArray(parsed.removed)).toBe(true);
      expect(parsed.removed).toContain(worktreePath);
      expect(existsSync(worktreePath)).toBe(false);
      // Don't add to createdWorktrees since it's already cleaned up
    });

    it('should delete the branch it created so refs do not accumulate', async () => {
      const branch = `cleanup-branch-${Date.now()}`;
      const createResult = await tool.execute({
        mode: 'create',
        repo: testRepoDir,
        branch,
      }, signal);
      const { worktreePath } = JSON.parse(createResult.llmContent as string);

      // Branch exists after create
      const before = execSync('git branch --list ' + branch, { cwd: testRepoDir, encoding: 'utf-8' });
      expect(before.trim()).not.toBe('');

      const cleanupResult = await tool.execute({ mode: 'cleanup', worktreePath }, signal);
      const parsed = JSON.parse(cleanupResult.llmContent as string);
      expect(parsed.branch).toBe(branch);

      // Branch is gone after cleanup
      const after = execSync('git branch --list ' + branch, { cwd: testRepoDir, encoding: 'utf-8' });
      expect(after.trim()).toBe('');
    });

    it('should also remove the clone directory when provided (no orphan)', async () => {
      // Simulate a clone-mode result: a separate clone dir plus a worktree under it.
      const cloneDir = join(tmpdir(), `ws-clone-${Date.now()}`);
      mkdirSync(cloneDir, { recursive: true });
      execSync('git init', { cwd: cloneDir, stdio: 'pipe' });
      execSync('git config user.email "t@t.com"', { cwd: cloneDir, stdio: 'pipe' });
      execSync('git config user.name "T"', { cwd: cloneDir, stdio: 'pipe' });
      writeFileSync(join(cloneDir, 'f.txt'), 'x');
      execSync('git add . && git commit -m init', { cwd: cloneDir, stdio: 'pipe' });
      execSync('git branch -M main', { cwd: cloneDir, stdio: 'pipe' });

      const branch = `wt-${Date.now()}`;
      const worktreePath = join(tmpdir(), `ws-wt-${Date.now()}`);
      execSync(`git worktree add "${worktreePath}" -b "${branch}" main`, { cwd: cloneDir, stdio: 'pipe' });
      expect(existsSync(cloneDir)).toBe(true);
      expect(existsSync(worktreePath)).toBe(true);

      const result = await tool.execute({ mode: 'cleanup', worktreePath, cloneDir }, signal);
      const parsed = JSON.parse(result.llmContent as string);

      expect(result.success).toBe(true);
      expect(parsed.cloneDirRemoved).toBe(true);
      expect(parsed.removed).toContain(cloneDir);
      expect(existsSync(worktreePath)).toBe(false);
      expect(existsSync(cloneDir)).toBe(false);
    });

    it('should reject an out-of-policy action', async () => {
      const prev = process.env.GIT_ALLOWED_ACTIONS;
      process.env.GIT_ALLOWED_ACTIONS = 'status'; // cleanup not allowed
      try {
        const restricted = new WorkspaceManagerTool({ workingDirectory: testRepoDir });
        const err = restricted.validateToolParams({ mode: 'cleanup', worktreePath: '/tmp/x' } as any);
        expect(err).toContain('not in the GIT_ALLOWED_ACTIONS');
      } finally {
        if (prev === undefined) delete process.env.GIT_ALLOWED_ACTIONS;
        else process.env.GIT_ALLOWED_ACTIONS = prev;
      }
    });

    it('should handle cleanup of already-removed worktree gracefully', async () => {
      const result = await tool.execute({
        mode: 'cleanup',
        worktreePath: '/tmp/nonexistent-worktree-xyz',
      }, signal);

      // Should succeed (cleanup is idempotent)
      expect(result.success).toBe(true);
    });
  });

  // ==============================
  // FULL LIFECYCLE
  // ==============================

  describe('full lifecycle', () => {
    it('should create → status → diff → cleanup successfully', async () => {
      // 1. Create
      const createResult = await tool.execute({
        mode: 'create',
        repo: testRepoDir,
        branch: `lifecycle-${Date.now()}`,
      }, signal);
      expect(createResult.success).toBe(true);
      const { worktreePath } = JSON.parse(createResult.llmContent as string);

      // 2. Status — should show 2 worktrees
      const statusResult = await tool.execute({ mode: 'status' }, signal);
      expect(statusResult.success).toBe(true);
      const statusParsed = JSON.parse(statusResult.llmContent as string);
      expect(statusParsed.worktreeCount).toBe(2);

      // 3. Make change and diff
      writeFileSync(join(worktreePath, 'lifecycle.txt'), 'lifecycle test');
      execSync('git add . && git commit -m "lifecycle"', { cwd: worktreePath, stdio: 'pipe' });

      const diffResult = await tool.execute({
        mode: 'diff',
        worktreePath,
        baseBranch: 'main',
      }, signal);
      expect(diffResult.success).toBe(true);
      const diffParsed = JSON.parse(diffResult.llmContent as string);
      expect(diffParsed.fileCount).toBeGreaterThanOrEqual(1);

      // 4. Cleanup
      const cleanupResult = await tool.execute({
        mode: 'cleanup',
        worktreePath,
      }, signal);
      expect(cleanupResult.success).toBe(true);

      // 5. Status — should be back to 1
      const finalStatus = await tool.execute({ mode: 'status' }, signal);
      const finalParsed = JSON.parse(finalStatus.llmContent as string);
      expect(finalParsed.worktreeCount).toBe(1);
    });
  });
});
