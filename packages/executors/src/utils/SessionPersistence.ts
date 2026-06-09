/**
 * SessionPersistence - Manages tmux session metadata storage
 * Stores session information in .cortex/tmux-sessions/metadata/
 */
import * as fs from 'fs';
import * as path from 'path';
import { TmuxSessionMetadata } from './TmuxManager.js';

export class SessionPersistence {
  private metadataDir: string;

  constructor(projectPath?: string) {
    const basePath = projectPath || process.cwd();
    this.metadataDir = path.join(basePath, '.cortex', 'tmux-sessions', 'metadata');
    this.ensureMetadataDir();
  }

  /**
   * Ensure the metadata directory exists
   */
  private ensureMetadataDir(): void {
    if (!fs.existsSync(this.metadataDir)) {
      fs.mkdirSync(this.metadataDir, { recursive: true });
    }
  }

  /**
   * Get the file path for a session's metadata
   */
  private getMetadataPath(sessionId: string): string {
    return path.join(this.metadataDir, `${sessionId}.json`);
  }

  /**
   * Save session metadata to disk
   * @param metadata Session metadata to save
   */
  public async saveSession(metadata: TmuxSessionMetadata): Promise<void> {
    try {
      const filePath = this.getMetadataPath(metadata.sessionId);
      const data = JSON.stringify(
        {
          ...metadata,
          created: metadata.created.toISOString(),
          lastUsed: metadata.lastUsed.toISOString()
        },
        null,
        2
      );
      fs.writeFileSync(filePath, data, 'utf-8');
    } catch (error: any) {
      throw new Error(`Failed to save session metadata: ${error.message}`);
    }
  }

  /**
   * Load session metadata from disk
   * @param sessionId Session identifier
   * @returns Session metadata or null if not found
   */
  public async loadSession(sessionId: string): Promise<TmuxSessionMetadata | null> {
    try {
      const filePath = this.getMetadataPath(sessionId);

      if (!fs.existsSync(filePath)) {
        return null;
      }

      const data = fs.readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(data);

      return {
        ...parsed,
        created: new Date(parsed.created),
        lastUsed: new Date(parsed.lastUsed)
      };
    } catch (error: any) {
      throw new Error(`Failed to load session metadata: ${error.message}`);
    }
  }

  /**
   * Update lastUsed timestamp for a session
   * @param sessionId Session identifier
   */
  public async touchSession(sessionId: string): Promise<void> {
    const metadata = await this.loadSession(sessionId);
    if (metadata) {
      metadata.lastUsed = new Date();
      await this.saveSession(metadata);
    }
  }

  /**
   * Delete session metadata from disk
   * @param sessionId Session identifier
   */
  public async deleteSession(sessionId: string): Promise<void> {
    try {
      const filePath = this.getMetadataPath(sessionId);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (error: any) {
      throw new Error(`Failed to delete session metadata: ${error.message}`);
    }
  }

  /**
   * List all stored session metadata
   * @returns Array of session metadata
   */
  public async listSessions(): Promise<TmuxSessionMetadata[]> {
    try {
      if (!fs.existsSync(this.metadataDir)) {
        return [];
      }

      const files = fs.readdirSync(this.metadataDir);
      const sessions: TmuxSessionMetadata[] = [];

      for (const file of files) {
        if (file.endsWith('.json')) {
          const sessionId = file.replace('.json', '');
          const metadata = await this.loadSession(sessionId);
          if (metadata) {
            sessions.push(metadata);
          }
        }
      }

      return sessions;
    } catch (error: any) {
      throw new Error(`Failed to list sessions: ${error.message}`);
    }
  }

  /**
   * Clean up metadata for sessions that no longer exist in tmux
   * @param activeSessions Array of active session IDs from tmux
   */
  public async cleanupOrphaned(activeSessions: string[]): Promise<number> {
    try {
      const stored = await this.listSessions();
      let cleaned = 0;

      for (const metadata of stored) {
        if (!activeSessions.includes(metadata.sessionId)) {
          await this.deleteSession(metadata.sessionId);
          cleaned++;
        }
      }

      return cleaned;
    } catch (error: any) {
      throw new Error(`Failed to cleanup orphaned sessions: ${error.message}`);
    }
  }

  /**
   * Clean up sessions that haven't been used in a specified time period
   * @param maxAgeMs Maximum age in milliseconds
   */
  public async cleanupStale(maxAgeMs: number): Promise<number> {
    try {
      const stored = await this.listSessions();
      const now = Date.now();
      let cleaned = 0;

      for (const metadata of stored) {
        const age = now - metadata.lastUsed.getTime();
        if (age > maxAgeMs) {
          await this.deleteSession(metadata.sessionId);
          cleaned++;
        }
      }

      return cleaned;
    } catch (error: any) {
      throw new Error(`Failed to cleanup stale sessions: ${error.message}`);
    }
  }

  /**
   * Get metadata directory path
   */
  public getMetadataDirectory(): string {
    return this.metadataDir;
  }

  /**
   * Recover sessions on startup
   * Checks which persisted sessions still exist in tmux
   * and cleans up metadata for sessions that no longer exist
   *
   * @param activeSessions Array of currently active tmux session IDs
   * @returns Object with recovered and cleaned session counts
   */
  public async recoverSessions(activeSessions: string[]): Promise<{
    recovered: number;
    cleaned: number;
    total: number;
  }> {
    const storedSessions = await this.listSessions();
    let recovered = 0;
    let cleaned = 0;

    for (const metadata of storedSessions) {
      if (activeSessions.includes(metadata.sessionId)) {
        // Session still exists - recovered
        recovered++;
        // Update lastUsed to indicate recovery
        metadata.lastUsed = new Date();
        await this.saveSession(metadata);
      } else {
        // Session no longer exists - clean up metadata
        await this.deleteSession(metadata.sessionId);
        cleaned++;
      }
    }

    return {
      recovered,
      cleaned,
      total: storedSessions.length
    };
  }

  /**
   * Auto-cleanup stale and orphaned sessions
   * Should be called periodically (e.g., every hour)
   *
   * @param activeSessions Current active tmux sessions
   * @param maxAgeHours Maximum age in hours before session is considered stale
   * @returns Cleanup statistics
   */
  public async autoCleanup(
    activeSessions: string[],
    maxAgeHours: number = 24
  ): Promise<{
    orphaned: number;
    stale: number;
    total: number;
  }> {
    const maxAgeMs = maxAgeHours * 60 * 60 * 1000;
    const orphanedCount = await this.cleanupOrphaned(activeSessions);
    const staleCount = await this.cleanupStale(maxAgeMs);

    return {
      orphaned: orphanedCount,
      stale: staleCount,
      total: orphanedCount + staleCount
    };
  }

  /**
   * Get session statistics
   */
  public async getStats(): Promise<{
    totalSessions: number;
    oldestSession: Date | null;
    newestSession: Date | null;
    averageAge: number;
  }> {
    const sessions = await this.listSessions();

    if (sessions.length === 0) {
      return {
        totalSessions: 0,
        oldestSession: null,
        newestSession: null,
        averageAge: 0
      };
    }

    const now = Date.now();
    const ages = sessions.map(s => now - s.created.getTime());
    const averageAge = ages.reduce((sum, age) => sum + age, 0) / ages.length;

    const sortedByCreated = sessions.sort((a, b) => a.created.getTime() - b.created.getTime());

    return {
      totalSessions: sessions.length,
      oldestSession: sortedByCreated[0]?.created || new Date(),
      newestSession: sortedByCreated[sortedByCreated.length - 1]?.created || new Date(),
      averageAge: averageAge / (60 * 60 * 1000) // Convert to hours
    };
  }
}
