/**
 * Content-Addressable File Storage
 * Implements SHA-256 based checkpoint storage for Claude CLI
 * Based on research: 02-claude-cli-analysis/FILE_CHECKPOINT_SYSTEM.md
 */

import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Backup file info
 */
export interface BackupFile {
  backupFileName: string;  // {hash}@v{version}
  version: number;
  hash: string;            // First 16 chars of SHA-256
  fullPath: string;        // Absolute path to backup file
  timestamp: string;       // ISO 8601 timestamp
  size: number;            // File size in bytes
}

/**
 * Content-addressable storage manager
 * Uses SHA-256 hashing to deduplicate file content
 */
export class ContentAddressableStore {
  private baseDir: string;
  private sessionId: string;
  // R10 (Opus parallel-bench): initialize() ran fs.mkdir(recursive) on every
  // saveBackup. Memoize the promise so the syscall fires once per instance.
  private initPromise?: Promise<void>;

  constructor(baseDir: string, sessionId: string) {
    this.baseDir = baseDir;
    this.sessionId = sessionId;
  }

  /**
   * Get storage directory for current session
   * Pattern: {baseDir}/file-history/{sessionId}/
   */
  getStorageDir(): string {
    return path.join(this.baseDir, 'file-history', this.sessionId);
  }

  /**
   * Initialize storage directory
   * Creates directory if it doesn't exist
   */
  async initialize(): Promise<void> {
    if (!this.initPromise) {
      const storageDir = this.getStorageDir();
      this.initPromise = fs.mkdir(storageDir, { recursive: true }).then(() => undefined);
    }
    return this.initPromise;
  }

  /**
   * Calculate SHA-256 hash of content
   * Returns first 16 characters (matches Claude CLI behavior)
   */
  calculateHash(content: string): string {
    const hash = crypto.createHash('sha256');
    hash.update(content, 'utf8');
    return hash.digest('hex').substring(0, 16);
  }

  /**
   * Generate backup filename
   * Pattern: {hash}@v{version}
   */
  generateBackupFilename(hash: string, version: number): string {
    return `${hash}@v${version}`;
  }

  /**
   * Save file content to content-addressable storage
   * Returns backup file info
   */
  async saveBackup(content: string, version: number): Promise<BackupFile> {
    await this.initialize();

    const hash = this.calculateHash(content);
    const backupFileName = this.generateBackupFilename(hash, version);
    const fullPath = path.join(this.getStorageDir(), backupFileName);

    // Write backup file
    await fs.writeFile(fullPath, content, 'utf8');

    // R10: size from the in-memory content — no redundant fs.stat syscall.
    return {
      backupFileName,
      version,
      hash,
      fullPath,
      timestamp: new Date().toISOString(),
      size: Buffer.byteLength(content, 'utf8')
    };
  }

  /**
   * Load backup file content
   */
  async loadBackup(backupFileName: string): Promise<string> {
    const fullPath = path.join(this.getStorageDir(), backupFileName);
    return await fs.readFile(fullPath, 'utf8');
  }

  /**
   * Check if backup file exists
   */
  async backupExists(backupFileName: string): Promise<boolean> {
    const fullPath = path.join(this.getStorageDir(), backupFileName);
    try {
      await fs.access(fullPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * List all backup files for this session
   * Returns sorted by version number (newest first)
   */
  async listBackups(): Promise<BackupFile[]> {
    const storageDir = this.getStorageDir();

    try {
      const files = await fs.readdir(storageDir);
      const backups: BackupFile[] = [];

      for (const file of files) {
        const match = file.match(/^([a-f0-9]{16})@v(\d+)$/);
        if (match) {
          const [, hash, versionStr] = match;
          const version = parseInt(versionStr!, 10);
          const fullPath = path.join(storageDir, file);
          const stats = await fs.stat(fullPath);

          backups.push({
            backupFileName: file,
            version,
            hash: hash!,
            fullPath,
            timestamp: stats.mtime.toISOString(),
            size: stats.size
          });
        }
      }

      // Sort by version descending (newest first)
      backups.sort((a, b) => b.version - a.version);
      return backups;
    } catch (error) {
      // Directory doesn't exist yet
      return [];
    }
  }

  /**
   * Find backups for a specific file (by hash prefix)
   * Useful for finding all versions of same content
   */
  async findBackupsByHash(hashPrefix: string): Promise<BackupFile[]> {
    const allBackups = await this.listBackups();
    return allBackups.filter(b => b.hash.startsWith(hashPrefix));
  }

  /**
   * Delete old backups
   * Keeps only the N most recent versions
   */
  async pruneBackups(keepCount: number): Promise<number> {
    const backups = await this.listBackups();

    if (backups.length <= keepCount) {
      return 0;
    }

    const toDelete = backups.slice(keepCount);
    let deletedCount = 0;

    for (const backup of toDelete) {
      try {
        await fs.unlink(backup.fullPath);
        deletedCount++;
      } catch (error) {
        console.warn(`Failed to delete backup ${backup.backupFileName}:`, error);
      }
    }

    return deletedCount;
  }

  /**
   * Get storage statistics
   */
  async getStats(): Promise<{ totalFiles: number; totalSize: number }> {
    const backups = await this.listBackups();
    const totalSize = backups.reduce((sum, b) => sum + b.size, 0);

    return {
      totalFiles: backups.length,
      totalSize
    };
  }

  /**
   * Clean up session storage (delete all backups)
   */
  async cleanup(): Promise<void> {
    const storageDir = this.getStorageDir();
    try {
      await fs.rm(storageDir, { recursive: true, force: true });
    } catch (error) {
      console.warn(`Failed to cleanup storage directory ${storageDir}:`, error);
    }
  }
}
