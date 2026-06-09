/**
 * File Checkpoint Manager
 * Tracks file modifications and creates automatic snapshots
 * Based on research: 02-claude-cli-analysis/FILE_CHECKPOINT_SYSTEM.md
 */

import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs/promises';
import { ContentAddressableStore } from './ContentAddressableStore.js';
import { FileHistorySnapshotMessage, FileBackupInfo } from '../session/MessageTypes.js';

/**
 * Tracked file state
 */
interface TrackedFile {
  filePath: string;
  currentVersion: number;
  lastBackup: string | null;       // Backup filename or null
  lastModified: string;             // ISO timestamp
  modified: boolean;                // Modified since last snapshot
}

/**
 * Snapshot creation result
 */
export interface SnapshotResult {
  success: boolean;
  messageId: string;
  snapshotMessage: FileHistorySnapshotMessage;
  backedUpFiles: string[];
  error?: string;
}

/**
 * File restoration result
 */
export interface RestoreResult {
  success: boolean;
  filePath: string;
  version: number;
  error?: string;
}

/**
 * Manages file checkpoint lifecycle
 */
export class FileCheckpointManager {
  private store: ContentAddressableStore;
  private trackedFiles: Map<string, TrackedFile>;

  constructor(baseDir: string, sessionId: string) {
    this.store = new ContentAddressableStore(baseDir, sessionId);
    this.trackedFiles = new Map();
  }

  /**
   * Initialize checkpoint manager
   */
  async initialize(): Promise<void> {
    await this.store.initialize();
  }

  /**
   * Mark file as modified
   * Called after Write or Edit tool usage
   */
  markModified(filePath: string): void {
    const tracked = this.trackedFiles.get(filePath);

    if (tracked) {
      tracked.modified = true;
      tracked.lastModified = new Date().toISOString();
    } else {
      // Start tracking new file
      this.trackedFiles.set(filePath, {
        filePath,
        currentVersion: 0,
        lastBackup: null,
        lastModified: new Date().toISOString(),
        modified: true
      });
    }
  }

  /**
   * Create snapshot for current message
   * Backs up all modified files
   */
  async createSnapshot(messageId: string): Promise<SnapshotResult> {
    const backedUpFiles: string[] = [];
    const trackedFileBackups: Record<string, FileBackupInfo> = {};

    try {
      // Process each tracked file
      for (const [filePath, tracked] of this.trackedFiles) {
        if (tracked.modified) {
          // File was modified, create backup
          const content = await this.readFileContent(filePath);
          const nextVersion = tracked.currentVersion + 1;
          const backup = await this.store.saveBackup(content, nextVersion);

          // Update tracked state
          tracked.currentVersion = nextVersion;
          tracked.lastBackup = backup.backupFileName;
          tracked.modified = false;
          tracked.lastModified = backup.timestamp;

          trackedFileBackups[filePath] = {
            backupFileName: backup.backupFileName,
            version: nextVersion,
            backupTime: backup.timestamp
          };

          backedUpFiles.push(filePath);
        } else {
          // File not modified, keep existing backup info
          trackedFileBackups[filePath] = {
            backupFileName: tracked.lastBackup,
            version: tracked.currentVersion,
            backupTime: tracked.lastModified
          };
        }
      }

      // Create snapshot message
      const snapshotMessage: FileHistorySnapshotMessage = {
        type: 'file-history-snapshot',
        uuid: uuidv4(),
        timestamp: new Date().toISOString(),
        messageId,
        snapshot: {
          messageId,
          trackedFileBackups,
          timestamp: new Date().toISOString()
        },
        isSnapshotUpdate: backedUpFiles.length > 0
      };

      return {
        success: true,
        messageId,
        snapshotMessage,
        backedUpFiles
      };
    } catch (error) {
      return {
        success: false,
        messageId,
        snapshotMessage: this.createEmptySnapshot(messageId),
        backedUpFiles,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Create empty snapshot (no files tracked or modified)
   */
  private createEmptySnapshot(messageId: string): FileHistorySnapshotMessage {
    return {
      type: 'file-history-snapshot',
      uuid: uuidv4(),
      timestamp: new Date().toISOString(),
      messageId,
      snapshot: {
        messageId,
        trackedFileBackups: {},
        timestamp: new Date().toISOString()
      },
      isSnapshotUpdate: false
    };
  }

  /**
   * Read file content
   * Helper method for backup creation
   */
  private async readFileContent(filePath: string): Promise<string> {
    try {
      return await fs.readFile(filePath, 'utf8');
    } catch (error) {
      throw new Error(`Failed to read file ${filePath}: ${error}`);
    }
  }

  /**
   * Restore file from backup
   */
  async restoreFile(filePath: string, version: number): Promise<RestoreResult> {
    const tracked = this.trackedFiles.get(filePath);

    if (!tracked) {
      return {
        success: false,
        filePath,
        version,
        error: `File ${filePath} is not being tracked`
      };
    }

    if (version > tracked.currentVersion || version < 1) {
      return {
        success: false,
        filePath,
        version,
        error: `Invalid version ${version}. Valid range: 1-${tracked.currentVersion}`
      };
    }

    try {
      // Find backup with this version
      const allBackups = await this.store.listBackups();
      const backup = allBackups.find(b => b.version === version);

      if (!backup) {
        return {
          success: false,
          filePath,
          version,
          error: `Backup for version ${version} not found`
        };
      }

      // Load backup content
      const content = await this.store.loadBackup(backup.backupFileName);

      // Restore file
      await fs.writeFile(filePath, content, 'utf8');

      // Mark as modified (will be backed up on next snapshot)
      this.markModified(filePath);

      return {
        success: true,
        filePath,
        version
      };
    } catch (error) {
      return {
        success: false,
        filePath,
        version,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Get file version history
   * Returns all versions for a tracked file
   */
  getFileHistory(filePath: string): FileBackupInfo[] | null {
    const tracked = this.trackedFiles.get(filePath);
    if (!tracked) {
      return null;
    }

    // Build history from tracked state
    const history: FileBackupInfo[] = [];
    for (let v = 1; v <= tracked.currentVersion; v++) {
      history.push({
        backupFileName: v === tracked.currentVersion ? tracked.lastBackup : `v${v}`,
        version: v,
        backupTime: v === tracked.currentVersion ? tracked.lastModified : 'unknown'
      });
    }

    return history;
  }

  /**
   * Get all tracked files
   */
  getTrackedFiles(): string[] {
    return Array.from(this.trackedFiles.keys());
  }

  /**
   * Get tracked file info
   */
  getTrackedFileInfo(filePath: string): TrackedFile | null {
    return this.trackedFiles.get(filePath) || null;
  }

  /**
   * Load snapshots from session history
   * Restores tracked file state from existing snapshots
   */
  loadFromSnapshots(snapshots: FileHistorySnapshotMessage[]): void {
    // Process snapshots in chronological order
    for (const snapshot of snapshots) {
      if (!snapshot.isSnapshotUpdate) {
        continue;  // Skip empty snapshots
      }

      // Update tracked file state
      for (const [filePath, backupInfo] of Object.entries(snapshot.snapshot.trackedFileBackups)) {
        this.trackedFiles.set(filePath, {
          filePath,
          currentVersion: backupInfo.version,
          lastBackup: backupInfo.backupFileName,
          lastModified: backupInfo.backupTime,
          modified: false
        });
      }
    }
  }

  /**
   * Get checkpoint statistics
   */
  async getStats() {
    const storeStats = await this.store.getStats();
    return {
      trackedFiles: this.trackedFiles.size,
      totalBackups: storeStats.totalFiles,
      totalSize: storeStats.totalSize,
      modifiedFiles: Array.from(this.trackedFiles.values()).filter(f => f.modified).length
    };
  }

  /**
   * Clean up checkpoint storage
   */
  async cleanup(): Promise<void> {
    await this.store.cleanup();
    this.trackedFiles.clear();
  }
}
