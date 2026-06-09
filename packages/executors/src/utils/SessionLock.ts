/**
 * SessionLock - Manage exclusive access to tmux sessions
 *
 * Prevents conflicts when multiple agents/users try to access
 * the same tmux session simultaneously.
 *
 * Features:
 * - File-based locking mechanism
 * - Automatic lock expiration (prevents deadlocks)
 * - Lock ownership tracking
 * - Shared vs exclusive locks
 */

import * as fs from 'fs';
import * as path from 'path';

export interface LockInfo {
  sessionId: string;
  owner: string;
  acquired: Date;
  expires: Date;
  type: 'exclusive' | 'shared';
}

export interface LockOptions {
  timeout?: number;      // Lock timeout in ms (default: 30000)
  retryInterval?: number; // Retry interval in ms (default: 100)
  maxRetries?: number;    // Max retry attempts (default: 50)
  type?: 'exclusive' | 'shared'; // Lock type (default: exclusive)
}

/**
 * SessionLock - Distributed locking for tmux sessions
 *
 * Uses file-based locks stored in .cortex/tmux-sessions/locks/
 * Handles lock acquisition, release, and automatic expiration.
 */
export class SessionLock {
  private lockDir: string;
  private defaultTimeout: number = 30000; // 30 seconds

  constructor(projectPath?: string) {
    const basePath = projectPath || process.cwd();
    this.lockDir = path.join(basePath, '.cortex', 'tmux-sessions', 'locks');
    this.ensureLockDir();
  }

  /**
   * Ensure lock directory exists
   */
  private ensureLockDir(): void {
    if (!fs.existsSync(this.lockDir)) {
      fs.mkdirSync(this.lockDir, { recursive: true });
    }
  }

  /**
   * Get lock file path for a session
   */
  private getLockPath(sessionId: string): string {
    return path.join(this.lockDir, `${sessionId}.lock`);
  }

  /**
   * Acquire lock on a session
   *
   * @param sessionId Session to lock
   * @param owner Identifier for lock owner (e.g., agent ID, user ID)
   * @param options Lock options
   * @returns true if lock acquired, false otherwise
   */
  public async acquireLock(
    sessionId: string,
    owner: string,
    options: LockOptions = {}
  ): Promise<boolean> {
    const timeout = options.timeout || this.defaultTimeout;
    const retryInterval = options.retryInterval || 100;
    const maxRetries = options.maxRetries || Math.floor(timeout / retryInterval);
    const lockType = options.type || 'exclusive';

    const lockPath = this.getLockPath(sessionId);
    const lockInfo: LockInfo = {
      sessionId,
      owner,
      acquired: new Date(),
      expires: new Date(Date.now() + timeout),
      type: lockType
    };

    for (let i = 0; i < maxRetries; i++) {
      try {
        // Check if lock exists
        if (fs.existsSync(lockPath)) {
          const existingLock = this.readLock(sessionId);

          if (existingLock) {
            // Check if lock has expired
            if (new Date() > existingLock.expires) {
              // Lock expired, remove it
              fs.unlinkSync(lockPath);
            } else if (existingLock.type === 'shared' && lockType === 'shared') {
              // Both are shared locks, allow access
              return true;
            } else {
              // Lock is still valid, wait and retry
              await new Promise(resolve => setTimeout(resolve, retryInterval));
              continue;
            }
          }
        }

        // Try to acquire lock (atomic write)
        fs.writeFileSync(lockPath, JSON.stringify(lockInfo, null, 2), { flag: 'wx' });
        return true;
      } catch (error: any) {
        if (error.code === 'EEXIST') {
          // File was created by another process, retry
          await new Promise(resolve => setTimeout(resolve, retryInterval));
          continue;
        }
        throw error;
      }
    }

    return false; // Failed to acquire lock
  }

  /**
   * Release lock on a session
   *
   * @param sessionId Session to unlock
   * @param owner Lock owner (must match to release)
   * @returns true if lock released, false if not owned by this owner
   */
  public async releaseLock(sessionId: string, owner: string): Promise<boolean> {
    const lockPath = this.getLockPath(sessionId);

    if (!fs.existsSync(lockPath)) {
      return true; // No lock exists
    }

    const lock = this.readLock(sessionId);
    if (!lock) {
      return true; // Invalid lock file
    }

    // Only owner can release the lock
    if (lock.owner !== owner) {
      return false;
    }

    try {
      fs.unlinkSync(lockPath);
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Check if session is locked
   *
   * @param sessionId Session to check
   * @returns Lock info if locked, null otherwise
   */
  public isLocked(sessionId: string): LockInfo | null {
    const lock = this.readLock(sessionId);

    if (!lock) {
      return null;
    }

    // Check if lock has expired
    if (new Date() > lock.expires) {
      // Clean up expired lock
      const lockPath = this.getLockPath(sessionId);
      try {
        fs.unlinkSync(lockPath);
      } catch {
        // Ignore cleanup errors
      }
      return null;
    }

    return lock;
  }

  /**
   * Read lock information from file
   */
  private readLock(sessionId: string): LockInfo | null {
    const lockPath = this.getLockPath(sessionId);

    if (!fs.existsSync(lockPath)) {
      return null;
    }

    try {
      const data = fs.readFileSync(lockPath, 'utf-8');
      const lock = JSON.parse(data);
      return {
        ...lock,
        acquired: new Date(lock.acquired),
        expires: new Date(lock.expires)
      };
    } catch {
      return null;
    }
  }

  /**
   * Extend lock expiration time
   *
   * @param sessionId Session to extend lock for
   * @param owner Lock owner (must match)
   * @param additionalTime Additional time in ms
   * @returns true if extended, false otherwise
   */
  public async extendLock(
    sessionId: string,
    owner: string,
    additionalTime: number = 30000
  ): Promise<boolean> {
    const lock = this.readLock(sessionId);

    if (!lock || lock.owner !== owner) {
      return false;
    }

    // Extend expiration
    lock.expires = new Date(lock.expires.getTime() + additionalTime);

    const lockPath = this.getLockPath(sessionId);
    try {
      fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Force release all locks (admin operation)
   * Use with caution!
   */
  public async forceReleaseAll(): Promise<number> {
    let released = 0;

    try {
      const files = fs.readdirSync(this.lockDir);

      for (const file of files) {
        if (file.endsWith('.lock')) {
          try {
            fs.unlinkSync(path.join(this.lockDir, file));
            released++;
          } catch {
            // Ignore errors
          }
        }
      }
    } catch {
      // Directory doesn't exist or not readable
    }

    return released;
  }

  /**
   * Clean up expired locks
   * Should be called periodically
   */
  public async cleanupExpiredLocks(): Promise<number> {
    let cleaned = 0;

    try {
      const files = fs.readdirSync(this.lockDir);

      for (const file of files) {
        if (file.endsWith('.lock')) {
          const sessionId = file.replace('.lock', '');
          const lock = this.readLock(sessionId);

          if (lock && new Date() > lock.expires) {
            try {
              fs.unlinkSync(path.join(this.lockDir, file));
              cleaned++;
            } catch {
              // Ignore errors
            }
          }
        }
      }
    } catch {
      // Directory doesn't exist or not readable
    }

    return cleaned;
  }

  /**
   * Get all active locks
   */
  public async getActiveLocks(): Promise<LockInfo[]> {
    const locks: LockInfo[] = [];

    try {
      const files = fs.readdirSync(this.lockDir);

      for (const file of files) {
        if (file.endsWith('.lock')) {
          const sessionId = file.replace('.lock', '');
          const lock = this.readLock(sessionId);

          if (lock && new Date() <= lock.expires) {
            locks.push(lock);
          }
        }
      }
    } catch {
      // Directory doesn't exist or not readable
    }

    return locks;
  }
}
