/**
 * GitPolicy — access-control + injection-resistance unit tests.
 */
import { describe, it, expect } from 'vitest';
import { GitPolicy } from '../GitPolicy.js';

describe('GitPolicy', () => {
  describe('repo validation (always-on, blocks injection)', () => {
    const p = new GitPolicy({ allowedRepos: '*' });

    it('accepts well-formed owner/repo', () => {
      expect(p.validateRepo('octocat/hello-world')).toBeNull();
      expect(p.validateRepo('a.b_c/d.e-f')).toBeNull();
    });

    it('rejects shell-metacharacter payloads', () => {
      expect(p.validateRepo('a/b; rm -rf ~')).not.toBeNull();
      expect(p.validateRepo('a/b`whoami`')).not.toBeNull();
      expect(p.validateRepo('a/b$(curl evil)')).not.toBeNull();
      expect(p.validateRepo('a/b && echo hi')).not.toBeNull();
      expect(p.validateRepo('a b/c')).not.toBeNull(); // space
    });

    it('rejects argument-injection (leading dash) on either half', () => {
      expect(p.validateRepo('--upload-pack=x/y')).not.toBeNull();
      expect(p.validateRepo('owner/--foo')).not.toBeNull();
    });

    it('rejects missing slash / non-string / empty', () => {
      expect(p.validateRepo('justaname')).not.toBeNull();
      expect(p.validateRepo('')).not.toBeNull();
      expect(p.validateRepo(undefined)).not.toBeNull();
      expect(p.validateRepo(42 as any)).not.toBeNull();
    });
  });

  describe('repo allow-list', () => {
    it('exact match only when listed', () => {
      const p = new GitPolicy({ allowedRepos: 'me/app,me/lib' });
      expect(p.validateRepo('me/app')).toBeNull();
      expect(p.validateRepo('me/other')).not.toBeNull();
      expect(p.validateRepo('someoneelse/app')).not.toBeNull();
    });

    it('owner/* wildcard', () => {
      const p = new GitPolicy({ allowedRepos: 'me/*' });
      expect(p.validateRepo('me/anything')).toBeNull();
      expect(p.validateRepo('notme/anything')).not.toBeNull();
    });

    it('* allows all (still format-validated)', () => {
      const p = new GitPolicy({ allowedRepos: '*' });
      expect(p.validateRepo('any/repo')).toBeNull();
      expect(p.validateRepo('any/repo; ls')).not.toBeNull();
    });

    it('unset defaults to allow-all', () => {
      const p = new GitPolicy({});
      expect(p.validateRepo('any/repo')).toBeNull();
    });

    it('match is case-insensitive', () => {
      const p = new GitPolicy({ allowedRepos: 'Me/App' });
      expect(p.validateRepo('me/app')).toBeNull();
    });
  });

  describe('branch validation', () => {
    const p = new GitPolicy({ allowedRepos: '*' });
    it('accepts normal refs and undefined', () => {
      expect(p.validateBranch('feature/foo-bar')).toBeNull();
      expect(p.validateBranch(undefined)).toBeNull();
    });
    it('rejects injection / bad refs', () => {
      expect(p.validateBranch('a;rm -rf')).not.toBeNull();
      expect(p.validateBranch('-D')).not.toBeNull();
      expect(p.validateBranch('a..b')).not.toBeNull();
      expect(p.validateBranch('a b')).not.toBeNull();
    });
  });

  describe('prNumber validation', () => {
    const p = new GitPolicy({ allowedRepos: '*' });
    it('accepts positive ints and numeric strings', () => {
      expect(p.validatePrNumber(42)).toBeNull();
      expect(p.validatePrNumber('42')).toBeNull();
      expect(p.prNumber('42')).toBe(42);
    });
    it('rejects non-ints and injection strings', () => {
      expect(p.validatePrNumber('42; rm -rf')).not.toBeNull();
      expect(p.validatePrNumber(0)).not.toBeNull();
      expect(p.validatePrNumber(-1)).not.toBeNull();
      expect(p.validatePrNumber('abc')).not.toBeNull();
    });
  });

  describe('action gating', () => {
    it('all allowed when unset', () => {
      const p = new GitPolicy({});
      expect(p.assertAction('review')).toBeNull();
      expect(p.assertAction('cleanup')).toBeNull();
    });
    it('restricts to the configured set', () => {
      const p = new GitPolicy({ allowedActions: 'review,list' });
      expect(p.assertAction('review')).toBeNull();
      expect(p.assertAction('post-review')).not.toBeNull();
      expect(p.assertAction('clone')).not.toBeNull();
    });
  });

  describe('token handling — env only, never argv/URL', () => {
    it('injects token as GH_TOKEN/GITHUB_TOKEN in subprocess env', () => {
      const p = new GitPolicy({ token: 'ghp_secret', allowedRepos: '*' });
      const env = p.subprocessEnv({ PATH: '/usr/bin' });
      expect(env.GH_TOKEN).toBe('ghp_secret');
      expect(env.GITHUB_TOKEN).toBe('ghp_secret');
      expect(env.PATH).toBe('/usr/bin');
    });

    it('omits token keys when no token configured', () => {
      const p = new GitPolicy({ allowedRepos: '*' });
      const env = p.subprocessEnv({});
      expect(env.GH_TOKEN).toBeUndefined();
      expect(env.GITHUB_TOKEN).toBeUndefined();
    });

    it('never embeds the token in the clone URL', () => {
      const p = new GitPolicy({ token: 'ghp_secret', host: 'github.com' });
      const url = p.cloneUrl('me/app');
      expect(url).toBe('https://github.com/me/app.git');
      expect(url).not.toContain('ghp_secret');
    });

    it('host override flows to GH_HOST and clone URL', () => {
      const p = new GitPolicy({ host: 'ghe.corp.com' });
      expect(p.subprocessEnv({}).GH_HOST).toBe('ghe.corp.com');
      expect(p.cloneUrl('me/app')).toBe('https://ghe.corp.com/me/app.git');
    });
  });

  describe('fromEnv', () => {
    it('parses the env vars', () => {
      const p = GitPolicy.fromEnv({
        GIT_ALLOWED_REPOS: 'me/*',
        GIT_ALLOWED_ACTIONS: 'review',
        GIT_AUTH_TOKEN: 'tok',
        GIT_HOST: 'github.com',
      } as any);
      expect(p.validateRepo('me/x')).toBeNull();
      expect(p.validateRepo('you/x')).not.toBeNull();
      expect(p.assertAction('clone')).not.toBeNull();
      expect(p.token).toBe('tok');
    });
  });
});
