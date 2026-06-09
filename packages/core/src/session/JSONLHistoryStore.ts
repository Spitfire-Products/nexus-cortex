/**
 * JSONL History Store
 * Implements Claude CLI's one-message-per-line storage format
 *
 * Based on: .claude/claude_research_analysis/02-claude-cli-analysis/CLAUDE_CODE_CLI_ARCHITECTURE.md
 * Format: JSONL (JSON Lines) - one complete message object per line
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { Message, SessionMetadata } from './MessageTypes.js';

export interface JSONLHistoryStoreConfig {
  /**
   * Base directory for session storage
   * Default: .cortex/sessions/
   */
  baseDir: string;

  /**
   * Enable automatic backups on save
   * Default: true
   */
  enableBackups?: boolean;

  /**
   * Maximum number of backup files to keep
   * Default: 5
   */
  maxBackups?: number;
}

export interface SessionInfo {
  /**
   * Session UUID
   */
  sessionId: string;

  /**
   * Path to the JSONL file
   */
  filePath: string;

  /**
   * Session metadata
   */
  metadata: SessionMetadata;

  /**
   * Total messages in session
   */
  messageCount: number;

  /**
   * File size in bytes
   */
  fileSize: number;

  /**
   * Last modified timestamp
   */
  lastModified: Date;
}

/**
 * JSONL History Store
 *
 * Manages session storage using JSONL format (one message per line)
 * - Append-only writes for performance
 * - Each line is a complete JSON message object
 * - Session files named: {sessionUuid}.jsonl
 * - Stored in: {baseDir}/{normalized-workspace-path}/{sessionUuid}.jsonl
 */
export class JSONLHistoryStore {
  private config: Required<JSONLHistoryStoreConfig>;
  // R3 (parallel-bench): every appendMessage made a redundant
  // fs.mkdir(recursive) syscall — once-per-session-dir is enough. Memo
  // keyed by directory. R6 (self-audit): if the dir is externally deleted
  // the memo would skip mkdir and the next append ENOENTs — evict + recover.
  private ensuredDirs: Set<string> = new Set();

  constructor(config: JSONLHistoryStoreConfig) {
    this.config = {
      baseDir: config.baseDir,
      enableBackups: config.enableBackups ?? true,
      maxBackups: config.maxBackups ?? 5
    };
  }

  /**
   * Get the file path for a session
   */
  getSessionPath(sessionId: string, workspacePath?: string): string {
    if (workspacePath) {
      // Normalize workspace path: /foo/bar -> -foo-bar
      const normalized = workspacePath.replace(/\//g, '-');
      return path.join(this.config.baseDir, normalized, `${sessionId}.jsonl`);
    }

    return path.join(this.config.baseDir, `${sessionId}.jsonl`);
  }

  /**
   * Check if a session exists
   */
  async sessionExists(sessionId: string, workspacePath?: string): Promise<boolean> {
    const filePath = this.getSessionPath(sessionId, workspacePath);
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Load all messages from a session
   *
   * Reads the JSONL file line by line and parses each message
   */
  async loadSession(sessionId: string, workspacePath?: string): Promise<Message[]> {
    const filePath = this.getSessionPath(sessionId, workspacePath);

    try {
      const content = await fs.readFile(filePath, 'utf-8');

      // Split by newlines and parse each line
      const lines = content.split('\n').filter(line => line.trim());
      const messages: Message[] = [];

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line) continue; // Handle noUncheckedIndexedAccess

        try {
          const message = JSON.parse(line) as Message;
          messages.push(message);
        } catch (error) {
          console.warn(`Failed to parse message at line ${i + 1}: ${error}`);
          // Continue parsing other lines
        }
      }

      return messages;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        // Session file doesn't exist yet
        return [];
      }
      throw error;
    }
  }

  /**
   * Save entire session history
   *
   * Writes all messages to JSONL file (one per line)
   * Creates backup of existing file if enabled
   */
  async saveSession(
    sessionId: string,
    messages: Message[],
    workspacePath?: string
  ): Promise<void> {
    const filePath = this.getSessionPath(sessionId, workspacePath);

    // Ensure directory exists
    await fs.mkdir(path.dirname(filePath), { recursive: true });

    // Create backup of existing file
    if (this.config.enableBackups) {
      await this.createBackup(filePath);
    }

    // Write messages as JSONL (one JSON object per line)
    const jsonlContent = messages
      .map(msg => JSON.stringify(msg))
      .join('\n');

    // Add trailing newline
    await fs.writeFile(filePath, jsonlContent + '\n', 'utf-8');
  }

  /**
   * Append a single message to the session
   *
   * This is the primary write operation - append-only for performance
   * Does NOT read the entire file, just appends one line
   */
  async appendMessage(
    sessionId: string,
    message: Message,
    workspacePath?: string
  ): Promise<void> {
    const filePath = this.getSessionPath(sessionId, workspacePath);

    // Append as single line with newline
    const jsonLine = JSON.stringify(message) + '\n';
    await this.writeWithRecovery(filePath, jsonLine);
  }

  /**
   * mkdir memo: skip the syscall when the directory was already ensured
   * this process. Crash safety unaffected — this only gates mkdir, never
   * the appendFile write.
   */
  private async ensureDir(dir: string): Promise<void> {
    if (this.ensuredDirs.has(dir)) return;
    await fs.mkdir(dir, { recursive: true });
    this.ensuredDirs.add(dir);
  }

  /**
   * Ensure dir (memoized) then append. On ENOENT (dir deleted externally
   * after the memo was set) evict the memo, re-mkdir, and retry once.
   * Non-ENOENT errors propagate without a retry.
   */
  private async writeWithRecovery(filePath: string, content: string): Promise<void> {
    const dir = path.dirname(filePath);
    await this.ensureDir(dir);
    try {
      await fs.appendFile(filePath, content, 'utf-8');
    } catch (err: any) {
      if (err?.code === 'ENOENT') {
        this.ensuredDirs.delete(dir);
        await this.ensureDir(dir);
        await fs.appendFile(filePath, content, 'utf-8');
      } else {
        throw err;
      }
    }
  }

  /**
   * Append multiple messages to the session
   *
   * Batch append operation for efficiency
   */
  async appendMessages(
    sessionId: string,
    messages: Message[],
    workspacePath?: string
  ): Promise<void> {
    const filePath = this.getSessionPath(sessionId, workspacePath);

    // Create JSONL content (one line per message)
    const jsonlContent = messages
      .map(msg => JSON.stringify(msg))
      .join('\n') + '\n';

    // Batch path benefits from the same mkdir memo (R3).
    await this.writeWithRecovery(filePath, jsonlContent);
  }

  /**
   * Get session information without loading all messages
   */
  async getSessionInfo(
    sessionId: string,
    workspacePath?: string
  ): Promise<SessionInfo | null> {
    const filePath = this.getSessionPath(sessionId, workspacePath);

    try {
      const stats = await fs.stat(filePath);
      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.split('\n').filter(line => line.trim());

      // Try to extract metadata from first message
      let metadata: SessionMetadata = {
        sessionId,
        projectPath: workspacePath || '',
        startTime: stats.birthtime.toISOString(),
        lastModified: stats.mtime.toISOString(),
        messageCount: lines.length,
        compactionCount: 0
      };

      // Count compact boundaries for compactionCount
      let compactionCount = 0;
      for (const line of lines) {
        if (!line) continue; // Handle noUncheckedIndexedAccess

        try {
          const msg = JSON.parse(line) as Message;
          if (msg.type === 'system' && (msg as any).subtype === 'compact_boundary') {
            compactionCount++;
          }
        } catch {
          // Ignore parse errors
        }
      }
      metadata.compactionCount = compactionCount;

      return {
        sessionId,
        filePath,
        metadata,
        messageCount: lines.length,
        fileSize: stats.size,
        lastModified: stats.mtime
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  /**
   * List all sessions in the base directory
   */
  async listSessions(workspacePath?: string): Promise<SessionInfo[]> {
    const searchDir = workspacePath
      ? path.join(this.config.baseDir, workspacePath.replace(/\//g, '-'))
      : this.config.baseDir;

    try {
      const entries = await fs.readdir(searchDir, { withFileTypes: true });
      const sessions: SessionInfo[] = [];

      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith('.jsonl')) {
          const sessionId = entry.name.replace('.jsonl', '');
          const info = await this.getSessionInfo(sessionId, workspacePath);
          if (info) {
            sessions.push(info);
          }
        }
      }

      // Sort by last modified (newest first)
      return sessions.sort((a, b) =>
        b.lastModified.getTime() - a.lastModified.getTime()
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  /**
   * Delete a session
   */
  async deleteSession(sessionId: string, workspacePath?: string): Promise<boolean> {
    const filePath = this.getSessionPath(sessionId, workspacePath);

    try {
      await fs.unlink(filePath);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return false;
      }
      throw error;
    }
  }

  /**
   * Create a backup of the session file
   */
  private async createBackup(filePath: string): Promise<void> {
    try {
      // Check if file exists
      await fs.access(filePath);

      // Create backup with timestamp
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupPath = `${filePath}.backup-${timestamp}`;

      await fs.copyFile(filePath, backupPath);

      // Clean up old backups
      await this.cleanupOldBackups(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        // Only throw if it's not a "file doesn't exist" error
        throw error;
      }
    }
  }

  /**
   * Remove old backup files, keeping only the most recent ones
   */
  private async cleanupOldBackups(filePath: string): Promise<void> {
    const dir = path.dirname(filePath);
    const baseName = path.basename(filePath);

    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      // Find all backup files for this session
      const backups = entries
        .filter(e => e.isFile() && e.name.startsWith(`${baseName}.backup-`))
        .map(e => ({
          name: e.name,
          path: path.join(dir, e.name)
        }));

      // Sort by name (timestamp is in the name)
      backups.sort((a, b) => b.name.localeCompare(a.name));

      // Remove old backups beyond maxBackups
      const toDelete = backups.slice(this.config.maxBackups);
      for (const backup of toDelete) {
        await fs.unlink(backup.path);
      }
    } catch {
      // Ignore errors during cleanup
    }
  }

  /**
   * Get the metadata file path for a session
   */
  getMetadataPath(sessionId: string, workspacePath?: string): string {
    const sessionPath = this.getSessionPath(sessionId, workspacePath);
    return sessionPath.replace('.jsonl', '.meta.json');
  }

  /**
   * Save session metadata (includes cache metrics, model info, etc.)
   */
  async saveMetadata(
    sessionId: string,
    metadata: Partial<SessionMetadata>,
    workspacePath?: string
  ): Promise<void> {
    const metadataPath = this.getMetadataPath(sessionId, workspacePath);

    // Ensure directory exists
    const { mkdir } = await import('fs/promises');
    const path = await import('path');
    await mkdir(path.dirname(metadataPath), { recursive: true });

    // Load existing metadata and merge
    let existingMetadata: Partial<SessionMetadata> = {};
    try {
      const content = await fs.readFile(metadataPath, 'utf-8');
      existingMetadata = JSON.parse(content);
    } catch {
      // No existing metadata, start fresh
    }

    // Merge metadata (new values override old)
    const mergedMetadata = {
      ...existingMetadata,
      ...metadata,
      sessionId,
      lastModified: new Date().toISOString()
    };

    await fs.writeFile(metadataPath, JSON.stringify(mergedMetadata, null, 2), 'utf-8');
  }

  /**
   * Load session metadata
   */
  async loadMetadata(
    sessionId: string,
    workspacePath?: string
  ): Promise<SessionMetadata | null> {
    const metadataPath = this.getMetadataPath(sessionId, workspacePath);

    try {
      const content = await fs.readFile(metadataPath, 'utf-8');
      return JSON.parse(content) as SessionMetadata;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  /**
   * Get storage statistics
   */
  async getStorageStats(workspacePath?: string): Promise<{
    totalSessions: number;
    totalMessages: number;
    totalSize: number;
    oldestSession: Date | null;
    newestSession: Date | null;
  }> {
    const sessions = await this.listSessions(workspacePath);

    if (sessions.length === 0) {
      return {
        totalSessions: 0,
        totalMessages: 0,
        totalSize: 0,
        oldestSession: null,
        newestSession: null
      };
    }

    const totalMessages = sessions.reduce((sum, s) => sum + s.messageCount, 0);
    const totalSize = sessions.reduce((sum, s) => sum + s.fileSize, 0);

    const dates = sessions.map(s => s.lastModified);
    const oldestSession = new Date(Math.min(...dates.map(d => d.getTime())));
    const newestSession = new Date(Math.max(...dates.map(d => d.getTime())));

    return {
      totalSessions: sessions.length,
      totalMessages,
      totalSize,
      oldestSession,
      newestSession
    };
  }
}
