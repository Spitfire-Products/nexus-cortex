/**
 * Git-backed HistoryStore — "your agent memory is a git repo you own."
 *
 * A published `HistoryStore` backend whose durable store is a git working
 * clone: sessions are canonical JSONL under `{repoDir}/{sessionsSubdir}`,
 * writes are committed (and optionally pushed), reads optionally pull first.
 * It DECORATES the existing Node session store (JSONLHistoryStore via
 * NodeHistoryStoreAdapter) — the canonical record format is reused verbatim,
 * never re-implemented; this class only adds the git state-machine layer
 * (push = append, pull = rehydrate).
 *
 * Dependency-free (Node built-ins only). git identity is passed per-commit
 * with `-c user.name/-c user.email` so global git config is never mutated.
 * All git invocations set GIT_TERMINAL_PROMPT=0 so a missing credential fails
 * fast instead of hanging on a prompt.
 *
 * Scope: the SESSION dimension (canonical Message records). The capability/
 * artifact dimension (skills/agents/mcp/plugins manifests) is a separate arc
 * (CANON_CROSS_HARNESS_PLAN.md §27p) and is intentionally not modeled here.
 *
 * @module adapters/node/GitHistoryStore
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import type { HistoryStore, SessionInfo } from '../../interfaces/HistoryStore.js';
import type { CanonicalMessage, SessionMetadata } from '@nexus-cortex/types';
import { JSONLHistoryStore } from '../../session/JSONLHistoryStore.js';
import { NodeHistoryStoreAdapter } from './NodeHistoryStoreAdapter.js';

const execFileAsync = promisify(execFile);

export interface GitHistoryStoreConfig {
  /** Local git working clone that holds the sessions. */
  repoDir: string;
  /**
   * Subdirectory within the repo where canonical session JSONL lives.
   * Default `.cortex/sessions` (the harness-native canon layout).
   */
  sessionsSubdir?: string;
  /**
   * Remote URL. If set and `repoDir` has no `.git`, it is cloned on first use;
   * otherwise a fresh repo is `git init`'d locally.
   */
  remote?: string;
  /** Branch to commit/push. Default `main`. */
  branch?: string;
  /** Pull before every read op. Default false (reads stay offline/fast). */
  autoPull?: boolean;
  /** Commit after every write op. Default true. */
  autoCommit?: boolean;
  /** Push after every committed write. Default false (opt-in network). */
  autoPush?: boolean;
  /** Commit-message prefix. Default `canon`. */
  commitPrefix?: string;
  /** git author identity for commits (never written to global config). */
  authorName?: string;
  authorEmail?: string;
}

type Required2<T> = { [K in keyof T]-?: T[K] };

/**
 * Git-backed session history store. Decorates JSONLHistoryStore with a git
 * state machine; implements the runtime-agnostic HistoryStore interface.
 */
export class GitHistoryStore implements HistoryStore {
  private readonly cfg: Required2<Omit<GitHistoryStoreConfig, 'remote'>> & { remote?: string };
  private readonly inner: NodeHistoryStoreAdapter;
  private readyPromise: Promise<void> | null = null;

  constructor(config: GitHistoryStoreConfig) {
    this.cfg = {
      repoDir: config.repoDir,
      sessionsSubdir: config.sessionsSubdir ?? '.cortex/sessions',
      branch: config.branch ?? 'main',
      autoPull: config.autoPull ?? false,
      autoCommit: config.autoCommit ?? true,
      autoPush: config.autoPush ?? false,
      commitPrefix: config.commitPrefix ?? 'canon',
      authorName: config.authorName ?? 'nexus-cortex canon',
      authorEmail: config.authorEmail ?? 'canon@nexus-cortex.local',
      remote: config.remote,
    };
    const baseDir = path.join(this.cfg.repoDir, this.cfg.sessionsSubdir);
    // git IS the history — no sidecar .backup files inside a versioned repo.
    this.inner = new NodeHistoryStoreAdapter(new JSONLHistoryStore({ baseDir, enableBackups: false }));
  }

  // ---- git plumbing (dependency-free) -------------------------------------

  private async git(args: string[], cwd = this.cfg.repoDir): Promise<string> {
    const { stdout } = await execFileAsync('git', args, {
      cwd,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
    return stdout;
  }

  /** Idempotent: clone/init the repo and ensure the sessions subdir exists. */
  private ensureRepo(): Promise<void> {
    if (!this.readyPromise) this.readyPromise = this.doEnsureRepo();
    return this.readyPromise;
  }

  private async doEnsureRepo(): Promise<void> {
    const hasGit = await this.pathExists(path.join(this.cfg.repoDir, '.git'));
    if (!hasGit) {
      if (this.cfg.remote) {
        await fs.mkdir(path.dirname(this.cfg.repoDir), { recursive: true });
        await execFileAsync('git', ['clone', '-q', '--branch', this.cfg.branch, this.cfg.remote, this.cfg.repoDir], {
          encoding: 'utf8',
          env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
        }).catch(async () => {
          // remote may not yet have the branch — clone default then checkout.
          await execFileAsync('git', ['clone', '-q', this.cfg.remote!, this.cfg.repoDir], {
            encoding: 'utf8',
            env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
          });
        });
      } else {
        await fs.mkdir(this.cfg.repoDir, { recursive: true });
        await this.git(['init', '-q', '-b', this.cfg.branch]);
      }
    }
    await fs.mkdir(path.join(this.cfg.repoDir, this.cfg.sessionsSubdir), { recursive: true });
  }

  private async pathExists(p: string): Promise<boolean> {
    try { await fs.access(p); return true; } catch { return false; }
  }

  private async pullIfEnabled(): Promise<void> {
    if (!this.cfg.autoPull || !this.cfg.remote) return;
    // Non-fatal: an offline pull must not break a local read.
    await this.git(['pull', '-q', '--ff-only', 'origin', this.cfg.branch]).catch(() => undefined);
  }

  /** Commit anything staged under the sessions subdir; push if configured. */
  private async commitAndPush(message: string): Promise<void> {
    if (!this.cfg.autoCommit) return;
    await this.git(['add', '--', this.cfg.sessionsSubdir]);
    const status = (await this.git(['status', '--porcelain', '--', this.cfg.sessionsSubdir])).trim();
    if (!status) return; // nothing changed — no empty commits
    await this.git([
      '-c', `user.name=${this.cfg.authorName}`,
      '-c', `user.email=${this.cfg.authorEmail}`,
      'commit', '-q', '-m', message,
    ]);
    if (this.cfg.autoPush && this.cfg.remote) {
      await this.git(['push', '-q', 'origin', this.cfg.branch]);
    }
  }

  // ---- HistoryStore: reads ------------------------------------------------

  async loadSession(sessionId: string): Promise<CanonicalMessage[]> {
    await this.ensureRepo();
    await this.pullIfEnabled();
    return this.inner.loadSession(sessionId);
  }

  async listSessions(): Promise<SessionInfo[]> {
    await this.ensureRepo();
    await this.pullIfEnabled();
    return this.inner.listSessions();
  }

  async sessionExists(sessionId: string): Promise<boolean> {
    await this.ensureRepo();
    return this.inner.sessionExists(sessionId);
  }

  async loadMetadata(sessionId: string): Promise<SessionMetadata | null> {
    await this.ensureRepo();
    await this.pullIfEnabled();
    return this.inner.loadMetadata(sessionId);
  }

  async getSessionInfo(sessionId: string): Promise<SessionInfo | null> {
    await this.ensureRepo();
    return this.inner.getSessionInfo(sessionId);
  }

  // ---- HistoryStore: writes (each = one git commit) -----------------------

  async appendMessage(sessionId: string, message: CanonicalMessage): Promise<void> {
    await this.ensureRepo();
    await this.inner.appendMessage(sessionId, message);
    await this.commitAndPush(`${this.cfg.commitPrefix}: append ${sessionId}`);
  }

  async appendMessages(sessionId: string, messages: CanonicalMessage[]): Promise<void> {
    await this.ensureRepo();
    await this.inner.appendMessages(sessionId, messages);
    await this.commitAndPush(`${this.cfg.commitPrefix}: append ${messages.length} → ${sessionId}`);
  }

  async saveSession(sessionId: string, messages: CanonicalMessage[]): Promise<void> {
    await this.ensureRepo();
    await this.inner.saveSession(sessionId, messages);
    await this.commitAndPush(`${this.cfg.commitPrefix}: save ${sessionId} (${messages.length} msgs)`);
  }

  async saveMetadata(sessionId: string, metadata: SessionMetadata): Promise<void> {
    await this.ensureRepo();
    await this.inner.saveMetadata(sessionId, metadata);
    await this.commitAndPush(`${this.cfg.commitPrefix}: metadata ${sessionId}`);
  }

  async deleteSession(sessionId: string): Promise<boolean> {
    await this.ensureRepo();
    const deleted = await this.inner.deleteSession(sessionId);
    if (deleted) await this.commitAndPush(`${this.cfg.commitPrefix}: delete ${sessionId}`);
    return deleted;
  }
}
