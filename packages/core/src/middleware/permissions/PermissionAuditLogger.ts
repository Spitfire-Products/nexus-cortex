/**
 * Permission Audit Logger
 *
 * JSONL-based audit logging for all permission decisions.
 * Each line is a JSON object representing a single audit entry.
 *
 * Features:
 * - Append-only logging (tamper-evident)
 * - JSONL format (one JSON object per line)
 * - Query interface for audit entries
 * - Session and tool filtering
 *
 * @module permissions/PermissionAuditLogger
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { createReadStream, createWriteStream } from 'node:fs';
import { createInterface } from 'node:readline';
import type { PermissionAuditEntry } from '../contracts/MiddlewareContracts.js';

/**
 * Options for audit logger
 */
export interface PermissionAuditLoggerOptions {
  /**
   * Maximum file size before rotation (bytes)
   * @default 10MB
   */
  maxFileSizeBytes?: number;

  /**
   * Whether to enable file rotation
   * @default true
   */
  enableRotation?: boolean;

  /**
   * Number of rotated files to keep
   * @default 5
   */
  maxRotatedFiles?: number;
}

/**
 * Query options for filtering audit entries
 */
export interface AuditQueryOptions {
  /**
   * Filter by session ID
   */
  sessionId?: string;

  /**
   * Filter by tool name
   */
  toolName?: string;

  /**
   * Only return denied operations
   */
  deniedOnly?: boolean;

  /**
   * Only return approved operations
   */
  approvedOnly?: boolean;

  /**
   * Start date for filtering
   */
  startDate?: Date;

  /**
   * End date for filtering
   */
  endDate?: Date;

  /**
   * Maximum number of entries to return
   */
  limit?: number;
}

/**
 * Permission audit logger with JSONL storage
 *
 * @example
 * ```typescript
 * const logger = new PermissionAuditLogger('/path/to/audit.log');
 *
 * await logger.log({
 *   timestamp: new Date(),
 *   sessionId: '123',
 *   toolName: 'read_file',
 *   toolInput: { file_path: '/workspace/file.txt' },
 *   decision: { allowed: true },
 *   approvalRequested: false
 * });
 *
 * const entries = await logger.query({ sessionId: '123' });
 * ```
 */
export class PermissionAuditLogger {
  private logPath: string;
  private options: Required<PermissionAuditLoggerOptions>;
  private writeStream: fs.WriteStream | null = null;

  /**
   * Create a new permission audit logger
   *
   * @param logPath Path to the audit log file
   * @param options Logger options
   */
  constructor(logPath: string, options: PermissionAuditLoggerOptions = {}) {
    this.logPath = path.resolve(logPath);
    this.options = {
      maxFileSizeBytes: options.maxFileSizeBytes ?? 10 * 1024 * 1024, // 10MB
      enableRotation: options.enableRotation ?? true,
      maxRotatedFiles: options.maxRotatedFiles ?? 5,
    };

    // Ensure directory exists
    this.ensureDirectoryExists();
  }

  /**
   * Log a permission audit entry
   */
  async log(entry: PermissionAuditEntry): Promise<void> {
    // Check if rotation is needed
    if (this.options.enableRotation) {
      await this.rotateIfNeeded();
    }

    // Convert entry to JSON line
    const jsonLine = JSON.stringify(entry) + '\n';

    // Write to file
    await this.writeToFile(jsonLine);
  }

  /**
   * Query audit entries with filtering
   */
  async query(options: AuditQueryOptions = {}): Promise<PermissionAuditEntry[]> {
    if (!fs.existsSync(this.logPath)) {
      return [];
    }

    const entries: PermissionAuditEntry[] = [];
    const stream = createReadStream(this.logPath, { encoding: 'utf-8' });
    const rl = createInterface({ input: stream });

    for await (const line of rl) {
      if (!line.trim()) continue;

      try {
        const entry = JSON.parse(line) as PermissionAuditEntry;

        // Convert timestamp string back to Date
        entry.timestamp = new Date(entry.timestamp);

        // Apply filters
        if (options.sessionId && entry.sessionId !== options.sessionId) {
          continue;
        }

        if (options.toolName && entry.toolName !== options.toolName) {
          continue;
        }

        if (options.deniedOnly && entry.decision.allowed) {
          continue;
        }

        if (options.approvedOnly && !entry.decision.allowed) {
          continue;
        }

        if (options.startDate && entry.timestamp < options.startDate) {
          continue;
        }

        if (options.endDate && entry.timestamp > options.endDate) {
          continue;
        }

        entries.push(entry);

        // Check limit
        if (options.limit && entries.length >= options.limit) {
          break;
        }
      } catch (error) {
        console.error('[PermissionAuditLogger] Error parsing line:', error);
        // Continue processing other lines
      }
    }

    return entries;
  }

  /**
   * Get entries for a specific session
   */
  async getEntriesBySession(sessionId: string): Promise<PermissionAuditEntry[]> {
    return this.query({ sessionId });
  }

  /**
   * Get entries for a specific tool
   */
  async getEntriesByTool(toolName: string): Promise<PermissionAuditEntry[]> {
    return this.query({ toolName });
  }

  /**
   * Get all denied operations
   */
  async getDeniedOperations(): Promise<PermissionAuditEntry[]> {
    return this.query({ deniedOnly: true });
  }

  /**
   * Get all operations that required approval
   */
  async getApprovalRequests(): Promise<PermissionAuditEntry[]> {
    const entries = await this.query();
    return entries.filter((e) => e.approvalRequested);
  }

  /**
   * Get audit statistics
   */
  async getStatistics(): Promise<{
    totalEntries: number;
    allowedCount: number;
    deniedCount: number;
    approvalRequestCount: number;
    approvalGrantedCount: number;
    uniqueSessions: number;
    uniqueTools: Set<string>;
  }> {
    const entries = await this.query();

    const uniqueSessions = new Set(entries.map((e) => e.sessionId));
    const uniqueTools = new Set(entries.map((e) => e.toolName));

    return {
      totalEntries: entries.length,
      allowedCount: entries.filter((e) => e.decision.allowed).length,
      deniedCount: entries.filter((e) => !e.decision.allowed).length,
      approvalRequestCount: entries.filter((e) => e.approvalRequested).length,
      approvalGrantedCount: entries.filter((e) => e.approvalGranted === true)
        .length,
      uniqueSessions: uniqueSessions.size,
      uniqueTools,
    };
  }

  /**
   * Clear the audit log
   * WARNING: This is a destructive operation
   */
  async clear(): Promise<void> {
    if (this.writeStream) {
      this.writeStream.close();
      this.writeStream = null;
    }

    if (fs.existsSync(this.logPath)) {
      await fs.promises.unlink(this.logPath);
    }
  }

  /**
   * Close the logger and cleanup resources
   */
  async close(): Promise<void> {
    if (this.writeStream) {
      return new Promise((resolve) => {
        this.writeStream!.end(() => {
          this.writeStream = null;
          resolve();
        });
      });
    }
  }

  /**
   * Ensure the log directory exists
   */
  private ensureDirectoryExists(): void {
    const dir = path.dirname(this.logPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * Write to file with append
   */
  private async writeToFile(data: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.writeStream) {
        this.writeStream = createWriteStream(this.logPath, { flags: 'a' });
      }

      this.writeStream.write(data, (error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Rotate log file if size exceeds limit
   *
   * Round 9 (parallel-bench output): previously called `fs.existsSync`
   * before the async `fs.promises.stat`. This method is called from `log()`
   * on every audit-log write — i.e. per permission check (10-20× per
   * multi-iter turn). Sync I/O inside an async hot path blocks the event
   * loop. The async `stat` already throws `ENOENT` when the file doesn't
   * exist; we catch and treat as "no rotation needed", eliminating the
   * sync `existsSync` call.
   */
  private async rotateIfNeeded(): Promise<void> {
    let stats: import('fs').Stats;
    try {
      stats = await fs.promises.stat(this.logPath);
    } catch (err: any) {
      if (err && err.code === 'ENOENT') return; // file doesn't exist yet
      throw err;
    }

    if (stats.size >= this.options.maxFileSizeBytes) {
      // Close current stream
      if (this.writeStream) {
        await this.close();
      }

      // Rotate files
      await this.rotateFiles();
    }
  }

  /**
   * Rotate log files
   */
  private async rotateFiles(): Promise<void> {
    // Delete oldest file if it exists
    const oldestFile = `${this.logPath}.${this.options.maxRotatedFiles}`;
    if (fs.existsSync(oldestFile)) {
      await fs.promises.unlink(oldestFile);
    }

    // Shift existing rotated files
    for (let i = this.options.maxRotatedFiles - 1; i >= 1; i--) {
      const oldFile = `${this.logPath}.${i}`;
      const newFile = `${this.logPath}.${i + 1}`;

      if (fs.existsSync(oldFile)) {
        await fs.promises.rename(oldFile, newFile);
      }
    }

    // Rotate current file
    await fs.promises.rename(this.logPath, `${this.logPath}.1`);
  }
}
